// Studio voices, "My voice" and "Record my lines".
// - Studio voices: every line of a film made on the free Kaggle GPU with natural, acted
//   speech (Chatterbox Multilingual, MIT; Indic Parler-TTS, Apache-2.0) through the relay's
//   /voice job, then imported. Each cast member keeps one voice: a fixed reference clip
//   (a synthetic Kokoro voice, Apache-2.0, never a real person's) or a fixed description.
// - My voice: the person's own 10-30 s recording, cleaned and checked here, used as the
//   reference clip for the narrator or chosen characters (only with their consent). It is
//   kept in the project on this device; a job copies it to a private Hugging Face dataset,
//   and the GPU notebook deletes it (history included) when the job ends.
// - Record my lines: a line the person speaks replaces the generated voice for that line.
import { API, Cancelled, relayFetch } from './ai.js?v=63';
import { speak } from './voice.js?v=63';
import { findLanguage } from './langs.js?v=63';
import { deliveryParams, parsePerformance, parlerWords, PARLER_VOICES } from './voicebook.js?v=63';

// Languages each studio model speaks (from their model cards, checked 2026-11-06).
export const CHATTERBOX = new Set('ar da de el en es fi fr he hi it ja ko ms nl no pl pt ru sv sw tr zh'.split(' '));
export const INDIC_PARLER = new Set('as bn brx doi gu hi kn kok ks mai ml mni mr ne or pa sa sat sd ta te ur'.split(' '));
// Which studio model voices a language, or null (then the on-device voice stays).
export function studioEngine(lang) {
  const l = findLanguage(lang || 'English');
  const code = (l?.code || 'en').split('-')[0];
  const c = { nb: 'no', bho: 'hi', mag: 'hi', hne: 'hi' }[code] || code;
  if (CHATTERBOX.has(c)) return { engine: 'chatterbox', code: c };
  if (INDIC_PARLER.has(c)) return { engine: 'parler', code: c };
  return null;
}

// ---------------- lines and emotions ----------------
// The shot's expression (storyboard) or, on Auto, the same words the renderer reads.
const EXPR_EMOTION = { neutral: 'calm', smile: 'happy', laugh: 'laugh', sad: 'sad', angry: 'angry', surprised: 'surprised', worried: 'worried' };
export function emotionFor(sc, text = '') {
  if (sc.expr && sc.expr !== 'auto' && EXPR_EMOTION[sc.expr]) return EXPR_EMOTION[sc.expr];
  const t = `${sc.action || ''} ${sc.visual || ''} ${(sc.beats || []).map(b => b.act).join(' ')}`.toLowerCase();
  if (/\blaugh/.test(t)) return 'laugh';
  if (/\b(cry|cries|tear|sad|sorrow|grief|weep|mourn)/.test(t)) return 'sad';
  if (/\b(angr|furious|shout|scold|glare|rage|yell)/.test(t)) return 'angry';
  if (/\b(surpris|shock|amaz|astonish|gasp|stunned)/.test(t)) return 'surprised';
  if (/\b(worr|anxious|nervous|afraid|scared|fear|tense)/.test(t)) return 'worried';
  if (/\b(smil|happy|joy|grin|cheer|delight|celebrat)/.test(t)) return 'happy';
  return /!\s*$/.test(text) ? 'excited' : 'calm';
}
// Stable ids for every spoken line: s<shot>-n (narration), s<shot>-d<k> (dialogue k).
// A line's delivery (dialogue editor or Director) wins over the shot's expression; then the
// character's own performance words.
function lineEmotion(sc, text, delivery, perf) {
  const d = deliveryParams(delivery)?.emotion;
  if (d) return d;
  if (sc.expr && sc.expr !== 'auto' && EXPR_EMOTION[sc.expr]) return EXPR_EMOTION[sc.expr];
  return (perf && parsePerformance(perf).emotion) || emotionFor(sc, text);
}
export function filmLines(P) {
  const out = [];
  const perfOf = id => P.characters?.find(c => c.id === id)?.perf?.text || '';
  P.scenes.forEach((sc, i) => {
    if (sc.narration) out.push({ id: `s${i}-n`, shot: i, text: sc.narration, speaker: 'narrator', delivery: sc.narrDelivery || '', emotion: lineEmotion(sc, sc.narration, sc.narrDelivery, P.narratorPerf) });
    (sc.dialogue || []).forEach((d, k) => { if (d.line) out.push({ id: `s${i}-d${k}`, shot: i, k, text: d.line, speaker: d.character, delivery: d.delivery || '', emotion: lineEmotion(sc, d.line, d.delivery, perfOf(d.character)) }); });
  });
  return out;
}

// ---------------- each speaker's fixed voice ----------------
// Reference clips: synthetic Kokoro voices (Apache-2.0), one per cast member, read in
// English (Chatterbox carries the voice, not the language, across).
const REF_TEXT = 'The morning was quiet when the boats came back. Everyone on the shore waited, hoping for good news, and then, slowly, the first of them began to smile.';
const REF_VOICES = {
  narrator: 'am_michael', 'male-adult': ['am_adam', 'am_eric', 'bm_lewis', 'am_onyx'], 'female-adult': ['af_sarah', 'af_nova', 'bf_isabella', 'af_kore'],
  'male-teen': ['am_puck', 'am_echo'], 'female-teen': ['af_sky', 'bf_lily'], 'male-child': ['am_puck'], 'female-child': ['af_sky'],
  'male-elder': ['bm_daniel', 'bm_george'], 'female-elder': ['bf_alice', 'bf_emma']
};
const hash = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
function refVoiceFor(c, used) {
  const pool = REF_VOICES[`${c.gender}-${c.age}`] || REF_VOICES[`${c.gender || 'male'}-adult`];
  const v = pool.find(x => !used.has(x)) || pool[hash(c.id) % pool.length];
  used.add(v);
  return v;
}
// Indic Parler: a fixed description per cast member, from their age, gender and role.
function describe(c) {
  const age = { child: 'young child', teen: 'teenage', adult: 'adult', elder: 'elderly' }[c.age] || 'adult';
  const pitch = c.gender === 'female' ? ['a soft, warm', 'a clear, bright', 'a gentle'][hash(c.id) % 3] : ['a deep, warm', 'a clear, firm', 'a calm, low'][hash(c.id) % 3];
  return `An ${age} ${c.gender === 'female' ? 'woman' : 'man'} with ${pitch} voice, ${c.role === 'antagonist' ? 'sharp and intense' : 'natural and expressive'}`.replace(/^An (young|teenage)/, 'A $1');
}
const refCache = new Map();
// perf: the character's "Customise performance" words; Chatterbox copies the reference
// clip's pace and pitch, so the clip is read at that pace and pitch.
async function referenceClip(voice, signal, perf = '') {
  const p = perf ? parsePerformance(perf) : { speed: 1, pitch: 0 };
  const key = `${voice}|${p.speed}|${p.pitch}`;
  if (!refCache.has(key)) refCache.set(key, speak(REF_TEXT, { engine: 'kokoro', voice, speed: p.speed, pitch: p.pitch, signal }).then(b => wavBlob(b.getChannelData(0), b.sampleRate)));
  return refCache.get(key);
}
// A cast member's Parler description: the voice picked in the voice picker, or one from
// their age and gender; then the performance's pace and pitch words.
function parlerDescription(c) {
  const picked = c.studioVoice && PARLER_VOICES[c.studioVoice];
  const words = parlerWords(c.perf?.text || '');
  return `${picked ? picked[2] : describe(c)}${words ? ', ' + words : ''}`;
}

// The job: all lines and speakers. mine: {blob, speakers: ['narrator', 'c1'…]} uses the
// person's own voice for those speakers.
export async function buildVoiceJob(P, { mine = null, signal } = {}) {
  const st = studioEngine(P.language);
  if (!st) throw new Error(`Studio voices don't speak ${P.language} yet; the on-device voice stays.`);
  const lines = filmLines(P).map(l => ({ ...l, lang: st.code, engine: st.engine }));
  const cast = [{ id: 'narrator', gender: /^[ab]f_/.test(P.narrator || '') ? 'female' : 'male', age: 'adult', role: 'narrator', ...(P.narratorPerf ? { perf: { text: P.narratorPerf } } : {}) }, ...P.characters];
  const speakers = {}, refs = [], used = new Set();
  const speaking = new Set(lines.map(l => l.speaker));
  for (const c of cast) {
    if (signal?.aborted) throw new Cancelled();
    if (!speaking.has(c.id)) continue; // no line to speak: no reference clip to upload
    const name = `ref-${c.id.toLowerCase().replace(/[^a-z0-9-]/g, '')}.wav`;
    if (mine?.blob && mine.speakers?.includes(c.id) && st.engine === 'chatterbox') {
      speakers[c.id] = { ref: name, refLang: st.code, mine: true };
      refs.push({ name, b64: await toBase64(mine.blob) });
    } else if (st.engine === 'chatterbox') {
      // the studio voice picked for this character in the voice picker, if any
      const chosen = /^[ab][fm]_[a-z]+$/.test(c.studioVoice || '') ? c.studioVoice : null;
      const v = chosen || (c.id === 'narrator' && /^[ab][fm]_/.test(P.narrator || '') ? P.narrator : c.id === 'narrator' ? REF_VOICES.narrator : refVoiceFor(c, used));
      used.add(v);
      speakers[c.id] = { ref: name, refLang: 'en', voice: v };
      refs.push({ name, b64: await toBase64(await referenceClip(v, signal, c.perf?.text || '')) });
    } else {
      speakers[c.id] = { description: parlerDescription(c), seed: hash(c.id) % 1000 };
    }
  }
  return { spec: { lines: lines.map(({ id, text, lang, speaker, emotion, engine }) => ({ id, text, lang, speaker, emotion, engine })), speakers }, refs };
}

// ---------------- the GPU job ----------------
async function relay(action, body, params = '') {
  const r = await relayFetch(`${API}/voice?action=${action}${params}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Studio voices ${r.status}`), { status: r.status });
  return j;
}
// Runs the job and returns Map(line id -> AudioBuffer). onLine(id, buffer) as each arrives.
export async function runStudioVoices(P, { mine, token, signal, onStatus, onLine } = {}) {
  // unguessable (122 random bits); the start time stays readable for the relay's daily sweep
  const job = `vf-voice-${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, '')}`;
  onStatus?.('Preparing the cast voices…');
  const { spec, refs } = await buildVoiceJob(P, { mine, signal });
  onStatus?.(`Sending ${spec.lines.length} lines to the free GPU…`);
  await relay('upload', { job, spec });
  // one reference clip per request: each stays under the relay's 4.5 MB
  // (only a sample the person confirmed is theirs, or used with the speaker's permission)
  for (const r of refs) await relay('upload', { job, refs: [r], consent: !!mine?.consent });
  await relay('start', { job, token });
  const got = new Map(), started = Date.now();
  const ctx = new OfflineAudioContext(1, 1, 24000);
  for (;;) {
    if (signal?.aborted) { relay('cancel', { job }).catch(() => {}); throw new Cancelled(); }
    await new Promise(r => setTimeout(r, 8000));
    const s = await relay('status', null, `&job=${job}`).catch(() => null);
    if (!s) continue;
    for (const id of s.lines.filter(x => !got.has(x))) {
      const { url } = await relay('line', null, `&job=${job}&id=${id}`);
      const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
      got.set(id, buf); onLine?.(id, buf);
    }
    const mins = Math.round((Date.now() - started) / 60000);
    onStatus?.(`Studio voices: ${got.size} of ${spec.lines.length} lines (${mins} min; the GPU starts in a few minutes)`);
    if (s.state === 'complete' || got.size >= spec.lines.length) {
      // every line is here: the job's lines (and any voice sample) are deleted from the GPU storage now
      relay('cleanup', { job }).catch(() => {});
      break;
    }
    if (/error|cancel/.test(s.state)) throw new Error('The voice notebook stopped: ' + (s.failure || s.state));
  }
  return { job, lines: got };
}

// The voice picker's ▶ Preview of a studio voice: one line, one speaker, the same GPU job
// as a film's (a few minutes: the notebook has to start). character: { gender, age,
// studioVoice, perf }; mine: { blob, consent } to preview "My voice".
export async function previewStudioVoice({ language, character, text, delivery = '', mine = null, token, signal, onStatus }) {
  const c = { gender: 'female', age: 'adult', role: 'other', ...character, id: 'c1' };
  const mini = { language, narrator: 'am_michael', characters: [c], scenes: [{ narration: '', dialogue: [{ character: 'c1', line: text, delivery }], characters: ['c1'] }] };
  const { lines } = await runStudioVoices(mini, { mine: mine ? { ...mine, speakers: ['c1'] } : null, token, signal, onStatus });
  return lines.get('s0-d0') || null;
}

// ---------------- My voice ----------------
// Decodes any recording to mono at a given rate.
export async function decodeMono(blob, rate = 48000) {
  const ac = new OfflineAudioContext(1, 1, rate);
  const src = await ac.decodeAudioData(await blob.arrayBuffer());
  const oc = new OfflineAudioContext(1, Math.ceil(src.duration * rate), rate);
  const s = oc.createBufferSource(); s.buffer = src; s.connect(oc.destination); s.start();
  return (await oc.startRendering()).getChannelData(0);
}
const dB = x => 20 * Math.log10(Math.max(1e-9, x));
// Length, loudness and noise of a voice sample (48 kHz mono samples).
export function checkVoiceSample(pcm, rate = 48000) {
  const win = Math.round(rate * 0.03), levels = [];
  for (let k = 0; k + win <= pcm.length; k += win) {
    let e = 0; for (let i = k; i < k + win; i++) e += pcm[i] * pcm[i];
    levels.push(Math.sqrt(e / win));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.1)] || 0, speech = sorted[Math.floor(sorted.length * 0.9)] || 0;
  const voiced = levels.filter(v => v > Math.max(noise * 3, 0.01)).length * 0.03;
  const r = { seconds: +(pcm.length / rate).toFixed(1), speechSeconds: +voiced.toFixed(1), loudnessDb: +dB(speech).toFixed(1), snrDb: +(dB(speech) - dB(noise)).toFixed(1) };
  r.problem = voiced < 8 ? `Only ${r.speechSeconds} s of speech: record 10-30 seconds of you talking naturally.`
    : r.seconds > 40 ? 'That is longer than needed: 10-30 seconds is best (the rest is not used).'
      : speech < 0.02 ? 'Too quiet: move closer to the microphone and record again.'
        : r.snrDb < 15 ? 'Too much background noise: record again somewhere quieter.' : '';
  return r;
}
// Clean a sample: denoise (the app's RNNoise), trim, keep the best 30 s, level it.
// denoise(pcm48, signal) is the app's own function.
export async function prepareVoiceSample(blob, { denoise, signal } = {}) {
  let pcm = await decodeMono(blob, 48000);
  if (denoise) pcm = await denoise(pcm, signal || new AbortController().signal);
  pcm = trimSilence(pcm, 48000);
  if (pcm.length > 25 * 48000) pcm = pcm.subarray(0, 25 * 48000); // plenty, and one upload stays small
  const check = checkVoiceSample(pcm, 48000);
  const pcm24 = resample(normalise(pcm, -20), 48000, 24000);
  return { check, wav: wavBlob(pcm24, 24000), ok: !check.problem || /longer than needed/.test(check.problem) };
}

// "Save my voice for other films": one sample, on this device only (its own small
// database, separate from the projects database).
function voiceDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('vf-my-voice', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('voice');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function voiceStore(mode, fn) {
  const db = await voiceDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('voice', mode), req = fn(tx.objectStore('voice'));
    tx.oncomplete = () => { db.close(); resolve(req?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export const saveMyVoice = blob => voiceStore('readwrite', s => s.put({ blob, at: Date.now() }, 'mine'));
export const loadMyVoice = () => voiceStore('readonly', s => s.get('mine')).then(v => v?.blob || null).catch(() => null);
export const forgetMyVoice = () => voiceStore('readwrite', s => s.delete('mine')).catch(() => {});

// ---------------- Record my lines ----------------
// A recorded line, trimmed of silence and brought to the same loudness as generated lines.
export async function cleanLineRecording(blob, { denoise, signal, rate = 24000 } = {}) {
  let pcm = await decodeMono(blob, 48000);
  if (denoise) pcm = await denoise(pcm, signal || new AbortController().signal);
  pcm = resample(normalise(trimSilence(pcm, 48000), -18), 48000, rate);
  const buf = new AudioBuffer({ length: Math.max(1, pcm.length), numberOfChannels: 1, sampleRate: rate });
  buf.copyToChannel(pcm, 0);
  return buf;
}
// Microphone recording: start() then stop() -> Blob.
export async function recorder() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const rec = new MediaRecorder(stream), parts = [];
  rec.ondataavailable = e => parts.push(e.data);
  rec.start();
  return {
    stop: () => new Promise(res => { rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); res(new Blob(parts, { type: rec.mimeType })); }; rec.stop(); })
  };
}

// ---------------- audio helpers ----------------
function trimSilence(pcm, rate) {
  const win = Math.round(rate * 0.02);
  let peak = 0; for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  const th = Math.max(0.006, peak * 0.05);
  const loud = k => { let m = 0; for (let i = k; i < Math.min(pcm.length, k + win); i++) m = Math.max(m, Math.abs(pcm[i])); return m > th; };
  let a = 0, b = pcm.length - win;
  while (a < b && !loud(a)) a += win;
  while (b > a && !loud(b)) b -= win;
  return pcm.subarray(Math.max(0, a - rate * 0.08), Math.min(pcm.length, b + win + rate * 0.15));
}
function normalise(pcm, targetDb) {
  let e = 0, n = 0, peak = 0;
  for (const v of pcm) { if (Math.abs(v) > 0.01) { e += v * v; n++; } peak = Math.max(peak, Math.abs(v)); }
  const rms = Math.sqrt(e / Math.max(1, n));
  const gain = Math.min(10 ** ((targetDb - dB(rms)) / 20), 0.95 / Math.max(peak, 1e-6));
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * gain;
  return out;
}
function resample(pcm, from, to) {
  if (from === to) return pcm;
  const ratio = from / to, out = new Float32Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio, a = Math.floor(x), f = x - a;
    out[i] = (pcm[a] || 0) * (1 - f) + (pcm[a + 1] || 0) * f;
  }
  return out;
}
export function wavBlob(pcm, rate) {
  const n = pcm.length, v = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 32767, true);
  return new Blob([v.buffer], { type: 'audio/wav' });
}
async function toBase64(blob) {
  const a = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}
