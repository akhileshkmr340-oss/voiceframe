import { compactPrompt } from './character-prompt.js?v=59';
// Characters: the voice picker ("Select a voice"), the character editor (one full-screen page
// for a film's character or a directory character), the character directory (the person's
// saved characters, on this device) and uploads of their own character pictures.
// The film's own character page and the stand-alone Character Designer are the same editor:
// both edit a draft and both save to the same directory.
import * as Store from './store.js?v=61';
import { paintImage, checkPicture, chat, parseJSON, Cancelled } from './ai.js?v=57';
import { checkImage, SAFETY_DOWN } from './safety.js?v=57';
import { portraitPrompt } from './story.js?v=57';
import { speak, playBuffer, loadVoice, voiceEngine, narratorsFor } from './voice.js?v=57';
import { findLanguage, languageOptionsHTML, isRTL } from './langs.js?v=57';
import { studioEngine, previewStudioVoice, loadMyVoice } from './studio.js?v=57';
import { voiceList, findVoice, voiceName, performanceSummary, parsePerformance, lineStyle } from './voicebook.js?v=57';
import { AGE_PRESETS, ageOf, ageClass, personWords, outfitPrompt, outfitLabel, outfitIssue, ensureFields, isMinor, outfitById, allowed } from './outfits.js?v=57';
import { openOutfitPicker, applyOutfitToFilm } from './outfit-ui.js?v=57';
import { cloudOn, putCloud, deleteCloud, listCloud, smaller, MAX_CLOUD } from './cloud.js?v=57';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid8 = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
let ctx = null; // from app.js: { P(), user(), save(now), toast(), runJob(), setStatus(), askPhotoConsent(), show(), castChanged(), token(), myVoice() }

// ---------------- pictures ----------------
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp'];
const MAX_UPLOAD = 15 * 1024 * 1024;
// A picture made smaller (longest side max px) as a JPEG Blob.
export async function shrink(blob, max = 1280, q = 0.9) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); // a transparent PNG gets a white backdrop
  g.drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close();
  return cv.convertToBlob({ type: 'image/jpeg', quality: q });
}
async function b64(blob) {
  const a = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}
const refJpeg = async blob => b64(await shrink(blob, 480, 0.9));
const urls = new Map();
function urlOf(blob) {
  if (!blob) return '';
  if (!urls.has(blob)) urls.set(blob, URL.createObjectURL(blob));
  return urls.get(blob);
}

// A real, famous person is refused: the open vision checker on the relay (/look) is asked
// who the picture shows. Fails closed: no answer, no upload.
export async function publicFigureCheck(blob, signal) {
  const v = await checkPicture({
    image: await b64(await shrink(blob, 768, 0.85)), signal,
    expect: 'One person, an uploaded reference picture for a fictional film character (a private person or a generated person). Public-figure check: if this person is a recognisable real celebrity, film star, politician, athlete, royal, influencer or other famous public figure, that is a problem: set "unsafe": true and write "public figure: <who>" in problems. Ordinary private people are fine.'
  });
  if (!v) return { ok: false, why: 'The public-figure check is unavailable right now. Try again in a few minutes.' };
  const famous = v.problems.find(p => /public figure|celebrit|politic|famous|actor|actress|star\b|athlete|cricketer|singer|royal|president|minister/i.test(p));
  if (famous) return { ok: false, why: `This looks like a real public figure (${famous.replace(/^public figure:\s*/i, '')}). VoiceFrame can't use famous people's likeness.` };
  if (v.unsafe) return { ok: false, why: 'The picture checker blocked this picture (' + (v.problems[0] || 'not family-safe') + ').' };
  return { ok: true, model: v.model };
}
// Every check an uploaded character picture needs: type and size, the person's consent, the
// NSFW check on this device, the public-figure check. Returns the resized JPEG, or null.
export async function checkedUpload(file, name = 'this character') {
  if (!IMAGE_TYPES.includes(file.type)) { ctx.toast('Use a JPG, PNG, WebP, AVIF or GIF picture.', true, 6000); return null; }
  if (file.size > MAX_UPLOAD) { ctx.toast('That picture is over 15 MB. Use a smaller one.', true, 6000); return null; }
  if (!await ctx.askPhotoConsent({ name })) return null;
  let blob;
  try { blob = await shrink(file, 1280, 0.9); } catch { ctx.toast('That picture could not be read.', true); return null; }
  ctx.setStatus('Checking your picture…', 'Safety check on this device, then the public-figure check');
  try {
    try { await checkImage(blob); } catch (e) { ctx.toast(e?.safetyDown ? `Your picture: ${SAFETY_DOWN}.` : 'Your picture was blocked by the safety filter.', true, 8000); return null; }
    const pf = await publicFigureCheck(blob);
    if (!pf.ok) { ctx.toast(pf.why, true, 9000); return null; }
    return blob;
  } finally { ctx.clearStatus(); }
}

// ---------------- the voice picker ----------------
// open: { language, character: {name, gender, age, voice, studioVoice, useMine, perf}, sample, onPick }
const vp = { open: null, sel: null, engine: 'all', gender: 'any', age: 'any', stop: null, studioRuns: new Map(), mine: false };
const ENGINE_CHIPS = [['all', 'All'], ['device', 'On device'], ['studio', 'Studio'], ['basic', 'Basic'], ['mine', 'My voice']];
const GENDER_CHIPS = [['any', 'Any'], ['female', 'Female'], ['male', 'Male']];
const AGE_CHIPS = [['any', 'Any age'], ['young', 'Young'], ['adult', 'Adult'], ['older', 'Older']];
const AVATAR = ['#f5b544', '#ff7a3d', '#c26bff', '#2dd4bf', '#ff5d8f', '#6aa8ff', '#9be15d', '#ffd36e'];
const avatar = e => {
  const a = AVATAR[e.hue % AVATAR.length], b = AVATAR[(e.hue >> 3) % AVATAR.length];
  return `<span class="vp-av" style="background:linear-gradient(140deg,${a},${b === a ? '#8b5cf6' : b})">${esc((e.name || '?')[0])}</span>`;
};
export async function openVoicePicker(opts) {
  const c = opts.character || {};
  vp.mine = !!(ctx.myVoice?.() || await loadMyVoice().catch(() => null));
  vp.open = { ...opts, language: opts.language || 'English' };
  // the filters start at the character's gender and age (the person can widen them)
  vp.engine = 'all';
  vp.gender = ['female', 'male'].includes(c.gender) ? c.gender : 'any';
  const years = ageOf(c);
  vp.age = !c.gender && !c.ageYears && !c.age ? 'any' : years < 18 ? 'young' : years >= 55 ? 'older' : 'adult';
  const current = c.useMine ? 'mine' : c.studioVoice ? 'studio:' + c.studioVoice : c.voice;
  vp.list = voiceList(vp.open.language, { mine: vp.mine });
  vp.sel = vp.list.find(e => e.id === current) || vp.list.find(e => !e.basic && (e.gender === c.gender || !c.gender)) || vp.list[0];
  $('#vpFor').textContent = `${c.name ? 'for ' + c.name + ' · ' : ''}${vp.open.language}`;
  $('#vpSearch').value = '';
  const sample = String(opts.sample || '').slice(0, 120);
  $('#vpSample').value = sample; $('#vpSample').dir = isRTL(vp.open.language) ? 'rtl' : 'auto'; $('#vpSample').lang = findLanguage(vp.open.language)?.code || 'en';
  $('#vpPerf').value = c.perf?.text || '';
  renderChips(); renderVoices(); renderSel(); counter(); perfNote();
  $('#voicePicker').showModal();
  $('#vpSearch').focus();
}
function renderChips() {
  $('#vpEngine').innerHTML = ENGINE_CHIPS.filter(([k]) => k !== 'mine' || vp.mine).filter(([k]) => k !== 'studio' || vp.list.some(e => e.studio)).filter(([k]) => k !== 'basic' || vp.list.some(e => e.basic))
    .map(([k, l]) => `<button type="button" class="chip${vp.engine === k ? ' on' : ''}" data-engine="${k}">${l}</button>`).join('');
  $('#vpGender').innerHTML = GENDER_CHIPS.map(([k, l]) => `<button type="button" class="chip${vp.gender === k ? ' on' : ''}" data-gender="${k}">${l}</button>`).join('')
    + '<span class="vp-sep"></span>' + AGE_CHIPS.map(([k, l]) => `<button type="button" class="chip${vp.age === k ? ' on' : ''}" data-age="${k}">${l}</button>`).join('');
}
function shown() {
  const list = shownBy(vp.age);
  // a language with no young (or older) voice on this device: its voices are all shown
  vp.ageWidened = vp.age !== 'any' && !list.some(e => !e.studio && !e.mine);
  return vp.ageWidened ? shownBy('any') : list;
}
function shownBy(age) {
  const q = $('#vpSearch').value.trim().toLowerCase();
  return vp.list.filter(e => {
    if (vp.engine === 'device' && (e.studio || e.mine || e.basic)) return false;
    if (vp.engine === 'studio' && !e.studio) return false;
    if (vp.engine === 'basic' && !e.basic) return false;
    if (vp.engine === 'mine' && !e.mine) return false;
    if (vp.gender !== 'any' && e.gender !== vp.gender && e.gender !== 'any') return false;
    if (age !== 'any' && e.ageFit !== age && e.ageFit !== 'any') return false;
    return !q || `${e.name} ${e.desc} ${e.tags.join(' ')} ${e.id}`.toLowerCase().includes(q);
  });
}
function renderVoices() {
  const list = shown();
  $('#vpList').innerHTML = list.map(e => `<button type="button" role="option" class="vp-item${vp.sel?.id === e.id ? ' on' : ''}" data-v="${esc(e.id)}" aria-selected="${vp.sel?.id === e.id}">
    ${avatar(e)}<span class="vp-txt"><b>${esc(e.name)}${e.basic ? ' <i class="vp-tag">basic</i>' : ''}${e.studio ? ' <i class="vp-tag studio">Studio</i>' : ''}</b><small>${esc(e.desc)}</small>${e.studio ? '<small class="vp-studio">Studio · natural, made on free GPU</small>' : ''}</span></button>`).join('')
    || '<p class="tiny muted vp-none">No voice matches. Clear the search or the filters.</p>';
}
function renderSel() {
  const e = vp.sel;
  $('#vpVoiceName').textContent = e ? `${e.name} · ${e.desc}` : '';
  $('#vpNote').textContent = !e ? '' : e.studio || e.mine ? 'Studio voices are made on the free GPU (~1–2 min, longer while the GPU starts). The on-device voice plays meanwhile.'
    : e.basic ? 'Basic: an on-device voice reading this language\'s sounds with an accent. Studio voices sound natural.' : e.engine === 'indic' && !e.id.endsWith('_local') ? 'Recorded by the Indian voice service through the relay.' : 'Made on your device.';
  $('#vpAdd').textContent = 'Add to character';
}
const counter = () => { $('#vpCount').textContent = `${$('#vpSample').value.length} / 120`; };
const perfNote = () => { $('#vpPerfNote').textContent = $('#vpPerf').value.trim() ? performanceSummary($('#vpPerf').value, { studio: !!vp.sel?.studio }) : 'Words like: tired, slow, gentle · deep and calm · excited, fast · whisper · old and frail.'; };
// The on-device voice that stands in for a studio voice (same gender, same language).
function standIn(e) {
  const lang = vp.open.language;
  if (e.engine !== 'studio' && e.engine !== 'mine') return e.id;
  const base = e.id.slice(7);
  if ((lang === 'English' || !findLanguage(lang) || findLanguage(lang).name === 'English') && /^[ab][fm]_/.test(base)) return base;
  const g = e.gender === 'any' ? (vp.open.character?.gender || 'female') : e.gender;
  const pool = narratorsFor(lang);
  const fit = pool.find(([id]) => (id.startsWith('pp_') || /_(fe)?male$/.test(id)) ? (g === 'female') === /female|_f|#.*F|kerstin|gosia|anna|alma|ugla|maider|ona|aegis|tetiana|nathalie|rapunzelina|kasandra|lili|mari|raya|vais|benyw|KNN/i.test(id) : (id[1] === (g === 'female' ? 'f' : 'm')));
  return (fit || pool[0])[0];
}
async function playOnDevice(voiceId, text, perf, delivery = '') {
  const lang = vp.open.language;
  const st = lineStyle(perf, delivery);
  $('#vpPreview').classList.add('busy');
  try {
    await loadVoice(lang, p => { $('#vpNote').textContent = `Loading the ${lang} voice on this device: ${Math.round(p * 100)}%`; });
    const buf = await speak(text, { engine: voiceEngine(lang), voice: voiceId, speed: st.speed, pitch: st.pitch, gain: st.gain });
    if (!buf) return;
    vp.stop?.(); vp.stop = playBuffer(buf);
    vp.lastPlayed = { voice: voiceId, text, seconds: buf.duration };
  } finally { $('#vpPreview').classList.remove('busy'); }
}
async function preview() {
  const e = vp.sel; if (!e) return;
  const text = $('#vpSample').value.trim() || sampleFor(vp.open.language, vp.open.character?.name);
  const perf = $('#vpPerf').value.trim();
  try {
    if (!e.studio && !e.mine) { await playOnDevice(e.id, text, perf); renderSel(); return; }
    // studio: the on-device stand-in plays now; the GPU makes the real one
    const key = `${vp.open.language}|${e.id}|${perf}|${text}`;
    const got = vp.studioRuns.get(key);
    if (got?.buffer) { vp.stop?.(); vp.stop = playBuffer(got.buffer); $('#vpNote').textContent = 'Studio version (made on the free GPU).'; return; }
    playOnDevice(standIn(e), text, perf).catch(err => console.warn('stand-in voice', err));
    if (got) { $('#vpNote').textContent = 'The studio version is still being made on the free GPU (~1–2 min). The on-device voice plays meanwhile.'; return; }
    if (!studioEngine(vp.open.language)) { $('#vpNote').textContent = `Studio voices don't speak ${vp.open.language} yet.`; return; }
    const run = { started: Date.now() };
    vp.studioRuns.set(key, run);
    const mine = e.mine ? ctx.myVoice?.() : null;
    if (e.mine && !mine?.consent) { vp.studioRuns.delete(key); $('#vpNote').textContent = 'My voice needs your consent in this film first: open 🎙 My voice in Voice & look.'; return; }
    $('#vpNote').textContent = 'Making the studio version on the free GPU (~1–2 min, longer while the GPU starts). The on-device voice plays meanwhile.';
    const token = await ctx.token().catch(() => null);
    const c = vp.open.character || {};
    previewStudioVoice({
      language: vp.open.language, text, mine, token,
      character: { gender: e.gender === 'any' ? c.gender || 'female' : e.gender, age: c.age || 'adult', studioVoice: e.mine ? '' : e.id.slice(7), perf: perf ? { text: perf } : undefined },
      onStatus: d => { if (vp.sel === e) $('#vpNote').textContent = d.replace(/^Studio voices:/, 'Studio preview:'); }
    }).then(buf => {
      run.buffer = buf;
      if (buf && $('#voicePicker').open && vp.sel === e) { vp.stop?.(); vp.stop = playBuffer(buf); $('#vpNote').textContent = 'Studio version ready (made on the free GPU). ▶ Preview plays it again.'; }
    }, err => { vp.studioRuns.delete(key); if (vp.sel === e) $('#vpNote').textContent = 'The studio preview did not work: ' + err.message; });
  } catch (err) { if (!(err instanceof Cancelled)) ctx.toast('Preview failed: ' + err.message, true, 7000); }
}
// A line to hear a voice with, in the film's language.
const SAMPLES = {
  English: 'Hello! This is how I sound when I tell you my story.', Hindi: 'नमस्ते! जब मैं अपनी कहानी सुनाता हूँ, तो मेरी आवाज़ ऐसी लगती है।',
  Spanish: '¡Hola! Así suena mi voz cuando te cuento mi historia.', French: 'Bonjour ! Voici ma voix quand je te raconte mon histoire.',
  Arabic: 'مرحباً! هكذا يبدو صوتي عندما أحكي لك قصتي.', German: 'Hallo! So klingt meine Stimme, wenn ich dir meine Geschichte erzähle.'
};
export const sampleFor = (lang, name) => SAMPLES[lang] || (lang === 'English' && name ? `Hello, my name is ${name}.` : SAMPLES.English);

function pick() {
  const e = vp.sel; if (!e) return;
  const perf = $('#vpPerf').value.trim();
  const out = { perf: perf ? { text: perf, ...parsePerformance(perf) } : null };
  if (e.mine) Object.assign(out, { useMine: true, studioVoice: '', voice: standIn(e) });
  else if (e.studio) Object.assign(out, { useMine: false, studioVoice: e.id.slice(7), voice: standIn(e) });
  else Object.assign(out, { useMine: false, studioVoice: '', voice: e.id });
  out.label = e.mine ? 'My voice' : e.studio ? `Studio · ${e.name}` : e.name;
  out.sample = $('#vpSample').value;
  vp.stop?.();
  $('#voicePicker').close();
  vp.open.onPick?.(out, e);
}
function wirePicker() {
  $('#vpSearch').addEventListener('input', renderVoices);
  $('#vpEngine').addEventListener('click', e => { const b = e.target.closest('[data-engine]'); if (b) { vp.engine = b.dataset.engine; renderChips(); renderVoices(); } });
  $('#vpGender').addEventListener('click', e => {
    const b = e.target.closest('[data-gender]'), a = e.target.closest('[data-age]');
    if (b) vp.gender = b.dataset.gender;
    if (a) vp.age = a.dataset.age;
    if (a || b) { renderChips(); renderVoices(); }
  });
  $('#vpList').addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    vp.sel = vp.list.find(x => x.id === b.dataset.v);
    renderVoices(); renderSel(); perfNote();
  });
  $('#vpList').addEventListener('dblclick', e => { if (e.target.closest('[data-v]')) preview(); });
  $('#vpSample').addEventListener('input', counter);
  $('#vpPerf').addEventListener('input', perfNote);
  $('#vpPreview').onclick = () => preview();
  $('#vpAdd').onclick = () => pick();
  $('#vpClose').onclick = () => { vp.stop?.(); $('#voicePicker').close(); };
  $('#voicePicker').addEventListener('close', () => vp.stop?.());
}

// ---------------- drafts: one character being edited ----------------
// A draft is the same for a film's character and a directory character:
// { src: 'film'|'dir', cid, lid, name, gender, age, role, era, setting, language, appearance,
//   personality, info, voice, studioVoice, useMine, perf, realPhoto, consent, portrait,
//   sheet, history: [{ id, blob, view: 'portrait'|'sheet', kind, fav, at, note }] }
const FIELDS = ['designPrompt', 'lastChange', 'name', 'gender', 'age', 'ageYears', 'outfit', 'wardrobe', 'role', 'era', 'setting', 'language', 'appearance', 'personality', 'info', 'voice', 'studioVoice', 'useMine', 'perf', 'realPhoto', 'consent'];
const clone = o => (o == null ? o : structuredClone(o));
const pickFields = o => Object.fromEntries(FIELDS.filter(k => o[k] !== undefined).map(k => [k, clone(o[k])]));
export function draftFromFilm(P, c) {
  const hist = seedHistory((c.history || []).map(h => ({ ...h, blob: P.images['charh-' + c.id + '-' + h.id] })).filter(h => h.blob), P.images['char-' + c.id], P.images['sheet-' + c.id]);
  return {
    src: 'film', cid: c.id, lid: c.lid || null, ...pickFields(c), language: P.language || 'English', setting: c.setting || String(P.setting || '').slice(0, 80),
    realPhoto: P.credits['char-' + c.id]?.kind === 'user' || !!P.credits['char-' + c.id]?.real,
    portrait: P.images['char-' + c.id] || null, sheet: P.images['sheet-' + c.id] || null, history: hist
  };
}
export function draftFromEntry(e) {
  return { src: 'dir', lid: e.lid, ...pickFields(e), portrait: e.portrait || null, sheet: e.sheet || null, history: seedHistory((e.history || []).filter(h => h.blob).map(h => ({ ...h })), e.portrait, e.sheet), createdAt: e.createdAt };
}
// the current portrait and sheet are always among the versions (a character from before the editor had none)
function seedHistory(hist, portrait, sheet) {
  for (const [blob, view] of [[portrait, 'portrait'], [sheet, 'sheet']]) if (blob && !hist.some(h => h.blob === blob)) hist.unshift({ id: uid8(), blob, view, kind: 'current', fav: false, at: Date.now(), note: '' });
  return hist;
}
const blankDraft = () => ({ src: 'dir', lid: null, name: 'Untitled character', gender: '', age: '', ageYears: '', outfit: null, wardrobe: [], role: 'other', era: '', setting: '', language: ctx.P()?.language || 'English', appearance: '', personality: '', info: '', voice: '', studioVoice: '', useMine: false, perf: null, realPhoto: false, portrait: null, sheet: null, history: [] });
const HISTORY_MAX = 12;
// Into the directory: the record for a draft (a new id when it has none).
export async function saveDraftToDirectory(d) {
  const user = ctx.user();
  if (!user) throw new Error('Sign in to keep characters in your directory.');
  const lid = d.lid || 'ch-' + uid8();
  const old = d.lid ? await Store.getCharacter(d.lid).catch(() => null) : null;
  const rec = { lid, uid: user.uid, ...pickFields(d), portrait: d.portrait || null, sheet: d.sheet || null,
    history: (d.history || []).slice(-HISTORY_MAX).map(h => ({ id: h.id, blob: h.blob, view: h.view, kind: h.kind, fav: !!h.fav, at: h.at, note: h.note || '' })),
    createdAt: old?.createdAt || d.createdAt || Date.now(), updatedAt: Date.now() };
  await Store.saveCharacter(rec);
  d.lid = lid;
  copyToFolder(rec); // and to the Google Drive folder, when one is chosen
  copyToCloud(rec); // and to the person's account, so it is there wherever they sign in
  return rec;
}
// Back into the film: the character's fields, portrait, sheet and history.
export function applyDraftToFilm(P, d) {
  let c = P.characters.find(x => x.id === d.cid);
  if (!c) {
    let n = P.characters.length + 1; while (P.characters.some(x => x.id === 'c' + n)) n++;
    c = { id: 'c' + n, role: 'other', personality: '' };
    P.characters.push(c);
    d.cid = c.id;
  }
  const oldPortrait = P.images['char-' + c.id];
  Object.assign(c, pickFields(d));
  delete c.language; delete c.consent; delete c.realPhoto;
  c.age = ageClass(ageOf(c));
  if (d.outfitPick) applyOutfitToFilm(P, c, d.outfitPick);
  ensureFields(c);
  if (d.lid) c.lid = d.lid;
  if (!c.studioVoice) delete c.studioVoice;
  if (!c.useMine) delete c.useMine;
  if (d.portrait) P.images['char-' + c.id] = d.portrait; else delete P.images['char-' + c.id];
  if (d.sheet) P.images['sheet-' + c.id] = d.sheet; else delete P.images['sheet-' + c.id];
  if (d.portrait && d.portrait !== oldPortrait) {
    P.credits['char-' + c.id] = d.realPhoto ? { kind: 'user', consent: d.consent || Date.now() } : { kind: d.lid ? 'library' : 'ai' };
    if (P.blocked) delete P.blocked['char-' + c.id];
  } else if (d.realPhoto && P.credits['char-' + c.id]?.kind !== 'user') P.credits['char-' + c.id] = { ...(P.credits['char-' + c.id] || { kind: 'library' }), real: true };
  for (const k of Object.keys(P.images)) if (k.startsWith('charh-' + c.id + '-')) delete P.images[k];
  c.history = (d.history || []).slice(-HISTORY_MAX).map(h => { P.images['charh-' + c.id + '-' + h.id] = h.blob; return { id: h.id, view: h.view, kind: h.kind, fav: !!h.fav, at: h.at, note: h.note || '' }; });
  return { c, portraitChanged: !!d.portrait && d.portrait !== oldPortrait };
}
// A directory character into a film (a new cast member, linked to its directory entry).
export function addEntryToFilm(P, e) {
  const d = draftFromEntry(e);
  d.cid = null;
  const same = P.characters.find(x => x.lid === e.lid);
  if (same) d.cid = same.id;
  const { c } = applyDraftToFilm(P, d);
  c.lid = e.lid;
  ctx.triedPortrait?.(c.id);
  return c;
}

// ---------------- the character editor ----------------
const ed = { d: null, view: 'portrait', shownId: null, mode: 'film', onDone: null, showHist: true, busy: false, back: 'studio' };
// mode 'film' (P's character) or 'dir' (the directory / the Character Designer)
export function openEditor(draft, { onDone, back = 'studio' } = {}) {
  ed.d = draft; ed.mode = draft.src; ed.onDone = onDone; ed.back = back;
  ed.view = draft.portrait || !draft.sheet ? 'portrait' : 'sheet';
  ed.shownId = null; ed.busy = false;
  $('#ceDescribe').value = draft.designPrompt || '';
  $('#ceAsk').value = '';
  ed.sig = sigOf(draft);
  ctx.show('chared');
  setStartTab('words');
  renderEditor();
}
// (tab: which start tab opens: 'words', 'tools' for the AI design tools, or 'search')
// (back: the page "Done" returns to; onSaved(rec): called with the saved directory record,
// e.g. to cast the new character in the film being started)
export const openDesigner = (tab = 'words', { back = 'chars', onSaved } = {}) => {
  openEditor(blankDraft(), { back, onDone: async d => { const rec = await saveDraftToDirectory(d); ctx.toast(`⭐ ${d.name} is saved in your character directory.`); onSaved?.(rec); } });
  // (the page opens at the top: the gender, age and outfit the tools' prompts need come first)
  setStartTab(tab);
};
// what the draft holds (pictures by size), to ask before leaving only when something changed
const sigOf = d => JSON.stringify(d, (k, v) => v instanceof Blob ? `blob:${v.size}:${v.type}` : v);
const current = () => ed.view === 'sheet' ? ed.d.sheet : ed.d.portrait;
function renderEditor() {
  const d = ed.d;
  $('#ceTitle').textContent = d.name || 'Untitled character';
  if (document.activeElement !== $('#ceName')) $('#ceName').value = d.name || '';
  if (document.activeElement !== $('#ceInfo')) $('#ceInfo').value = d.info || '';
  for (const id of ['#ceDesign','#ceDone','#ceBack','#ceSaveDir']) $(id).disabled = !!ed.busy;
  $('#ceDesign').textContent = ed.busy ? 'Creating character…' : 'Design this character';
  $('#ceChange .ce-go').disabled = !!ed.busy;
  $('#ceWhere').textContent = ed.mode === 'film' ? `In “${ctx.P()?.title || 'this film'}”${d.lid ? ' · linked to your directory' : ''}` : d.lid ? 'In your character directory' : 'New character · not saved yet';
  $('#ceVoiceName').textContent = voiceName(d.language || 'English', d);
  $('#cePull').hidden = !(ed.mode === 'film' && d.lid);
  $('#ceSaveDir').textContent = ed.mode === 'film' ? (d.lid ? '⭐ Update in directory' : '⭐ Save to directory') : '⭐ Save to directory';
  $('#ceDone').textContent = ed.mode === 'film' ? 'Done' : 'Done';
  for (const [id, k] of [['#ceGender', 'gender'], ['#ceAgeYears', 'ageYears'], ['#ceRole', 'role'], ['#ceEra', 'era'], ['#ceSetting', 'setting'], ['#ceLook', 'appearance']]) if (document.activeElement !== $(id)) $(id).value = d[k] || '';
  $('#ceAgePresets').innerHTML = AGE_PRESETS.map(([k, l, y]) => `<button type="button" class="chip${+d.ageYears && ageBand(+d.ageYears) === k ? ' on' : ''}" data-age="${y}">${l}</button>`).join('');
  $('#ceOutfitName').textContent = d.outfit ? outfitLabel(d.outfit) + (d.wardrobe?.length > 1 ? ` · wardrobe of ${d.wardrobe.length}` : '') : 'Choose an outfit (required)';
  $('#ceOutfit').classList.toggle('missing', !d.outfit);
  $('#ceGender').classList.toggle('missing', !d.gender);
  $('#ceAgeYears').classList.toggle('missing', !+d.ageYears);
  $('#ceMinorNote').hidden = !(+d.ageYears && +d.ageYears < 18);
  if (!$('#ceLang').options.length) $('#ceLang').innerHTML = languageOptionsHTML(d.language || 'English');
  $('#ceLang').value = d.language || 'English';
  $('#ceLang').disabled = ed.mode === 'film';
  $$('#ceToggle [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === ed.view));
  const img = current();
  $('#ceImg').hidden = !img;
  if (img) $('#ceImg').src = urlOf(img);
  $('#ceImg').alt = `${d.name} ${ed.view === 'sheet' ? 'reference sheet' : 'portrait'}`;
  $('#ceStage').classList.toggle('sheet', ed.view === 'sheet');
  $('#ceEmpty').hidden = !!img;
  $('#ceEmpty').innerHTML = ed.view === 'sheet'
    ? (d.portrait ? `<p>No reference sheet yet.</p><button type="button" class="btn btn-primary" id="ceMakeSheet">🎨 Make the reference sheet</button><p class="tiny muted">One picture painted from the portrait: front, 45°, side and back views, the face, and outfit, hands and shoes details. Free painter (FLUX.2 with the portrait as reference).</p>` : '<p class="muted">Make or upload the portrait first.</p>')
    : '<p class="muted">No portrait yet. Describe the character on the left and press ✨ Design, or upload a picture.</p>';
  const realNote = d.realPhoto ? ' · Real photo: shots with this face move gently but are never lip-synced.' : '';
  $('#ceNote').textContent = (img ? (ed.view === 'sheet' ? 'Reference sheet: the film\'s shots use it with the portrait so the face and clothes stay the same.' : 'Portrait: the casting picture used in every shot.') : '') + realNote;
  $('#ceHistory').hidden = !ed.showHist;
  $('#ceHist').textContent = ed.showHist ? 'Hide history' : 'Show history';
  const shown = d.history.find(h => h.blob === img);
  $('#ceFav').textContent = shown?.fav ? '♥' : '♡';
  $('#ceFav').disabled = $('#ceDel').disabled = !shown;
  $('#ceHistory').innerHTML = `<p class="tiny muted">Versions (${d.history.length})</p>` + [...d.history].reverse().map(h => `<button type="button" class="ce-ver${h.blob === img ? ' on' : ''}" data-h="${esc(h.id)}" title="${esc(`${h.view === 'sheet' ? 'Reference sheet' : 'Portrait'} · ${h.kind}${h.note ? ': ' + h.note : ''}`)}"><img src="${urlOf(h.blob)}" alt=""><span>${h.fav ? '♥ ' : ''}${h.view === 'sheet' ? 'Sheet' : 'Portrait'}</span></button>`).join('')
    || '<p class="tiny muted">Every portrait and sheet you make is kept here: pick one, favourite it or delete it.</p>';
}
const $$ = s => [...document.querySelectorAll(s)];
function addVersion(blob, view, kind, note = '') {
  const h = { id: uid8(), blob, view, kind, fav: false, at: Date.now(), note: String(note || '').slice(0, 120) };
  ed.d.history.push(h);
  // the oldest versions go first, favourites stay
  while (ed.d.history.length > HISTORY_MAX) { const k = ed.d.history.findIndex(x => !x.fav && x.blob !== ed.d.portrait && x.blob !== ed.d.sheet); if (k < 0) break; ed.d.history.splice(k, 1); }
  if (view === 'sheet') ed.d.sheet = blob; else ed.d.portrait = blob;
  ed.view = view;
}
// Paintings count: the free painter's allowance is shared with everyone (the editor says so).
const SHEET_SIZES = { sheet: [1024, 768], square: [1024, 1024], portrait: [768, 1024], wide: [1024, 576] };
const ageBand = y => (y < 13 ? 'child' : y < 18 ? 'teen' : y < 26 ? 'young' : y < 41 ? 'adult' : y < 60 ? 'middle' : 'elderly');
function sheetPrompt(d, change = '') {
  const minor = isMinor(d);
  const who = `${personWords(d)}, ${String(d.appearance || d.info || '').slice(0, 300).replace(/[.\s]+$/, '')}. ${outfitPrompt(d.outfit, d)}${minor ? '. A child or teenager: ordinary, age-appropriate everyday clothes, fully clothed' : ''}`;
  return `Character reference sheet for a live-action film, one photo-real person who does not exist (image 0 is this person: keep the exact face, hair, skin tone and clothes): ${who}. One picture laid out as a clean grid on a plain light-grey studio backdrop with soft even light. Top row: four full-length standing views of the same person, arms relaxed: front view, three-quarter view at 45 degrees, side profile, back view. Bottom row: a head-and-shoulders face close-up looking at the camera, a close detail of the outfit fabric and collar, both hands held open, the shoes seen from the side. The same person and the same clothes in every panel.${change ? ' Change: ' + change + '.' : ''} Family-friendly: fully and modestly clothed, no close-ups of the body, no text, no labels, no captions, no watermark.`;
}
function portraitText(d, change = '') {
  const c = { name: d.name, age: ageClass(ageOf(d)), ageYears: ageOf(d), gender: d.gender, outfit: d.outfit, appearance: d.appearance || d.info || '', personality: d.personality || '', info: d.info && d.appearance ? d.info : '' };
  return portraitPrompt({ style: 'cinematic', setting: [d.era, d.setting].filter(Boolean).join(', ') }, c) + (change ? `. Change: ${change}. Same person otherwise` : '');
}
export let lastPrompt = '';
async function paint(view, change, { painter = '', format = '' } = {}, signal) {
  const d = ed.d;
  const size = view === 'sheet' ? SHEET_SIZES[format || 'sheet'] : format && format !== 'sheet' ? SHEET_SIZES[format] : [768, 1024];
  const ref = view === 'sheet' ? (change && d.sheet ? d.sheet : d.portrait) : change ? d.portrait : null;
  const refs = ref ? [await refJpeg(ref)] : undefined;
  const issue = outfitIssue(change, d);
  if (issue) throw new Error(issue);
  const rawPrompt = view === 'sheet' ? sheetPrompt(d, change) : portraitText(d, change);
  const prompt = await preparePrompt(rawPrompt, signal, 1600);
  // The full private character prompt is not written to the console.
  lastPrompt = prompt;
  const seed = Math.floor(Math.random() * 1e6);
  const useRefs = refs && (!painter || painter === 'cloudflare-refs');
  try {
    return await paintImage(prompt, { width: size[0], height: size[1], seed, signal, refs: useRefs ? refs : undefined, lock: !!useRefs && !painter, painter,
      onWait: sec => ctx.setStatus('Painting…', `The free painters are busy, retrying in ${sec}s`) });
  } catch (e) {
    if (e.castOut) throw new Error('The painter that sees the reference picture is out for today (it resets at 05:30 IST). Pick another painter: it paints from the words alone.');
    throw e;
  }
}
async function preparePrompt(text, signal, maxChars = 6000) {
  return compactPrompt(text, { maxChars, signal,
    onProgress: (part, total) => ctx.setStatus('Reading your full prompt…', `Preparing section ${part} of ${total}. Your original text is kept.`),
    summarize: (part, limit) => chat([
      { role:'system', content:`Create a concise factual visual brief under ${limit} characters. Preserve character identity, age, face, clothing, colours, setting, requested changes and negative constraints. Preserve the most recent explicit correction if details conflict. Do not add people or invent traits. Keep family-friendly constraints. Return only the brief.` },
      { role:'user', content:part }
    ], {signal, temperature:.2, maxTokens:500})
  });
}
async function designFromWords(text, signal) {
  ed.d.designPrompt = text;
  const brief = await preparePrompt(text, signal);
  ctx.setStatus('Writing the casting brief…', 'The AI casting director reads your description');
  const reply = await chat([
    { role: 'system', content: 'You are the casting director of a family-friendly live-action film. Reply with ONLY valid JSON.' },
    { role: 'user', content: `Description from the film-maker: "${brief}"
Write a casting brief for ONE fictional person who does not exist. Never a real, famous or historical person's likeness: if the description asks for one, reply {"refused":"one short sentence"}. Keep children and teenagers in safe, ordinary, fully clothed situations.
JSON: {"name":"","gender":"female|male|other","ageYears":30,"outfit":"their main outfit in a few English words (ordinary and fully clothed for anyone under 18)","role":"protagonist|ally|antagonist|mentor|other","appearance":"25-40 words in English starting with nationality or ethnicity: age, face, hair, skin tone, build, outfit with colours, one distinctive feature","personality":"under 12 words","info":"1-2 sentences: how they look and act","era":"e.g. modern, 1950s, medieval","setting":"e.g. a Kerala fishing village"}` }
  ], { signal, temperature: 0.6 });
  const j = parseJSON(reply);
  if (j.refused) throw new Error(String(j.refused).slice(0, 200));
  const d = ed.d, one = (v, ok, dflt) => ok.includes(v) ? v : dflt;
  const years = Math.round(+j.ageYears) > 0 && Math.round(+j.ageYears) < 110 ? Math.round(+j.ageYears) : ageOf(d);
  Object.assign(d, {
    name: String(j.name || d.name).slice(0, 40), gender: d.gender || one(j.gender, ['female', 'male', 'other'], 'other'), ageYears: +d.ageYears || years, age: ageClass(+d.ageYears || years),
    role: one(j.role, ['protagonist', 'ally', 'antagonist', 'mentor', 'other'], 'other'), appearance: String(j.appearance || '').slice(0, 400),
    personality: String(j.personality || '').slice(0, 80), info: d.info || String(j.info || text).slice(0, 600), era: String(j.era || '').slice(0, 40), setting: String(j.setting || '').slice(0, 80)
  });
  // the outfit the person chose stays; otherwise the writer's, matched to the catalogue (age-gated)
  if (!d.outfit) { const tmp = { ...d, outfit: null, wardrobe: [], outfitWords: typeof j.outfit === 'string' ? j.outfit : '' }; ensureFields(tmp); d.outfit = tmp.outfit; d.wardrobe = tmp.wardrobe; }
  renderEditor();
  ctx.setStatus('Painting the portrait…', 'A photo-real person who does not exist (free FLUX painter)');
  const img = await paint('portrait', '', {}, signal);
  addVersion(img, 'portrait', 'designed', 'from your description');
  d.realPhoto = false;
}
function wireEditor() {
  $('#ceName').addEventListener('input', e => { ed.d.name = e.target.value.slice(0, 40); $('#ceTitle').textContent = ed.d.name || 'Untitled character'; });
  $('#ceInfo').addEventListener('input', e => { ed.d.info = e.target.value; });
  for (const [id, k] of [['#ceGender', 'gender'], ['#ceRole', 'role'], ['#ceEra', 'era'], ['#ceSetting', 'setting'], ['#ceLook', 'appearance'], ['#ceLang', 'language']]) $(id).addEventListener('input', e => { ed.d[k] = e.target.value; if (k === 'language' || k === 'gender') renderEditor(); });
  const setAge = y => {
    const n = Math.max(0, Math.min(100, Math.round(+y) || 0));
    ed.d.ageYears = n || ''; ed.d.age = n ? ageClass(n) : '';
    // an outfit this age may not wear is dropped (the person picks again)
    const o = ed.d.outfit && outfitById(ed.d.outfit.id);
    if (n && o && !allowed(o, ed.d)) { ed.d.outfit = null; ed.d.wardrobe = []; ctx.toast('That outfit is not for this age: choose another.', true, 6000); }
    renderEditor();
  };
  $('#ceAgeYears').addEventListener('change', e => setAge(e.target.value));
  $('#ceAgePresets').addEventListener('click', e => { const b = e.target.closest('[data-age]'); if (b) setAge(b.dataset.age); });
  $('#ceOutfit').onclick = () => {
    const d = ed.d;
    if (!d.gender || !+d.ageYears) { ctx.toast('Choose the gender and age first: the outfits shown depend on them.', true); return; }
    const P = ed.mode === 'film' ? ctx.P() : null;
    openOutfitPicker({ character: { ...d, id: d.cid }, film: P, onDone: r => {
      const changed = JSON.stringify(r.outfit) !== JSON.stringify(d.outfit);
      d.outfit = r.outfit; d.wardrobe = r.wardrobe; d.outfitPick = r;
      renderEditor();
      // a new outfit: the reference sheet is painted again (it counts toward the free painter's allowance)
      if (changed && d.sheet) { ctx.toast('New outfit: painting the reference sheet again.'); runPaint('sheet', ''); }
    } });
  };
    $('#ceVoice').onclick = () => {
    const d = ed.d, P = ctx.P();
    const line = ed.mode === 'film' && P ? P.scenes.flatMap(s => s.dialogue || []).find(x => x.character === d.cid && x.line)?.line : '';
    openVoicePicker({ language: d.language || 'English', character: d, sample: line || sampleFor(d.language || 'English', d.name), onPick: v => {
      Object.assign(d, { voice: v.voice, studioVoice: v.studioVoice, useMine: v.useMine, perf: v.perf });
      renderEditor();
      ctx.toast(`${d.name}'s voice: ${v.label}. Press Done to keep it.`);
    } });
  };
  $('#ceToggle').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) { ed.view = b.dataset.view; renderEditor(); } });
  $('#ceHist').onclick = () => { ed.showHist = !ed.showHist; renderEditor(); };
  $('#ceHistory').addEventListener('click', e => {
    const b = e.target.closest('[data-h]'); if (!b) return;
    const h = ed.d.history.find(x => x.id === b.dataset.h); if (!h) return;
    if (h.view === 'sheet') ed.d.sheet = h.blob; else ed.d.portrait = h.blob;
    ed.view = h.view; renderEditor();
  });
  $('#ceFav').onclick = () => { const h = ed.d.history.find(x => x.blob === current()); if (h) { h.fav = !h.fav; renderEditor(); } };
  $('#ceDel').onclick = () => {
    const img = current(), k = ed.d.history.findIndex(x => x.blob === img); if (k < 0) return;
    if (!confirm('Delete this version?')) return;
    const [h] = ed.d.history.splice(k, 1);
    const prev = [...ed.d.history].reverse().find(x => x.view === h.view);
    if (h.view === 'sheet') ed.d.sheet = prev?.blob || null; else ed.d.portrait = prev?.blob || null;
    renderEditor();
  };
  $('#ceStage').addEventListener('click', e => { if (e.target.closest('#ceMakeSheet')) runPaint('sheet', ''); });
  $('#ceDesign').onclick = () => {
    if (ed.busy) return;
    const text = $('#ceDescribe').value.trim();
    if (text.length < 8) { ctx.toast('Describe the person in a sentence or two first.', true); $('#ceDescribe').focus(); return; }
    ed.busy = true; renderEditor();
    ctx.runJob(signal => designFromWords(text, signal)).finally(() => { ed.busy = false; if (ed.d) renderEditor(); });
  };
  const upload = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const blob = await checkedUpload(f, ed.d.name || 'this character');
    if (!blob) return;
    addVersion(blob, 'portrait', 'upload', 'your picture');
    Object.assign(ed.d, { realPhoto: true, consent: Date.now() });
    renderEditor();
    ctx.toast('Your picture is this character\'s portrait. Shots with it move gently but are never lip-synced.', false, 8000);
  };
  $('#ceUpload').addEventListener('change', upload);
  $('#ceUpload2').addEventListener('change', upload);
  $('#ceChange').addEventListener('submit', e => {
    e.preventDefault();
    const ask = $('#ceAsk').value.trim();
    if (!ask) { $('#ceAsk').focus(); return; }
    if (!current()) { ctx.toast('Make or upload a picture first.', true); return; }
    runPaint(ed.view, ask);
  });
  $('#ceAsk').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#ceChange').requestSubmit(); } });
  $('#ceBack').onclick = () => { if (sigOf(ed.d) === ed.sig || confirm('Leave without saving the changes to this character?')) leave(); };
  $('#ceDone').onclick = () => done();
  $('#ceSaveDir').onclick = async () => {
    try {
      const rec = await saveDraftToDirectory(ed.d);
      if (ed.mode === 'film') { const P = ctx.P(); const c = P?.characters.find(x => x.id === ed.d.cid); if (c) { c.lid = rec.lid; ctx.save(); } }
      renderEditor();
      ctx.toast(`⭐ ${ed.d.name} is saved in your character directory.`);
    } catch (err) { ctx.toast(err.message, true, 6000); }
  };
  $('#cePull').onclick = async () => {
    const e = await Store.getCharacter(ed.d.lid).catch(() => null);
    if (!e) { ctx.toast('That character is no longer in your directory.', true); return; }
    const keep = { src: 'film', cid: ed.d.cid, language: ed.d.language };
    ed.d = { ...draftFromEntry(e), ...keep };
    ed.view = 'portrait'; renderEditor();
    ctx.toast(`Updated from your directory. Press Done to use it in this film.`);
  };
}
function runPaint(view, change) {
  if (ed.busy) return;
  const painter = $('#cePainter').value, format = $('#ceFormat').value;
  ed.busy = true; ed.d.lastChange = change; renderEditor();
  ctx.runJob(async signal => {
    ctx.setStatus(view === 'sheet' ? 'Painting the reference sheet…' : 'Painting the portrait…', change ? `Change: ${change.slice(0, 60)}` : 'One picture, from the portrait');
    const img = await paint(view, change, { painter, format }, signal);
    addVersion(img, view, change ? 'edit' : 'painted', change || (view === 'sheet' ? 'reference sheet' : 'portrait'));
    if (view === 'portrait') ed.d.realPhoto = false;
    $('#ceAsk').value = '';
  }).finally(() => { ed.busy = false; if (ed.d) renderEditor(); });
}
function leave() { const back = ed.back; ed.d = null; ctx.show(back); }

// ---------------- "Design in ChatGPT, Gemini… (free)": hand-offs, like the Flow and Kling prompts ----------------
// There is no free API for these tools and their websites must not be automated, so the person copies a
// ready prompt, makes the picture there with their own free account, and uploads the result
// here (consent, NSFW and public-figure checks; a real-looking face gets no lip-sync). Or the
// result is only a style reference: the free FLUX painter paints a new person who does not
// exist from its outfit, age and look, and that picture counts as generated.
export function gptPrompt(d) {
  const minor = isMinor(d);
  const outfit = outfitPrompt(d.outfit, d).replace(/^Outfit: /, '');
  const look = String(d.appearance || '').trim();
  return [
    `Create ONE photo-realistic character reference sheet of a fictional person who does not exist (not a real, famous or historical person, and not anyone's likeness).`,
    `Character: ${d.name || 'the character'}, a ${personWords(d)}${look ? `. Look: ${look}` : ''}${d.info ? `. Personality and manner: ${String(d.info).slice(0, 200).replace(/[.\s]+$/, '')}` : ''}.`,
    outfit && `Outfit: ${outfit}.`,
    `Layout: a single landscape image on a plain light-grey studio backdrop with soft, even light. Top row: four full-length standing views of the same person with arms relaxed: front view, three-quarter view (45 degrees), side profile and back view. Bottom row: a head-and-shoulders face close-up looking at the camera, a close-up of the outfit's fabric and collar, both hands held open, and the shoes seen from the side.`,
    `Keep the same face, hair, skin tone, build and clothes in every panel.`,
    `Family-friendly: fully and modestly clothed${minor ? ', ordinary age-appropriate everyday clothes (this character is under 18)' : ''}; no close-ups of the body. No text, labels, captions, logos or watermarks.`
  ].filter(Boolean).join('\n');
}
// The same prompt in under 480 characters, for tools with a length limit (Bing Image Creator,
// Meta AI). The family-safe words come first so a cut never drops them.
export function shortPrompt(d) {
  const outfit = outfitPrompt(d.outfit, d).replace(/^Outfit: /, '').replace(/[.\s]+$/, '');
  const head = `Family-friendly, fully and modestly clothed photo-realistic character reference sheet of ONE fictional person who does not exist: a ${personWords(d)}`;
  const tail = `. Front, three-quarter, side and back full-length views plus a face close-up, same face and clothes in every view, plain light-grey backdrop, soft light, no text.`;
  let look = String(d.appearance || '').trim().replace(/[.\s]+$/, '');
  let wear = outfit ? `, wearing ${outfit}` : '';
  const room = 470 - head.length - tail.length;
  look = look ? ', ' + look : '';
  // the outfit gets half the room when there is a look to fit too, else all of it
  const wearRoom = Math.floor(look ? Math.max(room * 0.5, room - look.length) : room);
  if (wear.length > wearRoom) wear = wear.slice(0, wearRoom).replace(/[\s,]+\S*$/, '');
  if (look.length > room - wear.length) look = look.slice(0, Math.max(0, room - wear.length)).replace(/[\s,]+\S*$/, '');
  return head + look + wear + tail;
}

// The free AI picture tools a character can be designed in: a hand-off each (copy the prompt,
// make the picture with your own account there, upload it back). None is automated or signed
// in to by VoiceFrame (their terms forbid it). Names are only to say which site opens.
export const AI_TOOLS = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', icon: '💬', note: 'Free OpenAI account · a few pictures a day' },
  // (Muse second: the user asked for ChatGPT and Muse first; meta.ai paints with Meta's Muse Image, 2026)
  { id: 'meta', name: 'Muse · Meta AI', url: 'https://www.meta.ai/', icon: '🌐', note: 'Meta\'s Muse Image · free Meta account · not in every country', short: true },
  { id: 'gemini', name: 'Google Gemini', url: 'https://gemini.google.com/app', icon: '✨', note: 'Free Google account · makes and edits pictures in the chat' },
  { id: 'copilot', name: 'Microsoft Copilot', url: 'https://copilot.microsoft.com/', icon: '🧭', note: 'Free Microsoft account' },
  { id: 'bing', name: 'Bing Image Creator', url: 'https://www.bing.com/images/create', icon: '🖼', note: 'Free Microsoft account · short prompts', short: true },
  { id: 'whisk', name: 'Google Whisk', url: 'https://labs.google/fx/tools/whisk', icon: '🌀', note: 'Google Labs · mixes subject, scene and style pictures', short: true }
];
let tool = AI_TOOLS[0];
// another tool the person names: only an https address, opened in a new tab without access back to this page
function otherTool(raw) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch { return null; }
  if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password) return null;
  return { id: 'other', name: u.hostname.replace(/^www\./, ''), url: u.href, icon: '🔗', note: '' };
}
function renderTools() {
  $('#ceTools').innerHTML = AI_TOOLS.map(t => `<button type="button" class="ce-tool" data-tool="${t.id}"><span class="ce-tool-icon" aria-hidden="true">${t.icon}</span><b>${esc(t.name)}</b><small>${esc(t.note)}</small></button>`).join('');
}
function showPrompt() {
  const short = $('#gptShort').checked;
  const text = short ? shortPrompt(ed.d) : gptPrompt(ed.d);
  $('#gptPrompt').value = text;
  $('#gptCount').textContent = `${text.length} characters`;
}
function openGpt(t = AI_TOOLS[0]) {
  const d = ed.d;
  if (!d.gender || !+d.ageYears || !d.outfit) { ctx.toast('Choose the gender, age and outfit first: the prompt is written from them.', true, 6000); return; }
  tool = t;
  // (a site the person typed in is not known to be free, so it is not called free)
  const free = t.id !== 'other';
  $('#gptTitle').textContent = `${t.icon} Design in ${t.name}${free ? ' (free)' : ''}`;
  $('#gptIntro').textContent = `Make the reference sheet with your own${free ? ' free' : ''} ${t.name} account, then bring it back.`;
  $$('#gptDlg .gpt-tool').forEach(s => { s.textContent = t.name; });
  $('#gptOpen').href = t.url;
  $('#gptOpen').textContent = `Open ${t.name} ↗`;
  $('#gptShort').checked = !!t.short;
  showPrompt();
  $('#gptStyle').checked = false;
  $('#gptState').textContent = '';
  $('#gptDlg').showModal();
}

// ---------------- the editor's start tabs: Describe · AI tools · Search ----------------
export function setStartTab(name) {
  $$('#ceStart [data-tab]').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  $$('#ceStart [data-pane]').forEach(p => { p.hidden = p.dataset.pane !== name; });
  if (name === 'search') { loadDirectory().catch(() => {}).then(renderFound); $('#ceSearch').focus(); }
}
function renderFound() {
  const q = $('#ceSearch').value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const text = e => [e.name, e.gender, e.ageYears || e.age, e.role, e.era, e.setting, e.language, e.appearance, e.info, e.outfit && outfitLabel(e.outfit)].filter(Boolean).join(' ').toLowerCase();
  const list = directory().filter(e => words.every(w => text(e).includes(w))).slice(0, 30);
  $('#ceFound').innerHTML = list.map(e => `<button type="button" class="ce-hit" data-lid="${esc(e.lid)}">${e.portrait ? `<img src="${urlOf(e.portrait)}" alt="">` : '<span class="ce-hit-blank" aria-hidden="true">🙂</span>'}
    <span><b>${esc(e.name)}</b><small>${esc([e.gender, e.ageYears ? e.ageYears + ' years' : e.age, e.outfit && outfitLabel(e.outfit)].filter(Boolean).join(' · '))}</small></span><em>Start from this</em></button>`).join('')
    || `<p class="tiny muted">${directory().length ? 'No saved character matches.' : 'Your directory is empty: characters you save appear here.'}</p>`;
}
// a saved character as the starting point: the same look, outfit, voice and pictures; in a
// film it becomes this film's character (linked to the directory), in the Designer a new copy
function startFrom(e) {
  const d = ed.d, from = draftFromEntry(e);
  if (ed.mode === 'film') Object.assign(d, from, { src: 'film', cid: d.cid });
  else Object.assign(d, from, { src: 'dir', lid: null, name: e.name + ' (new)', createdAt: undefined });
  ed.view = d.portrait || !d.sheet ? 'portrait' : 'sheet';
  ed.shownId = null;
  renderEditor();
  ctx.toast(ed.mode === 'film' ? `${e.name} is now this film's character (linked to your directory).` : `Started from ${e.name}: change anything, then save it as a new character.`, false, 6000);
}
// ---------------- the "🎨 Character design" popup ----------------
// The person writes a prompt (who the character is), sets gender and age, and picks the AI:
// VoiceFrame AI paints here; ChatGPT, Muse and the rest are hand-offs. Either way the
// character editor opens with that draft (and, for a tool, its prompt dialog on top), and
// "Done" saves it to the directory. (back: the page Done returns to; onSaved(rec): the saved record)
const dz = { back: 'chars', onSaved: null };
// words that name clothes, shoes or jewellery (a phrase with one is part of the outfit)
const CLOTHES = /\b(lehenga|ghagra|saree|sari|kurta|kurti|dhoti|lungi|mundu|salwar|churidar|dupatta|sherwani|bandhgala|pyjama|shirt|t-shirt|tee|polo|jeans|trousers|pants|chinos|dress|gown|frock|skirt|jacket|coat|blazer|suit|uniform|hoodie|sweater|jumper|cardigan|shorts|blouse|vest|waistcoat|robe|cloak|tunic|overalls|apron|turban|pagri|safa|hat|cap|scarf|shawl|stole|sandals|shoes|boots|sneakers|slippers|chappals?|juttis?|mojaris?|earrings|necklace|bangles|bracelet|jewellery|jewelry|nose ?ring|nose stud|anklets?|wearing|dressed)\b/i;
export function openDesignPopup({ back = 'chars', onSaved = null } = {}) {
  Object.assign(dz, { back, onSaved });
  $('#dzTools').innerHTML = `<button type="button" class="ce-tool dz-here" data-dz="here"><span class="ce-tool-icon" aria-hidden="true">🎬</span><b>VoiceFrame AI</b><small>Free · paints right here · a person who does not exist</small></button>`
    + AI_TOOLS.map(t => `<button type="button" class="ce-tool" data-dz="${t.id}"><span class="ce-tool-icon" aria-hidden="true">${t.icon}</span><b>${esc(t.name)}</b><small>${esc(t.note)}</small></button>`).join('');
  $('#designDlg').showModal();
  $('#dzPrompt').focus();
}
function dzStart(choice) {
  const text = $('#dzPrompt').value.trim();
  const gender = $('#dzGender').value, years = Math.round(+$('#dzAge').value);
  if (text.length < 8) { ctx.toast('Write who your character is first (a sentence is enough).', true); $('#dzPrompt').focus(); return; }
  if (!gender) { ctx.toast('Choose the gender.', true); $('#dzGender').focus(); return; }
  if (!(years >= 1 && years <= 100)) { ctx.toast('Set the age (1-100).', true); $('#dzAge').focus(); return; }
  const d = blankDraft();
  Object.assign(d, { name: $('#dzName').value.trim().slice(0, 40) || 'New character', gender, ageYears: years, age: ageClass(years), appearance: text.slice(0, 400), designPrompt: text });
  // family-safe before any prompt is written for VoiceFrame or another site (adult-only
  // clothes never for under-18s)
  const issue = outfitIssue(text, d);
  if (issue) { ctx.toast(issue, true, 8000); $('#dzPrompt').focus(); return; }
  // the clothes the person wrote are the outfit, in their own words, and the rest of the
  // prompt is the look (matching "mustard cotton lehenga" to the catalogue picked a bridal
  // one); with no clothes written, the catalogue picks one for this age (changeable)
  const parts = text.split(/[,;]+|\.\s+/).map(s => s.trim()).filter(Boolean);
  const clothes = parts.filter(p => CLOTHES.test(p));
  if (clothes.length) {
    d.outfit = { id: 'custom', colour: '', fabric: '', text: clothes.join(', ').slice(0, 160) };
    d.wardrobe = [{ wid: 'w1', label: 'Main outfit', ...d.outfit }];
    const look = parts.filter(p => !CLOTHES.test(p)).join(', ');
    if (look.length >= 8) d.appearance = look.slice(0, 400);
  } else {
    const tmp = ensureFields({ ...d, outfit: null, wardrobe: [], outfitWords: '' });
    d.outfit = tmp.outfit; d.wardrobe = tmp.wardrobe;
  }
  $('#designDlg').close();
  const { back, onSaved } = dz;
  openEditor(d, { back, onDone: async dd => { const rec = await saveDraftToDirectory(dd); ctx.toast(`⭐ ${dd.name} is saved in your character directory.`); onSaved?.(rec); } });
  if (choice === 'here') {
    $('#ceDescribe').value = text;
    $('#ceDesign').click();
    return;
  }
  setStartTab('tools');
  const t = choice === 'other' ? otherTool($('#dzOtherUrl').value.trim()) : AI_TOOLS.find(x => x.id === choice);
  if (t) openGpt(t);
}
function wireDesignPopup() {
  $('#dzTools').addEventListener('click', e => { const b = e.target.closest('[data-dz]'); if (b) dzStart(b.dataset.dz); });
  $('#dzOther').addEventListener('submit', e => {
    e.preventDefault();
    if (!otherTool($('#dzOtherUrl').value.trim())) { ctx.toast('Type the tool\'s full web address (https://…).', true); return; }
    dzStart('other');
  });
  $('#dzClose').onclick = () => $('#designDlg').close();
}
function wireStartTabs() {
  wireDesignPopup();
  renderTools();
  $('#ceStart').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setStartTab(b.dataset.tab); });
  $('#ceTools').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) openGpt(AI_TOOLS.find(t => t.id === b.dataset.tool)); });
  $('#ceOtherTool').addEventListener('submit', e => {
    e.preventDefault();
    const t = otherTool($('#ceOtherUrl').value.trim());
    if (!t) { ctx.toast('Type the tool\'s full web address (https://…).', true); return; }
    openGpt(t);
  });
  $('#ceSearch').addEventListener('input', renderFound);
  $('#ceFound').addEventListener('click', e => { const b = e.target.closest('[data-lid]'); const hit = b && directory().find(x => x.lid === b.dataset.lid); if (hit) startFrom(hit); });
  $('#gptShort').addEventListener('change', showPrompt);
}
async function gptResult(file) {
  const d = ed.d;
  const asStyle = $('#gptStyle').checked;
  const blob = await checkedUpload(file, d.name || 'this character');
  if (!blob) return;
  const bmp = await createImageBitmap(blob);
  const wide = bmp.width > bmp.height * 1.15; bmp.close();
  if (!asStyle) {
    addVersion(blob, wide ? 'sheet' : 'portrait', 'upload', 'made in ' + tool.name);
    if (!d.portrait) d.portrait = blob;
    Object.assign(d, { realPhoto: true, consent: Date.now() });
    $('#gptDlg').close(); renderEditor();
    ctx.toast('Your ' + tool.name + ' picture is this character\'s ' + (wide ? 'reference sheet' : 'portrait') + '. It counts as a real-looking face: shots move gently but are never lip-synced.', false, 9000);
    return;
  }
  // a style reference: a NEW person is painted by the free FLUX painter (it sees the upload)
  $('#gptDlg').close();
  ed.busy = true; ed.d.lastChange = change; renderEditor();
  ctx.runJob(async signal => {
    ctx.setStatus('Painting a new person from your style reference…', 'Free FLUX painter: same outfit, age and look, a face that does not exist');
    const prompt = sheetPrompt(d, '').replace(/^Character reference sheet for a live-action film, one photo-real person who does not exist \(image 0 is this person: keep the exact face, hair, skin tone and clothes\)/,
      'Character reference sheet for a live-action film of ONE NEW photo-real person who does not exist. Image 0 is a style reference only: copy its outfit, colours, fabrics, age, build, hairstyle, lighting and sheet layout, but give the person a clearly different, new face (not the face in image 0)');
    console.info('[character style-reference prompt]', prompt);
    lastPrompt = prompt;
    const img = await paintImage(prompt, { width: 1024, height: 768, seed: Math.floor(Math.random() * 1e6), signal, refs: [await refJpeg(blob)], lock: true,
      onWait: sec => ctx.setStatus('Painting…', `The free painters are busy, retrying in ${sec}s`) }).catch(e => {
      if (e.castOut) throw new Error('The painter that can see a reference is out for today (it resets at 05:30 IST). Upload the picture as it is, or try again after the reset.');
      throw e;
    });
    addVersion(img, 'sheet', 'style-ref', 'new person from your ' + tool.name + ' style reference');
    if (!d.portrait) d.portrait = img;
    d.realPhoto = false; delete d.consent;
  }).finally(() => { ed.busy = false; if (ed.d) renderEditor(); });
}
function wireGpt() {
  $('#gptCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#gptPrompt').value); $('#gptState').textContent = '✓ Copied. Paste it into ' + tool.name + '.'; }
    catch { $('#gptPrompt').select(); $('#gptState').textContent = 'Select the text and copy it (Ctrl+C).'; }
  };
  $('#gptFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) gptResult(f); });
  const drop = $('#gptDrop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) gptResult(f); });
  $('#gptClose').onclick = () => $('#gptDlg').close();
}

// ---------------- "Your cast": the check before an automatic film is built ----------------
// After the writer and casting director have made the cast, an automatic film stops here
// (nothing painted, voiced or rendered yet; no job runs while it waits). The person checks
// each character's gender, age, outfit and voice, can swap in a directory character, and
// sets the narrator's voice and the film's language. "Let the AI decide" keeps the AI's
// choices. Returns 'build', 'ai' or 'cancel'.
const askKey = () => 'vf_askcast_' + (ctx.user()?.uid || 'guest');
export const alwaysAsk = () => localStorage.getItem(askKey()) !== 'off';
const cc = { P: null, snap: null, resolve: null, lang: '' };
export function castCheck(P, { reason = 'Your film is about to be built.' } = {}) {
  cc.P = P;
  cc.snap = structuredClone({ characters: P.characters, narrator: P.narrator, narratorPerf: P.narratorPerf, outfits: P.scenes.map(sc => sc.outfits || null), images: Object.fromEntries(Object.entries(P.images).filter(([k]) => k.startsWith('char-') || k.startsWith('sheet-'))), credits: Object.fromEntries(Object.entries(P.credits).filter(([k]) => k.startsWith('char-'))) });
  cc.lang = P.language || 'English';
  P.characters.forEach(ensureFields);
  $('#ccReason').textContent = reason;
  $('#ccAsk').checked = alwaysAsk();
  $('#ccLang').innerHTML = languageOptionsHTML(cc.lang);
  renderCast();
  $('#castCheckDlg').showModal();
  return new Promise(res => { cc.resolve = res; });
}
function renderCast() {
  const P = cc.P;
  $('#ccNarrator').textContent = narratorName(P);
  const dirOpts = directory().map(e => `<option value="${esc(e.lid)}">${esc(e.name)} · ${esc([e.gender, e.ageYears || e.age].filter(Boolean).join(', '))}</option>`).join('');
  $('#ccCards').innerHTML = P.characters.map(c => `<article class="cc-card" data-c="${esc(c.id)}">
    <div class="cc-top"><input class="cc-name" value="${esc(c.name)}" aria-label="Name" maxlength="40">
      <select class="cc-role" aria-label="Role">${['protagonist', 'ally', 'antagonist', 'mentor', 'other'].map(r => `<option${c.role === r ? ' selected' : ''}>${r}</option>`).join('')}</select></div>
    <div class="cc-row"><label>Gender <select class="cc-gender">${[['female', 'Female'], ['male', 'Male'], ['other', 'Other / unspecified']].map(([v, l]) => `<option value="${v}"${c.gender === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Age <input class="cc-age" type="number" min="1" max="100" value="${ageOf(c)}"></label>
      <select class="cc-agepre" aria-label="Age preset"><option value="">preset…</option>${AGE_PRESETS.map(([, l, y]) => `<option value="${y}">${l} (${y})</option>`).join('')}</select></div>
    <button type="button" class="btn btn-ghost btn-sm cc-outfit">👗 ${esc(outfitLabel(c.outfit))}${c.wardrobe?.length > 1 ? ` · ${c.wardrobe.length} in wardrobe` : ''}</button>
    <button type="button" class="btn btn-ghost btn-sm cc-voice">🎙 ${esc(voiceName(P.language, c))}</button>
    ${dirOpts ? `<select class="cc-dir"><option value="">⭐ Use a character from my directory…</option>${dirOpts}</select>` : ''}
    <p class="tiny muted">${esc(String(c.appearance || '').slice(0, 140))}</p></article>`).join('') || '<p class="muted">This film has no characters (narration only).</p>';
}
const narratorName = P => { const v = findVoice(P.language, P.narrator); return v ? `${v.name} · ${v.desc}` : 'Auto narrator voice'; };
function ccChar(e) { const card = e.target.closest('[data-c]'); return card && cc.P.characters.find(c => c.id === card.dataset.c); }
function finishCast(choice) {
  const P = cc.P;
  if (choice === 'ai') {
    Object.assign(P, { characters: cc.snap.characters, narrator: cc.snap.narrator, narratorPerf: cc.snap.narratorPerf });
    P.scenes.forEach((sc, i) => { if (cc.snap.outfits[i]) sc.outfits = cc.snap.outfits[i]; else delete sc.outfits; });
    for (const k of Object.keys(P.images)) if (k.startsWith('char-') || k.startsWith('sheet-')) delete P.images[k];
    Object.assign(P.images, cc.snap.images);
    for (const k of Object.keys(P.credits)) if (k.startsWith('char-')) delete P.credits[k];
    Object.assign(P.credits, cc.snap.credits);
  } else if (choice === 'build') {
    const lang = $('#ccLang').value;
    if (lang && lang !== (P.language || 'English')) P.translateTo = lang;
  }
  localStorage.setItem(askKey(), $('#ccAsk').checked ? 'on' : 'off');
  P.characters.forEach(ensureFields);
  ctx.save(true);
  $('#castCheckDlg').close();
  const r = cc.resolve; cc.resolve = null;
  r?.(choice);
}
function wireCast() {
  $('#ccCards').addEventListener('input', e => {
    const c = ccChar(e); if (!c) return;
    if (e.target.classList.contains('cc-name')) c.name = e.target.value.slice(0, 40);
  });
  $('#ccCards').addEventListener('change', async e => {
    const c = ccChar(e); if (!c) return;
    const t = e.target;
    if (t.classList.contains('cc-role')) c.role = t.value;
    if (t.classList.contains('cc-gender')) { c.gender = t.value; dropOutfitIfNotAllowed(c); renderCast(); }
    if (t.classList.contains('cc-age') || (t.classList.contains('cc-agepre') && t.value)) {
      const n = Math.max(1, Math.min(100, Math.round(+t.value) || 30));
      c.ageYears = n; c.age = ageClass(n);
      dropOutfitIfNotAllowed(c); renderCast();
    }
    if (t.classList.contains('cc-dir') && t.value) {
      const entry = directory().find(x => x.lid === t.value);
      if (!entry) return;
      if (entry.realPhoto && !await ctx.askPhotoConsent({ name: entry.name })) { t.value = ''; return; }
      const d = draftFromEntry(entry);
      d.cid = c.id;
      // the film's lines stay with this role: only the look, voice and details change
      applyDraftToFilm(cc.P, d);
      cc.P.characters.find(x => x.id === c.id).lid = entry.lid;
      ctx.triedPortrait?.(c.id);
      renderCast();
    }
  });
  $('#ccCards').addEventListener('click', e => {
    const c = ccChar(e); if (!c) return;
    if (e.target.closest('.cc-outfit')) openOutfitPicker({ character: c, film: cc.P, onDone: r => { applyOutfitToFilm(cc.P, c, r); renderCast(); } });
    if (e.target.closest('.cc-voice')) {
      const line = cc.P.scenes.flatMap(s => s.dialogue || []).find(d => d.character === c.id && d.line)?.line;
      openVoicePicker({ language: cc.P.language, character: c, sample: line, onPick: v => { ctx.setVoice(cc.P, c, v); renderCast(); } });
    }
  });
  $('#ccNarratorBtn').onclick = () => {
    const P = cc.P, line = P.scenes.find(s => s.narration)?.narration;
    openVoicePicker({ language: P.language, character: { name: 'Narrator', gender: /^[ab]f_|_female/.test(P.narrator || '') ? 'female' : 'male', ageYears: 40, voice: P.narrator, perf: P.narratorPerf ? { text: P.narratorPerf } : null },
      sample: line, onPick: v => { P.narrator = v.voice; P.narratorPerf = v.perf?.text || ''; renderCast(); } });
  };
  $('#ccBuild').onclick = () => finishCast('build');
  $('#ccAI').onclick = e => { e.preventDefault(); finishCast('ai'); };
  $('#ccCancel').onclick = () => finishCast('cancel');
  $('#castCheckDlg').addEventListener('cancel', e => { e.preventDefault(); finishCast('cancel'); });
}
function dropOutfitIfNotAllowed(c) {
  const o = c.outfit && outfitById(c.outfit.id);
  if (o && !allowed(o, c)) { delete c.outfit; c.wardrobe = []; ensureFields(c); ctx.toast(`${c.name}'s outfit was not for a ${ageOf(c)}-year-old: an age-appropriate one is set. Change it with 👗.`, true, 7000); }
  if (c.wardrobe) c.wardrobe = c.wardrobe.filter(w => !w.id || w.id === 'custom' || allowed(outfitById(w.id), c));
}

async function done() {
  const d = ed.d;
  if (!d.name?.trim()) { ctx.toast('Give the character a name.', true); $('#ceName').focus(); return; }
  if (!d.gender) { ctx.toast('Choose the gender (male, female or other).', true); $('#ceGender').focus(); return; }
  if (!+d.ageYears) { ctx.toast('Set the age.', true); $('#ceAgeYears').focus(); return; }
  if (!d.outfit) { ctx.toast('Choose an outfit.', true); $('#ceOutfit').focus(); return; }
  d.age = ageClass(+d.ageYears);
  try { await ed.onDone?.(d); } catch (err) { ctx.toast(err.message, true, 7000); return; }
  leave();
}

// ---------------- the directory ----------------
const dir = { list: [], pickFor: null };
export async function loadDirectory() {
  const user = ctx.user();
  if (!user) return [];
  dir.list = await Store.listCharacters(user.uid).catch(e => { console.warn('directory', e); return []; });
  if (sync.for !== user.uid) { sync.for = user.uid; syncCloud().catch(e => console.warn('account characters', e)); }
  return dir.list;
}
export const directory = () => dir.list;
const filters = () => ({ q: $('#cdSearch').value.trim().toLowerCase(), gender: $('#cdGender').value, age: $('#cdAge').value, role: $('#cdRole').value, era: $('#cdEra').value, lang: $('#cdLang').value });
function fillFilter(sel, label, values) {
  const cur = sel.value;
  sel.innerHTML = `<option value="">${label}</option>` + [...new Set(values.filter(Boolean))].sort().map(v => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
}
export async function renderDirectory({ pickFor } = {}) {
  if (pickFor !== undefined) dir.pickFor = pickFor;
  loadFolder().catch(() => renderFolder());
  await loadDirectory();
  fillFilter($('#cdEra'), 'Any era or setting', dir.list.flatMap(e => [e.era, e.setting]));
  fillFilter($('#cdLang'), 'Any language', dir.list.map(e => e.language));
  const f = filters();
  const list = dir.list.filter(e => (!f.gender || e.gender === f.gender) && (!f.age || e.age === f.age) && (!f.role || e.role === f.role) && (!f.era || e.era === f.era || e.setting === f.era) && (!f.lang || e.language === f.lang)
    && (!f.q || [e.name, e.info, e.appearance, e.personality, e.era, e.setting, e.role].join(' ').toLowerCase().includes(f.q)));
  const P = ctx.P();
  $('#cdPick').hidden = !dir.pickFor;
  if (dir.pickFor) $('#cdPick').innerHTML = `Pick a character to add to <b>${esc(P?.title || 'your film')}</b>. <button type="button" class="btn btn-ghost btn-sm" id="cdPickDone">Back to the film</button>`;
  $('#cdEmpty').hidden = dir.list.length > 0;
  $('#cdGrid').innerHTML = list.map(e => {
    const img = e.sheet || e.portrait;
    return `<article class="cd-card" data-lid="${esc(e.lid)}">
      <div class="cd-img">${img ? `<img src="${urlOf(img)}" alt="${esc(e.name)}">` : `<span class="initial">${esc((e.name || '?')[0])}</span>`}${e.portrait && e.sheet ? `<img class="cd-mini" src="${urlOf(e.portrait)}" alt="">` : ''}</div>
      <div class="cd-body"><h3>${esc(e.name)}</h3>
        <p class="tiny muted">${esc([e.gender, e.ageYears ? `${e.ageYears} years` : e.age, e.role, e.era, e.setting, e.language].filter(Boolean).join(' · '))}${e.realPhoto ? ' · 📷 real photo (no lip-sync)' : ''}</p>
        <p class="tiny">🎙 ${esc(voiceName(e.language || 'English', e))}${e.outfit ? ` · 👗 ${esc(outfitLabel(e.outfit))}` : ''}</p>
        ${e.info ? `<p class="tiny cd-info">${esc(e.info.slice(0, 160))}</p>` : ''}
        <div class="row cd-actions">
          ${P ? `<button type="button" class="btn btn-primary btn-sm cd-add">＋ Add to “${esc((P.title || 'this film').slice(0, 24))}”</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm cd-addto" title="Add to one of your films">🎬 Add to film…</button>
          <button type="button" class="btn btn-ghost btn-sm cd-edit">✏ Edit</button>
          <button type="button" class="btn btn-ghost btn-sm cd-export" title="Save as a file">⤓ Export</button>
          <button type="button" class="btn btn-ghost btn-sm cd-del" title="Delete">🗑</button>
        </div></div></article>`;
  }).join('') || (dir.list.length ? '<p class="muted">No character matches the search or filters.</p>' : '');
}
async function addToFilm(e, P) {
  const c = addEntryToFilm(P, e);
  await ctx.saveFilm(P);
  return c;
}
async function chooseFilm(e) {
  const films = (await Store.listProjects(ctx.user().uid)).filter(p => p.scenes?.length || p.characters?.length);
  if (!films.length) { ctx.toast('No films yet. Start a film, then add the character to it.', true); return; }
  const menu = $('#cdFilms');
  menu.innerHTML = `<h3>Add ${esc(e.name)} to…</h3>` + films.slice(0, 30).map(p => `<button type="button" class="btn btn-ghost btn-block" data-pid="${esc(p.id)}">${esc(p.title || 'Untitled idea')} <span class="tiny muted">${p.characters?.length || 0} characters</span></button>`).join('') + '<button type="button" class="btn btn-ghost btn-sm" data-pid="">Cancel</button>';
  menu.dataset.lid = e.lid;
  menu.showModal();
}
function wireDirectory() {
  for (const id of ['#cdSearch', '#cdGender', '#cdAge', '#cdRole', '#cdEra', '#cdLang']) $(id).addEventListener('input', () => renderDirectory());
  $('#cdNew').onclick = () => openDesigner();
  $('#cdUpload').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const blob = await checkedUpload(f, 'this character');
    if (!blob) return;
    const d = { ...blankDraft(), name: '', realPhoto: true, consent: Date.now(), history: [] };
    const h = { id: uid8(), blob, view: 'portrait', kind: 'upload', fav: false, at: Date.now(), note: 'your picture' };
    d.history.push(h); d.portrait = blob;
    openEditor(d, { back: 'chars', onDone: async x => { await saveDraftToDirectory(x); ctx.toast(`⭐ ${x.name} is saved in your character directory.`); } });
    ctx.toast('Add a name, a voice and the character info, then press Done to save. Shots with this face move gently but are never lip-synced.', false, 9000);
    setTimeout(() => $('#ceName').focus(), 50);
  });
  $('#cdImport').addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) await importFile(f).catch(err => ctx.toast(`${f.name}: ${err.message}`, true, 8000));
    renderDirectory();
  });
  $('#cdGrid').addEventListener('click', async ev => {
    const card = ev.target.closest('[data-lid]'); if (!card) return;
    const e = dir.list.find(x => x.lid === card.dataset.lid); if (!e) return;
    if (ev.target.closest('.cd-edit')) openEditor(draftFromEntry(e), { back: 'chars', onDone: async d => { await saveDraftToDirectory(d); ctx.toast(`Saved ${d.name}.`); } });
    if (ev.target.closest('.cd-del') && confirm(`Delete ${e.name} from your directory${cloudOn() ? ' and your account' : ''}? Films that use them keep their copy.${fsx.handle ? ' The file in your Drive folder stays.' : ''}`)) { await Store.deleteCharacter(e.lid); deleteCloud(e.lid).catch(err => ctx.toast('Deleted here, but not from your account: ' + err.message, true, 8000)); renderDirectory(); }
    if (ev.target.closest('.cd-export')) exportEntry(e).catch(err => ctx.toast(err.message, true));
    if (ev.target.closest('.cd-addto')) chooseFilm(e);
    if (ev.target.closest('.cd-add')) {
      const P = ctx.P();
      // a film with no story yet: the writer casts them (with this look, outfit and info) when it writes it
      if (!P.scenes?.length) { ctx.pickForStory(e.lid); ctx.toast(`${e.name} will be cast when you write the story.`, false, 7000); ctx.show('studio'); return; }
      const c = await addToFilm(e, P);
      ctx.castChanged();
      ctx.toast(`${c.name} is in “${P.title || 'your film'}”. Add them to shots in the storyboard, or ask the AI Director.`, false, 8000);
      if (dir.pickFor) { dir.pickFor = null; ctx.backToFilm(); }
    }
  });
  $('#cdPick').addEventListener('click', e => { if (e.target.closest('#cdPickDone')) { dir.pickFor = null; ctx.backToFilm(); } });
  $('#cdFilms').addEventListener('click', async ev => {
    const b = ev.target.closest('[data-pid]'); if (!b) return;
    const menu = $('#cdFilms'); menu.close();
    if (!b.dataset.pid) return;
    const e = dir.list.find(x => x.lid === menu.dataset.lid);
    const open = ctx.P();
    const P = open?.id === b.dataset.pid ? open : await Store.getProject(b.dataset.pid);
    if (!P || !e) return;
    const c = await addToFilm(e, P);
    if (P === open) ctx.castChanged();
    ctx.toast(`${c.name} is in “${P.title || 'that film'}”.`, false, 6000);
  });
}

// ---------------- export / import (a file of one character) ----------------
const blobToData = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
async function dataToBlob(s) {
  if (typeof s !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(s) || s.length > 12e6) throw new Error('a picture in the file is not a JPG, PNG or WebP');
  return (await fetch(s)).blob();
}
// one character as a file's contents (Export, and the Drive folder); lid lets the folder copy
// come back as the same character
async function characterFile(e) {
  const out = { format: 'voiceframe-character', version: 1, lid: e.lid, exportedAt: new Date().toISOString(), character: pickFields(e),
    portrait: e.portrait ? await blobToData(e.portrait) : null, sheet: e.sheet ? await blobToData(e.sheet) : null,
    history: await Promise.all((e.history || []).slice(-6).map(async h => ({ view: h.view, kind: h.kind, fav: !!h.fav, at: h.at, note: h.note || '', data: await blobToData(h.blob) }))) };
  delete out.character.consent;
  return out;
}
const slugOf = e => String(e.name || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'character';
async function exportEntry(e) {
  const out = await characterFile(e);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
  a.download = `${slugOf(e)}.vfchar.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
// An imported file is checked like an upload: every picture through the NSFW check, the
// portrait through the public-figure check, and a real photo only with the consent box.
async function importFile(f, { keepLid = false, updatedAt = 0 } = {}) {
  if (f.size > 40e6) throw new Error('the file is too big');
  let j;
  try { j = JSON.parse(await f.text()); } catch { throw new Error('not a VoiceFrame character file'); }
  if (j?.format !== 'voiceframe-character' || !j.character) throw new Error('not a VoiceFrame character file');
  const ch = pickFields(j.character);
  const str = (v, n) => String(v ?? '').slice(0, n);
  for (const k of ['name', 'era', 'setting', 'language', 'personality', 'voice', 'studioVoice']) if (ch[k] != null) ch[k] = str(ch[k], 80);
  for (const k of ['appearance', 'info']) if (ch[k] != null) ch[k] = str(ch[k], 1200);
  if (!['female', 'male'].includes(ch.gender)) ch.gender = 'female';
  if (!['child', 'teen', 'adult', 'elder'].includes(ch.age)) ch.age = 'adult';
  if (ch.perf && typeof ch.perf === 'object') ch.perf = { text: str(ch.perf.text, 200), ...parsePerformance(ch.perf.text) }; else delete ch.perf;
  ch.useMine = false; // a voice sample never travels in a file
  const portrait = j.portrait ? await dataToBlob(j.portrait) : null, sheet = j.sheet ? await dataToBlob(j.sheet) : null;
  const history = [];
  for (const h of (Array.isArray(j.history) ? j.history : []).slice(0, 6)) {
    try { history.push({ id: uid8(), blob: await dataToBlob(h.data), view: h.view === 'sheet' ? 'sheet' : 'portrait', kind: str(h.kind, 20) || 'imported', fav: !!h.fav, at: +h.at || Date.now(), note: str(h.note, 120) }); } catch { /* a bad picture is left out */ }
  }
  ctx.setStatus('Checking the imported character…', ch.name || f.name);
  try {
    for (const b of [portrait, sheet, ...history.map(h => h.blob)].filter(Boolean)) {
      try { await checkImage(b); } catch (e) { throw new Error(e?.safetyDown ? SAFETY_DOWN : 'a picture was blocked by the safety filter'); }
    }
    if (portrait || sheet) {
      const pf = await publicFigureCheck(portrait || sheet);
      if (!pf.ok) throw new Error(pf.why);
    }
  } finally { ctx.clearStatus(); }
  if (ch.realPhoto) {
    if (!await ctx.askPhotoConsent({ name: ch.name || 'this character' })) throw new Error('not imported (the photo needs your confirmation)');
    ch.consent = Date.now();
  }
  const user = ctx.user();
  // from the Drive folder a character keeps its id, so its file there stays its file
  const lid = keepLid && /^ch-[a-z0-9]{4,16}$/.test(String(j.lid || '')) ? j.lid : 'ch-' + uid8();
  const rec = { lid, uid: user.uid, ...ch, portrait, sheet, history, createdAt: Date.now(), updatedAt: updatedAt || Date.now() };
  await Store.saveCharacter(rec);
  if (!keepLid) { ctx.toast(`Imported ${ch.name || 'a character'} into your directory.`); copyToFolder(rec); copyToCloud(rec); }
  return rec;
}

// ---------------- the person's account (cloud.js) ----------------
// Every saved character is copied to the signed-in account; on a new device (or after the
// browser's data was cleared) the account's characters come back when the directory loads,
// checked like any import (safety check on every picture, public-figure check, and the
// person's OK again for a real photo). Characters made before this are copied up once.
const sync = { for: null, busy: false, at: 0 };
async function cloudFile(e) {
  const f = await characterFile({ ...e, history: [], portrait: await smaller(e.portrait, 640).catch(() => e.portrait), sheet: await smaller(e.sheet, 1280).catch(() => e.sheet) });
  return f;
}
export function copyToCloud(rec) {
  if (!cloudOn()) return Promise.resolve(false);
  return cloudFile(rec).then(f => putCloud(rec.lid, f, rec.updatedAt || rec.createdAt || Date.now())).then(ok => { if (ok) { sync.at = Date.now(); renderCloudNote(); } return ok; })
    .catch(err => { if (!err.quiet) ctx.toast('Saved on this device, but not to your account yet: ' + err.message, true, 8000); return false; });
}
async function syncCloud() {
  if (!cloudOn() || sync.busy) return;
  sync.busy = true;
  try {
    const remote = await listCloud();
    const local = await Store.listCharacters(ctx.user().uid).catch(() => []);
    const byLid = new Map(local.map(e => [e.lid, e]));
    let got = 0, bad = 0;
    // from the account: characters this device lacks, or has an older copy of
    for (const r of remote) {
      const mine = byLid.get(r.lid);
      if (mine && (mine.updatedAt || mine.createdAt || 0) >= r.updatedAt) continue;
      if (r.file?.format !== 'voiceframe-character') continue;
      try {
        await importFile(new File([JSON.stringify({ ...r.file, lid: r.lid })], r.lid + '.vfchar.json', { type: 'application/json' }), { keepLid: true, updatedAt: r.updatedAt });
        got++;
      } catch (err) { bad++; console.warn('account character', r.lid, err); }
    }
    // to the account: characters only this device has (made before, or while offline)
    const there = new Set(remote.map(r => r.lid));
    let sent = 0;
    for (const e of local) {
      if (there.has(e.lid) || there.size + sent >= MAX_CLOUD) continue;
      if (await copyToCloud(e)) sent++;
    }
    sync.at = Date.now();
    if (got) {
      ctx.toast(`☁ ${got} character${got === 1 ? '' : 's'} from your account ${got === 1 ? 'is' : 'are'} on this device now.${bad ? ` ${bad} could not be loaded.` : ''}`, false, 7000);
      if (!$('#view-chars')?.hidden) renderDirectory();
    }
  } catch (err) {
    if (!err.quiet) console.warn('account characters', err);
  } finally { sync.busy = false; renderCloudNote(); }
}
function renderCloudNote() {
  const p = $('#cdWhere');
  if (!p) return;
  p.textContent = cloudOn() && sync.at
    ? '☁ Your saved characters are kept in your account too: sign in on any device and they are there. Reference sheet, portrait, outfit, voice and info; cast them in any film.'
    : 'Your saved characters, on this device: reference sheet, portrait, outfit, voice and info. Cast them in any film.';
}

// ---------------- "Save to Google Drive folder" ----------------
// The person picks a folder once (e.g. G:\My Drive\VoiceFrame Characters, which Google Drive
// for desktop syncs); every character saved to the directory is then also written there as
// "<name> - <id>.vfchar.json" (the Export format) plus "<name> - <id>.jpg" (the portrait, to
// see in Drive). "Load from folder" brings them back (checked like any import). Chrome and Edge
// on a computer only (the File System Access API). The folder's handle is kept in its own
// small database: the main "voiceframe" database is never opened here.
const fsx = { handle: null, ok: false, warned: false };
export const folderSupported = () => typeof window.showDirectoryPicker === 'function';
const folderKey = () => 'chars-' + (ctx.user()?.uid || 'guest');
function folderDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('voiceframe-folder', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('handles')) r.result.createObjectStore('handles'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function folderStore(mode, fn) {
  const db = await folderDb();
  try {
    return await new Promise((res, rej) => { const tx = db.transaction('handles', mode); const req = fn(tx.objectStore('handles')); tx.oncomplete = () => res(req?.result); tx.onerror = () => rej(tx.error); });
  } finally { db.close(); }
}
const permOf = async h => { try { return await h.queryPermission({ mode: 'readwrite' }); } catch { return 'denied'; } };
// the saved folder for this person (permission is asked again after the browser restarts)
export async function loadFolder() {
  fsx.handle = await folderStore('readonly', s => s.get(folderKey())).catch(() => null) || null;
  fsx.ok = !!fsx.handle && await permOf(fsx.handle) === 'granted';
  fsx.loadedFor = folderKey();
  renderFolder();
}
async function chooseFolder() {
  let h;
  try { h = await window.showDirectoryPicker({ id: 'voiceframe-characters', mode: 'readwrite', startIn: 'documents' }); }
  catch (e) { if (e.name !== 'AbortError') ctx.toast('That folder can\'t be used: ' + e.message, true, 7000); return; }
  await folderStore('readwrite', s => s.put(h, folderKey()));
  Object.assign(fsx, { handle: h, ok: true, warned: false, loadedFor: folderKey() });
  renderFolder();
  await saveAllToFolder();
}
async function reconnectFolder() {
  if (!fsx.handle) return chooseFolder();
  let p = 'denied';
  try { p = await fsx.handle.requestPermission({ mode: 'readwrite' }); } catch { /* the folder was moved or removed */ }
  if (p !== 'granted') { ctx.toast('No access to that folder. Choose it again.', true); return chooseFolder(); }
  fsx.ok = true; renderFolder();
  await saveAllToFolder();
}
async function forgetFolder() {
  await folderStore('readwrite', s => s.delete(folderKey())).catch(() => {});
  Object.assign(fsx, { handle: null, ok: false });
  renderFolder();
  ctx.toast('The folder is no longer used. The files already in it stay there.');
}
// writes one character; false when no folder is connected
async function writeToFolder(e) {
  if (!fsx.handle) return false;
  if (!fsx.ok) {
    // a click (Done, Save) may still count as the person's gesture: ask once more
    try { fsx.ok = await fsx.handle.requestPermission({ mode: 'readwrite' }) === 'granted'; } catch { fsx.ok = false; }
    renderFolder();
    if (!fsx.ok) return false;
  }
  const base = `${slugOf(e)} - ${e.lid}`;
  const put = async (name, blob) => { const fh = await fsx.handle.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); };
  await put(base + '.vfchar.json', new Blob([JSON.stringify(await characterFile(e))], { type: 'application/json' }));
  const pic = e.portrait || e.sheet;
  if (pic) await put(base + '.jpg', pic);
  // a renamed character: its files under the old name go
  for await (const [name] of fsx.handle.entries()) {
    if ((name.endsWith(` - ${e.lid}.vfchar.json`) || name.endsWith(` - ${e.lid}.jpg`)) && !name.startsWith(base + '.')) await fsx.handle.removeEntry(name).catch(() => {});
    if (!pic && name === base + '.jpg') await fsx.handle.removeEntry(name).catch(() => {});
  }
  return true;
}
// after every save to the directory (never blocks the save itself)
export function copyToFolder(rec) {
  // (the folder is looked up first when the Characters page has not been opened yet)
  return (fsx.loadedFor === folderKey() ? Promise.resolve() : loadFolder()).then(() => writeToFolder(rec)).then(done => {
    if (done) { fsx.lastSaved = Date.now(); renderFolder(); return; }
    if (fsx.handle && !fsx.warned) { fsx.warned = true; ctx.toast('Saved on this device. To copy it to your Drive folder, press 📁 Reconnect in Characters.', false, 8000); }
    else if (!fsx.handle && folderSupported() && !fsx.warned) { fsx.warned = true; ctx.toast('Tip: in 📚 Characters, choose a Google Drive folder and every character you save is kept there too.', false, 8000); }
  }).catch(err => { console.warn('Drive folder', err); ctx.toast('Saved on this device, but writing to your Drive folder failed: ' + err.message, true, 8000); });
}
async function saveAllToFolder() {
  const list = await loadDirectory().catch(() => directory());
  let n = 0;
  ctx.setStatus('Saving characters to your Drive folder…', `${list.length} characters`);
  try { for (const e of list) if (await writeToFolder(e)) n++; }
  catch (err) { ctx.toast('Writing to the folder failed: ' + err.message, true, 8000); }
  finally { ctx.clearStatus(); }
  fsx.lastSaved = Date.now(); renderFolder();
  if (n) ctx.toast(`📁 ${n} character${n === 1 ? '' : 's'} saved in “${fsx.handle.name}”.`);
}
// the characters in the folder that are not in the directory (a new PC, cleared browser data)
async function loadFromFolder() {
  if (!fsx.ok) return reconnectFolder();
  const have = new Set((await loadDirectory().catch(() => directory())).map(e => e.lid));
  let n = 0, bad = 0;
  for await (const [name, h] of fsx.handle.entries()) {
    if (h.kind !== 'file' || !name.endsWith('.vfchar.json')) continue;
    const lid = (/ - (ch-[a-z0-9]+)\.vfchar\.json$/.exec(name) || [])[1];
    if (lid && have.has(lid)) continue;
    try { const rec = await importFile(await h.getFile(), { keepLid: true }); have.add(rec.lid); n++; }
    catch (err) { bad++; console.warn('folder import', name, err); }
  }
  await renderDirectory();
  ctx.toast(n ? `📁 ${n} character${n === 1 ? '' : 's'} loaded from “${fsx.handle.name}”.${bad ? ` ${bad} could not be loaded.` : ''}` : bad ? `${bad} file(s) could not be loaded.` : 'Every character in the folder is already in your directory.', !!bad && !n, 8000);
}
function renderFolder() {
  const box = $('#cdFolder');
  if (!box) return;
  if (!folderSupported()) { box.innerHTML = '<span class="tiny muted">📁 Saving to a Google Drive folder works in Chrome or Edge on a computer. Here, use ⤓ Export on a character.</span>'; return; }
  if (!fsx.handle) { box.innerHTML = '<button type="button" class="btn btn-ghost btn-sm" data-fold="choose">📁 Save to Google Drive folder</button> <span class="tiny muted">Pick a folder in Google Drive (e.g. My Drive › VoiceFrame Characters): every character you save is kept there too.</span>'; return; }
  const when = fsx.lastSaved ? ` · last saved ${new Date(fsx.lastSaved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  box.innerHTML = fsx.ok
    ? `<span class="tiny">📁 Saving to <b>${esc(fsx.handle.name)}</b> ✓${when}</span> <button type="button" class="btn btn-ghost btn-sm" data-fold="all">Save all now</button> <button type="button" class="btn btn-ghost btn-sm" data-fold="load">Load from folder</button> <button type="button" class="btn btn-ghost btn-sm" data-fold="choose">Change</button> <button type="button" class="btn btn-ghost btn-sm" data-fold="forget" title="Stop saving to this folder">✕</button>`
    : `<span class="tiny">📁 <b>${esc(fsx.handle.name)}</b> needs your OK again (the browser asks after a restart).</span> <button type="button" class="btn btn-primary btn-sm" data-fold="reconnect">Reconnect</button> <button type="button" class="btn btn-ghost btn-sm" data-fold="forget">✕</button>`;
}
function wireFolder() {
  $('#cdFolder')?.addEventListener('click', e => {
    const b = e.target.closest('[data-fold]'); if (!b) return;
    ({ choose: chooseFolder, reconnect: reconnectFolder, all: saveAllToFolder, load: loadFromFolder, forget: forgetFolder })[b.dataset.fold]?.().catch?.(err => ctx.toast(err.message, true, 7000));
  });
}

// ---------------- the old "My characters" list ----------------
// Characters saved before the directory (a project record "charlib-<uid>") are copied in
// once; the old record stays as it was.
export async function migrateOldLibrary(user) {
  const flag = 'vf_dir_migrated_' + user.uid;
  if (localStorage.getItem(flag)) return 0;
  const old = await Store.getProject('charlib-' + user.uid).catch(() => null);
  let n = 0;
  for (const c of old?.characters || []) {
    if (await Store.getCharacter('old-' + c.lid).catch(() => null)) continue;
    await Store.saveCharacter({ lid: 'old-' + c.lid, uid: user.uid, name: c.name, role: c.role, gender: c.gender, age: c.age, appearance: c.appearance, personality: c.personality, info: '', voice: c.voice,
      realPhoto: !!c.realPhoto, portrait: old.images?.['char-' + c.lid] || null, sheet: null, history: [], createdAt: Date.now() });
    n++;
  }
  localStorage.setItem(flag, '1');
  return n;
}

export function initCharacters(c) {
  ctx = c;
  wirePicker(); wireEditor(); wireDirectory(); wireGpt(); wireStartTabs(); wireCast(); wireFolder();
}
