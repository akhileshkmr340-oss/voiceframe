import { requiresGeneratedVideo, assertGeneratedVideo, forwardClipTime } from './motion-policy.js?v=25';
// Frame compositor: camera moves, colour grade, particles, grain, letterbox,
// captions, title and end cards. draw(ctx, t) is pure in t, so preview and
// export render identical frames.
import { transitionFor } from './music.js?v=25';

export const INTRO = 4.2, OUTRO = 6.5;
// Pacing: films breathe (title card, slow dissolves); Shorts cut fast with no title card.
const PACE = {
  film:   { intro: INTRO, outro: OUTRO, lead: 0.7, gap: 0.4, tail: 1.0, minScene: 4.5, xf: 1.0 },
  shorts: { intro: 0, outro: 1.0, lead: 0.25, gap: 0.2, tail: 0.45, minScene: 2.8, xf: 0.12 }
};

export function sizeFor(format, quality = 1080) {
  const k = quality / 1080;
  const [w, h] = format === '9:16' ? [1080, 1920] : format === '1:1' ? [1080, 1080] : [1920, 1080];
  return { W: Math.round(w * k / 2) * 2, H: Math.round(h * k / 2) * 2 };
}

// audio[i] = [{buffer, text, speaker}] for scene i
export function buildTimeline(scenes, audio, shorts = false) {
  const { intro, outro, lead, gap, tail, minScene, xf } = PACE[shorts ? 'shorts' : 'film'];
  let cursor = 0;
  const out = [], segments = [];
  scenes.forEach((sc, i) => {
    const start = cursor;
    let t = start + (i === 0 ? intro + lead : lead);
    for (const a of audio[i] || []) {
      if (!a.buffer) continue;
      segments.push({ start: t, end: t + a.buffer.duration, buffer: a.buffer, text: a.text, speaker: a.speaker, scene: i });
      t += a.buffer.duration + gap;
    }
    const end = Math.max(t - gap + tail, start + (i === 0 ? intro + minScene : minScene));
    out.push({ start, end, ambience: sc.ambience });
    cursor = end;
  });
  return { scenes: out, segments, outroStart: cursor, total: cursor + outro, intro, outro, xf };
}

const ease = p => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, p)));
const clamp01 = v => Math.min(1, Math.max(0, v));
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

const GRADES = {
  epic:       { filter: 'contrast(1.12) saturate(1.06) brightness(0.97)', tint: ['rgba(0,90,120,', 'rgba(255,140,40,'], a: 0.22 },
  adventure:  { filter: 'contrast(1.08) saturate(1.15) brightness(1.02)', tint: ['rgba(0,120,140,', 'rgba(255,170,60,'], a: 0.18 },
  emotional:  { filter: 'contrast(1.03) saturate(1.02) brightness(1.03) sepia(0.12)', tint: ['rgba(255,190,140,', 'rgba(120,80,160,'], a: 0.16 },
  mysterious: { filter: 'contrast(1.14) saturate(0.82) brightness(0.92)', tint: ['rgba(20,60,120,', 'rgba(60,140,140,'], a: 0.25 },
  dark:       { filter: 'contrast(1.2) saturate(0.7) brightness(0.86)', tint: ['rgba(10,30,70,', 'rgba(90,10,20,'], a: 0.28 },
  romantic:   { filter: 'contrast(1.02) saturate(1.08) brightness(1.04) sepia(0.1)', tint: ['rgba(255,150,170,', 'rgba(255,200,120,'], a: 0.18 },
  joyful:     { filter: 'contrast(1.05) saturate(1.22) brightness(1.05)', tint: ['rgba(255,220,120,', 'rgba(80,200,255,'], a: 0.14 },
  scifi:      { filter: 'contrast(1.12) saturate(1.1) hue-rotate(-6deg)', tint: ['rgba(0,200,255,', 'rgba(220,40,200,'], a: 0.2 }
};

function particleKind(ambience, mood) {
  if (ambience === 'rain') return 'rain';
  if (ambience === 'fire' || mood === 'epic') return 'embers';
  if (ambience === 'night' || ambience === 'forest' || mood === 'romantic') return 'fireflies';
  if (mood === 'dark') return 'ash';
  if (ambience === 'city' || ambience === 'ocean') return 'none';
  return 'dust';
}

// ---------------- 2.5D depth camera (WebGL2) ----------------
// Each output pixel samples the picture at a position shifted by the camera move
// times (depth - focus): near things move more than far things. A few refinement
// steps keep foreground edges from smearing.
const VERT = `#version 300 es
out vec2 vUv;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uImg, uDepth;
uniform vec2 uScale, uCenter, uCam;
uniform float uDolly, uFocus;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 s = vec2(vUv.x, 1.0 - vUv.y);            // screen, top-down
  vec2 uv = uCenter + (s - 0.5) * uScale;       // picture, top-down
  vec2 dir = uCam + (s - 0.5) * uDolly;
  float d = texture(uDepth, uv).r;
  for (int k = 0; k < 4; k++) d = texture(uDepth, clamp(uv - dir * (d - uFocus), 0.0, 1.0)).r;
  outColor = texture(uImg, clamp(uv - dir * (d - uFocus), 0.001, 0.999));
}`;
const glCache = new Map();
function depthGL(W, H) {
  const k = W + 'x' + H;
  if (!glCache.has(k)) {
    try { glCache.set(k, new DepthGL(W, H)); } catch (e) { console.warn('3D camera unavailable:', e.message); glCache.set(k, null); }
  }
  return glCache.get(k);
}
class DepthGL {
  constructor(W, H) {
    this.canvas = new OffscreenCanvas(W, H);
    const gl = this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 not supported');
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = this.prog = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.useProgram(p);
    this.loc = Object.fromEntries(['uImg', 'uDepth', 'uScale', 'uCenter', 'uCam', 'uDolly', 'uFocus'].map(n => [n, gl.getUniformLocation(p, n)]));
    gl.uniform1i(this.loc.uImg, 0); gl.uniform1i(this.loc.uDepth, 1);
    gl.bindVertexArray(gl.createVertexArray());
    gl.viewport(0, 0, W, H);
    this.tex = new WeakMap();
  }
  texture(src) {
    if (this.tex.has(src)) return this.tex.get(src);
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex.set(src, t);
    return t;
  }
  draw(img, depth, { scale, center, cam, dolly, focus }) {
    const gl = this.gl, L = this.loc;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture(img));
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texture(depth));
    gl.uniform2f(L.uScale, scale[0], scale[1]); gl.uniform2f(L.uCenter, center[0], center[1]);
    gl.uniform2f(L.uCam, cam[0], cam[1]); gl.uniform1f(L.uDolly, dolly); gl.uniform1f(L.uFocus, focus);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }
}

export class Renderer {
  // depths[i]: optional grayscale depth map (white = near) for 2.5D camera motion
  // videos[i]: optional <video> of an AI-animated clip for the scene (played instead of the still)
  // brand: optional { name, logo: ImageBitmap|null, subscribe } for the channel badge and Subscribe pop-ups
  constructor(project, images, timeline, W, H, depths = [], videos = [], brand = null) {
    assertGeneratedVideo(project);
    this.brand = brand && (brand.name || brand.logo) ? brand : null;
    this.videos = videos;
    this.xf = timeline.xf ?? 1.0; this.intro = timeline.intro ?? INTRO; this.outro = timeline.outro ?? OUTRO;
    this.p = project; this.images = images; this.tl = timeline; this.W = W; this.H = H;
    this.depths = depths;
    this.o = project.look || {};
    this.grade = GRADES[project.mood] || GRADES.epic;
    this.trans = transitionFor(project.mood);
    this.u = Math.min(W, H) / 1080;
    this.portrait = H > W;
    this.bar = this.o.bars && !this.portrait && W / H > 1.5 ? Math.round((H - W / 2.39) / 2) : 0;
    this.makeGrain();
    this.makeVignette();
    this.capFont = `"Inter", "Noto Sans Devanagari", system-ui, sans-serif`;
    this.groups = this.tl.segments.map(s => this.wordGroups(s.text));
  }
  makeGrain() {
    this.grain = [];
    for (let k = 0; k < 4; k++) {
      const c = new OffscreenCanvas(256, 256), x = c.getContext('2d'), d = x.createImageData(256, 256);
      for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
      x.putImageData(d, 0, 0);
      this.grain.push(c);
    }
  }
  makeVignette() {
    const c = new OffscreenCanvas(this.W, this.H), x = c.getContext('2d');
    const g = x.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.35, this.W / 2, this.H / 2, Math.hypot(this.W, this.H) * 0.6);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.62)');
    x.fillStyle = g; x.fillRect(0, 0, this.W, this.H);
    this.vignette = c;
  }

  // Retiming is forward-only. It does not perform speech lip-sync.
  clipTime(i, t) {
    const s = this.tl.scenes[i], v = this.videos[i];
    return forwardClipTime(t - (s.start - this.xf / 2), s.end - s.start + this.xf, v.duration);
  }
  // Seek every clip visible at time t to the right frame; call (and await) before draw().
  async prepare(t) {
    const S = this.tl.scenes;
    let i = S.findIndex(s => t < s.end); if (i < 0) i = S.length - 1;
    const near = [i];
    if (i < S.length - 1 && t > S[i].end - this.xf / 2) near.push(i + 1);
    if (i > 0 && t < S[i].start + this.xf / 2) near.push(i - 1);
    await Promise.all(near.map(k => {
      const v = this.videos[k];
      if (!v || !(v.duration > 0)) return null;
      const target = this.clipTime(k, t);
      if (Math.abs(v.currentTime - target) < 0.004) return null;
      return new Promise(res => {
        const done = () => { clearTimeout(to); v.removeEventListener('seeked', done); res(); };
        const to = setTimeout(done, 1500);
        v.addEventListener('seeked', done);
        v.currentTime = target;
      });
    }));
  }

  draw(ctx, t) {
    const { W, H } = this, S = this.tl.scenes, n = S.length;
    ctx.save();
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    let i = S.findIndex(s => t < s.end); if (i < 0) i = n - 1;
    // transition: blend with neighbour near each cut
    const cutNext = i < n - 1 ? S[i].end : Infinity, cutPrev = i > 0 ? S[i].start : -Infinity;
    if (t > cutNext - this.xf / 2) this.blend(ctx, i, i + 1, (t - (cutNext - this.xf / 2)) / this.xf, t);
    else if (t < cutPrev + this.xf / 2) this.blend(ctx, i - 1, i, (t - (cutPrev - this.xf / 2)) / this.xf, t);
    else this.scene(ctx, i, t, 1);

    if (this.o.grain) this.overlayGrade(ctx);
    this.particles(ctx, i, t);
    ctx.drawImage(this.vignette, 0, 0);
    if (this.o.grain) this.drawGrain(ctx, t);
    this.letterbox(ctx, t);
    if (t < this.intro + 0.2) this.title(ctx, t);
    if (this.o.captions !== 'none') this.captions(ctx, t);
    if (t > this.tl.outroStart) this.endCard(ctx, t - this.tl.outroStart);
    if (this.o.watermark) this.watermark(ctx);
    if (this.brand && t > Math.max(0.8, this.intro) && t < this.tl.outroStart + 0.5) {
      this.badge(ctx);
      if (this.brand.subscribe) this.subscribe(ctx, t);
    }
    if (t < 0.6) { ctx.fillStyle = `rgba(0,0,0,${1 - t / 0.6})`; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  blend(ctx, a, b, p, t) {
    p = clamp01(p);
    if (this.trans === 'dip') {
      if (p < 0.5) this.scene(ctx, a, t, 1); else this.scene(ctx, b, t, 1);
      ctx.fillStyle = `rgba(0,0,0,${1 - Math.abs(p - 0.5) * 2})`; ctx.fillRect(0, 0, this.W, this.H);
      return;
    }
    this.scene(ctx, a, t, 1);
    this.scene(ctx, b, t, ease(p));
    if (this.trans === 'flash') {
      const k = Math.sin(p * Math.PI);
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createRadialGradient(this.W * 0.8, this.H * 0.2, 0, this.W * 0.8, this.H * 0.2, this.W * 0.9);
      g.addColorStop(0, `rgba(255,190,120,${0.55 * k})`); g.addColorStop(0.5, `rgba(255,100,40,${0.25 * k})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  scene(ctx, i, t, alpha) {
    const s = this.tl.scenes[i], img = this.images[i], { W, H } = this;
    if (requiresGeneratedVideo(this.p) && (!this.videos[i] || this.videos[i].readyState < 2)) {
      throw new Error(`Scene ${i + 1} has no playable AI video. Rendering stopped instead of using a moving still.`);
    }
    const p = (t - (s.start - this.xf / 2)) / (s.end - s.start + this.xf);
    ctx.globalAlpha = alpha;
    if (!img) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#1d1830'); g.addColorStop(1, '#0b0a12');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.font = `600 ${40 * this.u}px ${this.capFont}`; ctx.textAlign = 'center';
      ctx.fillText(this.p.scenes[i]?.title || '', W / 2, H / 2);
      ctx.globalAlpha = 1; return;
    }
    const vid = this.videos[i];
    if (vid && vid.readyState >= 2) {
      // AI clip: cover-fit with a gentle push-in so it matches the film's camera language
      const vw = vid.videoWidth, vh = vid.videoHeight, z = 1.02 + 0.05 * ease(p);
      const s2 = Math.max(W / vw, H / vh) * z, dw = vw * s2, dh = vh * s2;
      if (this.o.grain) ctx.filter = this.grade.filter;
      ctx.drawImage(vid, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
      return;
    }
    const iw = img.width, ih = img.height, base = Math.max(W / iw, H / ih);
    const e = ease(p), cam = this.p.scenes[i]?.camera || 'push-in';
    let z = 1.12, ox = 0, oy = 0, dolly = 0, cx = 0, cy = 0;
    // z/ox/oy frame the shot; dolly/cx/cy drive the 3D parallax when a depth map exists
    switch (cam) {
      case 'push-in': z = 1.03 + 0.17 * e; dolly = 0.07 * e; break;
      case 'pull-out': z = 1.2 - 0.17 * e; dolly = 0.07 * (1 - e); break;
      case 'pan-left': z = 1.16; ox = 1 - 2 * e; cx = 0.04 * (1 - 2 * e); break;
      case 'pan-right': z = 1.16; ox = -1 + 2 * e; cx = -0.04 * (1 - 2 * e); break;
      case 'tilt-up': z = 1.16; oy = -1 + 2 * e; cy = 0.035 * (1 - 2 * e); break;
      case 'tilt-down': z = 1.16; oy = 1 - 2 * e; cy = -0.035 * (1 - 2 * e); break;
      default: z = 1.08 + 0.08 * e; ox = -0.5 + e; oy = 0.3 - 0.6 * e; cx = 0.025 * (1 - 2 * e); dolly = 0.03 * e;
    }
    const dw = iw * base * z, dh = ih * base * z;
    const mx = (dw - W) / 2, my = (dh - H) / 2;
    // subtle handheld breathing keeps still images alive
    const bx = Math.sin(t * 0.7 + i) * 2 * this.u, by = Math.cos(t * 0.53 + i) * 2 * this.u;
    const x0 = (W - dw) / 2 + ox * mx + bx, y0 = (H - dh) / 2 + oy * my + by;
    const depth = this.o.depth !== false && this.depths[i];
    const gl = depth && depthGL(W, H);
    if (this.o.grain) ctx.filter = this.grade.filter;
    if (gl) {
      // 2.5D: the same framing, but near and far parts of the picture move at
      // different speeds, like a real camera moving through the scene.
      const sway = Math.sin(t * 0.45 + i * 1.7) * 0.006;
      ctx.drawImage(gl.draw(img, depth, {
        scale: [W / dw, H / dh], center: [(W / 2 - x0) / dw, (H / 2 - y0) / dh],
        cam: [cx + sway, cy + sway * 0.5], dolly, focus: 0.3
      }), 0, 0, W, H);
    } else {
      ctx.drawImage(img, x0, y0, dw, dh);
    }
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
  }

  overlayGrade(ctx) {
    const { W, H } = this, [c1, c2] = this.grade.tint, a = this.grade.a;
    ctx.globalCompositeOperation = 'soft-light';
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, c1 + a + ')'); g.addColorStop(1, c2 + a + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  drawGrain(ctx, t) {
    const f = Math.floor(t * 24);
    ctx.globalAlpha = 0.05; ctx.globalCompositeOperation = 'overlay';
    const pat = ctx.createPattern(this.grain[f % 4], 'repeat');
    ctx.translate(-(hash(f) * 256), -(hash(f + 9) * 256));
    ctx.fillStyle = pat; ctx.fillRect(0, 0, this.W + 256, this.H + 256);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  particles(ctx, i, t) {
    const kind = particleKind(this.p.scenes[i]?.ambience, this.p.mood);
    if (kind === 'none') return;
    const { W, H, u } = this, N = kind === 'rain' ? 140 : 46;
    ctx.save();
    for (let k = 0; k < N; k++) {
      const r1 = hash(k + 1), r2 = hash(k + 101), r3 = hash(k + 211), r4 = hash(k + 307);
      if (kind === 'rain') {
        const sp = 1400 + r3 * 900, x = ((r1 * W + t * 220) % (W + 100)) - 50, y = ((r2 * H + t * sp) % (H + 200)) - 100;
        ctx.strokeStyle = `rgba(200,220,255,${0.12 + r4 * 0.18})`; ctx.lineWidth = 1.2 * u;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 8 * u, y + 34 * u); ctx.stroke();
        continue;
      }
      const up = kind === 'embers' ? -1 : kind === 'ash' ? 0.6 : -0.2;
      const sp = (12 + r3 * 40) * u;
      const x = ((r1 * W + Math.sin(t * (0.3 + r4) + k) * 40 * u + t * sp * 0.4) % W + W) % W;
      const y = ((r2 * H + up * t * sp) % H + H) % H;
      const size = (kind === 'fireflies' ? 3 : kind === 'embers' ? 2.4 : 1.6) * u * (0.6 + r4);
      const tw = kind === 'fireflies' ? 0.5 + 0.5 * Math.sin(t * (1 + r3 * 2) + k * 3) : 1;
      const col = kind === 'embers' ? `255,${140 + r3 * 80 | 0},60` : kind === 'fireflies' ? '255,240,150' : kind === 'ash' ? '200,200,210' : '255,250,235';
      const a = (kind === 'dust' ? 0.25 : 0.7) * tw;
      ctx.fillStyle = `rgba(${col},${a})`;
      if (kind !== 'dust') { ctx.shadowColor = `rgba(${col},0.9)`; ctx.shadowBlur = 10 * u; }
      ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  letterbox(ctx, t) {
    const { W, H } = this;
    if (this.bar) {
      const b = this.bar * ease(Math.min(1, t / 1.6));
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, b); ctx.fillRect(0, H - b, W, b);
    } else {
      const g = ctx.createLinearGradient(0, H * 0.6, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = g; ctx.fillRect(0, H * 0.6, W, H * 0.4);
    }
  }

  title(ctx, t) {
    const { W, H, u } = this;
    const a = clamp01((t - 0.5) / 0.9) * clamp01((this.intro - t) / 0.8);
    if (a <= 0) return;
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.35 * a})`; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const words = (this.p.title || '').toUpperCase();
    let fs = (this.portrait ? 92 : 104) * u;
    ctx.font = `700 ${fs}px Cinzel, "Noto Sans Devanagari", serif`;
    const spacing = (4 + t * 3) * u;
    ctx.letterSpacing = spacing + 'px';
    const maxW = W * 0.86;
    const lines = wrap(ctx, words, maxW);
    if (lines.length > 2) { fs *= 0.75; ctx.font = `700 ${fs}px Cinzel, "Noto Sans Devanagari", serif`; }
    const L = wrap(ctx, words, maxW);
    ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 30 * u;
    const g = ctx.createLinearGradient(0, H / 2 - fs, 0, H / 2 + fs);
    g.addColorStop(0, '#fff6e0'); g.addColorStop(1, '#f5b544');
    ctx.fillStyle = g;
    L.forEach((ln, k) => ctx.fillText(ln, W / 2, H / 2 + (k - (L.length - 1) / 2) * fs * 1.15));
    ctx.letterSpacing = 6 * u + 'px';
    ctx.font = `600 ${22 * u}px Inter, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.shadowBlur = 10 * u;
    ctx.fillText('AN ORIGINAL STORY', W / 2, H / 2 - (L.length / 2) * fs * 1.15 - 40 * u);
    ctx.restore();
  }

  wordGroups(text) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const weights = words.map(w => w.length + 2 + (/[,;:]$/.test(w) ? 3 : /[.!?।]$/.test(w) ? 6 : 0));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    const timed = words.map((w, k) => { const s = acc / total; acc += weights[k]; return { w, s, e: acc / total }; });
    const groups = [];
    let cur = [];
    timed.forEach((x, k) => {
      cur.push(x);
      if (cur.length >= (this.portrait ? 4 : 7) || (cur.length >= 3 && /[,.!?;:।]$/.test(x.w)) || k === timed.length - 1) { groups.push(cur); cur = []; }
    });
    return groups;
  }

  captions(ctx, t) {
    const segs = this.tl.segments;
    const k = segs.findIndex(s => t >= s.start && t < s.end + 0.3);
    if (k < 0) return;
    const s = segs[k], frac = clamp01((t - s.start) / (s.end - s.start));
    const groups = this.groups[k];
    const g = groups.find(gr => frac < gr[gr.length - 1].e) || groups[groups.length - 1];
    if (!g) return;
    const { W, H, u } = this;
    const fs = Math.round((this.portrait ? 64 : 52) * u);
    ctx.save();
    ctx.font = `800 ${fs}px ${this.capFont}`;
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    const lines = [[]];
    let lw = 0;
    const maxW = W * (this.portrait ? 0.84 : 0.8), space = ctx.measureText(' ').width;
    g.forEach(x => {
      const w = ctx.measureText(x.w).width;
      if (lw + w > maxW && lines[lines.length - 1].length) { lines.push([]); lw = 0; }
      lines[lines.length - 1].push({ ...x, width: w }); lw += w + space;
    });
    const lh = fs * 1.22;
    const bottom = this.portrait ? H * 0.74 : H - (this.bar || H * 0.06) - fs * 0.9;
    const y0 = bottom - (lines.length - 1) * lh;
    if (s.speaker) {
      ctx.font = `700 ${Math.round(fs * 0.5)}px ${this.capFont}`;
      ctx.fillStyle = '#f5b544'; ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 8 * u;
      ctx.fillText(s.speaker.toUpperCase(), W / 2, y0 - fs * 1.05);
      ctx.font = `800 ${fs}px ${this.capFont}`; ctx.textAlign = 'left'; ctx.shadowBlur = 0;
    }
    lines.forEach((ln, li) => {
      const total = ln.reduce((a, x) => a + x.width, 0) + space * (ln.length - 1);
      let x = (W - total) / 2;
      const y = y0 + li * lh;
      ln.forEach(wd => {
        const active = this.o.captions === 'karaoke' && frac >= wd.s && frac < wd.e;
        const past = frac >= wd.e;
        ctx.lineJoin = 'round'; ctx.lineWidth = fs * 0.16; ctx.strokeStyle = 'rgba(0,0,0,.85)';
        ctx.strokeText(wd.w, x, y);
        ctx.fillStyle = this.o.captions === 'karaoke' ? (active ? '#ffc94d' : past ? '#ffffff' : 'rgba(255,255,255,.82)') : '#fff';
        ctx.fillText(wd.w, x, y);
        x += wd.width + space;
      });
    });
    ctx.restore();
  }

  endCard(ctx, dt) {
    const { W, H, u } = this;
    ctx.fillStyle = `rgba(0,0,0,${clamp01(dt / 1.4)})`; ctx.fillRect(0, 0, W, H);
    const a = clamp01((dt - 1.2) / 1) * clamp01((this.outro - dt) / 0.8);
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.letterSpacing = 10 * u + 'px';
    ctx.font = `700 ${70 * u}px Cinzel, serif`; ctx.fillStyle = '#f5d590';
    ctx.fillText('THE END', W / 2, H / 2 - 70 * u);
    ctx.letterSpacing = 2 * u + 'px';
    ctx.font = `500 ${24 * u}px Inter, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,.75)';
    const lines = [
      `“${this.p.title}”`,
      `Created by ${this.p.ownerName || 'a VoiceFrame storyteller'}`,
      'Original story, AI visuals & synthetic narration · Original score',
      'Made with VoiceFrame Studio'
    ];
    lines.forEach((l, k) => ctx.fillText(l, W / 2, H / 2 + (10 + k * 40) * u));
    ctx.restore();
  }

  // Channel badge: round logo (or initials) and channel name, top-left.
  badge(ctx) {
    const { u } = this, b = this.brand, d = (this.portrait ? 92 : 78) * u, m = 26 * u;
    const x = m, y = (this.bar || 0) + m, cx = x + d / 2, cy = y + d / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 14 * u;
    ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.fillStyle = '#d61f2c'; ctx.fill();
    ctx.shadowBlur = 0;
    if (b.logo) {
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, d / 2 - 3 * u, 0, Math.PI * 2); ctx.clip();
      const s = Math.max(d / b.logo.width, d / b.logo.height);
      ctx.drawImage(b.logo, cx - b.logo.width * s / 2, cy - b.logo.height * s / 2, b.logo.width * s, b.logo.height * s);
      ctx.restore();
    } else {
      const ini = (b.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      ctx.fillStyle = '#fff'; ctx.font = `800 ${d * 0.4}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ini, cx, cy + d * 0.02);
    }
    ctx.lineWidth = 3 * u; ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx, cy, d / 2 - 1.5 * u, 0, Math.PI * 2); ctx.stroke();
    if (b.name) {
      ctx.font = `800 ${Math.round(d * 0.3)}px Inter, "Noto Sans Devanagari", sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = 5 * u; ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.strokeText(b.name, x + d + 12 * u, cy);
      ctx.fillStyle = '#fff'; ctx.fillText(b.name, x + d + 12 * u, cy);
    }
    ctx.restore();
  }

  // When Subscribe pop-ups show: a few seconds in, then every 75 s (once, mid-way, for Shorts).
  subTimes() {
    if (this._subTimes) return this._subTimes;
    const start = Math.max(this.intro, 0) + (this.tl.total < 40 ? this.tl.total * 0.45 : 6), end = this.tl.outroStart - 4.5, out = [];
    for (let t = start; t < end; t += this.tl.total < 40 ? 999 : 75) out.push(t);
    return (this._subTimes = out);
  }
  // YouTube-style pop-up: the button slides up, a cursor clicks it, it turns grey and the bell rings.
  subscribe(ctx, t) {
    const s0 = this.subTimes().find(s => t >= s && t < s + 4.2);
    if (s0 === undefined) return;
    const k = t - s0, { W, H, u } = this;
    const a = clamp01(k / 0.35) * clamp01((4.2 - k) / 0.5), clicked = k > 1.7;
    const bw = 300 * u, bh = 76 * u;
    const cx = W / 2, cy = this.portrait ? H * 0.865 : H - (this.bar || 0) - 70 * u - (this.o.captions === 'none' ? 0 : 60 * u);
    const lift = (1 - ease(clamp01(k / 0.45))) * 60 * u;
    const press = k > 1.55 && k < 1.8 ? 0.94 : 1;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(cx, cy + lift); ctx.scale(press, press);
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 18 * u;
    ctx.fillStyle = clicked ? '#606060' : '#ff0000';
    ctx.beginPath(); ctx.roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(bh * 0.4)}px Inter, sans-serif`;
    ctx.fillText(clicked ? 'SUBSCRIBED' : 'SUBSCRIBE', 0, 2 * u);
    // bell, ringing after the click
    if (clicked) {
      const bx = bw / 2 + 52 * u, sw = Math.sin((k - 1.7) * 18) * clamp01((3.4 - k) / 1.2) * 0.45;
      ctx.save(); ctx.translate(bx, -10 * u); ctx.rotate(sw);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.moveTo(-20 * u, 22 * u); ctx.quadraticCurveTo(-18 * u, -14 * u, 0, -20 * u); ctx.quadraticCurveTo(18 * u, -14 * u, 20 * u, 22 * u); ctx.closePath();
      ctx.stroke(); ctx.fill();
      ctx.beginPath(); ctx.arc(0, 28 * u, 6 * u, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    // hand cursor glides in and taps the button
    if (k > 0.5 && k < 3.2) {
      const p = ease(clamp01((k - 0.5) / 1.05));
      const px = cx + bw * 0.18 + (1 - p) * W * 0.25, py = cy + lift + bh * 0.15 + (1 - p) * H * 0.12;
      const tap = k > 1.55 && k < 1.8 ? 0.85 : 1, s = 1.6 * u * tap;
      ctx.save(); ctx.globalAlpha = a * clamp01((3.2 - k) / 0.4);
      ctx.translate(px, py); ctx.scale(s, s);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, 30); ctx.lineTo(7, 23); ctx.lineTo(12, 34); ctx.lineTo(17, 32); ctx.lineTo(12, 21); ctx.lineTo(22, 21); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  watermark(ctx) {
    const { W, H, u } = this;
    ctx.save(); ctx.font = `600 ${18 * u}px Inter, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.textAlign = 'right';
    ctx.fillText('Made with VoiceFrame', W - 24 * u, (this.bar || 0) + 36 * u);
    ctx.restore();
  }
}

function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/), lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function srt(timeline) {
  const ts = s => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  return timeline.segments.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${s.speaker ? s.speaker + ': ' : ''}${s.text}\n`).join('\n');
}
