// Picture safety check in the browser: AdamCodd/vit-base-nsfw-detector (Apache-2.0, a ViT
// fine-tuned from google/vit-base-patch16-384), its 8-bit quantised ONNX build (~88 MB,
// cached by the browser after the first film). Answers the "nsfw" probability, 0-1.
// The revision is pinned, so a changed model upstream can't change what is let through.
import { pipeline, RawImage, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/+esm';

const MODEL = 'AdamCodd/vit-base-nsfw-detector';
const REVISION = '8587de998f441aac03fdd57a85d2e4cb808c7d64';
env.allowLocalModels = false;
let pipePromise = null;

function load() {
  // q8 = onnx/model_quantized.onnx on the CPU (WebAssembly): the same file and numbers on every device
  pipePromise ||= pipeline('image-classification', MODEL, { revision: REVISION, device: 'wasm', dtype: 'q8' })
    .catch(e => { pipePromise = null; throw e; });
  return pipePromise;
}

self.onmessage = async e => {
  const { id, blob, warm, fail } = e.data;
  try {
    // a simulated failure (local testing of the fail-closed path)
    if (fail) throw new Error('simulated safety-check failure');
    const pipe = await load();
    if (warm) { self.postMessage({ id, ready: true }); return; }
    const out = await pipe(await RawImage.fromBlob(blob), { top_k: 2 });
    const hit = (Array.isArray(out) ? out : [out]).find(o => String(o.label).toLowerCase() === 'nsfw');
    if (!hit || !Number.isFinite(hit.score)) throw new Error('no nsfw score in the answer');
    self.postMessage({ id, score: hit.score });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
