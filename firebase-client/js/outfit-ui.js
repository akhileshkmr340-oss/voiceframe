// The outfit picker: catalogue tabs, occasion and mood filters, search, colour and fabric,
// "Mix & match" slots, free words, a wardrobe per character (one outfit per shot) and
// "✨ Suggest outfits" from the AI writer. Only outfits the character's age and gender allow
// are ever shown or suggested (outfits.js).
import { chat, parseJSON } from './ai.js?v=63';
import { OUTFITS, CATEGORIES, OCCASIONS, SLOTS, COLOURS, FABRICS, outfitById, outfitsFor, allowed, outfitIssue, outfitLabel, ageOf, personWords } from './outfits.js?v=63';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toast = () => {};
const st = { c: null, film: null, cat: 'all', occ: '', mood: '', wardrobe: [], cur: 0, onDone: null, shots: {} };
const CAT_ICON = Object.fromEntries(CATEGORIES.map(([k, , i]) => [k, i]));
const SWATCH = { white: '#f4f1ea', ivory: '#f6efd9', cream: '#efe3c4', beige: '#d9c3a0', black: '#1b1b1f', charcoal: '#3a3a42', grey: '#8d8d95', navy: '#1e2b57', blue: '#3a6fd8', 'sky blue': '#8cc7f0', teal: '#1f9e95', green: '#2f9e4f', emerald: '#127a55', olive: '#6b7a32', mint: '#a6e3c5', yellow: '#f3d23c', mustard: '#d2a221', gold: '#d4a73b', saffron: '#f29a2e', orange: '#f07a2a', rust: '#b5502b', red: '#d63a3a', maroon: '#7a1f2b', wine: '#6a1b3a', pink: '#f08fb3', blush: '#f2c4c9', magenta: '#c4307d', lavender: '#b9a6e8', purple: '#7a43b8', brown: '#7a5233', tan: '#c49a6c', silver: '#c0c4cc', multicolour: 'linear-gradient(90deg,#f5b544,#ff5d8f,#8b5cf6,#2dd4bf)', pastel: 'linear-gradient(90deg,#f2c4c9,#b9a6e8,#a6e3c5)' };
const opts = (list, cur) => list.map(v => `<option value="${esc(v)}"${v === (cur || '') ? ' selected' : ''}>${v ? esc(v[0].toUpperCase() + v.slice(1)) : '—'}</option>`).join('');
const blank = () => ({ id: '', colour: '', fabric: '', text: '', slots: {} });
const range = s => { const out = []; for (const part of String(s || '').split(/[,\s]+/)) { const m = /^(\d+)(?:-(\d+))?$/.exec(part); if (m) for (let k = +m[1]; k <= +(m[2] || m[1]); k++) out.push(k); } return out; };

// open: { character (with gender, ageYears, outfit, wardrobe, info, role, era, setting), film: P or null, onDone({outfit, wardrobe, shots}) }
export function openOutfitPicker({ character, film = null, onDone }) {
  st.c = character; st.film = film; st.onDone = onDone;
  st.wardrobe = structuredClone(character.wardrobe?.length ? character.wardrobe : [{ wid: 'w1', label: 'Main outfit', ...(character.outfit || blank()) }]);
  const def = st.wardrobe.findIndex(w => character.outfit && w.id === character.outfit.id && (w.text || '') === (character.outfit.text || ''));
  st.cur = Math.max(0, def);
  // which shots wear which wardrobe outfit (in a film)
  st.shots = {};
  if (film) st.wardrobe.forEach(w => { st.shots[w.wid] = film.scenes.map((sc, i) => sc.outfits?.[character.id] === w.wid ? i + 1 : 0).filter(Boolean).join(', '); });
  st.cat = 'all'; st.occ = ''; st.mood = '';
  $('#opFor').textContent = `${character.name || 'Character'} · ${personWords(character)}`;
  $('#opSearch').value = '';
  $('#opSuggest').innerHTML = '';
  $('#opShotsRow').hidden = !film;
  render();
  $('#outfitPicker').showModal();
}
const wcur = () => st.wardrobe[st.cur];
function render() {
  const w = wcur();
  $('#opTabs').innerHTML = [['all', 'All', '🧵'], ...CATEGORIES].filter(([k]) => k === 'all' || outfitsFor(st.c).some(o => o.cat === k))
    .map(([k, l, i]) => `<button type="button" class="tab${st.cat === k ? ' active' : ''}" data-cat="${k}">${i} ${esc(l)}</button>`).join('');
  $('#opOcc').innerHTML = [['', 'Any occasion'], ...Object.entries(OCCASIONS)].map(([k, l]) => `<button type="button" class="chip${st.occ === k ? ' on' : ''}" data-occ="${k}">${esc(l)}</button>`).join('');
  const moods = [...new Set(outfitsFor(st.c).filter(o => st.cat === 'all' || o.cat === st.cat).flatMap(o => o.moods))].sort().slice(0, 24);
  $('#opMood').innerHTML = [['', 'Any mood'], ...moods.map(m => [m, m])].map(([k, l]) => `<button type="button" class="chip${st.mood === k ? ' on' : ''}" data-mood="${esc(k)}">${esc(l)}</button>`).join('');
  renderCards();
  $('#opColour').innerHTML = opts(COLOURS, w.colour); $('#opFabric').innerHTML = opts(FABRICS, w.fabric);
  $('#opText').value = w.text || '';
  $('#opSlots').innerHTML = SLOTS.map(([k, l]) => { const s = w.slots?.[k] || {}; return `<div class="op-slot" data-slot="${k}"><b>${l}</b><input class="op-s-text" value="${esc(s.text || '')}" placeholder="${esc(l.toLowerCase())}…" maxlength="80"><select class="op-s-colour">${opts(COLOURS, s.colour)}</select><select class="op-s-fabric">${opts(FABRICS, s.fabric)}</select></div>`; }).join('');
  $('#opWardrobe').innerHTML = st.wardrobe.map((x, k) => `<button type="button" class="op-w${k === st.cur ? ' on' : ''}" data-w="${k}"><span class="op-sw" style="background:${SWATCH[x.colour] || 'var(--panel2)'}">${CAT_ICON[outfitById(x.id)?.cat] || '✏'}</span><span><b>${esc(x.label || 'Outfit ' + (k + 1))}</b><small>${esc(outfitLabel(x))}</small></span></button>`).join('')
    + `<button type="button" class="btn btn-ghost btn-sm" id="opAddW">＋ Add outfit</button>`;
  $('#opLabel').value = w.label || '';
  $('#opShots').value = st.shots[w.wid] || '';
  $('#opNow').textContent = outfitLabel(w);
  $('#opIssue').textContent = outfitIssue([w.text, ...Object.values(w.slots || {}).map(s => s?.text)].join(' '), st.c);
}
function shownOutfits() {
  const q = $('#opSearch').value.trim().toLowerCase();
  return outfitsFor(st.c).filter(o => (st.cat === 'all' || o.cat === st.cat) && (!st.occ || o.occasions.includes(st.occ)) && (!st.mood || o.moods.includes(st.mood))
    && (!q || `${o.name} ${o.desc} ${o.region} ${o.era} ${o.moods.join(' ')}`.toLowerCase().includes(q)));
}
function renderCards() {
  const w = wcur(), list = shownOutfits();
  $('#opCount').textContent = `${list.length} outfit${list.length === 1 ? '' : 's'} for a ${personWords(st.c)}`;
  $('#opCards').innerHTML = list.map(o => `<button type="button" class="op-card${w.id === o.id ? ' on' : ''}" data-o="${o.id}" title="${esc(o.desc)}">
    <span class="op-icon">${CAT_ICON[o.cat]}</span><b>${esc(o.name)}</b><small>${esc(o.desc.split(',').slice(0, 3).join(','))}</small>
    <span class="op-meta">${esc(o.region)} · ${o.occasions.map(k => OCCASIONS[k].split(' /')[0]).slice(0, 3).join(', ')}${o.minAge >= 18 ? ' · 18+' : ''}</span></button>`).join('')
    || '<p class="tiny muted">No outfit matches: clear the filters, or describe it in your own words below.</p>';
}
function readForm() {
  const w = wcur();
  w.colour = $('#opColour').value; w.fabric = $('#opFabric').value; w.text = $('#opText').value.slice(0, 200);
  w.label = $('#opLabel').value.slice(0, 40) || w.label;
  w.slots = {};
  for (const el of document.querySelectorAll('#opSlots .op-slot')) {
    const s = { text: el.querySelector('.op-s-text').value.slice(0, 80), colour: el.querySelector('.op-s-colour').value, fabric: el.querySelector('.op-s-fabric').value };
    if (s.text || s.colour || s.fabric) w.slots[el.dataset.slot] = s;
  }
  if (!w.id && (w.text || Object.keys(w.slots).length)) w.id = 'custom';
  if (st.film) st.shots[w.wid] = $('#opShots').value;
}
// "✨ Suggest outfits": the free writer picks 5-10 catalogue outfits (only ones this
// character may wear) with the occasion each is for.
async function suggest() {
  const c = st.c, allowedList = outfitsFor(c);
  const film = st.film;
  $('#opSuggest').innerHTML = '<p class="tiny muted">The AI writer is choosing outfits…</p>';
  try {
    const story = film ? `Film: ${film.title || ''}. ${film.logline || ''} World: ${String(film.setting || '').slice(0, 200)}. Scenes: ${film.scenes.filter(s => (s.characters || []).includes(c.id)).slice(0, 12).map(s => s.title).filter(Boolean).join('; ')}` : '';
    const reply = await chat([
      { role: 'system', content: 'You are the costume designer of a family-friendly live-action film. Reply with ONLY valid JSON.' },
      { role: 'user', content: `Character: ${c.name || 'unnamed'}, ${personWords(c)}, role ${c.role || 'other'}${c.era ? ', era ' + c.era : ''}${c.setting ? ', setting ' + c.setting : ''}. ${String(c.info || c.appearance || '').slice(0, 300)}
${story}
Choose 5 to 10 outfits for this character from this catalogue only (use the ids exactly), each for a different occasion or scene in their life or the story (e.g. "for college", "for the party scene", "for festivals", "at home"). Fit their age, gender, role, era and place. Bridal or groom outfits only if this character is the bride or groom; a guest at a wedding wears festive wear.
${allowedList.map(o => `${o.id}: ${o.name}`).join('\n')}
JSON: {"suggestions":[{"occasion":"for college","id":"","why":"under 12 words"}]}` }
    ], { temperature: 0.5 });
    const j = parseJSON(reply);
    const ok = new Set(allowedList.map(o => o.id));
    const list = (Array.isArray(j.suggestions) ? j.suggestions : []).filter(s => ok.has(s.id) && allowed(outfitById(s.id), c)).slice(0, 10);
    st.lastSuggest = list;
    $('#opSuggest').innerHTML = list.length ? `<table class="op-table"><thead><tr><th>Occasion</th><th>Outfit</th><th></th></tr></thead><tbody>${list.map((s, k) => `<tr><td>${esc(String(s.occasion || '').slice(0, 40))}</td><td><b>${esc(outfitById(s.id).name)}</b><br><small class="muted">${esc(String(s.why || '').slice(0, 90))}</small></td><td><button type="button" class="btn btn-ghost btn-sm" data-sg="${k}">＋ Wardrobe</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="tiny muted">No suggestion came back. Try again.</p>';
  } catch (e) { $('#opSuggest').innerHTML = `<p class="tiny">Suggestions failed: ${esc(e.message)}</p>`; }
}
function wire() {
  $('#opTabs').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) { readForm(); st.cat = b.dataset.cat; st.mood = ''; render(); } });
  $('#opOcc').addEventListener('click', e => { const b = e.target.closest('[data-occ]'); if (b) { readForm(); st.occ = b.dataset.occ; render(); } });
  $('#opMood').addEventListener('click', e => { const b = e.target.closest('[data-mood]'); if (b) { readForm(); st.mood = b.dataset.mood; render(); } });
  $('#opSearch').addEventListener('input', renderCards);
  $('#opCards').addEventListener('click', e => {
    const b = e.target.closest('[data-o]'); if (!b) return;
    readForm();
    const w = wcur(), o = outfitById(b.dataset.o);
    if (!allowed(o, st.c)) return; // (never listed)
    w.id = o.id;
    if (!w.label || /^Outfit \d+$|^Main outfit$/.test(w.label) && st.cur > 0) w.label = o.name;
    render();
  });
  $('#opWardrobe').addEventListener('click', e => {
    if (e.target.closest('#opAddW')) { readForm(); st.wardrobe.push({ wid: 'w' + Date.now().toString(36), label: `Outfit ${st.wardrobe.length + 1}`, ...blank() }); st.cur = st.wardrobe.length - 1; render(); return; }
    const b = e.target.closest('[data-w]'); if (b) { readForm(); st.cur = +b.dataset.w; render(); }
  });
  $('#opDelW').onclick = () => { if (st.wardrobe.length < 2) return; st.wardrobe.splice(st.cur, 1); st.cur = 0; render(); };
  for (const id of ['#opColour', '#opFabric', '#opText', '#opLabel', '#opShots']) $(id).addEventListener('input', () => { readForm(); $('#opNow').textContent = outfitLabel(wcur()); $('#opIssue').textContent = outfitIssue([wcur().text, ...Object.values(wcur().slots || {}).map(s => s?.text)].join(' '), st.c); });
  $('#opSlots').addEventListener('input', () => { readForm(); $('#opIssue').textContent = outfitIssue([wcur().text, ...Object.values(wcur().slots || {}).map(s => s?.text)].join(' '), st.c); });
  $('#opSuggestBtn').onclick = () => suggest();
  $('#opSuggest').addEventListener('click', e => {
    const b = e.target.closest('[data-sg]'); if (!b) return;
    const s = st.lastSuggest[+b.dataset.sg];
    readForm();
    st.wardrobe.push({ wid: 'w' + Date.now().toString(36) + b.dataset.sg, label: String(s.occasion || outfitById(s.id).name).replace(/^for (the )?/i, '').slice(0, 40), ...blank(), id: s.id });
    st.cur = st.wardrobe.length - 1; render();
  });
  $('#opClose').onclick = () => $('#outfitPicker').close();
  $('#opDone').onclick = () => {
    readForm();
    for (const w of st.wardrobe) {
      const issue = outfitIssue([w.text, ...Object.values(w.slots || {}).map(s => s?.text)].join(' '), st.c);
      if (issue) { toast(issue, true, 8000); return; }
      if (w.id && w.id !== 'custom' && !allowed(outfitById(w.id), st.c)) { toast(`“${outfitById(w.id).name}” is not for a ${ageOf(st.c)}-year-old. Pick another outfit.`, true, 8000); return; }
    }
    const main = wcur();
    if (!main.id && !main.text) { toast('Pick an outfit, or describe one in your own words.', true); return; }
    const shots = {};
    if (st.film) for (const w of st.wardrobe) for (const n of range(st.shots[w.wid])) if (n >= 1 && n <= st.film.scenes.length) shots[n - 1] = w.wid;
    const { wid, label, ...outfit } = main;
    $('#outfitPicker').close();
    st.onDone?.({ outfit, defaultWid: wid, wardrobe: st.wardrobe.filter(w => w.id || w.text), shots });
  };
}
export function initOutfitPicker(t) { toast = t; wire(); }
// Apply a picker result to a film character: default outfit, wardrobe, and which shots wear what.
export function applyOutfitToFilm(P, c, r) {
  c.outfit = r.outfit; c.wardrobe = r.wardrobe;
  P.scenes.forEach((sc, i) => {
    if (sc.outfits) delete sc.outfits[c.id];
    if (r.shots[i] && r.shots[i] !== r.defaultWid) (sc.outfits ||= {})[c.id] = r.shots[i];
    if (sc.outfits && !Object.keys(sc.outfits).length) delete sc.outfits;
  });
}
export { OUTFITS };
