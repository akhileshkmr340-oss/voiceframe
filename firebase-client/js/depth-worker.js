// Depth estimation (Depth Anything V2 small, ~27 MB, Apache-2.0) in the browser.
// Each scene picture gets a depth map so the renderer can move a 3D camera through it.
import { pipeline, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/+esm';

const MODEL = 'onnx-community/depth-anything-v2-small';
let pipePromise = null;

function load() {
  pipePromise ||= (async () => {
    if (navigator.gpu) {
      try { return await pipeline('depth-estimation', MODEL, { device: 'webgpu', dtype: 'fp16' }); }
      catch (e) { console.warn('WebGPU depth failed, using CPU', e); }
    }
    return pipeline('depth-estimation', MODEL, { device: 'wasm', dtype: 'q8' });
  })();
  return pipePromise;
}

self.onmessage = async e => {
  const { id, blob } = e.data;
  try {
    const pipe = await load();
    const out = await pipe(await RawImage.fromBlob(blob));
    const d = out.depth || out[0]?.depth;
    const data = new Uint8Array(d.data); // 0 = far, 255 = near
    self.postMessage({ id, width: d.width, height: d.height, channels: d.channels, data }, [data.buffer]);
  } catch (err) {
    pipePromise = null;
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
