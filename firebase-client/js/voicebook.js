// The voice book: every voice a film can use in its language, with a VoiceFrame name, a
// one-line description and where that description comes from, plus the "Customise
// performance" and line-delivery words mapped to what each engine can really change.
//
// Where the words come from (src):
//   card      the model's own card or metadata: gender and accent from Kokoro's voice ids and
//             VOICES.md, gender and training data from each Piper MODEL_CARD (langs.js), the
//             SYSPIN / AI4Bharat voice lists
//   measured  pitch measured on this device: the median pitch (Hz) of one English test
//             sentence read by the voice (autocorrelation, voiced frames only), see HZ
//   guess     a listening impression written for this list, not from any card
// Kokoro voices that share a name with another company's voices are shown under a
// VoiceFrame name (the voice id stays the same).
import { findLanguage, PIPER_VOICES } from './langs.js?v=65';
import { narratorsFor, INDIC_LANGS } from './voice.js?v=65';
import { studioEngine } from './studio.js?v=65';

// Kokoro-82M English voices: id -> [VoiceFrame name, timbre words, words' source]
// Gender (f/m) and accent (a = American, b = British) are the id's own letters (card).
const KOKORO_EN = {
  af_heart: ['Heart', 'warm, clear', 'guess'], // the card's top-rated voice
  af_alloy: ['Alloy', 'even, neutral', 'guess'],
  af_aoede: ['Lyra', 'light, airy', 'guess'],
  af_bella: ['Bella', 'bright, youthful', 'guess'], // one of the card's two best-rated voices
  af_jessica: ['Jessica', 'casual, friendly', 'guess'],
  af_kore: ['Coral', 'firm, steady', 'guess'],
  af_nicole: ['Nicole', 'soft, close-up whisper', 'guess'], // the card marks it as a headphones (ASMR-style) voice
  af_nova: ['Nova', 'crisp, confident', 'guess'],
  af_river: ['River', 'calm, mature', 'guess'],
  af_sarah: ['Sarah', 'friendly, natural', 'guess'],
  af_sky: ['Sky', 'youthful, gentle', 'guess'],
  am_adam: ['Adam', 'plain, less natural', 'card'], // the card's lowest-graded voice
  am_echo: ['Echo', 'soft, younger', 'guess'],
  am_eric: ['Eric', 'confident, crisp', 'guess'],
  am_fenrir: ['Wolfe', 'intense, dramatic', 'guess'],
  am_liam: ['Liam', 'easy-going, casual', 'guess'],
  am_michael: ['Michael', 'warm storyteller', 'guess'],
  am_onyx: ['Onyx', 'deep, resonant', 'guess'],
  am_puck: ['Robin', 'lively, upbeat', 'guess'],
  am_santa: ['Santa', 'jolly, older', 'guess'],
  bf_alice: ['Alice', 'refined, bright', 'guess'],
  bf_emma: ['Emma', 'elegant, clear', 'guess'],
  bf_isabella: ['Isabella', 'polished, warm', 'guess'],
  bf_lily: ['Lily', 'gentle, young', 'guess'],
  bm_daniel: ['Daniel', 'measured, older', 'guess'],
  bm_fable: ['Fable', 'gentle storyteller', 'guess'],
  bm_george: ['George', 'classic narrator', 'guess'],
  bm_lewis: ['Lewis', 'deep, gravelly', 'guess']
};
// Kokoro's voices in its other languages (card: gender, language; words are guesses)
const KOKORO_WORLD = {
  em_alex: ['Alex', 'Spanish', 'clear, natural'], ef_dora: ['Dora', 'Spanish', 'warm, friendly'], em_santa: ['Santa', 'Spanish', 'deep, jolly'],
  ff_siwis: ['Siwis', 'French', 'clear, polished'], 'em_alex@fr': ['Alex', 'French (accented)', 'clear, natural'],
  im_nicola: ['Nicola', 'Italian', 'warm, natural'], if_sara: ['Sara', 'Italian', 'bright, friendly'],
  pm_alex: ['Alex', 'Brazilian', 'clear, natural'], pf_dora: ['Dora', 'Brazilian', 'warm, friendly'], pm_santa: ['Santa', 'Brazilian', 'deep, jolly'],
  jm_kumo: ['Kumo', 'Japanese', 'calm, steady'], jf_alpha: ['Alpha', 'Japanese', 'clear, natural'], jf_gongitsune: ['Gongitsune', 'Japanese', 'storyteller'],
  jf_nezumi: ['Nezumi', 'Japanese', 'soft, gentle'], jf_tebukuro: ['Tebukuro', 'Japanese', 'bright, lively'],
  zm_yunjian: ['Yunjian', 'Mandarin', 'firm, clear'], zf_xiaobei: ['Xiaobei', 'Mandarin', 'clear, friendly'], zm_yunxi: ['Yunxi', 'Mandarin', 'young, lively'],
  zf_xiaoni: ['Xiaoni', 'Mandarin', 'soft, gentle'], zm_yunyang: ['Yunyang', 'Mandarin', 'newsreader, formal'], zf_xiaoxiao: ['Xiaoxiao', 'Mandarin', 'bright, lively'],
  zm_yunxia: ['Yunxia', 'Mandarin', 'boyish, young'], zf_xiaoyi: ['Xiaoyi', 'Mandarin', 'warm, gentle']
};
// Median pitch in Hz, measured on this device (see the note at the top). Filled for the
// voices that were measured; a voice without a value has its pitch word marked as a guess.
// Measured 2026-11-06 on this device (Kokoro q8 in the browser): one sentence per voice,
// English for the English voices, the voice's own language for the others.
export const HZ = { af_heart: 197, af_alloy: 145, af_aoede: 180, af_bella: 209, af_jessica: 212, af_kore: 149, af_nicole: 138, af_nova: 158, af_river: 176, af_sarah: 195, af_sky: 163, am_adam: 119, am_echo: 113, am_eric: 159, am_fenrir: 145, am_liam: 118, am_michael: 126, am_onyx: 87, am_puck: 113, am_santa: 159, bf_alice: 222, bf_emma: 183, bf_isabella: 207, bf_lily: 216, bm_daniel: 121, bm_fable: 131, bm_george: 146, bm_lewis: 96, em_alex: 126, ef_dora: 175, em_santa: 123, ff_siwis: 211, im_nicola: 96, if_sara: 222, pm_alex: 145, pf_dora: 185, hi_male: 147, hi_female: 141 };
const GUESS_PITCH = { f: 'mid pitch', m: 'mid-low pitch' };
// relative to the voice's own gender (a 140 Hz woman's voice sounds low, a 140 Hz man's fairly high)
function pitchWord(hz, g) {
  const t = g === 'f' ? [150, 170, 195, 210] : [105, 120, 140, 160];
  return hz < t[0] ? 'low pitch' : hz < t[1] ? 'mid-low pitch' : hz < t[2] ? 'mid pitch' : hz < t[3] ? 'mid-high pitch' : 'high pitch';
}
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const GENDER = { f: 'Female', m: 'Male', n: 'Any gender' };
// one line: "Female, warm, clear, mid pitch" (+ where each part comes from)
function line(g, words, hzKey, extra = '') {
  const hz = HZ[hzKey];
  return { desc: [GENDER[g] || 'Voice', words, hz ? pitchWord(hz, g) : GUESS_PITCH[g] || 'mid pitch'].filter(Boolean).join(', ') + extra, pitchMeasured: !!hz, hz: hz || null };
}

// ---------------- the list for a film ----------------
// Each entry: { id, name, desc, gender: 'female'|'male'|'any', engine, tags[], basic, studio,
//   mine, wordsSrc, pitchMeasured, hue }
const hue = id => [...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 11) % 360;
const gWord = g => g === 'f' ? 'female' : g === 'm' ? 'male' : 'any';
function kokoroEntry(id, labelHint) {
  const base = id.split('@')[0];
  const en = KOKORO_EN[base], w = KOKORO_WORLD[id] || KOKORO_WORLD[base];
  const g = base[1];
  if (en && !id.includes('@')) {
    const l = line(g, en[1], base, ` · ${base[0] === 'b' ? 'British' : 'American'}`);
    return { id, name: en[0], ...l, gender: gWord(g), engine: 'kokoro', wordsSrc: en[2], tags: ['On device'] };
  }
  if (w && !id.includes('@')) {
    const l = line(g, w[2], base, ` · ${w[1]}`);
    return { id, name: w[0], ...l, gender: gWord(g), engine: 'kokoro', wordsSrc: 'guess', tags: ['On device'] };
  }
  // a Kokoro voice reading another language's eSpeak NG phonemes: understandable, accented
  const name = (KOKORO_EN[base] || KOKORO_WORLD[base] || [labelHint || base])[0];
  const l = line(g, en ? en[1] : 'clear', base, ' · accented reading');
  return { id, name, ...l, gender: gWord(g), engine: 'espeak', basic: true, wordsSrc: en?.[2] || 'guess', tags: ['On device', 'Basic'] };
}
function piperEntry(id) {
  const v = PIPER_VOICES[id.slice(3)];
  if (!v) return null;
  const l = line(v[0], '', 'pp_' + id.slice(3), ` · trained on ${v[3].split(',')[0]}`);
  return { id, name: v[1], ...l, desc: l.desc.replace(', ,', ','), gender: gWord(v[0]), engine: 'piper', wordsSrc: 'card', tags: ['On device', v[2]] };
}
function indicEntry(id, language) {
  if (id.endsWith('_local')) {
    return { id, name: `${language} narrator`, desc: 'Single-speaker narrator voice (AI4Bharat Indic-TTS), mid pitch', gender: 'any', engine: 'indic', wordsSrc: 'guess', pitchMeasured: false, tags: ['On device'] };
  }
  const g = id.endsWith('_female') ? 'f' : 'm';
  const l = line(g, 'clear studio-read voice', id, ` · ${language} (SYSPIN)`);
  return { id, name: `${language} ${g === 'f' ? 'Asha' : 'Dev'}`, ...l, gender: gWord(g), engine: 'indic', wordsSrc: 'card', tags: ['Cloud voice'] };
}
// Studio voices (Chatterbox) copy a reference voice; these are the reference voices offered.
export const STUDIO_REFS = ['af_heart', 'af_sarah', 'af_nova', 'bf_isabella', 'bf_emma', 'af_sky', 'bf_alice', 'am_michael', 'am_eric', 'bm_lewis', 'am_onyx', 'am_puck', 'bm_daniel', 'bm_george'];
// Indic Parler-TTS speakers are text descriptions (the model is steered by them).
export const PARLER_VOICES = {
  'p-f-warm': ['Meera', 'f', 'An adult woman with a soft, warm voice', 'soft, warm'],
  'p-f-bright': ['Kavya', 'f', 'A young adult woman with a clear, bright voice', 'clear, bright'],
  'p-f-elder': ['Savitri', 'f', 'An elderly woman with a gentle, slightly husky voice', 'gentle, older'],
  'p-m-deep': ['Arjun', 'm', 'An adult man with a deep, warm voice', 'deep, warm'],
  'p-m-firm': ['Vikram', 'm', 'An adult man with a clear, firm voice', 'clear, firm'],
  'p-m-calm': ['Hari', 'm', 'An adult man with a calm, low voice', 'calm, low'],
  'p-m-elder': ['Bhola', 'm', 'An elderly man with a slow, gravelly voice', 'slow, gravelly'],
  'p-child': ['Chintu', 'n', 'A young child with a high, lively voice', 'high, lively']
};
const STUDIO_NOTE = 'Studio · natural, made on free GPU';
function studioEntries(language) {
  const st = studioEngine(language);
  if (!st) return [];
  if (st.engine === 'chatterbox') return STUDIO_REFS.map(v => {
    const k = KOKORO_EN[v], g = v[1];
    return { id: 'studio:' + v, name: k[0], desc: `${GENDER[g]}, ${k[1]}`, gender: gWord(g), engine: 'studio', studio: true, wordsSrc: k[2], pitchMeasured: false, tags: [STUDIO_NOTE] };
  });
  return Object.entries(PARLER_VOICES).map(([k, v]) => ({ id: 'studio:' + k, name: v[0], desc: `${GENDER[v[1]]}, ${v[3]}`, gender: gWord(v[1]), engine: 'studio', studio: true, wordsSrc: 'card', pitchMeasured: false, tags: [STUDIO_NOTE] }));
}
const ALL_KOKORO_EN = Object.keys(KOKORO_EN);
// Every voice for a film's language. mine: a saved "My voice" exists (in the film or on this device).
export function voiceList(language, { mine = false } = {}) {
  const lang = language || 'English';
  let list;
  if (INDIC_LANGS[lang]) list = narratorsFor(lang).map(([id]) => indicEntry(id, lang));
  else {
    const l = findLanguage(lang);
    const ids = !l || l.name === 'English' ? ALL_KOKORO_EN : narratorsFor(lang).map(v => v[0]);
    list = ids.map(id => id.startsWith('pp_') ? piperEntry(id) : kokoroEntry(id, (narratorsFor(lang).find(v => v[0] === id) || [])[1])).filter(Boolean);
    // the accented Kokoro fallbacks of a Piper language are basic too
    if (l?.piper) list.forEach(e => { if (e.id.includes('@')) { e.basic = true; e.tags = ['On device', 'Basic']; } });
  }
  list = list.concat(studioEntries(lang));
  if (mine) list.push({ id: 'mine', name: 'My voice', desc: 'Your own recorded voice (with your consent), studio voices only', gender: 'any', engine: 'mine', mine: true, wordsSrc: 'card', pitchMeasured: false, tags: [STUDIO_NOTE] });
  // which ages a voice suits, from its words (the picker's age filter)
  const ageFit = e => /young|youthful|boy|child|lively|high, lively/.test(e.desc) ? 'young' : /older|mature|elder|jolly|measured|gravelly|slow/.test(e.desc) ? 'older' : 'adult';
  return list.map(e => ({ ...e, hue: hue(e.id), ageFit: e.mine ? 'any' : ageFit(e) }));
}
export const findVoice = (language, id, opts) => voiceList(language, opts).find(e => e.id === id) || null;
// A voice's short display name for a card ("Heart", "Studio · Meera", "My voice").
export function voiceName(language, c) {
  if (c?.useMine) return 'My voice';
  const s = c?.studioVoice && findVoice(language, 'studio:' + c.studioVoice);
  if (s) return `Studio · ${s.name}`;
  const v = c?.voice && findVoice(language, c.voice);
  return v ? v.name : 'Auto voice';
}
// The voice the Director or a search means: an id, a name, or words ("deep male", "whisper").
export function matchVoice(language, query, gender) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return null;
  const list = voiceList(language);
  const exact = list.find(e => e.id.toLowerCase() === q || e.id.toLowerCase() === 'studio:' + q) || list.find(e => e.name.toLowerCase() === q)
    || list.find(e => q.includes(e.name.toLowerCase()) && e.name.length > 2);
  if (exact) return exact;
  const words = q.split(/[^\p{L}\p{N}-]+/u).filter(w => w.length > 2);
  const want = /\b(female|woman|girl|lady)\b/.test(q) ? 'female' : /\b(male|man|boy|guy)\b/.test(q) ? 'male' : gender;
  let best = null, bestScore = 0;
  for (const e of list) {
    if (e.basic) continue;
    const hay = `${e.name} ${e.desc} ${e.tags.join(' ')}`.toLowerCase();
    let s = words.filter(w => hay.includes(w)).length + (want && e.gender === want ? 1.5 : 0) - (want && e.gender !== want && e.gender !== 'any' ? 3 : 0);
    if (/studio|natural|gpu/.test(q) && e.studio) s += 1;
    if (s > bestScore) { bestScore = s; best = e; }
  }
  return best;
}

// ---------------- performance and delivery ----------------
// "Customise performance" (a character) and a line's delivery: what changes.
//   speed  x the film's speaking speed (on device; studio voices: the reference clip's pace)
//   pitch  semitones (on device by resampling; studio voices: the reference clip's pitch)
//   gain   loudness (on device)
//   emotion  the studio voice's emotion preset (it sets Chatterbox's exaggeration, guidance
//          and temperature, or Parler's tone words)
export const DELIVERIES = ['calm', 'happy', 'angry', 'sad', 'whisper', 'shout'];
const DELIVERY = {
  calm: { speed: 0.95, pitch: -0.5, gain: 0.95, emotion: 'calm' },
  happy: { speed: 1.06, pitch: 1, gain: 1.05, emotion: 'happy' },
  angry: { speed: 1.08, pitch: 0.5, gain: 1.25, emotion: 'angry' },
  sad: { speed: 0.88, pitch: -1, gain: 0.9, emotion: 'sad' },
  whisper: { speed: 0.92, pitch: -0.5, gain: 0.55, emotion: 'whisper' },
  shout: { speed: 1.05, pitch: 1.5, gain: 1.45, emotion: 'excited' }
};
const RULES = [
  [/\b(very |extremely |really )?(slow|slowly|tired|sleepy|weary|exhausted|drowsy|lazy|unhurried|deliberate)\b/, p => { p.speed *= /very|extremely|really/.test(RegExp.lastMatch) ? 0.8 : 0.88; }],
  [/\b(fast|quick|quickly|rapid|hurried|rushed|brisk|breathless)\b/, p => { p.speed *= 1.14; }],
  [/\b(deep|low|bass|husky|gravelly|gruff|rough|baritone)\b/, p => { p.pitch -= 2; }],
  [/\b(high|squeaky|childlike|young|youthful|light|bright|chirpy)\b/, p => { p.pitch += 2; }],
  [/\b(old|elderly|aged|frail)\b/, p => { p.speed *= 0.93; p.pitch -= 1; }],
  [/\b(whisper|whispering|whispered|hushed|secretive)\b/, p => { p.emotion = 'whisper'; p.gain *= 0.55; p.speed *= 0.95; }],
  [/\b(shout|shouting|yell|yelling|loud|booming)\b/, p => { p.emotion ||= 'excited'; p.gain *= 1.4; p.pitch += 1; }],
  [/\b(quiet|soft|softly|gentle|gently|tender|kind)\b/, p => { p.emotion ||= 'calm'; p.gain *= 0.85; }],
  [/\b(calm|relaxed|peaceful|soothing|serene|steady)\b/, p => { p.emotion ||= 'calm'; p.speed *= 0.97; }],
  [/\b(happy|cheerful|joyful|warm|friendly|smiling|playful)\b/, p => { p.emotion ||= 'happy'; p.pitch += 0.5; }],
  [/\b(excited|energetic|enthusiastic|thrilled|lively|upbeat)\b/, p => { p.emotion = 'excited'; p.speed *= 1.06; p.pitch += 1; }],
  [/\b(laugh|laughing|giggling|amused)\b/, p => { p.emotion = 'laugh'; }],
  [/\b(angry|furious|stern|harsh|cold|menacing|threatening|annoyed)\b/, p => { p.emotion = 'angry'; p.gain *= 1.15; }],
  [/\b(sad|sorrowful|grieving|crying|tearful|heartbroken|melancholy|gloomy)\b/, p => { p.emotion = 'sad'; p.speed *= 0.92; p.pitch -= 0.5; }],
  [/\b(scared|afraid|fearful|terrified|frightened|nervous|anxious|worried|tense)\b/, p => { p.emotion = /scared|afraid|fear|terrif|fright/.test(RegExp.lastMatch) ? 'fear' : 'worried'; }],
  [/\b(surprised|shocked|amazed|astonished)\b/, p => { p.emotion = 'surprised'; p.pitch += 1; }],
  [/\b(dramatic|theatrical|intense|passionate|exaggerated|over the top)\b/, p => { p.exaggeration = 'high'; }],
  [/\b(subtle|flat|monotone|deadpan|understated|restrained|neutral)\b/, p => { p.exaggeration = 'low'; }]
];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// Free words ("tired, slow, gentle") -> { speed, pitch, gain, emotion, exaggeration, words }
export function parsePerformance(text) {
  const t = String(text || '').toLowerCase();
  const p = { speed: 1, pitch: 0, gain: 1, emotion: '', exaggeration: '' };
  for (const [rx, fn] of RULES) if (rx.test(t)) fn(p);
  if (!p.emotion && p.exaggeration === 'high') p.emotion = 'excited';
  if (!p.emotion && p.exaggeration === 'low') p.emotion = 'calm';
  p.speed = +clamp(p.speed, 0.7, 1.35).toFixed(2); p.pitch = +clamp(p.pitch, -4, 4).toFixed(1); p.gain = +clamp(p.gain, 0.4, 1.6).toFixed(2);
  return p;
}
// A line's delivery: one of DELIVERIES or free words.
export function deliveryParams(delivery) {
  const d = String(delivery || '').trim().toLowerCase();
  if (!d) return null;
  return DELIVERY[d] ? { ...DELIVERY[d], exaggeration: '' } : parsePerformance(d);
}
// What a line is spoken with: the character's performance, then the line's delivery on top.
export function lineStyle(perf, delivery) {
  const a = perf ? parsePerformance(perf.text ?? perf) : null, b = deliveryParams(delivery);
  const s = { speed: 1, pitch: 0, gain: 1, emotion: '' };
  for (const x of [a, b]) if (x) { s.speed *= x.speed; s.pitch += x.pitch; s.gain *= x.gain; if (x.emotion) s.emotion = x.emotion; }
  s.speed = +clamp(s.speed, 0.65, 1.45).toFixed(2); s.pitch = +clamp(s.pitch, -5, 5).toFixed(1); s.gain = +clamp(s.gain, 0.35, 1.7).toFixed(2);
  return s;
}
// What the performance changes, in words (shown under the box).
export function performanceSummary(text, { studio = false } = {}) {
  const p = parsePerformance(text);
  const bits = [];
  if (p.speed !== 1) bits.push(`pace ${p.speed < 1 ? 'slower' : 'faster'} (${p.speed}x)`);
  if (p.pitch) bits.push(`pitch ${p.pitch > 0 ? '+' : ''}${p.pitch} semitones`);
  if (p.gain !== 1) bits.push(p.gain < 1 ? 'quieter' : 'louder');
  if (p.emotion) bits.push(`${studio ? 'studio emotion' : 'tone'} “${p.emotion}”${p.exaggeration ? ` (${p.exaggeration} exaggeration)` : ''}`);
  return bits.length ? bits.join(' · ') : 'No change from the voice\'s natural reading.';
}
// Parler: the description's pace and pitch words for a performance.
export function parlerWords(perf) {
  const p = parsePerformance(perf?.text ?? perf ?? '');
  return [p.speed < 0.95 ? 'speaks slowly' : p.speed > 1.05 ? 'speaks quickly' : '', p.pitch <= -1.5 ? 'with a low-pitched voice' : p.pitch >= 1.5 ? 'with a high-pitched voice' : ''].filter(Boolean).join(' ');
}
export { cap };
