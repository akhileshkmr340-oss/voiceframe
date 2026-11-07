// Depth maps for 2.5D camera motion, computed in a worker and cached per picture.
let worker = null, seq = 0;
const pending = new Map();
const cache = new WeakMap(); // picture Blob -> Promise<ImageBitmap|null>

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./depth-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data);
  };
  worker.onerror = e => {
    pending.forEach(p => p.reject(new Error('Depth engine failed: ' + (e.message || 'worker error'))));
    pending.clear();
    worker = null;
  };
  return worker;
}

function estimate(blob) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Depth timed out')); }, 180000);
    pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
    getWorker().postMessage({ id, blob });
  });
}

// The raw depth map changes in a pixel or two at every outline, so a camera move folded
// the picture over itself there (torn edges, people shaking). Near parts are grown a
// little (people move as one piece, a sliver of their background with them), then the
// map is smoothed so its slope stays low: with the renderer's parallax cap (0.024) the
// picture can bend up to about 1.5x but never fold.
export function smoothDepth(src, w, h, channels = 1) {
  let a = new Float32Array(w * h), b = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = src[i * channels];
  const grow = Math.max(1, Math.round(w * 0.012)), blur = Math.max(2, Math.round(w * 0.025));
  // separable max filter (grow), then two separable box blurs
  const pass = (from, to, r, horiz, op) => {
    const n = horiz ? w : h, m = horiz ? h : w;
    for (let line = 0; line < m; line++) {
      const at = k => (horiz ? line * w + k : k * w + line);
      if (op === 'max') {
        for (let k = 0; k < n; k++) {
          let v = 0;
          for (let j = Math.max(0, k - r); j <= Math.min(n - 1, k + r); j++) v = Math.max(v, from[at(j)]);
          to[at(k)] = v;
        }
      } else {
        let sum = 0;
        for (let j = -r; j <= r; j++) sum += from[at(Math.min(n - 1, Math.max(0, j)))];
        for (let k = 0; k < n; k++) {
          to[at(k)] = sum / (2 * r + 1);
          sum += from[at(Math.min(n - 1, k + r + 1))] - from[at(Math.max(0, k - r))];
        }
      }
    }
  };
  pass(a, b, grow, true, 'max'); pass(b, a, grow, false, 'max');
  for (let k = 0; k < 2; k++) { pass(a, b, blur, true, 'box'); pass(b, a, blur, false, 'box'); }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.round(a[i]);
  return out;
}

// Returns a grayscale ImageBitmap (white = near), or null if depth can't be computed
// on this device; the renderer then falls back to flat camera moves.
export function depthFor(blob) {
  if (!blob) return Promise.resolve(null);
  if (!cache.has(blob)) {
    cache.set(blob, estimate(blob).then(({ width, height, channels, data }) => {
      const rgba = new Uint8ClampedArray(width * height * 4);
      const smooth = smoothDepth(data, width, height, channels);
      for (let i = 0; i < width * height; i++) {
        const v = smooth[i];
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
      }
      return createImageBitmap(new ImageData(rgba, width, height));
    }).catch(e => { console.warn('No depth for this picture:', e.message); return null; }));
  }
  return cache.get(blob);
}
