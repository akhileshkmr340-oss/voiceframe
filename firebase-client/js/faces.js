// Live faces: finds the faces in a shot's picture on the device (MediaPipe Face
// Landmarker, Apache-2.0) and reduces each to a few handles (mouth, eyes, head) that
// the renderer's shader moves every frame: lips in time with the voice, blinks, head
// turns and nods. No server and no GPU queue, so it is instant and never fails a film.
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
export const MAX_FACES = 4;
let landmarker = null;
const cache = new WeakMap(); // picture Blob -> Promise<handles[]>

function load() {
  landmarker ||= (async () => {
    const { FilesetResolver, FaceLandmarker } = await import(MP + '/vision_bundle.mjs');
    const files = await FilesetResolver.forVisionTasks(MP + '/wasm');
    return FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }, runningMode: 'IMAGE',
      numFaces: MAX_FACES, minFaceDetectionConfidence: 0.35, minFacePresenceConfidence: 0.35
    });
  })().catch(e => { landmarker = null; throw e; });
  return landmarker;
}

const r4 = v => Math.round(v * 1e4) / 1e4;
// Picture-relative (0-1) handles from the 478 landmarks of one face.
function handles(lm) {
  const P = i => lm[i];
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const p of lm) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const top = P(10), chin = P(152), size = Math.hypot(chin.x - top.x, chin.y - top.y);
  const eye = (o, i, u, l) => [(P(o).x + P(i).x) / 2, (P(u).y + P(l).y) / 2, Math.abs(P(o).x - P(i).x) / 2, Math.max(0.002, Math.abs(P(l).y - P(u).y) / 2)];
  return {
    m: [(P(61).x + P(291).x) / 2, (P(13).y + P(14).y) / 2, Math.abs(P(291).x - P(61).x) / 2, chin.y], // mouth centre, lip line, half width, chin
    a: eye(33, 133, 159, 145), b: eye(362, 263, 386, 374),                                             // eyes: centre, half width, half height
    h: [(x0 + x1) / 2, (y0 + y1) / 2 - (y1 - y0) * 0.08, (x1 - x0) / 2 * 1.2, (y1 - y0) / 2 * 1.35],    // head with hair
    p: [chin.x, chin.y + (chin.y - top.y) * 0.18],                                                     // neck: where the head turns
    br: [P(105).x, P(105).y, P(334).x, P(334).y],                                                     // eyebrows (middle of each)
    s: size
  };
}
const round = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Array.isArray(v) ? v.map(r4) : r4(v)]));

// The faces in a picture big enough to animate (a face under ~5% of the frame height
// is too small for lips to read). Returns [] when none, or when this device can't run it.
export function facesFor(blob) {
  if (!blob) return Promise.resolve([]);
  if (!cache.has(blob)) {
    cache.set(blob, (async () => {
      const lm = await load();
      const full = await createImageBitmap(blob), W = full.width, H = full.height;
      // The detector is made for close faces, so the picture is also searched in
      // overlapping squares (people in medium and wide shots), each mapped back.
      const side = Math.round(Math.min(W, H) * 0.62), boxes = [[0, 0, W, H]];
      const steps = (len) => { const n = Math.max(1, Math.ceil((len - side) / (side * 0.55))); return Array.from({ length: n + 1 }, (_, k) => Math.round(k * (len - side) / Math.max(1, n))); };
      for (const y of steps(H)) for (const x of steps(W)) boxes.push([x, y, side, side]);
      const found = [];
      try {
        for (const [sx, sy, sw, sh] of boxes) {
          const bmp = sx || sy || sw !== W ? await createImageBitmap(full, sx, sy, sw, sh) : full;
          const res = lm.detect(bmp);
          if (bmp !== full) bmp.close?.();
          for (const raw of res.faceLandmarks || []) {
            // a face cut by the edge of a square gives wrong points: the full search or a neighbour square has it whole
            if (bmp !== full && raw.some(p => p.x < 0.02 || p.x > 0.98 || p.y < 0.02 || p.y > 0.98)) continue;
            const f = handles(raw.map(p => ({ x: (sx + p.x * sw) / W, y: (sy + p.y * sh) / H })));
            if (f.s <= 0.05) continue;
            if (found.some(g => Math.hypot((g.m[0] - f.m[0]) * W / H, g.m[1] - f.m[1]) < 0.5 * Math.max(g.s, f.s))) continue;
            found.push(f);
          }
        }
      } finally { full.close?.(); }
      return found.sort((a, b) => b.s - a.s).slice(0, MAX_FACES).map(round);
    })().catch(e => { console.warn('Live faces unavailable:', e.message); return []; }));
  }
  return cache.get(blob);
}

// Mouth opening over a recorded line: loudness at 60 steps a second, scaled to the
// line's own loud parts and smoothed like a jaw (opens fast, closes a little slower).
export function mouthEnvelope(buf) {
  const sr = buf.sampleRate, hop = Math.max(1, Math.round(sr / 60)), d = buf.getChannelData(0), n = Math.ceil(d.length / hop);
  const e = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0; const a = k * hop, b = Math.min(d.length, a + hop);
    for (let j = a; j < b; j++) s += d[j] * d[j];
    e[k] = Math.sqrt(s / Math.max(1, b - a));
  }
  const ref = Float32Array.from(e).sort()[Math.floor(n * 0.92)] || 1e-4;
  let y = 0;
  for (let k = 0; k < n; k++) {
    const x = Math.min(1, Math.max(0, (e[k] / ref - 0.12) / 0.88));
    y += (x - y) * (x > y ? 0.65 : 0.32);
    e[k] = y;
  }
  return e;
}
