// Indian-language narration on this device: AI4Bharat Indic-TTS (FastPitch + HiFi-GAN,
// MIT licence) as ONNX, run off the main thread with onnxruntime-web. Each language
// (~120 MB) is downloaded once from Hugging Face and kept in the browser's cache.
// The vocoder (the slow half) runs on the graphics card when WebGPU is available.
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.webgpu.min.mjs';

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

// Browser-ready copies (see voiceframe-dev/fix_convinteger.py and dequantize_hifigan.py),
// pinned to one revision of the repo.
const BASE = 'https://huggingface.co/akhileshkmr2906/voiceframe-indic-voices/resolve/03c08aa38eedd306cbda36fea026bcb9ed66a568/';
const RATE = 22050;
const voices = new Map(); // lang -> Promise<{ fp, hg, map, longest }>
let gpu = null;

async function cached(url, onBytes) {
  let cache = null;
  try { cache = await caches.open('vf-indic-voices-v2'); } catch { /* no Cache API (private mode) */ }
  const hit = await cache?.match(url);
  if (hit) return hit.arrayBuffer();
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Voice model download failed (${r.status})`);
  const reader = r.body.getReader(), parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    onBytes?.(value.length);
  }
  const buf = await new Blob(parts).arrayBuffer();
  try { await cache?.put(url, new Response(buf.slice(0))); } catch { /* quota: just don't cache */ }
  return buf;
}

async function vocoder(buf) {
  gpu ??= !!(await navigator.gpu?.requestAdapter().catch(() => null));
  if (gpu) {
    try { return await ort.InferenceSession.create(buf, { executionProviders: ['webgpu'] }); }
    catch (e) { gpu = false; console.warn('WebGPU vocoder unavailable, using CPU', e); }
  }
  return ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
}

function load(lang) {
  if (!voices.has(lang)) {
    const p = (async () => {
      const dir = `${BASE}${lang}/`;
      let loaded = 0;
      const report = n => { loaded += n; self.postMessage({ type: 'progress', loaded, total: 119e6 }); };
      const tokens = await (await fetch(dir + `fastpitch-${lang}.tokens.json`)).json();
      const [fpBuf, hgBuf] = await Promise.all([
        cached(dir + `fastpitch-${lang}.u8.onnx`, report),
        cached(dir + `hifigan-${lang}.f32.onnx`, report)
      ]);
      const fp = await ort.InferenceSession.create(fpBuf, { executionProviders: ['wasm'] });
      const hg = await vocoder(hgBuf);
      // first id wins: the table repeats some punctuation and the model learned the lower id
      const map = new Map();
      tokens.forEach((s, i) => { if (typeof s === 'string' && !map.has(s)) map.set(s, i); });
      const longest = Math.max(...[...map.keys()].map(s => s.length));
      return { fp, hg, map, longest };
    })();
    p.catch(() => voices.delete(lang));
    voices.set(lang, p);
  }
  return voices.get(lang);
}

// Longest-match lookup. Characters the voice has no symbol for (quotes, emoji, Latin
// letters) are dropped; danda and other sentence marks become a full stop.
function tokenize(text, { map, longest }) {
  const s = text.normalize('NFC').replace(/[।॥]/g, '.').replace(/[“”"«»]/g, '').replace(/\s+/g, ' ').trim();
  const ids = [];
  for (let i = 0; i < s.length;) {
    let len = Math.min(longest, s.length - i), id;
    for (; len > 0; len--) if ((id = map.get(s.slice(i, i + len))) !== undefined) break;
    if (len > 0) { ids.push(id); i += len; } else i++;
  }
  return ids;
}

// Some voices come out quiet; bring every line to the same peak level.
function normalise(samples) {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? Math.min(8, 0.9 / peak) : 1;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}

self.onmessage = async e => {
  const { id, type, lang, text } = e.data;
  try {
    const v = await load(lang);
    if (type === 'load') return self.postMessage({ id, type: 'ready' });
    const ids = tokenize(text, v);
    if (!ids.length) return self.postMessage({ id, type: 'audio', samples: new Float32Array(Math.round(RATE * 0.3)), rate: RATE });
    const input = new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]);
    const mel = (await v.fp.run({ [v.fp.inputNames[0]]: input }))[v.fp.outputNames[0]];
    const audio = (await v.hg.run({ [v.hg.inputNames[0]]: mel }))[v.hg.outputNames[0]];
    const samples = normalise(new Float32Array(await audio.getData?.() ?? audio.data));
    self.postMessage({ id, type: 'audio', samples, rate: RATE }, [samples.buffer]);
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String(err?.message || err) });
  }
};
