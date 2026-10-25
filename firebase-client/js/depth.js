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

// Returns a grayscale ImageBitmap (white = near), or null if depth can't be computed
// on this device; the renderer then falls back to flat camera moves.
export function depthFor(blob) {
  if (!blob) return Promise.resolve(null);
  if (!cache.has(blob)) {
    cache.set(blob, estimate(blob).then(({ width, height, channels, data }) => {
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0, j = 0; i < width * height; i++, j += channels) {
        const v = data[j];
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
      }
      return createImageBitmap(new ImageData(rgba, width, height));
    }).catch(e => { console.warn('No depth for this picture:', e.message); return null; }));
  }
  return cache.get(blob);
}
