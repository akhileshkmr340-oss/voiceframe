// Voices for the world's languages on this device: Piper (VITS, MIT code) voices from
// rhasspy/piper-voices, only ones whose licence allows commercial use (see langs.js for
// each voice's licence and dataset). Text becomes phonemes with eSpeak NG (the same
// phonemizer Piper was trained with), then the voice runs in onnxruntime-web, off the main
// thread. Each voice (~20-130 MB) is downloaded once, pinned to one revision of the repo,
// and kept in the browser's cache.
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.webgpu.min.mjs';

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const REPO = 'https://huggingface.co/rhasspy/piper-voices/resolve/e7229f7d33a10e145e109b886d661984201ac3c4/';
const voices = new Map(); // model key -> Promise<{ session, config }>

async function cached(url, onBytes) {
  let cache = null;
  try { cache = await caches.open('vf-piper-voices-v1'); } catch { /* no Cache API (private mode) */ }
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

// "de_DE-thorsten-medium" -> "de/de_DE/thorsten/medium/de_DE-thorsten-medium"
function path(key) {
  const [loc, name, quality] = key.split('-');
  return `${loc.split('_')[0]}/${loc}/${name}/${quality}/${key}`;
}

function load(key) {
  if (!voices.has(key)) {
    const p = (async () => {
      const base = REPO + encodeURI(path(key));
      const config = await (await fetch(base + '.onnx.json')).json();
      if (config.phoneme_type && config.phoneme_type !== 'espeak') throw new Error(`Voice ${key} needs a phonemizer this app doesn't have`);
      let loaded = 0;
      const buf = await cached(base + '.onnx', n => { loaded += n; self.postMessage({ type: 'progress', loaded, total: 64e6 }); });
      const session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
      return { session, config };
    })();
    p.catch(() => voices.delete(key));
    voices.set(key, p);
  }
  return voices.get(key);
}

// ---------------- eSpeak NG phonemes ----------------
// piper-phonemize (MIT) built with eSpeak NG (GPL-3.0) for the web, ~18 MB of language data.
const PIPER = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
let espeakMod = null, espeakOut = [];
function espeak() {
  espeakMod ||= (async () => {
    const { createPiperPhonemize } = await import('https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/dist/piper-o91UDS6e.js');
    const [wasmBinary, data] = await Promise.all([PIPER + '.wasm', PIPER + '.data'].map(u => fetch(u).then(r => {
      if (!r.ok) throw new Error('Phoneme data download failed (' + r.status + ')');
      return r.arrayBuffer();
    })));
    return createPiperPhonemize({
      print: d => espeakOut.push(d), printErr: () => {}, wasmBinary, getPreloadedPackage: () => data,
      locateFile: u => PIPER + (u.endsWith('.wasm') ? '.wasm' : '.data')
    });
  })();
  espeakMod.catch(() => { espeakMod = null; });
  return espeakMod;
}
async function phonemes(text, lang) {
  const mod = await espeak();
  espeakOut = [];
  mod.callMain(['-l', lang, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  return espeakOut.flatMap(line => { try { return JSON.parse(line).phonemes; } catch { return []; } });
}

// Piper's phonemes_to_ids: ^ _ p1 _ p2 _ … $ with the voice's own symbol table.
function toIds(list, map) {
  const ids = [...map['^'], ...map['_']];
  for (const p of list) if (map[p]) ids.push(...map[p], ...map['_']);
  ids.push(...map['$']);
  return ids;
}

async function speak({ session, config }, text, speed, speaker) {
  const ps = await phonemes(text, config.espeak.voice);
  // one pass per sentence, as Piper does
  const sentences = [];
  let cur = [];
  for (const p of ps) {
    cur.push(p);
    if (/^[.!?]$/.test(p)) { sentences.push(cur); cur = []; }
  }
  if (cur.some(p => /\S/.test(p))) sentences.push(cur);
  const rate = config.audio.sample_rate, inf = config.inference || {};
  const sid = speaker != null ? config.speaker_id_map?.[speaker] ?? 0 : 0;
  const parts = [];
  for (const s of sentences) {
    const ids = toIds(s, config.phoneme_id_map);
    if (ids.length < 5) continue;
    const feeds = {
      input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / speed, inf.noise_w ?? 0.8]), [3])
    };
    if (config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(sid)]), [1]);
    const out = await session.run(feeds);
    parts.push(new Float32Array(out[session.outputNames[0]].data), new Float32Array(Math.round(rate * 0.2)));
  }
  const total = parts.reduce((n, a) => n + a.length, 0);
  const samples = new Float32Array(Math.max(total, Math.round(rate * 0.3)));
  let off = 0;
  for (const a of parts) { samples.set(a, off); off += a.length; }
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? Math.min(4, 0.9 / peak) : 1;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return { samples, rate };
}

// voice: "<model key>" or "<model key>#<speaker>" for the multi-speaker models
self.onmessage = async e => {
  const { id, type, voice, text, speed = 1 } = e.data;
  try {
    const [key, speaker] = String(voice).split('#');
    const v = await load(key);
    if (type === 'load') {
      await espeak();
      return self.postMessage({ id, type: 'ready' });
    }
    const { samples, rate } = await speak(v, String(text || ''), Math.min(1.5, Math.max(0.6, speed)), speaker);
    self.postMessage({ id, type: 'audio', samples, rate }, [samples.buffer]);
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String(err?.message || err) });
  }
};
