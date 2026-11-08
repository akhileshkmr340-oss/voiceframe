// Voice in (dictation + voice commands) and voice out (narration).
import { API, Cancelled, relayFetch } from './ai.js?v=66';
import { findLanguage, sentences, PIPER_VOICES } from './langs.js?v=66';

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
  ['am_fenrir', 'Wolfe · intense trailer voice'],
  ['bm_fable', 'Fable · gentle British male'],
  ['af_bella', 'Bella · bright and youthful'],
  ['af_nicole', 'Nicole · soft and intimate']
];
// Indian languages. Most are recorded through the site's relay with open-source VITS
// voices trained on the SYSPIN corpus (CC BY 4.0). Tamil and
// Malayalam run on this device with AI4Bharat Indic-TTS (MIT), which is also the
// fallback when the cloud voice fails (Hindi's voice for its sister languages).
export const INDIC_LANGS = { Hindi: 'hi', Bhojpuri: 'bho', Bengali: 'bn', Marathi: 'mr', Telugu: 'te', Kannada: 'kn', Maithili: 'mai', Magahi: 'mag', Chhattisgarhi: 'hne', Tamil: 'ta', Malayalam: 'ml' };
const ON_DEVICE = new Set(['ta', 'ml']);
const DEVICE_TWIN = { hi: 'hi', bho: 'hi', mai: 'hi', mag: 'hi', hne: 'hi', bn: 'bn', mr: 'mr', te: 'te', kn: 'kn', ta: 'ta', ml: 'ml' };
const indicVoice = (code, gender) => ON_DEVICE.has(code) ? code + '_local' : `${code}_${gender === 'female' ? 'female' : 'male'}`;
export function indicNarrators(language) {
  const code = INDIC_LANGS[language];
  if (!code) return [];
  if (ON_DEVICE.has(code)) return [[code + '_local', language + ' narrator']];
  return [[code + '_male', language + ' · male narrator'], [code + '_female', language + ' · female narrator']];
}
const KOKORO_CAST = {
  'male-adult': ['am_adam', 'am_eric', 'am_liam', 'bm_lewis', 'am_onyx'],
  'female-adult': ['af_sarah', 'af_nova', 'bf_isabella', 'af_kore', 'af_jessica'],
  'male-teen': ['am_puck', 'am_echo'], 'female-teen': ['af_sky', 'bf_lily'],
  'male-child': ['am_puck'], 'female-child': ['af_sky'],
  'male-elder': ['bm_daniel', 'am_santa'], 'female-elder': ['bf_alice', 'af_river']
};
const isLocalVoice = v => /^[a-z][fm]_/.test(v || '');

// ---------------- the world's languages (langs.js) ----------------
// Kokoro's own voices outside English (Apache-2.0), by Kokoro language letter.
export const KOKORO_WORLD = {
  e: [['em_alex', 'Alex · Spanish male'], ['ef_dora', 'Dora · Spanish female'], ['em_santa', 'Santa · deep Spanish male']],
  f: [['ff_siwis', 'Siwis · French female'], ['em_alex@fr', 'Alex · French male (accented)']],
  i: [['im_nicola', 'Nicola · Italian male'], ['if_sara', 'Sara · Italian female']],
  p: [['pm_alex', 'Alex · Brazilian male'], ['pf_dora', 'Dora · Brazilian female'], ['pm_santa', 'Santa · deep Brazilian male']],
  j: [['jm_kumo', 'Kumo · Japanese male'], ['jf_alpha', 'Alpha · Japanese female'], ['jf_gongitsune', 'Gongitsune · Japanese storyteller'], ['jf_nezumi', 'Nezumi · Japanese female, soft'], ['jf_tebukuro', 'Tebukuro · Japanese female, bright']],
  z: [['zm_yunjian', 'Yunjian · Mandarin male'], ['zf_xiaobei', 'Xiaobei · Mandarin female'], ['zm_yunxi', 'Yunxi · Mandarin male, young'], ['zf_xiaoni', 'Xiaoni · Mandarin female'], ['zm_yunyang', 'Yunyang · Mandarin newsreader'], ['zf_xiaoxiao', 'Xiaoxiao · Mandarin female, bright'], ['zm_yunxia', 'Yunxia · Mandarin boy'], ['zf_xiaoyi', 'Xiaoyi · Mandarin female, warm']]
};
// No native voice yet: Kokoro voices read the language's eSpeak NG phonemes (accented).
const ESPEAK_VOICES = [['am_michael', 'male'], ['af_heart', 'female'], ['bm_george', 'male, British'], ['bf_emma', 'female, British']];
const world = language => {
  const l = INDIC_LANGS[language] ? null : findLanguage(language);
  return l && l.name !== 'English' ? l : null;
};
// Which engine records a language: 'indic', 'kokoro' or 'piper' (both on this device).
// Gujarati's old voice was Meta MMS (non-commercial): Gujarati now reads with Kokoro + eSpeak NG.
export function voiceEngine(language) {
  if (INDIC_LANGS[language]) return 'indic';
  return world(language)?.engine === 'piper' ? 'piper' : 'kokoro';
}
// Narrator choices for a language: [voice id, label].
export function narratorsFor(language) {
  if (INDIC_LANGS[language]) return indicNarrators(language);
  const l = world(language);
  if (!l) return KOKORO_NARRATORS;
  if (l.piper) {
    const list = l.piper.map(v => [`pp_${v}`, `${PIPER_VOICES[v][1]} · ${l.name} ${PIPER_VOICES[v][0] === 'f' ? 'female' : 'male'}`]);
    // no Piper voice of one gender: a Kokoro voice reads the language's phonemes for it
    const code = l.code === 'nb' ? 'nb' : l.code.split('-')[0];
    if (!l.piper.some(v => PIPER_VOICES[v][0] === 'f')) list.push([`af_heart@${code}`, `Heart · ${l.name} female (accented)`]);
    if (!l.piper.some(v => PIPER_VOICES[v][0] === 'm')) list.push([`am_michael@${code}`, `Michael · ${l.name} male (accented)`]);
    return list;
  }
  if (l.espeak) return ESPEAK_VOICES.map(([v, d]) => [`${v}@${l.espeak}`, `${l.name} · ${d} (accented)`]);
  return KOKORO_WORLD[l.kokoro] || KOKORO_NARRATORS;
}
// What a voice is for, from its id: pp_<Piper voice>[#speaker] or <kokoro voice>[@espeak].
const voiceGender = v => v.startsWith('pp_') ? (PIPER_VOICES[v.slice(3)]?.[0] === 'f' ? 'female' : 'male') : v[1] === 'f' ? 'female' : 'male';
function castWorld(characters, l, narrator) {
  const pool = narratorsFor(l.name).map(v => v[0]);
  const used = new Set([narrator]);
  for (const c of characters) {
    if (c.voice && pool.includes(c.voice)) { used.add(c.voice); continue; }
    const fit = pool.filter(v => voiceGender(v) === c.gender);
    // a voice of the right gender, even if someone else has it, beats one of the wrong gender
    c.voice = fit.find(v => !used.has(v)) || fit.find(v => v !== narrator) || fit[0] || pool.find(v => !used.has(v)) || pool[0];
    used.add(c.voice);
  }
}
// The download a language's voice needs before recording, or null when none.
export function voiceDownload(language) {
  if (ON_DEVICE.has(INDIC_LANGS[language])) return { mb: 120, kind: 'indic' };
  if (INDIC_LANGS[language]) return null;
  const l = world(language);
  if (l?.piper) return { mb: (PIPER_VOICES[l.piper[0]]?.[4] || 63) + 18, kind: 'piper' };
  return { mb: 90 + (l?.kokoro === 'j' ? 17 : 0) + (l && l.kokoro !== 'z' && l.kokoro !== 'j' ? 18 : 0), kind: 'kokoro' };
}
// Loads whatever voice a language needs (Kokoro, an Indian voice or a Piper voice).
export async function loadVoice(language, onProgress) {
  const d = voiceDownload(language);
  if (!d) return;
  if (d.kind === 'indic') return loadIndicVoice(language, onProgress);
  if (d.kind === 'piper') {
    piperProgress = onProgress;
    try { await piperCall({ type: 'load', voice: world(language).piper[0] }, 1800000); }
    finally { piperProgress = null; }
    return;
  }
  const v = narratorsFor(language)[0][0];
  return loadVoiceEngine(onProgress, /^[ab][fm]_[a-z]+$/.test(v) ? null : v);
}

export function castVoices(characters, engine, narrator, language) {
  const used = new Set([narrator]);
  const l = engine !== 'indic' && world(language);
  if (l) return castWorld(characters, l, narrator);
  for (const c of characters) {
    // a voice picked for another engine or language doesn't exist here (a voice picked
    // for this Indian language in the voice picker stays)
    if (engine === 'indic') { if (!indicNarrators(language).some(v => v[0] === c.voice)) c.voice = indicVoice(INDIC_LANGS[language], c.gender); continue; }
    if (c.voice && !isLocalVoice(c.voice)) delete c.voice;
    if (c.voice) { used.add(c.voice); continue; }
    const pool = KOKORO_CAST[`${c.gender}-${c.age}`] || KOKORO_CAST[c.gender + '-adult'];
    c.voice = pool.find(v => !used.has(v)) || pool[0];
    used.add(c.voice);
  }
}
export const castOptions = (engine, language) => engine === 'indic'
  ? indicNarrators(language).map(v => v[0])
  : world(language) ? narratorsFor(language).map(v => v[0])
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
  const w = new Worker(new URL('./tts-worker.js?v=66', import.meta.url), { type: 'module' });
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
// warm: a voice whose phoneme reader (eSpeak NG data, Japanese dictionary) loads now too.
export async function loadVoiceEngine(onProgress, warm = null) {
  progressFn = onProgress;
  await call({ type: 'load', warm }, 600000, slots[0]);
  progressFn = null;
  await Promise.all(slots.slice(1).map(s => call({ type: 'load', warm }, 300000, s).catch(() => {})));
}

// Indian voices on this device: one worker, one language model loaded at a time.
let indicWorker = null, indicProgress = null;
const indicPending = new Map();
function indicCall(msg, ms) {
  if (!indicWorker) {
    indicWorker = new Worker(new URL('./indic-worker.js', import.meta.url), { type: 'module' });
    indicWorker.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') { indicProgress?.(m.loaded / (m.total || 1)); return; }
      const p = indicPending.get(m.id);
      if (!p) return;
      indicPending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.error)); else p.resolve(m);
    };
    indicWorker.onerror = e => {
      indicPending.forEach(p => p.reject(new Error('Indian voice engine failed to start: ' + (e.message || 'worker error'))));
      indicPending.clear();
      indicWorker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      if (!indicPending.delete(id)) return;
      indicWorker?.terminate(); indicWorker = null;
      indicPending.forEach(p => p.reject(new Error('Voice engine restarted')));
      indicPending.clear();
      reject(new Error('Voice engine timed out'));
    }, ms);
    indicPending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
    indicWorker.postMessage({ ...msg, id });
  });
}
// Languages whose voice must be downloaded to this device before recording.
export const onDeviceIndic = language => ON_DEVICE.has(INDIC_LANGS[language]);
export async function loadIndicVoice(language, onProgress) {
  indicProgress = onProgress;
  try { await indicCall({ type: 'load', lang: INDIC_LANGS[language] }, 1800000); }
  finally { indicProgress = null; }
}
async function indicTTS(text, lang) {
  const m = await indicCall({ type: 'speak', lang, text }, 1800000);
  const buf = ctx().createBuffer(1, m.samples.length, m.rate);
  buf.copyToChannel(m.samples, 0);
  return buf;
}

// The world's other languages on this device: Piper voices (commercial-use licences), one worker.
let piperWorker = null, piperProgress = null;
const piperPending = new Map();
function piperCall(msg, ms) {
  if (!piperWorker) {
    piperWorker = new Worker(new URL('./piper-worker.js?v=66', import.meta.url), { type: 'module' });
    piperWorker.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') { piperProgress?.(m.loaded / (m.total || 1)); return; }
      const p = piperPending.get(m.id);
      if (!p) return;
      piperPending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.error)); else p.resolve(m);
    };
    piperWorker.onerror = e => {
      piperPending.forEach(p => p.reject(new Error('Voice engine failed to start: ' + (e.message || 'worker error'))));
      piperPending.clear();
      piperWorker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      if (!piperPending.delete(id)) return;
      piperWorker?.terminate(); piperWorker = null;
      piperPending.forEach(p => p.reject(new Error('Voice engine restarted')));
      piperPending.clear();
      reject(new Error('Voice engine timed out'));
    }, ms);
    piperPending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
    piperWorker.postMessage({ ...msg, id });
  });
}
async function piperTTS(text, voice, speed) {
  const m = await piperCall({ type: 'speak', voice: voice.slice(3), text, speed }, 1800000);
  const buf = ctx().createBuffer(1, Math.max(1, m.samples.length), m.rate);
  buf.copyToChannel(m.samples, 0);
  return buf;
}

const ctx = () => (window.__vfAudio ||= new (window.AudioContext || window.webkitAudioContext)());

// Split into chunks the model can read in one pass (Kokoro caps at ~510 tokens).
// English and Indian lines split exactly as before; other scripts also end sentences
// with their own marks (。 ؟ ። …), and Chinese and Japanese, dense in sounds, in shorter chunks.
function chunks(text, world = false) {
  const sentenceList = (world ? sentences(text) : text.match(/[^.!?।]+[.!?।]+["'”’)]*\s*|[^.!?।]+$/g)) || [text];
  const max = world && /[぀-ヿ㐀-鿿]/.test(text) ? 90 : 280;
  const out = [];
  let cur = '';
  for (const s of sentenceList) {
    if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// pitch: semitones up (+) or down (-), duration kept: the line is read at a matching
// speed, then resampled (on-device and cloud voices alike). gain: loudness.
export async function speak(text, { engine, voice, speed = 1, signal, pitch = 0, gain = 1 }) {
  const r = 2 ** ((+pitch || 0) / 12);
  if (Math.abs(r - 1) < 0.005 && Math.abs(gain - 1) < 0.005) return speakPlain(text, { engine, voice, speed, signal });
  const buf = await speakPlain(text, { engine, voice, speed: speed / r, signal });
  return buf && shape(buf, r, gain);
}
// Resample by r (pitch x r, length / r) and scale by gain, peak kept under 0.98.
function shape(buf, r, gain) {
  const src = buf.getChannelData(0), n = Math.max(1, Math.floor(src.length / r));
  const out = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const x = i * r, a = Math.floor(x), f = x - a;
    out[i] = ((src[a] || 0) * (1 - f) + (src[a + 1] || 0) * f) * gain;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  if (peak > 0.98) for (let i = 0; i < n; i++) out[i] *= 0.98 / peak;
  const b = ctx().createBuffer(1, n, buf.sampleRate);
  b.copyToChannel(out, 0);
  return b;
}
async function speakPlain(text, { engine, voice, speed = 1, signal }) {
  const clean = text.replace(/\s+/g, ' ').replace(/[*_#~`]/g, '').trim();
  if (!clean) return null;
  if (signal?.aborted) throw new Cancelled();
  speak.calls = (speak.calls || 0) + 1; // lines really recorded (an edited line is the only new one)
  const worldVoice = engine === 'piper' || (engine !== 'indic' && !/^[ab][fm]_[a-z]+$/.test(voice || ''));
  const parts = await Promise.all(chunks(clean, worldVoice).map(async c => {
    if (voice?.startsWith('pp_')) return piperTTS(c, voice, speed);
    if (engine !== 'indic') return kokoroTTS(c, voice, speed);
    const code = voice.split('_')[0];
    if (voice.endsWith('_local')) return indicTTS(c, code);
    try { return await cloudTTS(c, voice, speed, signal); }
    catch (e) {
      // Cloud voice failed: record this line on-device with the same language's voice.
      if (e instanceof Cancelled || signal?.aborted || !DEVICE_TWIN[code]) throw e;
      console.warn('Cloud voice failed, recording on this device', e.message);
      return indicTTS(c, DEVICE_TWIN[code]);
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


// Cloud narration: through the site's relay (its key) or the user's own key.
// At most 6 lines are recorded at once; a failed line is retried once.
let cloudActive = 0;
const cloudWaiting = [];
async function cloudTTS(text, voice, speed, signal) {
  if (cloudActive >= 4) await new Promise(r => cloudWaiting.push(r));
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
  // the Indian voice service sleeps when idle and can take a minute to wake
  const timeout = AbortSignal.timeout(115000);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const r = await relayFetch(API + '/speech', {
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
