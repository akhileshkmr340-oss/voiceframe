// Every language a film can be written, voiced and subtitled in: one table.
// Voice engines (all free and open source, all on this device unless noted):
//   kokoro      Kokoro-82M (Apache-2.0) with its own voices: English, Spanish, French,
//               Italian, Portuguese (Brazil), Japanese and Mandarin Chinese
//   indic       the Indian voices (SYSPIN VITS, CC BY 4.0, through the relay; AI4Bharat
//               on this device for Tamil and Malayalam)
//   piper       Piper voices (rhasspy/piper-voices), only ones whose licence allows
//               commercial use; each voice's licence and dataset is in PIPER_VOICES
//   espeak      no commercially usable native voice: a Kokoro voice reads the language's
//               eSpeak NG phonemes (understandable, with a foreign accent). Languages
//               eSpeak NG lacks borrow a close language's rules ('espeak:sw' for Shona…)
// No non-commercial voice (Meta MMS, NC Piper voices) is reachable from this table.
const SCRIPTS = {
  Latn: ['Latin'], Cyrl: ['Cyrillic'], Grek: ['Greek'],
  Arab: ['Arabic', 'Noto Sans Arabic', 1], Hebr: ['Hebrew', 'Noto Sans Hebrew', 1], Thaa: ['Thaana', 'Noto Sans Thaana', 1],
  Deva: ['Devanagari', 'Noto Sans Devanagari'], Beng: ['Bengali', 'Noto Sans Bengali'], Guru: ['Gurmukhi', 'Noto Sans Gurmukhi'],
  Gujr: ['Gujarati', 'Noto Sans Gujarati'], Orya: ['Odia', 'Noto Sans Oriya'], Taml: ['Tamil', 'Noto Sans Tamil'],
  Telu: ['Telugu', 'Noto Sans Telugu'], Knda: ['Kannada', 'Noto Sans Kannada'], Mlym: ['Malayalam', 'Noto Sans Malayalam'],
  Sinh: ['Sinhala', 'Noto Sans Sinhala'], Tibt: ['Tibetan', 'Noto Serif Tibetan'],
  Thai: ['Thai', 'Noto Sans Thai'], Laoo: ['Lao', 'Noto Sans Lao'], Khmr: ['Khmer', 'Noto Sans Khmer'], Mymr: ['Myanmar', 'Noto Sans Myanmar'],
  Ethi: ['Ethiopic (Geʽez)', 'Noto Sans Ethiopic'], Geor: ['Georgian', 'Noto Sans Georgian'], Armn: ['Armenian', 'Noto Sans Armenian'],
  Kore: ['Hangul', 'Noto Sans KR'], Hans: ['simplified Chinese characters', 'Noto Sans SC'], Hant: ['traditional Chinese characters', 'Noto Sans TC'],
  Jpan: ['Japanese (kanji and kana)', 'Noto Sans JP']
};

// Whisper (speech to text) knows these codes; others are transcribed without a hint.
const WHISPER = new Set('af am ar as az ba be bg bn bo br bs ca cs cy da de el en es et eu fa fi fo fr gl gu ha haw he hi hr ht hu hy id is it ja jw ka kk km kn ko la lb ln lo lt lv mg mi mk ml mn mr ms mt my ne nl nn no oc pa pl ps pt ro ru sa sd si sk sl sn so sq sr su sv sw ta te tg th tk tl tr tt uk ur uz vi yi yo zh yue'.split(' '));

// [name, native name, BCP-47 code, script, voice, extra]
// voice: 'kokoro' (English) | 'kokoro:<Kokoro language letter>' | 'indic' | 'piper:<voice>,<voice>' | 'espeak:<eSpeak NG voice>'
// extra.borrowed: eSpeak NG has no rules for the language; the named one's are used.
const ROWS = {
  India: [
    ['Hindi', 'हिन्दी', 'hi', 'Deva', 'indic'],
    ['Bhojpuri', 'भोजपुरी', 'bho', 'Deva', 'indic', { whisper: 'hi' }],
    ['Bengali', 'বাংলা', 'bn', 'Beng', 'indic'],
    ['Marathi', 'मराठी', 'mr', 'Deva', 'indic'],
    ['Telugu', 'తెలుగు', 'te', 'Telu', 'indic'],
    ['Kannada', 'ಕನ್ನಡ', 'kn', 'Knda', 'indic'],
    ['Gujarati', 'ગુજરાતી', 'gu', 'Gujr', 'espeak:gu'],
    ['Maithili', 'मैथिली', 'mai', 'Deva', 'indic', { whisper: 'hi' }],
    ['Magahi', 'मगही', 'mag', 'Deva', 'indic', { whisper: 'hi' }],
    ['Chhattisgarhi', 'छत्तीसगढ़ी', 'hne', 'Deva', 'indic', { whisper: 'hi' }],
    ['Tamil', 'தமிழ்', 'ta', 'Taml', 'indic'],
    ['Malayalam', 'മലയാളം', 'ml', 'Mlym', 'indic'],
    ['Punjabi', 'ਪੰਜਾਬੀ', 'pa', 'Guru', 'espeak:pa'],
    ['Odia', 'ଓଡ଼ିଆ', 'or', 'Orya', 'espeak:or'],
    ['Assamese', 'অসমীয়া', 'as', 'Beng', 'espeak:as'],
    ['Urdu', 'اردو', 'ur', 'Arab', 'piper:ur_PK-fasih-medium,ur_PK-aegis_female-medium'],
    ['Konkani', 'कोंकणी', 'kok', 'Deva', 'espeak:kok', { whisper: 'mr' }],
    ['Sindhi', 'سنڌي', 'sd', 'Arab', 'espeak:sd']
  ],
  'South Asia': [
    ['Nepali', 'नेपाली', 'ne', 'Deva', 'piper:ne_NP-chitwan-medium'],
    ['Sinhala', 'සිංහල', 'si', 'Sinh', 'espeak:si'],
  ],
  'East Asia': [
    ['Chinese (Mandarin)', '中文', 'zh', 'Hans', 'kokoro:z'],
    ['Cantonese', '粵語', 'yue', 'Hant', 'espeak:yue', { whisper: 'zh' }],
    ['Japanese', '日本語', 'ja', 'Jpan', 'kokoro:j'],
    ['Korean', '한국어', 'ko', 'Kore', 'espeak:ko'],
    ['Mongolian', 'Монгол', 'mn', 'Cyrl', 'espeak:ky', { borrowed: 'Kyrgyz' }]
  ],
  'Southeast Asia': [
    ['Vietnamese', 'Tiếng Việt', 'vi', 'Latn', 'piper:vi_VN-vais1000-medium'],
    ['Thai', 'ไทย', 'th', 'Thai', 'espeak:th', { weak: true }],
    ['Indonesian', 'Bahasa Indonesia', 'id', 'Latn', 'espeak:id'],
    ['Malay', 'Bahasa Melayu', 'ms', 'Latn', 'espeak:ms'],
    ['Filipino (Tagalog)', 'Tagalog', 'tl', 'Latn', 'espeak:id', { borrowed: 'Indonesian' }],
    ['Cebuano', 'Cebuano', 'ceb', 'Latn', 'espeak:id', { borrowed: 'Indonesian' }],
    ['Ilocano', 'Ilokano', 'ilo', 'Latn', 'espeak:id', { borrowed: 'Indonesian' }],
    ['Javanese', 'Basa Jawa', 'jv', 'Latn', 'espeak:id', { borrowed: 'Indonesian', whisper: 'jw' }],
    ['Sundanese', 'Basa Sunda', 'su', 'Latn', 'espeak:id', { borrowed: 'Indonesian' }],
    ['Burmese', 'မြန်မာ', 'my', 'Mymr', 'espeak:my'],
  ],
  'Middle East & Central Asia': [
    ['Arabic', 'العربية', 'ar', 'Arab', 'espeak:ar', { weak: true }],
    ['Persian', 'فارسی', 'fa', 'Arab', 'piper:fa_IR-amir-medium,fa_IR-ganji-medium'],
    ['Hebrew', 'עברית', 'he', 'Hebr', 'espeak:he', { weak: true }],
    ['Turkish', 'Türkçe', 'tr', 'Latn', 'espeak:tr'],
    ['Kurdish (Kurmanji)', 'Kurdî', 'ku', 'Latn', 'espeak:ku', { whisper: null }],
    ['Azerbaijani', 'Azərbaycanca', 'az', 'Latn', 'espeak:az'],
    ['Kazakh', 'Қазақша', 'kk', 'Cyrl', 'piper:kk_KZ-issai-high#ISSAI_KazakhTTS_M1_Iseke,kk_KZ-issai-high#ISSAI_KazakhTTS_F1_Raya'],
    ['Uzbek', 'Oʻzbekcha', 'uz', 'Latn', 'espeak:uz'],
    ['Kyrgyz', 'Кыргызча', 'ky', 'Cyrl', 'espeak:ky', { whisper: null }],
    ['Tajik', 'Тоҷикӣ', 'tg', 'Cyrl', 'espeak:ky', { borrowed: 'Kyrgyz' }],
    ['Turkmen', 'Türkmençe', 'tk', 'Latn', 'espeak:tk'],
    ['Uyghur', 'ئۇيغۇرچە', 'ug', 'Arab', 'espeak:ug'],
    ['Tatar', 'Татарча', 'tt', 'Cyrl', 'espeak:tt'],
    ['Bashkir', 'Башҡортса', 'ba', 'Cyrl', 'espeak:ba'],
    ['Georgian', 'ქართული', 'ka', 'Geor', 'espeak:ka'],
    ['Armenian', 'Հայերեն', 'hy', 'Armn', 'piper:hy_AM-gor-medium']
  ],
  Europe: [
    ['Spanish', 'Español', 'es', 'Latn', 'kokoro:e'],
    ['French', 'Français', 'fr', 'Latn', 'kokoro:f'],
    ['Italian', 'Italiano', 'it', 'Latn', 'kokoro:i'],
    ['Portuguese', 'Português', 'pt', 'Latn', 'kokoro:p'],
    ['German', 'Deutsch', 'de', 'Latn', 'piper:de_DE-thorsten-medium,de_DE-kerstin-low'],
    ['Russian', 'Русский', 'ru', 'Cyrl', 'piper:ru_RU-dmitri-medium,ru_RU-denis-medium'],
    ['Ukrainian', 'Українська', 'uk', 'Cyrl', 'piper:uk_UA-oleksa-high,uk_UA-tetiana-high'],
    ['Polish', 'Polski', 'pl', 'Latn', 'piper:pl_PL-darkman-medium,pl_PL-gosia-medium'],
    ['Dutch', 'Nederlands', 'nl', 'Latn', 'piper:nl_NL-pim-medium,nl_BE-nathalie-medium'],
    ['Romanian', 'Română', 'ro', 'Latn', 'piper:ro_RO-mihai-medium'],
    ['Greek', 'Ελληνικά', 'el', 'Grek', 'piper:el_GR-rapunzelina-medium'],
    ['Hungarian', 'Magyar', 'hu', 'Latn', 'piper:hu_HU-imre-medium,hu_HU-anna-medium'],
    ['Swedish', 'Svenska', 'sv', 'Latn', 'piper:sv_SE-nst-medium,sv_SE-alma-medium'],
    ['Finnish', 'Suomi', 'fi', 'Latn', 'piper:fi_FI-harri-medium'],
    ['Bulgarian', 'Български', 'bg', 'Cyrl', 'piper:bg_BG-dimitar-medium'],
    ['Latvian', 'Latviešu', 'lv', 'Latn', 'piper:lv_LV-aivars-medium'],
    ['Icelandic', 'Íslenska', 'is', 'Latn', 'piper:is_IS-steinn-medium,is_IS-ugla-medium'],
    ['Welsh', 'Cymraeg', 'cy', 'Latn', 'piper:cy_GB-bu_tts-medium#gwryw-gogledd-pro,cy_GB-bu_tts-medium#benyw-gogledd-pro'],
    ['Basque', 'Euskara', 'eu', 'Latn', 'piper:eu_ES-antton-medium,eu_ES-maider-medium'],
    ['Catalan', 'Català', 'ca', 'Latn', 'piper:ca_ES-upc_pau-x_low,ca_ES-upc_ona-medium'],
    ['Albanian', 'Shqip', 'sq', 'Latn', 'piper:sq_AL-edon-medium'],
    ['Faroese', 'Føroyskt', 'fo', 'Latn', 'espeak:is', { borrowed: 'Icelandic' }],
    ['Latin', 'Latina', 'la', 'Latn', 'espeak:la'],
    ['Czech', 'Čeština', 'cs', 'Latn', 'piper:cs_CZ-jirka-medium,cs_CZ-kasandra-medium'],
    ['Slovak', 'Slovenčina', 'sk', 'Latn', 'piper:sk_SK-lili-medium'],
    ['Slovenian', 'Slovenščina', 'sl', 'Latn', 'piper:sl_SI-artur-medium'],
    ['Croatian', 'Hrvatski', 'hr', 'Latn', 'espeak:hr'],
    ['Serbian', 'Српски', 'sr', 'Cyrl', 'espeak:sr'],
    ['Bosnian', 'Bosanski', 'bs', 'Latn', 'espeak:bs'],
    ['Macedonian', 'Македонски', 'mk', 'Cyrl', 'espeak:mk'],
    ['Belarusian', 'Беларуская', 'be', 'Cyrl', 'espeak:be'],
    ['Lithuanian', 'Lietuvių', 'lt', 'Latn', 'espeak:lt'],
    ['Estonian', 'Eesti', 'et', 'Latn', 'piper:et_EE-news-medium#Albert,et_EE-news-medium#Mari'],
    ['Danish', 'Dansk', 'da', 'Latn', 'piper:da_DK-talesyntese-medium'],
    ['Norwegian', 'Norsk', 'nb', 'Latn', 'piper:no_NO-nvcc-medium#MNN,no_NO-nvcc-medium#KNN', { whisper: 'no' }],
    ['Irish', 'Gaeilge', 'ga', 'Latn', 'espeak:ga'],
    ['Scottish Gaelic', 'Gàidhlig', 'gd', 'Latn', 'espeak:gd'],
    ['Galician', 'Galego', 'gl', 'Latn', 'espeak:pt'], // eSpeak NG has no Galician: read as Portuguese
    ['Maltese', 'Malti', 'mt', 'Latn', 'espeak:mt'],
    ['Luxembourgish', 'Lëtzebuergesch', 'lb', 'Latn', 'espeak:lb'],
    ['Esperanto', 'Esperanto', 'eo', 'Latn', 'espeak:eo']
  ],
  Africa: [
    ['Swahili', 'Kiswahili', 'sw', 'Latn', 'espeak:sw'],
    ['Amharic', 'አማርኛ', 'am', 'Ethi', 'espeak:am'],
    ['Yoruba', 'Yorùbá', 'yo', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Hausa', 'Hausa', 'ha', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Somali', 'Soomaali', 'so', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Oromo', 'Afaan Oromoo', 'om', 'Latn', 'espeak:om'],
    ['Afrikaans', 'Afrikaans', 'af', 'Latn', 'espeak:af'],
    ['Setswana', 'Setswana', 'tn', 'Latn', 'espeak:tn'],
    ['Shona', 'chiShona', 'sn', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Kinyarwanda', 'Ikinyarwanda', 'rw', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Kirundi', 'Ikirundi', 'rn', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Luganda', 'Luganda', 'lg', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Chichewa', 'Chichewa', 'ny', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Malagasy', 'Malagasy', 'mg', 'Latn', 'espeak:id', { borrowed: 'Indonesian' }],
    ['Akan (Twi)', 'Akan', 'ak', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Ewe', 'Eʋegbe', 'ee', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Fula', 'Fulfulde', 'ff', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Kikuyu', 'Gĩkũyũ', 'ki', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Bambara', 'Bamanankan', 'bm', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Mooré', 'Mooré', 'mos', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Tsonga', 'Xitsonga', 'ts', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Fon', 'Fɔngbè', 'fon', 'Latn', 'espeak:sw', { borrowed: 'Swahili' }],
    ['Nigerian Pidgin', 'Naijá', 'pcm', 'Latn', 'espeak:en', { borrowed: 'English' }],
    ['Kabyle', 'Taqbaylit', 'kab', 'Latn', 'espeak:es', { borrowed: 'Spanish' }]
  ],
  'Americas & Pacific': [
    ['Haitian Creole', 'Kreyòl ayisyen', 'ht', 'Latn', 'espeak:ht'],
    ['Quechua', 'Runa Simi', 'qu', 'Latn', 'espeak:qu'],
    ['Guarani', 'Avañeʼẽ', 'gn', 'Latn', 'espeak:gn'],
    ['Jamaican Patois', 'Patwa', 'jam', 'Latn', 'espeak:en', { borrowed: 'English' }],
    ['Hawaiian', 'ʻŌlelo Hawaiʻi', 'haw', 'Latn', 'espeak:haw'],
    ['Māori', 'Te Reo Māori', 'mi', 'Latn', 'espeak:mi'],
    ['Samoan', 'Gagana Sāmoa', 'sm', 'Latn', 'espeak:id', { borrowed: 'Indonesian' }],
    ['Fijian', 'Vosa Vakaviti', 'fj', 'Latn', 'espeak:id', { borrowed: 'Indonesian' }],
    ['Tok Pisin', 'Tok Pisin', 'tpi', 'Latn', 'espeak:en', { borrowed: 'English' }]
  ]
};

// The languages the app shipped with before the global list: their writer prompts stay
// word for word the same.
const ORIGINAL = new Set(['English', 'Hindi', 'Bhojpuri', 'Bengali', 'Marathi', 'Telugu', 'Kannada', 'Gujarati', 'Maithili', 'Magahi', 'Chhattisgarhi', 'Tamil', 'Malayalam']);

function make(name, native, code, script, voice, extra = {}, group) {
  const i = voice.indexOf(':');
  const engine = i < 0 ? voice : voice.slice(0, i), model = i < 0 ? '' : voice.slice(i + 1);
  const s = SCRIPTS[script];
  const base = code.split('-')[0];
  return {
    name, native, group, code, script, scriptName: s[0], font: s[1] || null, rtl: !!s[2],
    whisper: 'whisper' in extra ? extra.whisper : WHISPER.has(base) ? base : null,
    engine: engine === 'espeak' ? 'kokoro' : engine,
    kokoro: engine === 'kokoro' ? (model || 'a') : engine === 'espeak' ? 'x' : null,
    espeak: engine === 'espeak' ? model : null,
    piper: engine === 'piper' ? model.split(',') : null,
    borrowed: extra.borrowed || null,
    // on-device reading is hard to understand (eSpeak NG needs vowel marks this script leaves out): suggest Studio voices
    weak: !!extra.weak,
    approx: engine === 'espeak'
  };
}

export const LANGUAGES = [make('English', 'English', 'en', 'Latn', 'kokoro', {}, 'English')]
  .concat(...Object.entries(ROWS).map(([g, rows]) => rows.map(r => make(...r.slice(0, 5), r[5], g))));
export const LANGUAGE_GROUPS = ['English', ...Object.keys(ROWS)];

const byName = new Map();
for (const l of LANGUAGES) for (const k of [l.name, l.native, l.code, l.name.replace(/\s*\(.*\)/, '')]) {
  const key = k.toLowerCase();
  if (!byName.has(key)) byName.set(key, l);
}
byName.set('mandarin', byName.get('chinese (mandarin)'));
byName.set('chinese', byName.get('chinese (mandarin)'));
byName.set('tagalog', byName.get('filipino (tagalog)'));
byName.set('farsi', byName.get('persian'));
byName.set('twi', byName.get('akan (twi)'));
byName.set('kurdish', byName.get('kurdish (kurmanji)'));

// The table entry for a language name, native name or code (case-insensitive).
export const findLanguage = lang => byName.get(String(lang || '').trim().toLowerCase()) || null;
export const langInfo = lang => findLanguage(lang) || LANGUAGES[0];
export const languageNames = () => LANGUAGES.map(l => l.name);
export const whisperCode = lang => findLanguage(lang)?.whisper ?? null;
export const isRTL = lang => !!findLanguage(lang)?.rtl;

// <option>s for a language <select>, grouped by region, the value being the English name.
export function languageOptionsHTML(selected = 'English', skip = null) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const opt = l => `<option value="${esc(l.name)}"${l.name === selected ? ' selected' : ''}>${esc(l.name === l.native ? l.name : `${l.name} · ${l.native}`)}</option>`;
  return LANGUAGE_GROUPS.map(g => {
    const list = LANGUAGES.filter(l => l.group === g && l.name !== skip);
    if (!list.length) return '';
    return g === 'English' ? list.map(opt).join('') : `<optgroup label="${esc(g)}">${list.map(opt).join('')}</optgroup>`;
  }).join('');
}

// How the writer is told which language to use: the original 13 keep their exact wording.
export function writeIn(lang) {
  const name = String(lang || 'English');
  if (ORIGINAL.has(name)) return `${name}${name !== 'English' ? ' (native script)' : ''}`;
  const l = findLanguage(name);
  if (!l) return `${name} (native script)`;
  return `${l.name} (${l.native}), written in ${l.scriptName} script${l.script === 'Latn' ? ' with all its accents and special letters' : ''}`;
}

// ---------------- text helpers (any script) ----------------
// Scripts written without spaces between words: words come from the browser's segmenter.
const NOSPACE = /[฀-໿က-႟ក-៿぀-ヿ㐀-鿿豈-﫿]/;
const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHARS = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿऀ-෿฀-໿က-႟Ⴀ-ჿក-៿぀-鿿가-힯]/;
// Right-to-left text (Arabic, Hebrew, Urdu, Persian, Dhivehi…): judged by its first strong letter.
export function isRTLText(text) {
  for (const ch of String(text || '')) {
    if (RTL_CHARS.test(ch)) return true;
    if (LTR_CHARS.test(ch)) return false;
  }
  return false;
}
const segLocale = s => /[぀-ヿ]/.test(s) ? 'ja' : /[㐀-鿿豈-﫿]/.test(s) ? 'zh' : /[฀-๿]/.test(s) ? 'th'
  : /[຀-໿]/.test(s) ? 'lo' : /[ក-៿]/.test(s) ? 'km' : /[က-႟]/.test(s) ? 'my' : 'en';
const segmenters = new Map();
// Words of a caption or title. Spaced scripts split on spaces exactly as before; for
// Chinese, Japanese, Thai, Lao, Khmer and Burmese each word is a segment, punctuation stays
// on the word before it, and a real space is kept at the end of its word. spaced tells the
// caller whether to draw a space between words.
export function splitWords(text) {
  const s = String(text || '').trim();
  if (!NOSPACE.test(s) || typeof Intl === 'undefined' || !Intl.Segmenter) return { words: s.split(/\s+/).filter(Boolean), spaced: true };
  const loc = segLocale(s);
  if (!segmenters.has(loc)) segmenters.set(loc, new Intl.Segmenter(loc, { granularity: 'word' }));
  const words = [];
  for (const { segment, isWordLike } of segmenters.get(loc).segment(s)) {
    if (/^\s+$/.test(segment)) { if (words.length) words[words.length - 1] += ' '; continue; }
    if (!isWordLike && words.length && !/\s$/.test(words[words.length - 1]) && !/^[「『（(“"《【]/.test(segment)) words[words.length - 1] += segment;
    else words.push(segment);
  }
  return { words: words.map(w => w.replace(/\s+$/, ' ')), spaced: false };
}
// Word count in any script (a spoken line's length).
export const wordCount = text => splitWords(text).words.filter(w => /[\p{L}\p{N}]/u.test(w)).length;
// Sentences, for every script's full stop: . ! ? । ॥ 。！？ ؟ ۔ ። ፧ ။ ། ։
export const SENTENCE_END = '.!?।॥。！？؟۔።፧။།։';
export function sentences(text) {
  const rx = new RegExp(`[^${SENTENCE_END}]+[${SENTENCE_END}]+["'”’»」』)]*\\s*|[^${SENTENCE_END}]+$`, 'g');
  return String(text || '').match(rx) || [];
}

// ---------------- fonts ----------------
// The Noto font for a language's script, from Google Fonts, so canvas captions draw real
// letters (the browser shapes Arabic, Indic and other complex scripts itself). Pass the
// film's text: big CJK fonts come in slices, and only the slices that text needs load.
const fontLinks = new Map();
function addFontCSS(family) {
  if (fontLinks.has(family)) return fontLinks.get(family);
  const p = new Promise(resolve => {
    if (typeof document === 'undefined') return resolve();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@400;700&display=swap`;
    link.dataset.vfFont = family;
    link.onload = link.onerror = () => resolve();
    document.head.appendChild(link);
  });
  fontLinks.set(family, p);
  return p;
}
export async function ensureScriptFont(lang, text = '') {
  if (typeof document === 'undefined' || !document.fonts) return;
  const l = findLanguage(lang);
  const families = [l?.font, scriptFontOf(text)].filter(Boolean);
  await Promise.all([...new Set(families)].map(addFontCSS));
  const sample = (String(text || '') + ' ' + (l?.native || '')).slice(0, 20000) || 'Aa';
  const faces = [...new Set(['Inter', ...families])];
  try {
    await Promise.race([
      Promise.all(faces.flatMap(f => ['400', '700', '800'].map(w => document.fonts.load(`${w} 40px "${f}"`, sample)))),
      new Promise(r => setTimeout(r, 15000)) // a slow font must not stop the render
    ]);
  } catch (e) { console.warn('font load', e); }
}
// A text in another script than the film's (a title typed in Arabic, say) gets its font too.
function scriptFontOf(text) {
  const s = String(text || '');
  for (const [code, [, font]] of Object.entries(SCRIPTS)) if (font && SCRIPT_TEST[code]?.test(s)) return font;
  return null;
}
const SCRIPT_TEST = {
  Arab: /[؀-ۿݐ-ݿ]/, Hebr: /[֐-׿]/, Thaa: /[ހ-޿]/, Beng: /[ঀ-৿]/, Guru: /[਀-੿]/,
  Gujr: /[઀-૿]/, Orya: /[଀-୿]/, Taml: /[஀-௿]/, Telu: /[ఀ-౿]/, Knda: /[ಀ-೿]/, Mlym: /[ഀ-ൿ]/,
  Sinh: /[඀-෿]/, Thai: /[฀-๿]/, Laoo: /[຀-໿]/, Tibt: /[ༀ-࿿]/, Mymr: /[က-႟]/, Geor: /[Ⴀ-ჿ]/,
  Ethi: /[ሀ-᎟]/, Khmr: /[ក-៿]/, Armn: /[԰-֏]/, Kore: /[가-힯ᄀ-ᇿ]/, Jpan: /[぀-ヿ]/, Hans: /[㐀-鿿]/
};
// Font stacks for the renderer: the script's Noto font after the design font.
export function captionFont(lang, lead = '"Inter"') {
  const f = findLanguage(lang)?.font;
  return [lead, f && `"${f}"`, '"Noto Sans Devanagari"', 'system-ui', 'sans-serif'].filter(Boolean).join(', ');
}
export const titleFont = lang => captionFont(lang, 'Cinzel').replace('system-ui, sans-serif', 'serif');

// ---------------- voices and their licences ----------------
// Piper voices in use, from rhasspy/piper-voices (pinned revision e7229f7d), each checked
// against its MODEL_CARD on 2026-11-06: only licences that allow commercial use.
// voice -> [gender m/f, display name, licence, training data (credit), download MB]
// Left out on purpose (non-commercial, research-only or no stated licence): ar_JO-kareem,
// he_IL-saspeech, sw_CD-lanfrica, tr_TR-dfki, th_TH-tsync2, ko_KR-kss, ku_TR-berfin_renas,
// id_ID-news_tts, lb_LU-marylux, sr_RS-serbski_institut, el_GR-joy, ru_RU-irina, ru_RU-ruslan,
// vi_VN-vivos, vi_VN-25hours_single, de_DE-pavoque, the M-AILABS German voices, ka_GE-natia,
// lt_LT-ingute, sv_SE-lisa, cy_GB-gwryw_gogleddol.
export const PIPER_VOICES = {
  'de_DE-thorsten-medium': ['m', 'Thorsten', 'CC0-1.0', 'Thorsten-Voice dataset, Thorsten Müller', 63],
  'de_DE-kerstin-low': ['f', 'Kerstin', 'CC0-1.0', 'rhasspy/dataset-voice-kerstin', 63],
  'ru_RU-dmitri-medium': ['m', 'Dmitri', 'CC0-1.0', 'OHF-Voice/voice-datasets', 63],
  'ru_RU-denis-medium': ['m', 'Denis', 'CC0-1.0', 'OHF-Voice/voice-datasets', 63],
  'uk_UA-oleksa-high': ['m', 'Oleksa', 'Apache-2.0', 'egorsmkv/ukrainian-tts-datasets', 114],
  'uk_UA-tetiana-high': ['f', 'Tetiana', 'Apache-2.0', 'egorsmkv/ukrainian-tts-datasets', 114],
  'pl_PL-darkman-medium': ['m', 'Darkman', 'CC0-1.0', 'OHF-Voice/voice-datasets', 63],
  'pl_PL-gosia-medium': ['f', 'Gosia', 'CC0-1.0', 'OHF-Voice/voice-datasets', 63],
  'nl_NL-pim-medium': ['m', 'Pim', 'CC0-1.0', 'OHF-Voice/voice-datasets', 64],
  'nl_BE-nathalie-medium': ['f', 'Nathalie (Flemish)', 'CC0-1.0', 'rhasspy/dataset-voice-nathalie', 63],
  'ro_RO-mihai-medium': ['m', 'Mihai', 'CC0-1.0', 'OHF-Voice/voice-datasets', 63],
  'el_GR-rapunzelina-medium': ['f', 'Rapunzelina', 'CC0-1.0', 'Greek Single Speaker Speech Dataset (Kaggle, bryanpark)', 63],
  'hu_HU-imre-medium': ['m', 'Imre', 'CC0-1.0', 'OHF-Voice/voice-datasets', 63],
  'hu_HU-anna-medium': ['f', 'Anna', 'CC0-1.0', 'OHF-Voice/voice-datasets', 63],
  'sv_SE-nst-medium': ['m', 'NST', 'CC0-1.0', 'NST Swedish, Språkbanken (National Library of Norway)', 63],
  'sv_SE-alma-medium': ['f', 'Alma', 'CC-BY-4.0', 'NST Swedish, Språkbanken (National Library of Norway); voice by yeagersthlm', 63],
  'fi_FI-harri-medium': ['m', 'Harri', 'CC0-1.0', 'Finnish Single Speaker Speech Dataset (Kaggle, bryanpark)', 63],
  'bg_BG-dimitar-medium': ['m', 'Dimitar', 'CC0-1.0', 'OHF-Voice/voice-datasets', 63],
  'lv_LV-aivars-medium': ['m', 'Aivars', 'CC0-1.0', 'RaivisDejus/Piper-lv_LV-Aivars-medium', 64],
  'is_IS-steinn-medium': ['m', 'Steinn', 'CC-BY-4.0', 'Talrómur, CLARIN-IS (hdl 20.500.12537/104)', 76],
  'is_IS-ugla-medium': ['f', 'Ugla', 'CC-BY-4.0', 'Talrómur, CLARIN-IS (hdl 20.500.12537/104)', 76],
  'cy_GB-bu_tts-medium#gwryw-gogledd-pro': ['m', 'North Wales male', 'CC-BY-4.0', 'BU-TTS, techiaith, Bangor University', 77],
  'cy_GB-bu_tts-medium#benyw-gogledd-pro': ['f', 'North Wales female', 'CC-BY-4.0', 'BU-TTS, techiaith, Bangor University', 77],
  'eu_ES-antton-medium': ['m', 'Antton', 'CC-BY-4.0', 'itzune/antton-dataset', 64],
  'eu_ES-maider-medium': ['f', 'Maider', 'CC-BY-4.0', 'itzune/maider-dataset', 64],
  'ca_ES-upc_pau-x_low': ['m', 'Pau', 'CC-BY-SA-3.0-ES', 'UPC Festcat TTS corpora (Universitat Politècnica de Catalunya)', 28],
  'ca_ES-upc_ona-medium': ['f', 'Ona', 'CC-BY-SA-3.0-ES', 'UPC Festcat TTS corpora (Universitat Politècnica de Catalunya)', 63],
  'sq_AL-edon-medium': ['m', 'Edon', 'CC0-1.0', 'edonseki/folsh.ai', 64],
  'ur_PK-fasih-medium': ['m', 'Fasih', 'MIT', 'Urdu recordings by Muhammad Noman', 65],
  'ur_PK-aegis_female-medium': ['f', 'Aegis', 'MIT', 'ur_PK-aegis_female voice (Piper)', 64],
  'vi_VN-vais1000-medium': ['f', 'VAIS', 'CC-BY-4.0', 'VAIS-1000 Vietnamese speech synthesis corpus (IEEE DataPort)', 63],
  'fa_IR-amir-medium': ['m', 'Amir', 'CC0-1.0', 'Datacula TTS databases', 64],
  'fa_IR-ganji-medium': ['m', 'Ganji', 'CC0-1.0', 'Datacula TTS databases', 64],
  'kk_KZ-issai-high#ISSAI_KazakhTTS_M1_Iseke': ['m', 'Iseke', 'CC-BY-4.0', 'KazakhTTS, ISSAI (Nazarbayev University)', 128],
  'kk_KZ-issai-high#ISSAI_KazakhTTS_F1_Raya': ['f', 'Raya', 'CC-BY-4.0', 'KazakhTTS, ISSAI (Nazarbayev University)', 128],
  'hy_AM-gor-medium': ['m', 'Gor', 'GPL-2.0', 'davit312/piper-TTS-Armenian', 64],
  'cs_CZ-jirka-medium': ['m', 'Jirka', 'CC0-1.0', 'OHF-Voice/voice-datasets', 63],
  'cs_CZ-kasandra-medium': ['f', 'Kasandra', 'CC-BY-4.0', 'ondrazarici/Cassandra-Kasandra-piper-cz', 64],
  'sk_SK-lili-medium': ['f', 'Lili', 'CC0-1.0', 'OHF-Voice/voice-datasets', 63],
  'sl_SI-artur-medium': ['m', 'Artur', 'CC-BY-4.0', 'Artur studio TTS (ppisljar)', 63],
  'et_EE-news-medium#Albert': ['m', 'Albert', 'CC-BY-4.0', 'Speech corpus of Estonian news sentences (University of Tartu)', 77],
  'et_EE-news-medium#Mari': ['f', 'Mari', 'CC-BY-4.0', 'Speech corpus of Estonian news sentences (University of Tartu)', 77],
  'da_DK-talesyntese-medium': ['m', 'Talesyntese', 'CC0-1.0', 'NB Tale, Språkbanken (National Library of Norway)', 63],
  'no_NO-nvcc-medium#MNN': ['m', 'NVCC male', 'CC0-1.0', 'NVCC, Språkbanken (National Library of Norway)', 77],
  'no_NO-nvcc-medium#KNN': ['f', 'NVCC female', 'CC0-1.0', 'NVCC, Språkbanken (National Library of Norway)', 77],
  'ne_NP-chitwan-medium': ['m', 'Chitwan', 'CC0-1.0', 'OHF-Voice/voice-datasets', 63]
};

// Credits for the film's end card or the About page: the software and voices a film used.
export function voiceCredits(lang) {
  const l = findLanguage(lang);
  const out = [];
  if (!l || l.engine === 'kokoro') out.push('Voice: Kokoro-82M by hexgrad (Apache-2.0)');
  if (l?.engine === 'indic') out.push('Voice: SYSPIN TTS voices (CC BY 4.0) / AI4Bharat Indic-TTS (MIT)');
  for (const v of l?.piper || []) {
    const p = PIPER_VOICES[v];
    if (p) out.push(`Voice: Piper "${p[1]}" (${p[2]}), trained on ${p[3]}`);
  }
  if (l && (l.piper || l.approx || ['e', 'f', 'i', 'p'].includes(l.kokoro))) out.push('Phonemes: eSpeak NG (GPL-3.0), source https://github.com/espeak-ng/espeak-ng');
  return out;
}
