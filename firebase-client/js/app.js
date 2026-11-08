import { requiresFullFootage, missingFootage, assertFullFootage, footageSummary } from './generation-policy.js?v=58';
import * as Auth from './auth.js?v=52';
import * as Store from './store.js?v=61';
import { paintImage, checkPicture, stockImage, relayStatus, relayHasMotion, refreshRelayMotion, relayCanPaintCast, paintersOut, API, Cancelled, Unsafe, relayFetch } from './ai.js?v=57';
import { checkImage, checkVideo, isSafe, warmSafety, SAFETY_DOWN } from './safety.js?v=57';
import { writeStory, writeActions, beatsText, parseBeats, beatsSentence, breakIntoShots, scenePrompt, gpuPaintPrompt, gpuPortraitPrompt, portraitPrompt, isReal, castFilm, SCENE_COUNT, translateFilm, pickShortMoment, storyFromTranscript } from './story.js?v=57';
import * as CR from './copyright.js?v=57';
import { Dictation, narratorsFor, voiceEngine as engineFor, voiceDownload, loadVoice, castVoices, castOptions, speak, playBuffer } from './voice.js?v=57';
import { languageNames, languageOptionsHTML, findLanguage, whisperCode, ensureScriptFont } from './langs.js?v=57';
import { mixFilm, previewScore } from './music.js?v=55';
import { Renderer, buildTimeline, sizeFor, srt, drawnShot } from './renderer.js?v=57';
import { exportFilm } from './exporter.js?v=57';
import { depthFor } from './depth.js?v=56';
import { facesFor } from './faces.js?v=52';
import { bodiesFor, motionFromVideo, clipMotionIssue } from './body.js?v=54';
import { askDirector, CAMS, AMBS, LONG, QUICK, NO_CHANGE, HANDOFF, toolOf, handoffPrompt } from './director.js?v=57';
import { runStudioVoices, studioEngine, filmLines, prepareVoiceSample, recorder, saveMyVoice, loadMyVoice, forgetMyVoice } from './studio.js?v=57';
import { initCharacters, openVoicePicker, openEditor, openDesigner, openDesignPopup, draftFromFilm, draftFromEntry, applyDraftToFilm, saveDraftToDirectory, renderDirectory, loadDirectory, directory, migrateOldLibrary, castCheck, alwaysAsk, checkedUpload } from './characters.js?v=61';
import { initDialogue, openDialogue } from './dialogue.js?v=57';
import { initOutfitPicker, openOutfitPicker, applyOutfitToFilm } from './outfit-ui.js?v=57';
import { voiceName, matchVoice, lineStyle, findVoice } from './voicebook.js?v=57';
import { OUTFITS, ensureFields, outfitFromText, outfitById, allowed, outfitIssue, outfitLabel, ageOf } from './outfits.js?v=57';

const $ = s => document.querySelector(s);
// the film-language picker lists every language in langs.js (before any project opens)
$('#optLang').innerHTML = languageOptionsHTML();
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = s => String(s || 'film').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'film';
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let user = null, P = null, job = null, afterAuth = 'studio', autoRender = false;
let voiceNote = ''; // latest narration progress, shown while other steps wait for it
const triedPortraits = new Set(); // portraits attempted this session (a failure isn't retried automatically)
let sceneAudio = null, timeline = null, mixBuf = null, video = null;
// the last MP4 made: it stays to watch and download while a newer version is rendered
let lastRender = null, renderJob = false;
// the AI Director: its edit history (undo), edits waiting for a running step, a re-render due
const undoStack = [], deferred = [];
let dirBusy = false, rerenderWanted = false;
let castPaused = false; // "Your cast" is open (nothing is painted meanwhile)
const urls = new Map();

// ============ helpers ============
function toast(msg, error = false, ms = 3800) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.className = 'toast', ms);
}
function blobURL(key, blob) {
  const old = urls.get(key);
  if (old?.blob === blob) return old.url;
  if (old) URL.revokeObjectURL(old.url);
  const url = URL.createObjectURL(blob);
  urls.set(key, { blob, url });
  return url;
}
// Each shot's picture and clip for the renderers, loaded as the film reaches it and let
// go of after: Chrome plays at most ~75 videos on a page, and hundreds of decoded
// pictures would take gigabytes. The most recent few of each stay ready.
async function decodePicture(blob) {
  let bmp = await createImageBitmap(blob);
  if (bmp.width > 2400) {
    const h = Math.round(bmp.height * 2400 / bmp.width);
    bmp.close(); bmp = await createImageBitmap(blob, { resizeWidth: 2400, resizeHeight: h, resizeQuality: 'high' });
  }
  return bmp;
}
function openClip(blob, i) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const done = ok => {
      clearTimeout(timer); v.onloadeddata = v.onerror = null;
      if (ok) return resolve(v);
      // an unreadable clip: the shot shows its picture with photo motion instead
      if (requiresFullFootage(P)) { URL.revokeObjectURL(v.src); v.removeAttribute('src'); v.load(); reject(new Error(`Shot ${i + 1} has an unreadable video clip. Replace or regenerate it before rendering full motion.`)); return; }
      console.warn(`Scene ${i + 1}: this browser cannot read its AI clip; using basic animation`);
      URL.revokeObjectURL(v.src); v.removeAttribute('src'); v.load(); resolve(null);
    };
    const timer = setTimeout(() => done(false), 15000);
    v.onloadeddata = () => done(v.duration > 0 && Number.isFinite(v.duration));
    v.onerror = () => done(false);
  });
}
const media = {
  pics: new Map(), clips: new Map(), keep: 10,
  image(i) { const e = this.pics.get(i); return e && e.blob === P?.images['scene-' + i] ? e.bmp : null; },
  video(i) { const e = this.clips.get(i); return e && e.blob === P?.videos?.['scene-' + i] ? e.el : null; },
  load(i) {
    if (!P || i < 0 || i >= P.scenes.length) return null;
    return Promise.all([
      this.get(this.pics, i, P.images['scene-' + i], b => decodePicture(b).catch(() => null), bmp => bmp?.close?.()),
      this.get(this.clips, i, P.videos?.['scene-' + i], b => openClip(b, i), el => { if (el) { URL.revokeObjectURL(el.src); el.removeAttribute('src'); el.load(); } })
    ]);
  },
  // the entry for shot i (made again if its picture or clip changed), as the newest
  get(map, i, blob, open, close) {
    let e = map.get(i);
    if (!blob) return null;
    if (e?.blob !== blob) {
      if (e) e.ready.then(() => close(e.bmp || e.el)).catch(() => {});
      e = { blob };
      e.ready = open(blob).then(x => { e.bmp = e.el = x; });
    }
    map.delete(i); map.set(i, e);
    while (map.size > this.keep) {
      const [k, old] = map.entries().next().value;
      map.delete(k); old.ready.then(() => close(old.bmp || old.el)).catch(() => {});
    }
    return e.ready;
  },
  // other pictures and clips a shot shows (picture-in-picture), by their media key
  extras: new Map(),
  extra(key) { const e = this.extras.get(key); return e && e.blob === (P?.videos?.[key] || P?.images?.[key]) ? e.bmp : null; },
  loadExtra(key) {
    const blob = P?.videos?.[key] || P?.images?.[key];
    if (!blob) return null;
    let e = this.extras.get(key);
    if (e?.blob !== blob) {
      e = { blob };
      const vid = !!P.videos?.[key];
      e.ready = (vid ? openClip(blob, -1) : decodePicture(blob).catch(() => null)).then(x => { if (x && vid) x.loop = true; e.bmp = x; });
      this.extras.set(key, e);
    }
    return e.ready;
  },
  clear() {
    for (const e of this.extras.values()) e.ready.then(() => { if (e.bmp?.src) { URL.revokeObjectURL(e.bmp.src); e.bmp.removeAttribute('src'); e.bmp.load(); } else e.bmp?.close?.(); });
    this.extras.clear();
    for (const e of this.pics.values()) e.ready.then(() => e.bmp?.close?.());
    for (const e of this.clips.values()) e.ready.then(() => { if (e.el) { URL.revokeObjectURL(e.el.src); e.el.removeAttribute('src'); e.el.load(); } });
    this.pics.clear(); this.clips.clear();
  }
};
let saveTimer;
function save(now = false) {
  if (!P) return;
  clearTimeout(saveTimer);
  const run = () => Store.saveProject(P).catch(e => {
    console.warn('save failed', e);
    // say so (once a minute): a full disk or blocked storage otherwise loses work silently
    if (Date.now() - (save.warned || 0) > 60000) { save.warned = Date.now(); toast(`Couldn't save this film on your device (${e?.name === 'QuotaExceededError' ? 'storage is full' : e?.message || 'storage error'}). Free some disk space, then make any change to save again.`, true, 10000); }
  });
  if (now) return run();
  saveTimer = setTimeout(run, 700);
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// ============ status / jobs ============
function setStatus(title, detail = '', progress = null) {
  $('#statusbar').hidden = false;
  if (!$('#view-chared').hidden) { $('#ceJobState').hidden = false; $('#ceJobTitle').textContent = title; $('#ceJobDetail').textContent = detail; }
  $('#statusTitle').textContent = title;
  $('#statusDetail').textContent = detail;
  if (progress != null) $('#statusBar').style.width = Math.round(progress * 100) + '%';
}
function clearStatus() { $('#ceJobState').hidden = true; $('#statusbar').hidden = true; $('#statusBar').style.width = '0'; }
// ---- safety: pictures and clips the checker blocked or could not check (safety.js) ----
// P.blocked[key] = 'unsafe' | 'down' (key: scene-<i> or char-<id>): the card says so, and
// nothing unchecked is used in its place.
function markBlocked(key, e) { (P.blocked ||= {})[key] = e?.safetyDown ? 'down' : 'unsafe'; }
const clearBlocked = key => { if (P.blocked) delete P.blocked[key]; };
const blockedText = key => (P.blocked?.[key] === 'down' ? SAFETY_DOWN : P.blocked?.[key] ? 'Blocked by the safety filter' : '');
const safetyToast = (what, e) => toast(e?.safetyDown ? `${what}: ${SAFETY_DOWN}.` : `${what} was blocked by the safety filter.`, true, 8000);
// Real people's faces (the person's own photo of a character, their own pictures and clips,
// real footage and photos): they may be animated gently, but are never lip-synced.
const realPhoto = id => P.credits['char-' + id]?.kind === 'user' || !!P.credits['char-' + id]?.real;
const REAL_FACE_NOTE = 'Lip-sync is off for real people\'s faces (your own photos and clips, real footage): they move gently, but their lips are never made to say words.';
const realFace = i =>['user', 'stock'].includes(P.credits['scene-' + i]?.kind) || !!P.credits['video-' + i]?.stock
  || (P.scenes[i]?.characters || []).some(realPhoto);
async function runJob(fn) {
  if (job) { toast('Still working on the last step. Cancel it first.'); return false; }
  $('#ceJobResult').textContent = '';
  job = new AbortController();
  const controller = job;
  // the picture checker loads while the job starts (the first visit downloads ~88 MB)
  warmSafety().catch(e => console.warn('safety check not ready:', e.why || e.message));
  try { await fn(job.signal); return true; }
  catch (e) {
    controller.abort();
    if (e instanceof Cancelled || e.name === 'AbortError') toast('Cancelled.');
    else { if (!$('#view-chared').hidden) $('#ceJobResult').textContent = e.message || 'Character generation failed. Your prompt is still here; try again.'; console.error(e); toast(e.message || 'Something went wrong.', true, e.unsafe ? 12000 : 6000); }
    return false;
  } finally { job = null; renderJob = false; clearStatus(); updateStepper(); setTimeout(afterJob); }
}
$('#btnCancel').onclick = () => job?.abort();

// ============ views ============
function show(view) {
  if (view === 'home') view = user ? 'projects' : 'landing';
  // the Character Designer: the character editor on a new character, no film needed
  if (view === 'designer' || view === 'aitools') { if (!user) { afterAuth = 'chars'; view = 'auth'; } else { openDesigner(view === 'aitools' ? 'tools' : 'words'); return; } }
  // "🎨 Character design" in the top bar: the design popup over the page that is open ("Done"
  // in the editor comes back to it)
  if (view === 'designpop') {
    if (!user) { afterAuth = 'chars'; view = 'auth'; }
    else { const here = ($$('.view').find(v => !v.hidden)?.id || 'view-chars').replace('view-', ''); openDesignPopup({ back: ['chared', 'auth', 'landing'].includes(here) ? 'chars' : here }); return; }
  }
  // "New video" in the top bar: a fresh film on the idea step (the film being made keeps its job)
  if (view === 'newvideo') {
    if (!user) { afterAuth = 'studio'; view = 'auth'; }
    else if (job) { toast('Still working on this film. Cancel it first, or wait until it finishes.'); view = 'studio'; }
    else { libPicked.clear(); newProject(); renderLib(); view = 'studio'; }
  }
  if (['studio', 'projects', 'chars', 'chared'].includes(view) && !user) { afterAuth = view === 'chared' ? 'chars' : view; view = 'auth'; }
  document.body.dataset.view = view;
  $$('.view').forEach(v => v.hidden = v.id !== 'view-' + view);
  window.scrollTo(0, 0);
  if (view === 'projects') renderProjects();
  if (view === 'chars') renderDirectory().catch(e => toast(e.message, true));
  if (view === 'studio' && user && !LIB) loadLib();
  if (view === 'studio' && !P) newProject();
}
document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) {
    e.preventDefault();
    if (go.dataset.mode) setAuthMode(go.dataset.mode);
    show(go.dataset.go);
    if (go.dataset.scroll) setTimeout(() => document.getElementById(go.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' }), 50);
    return;
  }
  const sc = e.target.closest('a[data-scroll]');
  if (sc) { e.preventDefault(); document.getElementById(sc.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' }); }
});

// ============ auth ============
let authMode = 'signin';
function setAuthMode(m) {
  authMode = m;
  const up = m === 'signup';
  $('#authTitle').textContent = up ? 'Create your studio' : 'Welcome back';
  $('#authSub').textContent = up ? 'Free account. Start making films in a minute.' : 'Sign in to start creating films.';
  $('#authSubmit').textContent = up ? 'Create account' : 'Sign in';
  $('#authSwitchText').textContent = up ? 'Already have an account?' : 'New to VoiceFrame?';
  $('#authSwitch').textContent = up ? 'Sign in' : 'Create an account';
  $$('.signup-only').forEach(x => x.hidden = !up);
  $$('.signin-only').forEach(x => x.hidden = up);
  $('#authForm [name=password]').autocomplete = up ? 'new-password' : 'current-password';
  $('#authError').textContent = '';
}
$('#authSwitch').onclick = e => { e.preventDefault(); setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); };
$('#authForm').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target), btn = $('#authSubmit');
  btn.disabled = true; $('#authError').textContent = '';
  try {
    if (authMode === 'signup') await Auth.signUp(f.get('name') || '', f.get('email'), f.get('password'));
    else await Auth.signIn(f.get('email'), f.get('password'));
    e.target.reset();
  } catch (err) { $('#authError').textContent = err.message; }
  btn.disabled = false;
};
$('#btnGoogle').onclick = async () => {
  try { await Auth.signInGoogle(); } catch (err) { $('#authError').textContent = err.message; }
};
$('#authReset').onclick = async e => {
  e.preventDefault();
  const email = $('#authForm [name=email]').value;
  if (!email) { $('#authError').textContent = 'Enter your email first, then tap “Forgot password?”.'; return; }
  try { await Auth.resetPassword(email); toast('Password reset email sent.'); } catch (err) { $('#authError').textContent = err.message; }
};
$('#btnSignOut').onclick = async () => { await Auth.signOut(); P = null; show('landing'); };

Auth.onUser(u => {
  const was = user;
  user = u;
  document.body.classList.toggle('signed-in', !!u);
  if (u) {
    // films live on this device: ask the browser not to clear them when the disk runs low
    // (without this, Chrome may evict the whole library under storage pressure)
    navigator.storage?.persist?.().catch(() => {});
    $('#userName').textContent = u.name;
    $('#userAvatar').innerHTML = u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : esc(u.name[0]?.toUpperCase() || 'U');
    if (!$('#view-auth').hidden) show(afterAuth);
    else if (!$('#view-landing').hidden) show('projects');
    if (pendingTemplate && !$('#view-studio').hidden) { applyTemplate(pendingTemplate); pendingTemplate = null; }
  } else if (was) show('landing');
});

// ============ projects ============
async function renderProjects() {
  const all = await Store.listProjects(user.uid);
  const query = ($('#projectSearch').value || '').trim().toLowerCase();
  const list = all.filter(p => !query || (p.title || 'Untitled idea').toLowerCase().includes(query));
  $('#dashboardProjectCount').textContent = all.length;
  $('#projectsEmptyTitle').textContent = query ? 'No matching projects' : 'Your first film starts here';
  $('#projectsEmptyText').textContent = query ? 'Try another project name.' : 'Create a video and it will appear in this workspace.';
  const grid = $('#projectsGrid');
  $('#projectsEmpty').hidden = list.length > 0;
  grid.innerHTML = list.map(p => {
    const img = p.images?.['scene-0'];
    return `<article class="proj-card" data-id="${p.id}">
      <div class="proj-thumb" style="${img ? `background-image:url(${blobURL('proj-' + p.id, img)})` : ''}"></div>
      <div class="proj-body"><h3>${esc(p.title || 'Untitled idea')}</h3>
      <div class="row"><span class="tiny muted">${new Date(p.updatedAt).toLocaleDateString()} · ${p.scenes?.length || 0} scenes · ${esc(p.options?.format || '16:9')}</span>
      <button class="btn btn-ghost btn-sm" data-del="${p.id}" title="Delete">🗑</button></div></div></article>`;
  }).join('');
}
$('#projectsGrid').onclick = async e => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    if (confirm('Delete this film? This cannot be undone.')) { await Store.deleteProject(del.dataset.del); if (P?.id === del.dataset.del) P = null; renderProjects(); }
    return;
  }
  const card = e.target.closest('.proj-card');
  if (card) openProject(await Store.getProject(card.dataset.id));
};
$('#projectSearch').addEventListener('input', () => { clearTimeout(renderProjects.searchTimer); renderProjects.searchTimer = setTimeout(renderProjects, 160); });
$('#btnNewProject').onclick = () => { newProject(); show('studio'); };

function newProject() {
  resetMedia();
  P = {
    id: crypto.randomUUID(), uid: user.uid, ownerName: user.name, createdAt: Date.now(),
    idea: '', options: { motion: 'full' }, images: {}, videos: {}, credits: {}, scenes: [], characters: [], flags: [],
    seed: Math.floor(Math.random() * 1e6), look: { bars: true, grain: true, captions: 'karaoke', watermark: false, depth: true }
  };
  $('#ideaInput').value = '';
  readOptionsToUI();
  goStep('idea');
}
function openProject(p) {
  resetMedia();
  P = p;
  $('#ideaInput').value = P.idea || '';
  readOptionsToUI();
  renderAll();
  show('studio');
  goStep(P.scenes?.length ? (allPainted() ? 'sound' : 'scenes') : 'idea');
}
function resetMedia() {
  media.clear();
  sceneAudio = null; timeline = null; mixBuf = null; video = null;
  player.unload();
  lastRender = null; undoStack.length = 0;
  $('#downloadBox').hidden = true; $('#staleNote').hidden = true;
}
function readOptionsToUI() {
  const o = P.options || {};
  const set = (id, v) => { if (v != null) $(id).value = v; };
  set('#optGenre', o.genre); set('#optLength', o.length); set('#optStyle', o.style); set('#optFormat', o.format);
  set('#optLang', o.language);
  $('#optUseOwn').checked = !!o.useOwn;
  if (o.enhance != null) $('#optEnhance').checked = o.enhance;
  if (o.motion) $('#optMotion').value = o.motion;
  if (o.check != null) $('#optCheck').checked = o.check;
  $('#optStock').checked = o.realFootage !== false;
  $('#optBars').checked = P.look?.bars ?? true; $('#optGrain').checked = P.look?.grain ?? true;
  $('#optWatermark').checked = !!P.look?.watermark; $('#optDepth').checked = P.look?.depth ?? true; $('#optFaces').checked = P.look?.faces ?? true; $('#optSfx').checked = P.sfx ?? true;
  set('#optCaptions', P.look?.captions); set('#optSpeed', P.speed); set('#optDialogue', P.dialogueMode);
  set('#optMood', P.moodOverride); if (P.musicVol != null) $('#optMusicVol').value = Math.round(P.musicVol * 100);
  speedNote();
}
function readOptions() {
  P.idea = $('#ideaInput').value.trim();
  P.options = {
    genre: $('#optGenre').value, length: $('#optLength').value, style: $('#optStyle').value, format: $('#optFormat').value,
    language: $('#optLang').value, useOwn: $('#optUseOwn').checked, enhance: $('#optEnhance').checked, motion: $('#optMotion').value, check: $('#optCheck').checked, realFootage: $('#optStock').checked
  };
  P.style = P.options.style; P.language = P.options.language;
}

// ============ stepper ============
const STEPS = ['idea', 'story', 'characters', 'scenes', 'sound', 'film'];
function goStep(step) {
  if (step !== 'idea' && !P?.scenes?.length) { toast('Write the story first.'); step = 'idea'; }
  $$('.panel').forEach(p => p.hidden = p.dataset.panel !== step);
  $$('#stepper button').forEach(b => b.classList.toggle('active', b.dataset.step === step));
  updateStepper();
  if (step === 'film') enterFilm().catch(error => toast(error.message, true, 10000));
  if (step === 'sound') fillNarrators();
  if (step === 'film') fillTranslateLangs();
  // Opening a step makes whatever it shows, so nothing waits for a button press.
  // (not while "Your cast" is open: nothing is painted before the person has checked the cast)
  if (!job && !castPaused && step === 'characters' && P.characters.some(c => !P.images['char-' + c.id] && !triedPortraits.has(c.id))) runJob(s => doPortraits(s));
  if (!job && !castPaused && step === 'scenes' && !allPainted()) runJob(s => doVisuals(s));
  $('.studio-main').scrollIntoView?.({ block: 'start' });
  window.scrollTo({ top: 0 });
}
// cards and map shots are drawn by the renderer: they need no picture
const needsPicture = i => !drawnShot(P.scenes[i]);
// a shot with a clip (real footage, the person's own, the GPU's) needs no picture of its own
function allPainted() { return P.scenes.length && P.scenes.every((_, i) => !needsPicture(i) || P.images['scene-' + i] || P.videos?.['scene-' + i]); }
function updateStepper() {
  if (!P) return;
  syncWorkspaceState();
  const done = {
    idea: !!P.scenes?.length, story: !!P.scenes?.length,
    characters: P.characters?.length && P.characters.every(c => P.images['char-' + c.id]),
    scenes: allPainted() && (!requiresFullFootage(P) || !missingFootage(P).length), sound: !!mixBuf, film: !!video
  };
  if (lastRender) $('#staleNote').hidden = video === lastRender;
  $$('#stepper button').forEach(b => b.classList.toggle('done', !!done[b.dataset.step] && !b.classList.contains('active')));
}
$('#stepper').onclick = e => { const b = e.target.closest('button[data-step]'); if (b) goStep(b.dataset.step); };
document.addEventListener('click', e => { const n = e.target.closest('[data-next]'); if (n) goStep(n.dataset.next); });

// ============ idea / dictation ============
// Ready-made story templates (landing page and the idea step): an idea plus settings.
const TEMPLATES = [
  { e: '🧒', name: "Kids' moral story", desc: 'A gentle fable with a lesson', genre: 'Kids / fable', length: 'medium', style: 'cinematic', format: '16:9',
    idea: 'A greedy little monkey and a kind old elephant in a jungle village learn that sharing food during a drought saves everyone' },
  { e: '🪔', name: 'Devotional katha', desc: 'A mythological tale told with reverence', genre: 'Mythology', length: 'long', style: 'cinematic', format: '16:9', lang: 'Hindi',
    idea: 'A poor village boy walks to a hilltop temple every day to offer a single flower, and the night of the festival his devotion is answered' },
  { e: '😂', name: 'Comedy Short', desc: 'A funny 20-second vertical sketch', genre: 'Comedy', length: 'shorts', style: 'cinematic', format: '9:16', lang: 'Hindi',
    idea: 'A strict grandmother catches her grandson pretending to study while secretly playing a mobile game under the textbook' },
  { e: '👻', name: 'Horror story', desc: 'Suspense and a twist, no gore', genre: 'Horror', length: 'long', style: 'cinematic', format: '16:9', lang: 'Hindi',
    idea: 'A night-shift watchman at an abandoned haveli hears a lullaby every night at 3 am, and finds out who has been singing it' },
  { e: '💞', name: 'Family drama', desc: 'An emotional story for story channels', genre: 'Drama', length: 'film5', style: 'cinematic', format: '16:9', lang: 'Hindi',
    idea: 'Two brothers who stopped speaking after a family quarrel must run their late father’s sweet shop together for one Diwali' },
  { e: '🚀', name: 'Motivational', desc: 'An underdog who never gives up', genre: 'Motivational', length: 'medium', style: 'cinematic', format: '16:9',
    idea: 'A tea seller’s daughter studies under a street lamp every night and cracks the hardest exam in the country' },
  { e: '🏛️', name: 'History lesson', desc: 'A moment from history as a short film', genre: 'History', length: 'medium', style: 'cinematic', format: '16:9',
    idea: 'The night an ancient Nalanda librarian races to save rare manuscripts before invaders reach the great library' },
  { e: '💼', name: 'Business explainer', desc: 'A product story for customers', genre: 'Drama', length: 'short', style: 'cinematic', format: '9:16',
    idea: 'A small-town tailor gets her first online order and learns how a simple app helps her reach customers across India' }
];
const tplCard = (t, k) => `<button class="tpl" type="button" data-tpl="${k}"><i>${t.e}</i><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></button>`;
$('#tplGrid').innerHTML = TEMPLATES.map(tplCard).join('');
$('#tplChips').innerHTML = TEMPLATES.map((t, k) => `<button class="chip" type="button" data-tpl="${k}">${t.e} ${esc(t.name)}</button>`).join('');
function applyTemplate(t) {
  $('#ideaInput').value = t.idea;
  $('#optGenre').value = t.genre; $('#optLength').value = t.length; $('#optStyle').value = t.style; $('#optFormat').value = t.format;
  if (t.lang) $('#optLang').value = t.lang;
  $('#optLength').dispatchEvent(new Event('change'));
  setSource('idea');
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-tpl]');
  if (!b) return;
  const t = TEMPLATES[+b.dataset.tpl];
  if ($('#view-studio').hidden) {
    show('studio');
    if (!user) { pendingTemplate = t; return; } // applied after sign-in
  }
  applyTemplate(t);
  toast(`Template “${t.name}” loaded. Change the idea if you like, then create.`);
});
let pendingTemplate = null;

// Feature tabs on the landing page, and idea / audio source tabs in the studio.
$('#features').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  $$('#features [data-tab]').forEach(x => x.classList.toggle('active', x === b));
  $$('#features [data-tabpanel]').forEach(p => p.hidden = p.dataset.tabpanel !== b.dataset.tab);
});
let source = 'idea';
function setSource(src) {
  source = src;
  $$('[data-source]').forEach(x => x.classList.toggle('active', x.dataset.source === src));
  $$('[data-sourcepanel]').forEach(p => p.hidden = p.dataset.sourcepanel !== src);
  $('#btnAuto').textContent = src === 'audio' ? '🎬 Make a film from my audio' : '🎬 Create full film automatically';
  $('#btnStoryOnly').hidden = src === 'audio';
}
document.addEventListener('click', e => { const b = e.target.closest('[data-source]'); if (b) setSource(b.dataset.source); });
$('#audioFile').addEventListener('change', e => { const f = e.target.files[0]; $('#audioName').textContent = f ? `🎧 ${f.name} · ${(f.size / 1048576).toFixed(1)} MB` : '🎧 Choose an audio file'; });

const dict = new Dictation({
  onText: (base, interim) => { $('#ideaInput').value = (base + (interim ? ' ' + interim : '')).trim(); },
  onState: (s, err) => {
    $('#btnMic').classList.toggle('listening', s === 'listening');
    $('#micState').textContent = s === 'listening' ? 'Listening… speak your idea' : s === 'error'
      ? (err === 'not-allowed' ? 'Microphone permission was blocked' : 'Mic error: ' + err) : 'Tap the mic and speak';
  },
  onCommand: cmd => {
    if (cmd === 'stop') return dict.stop();
    if (cmd === 'clear') { $('#ideaInput').value = ''; dict.base = ''; toast('Cleared.'); return; }
    dict.stop();
    toast(cmd === 'create' ? '🎬 Voice command: creating your film' : '✍️ Voice command: writing the story');
    (cmd === 'create' ? $('#btnAuto') : $('#btnStoryOnly')).click();
  }
});
$('#btnMic').onclick = () => {
  if (!dict.supported) { toast('Voice input needs Chrome, Edge or Safari. You can type instead.', true); return; }
  if (dict.listening) dict.stop(); else dict.start($('#micLang').value, $('#ideaInput').value);
};
// Roughly how long a film takes: story, pictures and voices in minutes; AI motion and
// lip-sync on the free GPU at about 1.5 shots a minute (measured), plus its start-up.
function speedNote() {
  const n = SCENE_COUNT[$('#optLength').value] || 10, shots = $('#optLength').value === 'shorts' ? n : Math.round(n * 2.4);
  const mode = motionMode(), gpuShots = mode === 'hero' ? Math.min(12, shots) : shots;
  $('#speedNote').textContent = `About ${shots} shots · story, pictures and voices are prepared first. `
    + (mode === 'live' ? 'Basic mode animates still pictures on your device.' : 'Real footage is generated on a shared GPU. Availability and completion time vary; full-motion export waits for finished clips.');
}
// live: no GPU; hero: the speaking shots that matter most; full: every shot
const motionMode = () => $('#optMotion')?.value || 'full';
// Up to 12 shots for the GPU: speaking shots first (close and medium shots, longer lines),
// spread over the film; the rest keep live faces.
// Shots whose action needs a real video model come first: walking, running, dancing,
// hand-overs, hugs, sitting down. Talking close-ups move well enough as live characters.
const BODY_MOVES = /walk|run|dance|give|hug|sit|turn|pull|clap/;
function heroShots(cands) {
  const score = i => {
    const s = P.scenes[i], line = s.dialogue?.[0]?.line || '';
    const body = (s.beats || []).filter(b => BODY_MOVES.test(b.move)).length || (/\b(walk|run|danc|hand(s|ing)? over|hug|sit|turn|pull|climb|jump)/i.test(`${s.action || ''} ${s.visual || ''}`) ? 1 : 0);
    return body * 12 + (line ? 4 : 0) + (/wide|medium/.test(s.shot || '') ? 2 : 0) + Math.min(2, line.length / 40);
  };
  const best = [...cands].sort((a, b) => score(b) - score(a)).slice(0, 12);
  return best.sort((a, b) => a - b);
}
['#optLength', '#optMotion'].forEach(s => $(s).addEventListener('change', speedNote));
$('#optMotion').addEventListener('change', () => { if ($('#optMotion').value !== 'live') showGpuState(); syncWorkspaceState(); });
setTimeout(showGpuState, 3000);
// A YouTube Short is always vertical and character-voiced.
$('#optLength').addEventListener('change', () => {
  if ($('#optLength').value !== 'shorts') return;
  $('#optFormat').value = '9:16'; $('#optDialogue').value = 'voiced';
  if ($('#optStyle').value === 'painterly' || $('#optStyle').value === 'watercolor') $('#optStyle').value = 'cinematic';
});
relayStatus.then(() => { $('#gpuMotionRow').hidden = false; speedNote(); syncWorkspaceState(); });

// ============ copyright gate ============
function askCopyright(flags) {
  return new Promise(resolve => {
    const d = $('#crDialog');
    $('#crDialogText').innerHTML = `Your idea mentions <b>${flags.map(esc).join(', ')}</b>. These are protected by copyright or trademark, and a video using them can be blocked or demonetised.<br><br>VoiceFrame can keep the spirit of your idea but build <b>original characters and names</b> instead.`;
    d.onclose = () => resolve(d.returnValue || 'edit');
    d.returnValue = '';
    d.showModal();
  });
}

// ============ step 1→2: story ============
let LIB = null;
const libPicked = new Set();
// "My characters" on the idea page: the character directory (characters saved before it
// existed are copied in once).
async function loadLib() {
  if (!user) return;
  await migrateOldLibrary(user).catch(e => console.warn('old character list', e));
  const list = await loadDirectory();
  LIB = { characters: list, images: Object.fromEntries(list.filter(e => e.portrait).map(e => ['char-' + e.lid, e.portrait])) };
  renderLib();
}
function renderLib() {
  const row = $('#libRow');
  if (!row) return;
  row.hidden = !LIB?.characters?.length;
  $('#libChips').innerHTML = (LIB?.characters || []).map(c => `<button type="button" class="chip lib-chip${libPicked.has(c.lid) ? ' on' : ''}" data-lid="${c.lid}" title="${esc(c.appearance)}">${libPicked.has(c.lid) ? '✓ ' : ''}${esc(c.name)}</button>`).join('');
}
$('#libChips').addEventListener('click', e => {
  const b = e.target.closest('.lib-chip'); if (!b) return;
  libPicked.has(b.dataset.lid) ? libPicked.delete(b.dataset.lid) : libPicked.add(b.dataset.lid);
  renderLib();
});
async function saveToLib(c) {
  if (!user) throw new Error('Sign in to keep characters.');
  ensureFields(c);
  const rec = await saveDraftToDirectory(draftFromFilm(P, c));
  c.lid = rec.lid; save();
  await loadLib();
  toast(`⭐ ${c.name} is saved in your character directory (with sheet, outfit, voice and info). Cast them in any film from 📚 Characters.`, false, 7000);
}
const pickedLib = () => (LIB?.characters || []).filter(c => libPicked.has(c.lid));
function ideaWithCast() {
  const cast = pickedLib();
  return cast.length ? `${P.idea}\nCast these recurring characters, with exactly these names and looks: ${cast.map(c => `${c.name} (${c.gender}, ${ageOf(c)} years old${c.outfit ? ', wearing ' + outfitLabel(c.outfit) : ''}): ${c.appearance}${c.info ? ` (how they look and act: ${String(c.info).slice(0, 200)})` : ''}`).join('; ')}` : P.idea;
}
// the saved characters keep their look, voice and portrait in the new film
function castFromLib() {
  for (const lc of pickedLib()) {
    const c = P.characters.find(x => x.name.trim().toLowerCase() === lc.name.trim().toLowerCase());
    if (!c) continue;
    // the directory character's look, outfit, voice, info, portrait and sheet, linked to it
    const d = draftFromEntry(lc);
    d.cid = c.id;
    applyDraftToFilm(P, d);
    c.lid = lc.lid;
    if (P.images['char-' + c.id]) triedPortraits.add(c.id);
  }
}
async function doStory(signal, { plan = true } = {}) {
  readOptions();
  if (P.idea.length < 8) { $('#ideaInput').focus(); throw new Error('Tell me a little more about your story (a sentence is enough).'); }
  const flags = CR.screen(P.idea);
  let makeOriginal = false;
  if (flags.length) {
    const choice = await askCopyright(flags);
    if (choice !== 'original') { $('#ideaInput').focus(); throw new Cancelled(); }
    makeOriginal = true;
  }
  setStatus('Writing your story…', 'The AI writer is building the plot, characters and scenes', 0.1);
  const s = await writeStory({
    idea: ideaWithCast(), genre: P.options.genre, length: P.options.length, language: P.options.language,
    useOwn: P.options.useOwn, makeOriginal, signal, real: isReal(P.options),
    onStatus: (detail, p) => setStatus('Writing your story…', detail, p)
  });
  // Shorts are already one line per shot; longer films are broken into shots (an automatic
  // film with "Your cast" plans them in the background while the cast is checked: plan false)
  if (plan && P.options.length !== 'shorts') {
    s.scenes = await breakIntoShots(s, { signal, real: isReal(P.options), onStatus: d => setStatus('Planning the shots…', d, 0.95) });
    s.shotMode = true;
  }
  await applyStory(s, flags);
  castFromLib();
}

// Shot planning and casting in the background while "Your cast" is open: they need only
// the story, so the person is asked about the cast within seconds instead of after minutes
// of planning. They work on a copy; a cast or script changed in "Your cast" is planned again.
const castKey = p => JSON.stringify(p.characters.map(c => [c.id, c.name, c.appearance, c.gender, c.age, c.ageYears]));
const fullCastKey = p => JSON.stringify(p.characters.map(c => [c.id, c.name, c.appearance, c.gender, c.age, c.ageYears, c.outfit, c.info]));
const scriptKey = p => JSON.stringify(p.scenes.map(sc => [sc.narration, (sc.dialogue || []).map(d => [d.character, d.line])]));
function planInBackground() {
  const ctl = new AbortController();
  const story = structuredClone({ title: P.title, logline: P.logline, setting: P.setting, characters: P.characters, scenes: P.scenes });
  const bg = { ctl, keys: [castKey(P), fullCastKey(P), scriptKey(P)], status: '', shots: null, casting: null };
  const real = isReal(P.options), shorts = P.options.length === 'shorts', withCasting = P.options?.realFootage !== false;
  bg.done = (async () => {
    try {
      const shots = shorts ? story.scenes : await breakIntoShots(story, { signal: ctl.signal, real, onStatus: d => { bg.status = d; } });
      if (ctl.signal.aborted) return;
      if (!shorts) bg.shots = shots;
      if (withCasting) { bg.status = 'Casting…'; bg.casting = await castFilm({ ...story, scenes: shots }, { signal: ctl.signal }); }
    } catch (e) { if (!ctl.signal.aborted) console.warn('background planning', e); }
  })();
  return bg;
}
function applyCasting(c) {
  P.casting = { roles: c.roles, extras: c.extras, at: Date.now() };
  for (const r of c.roles) { const ch = P.characters.find(x => x.id === r.id); if (ch) ch.casting = r.brief; }
  P.scenes.forEach((sc, i) => {
    const s = c.shots.find(x => x.n === i + 1);
    if (s) Object.assign(sc, { source: 'stock', stockQueries: s.queries, era: s.era, avoid: s.avoid });
    else sc.source = 'generated';
  });
}
// After "Your cast": the background plan is used when the cast and script it was made from
// are unchanged; otherwise (or when it failed) the shots are planned again now.
async function finishPlanning(bg, signal) {
  const stop = () => bg.ctl.abort();
  signal.addEventListener('abort', stop, { once: true });
  try {
    const sameCast = castKey(P) === bg.keys[0], sameScript = scriptKey(P) === bg.keys[2];
    if (!sameCast || !sameScript) bg.ctl.abort();
    else {
      const tick = setInterval(() => setStatus('Planning the shots…', bg.status || 'Started while you checked the cast', 0.95), 500);
      try { await bg.done; } finally { clearInterval(tick); }
    }
    if (signal.aborted) throw new Cancelled();
    if (P.options.length !== 'shorts') {
      let shots = sameCast && sameScript ? bg.shots : null;
      if (!shots) shots = await breakIntoShots(P, { signal, real: isReal(P.options), onStatus: d => setStatus('Planning the shots…', d, 0.95) });
      else {
        // the shots carry the script as it is now (delivery tags set in "Your cast", say)
        const nth = {};
        for (const sh of shots) {
          if (!sh.dialogue?.length) continue;
          const k = nth[sh.sceneOf] = (nth[sh.sceneOf] ?? -1) + 1;
          const d = P.scenes[sh.sceneOf]?.dialogue?.[k];
          if (d) sh.dialogue = [d];
        }
      }
      // outfits chosen for a scene in "Your cast" go to every shot of that scene
      for (const sh of shots) { const o = P.scenes[sh.sceneOf]?.outfits; if (o) sh.outfits = structuredClone(o); }
      P.scenes = shots;
      P.shotMode = true;
    }
    if (P.options?.realFootage !== false) {
      if (bg.casting && sameCast && sameScript && fullCastKey(P) === bg.keys[1]) applyCasting(bg.casting);
      else await doCasting(signal);
    }
    renderAll();
    await save(true);
  } finally { signal.removeEventListener('abort', stop); }
}

// A new story replaces the old one's pictures, clips and sound.
async function applyStory(s, flags = []) {
  P.images = {}; P.videos = {}; P.files = {}; P.credits = {};
  Object.assign(P, s, { flags });
  P.characters.forEach(c => delete c.voice);
  P.storyFlags = CR.screen([P.title, P.story, ...P.characters.map(c => c.name)].join(' '));
  sceneAudio = null; mixBuf = null; video = null;
  renderAll();
  await save(true);
}

async function doPortraits(signal, { onlyMissing = true } = {}) {
  const list = P.characters.filter(c => !onlyMissing || !P.images['char-' + c.id]);
  list.forEach(c => triedPortraits.add(c.id));
  let done = 0;
  setStatus('Designing the characters…', `0 of ${list.length}`, 0);
  // every character at once: the relay paints them in parallel
  await Promise.all(list.map(async (c, k) => {
    const key = 'char-' + c.id;
    markLoading(key, true);
    const seed = P.seed + 1000 + k + (onlyMissing ? 0 : Math.floor(Math.random() * 999));
    try {
      let best = null, fix = '';
      // the checker on this device blocks a picture (Unsafe with .picture): asked for again, safely worded
      for (let attempt = 0; attempt < 3; attempt++) {
        let img;
        try {
          img = await paintImage(portraitPrompt(P, c) + fix, {
            width: 768, height: 1024, seed: seed + attempt * 101, signal,
            onWait: sec => setStatus('Designing the characters…', `${done} of ${list.length} · painters busy, retrying in ${sec}s`, done / list.length)
          });
        } catch (e) { if (e.unsafe && e.picture) { fix = SAFE_FIX; console.warn(`Portrait of ${c.name} blocked on this device (nsfw ${e.score?.toFixed(2)})`); continue; } throw e; }
        if (!checksOn()) { best = { img, s: seed }; break; }
        const v = await checkPicture({ image: await checkJpeg(img), expect: `A head-and-shoulders portrait of one person: ${personText(c)}` + realCheck(), signal });
        if (v?.unsafe) { fix = SAFE_FIX; console.warn(`Portrait of ${c.name} failed the safety check (${v.model}):`, v.problems); continue; }
        const score = v ? v.problems.length : 99;
        if (!best || score < best.score) best = { img, s: seed + attempt * 101, v, score };
        if (!v || v.ok) break;
        fix = fixNote(v.problems);
        console.info(`Portrait of ${c.name} check failed (${v.model}):`, v.problems);
      }
      if (!best) throw new Unsafe(`Every portrait of ${c.name} failed the safety check.`);
      P.images[key] = best.img;
      P.credits[key] = { kind: 'ai', seed: best.s };
      clearBlocked(key);
      save();
    } catch (e) {
      // A busy image service shouldn't stop the film: the card keeps its placeholder.
      if (e instanceof Cancelled) throw e;
      if (e.unsafe || e.safetyDown) markBlocked(key, e);
      toast(e.safetyDown ? `${c.name}'s portrait: ${SAFETY_DOWN} (🎨 on the card).` : e.unsafe ? `${c.name}'s portrait was blocked by the safety filter. Edit the description (family-friendly, fully clothed) and press 🎨.` : `Couldn't design ${c.name}'s portrait right now. Use 🎨 on the card to retry later.`, true, 7000);
    } finally {
      done++;
      if (!signal?.aborted) setStatus('Designing the characters…', `${done} of ${list.length} ready`, done / list.length);
      markLoading(key, false); renderCast();
    }
  }));
}

function sceneSize() {
  const f = P.options.format;
  // shots get a motion clip of 1024x576, so their pictures need no more
  if (P.shotMode) return f === '9:16' ? [576, 1024] : f === '1:1' ? [768, 768] : [1024, 576];
  return f === '9:16' ? [720, 1280] : f === '1:1' ? [1024, 1024] : [1280, 720];
}
// The portraits of the characters in a shot (up to four, under 512 px) as references,
// so every shot shows the same faces and clothes, like a filmed drama.
const refCache = new WeakMap(); // portrait Blob -> its small base64 JPEG, made once per film
function refOf(blob) {
  if (!refCache.has(blob)) refCache.set(blob, (async () => {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
    const cv = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    bmp.close();
    return toBase64(await cv.convertToBlob({ type: 'image/jpeg', quality: 0.9 }));
  })());
  return refCache.get(blob);
}
// ---- picture check: the cast as the script describes them ----
const AGE_WORDS = { child: 'a child (about 6-12 years old)', teen: 'a teenager', adult: 'an adult', elder: 'an old person (60+)' };
const castOf = sc => (sc.characters || []).map(id => P.characters.find(c => c.id === id)).filter(Boolean);
const personText = c => `${c.name}: ${c.gender || ''}, ${AGE_WORDS[c.age] || c.age || ''}, ${String(c.appearance || '').slice(0, 220)}`;
const REAL_CHECK = ' Style check: it must look like a real photograph of real people and a real place, as filmed by a camera. A drawing, cartoon, illustration, storybook art, painting, anime or 3D render is a problem.';
const realCheck = () => (isReal(P) ? REAL_CHECK : '');
function expectFor(sc) {
  const cast = castOf(sc);
  if (sc.shot === 'macro') return `A macro insert shot: hands, food or objects fill the frame; faces may be out of frame (that is expected, not a problem). If hands or arms show, their skin tone and sleeves match: ${cast.map(c => `${c.name}: ${String(c.appearance || '').slice(0, 120)}`).join(' | ') || 'anyone'}. Scene: ${String(sc.visual || '').slice(0, 300)}` + realCheck();
  return (cast.length ? `${cast.length} main ${cast.length > 1 ? 'people' : 'person'}: ${cast.map(personText).join(' | ')}. ` : 'No main characters. ')
    + `Scene: ${String(sc.visual || '').slice(0, 300)}` + realCheck();
}
const checksOn = () => P.options?.check !== false;
const checkJpeg = blob => smallJpeg(blob, 768, 0.85);
async function smallJpeg(blob, max, q) {
  const bmp = await createImageBitmap(blob), k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close();
  return toBase64(await cv.convertToBlob({ type: 'image/jpeg', quality: q }));
}
// Checks a picture; returns the verdict (null when no checker answered).
async function checkShot(blob, sc, signal) {
  const cast = castOf(sc).filter(c => P.images['char-' + c.id]).slice(0, 4);
  const refs = await Promise.all(cast.map(async c => ({ name: c.name, b64: await smallJpeg(P.images['char-' + c.id], 384, 0.85) })));
  return checkPicture({ image: await checkJpeg(blob), refs, expect: expectFor(sc), signal });
}
const fixNote = problems => problems?.length ? `. Must fix: ${problems.join('; ')}` : '';
// asked for again after a picture failed the safety check
const SAFE_FIX = '. Family-friendly film still: everyone fully and modestly clothed in everyday clothes, calm pose, no blood or injuries';

async function castRefs(sc, i = -1) {
  // the shot before, when it is the same scene: same place, light, props and clothes
  const prev = i > 0 && P.scenes[i - 1] && (P.scenes[i - 1].sceneOf ?? i - 1) === (sc.sceneOf ?? i) && P.images['scene-' + (i - 1)] && P.credits['scene-' + (i - 1)]?.kind !== 'user'
    ? P.images['scene-' + (i - 1)] : null;
  const cast = (sc.characters || []).map(id => P.characters.find(c => c.id === id)).filter(c => c && P.images['char-' + c.id]).slice(0, prev ? 3 : 4);
  if (!cast.length && !prev) return { refs: undefined, note: '' };
  const refs = await Promise.all(cast.map(c => refOf(P.images['char-' + c.id])));
  const who = cast.map((c, k) => `image ${k} is ${c.name}`);
  // each character's reference sheet (front, side and back, face and outfit details) while there is room
  for (const c of cast) {
    const sheet = P.images['sheet-' + c.id];
    if (!sheet || refs.length >= (prev ? 3 : 4)) continue;
    refs.push(await refOf(sheet));
    who.push(`image ${refs.length - 1} is ${c.name}'s reference sheet (front, side and back views, face and outfit details)`);
  }
  if (prev) { refs.push(await refOf(prev)); who.push(`image ${refs.length - 1} is the previous shot of this same scene`); }
  return { refs, note: `. Reference images: ${who.join(', ')}. IDENTITY LOCK: each person is exactly the same person as in their reference images (same face shape, eyes, nose, jaw, hairline, hair, skin tone, age and clothes); use the references only for who they are, never for pose, framing, camera angle, backdrop or a look into the lens${prev ? '; keep the same place, background, lighting and props as the previous shot, seen from this shot\'s camera' : ''}; pose, angle and action exactly as described in this shot` };
}

async function paintScene(i, signal, reseed = false) {
  const key = 'scene-' + i, sc = P.scenes[i];
  const [w, h] = sceneSize();
  const seed = P.seed + i * 7 + (reseed ? Math.floor(Math.random() * 9999) : 0);
  markLoading(key, true);
  if (P.videos) delete P.videos[key]; // a new picture needs a new clip
  try {
    try {
      const ref = await castRefs(sc, i);
      const want = checksOn() && castOf(sc).length;
      let best = null, fix = '', unlocked = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const s2 = seed + attempt * 101;
        const opts = { width: w, height: h, seed: s2, signal, refs: ref.refs, lock: !!ref.refs && !unlocked,
          onWait: sec => setStatus('Painting scenes…', `Scene ${i + 1} of ${P.scenes.length} · ${ref.refs ? 'waiting for the cast painter' : 'painters busy'}, retrying in ${sec}s`) };
        let img;
        try {
          try { img = await paintImage(scenePrompt(P, sc) + ref.note + fix, opts); }
          catch (e) {
            // the painter that sees the portraits is out for today: paint from the descriptions, then check
            if (!e.castOut) throw e;
            unlocked = true; img = await paintImage(scenePrompt(P, sc) + fix, { ...opts, refs: undefined, lock: false });
          }
        } catch (e) {
          // blocked by the checker on this device: asked for again, safely worded (three tries in all)
          if (!(e.unsafe && e.picture)) throw e;
          fix = SAFE_FIX; console.warn(`Shot ${i + 1} blocked on this device (nsfw ${e.score?.toFixed(2)})`);
          if (attempt < 2) continue;
          break;
        }
        if (!want) { best = { img, seed: s2 }; break; }
        setStatus('Checking the pictures…', `Shot ${i + 1}: the right people, faces and hands`);
        const v = await checkShot(img, sc, signal);
        if (v?.unsafe) { fix = SAFE_FIX; console.warn(`Shot ${i + 1} failed the safety check (${v.model}):`, v.problems); continue; }
        const score = v ? v.problems.length : 99;
        if (!best || score < best.score) best = { img, seed: s2, v, score };
        if (!v || v.ok) break;
        fix = fixNote(v.problems);
        console.info(`Shot ${i + 1} check failed (${v.model}):`, v.problems);
      }
      if (!best) throw new Unsafe(`Every picture for shot ${i + 1} failed the safety check.`);
      // a frame the person uploaded meanwhile wins over the free painting
      if (P.credits[key]?.kind === 'user') return;
      P.images[key] = best.img;
      P.credits[key] = { kind: 'ai', seed: best.seed, ...(unlocked ? { unlocked: true } : {}) };
      clearBlocked(key);
      P.checks ||= {};
      if (best.v) P.checks[key] = { ok: best.v.ok, problems: best.v.problems, model: best.v.model }; else delete P.checks[key];
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      if (e.safetyDown) {
        // the checker could not run: no unchecked picture is used, the card says so
        markBlocked(key, e);
        toast(`Shot ${i + 1}: ${SAFETY_DOWN} (🎨 Repaint).`, true, 8000);
        return;
      }
      if (e.unsafe) {
        markBlocked(key, e);
        toast(`Shot ${i + 1} was blocked by the safety filter. Edit its picture description (family-friendly) and press 🎨 Repaint.`, true, 8000);
        return;
      }
      // every painter stayed busy for minutes (the relay already tried each one): use a
      // public-domain photo so the film finishes; 🎨 on the card paints it later
      console.warn(`Scene ${i + 1}: ${e.message} → public-domain photo`);
      const used = new Set(Object.values(P.credits).map(c => c.id).filter(Boolean));
      let r;
      try { r = await stockImage(sc.stock, P.options.format, used, signal); }
      catch (e2) {
        if (e2 instanceof Cancelled) throw e2;
        if (e2.safetyDown) { markBlocked(key, e2); toast(`Shot ${i + 1}: ${SAFETY_DOWN}.`, true, 8000); return; }
        // no painter and no matching free photo: this shot waits, the other shots go on
        toast(`Shot ${i + 1}: the free painters are busy and no free photo matched. Press 🎨 Repaint on it later.`, true, 8000);
        return;
      }
      P.images[key] = r.blob; P.credits[key] = r.credit; clearBlocked(key);
    }
  } finally { markLoading(key, false); renderSceneImage(i); save(); }
}
// Checks pictures that were painted elsewhere (the GPU) and repaints the ones that show
// the wrong people; two at a time.
async function checkShots(signal, idxs = P.scenes.map((_, i) => i)) {
  if (!checksOn()) return;
  P.checks ||= {};
  const todo = idxs.filter(i => P.images['scene-' + i] && !P.checks['scene-' + i] && castOf(P.scenes[i]).length && P.credits['scene-' + i]?.kind !== 'user' && !P.videos?.['scene-' + i]);
  let done = 0, redo = 0;
  const q = [...todo];
  await Promise.all(Array.from({ length: Math.min(2, q.length) }, async () => {
    while (q.length) {
      const i = q.shift();
      setStatus('Checking the pictures…', `${done} of ${todo.length} checked · ${redo} repainted`, done / todo.length);
      const v = await checkShot(P.images['scene-' + i], P.scenes[i], signal);
      if (v?.unsafe) { delete P.images['scene-' + i]; delete P.credits['scene-' + i]; renderSceneImage(i); }
      if (v && !v.ok) { redo++; await paintScene(i, signal, true); }
      else if (v) P.checks['scene-' + i] = { ok: true, problems: [], model: v.model };
      done++; renderSceneImage(i);
    }
  }));
  save();
}
async function doVisuals(signal) {
  const todo = P.scenes.map((_, i) => i).filter(i => needsPicture(i) && !P.images['scene-' + i] && !P.videos?.['scene-' + i]);
  let done = 0;
  const step = async i => {
    setStatus('Painting scenes…', `Scene ${i + 1} of ${P.scenes.length}`, done / todo.length);
    await paintScene(i, signal);
    done++;
    setStatus('Painting scenes…', `${done} of ${todo.length} done`, done / todo.length);
  };
  // six at a time: the relay spreads them over its painters
  const q = [...todo];
  await Promise.all(Array.from({ length: Math.min(6, q.length) }, async () => { while (q.length) await step(q.shift()); }));
}

// ============ AI video clips ============
const CAMERA_WORDS = {
  'push-in': 'the camera slowly pushes in', 'pull-out': 'the camera slowly pulls back', 'pan-left': 'the camera pans left',
  'pan-right': 'the camera pans right', 'tilt-up': 'the camera tilts up', 'tilt-down': 'the camera tilts down', drift: 'the camera drifts gently',
  'track-left': 'the camera tracks sideways to the left alongside the people', 'track-right': 'the camera tracks sideways to the right alongside the people',
  orbit: 'the camera slowly circles around the people', handheld: 'a gently swaying handheld camera follows the action'
};
// The video model animates one picture, so the prompt describes one continuous shot:
// shot-type words and "followed by ..." second shots made it cut, zoom or warp faces.
// The Turbo model ignores the negative prompt, so "no text" is said in the prompt itself
// (a shot of someone reading a letter came out with made-up subtitles).
const cap = t => t[0].toUpperCase() + t.slice(1);
// How a move looks in a real body, for the video model (one per kind of beat in the shot).
const CHOREO = {
  walk: 'Natural walk: each foot plants firmly, weight shifts from foot to foot, arms swing opposite the legs, clothes sway with the steps, no foot sliding.',
  run: 'Running: knees lift, arms pump opposite the legs, body leans slightly forward, clothes and hair bounce, feet push off the ground.',
  turn: 'The turn starts with the head and eyes, then the shoulders and hips follow smoothly.',
  give: 'One hand holds the object out, the other person reaches and takes it; both hands stay on the object during the hand-over.',
  pull: 'The hand grips the string firmly and tugs in short pulls, the shoulder and elbow move with each tug, the string stays in the hand.',
  hug: 'They step close and wrap their arms around each other, heads tilt, a gentle squeeze, then ease back.',
  wave: 'The hand rises to shoulder height and waves side to side from the wrist and elbow.',
  point: 'The arm extends and the index finger points steadily, eyes looking where it points.',
  dance: 'Rhythmic dance: steps on the beat, hips and shoulders sway, arms move in flowing arcs, clothes swirl.',
  sit: 'Bends the knees and lowers the body onto the seat, hands steadying, then settles.',
  hold: 'Fingers wrap naturally around the object and keep hold of it throughout.',
  clap: 'The palms meet in front of the chest in quick claps, elbows bent.',
  laugh: 'Shoulders shake with laughter, the head tips back slightly, eyes crinkle.'
};
function choreography(sc) {
  const moves = [...new Set((sc.beats || []).map(b => b.move))].filter(m => CHOREO[m]).slice(0, 3);
  return moves.length ? ' ' + moves.map(m => CHOREO[m]).join(' ') : '';
}
function motionWords(sc) {
  const v = sc.motion ?? 0.5;
  return (v < 0.3 ? ' Subtle, gentle movement only.' : v > 0.7 ? ' Lively, energetic movement with big natural gestures.' : '')
    + (EXPR_WORDS[sc.expr] ? ` Facial expression: ${EXPR_WORDS[sc.expr]}.` : '');
}
function motionPrompt(sc) {
  return motionPromptBase(sc).replace(' Realistic, cinematic', choreography(sc) + motionWords(sc) + ' Hands keep hold of whatever they hold (strings, books, cups); hands and fingers stay natural. Continuous motion, realistic gravity, no morphing. Realistic, cinematic');
}
function motionPromptBase(sc) {
  if (sc.beats?.length) sc = { ...sc, action: beatsSentence(sc.beats) };
  if (sc.action) {
    // the action already says who talks; make sure a speaking scene shows lips moving
    const talk = (sc.dialogue || []).length && !/\b(lips?|speak|speaks|talk|talks|says|shouts|whispers|calls)\b/i.test(sc.action)
      ? ' The character who speaks talks with clear lip movement and natural hand gestures.' : '';
    return `${sc.action}${/[.!?]$/.test(sc.action) ? '' : '.'}${talk} ${cap(CAMERA_WORDS[sc.camera] || 'smooth camera motion')}. Realistic, cinematic, stable shot; faces stay natural and the same as in the picture. No text, letters or subtitles appear on screen.`;
  }
  const visual = String(sc.visual || '')
    .replace(/,?\s*followed by[^.]*/gi, '')
    .replace(/\b(extreme\s+)?(close-up|close up|wide shot|medium shot|long shot|low-angle shot|high-angle shot|aerial shot|establishing shot|over-the-shoulder shot)\s+(looking (up|down) at\s+|of\s+)?/gi, '')
    .replace(/^\W+/, '').trim();
  const lead = visual ? visual[0].toUpperCase() + visual.slice(1) : '';
  const speaking = (sc.dialogue || []).length ? ' The characters talk with natural lip movement, facial expressions and small hand gestures.' : '';
  return `${lead} The people move naturally and smoothly with realistic body, head and hand movements; their faces stay natural, stable and the same as in the picture.${speaking} ${CAMERA_WORDS[sc.camera] || 'smooth camera motion'}. Realistic, cinematic, stable shot. No text, letters or subtitles appear on screen.`;
}

// Frames for each shot's clip, so motion lasts exactly as long as its line (written at
// 16 fps; the model makes 4k+1 frames, 33-121 = 2-7.5 s). Needs the recorded voices.
function clipFrames() {
  if (!sceneAudio) return [];
  const tl = buildTimeline(P.scenes, sceneAudio, P.options.length === 'shorts' ? 'shorts' : P.shotMode ? 'shots' : 'film');
  return tl.scenes.map(s => Math.min(121, Math.max(33, 4 * Math.ceil((s.end - s.start + tl.xf) * 16 / 4) + 1)));
}

// Puts a clip on scene i: its first frame becomes the scene picture.
// ---- clip quality gate ----
// A frame of a clip at a point of its length (0-1), as a JPEG.
async function frameAt(blob, frac) {
  const v = document.createElement('video'), url = URL.createObjectURL(blob);
  v.muted = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('unreadable clip')); });
    v.currentTime = Math.max(0, Math.min(v.duration - 0.05, v.duration * frac));
    await new Promise(res => { v.onseeked = res; });
    const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
    c.getContext('2d').drawImage(v, 0, 0);
    return c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  } finally { URL.revokeObjectURL(url); }
}
// Technical faults of an AI clip, from 10 small frames: black, frozen (nothing moves) or
// flickering (the picture jumps back and forth). Returns the fault, or '' when it is fine.
async function clipFault(blob) {
  const v = document.createElement('video'), url = URL.createObjectURL(blob);
  v.muted = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('unreadable')); });
    const c = new OffscreenCanvas(64, 36), x = c.getContext('2d', { willReadFrequently: true }), frames = [];
    for (let k = 0; k < 10; k++) {
      v.currentTime = v.duration * (0.04 + 0.92 * k / 9);
      await new Promise(res => { v.onseeked = res; });
      x.drawImage(v, 0, 0, 64, 36);
      const d = x.getImageData(0, 0, 64, 36).data, g = new Float32Array(64 * 36);
      for (let p = 0; p < g.length; p++) g[p] = 0.3 * d[p * 4] + 0.59 * d[p * 4 + 1] + 0.11 * d[p * 4 + 2];
      frames.push(g);
    }
    const mean = g => g.reduce((a, b) => a + b, 0) / g.length;
    const diff = (a, b) => { let s = 0; for (let p = 0; p < a.length; p++) s += Math.abs(a[p] - b[p]); return s / a.length; };
    if (frames.filter(f => mean(f) < 10).length >= 3) return 'mostly black';
    const steps = frames.slice(1).map((f, k) => diff(frames[k], f));
    if (Math.max(...steps) < 0.8) return 'frozen: nothing moves';
    // flicker: big jumps whose neighbours look alike (A, B, A)
    let flick = 0;
    for (let k = 2; k < frames.length; k++) if (steps[k - 1] > 35 && diff(frames[k - 2], frames[k]) < steps[k - 1] * 0.35) flick++;
    if (flick >= 2) return 'flickering';
    return '';
  } catch { return 'unreadable'; } finally { URL.revokeObjectURL(url); }
}
// After a GPU clip lands: its middle frame is checked against the cast (in the background;
// a wrong face is flagged, the clip is kept for the person to decide).
function checkClipMotion(i, file) {
  clipMotionIssue(file).then(issue => {
    if (!issue || P.videos?.['scene-' + i] !== file) return;
    (P.clipIssues ||= {})['scene-' + i] = 'check the motion: ' + issue;
    picked.add(i); updateFixBar(); renderSceneImage(i); save();
  }).catch(e => console.warn('motion check', e));
}
function checkClipCast(i, file) {
  if (!checksOn() || !castOf(P.scenes[i]).length) return;
  frameAt(file, 0.5).then(f => checkShot(f, P.scenes[i])).then(v => {
    if (!v || P.videos?.['scene-' + i] !== file) return;
    P.clipIssues ||= {};
    if (v.ok) delete P.clipIssues['scene-' + i];
    else { P.clipIssues['scene-' + i] = 'clip: ' + (v.problems[0] || 'cast check failed'); picked.add(i); updateFixBar(); }
    renderSceneImage(i); save();
  }).catch(e => console.warn('clip check', e));
}

async function attachClip(i, file, model, signal, from = null) {
  const { poster, duration } = await readImportedClip(file, signal);
  // fail closed: every clip (GPU, real footage, the person's own, made with the Director's
  // generators) passes the checker on this device first; Unsafe or SafetyDown stops it here
  await checkVideo(file);
  if (signal?.aborted) throw new Cancelled();
  clearBlocked('scene-' + i);
  // a clip brought in with its own speech (e.g. made in Google Flow): play that sound
  if (!from) { P.scenes[i].clipSound = !!(await clipSound(file)); sceneAudio = null; mixBuf = null; timeline = null; }
  else delete P.scenes[i].clipSound;
  if (signal?.aborted) throw new Cancelled();
  (P.videos ||= {})['scene-' + i] = file;
  if (from && P.images['scene-' + i] && !P.credits['review-' + i]) {
    P.images['prev-' + i] = P.images['scene-' + i]; P.credits['prevc-' + i] = P.credits['scene-' + i] || null;
  }
  if (from) P.credits['review-' + i] = true;
  P.images['scene-' + i] = poster;
  // a GPU clip's first frame is AI-made, not the person's own image
  P.credits['scene-' + i] = from ? { kind: 'clip' } : { kind: 'user' };
  // where a GPU clip came from (its job and shot number), so lip-sync can redo it later
  P.credits['video-' + i] = { kind: 'video', model, duration, ...(from ? { job: from.job, n: from.n, mode: 'turbo', enhance: P.options?.enhance !== false, at: Date.now() } : {}) };
  delete P.scenes[i].lipStale;
  delete P.credits['want-' + i];
  if (P.clipIssues) delete P.clipIssues['scene-' + i];
  if (from) { checkClipCast(i, file); checkClipMotion(i, file); }
  // black bars left out, the people kept in frame (the shot's sc.fill says how it fills the frame)
  await frameClip(i, file).catch(e => console.warn(`Shot ${i + 1}: frame check`, e.message));
  video = null; staleDownload();
  renderSceneImage(i);
}

// ============ voice & music ============
// Open-source voices only: Indian languages are recorded by the relay's Indian voice
// service; English by Kokoro-82M on this device.
function voiceEngine() {
  return engineFor(P.language);
}
function fillNarrators() {
  const list = [...narratorsFor(P.language)];
  const picked = P.narrator && findVoice(P.language, P.narrator);
  if (picked && !picked.studio && !list.some(v => v[0] === P.narrator)) list.push([P.narrator, `${picked.name} · ${picked.desc}`]);
  const sel = $('#optNarrator');
  sel.innerHTML = list.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  if (!P.narrator || !list.some(v => v[0] === P.narrator)) P.narrator = list[0][0];
  sel.value = P.narrator;
}
function readSoundOptions() {
  P.narrator = $('#optNarrator').value || P.narrator;
  P.speed = +$('#optSpeed').value;
  P.moodOverride = $('#optMood').value;
  P.musicVol = $('#optMusicVol').value / 100;
  P.sfx = $('#optSfx').checked;
  P.dialogueMode = $('#optDialogue').value;
  P.look = { bars: $('#optBars').checked, grain: $('#optGrain').checked, captions: $('#optCaptions').value, watermark: $('#optWatermark').checked, depth: $('#optDepth').checked, faces: $('#optFaces').checked };
}
const filmMood = () => (P.moodOverride && P.moodOverride !== 'auto') ? P.moodOverride : P.mood;

async function ensureVoiceEngine(signal, st = setStatus) {
  const abort = new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Cancelled())));
  abort.catch(() => {}); // only one of the race's sides is awaited
  // Kokoro, an on-device Indian voice or an MMS voice; nothing for the cloud Indian voices
  const need = voiceDownload(P.language);
  if (!need) return;
  const label = (P.language || 'English') === 'English' ? 'the narrator voice' : `the ${P.language} voice`;
  st(`Loading ${label}…`, `First time only: downloading the voice model (~${need.mb} MB)`, 0.02);
  return Promise.race([
    loadVoice(P.language, p => st(`Loading ${label}…`, `Downloading voice model: ${Math.round(p * 100)}%`, p)),
    abort
  ]);
}

// Recorded lines by engine, voice, speed and text: after an edit only the changed lines
// are recorded again.
const voiceCache = new Map();
// A film made from the person's own recording plays that recording, shot by shot.
let ownAudio = null;
async function ownNarration() {
  const blob = P.files?.narration;
  if (!blob) return null;
  if (ownAudio?.blob !== blob) {
    const ac = new OfflineAudioContext(1, 1, 24000);
    ownAudio = { blob, buffer: await ac.decodeAudioData(await blob.arrayBuffer()) };
  }
  return ownAudio.buffer;
}

// The sound inside a shot's clip, decoded once per clip (null when the clip is silent).
const clipSoundCache = new WeakMap();
function clipSound(blob) {
  if (!clipSoundCache.has(blob)) clipSoundCache.set(blob, (async () => {
    try {
      const ac = new OfflineAudioContext(2, 44100, 44100);
      const buf = await ac.decodeAudioData(await blob.arrayBuffer());
      // silent clips decode too: keep only sound that is really there
      const d = buf.getChannelData(0);
      let peak = 0; for (let k = 0; k < d.length; k += 64) peak = Math.max(peak, Math.abs(d[k]));
      return peak > 0.01 ? buf : null;
    } catch { return null; }
  })());
  return clipSoundCache.get(blob);
}
// What a clip-sound shot shows as subtitles: its lines (and narration), in order.
function shotLines(sc) {
  const name = id => P.characters.find(c => c.id === id)?.name || null;
  const d = (sc.dialogue || []).filter(x => x.line);
  return { text: [sc.narration, ...d.map(x => x.line)].filter(Boolean).join(' '), speaker: d.length === 1 && !sc.narration ? name(d[0].character) : null };
}
async function clipSoundAudio(i) {
  const sc = P.scenes[i], clip = P.videos?.['scene-' + i];
  if (!sc?.clipSound || !clip) return null;
  let buffer = await clipSound(clip);
  if (!buffer) return null;
  // a trimmed clip's sound stops at its out-point (the timeline skips to its in-point)
  if (sc.trim?.[1] > 0 && sc.trim[1] < buffer.duration) buffer = sliceAudio(buffer, 0, sc.trim[1]);
  // the Director's volume for a clip's own sound
  if (sc.clipVol != null && sc.clipVol !== 1) {
    const v = Math.max(0, +sc.clipVol), out = new AudioBuffer({ length: buffer.length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
    for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).map(x => x * v), c);
    buffer = out;
  }
  return [{ buffer, clip: true, clipDur: +P.credits['video-' + i]?.duration || buffer.duration, speech: sc.speech || null, ...shotLines(sc) }];
}
async function doVoices(signal, quiet = false) {
  const st = (t, d = '', p = null) => { voiceNote = d || t; if (!quiet) setStatus(t, d, p); };
  // shots that play their own clip's sound need no recorded voice
  const own = await Promise.all(P.scenes.map((_, i) => clipSoundAudio(i)));
  const mine = await ownNarration();
  if (mine) {
    sceneAudio = P.scenes.map((sc, i) => own[i] || (sc.span ? [{ buffer: sliceAudio(mine, sc.span[0], sc.span[1]), text: sc.narration, speaker: null }] : []));
    return;
  }
  await relayStatus;
  fillNarrators();
  readSoundOptions();
  const engine = voiceEngine();
  P.voiceEngine = engine;
  await ensureVoiceEngine(signal, st);
  castVoices(P.characters, engine, P.narrator, P.language);
  // Every line of every scene is queued at once; the voice engine records them in
  // parallel on the available CPU cores, and each scene keeps its own order.
  const lines = P.scenes.map((sc, i) => {
    if (own[i]) return [];
    // each line has its id (s<shot>-n, s<shot>-d<k>), the one studio voices use
    const out = [{ id: `s${i}-n`, text: sc.narration, voice: P.narrator, speaker: null, style: lineStyle(P.narratorPerf, sc.narrDelivery) }];
    if (P.dialogueMode !== 'off') (sc.dialogue || []).forEach((d, k) => {
      const c = P.characters.find(x => x.id === d.character);
      if (!c) return;
      out.push(P.dialogueMode === 'voiced' ? { id: `s${i}-d${k}`, text: d.line, voice: c.voice, speaker: c.name, style: lineStyle(c.perf?.text, d.delivery) }
        : { text: `${c.name} says: ${d.line}`, voice: P.narrator, speaker: null, style: lineStyle(P.narratorPerf, d.delivery) });
    });
    return out.filter(l => l.text);
  });
  const total = lines.flat().length;
  // which voice and delivery each line was recorded with (shown in the console for checking)
  window.__vfLineVoices = lines.flat().map(l => ({ id: l.id, voice: l.voice, speaker: l.speaker, ...(l.style || {}) }));
  let done = 0;
  st('Recording narration…', `0 of ${total} lines`, 0);
  const audio = await Promise.all(lines.map(sceneLines => Promise.all(sceneLines.map(async l => {
    // the line's studio voice (made on the free GPU) when it is still for the same words
    const studio = l.id && P.studio?.texts?.[l.id] === l.text && P.files?.['studio-' + l.id];
    const sty = l.style || { speed: 1, pitch: 0, gain: 1 };
    const plain = sty.speed === 1 && !sty.pitch && sty.gain === 1;
    const key = studio ? `studio|${l.id}|${studio.size}` : `${engine}|${l.voice}|${P.speed}|${plain ? '' : `${sty.speed}|${sty.pitch}|${sty.gain}|`}${l.text}`;
    let buffer = voiceCache.get(key);
    if (!buffer && studio) {
      buffer = await new OfflineAudioContext(1, 1, 24000).decodeAudioData(await studio.arrayBuffer());
      voiceCache.set(key, buffer);
    }
    if (!buffer) {
      buffer = await speak(l.text, { engine, voice: l.voice, speed: P.speed * sty.speed, pitch: sty.pitch, gain: sty.gain, signal });
      if (buffer) voiceCache.set(key, buffer);
    }
    done++;
    st('Recording narration…', `${done} of ${total} lines`, done / total);
    return buffer && { buffer, text: l.text, speaker: l.speaker };
  })).then(segs => segs.filter(Boolean))));
  sceneAudio = audio.map((a, i) => own[i] || a);
}

async function doMix(signal) {
  readSoundOptions();
  if (!sceneAudio) await doVoices(signal);
  setStatus('Composing the soundtrack…', `Original ${filmMood()} score, mixed with narration`, 0.9);
  await new Promise(r => setTimeout(r, 30));
  timeline = buildTimeline(P.scenes, sceneAudio, P.options.length === 'shorts' ? 'shorts' : P.shotMode ? 'shots' : 'film');
  mixBuf = await mixFilm(timeline, { mood: filmMood(), seed: P.seed, musicVol: P.musicVol, sfx: P.sfx });
  await mixClipBeds(timeline, mixBuf);
  P.mood = P.mood || 'epic';
  video = null; staleDownload();
  save();
}
// External clips whose own sound the Director mixed in (sc.clipMix, 0-1): laid under the
// film's sound from the clip's in-point, faded at the edges and ducked under speech.
const bedCache = new WeakMap();
async function mixClipBeds(tl, out) {
  const R = out.sampleRate, L = out.getChannelData(0), Rr = out.numberOfChannels > 1 ? out.getChannelData(1) : null;
  let added = false;
  for (const [i, sc] of P.scenes.entries()) {
    const clip = P.videos?.['scene-' + i], s = tl.scenes[i];
    if (!(sc.clipMix > 0) || !clip || !s || sc.clipSound) continue;
    if (!bedCache.has(clip)) bedCache.set(clip, clip.arrayBuffer().then(b => new OfflineAudioContext(2, 1, R).decodeAudioData(b)).catch(() => null));
    const buf = await bedCache.get(clip);
    if (!buf) continue;
    const from = Math.max(0, +sc.trim?.[0] || 0), to = Math.min(buf.duration, sc.trim?.[1] > from ? sc.trim[1] : buf.duration);
    const a = Math.floor(s.start * R);
    let n = Math.min(Math.floor((s.end - s.start) * R), Math.floor((to - from) * R), L.length - a);
    if (n <= 0) continue;
    const c0 = buf.getChannelData(0), c1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : c0, off = Math.floor(from * R);
    n = Math.min(n, c0.length - off);
    if (n <= 0) continue;
    // speech in the film: the clip's sound dips to a third under it (sc.duck false keeps it level)
    const speech = sc.duck === false ? [] : tl.segments.filter(g => g.end > s.start && g.start < s.end).map(g => [(g.start - 0.25) * R - a, (g.end + 0.3) * R - a]);
    const fade = Math.floor(0.25 * R);
    for (let k = 0; k < n; k++) {
      let g = sc.clipMix * Math.min(1, k / fade, (n - k) / fade);
      for (const [x, y] of speech) if (k > x - fade && k < y + fade) { g *= k < x ? 1 - 0.68 * (k - x + fade) / fade : k > y ? 1 - 0.68 * (y + fade - k) / fade : 0.32; break; }
      L[a + k] += c0[off + k] * g;
      if (Rr) Rr[a + k] += c1[off + k] * g;
    }
    added = true;
  }
  if (!added) return;
  let peak = 0;
  for (const d of [L, Rr].filter(Boolean)) for (let k = 0; k < d.length; k += 3) peak = Math.max(peak, Math.abs(d[k]));
  if (peak > 0.98) for (const d of [L, Rr].filter(Boolean)) for (let k = 0; k < d.length; k++) d[k] *= 0.97 / peak;
}

// ============ automatic pipeline ============
// Starts the free GPUs for a job (they boot while the story is written). Returns the job
// name, or null when motion is off, the GPUs are busy with another film, or today's
// allowance is used up (the relay says which, and that is shown).
let gpuBusy = false;
async function startGpu(prefix, parts = 2, { quietBusy = false } = {}) {
  if (!(relayHasMotion() || await refreshRelayMotion())) return null;
  const job = `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, '')}`;
  try {
    await relay('start', { job, mode: 'turbo', first: true, parts, token: await Auth.idToken().catch(() => null) });
    gpuBusy = false;
    return job;
  } catch (e) {
    gpuBusy = /busy/i.test(e.message);
    if (/allowance|quota|limit|used up|hours/i.test(e.message) && !gpuBusy) spend('gpu', e.message.replace(/\s+/g, ' ').slice(0, 90), Date.now() + 6 * 3600000);
    if (!(gpuBusy && quietBusy)) toast(e.message, true, 10000);
    return null;
  }
}
// The free GPUs make one film at a time. When they are busy, wait for them, showing so,
// rather than quietly finishing with basic motion; Finish now is the person's choice.
async function waitForGpu(prefix, parts, signal) {
  skipGpu = false; $('#btnSkipGpu').hidden = false;
  const t0 = Date.now();
  try {
    for (;;) {
      const job = await startGpu(prefix, parts, { quietBusy: true });
      if (job || !gpuBusy) return job;
      for (let k = 0; k < 45 && !skipGpu && !signal.aborted; k++) {
        setStatus('Waiting for the free GPU…', `Another film is using it · waiting ${Math.round((Date.now() - t0) / 60000)} min · Finish now uses basic motion instead`, null);
        await new Promise(r => setTimeout(r, 1000));
      }
      if (signal.aborted) throw new Cancelled();
      if (skipGpu) return null;
    }
  } finally { $('#btnSkipGpu').hidden = true; }
}
// Free-GPU status next to the motion choice
async function showGpuState() {
  const el = $('#gpuState');
  if (!el || !relayHasMotion()) return;
  try {
    const s = await relay('gpu');
    el.textContent = s.free ? '🟢 Free GPU ready now' : '🟡 Free GPU busy with another film: a Realistic film will wait for it';
  } catch { el.textContent = ''; }
}
const unclipped = () => P.scenes.map((_, i) => i).filter(i => P.images['scene-' + i] && !P.videos?.['scene-' + i]);

// "Your cast" (characters.js): with "Always ask me before building" on, an automatic film stops
// after the story and casting, before anything is painted, voiced or rendered; no job runs
// while the person looks. Returns false when they stopped there.
async function confirmCast(reason) {
  if (!alwaysAsk() || !P?.characters) return true;
  castPaused = true;
  await loadDirectory().catch(() => {});
  let choice;
  try { choice = await castCheck(P, { reason }); } finally { castPaused = false; }
  renderCast(); updateStepper();
  if (choice === 'cancel') { toast('Stopped before building: the story and cast are saved, nothing was painted. Press 🎬 Create again, or carry on step by step.', false, 9000); return false; }
  return true;
}
// a language chosen in "Your cast": the script is translated before it is voiced
async function translateIfAsked(signal) {
  const lang = P.translateTo;
  if (!lang) return;
  delete P.translateTo;
  setStatus('Translating the script…', `${P.language || 'English'} → ${lang}`);
  await translateFilm(P, lang, { signal, onStatus: d => setStatus('Translating the script…', d) });
  P.options = { ...P.options, language: lang }; P.language = lang;
  P.characters.forEach(c => { if (!findVoice(lang, c.voice)) delete c.voice; });
  if (!findVoice(lang, P.narrator)) delete P.narrator;
  $('#optLang').value = lang;
  sceneAudio = null; mixBuf = null; renderAll(); save();
}
// "Characters for this film": before an automatic film is written, the person picks saved
// characters to star in it, or lets the AI design the cast (or designs a new one first).
// Resolves true to go on, false when they stopped. Not asked when characters are already
// picked on the idea page, or when "Always ask me before building" is off.
function askCharacters() {
  return new Promise(async resolve => {
    await loadLib().catch(() => {});
    const list = LIB?.characters || [];
    const pick = new Set([...libPicked].filter(lid => list.some(c => c.lid === lid)));
    const urls = new Map(list.map(c => [c.lid, c.portrait ? URL.createObjectURL(c.portrait) : '']));
    const dlg = $('#pickCastDlg');
    const render = () => {
      $('#pcGrid').innerHTML = list.map(c => `<button type="button" class="pc-tile" data-lid="${esc(c.lid)}" aria-pressed="${pick.has(c.lid)}">
        ${urls.get(c.lid) ? `<img src="${urls.get(c.lid)}" alt="">` : '<span class="pc-blank" aria-hidden="true">🙂</span>'}<span class="pc-tick" aria-hidden="true">✓</span>
        <b>${esc(c.name)}</b><small>${esc([c.gender, c.ageYears ? c.ageYears + ' yrs' : c.age, c.outfit && outfitLabel(c.outfit)].filter(Boolean).join(' · '))}</small></button>`).join('');
      $('#pcEmpty').hidden = !!list.length;
      $('#pcUseSelected').hidden = !list.length;
      $('#pcUseSelected').disabled = !pick.size;
      $('#pcUseSelected').textContent = `⭐ Use selected (${pick.size})`;
      // with nothing saved, AI design is the main choice
      $('#pcAuto').classList.toggle('btn-primary', !list.length);
      $('#pcAuto').classList.toggle('btn-ghost', !!list.length);
    };
    let settled = false;
    const finish = go => {
      if (settled) return; settled = true;
      if (dlg.open) dlg.close();
      setTimeout(() => urls.forEach(u => u && URL.revokeObjectURL(u)), 1000);
      resolve(go);
    };
    $('#pcGrid').onclick = e => { const b = e.target.closest('[data-lid]'); if (!b) return; pick.has(b.dataset.lid) ? pick.delete(b.dataset.lid) : pick.add(b.dataset.lid); render(); };
    $('#pcUseSelected').onclick = () => { libPicked.clear(); pick.forEach(l => libPicked.add(l)); renderLib(); finish(true); };
    $('#pcAuto').onclick = () => { libPicked.clear(); renderLib(); finish(true); };
    $('#pcDesign').onclick = () => {
      finish(false);
      // the new character is saved to the directory and picked for this film; Create starts it
      openDesignPopup({ back: 'studio', onSaved: rec => { libPicked.add(rec.lid); loadLib().catch(() => {}); toast(`🎬 ${rec.name} will star in this film. Press Create when you are ready.`, false, 8000); } });
    };
    $('#pcClose').onclick = () => finish(false);
    dlg.onclose = () => finish(false);
    render();
    dlg.showModal();
  });
}
$('#btnAuto').onclick = () => autoFilm();
async function autoFilm() {
  if (job) { toast('Still working on the last step. Cancel it first.'); return; }
  // which characters star in the film: asked before the story is written (an idea of a few
  // words is checked first, so the question never comes before that error)
  if (source !== 'audio' && alwaysAsk() && !libPicked.size && $('#ideaInput').value.trim().length >= 8) {
    if (!await askCharacters()) return;
  }
  autoRender = true;
  const ask = alwaysAsk();
  let early = null, earlyBusy = false, bg = null;
  // with "Your cast", it opens as soon as the story is written; the shots are planned and
  // cast in the background meanwhile (planning a long film takes minutes)
  const askFirst = ask && source !== 'audio';
  // 1. the story and the cast (without the cast check, the GPU starts now, as before)
  const ok = await runJob(async signal => {
    if (source === 'audio' && !$('#audioFile').files[0]) throw new Error('Choose an audio file first.');
    if (!ask) { early = motionMode() !== 'live' ? await startGpu('film', 2, { quietBusy: true }) : null; earlyBusy = motionMode() !== 'live' && !early && gpuBusy; }
    $('#gpuMotionRow').hidden = false;
    try {
      if (source === 'audio') await doAudioStory(signal); else await doStory(signal, { plan: !askFirst });
      goStep('story');
      if (askFirst) bg = planInBackground();
      else if (P.options?.realFootage !== false) await doCasting(signal);
    } catch (e) { if (early) relay('cancel', { job: early }).catch(() => {}); early = null; throw e; }
  });
  if (!ok) { autoRender = false; return; }
  // 2. "Your cast": nothing is painted, voiced or rendered while the person checks it
  if (ask) {
    castPaused = true; // set before the step opens: opening the cast step would otherwise paint the portraits
    goStep('characters');
    const go = await confirmCast(bg ? 'The story is written. Choose each character\'s look, outfit, age and voice: the shots are being planned meanwhile.' : 'The story and cast are ready. Check them before the film is built.');
    // stopped before building: the shot plan is still finished (and can be cancelled), so
    // carrying on step by step has the same shots an automatic film would have had
    if (!go) { autoRender = false; if (bg) runJob(s => finishPlanning(bg, s)); return; }
  }
  // 3. the film
  runJob(async signal => {
  if (bg) await finishPlanning(bg, signal);
  let motionJob = early;
  const wasBusy = ask ? false : earlyBusy;
  if (ask && motionMode() !== 'live') motionJob = await startGpu('film', 2, { quietBusy: true });
  try {
  if (requiresFullFootage(P) && !motionJob && !wasBusy) throw new Error('The video GPU could not start. Your story is saved. Retry realistic motion later, or explicitly choose Basic animation.');
  await translateIfAsked(signal);
  // narration runs on this device while the pictures are painted, so they overlap
  readSoundOptions();
  let voiceErr = null;
  const voices = (async () => {
    try { await doVoices(signal, true); } catch (e) { voiceErr = e; }
  })();
  goStep('characters');
  // A long film (or a day whose free picture allowance is spent) is painted on the free
  // GPUs, which are already running, portraits included; otherwise they are told to
  // load the video model now.
  const onGpu = motionJob && await wantsGpuPaint();
  if (!onGpu) await doPortraits(signal);
  goStep('scenes');
  if (onGpu) {
    await gpuPaint(signal, motionJob);
    // portraits the GPU could not make (it stopped) are designed by the picture services
    if (P.characters.some(c => !P.images['char-' + c.id])) await doPortraits(signal);
    await checkShots(signal);
  } else if (motionJob) await relay('upload', { job: motionJob, files: [jsonFile('paint.json', { shots: [] })] }).catch(e => console.warn('paint plan', e));
  // real footage first: a scenery shot that gets a stock clip is not painted as well (the
  // free picture allowance is shared by everyone); the shots without one are painted next
  if (P.options?.realFootage !== false) await doRealFootage(signal);
  await doVisuals(signal);
  // the action timeline each live character follows (a GPU run writes it as it starts)
  if (!motionJob && P.look?.faces !== false) {
    setStatus('Planning character actions…', 'A timed action for each shot, from the script');
    await writeActions(P, { signal, onStatus: d => setStatus('Planning character actions…', d) }).catch(e => { if (e instanceof Cancelled) throw e; console.warn('actions', e); });
    save();
  }
  let motionErr = null;
  // voices first: each shot's clip is made as long as its recorded line
  await waitVoices(voices);
  if (voiceErr) throw voiceErr;
  // the GPU was busy at the start: wait for it now that the pictures and voices are ready
  if (wasBusy && wantsGpuMotion()) motionJob = await waitForGpu('film', 2, signal);
  const motion = motionJob && wantsGpuMotion() ? sendToGpu(signal, motionJob, motionMode() === 'hero' ? heroShots(unclipped()) : unclipped()).catch(e => { motionErr = e; }) : null;
  if (motionJob && !motion) relay('cancel', { job: motionJob }).catch(() => {});
  await doMix(signal);
  if (motion) await waitMotion(motion);
  if (motionErr) {
    if (motionErr instanceof Cancelled) throw motionErr;
    if (requiresFullFootage(P) && !skipGpu) throw motionErr;
    toast(skipGpu ? 'Finished without waiting: shots without AI motion have live faces. You can animate them later from the storyboard.'
      : `AI motion didn't finish (${motionErr.message}). Those shots have live faces instead; you can animate them later from the storyboard.`, !skipGpu, 12000);
  }
  assertFullFootage(P);
  motionJob = null;
  goStep('film');
  } finally {
    // stopped or failed before the pictures went up: free the waiting GPUs
    if (motionJob && P.gpuRun?.job !== motionJob) relay('cancel', { job: motionJob }).catch(() => {});
  }
  }).then(ok => { if (!ok) autoRender = false; });
}

// ============ painting on the free Kaggle GPUs ============
// The free picture services paint about a hundred pictures a day. A long film has a few
// hundred shots, so its shots go to the GPU notebooks (SDXL-Lightning with the cast's
// portraits) and each picture comes back here as soon as it is painted.
const jsonFile = (name, obj) => ({ name, b64: btoa(unescape(encodeURIComponent(JSON.stringify(obj)))) });
async function wantsGpuPaint() {
  const todo = P.scenes.filter((_, i) => needsPicture(i) && !P.images['scene-' + i]).length;
  return todo > 40 || (todo > 0 && !await relayCanPaintCast());
}
async function gpuPaint(signal, job, want = new Set(P.scenes.map((_, i) => i + 1).filter(n => needsPicture(n - 1) && !P.images['scene-' + (n - 1)]))) {
  const cast = P.characters.filter(c => !P.images['char-' + c.id]);
  const files = [];
  for (const c of P.characters) if (P.images['char-' + c.id]) files.push({ name: `char-${c.id}.jpg`, b64: await refOf(P.images['char-' + c.id]) });
  files.push(jsonFile('paint.json', {
    format: P.options.format || '16:9',
    portraits: cast.map((c, k) => ({ id: c.id, seed: P.seed + 1000 + k, ...gpuPortraitPrompt(P, c) })),
    shots: [...want].map(n => ({ n, seed: P.seed + (n - 1) * 7, ...gpuPaintPrompt(P, P.scenes[n - 1]) }))
  }));
  await relay('upload', { job, files, first: true });
  const t0 = Date.now();
  let got = 0, lastNew = Date.now();
  for (;;) {
    // the GPUs were started when the film was created (the job name holds that time)
    const min = Math.round((Date.now() - (parseInt(job.split('-')[1], 36) || t0)) / 60000);
    setStatus('Painting scenes on your free GPU…', got
      ? `${got} of ${want.size} shots painted`
      : `Starting the GPUs and the painter (about ${Math.max(1, 8 - min)} min), then ${cast.length ? `${cast.length} characters and ` : ''}${want.size} shots take a few minutes`, got / want.size);
    await new Promise(r => setTimeout(r, 15000));
    if (signal.aborted) throw new Cancelled();
    const s = await relay('status', null, `&job=${job}`).catch(() => null);
    if (!s) {
      motionNote = 'Cannot reach the GPU status service. Retrying; completed footage stays saved.';
      if (++statusFailures >= 10) { const error = new Error('GPU status is unavailable. Your run is saved. Use Collect clips in the storyboard to reconnect without starting another generation.'); error.resumable = true; throw error; }
      continue;
    }
    statusFailures = 0;
    // portraits and shots the GPU's own safety checker blocked are never uploaded: the card says so
    for (const id of s.unsafeChars || []) if (cast.some(x => x.id === id) && !P.images['char-' + id] && P.blocked?.['char-' + id] !== 'unsafe') { markBlocked('char-' + id); renderCast(); }
    for (const n of s.unsafe || []) {
      if (!want.has(n) || P.images['scene-' + (n - 1)] || P.blocked?.['scene-' + (n - 1)] === 'unsafe') continue;
      markBlocked('scene-' + (n - 1)); renderSceneImage(n - 1); got++; lastNew = Date.now();
    }
    for (const id of s.chars || []) {
      const c = cast.find(x => x.id === id);
      if (!c || P.images['char-' + id] || P.blocked?.['char-' + id] === 'unsafe') continue;
      try {
        const { url } = await relay('clip', null, `&job=${job}&c=${id}`);
        const blob = await (await fetch(url, { signal })).blob();
        try { await checkImage(blob); }
        catch (e) { if (P.blocked?.['char-' + id] !== (e.safetyDown ? 'down' : 'unsafe')) { markBlocked('char-' + id, e); renderCast(); safetyToast(`${c.name}'s portrait`, e); } continue; }
        P.images['char-' + id] = blob;
        P.credits['char-' + id] = { kind: 'ai', model: 'SDXL-Lightning (free Kaggle GPU)' };
        clearBlocked('char-' + id);
        renderCast();
      } catch (e) { if (signal.aborted) throw new Cancelled(); console.warn('GPU portrait', id, e); }
    }
    // six downloads at a time: the GPUs paint faster than one-by-one fetching keeps up with
    const ready = (s.pics || []).filter(n => want.has(n) && !P.images['scene-' + (n - 1)] && P.blocked?.['scene-' + (n - 1)] !== 'unsafe');
    await Promise.all(Array.from({ length: Math.min(6, ready.length) }, async () => {
      while (ready.length) {
        const n = ready.shift();
        try {
          const { url } = await relay('clip', null, `&job=${job}&n=${n}&kind=pic`);
          const blob = await (await fetch(url, { signal })).blob();
          // checked on this device too (fail closed): a blocked picture counts as done, the card says why
          try { await checkImage(blob); }
          catch (e) {
            if (e.unsafe) { got++; lastNew = Date.now(); }
            if (P.blocked?.['scene-' + (n - 1)] !== (e.safetyDown ? 'down' : 'unsafe')) { markBlocked('scene-' + (n - 1), e); renderSceneImage(n - 1); }
            continue;
          }
          clearBlocked('scene-' + (n - 1));
          P.images['scene-' + (n - 1)] = blob;
          // where it was painted, so a later GPU job can take it from there instead of an upload
          P.credits['scene-' + (n - 1)] = { kind: 'ai', seed: P.seed + (n - 1) * 7, model: 'SDXL-Lightning (free Kaggle GPU)', job, n };
          renderSceneImage(n - 1);
          got++; lastNew = Date.now();
          setStatus('Painting scenes on your free GPU…', `${got} of ${want.size} shots painted`, got / want.size);
        } catch (e) { if (signal.aborted) throw new Cancelled(); console.warn('GPU picture', n, e); }
      }
    }));
    save();
    if (got >= want.size) return;
    // the notebooks stopped, or nothing new for 25 minutes: the remaining shots are painted here
    const stopped = /^(error|cancel|partial|complete)/.test(s.state);
    if (stopped || Date.now() - lastNew > 25 * 60000) {
      toast(`The GPU painted ${got} of ${want.size} shots${s.failure ? ` (${s.failure.slice(0, 120)})` : ''}. Painting the rest with the free picture services.`, true, 9000);
      return;
    }
  }
}

// ============ automatic AI motion (free Kaggle GPU via the relay) ============
// Each scene picture is cropped to the clip size and sent with its motion prompt; the
// relay starts the motion notebook on the owner's Kaggle GPU (two scenes at a time)
// and every finished clip is put on its scene straight away.
let motionNote = '';
const wantsGpuMotion = () => relayHasMotion() && P.scenes.some((_, i) => P.images['scene-' + i]);
// "Finish now": stop waiting for the GPU; clips that already arrived stay
let skipGpu = false;
$('#btnSkipGpu').onclick = () => { if (P) { P.options.motion = 'live'; $('#optMotion').value = 'live'; save(); syncWorkspaceState(); } skipGpu = true; $('#btnSkipGpu').hidden = true; motionNote = 'Finishing without waiting for the GPU…'; };
async function relay(action, body, params = '') {
  const r = await relayFetch(`${API}/motion?action=${action}${params}`, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'motion service ' + r.status);
  return j;
}
const toBase64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
// Audio resampled to mono at a given rate.
async function monoAt(buffer, rate) {
  const oc = new OfflineAudioContext(1, Math.ceil(buffer.duration * rate), rate);
  const src = oc.createBufferSource();
  src.buffer = buffer; src.connect(oc.destination); src.start();
  return (await oc.startRendering()).getChannelData(0);
}
// A recorded line as a 16 kHz mono WAV, the format the lip-sync model listens to.
async function wav16k(buffer) { return wavBlob(await monoAt(buffer, 16000), 16000); }
function wavBlob(pcm, rate) {
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const text = (o, s) => [...s].forEach((ch, k) => out.setUint8(o + k, ch.charCodeAt(0)));
  text(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); text(8, 'WAVEfmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  text(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let k = 0; k < pcm.length; k++) out.setInt16(44 + k * 2, Math.max(-1, Math.min(1, pcm[k])) * 0x7fff, true);
  return new Blob([out], { type: 'audio/wav' });
}

const pad = n => String(n).padStart(2, '0');
// A picture cover-cropped to the clip size (the crop sits a little above centre, on faces).
async function cropForClip(blob, w, h) {
  const bmp = await createImageBitmap(blob);
  const k = Math.max(w / bmp.width, h / bmp.height), c = new OffscreenCanvas(w, h);
  c.getContext('2d').drawImage(bmp, (w - bmp.width * k) / 2, (h - bmp.height * k) * 0.45, bmp.width * k, bmp.height * k);
  bmp.close();
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}

// Sends shots to a started GPU job and puts each finished clip on its shot as it lands.
// want: shot indices. lipOnly: keep each shot's clip and only sync its speaker's lips to
// the current line (after an edit or a translation). fresh: a new take (new seed).
async function sendToGpu(signal, job, want, { lipOnly = false, fresh = false } = {}) {
  // the clip size of the Turbo model
  const [w, h] = P.options.format === '9:16' ? [480, 832] : P.options.format === '1:1' ? [640, 640] : [832, 480];
  if (lipOnly) want = want.filter(i => P.videos?.['scene-' + i] && P.scenes[i].dialogue?.length && !realFace(i));
  if (!want.length) { relay('cancel', { job }).catch(() => {}); return; }
  if (!lipOnly) {
    motionNote = 'Planning character actions from the script…';
    await writeActions(P, { signal }).catch(e => { if (e instanceof Cancelled) throw e; console.warn('actions', e); });
    save();
  }
  motionNote = `Sending ${want.length} shots to your free GPU…`;
  const files = [], frames = clipFrames();
  const tl = sceneAudio && buildTimeline(P.scenes, sceneAudio, P.options.length === 'shorts' ? 'shorts' : P.shotMode ? 'shots' : 'film');
  const scenes = [];
  for (const i of want) {
    if (!lipOnly) P.credits['want-' + i] = { job, at: Date.now() };
    const n = i + 1, shot = { n, file: `scene-${pad(n)}.jpg` };
    if (lipOnly) {
      // the clip comes from the GPU job that made it, or is uploaded (an imported or extended clip)
      const from = P.credits['video-' + i];
      Object.assign(shot, { mode: 'lip', file: `scene-${pad(n)}.mp4` });
      if (from?.job === job) shot.src = `jobs/${from.job}/out/scene-${pad(from.n)}.mp4`;
      else files.push({ name: shot.file, b64: await toBase64(P.videos['scene-' + i]) });
    } else {
      const pic = P.credits['scene-' + i];
      if (pic?.job === job) shot.painted = `jobs/${pic.job}/pics/scene-${pad(pic.n)}.jpg`; // already in this job's storage
      else files.push({ name: shot.file, b64: await toBase64(await cropForClip(P.images['scene-' + i], w, h)) });
      Object.assign(shot, { prompt: motionPrompt(P.scenes[i]), frames: frames[i], ...(fresh ? { seed: Math.floor(Math.random() * 1e9) } : {}) });
    }
    // Speaking shots carry their recorded line, and where it starts in the clip, so the
    // GPU can sync the speaker's lips to it.
    const line = tl?.segments.find(g => g.scene === i && g.speaker);
    // a real person's face (their own photo, real footage) is animated gently but never lip-synced
    if (line?.buffer && !realFace(i)) {
      files.push({ name: `scene-${pad(n)}.wav`, b64: await toBase64(await wav16k(line.buffer)) });
      Object.assign(shot, { lip: true, audio: `scene-${pad(n)}.wav`, lead: +(line.start - (tl.scenes[i].start - tl.xf / 2)).toFixed(3) });
    }
    scenes.push(shot);
  }
  const pack = { title: P.title, format: P.options.format || '16:9', options: { enhance: !lipOnly && P.options.enhance !== false }, scenes };
  files.push(jsonFile('motion.json', pack));
  // in batches of up to ~3 MB (the relay takes 4.5 MB a request), motion.json last, so
  // the notebook finds every picture, clip and voice line once it sees the plan
  const batches = [[]];
  let size = 0;
  for (const f of files) {
    if (batches.at(-1).length && (size + f.b64.length > 3e6 || batches.at(-1).length >= 40 || f.name === 'motion.json')) { batches.push([]); size = 0; }
    batches.at(-1).push(f); size += f.b64.length;
  }
  for (const [k, part] of batches.entries()) {
    if (signal.aborted) throw new Cancelled();
    motionNote = `Sending ${want.length} shots to your free GPU… (${k + 1} of ${batches.length})`;
    let tries = 0;
    for (;;) {
      try { await relay('upload', { job, files: part }); break; }
      catch (e) { if (++tries >= 3) throw e; await new Promise(r => setTimeout(r, 4000 * tries)); }
    }
  }
  P.gpuRun = { job, want, lipOnly, speaking: scenes.filter(x => x.lip).length, at: Date.now() }; save();
  let retainRun = false;
  try { await collectClips(signal, job, want, P.gpuRun); }
  catch (e) { retainRun = !!e.resumable || (e instanceof Cancelled && !skipGpu); if (!(e instanceof Cancelled)) markGpuError(e.message, want); throw e; }
  finally { if (!retainRun && P.gpuRun?.job === job) { delete P.gpuRun; save(); } }
}
// A GPU run's error, kept on each shot that got no clip (shown on its card).
function markGpuError(msg, want) {
  for (const i of want) if (!P.videos?.['scene-' + i] && P.credits['want-' + i]) P.credits['want-' + i] = { ...P.credits['want-' + i], error: String(msg).slice(0, 200) };
  renderScenes(); save();
}
// Downloads each finished clip of a GPU run as it lands. Also picks a run back up after the
// tab was closed (the notebooks keep working without it): the film remembers its run.
// The site has what it needs from a GPU job: its pictures, clips and voice lines are deleted
// from the GPU storage now (the relay's daily sweep deletes anything left after 24 h).
function forgetJob(job) { relay('cleanup', { job }).catch(e => console.warn('GPU job cleanup', job, e.message)); }
async function collectClips(signal, job, want, { lipOnly = false, speaking = 0, at = Date.now() } = {}) {
  let statusFailures = 0;
  const t0 = at, have = new Set(want.filter(i => P.credits['video-' + i]?.job === job).map(i => i + 1));
  for (;;) {
    for (let k = 0; k < 30 && !skipGpu && !signal.aborted; k++) await new Promise(r => setTimeout(r, 1000));
    if (signal.aborted) throw new Cancelled();
    if (skipGpu) { relay('cancel', { job }).catch(() => {}); throw new Error('finished without waiting'); }
    const s = await relay('status', null, `&job=${job}`).catch(() => null);
    if (!s) {
      motionNote = 'Cannot reach the GPU status service. Retrying; completed footage stays saved.';
      if (++statusFailures >= 10) { const error = new Error('GPU status is unavailable. Your run is saved. Use Collect clips in the storyboard to reconnect without starting another generation.'); error.resumable = true; throw error; }
      continue;
    }
    statusFailures = 0;
    // clips the GPU's safety checker blocked are never uploaded: the shot keeps its picture
    for (const n of s.unsafe || []) {
      if (have.has(n) || !want.includes(n - 1)) continue;
      (P.clipIssues ||= {})['scene-' + (n - 1)] = 'AI clip not used: blocked by the safety filter';
      picked.add(n - 1); updateFixBar(); renderSceneImage(n - 1); have.add(n); save();
    }
    // three downloads at a time (the lip-synced shots all land together at the end)
    const ready = s.clips.filter(n => !have.has(n) && want.includes(n - 1));
    await Promise.all(Array.from({ length: Math.min(3, ready.length) }, async () => {
      while (ready.length) {
        const n = ready.shift();
        const { url } = await relay('clip', null, `&job=${job}&n=${n}`);
        const blob = await (await fetch(url, { signal })).blob();
        // a black, frozen or flickering clip is not used: the shot keeps its picture with live characters
        const fault = await clipFault(blob);
        if (/black|unreadable/.test(fault)) {
          (P.clipIssues ||= {})['scene-' + (n - 1)] = 'AI clip not used: ' + fault;
          picked.add(n - 1); updateFixBar(); renderSceneImage(n - 1);
          have.add(n); save();
          continue;
        }
        try { await attachClip(n - 1, new File([blob], `scene-${pad(n)}.mp4`, { type: 'video/mp4' }), 'Wan 2.2 (free Kaggle GPU)', signal, { job, n }); }
        catch (e) {
          if (!(e.unsafe || e.safetyDown)) throw e;
          // blocked or not checkable on this device: not used (fail closed); the shot keeps its picture
          (P.clipIssues ||= {})['scene-' + (n - 1)] = 'AI clip not used: ' + (e.safetyDown ? SAFETY_DOWN : 'blocked by the safety filter');
          picked.add(n - 1); updateFixBar(); renderSceneImage(n - 1);
          have.add(n); save();
          continue;
        }
        if (fault) { (P.clipIssues ||= {})['scene-' + (n - 1)] = 'review the AI clip: ' + fault; picked.add(n - 1); updateFixBar(); renderSceneImage(n - 1); }
        have.add(n); save();
        motionNote = `Downloading the finished clips: ${have.size} of ${want.length}`;
      }
    }));
    const min = Math.round((Date.now() - t0) / 60000);
    // measured with Turbo on two notebooks (four T4s): ~1.6 shots a minute, then the
    // lip-sync pass (~3 min to set up, ~7 s a speaking shot); speaking shots wait for it
    const made = lipOnly ? 0 : have.size + (s.raw || 0);
    const left = Math.max(1, Math.round((made ? 0 : Math.max(0, 9 - min)) + (lipOnly ? 0 : (want.length - made) / 1.6) + (speaking && have.size < want.length ? 3 + speaking * 0.12 : 0)));
    motionNote = lipOnly ? `Syncing lips on your free GPU: ${have.size} of ${want.length} shots · about ${left} min left`
      : `AI motion on your free GPU: ${made} of ${want.length} shots animated${s.raw ? ` (${s.raw} waiting for lip-sync)` : ''} · about ${left} min left`;
    motionNote += ` · elapsed ${min} min`;
    if (!made && min >= 12) motionNote = `Waiting for the GPU worker: no clips received after ${min} min. The time estimate is uncertain. You can cancel waiting and collect this run later from the storyboard.`;
    if (have.size >= want.length) { forgetJob(job); return; }
    // 'partial': a notebook stopped and no other is still working on the film
    if (/^(error|cancel|partial)/.test(s.state)) { forgetJob(job); throw new Error(s.failure || 'the GPU run stopped'); }
    if (s.state === 'complete' && have.size < want.length && s.clips.length <= have.size) { forgetJob(job); throw new Error('some shots were not finished'); }
    if (Date.now() - t0 > (1 + want.length / 8) * 3600e3) throw new Error('the GPU run took too long');
  }
}
async function waitMotion(motion) {
  const show = () => setStatus('Adding real character motion…', motionNote || 'Starting your free GPU', null);
  show(); skipGpu = false; $('#btnSkipGpu').hidden = false;
  const iv = setInterval(show, 1000);
  try { await motion; } finally { clearInterval(iv); $('#btnSkipGpu').hidden = true; }
}
$('#btnStoryOnly').onclick = () => runJob(async signal => { await doStory(signal); goStep('story'); });
$('#btnRewrite').onclick = () => {
  if (!confirm('Rewrite the whole story? Current scenes and images will be replaced.')) return;
  runJob(async signal => { await doStory(signal); goStep('story'); });
};
$('#btnPortraits').onclick = () => runJob(s => doPortraits(s));
$('#btnVisuals').onclick = () => runJob(s => doVisuals(s));
// The film step paints anything missing, then records voice and score.
$('#btnBuildSound').onclick = () => {
  if (job) { toast('Still working on the last step. Cancel it first.'); return; }
  sceneAudio = null; mixBuf = null;
  goStep('film');
};

// ============ rendering panels ============
function renderAll() {
  renderStory(); renderCast(); renderScenes(); updateStepper();
}
function renderStory() {
  $('#storyTitle').textContent = P.title || 'Untitled';
  $('#storyLogline').textContent = P.logline || '';
  $('#storyGenre').textContent = [P.genre, P.mood && P.mood + ' mood', P.scenes?.length && P.scenes.length + ' scenes'].filter(Boolean).join(' · ');
  $('#storyText').value = P.story || '';
  const fl = $('#storyFlag');
  fl.hidden = !(P.flags?.length || P.storyFlags?.length);
  if (!fl.hidden) fl.innerHTML = P.storyFlags?.length
    ? `⚠️ The story still mentions <b>${P.storyFlags.map(esc).join(', ')}</b>. Edit those names before publishing.`
    : `🛡️ Your idea mentioned <b>${P.flags.map(esc).join(', ')}</b>. The story uses original characters instead.`;
}
$('#storyTitle').oninput = e => { P.title = e.target.textContent.trim(); save(); };
$('#storyLogline').oninput = e => { P.logline = e.target.textContent.trim(); save(); };
$('#storyText').oninput = e => { P.story = e.target.value; save(); };

function markLoading(key, on) {
  const el = document.querySelector(`[data-img="${key}"]`);
  el?.classList.toggle('loading', on);
}
function renderCast() {
  P.characters.forEach(ensureFields);
  $('#castGrid').innerHTML = P.characters.map(c => {
    const img = P.images['char-' + c.id];
    return `<article class="cast-card" data-char="${c.id}">
      <div class="cast-portrait" data-img="char-${c.id}">${img ? `<img src="${blobURL('char-' + c.id, img)}" alt="${esc(c.name)} portrait">` : `<span class="initial">${esc(c.name[0] || '?')}</span>`}${!img && blockedText('char-' + c.id) ? `<span class="blocked-note">⛔ ${esc(blockedText('char-' + c.id))}</span>` : ''}${P.images['sheet-' + c.id] ? '<span class="sheet-badge" title="Has a reference sheet: shots use it too">🧍 sheet</span>' : ''}</div>
      <div class="cast-body">
        <span class="cast-role">${esc(c.role)} · ${ageOf(c)}-year-old ${esc(c.gender === 'other' ? 'person' : c.gender)}${c.lid ? ' · ⭐ in directory' : ''}</span>
        <input class="c-name" value="${esc(c.name)}" aria-label="Name">
        <textarea class="c-look" rows="4" aria-label="Appearance">${esc(c.appearance)}</textarea>
        <p class="tiny muted">${esc(c.personality)}</p>
        <div class="row c-picks">
          <button class="btn btn-ghost btn-sm c-voicepick" title="Select a voice">🎙 ${esc(voiceName(P.language, c))}</button>
          <button class="btn btn-ghost btn-sm c-outfit" title="Outfit and wardrobe">👗 ${esc(outfitLabel(c.outfit))}</button>
        </div>
        <div class="row">
          <button class="btn btn-ghost btn-sm c-edit" title="Open the character page: voice, info, reference sheet, history">✏ Edit</button>
          <button class="btn btn-ghost btn-sm c-hear" title="Hear voice">▶</button>
          <button class="btn btn-ghost btn-sm c-repaint" title="Redesign portrait">🎨</button>
          <button class="btn btn-ghost btn-sm c-save" title="Save to My characters, to cast again in later films">⭐</button>
          <label class="btn btn-ghost btn-sm" title="Use my own photo for this character">📷<input type="file" accept="image/*" class="c-photo" hidden></label>
        </div>
      </div></article>`;
  }).join('') || '<p class="muted">No characters yet.</p>';
}
$('#castGrid').addEventListener('input', e => {
  const card = e.target.closest('[data-char]'); if (!card) return;
  const c = P.characters.find(x => x.id === card.dataset.char);
  if (e.target.classList.contains('c-name')) c.name = e.target.value;
  if (e.target.classList.contains('c-look')) c.appearance = e.target.value;
  save();
});
$('#castGrid').addEventListener('change', e => {
  if (e.target.classList.contains('c-photo') && e.target.files[0]) {
    // the person's own photo as this character's reference: new pictures keep that face.
    // Used only with their confirmation (it is them, or they have the person's permission)
    // and once the checker on this device passes it; real faces are never lip-synced.
    const c = P.characters.find(x => x.id === e.target.closest('[data-char]').dataset.char);
    const file = e.target.files[0]; e.target.value = '';
    // consent, the safety check on this device and the public-figure check (characters.js)
    checkedUpload(file, c.name).then(async blob => {
      if (!blob) return;
      P.images['char-' + c.id] = blob;
      P.credits['char-' + c.id] = { kind: 'user', consent: Date.now() };
      clearBlocked('char-' + c.id);
      renderCast(); save();
      toast(`${c.name} now uses your photo. Repaint shots in the storyboard to use it there. Shots with this face move gently but are never lip-synced.`, false, 9000);
    });
    return;
  }
});
// A voice picked in the voice picker, for a film's character: on-device voice, studio voice,
// or "My voice" (only with the consent given in 🎙 My voice), and the performance words.
function setVoice(F, c, v) {
  c.voice = v.voice;
  if (v.perf) c.perf = v.perf; else delete c.perf;
  if (v.studioVoice) c.studioVoice = v.studioVoice; else delete c.studioVoice;
  if (v.useMine && F.myVoice?.blob && F.myVoice.consent) { c.useMine = true; F.myVoice.speakers = [...new Set([...(F.myVoice.speakers || []), c.id])]; }
  else {
    if (v.useMine) toast('My voice needs your consent in this film first: open 🎙 My voice in Voice & look and tick the box. The on-device voice is used meanwhile.', true, 9000);
    delete c.useMine;
    if (F.myVoice?.speakers) F.myVoice.speakers = F.myVoice.speakers.filter(x => x !== c.id);
  }
  // studio lines made with the old voice are not used for this character any more
  if (F.studio?.texts) for (const l of filmLines(F)) if (l.speaker === c.id) delete F.studio.texts[l.id];
  if (F === P) { sceneAudio = null; mixBuf = null; video = null; renderCast(); save(); }
}
// ---------------- real-photo consent ----------------
// "📷 Use my own photo" goes ahead only after the person ticks the required box.
function askPhotoConsent(c) {
  const dlg = $('#photoConsentDlg'), box = $('#pcConsent'), use = $('#pcUse');
  $('#pcName').textContent = c.name;
  box.checked = false; use.disabled = true;
  return new Promise(resolve => {
    let done = false;
    const end = ok => { if (done) return; done = true; resolve(ok); if (dlg.open) dlg.close(); };
    box.onchange = () => { use.disabled = !box.checked; };
    use.onclick = () => { if (box.checked) end(true); };
    $('#pcCancel').onclick = () => end(false);
    dlg.onclose = () => end(false);
    dlg.showModal();
  });
}

// ---------------- studio voices (free GPU) ----------------
$('#btnStudioVoices').onclick = () => runJob(async signal => {
  if (!studioEngine(P.language)) { toast(`Studio voices don't speak ${P.language} yet; the on-device voice stays.`, true, 8000); return; }
  // a voice sample is used only with the consent box ticked, and only for a signed-in person
  const mine = P.myVoice?.blob && P.myVoice.speakers?.length && P.myVoice.consent ? P.myVoice : null;
  const token = await Auth.idToken().catch(() => null);
  if (mine && !token) { toast('Sign in (Google or email) to use your own voice. The other studio voices work without it.', true, 9000); return; }
  setStatus('Studio voices…', 'Preparing the cast voices');
  const { job, lines } = await runStudioVoices(P, { mine, token, signal, onStatus: d => setStatus('Studio voices…', d) });
  const text = Object.fromEntries(filmLines(P).map(l => [l.id, l.text]));
  P.files ||= {}; P.studio = { job, texts: {} };
  for (const [id, buf] of lines) { P.files['studio-' + id] = wavBlob(buf.getChannelData(0), buf.sampleRate); P.studio.texts[id] = text[id]; }
  sceneAudio = null; mixBuf = null; save();
  if (mine) toast('Your voice sample was used for this job only and has been deleted from the GPU storage.', false, 9000);
  await doMix(signal);
});
$('#btnStudioOff').onclick = () => { delete P.studio; sceneAudio = null; mixBuf = null; save(); toast('Back to the on-device voices.'); };

// ---------------- My voice ----------------
// The sample is used only after the person ticks "This is my own voice, or I have the
// speaker's permission" (required: Use stays disabled until then).
let mvBlob = null, mvRec = null;
function showMv(msg = '') {
  $('#mvPlay').hidden = !mvBlob;
  if (mvBlob) $('#mvPlay').src = URL.createObjectURL(mvBlob);
  $('#mvState').textContent = msg;
  $('#mvUse').disabled = !mvBlob || !$('#mvConsent').checked;
}
async function takeSample(blob) {
  $('#mvState').textContent = 'Cleaning and checking the sample…';
  const r = await prepareVoiceSample(blob, { denoise, signal: new AbortController().signal });
  mvBlob = r.ok ? r.wav : null;
  showMv(r.ok ? `✓ ${r.check.speechSeconds} s of clear speech` : '⚠ ' + r.check.problem);
}
$('#btnMyVoice').onclick = async () => {
  $('#mvWho').innerHTML = '<legend class="tiny">Who speaks in this voice</legend>' + [['narrator', 'Narrator'], ...P.characters.map(c => [c.id, c.name])]
    .map(([id, n]) => `<label class="check"><input type="checkbox" value="${esc(id)}" ${P.myVoice?.speakers?.includes(id) ? 'checked' : ''}> <span>${esc(n)}</span></label>`).join('');
  $('#mvConsent').checked = !!P.myVoice?.consent;
  mvBlob = P.myVoice?.blob || await loadMyVoice();
  showMv(mvBlob && !P.myVoice ? 'Your saved voice from this device.' : '');
  $('#myVoiceDlg').showModal();
};
$('#mvConsent').onchange = () => { $('#mvUse').disabled = !mvBlob || !$('#mvConsent').checked; };
$('#mvRec').onclick = async () => {
  if (mvRec) { const b = await mvRec.stop(); mvRec = null; $('#mvRec').textContent = '● Record'; return takeSample(b); }
  try { mvRec = await recorder(); $('#mvRec').textContent = '■ Stop'; $('#mvState').textContent = 'Recording… talk naturally for 10-30 seconds.'; }
  catch { toast('The microphone is not available. You can upload a recording instead.', true); }
};
$('#mvFile').onchange = e => { if (e.target.files[0]) takeSample(e.target.files[0]); e.target.value = ''; };
$('#mvUse').onclick = async () => {
  if (!mvBlob) return toast('Record or upload a sample first.', true);
  if (!$('#mvConsent').checked) return toast("Please confirm it's your own voice, or that you have the speaker's permission.", true);
  const speakers = [...document.querySelectorAll('#mvWho input:checked')].map(x => x.value);
  if (!speakers.length) return toast('Choose who speaks in this voice.', true);
  P.myVoice = { blob: mvBlob, speakers, consent: Date.now() };
  if ($('#mvKeep').checked) await saveMyVoice(mvBlob).catch(() => {});
  save(); $('#myVoiceDlg').close();
  toast('Your voice is set. Press 🎭 Studio voices to record the film with it.', false, 8000);
};
$('#mvRemove').onclick = async () => { delete P.myVoice; mvBlob = null; await forgetMyVoice(); save(); showMv('Removed from this project and this device.'); };
$('#mvClose').onclick = () => $('#myVoiceDlg').close();

$('#castGrid').addEventListener('click', e => {
  const card = e.target.closest('[data-char]'); if (!card) return;
  const c = P.characters.find(x => x.id === card.dataset.char);
  if (e.target.closest('.c-save')) { saveToLib(c).catch(err => toast(err.message, true, 6000)); return; }
  if (e.target.closest('.c-voicepick')) {
    const line = P.scenes.flatMap(s => s.dialogue || []).find(d => d.character === c.id && d.line)?.line;
    openVoicePicker({ language: P.language, character: c, sample: line, onPick: v => { setVoice(P, c, v); toast(`${c.name}'s voice: ${v.label}.`); } });
    return;
  }
  if (e.target.closest('.c-outfit')) {
    openOutfitPicker({ character: c, film: P, onDone: r => {
      applyOutfitToFilm(P, c, r); renderCast(); save();
      toast(`${c.name}: ${outfitLabel(r.outfit)}. Repaint their shots (🎨) or the portrait to show it.`, false, 7000);
    } });
    return;
  }
  if (e.target.closest('.c-edit')) { editCharacter(c); return; }
  if (e.target.closest('.c-repaint')) runJob(async signal => {
    delete P.images['char-' + c.id];
    await doPortraits(signal, { onlyMissing: true });
  });
  if (e.target.closest('.c-hear')) runJob(async signal => {
    castVoices(P.characters, voiceEngine(), P.narrator, P.language);
    await ensureVoiceEngine(signal);
    setStatus(`Voicing ${c.name}…`);
    const line = P.scenes.flatMap(s => s.dialogue || []).find(d => d.character === c.id)?.line || `Hello, my name is ${c.name}.`;
    const st = lineStyle(c.perf?.text, '');
    playBuffer(await speak(line, { engine: voiceEngine(), voice: c.voice, speed: (P.speed || 1) * st.speed, pitch: st.pitch, gain: st.gain, signal }));
    renderCast();
  });
});

// ---------------- characters, voices, outfits and dialogue (characters.js, dialogue.js) ----------------
function editCharacter(c) {
  ensureFields(c);
  openEditor(draftFromFilm(P, c), { back: 'studio', onDone: async d => {
    const { c: ch, portraitChanged } = applyDraftToFilm(P, d);
    if (portraitChanged) triedPortraits.add(ch.id);
    sceneAudio = null; mixBuf = null; video = null;
    await save(true);
    setTimeout(() => { goStep('characters'); renderCast(); renderScenes(); }, 0);
    toast(portraitChanged ? `${ch.name} is updated. Repaint their shots in the storyboard (🎨) to show the new look.` : `${ch.name} is updated.`, false, 7000);
  } });
}
// a line edited in the dialogue editor: only it is voiced again; a moving clip of that shot needs its lips re-synced
function lineEdited(i, { voice: v = true, lips = false } = {}) {
  if (v) { sceneAudio = null; mixBuf = null; video = null; }
  if (lips && P.videos?.['scene-' + i]) { P.scenes[i].lipStale = true; picked.add(i); }
  renderScenes(); updateStepper(); staleDownload(); save();
}
async function hearLine(i, k) {
  const sc = P.scenes[i];
  const c = k >= 0 ? P.characters.find(x => x.id === sc.dialogue[k].character) : null;
  const text = k < 0 ? sc.narration : sc.dialogue[k].line;
  const st = k < 0 ? lineStyle(P.narratorPerf, sc.narrDelivery) : lineStyle(c?.perf?.text, sc.dialogue[k].delivery);
  try {
    await relayStatus; fillNarrators();
    await ensureVoiceEngine(null, setStatus);
    castVoices(P.characters, voiceEngine(), P.narrator, P.language);
    setStatus('Voicing the line…', cut(text, 60));
    const buf = await speak(text, { engine: voiceEngine(), voice: c ? c.voice : P.narrator, speed: (P.speed || 1) * st.speed, pitch: st.pitch, gain: st.gain });
    if (!job) clearStatus();
    if (buf) playBuffer(buf);
  } catch (e) { if (!job) clearStatus(); toast('Could not voice the line: ' + e.message, true, 7000); }
}
initCharacters({
  P: () => P, user: () => user, save: now => save(now), saveFilm: F => (F === P ? save(true) : Store.saveProject(F)),
  toast, runJob, setStatus, clearStatus: () => { if (!job) clearStatus(); }, askPhotoConsent, show, setVoice,
  castChanged: () => { sceneAudio = null; mixBuf = null; video = null; renderCast(); updateStepper(); save(); },
  token: () => Auth.idToken(), myVoice: () => (P?.myVoice?.blob ? P.myVoice : null),
  triedPortrait: id => triedPortraits.add(id),
  pickForStory: lid => { libPicked.add(lid); loadLib().catch(() => {}); },
  backToFilm: () => { show('studio'); goStep('characters'); }
});
initDialogue({ P: () => P, save: () => save(), toast, lineEdited, hearLine });
initOutfitPicker(toast);
document.addEventListener('click', e => { if (e.target.closest('[data-dialogue]')) openDialogue(); });
$('#btnFromDir').onclick = () => { show('chars'); renderDirectory({ pickFor: P.id }).catch(err => toast(err.message, true)); };
$('#btnNarratorPick').onclick = () => {
  const line = P.scenes.find(s => s.narration)?.narration;
  openVoicePicker({ language: P.language, character: { name: 'Narrator', gender: /^[ab]f_|_female/.test(P.narrator || '') ? 'female' : 'male', voice: P.narrator, perf: P.narratorPerf ? { text: P.narratorPerf } : null },
    sample: line, onPick: v => {
      if (v.studioVoice || v.useMine) toast('The narrator\'s studio voice comes from 🎭 Studio voices; the on-device voice is set now.', false, 7000);
      P.narrator = v.voice; if (v.perf?.text) P.narratorPerf = v.perf.text; else delete P.narratorPerf;
      fillNarrators(); sceneAudio = null; mixBuf = null; video = null; save();
    } });
};

const TEXT_STYLES = { title: 'Title card', lower: 'Lower third', top: 'Top line' };
// Magic Edit: a new look for a shot. The shot's own description is kept (baseVisual) so
// looks never pile up, and the shot is repainted from it.
const MAGIC = {
  night: { label: '🌙 Night', add: 'at night, moonlight and warm lamp light, deep blue shadows', amb: 'night' },
  golden: { label: '🌅 Golden hour', add: 'at golden hour, warm low sunlight, long soft shadows' },
  day: { label: '☀️ Daylight', add: 'in bright clear daylight, soft natural light' },
  rain: { label: '🌧 Rain', add: 'in heavy rain, wet glistening surfaces, overcast light', amb: 'rain' },
  storm: { label: '⛈ Storm', add: 'under a dark stormy sky, lightning in the distance, wind-blown', amb: 'storm' },
  fog: { label: '🌫 Fog', add: 'in thick morning fog, soft hazy light' },
  snow: { label: '❄️ Snow', add: 'in gently falling snow, snow-covered ground, cold blue light', amb: 'wind' },
  festival: { label: '🪔 Festival', add: 'decorated for an Indian festival: marigold garlands, glowing diyas, string lights', amb: 'festival' },
  backdrop: { label: '🏞 New backdrop…' },
  original: { label: '↺ Original look' }
};
const magicOptions = () => '<option value="">✨ Magic edit…</option>' + Object.entries(MAGIC).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('');
function applyMagic(i, key, backdrop) {
  const sc = P.scenes[i], m = MAGIC[key];
  sc.baseVisual ??= sc.visual || '';
  sc.baseAmbience ??= sc.ambience || 'none';
  if (key === 'original') { sc.visual = sc.baseVisual; sc.ambience = sc.baseAmbience; delete sc.magic; return; }
  sc.visual = key === 'backdrop' ? `${sc.baseVisual}, the setting changed to ${backdrop}` : `${sc.baseVisual}, ${m.add}`;
  if (key === 'backdrop') sc.stock = backdrop;
  sc.ambience = m.amb || sc.baseAmbience;
  sc.magic = key;
}
// Magic-edit shots and repaint them. Their old clips no longer match, so they are ticked
// for 🎬 Re-animate on the free GPU.
async function magicEdit(idxs, key, signal, backdrop) {
  if (!MAGIC[key]) throw new Error('Unknown magic edit: ' + key);
  if (key === 'backdrop' && !backdrop) throw new Error('Say which backdrop to use.');
  idxs.forEach(i => applyMagic(i, key, backdrop));
  mixBuf = null;
  let k = 0;
  for (const i of idxs) {
    setStatus(`Magic edit: ${MAGIC[key].label}`, `Repainting shot ${i + 1} (${++k} of ${idxs.length})`);
    await paintScene(i, signal, true);
  }
  idxs.forEach(i => picked.add(i));
  renderScenes(); refreshPreview(); save();
}
// on-screen text needs no new voices or mix: update the timeline in place
function textChanged(i) {
  if (timeline?.scenes[i]) timeline.scenes[i].text = P.scenes[i].text?.text ? P.scenes[i].text : null;
  video = null;
  clearTimeout(textChanged.t); textChanged.t = setTimeout(refreshPreview, 400);
}
function askBackdrop() {
  const b = prompt('New backdrop for the shot (for example: a busy Mumbai street, a palace courtyard, a beach at sunset):');
  return b && b.trim() ? b.trim().slice(0, 120) : null;
}
// What moves a shot really has (shown on the card, and in the film's motion report).
function motionKind(i) {
  const s = P.scenes[i], v = P.credits['video-' + i];
  if (P.videos?.['scene-' + i]) return v?.model && /wan|gpu/i.test(v.model) ? 'AI video (' + v.model + ')' : 'Your video clip';
  if (!P.images['scene-' + i]) return 'Not painted';
  if (P.look?.faces === false) return 'Still picture with 3D camera';
  return s.motionRef ? 'Picture + copied motion from your video' : 'Picture + live characters (on device)';
}
// what a card or map shot shows on its storyboard card (the renderer draws it in the film)
function drawnLabel(s) {
  if (s.map) return `🗺 Map${s.map.title ? ': ' + s.map.title : ''}${s.map.year ? ' · ' + s.map.year : ''}`;
  const c = s.card;
  return c.kind === 'disclaimer' ? `📜 Disclaimer: ${cut(c.text, 90)}` : c.kind === 'chapter' ? `📖 ${c.label || 'Chapter ' + (c.num ?? '')}: ${c.title}` : `🎬 Title: ${c.title}`;
}
function shotStatus(i) {
  const s = P.scenes[i];
  if (drawnShot(s)) return '<span class="st ok" title="Drawn by VoiceFrame in the film: no picture needed">🗂 card drawn in the film</span>';
  const walks = !P.videos?.['scene-' + i] && ((s.beats || []).some(b => /walk|run|dance/.test(b.move)));
  const missed = !P.videos?.['scene-' + i] && P.credits['want-' + i] && !job;
  if (!P.images['scene-' + i] && blockedText('scene-' + i)) return `<span class="st warn blocked">⛔ ${esc(blockedText('scene-' + i))}</span>`;
  return (P.videos?.['scene-' + i] ? '<span class="st ok" title="' + esc(motionKind(i)) + '">🎬 AI video</span>' : P.images['scene-' + i] ? '<span class="st" title="' + esc(motionKind(i)) + '">🖼️ picture + live characters</span>' : '<span class="st warn">no picture</span>')
    + (s.lipStale ? ' <span class="st warn">👄 line changed: re-sync lips</span>' : '')
    + (missed ? ` <span class="st warn" title="${esc(P.credits['want-' + i].error ? 'GPU error: ' + P.credits['want-' + i].error : 'It was sent to the free GPU but no clip came back.')} Tick it and press 🎬 Re-animate.">⚠ ${requiresFullFootage(P) ? 'AI video missing: full-motion export is blocked' : 'AI video not made: showing basic animation'}${P.credits['want-' + i].error ? ' (' + esc(P.credits['want-' + i].error.slice(0, 50)) + ')' : ''}</span>` : '')
    + (P.credits['review-' + i] && P.videos?.['scene-' + i] ? ' <span class="st warn review">👀 New AI clip (hover to preview): <button class="btn btn-ghost btn-sm s-keep">✓ Keep</button><button class="btn btn-ghost btn-sm s-reject">✕ Reject</button></span>' : '')
    + (walks && !missed ? ' <span class="st" title="Walking, running and dancing need real AI video: tick it and press 🎬 Re-animate (free GPU)">🚶 needs AI video for real walking</span>' : '')
    + (P.clipIssues?.['scene-' + i] ? ` <span class="st warn" title="Tick it and press 🎬 Re-animate to make a new clip">⚠ ${esc(P.clipIssues['scene-' + i])}</span>` : '')
    + (P.checks?.['scene-' + i] ? (P.checks['scene-' + i].ok ? ' <span class="st ok" title="An AI compared it with the script and the cast portraits">✓ cast checked</span>'
      : ` <span class="st warn" title="${esc(P.checks['scene-' + i].problems.join(' · '))}">⚠ ${esc(P.checks['scene-' + i].problems[0] || 'check failed')}</span>`) : '');
}
function renderScenes() {
  // films made before v54 marked a GPU clip's first frame as the person's own image
  P.scenes.forEach((_, i) => { if (P.credits['video-' + i]?.job && P.credits['scene-' + i]?.kind === 'user') P.credits['scene-' + i] = { kind: 'clip' }; });
  const fmt = P.options?.format;
  const cls = fmt === '9:16' ? 'portrait' : fmt === '1:1' ? 'square' : '';
  const clips = P.scenes.filter((_, i) => P.videos?.['scene-' + i]).length;
  $('#scenesSummary').textContent = `${P.scenes.length} shots · ${clips} with AI video motion, ${P.scenes.length - clips} pictures with live characters · ${fmt || '16:9'}. For real walking, turning and hand-overs, tick shots and press 🎬 Re-animate (free GPU).`;
  $('#btnCollect').hidden = !P.gpuRun || !!job;
  const flagged = P.scenes.map((_, k) => k).filter(k => P.checks?.['scene-' + k] && !P.checks['scene-' + k].ok);
  $('#btnFixFlagged').hidden = !flagged.length;
  $('#btnFixFlagged').textContent = `🔁 Repaint ${flagged.length} flagged shot${flagged.length === 1 ? '' : 's'}`;
  const opts = (list, cur) => list.map(c => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('');
  $('#sceneList').innerHTML = P.scenes.map((s, i) => {
    const d = s.dialogue?.[0], clip = P.videos?.['scene-' + i];
    return `<article class="scene-card${picked.has(i) ? ' picked' : ''}" data-scene="${i}">
      <div class="scene-img ${cls}${drawnShot(s) ? ' drawn' : ''}" data-img="scene-${i}"><span class="badge">${i + 1}</span><span class="ph">${drawnShot(s) ? esc(drawnLabel(s)) : 'Not painted yet'}</span>
        <label class="pick" title="Select to fix on the free GPU"><input type="checkbox" class="s-pick" ${picked.has(i) ? 'checked' : ''}></label></div>
      <div class="scene-body">
        <div class="shot-head"><h3>${esc(s.title || 'Shot ' + (i + 1))}</h3><span class="s-status">${shotStatus(i)}</span></div>
        ${d ? `<div class="line-row"><select class="s-speaker" title="Who speaks">${P.characters.map(c => `<option value="${c.id}" ${c.id === d.character ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
          <input class="s-line" value="${esc(d.line)}" aria-label="Line"></div>` : ''}
        ${s.narration || !d ? `<textarea class="s-narr" rows="2" placeholder="Narration (optional)">${esc(s.narration)}</textarea>` : ''}
        <details class="direction"${s.visual ? '' : ' open'}><summary>🎬 Action Director: picture, action timeline, motion</summary>
          <textarea class="s-visual" rows="2" placeholder="What the camera sees">${esc(s.visual)}</textarea>
          <textarea class="s-action" rows="2" placeholder="What the characters do during the shot">${esc(s.action || '')}</textarea>
          <textarea class="s-beats" rows="3" placeholder="Action timeline, one step a line, e.g.&#10;0-40%: the girl looks up and raises her right arm (raise)&#10;40-100%: she tugs the kite string in her right hand (pull)">${esc(beatsText(s.beats))}</textarea>
          <p class="tiny muted">Moves: still, talk, look, nod, turn, laugh, raise, point, wave, pull, hold, give, hug, clap, walk, run, dance, sit</p></details>
        <div class="scene-meta">
          <select class="s-cam" title="Camera move">${opts(CAMS, s.camera)}</select>
          <select class="s-amb" title="Ambient sound">${opts(AMBS, s.ambience)}</select>
          <select class="s-hold" title="Hold the shot longer">${[0, 1, 2, 3, 5].map(h => `<option value="${h}" ${(+s.hold || 0) === h ? 'selected' : ''}>${h ? `hold +${h}s` : 'no hold'}</option>`).join('')}</select>
          <label class="s-motion-wrap" title="How much the characters move in this shot">🏃<input type="range" class="s-motion" min="0" max="100" step="5" value="${Math.round((s.motion ?? 0.5) * 100)}" aria-label="Motion amount"></label>
          ${d ? '<button class="btn btn-ghost btn-sm s-lipface" title="Choose which face speaks this line">👄 Speaker</button>' : ''}
          ${clip ? `<label class="s-motion-wrap" title="Play the clip's own sound (its speech) instead of a recorded voice"><input type="checkbox" class="s-clipsound" ${s.clipSound ? 'checked' : ''}> 🔊 clip's sound</label>` : ''}
          ${clip ? `<select class="s-fill" title="How the clip fills the frame (black bars are always left out)">${[['fill', '⛶ Fill frame (crop)'], ['fit', '▭ Whole picture'], ['blur-fill', '▒ Whole + blurred sides']].map(([v, l]) => `<option value="${v}" ${(s.fill || 'fill') === v ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn btn-ghost btn-sm s-best" title="Play the best part of the clip (frames checked by AI vision)">✨ Best part</button>` : ''}
          <select class="s-expr" title="Facial expression (Auto reads it from the script)">${EXPR_OPTS.map(([v, l]) => `<option value="${v}" ${(s.expr || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <select class="s-magic" title="Give the shot a new look and repaint it">${magicOptions()}</select>${s.magic ? ` <span class="st">✨ ${esc(MAGIC[s.magic]?.label || '')}</span>` : ''}
        </div>
        <div class="text-row"><input class="s-text" value="${esc(s.text?.text || '')}" placeholder="On-screen text (optional): a title, a place, a date…" aria-label="On-screen text" maxlength="90">
          <select class="s-tstyle" title="How the text shows">${Object.entries(TEXT_STYLES).map(([k, v]) => `<option value="${k}" ${(s.text?.style || 'title') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="shot-tools">
          <button class="btn btn-ghost s-up" title="Move up">↑</button><button class="btn btn-ghost s-down" title="Move down">↓</button>
          <button class="btn btn-ghost s-dup" title="Duplicate">⧉</button><button class="btn btn-ghost s-add" title="Insert a new shot after this one">＋ Shot</button>
          <button class="btn btn-ghost s-extend" title="Continue this moving shot from its last frame"${clip ? '' : ' disabled'}>⤳ Extend</button>
          <button class="btn btn-ghost s-del" title="Delete">🗑</button>
          <button class="btn btn-ghost s-repaint" title="New picture from the free picture services">🎨 Repaint</button>
          <label class="btn btn-ghost" title="Use my own picture">⬆ Image<input type="file" accept="image/*" class="s-upload" hidden></label>
          <label class="btn btn-ghost" title="Use my own video clip">⬆ Video<input type="file" accept="video/*,.mp4,.webm,.mov" class="s-upload-video" hidden></label>
          ${clip ? '<button class="btn btn-ghost s-save-motion" type="button">▣ Save motion</button>' : ''}
          <button class="btn btn-ghost s-reuse-motion" type="button" title="Reuse a saved clip without generation GPU time">▤ Motion library</button>
          <button class="btn btn-ghost s-stock" type="button" title="Use real free stock footage (Pexels / Wikimedia Commons) for this shot. Best for scenery and crowds: a stock clip can't show your own characters">🎥 Real footage</button>
          <label class="btn btn-ghost" title="Copy how a person moves in a video of yours (read on this device; the video is not uploaded)">🕺 Copy motion<input type="file" accept="video/*,.mp4,.webm,.mov" class="s-motionref" hidden></label>
          ${s.motionRef ? '<button class="btn btn-ghost s-motionref-clear" title="Stop copying the motion">✕ copied motion</button>' : ''}
          <button class="btn btn-ghost s-play">▶ Play</button>
          <button class="btn btn-ghost s-clip">⬇ MP4</button>
        </div>
        <p class="credit-line" data-credit="${i}"></p>
      </div></article>`;
  }).join('');
  P.scenes.forEach((_, i) => renderSceneImage(i));
  updateFixBar();
}
async function saveShotMotion(i) {
  const blob = P?.videos?.['scene-' + i];
  if (!blob || !user?.uid) throw new Error('Sign in and finish a video shot first.');
  const scene = P.scenes[i];
  const name = prompt('Name this reusable motion clip', scene.title || `Shot ${i + 1}`);
  if (!name?.trim()) return;
  await Store.saveMotion({ uid: user.uid, name: name.trim(), blob,
    poster: P.images['scene-' + i], credit: structuredClone(P.credits['video-' + i] || {}),
    sourceProject: P.id, characterNames: (P.characters || []).map(c => c.name),
    action: scene.action || '', dialogue: structuredClone(scene.dialogue || []) });
  toast('Motion saved on this device. Reuse it in another film without generation GPU time.', false, 6500);
}

async function openMotionLibrary(i) {
  const project = P, uid = user?.uid;
  if (!uid) throw new Error('Sign in to open your motion library.');
  const entries = await Store.listMotions(uid);
  if (P !== project || user?.uid !== uid) return;
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'width:min(720px,92vw);max-height:85dvh;overflow:auto;padding:24px;border-radius:16px;background:var(--panel,#18202f);color:inherit;border:1px solid #64748b';
  const previewURLs = entries.map(entry => URL.createObjectURL(entry.blob));
  dialog.innerHTML = `<h2>▤ Saved motion</h2><p>Reuse the exact footage with no generation GPU time. New actions or lip-sync require processing. Saved on this browser and device; download a backup before clearing site data.</p><button class="btn motion-close" type="button">Close</button><div>${entries.length ? entries.map((entry, k) => `<article style="padding:16px 0;border-bottom:1px solid #64748b"><h3>${esc(entry.name)}</h3><p>${esc((entry.characterNames || []).join(', '))}</p><video controls playsinline preload="metadata" src="${previewURLs[k]}" style="width:100%;max-height:240px"></video><div><button class="btn motion-use" type="button" data-entry="${k}">Use in shot ${i + 1}</button> <a class="btn" href="${previewURLs[k]}" download="${slug(entry.name)}.${entry.blob.type.includes('webm') ? 'webm' : 'mp4'}">Download backup</a></div></article>`).join('') : '<p>No saved clips yet. Choose “Save motion” on a completed shot.</p>'}</div>`;
  const dispose = () => { previewURLs.forEach(url => URL.revokeObjectURL(url)); dialog.remove(); };
  dialog.addEventListener('close', dispose, { once: true });
  dialog.querySelector('.motion-close').onclick = () => dialog.close();
  dialog.querySelectorAll('.motion-use').forEach(button => button.onclick = () => {
    if (P !== project || user?.uid !== uid || !P.scenes[i]) { dialog.close(); return; }
    const entry = entries[+button.dataset.entry];
    dialog.close();
    runJob(async signal => {
      pushUndo('reuse saved motion');
      // Keep normal video decoding and safety checks; never invoke a generator.
      await replaceShotClip(i, entry.blob, entry.credit?.model || 'Saved motion', signal);
      P.credits['video-' + i] = { ...P.credits['video-' + i], reusedFrom: entry.id, sourceCredit: entry.credit };
      await save(true);
      toast('Saved footage reused. Review its original speech against this scene before export.', false, 6500);
    });
  });
  document.body.append(dialog); dialog.showModal();
}

function renderSceneImage(i) {
  const box = document.querySelector(`[data-img="scene-${i}"]`);
  if (!box) return;
  const blob = P.images['scene-' + i], clip = P.videos?.['scene-' + i];
  box.querySelectorAll('img, video:not(.clip-canvas)').forEach(el => el.remove());
  box.querySelector('.ph').hidden = !!blob;
  // the still picture; a shot with an AI clip plays it while the pointer is over it
  // (a long film has hundreds of clips, more than a page can play at once)
  if (blob) box.insertAdjacentHTML('beforeend', `<img src="${blobURL('scene-' + i, blob)}" alt="Shot ${i + 1}">`);
  // a picture or clip the safety check blocked, or could not check: nothing is shown in its place
  box.querySelector('.blocked-note')?.remove();
  if (!blob && blockedText('scene-' + i)) box.insertAdjacentHTML('beforeend', `<span class="blocked-note">⛔ ${esc(blockedText('scene-' + i))}</span>`);
  box.classList.toggle('has-clip', !!clip);
  // a clip loading in the background
  box.querySelector('.s-chip')?.remove();
  const chip = chipOf.get(P.scenes[i]);
  if (chip) box.insertAdjacentHTML('beforeend', `<span class="s-chip">${esc(chip)}</span>`);
  const c = P.credits['scene-' + i], cl = document.querySelector(`[data-credit="${i}"]`), vc = P.credits['video-' + i];
  if (cl) cl.textContent = (!c ? '' : c.kind === 'ai' ? `AI-painted${c.model ? ` (${c.model})` : ''} · seed ${c.seed}` : c.kind === 'user' ? 'Your own image. Make sure you hold the rights.'
    : c.kind === 'clip' ? 'First frame of the AI video' : c.kind === 'stock-preview' ? 'Preview of free footage' : c.kind === 'extend' ? 'Last frame of the shot before' : `📷 “${c.title}” by ${c.creator} · ${c.license} · via ${c.provider}`)
    + (clip && vc ? ` · 🎬 ${vc.model}${vc.duration ? ` · ${(+vc.duration).toFixed(1)} s clip (${Math.round(vc.duration * 24)} frames)` : ''}${vc.job ? ` · GPU job ${vc.job} #${vc.n}` : ''}${vc.stock?.credit ? ` · ${vc.stock.credit}` : ''}${areaNote(i) ? ` · ${areaNote(i)}` : ''}` : '')
    + ` · Motion: ${motionKind(i)}`;
  const st = document.querySelector(`[data-scene="${i}"] .s-status`);
  if (st) st.innerHTML = shotStatus(i);
  updateStepper();
}
let hoverClip = null;
$('#sceneList').addEventListener('pointerover', e => {
  const box = e.target.closest('.scene-img.has-clip');
  if (box === hoverClip?.box) return;
  hoverClip?.el.remove(); hoverClip = null;
  const i = box ? +box.closest('[data-scene]').dataset.scene : -1, clip = P?.videos?.['scene-' + i];
  if (!clip) return;
  box.insertAdjacentHTML('beforeend', `<video src="${blobURL('clip-' + i, clip)}" autoplay loop muted playsinline aria-label="Shot ${i + 1} clip"></video>`);
  hoverClip = { box, el: box.lastElementChild };
});
$('#sceneList').addEventListener('pointerleave', () => { hoverClip?.el.remove(); hoverClip = null; });

// Text edits: a changed line or narration is the only one recorded again (voice cache);
// a changed spoken line on a shot with a clip needs its lips re-synced.
$('#sceneList').addEventListener('input', () => { if (lastRender) setTimeout(staleDownload); });
$('#sceneList').addEventListener('change', () => { if (lastRender) setTimeout(staleDownload); });
$('#sceneList').addEventListener('input', e => {
  const card = e.target.closest('[data-scene]'); if (!card) return;
  const i = +card.dataset.scene, sc = P.scenes[i], t = e.target;
  if (t.classList.contains('s-line')) { sc.dialogue[0].line = t.value; sceneAudio = null; mixBuf = null; }
  else if (t.classList.contains('s-narr')) { sc.narration = t.value; sceneAudio = null; mixBuf = null; }
  else if (t.classList.contains('s-visual')) sc.visual = t.value;
  else if (t.classList.contains('s-action')) { sc.action = t.value; delete sc.beats; const b = card.querySelector('.s-beats'); if (b) b.value = ''; }
  else if (t.classList.contains('s-beats')) {
    const beats = parseBeats(t.value);
    if (beats.length) { sc.beats = beats; sc.action = beatsSentence(beats); card.querySelector('.s-action').value = sc.action; } else delete sc.beats;
    video = null; clearTimeout(textChanged.t); textChanged.t = setTimeout(refreshPreview, 600);
  }
  else if (t.classList.contains('s-motion')) { sc.motion = +t.value / 100; video = null; clearTimeout(textChanged.t); textChanged.t = setTimeout(refreshPreview, 300); }
  else if (t.classList.contains('s-text')) {
    if (t.value.trim()) sc.text = { style: sc.text?.style || card.querySelector('.s-tstyle').value, text: t.value };
    else delete sc.text;
    textChanged(i);
  }
  else return;
  save();
});

// Shot order: order[k] is the old index of the shot now at k, or -1 for a new one (taken
// from fresh). Pictures, clips, credits and recorded lines move with their shots.
function reshuffle(order, fresh = []) {
  const move = (map, prefixes) => {
    const out = {};
    for (const [k, v] of Object.entries(map || {})) if (!prefixes.some(p => k.startsWith(p))) out[k] = v;
    order.forEach((old, k) => { if (old >= 0) for (const p of prefixes) if (map?.[p + old] !== undefined) out[p + k] = map[p + old]; });
    return out;
  };
  P.images = move(P.images, ['scene-', 'prev-']); P.videos = move(P.videos, ['scene-']); P.credits = move(P.credits, ['scene-', 'video-', 'want-', 'prevc-', 'review-']);
  const pool = [...fresh];
  P.scenes = order.map(old => old >= 0 ? structuredClone(P.scenes[old]) : pool.shift());
  if (sceneAudio) sceneAudio = order.map(old => old >= 0 ? sceneAudio[old] || [] : []);
  const pickedOld = [...picked]; picked.clear();
  order.forEach((old, k) => { if (pickedOld.includes(old)) picked.add(k); });
  timeline = null; mixBuf = null; video = null; media.clear();
  renderScenes(); save();
}
const indexes = () => P.scenes.map((_, k) => k);
function newShotAfter(i) {
  const sc = P.scenes[i];
  return { title: sc.title, sceneOf: sc.sceneOf, narration: '', dialogue: [], characters: [...(sc.characters || [])], visual: '', action: '',
    shot: 'medium', camera: 'drift', ambience: sc.ambience, stock: sc.stock, hold: 0 };
}
// The last frame of a clip, as a picture to continue the shot from.
async function lastFrame(blob) {
  const v = document.createElement('video'), url = URL.createObjectURL(blob);
  v.muted = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('Could not read that clip.')); });
    v.currentTime = Math.max(0, v.duration - 0.05);
    await new Promise(res => { v.onseeked = res; });
    const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
    c.getContext('2d').drawImage(v, 0, 0);
    return await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
  } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
}

$('#sceneList').addEventListener('change', e => {
  const card = e.target.closest('[data-scene]'); if (!card) return;
  const i = +card.dataset.scene, sc = P.scenes[i], t = e.target;
  if (t.classList.contains('s-pick')) {
    if (t.checked) picked.add(i); else picked.delete(i);
    card.classList.toggle('picked', t.checked); updateFixBar(); return;
  }
  if (t.classList.contains('s-upload-video') && t.files[0]) {
    const file = t.files[0]; t.value = '';
    runJob(async signal => {
      setStatus('Importing video…', `Shot ${i + 1}`);
      await replaceShotClip(i, file, 'Your video', signal);
      await save(true); updateStepper();
      toast(`Shot ${i + 1} now uses your video.`);
    });
    return;
  }
  if (t.classList.contains('s-line')) {
    // a spoken line changed on a shot whose clip was lip-synced to the old one
    if (P.videos?.['scene-' + i]) { sc.lipStale = true; picked.add(i); card.classList.add('picked'); card.querySelector('.s-pick').checked = true; updateFixBar(); }
    renderSceneImage(i);
  }
  if (t.classList.contains('s-speaker')) { sc.dialogue[0].character = t.value; sceneAudio = null; mixBuf = null; }
  if (t.classList.contains('s-cam')) { sc.camera = t.value; refreshPreview(); }
  if (t.classList.contains('s-fill')) { if (t.value === 'fill') delete sc.fill; else sc.fill = t.value; video = null; staleDownload(); refreshPreview(); }
  if (t.classList.contains('s-amb')) { sc.ambience = t.value; mixBuf = null; }
  if (t.classList.contains('s-hold')) { sc.hold = +t.value; timeline = null; mixBuf = null; }
  if (t.classList.contains('s-tstyle') && sc.text) { sc.text.style = t.value; textChanged(i); }
  if (t.classList.contains('s-magic') && t.value) {
    const key = t.value; t.value = '';
    const backdrop = key === 'backdrop' ? askBackdrop() : null;
    if (key === 'backdrop' && !backdrop) return;
    runJob(signal => magicEdit([i], key, signal, backdrop));
    return;
  }
  if (t.classList.contains('s-expr')) { sc.expr = t.value; video = null; refreshPreview(); }
  if (t.classList.contains('s-clipsound')) { sc.clipSound = t.checked; sceneAudio = null; mixBuf = null; timeline = null; video = null; }
  if (t.classList.contains('s-motionref') && t.files[0]) {
    const file = t.files[0];
    runJob(async () => {
      setStatus('Copying the movement…', 'Reading the person in your video, on this device', 0);
      sc.motionRef = await motionFromVideo(file, p => setStatus('Copying the movement…', `${Math.round(p * 100)}%`, p));
      video = null; renderScenes(); save(); refreshPreview();
      toast(`Shot ${i + 1} now moves like the person in your video (${Math.round(sc.motionRef.limbs.armL.length / sc.motionRef.fps)} s, repeating).`, false, 7000);
    });
    return;
  }
  if (t.classList.contains('s-upload') && t.files[0]) {
    // the person's own picture: used only once the checker on this device passes it
    const file = t.files[0]; t.value = '';
    checkImage(file).then(() => {
      P.images['scene-' + i] = file;
      if (P.videos) delete P.videos['scene-' + i];
      P.credits['scene-' + i] = { kind: 'user' };
      clearBlocked('scene-' + i);
      renderSceneImage(i); refreshPreview(); save();
    }, e => safetyToast(`Your picture for shot ${i + 1}`, e));
    return;
  }
  save();
});
$('#sceneList').addEventListener('click', e => {
  const card = e.target.closest('[data-scene]'); if (!card || job) return;
  const i = +card.dataset.scene, n = P.scenes.length;
  if (e.target.closest('.s-save-motion')) { saveShotMotion(i).catch(error => toast(error.message, true)); return; }
  if (e.target.closest('.s-reuse-motion')) { openMotionLibrary(i).catch(error => toast(error.message, true)); return; }
  if (e.target.closest('.s-play')) playSceneClip(i, card).catch(error => toast(error.message, true, 10000));
  if (e.target.closest('.s-stock')) {
    runJob(async signal => {
      setStatus('Finding real footage…', `Shot ${i + 1}`);
      const ok = await realFootage(i, signal, { force: true });
      await save(true); updateStepper();
      toast(ok ? `Shot ${i + 1} now uses real footage (credited at the end).`
        : spent('vision') ? `The free picture checker is busy, and archive footage is never used unchecked. Try shot ${i + 1} again in about 10 minutes.`
        : `No fitting free footage found for shot ${i + 1}. Try rewording its "stock" words or the shot description.`, !ok, 7000);
    });
    return;
  }
  if (e.target.closest('.s-lipface')) showFacePicker(i, card).catch(error => toast(error.message, true, 6000));
  if (e.target.closest('.s-keep')) {
    delete P.credits['review-' + i]; delete P.images['prev-' + i]; delete P.credits['prevc-' + i];
    renderSceneImage(i); save(); return;
  }
  if (e.target.closest('.s-reject')) {
    // back to the picture it had, with basic motion
    if (P.videos) delete P.videos['scene-' + i];
    delete P.credits['video-' + i]; delete P.credits['review-' + i];
    if (P.images['prev-' + i]) { P.images['scene-' + i] = P.images['prev-' + i]; P.credits['scene-' + i] = P.credits['prevc-' + i] || { kind: 'ai' }; }
    delete P.images['prev-' + i]; delete P.credits['prevc-' + i];
    video = null; media.clear(); renderSceneImage(i); refreshPreview(); save();
    toast(`Shot ${i + 1} is back to its picture with basic motion. Tick it and press 🎬 Re-animate for a new take.`, false, 7000);
    return;
  }
  if (e.target.closest('.s-motionref-clear')) { delete sc0(i).motionRef; video = null; renderScenes(); save(); refreshPreview(); return; }
  const fp = e.target.closest('.face-pick');
  if (fp) {
    const name = P.characters.find(c => c.id === sc0(i).dialogue?.[0]?.character)?.name;
    if (name) { sc0(i).lipFaces = { ...(sc0(i).lipFaces || {}), [name]: +fp.dataset.n }; save(); video = null; refreshPreview(); }
    card.querySelectorAll('.face-pick').forEach(b => b.classList.toggle('on', b === fp));
    toast(`${name || 'The speaker'} now speaks with face ${+fp.dataset.n + 1}.`);
    return;
  }
  if (e.target.closest('.s-clip')) exportSceneClip(i);
  if (e.target.closest('.s-best')) runJob(async signal => {
    pushUndo('best part');
    setStatus('Finding the best part…', `Shot ${i + 1}: frames checked by AI vision`);
    const tr = await bestPart(i, signal);
    toast(tr ? `Shot ${i + 1} plays ${tr[0]}-${tr[1]} s of its clip.` : `Shot ${i + 1}'s clip is no longer than the shot.`);
    sceneAudio = null; timeline = null; mixBuf = null; video = null; save();
  }).then(ok => { if (ok) edited(); });
  if (e.target.closest('.s-repaint')) runJob(async signal => { setStatus('Painting shot ' + (i + 1) + '…'); await paintScene(i, signal, true); refreshPreview(); });
  if (e.target.closest('.s-up') && i > 0) { const o = indexes(); [o[i - 1], o[i]] = [o[i], o[i - 1]]; reshuffle(o); }
  if (e.target.closest('.s-down') && i < n - 1) { const o = indexes(); [o[i], o[i + 1]] = [o[i + 1], o[i]]; reshuffle(o); }
  if (e.target.closest('.s-dup')) { const o = indexes(); o.splice(i + 1, 0, i); reshuffle(o); }
  if (e.target.closest('.s-del') && n > 1 && confirm(`Delete shot ${i + 1}?`)) { const o = indexes(); o.splice(i, 1); reshuffle(o); }
  if (e.target.closest('.s-add')) {
    const o = indexes(); o.splice(i + 1, 0, -1); reshuffle(o, [newShotAfter(i)]);
    toast('New shot added. Describe it under Direction, then paint it (🎨 Repaint).', false, 7000);
  }
  if (e.target.closest('.s-extend')) runJob(async () => {
    setStatus('Extending the shot…', 'Taking its last frame');
    const frame = await lastFrame(P.videos['scene-' + i]);
    const next = { ...newShotAfter(i), visual: P.scenes[i].visual, action: '' };
    const o = indexes(); o.splice(i + 1, 0, -1); reshuffle(o, [next]);
    P.images['scene-' + (i + 1)] = frame; P.credits['scene-' + (i + 1)] = { kind: 'extend' };
    picked.add(i + 1); renderScenes(); save();
    document.querySelector(`[data-scene="${i + 1}"] .s-action`)?.focus();
    toast('Shot continued from the last frame. Write what happens next under Direction, then press 🎬 Re-animate.', false, 9000);
  });
});

// ---- lip-sync studio: number the faces on the picture, click the one that speaks ----
const sc0 = i => P.scenes[i];
const EXPR_OPTS = [['auto', '🎭 Auto face'], ['neutral', '😐 Neutral'], ['smile', '🙂 Smile'], ['laugh', '😄 Laugh'], ['sad', '😢 Sad'], ['angry', '😠 Angry'], ['surprised', '😮 Surprised'], ['worried', '😟 Worried']];
const EXPR_WORDS = { neutral: 'calm, neutral faces', smile: 'warm, natural smiles', laugh: 'genuine laughter', sad: 'sad, teary faces', angry: 'angry, frowning faces', surprised: 'surprised faces, raised eyebrows', worried: 'worried, tense faces' };
async function showFacePicker(i, card) {
  const blob = P.images['scene-' + i];
  if (!blob) throw new Error('Paint this shot first.');
  if (realFace(i)) throw new Error(REAL_FACE_NOTE);
  const box = card.querySelector('.scene-img');
  box.querySelectorAll('.face-pick').forEach(b => b.remove());
  setStatus('Finding the faces…', 'On your device');
  const faces = await facesFor(blob);
  clearStatus();
  if (!faces.length) throw new Error('No face big enough to lip-sync was found in this picture.');
  const ltr = [...faces].sort((a, b) => a.m[0] - b.m[0]);
  const name = P.characters.find(c => c.id === sc0(i).dialogue?.[0]?.character)?.name;
  const cur = sc0(i).lipFaces?.[name];
  box.insertAdjacentHTML('beforeend', ltr.map((f, n) => `<button class="face-pick${cur === n ? ' on' : ''}" data-n="${n}" style="left:${(f.m[0] * 100).toFixed(1)}%;top:${(f.m[1] * 100).toFixed(1)}%" title="This face speaks">${n + 1}</button>`).join(''));
  toast(`Click the face that says “${(sc0(i).dialogue?.[0]?.line || '').slice(0, 40)}”.`, false, 6000);
}

// ============ fix shots on the free GPU ============
const picked = new Set();
function updateFixBar() {
  $('#fixBar').hidden = !picked.size;
  $('#fixCount').textContent = `${picked.size} shot${picked.size === 1 ? '' : 's'} selected`;
}
$('#fixClear').onclick = () => { picked.clear(); renderScenes(); };
$('#btnCollect').onclick = () => runJob(async signal => {
  const run = P.gpuRun;
  if (!run) return;
  try { await waitMotion(collectClips(signal, run.job, run.want, run)); delete P.gpuRun; }
  catch (e) { if (e instanceof Cancelled) throw e; markGpuError(e.message, run.want); if (!e.resumable) delete P.gpuRun; throw e; }
  finally { save(); renderScenes(); }
  toast('The AI clips from the GPU run are in.', false, 6000);
});
$('#btnFixFlagged').onclick = () => runJob(async signal => {
  const flagged = P.scenes.map((_, k) => k).filter(k => P.checks?.['scene-' + k] && !P.checks['scene-' + k].ok);
  let k = 0;
  for (const i of flagged) { setStatus('Repainting flagged shots…', `Shot ${i + 1} (${++k} of ${flagged.length})`, k / flagged.length); await paintScene(i, signal, true); picked.add(i); }
  renderScenes(); refreshPreview();
  const still = flagged.filter(i => !P.checks?.['scene-' + i]?.ok).length;
  toast(still ? `${flagged.length - still} fixed; ${still} still flagged. Try ✨ Magic edit or edit the shot's description.` : 'All flagged shots repainted and passed the check.', !!still, 9000);
});
$('#fixBar').addEventListener('click', e => { const b = e.target.closest('[data-fix]'); if (b) fixShots(b.dataset.fix); });
$('#fixMagic').innerHTML = magicOptions();
$('#fixMagic').onchange = e => {
  const key = e.target.value; e.target.value = '';
  if (!key || !picked.size || job) return;
  const backdrop = key === 'backdrop' ? askBackdrop() : null;
  if (key === 'backdrop' && !backdrop) return;
  runJob(signal => magicEdit([...picked].sort((a, b) => a - b), key, signal, backdrop));
};
// paint: new picture, then new motion (and lip-sync); animate: new motion from the same
// picture; lip: the same clip with its lips synced to the current line.
function fixShots(kind) {
  const shots = [...picked].sort((a, b) => a - b);
  if (!shots.length) return;
  if (!relayHasMotion()) { toast('The free GPU is not available on this site right now.', true); return; }
  if (kind === 'lip' && shots.length && shots.every(realFace)) {
    toast(REAL_FACE_NOTE, true, 8000); return;
  }
  if (kind === 'lip' && !shots.some(i => P.videos?.['scene-' + i] && P.scenes[i].dialogue?.length)) {
    toast('Lip-sync needs shots that have a motion clip and a spoken line.', true); return;
  }
  runJob(async signal => {
    setStatus('Starting the free GPU…', `${shots.length} shot${shots.length > 1 ? 's' : ''}`);
    // lip-sync alone runs on one notebook (two would sync the same shots twice)
    let job = await startGpu('fix', kind !== 'lip' && shots.length > 8 ? 2 : 1, { quietBusy: true });
    if (!job && gpuBusy) job = await waitForGpu('fix', kind !== 'lip' && shots.length > 8 ? 2 : 1, signal);
    if (!job) return;
    let ok = false;
    try {
      if (kind === 'paint') {
        shots.forEach(i => { delete P.images['scene-' + i]; delete P.videos['scene-' + i]; renderSceneImage(i); });
        await gpuPaint(signal, job, new Set(shots.map(i => i + 1)));
      }
      if (!sceneAudio) await doVoices(signal);
      await waitMotion(sendToGpu(signal, job, shots, { lipOnly: kind === 'lip', fresh: kind !== 'lip' }));
      ok = true;
    } finally { if (!ok && P.gpuRun?.job !== job) relay('cancel', { job }).catch(() => {}); }
    picked.clear(); timeline = null; mixBuf = null; video = null;
    renderScenes(); save();
    toast(`✅ ${shots.length} shot${shots.length > 1 ? 's' : ''} fixed. Open Film & tools to render the new version.`, false, 8000);
  });
}

// Decode before replacing a scene, so an invalid upload cannot destroy its media.
async function readImportedClip(file, signal) {
  if (!file?.size || file.size > 250 * 1024 * 1024) throw new Error('Choose a non-empty video under 250 MB.');
  const el = document.createElement('video'), url = URL.createObjectURL(file);
  el.muted = true; el.playsInline = true; el.preload = 'auto';
  try {
    await new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => { clearTimeout(timer); el.onloadeddata = null; el.onerror = null; signal?.removeEventListener('abort', cancel); };
      const fail = error => { cleanup(); reject(error); };
      const cancel = () => fail(new Cancelled());
      if (signal?.aborted) return cancel();
      signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => fail(new Error('Video loading timed out. Try an MP4 file.')), 20000);
      el.onerror = () => fail(new Error('This browser cannot read that video. Try an MP4 file.'));
      el.onloadeddata = () => { cleanup(); resolve(); };
      el.src = url; el.load();
    });
    if (signal?.aborted) throw new Cancelled();
    if (!(el.duration > 0) || !Number.isFinite(el.duration) || !el.videoWidth || !el.videoHeight) throw new Error('The selected file has no readable video frames.');
    const canvas = document.createElement('canvas'), scale = Math.min(1, 1280 / Math.max(el.videoWidth, el.videoHeight));
    canvas.width = Math.max(1, Math.round(el.videoWidth * scale)); canvas.height = Math.max(1, Math.round(el.videoHeight * scale));
    canvas.getContext('2d').drawImage(el, 0, 0, canvas.width, canvas.height);
    const poster = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!poster) throw new Error('Could not extract a preview frame from this video.');
    return { poster, duration: el.duration };
  } finally { el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); }
}
// ============ AI tools: Smart Short and translation ============
// A copy of the film (all or some of its shots) as a new film in My films; pictures and
// clips are shared with the original, not copied.
function deriveFilm(idxs, patch) {
  const D = structuredClone({ ...P, images: {}, videos: {}, credits: {}, files: {} });
  Object.assign(D, { id: crypto.randomUUID(), createdAt: Date.now(), parent: P.id });
  D.scenes = idxs.map(i => structuredClone(P.scenes[i]));
  for (const [k, v] of Object.entries(P.images)) if (!k.startsWith('scene-') && !k.startsWith('prev-')) D.images[k] = v;
  for (const [k, v] of Object.entries(P.credits)) if (!/^(scene|video|want|prevc|review)-/.test(k)) D.credits[k] = v;
  for (const [k, v] of Object.entries(P.videos || {})) if (k.startsWith('pip-')) D.videos[k] = v;
  idxs.forEach((old, k) => {
    if (P.images['scene-' + old]) D.images['scene-' + k] = P.images['scene-' + old];
    if (P.videos?.['scene-' + old]) D.videos['scene-' + k] = P.videos['scene-' + old];
    for (const p of ['scene-', 'video-', 'want-']) if (P.credits[p + old]) D.credits[p + k] = P.credits[p + old];
  });
  return Object.assign(D, patch);
}
async function openDerived(D) {
  resetMedia();
  P = D;
  readOptionsToUI(); renderAll();
  await save(true);
}
$('#btnShort').onclick = () => runJob(async signal => {
  setStatus('Smart Short: finding the strongest moment…', P.title);
  const m = await pickShortMoment(P, { signal });
  const idxs = Array.from({ length: m.to - m.from + 1 }, (_, k) => m.from + k);
  await openDerived(deriveFilm(idxs, {
    title: m.title, options: { ...P.options, format: '9:16', length: 'shorts' },
    look: { ...P.look, bars: false, captions: 'bold' }
  }));
  P.scenes.forEach(sc => { sc.hold = 0; });
  toast(`📱 Smart Short: ${idxs.length} shots from the original, now a vertical film.`, false, 7000);
}).then(async ok => { if (ok && await confirmCast('Your Short is ready to render.')) { autoRender = true; goStep('film'); } });

// The same film in another frame: pictures and clips are re-framed by the renderer.
async function resizeFilm(format) {
  if (!['16:9', '9:16', '1:1'].includes(format)) throw new Error('Pick 16:9, 9:16 or 1:1.');
  if (format === (P.options?.format || '16:9')) throw new Error(`The film is already ${format}.`);
  const name = { '16:9': 'YouTube', '9:16': 'Vertical', '1:1': 'Square' }[format];
  await openDerived(deriveFilm(indexes(), {
    title: `${P.title} (${name})`, options: { ...P.options, format },
    look: { ...P.look, bars: format === '16:9' ? P.look?.bars : false }
  }));
  toast(`📐 ${format} copy made. Rendering…`, false, 6000);
}
$('#btnResize').onclick = () => runJob(() => resizeFilm($('#rsFormat').value)).then(async ok => { if (ok && await confirmCast('The resized copy is ready to render.')) { autoRender = true; goStep('film'); } });

// every language in langs.js, grouped by region
const LANGS = languageNames();
function fillTranslateLangs() {
  const cur = P?.language || 'English';
  $('#trLang').innerHTML = languageOptionsHTML(null, cur);
}
$('#btnTranslate').onclick = () => runJob(async signal => {
  const lang = $('#trLang').value;
  const T = deriveFilm(P.scenes.map((_, k) => k), {});
  T.characters.forEach(c => delete c.voice);
  delete T.narrator;
  setStatus('Translating the script…', `${P.language || 'English'} → ${lang}`);
  await translateFilm(T, lang, { signal, onStatus: d => setStatus('Translating the script…', d) });
  T.options = { ...T.options, language: lang };
  await openDerived(T);
}).then(async ok => {
  // "Your cast" before the new voices are made (no job runs while it is open)
  if (!ok || !await confirmCast(`The script is in ${P.language} now: check the voices before they are recorded.`)) return;
  runJob(async signal => {
  // new voices, then the speakers' lips synced to them on the free GPU
  await doVoices(signal);
  const speaking = P.scenes.map((_, k) => k).filter(k => P.videos?.['scene-' + k] && P.scenes[k].dialogue?.length);
  if (!speaking.length) return;
  const job = await startGpu('tr', 1);
  if (!job) {
    speaking.forEach(k => { P.scenes[k].lipStale = true; });
    save();
    toast('The lips still follow the original language. Re-sync them later from the storyboard (👄).', true, 10000);
    return;
  }
  let ok = false;
  try { await waitMotion(sendToGpu(signal, job, speaking, { lipOnly: true })); ok = true; }
  finally { if (!ok && P.gpuRun?.job !== job) relay('cancel', { job }).catch(() => {}); }
  }).then(ok2 => { if (ok2) { autoRender = true; goStep('film'); } });
});

// ============ real stock footage ============
// Scenery shots (no main character, nobody speaking) can be real camera footage: the
// relay searches Pexels, then Wikimedia Commons (public domain, CC0, CC BY); each
// candidate's frame is checked against the shot like a painted picture, and the first that
// fits is attached without sound. The writer's "stock" words (English) are the search.
const isScenery = sc => !drawnShot(sc) && !castOf(sc).length && !(sc.dialogue || []).some(d => d.line) && (P.casting ? sc.source === 'stock' : true);
// The casting director (one writer call): briefs for the roles, the extras, and which
// scenery shots are stock footage with their search queries. Kept on the film, so the
// AI Director can recast a role or swap a shot's clip later.
async function doCasting(signal) {
  setStatus('Casting…', 'The AI casting director picks who is generated and which shots are real footage');
  try {
    applyCasting(await castFilm(P, { signal }));
    save();
  } catch (e) {
    if (e instanceof Cancelled) throw e;
    console.warn('casting', e); // without it, scenery shots are tried with their own words
  }
}
async function findFootage(sc, signal) {
  const orientation = P.options?.format === '9:16' ? 'portrait' : P.options?.format === '1:1' ? 'square' : 'landscape';
  // (words about the footage itself, "free stock footage", "YouTube", only spoil the search)
  // (nor do camera words and little words: "Wide shot of a river at sunrise" found NASA clips)
  const words = s => String(s || '').replace(/[^\p{L}\p{N} ,'-]/gu, ' ').replace(/\b(free|stock|footage|videos?|clips?|youtube|online|b-roll)\b/gi, ' ')
    .replace(/\b(extreme|wide|medium|close-up|close|up|long|establishing|aerial|over-the-shoulder|low-angle|high-angle|macro|shot|view|angle|camera|of|a|an|the|at|in|on|with|and|from|its|their|his|her)\b/gi, ' ')
    .split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  const queries = (sc.stockQueries?.length ? sc.stockQueries : [sc.stock || sc.visual]).map(words).filter(Boolean);
  const seen = new Set(), out = [];
  for (const query of queries) {
    const era = encodeURIComponent(String(sc.era || P.setting || '').slice(0, 80));
    const r = await relayFetch(`${API}/stock?query=${encodeURIComponent(query)}&orientation=${orientation}&min=4&max=180&n=8&era=${era}`,
      { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) }).catch(e => { if (signal?.aborted) throw new Cancelled(); return null; });
    if (!r?.ok) continue;
    for (const c of (await r.json().catch(() => ({}))).clips || []) if (!seen.has(c.url)) { seen.add(c.url); out.push({ ...c, query }); }
    if (out.length >= 10) break;
  }
  return out;
}
// Safety check of a whole stock clip: three frames go to the vision checker. Any frame
// it calls unsafe rejects the clip. Commons and Internet Archive clips need at least one
// answer (no checker, no clip); Pexels clips pass when no checker answers.
async function clipSafe(blob, source, signal) {
  if (spent('vision')) return source === 'pexels';
  let answered = 0;
  try {
    const { frames } = await sampleFrames(blob, [0.15, 0.5, 0.85], 384);
    for (const f of frames) {
      const v = await checkPicture({ image: await toBase64(await f.c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })), expect: 'A frame of a stock video for a family film. Check it for safety.', signal });
      if (v?.unsafe) { console.warn('stock clip failed the safety check', v.problems); return false; }
      if (v) answered++;
    }
  } catch (e) { if (e instanceof Cancelled) throw e; return false; }
  return answered > 0 || source === 'pexels';
}
// What a stock clip must be for this shot (the vision check fails it otherwise).
const stockExpect = sc => `A frame of a real stock video considered for this shot: ${String(sc.visual || '').slice(0, 260)}. `
  + `It must match the place and era (${sc.era || P.setting || 'the film\'s world'}) and the shot's light and mood. `
  + `It must not show modern things in a period film (${(sc.avoid?.length ? sc.avoid : ['phones', 'cars', 'modern clothes', 'signs', 'logos', 'plastic']).join(', ')}), nor any text, subtitles or watermark. People in it are fine.`;
async function thumbBlob(c, signal) {
  if (!c.thumb) return null;
  const r = await fetch(c.thumb, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }).catch(() => null);
  const b = r?.ok ? await r.blob() : null;
  // a thumbnail is shown on the shot while its clip loads: only one the checker passes
  return b && /^image\//.test(b.type) && await isSafe(b) ? b : null;
}
// The free clips found for shot i, best first: each thumbnail is checked by the AI vision
// model (vision on) and the ones that pass are kept in search order. Returns the first
// with its thumbnail (shown while the clip loads), or null.
async function pickFootage(i, signal, { vision = true } = {}) {
  const sc = P.scenes[i];
  const used = new Set(Object.values(P.credits).map(c => c?.stock?.url).filter(Boolean));
  const log = { shot: i + 1, queries: sc.stockQueries || [sc.stock || ''], candidates: 0, scored: 0, passed: 0, chosen: null };
  (P.stockLog ||= []).push(log);
  P.stockLog = P.stockLog.slice(-30);
  const cands = (await findFootage(sc, signal)).filter(c => !used.has(c.url));
  log.candidates = cands.length;
  if (!cands.length) return null;
  if (!vision || spent('vision')) {
    const safe = cands.find(c => c.source === 'pexels');
    if (!safe) { log.unchecked = 'no checker: archive clips are not used unchecked'; return null; }
    log.chosen = safe.url; log.unchecked = true; return { c: safe, thumb: await thumbBlob(safe, signal) };
  }
  // three thumbnails are checked at a time; the first that passes, in search order, wins
  const scored = [];
  for (let j = 0; j < Math.min(9, cands.length); j += 3) {
    const batch = await Promise.all(cands.slice(j, j + 3).map(async c => {
      const thumb = await thumbBlob(c, signal);
      const v = thumb ? await checkPicture({ image: await checkJpeg(thumb), expect: stockExpect(sc), signal }) : null;
      if (thumb) log.scored++;
      if (v && !v.ok) console.info(`Shot ${i + 1}: stock thumbnail rejected`, c.url, v.problems);
      return { c, thumb, v };
    }));
    scored.push(...batch);
    const ok = batch.find(x => x.v?.ok);
    if (ok) { log.passed++; ok.c.checked = true; log.chosen = ok.c.url; return { c: ok.c, thumb: ok.thumb }; }
    // the free vision checker is not answering: say so, and do not keep waiting for it
    if (batch.every(x => !x.v)) { spend('vision', 'not answering', Date.now() + 10 * 60000); break; }
  }
  // no checker answered at all: a Pexels clip, unchecked, or none
  if (!log.scored || scored.every(x => !x.v)) {
    const safe = scored.find(x => x.c.source === 'pexels') || (cands.find(c => c.source === 'pexels') && { c: cands.find(c => c.source === 'pexels'), thumb: null });
    if (!safe) return null;
    log.chosen = safe.c.url; return { c: safe.c, thumb: safe.thumb || null };
  }
  return null;
}
// A stock clip's credit and sound: someone else's sound is not played; the film keeps its own.
function useStock(i, c) {
  const sc = P.scenes[i];
  sc.clipSound = false; sc.source = 'stock';
  P.credits['video-' + i] = { ...P.credits['video-' + i], stock: { url: c.url, page: c.page, credit: c.credit, license: c.license, author: c.author, source: c.source, query: c.query } };
  sceneAudio = null; mixBuf = null; timeline = null;
}
async function realFootage(i, signal, { force = false, vision = checksOn() } = {}) {
  const sc = P.scenes[i];
  if (!force && (!isScenery(sc) || P.videos?.['scene-' + i] || P.credits['scene-' + i]?.kind === 'user')) return false;
  const pick = await pickFootage(i, signal, { vision });
  if (!pick) return false;
  try {
    const blob = await fetchClip(pick.c, null, signal);
    if (!await clipSafe(blob, pick.c.source, signal)) throw new Error('the clip did not pass the safety check');
    const file = new File([blob], `stock-${i + 1}.${/webm/.test(blob.type || pick.c.url) ? 'webm' : 'mp4'}`, { type: blob.type || 'video/mp4' });
    await attachClip(i, file, { pexels: 'Real footage (Pexels)', archive: 'Real footage (Internet Archive)' }[pick.c.source] || 'Real footage (Wikimedia Commons)', signal);
    useStock(i, pick.c);
    renderSceneImage(i);
    return true;
  } catch (e) {
    if (e instanceof Cancelled) throw e;
    console.warn(`Shot ${i + 1}: stock clip failed`, pick.c.url, e.message);
    return false;
  }
}
async function doRealFootage(signal) {
  const todo = P.scenes.map((_, i) => i).filter(i => isScenery(P.scenes[i]) && !P.videos?.['scene-' + i] && P.credits['scene-' + i]?.kind !== 'user');
  let done = 0, got = 0;
  for (const i of todo) {
    setStatus('Finding real footage for scenery shots…', `Shot ${i + 1} · ${done} of ${todo.length} checked, ${got} found`, done / Math.max(1, todo.length));
    if (await realFootage(i, signal).catch(e => { if (e instanceof Cancelled) throw e; return false; })) got++;
    done++;
  }
  if (got) save();
}

// ============ clips fill the frame ============
// Any clip that comes into the film (stock and archive footage, the person's files, clips
// made elsewhere, the free GPU's clips) is looked at once: black bars (pillarbox, letterbox
// or both) are found on a few frames and left out, and where people are seen the crop
// keeps them in view. The renderer then fills the film's frame (sc.fill: fill, fit, blur-fill).
async function sampleFrames(blob, at, size = 192) {
  const el = document.createElement('video'), url = URL.createObjectURL(blob);
  el.muted = true; el.playsInline = true; el.preload = 'auto';
  try {
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('the clip did not load')), 20000);
      el.onloadeddata = () => { clearTimeout(to); res(); };
      el.onerror = () => { clearTimeout(to); rej(new Error('unreadable clip')); };
      el.src = url;
    });
    const D = el.duration, k = Math.min(1, size / Math.max(el.videoWidth, el.videoHeight));
    const w = Math.max(8, Math.round(el.videoWidth * k)), h = Math.max(8, Math.round(el.videoHeight * k)), frames = [];
    for (const f of at) {
      const t = Math.max(0, Math.min(D - 0.05, f * D));
      await new Promise(res => { const to = setTimeout(res, 4000); el.onseeked = () => { clearTimeout(to); res(); }; el.currentTime = t; });
      const c = new OffscreenCanvas(w, h);
      c.getContext('2d', { willReadFrequently: true }).drawImage(el, 0, 0, w, h);
      frames.push({ t, c });
    }
    return { frames, duration: D, width: el.videoWidth, height: el.videoHeight };
  } finally { el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); }
}
// The picture area without black bars, as a 0-1 box (null when there are none). A row or
// column is a bar when it is dark in every sampled frame; bars come in matching pairs.
function barsOf(frames) {
  const { width: w, height: h } = frames[0].c;
  const col = new Float32Array(w), row = new Float32Array(h), colPeak = new Float32Array(w), rowPeak = new Float32Array(h);
  for (const { c } of frames) {
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const cs = new Float32Array(w), rs = new Float32Array(h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, l = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
      cs[x] += l / h; rs[y] += l / w;
      if (l > colPeak[x]) colPeak[x] = l;
      if (l > rowPeak[y]) rowPeak[y] = l;
    }
    for (let x = 0; x < w; x++) col[x] = Math.max(col[x], cs[x]);
    for (let y = 0; y < h; y++) row[y] = Math.max(row[y], rs[y]);
  }
  const dark = (mean, peak) => mean < 18 && peak < 60;
  const span = (mean, peak, n) => {
    let a = 0, b = n - 1;
    while (a < n - 1 && dark(mean[a], peak[a])) a++;
    while (b > a && dark(mean[b], peak[b])) b--;
    const lo = a / n, hi = (n - 1 - b) / n;
    // a pair of bars (one side may be a little wider), each over 2% of the frame
    return lo > 0.02 && hi > 0.02 && Math.abs(lo - hi) < 0.06 ? [lo + 0.004, 1 - hi - 0.004] : [0, 1];
  };
  const [x0, x1] = span(col, colPeak, w), [y0, y1] = span(row, rowPeak, h);
  if (x1 - x0 < 0.3 || y1 - y0 < 0.3 || (x0 === 0 && y0 === 0)) return null;
  return { x: +x0.toFixed(4), y: +y0.toFixed(4), w: +(x1 - x0).toFixed(4), h: +(y1 - y0).toFixed(4) };
}
// Where the people are in a frame (0-1 of the picture area), from the on-device body and
// face finders; null when nobody is seen.
async function subjectOf(c, area) {
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  const A = area || { x: 0, y: 0, w: 1, h: 1 }, inArea = (x, y) => [Math.min(1, Math.max(0, (x - A.x) / A.w)), Math.min(1, Math.max(0, (y - A.y) / A.h))];
  // faces first (the most exact), weighted by their size; then whole bodies
  // (small faces next to a big one are often patterns on cloth or walls: only faces at least
  // half the size of the biggest count)
  const F0 = await facesFor(blob).catch(() => []), big = Math.max(0, ...F0.map(f => f.s)), F = F0.filter(f => f.s >= big * 0.5);
  if (F.length) {
    const tot = F.reduce((a, f) => a + f.s, 0);
    return inArea(F.reduce((a, f) => a + f.m[0] * f.s, 0) / tot, F.reduce((a, f) => a + f.m[1] * f.s, 0) / tot);
  }
  const B = await bodiesFor(blob).catch(() => null);
  if (B?.people?.length) {
    const ppl = B.people.filter(p => p.nose), tot = ppl.reduce((a, p) => a + (p.size || 1), 0);
    if (ppl.length && tot) return inArea(ppl.reduce((a, p) => a + p.nose[0] * (p.size || 1), 0) / tot, ppl.reduce((a, p) => a + p.nose[1] * (p.size || 1), 0) / tot);
  }
  return null;
}
// Looks at shot i's clip once: its bars and its people. Stored with the clip's credit.
async function frameClip(i, blob) {
  const vc = P.credits['video-' + i];
  if (!vc || !blob) return null;
  const { frames, width, height } = await sampleFrames(blob, [0.15, 0.35, 0.55, 0.75, 0.92], 192);
  const area = barsOf(frames) || { x: 0, y: 0, w: 1, h: 1 };
  // people matter when filling the frame cuts much of the picture away
  const { W, H } = sizeFor(P.options?.format || '16:9', 1080), filmAr = W / H, clipAr = (area.w * width) / (area.h * height);
  let focus = null;
  if (Math.abs(clipAr - filmAr) / filmAr > 0.15) {
    const mid = (await sampleFrames(blob, [0.5], 640)).frames[0];
    focus = await subjectOf(mid.c, area).catch(() => null);
  }
  const bars = area.w < 1 || area.h < 1;
  if (bars || focus) vc.area = { ...area, ...(focus ? { focus: focus.map(v => +v.toFixed(3)) } : {}) };
  else delete vc.area;
  return vc.area || null;
}
const areaNote = i => {
  const a = P.credits['video-' + i]?.area;
  if (!a) return '';
  return [a.w < 1 && 'side bars cropped', a.h < 1 && 'top/bottom bars cropped', a.focus && 'kept the people in frame'].filter(Boolean).join(', ');
};

// The best part of a long clip for its shot: frames across the clip are scored by the AI
// vision check (does it show the shot, without modern things or text) and by sharpness;
// the shot plays the stretch whose frames scored best.
function sharpness(c) {
  const { width: w, height: h } = c, d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) g[k] = 0.299 * d[k * 4] + 0.587 * d[k * 4 + 1] + 0.114 * d[k * 4 + 2];
  let s = 0, s2 = 0, n = 0, light = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x, v = 4 * g[k] - g[k - 1] - g[k + 1] - g[k - w] - g[k + w];
    s += v; s2 += v * v; n++; light += g[k];
  }
  const varL = s2 / n - (s / n) ** 2, mean = light / n;
  return varL / (varL + 300) * (mean < 25 ? 0.3 : 1); // dark frames count for less
}
async function bestPart(k, signal, seconds = 0) {
  const sc = P.scenes[k], clip = P.videos?.['scene-' + k], D = clipDur(k);
  if (!clip || !D) return null;
  const L = Math.max(1.5, seconds || (timeline?.scenes[k] ? (timeline.scenes[k].end - timeline.scenes[k].start) * (sc.speed || 1) : +sc.len || 5));
  if (D < L + 0.8) return null;
  const { frames } = await sampleFrames(clip, [0.06, 0.2, 0.34, 0.48, 0.62, 0.76, 0.9], 512);
  const area = P.credits['video-' + k]?.area;
  const scored = [];
  for (let j = 0; j < frames.length; j += 3) { // three vision checks at a time
    scored.push(...await Promise.all(frames.slice(j, j + 3).map(async f => {
      let c = f.c;
      if (area) { const x = new OffscreenCanvas(Math.round(area.w * c.width), Math.round(area.h * c.height)); x.getContext('2d').drawImage(c, -area.x * c.width, -area.y * c.height); c = x; }
      const v = spent('vision') ? null : await checkPicture({ image: await toBase64(await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 })), expect: stockExpect(sc), signal }).catch(e => { if (e instanceof Cancelled) throw e; return null; });
      return { t: f.t, s: (v ? (v.ok ? 2 : 0) - 0.4 * v.problems.length : 0) + sharpness(f.c), v: v ? (v.ok ? 'ok' : v.problems[0] || 'no') : 'unchecked' };
    })));
    if (j === 0 && scored.every(x => x.v === 'unchecked') && !spent('vision')) spend('vision', 'not answering', Date.now() + 10 * 60000);
  }
  let best = null;
  const step = Math.max(0.4, (D - L) / 16);
  for (let a = 0; a + L <= D + 0.01; a += step) {
    const inside = scored.filter(x => x.t >= a - 0.2 && x.t <= a + L + 0.2);
    const near = inside.length ? inside : [scored.reduce((p, x) => Math.abs(x.t - (a + L / 2)) < Math.abs(p.t - (a + L / 2)) ? x : p)];
    const m = near.reduce((q, x) => q + x.s, 0) / near.length;
    if (!best || m > best.m + 0.01) best = { a, m };
  }
  sc.trim = [+best.a.toFixed(2), +Math.min(D, best.a + L).toFixed(2)];
  console.info(`Shot ${k + 1}: best part ${sc.trim.join('-')} s of ${D.toFixed(1)} s`, scored.map(x => `${x.t.toFixed(1)}s ${x.s.toFixed(2)} ${x.v}`).join(' · '));
  return sc.trim;
}

// ============ free allowances ============
// The free services the film uses have daily or weekly allowances. When one is spent the
// Director says so (and when it comes back) and does not keep asking it.
const allowance = {};
const nextUtcMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };
const istTime = t => new Date(t).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST';
function spend(name, why, until) { allowance[name] = { why, until }; if (!$('#director').hidden) renderChat(); }
const spent = name => allowance[name] && Date.now() < allowance[name].until;
function allowanceLines() {
  const label = { cast: 'Free cast painter (Cloudflare)', painter: 'Free painters', gpu: 'Free GPU (Kaggle)', writer: 'Free writer', vision: 'Free AI vision check (footage picked unchecked meanwhile)' };
  return Object.entries(allowance).filter(([n]) => spent(n)).map(([n, a]) => `${label[n] || n}: ${a.why}, back at ${istTime(a.until)}`);
}
// asked when the Director opens and before it paints
async function checkAllowance() {
  if (!(await relayCanPaintCast()) && !spent('cast')) spend('cast', 'used up today', nextUtcMidnight());
  if (paintersOut()) spend('painter', 'all busy', Date.now() + 10 * 60000);
}
async function painterLeft() {
  await checkAllowance().catch(() => {});
  return !spent('painter') && !paintersOut();
}

// ============ free footage in the background ============
// Stock and archive clips the Director picks load while everything else goes on: the shot
// shows the clip's poster frame at once and a small chip with the progress; two load at a
// time. The clip is then kept with the film (IndexedDB), so renders never fetch it again.
const footQ = [], footRun = new Set(), chipOf = new WeakMap();
function footChip(sc, text) {
  if (text) chipOf.set(sc, text); else chipOf.delete(sc);
  const k = P?.scenes.indexOf(sc);
  if (k >= 0) renderSceneImage(k);
}
function footageLater(tasks) { footQ.push(...tasks); tasks.forEach(t => footChip(t.sc, '🎥 waiting to look for footage…')); pumpFootage(); }
function pumpFootage() {
  while (footRun.size < 2 && footQ.length) {
    const t = footQ.shift();
    footRun.add(t);
    footage(t).finally(() => { footRun.delete(t); pumpFootage(); });
  }
}
// A clip straight from its source (Wikimedia, the Internet Archive and Pexels allow it),
// with progress; a host that blocks the browser is fetched through the relay instead.
async function fetchClip(c, onProgress, signal) {
  const get = async url => {
    // the relay's copy carries the sign-in token; the stock hosts get a plain request
    const r = await (url.startsWith(API) ? relayFetch : fetch)(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(240000)]) });
    if (!r.ok) throw new Error(`the clip's host answered ${r.status}`);
    const total = +r.headers.get('content-length') || c.size || 0, parts = [];
    let got = 0;
    const rd = r.body.getReader();
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value); got += value.length;
      if (got > 150 * 1048576) { rd.cancel(); throw new Error('the clip is too big'); }
      onProgress?.(total ? Math.min(1, got / total) : 0);
    }
    return new Blob(parts, { type: (r.headers.get('content-type') || '').split(';')[0] });
  };
  try { return await get(c.url); }
  catch (e) {
    if (signal.aborted) throw new Cancelled();
    if (!(e instanceof TypeError)) throw e; // a network or CORS refusal: try the relay
    return get(`${API}/clip?url=${encodeURIComponent(c.url)}`);
  }
}
async function footage(t) {
  const { sc, turn } = t, ctl = new AbortController(), signal = ctl.signal;
  t.ctl = ctl;
  const idx = () => P.scenes.indexOf(sc), say = m => { turn.done.push(m); renderChat(); save(); };
  try {
    if (t.query) { sc.stockQueries = [t.query]; sc.stock = t.query; }
    footChip(sc, '🎥 finding free footage, checked by AI vision…');
    const pick = await pickFootage(idx(), signal);
    if (idx() < 0) return;
    if (!pick) { footChip(sc, ''); await noFootage(t); return; }
    // the shot shows the clip's poster frame while it loads
    if (pick.thumb && !(t.swap && P.videos?.['scene-' + idx()])) { P.images['scene-' + idx()] = pick.thumb; P.credits['scene-' + idx()] = { kind: 'stock-preview' }; }
    footChip(sc, '🎥 loading the clip…');
    const blob = await fetchClip(pick.c, p => footChip(sc, `🎥 loading ${Math.round(p * 100)}%`), signal);
    footChip(sc, '🎥 safety check…');
    if (!await clipSafe(blob, pick.c.source, signal)) {
      const j = idx();
      if (j >= 0 && P.credits['scene-' + j]?.kind === 'stock-preview') { delete P.images['scene-' + j]; delete P.credits['scene-' + j]; renderSceneImage(j); }
      throw new Error('the clip did not pass the safety check');
    }
    const k = idx();
    if (k < 0) return;
    const file = new File([blob], `stock-${k + 1}.${/webm/.test(blob.type || pick.c.url) ? 'webm' : 'mp4'}`, { type: blob.type || 'video/mp4' });
    footChip(sc, '🎥 fitting it to the frame…');
    await attachClip(k, file, { pexels: 'Real footage (Pexels)', archive: 'Real footage (Internet Archive)' }[pick.c.source] || 'Real footage (Wikimedia Commons)', signal);
    useStock(k, pick.c);
    if (t.inserted) sc.len = Math.min(8, Math.max(3, +P.credits['video-' + k]?.duration || 5));
    if (t.volume > 0) { sc.clipMix = t.volume / 100; sc.duck = true; }
    timeline = null; sceneAudio = null; mixBuf = null; video = null;
    if (clipDur(k) > (+sc.len || 5) + 1) { footChip(sc, '🎥 finding the best part…'); await bestPart(idx(), signal, +sc.len || 5).catch(e => { if (e instanceof Cancelled) throw e; console.warn('best part', e); }); }
    footChip(sc, '');
    const fit = areaNote(idx());
    say(`${t.swap ? 'New' : 'Real'} footage in shot ${idx() + 1}: ${pick.c.credit || pick.c.page}${fit ? ` (${fit})` : ''}${sc.trim ? `, playing its best part ${sc.trim[0]}-${sc.trim[1]} s` : ''}`);
    // a render in progress is made again with the clip
    if (job && renderJob) job.abort();
    edited();
  } catch (e) {
    footChip(sc, '');
    if (e instanceof Cancelled) return;
    console.warn('footage', e);
    say(`⚠ Footage for shot ${idx() + 1} could not be loaded (${e.message})`);
  }
}
// Nothing fitting: paint the shot with the free painter and animate it on the free GPU;
// when their allowances are spent, hand it off to a free AI video tool.
async function noFootage(t) {
  const { sc, turn } = t, k = P.scenes.indexOf(sc);
  if (k < 0) return;
  if (await painterLeft()) {
    const gpu = relayHasMotion() && !spent('gpu');
    turn.done.push(`No fitting free footage for shot ${k + 1}: painting it with the free painter instead${gpu ? ', then animating it on the free GPU' : ''}`);
    if (P.credits['scene-' + k]?.kind === 'stock-preview') { delete P.images['scene-' + k]; delete P.credits['scene-' + k]; }
    sc.source = 'generated'; sc.visual ||= sc.stock || '';
    deferred.push({ actions: [{ do: 'repaint', shots: [k] }, ...(gpu ? [{ do: 'gpu_fix', shots: [k], kind: 'animate' }] : [])], turn, msg: 'paint instead of footage' });
    setTimeout(afterJob);
  } else {
    turn.handoff = { tool: 'flow', items: handoffItems('flow', [k]) };
    turn.pick = { mode: 'flow', tool: 'flow', shots: [k] };
    turn.done.push(`No fitting free footage for shot ${k + 1}, and ${allowanceLines().join('; ') || 'the free painters are out'}. You can make it with your own free credits in Google Flow, Kling or Hailuo:`);
  }
  renderChat(); save();
}

// ============ film from my clips ============
// Clips made elsewhere (e.g. Google Flow / Veo, with their own speech) become a film: one
// shot per clip in file-name order, each clip's sound kept and its speech transcribed as
// subtitles timed to the words. Music, titles, captions and the MP4 come from VoiceFrame.
$('#clipsFile').onchange = e => {
  const files = [...e.target.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  e.target.value = '';
  if (!files.length) return;
  autoRender = false;
  runJob(async signal => {
    const idea = $('#ideaInput').value.trim();
    newProject();
    $('#ideaInput').value = idea;
    readOptions();
    const lang = $('#optLang').value || 'Hindi';
    Object.assign(P, {
      title: idea.split(/[.!?\n]/)[0].slice(0, 60) || 'My film', idea, logline: idea, genre: 'drama', mood: 'joyful', language: lang,
      characters: [], shotMode: true,
      options: { ...P.options, format: '16:9', length: 'short', language: lang, motion: 'live' },
      scenes: files.map((f, i) => ({ title: f.name.replace(/\.[^.]+$/, '').slice(0, 40), narration: '', dialogue: [], characters: [], visual: '', action: '', shot: 'medium', camera: 'drift', ambience: 'none', hold: 0, sceneOf: i }))
    });
    for (const [i, f] of files.entries()) {
      setStatus('Bringing in your clips…', `Clip ${i + 1} of ${files.length}: ${f.name}`, i / files.length);
      await attachClip(i, f, 'Your video', signal);
      if (i === 0) {
        // the film takes the first clip's shape
        const v = document.createElement('video'); v.src = URL.createObjectURL(f);
        await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; });
        P.options.format = v.videoHeight > v.videoWidth * 1.2 ? '9:16' : Math.abs(v.videoHeight - v.videoWidth) < 40 ? '1:1' : '16:9';
        URL.revokeObjectURL(v.src);
      }
      // the clip's own words, for subtitles
      const sound = await clipSound(f);
      if (!sound) continue;
      setStatus('Reading what is said in each clip…', `Clip ${i + 1} of ${files.length}`, (i + 0.5) / files.length);
      const segs = await transcribe(await monoAt(sound, 16000), signal).catch(err => { if (err instanceof Cancelled) throw err; console.warn('transcribe', err); return []; });
      if (segs.length) {
        P.scenes[i].narration = segs.map(s => s.text).join(' ');
        P.scenes[i].speech = [segs[0].start, segs[segs.length - 1].end];
      }
    }
    sceneAudio = null; timeline = null; mixBuf = null;
    readOptionsToUI(); renderAll(); save(true);
    toast(`🎞 ${files.length} clips are now a film, with their own voices and subtitles. Add a title, music and captions in Voice & look, then render.`, false, 9000);
    goStep('scenes');
  });
};

// ============ motion test ============
// Four short shots that show whether real motion works before a long film is made: a walk,
// writing in a notebook, a Hindi conversation with lip-sync, and a two-person hand-over.
// They are written here (no story writer), painted, voiced and all animated on the free GPU.
function motionTestFilm() {
  const meera = { id: 'c1', name: 'मीरा', role: 'protagonist', gender: 'female', age: 'adult', appearance: 'Indian woman, 24, oval face, long black hair in a single braid, warm brown skin, slim, mustard-yellow cotton kurta with embroidered neckline, white leggings, small silver earrings', personality: 'determined and kind' };
  const dadi = { id: 'c2', name: 'दादी', role: 'mentor', gender: 'female', age: 'elder', appearance: 'Indian grandmother, 70, round face, grey hair in a bun, wrinkles, wheat skin, maroon cotton saree with a gold border, thin gold bangles', personality: 'gentle and wise' };
  const beat = (from, to, act, move) => ({ from, to, act, move });
  const shot = (o) => ({ narration: '', dialogue: [], camera: 'drift', ambience: 'none', hold: 0, motion: 0.6, sceneOf: 0, ...o });
  return {
    title: 'Motion test', logline: 'Four short shots that test real character motion.', genre: 'drama', mood: 'joyful', language: 'Hindi',
    setting: 'a sunny Rajasthani village, mud houses, a courtyard with a neem tree', characters: [meera, dadi],
    scenes: [
      shot({ title: 'Walk', characters: ['c1'], shot: 'wide', camera: 'track-right', ambience: 'birds', sceneOf: 0,
        visual: 'Wide side view of the young woman in the mustard kurta walking along a sunny village lane between mud houses, full body visible from head to feet, mid-stride',
        beats: [beat(0, 1, 'the young woman in the mustard kurta walks steadily from left to right along the lane, full body in view', 'walk')] }),
      shot({ title: 'Writing', characters: ['c1'], shot: 'medium', camera: 'push-in', ambience: 'clock', sceneOf: 1,
        visual: 'Three-quarter medium shot of the young woman in the mustard kurta sitting at a wooden table, writing in an open notebook with a blue pen in her right hand',
        beats: [beat(0, 0.7, 'she writes in the notebook, the pen moving across the page in her right hand', 'hold'), beat(0.7, 1, 'she looks up from the notebook and smiles', 'look')] }),
      shot({ title: 'Conversation', characters: ['c1', 'c2'], shot: 'close-up', camera: 'drift', ambience: 'birds', sceneOf: 2,
        visual: 'Three-quarter close-up of the grandmother in the maroon saree talking to the young woman beside her in the courtyard, face and mouth clearly visible',
        dialogue: [{ character: 'c2', line: 'बेटी, मेहनत का फल हमेशा मीठा होता है।' }],
        beats: [beat(0, 1, 'the grandmother speaks warmly to the young woman, lips moving, one hand gesturing gently', 'talk')] }),
      shot({ title: 'Hand-over', characters: ['c1', 'c2'], shot: 'medium', camera: 'orbit', ambience: 'birds', sceneOf: 2,
        visual: 'Medium side shot of the young woman in the mustard kurta handing a folded embroidered cloth to the grandmother in the maroon saree under a neem tree',
        beats: [beat(0, 0.6, 'the young woman holds out the folded cloth with both hands', 'give'), beat(0.6, 1, 'the grandmother takes it with both hands and smiles', 'give')] })
    ]
  };
}
$('#btnMotionTest').onclick = () => {
  if (!relayHasMotion()) { toast('The free GPU is not available on this site right now.', true); return; }
  if (!confirm('Make a 4-shot motion test on the free GPU? It takes about 20-30 minutes; keep this tab open.')) return;
  autoRender = true;
  runJob(async signal => {
    newProject();
    Object.assign(P, motionTestFilm(), { options: { ...P.options, format: '16:9', length: 'shorts', language: 'Hindi', motion: 'full' }, shotMode: true });
    P.scenes.forEach(sc => { sc.action = beatsSentence(sc.beats); });
    readOptionsToUI(); renderAll(); save();
    let job = await startGpu('test', 1, { quietBusy: true });
    if (!job && gpuBusy) job = await waitForGpu('test', 1, signal);
    if (!job) throw new Error('The free GPU could not start; try again later.');
    try {
      goStep('characters'); await doPortraits(signal);
      goStep('scenes'); await doVisuals(signal);
      readSoundOptions(); await doVoices(signal);
      await waitMotion(sendToGpu(signal, job, P.scenes.map((_, i) => i)));
      await doMix(signal);
      job = null;
      goStep('film');
    } finally { if (job) relay('cancel', { job }).catch(() => {}); }
  }).then(ok => { if (!ok) autoRender = false; });
};

// ============ AI Director ============
// A chat that edits the film at any stage, also after the MP4 is made: the free writer
// answers with actions (director.js checks them). Quick edits run at once, even while
// another step runs; the rest wait for it. After an edit a rendered film is marked older
// (it stays to watch and download) and rendered again. Each edit can be undone.
const has = {
  image: i => !!P.images['scene-' + i], video: i => !!P.videos?.['scene-' + i],
  info: i => {
    const v = P.credits['video-' + i];
    if (!P.videos?.['scene-' + i] || !v) return '';
    return `${v.stock ? 'stock footage' : v.job ? 'AI motion' : v.model || 'imported clip'} ${(+v.duration || 0).toFixed(1)}s clip${areaNote(i) ? ` (${areaNote(i)})` : ''}`;
  },
  cast: c => `voice ${voiceName(P.language, c)}${c.perf?.text ? ` (${String(c.perf.text).slice(0, 30)})` : ''}`,
  rendered: () => (lastRender ? (video === lastRender ? 'MP4 rendered, up to date' : 'MP4 rendered, older than the latest edits') : 'MP4 not rendered yet')
    + allowanceLines().map(l => ' · ' + l).join('')
};
const DIR_HINTS = ['Give the whole film a sepia documentary look', 'Add an opening disclaimer and a chapter card “Chapter 1”', 'Show a map of the journey after shot 2',
  'Make shot 3 a black-and-white flashback seen through a keyhole', 'Slow shot 2 to half speed', 'Insert real stock footage of a busy old market after shot 1',
  'Add a new character: a wise old boatman', 'Write Google Flow prompts for shots 2 and 3', 'Kling prompts for shot 4', 'Export the film for YouTube Create', 'Undo the last change'];
function openDirector(open = true) {
  $('#director').hidden = !open;
  $('#btnDirector').classList.toggle('on', open);
  if (open) { renderChat(); $('#dirInput').focus(); checkAllowance().then(() => renderChat()).catch(() => {}); }
}
$('#btnDirector').onclick = () => openDirector($('#director').hidden);
$('#dirClose').onclick = () => openDirector(false);
let dirNote = '';
function renderChat(status) {
  if (status !== undefined) dirNote = status;
  const log = P?.chat || [];
  const pickLabel = (m, k) => {
    const pk = m.pick;
    if (!pk || pk.used) return '';
    const text = pk.mode === 'insert' ? `📂 Choose a video to insert after shot ${pk.after + 1}` : pk.mode === 'pip' ? `📂 Choose the clip for the corner of shot ${pk.shot + 1}`
      : `🎞 Bring back my ${toolOf(pk.tool || 'flow').name} clip${pk.shots.length > 1 ? 's' : ''} for shot${pk.shots.length > 1 ? 's' : ''} ${pk.shots.map(s => s + 1).join(', ')}`;
    return `<label class="btn btn-primary btn-sm dir-pick">${text}<input type="file" class="dir-file" data-turn="${k}" accept="video/*,.mp4,.webm,.mov"${pk.mode === 'flow' ? ' multiple' : ''} hidden></label>`
      + (pk.mode === 'flow' ? '<p class="tiny muted">Name each clip with its shot number (e.g. 03.mp4); without numbers they are used in file-name order.</p>' : '');
  };
  const prompts = m => (m.handoff?.items?.length ? promptCards(m.handoff.tool, m.handoff.items) : m.prompts?.length ? promptCards('flow', m.prompts) : '')
    + (m.pack ? '<button type="button" class="btn btn-primary btn-sm ho-pack">📦 Download the editing pack (.zip)</button>' : '');
  $('#dirLog').innerHTML = (log.length ? '' : `<p class="dir-msg ai">Hi! I'm your AI Director. I can edit “${esc(P?.title || 'your film')}” at any stage, even after the MP4 is made (it renders again by itself): lines, pictures, colour looks, trims, speed, freeze frames, crops, transitions, picture-in-picture, blurring text or logos, chapter, title and disclaimer cards, animated maps, stock footage or your own clips, new characters and pictures, prompts for Google Flow, Kling, Hailuo and other free AI video tools, an editing pack for YouTube Create, a Short or a translation. Say “undo” to take back a change.</p>`)
    + log.map((m, k) => `<div class="dir-msg ${m.role === 'user' ? 'me' : 'ai'}">${esc(m.content)}${m.done?.length ? `<ul class="dir-done">${m.done.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}${prompts(m)}${pickLabel(m, k)}</div>`).join('')
    + (dirBusy && dirNote ? `<p class="dir-msg ai dir-thinking">${esc(dirNote)}</p>` : '')
    + allowanceLines().map(l => `<p class="dir-allow">⏳ ${esc(l)}</p>`).join('');
  $('#dirChips').innerHTML = log.length > 2 ? '' : DIR_HINTS.map(h => `<button type="button" class="chip">${esc(h)}</button>`).join('');
  $('#dirLog').scrollTop = $('#dirLog').scrollHeight;
}
$('#dirChips').addEventListener('click', e => { const c = e.target.closest('.chip'); if (c) { $('#dirInput').value = c.textContent; $('#dirInput').focus(); } });
$('#dirInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#dirForm').requestSubmit(); } });
$('#dirForm').addEventListener('submit', e => { e.preventDefault(); sendDirector($('#dirInput').value.trim()); });
// (copy, start-frame and pack buttons: see "make clips elsewhere" below)
$('#dirLog').addEventListener('change', e => {
  const inp = e.target.closest('.dir-file'); if (!inp?.files?.length) return;
  const turn = P.chat[+inp.dataset.turn], files = [...inp.files];
  inp.value = '';
  if (turn?.pick && !turn.pick.used) useDirectorFiles(turn, files);
});
const cut = (s, n) => (s = String(s || ''), s.length > n ? s.slice(0, n - 1) + '…' : s);
const until = async ok => { while (!ok()) await new Promise(r => setTimeout(r, 120)); };

async function sendDirector(msg) {
  if (!msg) return;
  if (!P?.scenes?.length) { toast('Write the story first, then the AI Director can edit it.'); return; }
  if (dirBusy) { toast('The AI Director is still on your last message.'); return; }
  dirBusy = true;
  // the film this message is about (a new film may be opened while the Director thinks)
  const film = P;
  P.chat = [...(P.chat || []), { role: 'user', content: msg }].slice(-30);
  $('#dirInput').value = ''; renderChat('Thinking…');
  const turn = { role: 'assistant', content: '', done: [] };
  try {
    // refused (unsafe) exchanges stay out of the history: the relay screens it too, and one
    // refused message would otherwise block the next requests as well
    const history = P.chat.slice(0, -1).filter(m => !m.blocked);
    const r = await askDirector(P, has, history, msg, { onStatus: d => renderChat(d) });
    // another film was opened while the Director thought: its edits are not made on that one
    if (P !== film) { turn.content = r.reply; turn.done.push('⚠ Not applied: another film was opened meanwhile. Open this film again and ask once more.'); film.chat.push(turn); return; }
    turn.content = r.reply; P.chat.push(turn); renderChat('Working on it…'); save();
    await applyDirector(r.actions, turn, msg);
  } catch (e) {
    console.error(e);
    if (e.unsafe) { const mine = [...(film.chat || [])].reverse().find(m => m.role === 'user' && m.content === msg); if (mine) mine.blocked = true; }
    if (film.chat?.includes(turn)) turn.done.push('⚠ ' + (e.message || 'Something went wrong.'));
    // a safety refusal is final: no "try again"
    else (film.chat ||= []).push({ role: 'assistant', ...(e.unsafe ? { blocked: true } : {}), content: e.unsafe ? `I can't make that. ${e.message || 'VoiceFrame makes family-friendly films only.'}` : `Sorry, that did not work (${e.message || 'error'}). Please try again.` });
  } finally { dirBusy = false; renderChat(''); save(); setTimeout(afterJob); }
}

// ---- edit history: "undo the last change" ----
function snapshot(label) {
  return { label, pid: P.id, scenes: structuredClone(P.scenes), characters: structuredClone(P.characters), film: structuredClone(P.film || {}),
    look: { ...P.look }, moodOverride: P.moodOverride, musicVol: P.musicVol, casting: P.casting ? structuredClone(P.casting) : undefined,
    images: { ...P.images }, videos: { ...(P.videos || {}) }, credits: structuredClone(P.credits) };
}
function pushUndo(label) { undoStack.push(snapshot(label)); while (undoStack.length > 12) undoStack.shift(); }
function undoLast(done) {
  const s = undoStack.pop();
  if (!s || s.pid !== P.id) { done.push('Nothing to undo yet'); return false; }
  const { label, pid, ...rest } = s;
  Object.assign(P, rest);
  sceneAudio = null; timeline = null; mixBuf = null; video = null; media.clear(); picked.clear();
  readOptionsToUI(); renderAll();
  done.push(`Undone: ${label}`);
  return true;
}

// Carry out a reply: now, or (all but the quick edits) when the running step ends.
async function applyDirector(actions, turn, msg) {
  if (!actions.length) return;
  // an undo changes the film too (it takes no undo step of its own, but is rendered again)
  const changes = actions.some(a => !NO_CHANGE.has(a.do) || a.do === 'undo');
  // a render in progress is stopped: the film is rendered again with the edit
  if (job && renderJob && changes) { job.abort(); await until(() => !job); }
  if (job) {
    const now = actions.filter(a => QUICK.has(a.do)), later = actions.filter(a => !QUICK.has(a.do));
    const nowChanges = now.some(a => !NO_CHANGE.has(a.do));
    if (now.length) { if (nowChanges) pushUndo(cut(msg, 60)); await directorActions(now, null, turn); }
    if (later.length) {
      deferred.push({ actions: later, turn, msg });
      turn.done.push(`After the current step: ${[...new Set(later.map(a => a.do.replace(/_/g, ' ')))].join(', ')}`);
    }
    if (nowChanges) edited();
    return;
  }
  let long = null;
  const ok = await runJob(async signal => {
    if (changes && actions.some(a => a.do !== 'undo')) pushUndo(cut(msg, 60));
    long = await directorActions(actions, signal, turn);
  });
  renderChat();
  if (!ok) turn.done.push('⚠ Stopped before every change was made (say “undo” to go back)');
  if (long) { runLong(long); return; }
  if (changes) edited();
}
// After an edit: the storyboard and preview follow; a film that was rendered is rendered again.
function edited() {
  renderScenes(); updateStepper();
  if (lastRender) { staleDownload(); rerender(); }
  else if (!$('[data-panel=film]').hidden) enterFilm().catch(error => toast(error.message, true, 10000));
}
function rerender() {
  if (job || dirBusy) { rerenderWanted = true; return; }
  rerenderWanted = false;
  if (video) return;
  if (!$('[data-panel=film]').hidden) { if (autoRender) return; autoRender = true; enterFilm().catch(error => toast(error.message, true, 10000)); }
  else renderFull();
}
// When a step ends: the edits that waited for it, then a new render if one is due.
async function afterJob() {
  if (job || dirBusy || !P) return;
  if (deferred.length) {
    const d = deferred.shift();
    let long = null;
    // (an undo step only for actions that change the film: "undo" after an export pack
    // undid nothing, while the edit before it stayed)
    await runJob(async signal => { if (d.actions.some(a => !NO_CHANGE.has(a.do))) pushUndo(cut(d.msg, 60)); long = await directorActions(d.actions, signal, d.turn); });
    renderChat(); save();
    if (long) runLong(long); else edited();
    return;
  }
  if (rerenderWanted) rerender();
}

// A file the person picked from the Director's prompt: a clip to insert, a picture-in-picture
// clip, or clips made in Google Flow for some shots.
async function useDirectorFiles(turn, files) {
  const pk = turn.pick;
  if (job && renderJob) { job.abort(); await until(() => !job); }
  if (job) { toast('Still working on the last step. Pick the file again when it finishes.'); return; }
  const ok = await runJob(async signal => {
    pushUndo(pk.mode === 'flow' ? 'clips made elsewhere' : 'your clip');
    if (pk.mode === 'insert') {
      const file = files[0];
      setStatus('Bringing in your clip…', file.name);
      await readImportedClip(file, signal); // an unreadable file stops here, before anything changes
      await checkVideo(file); // and so does one the safety check blocks or can't check
      const at = Math.min(pk.after, P.scenes.length - 1), base = Math.max(0, at);
      const o = indexes(); o.splice(at + 1, 0, -1);
      reshuffle(o, [{ ...newShotAfter(base), title: file.name.replace(/\.[^.]+$/, '').slice(0, 40), visual: '', characters: [], dialogue: [], narration: '', sceneOf: 'u' + Math.random().toString(36).slice(2, 8) }]);
      const k = at + 1;
      await attachClip(k, file, 'Your video', signal);
      if (P.scenes[k].clipSound) P.scenes[k].clipVol = (pk.volume ?? 70) / 100;
      turn.done.push(`Your clip “${file.name}” is now shot ${k + 1}${P.scenes[k].clipSound ? ` with its own sound at ${pk.volume ?? 70}%` : ''}`);
    } else if (pk.mode === 'pip') {
      const file = files[0];
      await readImportedClip(file, signal);
      await checkVideo(file);
      const sc = P.scenes[pk.shot];
      if (!sc) throw new Error('That shot is gone.');
      dropPip(sc);
      const key = 'pip-' + Math.random().toString(36).slice(2, 10);
      P.videos[key] = file;
      sc.pip = { key, from: 'your clip', pos: pk.pos || 'tr', size: pk.size || 0.3 };
      turn.done.push(`Your clip plays in the corner of shot ${pk.shot + 1}`);
    } else {
      const got = await bringBackClips(files, pk.shots, toolOf(pk.tool || 'flow').name, signal);
      turn.done.push(`${got.length} clip${got.length === 1 ? '' : 's'} from ${toolOf(pk.tool || 'flow').name} in shot${got.length === 1 ? '' : 's'} ${got.map(k => k + 1).join(', ')}`);
    }
    pk.used = true;
    sceneAudio = null; timeline = null; mixBuf = null; video = null; media.clear();
    save();
  });
  renderChat();
  if (ok) edited();
}

// A picture-in-picture's own copy of its picture or clip (kept until nothing shows it).
function dropPip(sc) {
  const key = sc.pip?.key;
  delete sc.pip;
  if (!key || P.scenes.some(s => s.pip?.key === key)) return;
  delete P.images[key]; if (P.videos) delete P.videos[key];
}
const cardShot = (card, len) => ({ title: '', card, ...(len ? { len } : {}), narration: '', dialogue: [], characters: [], visual: '', action: '', shot: 'wide', camera: 'push-in',
  ambience: 'none', hold: 0, sceneOf: 'c' + Math.random().toString(36).slice(2, 8) });
const mapShotOf = (map, len, narration) => { const s = cardShot(null, len); delete s.card; return { ...s, map, narration: narration || '' }; };
const clipDur = k => P.videos?.['scene-' + k] ? +P.credits['video-' + k]?.duration || 0 : 0;
const STRUCT = new Set(['insert_shot', 'delete_shot', 'move_shot', 'split', 'chapter_card', 'title_card', 'disclaimer_card', 'map_shot', 'insert_clip', 'generate_image']);

// Carry out the actions; returns the long job to start afterwards, if any.
async function directorActions(actions, signal, turn) {
  const done = turn.done;
  let voice = false, sound = false, look = false, retime = false, repaint = new Set();
  const N = k => `shot ${k + 1}`, Ns = s => `shot${s.length > 1 ? 's' : ''} ${s.map(k => k + 1).join(', ')}`;
  const portraits = [], stockTodo = [], recast = new Set();
  for (const a of actions) {
    const sc = P.scenes[a.shot];
    switch (a.do) {
      case 'set_line': {
        const L = a.line || 0;
        if (!a.text) { if (sc.dialogue?.[L]) sc.dialogue.splice(L, 1); }
        else if (sc.dialogue?.[L]) { sc.dialogue[L].line = a.text; if (a.speaker) sc.dialogue[L].character = a.speaker; }
        else (sc.dialogue ||= []).push({ character: a.speaker || sc.characters?.[0] || P.characters[0]?.id, line: a.text });
        const d = a.text && sc.dialogue[Math.min(L, sc.dialogue.length - 1)];
        if (d && a.delivery !== undefined) { if (a.delivery) d.delivery = a.delivery; else delete d.delivery; }
        if (has.video(a.shot) && a.text) { sc.lipStale = true; picked.add(a.shot); }
        voice = true; done.push(`New line for ${N(a.shot)}${d?.delivery ? ` (${d.delivery})` : ''}`); break;
      }
      case 'set_delivery':
        if (a.line < 0) { if (a.delivery) sc.narrDelivery = a.delivery; else delete sc.narrDelivery; }
        else if (sc.dialogue?.[a.line]) { if (a.delivery) sc.dialogue[a.line].delivery = a.delivery; else delete sc.dialogue[a.line].delivery; }
        voice = true; done.push(`${a.line < 0 ? 'Narration' : `Line ${a.line + 1}`} of ${N(a.shot)}: ${a.delivery || 'natural'} delivery (only that line is voiced again)`); break;
      case 'set_voice': {
        const c = a.character === 'narrator' ? null : P.characters.find(x => x.id === a.character);
        const v = matchVoice(P.language, a.voice, c ? c.gender : undefined);
        if (!v) { done.push(`No ${P.language} voice matches “${a.voice}”`); break; }
        if (!c) {
          if (v.studio || v.mine) { done.push('The narrator keeps an on-device voice here (studio voices: 🎭 Studio voices)'); break; }
          P.narrator = v.id; fillNarrators(); voice = true; done.push(`Narrator voice: ${v.name} (${v.desc})`); break;
        }
        setVoice(P, c, v.mine ? { useMine: true, voice: c.voice, perf: c.perf } : v.studio ? { studioVoice: v.id.slice(7), voice: c.voice, perf: c.perf } : { voice: v.id, perf: c.perf });
        voice = true; done.push(`${c.name}'s voice: ${v.studio ? 'Studio · ' : ''}${v.name} (${v.desc})`); break;
      }
      case 'set_outfit': {
        const c = P.characters.find(x => x.id === a.character);
        ensureFields(c);
        const q = a.outfit.toLowerCase();
        const o = outfitById(a.outfit) || OUTFITS.find(x => x.name.toLowerCase() === q) || outfitFromText(a.outfit, c) || OUTFITS.find(x => q.includes(x.name.toLowerCase()));
        let choice;
        if (o && allowed(o, c)) choice = { id: o.id, colour: '', fabric: '', text: '' };
        else if (o) { done.push(`“${o.name}” is not for ${c.name} (${ageOf(c)} years old): their outfit stays`); break; }
        else { const issue = outfitIssue(a.outfit, c); if (issue) { done.push(issue); break; } choice = { id: 'custom', colour: '', fabric: '', text: a.outfit }; }
        c.wardrobe ||= [];
        let w = c.wardrobe.find(x => x.id === choice.id && (x.text || '') === (choice.text || ''));
        if (!w) { w = { wid: 'w' + Date.now().toString(36) + c.wardrobe.length, label: (o ? o.name : a.outfit).slice(0, 30), ...choice }; c.wardrobe.push(w); }
        if (a.shots.length) {
          a.shots.forEach(k => { (P.scenes[k].outfits ||= {})[c.id] = w.wid; if (needsPicture(k) && (P.scenes[k].characters || []).includes(c.id)) repaint.add(k); });
          done.push(`${c.name} wears ${outfitLabel(w)} in ${Ns(a.shots)}`);
        } else { c.outfit = choice; done.push(`${c.name}'s main outfit: ${outfitLabel(choice)} (repaint their shots to show it)`); }
        break;
      }
      case 'set_narration': sc.narration = a.text; voice = true; done.push(`Narration of ${N(a.shot)} ${a.text ? 'changed' : 'removed'}`); break;
      case 'set_visual': if (drawnShot(sc)) break; sc.visual = a.text; delete sc.baseVisual; delete sc.magic; if (a.repaint) repaint.add(a.shot); done.push(`New picture description for ${N(a.shot)}`); break;
      case 'set_action': sc.action = a.text; done.push(`New action for ${N(a.shot)}`); break;
      case 'set_camera': sc.camera = a.camera; look = true; done.push(`Camera ${a.camera} on ${N(a.shot)}`); break;
      case 'set_ambience': sc.ambience = a.ambience; sound = true; done.push(`Sound “${a.ambience}” on ${N(a.shot)}`); break;
      case 'set_title':
        if (a.text) sc.text = { text: a.text, style: a.style }; else delete sc.text;
        look = true; done.push(a.text ? `Text “${a.text}” on ${N(a.shot)}` : `Text removed from ${N(a.shot)}`); break;
      case 'hold': sc.hold = a.seconds; retime = true; done.push(`${N(a.shot)} held +${a.seconds}s`); break;
      case 'set_expression': a.shots.forEach(k => { P.scenes[k].expr = a.expression; }); look = true; done.push(`Face ${a.expression} on ${Ns(a.shots)}`); break;
      case 'set_motion': a.shots.forEach(k => { P.scenes[k].motion = a.amount / 100; }); look = true; done.push(`Motion ${a.amount} on ${Ns(a.shots)}`); break;
      case 'magic_edit': {
        const s = a.shots.filter(needsPicture);
        s.forEach(k => { applyMagic(k, a.look, a.backdrop); repaint.add(k); });
        if (s.length) { sound = true; done.push(`${MAGIC[a.look].label.replace('…', '')} look on ${Ns(s)}`); }
        break;
      }
      case 'repaint': a.shots.filter(needsPicture).forEach(k => repaint.add(k)); break;
      case 'set_captions': P.look = { ...P.look, captions: a.style }; $('#optCaptions').value = a.style; look = true; done.push(`Captions: ${a.style}`); break;
      case 'set_music':
        if (a.mood) { P.moodOverride = a.mood; $('#optMood').value = a.mood; }
        if (a.volume != null) { P.musicVol = a.volume / 100; $('#optMusicVol').value = a.volume; }
        sound = true; done.push(`Music${a.mood ? ' ' + a.mood : ''}${a.volume != null ? ` at ${a.volume}%` : ''}`); break;
      // ---- clip editing: fields the renderer applies when it draws ----
      case 'trim': {
        const D = clipDur(a.shot);
        if (!D) { done.push(`${N(a.shot)} is a picture, not a clip: its length follows its line (try “hold” or “freeze”)`); break; }
        const o = Math.min(D, a.out ?? D), i = Math.min(a.in, o - 0.3);
        if (i <= 0.01 && o >= D - 0.01) delete sc.trim; else sc.trim = [Math.max(0, +i.toFixed(2)), +o.toFixed(2)];
        voice = true; done.push(sc.trim ? `${N(a.shot)} trimmed to ${sc.trim[0]}-${sc.trim[1]} s of its ${D.toFixed(1)} s clip` : `${N(a.shot)} plays its whole clip again`); break;
      }
      case 'speed': a.shots.forEach(k => { if (a.rate === 1) delete P.scenes[k].speed; else P.scenes[k].speed = a.rate; }); voice = true; done.push(`${Ns(a.shots)} at ${a.rate}x speed`); break;
      case 'reverse': a.shots.forEach(k => { if (a.on) P.scenes[k].reverse = true; else delete P.scenes[k].reverse; }); look = true; done.push(`${Ns(a.shots)} ${a.on ? 'play backwards' : 'play forwards'}`); break;
      case 'freeze':
        if (!a.seconds) delete sc.freeze; else sc.freeze = { at: a.at, dur: a.seconds };
        retime = true; done.push(a.seconds ? `${N(a.shot)} freezes for ${a.seconds} s at ${a.at} s` : `Freeze frame removed from ${N(a.shot)}`); break;
      case 'reframe':
        if (a.reset) delete sc.crop; else sc.crop = a.crop;
        look = true; done.push(a.reset ? `${N(a.shot)} shows its whole picture again` : `${N(a.shot)} reframed (${Math.round(1 / Math.max(a.crop.w, a.crop.h) * 10) / 10}x zoom)`); break;
      case 'set_grade':
        if (!a.shots) { P.film = { ...P.film }; if (a.grade === 'auto') delete P.film.grade; else P.film.grade = a.grade; done.push(`Whole film: ${GRADE_NAMES[a.grade]}`); }
        else { a.shots.forEach(k => { if (a.grade === 'auto') delete P.scenes[k].grade; else P.scenes[k].grade = a.grade; }); done.push(`${GRADE_NAMES[a.grade]} on ${Ns(a.shots)}`); }
        look = true; break;
      case 'keyhole': a.shots.forEach(k => { if (a.shape === 'none') delete P.scenes[k].keyhole; else P.scenes[k].keyhole = a.shape; }); look = true; done.push(a.shape === 'none' ? `Mask removed from ${Ns(a.shots)}` : `${Ns(a.shots)} seen through a ${a.shape}`); break;
      case 'blur_region':
        if (a.clear) delete sc.blur; else sc.blur = [...(sc.blur || []), a.box].slice(-6);
        look = true; done.push(a.clear ? `Hidden regions cleared on ${N(a.shot)}` : `${a.box.mode === 'hide' ? 'Hid' : a.box.mode === 'pixelate' ? 'Pixelated' : 'Blurred'} a region of ${N(a.shot)}`); break;
      case 'set_transition': a.shots.forEach(k => { if (a.kind === 'auto') delete P.scenes[k].trans; else P.scenes[k].trans = a.kind; }); look = true; done.push(`${a.kind === 'auto' ? 'Automatic' : cap(a.kind)} cut into ${Ns(a.shots)}`); break;
      case 'pip': {
        if (a.off) { dropPip(sc); look = true; done.push(`Picture-in-picture removed from ${N(a.shot)}`); break; }
        if (a.source === 'file') { turn.pick = { mode: 'pip', shot: a.shot, pos: a.pos, size: a.size }; done.push('Choose the clip for the corner with the button below'); break; }
        const blob = P.videos?.['scene-' + a.source] || P.images['scene-' + a.source];
        if (!blob) { done.push(`Shot ${a.source + 1} has no picture yet for the corner`); break; }
        dropPip(sc);
        const key = 'pip-' + Math.random().toString(36).slice(2, 10);
        (P.videos?.['scene-' + a.source] ? (P.videos ||= {}) : P.images)[key] = blob;
        sc.pip = { key, from: `shot ${a.source + 1}`, pos: a.pos, size: a.size };
        look = true; done.push(`Shot ${a.source + 1} plays in the ${{ tr: 'top-right', tl: 'top-left', br: 'bottom-right', bl: 'bottom-left' }[a.pos]} corner of ${N(a.shot)}`); break;
      }
      case 'set_particles': a.shots.forEach(k => { if (a.kind === 'auto') delete P.scenes[k].particles; else P.scenes[k].particles = a.kind; }); look = true; done.push(`Particles “${a.kind}” on ${Ns(a.shots)}`); break;
      case 'mix_audio': {
        // (a clip inserted in the same reply carries its own volume)
        if (!P.videos?.['scene-' + a.shot]) { if (!actions.some(x => x.do === 'insert_clip')) done.push(`${N(a.shot)} has no clip with its own sound`); break; }
        if (sc.clipSound) sc.clipVol = a.volume / 100;
        else if (a.volume > 0) { sc.clipMix = a.volume / 100; sc.duck = a.duck; } else { delete sc.clipMix; delete sc.duck; }
        voice = true; done.push(a.volume ? `${N(a.shot)}: the clip's own sound at ${a.volume}%${!sc.clipSound && a.duck ? ', quieter under speech' : ''}` : `${N(a.shot)}: the clip's own sound muted`); break;
      }
      // ---- clips from elsewhere ----
      case 'insert_clip': if (a.from === 'file') { turn.pick = { mode: 'insert', after: a.after, volume: a.volume }; done.push('Choose the video file with the button below'); } break;
      case 'swap_stock': stockTodo.push({ k: a.shot, query: a.query, swap: true }); break;
      // ---- generators ----
      case 'new_character': {
        let n = P.characters.length + 1; while (P.characters.some(c => c.id === 'c' + n)) n++;
        const c = ensureFields({ id: 'c' + n, name: a.name, role: a.role, gender: /^f/i.test(a.gender) ? 'female' : /^m/i.test(a.gender) ? 'male' : 'other', age: a.age, appearance: a.description, personality: a.personality || '', casting: a.description, generated: true });
        P.characters.push(c); portraits.push(c.id);
        a.shots.forEach(k => { const s = P.scenes[k]; if (needsPicture(k) && !s.characters?.includes(c.id)) (s.characters ||= []).push(c.id); });
        done.push(`New cast member ${c.name} (${c.id})${a.shots.length ? ` in ${Ns(a.shots)}` : ''}`); break;
      }
      case 'generate_image': if (a.shot != null && needsPicture(a.shot)) { sc.visual = a.prompt; delete sc.baseVisual; delete sc.magic; repaint.add(a.shot); } break;
      case 'recast': {
        const c = P.characters.find(x => x.id === a.character);
        if (a.description) { c.appearance = a.description; c.casting = a.description; }
        delete P.images['char-' + c.id]; delete P.credits['char-' + c.id]; triedPortraits.delete(c.id);
        portraits.push(c.id); recast.add(c.id); break;
      }
      case 'handoff': {
        const T = toolOf(a.tool), items = handoffItems(T.id, a.shots);
        if (!items.length) { done.push('Those shots are cards or maps: nothing to make elsewhere'); break; }
        turn.handoff = { tool: T.id, items };
        turn.pick = { mode: 'flow', tool: T.id, shots: items.map(p => p.shot - 1) };
        done.push(`${T.name} prompts for ${items.length} shot${items.length > 1 ? 's' : ''} (${T.note}): copy each into ${T.name}, add the start frame, save each clip as its shot number (e.g. ${pad(items[0].shot)}.mp4), then bring them back below`);
        break;
      }
      case 'export_pack': turn.pack = true; done.push('Your editing pack for YouTube Create or any editor: the MP4, subtitles, voice and music tracks and each shot, numbered'); break;
      case 'fill_frame': {
        const s = a.shots.filter(k => P.videos?.['scene-' + k]);
        for (const k of s) {
          if (!P.credits['video-' + k]?.area && signal) await frameClip(k, P.videos['scene-' + k]).catch(() => null);
          if (a.mode === 'fill') delete P.scenes[k].fill; else P.scenes[k].fill = a.mode;
        }
        if (s.length) { look = true; done.push(`${Ns(s)}: ${{ fill: 'fills the frame (bars cropped, people kept in view)', fit: 'shows the whole picture', 'blur-fill': 'whole picture over a blurred copy' }[a.mode]}`); }
        else done.push('Those shots have no clip (pictures are painted to the frame already)');
        break;
      }
      case 'best_part': {
        for (const k of a.shots) {
          if (!P.videos?.['scene-' + k]) { done.push(`${N(k)} has no clip`); continue; }
          if (!signal) continue;
          setStatus('AI Director: finding the best part…', `Shot ${k + 1}: frames checked by AI vision`);
          const tr = await bestPart(k, signal);
          done.push(tr ? `${N(k)} plays its best part, ${tr[0]}-${tr[1]} s` : `${N(k)}'s clip is no longer than the shot`);
        }
        voice = true; break;
      }
      case 'undo': if (undoLast(done)) voice = true; break;
    }
  }
  // inserts, deletes, moves, splits, cards, maps and clips, all by the shot numbers the director saw
  const struct = actions.filter(a => STRUCT.has(a.do) && (a.do !== 'insert_clip' || a.from !== 'file') && (a.do !== 'generate_image' || a.after !== undefined));
  if (struct.length) {
    const toks = P.scenes.map((_, k) => ({ old: k }));
    const pos = old => toks.findIndex(t => t.old === old && !t.copy);
    const put = (after, tok) => { const p = after < 0 ? -1 : pos(after); toks.splice(p < 0 && after >= 0 ? toks.length : p + 1, 0, tok); };
    const n = {};
    const count = (what, k = 1) => { n[what] = (n[what] || 0) + k; };
    for (const a of struct) {
      if (a.do === 'delete_shot') a.shots.forEach(k => { const p = pos(k); if (p >= 0 && toks.length > 1) { toks.splice(p, 1); count('deleted'); } });
      if (a.do === 'insert_shot' || a.do === 'generate_image') {
        const base = Math.max(0, a.after), shot = { ...newShotAfter(base), visual: a.visual || a.prompt, action: a.action || '', narration: a.narration || '',
          dialogue: a.line ? [{ character: a.speaker, line: a.line }] : [] };
        if (a.line && a.speaker && !shot.characters.includes(a.speaker)) shot.characters.push(a.speaker);
        put(a.after, { shot, paint: true }); count('new');
      }
      if (a.do === 'move_shot') { const p = pos(a.shot); if (p >= 0) { const [t] = toks.splice(p, 1); toks.splice(Math.min(a.to, toks.length), 0, t); count('moved'); } }
      if (a.do === 'split') {
        const p = pos(a.shot); if (p < 0) continue;
        const D = clipDur(a.shot), sc = P.scenes[a.shot];
        if (D) {
          const i0 = sc.trim?.[0] || 0, o0 = sc.trim?.[1] || D, at = Math.min(o0 - 0.3, i0 + a.at * (sc.speed || 1));
          if (at <= i0 + 0.2) { done.push(`${N(a.shot)} is too short to split at ${a.at} s`); continue; }
          toks[p].patch = { ...toks[p].patch, trim: [i0, +at.toFixed(2)] };
          toks.splice(p + 1, 0, { old: a.shot, copy: true, patch: { trim: [+at.toFixed(2), o0], dialogue: [], narration: '', text: undefined } });
        } else {
          // a picture: the second part is a silent cutaway on the same picture, with another camera move
          toks.splice(p + 1, 0, { old: a.shot, copy: true, patch: { dialogue: [], narration: '', text: undefined, camera: sc.camera === 'pull-out' ? 'push-in' : 'pull-out' } });
        }
        count('split');
      }
      if (a.do === 'chapter_card') { put(a.after, { shot: cardShot({ kind: 'chapter', title: a.title, num: a.num, label: a.label }, a.seconds) }); count('chapter card'); }
      if (a.do === 'title_card') { put(a.after, { shot: cardShot({ kind: 'title', title: a.title || P.title, sub: a.sub }, a.seconds) }); count('title card'); }
      if (a.do === 'disclaimer_card') {
        const first = toks[0]?.shot || P.scenes[toks[0]?.old];
        if (first?.card?.kind === 'disclaimer') toks[0].patch = { card: { kind: 'disclaimer', text: a.text, title: a.title } };
        else toks.unshift({ shot: cardShot({ kind: 'disclaimer', text: a.text, title: a.title }, a.seconds) });
        count('disclaimer card');
      }
      if (a.do === 'map_shot') { put(a.after, { shot: mapShotOf(a.map, a.seconds, a.narration) }); count('map'); }
      if (a.do === 'insert_clip' && a.from === 'stock') {
        const base = Math.max(0, a.after);
        put(a.after, { shot: { ...newShotAfter(base), title: 'Real footage', characters: [], dialogue: [], narration: '', visual: a.visual, stock: a.query, stockQueries: [a.query], era: a.era || undefined, source: 'stock' },
          stock: { volume: a.volume } });
        count('stock clip');
      }
      if (a.do === 'insert_clip' && a.from === 'shot') {
        const D = clipDur(a.shot), src = P.scenes[a.shot];
        const tr = D ? [Math.min(a.in ?? 0, D - 0.3), Math.min(D, a.out ?? D)] : null;
        put(a.after, { old: a.shot, copy: true, patch: { dialogue: [], narration: '', text: undefined, title: src.title, ...(tr && tr[1] > tr[0] + 0.2 ? { trim: tr } : {}) } });
        count('re-used clip');
      }
    }
    const order = toks.map(t => t.shot ? -1 : t.old), fresh = toks.filter(t => t.shot).map(t => t.shot);
    const rp = new Set(); toks.forEach((t, k) => { if ((t.shot && t.paint) || (!t.shot && repaint.has(t.old))) rp.add(k); }); repaint = rp;
    reshuffle(order, fresh);
    toks.forEach((t, k) => {
      if (t.patch) { Object.assign(P.scenes[k], t.patch); for (const [f, v] of Object.entries(t.patch)) if (v === undefined) delete P.scenes[k][f]; }
      if (t.copy) delete P.scenes[k].pip; // a copy shows its own picture only
      if (t.stock) stockTodo.push({ k, volume: t.stock.volume, inserted: true });
    });
    voice = true;
    const said = { new: 'new shot', deleted: 'shot deleted', moved: 'shot moved', split: 'shot split in two' };
    for (const [what, k] of Object.entries(n)) done.push(`${k} ${said[what] ? said[what].replace('shot', k > 1 ? 'shots' : 'shot') : what + (k > 1 ? 's' : '') + ' added'}`);
  }
  if (voice) { sceneAudio = null; timeline = null; mixBuf = null; }
  if (sound || retime) { timeline = null; mixBuf = null; }
  if (voice || sound || look || retime) video = null;
  renderScenes(); renderCast(); save();
  // new and recast characters: a casting portrait each (a person who does not exist)
  if (portraits.length && signal) {
    setStatus('AI Director: casting…', `${portraits.length} new portrait${portraits.length > 1 ? 's' : ''}`);
    await doPortraits(signal);
    portraits.forEach(id => { if (P.images['char-' + id]) done.push(`Casting portrait of ${P.characters.find(c => c.id === id)?.name} painted`); else done.push(`The painter was busy: use 🎨 on ${P.characters.find(c => c.id === id)?.name}'s card to try again`); });
    // a recast character's shots are painted again with the new face
    P.scenes.forEach((s, k) => { if ([...recast].some(id => s.characters?.includes(id)) && needsPicture(k) && P.credits['scene-' + k]?.kind !== 'user' && !P.credits['video-' + k]?.stock) repaint.add(k); });
  }
  // repaint, then the shots whose clips no longer match are ticked for 🎬 Re-animate
  let k = 0;
  let paint = [...repaint].filter(i => needsPicture(i)).sort((a, b) => a - b);
  // a spent painter is not asked again: those shots are handed off instead
  if (paint.length && signal && !(await painterLeft())) {
    turn.handoff = { tool: 'flow', items: handoffItems('flow', paint) };
    turn.pick = { mode: 'flow', tool: 'flow', shots: paint };
    done.push(`Not painted: ${allowanceLines().join('; ') || 'the free painters are out'}. Make ${Ns(paint)} with your own free credits in Google Flow, Kling or Hailuo below, or ask again later`);
    paint = [];
  }
  for (const i of signal ? paint : []) {
    setStatus('AI Director: painting…', `Shot ${i + 1} (${++k} of ${paint.length})`);
    await paintScene(i, signal, true);
    picked.add(i);
  }
  if (paint.length && signal) { done.push(`Painted ${Ns(paint)}`); renderScenes(); }
  // a shot painted without its cast's portraits: the cast painter's daily allowance is spent
  if (paint.some(i => P.credits['scene-' + i]?.unlocked)) spend('cast', 'used up today (shots painted without the cast portraits)', nextUtcMidnight());
  if (paintersOut()) spend('painter', 'all busy', Date.now() + 10 * 60000);
  // real footage: new stock shots and swapped clips, ranked by the AI vision check, load in
  // the background (two at a time) while the person goes on
  if (stockTodo.length) {
    footageLater(stockTodo.filter(t => P.scenes[t.k]).map(t => ({ ...t, sc: P.scenes[t.k], turn })));
    done.push(`Looking for free footage for ${Ns(stockTodo.map(t => t.k))} in the background (Wikimedia Commons, the Internet Archive, Pexels): the shot${stockTodo.length > 1 ? 's update' : ' updates'} when ${stockTodo.length > 1 ? 'they are' : 'it is'} ready`);
    stockTodo.length = 0;
  }
  for (const t of stockTodo.sort((a, b) => b.k - a.k)) {
    if (!signal) break;
    const s = P.scenes[t.k];
    if (!s) {
      motionNote = 'Cannot reach the GPU status service. Retrying; completed footage stays saved.';
      if (++statusFailures >= 10) { const error = new Error('GPU status is unavailable. Your run is saved. Use Collect clips in the storyboard to reconnect without starting another generation.'); error.resumable = true; throw error; }
      continue;
    }
    statusFailures = 0;
    if (t.query) { s.stockQueries = [t.query]; s.stock = t.query; }
    setStatus('AI Director: finding real footage…', `Shot ${t.k + 1}: free stock clips, checked by AI vision`);
    const ok = await realFootage(t.k, signal, { force: true, vision: true }).catch(e => { if (e instanceof Cancelled) throw e; console.warn('stock', e); return false; });
    if (ok) {
      s.source = 'stock';
      if (t.inserted) s.len = Math.min(8, Math.max(3, +P.credits['video-' + t.k]?.duration || 5));
      if (t.volume > 0) { s.clipMix = t.volume / 100; s.duck = true; }
      done.push(`${t.swap ? 'New' : 'Real'} footage for shot ${t.k + 1} (${P.credits['video-' + t.k]?.stock?.source || 'stock'}, credited at the end)`);
    } else if (t.inserted) {
      const o = indexes(); o.splice(t.k, 1); reshuffle(o);
      done.push(`No fitting free footage was found, so the stock shot was not added (try other words)`);
    } else done.push(`No other fitting free footage for shot ${t.k + 1}`);
    sceneAudio = null; timeline = null; mixBuf = null; video = null;
  }
  if (stockTodo.length) { renderScenes(); save(); }
  if (look && !voice && !sound && !retime && timeline) {
    P.scenes.forEach((sc, i) => { if (timeline.scenes[i]) timeline.scenes[i].text = sc.text?.text ? sc.text : null; });
    refreshPreview();
  }
  const long = actions.find(a => LONG.has(a.do));
  if (long?.do === 'gpu_fix' && struct.length) { done.push('Shots were added or moved, so start the GPU fix from the storyboard'); return null; }
  return long || null;
}
const GRADE_NAMES = { sepia: 'warm sepia-gold documentary look', 'teal-orange': 'teal-and-orange look', bw: 'black and white', warm: 'warm daylight look', cool: 'cool night look', none: 'natural colour (no grade)', auto: 'the mood’s own grade' };
function runLong(a) {
  if (a.do === 'gpu_fix') { picked.clear(); a.shots.forEach(i => picked.add(i)); renderScenes(); fixShots(a.kind); }
  if (a.do === 'make_short') $('#btnShort').click();
  if (a.do === 'resize') { $('#rsFormat').value = a.format; $('#btnResize').click(); }
  if (a.do === 'render') { autoRender = true; video = null; goStep('film'); }
  if (a.do === 'translate') {
    fillTranslateLangs();
    const lang = findLanguage(a.language)?.name;
    if (!lang || lang === (P.language || 'English')) { toast(`Translation into ${a.language} is not available. Pick a language from the Translate list (${LANGS.length} languages).`, true, 8000); return; }
    $('#trLang').value = lang; $('#btnTranslate').click();
  }
}

/// ============ make clips elsewhere ============
// Free AI video tools (Google Flow, Kling, Hailuo, PixVerse, Vidu, Luma, Pika, Meta AI) have
// no free public API, so VoiceFrame hands off instead of automating them: a prompt per shot
// written for the tool, the shot's picture as the start frame, a link to the tool's site;
// the person makes the clips there and brings them back by shot number.
const shotSeconds = k => timeline?.scenes[k] ? timeline.scenes[k].end - timeline.scenes[k].start : 0;
const handoffItems = (tool, shots) => shots.filter(needsPicture).map(k => ({ shot: k + 1, text: handoffPrompt(P, k, tool, shotSeconds(k)) })).filter(p => p.text);
function promptCards(tool, items) {
  const T = toolOf(tool);
  return `<div class="dir-prompts"><div class="ho-tools"><a class="btn btn-primary btn-sm" href="${esc(T.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(T.name)} ↗</a>`
    + `<button type="button" class="btn btn-ghost btn-sm ho-copyall">📋 Copy all</button></div>`
    + items.map(p => `<div class="dir-prompt" data-shot="${p.shot - 1}"><b>Shot ${pad(p.shot)}</b> <span class="tiny muted">save the clip as ${pad(p.shot)}.mp4</span>`
      + `<p class="ho-text">${esc(p.text)}</p><div class="ho-tools"><button type="button" class="btn btn-ghost btn-sm ho-copy">📋 Copy</button>`
      + (P.images['scene-' + (p.shot - 1)] ? `<button type="button" class="btn btn-ghost btn-sm ho-frame" title="The shot's picture, to upload as the start frame or reference image">⬇ Start frame</button>` : '')
      + `</div></div>`).join('') + `<p class="tiny muted">${esc(T.name)}: ${esc(T.note)}.</p></div>`;
}
const imgExt = b => /png/.test(b?.type) ? 'png' : /webp/.test(b?.type) ? 'webp' : 'jpg';
const vidExt = b => /webm/.test(b?.type) ? 'webm' : /quicktime/.test(b?.type) ? 'mov' : 'mp4';
document.addEventListener('click', async e => {
  const t = e.target.closest('.ho-copy, .ho-copyall, .ho-frame, .ho-pack');
  if (!t || !P) return;
  if (t.classList.contains('ho-pack')) { exportPack(); return; }
  if (t.classList.contains('ho-frame')) {
    const k = +t.closest('.dir-prompt').dataset.shot, b = P.images['scene-' + k];
    if (b) download(b, `${pad(k + 1)}-start-frame.${imgExt(b)}`);
    return;
  }
  const text = t.classList.contains('ho-copy') ? t.closest('.dir-prompt').querySelector('.ho-text').textContent
    : [...t.closest('.dir-prompts').querySelectorAll('.dir-prompt')].map(d => `Shot ${pad(+d.dataset.shot + 1)}:\n${d.querySelector('.ho-text').textContent}`).join('\n\n');
  try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into the tool.'); } catch { toast('Copy blocked by the browser: select the text instead.', true); }
});

// Clips that come back: each goes to the shot whose number starts its file name ("03.mp4",
// "shot-3.mp4"); when the names carry no numbers, in file-name order over the shots asked for.
function matchClips(files, shots) {
  const list = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const num = f => { const m = f.name.match(/^(?:shot|scene|clip)?[\s_-]*0*(\d{1,4})(?!\d)/i); return m ? +m[1] : null; };
  const nums = list.map(num);
  const byNumber = nums.every(n => n && P.scenes[n - 1] && needsPicture(n - 1)) && new Set(nums).size === nums.length;
  return byNumber ? list.map((f, j) => [nums[j] - 1, f]) : list.slice(0, shots.length).map((f, j) => [shots[j], f]);
}
async function bringBackClips(files, shots, model, signal) {
  const pairs = matchClips(files, shots), got = [];
  for (const [j, [k, file]] of pairs.entries()) {
    if (!P.scenes[k]) continue;
    setStatus('Bringing in your clips…', `Shot ${k + 1}: ${file.name}`, j / pairs.length);
    await replaceShotClip(k, file, model, signal);
    got.push(k);
  }
  return got;
}
// A shot's clip replaced by a file: the shot keeps its line, look and edits. When the clip
// speaks (its words are heard), its own sound replaces the recorded voice; otherwise the shot
// keeps the recorded voice and its timing.
async function replaceShotClip(i, file, model, signal) {
  const sc = P.scenes[i];
  await attachClip(i, file, model, signal);
  for (const f of ['trim', 'freeze', 'reverse', 'speech']) delete sc[f]; // they were for the old clip
  if (sc.clipSound) {
    const sound = await clipSound(file);
    const segs = sound ? await transcribe(await monoAt(sound, 16000), signal).catch(err => { if (err instanceof Cancelled) throw err; console.warn('transcribe', err); return null; }) : [];
    if (segs?.length) sc.speech = [segs[0].start, segs[segs.length - 1].end];
    // no words heard (or no way to listen): the clip's sound replaces the voice only when the shot has a line
    else if (segs || !(sc.dialogue || []).some(d => d.line)) sc.clipSound = false;
  }
  sceneAudio = null; timeline = null; mixBuf = null; video = null; media.clear();
  renderScenes(); save();
}

// The hand-off panel
function openHandoff() {
  if (!P?.scenes?.length) { toast('Write the story first.'); return; }
  const sel = $('#hoTool');
  if (!sel.options.length) sel.innerHTML = HANDOFF.map(t => `<option value="${t.id}">${esc(t.name)}${t.speech ? ' (makes speech)' : ''}</option>`).join('');
  const shots = P.scenes.map((_, k) => k).filter(needsPicture);
  $('#hoShots').innerHTML = shots.map(k => `<label><input type="checkbox" value="${k}"${P.videos?.['scene-' + k] ? '' : ' checked'}> ${pad(k + 1)} ${esc(cut(P.scenes[k].title || '', 18))}</label>`).join('');
  $('#hoList').innerHTML = '';
  toolChanged();
  $('#handoffDialog').showModal();
}
function toolChanged() {
  const T = toolOf($('#hoTool').value);
  $('#hoOpen').href = T.url; $('#hoOpen').textContent = `Open ${T.name} ↗`;
  $('#hoNote').textContent = `${T.name}: ${T.note}. Clips of ${T.lens.join(' or ')} s; prompts up to ${T.max} characters.${T.speech ? ' It speaks the lines itself, with lip-sync.' : ' Its clips are silent: the film keeps the recorded voice.'}`;
}
const hoShots = () => [...$$('#hoShots input:checked')].map(x => +x.value);
$('#btnHandoff').onclick = $('#btnHandoff2').onclick = openHandoff;
$('#hoClose').onclick = () => $('#handoffDialog').close();
$('#hoTool').onchange = () => { toolChanged(); if ($('#hoList').innerHTML) $('#hoMake').click(); };
$('#hoMake').onclick = () => {
  const items = handoffItems($('#hoTool').value, hoShots());
  $('#hoList').innerHTML = items.length ? promptCards($('#hoTool').value, items) : '<p class="tiny muted">Tick at least one shot.</p>';
};
$('#hoPack').onclick = () => exportPack();
$('#hoFiles').onchange = e => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  const T = toolOf($('#hoTool').value), shots = hoShots().length ? hoShots() : P.scenes.map((_, k) => k).filter(needsPicture);
  $('#handoffDialog').close();
  runJob(async signal => {
    pushUndo('clips made elsewhere');
    const got = await bringBackClips(files, shots, T.name, signal);
    toast(`🎞 ${got.length} clip${got.length === 1 ? '' : 's'} in shot${got.length === 1 ? '' : 's'} ${got.map(k => k + 1).join(', ')}.`, false, 7000);
  }).then(ok => { if (ok) edited(); });
};
$('#btnPack').onclick = () => exportPack();

// ---- the editing pack: everything an editor (YouTube Create, CapCut, Premiere…) needs ----
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
// a plain .zip (stored, not compressed: video and audio do not shrink anyway)
async function zipBlob(files) {
  const parts = [], central = [], enc = new TextEncoder();
  let off = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer()), name = enc.encode(f.name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    parts.push(h, name, data); central.push(c, name);
    off += 30 + name.length + data.length;
  }
  const size = central.reduce((a, x) => a + x.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
function wavOf(buf) {
  const ch = buf.numberOfChannels, n = buf.length, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const text = (o, s) => [...s].forEach((c, k) => out.setUint8(o + k, c.charCodeAt(0)));
  text(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); text(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
  out.setUint16(22, ch, true); out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  text(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
  return new Blob([out], { type: 'audio/wav' });
}
// every spoken line (and clip speech) at its place in the film, nothing else
async function voiceTrack(tl) {
  const R = 48000, oc = new OfflineAudioContext(2, Math.ceil(tl.total * R), R);
  for (const g of tl.segments) {
    if (!g.buffer) continue;
    const src = oc.createBufferSource(), off = g.offset || 0;
    src.buffer = g.buffer; src.connect(oc.destination);
    src.start(g.start, off, Math.max(0.01, Math.min(g.buffer.duration - off, g.end - g.start)));
  }
  return oc.startRendering();
}
function exportPack() {
  if (!P?.scenes?.length) { toast('Write the story first.'); return; }
  return runJob(async signal => {
    if (!mixBuf || !timeline) await ensureFilmParts(signal);
    const files = [], name = slug(P.title), tl = timeline;
    setStatus('Packing the film for editing…', 'Subtitles, voice and music tracks', 0.1);
    if (lastRender) files.push({ name: `00-film${video === lastRender ? '' : '-older-version'}.${vidExt(lastRender.blob)}`, blob: lastRender.blob });
    files.push({ name: '00-subtitles.srt', blob: new Blob([srt(tl)], { type: 'text/plain' }) });
    files.push({ name: '00-voice.wav', blob: wavOf(await voiceTrack(tl)) });
    if (signal.aborted) throw new Cancelled();
    files.push({ name: '00-music.wav', blob: wavOf(await mixFilm(tl, { mood: filmMood(), seed: P.seed, musicVol: P.musicVol, sfx: false, withVoice: false })) });
    // each shot: its clip, else its picture; cards and maps as a still of the finished card
    let still = null;
    const rows = [];
    for (const [k, sc] of P.scenes.entries()) {
      if (signal.aborted) throw new Cancelled();
      setStatus('Packing the film for editing…', `Shot ${k + 1} of ${P.scenes.length}`, 0.3 + 0.6 * k / P.scenes.length);
      const s = tl.scenes[k], base = `shots/${pad(k + 1)}-${slug(sc.title || drawnLabel(sc) || 'shot').slice(0, 30)}`;
      const clip = P.videos?.['scene-' + k], pic = P.images['scene-' + k];
      let file = null;
      if (clip) file = { name: `${base}.${vidExt(clip)}`, blob: clip };
      else if (pic && !drawnShot(sc)) file = { name: `${base}.${imgExt(pic)}`, blob: pic };
      else {
        const { W, H } = sizeFor(P.options.format, 720);
        still ||= await makeRenderer(P, W, H);
        const t = s.start + (s.end - s.start) * 0.7, c = new OffscreenCanvas(W, H);
        await still.prepare(t); still.draw(c.getContext('2d'), t);
        file = { name: `${base}.jpg`, blob: await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }) };
      }
      files.push(file);
      const fx = ['trim', 'speed', 'reverse', 'freeze', 'crop', 'grade', 'keyhole', 'blur', 'trans', 'pip', 'fill'].filter(f => sc[f] != null).join(', ');
      rows.push(`${pad(k + 1)}  ${s.start.toFixed(2)}-${s.end.toFixed(2)} s  ${file.name}${fx ? `  (edits in VoiceFrame: ${fx})` : ''}`);
    }
    files.push({ name: '00-README.txt', blob: new Blob([[
      `${P.title}: editing pack from VoiceFrame Studio`, '',
      `00-film: the rendered film${lastRender ? (video === lastRender ? '' : ' (made before the latest edits)') : ' (not included: render the MP4 first)'}.`,
      '00-subtitles.srt: subtitles, timed to the film.', '00-voice.wav: narration and dialogue only, at their times in the film.',
      '00-music.wav: the original score only.', 'shots/: each shot\'s clip or picture, numbered in film order (cards and maps as a still).', '',
      `Film length ${tl.total.toFixed(2)} s (the end card starts at ${tl.outroStart.toFixed(2)} s). Shot times:`, ...rows, '',
      'Import the folder into YouTube Create, CapCut or any editor: place the shots by these times, add the voice and music tracks and the .srt.',
      'Credits for stock footage are in the licence report (📄 on the film page).'
    ].join('\r\n')], { type: 'text/plain' }) });
    setStatus('Packing the film for editing…', 'Making the .zip', 0.95);
    const zip = await zipBlob(files);
    download(zip, `${name}-edit-pack.zip`);
    toast(`📦 Editing pack saved: ${files.length} files (${(zip.size / 1048576).toFixed(1)} MB).`, false, 7000);
  });
}

// ============ audio to film ============
// The person's own narration: cleaned up (RNNoise), transcribed (Whisper, through the
// relay), cast and planned into shots, each shot playing its part of the recording.
const RNNOISE = 'https://cdn.jsdelivr.net/npm/@shiguredo/rnnoise-wasm@2022.2.0/dist/rnnoise.mjs';
async function denoise(pcm48, signal) {
  const { Rnnoise } = await import(RNNOISE);
  const rn = await Rnnoise.load(), st = rn.createDenoiseState(), N = rn.frameSize, frame = new Float32Array(N);
  const out = new Float32Array(pcm48.length);
  for (let k = 0; k + N <= pcm48.length; k += N) {
    if (k % (N * 2000) === 0) { if (signal.aborted) throw new Cancelled(); await new Promise(r => setTimeout(r)); }
    for (let j = 0; j < N; j++) frame[j] = pcm48[k + j] * 32768; // RNNoise works on 16-bit sample values
    st.processFrame(frame);
    for (let j = 0; j < N; j++) out[k + j] = frame[j] / 32768;
  }
  st.destroy();
  return out;
}
// Pieces of about 75 s (each request stays under the relay's 4.5 MB), cut at the quietest
// moment of the last 6 s so no word is split.
function speechPieces(pcm, rate) {
  const pieces = [], win = 75 * rate, look = 6 * rate, hop = rate / 50;
  let a = 0;
  while (a < pcm.length) {
    let b = Math.min(pcm.length, a + win);
    if (b < pcm.length) {
      let best = b, low = Infinity;
      for (let k = b - look; k < b; k += hop) {
        let e = 0;
        for (let j = 0; j < hop; j++) e += pcm[k + j] ** 2;
        if (e < low) { low = e; best = k; }
      }
      b = best;
    }
    pieces.push([a, b]); a = b;
  }
  return pieces;
}
async function transcribe(pcm16, signal) {
  const segs = [];
  const pieces = speechPieces(pcm16, 16000);
  for (const [k, [a, b]] of pieces.entries()) {
    setStatus('Transcribing your audio…', `Part ${k + 1} of ${pieces.length}`, k / pieces.length);
    let r, j;
    for (let attempt = 0; attempt < 3; attempt++) {
      r = await relayFetch(API + '/transcribe', {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: await toBase64(wavBlob(pcm16.subarray(a, b), 16000)), language: whisperCode(P.options.language) })
      });
      j = await r.json().catch(() => ({}));
      if (r.ok) break;
      await new Promise(res => setTimeout(res, 5000 * (attempt + 1)));
    }
    if (!r.ok) throw new Error(j.error || 'The transcription service is busy. Try again in a few minutes.');
    for (const sg of j.segments || []) if (sg.text?.trim()) segs.push({ start: a / 16000 + sg.start, end: a / 16000 + sg.end, text: sg.text.trim() });
  }
  return segs;
}
async function doAudioStory(signal) {
  readOptions();
  const file = $('#audioFile').files[0];
  setStatus('Reading your audio…', file.name, 0.02);
  let buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await file.arrayBuffer());
  if (buf.duration > 20.5 * 60) throw new Error('Use a recording of up to 20 minutes.');
  let pcm48 = await monoAt(buf, 48000);
  if ($('#optDenoise').checked) {
    setStatus('Cleaning up background noise…', 'RNNoise, in your browser', 0.05);
    pcm48 = await denoise(pcm48, signal);
  }
  buf = new AudioBuffer({ length: pcm48.length, sampleRate: 48000, numberOfChannels: 1 });
  buf.copyToChannel(pcm48, 0);
  const segs = await transcribe(await monoAt(buf, 16000), signal);
  if (!segs.length) throw new Error('No speech was found in that recording.');
  setStatus('Planning your film…', `${segs.length} sentences`);
  const film = await storyFromTranscript(segs, { language: P.options.language, genre: P.options.genre, signal, onStatus: d => setStatus('Planning your film…', d) });
  film.scenes = await breakIntoShots(film, { signal, real: isReal(P.options), onStatus: d => setStatus('Planning the shots…', d) });
  // each shot plays its part of the recording; a sentence split over several shots is shared by words
  const groups = {};
  film.scenes.forEach(sh => (groups[sh.sceneOf] ||= []).push(sh));
  for (const [k, list] of Object.entries(groups)) {
    const sg = segs[k], words = list.map(x => Math.max(1, x.narration.split(/\s+/).length)), total = words.reduce((x, y) => x + y, 0);
    let t = sg.start;
    list.forEach((x, j) => { const d = (sg.end - sg.start) * words[j] / total; x.span = [t, t + d]; t += d; });
  }
  film.shotMode = true;
  await applyStory(film, []);
  // the recording itself is the film's voice track (kept at 24 kHz mono)
  P.files = { narration: wavBlob(await monoAt(buf, 24000), 24000) };
  P.dialogueMode = 'narrator';
  await save(true);
}

// ============ previews on the sound step ============
let stopPreview = null;
$('#btnPreviewVoice').onclick = () => runJob(async signal => {
  readSoundOptions();
  stopPreview?.();
  await ensureVoiceEngine(signal);
  setStatus('Recording a sample…');
  const text = P.scenes[0]?.narration || 'Once upon a time, in a land far away, a story was waiting to be told.';
  stopPreview = playBuffer(await speak(text, { engine: voiceEngine(), voice: P.narrator, speed: P.speed, signal }));
});
$('#btnPreviewMusic').onclick = () => runJob(async () => {
  readSoundOptions();
  stopPreview?.();
  setStatus('Composing a sample…', filmMood() + ' mood');
  stopPreview = playBuffer(await previewScore(filmMood(), 15, P.seed));
});
['#optNarrator', '#optSpeed', '#optDialogue'].forEach(s => $(s).addEventListener('change', () => { sceneAudio = null; mixBuf = null; }));
['#optMood', '#optMusicVol', '#optSfx'].forEach(s => $(s).addEventListener('change', () => { mixBuf = null; }));
['#optBars', '#optGrain', '#optCaptions', '#optWatermark', '#optDepth', '#optFaces'].forEach(s => $(s).addEventListener('change', () => { readSoundOptions(); refreshPreview(); save(); }));

// ============ player ============
const player = {
  canvas: $('#playerCanvas'), ctx: $('#playerCanvas').getContext('2d', { alpha: false }),
  renderer: null, buf: null, ac: null, src: null, startAt: 0, offset: 0, playing: false, raf: 0,
  load(renderer, buf) {
    this.pause(); this.renderer = renderer; this.buf = buf; this.offset = 0;
    this.canvas.width = renderer.W; this.canvas.height = renderer.H;
    renderStrip(renderer.tl);
    this.draw(); this.updateUI();
  },
  unload() { this.pause(); this.renderer = null; this.buf = null; },
  time() { return this.playing ? this.ac.currentTime - this.startAt : this.offset; },
  play() {
    if (!this.buf) return;
    this.ac ||= new AudioContext();
    this.ac.resume();
    if (this.offset >= this.buf.duration - 0.05) this.offset = 0;
    this.src = this.ac.createBufferSource(); this.src.buffer = this.buf; this.src.connect(this.ac.destination);
    this.startAt = this.ac.currentTime - this.offset;
    this.src.start(0, this.offset);
    this.src.onended = () => { if (this.playing && this.time() >= this.buf.duration - 0.1) { this.playing = false; this.offset = this.buf.duration; this.updateUI(); } };
    this.playing = true; this.loop(); this.updateUI();
  },
  pause() {
    if (!this.playing) return;
    this.offset = this.time(); this.playing = false;
    try { this.src.stop(); } catch { /* stopped */ }
    cancelAnimationFrame(this.raf); this.updateUI();
  },
  seek(t) { const was = this.playing; this.pause(); this.offset = Math.max(0, Math.min(t, this.buf?.duration || 0)); this.draw(); this.updateUI(); if (was) this.play(); },
  loop() { this.draw(); this.updateUI(); if (this.playing) this.raf = requestAnimationFrame(() => this.loop()); },
  // Seek any AI clips to the right frame, then draw; skip a frame if the last seek is still running.
  draw() {
    if (!this.renderer || this.busy) return;
    const t = Math.min(this.time(), this.buf.duration);
    this.busy = true;
    this.renderer.prepare(t).then(() => this.renderer?.draw(this.ctx, t)).finally(() => { this.busy = false; });
  },
  updateUI() {
    const d = this.buf?.duration || 0, t = Math.min(this.time(), d);
    $('#timecode').textContent = `${fmtTime(t)} / ${fmtTime(d)}`;
    if (!seeking) $('#seek').value = d ? Math.round(t / d * 1000) : 0;
    $('#btnPlay').textContent = this.playing ? '❚❚' : '▶';
    $('#btnBigPlay').hidden = this.playing || !this.buf;
    markStrip(t);
  }
};
// Timeline strip: one thumbnail per shot, as wide as the shot is long; click to jump there.
let stripAt = -1;
function renderStrip(tl) {
  const box = $('#tlStrip'); stripAt = -1;
  if (!tl?.scenes?.length) { box.innerHTML = ''; return; }
  box.innerHTML = tl.scenes.map((s, i) => {
    const img = P.images['scene-' + i], dur = Math.max(0.5, s.end - s.start);
    return `<button class="tl-shot${P.videos?.['scene-' + i] ? ' moving' : ''}" data-at="${s.start}" data-i="${i}" style="flex-grow:${dur.toFixed(2)}" title="Shot ${i + 1} · ${dur.toFixed(1)}s${P.scenes[i]?.title ? ' · ' + esc(P.scenes[i].title) : ''}">`
      + (img ? `<img src="${blobURL('scene-' + i, img)}" alt="" loading="lazy">` : '') + `<span>${i + 1}</span></button>`;
  }).join('');
}
function markStrip(t) {
  const S = player.renderer?.tl?.scenes; if (!S) return;
  let i = S.findIndex(s => t < s.end); if (i < 0) i = S.length - 1;
  if (i === stripAt) return;
  const box = $('#tlStrip');
  box.children[stripAt]?.classList.remove('now');
  const el = box.children[i]; stripAt = i;
  if (!el) return;
  el.classList.add('now');
  const l = el.offsetLeft - box.offsetLeft, r = l + el.offsetWidth;
  if (l < box.scrollLeft || r > box.scrollLeft + box.clientWidth) box.scrollLeft = l - box.clientWidth / 3;
}
$('#tlStrip').addEventListener('click', e => {
  const b = e.target.closest('.tl-shot'); if (!b || !player.buf) return;
  player.seek(+b.dataset.at + 0.05);
});
let seeking = false;
$('#seek').addEventListener('pointerdown', () => seeking = true);
$('#seek').addEventListener('input', e => { if (player.buf) { player.offset = e.target.value / 1000 * player.buf.duration; if (!player.playing) { player.draw(); player.updateUI(); } } });
$('#seek').addEventListener('change', e => { seeking = false; player.seek(e.target.value / 1000 * (player.buf?.duration || 0)); });
$('#btnPlay').onclick = () => player.playing ? player.pause() : player.play();
$('#btnBigPlay').onclick = () => player.play();

// Depth maps for the 3D camera (computed once per picture in the browser).
function sceneDepths(maxWait = 45000) {
  if (P.look?.depth === false) return Promise.resolve([]);
  // only shots without an AI clip use the depth camera; a slow device never holds the film
  // for long: shots whose depth isn't ready in time play without the 3D camera (it keeps
  // being worked out and is used the next time the film is drawn)
  const late = new Promise(res => setTimeout(res, maxWait));
  return Promise.all(P.scenes.map((_, i) => P.videos?.['scene-' + i] || !P.images['scene-' + i] ? null : Promise.race([depthFor(P.images['scene-' + i]), late.then(() => null)])));
}
// Live faces on still shots (lips, blinks, head), found once per picture on the device.
function sceneFaces() {
  if (P.look?.faces === false) return Promise.resolve([]);
  P.faceCache ||= {};
  // kept with the film, keyed by the picture's size, so a repainted shot is searched again
  return Promise.all(P.scenes.map(async (_, i) => {
    const key = 'scene-' + i, blob = P.images[key];
    if (!blob || P.videos?.[key]) return null;
    const c = P.faceCache[key];
    if (c && c.n === blob.size && c.f.every(f => f.br)) return c.f;
    const f = await facesFor(blob);
    P.faceCache[key] = { n: blob.size, f };
    return f;
  }));
}
// Live bodies (skeleton, outline, clean background) per still shot, found on the device.
function sceneBodies() {
  if (P.look?.faces === false) return Promise.resolve([]);
  return Promise.all(P.scenes.map((_, i) => P.videos?.['scene-' + i] || !P.images['scene-' + i] ? null : bodiesFor(P.images['scene-' + i])));
}
async function makeRenderer(proj, W, H) {
  // the script's Noto font (and, for Chinese and Japanese, the slices this film's text needs)
  // must be loaded before the first caption frame is drawn
  const text = [proj.title, ...(timeline?.segments || []).map(s => `${s.speaker || ''} ${s.text || ''}`), ...(proj.scenes || []).map(s => s.title || '')].join(' ');
  const [depths, faces, bodies] = await Promise.all([sceneDepths(), sceneFaces(), sceneBodies(), ensureScriptFont(proj.language, text)]);
  const r = new Renderer(proj, media, timeline, W, H, depths, [], brand);
  r.faces = faces; r.bodies = bodies;
  // real people's faces blink and move, but their mouths never follow the voice
  r.noLip = new Set(proj.scenes.map((_, i) => i).filter(realFace));
  return r;
}
async function previewRenderer() {
  const { W, H } = sizeFor(P.options.format, 1080);
  const k = Math.min(1, 960 / Math.max(W, H));
  return await makeRenderer(P, Math.round(W * k), Math.round(H * k));
}
async function refreshPreview() {
  if (!timeline || !mixBuf || $('[data-panel=film]').hidden) return;
  const t = player.time();
  player.load(await previewRenderer(), mixBuf);
  player.seek(t);
}

async function enterFilm() {
  await document.fonts.load('700 40px Cinzel'); await document.fonts.load('800 40px Inter');
  renderMeta(); renderChecklist(); renderShare();
  $('#filmTitle').textContent = P.title;
  syncWorkspaceState();
  if (requiresFullFootage(P) && missingFootage(P).length) { autoRender = false; $('#filmMeta').textContent = 'Waiting for full-motion footage. Completed clips are saved.'; return; }
  // Arriving here with missing portraits, scenes or sound (e.g. after "write the
  // story first"): make them now instead of rendering placeholders.
  const noPortrait = () => P.characters.some(c => !P.images['char-' + c.id] && !triedPortraits.has(c.id));
  let generated = false;
  if (!job && (noPortrait() || !allPainted() || !mixBuf)) {
    $('#filmMeta').textContent = 'Designing characters, painting scenes and recording the voice before your film can play…';
    const ok = await runJob(signal => ensureFilmParts(signal));
    renderChecklist();
    if (!ok) return;
    generated = true;
  }
  if (!mixBuf) return;
  renderChecklist();
  showMissing(missingShots());
  $('#filmMeta').textContent = `${fmtTime(mixBuf.duration)} · ${P.scenes.length} scene clips joined into one film · ${P.options.format} · ${filmMood()} score`;
  // depth, faces and bodies are found on this device the first time: say so meanwhile
  // (a job that just ended may clear the bar, so it is put back until this is done)
  const prepNote = () => { if ($('#statusbar').hidden) setStatus('Preparing the film…', '3D depth, faces and bodies for each shot, on your device'); };
  prepNote();
  const iv = setInterval(prepNote, 500);
  let r;
  try { r = await previewRenderer(); } finally {
    clearInterval(iv);
    if (!job && $('#statusTitle').textContent === 'Preparing the film…') clearStatus();
  }
  player.load(r, mixBuf);
  player.seek(Math.min(timeline.intro ? timeline.intro * 0.55 : 0.8, mixBuf.duration));
  if ((generated || autoRender) && !video) {
    autoRender = false;
    while (job) await new Promise(r => setTimeout(r, 200)); // let the pipeline that brought us here finish
    renderFull();
  }
}

// Everything a film needs: portraits, scene pictures, narration, then the mix.
// Narration is recorded on this device while the images are painted.
async function ensureFilmParts(signal) {
  const noPortrait = () => P.characters.some(c => !P.images['char-' + c.id] && !triedPortraits.has(c.id));
  let voiceErr = null;
  const voices = sceneAudio || mixBuf ? null : doVoices(signal, true).catch(e => { voiceErr = e; });
  if (noPortrait()) await doPortraits(signal);
  if (!allPainted()) await doVisuals(signal);
  if (P.look?.depth !== false) {
    setStatus('Adding 3D camera motion…', 'Measuring depth in each scene (in your browser)', 0.9);
    await sceneDepths();
  }
  if (P.look?.faces !== false && P.scenes.some(sc => !sc.beats?.length)) {
    setStatus('Planning character actions…', 'A timed action for each shot, from the script', 0.92);
    await writeActions(P, { signal, onStatus: d => setStatus('Planning character actions…', d, 0.92) }).catch(e => { if (e instanceof Cancelled) throw e; console.warn('actions', e); });
    save();
  }
  if (P.look?.faces !== false) {
    setStatus('Bringing the characters to life…', 'Finding faces and bodies for lips, eyes, head, arms, legs and hair (in your browser)', 0.93);
    await sceneFaces();
    await sceneBodies();
  }
  if (voices) await waitVoices(voices);
  if (voiceErr) throw voiceErr;
  if (!mixBuf) await doMix(signal);
}

async function waitVoices(voices) {
  const show = () => setStatus('Recording narration…', voiceNote || 'Almost there', 0.95);
  show();
  const iv = setInterval(show, 700);
  try { await voices; } finally { clearInterval(iv); }
}

// ============ scene clips ============
// AI mode requires generated video for every scene; photo motion is an explicit alternative. The full film is all clips joined in order.
let clipStop = null;
async function playSceneClip(i, card) {
  if (clipStop) { const was = clipStop.i; clipStop(); if (was === i) return; }
  if (!mixBuf) {
    toast('Making the voice and music for your clips first…');
    const ok = await runJob(signal => ensureFilmParts(signal));
    if (!ok) return;
  }
  const box = card.querySelector('.scene-img');
  const s = timeline.scenes[i];
  const { W, H } = sizeFor(P.options.format, 1080);
  const k = Math.min(1, 640 / Math.max(W, H));
  const r = await makeRenderer(P, Math.round(W * k), Math.round(H * k));
  const cv = document.createElement('canvas');
  cv.className = 'clip-canvas'; cv.width = r.W; cv.height = r.H;
  box.appendChild(cv);
  const ctx = cv.getContext('2d', { alpha: false });
  const ac = new AudioContext();
  const src = ac.createBufferSource(); src.buffer = mixBuf; src.connect(ac.destination);
  const t0 = ac.currentTime + 0.05, dur = s.end - s.start;
  src.start(t0, s.start, dur);
  const btn = card.querySelector('.s-play');
  btn.textContent = '■ Stop clip';
  let raf = 0;
  const stop = () => { cancelAnimationFrame(raf); try { src.stop(); } catch { /* ended */ } ac.close(); cv.remove(); btn.textContent = '▶ Play clip'; clipStop = null; };
  stop.i = i;
  clipStop = stop;
  const loop = () => {
    const t = ac.currentTime - t0;
    if (t >= dur) return stop();
    if (!loop.busy) {
      loop.busy = true;
      const ft = s.start + Math.max(0, t);
      r.prepare(ft).then(() => r.draw(ctx, ft)).finally(() => { loop.busy = false; });
    }
    raf = requestAnimationFrame(loop);
  };
  loop();
}

function sliceAudio(buf, a, b) {
  const from = Math.floor(a * buf.sampleRate), to = Math.min(buf.length, Math.ceil(b * buf.sampleRate));
  const out = new AudioBuffer({ length: to - from, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(from, to), c);
  return out;
}

function exportSceneClip(i) {
  return runJob(async signal => {
    if (!mixBuf) await ensureFilmParts(signal);
    const s = timeline.scenes[i];
    const q = +(localStorage.getItem('vf_quality') || 1080);
    const { W, H } = sizeFor(P.options.format, q);
    await document.fonts.load('700 40px Cinzel');
    const full = await makeRenderer(P, W, H);
    const renderer = { prepare: t => full.prepare(s.start + t), draw: (ctx, t) => full.draw(ctx, s.start + t) };
    const blob = await exportFilm({
      renderer, audio: sliceAudio(mixBuf, s.start, s.end), W, H, signal,
      onProgress: p => setStatus(`Rendering scene ${i + 1} clip…`, `${Math.round(p * 100)}%`, p)
    });
    download(blob, `${slug(P.title)}-scene-${i + 1}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
    toast(`✅ Scene ${i + 1} clip saved.`);
  });
}

// ============ export ============
$('#btnRender').onclick = () => renderFull();
// Shots that need a picture and have none: painting was blocked, or the safety check could not run.
const missingShots = () => P.scenes.map((_, i) => i).filter(i => needsPicture(i) && !P.images['scene-' + i] && !P.videos?.['scene-' + i]);
const shotList = idx => { const n = idx.map(i => i + 1); return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : `${n[0]}`; };
function missingText(miss) {
  const why = [...new Set(miss.map(i => blockedText('scene-' + i) || 'not painted'))].join('; ');
  return `The film was not rendered: shot${miss.length > 1 ? 's' : ''} ${shotList(miss)} ${miss.length > 1 ? 'have' : 'has'} no picture (${why}). Press ↻ Try again to paint ${miss.length > 1 ? 'them' : 'it'}, or give ${miss.length > 1 ? 'them' : 'it'} your own picture in the storyboard.`;
}
function showMissing(miss) {
  $('#missingBox').hidden = !miss.length;
  if (miss.length) { $('#missingText').textContent = '⛔ ' + missingText(miss); $('#missingBox').scrollIntoView?.({ block: 'nearest' }); }
}
$('#btnMissingRetry').onclick = () => runJob(async signal => {
  const miss = missingShots();
  miss.forEach(i => clearBlocked('scene-' + i));
  setStatus('Painting the missing shots…', `Shot${miss.length > 1 ? 's' : ''} ${shotList(miss)}`);
  await doVisuals(signal);
  showMissing(missingShots());
}).then(ok => { if (ok && !missingShots().length) renderFull(); else if (ok) toast(missingText(missingShots()), true, 10000); });
$('#btnMissingBoard').onclick = () => goStep('scenes');
// The last MP4 stays on show (marked as older) while the film changes and a new one is made.
function staleDownload(schedule = true) {
  if (!lastRender) { $('#downloadBox').hidden = true; return; }
  $('#downloadBox').hidden = false;
  $('#staleNote').hidden = video === lastRender;
  // an edit made by hand after the render (storyboard, look, sound): render again once the
  // edits pause, as the note promises (the AI Director's edits already do)
  if (schedule) laterRender();
}
// a new render once the edits pause (6 s), while an older MP4 exists
function laterRender() {
  clearTimeout(laterRender.timer);
  if (lastRender && video !== lastRender) laterRender.timer = setTimeout(() => { if (lastRender && video !== lastRender && !renderJob) rerender(); }, 6000);
}
// The full-length film: every scene clip, in order, with transitions, title and end card.
const renderFull = () => runJob(async signal => {
  assertFullFootage(P);
  renderJob = true;
  try {
  player.pause();
  clipStop?.();
  if (!mixBuf || !allPainted()) await ensureFilmParts(signal);
  // a shot that needs a picture and has none (blocked, or its check could not run): stop
  // here and say which ones, instead of a film with empty shots
  const miss = missingShots();
  showMissing(miss);
  if (miss.length) throw new Error(missingText(miss));
  const q = +(localStorage.getItem('vf_quality') || 1080);
  const { W, H } = sizeFor(P.options.format, q);
  await document.fonts.load('700 40px Cinzel');
  const renderer = await makeRenderer(P, W, H);
  $('#renderBox').hidden = false; staleDownload(false);
  setStatus('Rendering your film…', `${W}×${H}`, 0);
  const blob = await exportFilm({
    renderer, audio: mixBuf, W, H, signal,
    onProgress: (p, eta) => {
      const txt = `${Math.round(p * 100)}% · about ${Math.max(1, Math.round(eta))}s left`;
      $('#renderBar').style.width = (p * 100).toFixed(1) + '%'; $('#renderText').textContent = txt;
      setStatus('Rendering your film…', `${W}×${H} · ${txt}`, p);
    }
  }).finally(() => { $('#renderBox').hidden = true; renderJob = false; });
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  video = { blob, name: `${slug(P.title)}.${ext}`, downloaded: false };
  lastRender = video;
  const a = $('#dlVideo');
  a.href = blobURL('video', blob); a.download = video.name;
  a.textContent = `⬇ Download ${ext.toUpperCase()} (${(blob.size / 1048576).toFixed(1)} MB)`;
  $('#lastVideo').src = blobURL('video', blob); $('#lastVideo').hidden = false;
  $('#downloadBox').hidden = false; $('#staleNote').hidden = true;
  $('#btnNativeShare').hidden = !(navigator.canShare && navigator.canShare({ files: [new File([blob], video.name, { type: blob.type })] }));
  toast(`✅ Full film ready: ${P.scenes.length} scene clips joined into one ${ext.toUpperCase()}. Download or share it below.`, false, 7000);
  } finally { renderJob = false; $('#renderBox').hidden = true; }
});
$('#dlVideo').addEventListener('click', () => { if (video) video.downloaded = true; $('#btnCreateNew').classList.add('btn-primary'); $('#btnCreateNewTop').classList.add('btn-primary'); });
$('#btnCreateNew').onclick = $('#btnCreateNewTop').onclick = $('#btnStepNew').onclick = () => {
  if (job) { toast('Still working. Cancel the current step first.'); return; }
  if (video && !video.downloaded && !confirm('Start a new film? This film is saved in My films, but you have not downloaded the video yet.')) return;
  $('#btnCreateNew').classList.remove('btn-primary'); $('#btnCreateNewTop').classList.remove('btn-primary');
  newProject(); show('studio'); window.scrollTo({ top: 0, behavior: 'smooth' });
};
$('#dlCredits').onclick = () => {
  // with a motion report: what really moves in each shot (AI video, or a picture with live characters)
  const motion = '\n\nMOTION REPORT\n' + P.scenes.map((s, i) => {
    const v = P.credits['video-' + i];
    return `Shot ${i + 1}: ${motionKind(i)}${v?.job ? ` · GPU job ${v.job}, shot ${v.n}` : ''}${s.beats?.length ? ` · actions: ${s.beats.map(b => b.move).join(' > ')}` : ''}`;
  }).join('\n');
  download(new Blob([CR.credits(P) + motion], { type: 'text/plain' }), `${slug(P.title)}-licence-report.txt`);
};
$('#dlSrt').onclick = () => timeline && download(new Blob([srt(timeline)], { type: 'text/plain' }), `${slug(P.title)}.srt`);
$('#dlThumb').onclick = async () => {
  const { W, H } = sizeFor(P.options.format, 1080);
  const c = new OffscreenCanvas(W, H);
  const r = await makeRenderer({ ...P, look: { ...P.look, captions: 'none' } }, W, H);
  const tt = timeline.intro ? timeline.intro * 0.6 : 1;
  await r.prepare(tt);
  r.draw(c.getContext('2d'), tt);
  download(await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 }), `${slug(P.title)}-thumbnail.jpg`);
};

// ============ share ============
const PLATFORMS = [
  ['YouTube', 'https://www.youtube.com/upload', '#ff0000', '▶'],
  ['YT Shorts', 'https://www.youtube.com/upload', '#ff0033', 'S'],
  ['Instagram', 'https://www.instagram.com/', '#d62976', 'IG'],
  ['Facebook', 'https://www.facebook.com/', '#1877f2', 'f'],
  ['X', 'https://x.com/compose/post', '#111', '𝕏'],
  ['LinkedIn', 'https://www.linkedin.com/feed/?shareActive=true', '#0a66c2', 'in'],
  ['WhatsApp', 'https://web.whatsapp.com/', '#25d366', 'W'],
  ['TikTok', 'https://www.tiktok.com/upload', '#000', '♪']
];
function renderShare() {
  $('#shareGrid').innerHTML = PLATFORMS.map(([n, , c, i], k) => `<button class="share-btn" data-p="${k}"><span class="dot" style="background:${c}">${i}</span>${n}</button>`).join('');
}
function metaText() {
  return `${$('#metaTitle').value}\n\n${$('#metaDesc').value}\n\n${$('#metaTags').value}`;
}
$('#shareGrid').onclick = async e => {
  const b = e.target.closest('[data-p]'); if (!b) return;
  if (!video) { toast('Render the MP4 first, then share.', true); $('#btnRender').focus(); return; }
  const [name, url] = PLATFORMS[+b.dataset.p];
  if (!video.downloaded) { download(video.blob, video.name); video.downloaded = true; }
  try { await navigator.clipboard.writeText(metaText()); } catch { /* clipboard blocked */ }
  window.open(url, '_blank', 'noopener');
  toast(`Video saved and caption copied. In ${name}, upload “${video.name}” and paste the caption.`, false, 7000);
};
$('#btnNativeShare').onclick = async () => {
  try {
    await navigator.share({ files: [new File([video.blob], video.name, { type: video.blob.type })], title: P.title, text: $('#metaDesc').value.slice(0, 500) });
  } catch (e) { if (e.name !== 'AbortError') toast('Sharing failed: ' + e.message, true); }
};
function renderMeta() {
  $('#metaTitle').value = P.title || '';
  $('#metaDesc').value = CR.description(P);
  $('#metaTags').value = (P.hashtags || []).concat(['AIStory', 'ShortFilm']).map(h => '#' + String(h).replace(/^#|\s+/g, '')).join(' ');
}
$('#btnCopyMeta').onclick = async () => { try { await navigator.clipboard.writeText(metaText()); toast('Copied.'); } catch { toast('Copy blocked by the browser.', true); } };
function renderChecklist() {
  P.voiceEngine = voiceEngine();
  P.mood = P.mood || 'epic';
  $('#crList').innerHTML = CR.checklist({ ...P, mood: filmMood() }).map(i => `<li><span class="${i.s}">${i.s === 'ok' ? '✔' : i.s === 'warn' ? '!' : '✖'}</span><span>${esc(i.t)}</span></li>`).join('');
}

// ============ channel branding ============
// Saved once in this browser and drawn on every film: { name, logo (small PNG data URL), subscribe }.
let brand = null; // what the renderer gets: { name, logo: ImageBitmap|null, subscribe }
function readBrand() { try { return JSON.parse(localStorage.getItem('vf_brand') || 'null') || {}; } catch { return {}; } }
async function loadBrand() {
  const b = readBrand();
  let logo = null;
  if (b.logo) { try { logo = await createImageBitmap(await (await fetch(b.logo)).blob()); } catch { /* bad image */ } }
  brand = (b.name || logo) ? { name: b.name || '', logo, subscribe: b.subscribe !== false } : null;
  $('#brandName').value = b.name || '';
  $('#brandSub').checked = b.subscribe !== false;
  $('#brandLogoImg').hidden = !b.logo; $('#brandLogoPh').hidden = !!b.logo;
  if (b.logo) $('#brandLogoImg').src = b.logo;
}
async function saveBrand(patch) {
  try { localStorage.setItem('vf_brand', JSON.stringify({ ...readBrand(), ...patch })); }
  catch { toast('That logo is too large to save. Try a smaller image.', true); return; }
  await loadBrand();
  refreshPreview();
}
// Logos are stored square, 256 px, so they stay small and sharp in the badge.
async function setLogo(file) {
  if (!file) return;
  // the logo is drawn on every film: checked like any picture (fail closed)
  try { await checkImage(file); } catch (e) { safetyToast('That logo', e); return; }
  try {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const s = Math.max(256 / bmp.width, 256 / bmp.height);
    c.getContext('2d').drawImage(bmp, (256 - bmp.width * s) / 2, (256 - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    await saveBrand({ logo: c.toDataURL('image/png') });
    toast('Logo added. It appears on every film.');
  } catch { toast('Could not read that image. Try a PNG or JPG.', true); }
}
$('#brandLogo').addEventListener('change', e => setLogo(e.target.files[0]));
$('#brandRemove').onclick = () => saveBrand({ logo: null });
$('#brandName').addEventListener('change', e => saveBrand({ name: e.target.value.trim() }));
$('#brandSub').addEventListener('change', e => saveBrand({ subscribe: e.target.checked }));
loadBrand();

// ============ settings ============
$('#btnSettings').onclick = () => {
  $('#setQuality').value = localStorage.getItem('vf_quality') || '1080';
  $('#settingsDialog').showModal();
};
$('#settingsDialog').addEventListener('close', () => {
  if ($('#settingsDialog').returnValue !== 'save') return;
  localStorage.setItem('vf_quality', $('#setQuality').value);
  toast('Settings saved.');
});

// ============ install as an app ============
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('#btnInstall').hidden = false; });
$('#btnInstall').onclick = async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('#btnInstall').hidden = true; };
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

function syncWorkspaceState() {
  const summary = footageSummary(P || {options:{motion:motionMode()}});
  $('#workspaceProjectName').textContent = P?.title || 'Untitled project';
  $('#workspaceMode').textContent = summary.label;
  $('#workspaceFootage').textContent = `${summary.ready} / ${summary.total} video shots`;
  $('#workspaceFootage').dataset.ready = String(summary.total > 0 && summary.ready === summary.total);
  $('#workspaceGpu').textContent = relayHasMotion() ? 'GPU service enabled' : 'GPU unavailable';
  $('#workspaceGpu').classList.toggle('warn', !relayHasMotion());
  $('#fullMotionBlock').hidden = !summary.blocked;
  if (summary.blocked) $('#fullMotionBlockText').textContent = `${summary.ready} of ${summary.total} shots have footage. ${summary.total - summary.ready} still need video. Full-motion export waits for actual clips. Use the storyboard to retry unfinished shots or import footage.`;
}
$('#btnRetryMissingMotion').onclick = () => {
  if (!P || job) { toast('Wait for the current step or cancel waiting first.'); return; }
  if (P.gpuRun) { $('#btnCollect').click(); return; }
  const missing = missingFootage(P);
  if (!missing.length) { toast('All cinematic shots have footage.'); return; }
  picked.clear(); missing.forEach(i => picked.add(i)); renderScenes(); goStep('scenes');
  if (!job) fixShots('animate');
};
$('#btnAlternateFootage').onclick = () => { if (P?.scenes?.length) $('#btnHandoff').click(); };
$('#btnUseBasic').onclick = () => {
  if (!P || job) { toast('Cancel the current job before changing the film mode.'); return; }
  P.options.motion = 'live'; $('#optMotion').value = 'live'; autoRender = false;
  save(); syncWorkspaceState(); enterFilm().catch(e => toast(e.message, true, 10000));
};


$('#ceJobCancel').onclick = () => job?.abort();
document.addEventListener('click', e => {
  const tab = e.target.closest('[data-ribbon]');
  if (tab) {
    $$('.ribbon-tabs [role="tab"]').forEach(b => { const active = b === tab; b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1; });
    $$('.ribbon-panel').forEach(panel => panel.hidden = panel.id !== 'ribbonPanel-' + tab.dataset.ribbon);
  }
  const command = e.target.closest('[data-command]');
  if (command) $("#" + command.dataset.command)?.click();
  const focus = e.target.closest('[data-focus]');
  if (focus) { goStep(focus.dataset.stepTarget); setTimeout(() => { const field = $("#" + focus.dataset.focus); field?.scrollIntoView({block:'center',behavior:'smooth'}); field?.focus(); }, 100); }
  const audioStart = e.target.closest('[data-dashboard-source]');
  const importStart = e.target.closest('[data-dashboard-import]');
  if (audioStart || importStart) { show('newvideo'); if (job) return; if (audioStart) setSource('audio'); else $('#clipsFile').click(); }
});
$('.ribbon-tabs').addEventListener('keydown', e => {
  if (!['ArrowRight','ArrowLeft','Home','End'].includes(e.key)) return;
  const tabs = $$('.ribbon-tabs [role="tab"]'); let i = tabs.indexOf(document.activeElement); if (i < 0) return;
  e.preventDefault(); i = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[i].click(); tabs[i].focus();
});

// ============ boot ============
$('#year').textContent = new Date().getFullYear();
setAuthMode('signin');
const mode = await Auth.initAuth();
$('#authModeNote').textContent = mode === 'local' ? 'Accounts are saved on this device.' : 'Secured by Google Firebase Authentication.';
if (mode === 'local') $('#btnGoogle').hidden = true, $('.divider').hidden = true;
show(user ? 'projects' : 'landing');

// Local end-to-end tests only (never on the live site): a handle on the open film.
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.vfDebug = {
  get P() { return P; }, get timeline() { return timeline; }, get video() { return video; }, get lastRender() { return lastRender; }, get mixBuf() { return mixBuf; },
  get job() { return job; }, undoStack, media, renderAll, save, goStep, renderFull, enterFilm, readOptionsToUI, newProject, makeRenderer, sendDirector, refreshPreview
};
