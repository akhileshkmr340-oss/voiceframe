// Story writer, character designer and prompt builder.
import { chat, parseJSON, hasKey } from './ai.js?v=25';
import { ORIGINAL_RULES } from './copyright.js?v=25';

export const SCENE_COUNT = { shorts: 5, short: 6, medium: 10, long: 16, film5: 32, film10: 64 };
export const MOODS = ['epic', 'adventure', 'emotional', 'mysterious', 'dark', 'romantic', 'joyful', 'scifi'];
const CAMERAS = ['push-in', 'pan-right', 'pull-out', 'pan-left', 'tilt-up', 'drift', 'push-in', 'tilt-down'];

export const STYLES = {
  cinematic: 'cinematic film still, photorealistic, anamorphic lens, dramatic volumetric lighting, shallow depth of field, 35mm film, rich colour grade',
  pixar: 'high-end 3D animated feature film still, expressive stylised characters, soft global illumination, vibrant colours, detailed render',
  anime: 'anime feature film still, hand-painted backgrounds, clean cel shading, cinematic lighting, highly detailed',
  painterly: 'digital concept art painting, epic matte painting, visible brush strokes, cinematic composition, atmospheric light',
  watercolor: 'watercolour storybook illustration, soft washes, paper texture, gentle warm light, whimsical',
  noir: 'black and white film noir still, high contrast, hard shadows, 1940s cinema, moody',
  indian: 'Indian miniature painting style, intricate ornament, gold leaf accents, rich mineral pigments, flat perspective'
};
const NEG = 'no text, no captions, no watermark, no logo, no frame border';

// The free model stops at ~1,500 tokens, so the film is written in passes:
// an outline (title, cast, one beat per scene), then scenes in batches of 4.
export async function writeStory({ idea, genre, length, language, useOwn, makeOriginal, onStatus, signal }) {
  const n = SCENE_COUNT[length] || 10;
  const shorts = length === 'shorts';
  const lang = language || 'English';
  const langNote = `Write title, logline, beats, narration and dialogue in ${lang}${lang !== 'English' ? ' (native script)' : ''}. Write "appearance", "visual" and "stock" in English.`;
  const sys = `You are an award-winning screenwriter and film director who writes gripping, emotional short films for YouTube.
${ORIGINAL_RULES}
Keep it suitable for a general audience${genre === 'Horror' ? ' (suspense and dread are fine, no gore)' : ''}.
Reply with ONLY valid JSON, no markdown, no commentary.`;
  const source = useOwn
    ? `Adapt the AUTHOR'S STORY faithfully: keep its plot, events, names and tone${makeOriginal ? ' (but rename copyrighted characters or places to original ones)' : ''}.

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
Max 4 characters. Each "appearance" is 25-40 words: age, face, hair, skin tone, build, outfit with colours, one distinctive feature, so an illustrator draws them the same in every scene.

JSON: {"title":"","logline":"one gripping sentence","genre":"","mood":"${MOODS.join('|')}",
"setting":"time period, place and visual world in one sentence",
"characters":[{"id":"c1","name":"","role":"protagonist|ally|antagonist|mentor|other","gender":"male|female","age":"child|teen|adult|elder","appearance":"","personality":"under 12 words"}],
"hashtags":["6 hashtags without #"],
${longForm
    ? `"acts":["exactly ${nActs} items: 2-3 sentences each on what happens in that act"]}`
    : `"beats":["exactly ${n} items: one sentence of what happens in each scene"]}`}`, { onStatus, signal, label: 'Outlining the story and cast…' });
  const plan = longForm ? outline.acts : outline.beats;
  if (!Array.isArray(outline.characters) || !Array.isArray(plan) || !plan.length) throw new Error('The story outline came back incomplete. Please try again.');

  const cast = outline.characters.slice(0, 4).map(c => `${c.id} = ${c.name} (${c.role}, ${c.age} ${c.gender})`).join('; ');
  const style = shorts
    ? `This is a YouTube Short: NO narrator. "narration" is an empty string in every shot.
Every shot has exactly 1 line of dialogue spoken on camera by the character in focus: natural, funny or cute, 3-8 words.
"visual" describes one vertical 9:16 photoreal shot with the speaking character's face clearly visible, their action and expression.`
    : longForm
      ? `The characters carry the story by talking on camera: most scenes have 1-3 lines of dialogue (under 15 words each) between the characters in the shot.
"narration" is 1 short sentence (under 20 words) only when the story needs a bridge, otherwise an empty string.`
      : `Narration: 2-3 vivid sentences (30-45 words), told by a narrator, present tense${useOwn ? ", reusing the author's sentences where possible" : ''}.
Give about half the scenes 1-2 lines of character dialogue (under 15 words each); others get an empty list.`;
  const sceneJSON = `JSON: {"scenes":[{"title":"","narration":"","dialogue":[{"character":"c1","line":""}],"characters":["c1"],
"visual":"what the camera sees: subject, action, setting, lighting, composition (25-40 words)",
"stock":"2-3 word photo search for this scene's setting, e.g. misty forest",
"shot":"wide|medium|close-up|aerial|low-angle","camera":"push-in|pull-out|pan-left|pan-right|tilt-up|tilt-down|drift",
"ambience":"none|rain|wind|ocean|fire|forest|city|night|cave"}]}`;
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

  // With a key the writer has no pacing limit, so batches run 4 at a time.
  const parts = new Array(batches.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < batches.length) {
      const k = next++, bt = batches[k];
      onStatus?.(bt.label, 0.12 + 0.85 * done / batches.length);
      const part = await askJSON(sys, bt.prompt, { onStatus, signal, label: bt.label });
      const got = Array.isArray(part.scenes) ? part.scenes.slice(0, bt.b - bt.a) : [];
      if (!got.length) throw new Error('A batch of scenes came back empty. Please try again.');
      parts[k] = got;
      done++;
    }
  };
  await Promise.all(Array.from({ length: hasKey() ? 4 : 1 }, worker));
  const scenes = parts.flat();
  const film = normalise({ ...outline, scenes }, n);
  // Shorts are carried by the characters' own lines; drop any narrator text the model added.
  if (shorts) film.scenes.forEach(s => { if (s.dialogue.length) s.narration = ''; });
  return film;
}

async function askJSON(sys, user, { onStatus, signal, label }) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const reply = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], {
      signal, onWait: sec => onStatus?.(sec ? `${label} (free writer busy, starting in ${sec}s)` : label)
    });
    try { return parseJSON(reply); } catch (e) { lastErr = e; console.warn('Story parse failed', e, reply); }
  }
  throw new Error('The story writer returned something unreadable. Please try again. (' + (lastErr?.message || '') + ')');
}

function normalise(s, n) {
  const chars = (Array.isArray(s.characters) ? s.characters : []).slice(0, 4).map((c, i) => ({
    id: String(c.id || 'c' + (i + 1)), name: String(c.name || 'Character ' + (i + 1)),
    role: c.role || 'other', gender: /^f/i.test(c.gender) ? 'female' : 'male',
    age: ['child', 'teen', 'adult', 'elder'].includes(c.age) ? c.age : 'adult',
    appearance: String(c.appearance || ''), personality: String(c.personality || '')
  }));
  const ids = new Set(chars.map(c => c.id));
  const byName = Object.fromEntries(chars.map(c => [c.name.toLowerCase(), c.id]));
  const ref = x => ids.has(x) ? x : byName[String(x || '').toLowerCase()];
  let scenes = (Array.isArray(s.scenes) ? s.scenes : []).filter(x => x && (x.narration || x.visual));
  if (!scenes.length) throw new Error('No scenes');
  scenes = scenes.slice(0, Math.max(n + 2, 6)).map((x, i) => ({
    title: String(x.title || `Scene ${i + 1}`),
    narration: String(x.narration || '').trim(),
    dialogue: (Array.isArray(x.dialogue) ? x.dialogue : []).map(d => ({ character: ref(d.character), line: String(d.line || '').trim() }))
      .filter(d => d.character && d.line).slice(0, 3),
    characters: (Array.isArray(x.characters) ? x.characters : []).map(ref).filter(Boolean),
    visual: String(x.visual || x.narration || ''),
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

export function scenePrompt(p, scene) {
  const cast = scene.characters.map(id => p.characters.find(c => c.id === id)).filter(Boolean)
    .map(c => `${c.name}: ${c.appearance}`).join('; ');
  return [STYLES[p.style] || STYLES.cinematic, `${scene.shot} shot`, scene.visual,
    cast && `Characters (keep exactly this look) — ${cast}`, p.setting && `World: ${p.setting}`, MODEST, NEG].filter(Boolean).join('. ');
}

// ---------------- ChatGPT workflow ----------------
// A ChatGPT subscription can't be called by a website, but the person can paste
// these prompts into ChatGPT themselves and bring the results back.

const FORMAT_WORDS = { '9:16': 'vertical 9:16 (1080x1920)', '1:1': 'square 1:1', '16:9': 'wide 16:9 (1920x1080)' };

export function chatgptStoryPrompt({ idea, genre, length, language }) {
  const n = SCENE_COUNT[length] || 10, shorts = length === 'shorts', lang = language || 'English';
  return `You are an award-winning screenwriter. Write an ORIGINAL ${shorts ? 'viral YouTube Short (15-20 s)' : `film of about ${Math.max(1, Math.round(n * (n > 16 ? 10 : 15) / 60))} minutes`} for YouTube from this idea:
"""${idea}"""

Rules: original characters only (no existing franchises, real celebrities, brands or song lyrics); family-friendly; modest clothing.
Genre: ${genre === 'auto' ? 'choose the best fit' : genre}. Exactly ${n} scenes. Max 4 characters.
${shorts ? 'No narrator: every scene has exactly 1 short spoken line (3-8 words) by the character in focus; "narration" is "".'
    : n > 16 ? 'Characters carry the story with on-camera dialogue (1-3 lines per scene, under 15 words each); "narration" is 1 short bridging sentence or "".'
      : 'Each scene: narration of 2-3 vivid sentences (30-45 words, present tense); about half the scenes also have 1-2 lines of dialogue (under 15 words).'}
Write title, logline, narration and dialogue in ${lang}${lang !== 'English' ? ' (native script)' : ''}; write "appearance", "visual" and "stock" in English.
Each character "appearance" is 30-40 words (age, face, hair, skin tone, build, outfit with colours, one distinctive feature) so they look identical in every picture.

Reply with ONLY this JSON, no other text:
{"title":"","logline":"","genre":"","mood":"${MOODS.join('|')}","setting":"one sentence",
"characters":[{"id":"c1","name":"","role":"protagonist|ally|antagonist|mentor|other","gender":"male|female","age":"child|teen|adult|elder","appearance":"","personality":""}],
"scenes":[{"title":"","narration":"","dialogue":[{"character":"c1","line":""}],"characters":["c1"],"visual":"what the camera sees (25-40 words)","stock":"2-3 words","shot":"wide|medium|close-up|aerial|low-angle","camera":"push-in|pull-out|pan-left|pan-right|tilt-up|tilt-down|drift","ambience":"none|rain|wind|ocean|fire|forest|city|night|cave"}],
"hashtags":["6 hashtags"]}`;
}

// Turn ChatGPT's pasted answer into a story (same shape the built-in writer returns).
export function importStory(text, length) {
  const s = parseJSON(text);
  if (!Array.isArray(s.scenes) || !s.scenes.length) throw new Error('That answer has no scenes. Copy ChatGPT\'s whole reply (the JSON) and paste it again.');
  const film = normalise(s, s.scenes.length);
  if (length === 'shorts') film.scenes.forEach(x => { if (x.dialogue.length) x.narration = ''; });
  return film;
}

export function chatgptImagePrompts(p) {
  const style = (STYLES[p.style] || STYLES.cinematic).replace(/^cinematic film still, /, '');
  const fmt = FORMAT_WORDS[p.options?.format] || FORMAT_WORDS['16:9'];
  return `Please create ${p.scenes.length} images for my film "${p.title}", one image per message, in order. After each image, wait for me to say "next".
Every image: ${fmt}, ${style}. ${MODEST}. No text, captions, logos or watermarks.
Keep the characters looking EXACTLY the same in every image (same face, hair, skin tone and outfit):
${p.characters.map(c => `- ${c.name} (${c.age} ${c.gender}): ${c.appearance}`).join('\n')}
${p.setting ? `World: ${p.setting}\n` : ''}
${p.scenes.map((s, i) => `Image ${i + 1} — ${s.shot} shot: ${s.visual}${s.characters.length ? ` (shows ${s.characters.map(id => p.characters.find(c => c.id === id)?.name).filter(Boolean).join(', ')})` : ''}`).join('\n')}

Start with image 1.`;
}

export function portraitPrompt(p, c) {
  return [STYLES[p.style] || STYLES.cinematic, 'character design portrait, head and shoulders, looking at camera, neutral dark backdrop, studio rim light',
    `${c.name}, ${c.age} ${c.gender}, ${c.appearance}`, `personality: ${c.personality}`, p.setting && `World: ${p.setting}`, MODEST, NEG].filter(Boolean).join('. ');
}

// Rewrite one scene's narration (used by the per-scene "rewrite" button).
export async function rewriteScene(p, i, { onWait, signal }) {
  const sc = p.scenes[i];
  const reply = await chat([
    { role: 'system', content: 'You are a film narrator-writer. Reply with ONLY the new narration text.\n' + ORIGINAL_RULES },
    { role: 'user', content: `Story: ${p.logline}\nPrevious scene: ${p.scenes[i - 1]?.narration || '(none)'}\nThis scene: ${sc.visual}\nNext scene: ${p.scenes[i + 1]?.narration || '(end)'}\nRewrite this scene's narration in ${p.language || 'English'}: 2-3 vivid sentences, 30-45 words, present tense, more cinematic than: "${sc.narration}"` }
  ], { onWait, signal });
  return reply.replace(/^["'\s]+|["'\s]+$/g, '');
}
