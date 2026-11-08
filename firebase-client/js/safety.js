// Picture and clip safety on this device, fail closed. Every picture the film may use
// (painted shots and portraits, GPU pictures and clips, stock photos and clips, the
// person's own photos and clips, pictures made with the Director's generators) passes
// checkImage or checkVideo first. When the checker can't load or run, nothing is let
// through: SafetyDown is thrown and the shot says "safety check unavailable – try again".
// The relay's vision check (/look, "unsafe") stays on as a second layer.

// The relay's safety filter refused a request (422), or a picture failed the check.
export class Unsafe extends Error {
  constructor(msg) { super(msg || 'Blocked by the safety filter. VoiceFrame makes family-friendly films only.'); this.unsafe = true; }
}
export const SAFETY_DOWN = 'Safety check unavailable – try again';
export class SafetyDown extends Error {
  constructor(why = '') { super(SAFETY_DOWN); this.safetyDown = true; this.why = why; }
}

// nsfw probability at or above this blocks the picture (the model's own decision point;
// its validation set separates the classes with AUC 0.995). Measured on 318 ordinary
// film pictures (painted shots and portraits, real-footage frames, family scenes): 99%
// score under 0.33 and the highest ordinary ones 0.40-0.43 (a grandfather with his
// granddaughter, a woman in an apron), so a lower cut-off would block family scenes;
// a bare-shouldered portrait with no clothing in view scored 0.70 and is blocked.
export const NSFW_THRESHOLD = 0.5;
// a clip fails when any sampled frame does
const CLIP_FRAMES = [0.1, 0.35, 0.6, 0.9];
const LOAD_MS = 240000, CHECK_MS = 60000;

let worker = null, seq = 0, warmed = null;
const pending = new Map();
const cache = new WeakMap(); // Blob -> Promise<{safe, score}> (only answers are kept, never failures)
// local testing of the fail-closed path: localStorage.vf_safety_test = 'fail'
const simulateFail = () => { try { return localStorage.getItem('vf_safety_test') === 'fail'; } catch { return false; } };

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./safety-worker.js?v=63', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) {
      p.reject(new SafetyDown(e.data.error));
      // ONNX caches failed backend initialization inside its worker. Retry in a
      // fresh worker rather than repeatedly reusing that broken runtime.
      if (p.warm) { worker?.terminate(); worker = null; warmed = null; }
    } else p.resolve(e.data);
  };
  worker.onerror = e => {
    pending.forEach(p => p.reject(new SafetyDown(e.message || 'worker error')));
    pending.clear();
    worker = null; warmed = null;
  };
  return worker;
}

function ask(msg, ms) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new SafetyDown('timed out')); }, ms);
    pending.set(id, { warm: !!msg.warm, resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
    try { getWorker().postMessage({ id, ...msg, fail: simulateFail() }); }
    catch (e) { pending.delete(id); clearTimeout(timer); reject(new SafetyDown(e.message)); }
  });
}

// Loads the checker ahead of the first picture (the first visit downloads ~88 MB).
export function warmSafety() {
  warmed ||= ask({ warm: true }, LOAD_MS).catch(e => { warmed = null; throw e; });
  return warmed;
}

async function score(blob) {
  if (!(blob instanceof Blob) || !blob.size) throw new SafetyDown('no picture');
  await warmSafety();
  const { score } = await ask({ blob }, CHECK_MS);
  if (!Number.isFinite(score)) throw new SafetyDown('no score');
  return score;
}

// {safe: true, score} for a picture that may be used; throws Unsafe (with .picture and
// .score) for one that may not, and SafetyDown when the check could not run.
export async function checkImage(blob) {
  if (simulateFail()) throw new SafetyDown('simulated');
  if (!cache.has(blob)) {
    const p = score(blob).then(s => ({ safe: s < NSFW_THRESHOLD, score: s }));
    cache.set(blob, p);
    p.catch(() => cache.delete(blob));
  }
  const v = await cache.get(blob);
  if (!v.safe) throw Object.assign(new Unsafe('This picture was blocked by the safety filter.'), { picture: true, score: v.score });
  return v;
}

// Frames of a clip (as JPEG blobs) at the given points of its length.
export async function clipFrames(blob, fracs = CLIP_FRAMES, max = 512) {
  const v = document.createElement('video'), url = URL.createObjectURL(blob);
  v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = url;
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('clip took too long to open')), 30000);
      v.onloadeddata = () => { clearTimeout(t); res(); };
      v.onerror = () => { clearTimeout(t); rej(new Error('unreadable clip')); };
    });
    const k = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
    const c = new OffscreenCanvas(Math.max(1, Math.round(v.videoWidth * k)), Math.max(1, Math.round(v.videoHeight * k)));
    const out = [];
    for (const f of fracs) {
      v.currentTime = Math.max(0, Math.min((v.duration || 0) - 0.05, (v.duration || 0) * f));
      await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('seek took too long')), 15000); v.onseeked = () => { clearTimeout(t); res(); }; });
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      out.push(await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }));
    }
    return out;
  } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
}

// The same for a clip: 4 frames across its length; any unsafe frame blocks the clip.
// A clip that can't be opened can't be checked, so it is not used either.
const clipCache = new WeakMap();
export async function checkVideo(blob) {
  if (simulateFail()) throw new SafetyDown('simulated');
  if (!clipCache.has(blob)) {
    const p = (async () => {
      let frames;
      try { frames = await clipFrames(blob); } catch (e) { throw new SafetyDown(e.message); }
      let worst = 0;
      for (const f of frames) {
        const s = await score(f);
        worst = Math.max(worst, s);
        if (s >= NSFW_THRESHOLD) break;
      }
      return { safe: worst < NSFW_THRESHOLD, score: worst };
    })();
    clipCache.set(blob, p);
    p.catch(() => clipCache.delete(blob));
  }
  const v = await clipCache.get(blob);
  if (!v.safe) throw Object.assign(new Unsafe('This clip was blocked by the safety filter.'), { picture: true, score: v.score });
  return v;
}

// true / false without throwing: for optional pictures (stock thumbnails) that are
// simply skipped when they fail or can't be checked.
export const isSafe = blob => checkImage(blob).then(() => true, () => false);

// The message a shot shows when its picture or clip was not used.
export const blockedNote = e => (e?.safetyDown ? SAFETY_DOWN : e?.unsafe ? 'Blocked by the safety filter' : '');
