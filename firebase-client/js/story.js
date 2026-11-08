// Story writer, character designer and prompt builder.
import { chat, parseJSON, Unsafe } from './ai.js?v=63';

import { ORIGINAL_RULES } from './copyright.js?v=63';
import { writeIn, findLanguage, sentences, wordCount } from './langs.js?v=63';
import { ensureFields, outfitPrompt, outfitForShot, personWords } from './outfits.js?v=63';

export const SCENE_COUNT = { shorts: 5, short: 6, medium: 10, long: 16, film5: 32, film10: 64, film15: 96 };
// most characters a film may have: long films carry a bigger cast
export const maxCast = n => (n > 16 ? 6 : 4);
export const MOODS = ['epic', 'adventure', 'emotional', 'mysterious', 'dark', 'romantic', 'joyful', 'scifi'];
const CAMERAS = ['push-in', 'pan-right', 'pull-out', 'pan-left', 'tilt-up', 'drift', 'push-in', 'tilt-down'];

export const STYLES = {
  cinematic: 'Real photograph: a live-action film still shot on an ARRI Alexa camera with a 35mm lens, real people with natural skin texture, real location, natural and practical light, shallow depth of field, rich cinematic colour grade with natural skin tones. Not a drawing, cartoon, illustration, painting, anime or 3D render; any magic is a practical on-set effect (real fire, smoke, light, costume), no fantasy sky or digital effects',
  pixar: 'high-end 3D animated feature film still, expressive stylised characters, soft global illumination, vibrant colours, detailed render',
  anime: 'anime feature film still, hand-painted backgrounds, clean cel shading, cinematic lighting, highly detailed',
  painterly: 'digital concept art painting, epic matte painting, visible brush strokes, cinematic composition, atmospheric light',
  watercolor: 'watercolour storybook illustration, soft washes, paper texture, gentle warm light, whimsical',
  noir: 'black and white film noir still, high contrast, hard shadows, 1940s cinema, moody',
  indian: 'Indian miniature painting style, intricate ornament, gold leaf accents, rich mineral pigments, flat perspective'
};
const NEG = 'no text, no captions, no watermark, no logo, no frame border, no signboards or banners with writing';
// Live-action pictures must look filmed: words that ask for a drawn look are taken out of
// the writer's descriptions (a "storybook" village or a "cartoon" monkey came out drawn).
export const isReal = p => !p.style || p.style === 'cinematic' || p.style === 'noir';
const DRAWN = /\b(cartoon(?:ish|y)?|animated|animation|illustrat\w*|storybook|story-book|drawn|drawing|sketch(?:ed|y)?|painted|painting|painterly|anime|manga|chibi|whimsical|stylis\w*|styliz\w*|cel[- ]shaded|3d render\w*|cgi|clipart|comic)\b/gi;
// Live-action shots must be filmable: fantasy described as glowing creatures or a red
// "magic" sky came out as digital art. Magic stays, as a film crew would shoot it.
export const FILMABLE = ' Every shot description must be something a film crew could shoot for real on location or on a set: real people in real costumes, real places, natural sky, weather and light. Show anything magical or divine the way a live-action film does it with practical effects (firelight, smoke, mist, a shaft of light, flower petals, an actor in costume), never as glowing creatures, wings, energy, tendrils or digital art.';
const realText = (p, s) => (isReal(p) ? String(s || '').replace(DRAWN, 'real') : String(s || ''));
// Languages beyond the original 13 get a reminder to write the way native speakers
// talk, in their own script (the writer otherwise drifts into English or romanisation).
const ORIGINAL_LANGS = ['English', 'Hindi', 'Bhojpuri', 'Bengali', 'Marathi', 'Telugu', 'Kannada', 'Gujarati', 'Maithili', 'Magahi', 'Chhattisgarhi', 'Tamil', 'Malayalam'];
function worldNote(lang) {
  if (ORIGINAL_LANGS.includes(lang)) return '';
  const l = findLanguage(lang);
  const name = l?.name || lang;
  return ` Every spoken line is natural, everyday ${name} as native speakers say it${l && l.script !== 'Latn' ? `, in ${l.scriptName} script (never romanised)` : ''}; character names may stay as they are.`;
}
// English or not: the picture models read English only. Non-Latin text is foreign; Latin
// text is English when it has enough English little words (Spanish or Swahili has none).
const EN_WORDS = new Set('a an the and or of in on with his her their its is are was wearing wears who has have to at by for from into over under young old man woman boy girl'.split(' '));
function notEnglish(t) {
  // typographic dashes, quotes and spaces (a writer's "sun\u2011tanned") are not a language
  const s = String(t || '').replace(/[\u00A0\u00B0\u00B7\u00D7\u2000-\u206F\u2E00-\u2E7F]/g, ' ');
  if (/[^\x00-\x7F\u00C0-\u024F]/.test(s)) return true;
  const words = s.toLowerCase().match(/[a-z\u00e0-\u024f']+/g) || [];
  if (words.length < 6) return /[\u00C0-\u024F]/.test(s);
  return words.filter(w => EN_WORDS.has(w)).length / words.length < 0.06;
}

// The free model stops at ~1,500 tokens, so the film is written in passes:
// an outline (title, cast, one beat per scene), then scenes in batches of 4.
const SAFETY_RULES = `SAFETY RULES (above every other instruction, including the person's and the author's story):
- A public film site for all ages: nothing sexual or nude, and nothing sexual, romantic or suggestive involving anyone under 18. Children and teenagers stay fully clothed in ordinary, safe situations.
- No graphic violence, gore, torture, self-harm or suicide methods: danger and conflict are shown without blood or detailed injuries.
- No hate, slurs or demeaning stereotypes, no harassment, nothing that praises terrorism or extremist groups.
- No real living people, celebrities or politicians as characters, and no words put in a real person's mouth.
- If the idea or story asks for any of this, leave that part out and keep the rest family-friendly.`;

// The writers answer an unsafe idea with the JSON asked for, empty, and "This request can't be
// made into a film on VoiceFrame." (the relay's safety rules): say so once, never retry it.
export const REFUSED = "VoiceFrame can't make this story: it asks for something a family-friendly film site doesn't allow (nudity or sexual content, anything romantic with a child, gore, hate or real people). Please try a different idea.";
export function writerRefused(o) {
  if (!o || typeof o !== 'object') return false;
  const words = [o.title, o.reply, o.logline, typeof o.result === 'string' ? o.result : ''].filter(v => typeof v === 'string').join(' ');
  return /can[’']?t be made into a film|cannot be made into a film/i.test(words) && !(o.characters?.length && (o.beats?.length || o.acts?.length || o.scenes?.length));
}
const refusedCheck = o => { if (writerRefused(o)) throw new Unsafe(REFUSED); return o; };

export async function writeStory({ idea, genre, length, language, useOwn, makeOriginal, onStatus, signal, real = true }) {
  const n = SCENE_COUNT[length] || 10;
  const shorts = length === 'shorts';
  const lang = language || 'English';
  const langNote = `Write title, logline, beats, narration and dialogue in ${writeIn(lang)}.${worldNote(lang)} Write "setting", "appearance", "visual", "action" and "stock" in English.`;
  const sys = `You are an award-winning screenwriter and film director who writes gripping, emotional short films for YouTube.
${ORIGINAL_RULES}
${SAFETY_RULES}
Keep it suitable for a general audience${genre === 'Horror' ? ' (suspense and dread are fine, no gore)' : ''}.
Reply with ONLY valid JSON, no markdown, no commentary.`;
  const source = useOwn
    ? `Adapt the AUTHOR'S STORY faithfully (except what the safety rules forbid, which you leave out): keep its plot, events, names and tone${makeOriginal ? ' (but rename copyrighted characters or places to original ones)' : ''}.

AUTHOR'S STORY:
"""${idea.slice(0, 6000)}"""`
    : `Idea: """${idea}"""${makeOriginal ? '\n(The idea mentions existing franchises or brands. Replace them with original equivalents.)' : ''}`;

  // Long films (5-10 min) are planned as acts of ~6 scenes; shorter ones beat by beat.
  const longForm = n > 16;
  const nActs = longForm ? Math.ceil(n / 6) : 0;
  const minutes = Math.round(n / 6);

  onStatus?.('Outlining the story and cast…', 0.06);
  const outline = await askJSON(sys, `${source}

${shorts
    ? `Plan a viral vertical YouTube Short (15-20 seconds) in exactly ${n} quick shots of about 3 seconds each, like a live-action comedy sketch: an instant hook in shot 1, a funny or cute exchange between the characters, and a punchline or sweet surprise in the last shot. Photorealistic, everyday setting, expressive faces. Max 3 characters.`
    : longForm
      ? `Plan a complete original ${minutes}-minute character-driven film for YouTube in exactly ${nActs} acts (about 6 scenes each, ${n} scenes in total). Lots of on-screen dialogue between the characters, like a live-action web series episode: a strong hook, setbacks and comic or emotional moments, a turning point, a climax and a satisfying ending.`
      : `Plan a complete original short film in exactly ${n} scenes: a hook in scene 1, rising tension, a turning point, a climax and a satisfying ending with an emotional payoff.`}
Genre: ${genre === 'auto' ? 'choose the best fit' : genre}. ${langNote}
Max ${shorts ? 3 : maxCast(n)} characters, each with a clearly different look. Each "appearance" is 25-40 words and starts with the person's nationality or ethnicity (e.g. "Indian"): age, face, hair, skin tone, build, outfit with colours, one distinctive feature, so a casting director and costume team can match them the same in every scene.

JSON: {"title":"","logline":"one gripping sentence","genre":"","mood":"${MOODS.join('|')}",
"setting":"time period, place and visual world in one sentence",
"characters":[{"id":"c1","name":"","role":"protagonist|ally|antagonist|mentor|other","gender":"male|female","age":"child|teen|adult|elder","ageYears":30,"outfit":"their main outfit in a few English words, true to the era and place, ordinary and fully clothed for anyone under 18","appearance":"","personality":"under 12 words"}],
"hashtags":["6 hashtags without #"],
${longForm
    ? `"acts":["exactly ${nActs} items: 2-3 sentences each on what happens in that act"]}`
    : `"beats":["exactly ${n} items: one sentence of what happens in each scene"]}`}`, { onStatus, signal, label: 'Outlining the story and cast…', maxTokens: lang === 'English' ? 2500 : 0 });
  const plan = longForm ? outline.acts : outline.beats;
  if (!Array.isArray(outline.characters) || !Array.isArray(plan) || !plan.length) throw new Error('The story outline came back incomplete. Please try again.');

  const cast = outline.characters.slice(0, maxCast(n)).map(c => `${c.id} = ${c.name} (${c.role}, ${c.age} ${c.gender})`).join('; ');
  const style = shorts
    ? `This is a YouTube Short: NO narrator. "narration" is an empty string in every shot.
Every shot has exactly 1 line of dialogue spoken on camera by the character in focus: natural, funny or cute, 3-8 words.
"visual" describes one vertical 9:16 photoreal shot with the speaking character's face clearly visible, their action and expression.`
    : longForm
      ? `The characters carry the story by talking on camera: every scene has 2-4 lines of dialogue (8-15 words each) between the characters in the shot (each line becomes its own ~4-second shot, so this sets the film's length).
"narration" is 1 short sentence (under 20 words) only when the story needs a bridge, otherwise an empty string.`
      : `Narration: 2-3 vivid sentences (30-45 words), told by a narrator, present tense${useOwn ? ", reusing the author's sentences where possible" : ''}.
Give about half the scenes 1-2 lines of character dialogue (under 15 words each); others get an empty list.`;
  const sceneJSON = `JSON: {"scenes":[{"title":"","narration":"","dialogue":[{"character":"c1","line":""}],"characters":["c1"],
"visual":"what the camera sees in ONE continuous shot (never two shots, no 'followed by'): subject caught in the middle of one clear physical action (walking, working with their hands, handing something over, turning, sitting down), eyes on their work or on each other, never looking into the lens or posing for the camera; camera angle (side, three-quarter, over-the-shoulder, low or high angle, wide, close or a macro of hands at work), setting, lighting (25-40 words)${real ? FILMABLE : ''}",
"action":"in English: what each character in the shot physically does during it, in order, acting out this scene's narration and dialogue (whoever speaks a line is shown talking), characters named by their look not their name, 20-40 words, e.g. 'Grandpa tugs the string, it tangles round his arm, he stumbles back; the girl points and laughs'",
"stock":"2-3 word photo search for this scene's setting, e.g. misty forest",
"shot":"wide|medium|close-up|over-the-shoulder|macro|low-angle|high-angle|aerial","camera":"push-in|pull-out|pan-left|pan-right|tilt-up|tilt-down|track-left|track-right|orbit|handheld|drift",
"ambience":"none|rain|storm|wind|ocean|river|fire|forest|birds|city|traffic|crowd|festival|temple|kitchen|clock|night|cave"}]}`;
  const head = `Film: "${outline.title}". ${outline.logline}
Setting: ${outline.setting}
Cast: ${cast}`;

  // Batches: long films one act per call, short films 4 scenes per call.
  const batches = [];
  if (longForm) {
    const acts = plan.slice(0, nActs);
    while (acts.length < nActs) acts.push('The story continues towards its ending.');
    let a = 0;
    acts.forEach((act, k) => {
      const count = Math.round((k + 1) * n / nActs) - a;
      batches.push({ a, b: a + count, label: `Writing act ${k + 1} of ${nActs}…`, prompt: `${head}
Story map:
${acts.map((x, i) => `Act ${i + 1}: ${x}`).join('\n')}
${useOwn ? '\n' + source + '\n' : ''}
Write act ${k + 1} as exactly ${count} scenes (scenes ${a + 1}-${a + count} of ${n}). ${k === 0 ? 'Open with a hook.' : `Continue directly from act ${k}.`}${k === nActs - 1 ? ' End the film satisfyingly.' : ''} ${langNote}
${style}

${sceneJSON}` });
      a += count;
    });
  } else {
    const beats = plan.slice(0, n);
    while (beats.length < n) beats.push('Continue the story towards its ending.');
    for (let a = 0; a < n; a += 4) {
      const b = Math.min(n, a + 4);
      batches.push({ a, b, label: `Writing scenes ${a + 1}–${b} of ${n}…`, prompt: `${head}
All beats:
${beats.map((x, i) => `${i + 1}. ${x}`).join('\n')}
${useOwn ? '\n' + source + '\n' : ''}
Write scenes ${a + 1} to ${b} in full (${b - a} scenes). ${langNote}
${style}

${sceneJSON}` });
    }
  }

  // the relay's writers have no pacing limit, so batches run 4 at a time
  const parts = new Array(batches.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < batches.length) {
      const k = next++, bt = batches[k];
      onStatus?.(bt.label, 0.12 + 0.85 * done / batches.length);
      // (an English batch needs about 2,000 tokens; other scripts take more, so they keep the default)
      const part = await askJSON(sys, bt.prompt, { onStatus, signal, label: bt.label, maxTokens: lang === 'English' ? 3000 : 0 });
      const got = Array.isArray(part.scenes) ? part.scenes.slice(0, bt.b - bt.a) : [];
      if (!got.length) throw new Error('A batch of scenes came back empty. Please try again.');
      parts[k] = got;
      done++;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const scenes = parts.flat();
  const film = normalise({ ...outline, scenes }, n);
  // Shorts are carried by the characters' own lines; drop any narrator text the model added.
  if (shorts) film.scenes.forEach(s => { if (s.dialogue.length) s.narration = ''; });
  await englishLooks(film, { signal });
  return film;
}

// The picture and video models read English only. Writers sometimes describe the cast in
// the film's language anyway, so those descriptions are translated (one short call).
async function englishLooks(film, { signal }) {
  const foreign = notEnglish;
  const outfitText = c => String(c.outfit?.text || '');
  const todo = film.characters.filter(c => foreign(c.appearance) || (outfitText(c) && foreign(outfitText(c))));
  const place = foreign(film.setting);
  if (!todo.length && !place) return;
  try {
    const reply = await chat([
      { role: 'system', content: 'You translate character descriptions for a film crew. Reply with ONLY valid JSON.' },
      { role: 'user', content: `Translate into English for a film crew. Setting: ${film.setting}\nEach character's look keeps every detail (age, face, hair, skin tone, build, outfit and colours, distinctive feature), 25-40 words, starting with their nationality or ethnicity as the story implies (e.g. "Indian"), and true to their gender and age (no beard on a woman or a child).\nEach outfit: a few English words.\n${todo.map(c => `${c.id} (${c.age} ${c.gender}): ${c.appearance}${outfitText(c) ? ` | outfit: ${outfitText(c)}` : ''}`).join('\n')}\nJSON: {"setting":"","looks":[{"id":"c1","appearance":"","outfit":""}]}` }
    ], { signal });
    const j = parseJSON(reply);
    if (place && j.setting && !foreign(j.setting)) film.setting = String(j.setting).trim();
    for (const l of j.looks || []) {
      const c = todo.find(x => x.id === l.id);
      if (c && l.appearance && foreign(c.appearance) && !notEnglish(l.appearance)) c.appearance = String(l.appearance).trim();
      // the outfit too (and the wardrobe's copy of it)
      const was = c && outfitText(c);
      if (was && foreign(was) && l.outfit && !/[^\x00-\x7F\u00C0-\u024F\u2010-\u2027]/.test(l.outfit)) {
        const text = String(l.outfit).trim().slice(0, 160);
        c.outfit.text = text;
        for (const w of c.wardrobe || []) if (w.text === was) w.text = text;
      }
    }
  } catch (e) { if (signal?.aborted) throw e; console.warn('English looks', e); }
}

async function askJSON(sys, user, { onStatus, signal, label, maxTokens = 0 }) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const reply = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], {
      signal, maxTokens, onWait: sec => onStatus?.(sec ? `${label} (free writer busy, starting in ${sec}s)` : label)
    });
    let out;
    try { out = parseJSON(reply); } catch (e) { lastErr = e; console.warn('Story parse failed', e, reply); continue; }
    return refusedCheck(out);
  }
  throw new Error('The story writer returned something unreadable. Please try again. (' + (lastErr?.message || '') + ')');
}

function normalise(s, n) {
  const cleanId = x => String(x ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16);
  const chars = (Array.isArray(s.characters) ? s.characters : []).slice(0, maxCast(n)).map((c, i, all) => ({
    id: cleanId(c.id) && all.findIndex(o => cleanId(o.id) === cleanId(c.id)) === i ? cleanId(c.id) : 'c' + (i + 1), name: String(c.name || 'Character ' + (i + 1)),
    role: c.role || 'other', gender: /^f/i.test(c.gender) ? 'female' : 'male',
    age: ['child', 'teen', 'adult', 'elder'].includes(c.age) ? c.age : 'adult',
    appearance: String(c.appearance || ''), personality: String(c.personality || ''),
    // every character has an age in years, a gender and an outfit (from the writer, or read from their look)
    ...(Number.isFinite(+c.ageYears) && +c.ageYears > 0 ? { ageYears: Math.round(+c.ageYears) } : {}),
    ...(typeof c.outfit === 'string' && c.outfit.trim() ? { outfitWords: c.outfit.trim().slice(0, 160) } : {})
  })).map(c => {
    // the writer's class and number must agree: a "child" of 30 keeps the class's age
    if (c.ageYears && ({ child: c.ageYears >= 13, teen: c.ageYears < 13 || c.ageYears >= 18, elder: c.ageYears < 55 }[c.age])) delete c.ageYears;
    return ensureFields(c);
  });
  const ids = new Set(chars.map(c => c.id));
  const byName = Object.fromEntries(chars.map(c => [c.name.toLowerCase(), c.id]));
  const ref = x => ids.has(cleanId(x)) ? cleanId(x) : byName[String(x || '').toLowerCase()];
  let scenes = (Array.isArray(s.scenes) ? s.scenes : []).filter(x => x && (x.narration || x.visual));
  if (!scenes.length) throw new Error('No scenes');
  scenes = scenes.slice(0, Math.max(n + 2, 6)).map((x, i) => ({
    title: String(x.title || `Scene ${i + 1}`),
    narration: String(x.narration || '').trim(),
    dialogue: (Array.isArray(x.dialogue) ? x.dialogue : []).map(d => ({ character: ref(d.character), line: String(d.line || '').trim() }))
      .filter(d => d.character && d.line).slice(0, 4),
    characters: (Array.isArray(x.characters) ? x.characters : []).map(ref).filter(Boolean),
    visual: String(x.visual || x.narration || ''),
    action: String(x.action || '').trim(),
    stock: String(x.stock || '').trim() || String(x.visual || '').split(/\s+/).slice(0, 3).join(' '),
    shot: x.shot || 'wide',
    camera: CAMERAS.includes(x.camera) || ['pull-out', 'tilt-up', 'tilt-down', 'drift'].includes(x.camera) ? x.camera : CAMERAS[i % CAMERAS.length],
    ambience: x.ambience || 'none'
  }));
  // avoid the same move twice in a row: it reads as static
  scenes.forEach((sc, i) => { if (i && sc.camera === scenes[i - 1].camera) sc.camera = CAMERAS[(CAMERAS.indexOf(sc.camera) + 3) % CAMERAS.length]; });
  const mood = MOODS.includes(String(s.mood).toLowerCase()) ? String(s.mood).toLowerCase() : 'epic';
  return {
    title: String(s.title || 'Untitled'), logline: String(s.logline || ''), genre: String(s.genre || ''),
    mood, setting: String(s.setting || ''), characters: chars,
    story: String(s.story || scenes.map(x => [x.narration, ...x.dialogue.map(d => `${chars.find(c => c.id === d.character)?.name}: “${d.line}”`)].join('\n')).join('\n\n')),
    scenes, hashtags: (Array.isArray(s.hashtags) ? s.hashtags : []).map(String).slice(0, 10)
  };
}

const MODEST = 'everyone fully and modestly clothed, family-friendly';
// A character's outfit in a shot (their wardrobe pick for it, else their main outfit), as
// prompt words; the age gate is applied in outfitPrompt.
const charOutfit = (c, scene) => {
  let t = outfitPrompt(outfitForShot(c, scene), c);
  // words in another script would reach the painter as noise: its look already names the clothes
  if (/[^\x00-\x7F\u00C0-\u024F\u2010-\u2027]/.test(t)) t = t.split('; ').filter(x => !/[^\x00-\x7F\u00C0-\u024F\u2010-\u2027]/.test(x.replace(/^Outfit: /, ''))).join('; ').replace(/^(?!Outfit: )(.)/, 'Outfit: $1');
  return t && t !== 'Outfit: ' ? '. ' + t : '';
};

// A shot size as a camera crew would frame it (the painter reads "close-up shot" as a portrait).
const SHOT_WORDS = {
  wide: 'wide shot on a 24mm lens: the people small in their surroundings, the whole place and its everyday life visible',
  medium: 'medium shot on a 35mm lens, people seen from the waist up in their surroundings',
  'close-up': 'close-up on an 85mm lens, seen from the side or three-quarter, background softly out of focus',
  'over-the-shoulder': 'over-the-shoulder shot: the near person\'s shoulder and the back of their head blurred in the foreground, the other person facing them in focus',
  macro: 'macro insert shot on a 100mm macro lens: hands at work, food, tools or an animal fill the frame, faces out of frame or cut off, very shallow depth of field',
  'low-angle': 'low-angle shot from near the ground looking up at the action',
  'high-angle': 'high-angle shot looking down on the action',
  aerial: 'aerial shot from high above the place'
};
export const SHOT_SIZES = Object.keys(SHOT_WORDS);
const shotWords = (p, s) => (isReal(p) && SHOT_WORDS[s]) || `${s || 'medium'} shot`;
// people in a live-action picture are caught in the moment, like a documentary or a vlog
const CANDID = 'Candid moment, not a posed portrait: everyone is busy with what they are doing, eyes on their work, on what is in their hands or on each other; nobody looks into the lens; natural light, shallow depth of field, real textures';
export function scenePrompt(p, scene) {
  const cast = scene.characters.map(id => p.characters.find(c => c.id === id)).filter(Boolean)
    .map(c => `${c.name} (${personWords(c)}): ${realText(p, c.appearance)}${charOutfit(c, scene)}`).join('; ');
  return [STYLES[p.style] || STYLES.cinematic, shotWords(p, scene.shot), realText(p, scene.visual), isReal(p) && cast && CANDID,
    cast && `Characters (keep exactly this look) — ${cast}`, p.setting && `World: ${realText(p, p.setting)}`, MODEST, NEG].filter(Boolean).join('. ');
}

// The GPU painter (SDXL) reads 77 tokens per prompt, so the style comes first (cut off at
// the end it painted portraits like paintings), then the shot; its second encoder gets
// the cast's look and the world. "face" is how strongly the main character's portrait
// steers the picture: strong in a close-up, light in a wide or group shot (stronger made
// every shot a portrait and gave everyone in a group the same face).
const GPU_LOOK = {
  cinematic: 'real photograph, live-action film still, real people, natural skin texture, 35mm, natural light',
  pixar: '3D animated feature film still, stylised characters, soft global illumination, vibrant colours',
  anime: 'anime feature film still, cel shading, hand-painted background, vivid colours',
  painterly: 'digital concept art painting, cinematic composition, atmospheric light',
  watercolor: 'watercolour storybook illustration, soft washes, warm light',
  noir: 'black and white film noir still, high contrast, hard shadows',
  indian: 'Indian miniature painting style, intricate ornament, rich mineral pigments'
};
export function gpuPaintPrompt(p, scene) {
  const look = GPU_LOOK[p.style] || GPU_LOOK.cinematic;
  const cast = scene.characters.map(id => p.characters.find(c => c.id === id)).filter(Boolean);
  const close = /close|over-the-shoulder/.test(scene.shot || '');
  return {
    prompt: [look, `${scene.shot} shot`, realText(p, scene.visual)].filter(Boolean).join(', '),
    // a group comes out as copies of one face unless told otherwise (first: CLIP reads 77 tokens)
    prompt2: [cast.length > 1 && `${cast.length} different people, each with a clearly different face, age and clothes`,
      cast.map(c => `${personWords(c)}, ${realText(p, c.appearance)}${charOutfit(c, scene)}`).join('; '), realText(p, p.setting), look, 'fully clothed, no text'].filter(Boolean).join('. '),
    cast: cast.map(c => c.id),
    face: cast.length > 1 || scene.shot === 'macro' ? 0 : close ? 0.5 : 0.38
  };
}

// The casting director: a brief for every role, and which shots can be real stock footage.
// Only shots without a cast member are offered (stock people can't stay one person or speak).
export async function castFilm(film, { signal } = {}) {
  const cast = film.characters.map(c => ({ id: c.id, name: c.name, role: c.role, gender: c.gender, age: c.ageYears || c.age, look: String(c.appearance || '').slice(0, 200), ...(c.info ? { info: String(c.info).slice(0, 160) } : {}), ...(c.outfit ? { outfit: outfitPrompt(c.outfit, c).replace(/^Outfit: /, '').slice(0, 160) } : {}) }));
  const open = film.scenes.map((sc, i) => ({ n: i + 1, visual: String(sc.visual || '').slice(0, 200), speaks: (sc.dialogue || []).some(d => d.line), people: (sc.characters || []).length }))
    .filter(s => !s.people && !s.speaks && !PEOPLE.test(s.visual)).slice(0, 40);
  const reply = await chat([
    { role: 'system', content: 'You are the casting director and stock-footage researcher of a live-action film. Reply with ONLY valid JSON.' },
    { role: 'user', content: `Film: ${film.title}. ${film.logline || ''}
World: ${film.setting || ''}
Cast: ${JSON.stringify(cast)}
Shots with no cast member: ${JSON.stringify(open)}
1. For every cast member write a casting brief (20-35 words): age, gender, region or ethnicity, era, clothing, build, mood. Main and speaking roles are "generated" (a photo-real portrait of a person who does not exist, used in every shot).
2. List the background people the film needs (crowds, villagers, soldiers, priests in the back) as "extras" with a short brief; they come from real stock video.
3. If a listed shot names or shows a real, well-known place or monument (e.g. Taj Mahal, Red Fort, Qutub Minar, Varanasi ghats, Kamakhya temple), choose "stock" and put the place's name in the queries: real footage of it beats a painting. Otherwise, for each listed shot choose "stock" if real stock video could show it (a place, sky, weather, rain, fire, diyas, a river, animals, hands, a crowd or extras), else "generated". For "stock" give 2-3 English search queries for a stock video site (2-4 concrete words each, e.g. "oil lamps temple night", "monsoon rain village street"), the era and place the clip must match, and the modern things it must not show.
JSON: {"roles":[{"id":"c1","brief":"","source":"generated"}],"extras":[{"brief":"","source":"stock"}],"shots":[{"n":1,"source":"stock","queries":["",""],"era":"","avoid":[""]}]}` }
  ], { signal, temperature: 0.4 });
  const j = parseJSON(reply);
  const roles = (Array.isArray(j.roles) ? j.roles : []).filter(r => film.characters.some(c => c.id === r.id))
    .map(r => ({ id: r.id, brief: String(r.brief || '').slice(0, 300), source: 'generated' }));
  const extras = (Array.isArray(j.extras) ? j.extras : []).map(e => ({ brief: String(e.brief || '').slice(0, 200), source: 'stock' })).slice(0, 8);
  const ok = new Set(open.map(s => s.n));
  const shots = (Array.isArray(j.shots) ? j.shots : []).filter(s => ok.has(+s.n) && s.source === 'stock')
    .map(s => ({ n: +s.n, queries: (Array.isArray(s.queries) ? s.queries : []).map(q => String(q).replace(/[^\p{L}\p{N} ,'-]/gu, ' ').trim().slice(0, 60)).filter(Boolean).slice(0, 3),
      era: String(s.era || '').slice(0, 80), avoid: (Array.isArray(s.avoid) ? s.avoid : []).map(String).slice(0, 8) }))
    .filter(s => s.queries.length);
  return { roles, extras, shots };
}

export function gpuPortraitPrompt(p, c) {
  const look = GPU_LOOK[p.style] || GPU_LOOK.cinematic;
  return {
    prompt: `${look}, head and shoulders portrait looking at camera, ${personWords(c)}, ${realText(p, c.appearance)}`,
    prompt2: [realText(p, c.appearance), outfitPrompt(c.outfit, c), 'plain softly lit background', look, 'fully clothed, no text'].filter(Boolean).join('. ')
  };
}

export function portraitPrompt(p, c) {
  // "character design" asks for concept art: a live-action cast gets a casting photo
  const kind = isReal(p) ? 'casting headshot photograph of a real person, unretouched natural skin texture with pores and fine lines (no airbrushing, no smooth AI skin), head and shoulders, looking at camera, softly lit plain dark backdrop'
    : 'character design portrait, head and shoulders, looking at camera, neutral dark backdrop, studio rim light';
  return [STYLES[p.style] || STYLES.cinematic, kind,
    `${c.name}, ${personWords(c)}, ${realText(p, c.appearance)}`, outfitPrompt(c.outfit, c), c.info && `Character: ${String(c.info).slice(0, 200).replace(/[.\s]+$/, '')}`, `personality: ${c.personality}`, p.setting && `World: ${realText(p, p.setting)}`, MODEST, NEG].filter(Boolean).join('. ');
}

// Rewrite one scene's narration (used by the per-scene "rewrite" button).
// Breaks a story's scenes into shots, one per spoken line, like a filmed drama: each
// dialogue line is a shot of its speaker facing the camera (mouth visible), and the
// narration becomes shots that show what each sentence describes. A shot keeps its
// scene's place, light and sound; its picture, action and length follow its line.
function splitNarration(text) {
  const list = sentences(text);
  const joiner = /[\u3040-\u30ff\u3400-\u9fff]/.test(String(text || '')) ? '' : ' ';
  const out = [];
  let cur = '';
  for (const s of list.map(x => x.trim()).filter(Boolean)) {
    if (cur && wordCount(cur + joiner + s) > 20) { out.push(cur); cur = ''; }
    cur = cur ? cur + joiner + s : s;
  }
  if (cur) out.push(cur);
  return out;
}

// a shot description that shows one particular person (the planner sometimes leaves the
// cast out of one); crowds and extras are fine for stock footage
const PEOPLE = /\b(he|she|his|her|him|man|woman|boy|girl|child|kid|elder|elderly|old (man|woman)|grandfather|grandmother|king|queen|priest|boatman|warrior|soldier|mother|father|son|daughter)\b/i;
export async function breakIntoShots(story, { signal, onStatus, real = true } = {}) {
  const lines = [];
  story.scenes.forEach((sc, i) => {
    for (const text of splitNarration(sc.narration)) lines.push({ scene: i, narration: text });
    for (const d of sc.dialogue || []) lines.push({ scene: i, dialogue: d });
  });
  if (!lines.length) return story.scenes;
  const name = id => story.characters.find(c => c.id === id)?.name || id;
  const cast = story.characters.map(c => `${c.id} = ${c.name}: ${c.appearance}`).join('\n');
  const plan = new Array(lines.length);
  // batches of 10 lines, three at a time: a 15-minute film has about 300 lines
  const starts = Array.from({ length: Math.ceil(lines.length / 10) }, (_, j) => j * 10);
  let planned = 0;
  const planBatch = async k => {
    const part = lines.slice(k, k + 10);
    const list = part.map((l, j) => {
      const sc = story.scenes[l.scene];
      const what = l.dialogue ? `DIALOGUE, ${name(l.dialogue.character)} (${l.dialogue.character}) says: "${l.dialogue.line}"` : `NARRATION: "${l.narration}"`;
      return `Line ${k + j + 1} (scene ${l.scene + 1}: ${sc.visual}; characters in scene: ${(sc.characters || []).join(', ') || 'none'})\n${what}`;
    }).join('\n\n');
    try {
      const reply = await chat([
        { role: 'system', content: 'You are a film director planning shots for an image-to-video model. Reply with ONLY valid JSON.' },
        { role: 'user', content: `Cast:\n${cast}\n\n${list}\n\nPlan ONE continuous shot for each line, in English.
- DIALOGUE: the speaker talks to the other person, looking at them, never into the lens: a three-quarter or side view in a close-up, medium or over-the-shoulder shot (over the listener's shoulder), face and mouth clearly visible, with a gesture that fits the line, often while still doing their task.
- NARRATION: show exactly what the sentence describes, with the right characters, in the scene's place, as an action in progress. When a narration line describes only the place, the weather, the time of day or a crowd (no named character acts in it), make it a wide establishing shot of that place with "characters": [] — like a real film opening a scene.
- Every shot has ONE clear physical action happening (walks along the lane, threads a needle, hands over the parcel, turns to look, sits down). People never stand still and pose and never look into the lens: their eyes are on their work, on what is in their hands or on each other, like a documentary or a village vlog.
- Mix shot sizes and angles like a real film crew: in any 4 shots in a row use at least 3 different sizes (wide, medium, close-up, over-the-shoulder, macro), and add low-angle and high-angle shots now and then. A narration line about work, cooking, food, tools, crafts or touch gets a "macro" insert: hands, food or an object filling the frame, faces out of frame (list the person whose hands they are in "characters"). Show the place's animals (hens, goats, cows, dogs, birds) and everyday life where they fit.
- Keep each scene's place, time of day and clothes the same across its shots; never the same shot size twice in a row.
"visual": what the camera sees (20-35 words). "action": what happens during the shot, in order (15-30 words); a speaker talks with lips moving and a fitting gesture. Name characters by their look, not their name, in both.${real ? FILMABLE : ''}
JSON: {"shots":[{"line":1,"visual":"","action":"","shot":"close-up|medium|wide|over-the-shoulder|macro|low-angle|high-angle","characters":["c1"]}]}` }
        // ten shots are about 1,300 tokens: asking for less than the default 4,000 lets the
        // free writers take the three batches at once instead of one a minute
      ], { signal, maxTokens: 2500 });
      const j = parseJSON(reply);
      for (const s of Array.isArray(j.shots) ? j.shots : []) {
        const idx = (+s.line || 0) - 1;
        if (idx >= k && idx < k + part.length) plan[idx] = s;
      }
    } catch (e) { if (signal?.aborted) throw e; console.warn('shot plan', e); }
    planned += part.length;
    onStatus?.(`Planning shots… (${planned} of ${lines.length} lines)`);
  };
  onStatus?.(`Planning shots… (0 of ${lines.length} lines)`);
  await Promise.all(Array.from({ length: Math.min(3, starts.length) }, async () => { while (starts.length) await planBatch(starts.shift()); }));
  const ids = new Set(story.characters.map(c => c.id));
  return lines.map((l, i) => {
    const sc = story.scenes[l.scene], s = plan[i] || {};
    const who = (Array.isArray(s.characters) ? s.characters : []).filter(x => ids.has(x));
    const speaker = l.dialogue?.character;
    return {
      title: sc.title, sceneOf: l.scene,
      narration: l.narration || '',
      dialogue: l.dialogue ? [l.dialogue] : [],
      // a narration shot planned with nobody in it is an establishing shot: keep it empty
      characters: who.length ? who : speaker ? [speaker] : real && Array.isArray(s.characters) && !s.characters.length && s.visual && !PEOPLE.test(s.visual) ? [] : sc.characters,
      visual: String(s.visual || (speaker ? `${name(speaker)} speaking to the person beside them, three-quarter view, close-up. ${sc.visual}` : sc.visual)),
      action: String(s.action || ''),
      shot: s.shot || (speaker ? 'close-up' : sc.shot),
      camera: speaker ? (i % 2 ? 'push-in' : 'drift') : sc.camera,
      ambience: sc.ambience, stock: sc.stock
    };
  });
}

// Scenes written before "action" existed (or by ChatGPT without it) get one now: what
// each character does during the shot, in order, so AI motion acts out the script.
// ---------------- action timeline ----------------
// A shot's action as timed beats: {from, to} in parts of the shot (0-1), what happens, and
// a move type the on-device body motion follows.
export const MOVES = ['still', 'talk', 'look', 'nod', 'turn', 'laugh', 'raise', 'point', 'wave', 'pull', 'hold', 'give', 'hug', 'clap', 'walk', 'run', 'dance', 'sit'];
export function cleanBeats(list) {
  const out = (Array.isArray(list) ? list : []).map(b => ({
    from: Math.max(0, Math.min(1, (+b.from || 0) / ((+b.from || 0) > 1 || (+b.to || 0) > 1 ? 100 : 1))),
    to: Math.max(0, Math.min(1, (+b.to || 0) / ((+b.from || 0) > 1 || (+b.to || 0) > 1 ? 100 : 1))),
    act: String(b.act || '').trim().slice(0, 200),
    move: MOVES.includes(b.move) ? b.move : 'talk'
  })).filter(b => b.act && b.to > b.from).sort((a, b) => a.from - b.from).slice(0, 6);
  if (out.length) { out[0].from = 0; out[out.length - 1].to = 1; }
  return out;
}
export function beatsSentence(beats) {
  return beats.map((b, k) => (beats.length > 1 ? (k === 0 ? 'First, ' : k === beats.length - 1 ? 'Finally, ' : 'Then, ') : '') + b.act.replace(/[.!?]$/, '')).join('. ') + '.';
}
// the timeline as editable text, one beat a line: "0-40%: looks up and raises her arm (raise)"
export const beatsText = beats => (beats || []).map(b => `${Math.round(b.from * 100)}-${Math.round(b.to * 100)}%: ${b.act} (${b.move})`).join('\n');
export function parseBeats(text) {
  return cleanBeats(String(text || '').split('\n').map(l => {
    const m = /^\s*(\d+)\s*-\s*(\d+)\s*%?\s*:\s*(.+?)\s*(?:\((\w+)\))?\s*$/.exec(l);
    return m ? { from: +m[1] / 100, to: +m[2] / 100, act: m[3], move: (m[4] || 'talk').toLowerCase() } : null;
  }).filter(Boolean));
}

export async function writeActions(p, { signal, onStatus } = {}) {
  // every shot without a timeline; a shot that already has an action keeps it, and its
  // timeline acts that action out
  // (cards and maps are drawn, and a shot with nobody in it has nobody to act: neither needs
  // the writer, which a re-render otherwise waited for on every shot without a timeline)
  const todo = p.scenes.map((sc, i) => i).filter(i => { const sc = p.scenes[i]; return !sc.beats?.length && !sc.card && !sc.map && ((sc.characters || []).length || (sc.dialogue || []).some(d => d.line)); });
  const name = id => p.characters.find(c => c.id === id)?.name || id;
  for (let k = 0; k < todo.length; k += 8) {
    const part = todo.slice(k, k + 8);
    onStatus?.(`Planning character actions… (${Math.min(k + 8, todo.length)} of ${todo.length})`);
    const list = part.map(i => {
      const sc = p.scenes[i];
      const lines = (sc.dialogue || []).map(d => `${name(d.character)} says: "${d.line}"`).join(' / ');
      return `Scene ${i + 1}. Picture: ${sc.visual}\nNarration: ${sc.narration || '(none)'}\nDialogue: ${lines || '(none)'}${sc.action ? `\nPlanned action (follow it): ${sc.action}` : ''}`;
    }).join('\n\n');
    const cast = p.characters.map(c => `${c.name}: ${c.appearance}`).join('\n');
    const reply = await chat([
      { role: 'system', content: 'You turn a film script into physical actions for an image-to-video model. Reply with ONLY valid JSON.' },
      { role: 'user', content: `Cast:\n${cast}\n\n${list}\n\nFor each scene write an action timeline in English: 1-2 beats describing phases of ONE primary physical action that together fill the shot, in order, acting out that scene's narration and dialogue. Each beat: "from" and "to" in percent of the shot (0-100, no gaps), "act" (8-20 words: who does what, physically) and "move", one of ${MOVES.join('|')}.
Rules: do not combine walking, turning, waving and object handling in one short shot. Use one body action; split distinct actions across shots. Keep wardrobe, face and hand/object ownership identical to the reference image. Whoever speaks a line is shown talking with lips moving and a matching gesture. Refer to each character by a short English description of their look (e.g. "the little girl in the yellow dress"), never by name. Concrete verbs, no camera words, no inner thoughts, nothing the picture cannot show. Hands and objects: say which hand holds what, and keep every held object in that hand for the whole beat (the kite string stays in her right hand, the book stays open in his hands); a page is turned with fingers, a cup is lifted by its handle.
JSON: {"actions":[{"scene":1,"beats":[{"from":0,"to":40,"act":"","move":"raise"}]}]}` }
    ], { signal });
    const j = parseJSON(reply);
    for (const a of Array.isArray(j.actions) ? j.actions : []) {
      const sc = p.scenes[(+a.scene || 0) - 1];
      if (!sc || sc.beats?.length) continue;
      const beats = cleanBeats(a.beats);
      if (beats.length) { sc.beats = beats; sc.action ||= beatsSentence(beats); }
      else if (a.action && !sc.action) sc.action = String(a.action).trim();
    }
  }
}

// ---------------- AI tools ----------------
// Video translation: every narration and dialogue line, the title and the logline go into
// another language, in batches, keeping the order; a line the writer drops stays as it was.
export async function translateFilm(p, lang, { signal, onStatus } = {}) {
  const slots = [[p, 'title'], [p, 'logline']];
  p.scenes.forEach(sc => {
    if (sc.narration) slots.push([sc, 'narration']);
    (sc.dialogue || []).forEach(d => slots.push([d, 'line']));
  });
  const batches = [];
  for (let k = 0; k < slots.length; k += 30) batches.push(slots.slice(k, k + 30));
  let done = 0;
  const run = async part => {
    const list = part.map(([o, key], j) => `${j + 1}. ${o[key]}`).join('\n');
    for (let attempt = 0; attempt < 2; attempt++) {
      const j = await askJSON('You translate film scripts. Reply with ONLY valid JSON.',
        `Translate each numbered line into ${writeIn(lang)}: natural spoken ${findLanguage(lang)?.name || lang} for a film, same meaning, tone and length, names kept.${worldNote(lang)}\n${list}\nJSON: {"t":["line 1 translated", "..."]} with exactly ${part.length} items in the same order.`,
        { signal, label: 'Translating…' });
      const t = Array.isArray(j.t) ? j.t : [];
      if (t.length === part.length || attempt) {
        part.forEach(([o, key], k) => { if (typeof t[k] === 'string' && t[k].trim()) o[key] = t[k].trim(); });
        break;
      }
    }
    done += part.length;
    onStatus?.(`Translating the script… (${Math.min(done, slots.length)} of ${slots.length} lines)`);
  };
  const queue = [...batches];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => { while (queue.length) await run(queue.shift()); }));
  const name = id => p.characters.find(c => c.id === id)?.name || '';
  p.story = p.scenes.map(sc => [sc.narration, ...(sc.dialogue || []).map(d => `${name(d.character)}: “${d.line}”`)].filter(Boolean).join('\n')).join('\n\n');
  p.language = lang;
}

// Smart Short: the strongest run of 5-12 consecutive shots (about 30-50 s) of a film,
// with a hook at the start and a payoff, and a title for it.
export async function pickShortMoment(p, { signal } = {}) {
  const n = p.scenes.length;
  const fallback = { from: 0, to: Math.min(n, 8) - 1, title: p.title };
  if (n <= 6) return { from: 0, to: n - 1, title: p.title };
  const name = id => p.characters.find(c => c.id === id)?.name || id;
  const list = p.scenes.slice(0, 300).map((sc, i) => `${i + 1}. ${sc.dialogue?.[0] ? `${name(sc.dialogue[0].character)}: ${sc.dialogue[0].line}` : sc.narration || sc.visual}`).join('\n');
  try {
    const j = await askJSON('You are a YouTube Shorts editor. Reply with ONLY valid JSON.',
      `Film: "${p.title}". ${p.logline}\nShots:\n${list}\n\nPick the best 5-12 CONSECUTIVE shots for a 30-50 second YouTube Short that makes sense on its own: a strong hook in the first shot and a payoff or twist at the end. Also write a catchy Short title in ${writeIn(p.language || 'English')} (under 60 characters).\nJSON: {"from":1,"to":8,"title":""}`,
      { signal, label: 'Choosing the moment…' });
    const from = Math.max(1, Math.min(n, +j.from || 1)) - 1, to = Math.max(from + 4, Math.min(n, +j.to || from + 8)) - 1;
    return { from, to: Math.min(to, from + 11, n - 1), title: String(j.title || p.title).slice(0, 80) };
  } catch (e) {
    if (signal?.aborted) throw e;
    return fallback;
  }
}

// Audio to film: a film planned around someone's own narration. segs are its transcript
// segments ({start, end, text}); each becomes a scene whose narration is that segment.
export async function storyFromTranscript(segs, { language, genre, signal, onStatus } = {}) {
  onStatus?.('Reading your narration and casting the film…');
  const text = segs.map(s => s.text.trim()).join(' ').slice(0, 12000);
  const outline = await askJSON(`You are a film director who turns a narration into a film. ${ORIGINAL_RULES}\n${SAFETY_RULES}\nReply with ONLY valid JSON.`,
    `NARRATION (transcript of the person's own recording):\n"""${text}"""\n\nPlan the film that plays under this narration. Genre: ${genre === 'auto' || !genre ? 'choose the best fit' : genre}.
Write title, logline and hashtags in ${writeIn(language || 'English')}; write "setting" and "appearance" in English.
Cast: the people (or animals) the narration is about, max 6, each with a clearly different look. Each "appearance" is 25-40 words and starts with their nationality or ethnicity as the story implies (e.g. "Indian"): age, face, hair, skin tone, build, outfit with colours, one distinctive feature, true to their gender and age.
JSON: {"title":"","logline":"","genre":"","mood":"${MOODS.join('|')}","setting":"time period, place and visual world in one sentence",
"characters":[{"id":"c1","name":"","role":"protagonist|ally|antagonist|mentor|other","gender":"male|female","age":"child|teen|adult|elder","ageYears":30,"outfit":"their main outfit in a few English words, true to the era and place, ordinary and fully clothed for anyone under 18","appearance":"","personality":"under 12 words"}],
"hashtags":["6 hashtags without #"]}`, { signal, label: 'Casting…' });
  const film = normalise({
    ...outline,
    scenes: segs.map((sg, i) => ({ title: `${outline.title || 'Part'} ${i + 1}`, narration: sg.text.trim(), dialogue: [], characters: [], visual: sg.text.trim(), action: '', ambience: 'none' }))
  }, segs.length);
  await englishLooks(film, { signal });
  return film;
}
