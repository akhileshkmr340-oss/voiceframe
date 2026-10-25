// Voice in (dictation + voice commands) and voice out (narration).
import { getKey, relayHasKey, relayStatus, API, Cancelled } from './ai.js?v=25';

// ---------------- dictation ----------------
export class Dictation {
  constructor({ onText, onState, onCommand }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!SR;
    if (!SR) return;
    this.rec = new SR();
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.listening = false;
    this.base = '';
    this.rec.onresult = ev => {
      let finalText = '', interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t; else interim += t;
      }
      if (finalText) {
        const cmd = matchCommand(finalText);
        if (cmd) { onCommand(cmd); return; }
        this.base = (this.base + ' ' + finalText.trim()).trim();
      }
      onText(this.base, interim);
    };
    this.rec.onerror = ev => onState('error', ev.error);
    this.rec.onend = () => {
      if (this.listening) { try { this.rec.start(); } catch { /* already restarting */ } }
      else onState('stopped');
    };
    this.onState = onState;
  }
  start(lang, existing) {
    this.base = existing || '';
    this.rec.lang = lang;
    this.listening = true;
    this.rec.start();
    this.onState('listening');
  }
  stop() { this.listening = false; try { this.rec.stop(); } catch { /* not running */ } }
}

const COMMANDS = [
  ['create', /\b(create|make|generate|start)\s+(the\s+|my\s+)?(film|movie|video)\b|फ़िल्म बनाओ|वीडियो बनाओ/i],
  ['story', /\b(write|generate|create)\s+(the\s+|my\s+)?story\b|कहानी लिखो/i],
  ['clear', /^\s*(clear|erase|reset)(\s+(it|text|all))?\s*[.!]?\s*$|साफ़ करो/i],
  ['stop', /\b(stop|end)\s+(listening|recording|dictation)\b|रुको/i]
];
function matchCommand(text) {
  for (const [name, rx] of COMMANDS) if (rx.test(text)) return name;
  return null;
}

// ---------------- narration voices ----------------
export const KOKORO_NARRATORS = [
  ['am_michael', 'Michael · deep storyteller (US)'],
  ['bm_george', 'George · classic British narrator'],
  ['af_heart', 'Heart · warm female (US)'],
  ['bf_emma', 'Emma · elegant British female'],
  ['am_fenrir', 'Fenrir · intense trailer voice'],
  ['bm_fable', 'Fable · gentle British male'],
  ['af_bella', 'Bella · bright and youthful'],
  ['af_nicole', 'Nicole · soft and intimate']
];
// Cloud voices (Pollinations key): OpenAI and Microsoft voices that run on the
// account's free credit (Kokoro in the cloud needs paid credit), recorded in seconds.
export const POLLI_NARRATORS = [
  ['onyx', 'Onyx · deep storyteller'], ['fable', 'Fable · British storyteller'],
  ['en-US-Ethan', 'Ethan · warm US male'], ['en-GB-Harry', 'Harry · classic British male'],
  ['nova', 'Nova · warm female'], ['en-US-Olivia', 'Olivia · bright US female'],
  ['en-IN-Dhruv', 'Dhruv · Indian English male'], ['en-IN-Priya', 'Priya · Indian English female'],
  ['hi-IN-Arjun', 'Arjun · हिन्दी male'], ['hi-IN-Kavya', 'Kavya · हिन्दी female']
];
const KOKORO_CAST = {
  'male-adult': ['am_adam', 'am_eric', 'am_liam', 'bm_lewis', 'am_onyx'],
  'female-adult': ['af_sarah', 'af_nova', 'bf_isabella', 'af_kore', 'af_jessica'],
  'male-teen': ['am_puck', 'am_echo'], 'female-teen': ['af_sky', 'bf_lily'],
  'male-child': ['am_puck'], 'female-child': ['af_sky'],
  'male-elder': ['bm_daniel', 'am_santa'], 'female-elder': ['bf_alice', 'af_river']
};
const POLLI_CAST = {
  male: ['echo', 'en-US-Ethan', 'en-GB-Harry', 'en-IN-Dhruv', 'onyx'],
  female: ['shimmer', 'en-US-Olivia', 'en-GB-Emily', 'en-IN-Priya', 'nova'],
  'male-hi': ['hi-IN-Dhruv', 'hi-IN-Arjun'], 'female-hi': ['hi-IN-Priya', 'hi-IN-Kavya']
};
// The on-device voice closest to each cloud voice, used if a cloud line fails.
const LOCAL_TWIN = {
  onyx: 'am_michael', fable: 'bm_fable', echo: 'am_adam', alloy: 'af_alloy', nova: 'af_heart', shimmer: 'af_nicole',
  'en-US-Ethan': 'am_eric', 'en-US-Olivia': 'af_sarah', 'en-GB-Harry': 'bm_george', 'en-GB-Emily': 'bf_emma',
  'en-IN-Dhruv': 'am_michael', 'en-IN-Priya': 'af_heart'
};
const isLocalVoice = v => /^[a-z][fm]_/.test(v || '');

export function castVoices(characters, engine, narrator, language) {
  const used = new Set([narrator]);
  for (const c of characters) {
    // a voice picked for the other engine doesn't exist on this one
    if (c.voice && isLocalVoice(c.voice) !== (engine !== 'pollinations')) delete c.voice;
    if (c.voice) { used.add(c.voice); continue; }
    let pool;
    if (engine === 'pollinations') pool = POLLI_CAST[c.gender + (language === 'Hindi' ? '-hi' : '')];
    else pool = KOKORO_CAST[`${c.gender}-${c.age}`] || KOKORO_CAST[c.gender + '-adult'];
    c.voice = pool.find(v => !used.has(v)) || pool[0];
    used.add(c.voice);
  }
}
export const castOptions = engine => engine === 'pollinations'
  ? [...new Set(Object.values(POLLI_CAST).flat().concat(POLLI_NARRATORS.map(v => v[0])))]
  : [...new Set(Object.values(KOKORO_CAST).flat().concat(KOKORO_NARRATORS.map(v => v[0])))];

// ---------------- synthesis ----------------
// On-device speech (the backup when no cloud voice is available) runs on CPU, one
// sentence group at a time per worker. Two at most: more starve each other of CPU
// and trip the time limit.
const POOL = (navigator.hardwareConcurrency || 2) >= 4 && (navigator.deviceMemory || 4) >= 4 ? 2 : 1;
const slots = Array.from({ length: POOL }, () => ({ worker: null, pending: new Map() }));
let seq = 0;
let progressFn = null;

function getWorker(slot) {
  if (slot.worker) return slot.worker;
  const w = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' });
  w.onmessage = e => {
    const m = e.data;
    if (m.type === 'progress') { progressFn?.(m.loaded / (m.total || 1)); return; }
    const p = slot.pending.get(m.id);
    if (!p) return;
    slot.pending.delete(m.id);
    if (m.type === 'error') p.reject(new Error(m.error)); else p.resolve(m);
  };
  w.onerror = e => {
    slot.pending.forEach(p => p.reject(new Error('Voice engine failed to start: ' + (e.message || 'worker error'))));
    slot.pending.clear();
    slot.worker = null;
  };
  return (slot.worker = w);
}

// A worker can die silently (e.g. out of memory) and never answer, so every call
// has a deadline; on timeout that worker is restarted and the caller may retry.
function call(msg, ms, slot = slots.reduce((a, b) => (b.pending.size < a.pending.size ? b : a))) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      if (!slot.pending.has(id)) return;
      slot.pending.delete(id);
      slot.worker?.terminate();
      slot.worker = null;
      slot.pending.forEach(p => p.reject(new Error('Voice engine restarted')));
      slot.pending.clear();
      reject(new Error('Voice engine timed out'));
    }, ms);
    slot.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
    getWorker(slot).postMessage({ ...msg, id });
  });
}

// The first worker downloads the model (cached by the browser); the others then
// load it from cache in parallel.
export async function loadVoiceEngine(onProgress) {
  progressFn = onProgress;
  await call({ type: 'load' }, 600000, slots[0]);
  progressFn = null;
  await Promise.all(slots.slice(1).map(s => call({ type: 'load' }, 300000, s).catch(() => {})));
}

const ctx = () => (window.__vfAudio ||= new (window.AudioContext || window.webkitAudioContext)());

// Split into chunks the model can read in one pass (Kokoro caps at ~510 tokens).
function chunks(text) {
  const sentences = text.match(/[^.!?।]+[.!?।]+["'”’)]*\s*|[^.!?।]+$/g) || [text];
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > 280 && cur) { out.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export async function speak(text, { engine, voice, speed = 1, signal }) {
  const clean = text.replace(/\s+/g, ' ').replace(/[*_#~`]/g, '').trim();
  if (!clean) return null;
  if (signal?.aborted) throw new Cancelled();
  const parts = await Promise.all(chunks(clean).map(async c => {
    if (engine !== 'pollinations') return kokoroTTS(c, voice, speed);
    try { return await cloudTTS(c, voice, speed, signal); }
    catch (e) {
      // Cloud voice failed: record this line on-device with the closest local voice.
      const twin = isLocalVoice(voice) ? voice : LOCAL_TWIN[voice];
      if (e instanceof Cancelled || signal?.aborted || !twin) throw e;
      console.warn('Cloud voice failed, recording on this device', e.message);
      return kokoroTTS(c, twin, speed);
    }
  }));
  if (signal?.aborted) throw new Cancelled();
  return concat(parts);
}

async function kokoroTTS(text, voice, speed) {
  let m;
  try { m = await call({ type: 'speak', text, voice, speed }, 240000); }
  catch (e) {
    if (!/timed out|restarted/.test(e.message)) throw e;
    m = await call({ type: 'speak', text, voice, speed }, 360000); // fresh worker reloads the cached model
  }
  const buf = ctx().createBuffer(1, m.samples.length, m.rate);
  buf.copyToChannel(m.samples, 0);
  return buf;
}

export const cloudVoiceReady = () => relayStatus.then(() => relayHasKey() || !!getKey());

// Cloud narration: through the site's relay (its key) or the user's own key.
// At most 6 lines are recorded at once; a failed line is retried once.
let cloudActive = 0;
const cloudWaiting = [];
async function cloudTTS(text, voice, speed, signal) {
  if (cloudActive >= 6) await new Promise(r => cloudWaiting.push(r));
  cloudActive++;
  try {
    for (let attempt = 0; ; attempt++) {
      try { return await cloudOnce(text, voice, speed, signal); }
      catch (e) { if (attempt >= 1 || signal?.aborted) throw e; }
    }
  } finally {
    cloudActive--;
    cloudWaiting.shift()?.();
  }
}
async function cloudOnce(text, voice, speed, signal) {
  const key = getKey();
  const model = /^[a-z][fm]_/.test(voice) ? 'hexgrad/kokoro-82m' : /^[a-z]{2}-[A-Z]{2}-/.test(voice) ? 'microsoft/mai-voice-2.1-flash' : 'openai/tts-1';
  const timeout = AbortSignal.timeout(60000);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const r = key && !relayHasKey()
    ? await fetch('https://gen.pollinations.ai/v1/audio/speech', {
      method: 'POST', signal: sig,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, input: text, voice, response_format: 'mp3', speed })
    })
    : await fetch(API + '/speech', {
      method: 'POST', signal: sig,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, voice, speed })
    });
  if (!r.ok) throw new Error('Voice service error ' + r.status + ': ' + (await r.text()).slice(0, 160));
  return ctx().decodeAudioData(await r.arrayBuffer());
}

function concat(bufs) {
  const rate = bufs[0].sampleRate;
  const gap = Math.round(rate * 0.12);
  const len = bufs.reduce((n, b) => n + b.length + gap, 0);
  const out = ctx().createBuffer(1, len, rate);
  const data = out.getChannelData(0);
  let off = 0;
  for (const b of bufs) {
    // mix to mono and resample if a chunk came back at a different rate
    const src = b.sampleRate === rate ? b.getChannelData(0) : resample(b.getChannelData(0), b.sampleRate, rate);
    data.set(src.subarray(0, Math.min(src.length, len - off)), off);
    off += src.length + gap;
  }
  return trimSilence(out);
}

function resample(src, from, to) {
  const ratio = from / to, out = new Float32Array(Math.floor(src.length / ratio));
  for (let i = 0; i < out.length; i++) out[i] = src[Math.floor(i * ratio)];
  return out;
}

function trimSilence(buf) {
  const d = buf.getChannelData(0);
  let a = 0, b = d.length - 1;
  while (a < b && Math.abs(d[a]) < 0.004) a++;
  while (b > a && Math.abs(d[b]) < 0.004) b--;
  a = Math.max(0, a - 400); b = Math.min(d.length, b + 2400);
  const out = ctx().createBuffer(1, b - a, buf.sampleRate);
  out.copyToChannel(d.subarray(a, b), 0);
  return out;
}

export function playBuffer(buf) {
  const c = ctx();
  c.resume();
  const s = c.createBufferSource();
  s.buffer = buf;
  s.connect(c.destination);
  s.start();
  return () => { try { s.stop(); } catch { /* already stopped */ } };
}
