// Kokoro-82M neural TTS, run off the main thread. The model (~90 MB) is
// downloaded once from Hugging Face and cached by the browser.
// English voices (a…, b…) read text through kokoro-js as before. Kokoro's other
// languages get their phonemes the way Kokoro's own pipeline (misaki) makes them:
// eSpeak NG for Spanish, French, Italian and Portuguese, pinyin for Mandarin and kana
// readings for Japanese. A voice written "<voice>@<espeak code>" reads any eSpeak NG
// language with that Kokoro voice (an accent, but understandable).
import { KokoroTTS } from 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';

let ttsPromise = null;

function load() {
  ttsPromise ||= KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: p => {
      if (p.status === 'progress' && p.file?.endsWith('.onnx')) self.postMessage({ type: 'progress', loaded: p.loaded, total: p.total });
    }
  });
  return ttsPromise;
}

// ---------------- eSpeak NG (all its ~100 languages) ----------------
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
async function espeakPhonemes(text, lang) {
  const mod = await espeak();
  espeakOut = [];
  mod.callMain(['-l', lang, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  return espeakOut.map(line => { try { return JSON.parse(line).phonemes.join(''); } catch { return ''; } }).join(' ');
}
// misaki's EspeakG2P: eSpeak's diphthongs and affricates as Kokoro's single symbols.
const E2M = [['aɪ', 'I'], ['aʊ', 'W'], ['dz', 'ʣ'], ['dʒ', 'ʤ'], ['eɪ', 'A'], ['oʊ', 'O'], ['əʊ', 'Q'], ['ts', 'ʦ'], ['tʃ', 'ʧ'], ['ɔɪ', 'Y']];
async function espeakG2P(text, lang) {
  const t = text.replace(/«/g, '“').replace(/»/g, '”');
  let ps = await espeakPhonemes(t, lang);
  for (const [a, b] of E2M) ps = ps.split(a).join(b);
  return ps.replace(/[\^-]/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------- Mandarin: pinyin to IPA (misaki zh, v1.0 voices) ----------------
let pinyinLib = null;
const INI = { b: 'p', c: 'ʦʰ', ch: 'ꭧʰ', d: 't', f: 'f', g: 'k', h: 'x', j: 'ʨ', k: 'kʰ', l: 'l', m: 'm', n: 'n', p: 'pʰ', q: 'ʨʰ', r: 'ɻ', s: 's', sh: 'ʂ', t: 'tʰ', x: 'ɕ', z: 'ʦ', zh: 'ꭧ' };
const INI_ORDER = ['zh', 'ch', 'sh', ...'bpmfdtnlgkhjqxrzcs'];
const FIN = {
  a: 'a0', ai: 'ai̯0', an: 'a0n', ang: 'a0ŋ', ao: 'au̯0', e: 'ɤ0', ei: 'ei̯0', en: 'ə0n', eng: 'ə0ŋ',
  i: 'i0', ia: 'ja0', ian: 'jɛ0n', iang: 'ja0ŋ', iao: 'jau̯0', ie: 'je0', in: 'i0n', iou: 'jou̯0', ing: 'i0ŋ', iong: 'jʊ0ŋ',
  ong: 'ʊ0ŋ', ou: 'ou̯0', u: 'u0', uei: 'wei̯0', ua: 'wa0', uai: 'wai̯0', uan: 'wa0n', uen: 'wə0n', uang: 'wa0ŋ', ueng: 'wə0ŋ',
  uo: 'wo0', o: 'wo0', 'ü': 'y0', 'üe': 'ɥe0', 'üan': 'ɥɛ0n', 'ün': 'y0n'
};
const SPECIAL = { hm: 'hm0', hng: 'hŋ0', m: 'm0', n: 'n0', ng: 'ŋ0', io: 'jɔ0', 'ê': 'ɛ0', er: 'ɚ0', o: 'ɔ0' };
const TONE = ['', '˥', '˧˥', '˧˩˧', '˥˩', ''];
function py2ipa(syl) {
  const m = /^([a-zü]+)([0-5])?$/.exec(syl.replace(/v/g, 'ü'));
  if (!m) return '';
  const py = m[1], tone = +(m[2] || 5) || 5;
  let ipa = SPECIAL[py];
  if (!ipa) {
    const ini = INI_ORDER.find(i => py.startsWith(i)) || '';
    let fin = py.slice(ini.length);
    if (!ini && py[0] === 'y') { fin = py.slice(1); fin = fin[0] === 'u' ? 'ü' + fin.slice(1) : fin[0] === 'i' ? fin : 'i' + fin; }
    else if (!ini && py[0] === 'w') { fin = py.slice(1); if (fin[0] !== 'u') fin = 'u' + fin; }
    if (/^[jqx]$/.test(ini) && fin[0] === 'u') fin = 'ü' + fin.slice(1);
    fin = { iu: 'iou', ui: 'uei', un: 'uen' }[fin] || fin;
    let f = FIN[fin];
    if (fin === 'i' && /^(zh|ch|sh|r)$/.test(ini)) f = 'ɻ̩0';
    else if (fin === 'i' && /^[zcs]$/.test(ini)) f = 'ɹ̩0';
    if (!f) return '';
    ipa = (INI[ini] || '') + f;
  }
  ipa = ipa.replace(/0/g, TONE[tone]);
  return ipa.replace(/˧˩˧/g, '↓').replace(/˧˥/g, '↗').replace(/˥˩/g, '↘').replace(/˥/g, '→')
    .replace(/[ɻɹ]̩/g, 'ɨ').replace(/̯/g, '');
}
const ZH_PUNCT = { '、': ', ', '，': ', ', '。': '. ', '．': '. ', '！': '! ', '：': ': ', '；': '; ', '？': '? ', '«': ' “', '»': '” ', '《': ' “', '》': '” ', '「': ' “', '」': '” ', '『': ' “', '』': '” ', '【': ' “', '】': '” ', '（': ' (', '）': ') ' };
const ZH_DIGITS = '零一二三四五六七八九';
async function zhG2P(text) {
  pinyinLib ||= import('https://cdn.jsdelivr.net/npm/pinyin-pro@3.29.5/+esm');
  const { pinyin } = await pinyinLib;
  const s = text.replace(/\d/g, d => ZH_DIGITS[d]);
  const seg = new Intl.Segmenter('zh', { granularity: 'word' });
  const out = [];
  for (const { segment } of seg.segment(s)) {
    if (/^[㐀-鿿豈-﫿]+$/.test(segment)) {
      const syl = pinyin(segment, { toneType: 'num', type: 'array' });
      out.push(syl.map(py2ipa).join(''));
    } else {
      const p = [...segment].map(c => ZH_PUNCT[c] ?? (/[,.!?;:—…"()“”]/.test(c) ? c : /\s/.test(c) ? ' ' : '')).join('');
      if (p.trim()) out.push(p.trim()); // Latin words and symbols the voice can't read are dropped
    }
  }
  return out.join(' ').replace(/\s+([,.!?;:”)])/g, '$1').replace(/\s+/g, ' ').trim();
}

// ---------------- Japanese: kana readings to phonemes (misaki cutlet) ----------------
// Readings come from kuromoji.js (Apache-2.0, IPADIC, ~17 MB once).
const HEP = {"ぁ":"a","あ":"a","ぃ":"i","い":"i","ぅ":"ɯ","う":"ɯ","ぇ":"e","え":"e","ぉ":"o","お":"o","か":"ka","が":"ɡa","き":"kʲi","ぎ":"ɡʲi","く":"kɯ","ぐ":"ɡɯ","け":"ke","げ":"ɡe","こ":"ko","ご":"ɡo","さ":"sa","ざ":"ʣa","し":"ɕi","じ":"ʥi","す":"sɨ","ず":"zɨ","せ":"se","ぜ":"ʣe","そ":"so","ぞ":"ʣo","た":"ta","だ":"da","ち":"ʨi","ぢ":"ʥi","つ":"ʦɨ","づ":"zɨ","て":"te","で":"de","と":"to","ど":"do","な":"na","に":"ɲi","ぬ":"nɯ","ね":"ne","の":"no","は":"ha","ば":"ba","ぱ":"pa","ひ":"çi","び":"bʲi","ぴ":"pʲi","ふ":"ɸɯ","ぶ":"bɯ","ぷ":"pɯ","へ":"he","べ":"be","ぺ":"pe","ほ":"ho","ぼ":"bo","ぽ":"po","ま":"ma","み":"mʲi","む":"mɯ","め":"me","も":"mo","ゃ":"ja","や":"ja","ゅ":"jɯ","ゆ":"jɯ","ょ":"jo","よ":"jo","ら":"ɾa","り":"ɾʲi","る":"ɾɯ","れ":"ɾe","ろ":"ɾo","ゎ":"βa","わ":"βa","ゐ":"i","ゑ":"e","を":"o","ゔ":"vɯ","ゕ":"ka","ゖ":"ke","ヷ":"va","ヸ":"vʲi","ヹ":"ve","ヺ":"vo","いぇ":"je","うぃ":"βi","うぇ":"βe","うぉ":"βo","きぇ":"kʲe","きゃ":"kʲa","きゅ":"kʲɨ","きょ":"kʲo","ぎゃ":"ɡʲa","ぎゅ":"ɡʲɨ","ぎょ":"ɡʲo","くぁ":"kᵝa","くぃ":"kᵝi","くぇ":"kᵝe","くぉ":"kᵝo","ぐぁ":"ɡᵝa","ぐぃ":"ɡᵝi","ぐぇ":"ɡᵝe","ぐぉ":"ɡᵝo","しぇ":"ɕe","しゃ":"ɕa","しゅ":"ɕɨ","しょ":"ɕo","じぇ":"ʥe","じゃ":"ʥa","じゅ":"ʥɨ","じょ":"ʥo","ちぇ":"ʨe","ちゃ":"ʨa","ちゅ":"ʨɨ","ちょ":"ʨo","ぢゃ":"ʥa","ぢゅ":"ʥɨ","ぢょ":"ʥo","つぁ":"ʦa","つぃ":"ʦʲi","つぇ":"ʦe","つぉ":"ʦo","てぃ":"tʲi","てゅ":"tʲɨ","でぃ":"dʲi","でゅ":"dʲɨ","とぅ":"tɯ","どぅ":"dɯ","にぇ":"ɲe","にゃ":"ɲa","にゅ":"ɲɨ","にょ":"ɲo","ひぇ":"çe","ひゃ":"ça","ひゅ":"çɨ","ひょ":"ço","びゃ":"bʲa","びゅ":"bʲɨ","びょ":"bʲo","ぴゃ":"pʲa","ぴゅ":"pʲɨ","ぴょ":"pʲo","ふぁ":"ɸa","ふぃ":"ɸʲi","ふぇ":"ɸe","ふぉ":"ɸo","ふゅ":"ɸʲɨ","ふょ":"ɸʲo","みゃ":"mʲa","みゅ":"mʲɨ","みょ":"mʲo","りゃ":"ɾʲa","りゅ":"ɾʲɨ","りょ":"ɾʲo","ゔぁ":"va","ゔぃ":"vʲi","ゔぇ":"ve","ゔぉ":"vo","ゔゅ":"bʲɨ","ゔょ":"bʲo",
  '。': '.', '、': ',', '？': '?', '！': '!', '「': '“', '」': '”', '『': '“', '』': '”', '：': ':', '；': ';', '（': '(', '）': ')', '《': '(', '》': ')', '・': ' ', '，': ',', '～': '—', '〜': '—', '—': '—', '«': '“', '»': '”'};
const SUTEGANA = 'ゃゅょぁぃぅぇぉ';
const kata2hira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
let jaTokenizer = null;
function kuromojiTokenizer() {
  jaTokenizer ||= (async () => {
    // kuromoji joins the dictionary URL with path.join, which turns https:// into https:/
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, url, ...rest) { return open.call(this, m, String(url).replace(/^(https?):\/(?!\/)/, '$1://'), ...rest); };
    // its browser build is a classic script (the ES module build breaks on its zlib)
    const r = await fetch('https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/build/kuromoji.js');
    if (!r.ok) throw new Error('Japanese reader download failed (' + r.status + ')');
    (0, eval)(await r.text());
    const kuromoji = self.kuromoji;
    return new Promise((resolve, reject) => kuromoji.builder({ dicPath: 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/' })
      .build((err, t) => err ? reject(err) : resolve(t)));
  })();
  jaTokenizer.catch(() => { jaTokenizer = null; });
  return jaTokenizer;
}
function kanaMora(pk, kk, nk) {
  if (pk && HEP[pk + kk]) return HEP[pk + kk];
  if (nk && HEP[kk + nk]) return '';
  if (nk && SUTEGANA.includes(nk)) return kk === 'っ' ? '' : (HEP[kk] || '').slice(0, -1) + HEP[nk];
  if (SUTEGANA.includes(kk)) return '';
  if (kk === 'ー') return 'ː';
  if (kk === 'っ') return 'ʔ';
  if (kk === 'ん') {
    const t = HEP[nk];
    if (t) {
      if ('mpb'.includes(t[0])) return 'm';
      if ('kɡ'.includes(t[0])) return 'ŋ';
      if (/^[ɲʨʥ]/.test(t)) return 'ɲ';
      if ('ntdɾz'.includes(t[0])) return 'n';
    }
    return 'ɴ';
  }
  return HEP[kk] || '';
}
async function jaG2P(text) {
  const tk = await kuromojiTokenizer();
  const words = tk.tokenize(text.normalize('NFKC'));
  const out = [];
  for (const w of words) {
    const surface = w.surface_form;
    let roma;
    if (/^[\x00-\x7f]+$/.test(surface)) roma = /^\s+$/.test(surface) ? ' ' : surface.replace(/[^,.!?;:'"()-]/g, '');
    else if (w.pos === '記号') roma = [...surface].map(c => HEP[c] ?? '').join('');
    else {
      const hira = kata2hira(w.pronunciation && w.pronunciation !== '*' ? w.pronunciation : w.reading && w.reading !== '*' ? w.reading : surface);
      const ks = [...hira];
      roma = ks.map((k, i) => kanaMora(ks[i - 1], k, ks[i + 1])).join('');
    }
    const prev = out[out.length - 1];
    if (/^[「『«(\[“]/.test(surface) || /^[(\[]/.test(roma)) { if (prev) prev.space = true; out.push({ s: roma, space: false }); }
    else if (/^[」』»]/.test(surface) || /^[\]).,?!:]/.test(roma)) { if (prev) prev.space = false; out.push({ s: roma, space: true }); }
    else out.push({ s: roma, space: roma !== ' ' });
  }
  const ps = out.map(t => t.s.replace(/っ/g, '') + (t.space ? ' ' : '')).join('').trim().replace(/\s+/g, ' ');
  return ps.replace(/(?<![!",.:;?»—…”]) (?=ʔ)|(?<=ʔ) (?!["«“])/g, '');
}

// The voice's first letter is its language (Kokoro's naming); "@code" picks eSpeak NG.
const ESPEAK = { e: 'es', f: 'fr', i: 'it', p: 'pt-br', h: 'hi' };
async function phonemesFor(text, voice) {
  const at = voice.indexOf('@');
  if (at > 0) return espeakG2P(text, voice.slice(at + 1));
  const k = voice[0];
  if (k === 'z') return zhG2P(text);
  if (k === 'j') return jaG2P(text);
  return espeakG2P(text, ESPEAK[k] || 'en-us');
}

self.onmessage = async e => {
  const { id, type, text, voice, speed } = e.data;
  try {
    const tts = await load();
    if (type === 'load') {
      if (e.data.warm) await phonemesFor('.', e.data.warm);
      return self.postMessage({ id, type: 'ready' });
    }
    let audio;
    if (/^[ab][fm]_[a-z]+$/.test(voice)) audio = await tts.generate(text, { voice, speed });
    else {
      const name = voice.split('@')[0];
      const ps = await phonemesFor(text, voice);
      if (!ps.replace(/[\s,.!?;:—…"()“”]/g, '')) return self.postMessage({ id, type: 'audio', samples: new Float32Array(7200), rate: 24000 });
      const { input_ids } = tts.tokenizer(ps, { truncation: true });
      audio = await tts.generate_from_ids(input_ids, { voice: name, speed });
    }
    const samples = audio.audio;
    self.postMessage({ id, type: 'audio', samples, rate: audio.sampling_rate }, [samples.buffer]);
  } catch (err) {
    ttsPromise = type === 'load' ? null : ttsPromise;
    self.postMessage({ id, type: 'error', error: String(err?.message || err) });
  }
};
