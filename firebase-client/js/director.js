// AI Director: a chat agent that edits the film. The free writer reads a compact view of
// the film and replies with {reply, actions}; app.js checks and carries out the actions.
// Edits work at any stage, also after the MP4 is made (the film is then rendered again).
import { chat, parseJSON } from './ai.js?v=66';
import { outfitPrompt, outfitForShot, outfitLabel, ageOf } from './outfits.js?v=66';

export const CAMS = ['push-in', 'pull-out', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down', 'track-left', 'track-right', 'orbit', 'handheld', 'drift'];
export const AMBS = ['none', 'rain', 'storm', 'wind', 'ocean', 'river', 'fire', 'forest', 'birds', 'city', 'traffic', 'crowd', 'festival', 'temple', 'kitchen', 'clock', 'night', 'cave'];
export const LOOKS = ['night', 'golden', 'day', 'rain', 'storm', 'fog', 'snow', 'festival', 'backdrop', 'original'];
export const MOODS = ['auto', 'epic', 'adventure', 'emotional', 'mysterious', 'dark', 'romantic', 'joyful', 'scifi'];
export const CAPTIONS = ['karaoke', 'bold', 'box', 'classic', 'none'];
export const TEXT_STYLES = ['title', 'lower', 'top'];
export const FORMATS = ['16:9', '9:16', '1:1'];
export const EXPRS = ['auto', 'neutral', 'smile', 'laugh', 'sad', 'angry', 'surprised', 'worried'];
export const GRADES = ['sepia', 'teal-orange', 'bw', 'warm', 'cool', 'none', 'auto'];
export const MASKS = ['keyhole', 'circle', 'vignette', 'none'];
export const TRANS = ['cut', 'crossfade', 'dip', 'whip', 'auto'];
export const PARTICLES = ['dust', 'embers', 'fireflies', 'rain', 'petals', 'sparkles', 'ash', 'mist', 'none', 'auto'];
export const BLURS = ['blur', 'pixelate', 'hide'];
export const FILLS = ['fill', 'fit', 'blur-fill'];
export const DELIVERIES = ['calm', 'happy', 'angry', 'sad', 'whisper', 'shout'];
// ---- Making clips elsewhere: free AI video tools the person uses on their own site ----
// One prompt per shot, tuned to the tool; the person makes the clip there and brings it
// back by shot number. No automation of those sites: only their public addresses.
// Edit this table to add a tool or update one (free credits and limits change often).
// speech: the tool makes the spoken line with lip-sync itself; lens: clip lengths (s);
// max: prompt length limit (characters); ratios: frame shapes it makes.
export const HANDOFF = [
  { id: 'flow', name: 'Google Flow (Veo)', url: 'https://labs.google/fx/tools/flow', speech: true, lens: [8], max: 2000, ratios: ['16:9', '9:16'], note: 'free credits, limits change; makes speech' },
  { id: 'kling', name: 'Kling AI', url: 'https://klingai.com/', speech: false, lens: [5, 10], max: 2500, ratios: ['16:9', '9:16', '1:1'], note: 'free credits, limits change' },
  { id: 'hailuo', name: 'Hailuo (MiniMax)', url: 'https://hailuoai.video/', speech: false, lens: [6, 10], max: 2000, ratios: ['16:9', '9:16', '1:1'], note: 'free credits, limits change' },
  { id: 'pixverse', name: 'PixVerse', url: 'https://app.pixverse.ai/', speech: false, lens: [5, 8], max: 2048, ratios: ['16:9', '9:16', '1:1'], note: 'free credits, limits change' },
  { id: 'vidu', name: 'Vidu', url: 'https://www.vidu.com/', speech: false, lens: [4, 8], max: 1500, ratios: ['16:9', '9:16', '1:1'], note: 'free credits, limits change' },
  { id: 'luma', name: 'Luma Dream Machine', url: 'https://lumalabs.ai/dream-machine', speech: false, lens: [5, 9], max: 2000, ratios: ['16:9', '9:16', '1:1'], note: 'free credits, limits change' },
  { id: 'pika', name: 'Pika', url: 'https://pika.art/', speech: false, lens: [5, 10], max: 1000, ratios: ['16:9', '9:16', '1:1'], note: 'free credits, limits change' },
  { id: 'meta', name: 'Meta AI', url: 'https://www.meta.ai/', speech: false, lens: [5], max: 1000, ratios: ['16:9', '9:16', '1:1'], note: 'free, limits change' }
];
export const toolOf = id => HANDOFF.find(t => t.id === id) || HANDOFF[0];
// the tool's own word for a few spellings the writer may use
export function toolName(v) {
  const s = String(v || '').toLowerCase();
  return HANDOFF.find(t => s.includes(t.id))?.id || (/veo|google/.test(s) ? 'flow' : /minimax/.test(s) ? 'hailuo' : /dream/.test(s) ? 'luma' : null);
}
// actions that start a long job of their own; one per reply, run last
export const LONG = new Set(['gpu_fix', 'make_short', 'translate', 'resize', 'render']);
// actions that only change what the renderer draws: safe while another step is running
export const QUICK = new Set(['set_camera', 'set_title', 'set_captions', 'set_expression', 'set_motion', 'set_ambience', 'set_music', 'set_grade', 'keyhole',
  'blur_region', 'set_transition', 'reframe', 'speed', 'reverse', 'trim', 'freeze', 'hold', 'set_particles', 'mix_audio', 'flow_prompts', 'handoff']);
// actions that change nothing in the film (no undo step, no new render)
export const NO_CHANGE = new Set(['flow_prompts', 'handoff', 'export_pack', 'undo', ...LONG]);

// the writer's own words for a look, mapped to the grades
export function gradeName(v) {
  const g = String(v || '').toLowerCase().replace(/[^a-z&]+/g, ' ').trim();
  if (GRADES.includes(g.replace(/ /g, '-'))) return g.replace(/ /g, '-');
  if (/sepia|documentary|gold|vintage|old film|antique/.test(g)) return 'sepia';
  if (/black|b&w|\bbw\b|mono|gr[ae]y ?scale|noir/.test(g)) return 'bw';
  if (/teal|orange/.test(g)) return 'teal-orange';
  if (/cool|night|blue|cold/.test(g)) return 'cool';
  if (/warm|daylight|sunny/.test(g)) return 'warm';
  if (/natural|none|original|no grade|plain/.test(g)) return 'none';
  if (/auto|default|mood/.test(g)) return 'auto';
  return null;
}
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const num = (v, d = 1) => Math.round(+v * 10 ** d) / 10 ** d;

// The Director's own edits on a shot, compactly.
function edits(s, i, has) {
  const b = [];
  if (s.trim) b.push(`trim ${num(s.trim[0])}-${num(s.trim[1])}s`);
  if (s.speed) b.push(`speed ${num(s.speed, 2)}x`);
  if (s.reverse) b.push('reversed');
  if (s.freeze) b.push(`freeze ${num(s.freeze.dur)}s at ${num(s.freeze.at)}s`);
  if (s.crop) b.push(`reframed to ${['x', 'y', 'w', 'h'].map(k => num(s.crop[k], 2)).join(',')}`);
  if (s.grade) b.push(`grade ${s.grade}`);
  if (s.keyhole) b.push(`mask ${s.keyhole}`);
  if (s.blur?.length) b.push(`${s.blur.length} hidden region${s.blur.length > 1 ? 's' : ''}`);
  if (s.trans) b.push(`cut in: ${s.trans}`);
  if (s.pip) b.push(`picture-in-picture (${s.pip.from || 'clip'}, ${s.pip.pos})`);
  if (s.particles) b.push(`particles ${s.particles}`);
  if (s.clipMix > 0) b.push(`clip sound ${Math.round(s.clipMix * 100)}%`);
  if (s.fill) b.push(`frame ${s.fill}`);
  if (has.info) { const x = has.info(i); if (x) b.push(x); }
  return b;
}

// The film as the director sees it: one line a shot. Long films get shorter lines.
export function filmView(P, has, width = 0) {
  const n = P.scenes.length, w = width || (n > 60 ? 50 : n > 25 ? 80 : 130);
  const name = id => P.characters.find(c => c.id === id)?.name || id;
  const shots = P.scenes.map((s, i) => {
    const bits = [`#${i + 1}`];
    if (s.card) {
      const c = s.card;
      bits.push(c.kind === 'disclaimer' ? `DISCLAIMER CARD "${cut(c.text, 80)}"` : c.kind === 'chapter' ? `CHAPTER CARD ${c.num ?? ''} "${cut(c.title, 40)}"` : `TITLE CARD "${cut(c.title, 40)}"`);
    } else if (s.map) {
      const m = s.map;
      bits.push(`MAP "${cut(m.title, 40)}"${m.year ? ' ' + m.year : ''}: ${[...(m.regions || []), ...(m.pins || [])].map(p => p.name).filter(Boolean).slice(0, 8).join(', ')}${m.routes?.length ? `, ${m.routes.length} route(s)` : ''}`);
    } else if (s.title) bits.push(`[${cut(s.title, 30)}]`);
    const many = (s.dialogue || []).length > 1;
    (s.dialogue || []).forEach((d, k) => bits.push(`${many ? `L${k + 1} ` : ''}${name(d.character)}: "${cut(d.line, w)}"${d.delivery ? ` [${cut(d.delivery, 24)}]` : ''}`));
    if (s.narration) bits.push(`narration: "${cut(s.narration, w)}"${s.narrDelivery ? ` [${cut(s.narrDelivery, 24)}]` : ''}`);
    if (!s.card && !s.map) {
      bits.push(`picture: ${cut(s.visual, w)}`);
      bits.push(`cam ${s.camera || 'drift'}, sound ${s.ambience || 'none'}`);
    }
    if (+s.hold) bits.push(`hold +${s.hold}s`);
    if (s.motion != null && !s.card && !s.map) bits.push(`motion ${Math.round(s.motion * 100)}`);
    if (s.expr && s.expr !== 'auto') bits.push(`face ${s.expr}`);
    if (s.text?.text) bits.push(`text(${s.text.style || 'title'}): "${cut(s.text.text, 40)}"`);
    if (s.magic) bits.push(`look ${s.magic}`);
    bits.push(...edits(s, i, has));
    if (!s.card && !s.map) bits.push(has.video(i) ? 'moving clip' : has.image(i) ? 'still' : 'not painted');
    return bits.join(' · ');
  });
  return `Film "${P.title}" · ${P.language || 'English'} · ${P.options?.format || '16:9'} · ${n} shots · captions ${P.look?.captions || 'karaoke'} · music ${P.moodOverride || 'auto'} (story mood ${P.mood || 'epic'}), volume ${Math.round((P.musicVol ?? 0.55) * 100)}% · film grade ${P.film?.grade || 'auto (from the mood)'}${has.rendered ? ` · ${has.rendered()}` : ''}
Cast: ${P.characters.map(c => `${c.name} (${c.id}, ${ageOf(c)}-year-old ${c.gender || ''}, outfit ${outfitLabel(c.outfit)}${c.wardrobe?.length > 1 ? `, wardrobe: ${c.wardrobe.map(w => `${w.wid}=${outfitLabel(w)}`).join(', ')}` : ''}${has.cast ? ', ' + has.cast(c) : ''})${c.info ? ` info: ${cut(c.info, width ? 60 : 140)}` : ''}`).join('; ') || 'none'}
${shots.join('\n')}`;
}

const TOOLS = `Actions (shot numbers are as in the list; several actions may refer to the same list):
{"do":"set_line","shot":3,"line":1,"text":"new spoken line","speaker":"c1","delivery":"whisper"}   (line: which spoken line of the shot, L1, L2…, default 1; speaker and delivery optional)
{"do":"set_delivery","shot":3,"line":1,"delivery":"${DELIVERIES.join('|')}|or a few words, e.g. tired and slow"}   (how a line is spoken; "line":"narration" for the narration; only that line is voiced again)
{"do":"set_outfit","character":"c1","outfit":"an outfit name or words, e.g. maroon silk saree, school uniform, white open-collar shirt & jeans","shots":[3,4]}   (shots optional: without them it is the character's main outfit; adult-only looks are refused for anyone under 18; the shots are repainted)
{"do":"set_voice","character":"c1","voice":"a voice name from the cast list, or words: deep calm male, soft young female, studio"}   ("character":"narrator" for the narrator)
{"do":"set_narration","shot":3,"text":""}
{"do":"set_visual","shot":3,"text":"what the camera sees","repaint":true}
{"do":"set_action","shot":3,"text":"what the characters do"}
{"do":"set_camera","shot":3,"camera":"${CAMS.join('|')}"}
{"do":"set_ambience","shot":3,"ambience":"${AMBS.join('|')}"}
{"do":"set_title","shot":1,"text":"on-screen text, empty to remove","style":"${TEXT_STYLES.join('|')}"}
{"do":"hold","shot":3,"seconds":2}   (0-5 extra seconds on screen)
{"do":"set_expression","shots":[3],"expression":"auto|neutral|smile|laugh|sad|angry|surprised|worried"}
{"do":"set_motion","shots":[3],"amount":70}   (how much the characters move: 0 still, 35 subtle, 50 normal, 100 very lively)
{"do":"magic_edit","shots":[2,3],"look":"${LOOKS.join('|')}","backdrop":"only for look backdrop"}   (new look, repainted)
{"do":"repaint","shots":[4]}
{"do":"insert_shot","after":3,"visual":"","action":"","line":"","speaker":"c1","narration":""}   (painted automatically; after 0 = at the start)
{"do":"delete_shot","shots":[5]}
{"do":"move_shot","shot":6,"to":2}
{"do":"set_captions","style":"${CAPTIONS.join('|')}"}
{"do":"set_music","mood":"${MOODS.join('|')}","volume":55}
Clip editing (no repainting):
{"do":"trim","shot":3,"in":1.5,"out":6}   (which seconds of the shot's clip play)
{"do":"split","shot":3,"at":2.5}   (cut the shot in two at that second)
{"do":"speed","shots":[3],"rate":0.5}   (0.25-4; below 1 is slow motion)
{"do":"reverse","shots":[3],"on":true}
{"do":"freeze","shot":3,"at":2,"seconds":2}   (hold the frame at that second for some seconds; seconds 0 removes)
{"do":"reframe","shot":3,"zoom":1.5,"cx":0.75,"cy":0.5}   (zoom in / crop / reframe on a point of the picture, 0-1; or "x","y","w","h" for a box; zoom 1 resets)
{"do":"set_grade","grade":"${GRADES.join('|')}","shots":[4,5]}   (colour look; without shots = the whole film; sepia = warm documentary sepia-gold, bw = black and white, e.g. a flashback)
{"do":"keyhole","shots":[2],"shape":"${MASKS.join('|')}"}   (seen through a keyhole, an iris circle or a heavy vignette)
{"do":"blur_region","shot":3,"x":0.7,"y":0.05,"w":0.25,"h":0.1,"mode":"${BLURS.join('|')}"}   (hide burned-in text, a logo or a face; "clear":true removes all)
{"do":"set_transition","shots":[4],"kind":"${TRANS.join('|')}"}   (the cut INTO these shots)
{"do":"pip","shot":3,"source":5,"pos":"tr|tl|br|bl","size":30}   (shot 5's picture or clip in a corner of shot 3, size % of the width; "source":"file" lets the person pick a clip; "off":true removes)
{"do":"set_particles","shots":[2],"kind":"${PARTICLES.join('|')}"}   (overlay: floating dust, embers, rain...)
{"do":"fill_frame","shots":[3],"mode":"${FILLS.join('|')}"}   (how a clip fills the frame: fill = crop to the frame keeping the people in view (default; black bars are always cut off), fit = the whole picture, blur-fill = the whole picture over a blurred copy)
{"do":"best_part","shots":[3]}   (the shot plays the best part of its clip, picked by AI vision)
{"do":"mix_audio","shot":3,"volume":40,"duck":true}   (a clip's own sound mixed under the film's voices; duck = quieter while someone speaks; 0 mutes)
Cards and shots drawn without painting:
{"do":"chapter_card","after":0,"number":1,"title":"chapter title","label":"CHAPTER 1"}   (title and label in the film's language)
{"do":"title_card","after":0,"title":"the film's title","subtitle":""}
{"do":"disclaimer_card","text":"opening disclaimer"}   (always the first shot)
{"do":"map_shot","after":2,"title":"","year":"1857","regions":[{"name":"","x":0.45,"y":0.35,"r":0.08,"year":""}],"pins":[{"name":"","x":0.6,"y":0.5}],"routes":[{"from":"name","to":"name","label":""}],"narration":""}   (animated parchment map; x,y 0-1, rough real positions, north up; names in the film's language)
Clips from elsewhere:
{"do":"insert_clip","after":3,"from":"stock","query":"3-6 English search words","visual":"what it must show","volume":0}   (free real footage, picked by AI vision; scenery and crowds only; volume = its own sound under the voices, no mix_audio needed)
{"do":"insert_clip","after":3,"from":"shot","shot":2,"in":0,"out":3}   (re-use part of a shot's clip)
{"do":"insert_clip","after":3,"from":"file","volume":60}   (the person picks a video file; volume = its own sound)
{"do":"swap_stock","shot":4,"query":""}   (a different stock clip for a stock shot)
Generators (paint pictures):
{"do":"new_character","name":"","description":"nationality, age, face, hair, skin tone, build, clothes with colours","gender":"female","age":"child|teen|adult|elder","role":"supporting","shots":[3]}   (a new cast member: a person who does not exist; shots = where they appear)
{"do":"generate_image","after":4,"prompt":"what to paint"}   (a NEW painted shot after shot 4; "shot":4 instead of "after" repaints shot 4 from the prompt)
{"do":"recast","character":"c2","description":"new look, optional"}   (new casting portrait; that character's shots are repainted)
Other:
{"do":"handoff","tool":"${HANDOFF.map(t => t.id).join('|')}","shots":[2,3]}   (prompts to make those shots' clips in a free AI video tool: ${HANDOFF.map(t => t.name).join(', ')}; the person makes them there and brings them back; "Google Flow prompts" = tool flow)
{"do":"export_pack"}   (the film's parts for editing in YouTube Create or any editor: MP4, subtitles, voice, music and each shot's clip, numbered)
{"do":"undo"}   (undo the last change)
Long jobs (at most ONE per reply, it runs after the others):
{"do":"gpu_fix","shots":[2],"kind":"paint|animate|lip"}   (free GPU: new picture+motion, new motion, or lips re-synced; ~10 min + 1 min a shot)
{"do":"make_short"}   (9:16 Short from the best moment, as a new film)
{"do":"translate","language":"Hindi"}   (new film in another language)
{"do":"resize","format":"${FORMATS.join('|')}"}   (new film in another frame)
{"do":"render"}   (render the MP4)`;

const SYSTEM = `You are the AI Director inside VoiceFrame Studio, a film app. The person tells you what to change; you change the film with actions, or answer questions about it. You can edit at any stage, also after the MP4 is rendered: the film is rendered again by itself after your edits.
Rules:
- Reply with ONLY valid JSON: {"reply":"1-3 friendly sentences in the person's language saying what you did or will do","actions":[...]}.
- Act on the person's LAST message only. Earlier messages are context: their changes are already in the film (see "done"); never repeat them.
- Use only the actions listed. Keep the story, cast and language unless asked. Write spoken lines, narration, card and map text in the film's language; "visual", "action", "query" and "description" in English.
- When the request is unclear, ask a short question with "actions":[].
- A different time of day, weather, season or place for a shot ("make it night", "rainy", "at the beach") is magic_edit, which repaints the picture; add a matching set_ambience only if asked about sound.
- "Title", "caption on screen", a place or a date shown over a shot is set_title; a separate card between shots is chapter_card / title_card; subtitles for all speech are set_captions.
- A documentary look: set_grade sepia for the film; a flashback: set_grade bw on those shots; a map of places or a journey: map_shot.
- Cutting, slowing, speeding, reversing, freezing, cropping, hiding text or logos, transitions and picture-in-picture never need repainting. Zooming in, cropping or reframing a shot is reframe, never set_action.
- set_action and set_visual describe what happens in the story, never an edit.
- How a line sounds (whispered, angry, slower, shouted) is set_delivery on that line; a different voice for a character or the narrator is set_voice (pick from the voices in the cast list or describe one); new words for a line are set_line. Characters' "info" says how they look and act: keep their lines and actions true to it.
- Safety first (a public film site for all ages): never make or describe anything sexual or nude, anything sexual, romantic or suggestive with a child or teenager, graphic gore, hate symbols or real living people; for such a request reply in one sentence that VoiceFrame can't make it, with "actions":[]. Children always stay fully clothed in safe, ordinary situations.
- Main and speaking characters are always generated people who do not exist (new_character); stock footage (insert_clip from stock) only for scenery and background crowds, never with lines or lip-sync. Never use a real person's likeness or other creators' videos.
- "Undo", "undo again", "go back", "revert that" is undo, one per request (never redo or repeat an earlier change).
- Never YouTube footage: its videos are copyrighted and its terms forbid downloading. If asked, say so in one sentence and use insert_clip / swap_stock (free archives: Wikimedia Commons, the Internet Archive, Pexels) instead.
- When the film line says a free service is used up, do not ask it again (no repaint or new pictures): offer handoff instead, and say when it comes back.
- You cannot use other websites yourself: for Google Flow, Kling, Hailuo, PixVerse, Vidu, Luma, Pika or Meta AI write handoff prompts; YouTube Create is an editing app, so for it use export_pack.
- Never invent shot numbers outside the list. Changing a picture needs repaint; changing a line of a shot with a moving clip needs a gpu_fix "lip" later (mention it).
${TOOLS}`;

const BUDGET = 23000;
// One turn: returns {reply, actions} with the actions checked against the film.
export async function askDirector(P, has, history, message, { signal, onStatus } = {}) {
  // The relay reads only the first 6 messages (24,000 characters at most): one system
  // message, the last two exchanges and the request; a long film's view gets shorter lines.
  // earlier replies carry what was really done, so the writer does not repeat them
  const recent = history.slice(-4).map(m => ({ role: m.role, content: m.role === 'assistant' ? JSON.stringify({ reply: cut(m.content, 300), done: (m.done || []).slice(0, 6).map(d => cut(d, 80)) }) : cut(m.content, 600) }));
  const size = (...x) => JSON.stringify(x).length;
  let view = '';
  for (const width of [0, 60, 36, 20, 10]) {
    view = filmView(P, has, width);
    if (size(SYSTEM, view, recent, message) < BUDGET) break;
  }
  const room = BUDGET - size(SYSTEM, recent, message) - 200;
  if (size(view) > room) view = view.slice(0, Math.max(2000, Math.floor(room * 0.85))) + '\n… (more shots not shown)';
  const msgs = [
    { role: 'system', content: SYSTEM + '\n\nThe film now:\n' + view },
    ...recent,
    { role: 'user', content: message }
  ];
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await chat(msgs, { signal, temperature: 0.4, onWait: sec => onStatus?.(sec ? `The free writer is busy, asking again in ${sec}s` : 'Thinking…') });
    try {
      const out = parseJSON(text);
      const actions = checkActions(out.actions, P);
      console.info('AI Director actions', JSON.stringify(out.actions), '→', JSON.stringify(actions));
      return { reply: cut(out.reply || 'Done.', 600), actions };
    } catch (e) { lastErr = e; console.warn('Director reply', text); }
  }
  throw new Error('The AI Director’s answer could not be read. Please ask again. ' + (lastErr?.message || ''));
}

// Keep only well-formed actions on shots that exist; numbers become 0-based indexes.
export function checkActions(list, P) {
  const n = P.scenes.length, out = [];
  const shot = v => { const k = Math.round(+v) - 1; return k >= 0 && k < n ? k : null; };
  const shots = v => [...new Set((Array.isArray(v) ? v : [v]).map(shot).filter(k => k !== null))].sort((a, b) => a - b);
  const str = (v, max = 400) => cut(v, max);
  const one = (v, allowed, dflt) => allowed.includes(v) ? v : dflt;
  const f01 = (v, d) => Number.isFinite(+v) && v !== null && v !== '' ? Math.max(0, Math.min(1, +v)) : d;
  const secs = (v, max = 600) => Number.isFinite(+v) && v !== null && v !== '' ? Math.max(0, Math.min(max, Math.round(+v * 100) / 100)) : null;
  const after = v => { const k = Math.round(+v); return k >= 0 && k <= n ? k - 1 : null; }; // -1 = at the start
  const charOf = v => P.characters.find(c => c.id === v || c.name?.toLowerCase() === String(v || '').toLowerCase());
  let long = false;
  // small writers sometimes send one action, or the list as an object with keys 0, 1, ...
  const all = Array.isArray(list) ? list : list && typeof list === 'object' ? (list.do ? [list] : Object.values(list)) : [];
  for (const a of all) {
    if (!a || typeof a !== 'object') continue;
    const d = a.do || a.action || a.type;
    if (LONG.has(d) && long) continue;
    const before = out.length;
    switch (d) {
      case 'set_line': case 'set_narration': case 'set_visual': case 'set_action': {
        const k = shot(a.shot); if (k === null) break;
        const speaker = charOf(a.speaker)?.id;
        const o = { do: d, shot: k, text: str(a.text), speaker, repaint: d === 'set_visual' && a.repaint !== false };
        if (d === 'set_line') {
          const L = Math.round(+String(a.line ?? 1).replace(/^L/i, '')) - 1;
          o.line = L >= 0 && L < Math.max(1, (P.scenes[k].dialogue || []).length + 1) ? L : 0;
          if (a.delivery) o.delivery = str(a.delivery, 60);
        }
        out.push(o);
        break;
      }
      case 'set_delivery': {
        const k = shot(a.shot), del = str(a.delivery, 60); if (k === null || !del) break;
        const sc = P.scenes[k], narr = /narr/i.test(String(a.line)) || (!(sc.dialogue || []).length && sc.narration);
        const L = narr ? -1 : Math.round(+String(a.line ?? 1).replace(/^L/i, '')) - 1;
        if (!narr && !(sc.dialogue?.[L]?.line)) break;
        out.push({ do: d, shot: k, line: L, delivery: /^(none|normal|default|auto)$/i.test(del) ? '' : del });
        break;
      }
      case 'set_outfit': {
        const c = charOf(a.character ?? a.id), o = str(a.outfit, 160);
        if (c && o) out.push({ do: d, character: c.id, outfit: o, shots: shots(a.shots ?? []) });
        break;
      }
      case 'set_voice': {
        const who = /^narrat/i.test(String(a.character)) ? 'narrator' : charOf(a.character ?? a.id)?.id;
        const v = str(a.voice, 80);
        if (who && v) out.push({ do: d, character: who, voice: v });
        break;
      }
      case 'set_camera': { const k = shot(a.shot); if (k !== null && CAMS.includes(a.camera)) out.push({ do: d, shot: k, camera: a.camera }); break; }
      case 'set_ambience': { const k = shot(a.shot); if (k !== null && AMBS.includes(a.ambience)) out.push({ do: d, shot: k, ambience: a.ambience }); break; }
      case 'set_title': { const k = shot(a.shot); if (k !== null) out.push({ do: d, shot: k, text: str(a.text, 90), style: one(a.style, TEXT_STYLES, 'title') }); break; }
      case 'set_expression': { const s = shots(a.shots ?? a.shot); if (s.length && EXPRS.includes(a.expression)) out.push({ do: d, shots: s, expression: a.expression }); break; }
      case 'set_motion': { const s = shots(a.shots ?? a.shot); if (s.length) out.push({ do: d, shots: s, amount: Math.max(0, Math.min(100, Math.round(+a.amount || 50))) }); break; }
      case 'hold': { const k = shot(a.shot); if (k !== null) out.push({ do: d, shot: k, seconds: Math.max(0, Math.min(5, Math.round(+a.seconds || 0))) }); break; }
      case 'magic_edit': {
        const s = shots(a.shots ?? a.shot), look = one(a.look, LOOKS, null);
        if (s.length && look && (look !== 'backdrop' || a.backdrop)) out.push({ do: d, shots: s, look, backdrop: str(a.backdrop, 120) });
        break;
      }
      case 'repaint': case 'delete_shot': { const s = shots(a.shots ?? a.shot); if (s.length) out.push({ do: d, shots: s }); break; }
      case 'insert_shot': {
        const at = after(a.after); if (at === null) break;
        const speaker = P.characters.some(c => c.id === a.speaker) ? a.speaker : P.characters[0]?.id;
        out.push({ do: d, after: at, visual: str(a.visual), action: str(a.action), line: str(a.line, 200), speaker, narration: str(a.narration) });
        break;
      }
      case 'move_shot': { const k = shot(a.shot), to = shot(a.to); if (k !== null && to !== null && k !== to) out.push({ do: d, shot: k, to }); break; }
      case 'set_captions': if (CAPTIONS.includes(a.style)) out.push({ do: d, style: a.style }); break;
      case 'set_music': {
        const v = a.volume == null ? null : Math.max(0, Math.min(100, Math.round(+a.volume)));
        out.push({ do: d, mood: one(a.mood, MOODS, null), volume: Number.isFinite(v) ? v : null });
        break;
      }
      // ---- clip editing ----
      case 'trim': {
        const k = shot(a.shot), i = secs(a.in ?? a.from ?? 0), o = secs(a.out ?? a.to);
        if (k !== null && (o === null || o > i + 0.2)) out.push({ do: d, shot: k, in: i || 0, out: o });
        break;
      }
      case 'split': { const k = shot(a.shot), at = secs(a.at); if (k !== null && at > 0.2) out.push({ do: d, shot: k, at }); break; }
      case 'speed': { const s = shots(a.shots ?? a.shot), r = +a.rate || +a.speed; if (s.length && r > 0) out.push({ do: d, shots: s, rate: Math.max(0.25, Math.min(4, Math.round(r * 100) / 100)) }); break; }
      case 'reverse': { const s = shots(a.shots ?? a.shot); if (s.length) out.push({ do: d, shots: s, on: a.on !== false }); break; }
      case 'freeze': { const k = shot(a.shot); if (k !== null) out.push({ do: d, shot: k, at: secs(a.at) || 0, seconds: Math.min(10, secs(a.seconds ?? a.dur) ?? 2) }); break; }
      case 'reframe': {
        const k = shot(a.shot); if (k === null) break;
        let w = f01(a.w, null), h = f01(a.h, null);
        // "zoom":2 with a centre is a box too
        if (w === null && +a.zoom > 1) { w = h = 1 / Math.min(4, +a.zoom); }
        if (w === null || w >= 0.98) { out.push({ do: d, shot: k, reset: true }); break; }
        h ??= w; w = Math.max(0.15, w); h = Math.max(0.15, h);
        const cx = f01(a.cx, null), cy = f01(a.cy, null);
        const x = f01(a.x, cx !== null ? cx - w / 2 : (1 - w) / 2), y = f01(a.y, cy !== null ? cy - h / 2 : (1 - h) / 2);
        out.push({ do: d, shot: k, crop: { x: Math.min(x, 1 - w), y: Math.min(y, 1 - h), w, h } });
        break;
      }
      case 'set_grade': case 'grade': {
        const g = gradeName(a.grade ?? a.look ?? a.preset ?? a.style); if (!g) break;
        // no shots, "all" or an empty list = the whole film
        const sel = a.shots ?? a.shot, whole = sel == null || sel === 'all' || (Array.isArray(sel) && !sel.length);
        const s = whole ? null : shots(sel);
        if (s && !s.length) break;
        out.push({ do: 'set_grade', grade: g, shots: s });
        break;
      }
      case 'keyhole': case 'mask': { const s = shots(a.shots ?? a.shot); if (s.length) out.push({ do: 'keyhole', shots: s, shape: one(a.shape, MASKS, 'keyhole') }); break; }
      case 'blur_region': case 'hide_region': {
        const k = shot(a.shot); if (k === null) break;
        if (a.clear) { out.push({ do: 'blur_region', shot: k, clear: true }); break; }
        const w = f01(a.w, 0.2), h = f01(a.h, 0.1);
        if (w < 0.01 || h < 0.01) break;
        out.push({ do: 'blur_region', shot: k, box: { x: Math.min(f01(a.x, 0), 1 - w), y: Math.min(f01(a.y, 0), 1 - h), w, h, mode: one(a.mode, BLURS, 'blur') } });
        break;
      }
      case 'set_transition': case 'transition': { const s = shots(a.shots ?? a.shot); const t = one(a.kind ?? a.transition, TRANS, null); if (s.length && t) out.push({ do: 'set_transition', shots: s, kind: t }); break; }
      case 'pip': {
        const k = shot(a.shot); if (k === null) break;
        if (a.off) { out.push({ do: d, shot: k, off: true }); break; }
        const src = a.source === 'file' ? 'file' : shot(a.source ?? a.from);
        if (src === null || src === k) break;
        out.push({ do: d, shot: k, source: src, pos: one(a.pos, ['tr', 'tl', 'br', 'bl'], 'tr'), size: Math.max(15, Math.min(50, Math.round(+a.size || 30))) / 100 });
        break;
      }
      case 'set_particles': case 'particles': { const s = shots(a.shots ?? a.shot); const p = one(a.kind, PARTICLES, null); if (s.length && p) out.push({ do: 'set_particles', shots: s, kind: p }); break; }
      case 'fill_frame': case 'fit': { const s = shots(a.shots ?? a.shot); const m = one(a.mode ?? a.kind, FILLS, /blur/.test(a.mode || '') ? 'blur-fill' : /fit|whole|uncrop|no crop/i.test(a.mode || '') ? 'fit' : 'fill'); if (s.length) out.push({ do: 'fill_frame', shots: s, mode: m }); break; }
      case 'best_part': { const s = shots(a.shots ?? a.shot); if (s.length) out.push({ do: d, shots: s }); break; }
      case 'mix_audio': { const k = shot(a.shot); if (k !== null) out.push({ do: d, shot: k, volume: Math.max(0, Math.min(100, Math.round(+a.volume || 0))), duck: a.duck !== false }); break; }
      // ---- cards and maps ----
      case 'chapter_card': case 'title_card': {
        const at = after(a.after ?? 0); if (at === null) break;
        const title = str(a.title, 90); if (!title && d === 'title_card' && !P.title) break;
        out.push({ do: d, after: at, title, num: a.number ?? a.num ?? null, label: str(a.label, 40), sub: str(a.subtitle ?? a.sub, 90), seconds: secs(a.seconds, 10) });
        break;
      }
      case 'disclaimer_card': { const text = str(a.text, 500); if (text) out.push({ do: d, text, title: str(a.title, 40), seconds: secs(a.seconds, 12) }); break; }
      case 'map_shot': {
        const at = after(a.after ?? n); if (at === null) break;
        const pt = p => p && typeof p === 'object' ? { name: str(p.name, 40), x: f01(p.x, 0.5), y: f01(p.y, 0.5), ...(p.r != null ? { r: Math.max(0.03, Math.min(0.3, +p.r || 0.08)) } : {}), ...(p.year ? { year: str(p.year, 12) } : {}) } : null;
        const regions = (Array.isArray(a.regions) ? a.regions : []).map(pt).filter(Boolean).slice(0, 8).map(r => ({ r: 0.08, ...r }));
        const pins = (Array.isArray(a.pins) ? a.pins : []).map(pt).filter(Boolean).slice(0, 8);
        const ends = v => Array.isArray(v) ? [f01(v[0], 0.5), f01(v[1], 0.5)] : str(v, 40);
        const routes = (Array.isArray(a.routes) ? a.routes : []).filter(r => r && r.from && r.to).slice(0, 6).map(r => ({ from: ends(r.from), to: ends(r.to), label: str(r.label, 40) }));
        if (!regions.length && !pins.length) break;
        out.push({ do: d, after: at, map: { title: str(a.title, 60), year: str(a.year, 12), regions, pins, routes }, narration: str(a.narration), seconds: secs(a.seconds, 15) });
        break;
      }
      // ---- clips from elsewhere ----
      case 'insert_clip': {
        const at = after(a.after ?? n); if (at === null) break;
        const from = one(a.from ?? a.source, ['stock', 'shot', 'file'], a.query ? 'stock' : null);
        const vol = a.volume == null ? null : Math.max(0, Math.min(100, Math.round(+a.volume || 0)));
        if (from === 'stock' && (a.query || a.visual)) out.push({ do: d, after: at, from, query: str(a.query || a.visual, 80), visual: str(a.visual || a.query, 300), era: str(a.era, 80), volume: vol });
        if (from === 'shot') { const k = shot(a.shot); if (k !== null) out.push({ do: d, after: at, from, shot: k, in: secs(a.in), out: secs(a.out) }); }
        if (from === 'file') out.push({ do: d, after: at, from, volume: vol ?? 70 });
        break;
      }
      case 'swap_stock': { const k = shot(a.shot); if (k !== null) out.push({ do: d, shot: k, query: str(a.query, 80) }); break; }
      // ---- generators ----
      case 'new_character': {
        const desc = str(a.description ?? a.appearance, 400); if (!desc) break;
        out.push({ do: d, name: str(a.name, 40) || 'New character', description: desc, gender: str(a.gender, 12) || 'female', age: one(a.age, ['child', 'teen', 'adult', 'elder'], 'adult'),
          role: str(a.role, 30) || 'supporting', personality: str(a.personality, 80), shots: shots(a.shots ?? []) });
        break;
      }
      case 'generate_image': {
        const prompt = str(a.prompt ?? a.visual, 400); if (!prompt) break;
        const k = a.shot != null ? shot(a.shot) : null, at = a.shot == null ? after(a.after) : null;
        // a card or map has no picture: the new picture becomes a shot after it
        if (k !== null && (P.scenes[k].card || P.scenes[k].map)) out.push({ do: d, after: k, prompt });
        else if (k !== null) out.push({ do: d, shot: k, prompt });
        else if (at !== null) out.push({ do: d, after: at, prompt });
        break;
      }
      case 'recast': { const c = charOf(a.character ?? a.id); if (c) out.push({ do: d, character: c.id, description: str(a.description, 400) }); break; }
      case 'flow_prompts': case 'handoff': {
        const tool = d === 'flow_prompts' ? 'flow' : toolName(a.tool ?? a.service) || 'flow';
        const s = shots(a.shots ?? a.shot ?? P.scenes.map((_, i) => i + 1)).filter(k => !P.scenes[k].card && !P.scenes[k].map);
        if (s.length) out.push({ do: 'handoff', tool, shots: s.slice(0, 12) });
        break;
      }
      case 'export_pack': out.push({ do: d }); break;
      case 'undo': out.push({ do: d }); break;
      case 'gpu_fix': { const s = shots(a.shots ?? a.shot); if (s.length) out.push({ do: d, shots: s, kind: one(a.kind, ['paint', 'animate', 'lip'], 'animate') }); break; }
      case 'make_short': case 'render': out.push({ do: d }); break;
      case 'translate': if (a.language) out.push({ do: d, language: str(a.language, 40) }); break;
      case 'resize': if (FORMATS.includes(a.format)) out.push({ do: d, format: a.format }); break;
    }
    if (LONG.has(d) && out.length > before) long = true;
  }
  return out;
}

const CAMERA = {
  'push-in': 'slow dolly push-in', 'pull-out': 'slow dolly pull-back', 'pan-left': 'slow pan left', 'pan-right': 'slow pan right',
  'tilt-up': 'slow tilt up', 'tilt-down': 'slow tilt down', 'track-left': 'tracking shot moving left alongside the people',
  'track-right': 'tracking shot moving right alongside the people', orbit: 'slow orbit around the people', handheld: 'gentle handheld camera', drift: 'gentle drifting camera'
};
// The prompt for shot i in a tool: photo-real, the cast's looks (their casting briefs), the
// setting, camera, action and the spoken line in quotes (spoken by the tool when it makes
// speech); the clip length and frame shape match the film; it fits the tool's limit.
// seconds: how long the shot is in the film (the tool's nearest clip length is asked for).
export function handoffPrompt(P, i, toolId = 'flow', seconds = 0) {
  const s = P.scenes[i] || {}, T = toolOf(toolId);
  if (s.card || s.map) return '';
  const want = Math.max(+seconds || 0, 3);
  const len = T.lens.find(l => l >= want) || T.lens[T.lens.length - 1];
  const fmt = P.options?.format || '16:9', ratio = T.ratios.includes(fmt) ? fmt : T.ratios[0];
  const cast = (s.characters || []).map(id => P.characters.find(c => c.id === id)).filter(Boolean);
  const lang = P.language || 'English';
  const said = (s.dialogue || []).filter(d => d.line).map(d => ({ who: P.characters.find(c => c.id === d.character)?.name || 'The character', line: d.line }));
  const end = t => t.replace(/[.\s…]*$/, '') + '.';
  const build = k => {
    const look = cast.map(c => `${c.name}: ${cut(c.casting || c.appearance, [260, 160, 90][k]).replace(/[.\s]*$/, '.')}${k < 2 && c.outfit ? ' ' + cut(outfitPrompt(outfitForShot(c, s), c), [200, 110][k]).replace(/[.\s]*$/, '.') : ''}`).join(' ');
    return [
      `Photo-real live-action film shot, ${len} seconds, ${ratio}${P.setting ? `, ${cut(P.setting, [160, 100, 60][k])}` : ''}.`,
      look && `Characters (people who do not exist; keep these exact looks): ${look}`,
      `Scene: ${end(cut(s.visual, [400, 240, 140][k]))}`,
      s.action && `Action: ${end(cut(s.action, [300, 180, 100][k]))}`,
      `Camera: ${CAMERA[s.camera] || 'gentle drifting camera'}, ${s.shot || 'medium'} shot, 35mm lens, natural light, shallow depth of field.`,
      said.length && (T.speech
        ? `Dialogue with natural lip-sync, spoken in ${lang}: ${said.map(d => `${d.who} says: "${d.line}"`).join(' ')}`
        : `${said.map(d => d.who).join(' and ')} speak${said.length > 1 ? '' : 's'} with natural mouth movement (silent clip, the voice is added later): ${said.map(d => `"${d.line}"`).join(' ')}`),
      !said.length && (T.speech ? 'No one speaks on camera; ambient sound only.' : 'No one speaks on camera.'),
      'No text, subtitles, logos or watermarks on screen.'
    ].filter(Boolean).join(' ');
  };
  for (const k of [0, 1, 2]) { const p = build(k); if (p.length <= T.max) return p; }
  return cut(build(2), T.max);
}
export const flowPrompt = (P, i, seconds) => handoffPrompt(P, i, 'flow', seconds);
