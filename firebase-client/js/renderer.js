// Frame compositor: camera moves, colour grade, particles, grain, letterbox,
// captions, title and end cards. draw(ctx, t) is pure in t, so preview and
// export render identical frames.
import { mouthEnvelope } from './faces.js?v=65';
import { bodyStyle } from './body.js?v=65';
// facial expressions: [smile, eyebrows, jaw held open, laugh bursts]
const EXPR = { neutral: [0, 0, 0, 0], smile: [0.8, 0.2, 0, 0], laugh: [1, 0.35, 0.12, 1], sad: [-0.6, 0.35, 0, 0], angry: [-0.35, -0.75, 0, 0], surprised: [0, 1, 0.3, 0], worried: [-0.3, 0.45, 0, 0] };
// action-timeline moves -> the body motion that plays them
const MOVE_STYLE = { raise: 'point', point: 'point', wave: 'wave', pull: 'pull', clap: 'clap', walk: 'walk', run: 'run', dance: 'dance' };
import { transitionFor } from './music.js?v=65';
import { captionFont, titleFont, splitWords, isRTLText } from './langs.js?v=65';

export const INTRO = 4.2, OUTRO = 6.5;

// Play a clip forwards at (nearly) its natural speed. Stretching a 5 s clip over an
// 11 s scene made motion slow and choppy, so playback slows to 80% at most and a
// longer scene holds the last frame (the renderer keeps pushing in). Never reverse a
// gesture or make a speaker's mouth run backwards.
function forwardClipTime(localTime, sceneLength, clipLength) {
  if (!(sceneLength > 0) || !(clipLength > 0)) return 0;
  const rate = Math.min(1, Math.max(0.8, clipLength / sceneLength));
  return Math.min(Math.max(0, localTime) * rate, Math.max(0, clipLength - 1 / 1000));
}
// Pacing: films breathe (title card, slow dissolves); Shorts cut fast with no title card.
const PACE = {
  film:   { intro: INTRO, outro: OUTRO, lead: 0.7, gap: 0.4, tail: 1.0, minScene: 4.5, xf: 0.4 },
  shorts: { intro: 0, outro: 1.0, lead: 0.25, gap: 0.2, tail: 0.45, minScene: 2.8, xf: 0.12 },
  // one shot per spoken line: brisk cuts on the line's breath, like a filmed drama
  shots:  { intro: INTRO, outro: OUTRO, lead: 0.2, gap: 0.15, tail: 0.4, minScene: 2.0, xf: 0.12 }
};

export function sizeFor(format, quality = 1080) {
  const k = quality / 1080;
  const [w, h] = format === '9:16' ? [1080, 1920] : format === '1:1' ? [1080, 1080] : [1920, 1080];
  return { W: Math.round(w * k / 2) * 2, H: Math.round(h * k / 2) * 2 };
}

// Cards and map shots are drawn here (no picture): how long each shows by default.
export const CARD_LEN = { chapter: 3.6, title: 4.2, disclaimer: 5.5, map: 7 };
export const drawnShot = sc => !!(sc?.card || sc?.map);
// A clip's playing length after the Director's trim and speed (seconds of film).
export function clipLength(sc, dur) {
  const a = Math.max(0, +sc?.trim?.[0] || 0), b = Math.min(dur, sc?.trim?.[1] > a ? +sc.trim[1] : dur);
  return Math.max(0.3, (b - a) / (+sc?.speed || 1));
}
const freezeOf = sc => sc?.freeze && +sc.freeze.dur > 0 ? { at: Math.max(0, +sc.freeze.at || 0), dur: Math.min(10, +sc.freeze.dur) } : null;

// audio[i] = [{buffer, text, speaker}] for scene i
export function buildTimeline(scenes, audio, pace = 'film') {
  const P0 = PACE[pace === true ? 'shorts' : PACE[pace] ? pace : 'film'];
  const { outro, lead, gap, tail, minScene, xf } = P0;
  // a film that opens on a card, or has its own title card, needs no title over shot 1
  const intro = scenes[0] && drawnShot(scenes[0]) || scenes.some(s => s.card?.kind === 'title') ? 0 : P0.intro;
  let cursor = 0;
  const out = [], segments = [];
  scenes.forEach((sc, i) => {
    const start = cursor;
    const fz = freezeOf(sc)?.dur || 0;
    // A shot that plays its own clip's sound: the shot is as long as the clip (so the clip
    // plays at normal speed) and the sound starts where the picture does. The renderer
    // shows the clip from xf/2 before the shot starts, so the sound skips that much.
    const own = (audio[i] || []).find(a => a.clip && a.buffer);
    if (own) {
      const len = Math.max(1, clipLength(sc, own.clipDur) - xf) + fz;
      const cut = Math.max(0, +sc.trim?.[0] || 0); // a trimmed clip's sound starts at its new in-point
      // subtitles follow the words: shown while they are spoken in the clip
      const cap = own.speech ? { capStart: start + Math.max(0, own.speech[0] - cut - xf / 2), capEnd: start + Math.max(0.5, own.speech[1] - cut - xf / 2) } : {};
      segments.push({ start, end: start + own.buffer.duration - cut - xf / 2, buffer: own.buffer, offset: xf / 2 + cut, text: own.text, speaker: own.speaker, scene: i, clip: true, ...cap });
      const end = start + len;
      out.push({ start, end, ambience: sc.ambience, sceneOf: sc.sceneOf ?? i, text: sc.text?.text ? sc.text : null });
      cursor = end;
      return;
    }
    let t = start + (i === 0 ? intro + lead : lead);
    for (const a of audio[i] || []) {
      if (!a.buffer) continue;
      segments.push({ start: t, end: t + a.buffer.duration, buffer: a.buffer, text: a.text, speaker: a.speaker, scene: i });
      t += a.buffer.duration + gap;
    }
    // cards and maps show for their own length (longer if narrated)
    const least = +sc.len > 0 ? Math.max(1.5, Math.min(20, +sc.len)) : drawnShot(sc) ? CARD_LEN[sc.card?.kind] || CARD_LEN.map : minScene;
    // a shot can be held on screen longer than its line (the storyboard's "hold"), or frozen
    const end = Math.max(t - gap + tail, start + (i === 0 ? intro + least : least)) + Math.max(0, +sc.hold || 0) + fz;
    out.push({ start, end, ambience: sc.ambience, sceneOf: sc.sceneOf ?? i, text: sc.text?.text ? sc.text : null });
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
// Looks the AI Director can put on the whole film or on some shots (the mood's grade otherwise).
export const LOOK_GRADES = {
  sepia: { filter: 'sepia(0.62) saturate(0.92) contrast(1.1) brightness(0.97)', tint: ['rgba(110,62,18,', 'rgba(255,196,96,'], a: 0.26 },
  'teal-orange': { filter: 'contrast(1.14) saturate(1.14) brightness(0.98)', tint: ['rgba(0,112,132,', 'rgba(255,138,44,'], a: 0.28 },
  bw: { filter: 'grayscale(1) contrast(1.2) brightness(0.98)', tint: null, a: 0 },
  warm: { filter: 'saturate(1.08) brightness(1.04) sepia(0.16) contrast(1.03)', tint: ['rgba(255,206,130,', 'rgba(255,160,80,'], a: 0.14 },
  cool: { filter: 'saturate(0.84) brightness(0.9) contrast(1.12) hue-rotate(8deg)', tint: ['rgba(18,44,120,', 'rgba(40,96,170,'], a: 0.3 },
  none: { filter: 'none', tint: null, a: 0 }
};
// Transitions into a shot: how long each blends (seconds).
const TRANS_LEN = { cut: 0, crossfade: 0.9, dip: 1.0, whip: 0.4 };

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
// Characters: the nearest layer of the depth map (the people in the shot) also moves
// on its own, anchored at the feet so heads and shoulders travel most: breathing,
// a weight-shifting sway, a walking or running bob, and a nod while someone speaks.
// uAct = (bob, sway, breathe, talk) amplitudes; uStep = steps per second.
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uImg, uDepth;
uniform vec2 uScale, uCenter, uCam, uTexel;
uniform float uDolly, uFocus, uTime, uStep, uSharp;
uniform vec4 uAct;
// Live faces (up to 4): handles in picture coordinates (0-1) and this frame's motion
// uDyn = (mouth open 0-1, blink 0-1, head turn in radians, nod as a picture offset).
uniform int uFaces;
uniform float uAspect;
uniform vec4 uMouth[4], uEyeA[4], uEyeB[4], uHead[4], uPiv[4], uDyn[4];
// expressions: uExpr = (smile -1..1, eyebrows -1 frown .. 1 raised, -, -); uBrow = both eyebrows
uniform vec4 uExpr[4], uBrow[4];
in vec2 vUv;
out vec4 outColor;
// Live bodies: up to 12 limbs (3 people x arms and legs). A = shoulder/hip and elbow/knee,
// B = wrist/ankle and this frame's turn at the root and at the middle joint, C = (limb
// thickness, whose mask channel). uMask: one person per channel; uPlate: the picture with
// the people filled in, shown where a limb moved away.
uniform int uLimbs;
uniform vec4 uLimbA[16], uLimbB[16], uLimbC[16];
uniform sampler2D uMask, uPlate;
uniform float uFlutter;
uniform float uAmb;
float gGhost = 0.0;
float hash1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash1(i), hash1(i + vec2(1.0, 0.0)), f.x), mix(hash1(i + vec2(0.0, 1.0)), hash1(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Leaves and grass sway in a light, gusty breeze. Greenness is read from a small
// neighbourhood so the sway fades in smoothly (no seams); the near layer (people) stays still.
vec2 foliage(vec2 uv) {
  float r = 0.006;
  vec3 c = 0.25 * (texture(uImg, uv + vec2(r, 0.0)).rgb + texture(uImg, uv - vec2(r, 0.0)).rgb
                 + texture(uImg, uv + vec2(0.0, r)).rgb + texture(uImg, uv - vec2(0.0, r)).rgb);
  float green = smoothstep(0.025, 0.09, c.g - 0.5 * (c.r + c.b)) * smoothstep(0.06, 0.18, c.g);
  if (green <= 0.0) return uv;
  float near = smoothstep(0.55, 0.8, texture(uDepth, uv).r);
  float gust = 0.55 + 0.45 * sin(uTime * 0.6 + uv.x * 4.0);
  vec2 d = vec2(0.7 * sin(uv.y * 57.0 + uTime * 1.9 + uv.x * 9.0) + 0.5 * sin(uv.y * 23.0 - uTime * 1.2 + uv.x * 31.0),
                0.35 * sin(uv.x * 41.0 + uTime * 1.4));
  return uv + d * 0.0011 * green * gust * (1.0 - near) * uAmb;
}
// Flames, diyas, lamps and bright warm windows flicker; the flicker drifts across the picture.
vec3 flicker(vec3 col, vec2 uv) {
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  float warm = smoothstep(0.55, 0.85, lum) * smoothstep(0.03, 0.16, col.r - col.b);
  if (warm <= 0.0) return col;
  // only light sources: much brighter than what is around them (a sunlit gold roof or a
  // saffron cloth is bright and warm too, but as bright as its surroundings)
  float r = 0.035, around = 0.0;
  for (int k = 0; k < 6; k++) {
    float a = float(k) * 1.0472;
    around += dot(texture(uImg, uv + vec2(cos(a), sin(a)) * r * vec2(0.5625, 1.0)).rgb, vec3(0.3, 0.59, 0.11));
  }
  warm *= smoothstep(0.1, 0.25, lum - around / 6.0);
  if (warm <= 0.0) return col;
  float n = vnoise(uv * vec2(22.0, 13.0) + vec2(uTime * 7.3, uTime * 3.1)) + 0.5 * vnoise(uv * 40.0 - uTime * 11.0);
  return col * (1.0 + uAmb * warm * (n - 0.75) * 0.22);
}
float gCav = 0.0, gTeeth = 0.0;
vec2 rotA(vec2 p, vec2 c, float a) {
  vec2 q = (p - c) * vec2(uAspect, 1.0);
  float cs = cos(a), sn = sin(a);
  q = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
  return c + q / vec2(uAspect, 1.0);
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 S = vec2(uAspect, 1.0), pa = (p - a) * S, ba = (b - a) * S;
  return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0));
}
float maskOf(vec2 uv, float k) { vec4 m = texture(uMask, uv); return k < 0.5 ? m.r : k < 1.5 ? m.g : m.b; }
float anyMask(vec2 uv) { vec4 m = texture(uMask, uv); return max(m.r, max(m.g, m.b)); }
// Output point -> picture point for bent limbs (each bone's inverse, blended by how near
// the point is to that bone and whether it lands on that person).
vec2 limbWarp(vec2 uv) {
  vec2 acc = vec2(0.0);
  float wsum = 0.0, restNear = 0.0, animNear = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uLimbs) break;
    vec4 A = uLimbA[i], B = uLimbB[i], C = uLimbC[i];
    vec2 s = A.xy, e = A.zw, w = B.xy;
    float a1 = B.z, a2 = B.w, t = C.x, k = C.y;
    if (abs(a1) + abs(a2) < 0.0005) continue;
    vec2 e2 = rotA(e, s, a1), w2 = rotA(rotA(w, s, a1), e2, a2);
    vec2 invU = rotA(uv, s, -a1), invF = rotA(rotA(uv, e2, -a2), s, -a1);
    float dU = segDist(uv, s, e2), dF = segDist(uv, e2, w2), rU = segDist(uv, s, e), rF = segDist(uv, e, w);
    // far from this limb (before and after it moved): nothing to do, no texture reads
    if (min(min(dU, dF), min(rU, rF)) > 2.2 * t) continue;
    float gU = exp(-dU * dU / (t * t)), gF = exp(-dF * dF / (t * t));
    float wU = gU > 0.01 ? gU * smoothstep(0.25, 0.6, maskOf(invU, k)) : 0.0;
    float wF = gF > 0.01 ? gF * smoothstep(0.25, 0.6, maskOf(invF, k)) : 0.0;
    acc += wU * (invU - uv) + wF * (invF - uv);
    wsum += wU + wF;
    animNear = max(animNear, max(wU, wF));
    float gr = max(exp(-rU * rU / (t * t)), exp(-rF * rF / (t * t)));
    if (gr > 0.01) restNear = max(restNear, gr * maskOf(uv, k));
  }
  gGhost = smoothstep(0.35, 0.8, restNear) * (1.0 - smoothstep(0.15, 0.5, animNear));
  return wsum > 0.0 ? uv + acc / max(wsum, 1.0) : uv;
}
// hair, loose cloth and saree ends: a soft wind-like ripple near each person's outline
vec2 flutter(vec2 uv) {
  float m = anyMask(uv);
  if (m < 0.05) return uv;
  float r = 0.012, ring = 0.25 * (anyMask(uv + vec2(r, 0.0)) + anyMask(uv - vec2(r, 0.0)) + anyMask(uv + vec2(0.0, r)) + anyMask(uv - vec2(0.0, r)));
  float edge = clamp((1.0 - ring) * 2.5, 0.0, 1.0) * m;
  vec2 d = vec2(sin(uv.y * 38.0 + uTime * 2.3 + uv.x * 11.0) + 0.5 * sin(uv.y * 91.0 - uTime * 3.7),
                0.4 * sin(uv.x * 33.0 + uTime * 1.9));
  return uv + d * uFlutter * edge;
}
vec2 gLip = vec2(0.0);
// a blink pulls the skin above the eye down over it
vec2 eyeWarp(vec2 uv, vec4 e, float b) {
  if (b <= 0.0) return uv;
  vec2 d = (uv - e.xy) / vec2(e.z * 1.3, e.w * 2.8);
  float w = 1.0 - smoothstep(0.45, 1.0, dot(d, d));
  return uv - vec2(0.0, b * e.w * 2.2 * w);
}
// Output point -> picture point (the inverse of the face motion). Points inside an
// opened mouth are flagged (gCav) and painted as the mouth's inside.
vec2 faceWarp(vec2 uv) {
  for (int k = 0; k < 4; k++) {
    if (k >= uFaces) break;
    vec4 dyn = uDyn[k], h = uHead[k];
    float wh = 1.0 - smoothstep(1.0, 1.75, length((uv - h.xy) / h.zw));
    if (wh <= 0.0) continue;
    // head: turn about the neck and nod, fading out around the head and hair
    vec2 pv = uPiv[k].xy, q = (uv - pv) * vec2(uAspect, 1.0);
    float a = -dyn.z * wh, c = cos(a), s = sin(a);
    q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    uv = pv + q / vec2(uAspect, 1.0) - vec2(0.0, dyn.w * wh);
    uv = eyeWarp(uv, uEyeA[k], dyn.y);
    uv = eyeWarp(uv, uEyeB[k], dyn.y);
    vec4 ex = uExpr[k];
    if (abs(ex.y) > 0.01) {
      vec4 br = uBrow[k];
      for (int j = 0; j < 2; j++) {
        vec2 bc = j == 0 ? br.xy : br.zw;
        vec4 e = j == 0 ? uEyeA[k] : uEyeB[k];
        float hh = max(e.y - bc.y, 0.004);
        vec2 d = (uv - bc) / vec2(e.z * 1.6, hh * 1.2);
        uv.y += ex.y * hh * 0.45 * exp(-dot(d, d) * 1.2);
      }
    }
    if (abs(ex.x) > 0.01) {
      vec4 mm = uMouth[k];
      float jw = max(mm.w - mm.y, 0.002);
      for (int j = 0; j < 2; j++) {
        float side = j == 0 ? -1.0 : 1.0;
        vec2 d = (uv - vec2(mm.x + side * mm.z, mm.y)) / vec2(mm.z * 0.6, jw * 0.35);
        float w = exp(-dot(d, d) * 1.3);
        uv += vec2(-side * ex.x * mm.z * 0.08, ex.x * jw * 0.14) * w;
      }
    }
    // jaw: below the lip line everything drops; the gap that opens is the mouth
    vec4 m = uMouth[k];
    float jaw = max(m.w - m.y, 0.002), drop = dyn.x * 0.3 * jaw, y = uv.y - m.y;
    if (drop > 0.0001 && y > 0.0) {
      float dx = (uv.x - m.x) / m.z;
      float lens = max(0.0, 1.0 - dx * dx);
      float broad = 1.0 - smoothstep(1.0, 1.9, abs(dx));
      float fall = 1.0 - smoothstep(1.0, 1.8, y / jaw);
      float gap = drop * lens;
      if (y < gap) {
        float rel = y / gap;
        gCav = max(gCav, smoothstep(0.0, 0.2, lens) * smoothstep(0.0, 0.12, rel) * (1.0 - smoothstep(0.88, 1.0, rel)));
        gTeeth = (1.0 - smoothstep(0.2, 0.34, rel)) * (1.0 - smoothstep(0.5, 0.78, abs(dx))) * smoothstep(0.25, 0.6, dyn.x);
        gLip = vec2(uv.x, m.y + jaw * 0.14);
      }
      uv.y -= drop * mix(lens, broad, smoothstep(0.0, 0.7, y / jaw)) * fall;
    }
  }
  return uv;
}
vec2 actor(vec2 uv, float d) {
  float w = smoothstep(0.45, 0.75, d);            // foreground only
  float lever = clamp(1.0 - uv.y, 0.0, 1.0);      // 0 at the feet, 1 at the top of frame
  float t = uTime;
  vec2 o = vec2(0.0);
  o.y += uAct.z * sin(6.2832 * t / 3.4) * lever;                  // breathing
  o.x += uAct.y * sin(6.2832 * t / 4.6 + 0.7) * lever;            // weight shift
  o.y -= uAct.x * abs(sin(3.1416 * t * uStep));                   // steps
  o.x += uAct.x * 0.35 * sin(3.1416 * t * uStep) * lever;         // stride sway
  o.y += uAct.w * sin(6.2832 * t * 1.7) * lever * lever;          // speaking nod
  return o * w;
}
vec4 pick(vec2 uv, vec2 dir) {
  float d = texture(uDepth, uv).r;
  for (int k = 0; k < 4; k++) d = texture(uDepth, clamp(uv - dir * (d - uFocus) - actor(uv, d), 0.0, 1.0)).r;
  vec2 p = clamp(uv - dir * (d - uFocus) - actor(uv, d), 0.001, 0.999);
  vec4 c = texture(uImg, p);
  // light unsharp mask restores detail lost to upscaling
  vec4 b = 0.25 * (texture(uImg, p + vec2(uTexel.x, 0.0)) + texture(uImg, p - vec2(uTexel.x, 0.0))
                 + texture(uImg, p + vec2(0.0, uTexel.y)) + texture(uImg, p - vec2(0.0, uTexel.y)));
  return clamp(c + uSharp * (c - b), 0.0, 1.0);
}
void main() {
  vec2 s = vec2(vUv.x, 1.0 - vUv.y);            // screen, top-down
  vec2 uv = uCenter + (s - 0.5) * uScale;       // picture, top-down
  vec2 dir = uCam + (s - 0.5) * uDolly;
  vec2 uv0 = uv;
  if (uLimbs > 0) { uv = limbWarp(uv); if (uFlutter > 0.0) uv = flutter(uv); }
  if (uFaces > 0) uv = faceWarp(uv);
  if (uAmb > 0.0) uv = foliage(uv);
  outColor = pick(uv, dir);
  if (uAmb > 0.0) outColor.rgb = flicker(outColor.rgb, uv);
  if (gGhost > 0.0) outColor.rgb = mix(outColor.rgb, texture(uPlate, uv0).rgb, gGhost);
  if (gCav > 0.0) {
    vec3 lip = texture(uImg, gLip).rgb;
    float lum = dot(lip, vec3(0.3, 0.59, 0.11));
    vec3 inside = lip * 0.15 + vec3(0.035, 0.004, 0.004);
    vec3 teeth = vec3(0.86, 0.83, 0.78) * clamp(lum * 1.7, 0.32, 0.95);
    outColor.rgb = mix(outColor.rgb, mix(inside, teeth, gTeeth), gCav);
  }
}`;
const glCache = new Map();
let flat = null;
const flatDepth = () => (flat ||= (() => { const c = new OffscreenCanvas(4, 4), x = c.getContext('2d'); x.fillStyle = 'rgb(77,77,77)'; x.fillRect(0, 0, 4, 4); return c; })());
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
    this.loc = Object.fromEntries(['uImg', 'uDepth', 'uScale', 'uCenter', 'uCam', 'uDolly', 'uFocus', 'uTexel', 'uTime', 'uStep', 'uSharp', 'uAct',
      'uFaces', 'uAspect', 'uMouth', 'uEyeA', 'uEyeB', 'uHead', 'uPiv', 'uDyn',
      'uLimbs', 'uLimbA', 'uLimbB', 'uLimbC', 'uMask', 'uPlate', 'uFlutter', 'uExpr', 'uBrow', 'uAmb'].map(n => [n, gl.getUniformLocation(p, n)]));
    gl.uniform1i(this.loc.uMask, 2); gl.uniform1i(this.loc.uPlate, 3);
    this.lbuf = { uLimbA: new Float32Array(64), uLimbB: new Float32Array(64), uLimbC: new Float32Array(64) };
    this.fbuf = Object.fromEntries(['uMouth', 'uEyeA', 'uEyeB', 'uHead', 'uPiv', 'uDyn', 'uExpr', 'uBrow'].map(n => [n, new Float32Array(16)]));
    gl.uniform1i(this.loc.uImg, 0); gl.uniform1i(this.loc.uDepth, 1);
    gl.bindVertexArray(gl.createVertexArray());
    gl.viewport(0, 0, W, H);
    this.tex = new Map(); // picture -> texture, the most recent few (GPU memory)
  }
  texture(src) {
    if (this.tex.has(src)) { const t = this.tex.get(src); this.tex.delete(src); this.tex.set(src, t); return t; }
    const gl = this.gl;
    while (this.tex.size >= 12) { const [k, old] = this.tex.entries().next().value; this.tex.delete(k); gl.deleteTexture(old); }
    const t = gl.createTexture();
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
  draw(img, depth, { scale, center, cam, dolly, focus, time = 0, act = [0, 0, 0, 0], step = 1.8, sharp = 0.35, faces = null, body = null, amb = 1 }) {
    const gl = this.gl, L = this.loc;
    gl.uniform1f(L.uAmb, amb);
    const nl = Math.min(16, body?.limbs.length || 0);
    gl.uniform1i(L.uLimbs, nl);
    gl.uniform1f(L.uFlutter, nl ? body.flutter : 0);
    if (nl) {
      const B = this.lbuf;
      body.limbs.slice(0, 16).forEach((l, k) => {
        B.uLimbA.set([l.s[0], l.s[1], l.e[0], l.e[1]], k * 4); B.uLimbB.set([l.w[0], l.w[1], l.a1, l.a2], k * 4); B.uLimbC.set([l.t, l.k, 0, 0], k * 4);
      });
      for (const [name, arr] of Object.entries(B)) gl.uniform4fv(L[name], arr);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texture(body.mask));
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.texture(body.plate));
      gl.uniform1f(L.uAspect, img.width / img.height);
    }
    const n = Math.min(4, faces?.length || 0);
    gl.uniform1i(L.uFaces, n);
    if (n) {
      const B = this.fbuf;
      faces.slice(0, 4).forEach(({ f, dyn, ex = [0, 0, 0, 0] }, k) => {
        B.uMouth.set(f.m, k * 4); B.uEyeA.set(f.a, k * 4); B.uEyeB.set(f.b, k * 4); B.uHead.set(f.h, k * 4);
        B.uExpr.set(ex, k * 4);
        // faces found before eyebrows were recorded: about three eye-heights above each eye
        B.uBrow.set(f.br || [f.a[0], f.a[1] - f.a[3] * 3, f.b[0], f.b[1] - f.b[3] * 3], k * 4);
        B.uPiv.set([f.p[0], f.p[1], 0, 0], k * 4); B.uDyn.set(dyn, k * 4);
      });
      for (const [name, arr] of Object.entries(B)) gl.uniform4fv(L[name], arr);
      gl.uniform1f(L.uAspect, img.width / img.height);
    }
    gl.uniform2f(L.uTexel, 1 / img.width, 1 / img.height);
    gl.uniform1f(L.uTime, time); gl.uniform1f(L.uStep, step); gl.uniform1f(L.uSharp, sharp);
    gl.uniform4f(L.uAct, act[0], act[1], act[2], act[3]);
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
    this.brand = brand && (brand.name || brand.logo) ? brand : null;
    // media: a pool that loads each shot's picture and clip as the film reaches it and
    // lets go of them after (a long film has hundreds); or plain arrays of both
    this.media = images?.load ? images : { image: i => images[i], video: i => videos[i], load: () => null };
    this.xf = timeline.xf ?? 1.0; this.intro = timeline.intro ?? INTRO; this.outro = timeline.outro ?? OUTRO;
    this.p = project; this.tl = timeline; this.W = W; this.H = H;
    this.depths = depths;
    this.faces = [];       // faces[i]: live-face handles for shot i (faces.js), set by the app
    this.bodies = [];      // bodies[i]: {people, mask, plate} for shot i (body.js), set by the app
    this.o = project.look || {};
    this.grade = GRADES[project.mood] || GRADES.epic;
    this.trans = transitionFor(project.mood);
    this.u = Math.min(W, H) / 1080;
    this.portrait = H > W;
    this.bar = this.o.bars && !this.portrait && W / H > 1.5 ? Math.round((H - W / 2.0) / 2) : 0;
    this.makeGrain();
    this.makeVignette();
    this.capFont = captionFont(project.language);
    this.titleFont = titleFont(project.language);
    this.serif = `Cinzel, ${this.capFont}`; // Latin titles in Cinzel; other scripts fall through to the caption fonts
    this.film = project.film || {};
    this.groups = this.tl.segments.map(s => this.wordGroups(s.text));
  }
  // The colour grade of shot i: its own look, else the film's look, else the mood's grade.
  gradeOf(i) {
    const k = this.p.scenes[i]?.grade || this.film.grade;
    return LOOK_GRADES[k] || this.grade;
  }
  // The picture area of shot i's clip (0-1, without black bars) and the point to keep in view.
  areaOf(i) {
    const a = this.p.credits?.['video-' + i]?.area;
    return a && a.w > 0.2 && a.h > 0.2 ? a : { x: 0, y: 0, w: 1, h: 1, focus: a?.focus };
  }
  // How long the transition into shot k blends (0 = hard cut).
  xfInto(k) {
    const kind = this.p.scenes[k]?.trans;
    return kind in TRANS_LEN ? TRANS_LEN[kind] : this.xf;
  }
  // A frozen frame holds the shot's time still for a while: the time the shot shows at t.
  frozen(i, t) {
    const fz = freezeOf(this.p.scenes[i]), s = this.tl.scenes[i];
    if (!fz || !s) return t;
    const at = s.start + fz.at;
    return t < at ? t : t < at + fz.dur ? at : t - fz.dur;
  }
  // A scratch canvas (shot effects and whip pans draw a shot on its own first).
  layer(n) {
    this.layers ||= [];
    const c = this.layers[n] ||= new OffscreenCanvas(this.W, this.H);
    const x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none';
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.clearRect(0, 0, this.W, this.H);
    return x;
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
  // The Director's trim (in/out), speed and reverse are applied here; without them the
  // clip plays forwards at (nearly) its natural speed.
  clipTime(i, t) {
    const s = this.tl.scenes[i], v = this.media.video(i), sc = this.p.scenes[i] || {}, D = v.duration;
    const fz = freezeOf(sc)?.dur || 0;
    const lt = this.frozen(i, t) - (s.start - this.xf / 2), len = s.end - s.start + this.xf - fz;
    const a = Math.min(Math.max(0, +sc.trim?.[0] || 0), D - 0.05), b = Math.max(a + 0.05, Math.min(D, sc.trim?.[1] > a ? +sc.trim[1] : D));
    const x = +sc.speed > 0 ? Math.min(Math.max(0, lt) * sc.speed, b - a - 0.001) : forwardClipTime(lt, len, b - a);
    return sc.reverse ? Math.max(a, b - x - 0.001) : a + x;
  }
  // Seek every clip visible at time t to the right frame; call (and await) before draw().
  async prepare(t) {
    const S = this.tl.scenes;
    let i = S.findIndex(s => t < s.end); if (i < 0) i = S.length - 1;
    const near = [i];
    if (i < S.length - 1 && t > S[i].end - Math.max(this.xf, this.xfInto(i + 1)) / 2) near.push(i + 1);
    if (i > 0 && t < S[i].start + Math.max(this.xf, this.xfInto(i)) / 2) near.push(i - 1);
    await Promise.all(near.map(k => this.media.load(k)));
    // the next two shots load meanwhile, so the cut to them never waits
    for (const k of [i + 1, i + 2]) if (k < S.length) Promise.resolve(this.media.load(k)).catch(() => {});
    const seek = (v, target) => {
      if (!v || !(v.duration > 0) || Math.abs(v.currentTime - target) < 0.004) return null;
      return new Promise(res => {
        const done = () => { clearTimeout(to); v.removeEventListener('seeked', done); res(); };
        const to = setTimeout(done, 1500);
        v.addEventListener('seeked', done);
        v.currentTime = target;
      });
    };
    // picture-in-picture: its picture or clip (looping) is loaded and seeked too
    const pips = near.map(k => this.p.scenes[k]?.pip).filter(p => p?.key && this.media.loadExtra);
    await Promise.all(pips.map(p => this.media.loadExtra(p.key)));
    await Promise.all([
      ...near.map(k => { const v = this.media.video(k); return v && v.duration > 0 ? seek(v, this.clipTime(k, t)) : null; }),
      ...near.map(k => {
        const p = this.p.scenes[k]?.pip, v = p?.key && this.media.extra?.(p.key);
        return v instanceof HTMLVideoElement && v.duration > 0 ? seek(v, Math.max(0, t - S[k].start + this.xf / 2) % Math.max(0.1, v.duration - 0.05)) : null;
      })
    ]);
  }

  draw(ctx, t) {
    const { W, H } = this, S = this.tl.scenes, n = S.length;
    ctx.save();
    // pictures are scaled up for 1080p and camera pushes: use the sharpest filter
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    let i = S.findIndex(s => t < s.end); if (i < 0) i = n - 1;
    // transition: blend with neighbour near each cut
    // each shot can have its own transition in (the Director's cut, crossfade, dip or whip)
    const cutNext = i < n - 1 ? S[i].end : Infinity, cutPrev = i > 0 ? S[i].start : -Infinity;
    const wN = i < n - 1 ? this.xfInto(i + 1) : 0, wP = i > 0 ? this.xfInto(i) : 0;
    if (wN > 0.01 && t > cutNext - wN / 2) this.blend(ctx, i, i + 1, (t - (cutNext - wN / 2)) / wN, t);
    else if (wP > 0.01 && t < cutPrev + wP / 2) this.blend(ctx, i - 1, i, (t - (cutPrev - wP / 2)) / wP, t);
    else this.scene(ctx, i, t, 1);

    // daylight shots keep natural light: half the tint (night, fire and diyas get it all)
    if (this.o.grade !== false) this.overlayGrade(ctx, /\b(morning|dawn|sunrise|daylight|daytime|noon|afternoon|sunlit|sunny|midday|window light)\b/i.test(this.p.scenes[i]?.visual || '') ? 0.5 : 1, i);
    this.particles(ctx, i, t);
    ctx.drawImage(this.vignette, 0, 0);
    if (this.o.grain) this.drawGrain(ctx, t);
    this.letterbox(ctx, t);
    if (t < this.intro + 0.2) this.title(ctx, t);
    if (S[i].text) this.shotText(ctx, S[i], t);
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
    const S = this.tl.scenes, sameScene = S[a].sceneOf === S[b].sceneOf, kind = this.p.scenes[b]?.trans;
    if (kind === 'crossfade') { this.scene(ctx, a, t, 1); this.scene(ctx, b, t, ease(p)); return; }
    if (kind === 'dip') {
      this.scene(ctx, p < 0.5 ? a : b, t, 1);
      ctx.fillStyle = `rgba(0,0,0,${1 - Math.abs(p - 0.5) * 2})`; ctx.fillRect(0, 0, this.W, this.H);
      return;
    }
    if (kind === 'whip') {
      // a fast pan: the old shot flies out to the left, the new one in from the right, motion-blurred
      const e = ease(p), blur = Math.sin(p * Math.PI) * 38 * this.u, { W, H } = this;
      for (const [k, x] of [[a, -e * W], [b, (1 - e) * W]]) {
        const lx = this.layer(2);
        this.scene(lx, k, t, 1);
        ctx.save(); ctx.filter = blur > 0.5 ? `blur(${blur.toFixed(1)}px)` : 'none';
        ctx.drawImage(lx.canvas, x, 0, W, H); ctx.restore();
      }
      return;
    }
    if (sameScene) { this.scene(ctx, a, t, 1); this.scene(ctx, b, t, ease(p)); return; }
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

  // A shot with the Director's effects (hidden regions, picture-in-picture, keyhole) is drawn
  // on its own layer first, so a cross-fade blends the finished shot.
  scene(ctx, i, t, alpha) {
    const sc = this.p.scenes[i] || {};
    t = this.frozen(i, t);
    if (!(sc.blur?.length || sc.pip?.key || (sc.keyhole && sc.keyhole !== 'none'))) return this.shot(ctx, i, t, alpha);
    const lx = this.layer(1);
    this.shot(lx, i, t, 1);
    if (sc.blur?.length) this.hideRegions(lx, sc.blur);
    if (sc.pip?.key) this.pip(lx, i, t);
    if (sc.keyhole && sc.keyhole !== 'none') this.keyhole(lx, sc.keyhole, t - this.tl.scenes[i].start);
    ctx.globalAlpha = alpha; ctx.drawImage(lx.canvas, 0, 0); ctx.globalAlpha = 1;
  }

  shot(ctx, i, t, alpha) {
    const s = this.tl.scenes[i], img = this.media.image(i), vid = this.media.video(i), { W, H } = this, sc = this.p.scenes[i] || {};
    if (sc.card) return this.card(ctx, i, t, alpha);
    if (sc.map) return this.mapShot(ctx, i, t, alpha);
    const fz = freezeOf(sc)?.dur || 0;
    let p = (t - (s.start - this.xf / 2)) / (s.end - s.start + this.xf - fz);
    if (+sc.speed > 0 && !vid) p *= sc.speed; // a faster or slower camera move on a picture
    if (sc.reverse && !vid) p = 1 - p; // a picture "played backwards": its camera move runs the other way
    // reframe: the part of the picture (0-1 box) the shot shows
    const cr = sc.crop && sc.crop.w > 0.05 && sc.crop.h > 0.05 ? sc.crop : null;
    const G = this.gradeOf(i), gradeOn = this.o.grade !== false && G.filter !== 'none';
    ctx.globalAlpha = alpha;
    if (!img && !(vid && vid.readyState >= 2)) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#1d1830'); g.addColorStop(1, '#0b0a12');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.font = `600 ${40 * this.u}px ${this.capFont}`; ctx.textAlign = 'center';
      ctx.fillText(this.p.scenes[i]?.title || '', W / 2, H / 2);
      ctx.globalAlpha = 1; return;
    }
    if (vid && vid.readyState >= 2) {
      // A clip: its picture area (black bars found on import are left out), then the
      // Director's reframe inside it. "fill" (default) covers the frame, keeping the people
      // or main subject in view; "fit" shows the whole picture; "blur-fill" puts a blurred
      // copy behind it. A gentle push-in matches the film's camera language.
      const VW = vid.videoWidth, VH = vid.videoHeight, ar = this.areaOf(i);
      let sx = ar.x * VW, sy = ar.y * VH, vw = ar.w * VW, vh = ar.h * VH;
      if (cr) { sx += cr.x * vw; sy += cr.y * vh; vw *= cr.w; vh *= cr.h; }
      const mode = sc.fill || 'fill', z = 1.02 + 0.05 * ease(p);
      if (gradeOn) ctx.filter = G.filter;
      if (mode === 'fill') {
        const s2 = Math.max(W / vw, H / vh) * z, dw = vw * s2, dh = vh * s2;
        const f = !cr && ar.focus ? ar.focus : [0.5, 0.5];
        const dx = Math.min(0, Math.max(W - dw, W / 2 - f[0] * dw)), dy = Math.min(0, Math.max(H - dh, H / 2 - f[1] * dh));
        ctx.drawImage(vid, sx, sy, vw, vh, dx, dy, dw, dh);
      } else {
        if (mode === 'blur-fill') {
          const s2 = Math.max(W / vw, H / vh) * 1.1, dw = vw * s2, dh = vh * s2;
          ctx.filter = `${gradeOn ? G.filter + ' ' : ''}blur(${Math.round(28 * this.u)}px) brightness(0.62)`;
          ctx.drawImage(vid, sx, sy, vw, vh, (W - dw) / 2, (H - dh) / 2, dw, dh);
          ctx.filter = gradeOn ? G.filter : 'none';
        } else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
        const s2 = Math.min(W / vw, H / vh) * (1 + 0.03 * ease(p)), dw = vw * s2, dh = vh * s2;
        ctx.drawImage(vid, sx, sy, vw, vh, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
      return;
    }
    const iw = cr ? cr.w * img.width : img.width, ih = cr ? cr.h * img.height : img.height, base = Math.max(W / iw, H / ih);
    const e = ease(p), cam = this.p.scenes[i]?.camera || 'push-in';
    let z = 1.12, ox = 0, oy = 0, dolly = 0, cx = 0, cy = 0;
    // z/ox/oy frame the shot; dolly/cx/cy drive the 3D parallax when a depth map exists
    switch (cam) {
      // parallax (cx, cy, dolly) is kept small: bigger values folded the picture over at
      // people's outlines (torn frames, shaking people); the framing (z, ox, oy) still travels
      case 'push-in': z = 1.03 + 0.15 * e; dolly = 0.03 * e; break;
      case 'pull-out': z = 1.18 - 0.15 * e; dolly = 0.03 * (1 - e); break;
      case 'pan-left': z = 1.16; ox = 1 - 2 * e; cx = 0.016 * (1 - 2 * e); break;
      case 'pan-right': z = 1.16; ox = -1 + 2 * e; cx = -0.016 * (1 - 2 * e); break;
      case 'tilt-up': z = 1.16; oy = -1 + 2 * e; cy = 0.014 * (1 - 2 * e); break;
      case 'tilt-down': z = 1.16; oy = 1 - 2 * e; cy = -0.014 * (1 - 2 * e); break;
      // tracking: the camera slides sideways alongside the people, so near and far move apart
      case 'track-left': z = 1.14; ox = 0.7 - 1.4 * e; cx = 0.02 * (1 - 2 * e); break;
      case 'track-right': z = 1.14; ox = -0.7 + 1.4 * e; cx = -0.02 * (1 - 2 * e); break;
      case 'orbit': z = 1.12 + 0.03 * e; ox = 0.5 - e; cx = 0.018 * Math.sin(Math.PI * (e - 0.5)); cy = -0.006 * Math.cos(Math.PI * e); dolly = 0.008; break;
      case 'handheld': z = 1.1 + 0.02 * e; ox = 0.12 * Math.sin(t * 1.3 + i) + 0.05 * Math.sin(t * 3.1); oy = 0.1 * Math.sin(t * 1.7 + 2 * i) + 0.04 * Math.sin(t * 2.6); cx = 0.006 * Math.sin(t * 0.9); break;
      default: z = 1.08 + 0.08 * e; ox = -0.5 + e; oy = 0.3 - 0.6 * e; cx = 0.012 * (1 - 2 * e); dolly = 0.016 * e;
    }
    const dw = iw * base * z, dh = ih * base * z;
    const mx = (dw - W) / 2, my = (dh - H) / 2;
    // subtle handheld breathing keeps still images alive
    const bx = Math.sin(t * 0.7 + i) * 2 * this.u, by = Math.cos(t * 0.53 + i) * 2 * this.u;
    const x0 = (W - dw) / 2 + ox * mx + bx, y0 = (H - dh) / 2 + oy * my + by;
    const faces = this.o.faces !== false && this.faces[i]?.length ? this.liveFaces(i, t) : null;
    const body = this.o.faces !== false && this.bodies[i]?.people?.length ? this.liveBody(i, t) : null;
    const depth = (this.o.depth !== false && this.depths[i]) || ((faces || body) && flatDepth());
    const gl = depth && depthGL(W, H);
    if (gradeOn) ctx.filter = G.filter;
    if (gl) {
      // 2.5D: the same framing, but near and far parts of the picture move at
      // different speeds, like a real camera moving through the scene.
      const sway = Math.sin(t * 0.45 + i * 1.7) * 0.003;
      const m = this.motion(i, t), amt = this.amount(i);
      // the shader works in whole-picture coordinates: a reframed shot maps its box back
      const sc2 = [W / dw, H / dh], c2 = [(W / 2 - x0) / dw, (H / 2 - y0) / dh];
      ctx.drawImage(gl.draw(img, depth, {
        scale: cr ? [sc2[0] * cr.w, sc2[1] * cr.h] : sc2, center: cr ? [cr.x + c2[0] * cr.w, cr.y + c2[1] * cr.h] : c2,
        cam: [cx + sway, cy + sway * 0.5], dolly, focus: 0.3,
        time: t, act: (faces ? [m.act[0], m.act[1], m.act[2], m.act[3] * 0.3] : m.act).map(v => v * amt), step: m.step, sharp: 0.35, faces, body
      }), 0, 0, W, H);
    } else if (cr) {
      ctx.drawImage(img, cr.x * img.width, cr.y * img.height, iw, ih, x0, y0, dw, dh);
    } else {
      ctx.drawImage(img, x0, y0, dw, dh);
    }
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
  }

  // How the people in scene i move, read from what the scene describes. Someone
  // speaking (a dialogue line playing now) also nods.
  motion(i, t) {
    this.acts ||= [];
    if (!this.acts[i]) {
      const sc = this.p.scenes[i] || {};
      const txt = `${sc.visual || ''} ${sc.title || ''}`.toLowerCase();
      let act = [0, 0.0016, 0.0022, 0], step = 1.8;                                   // standing: breathe, shift weight
      if (/\b(run|runs|running|race|racing|chase|chasing|sprint|rush|flee|jump|leap|dance|dancing)/.test(txt)) { act = [0.006, 0.003, 0.002, 0]; step = 2.8; }
      else if (/\b(walk|walks|walking|stroll|approach|march|wander|steps? (in|out|forward|toward))/.test(txt)) { act = [0.0035, 0.0022, 0.002, 0]; step = 1.8; }
      else if (/\b(fight|struggl|pull|tug|wrestl|storm|wind|fly|flying|kite|wave|waving)/.test(txt)) { act = [0.0015, 0.0045, 0.0024, 0]; step = 1.4; }
      else if (/\b(sit|sits|sitting|sleep|lying|kneel|rest)/.test(txt)) { act = [0, 0.0008, 0.0026, 0]; }
      this.acts[i] = { act, step };
    }
    const base = this.acts[i];
    const talking = this.tl.segments.some(g => g.scene === i && g.speaker && t >= g.start && t <= g.end);
    return talking ? { act: [base.act[0], base.act[1], base.act[2], 0.0028], step: base.step } : base;
  }

  // This frame's motion for each face in shot i. Each distinct speaker of the shot is
  // matched to a face, biggest first; the speaker's mouth follows their recorded voice,
  // everyone blinks and moves a little, listeners nod now and then.
  // How much the characters of shot i move (the storyboard's motion setting): x0.4 to x1.6.
  amount(i) {
    const v = this.p.scenes[i]?.motion ?? this.o.motion ?? 0.5;
    return 0.4 + 1.2 * Math.max(0, Math.min(1, v));
  }
  // Which face (index into faces[i]) says the line of this speaker: the one picked in the
  // storyboard (numbered left to right), else each speaker in turn, biggest face first.
  talkerFace(i, name) {
    const F = this.faces[i];
    if (!F?.length || !name) return -1;
    const pick = this.p.scenes[i]?.lipFaces?.[name];
    if (pick != null) {
      const ltr = F.map((_, k) => k).sort((a, b) => F[a].m[0] - F[b].m[0]);
      if (ltr[pick] != null) return ltr[pick];
    }
    const names = [];
    for (const g of this.tl.segments) if (g.scene === i && g.speaker && !names.includes(g.speaker)) names.push(g.speaker);
    const bySize = F.map((_, k) => k).sort((a, b) => F[b].s - F[a].s);
    return bySize[Math.max(0, names.indexOf(name)) % bySize.length];
  }
  // The shot's facial expression (picked in the storyboard, or read from the script and
  // the current beat): [smile, eyebrows, jaw held open, laughing].
  expression(i, t) {
    const sc = this.p.scenes[i] || {}, S = this.tl.scenes[i];
    let kind = sc.expr && sc.expr !== 'auto' ? sc.expr : null;
    if (!kind) {
      const p01 = clamp01((t - S.start) / Math.max(0.5, S.end - S.start));
      const beat = sc.beats?.find(b => p01 >= b.from && p01 <= b.to);
      const txt = `${beat?.act || ''} ${beat ? '' : sc.action || ''} ${sc.visual || ''}`.toLowerCase();
      kind = beat?.move === 'laugh' || /\blaugh/.test(txt) ? 'laugh' : /\b(smil|happy|joy|grin|cheer|delight)/.test(txt) ? 'smile'
        : /\b(cry|cries|tear|sad|sorrow|grief|weep)/.test(txt) ? 'sad' : /\b(angr|furious|shout|scold|glare)/.test(txt) ? 'angry'
        : /\b(surpris|shock|amaz|astonish|gasp|stunned)/.test(txt) ? 'surprised' : /\b(worr|anxious|nervous|afraid|scared|fear|tense)/.test(txt) ? 'worried' : 'neutral';
    }
    return EXPR[kind] || EXPR.neutral;
  }
  liveFaces(i, t) {
    const F = this.faces[i], amt = this.amount(i), S = this.tl.scenes[i];
    const { seg, open } = this.speech(i, t);
    // noLip (set by the app): real people's faces, whose mouths never follow the voice
    const said = this.noLip?.has(i) ? 0 : open;
    const talker = seg ? this.talkerFace(i, seg.speaker) : -1;
    const X = this.expression(i, t), xr = clamp01((t - S.start) / 0.6);
    return F.map((f, k) => {
      const ph = hash(i * 7.3 + k * 13.1) * 6.283, speaks = k === talker, xk = xr * (speaks || talker < 0 ? 1 : 0.7);
      // a laugh opens the jaw in bursts, surprise holds it a little open
      const open = Math.max(speaks ? said : 0, (X[2] + X[3] * 0.35 * Math.abs(Math.sin(t * Math.PI * 2.8 + ph))) * xk);
      const period = 2.8 + hash(i * 3.1 + k) * 2.6, bt = (t + ph) % period;
      const blink = bt < 0.17 ? Math.sin(bt / 0.17 * Math.PI) : 0;
      const tilt = 0.02 * Math.sin(t * 0.5 + ph) + (speaks ? 0.016 * Math.sin(t * 2.1 + ph) * Math.min(1, open * 2) : 0);
      const nod = f.s * (0.006 * Math.sin(t * 0.8 + ph * 2) + (speaks ? 0.025 * open : seg ? 0.008 * Math.max(0, Math.sin(t * 1.3 + ph)) : 0));
      return { f, dyn: [open, blink, tilt * amt, nod * amt], ex: [X[0] * xk, X[1] * xk, 0, 0] };
    });
  }

  // The line being spoken in shot i at time t and how open the speaker's mouth is.
  speech(i, t) {
    const seg = this.tl.segments.find(g => g.scene === i && g.speaker && g.buffer && t >= g.start - 0.1 && t <= g.end + 0.15);
    if (!seg) return { seg: null, open: 0, energy: 0 };
    seg.env ||= mouthEnvelope(seg.buffer);
    const x = (t - seg.start + 0.04) * 60, k = Math.floor(x), e = seg.env;
    const open = k < 0 || k >= e.length - 1 ? 0 : e[k] + (e[k + 1] - e[k]) * (x - k);
    // gestures follow the phrasing, not each syllable: the loudness over the last ~0.6 s
    let sum = 0, n = 0;
    for (let j = Math.max(0, k - 36); j <= Math.min(e.length - 1, k); j++) { sum += e[j]; n++; }
    return { seg, open, energy: n ? sum / n : 0 };
  }

  // This frame's limb turns for everyone in shot i, from what the script says they do
  // (bodyStyle) and, for whoever is speaking, the loudness of their line.
  liveBody(i, t) {
    const B = this.bodies[i], S = this.tl.scenes[i], sc = this.p.scenes[i];
    this.bstyle ||= [];
    const dur = Math.max(0.5, S.end - S.start), p01 = clamp01((t - S.start) / dur);
    // the action timeline: each beat its own gesture, eased in and out at its edges
    const beat = sc?.beats?.find(b => p01 >= b.from && p01 <= b.to);
    const style = beat ? (MOVE_STYLE[beat.move] || 'talk') : (this.bstyle[i] ||= bodyStyle(sc));
    const t0 = beat ? S.start + beat.from * dur : S.start;
    const beatRamp = beat ? clamp01((p01 - beat.from) * dur / 0.35 + (beat.from === 0 ? 1 : 0)) * clamp01((beat.to - p01) * dur / 0.35 + (beat.to === 1 ? 1 : 0)) : 1;
    const { seg, energy } = this.speech(i, t);
    const bySize = B.people.map((_, k) => k).sort((a, b) => B.people[b].size - B.people[a].size);
    let speaker = -1;
    if (seg) {
      // the person whose head is nearest the speaking face; without faces, biggest first
      const fi = this.talkerFace(i, seg.speaker), F = this.faces[i];
      if (fi >= 0 && F?.[fi]) {
        const [fx, fy] = F[fi].m;
        speaker = B.people.map((p, k) => [k, Math.hypot(p.nose[0] - fx, p.nose[1] - fy)]).sort((a, b) => a[1] - b[1])[0][0];
      } else {
        const names = [];
        for (const g of this.tl.segments) if (g.scene === i && g.speaker && !names.includes(g.speaker)) names.push(g.speaker);
        speaker = bySize[Math.max(0, names.indexOf(seg.speaker)) % bySize.length] ?? bySize[0];
      }
    }
    const amt = this.amount(i);
    const ramp = clamp01((t - S.start) / 0.6) * clamp01((S.end - t) / 0.6) * beatRamp * amt;
    const limbs = [];
    B.people.forEach((p, n) => {
      const ph = hash(i * 5.7 + n * 3.3) * 6.283, lead = n === bySize[0];
      // the turn that lifts a bone's far end (screen y points down)
      const lift = (a, b, side) => -Math.sign((b[0] - a[0]) || side) || 1;
      for (const [name, l] of Object.entries(p.limbs)) {
        const arm = name.startsWith('arm'), side = l.s[0] < p.hip[0] ? -1 : 1, left = name.endsWith('L');
        const lu = lift(l.s, l.e, -side), lf = lift(l.e, l.w, -side);
        let a1 = 0, a2 = 0;
        const ref = sc?.motionRef?.limbs?.[name];
        if (ref?.length && (n === speaker || (speaker < 0 && lead))) {
          const x = (t - S.start) * sc.motionRef.fps, f = Math.floor(x) % ref.length, g = (f + 1) % ref.length, u = x - Math.floor(x);
          a1 = Math.max(-1, Math.min(1, ref[f][0] + (ref[g][0] - ref[f][0]) * u));
          a2 = Math.max(-1.2, Math.min(1.2, ref[f][1] + (ref[g][1] - ref[f][1]) * u));
          limbs.push({ s: l.s, e: l.e, w: l.w, t: l.t, k: p.k, a1: a1 * ramp / amt, a2: a2 * ramp / amt });
          continue;
        }
        const sw = Math.sin(t * 2 * Math.PI * (style === 'run' ? 1.5 : 0.95) + ph) * (left ? 1 : -1);
        if (style === 'walk' || style === 'run') {
          const k = style === 'run' ? 1.8 : 1;
          // a still picture cannot really walk (the feet would stay on the spot): a gentle arm
          // swing only, legs planted; real walking comes from the AI video on the GPU
          if (arm) { a1 = 0.035 * k * sw; a2 = lf * 0.025 * k * Math.max(0, sw); }
        } else if (arm && style === 'dance' ) {
          a1 = lu * (0.12 + 0.08 * Math.sin(t * 2 * Math.PI * 1.1 + ph + (left ? 0 : Math.PI)));
          a2 = lf * 0.15 * Math.sin(t * 2 * Math.PI * 2.2 + ph);
        } else if (!arm && style === 'dance') {
          a1 = 0.03 * Math.sin(t * 2 * Math.PI * 1.1 + ph + (left ? 0 : Math.PI));
        } else if (arm && style === 'wave' && lead && !left) {
          a1 = lu * 0.28 * clamp01((t - t0) / 0.8); a2 = lf * (0.35 + 0.2 * Math.sin(t * 2 * Math.PI * 1.6));
        } else if (arm && style === 'point' && lead && !left) {
          a1 = lu * 0.22 * clamp01((t - t0) / 0.7); a2 = lf * 0.1 * clamp01((t - t0) / 0.7);
        } else if (arm && style === 'pull' && (n === speaker || (speaker < 0 && lead)) && !left) {
          // tugging a string or rope: the arm held up, the forearm pulling in short tugs
          a1 = lu * 0.2 * clamp01((t - t0) / 0.6); a2 = lf * (0.1 + 0.12 * Math.abs(Math.sin(t * Math.PI * 1.3)));
        } else if (arm && style === 'clap' && lead) {
          a2 = lf * (0.14 + 0.08 * Math.abs(Math.sin(t * Math.PI * 2.4)));
        } else if (arm) {
          // talking hands: the speaker gestures with the phrasing, mostly one hand at a time
          const dom = Math.sin(t * 0.45 + ph) > 0 === left ? 1 : 0.35;
          const g = n === speaker ? Math.min(1, energy * 1.6) : 0;
          a2 = lf * (0.03 * Math.sin(t * 0.7 + ph + (left ? 1 : 0)) + 0.2 * g * dom * (0.7 + 0.3 * Math.sin(t * 3.1 + ph)));
          a1 = lu * 0.06 * g * dom;
        }
        if (!(a1 || a2)) continue;
        limbs.push({ s: l.s, e: l.e, w: l.w, t: l.t, k: p.k, a1: a1 * ramp, a2: a2 * ramp });
      }
    });
    const windy = /wind|storm|ocean|festival/.test(sc?.ambience || '') ? 2.4 : 1;
    const flutter = 0.0011 * windy * amt * (style === 'dance' || style === 'run' ? 1.6 : 1);
    return { limbs, mask: B.mask, plate: B.plate, flutter };
  }

  // ---------------- the AI Director's shot effects ----------------
  tmp(w, h) {
    const c = (this._tmp ||= new OffscreenCanvas(1, 1));
    w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const x = c.getContext('2d'); x.clearRect(0, 0, w, h); x.imageSmoothingEnabled = true;
    return x;
  }
  // Blur, pixelate or hide boxes of the frame (0-1 coordinates): burned-in text, logos, faces.
  hideRegions(ctx, boxes) {
    const { W, H } = this, src = ctx.canvas;
    for (const b of boxes.slice(0, 6)) {
      const x = Math.max(0, b.x * W), y = Math.max(0, b.y * H), w = Math.min(W - x, b.w * W), h = Math.min(H - y, b.h * H);
      if (w < 2 || h < 2) continue;
      const m = Math.min(w, h);
      ctx.save();
      ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(20 * this.u, m * 0.2)); ctx.clip();
      if (b.mode === 'pixelate') {
        const n = Math.max(4, Math.round(w / (22 * this.u))), k = Math.max(3, Math.round(n * h / w)), tx = this.tmp(n, k);
        tx.drawImage(src, x, y, w, h, 0, 0, n, k);
        ctx.imageSmoothingEnabled = false; ctx.drawImage(tx.canvas, 0, 0, n, k, x, y, w, h);
      } else if (b.mode === 'hide') {
        // the box's own colours, smeared into a soft patch: nothing of what was there stays readable
        const tx = this.tmp(4, 4);
        tx.drawImage(src, x, y, w, h, 0, 0, 4, 4);
        ctx.filter = `blur(${(m * 0.18).toFixed(1)}px)`;
        ctx.drawImage(tx.canvas, 0, 0, 4, 4, x - m * 0.25, y - m * 0.25, w + m * 0.5, h + m * 0.5);
      } else {
        // a strong blur, sampling a margin round the box so its edges stay opaque
        const mg = Math.max(8, m * 0.3), sx = Math.max(0, x - mg), sy = Math.max(0, y - mg);
        const sw = Math.min(W, x + w + mg) - sx, sh = Math.min(H, y + h + mg) - sy, tx = this.tmp(sw, sh);
        tx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
        ctx.filter = `blur(${Math.max(8, m * 0.14).toFixed(1)}px)`;
        ctx.drawImage(tx.canvas, 0, 0, sw, sh, sx, sy, sw, sh);
        ctx.drawImage(tx.canvas, 0, 0, sw, sh, sx, sy, sw, sh);
      }
      ctx.restore();
    }
  }
  // Picture-in-picture: another shot's picture or clip in a corner.
  pip(ctx, i, t) {
    const p = this.p.scenes[i].pip, src = this.media.extra?.(p.key);
    if (!src) return;
    const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
    if (!sw || !sh || (src.readyState !== undefined && src.readyState < 2)) return;
    const { W, H, u } = this, size = Math.min(0.5, Math.max(0.15, +p.size || 0.3));
    let w = W * size, h = w * sh / sw;
    if (h > H * 0.5) { h = H * 0.5; w = h * sw / sh; }
    const m = Math.round(Math.min(W, H) * 0.045), pos = p.pos || 'tr';
    const x = pos.includes('l') ? m : W - w - m, y = pos.includes('t') ? m + (this.bar || 0) : H - h - m - (this.bar || 0);
    const a = clamp01((t - this.tl.scenes[i].start + 0.2) / 0.45);
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a;
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 24 * u;
    ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.roundRect(x - 4 * u, y - 4 * u, w + 8 * u, h + 8 * u, 14 * u); ctx.fill();
    ctx.shadowBlur = 0; ctx.beginPath(); ctx.roundRect(x, y, w, h, 10 * u); ctx.clip();
    const G = this.gradeOf(i);
    if (this.o.grade !== false && G.filter !== 'none') ctx.filter = G.filter;
    ctx.drawImage(src, x, y, w, h);
    ctx.restore();
  }
  // Framing masks: looking through a keyhole, an iris circle, or a heavy vignette.
  keyhole(ctx, shape) {
    const { W, H } = this;
    this.masks ||= {};
    const m = this.masks[shape] ||= (() => {
      const c = new OffscreenCanvas(W, H), x = c.getContext('2d'), R = Math.min(W, H);
      if (shape === 'vignette') {
        const g = x.createRadialGradient(W / 2, H / 2, R * 0.2, W / 2, H / 2, Math.hypot(W, H) * 0.5);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0.97)');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        return c;
      }
      x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'destination-out';
      x.filter = `blur(${Math.round(R * 0.018)}px)`;
      if (shape === 'circle') { x.beginPath(); x.arc(W / 2, H / 2, R * 0.44, 0, Math.PI * 2); x.fill(); return c; }
      // keyhole: a round top over a flared slot
      const cx = W / 2, cy = H * 0.39, r = R * 0.23;
      x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.moveTo(cx - r * 0.42, cy + r * 0.55); x.lineTo(cx - r * 0.82, H * 0.91); x.lineTo(cx + r * 0.82, H * 0.91); x.lineTo(cx + r * 0.42, cy + r * 0.55); x.closePath(); x.fill();
      return c;
    })();
    ctx.drawImage(m, 0, 0);
  }

  // ---------------- cards (no picture needed) ----------------
  // Chapter, title and opening-disclaimer cards; their words are in the film's language.
  card(ctx, i, t, alpha) {
    const { W, H, u } = this, s = this.tl.scenes[i], c = this.p.scenes[i].card, lt = t - s.start, len = s.end - s.start;
    ctx.save(); ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    g.addColorStop(0, c.kind === 'disclaimer' ? '#151515' : '#2c2217'); g.addColorStop(1, '#040302');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const a = clamp01((lt - 0.15) / 0.7) * clamp01((len - lt + 0.1) / 0.5);
    ctx.globalAlpha = alpha * a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 18 * u;
    const maxW = W * (this.portrait ? 0.84 : 0.7);
    const gold = (y, fs) => { const gr = ctx.createLinearGradient(0, y - fs / 2, 0, y + fs / 2); gr.addColorStop(0, '#fff3d6'); gr.addColorStop(1, '#e0a73c'); return gr; };
    if (c.kind === 'disclaimer') {
      let fs = Math.round((this.portrait ? 40 : 34) * u), L;
      for (let k = 0; k < 3; k++) { ctx.font = `500 ${fs}px ${this.capFont}`; L = wrapAny(ctx, c.text || '', maxW); if (L.length <= 8) break; fs = Math.round(fs * 0.82); }
      const top = c.title ? fs * 1.6 : 0, y0 = H / 2 - ((L.length - 1) * fs * 1.45 + top) / 2;
      if (c.title) {
        ctx.font = `700 ${Math.round(fs * 0.8)}px ${this.capFont}`; ctx.letterSpacing = 5 * u + 'px'; ctx.fillStyle = '#e0b25a';
        ctx.fillText(c.title.toUpperCase(), W / 2, y0); ctx.letterSpacing = '0px';
      }
      ctx.font = `500 ${fs}px ${this.capFont}`; ctx.fillStyle = 'rgba(236,229,214,.93)';
      L.forEach((l, k) => ctx.fillText(l, W / 2, y0 + top + k * fs * 1.45));
    } else if (c.kind === 'chapter') {
      const label = c.label || `CHAPTER ${c.num ?? ''}`.trim(), fl = Math.round((this.portrait ? 34 : 30) * u);
      ctx.font = `700 ${fl}px ${this.serif}`; ctx.letterSpacing = 8 * u + 'px'; ctx.fillStyle = '#d9a84c';
      const ly = H / 2 - 70 * u;
      ctx.fillText(label.toUpperCase(), W / 2, ly);
      const lw = ctx.measureText(label.toUpperCase()).width, rule = ease(clamp01((lt - 0.2) / 1.2)) * W * 0.16;
      ctx.letterSpacing = '0px'; ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(217,168,76,.8)'; ctx.lineWidth = 2 * u;
      ctx.beginPath(); ctx.moveTo(W / 2 - lw / 2 - 24 * u, ly); ctx.lineTo(W / 2 - lw / 2 - 24 * u - rule, ly);
      ctx.moveTo(W / 2 + lw / 2 + 24 * u, ly); ctx.lineTo(W / 2 + lw / 2 + 24 * u + rule, ly); ctx.stroke();
      ctx.shadowBlur = 22 * u;
      let fs = (this.portrait ? 84 : 92) * u, L;
      for (let k = 0; k < 3; k++) { ctx.font = `700 ${fs}px ${this.serif}`; L = wrapAny(ctx, c.title || '', maxW); if (L.length <= 2) break; fs *= 0.8; }
      const sc = 1 + (1 - ease(clamp01(lt / 1.4))) * 0.05;
      ctx.translate(W / 2, H / 2 + 40 * u + (L.length - 1) * fs * 0.55); ctx.scale(sc, sc);
      ctx.fillStyle = gold(0, fs);
      L.forEach((l, k) => ctx.fillText(l, 0, (k - (L.length - 1) / 2) * fs * 1.12));
    } else {
      let fs = (this.portrait ? 96 : 112) * u, L;
      for (let k = 0; k < 3; k++) { ctx.font = `700 ${fs}px ${this.serif}`; L = wrapAny(ctx, (c.title || this.p.title || '').toUpperCase(), W * 0.84); if (L.length <= 2) break; fs *= 0.78; }
      ctx.letterSpacing = (3 + lt * 2.5) * u + 'px';
      ctx.fillStyle = gold(H / 2, fs * 2);
      L.forEach((l, k) => ctx.fillText(l, W / 2, H / 2 + (k - (L.length - 1) / 2) * fs * 1.12));
      if (c.sub) {
        ctx.letterSpacing = 4 * u + 'px'; ctx.font = `600 ${Math.round(26 * u)}px ${this.capFont}`; ctx.fillStyle = 'rgba(255,255,255,.8)';
        ctx.fillText(c.sub, W / 2, H / 2 + (L.length / 2) * fs * 1.12 + 40 * u);
      }
    }
    ctx.restore();
  }

  // ---------------- map shot ----------------
  // An animated parchment map, drawn here (no map tiles): the land is shaped round the places
  // the AI named; regions glow in, routes draw themselves, pins drop, the year changes.
  mapBase(M) {
    const key = JSON.stringify(M);
    this.maps ||= new Map();
    if (this.maps.has(key)) return this.maps.get(key);
    const { W, H, u } = this, c = new OffscreenCanvas(W, H), x = c.getContext('2d'), R = Math.min(W, H);
    let seed = 7; for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) % 100003;
    const rnd = k => hash(seed + k * 13.37);
    // parchment
    const g = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, '#efdfb4'); g.addColorStop(0.7, '#dcc28c'); g.addColorStop(1, '#b38b52');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    for (let k = 0; k < 140; k++) {
      x.fillStyle = `rgba(${110 + rnd(k) * 40 | 0},${70 + rnd(k + 1) * 30 | 0},30,${0.02 + rnd(k + 2) * 0.05})`;
      x.beginPath(); x.ellipse(rnd(k + 3) * W, rnd(k + 4) * H, (10 + rnd(k + 5) * 90) * u, (6 + rnd(k + 6) * 50) * u, rnd(k + 7) * 3, 0, Math.PI * 2); x.fill();
    }
    // sea: a faint grey-green wash, with the land drawn over it
    x.fillStyle = 'rgba(80,104,96,0.16)'; x.fillRect(0, 0, W, H);
    const pts = [...(M.regions || []), ...(M.pins || [])].map(p => [p.x * W, p.y * H]);
    const cx = pts.length ? pts.reduce((a, p) => a + p[0], 0) / pts.length : W * 0.5, cy = pts.length ? pts.reduce((a, p) => a + p[1], 0) / pts.length : H * 0.5;
    const far = Math.max(R * 0.18, ...pts.map(p => Math.hypot(p[0] - cx, p[1] - cy)));
    const blob = (bx, by, br, k0) => {
      const path = new Path2D();
      for (let k = 0; k <= 72; k++) {
        const a = k / 72 * Math.PI * 2;
        const r = br * (1 + 0.13 * Math.sin(3 * a + rnd(k0) * 6) + 0.08 * Math.sin(7 * a + rnd(k0 + 1) * 6) + 0.04 * Math.sin(15 * a + rnd(k0 + 2) * 6));
        const px = bx + Math.cos(a) * r * 1.25, py = by + Math.sin(a) * r * 0.9;
        k ? path.lineTo(px, py) : path.moveTo(px, py);
      }
      path.closePath();
      return path;
    };
    const lands = [blob(cx, cy, far * 1.25 + R * 0.12, 1)];
    for (let k = 0; k < 3; k++) lands.push(blob(rnd(20 + k) * W, rnd(30 + k) * H, R * (0.05 + rnd(40 + k) * 0.07), 50 + k * 3));
    for (const L of lands) {
      // water lines round the coast, then the land and its coastline
      for (const [w, a] of [[16, 0.07], [10, 0.12], [5, 0.2]]) { x.strokeStyle = `rgba(70,60,40,${a})`; x.lineWidth = w * u; x.stroke(L); }
      x.fillStyle = '#ead7a6'; x.fill(L);
      x.strokeStyle = '#6a4822'; x.lineWidth = 2.6 * u; x.stroke(L);
    }
    // mountains
    x.strokeStyle = 'rgba(105,72,36,.55)'; x.lineWidth = 1.8 * u;
    for (let k = 0; k < 14; k++) {
      const mx = cx + (rnd(60 + k) - 0.5) * far * 1.6, my = cy + (rnd(80 + k) - 0.5) * far * 1.1, s = (10 + rnd(100 + k) * 10) * u;
      if (!x.isPointInPath(lands[0], mx, my)) continue;
      x.beginPath(); x.moveTo(mx - s, my + s * 0.6); x.lineTo(mx, my - s * 0.6); x.lineTo(mx + s, my + s * 0.6); x.stroke();
    }
    // grid, border and compass
    x.strokeStyle = 'rgba(95,62,28,.16)'; x.lineWidth = 1.2 * u; x.setLineDash([6 * u, 8 * u]);
    for (let k = 1; k < 8; k++) { x.beginPath(); x.moveTo(W * k / 8, 0); x.lineTo(W * k / 8, H); x.stroke(); }
    for (let k = 1; k < 5; k++) { x.beginPath(); x.moveTo(0, H * k / 5); x.lineTo(W, H * k / 5); x.stroke(); }
    x.setLineDash([]);
    x.strokeStyle = 'rgba(92,60,26,.7)'; x.lineWidth = 3 * u; x.strokeRect(R * 0.03, R * 0.03, W - R * 0.06, H - R * 0.06);
    x.lineWidth = 1.2 * u; x.strokeRect(R * 0.045, R * 0.045, W - R * 0.09, H - R * 0.09);
    const ox = W - R * 0.14, oy = H - R * 0.16, cr = R * 0.07;
    x.fillStyle = 'rgba(92,60,26,.75)';
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4 - Math.PI / 2, l = k % 2 ? cr * 0.55 : cr;
      x.beginPath(); x.moveTo(ox + Math.cos(a) * l, oy + Math.sin(a) * l);
      x.lineTo(ox + Math.cos(a + 0.35) * cr * 0.18, oy + Math.sin(a + 0.35) * cr * 0.18);
      x.lineTo(ox + Math.cos(a - 0.35) * cr * 0.18, oy + Math.sin(a - 0.35) * cr * 0.18); x.closePath(); x.fill();
    }
    x.font = `700 ${Math.round(cr * 0.38)}px ${this.serif}`; x.textAlign = 'center'; x.fillText('N', ox, oy - cr * 1.22);
    // burnt, darkened edges
    const e = x.createRadialGradient(W / 2, H / 2, R * 0.45, W / 2, H / 2, Math.hypot(W, H) * 0.55);
    e.addColorStop(0, 'rgba(60,34,8,0)'); e.addColorStop(1, 'rgba(60,34,8,.6)');
    x.fillStyle = e; x.fillRect(0, 0, W, H);
    this.maps.set(key, c);
    return c;
  }
  mapShot(ctx, i, t, alpha) {
    const { W, H, u } = this, s = this.tl.scenes[i], M = this.p.scenes[i].map;
    const lt = Math.max(0, t - s.start), len = Math.max(2, s.end - s.start), R = Math.min(W, H);
    const regions = M.regions || [], pins = M.pins || [], routes = M.routes || [];
    const place = v => Array.isArray(v) ? [v[0] * W, v[1] * H]
      : (p => p ? [p.x * W, p.y * H] : null)([...regions, ...pins].find(p => String(p.name || '').toLowerCase() === String(v || '').toLowerCase()));
    const pts = [...regions, ...pins];
    const fx = pts.length ? pts.reduce((a, p) => a + p.x, 0) / pts.length : 0.5, fy = pts.length ? pts.reduce((a, p) => a + p.y, 0) / pts.length : 0.5;
    const z = 1.0 + 0.1 * ease(lt / len);
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.translate(W * fx, H * fy); ctx.scale(z, z); ctx.translate(-W * fx, -H * fy);
    ctx.drawImage(this.mapBase(M), 0, 0);
    // one thing after another: regions, then routes, then pins
    const items = [...regions.map(r => ['r', r]), ...routes.map(r => ['l', r]), ...pins.map(p => ['p', p])];
    const step = Math.min(1.1, Math.max(0.35, (len - 2) / Math.max(1, items.length)));
    let year = M.year || '';
    const label = (txt, x, y, fs, sub) => {
      if (!txt) return;
      ctx.font = `700 ${fs}px ${this.serif}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = fs * 0.28; ctx.strokeStyle = 'rgba(244,230,196,.9)'; ctx.strokeText(txt, x, y);
      ctx.fillStyle = '#3e2410'; ctx.fillText(txt, x, y);
      if (sub) { ctx.font = `600 ${Math.round(fs * 0.7)}px ${this.capFont}`; ctx.lineWidth = fs * 0.22; ctx.strokeText(sub, x, y + fs * 0.95); ctx.fillStyle = '#8a2b12'; ctx.fillText(sub, x, y + fs * 0.95); }
    };
    items.forEach(([kind, it], k) => {
      const q = clamp01((lt - 0.5 - k * step) / 0.8);
      if (q <= 0) return;
      if (it.year) year = it.year;
      if (kind === 'r') {
        const x = it.x * W, y = it.y * H, r = Math.max(0.03, Math.min(0.3, +it.r || 0.1)) * R * (0.7 + 0.3 * ease(q));
        const pulse = 0.78 + 0.22 * Math.sin(lt * 2.3 + k);
        ctx.save();
        const path = new Path2D();
        for (let j = 0; j <= 48; j++) { const a = j / 48 * Math.PI * 2, rr = r * (1 + 0.09 * Math.sin(a * 5 + k * 1.7) + 0.05 * Math.sin(a * 9 + k)); j ? path.lineTo(x + Math.cos(a) * rr * 1.2, y + Math.sin(a) * rr) : path.moveTo(x + Math.cos(a) * rr * 1.2, y + Math.sin(a) * rr); }
        path.closePath();
        ctx.fillStyle = `rgba(178,58,22,${0.22 * q})`; ctx.fill(path);
        ctx.globalCompositeOperation = 'screen';
        const gl = ctx.createRadialGradient(x, y, 0, x, y, r * 1.6);
        gl.addColorStop(0, `rgba(255,196,90,${0.55 * q * pulse})`); gl.addColorStop(1, 'rgba(255,140,40,0)');
        ctx.fillStyle = gl; ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
        ctx.globalCompositeOperation = 'source-over';
        ctx.setLineDash([9 * u, 6 * u]); ctx.lineWidth = 3 * u; ctx.strokeStyle = `rgba(120,30,12,${0.85 * q})`; ctx.stroke(path);
        ctx.restore();
        ctx.save(); ctx.globalAlpha *= q; label(it.name, x, y, Math.round(30 * u), it.year ? String(it.year) : ''); ctx.restore();
      } else if (kind === 'l') {
        const a = place(it.from), b = place(it.to);
        if (!a || !b) return;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const nx = -(b[1] - a[1]) / (d || 1), ny = (b[0] - a[0]) / (d || 1), c = [mx + nx * d * 0.18, my + ny * d * 0.18];
        const at = v => [(1 - v) ** 2 * a[0] + 2 * (1 - v) * v * c[0] + v * v * b[0], (1 - v) ** 2 * a[1] + 2 * (1 - v) * v * c[1] + v * v * b[1]];
        const qq = ease(q);
        ctx.save(); ctx.strokeStyle = '#8c1d0e'; ctx.lineWidth = 4.5 * u; ctx.lineCap = 'round'; ctx.setLineDash([14 * u, 9 * u]);
        ctx.beginPath(); for (let j = 0; j <= 40; j++) { const p = at(qq * j / 40); j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); } ctx.stroke();
        ctx.setLineDash([]);
        const tip = at(qq), back = at(Math.max(0, qq - 0.03)), ang = Math.atan2(tip[1] - back[1], tip[0] - back[0]), hs = 16 * u;
        ctx.fillStyle = '#8c1d0e'; ctx.beginPath(); ctx.moveTo(tip[0] + Math.cos(ang) * hs, tip[1] + Math.sin(ang) * hs);
        ctx.lineTo(tip[0] + Math.cos(ang + 2.5) * hs, tip[1] + Math.sin(ang + 2.5) * hs); ctx.lineTo(tip[0] + Math.cos(ang - 2.5) * hs, tip[1] + Math.sin(ang - 2.5) * hs); ctx.fill();
        ctx.restore();
        if (it.label && q > 0.5) { const p = at(0.5); ctx.save(); ctx.globalAlpha *= clamp01((q - 0.5) * 2); label(it.label, p[0], p[1] - 22 * u, Math.round(24 * u)); ctx.restore(); }
      } else {
        const x = it.x * W, y = it.y * H - (1 - ease(q)) * 50 * u, r = 11 * u;
        ctx.save(); ctx.globalAlpha *= clamp01(q * 2);
        ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 8 * u; ctx.shadowOffsetY = 3 * u;
        ctx.fillStyle = '#b3220f'; ctx.beginPath(); ctx.arc(x, y - r * 1.6, r, Math.PI * 0.85, Math.PI * 0.15); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.fillStyle = '#f7e6c0'; ctx.beginPath(); ctx.arc(x, y - r * 1.6, r * 0.42, 0, Math.PI * 2); ctx.fill();
        label(it.name, x, y + 24 * u, Math.round(25 * u), it.year ? String(it.year) : '');
        ctx.restore();
      }
    });
    ctx.restore();
    // title and year stay still while the map drifts
    ctx.save(); ctx.globalAlpha = alpha * clamp01(lt / 0.8);
    if (M.title) {
      const fs = Math.round((this.portrait ? 46 : 50) * u);
      ctx.font = `700 ${fs}px ${this.serif}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const y = (this.bar || 0) + R * 0.12;
      ctx.lineJoin = 'round'; ctx.lineWidth = fs * 0.25; ctx.strokeStyle = 'rgba(244,230,196,.85)'; ctx.strokeText(M.title, W / 2, y);
      ctx.fillStyle = '#3a210d'; ctx.fillText(M.title, W / 2, y);
    }
    if (year) {
      const fs = Math.round((this.portrait ? 70 : 76) * u);
      ctx.font = `700 ${fs}px ${this.serif}`; ctx.textAlign = this.portrait ? 'center' : 'right'; ctx.textBaseline = 'middle';
      const x = this.portrait ? W / 2 : W - R * 0.09, y = this.portrait ? H - (this.bar || 0) - R * 0.3 : (this.bar || 0) + R * 0.13;
      const gr = ctx.createLinearGradient(0, y - fs / 2, 0, y + fs / 2); gr.addColorStop(0, '#9b5a14'); gr.addColorStop(1, '#5a2c06');
      ctx.lineWidth = fs * 0.12; ctx.strokeStyle = 'rgba(244,230,196,.8)'; ctx.strokeText(String(year), x, y);
      ctx.fillStyle = gr; ctx.fillText(String(year), x, y);
    }
    ctx.restore();
  }

  overlayGrade(ctx, k = 1, i = -1) {
    const G = i >= 0 ? this.gradeOf(i) : this.grade;
    if (!G.tint || !(G.a > 0)) return;
    const { W, H } = this, [c1, c2] = G.tint, a = +(G.a * k).toFixed(3);
    ctx.globalCompositeOperation = 'soft-light';
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, c1 + a + ')'); g.addColorStop(1, c2 + a + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  drawGrain(ctx, t) {
    const f = Math.floor(t * 24);
    ctx.globalAlpha = 0.028; ctx.globalCompositeOperation = 'overlay';
    const pat = ctx.createPattern(this.grain[f % 4], 'repeat');
    ctx.translate(-(hash(f) * 512), -(hash(f + 9) * 512));
    ctx.scale(2, 2);
    ctx.fillStyle = pat; ctx.fillRect(0, 0, this.W / 2 + 256, this.H / 2 + 256);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  particles(ctx, i, t) {
    const sc = this.p.scenes[i] || {}, seen = `${sc.visual || ''} ${sc.action || ''}`.toLowerCase();
    // the Director can pick a shot's overlay (or none); cards and maps have none unless picked
    if (sc.particles === 'mist') { this.mist(ctx, i, t); return; }
    if (!sc.particles && sc.card) return;
    // mist, fog and smoke drift slowly across the shot
    if (!sc.particles && /\b(mist|misty|fog|foggy|haze|hazy|smoke|smoky|steam)\b/.test(seen)) this.mist(ctx, i, t);
    // rain falls whenever the shot shows it, whatever its sound
    // otherwise the shot's content picks its overlay: petals with flowers and offerings,
    // sparkles around the divine, embers near fire, dust in beams of light
    const kind = sc.particles ? sc.particles : sc.map ? 'dust' : /\b(rain|raining|rainy|monsoon|downpour|drizzle|storm)\b/.test(seen) ? 'rain'
      : /\b(petals?|flower shower|showering flowers|garlands?|rose|marigold|lotus|offering flowers)\b/.test(seen) ? 'petals'
      : /\b(divine|goddess|god|deity|devi|halo|blessing|blesses|miracle|celestial|angel|glowing aura|heavenly)\b/.test(seen) ? 'sparkles'
      : /\b(fire|flames?|yagna|yajna|havan|bonfire|torch(es)?|burning|blaze|pyre)\b/.test(seen) ? 'embers'
      : /\b(beam|beams|rays?|shaft of light|sunlight streams|god rays)\b/.test(seen) ? 'dust'
      : particleKind(sc.ambience, this.p.mood);
    if (kind === 'none') return;
    const { W, H, u } = this, N = kind === 'rain' ? 140 : kind === 'petals' ? 24 : 46;
    ctx.save();
    for (let k = 0; k < N; k++) {
      const r1 = hash(k + 1), r2 = hash(k + 101), r3 = hash(k + 211), r4 = hash(k + 307);
      if (kind === 'petals') {
        // a petal tumbles down, swaying; size and colour vary (rose, marigold, pale pink)
        const sp = (40 + r3 * 50) * u, x = ((r1 * W + Math.sin(t * (0.6 + r4) + k) * 60 * u + t * 18 * u) % (W + 60) + W + 60) % (W + 60) - 30;
        const y = ((r2 * (H + 80) + t * sp) % (H + 80)) - 40, s = (5 + r4 * 6) * u, rot = t * (0.8 + r3 * 1.6) + k;
        const col = r3 < 0.4 ? [196, 30, 58] : r3 < 0.75 ? [245, 150, 30] : [240, 170, 190];
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(rot * 1.3)));
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s);
        g.addColorStop(0, `rgba(${col.map(c => Math.min(255, c + 30)).join(',')},0.85)`); g.addColorStop(1, `rgba(${col.join(',')},0.55)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.62, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        continue;
      }
      if (kind === 'sparkles') {
        // tiny golden glints rising slowly and twinkling
        const x = ((r1 * W + Math.sin(t * 0.4 + k) * 30 * u) % W + W) % W, y = ((r2 * H - t * (8 + r3 * 18) * u) % H + H) % H;
        const tw = Math.max(0, Math.sin(t * (1.5 + r3 * 3) + k * 2.1)) ** 3, s = (1.2 + r4 * 2.2) * u;
        if (tw < 0.02) continue;
        ctx.fillStyle = `rgba(255,236,170,${0.85 * tw})`; ctx.shadowColor = 'rgba(255,220,140,0.95)'; ctx.shadowBlur = 12 * u;
        ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(x - s * 3 * tw, y - 0.4 * u, s * 6 * tw, 0.8 * u); ctx.fillRect(x - 0.4 * u, y - s * 3 * tw, 0.8 * u, s * 6 * tw);
        continue;
      }
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

  // A few large, soft banks of mist that drift sideways and breathe.
  mist(ctx, i, t) {
    const { W, H } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let k = 0; k < 4; k++) {
      const r1 = hash(k + 17 + i * 7), r2 = hash(k + 59 + i * 7);
      const R = W * (0.35 + 0.25 * r1);
      const x = ((r1 * W + t * W * (0.012 + 0.01 * r2)) % (W + 2 * R)) - R;
      const y = H * (0.45 + 0.4 * r2) + Math.sin(t * 0.2 + k) * H * 0.03;
      const a = 0.05 + 0.035 * (0.5 + 0.5 * Math.sin(t * 0.25 + k * 2));
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, `rgba(205,212,222,${a})`); g.addColorStop(1, 'rgba(205,212,222,0)');
      ctx.fillStyle = g; ctx.fillRect(x - R, y - R, 2 * R, 2 * R);
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
    ctx.font = `700 ${fs}px ${this.titleFont}`;
    const spacing = (4 + t * 3) * u;
    ctx.letterSpacing = spacing + 'px';
    const maxW = W * 0.86;
    const lines = wrap(ctx, words, maxW);
    if (lines.length > 2) { fs *= 0.75; ctx.font = `700 ${fs}px ${this.titleFont}`; }
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

  // On-screen text a shot carries: a centred title card, a lower third, or a line at the top.
  shotText(ctx, s, t) {
    const { W, H, u } = this, { text, style = 'title' } = s.text;
    // on the first shot, wait for the film's own title card to clear
    const from = s.start < this.intro ? this.intro + 0.3 : s.start;
    const a = clamp01((t - from - 0.25) / 0.5) * clamp01((s.end - t - 0.2) / 0.5);
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a; ctx.shadowColor = 'rgba(0,0,0,.85)';
    if (style === 'lower') {
      const fs = Math.round((this.portrait ? 46 : 40) * u);
      ctx.font = `700 ${fs}px ${this.capFont}`;
      const L = wrap(ctx, text, W * 0.6), w = Math.max(...L.map(l => ctx.measureText(l).width));
      const x = W * 0.06, y = this.portrait ? H * 0.16 : H * 0.62 - (this.bar || 0);
      const slide = (1 - a) * 40 * u, h = L.length * fs * 1.25 + fs * 0.6;
      ctx.fillStyle = 'rgba(10,12,20,.72)'; ctx.fillRect(x - slide, y, w + fs * 1.1, h);
      ctx.fillStyle = '#f5b544'; ctx.fillRect(x - slide, y, fs * 0.16, h);
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'top';
      L.forEach((l, k) => ctx.fillText(l, x + fs * 0.55 - slide, y + fs * 0.3 + k * fs * 1.25));
    } else if (style === 'top') {
      const fs = Math.round((this.portrait ? 50 : 42) * u);
      ctx.font = `800 ${fs}px ${this.capFont}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const L = wrap(ctx, text, W * 0.84), y = (this.bar || 0) + (this.portrait ? H * 0.07 : H * 0.06);
      ctx.lineJoin = 'round'; ctx.lineWidth = fs * 0.18; ctx.strokeStyle = 'rgba(0,0,0,.9)'; ctx.fillStyle = '#fff';
      L.forEach((l, k) => { ctx.strokeText(l, W / 2, y + k * fs * 1.2); ctx.fillText(l, W / 2, y + k * fs * 1.2); });
    } else {
      ctx.fillStyle = `rgba(0,0,0,${0.3 * a})`; ctx.fillRect(0, 0, W, H);
      let fs = (this.portrait ? 80 : 88) * u;
      ctx.font = `700 ${fs}px ${this.titleFont}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let L = wrap(ctx, text, W * 0.84);
      if (L.length > 2) { fs *= 0.72; ctx.font = `700 ${fs}px ${this.titleFont}`; L = wrap(ctx, text, W * 0.84); }
      ctx.shadowBlur = 26 * u;
      const g = ctx.createLinearGradient(0, -fs, 0, fs);
      g.addColorStop(0, '#fff6e0'); g.addColorStop(1, '#f5b544'); ctx.fillStyle = g;
      const scale = 1 + (1 - a) * 0.06;
      ctx.translate(W / 2, H / 2); ctx.scale(scale, scale);
      L.forEach((l, k) => ctx.fillText(l, 0, (k - (L.length - 1) / 2) * fs * 1.15));
    }
    ctx.restore();
  }

  wordGroups(text) {
    const { words, spaced } = splitWords(text);
    const weights = words.map(w => w.trim().length + 2 + (/[,;:،؛、，；：]\s?$/.test(w) ? 3 : /[.!?।。！？؟۔።]\s?$/.test(w) ? 6 : 0));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    const timed = words.map((w, k) => { const s = acc / total; acc += weights[k]; return { w, s, e: acc / total }; });
    const groups = [];
    let cur = [];
    timed.forEach((x, k) => {
      cur.push(x);
      if (cur.length >= (this.portrait ? 4 : 7) * (spaced ? 1 : 2) || (cur.length >= 3 && /[,.!?;:।،؛؟。，！？、]\s?$/.test(x.w)) || k === timed.length - 1) { groups.push(cur); cur = []; }
    });
    groups.spaced = spaced;
    return groups;
  }

  captions(ctx, t) {
    const segs = this.tl.segments;
    const k = segs.findIndex(s => t >= (s.capStart ?? s.start) && t < (s.capEnd ?? s.end) + 0.3);
    if (k < 0) return;
    const s = segs[k], a = s.capStart ?? s.start, b = s.capEnd ?? s.end, frac = clamp01((t - a) / Math.max(0.3, b - a));
    const groups = this.groups[k];
    const g = groups.find(gr => frac < gr[gr.length - 1].e) || groups[groups.length - 1];
    if (!g) return;
    const { W, H, u } = this, style = this.o.captions;
    // styles: karaoke (word by word), classic, bold (big yellow, like viral Shorts), box (on a dark band)
    const fs = Math.round((this.portrait ? 64 : 52) * u * (style === 'bold' ? 1.22 : 1));
    ctx.save();
    ctx.font = `800 ${fs}px ${this.capFont}`;
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    const lines = [[]];
    let lw = 0;
    const maxW = W * (this.portrait ? 0.84 : 0.8), space = groups.spaced === false ? 0 : ctx.measureText(' ').width;
    const rtl = isRTLText(s.text);
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
    lines.forEach((row, li) => {
      // right-to-left scripts: first word on the right, each word shaped right to left
      const ln = rtl ? [...row].reverse() : row;
      ctx.direction = rtl ? 'rtl' : 'ltr';
      const total = ln.reduce((a, x) => a + x.width, 0) + space * (ln.length - 1);
      let x = (W - total) / 2;
      const y = y0 + li * lh;
      if (style === 'box') {
        ctx.fillStyle = 'rgba(0,0,0,.62)';
        ctx.beginPath(); ctx.roundRect(x - fs * 0.35, y - fs * 0.95, total + fs * 0.7, fs * 1.28, fs * 0.22); ctx.fill();
      }
      ln.forEach(wd => {
        const active = frac >= wd.s && frac < wd.e;
        const past = frac >= wd.e;
        if (style !== 'box') {
          ctx.lineJoin = 'round'; ctx.lineWidth = fs * (style === 'bold' ? 0.24 : 0.16); ctx.strokeStyle = 'rgba(0,0,0,.9)';
          ctx.strokeText(wd.w, x, y);
        }
        ctx.fillStyle = style === 'karaoke' ? (active ? '#ffc94d' : past ? '#ffffff' : 'rgba(255,255,255,.82)')
          : style === 'bold' ? (active ? '#ffffff' : '#ffd23f') : '#fff';
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
      // clips that bring their own speech (e.g. from Google Flow) aren't "synthetic narration"
      this.p.scenes?.some(s => s.clipSound) ? 'Original story, AI video & AI voices · Original score' : 'Original story, AI visuals & synthetic narration · Original score',
      'Made with VoiceFrame Studio'
    ];
    lines.forEach((l, k) => ctx.fillText(l, W / 2, H / 2 + (10 + k * 40) * u));
    // real stock footage: each clip's credit (CC BY needs title, author and licence)
    const stock = [...new Set(Object.values(this.p.credits || {}).map(c => c?.stock?.credit).filter(Boolean))];
    if (stock.length) {
      const size = stock.length > 6 ? 15 : 18;
      ctx.save(); ctx.font = `${size * u}px ${this.capFont}`; ctx.globalAlpha *= 0.85;
      ['Real footage:', ...stock].slice(0, 11).forEach((l, k) => ctx.fillText(l.length > 110 ? l.slice(0, 107) + '…' : l, W / 2, H / 2 + (10 + lines.length * 40 + 14 + k * (size + 8)) * u));
      ctx.restore();
    }
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
  const { words, spaced } = splitWords(text), lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + (spaced ? ' ' : '') + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}
// Like wrap, but also breaks scripts written without spaces (and over-long words) by character.
function wrapAny(ctx, text, maxW) {
  const out = [];
  for (const ln of wrap(ctx, String(text || '').trim(), maxW)) {
    if (ctx.measureText(ln).width <= maxW) { out.push(ln); continue; }
    let cur = '';
    for (const ch of Array.from(ln)) {
      if (cur && ctx.measureText(cur + ch).width > maxW) { out.push(cur); cur = ch.trim() ? ch : ''; } else cur += ch;
    }
    if (cur) out.push(cur);
  }
  return out;
}

export function srt(timeline) {
  const ts = s => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  // lines with words only; a clip's own speech is timed to when it is heard
  return timeline.segments.filter(s => String(s.text || '').trim())
    .map((s, i) => `${i + 1}\n${ts(s.capStart ?? s.start)} --> ${ts(s.capEnd ?? s.end)}\n${s.speaker ? s.speaker + ': ' : ''}${s.text}\n`).join('\n');
}

export { wrap as __wrap };
