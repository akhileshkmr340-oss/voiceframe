// Copyright safety: screen prompts and stories for protected franchises, brands
// and lyrics, and produce the licence report and platform descriptions.
const PROTECTED = [
  // franchises & characters
  'harry potter', 'hogwarts', 'voldemort', 'dumbledore', 'hermione', 'marvel', 'avengers', 'iron man', 'spider-man', 'spiderman',
  'captain america', 'hulk', 'thanos', 'black panther', 'wolverine', 'x-men', 'deadpool', 'batman', 'superman', 'wonder woman',
  'gotham', 'justice league', 'star wars', 'jedi', 'darth vader', 'skywalker', 'yoda', 'star trek', 'pokemon', 'pokémon', 'pikachu',
  'mickey mouse', 'minnie mouse', 'donald duck', 'disney', 'pixar', 'moana', 'simba', 'lion king', 'toy story',
  'buzz lightyear', 'shrek', 'minions', 'despicable me', 'kung fu panda', 'naruto', 'sasuke', 'dragon ball', 'goku', 'one piece', 'luffy',
  'demon slayer', 'attack on titan', 'doraemon', 'nobita', 'shinchan', 'shin-chan', 'chhota bheem', 'chota bheem', 'motu patlu', 'oggy',
  'tom and jerry', 'scooby', 'spongebob', 'peppa pig', 'paw patrol', 'super mario', 'luigi', 'sonic the hedgehog', 'zelda', 'minecraft',
  'fortnite', 'roblox', 'barbie', 'transformers', 'optimus prime', 'godzilla', 'king kong', 'lord of the rings', 'hobbit', 'gandalf',
  'frodo', 'game of thrones', 'westeros', 'hunger games', 'james bond', '007', 'jurassic park', 'terminator 2', 'the matrix',
  'na\'vi','baahubali', 'bahubali', 'krrish', 'ra.one', 'kgf', 'pushpa', 'rrr', 'squid game', 'stranger things', 'witcher',
  'percy jackson', 'narnia', 'sherlock bbc', 'ghibli', 'totoro', 'ben 10', 'power rangers', 'teenage mutant', 'ninja turtles',
  // brands
  'coca-cola', 'pepsi', 'nike', 'adidas', 'apple iphone', 'mcdonald', 'starbucks', 'ferrari', 'lamborghini',
  // copyrighted text
  'lyrics', 'song by', 'sing the song', 'theme song'
];

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RX = PROTECTED.map(w => [w, new RegExp(`(^|[^a-z0-9])${esc(w)}($|[^a-z0-9])`, 'i')]);

export function screen(text) {
  const t = String(text || '');
  return [...new Set(RX.filter(([, rx]) => rx.test(t)).map(([w]) => w))];
}

export const ORIGINAL_RULES = `ORIGINALITY RULES (strict, for copyright safety):
- Invent ORIGINAL characters, names, places, creatures and worlds. Never use characters, names, settings, catchphrases or plots from existing books, films, TV, games, comics or anime.
- If the idea mentions an existing franchise or character, replace it with a fresh original equivalent that has a different name and look.
- No real celebrities, politicians or living public figures. No brand names or logos.
- Never quote song lyrics, poems or lines from copyrighted works.
- Public-domain myths, folk tales and history are fine; retell them in your own words.`;

export function aiDisclosure() {
  return 'This video was made with AI tools: an AI-written original story, AI-generated images, a synthetic narrator voice and a computer-generated soundtrack. Characters and events are fictional.';
}

export function describeVisuals(project) {
  const credits = Object.values(project.credits || {});
  const stock = credits.filter(c => c.kind === 'stock');
  const ai = credits.filter(c => c.kind === 'ai');
  return { stock, ai };
}

export function checklist(project) {
  const flags = project.flags || [];
  const { stock, ai } = describeVisuals(project);
  const voice = project.voiceEngine === 'pollinations' ? 'Pollinations TTS (synthetic voice)' : 'Kokoro-82M (Apache-2.0, synthetic voice)';
  const missing = (project.scenes || []).filter((s, i) => !project.images?.['scene-' + i]).length;
  return [
    flags.length
      ? { s: 'warn', t: `Story idea mentioned protected names (${flags.join(', ')}). They were replaced with original creations. Read the story once before publishing.` }
      : { s: 'ok', t: 'Original story: no franchise characters, brands or lyrics found.' },
    missing
      ? { s: 'bad', t: `${missing} scene(s) have no image yet.` }
      : { s: 'ok', t: `Visuals: ${ai.length} AI-generated image(s)${stock.length ? `, ${stock.length} CC0 / public-domain photo(s)` : ''}. No attribution needed.` },
    ...(Object.keys(project.credits || {}).some(k => k.startsWith('video-'))
      ? [{ s: 'ok', t: 'Motion: scene clips were generated from your own scene pictures by open video models (LTX-Video / Wan). No third-party footage was used.' }] : []),
    { s: 'ok', t: 'Music: an original score composed in your browser for this film. There is no third-party recording for Content ID to match.' },
    { s: 'ok', t: `Voice: ${voice}. No real person's voice is cloned.` },
    { s: 'warn', t: 'When uploading, tick “Altered or synthetic content” on YouTube (and “AI info” on Instagram/Facebook) if the film looks realistic. The disclosure text is already in your description.' }
  ];
}

export function credits(project) {
  const lines = [];
  const date = new Date().toISOString().slice(0, 10);
  lines.push(`VOICEFRAME STUDIO — LICENCE & SOURCE REPORT`);
  lines.push(`Film: ${project.title}`);
  lines.push(`Created: ${date}`);
  lines.push(`Made by: ${project.ownerName || 'VoiceFrame user'}`);
  lines.push('');
  lines.push('STORY');
  lines.push(`  Written by an AI model (Pollinations.ai text API) from the creator's idea, under originality rules`);
  lines.push(`  (no existing franchises, real people, brands or lyrics).`);
  if (project.flags?.length) lines.push(`  Note: the idea mentioned ${project.flags.join(', ')}. These were replaced with original equivalents.`);
  lines.push('');
  lines.push('VISUALS');
  (project.scenes || []).forEach((s, i) => {
    const c = project.credits?.['scene-' + i];
    if (!c) return;
    if (c.kind === 'ai') lines.push(`  Scene ${i + 1}: AI-generated image (Pollinations.ai, seed ${c.seed}). Generated for this film.`);
    else if (c.kind === 'chatgpt') lines.push(`  Scene ${i + 1}: image generated by the creator with ChatGPT (OpenAI image generation; output owned by the creator under OpenAI's terms).`);
    else if (c.kind === 'user') lines.push(`  Scene ${i + 1}: image supplied by the creator.`);
    else lines.push(`  Scene ${i + 1}: "${c.title}" by ${c.creator}. ${c.license} (${c.licenseUrl}). Source: ${c.source}`);
  });
  (project.scenes || []).forEach((s, i) => {
    const v = project.credits?.['video-' + i];
    if (v) lines.push(`  Scene ${i + 1} motion: AI video generated from the scene picture with the open ${v.model} model (Hugging Face Space, free GPU).`);
  });
  (project.characters || []).forEach(ch => {
    const c = project.credits?.['char-' + ch.id];
    if (c) lines.push(`  Character portrait "${ch.name}": AI-generated (Pollinations.ai, seed ${c.seed}).`);
  });
  lines.push('');
  lines.push('VOICE');
  lines.push(project.voiceEngine === 'pollinations'
    ? '  Synthetic speech from the Pollinations.ai text-to-speech API.'
    : '  Synthetic speech from Kokoro-82M (hexgrad, Apache-2.0 licence), run in the browser.');
  lines.push('  No real person\'s voice was recorded or cloned.');
  lines.push('');
  lines.push('MUSIC & SOUND');
  lines.push(`  Original score procedurally synthesised by VoiceFrame for this film (mood: ${project.mood}, seed ${project.seed}).`);
  lines.push('  Ambient effects are synthesised noise. No samples or third-party recordings were used.');
  lines.push('');
  lines.push('AI DISCLOSURE');
  lines.push('  ' + aiDisclosure());
  lines.push('');
  lines.push('Openverse CC0/PDM items carry no copyright restrictions. Credits are listed here as good practice.');
  return lines.join('\n');
}

export function description(project) {
  const tags = (project.hashtags || []).map(h => '#' + String(h).replace(/^#/, '').replace(/\s+/g, '')).slice(0, 8);
  const { stock } = describeVisuals(project);
  const parts = [
    project.logline || '',
    '',
    (project.story || '').split(/\n\n+/)[0]?.slice(0, 400) || '',
    '',
    '— Credits —',
    'Story, characters & visuals: created with VoiceFrame Studio (AI-assisted, original).',
    'Narration: synthetic AI voice. Music: original, composed for this film.',
    stock.length ? `Public-domain photos via Openverse: ${stock.map(s => `${s.creator} (${s.license})`).join('; ')}` : '',
    '',
    aiDisclosure(),
    '',
    tags.join(' ')
  ];
  return parts.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim();
}
