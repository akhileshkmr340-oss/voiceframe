import { waitVideoEvent, seekVideo } from './media-readiness.js?v=66';
// Live bodies: finds each person's skeleton and outline in a shot's picture on the device
// (MediaPipe Pose Landmarker, Apache-2.0), so the renderer can bend their arms and legs
// every frame (gestures while they speak, waving, pointing, walking, dancing) and make
// hair and clothes move. No server and no GPU queue. Also makes a "clean plate": the
// picture with the people filled in from their surroundings, shown where a limb moves away.
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
export const MAX_BODIES = 3; // one person per colour channel of the mask
let landmarker = null;
const cache = new WeakMap(); // picture Blob -> Promise<{people, mask, plate}|null>

function load() {
  landmarker ||= (async () => {
    const { FilesetResolver, PoseLandmarker } = await import(MP + '/vision_bundle.mjs');
    const files = await FilesetResolver.forVisionTasks(MP + '/wasm');
    return PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }, runningMode: 'IMAGE',
      numPoses: 4, minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, outputSegmentationMasks: true
    });
  })().catch(e => { landmarker = null; throw e; });
  return landmarker;
}

// Limbs as [root, middle, end] landmark numbers: arms from the shoulder, legs from the hip.
const LIMBS = { armL: [11, 13, 15], armR: [12, 14, 16], legL: [23, 25, 27], legR: [24, 26, 28] };
const MASK_SIDE = 384;

// Each person: limbs with their joints (picture 0-1 coordinates), how thick the limb is,
// and which channel of the mask is theirs. Limbs whose joints are hidden are left out.
function person(lm, k, aspect) {
  const P = i => lm[i], vis = i => (P(i).visibility ?? 1) > 0.5 && P(i).x > 0 && P(i).x < 1 && P(i).y > 0 && P(i).y < 1;
  const shoulderW = Math.hypot((P(11).x - P(12).x) * aspect, P(11).y - P(12).y);
  const limbs = {};
  for (const [name, [a, b, c]] of Object.entries(LIMBS)) {
    if (![a, b, c].every(vis)) continue;
    limbs[name] = { s: [P(a).x, P(a).y], e: [P(b).x, P(b).y], w: [P(c).x, P(c).y], t: shoulderW * (name.startsWith('leg') ? 0.42 : 0.32) };
  }
  const size = Math.abs(((P(27).y + P(28).y) / 2 || P(24).y) - P(0).y);
  return { k, limbs, size, nose: [P(0).x, P(0).y], hip: [(P(23).x + P(24).x) / 2, (P(23).y + P(24).y) / 2] };
}

// The picture with the people filled in from their surroundings (push-pull: the holes
// take the average colour of ever wider rings around them). Blurry, but it is only seen
// in the thin strip a moving limb uncovers.
function cleanPlate(img, maskRGBA, W, H) {
  const c = new OffscreenCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, W, H);
  const px = x.getImageData(0, 0, W, H), d = px.data;
  // a pixel is a hole if any person covers it (grown by 3 px so their edge goes too)
  const hole = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (maskRGBA[i * 4] > 80 || maskRGBA[i * 4 + 1] > 80 || maskRGBA[i * 4 + 2] > 80) hole[i] = 1;
  for (let pass = 0; pass < 3; pass++) {
    const g = hole.slice();
    for (let y = 1; y < H - 1; y++) for (let xx = 1; xx < W - 1; xx++) { const i = y * W + xx; if (!hole[i] && (hole[i - 1] || hole[i + 1] || hole[i - W] || hole[i + W])) g[i] = 1; }
    hole.set(g);
  }
  // pyramid: each level holds the average known colour of its block and how much of the
  // block was known (0-1)
  let lw = W, lh = H, lv = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i++) if (!hole[i]) { lv[i * 4] = d[i * 4]; lv[i * 4 + 1] = d[i * 4 + 1]; lv[i * 4 + 2] = d[i * 4 + 2]; lv[i * 4 + 3] = 1; }
  const levels = [{ w: lw, h: lh, v: lv }];
  while (lw > 1 || lh > 1) {
    const nw = Math.ceil(lw / 2), nh = Math.ceil(lh / 2), sum = new Float32Array(nw * nh * 4), n = new Float32Array(nw * nh);
    for (let y = 0; y < lh; y++) for (let xx = 0; xx < lw; xx++) {
      const s = (y * lw + xx) * 4, t = (y >> 1) * nw + (xx >> 1), a = lv[s + 3];
      sum[t * 4] += lv[s] * a; sum[t * 4 + 1] += lv[s + 1] * a; sum[t * 4 + 2] += lv[s + 2] * a; sum[t * 4 + 3] += a; n[t]++;
    }
    const nv = new Float32Array(nw * nh * 4);
    for (let t = 0; t < nw * nh; t++) {
      const a = sum[t * 4 + 3];
      if (a > 0) { nv[t * 4] = sum[t * 4] / a; nv[t * 4 + 1] = sum[t * 4 + 1] / a; nv[t * 4 + 2] = sum[t * 4 + 2] / a; }
      nv[t * 4 + 3] = a / n[t];
    }
    levels.push({ w: nw, h: nh, v: nv }); lw = nw; lh = nh; lv = nv;
  }
  const topL = levels.at(-1).v;
  if (topL[3] === 0) { topL[0] = topL[1] = topL[2] = 90; }
  topL[3] = 1;
  // fill each level from the coarser one, finest last: known colour where known, the
  // surroundings' colour where not
  for (let L = levels.length - 2; L >= 0; L--) {
    const f = levels[L], cL = levels[L + 1];
    for (let y = 0; y < f.h; y++) for (let xx = 0; xx < f.w; xx++) {
      const s = (y * f.w + xx) * 4, a = f.v[s + 3];
      if (a >= 1) continue;
      const t = ((y >> 1) * cL.w + (xx >> 1)) * 4;
      for (let ch = 0; ch < 3; ch++) f.v[s + ch] = f.v[s + ch] * a + cL.v[t + ch] * (1 - a);
      f.v[s + 3] = 1;
    }
  }
  const top = levels[0].v;
  for (let i = 0; i < W * H; i++) if (hole[i]) { d[i * 4] = top[i * 4]; d[i * 4 + 1] = top[i * 4 + 1]; d[i * 4 + 2] = top[i * 4 + 2]; }
  // soften the blocky fill: a few blurs inside the holes only
  for (let pass = 0; pass < 4; pass++) {
    const src = d.slice();
    for (let y = 1; y < H - 1; y++) for (let xx = 1; xx < W - 1; xx++) {
      const i = y * W + xx;
      if (!hole[i]) continue;
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += src[((y + dy) * W + xx + dx) * 4 + ch];
        d[i * 4 + ch] = sum / 9;
      }
    }
  }
  x.putImageData(px, 0, 0);
  return c;
}

// People in a picture: up to four skeletons, a mask (one person per colour channel) and a
// clean plate. null when nobody is found or this device can't run it.
export function bodiesFor(blob) {
  if (!blob) return Promise.resolve(null);
  if (!cache.has(blob)) {
    cache.set(blob, (async () => {
      const lm = await load();
      const img = await createImageBitmap(blob), aspect = img.width / img.height;
      try {
        const res = lm.detect(img);
        const poses = res.landmarks || [], masks = res.segmentationMasks || [];
        const W = aspect >= 1 ? MASK_SIDE : Math.round(MASK_SIDE * aspect), H = aspect >= 1 ? Math.round(MASK_SIDE / aspect) : MASK_SIDE;
        const rgba = new Uint8ClampedArray(W * H * 4);
        for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255; // opaque: a canvas drops colour where alpha is 0
        const people = [];
        poses.slice(0, MAX_BODIES).forEach((p, k) => {
          const who = person(p, k, aspect);
          if (who.size < 0.12 || !Object.keys(who.limbs).length) return;
          people.push(who);
          const m = masks[k];
          if (!m) return;
          const f = m.getAsFloat32Array(), mw = m.width, mh = m.height;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const v = f[Math.min(mh - 1, Math.floor(y / H * mh)) * mw + Math.min(mw - 1, Math.floor(x / W * mw))];
            rgba[(y * W + x) * 4 + k] = Math.max(0, Math.min(255, v * 255));
          }
        });
        masks.forEach(m => m.close?.());
        if (!people.length) return null;
        const mask = new OffscreenCanvas(W, H);
        mask.getContext('2d').putImageData(new ImageData(rgba, W, H), 0, 0);
        return { people, mask, plate: cleanPlate(img, rgba, W, H) };
      } finally { img.close?.(); }
    })().catch(e => { console.warn('Live bodies unavailable:', e.message); return null; }));
  }
  return cache.get(blob);
}

// ---- motion copy: a person's arm and leg movement read from a video, on this device ----
// Each limb's turn at its root and middle joint, frame by frame, relative to the first
// frame; the renderer adds them to the character's own pose. Only the angles are kept.
let videoLm = null, stamp = 0;
function loadVideoLm() {
  videoLm ||= (async () => {
    const { FilesetResolver, PoseLandmarker } = await import(MP + '/vision_bundle.mjs');
    const files = await FilesetResolver.forVisionTasks(MP + '/wasm');
    return PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 1 });
  })().catch(e => { videoLm = null; throw e; });
  return videoLm;
}
export async function motionFromVideo(file, onProgress) {
  const lm = await loadVideoLm();
  const v = document.createElement('video'), url = URL.createObjectURL(file);
  v.muted = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('That video could not be read.')); });
    const fps = 12, n = Math.max(2, Math.floor(Math.min(v.duration, 12) * fps)), aspect = v.videoWidth / v.videoHeight;
    const ang = (a, b) => Math.atan2(b.y - a.y, (b.x - a.x) * aspect);
    const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
    const limbs = Object.fromEntries(Object.keys(LIMBS).map(k => [k, []])), base = {};
    let found = 0;
    for (let f = 0; f < n; f++) {
      v.currentTime = f / fps;
      await new Promise(res => { v.onseeked = res; });
      const p = lm.detectForVideo(v, (stamp += 100)).landmarks?.[0];
      if (p) found++;
      for (const [name, [a, b, c]] of Object.entries(LIMBS)) {
        const arr = limbs[name];
        if (!p || [a, b, c].some(j => (p[j].visibility ?? 1) < 0.4)) { arr.push(arr.at(-1) || [0, 0]); continue; }
        const up = ang(p[a], p[b]), mid = ang(p[b], p[c]) - up;
        base[name] ??= [up, mid];
        arr.push([+wrap(up - base[name][0]).toFixed(3), +wrap(mid - base[name][1]).toFixed(3)]);
      }
      onProgress?.((f + 1) / n);
    }
    if (found < n * 0.3) throw new Error('No person could be followed in that video. Use a clip with one person, whole body in view.');
    return { fps, limbs };
  } finally { URL.revokeObjectURL(url); }
}

// ---- motion-quality check: follow the main person through an AI clip ----
// Flags (never rejects) a clip whose person vanishes mid-shot, or whose hands jump further
// between two looks 0.6 s apart than a body can move. Returns the issue, or ''.
export async function clipMotionIssue(blob, signal) {
  const lm = await loadVideoLm();
  const v = document.createElement('video'), url = URL.createObjectURL(blob);
  v.muted = true; v.preload = 'auto'; v.src = url;
  try {
    if (v.readyState < 2) await waitVideoEvent(v, 'loadeddata', {signal});
    const aspect = v.videoWidth / v.videoHeight, seen = [];
    for (let k = 0; k < 8; k++) {
      await seekVideo(v, v.duration * (0.05 + 0.9 * k / 7), {signal});
      seen.push(lm.detectForVideo(v, (stamp += 100)).landmarks?.[0] || null);
    }
    const found = seen.map(Boolean);
    // there at the start and the end but gone in between: a person blinking out of existence
    const first = found.indexOf(true), last = found.lastIndexOf(true);
    if (first >= 0 && last - first >= 3 && found.slice(first, last + 1).filter(f => !f).length >= 2) return 'a person disappears mid-shot';
    const torso = p => Math.hypot(((p[11].x + p[12].x) - (p[23].x + p[24].x)) / 2 * aspect, ((p[11].y + p[12].y) - (p[23].y + p[24].y)) / 2) || 0.2;
    for (let k = 1; k < seen.length; k++) {
      const a = seen[k - 1], b = seen[k];
      if (!a || !b) continue;
      const t = torso(a);
      for (const j of [15, 16]) {
        if ((a[j].visibility ?? 1) < 0.6 || (b[j].visibility ?? 1) < 0.6) continue;
        if (Math.hypot((b[j].x - a[j].x) * aspect, b[j].y - a[j].y) > 1.4 * t) return 'a hand jumps unnaturally';
      }
      const shoulders = Math.hypot(((b[11].x + b[12].x) - (a[11].x + a[12].x)) / 2 * aspect, ((b[11].y + b[12].y) - (a[11].y + a[12].y)) / 2);
      if (shoulders > 1.5 * t) return 'the body jumps between frames';
    }
    return '';
  } finally { URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); }
}

// What the people in a shot do, read from the script: a gesture style per shot.
export function bodyStyle(sc) {
  const t = `${sc?.action || ''} ${sc?.visual || ''}`.toLowerCase();
  if (/\b(dance|dances|dancing|celebrat|garba|bhangra)/.test(t)) return 'dance';
  if (/\b(run|runs|running|chase|chasing|sprint|race|racing)/.test(t)) return 'run';
  if (/\b(walk|walks|walking|stroll|wander|march|approach)/.test(t)) return 'walk';
  if (/\b(wave|waves|waving|greet|bye|goodbye)/.test(t)) return 'wave';
  if (/\b(point|points|pointing|show|shows)/.test(t)) return 'point';
  if (/\b(clap|claps|clapping|cheer)/.test(t)) return 'clap';
  return 'talk';
}
