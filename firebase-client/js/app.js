import { requiresGeneratedVideo, missingVideoScenes, assertGeneratedVideo } from './motion-policy.js?v=25';
import * as Auth from './auth.js?v=25';
import * as Store from './store.js?v=25';
import { paintImage, stockImage, hasKey, getKey, relayStatus, relayHasKey, Cancelled } from './ai.js?v=25';
import { writeStory, scenePrompt, portraitPrompt, rewriteScene, SCENE_COUNT, chatgptStoryPrompt, importStory, chatgptImagePrompts } from './story.js?v=25';
import * as CR from './copyright.js?v=25';
import { Dictation, KOKORO_NARRATORS, POLLI_NARRATORS, castVoices, castOptions, loadVoiceEngine, speak, playBuffer } from './voice.js?v=25';
import { mixFilm, previewScore } from './music.js?v=25';
import { Renderer, buildTimeline, sizeFor, srt, INTRO } from './renderer.js?v=25';
import { exportFilm } from './exporter.js?v=25';
import { depthFor } from './depth.js?v=25';
import { animateScene, isQuotaError, videoQuotaLeft, quotaRefillText } from './video.js?v=25';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = s => String(s || 'film').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'film';
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let user = null, P = null, job = null, afterAuth = 'studio', autoRender = false;
let voiceNote = ''; // latest narration progress, shown while other steps wait for it
const triedPortraits = new Set(); // portraits attempted this session (a failure isn't retried automatically)
let bitmaps = {}, sceneAudio = null, timeline = null, mixBuf = null, video = null;
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
async function bitmapFor(key) {
  const blob = P.images?.[key];
  if (!blob) return null;
  if (bitmaps[key]?.blob === blob) return bitmaps[key].bmp;
  let bmp = await createImageBitmap(blob);
  if (bmp.width > 2400) {
    const h = Math.round(bmp.height * 2400 / bmp.width);
    bmp.close(); bmp = await createImageBitmap(blob, { resizeWidth: 2400, resizeHeight: h, resizeQuality: 'high' });
  }
  bitmaps[key] = { blob, bmp };
  return bmp;
}
let saveTimer;
function save(now = false) {
  if (!P) return;
  clearTimeout(saveTimer);
  const run = () => Store.saveProject(P).catch(e => console.warn('save failed', e));
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
  $('#statusTitle').textContent = title;
  $('#statusDetail').textContent = detail;
  if (progress != null) $('#statusBar').style.width = Math.round(progress * 100) + '%';
}
function clearStatus() { $('#statusbar').hidden = true; $('#statusBar').style.width = '0'; }
async function runJob(fn) {
  if (job) { toast('Still working on the last step. Cancel it first.'); return false; }
  job = new AbortController();
  const controller = job;
  try { await fn(job.signal); return true; }
  catch (e) {
    controller.abort();
    if (e instanceof Cancelled || e.name === 'AbortError') toast('Cancelled.');
    else { console.error(e); toast(e.message || 'Something went wrong.', true, 6000); }
    return false;
  } finally { job = null; clearStatus(); updateStepper(); }
}
$('#btnCancel').onclick = () => job?.abort();

// ============ views ============
function show(view) {
  if ((view === 'studio' || view === 'projects') && !user) { afterAuth = view; view = 'auth'; }
  $$('.view').forEach(v => v.hidden = v.id !== 'view-' + view);
  window.scrollTo(0, 0);
  if (view === 'projects') renderProjects();
  if (view === 'studio' && !P) newProject();
  if (view === 'landing') startHero(); else stopHero();
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
    $('#userName').textContent = u.name;
    $('#userAvatar').innerHTML = u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : esc(u.name[0]?.toUpperCase() || 'U');
    if (!$('#view-auth').hidden) show(afterAuth);
  } else if (was) show('landing');
});

// ============ projects ============
async function renderProjects() {
  const list = await Store.listProjects(user.uid);
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
$('#btnNewProject').onclick = () => { newProject(); show('studio'); };

function newProject() {
  resetMedia();
  P = {
    id: crypto.randomUUID(), uid: user.uid, ownerName: user.name, createdAt: Date.now(),
    idea: '', options: {}, images: {}, videos: {}, credits: {}, scenes: [], characters: [], flags: [],
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
  Object.values(bitmaps).forEach(b => b.bmp.close?.());
  bitmaps = {}; sceneAudio = null; timeline = null; mixBuf = null; video = null;
  player.unload();
  $('#downloadBox').hidden = true;
}
function readOptionsToUI() {
  const o = P.options || {};
  const set = (id, v) => { if (v != null) $(id).value = v; };
  set('#optGenre', o.genre); set('#optLength', o.length); set('#optStyle', o.style); set('#optFormat', o.format);
  set('#optLang', o.language); set('#optVisuals', o.visuals); set('#optMotion', o.motion);
  $('#optUseOwn').checked = !!o.useOwn;
  $('#optBars').checked = P.look?.bars ?? true; $('#optGrain').checked = P.look?.grain ?? true;
  $('#optWatermark').checked = !!P.look?.watermark; $('#optDepth').checked = P.look?.depth ?? true; $('#optSfx').checked = P.sfx ?? true;
  set('#optCaptions', P.look?.captions); set('#optSpeed', P.speed); set('#optDialogue', P.dialogueMode);
  set('#optMood', P.moodOverride); if (P.musicVol != null) $('#optMusicVol').value = Math.round(P.musicVol * 100);
  speedNote();
}
function readOptions() {
  P.idea = $('#ideaInput').value.trim();
  P.options = {
    genre: $('#optGenre').value, length: $('#optLength').value, style: $('#optStyle').value, format: $('#optFormat').value,
    language: $('#optLang').value, visuals: $('#optVisuals').value, motion: $('#optMotion').value, useOwn: $('#optUseOwn').checked
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
  // Opening a step makes whatever it shows, so nothing waits for a button press.
  // A ChatGPT story waits for the person's ChatGPT frames instead of auto-painting.
  const gpt = P.credits?.story?.kind === 'chatgpt';
  if (!job && !gpt && step === 'characters' && P.characters.some(c => !P.images['char-' + c.id] && !triedPortraits.has(c.id))) runJob(s => doPortraits(s));
  if (!job && !gpt && step === 'scenes' && !allPainted()) runJob(s => doVisuals(s));
  if (gpt && step === 'scenes' && !allPainted()) toast('Add your ChatGPT frames with “🤖 Frames from my ChatGPT”, or click “Paint all scenes”.', false, 6000);
  $('.studio-main').scrollIntoView?.({ block: 'start' });
  window.scrollTo({ top: 0 });
}
function allPainted() { return P.scenes.length && P.scenes.every((_, i) => P.images['scene-' + i]); }
function updateStepper() {
  if (!P) return;
  updateMotionStatus();
  const done = {
    idea: !!P.scenes?.length, story: !!P.scenes?.length,
    characters: P.characters?.length && P.characters.every(c => P.images['char-' + c.id]),
    scenes: allPainted() && !missingVideoScenes(P).length, sound: !!mixBuf, film: !!video
  };
  $$('#stepper button').forEach(b => b.classList.toggle('done', !!done[b.dataset.step] && !b.classList.contains('active')));
}
$('#stepper').onclick = e => { const b = e.target.closest('button'); if (b) goStep(b.dataset.step); };
document.addEventListener('click', e => { const n = e.target.closest('[data-next]'); if (n) goStep(n.dataset.next); });

// ============ idea / dictation ============
const IDEAS = [
  'A lonely lighthouse keeper finds a glowing fish that grants wishes, but each wish costs a memory',
  'A street-food vendor in old Delhi discovers his tandoor is a portal to the year 2190',
  'A young girl teaches a retired war robot how to paint',
  'Two rival kite makers must work together to save their village festival',
  'An astronaut stranded on Mars receives a letter from her grandmother',
  'A tiger cub and a village boy become secret friends in the Sundarbans'
];
$('#ideaChips').innerHTML = IDEAS.map(i => `<button class="chip" type="button">${esc(i.split(' ').slice(0, 6).join(' '))}…</button>`).join('');
$('#ideaChips').onclick = e => { const c = e.target.closest('.chip'); if (c) { $('#ideaInput').value = IDEAS[[...c.parentNode.children].indexOf(c)]; } };

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
function speedNote() {
  const n = SCENE_COUNT[$('#optLength').value] || 10;
  const ai = $('#optVisuals').value === 'ai';
  const imgs = (ai ? n : 0) + 3;
  $('#speedNote').textContent = hasKey()
    ? `Fast mode is on: characters and scenes are painted in parallel.${n > 16 ? ` A ${n}-scene film takes roughly ${Math.round(n / 4)}–${Math.round(n / 2.5)} minutes to make; keep this tab open.` : ''}`
    : `Free mode: about ${Math.ceil(imgs * 46 / 60) + 2} minutes for ${ai ? n + ' painted scenes and ' : ''}character portraits (the free image service allows one image every 45 s). Add a free Pollinations key in Settings to go faster.`;
}
['#optLength', '#optVisuals'].forEach(s => $(s).addEventListener('change', speedNote));
// A YouTube Short is always vertical, character-voiced and in motion.
$('#optLength').addEventListener('change', () => {
  if ($('#optLength').value !== 'shorts') return;
  $('#optFormat').value = '9:16'; $('#optMotion').value = 'ai'; $('#optDialogue').value = 'voiced';
  if ($('#optStyle').value === 'painterly' || $('#optStyle').value === 'watercolor') $('#optStyle').value = 'cinematic';
});
relayStatus.then(speedNote);

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
async function doStory(signal) {
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
    idea: P.idea, genre: P.options.genre, length: P.options.length, language: P.options.language,
    useOwn: P.options.useOwn, makeOriginal, signal,
    onStatus: (detail, p) => setStatus('Writing your story…', detail, p)
  });
  await applyStory(s, flags);
}

// A new story replaces the old one's pictures, clips and sound.
async function applyStory(s, flags = [], source = null) {
  P.images = {}; P.videos = {}; P.credits = source ? { story: { kind: source } } : {};
  Object.assign(P, s, { flags });
  P.characters.forEach(c => delete c.voice);
  P.storyFlags = CR.screen([P.title, P.story, ...P.characters.map(c => c.name)].join(' '));
  sceneAudio = null; mixBuf = null; video = null;
  renderAll();
  await save(true);
}

// ============ ChatGPT workflow ============
// The person runs these prompts in their own ChatGPT and brings the results back.
async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied. Paste it into ChatGPT.`); }
  catch { toast('Copy was blocked by the browser. Select the text and copy it yourself.', true); }
}
$('#btnGptStory').onclick = () => {
  readOptions();
  if (P.idea.length < 8) { toast('Type or speak your idea first.', true); $('#ideaInput').focus(); return; }
  $('#gptStoryError').textContent = '';
  $('#gptStoryDialog').showModal();
};
$('#gptCopyStory').onclick = () => {
  readOptions();
  copyText(chatgptStoryPrompt({ idea: P.idea, genre: P.options.genre, length: P.options.length, language: P.options.language }), 'Story prompt');
};
$('#gptLoadStory').onclick = async () => {
  readOptions();
  try {
    const s = importStory($('#gptStoryPaste').value, P.options.length);
    const flags = CR.screen([P.idea, s.title, s.story].join(' '));
    await applyStory(s, flags, 'chatgpt');
    $('#gptStoryDialog').close();
    $('#gptStoryPaste').value = '';
    toast(`Loaded “${s.title}”: ${s.scenes.length} scenes, ${s.characters.length} characters.`);
    goStep('story');
  } catch (e) {
    $('#gptStoryError').textContent = e.message.startsWith('That') ? e.message : 'Could not read that answer. Make sure you pasted ChatGPT\'s whole JSON reply. (' + e.message + ')';
  }
};
$('#btnGptFrames').onclick = () => {
  $('#gptFramesNote').textContent = `${P.scenes.length} scenes to draw.`;
  $('#gptFramesDialog').showModal();
};
$('#gptCopyFrames').onclick = () => copyText(chatgptImagePrompts(P), 'Image instructions');
$('#gptFramesFile').addEventListener('change', e => {
  // Downloads arrive in the order ChatGPT drew them; sort by time saved, then by name.
  job?.abort(); // stop any free painting so it can't replace these frames
  const files = [...e.target.files].sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!files.length) return;
  files.slice(0, P.scenes.length).forEach((f, i) => {
    P.images['scene-' + i] = f;
    P.credits['scene-' + i] = { kind: 'chatgpt' };
    if (P.videos) delete P.videos['scene-' + i];
    renderSceneImage(i);
  });
  e.target.value = '';
  save();
  refreshPreview();
  $('#gptFramesDialog').close();
  toast(`${Math.min(files.length, P.scenes.length)} ChatGPT frames placed into scenes 1–${Math.min(files.length, P.scenes.length)}.${files.length > P.scenes.length ? ` ${files.length - P.scenes.length} extra image(s) ignored.` : ''}`, false, 6000);
});

async function doPortraits(signal, { onlyMissing = true } = {}) {
  const list = P.characters.filter(c => !onlyMissing || !P.images['char-' + c.id]);
  list.forEach(c => triedPortraits.add(c.id));
  for (let k = 0; k < list.length; k++) {
    const c = list[k], key = 'char-' + c.id;
    markLoading(key, true);
    const seed = P.seed + 1000 + k + (onlyMissing ? 0 : Math.floor(Math.random() * 999));
    setStatus(`Designing ${c.name}…`, `Character ${k + 1} of ${list.length}`, k / list.length);
    try {
      P.images[key] = await paintImage(portraitPrompt(P, c), {
        width: 768, height: 1024, seed, signal,
        onWait: sec => setStatus(`Designing ${c.name}…`, `Character ${k + 1} of ${list.length} · free tier: next image in ${sec}s`, k / list.length)
      });
      P.credits[key] = { kind: 'ai', seed };
      save();
    } catch (e) {
      // A busy image service shouldn't stop the film: the card keeps its placeholder.
      if (e instanceof Cancelled) throw e;
      toast(`Couldn't design ${c.name}'s portrait right now. Use 🎨 on the card to retry later.`, true, 5000);
    } finally { markLoading(key, false); renderCast(); }
  }
}

function sceneSize() {
  const f = P.options.format;
  return f === '9:16' ? [720, 1280] : f === '1:1' ? [1024, 1024] : [1280, 720];
}
async function paintScene(i, signal, reseed = false, source = P.options.visuals) {
  const key = 'scene-' + i, sc = P.scenes[i];
  const [w, h] = sceneSize();
  const seed = P.seed + i * 7 + (reseed ? Math.floor(Math.random() * 9999) : 0);
  markLoading(key, true);
  if (P.videos) delete P.videos[key]; // a new picture needs a new clip
  try {
    if (source === 'stock') {
      try {
        const used = new Set(Object.values(P.credits).map(c => c.id).filter(Boolean));
        const r = await stockImage(sc.stock, P.options.format, used, signal);
        P.images[key] = r.blob; P.credits[key] = r.credit;
        return;
      } catch (e) { if (e instanceof Cancelled) throw e; console.warn(e.message, '→ painting instead'); }
    }
    try {
      const img = await paintImage(scenePrompt(P, sc), {
        width: w, height: h, seed, signal,
        onWait: sec => setStatus('Painting scenes…', `Scene ${i + 1} of ${P.scenes.length} · free tier: next image in ${sec}s`)
      });
      // a frame the person uploaded meanwhile wins over the free painting
      if (['chatgpt', 'user'].includes(P.credits[key]?.kind)) return;
      P.images[key] = img;
      P.credits[key] = { kind: 'ai', seed };
    } catch (e) {
      // Busy image service: use a public-domain photo so the film can still finish.
      if (e instanceof Cancelled || source === 'stock') throw e;
      const used = new Set(Object.values(P.credits).map(c => c.id).filter(Boolean));
      const r = await stockImage(sc.stock, P.options.format, used, signal);
      P.images[key] = r.blob; P.credits[key] = r.credit;
    }
  } finally { markLoading(key, false); renderSceneImage(i); save(); }
}
async function doVisuals(signal) {
  const todo = P.scenes.map((_, i) => i).filter(i => !P.images['scene-' + i]);
  let done = 0;
  const step = async i => {
    setStatus('Painting scenes…', `Scene ${i + 1} of ${P.scenes.length}`, done / todo.length);
    await paintScene(i, signal);
    done++;
    setStatus('Painting scenes…', `${done} of ${todo.length} done`, done / todo.length);
  };
  if (hasKey() || P.options.visuals === 'stock') {
    const q = [...todo];
    await Promise.all(Array.from({ length: 3 }, async () => { while (q.length) await step(q.shift()); }));
  } else for (const i of todo) await step(i);
}

// ============ AI video clips ============
const CAMERA_WORDS = {
  'push-in': 'the camera slowly pushes in', 'pull-out': 'the camera slowly pulls back', 'pan-left': 'the camera pans left',
  'pan-right': 'the camera pans right', 'tilt-up': 'the camera tilts up', 'tilt-down': 'the camera tilts down', drift: 'the camera drifts gently'
};
function motionPrompt(sc) {
  return `${sc.visual} Natural, lifelike motion: characters move and breathe naturally, hair and clothes move in the air, the environment is alive. ${CAMERA_WORDS[sc.camera] || 'smooth camera motion'}. Cinematic, film look, consistent faces.`;
}
// Animate scene i. Fail rather than substituting a moving still image.
async function animateOne(i, signal, loud = false) {
  const key = 'scene-' + i;
  markLoading(key, true);
  try {
    const r = await animateScene(P.images[key], motionPrompt(P.scenes[i]), {
      format: P.options.format, seconds: 5, signal,
      onStatus: msg => setStatus('Turning scenes into video…', `Scene ${i + 1}: ${msg}`)
    });
    (P.videos ||= {})[key] = r.blob;
    P.credits['video-' + i] = { kind: 'video', model: r.model };
    return true;
  } catch (e) {
    if (e instanceof Cancelled) throw e;
    if (isQuotaError(e)) {
      throw new Error(`Free AI video quota exhausted. Retry in ${quotaRefillText()}. Completed clips are saved; no still-image substitute will be exported.`);
    }
    throw new Error(`Scene ${i + 1} video generation failed: ${e.message}. Completed clips are saved. Retry this scene or Animate all scenes.`);
  } finally { markLoading(key, false); renderSceneImage(i); save(); }
}
async function doAnimate(signal) {
  if (!videoQuotaLeft()) {
    if (missingVideoScenes(P).length) {
      throw new Error(`Free AI video quota exhausted. Retry in ${quotaRefillText()}. Completed clips are saved; no photo-animation substitute was exported.`);
    }
    return;
  }
  // The free allowance covers only a few clips, so the scenes that matter most go
  // first: the opening hook, the ending, the climax, then the rest spread out.
  const n = P.scenes.length, key = [0, n - 1, Math.round((n - 1) * 0.7), Math.round((n - 1) * 0.35), Math.round((n - 1) * 0.85), Math.round((n - 1) * 0.5)];
  const order = [...new Set([...key, ...P.scenes.map((_, i) => i)])].filter(i => i >= 0 && i < n);
  const todo = order.filter(i => P.images['scene-' + i] && !P.videos?.['scene-' + i]);
  let done = 0;
  const q = [...todo];
  setStatus('Turning scenes into video…', `0 of ${todo.length} clips · free AI video (LTX-Video)`, 0);
  // one at a time: the free GPU serves one clip per visitor at once
  while (q.length) {
    const i = q.shift();
    await animateOne(i, signal);
    done++;
    setStatus('Turning scenes into video…', `${done} of ${todo.length} clips`, done / todo.length);
  }
  assertGeneratedVideo(P);
}
$('#btnAnimate').onclick = () => runJob(async signal => { if (!allPainted()) await doVisuals(signal); await doAnimate(signal); renderChecklist(); });

// <video> elements for the renderer, one per animated scene (cached per clip).
const videoEls = new WeakMap();
function sceneVideos() {
  if (!requiresGeneratedVideo(P)) return Promise.resolve([]);
  assertGeneratedVideo(P);
  return Promise.all(P.scenes.map(async (_, i) => {
    const blob = P.videos?.['scene-' + i];
    if (!blob) return null;
    if (!videoEls.has(blob)) {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.src = URL.createObjectURL(blob);
      videoEls.set(blob, new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); v.onloadeddata = null; v.onerror = null; };
        const fail = () => { cleanup(); videoEls.delete(blob); URL.revokeObjectURL(v.src); reject(new Error(`Scene ${i + 1} has an unreadable AI video clip. Regenerate that scene or use a browser supporting this video format. No image substitute was used.`)); };
        const timer = setTimeout(fail, 15000);
        v.onloadeddata = () => { if (!(v.duration > 0) || !Number.isFinite(v.duration)) return fail(); cleanup(); resolve(v); };
        v.onerror = fail;
      }));
    }
    return videoEls.get(blob);
  }));
}

// ============ voice & music ============
// Cloud voice whenever a key is available (the site relay's or the user's own):
// seconds instead of minutes. Otherwise the voice is recorded on this device.
function voiceEngine() {
  if (localStorage.getItem('vf_voice_mode') === 'kokoro' && P.language !== 'Hindi') return 'kokoro';
  return relayHasKey() || getKey() ? 'pollinations' : 'kokoro';
}
function fillNarrators() {
  const engine = voiceEngine();
  const list = engine === 'pollinations' ? POLLI_NARRATORS : KOKORO_NARRATORS;
  const sel = $('#optNarrator');
  sel.innerHTML = list.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  if (!P.narrator || !list.some(v => v[0] === P.narrator)) P.narrator = engine === 'pollinations' && P.language === 'Hindi' ? 'hi-IN-Arjun' : list[0][0];
  sel.value = P.narrator;
}
function readSoundOptions() {
  P.narrator = $('#optNarrator').value || P.narrator;
  P.speed = +$('#optSpeed').value;
  P.moodOverride = $('#optMood').value;
  P.musicVol = $('#optMusicVol').value / 100;
  P.sfx = $('#optSfx').checked;
  P.dialogueMode = $('#optDialogue').value;
  P.look = { bars: $('#optBars').checked, grain: $('#optGrain').checked, captions: $('#optCaptions').value, watermark: $('#optWatermark').checked, depth: $('#optDepth').checked };
}
const filmMood = () => (P.moodOverride && P.moodOverride !== 'auto') ? P.moodOverride : P.mood;

async function ensureVoiceEngine(signal, st = setStatus) {
  if (voiceEngine() !== 'kokoro') return;
  st('Loading the narrator voice…', 'First time only: downloading the voice model (~90 MB)', 0.02);
  await Promise.race([
    loadVoiceEngine(p => st('Loading the narrator voice…', `Downloading voice model: ${Math.round(p * 100)}%`, p)),
    new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Cancelled())))
  ]);
}

async function doVoices(signal, quiet = false) {
  const st = (t, d = '', p = null) => { voiceNote = d || t; if (!quiet) setStatus(t, d, p); };
  await relayStatus;
  fillNarrators();
  readSoundOptions();
  const engine = voiceEngine();
  P.voiceEngine = engine;
  const silent = P.language === 'Hindi' && engine !== 'pollinations';
  if (silent) toast('Hindi narration needs a Pollinations key (Settings). This film will have Hindi captions and music only.', true, 7000);
  else await ensureVoiceEngine(signal, st);
  castVoices(P.characters, engine, P.narrator, P.language);
  // Every line of every scene is queued at once; the voice engine records them in
  // parallel on the available CPU cores, and each scene keeps its own order.
  const lines = P.scenes.map(sc => {
    const out = [{ text: sc.narration, voice: P.narrator, speaker: null }];
    if (P.dialogueMode !== 'off') for (const d of sc.dialogue || []) {
      const c = P.characters.find(x => x.id === d.character);
      if (!c) continue;
      out.push(P.dialogueMode === 'voiced' ? { text: d.line, voice: c.voice, speaker: c.name } : { text: `${c.name} says: ${d.line}`, voice: P.narrator, speaker: null });
    }
    return out.filter(l => l.text);
  });
  const total = lines.flat().length;
  let done = 0;
  st('Recording narration…', `0 of ${total} lines`, 0);
  const audio = await Promise.all(lines.map(sceneLines => Promise.all(sceneLines.map(async l => {
    const buffer = silent ? silence(Math.max(2, l.text.split(/\s+/).length / 2.6)) : await speak(l.text, { engine, voice: l.voice, speed: P.speed, signal });
    done++;
    st('Recording narration…', `${done} of ${total} lines`, done / total);
    return buffer && { buffer, text: l.text, speaker: l.speaker };
  })).then(segs => segs.filter(Boolean))));
  sceneAudio = audio;
}
function silence(sec) {
  const c = window.__vfAudio ||= new AudioContext();
  return c.createBuffer(1, Math.round(sec * 24000), 24000);
}

async function doMix(signal) {
  readSoundOptions();
  if (!sceneAudio) await doVoices(signal);
  setStatus('Composing the soundtrack…', `Original ${filmMood()} score, mixed with narration`, 0.9);
  await new Promise(r => setTimeout(r, 30));
  timeline = buildTimeline(P.scenes, sceneAudio, P.options.length === 'shorts');
  mixBuf = await mixFilm(timeline, { mood: filmMood(), seed: P.seed, musicVol: P.musicVol, sfx: P.sfx });
  P.mood = P.mood || 'epic';
  video = null; $('#downloadBox').hidden = true;
  save();
}

// ============ automatic pipeline ============
$('#btnAuto').onclick = () => (autoRender = true, runJob(async signal => {
  await doStory(signal);
  goStep('story');
  // narration runs on this device while the image service paints, so they overlap
  readSoundOptions();
  let voiceErr = null;
  const voices = (async () => {
    try { await doVoices(signal, true); } catch (e) { voiceErr = e; }
  })();
  goStep('characters');
  await doPortraits(signal);
  goStep('scenes');
  await doVisuals(signal);
  await waitVoices(voices);
  if (voiceErr) throw voiceErr;
  await doMix(signal);
  goStep('film');
}).then(ok => { if (!ok) autoRender = false; }));
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
  const voices = castOptions(voiceEngine());
  $('#castGrid').innerHTML = P.characters.map(c => {
    const img = P.images['char-' + c.id];
    return `<article class="cast-card" data-char="${c.id}">
      <div class="cast-portrait" data-img="char-${c.id}">${img ? `<img src="${blobURL('char-' + c.id, img)}" alt="${esc(c.name)} portrait">` : `<span class="initial">${esc(c.name[0] || '?')}</span>`}</div>
      <div class="cast-body">
        <span class="cast-role">${esc(c.role)} · ${esc(c.age)} ${esc(c.gender)}</span>
        <input class="c-name" value="${esc(c.name)}" aria-label="Name">
        <textarea class="c-look" rows="4" aria-label="Appearance">${esc(c.appearance)}</textarea>
        <p class="tiny muted">${esc(c.personality)}</p>
        <div class="row">
          <select class="c-voice" title="Character voice"><option value="">Auto voice</option>${voices.map(v => `<option ${c.voice === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <button class="btn btn-ghost btn-sm c-hear" title="Hear voice">▶</button>
          <button class="btn btn-ghost btn-sm c-repaint" title="Redesign portrait">🎨</button>
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
  if (!e.target.classList.contains('c-voice')) return;
  const c = P.characters.find(x => x.id === e.target.closest('[data-char]').dataset.char);
  c.voice = e.target.value || undefined; sceneAudio = null; mixBuf = null; save();
});
$('#castGrid').addEventListener('click', e => {
  const card = e.target.closest('[data-char]'); if (!card) return;
  const c = P.characters.find(x => x.id === card.dataset.char);
  if (e.target.closest('.c-repaint')) runJob(async signal => {
    delete P.images['char-' + c.id];
    await doPortraits(signal, { onlyMissing: true });
  });
  if (e.target.closest('.c-hear')) runJob(async signal => {
    castVoices(P.characters, voiceEngine(), P.narrator, P.language);
    await ensureVoiceEngine(signal);
    setStatus(`Voicing ${c.name}…`);
    const line = P.scenes.flatMap(s => s.dialogue || []).find(d => d.character === c.id)?.line || `Hello, my name is ${c.name}.`;
    playBuffer(await speak(line, { engine: voiceEngine(), voice: c.voice, speed: P.speed || 1, signal }));
    renderCast();
  });
});

function renderScenes() {
  const fmt = P.options?.format;
  const cls = fmt === '9:16' ? 'portrait' : fmt === '1:1' ? 'square' : '';
  const cams = ['push-in', 'pull-out', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down', 'drift'];
  const amb = ['none', 'rain', 'wind', 'ocean', 'fire', 'forest', 'city', 'night', 'cave'];
  $('#scenesSummary').textContent = `${P.scenes.length} scenes · ${P.options?.visuals === 'stock' ? 'public-domain photos' : 'AI-painted'} · ${fmt || '16:9'}`;
  $('#sceneList').innerHTML = P.scenes.map((s, i) => `
    <article class="scene-card" data-scene="${i}">
      <div class="scene-img ${cls}" data-img="scene-${i}"><span class="badge">${i + 1}</span><span class="ph">Not painted yet</span></div>
      <div class="scene-body">
        <h3>${esc(s.title)}</h3>
        <textarea class="s-narr" rows="3" aria-label="Narration">${esc(s.narration)}</textarea>
        ${(s.dialogue || []).map(d => `<div class="dialogue"><b>${esc(P.characters.find(c => c.id === d.character)?.name || '')}:</b> “${esc(d.line)}”</div>`).join('')}
        <div class="scene-meta">
          <select class="s-cam" title="Camera move">${cams.map(c => `<option ${c === s.camera ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <select class="s-amb" title="Ambient sound">${amb.map(c => `<option ${c === s.ambience ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <button class="btn btn-ghost btn-sm s-animate">🎬 Animate</button>
          <button class="btn btn-ghost btn-sm s-play">▶ Play clip</button>
          <button class="btn btn-ghost btn-sm s-clip">⬇ Clip MP4</button>
          <button class="btn btn-ghost btn-sm s-repaint">🎨 AI paint</button>
          <button class="btn btn-ghost btn-sm s-photo">📷 Other photo</button>
          <button class="btn btn-ghost btn-sm s-rewrite">✍️ Rewrite</button>
          <label class="btn btn-ghost btn-sm">⬆ My image<input type="file" accept="image/*" class="s-upload" hidden></label>
        </div>
        <p class="credit-line" data-credit="${i}"></p>
      </div>
    </article>`).join('');
  P.scenes.forEach((_, i) => renderSceneImage(i));
}
function renderSceneImage(i) {
  const box = document.querySelector(`[data-img="scene-${i}"]`);
  if (!box) return;
  const blob = P.images['scene-' + i], clip = P.videos?.['scene-' + i];
  box.querySelectorAll('img, video:not(.clip-canvas)').forEach(el => el.remove());
  box.querySelector('.ph').hidden = !!blob;
  // the AI clip loops silently in the card; otherwise the still picture
  if (clip) box.insertAdjacentHTML('beforeend', `<video src="${blobURL('clip-' + i, clip)}" autoplay loop muted playsinline aria-label="Scene ${i + 1} clip"></video>`);
  else if (blob) box.insertAdjacentHTML('beforeend', `<img src="${blobURL('scene-' + i, blob)}" alt="Scene ${i + 1}">`);
  const c = P.credits['scene-' + i], cl = document.querySelector(`[data-credit="${i}"]`);
  const vc = P.credits['video-' + i];
  if (cl) cl.textContent = (!c ? '' : c.kind === 'ai' ? `AI-generated · seed ${c.seed}` : c.kind === 'user' ? 'Your own image. Make sure you hold the rights.' : c.kind === 'chatgpt' ? '🤖 Made with your ChatGPT' : `📷 “${c.title}” by ${c.creator} · ${c.license} · via ${c.provider}`)
    + (clip && vc ? ` · 🎬 animated with ${vc.model}` : '');
  updateStepper();
}
$('#sceneList').addEventListener('input', e => {
  const card = e.target.closest('[data-scene]'); if (!card || !e.target.classList.contains('s-narr')) return;
  P.scenes[+card.dataset.scene].narration = e.target.value;
  sceneAudio = null; mixBuf = null; save();
});
$('#sceneList').addEventListener('change', e => {
  const card = e.target.closest('[data-scene]'); if (!card) return;
  const i = +card.dataset.scene, sc = P.scenes[i];
  if (e.target.classList.contains('s-cam')) { sc.camera = e.target.value; refreshPreview(); }
  if (e.target.classList.contains('s-amb')) { sc.ambience = e.target.value; mixBuf = null; }
  if (e.target.classList.contains('s-upload') && e.target.files[0]) {
    P.images['scene-' + i] = e.target.files[0];
    if (P.videos) delete P.videos['scene-' + i];
    P.credits['scene-' + i] = { kind: 'user' };
    renderSceneImage(i); refreshPreview();
  }
  save();
});
$('#sceneList').addEventListener('click', e => {
  const card = e.target.closest('[data-scene]'); if (!card) return;
  const i = +card.dataset.scene;
  if (e.target.closest('.s-play')) playSceneClip(i, card).catch(error => toast(error.message, true, 10000));
  if (e.target.closest('.s-animate')) runJob(async signal => {
    if (!P.images['scene-' + i]) await paintScene(i, signal);
    delete P.videos?.['scene-' + i];
    await animateOne(i, signal, true);
    renderChecklist();
  });
  if (e.target.closest('.s-clip')) exportSceneClip(i);
  if (e.target.closest('.s-repaint')) runJob(async signal => { setStatus('Painting scene ' + (i + 1) + '…'); await paintScene(i, signal, true, 'ai'); refreshPreview(); });
  if (e.target.closest('.s-photo')) runJob(async signal => { setStatus('Finding another public-domain photo…'); await paintScene(i, signal, true, 'stock'); refreshPreview(); });
  if (e.target.closest('.s-rewrite')) runJob(async signal => {
    setStatus('Rewriting scene ' + (i + 1) + '…');
    P.scenes[i].narration = await rewriteScene(P, i, { signal, onWait: s => setStatus('Rewriting scene ' + (i + 1) + '…', s ? `Free writer is busy, starting in ${s}s` : 'Writing…') });
    card.querySelector('.s-narr').value = P.scenes[i].narration;
    sceneAudio = null; mixBuf = null; save();
  });
});

// ============ previews on the sound step ============
let stopPreview = null;
$('#btnPreviewVoice').onclick = () => runJob(async signal => {
  readSoundOptions();
  stopPreview?.();
  if (P.language === 'Hindi' && voiceEngine() !== 'pollinations') throw new Error('Hindi narration needs a Pollinations key (Settings).');
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
['#optBars', '#optGrain', '#optCaptions', '#optWatermark', '#optDepth'].forEach(s => $(s).addEventListener('change', () => { readSoundOptions(); refreshPreview(); save(); }));

// ============ player ============
const player = {
  canvas: $('#playerCanvas'), ctx: $('#playerCanvas').getContext('2d', { alpha: false }),
  renderer: null, buf: null, ac: null, src: null, startAt: 0, offset: 0, playing: false, raf: 0,
  load(renderer, buf) {
    this.pause(); this.renderer = renderer; this.buf = buf; this.offset = 0;
    this.canvas.width = renderer.W; this.canvas.height = renderer.H;
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
  }
};
let seeking = false;
$('#seek').addEventListener('pointerdown', () => seeking = true);
$('#seek').addEventListener('input', e => { if (player.buf) { player.offset = e.target.value / 1000 * player.buf.duration; if (!player.playing) { player.draw(); player.updateUI(); } } });
$('#seek').addEventListener('change', e => { seeking = false; player.seek(e.target.value / 1000 * (player.buf?.duration || 0)); });
$('#btnPlay').onclick = () => player.playing ? player.pause() : player.play();
$('#btnBigPlay').onclick = () => player.play();

async function sceneBitmaps() {
  const out = [];
  for (let i = 0; i < P.scenes.length; i++) out.push(await bitmapFor('scene-' + i));
  return out;
}
// Depth maps for the 3D camera (computed once per picture in the browser).
function sceneDepths() {
  if (P.look?.depth === false) return Promise.resolve([]);
  return Promise.all(P.scenes.map((_, i) => depthFor(P.images['scene-' + i])));
}
async function previewRenderer() {
  const { W, H } = sizeFor(P.options.format, 1080);
  const k = Math.min(1, 960 / Math.max(W, H));
  return new Renderer(P, await sceneBitmaps(), timeline, Math.round(W * k), Math.round(H * k), await sceneDepths(), await sceneVideos(), brand);
}
async function refreshPreview() {
  if (missingVideoScenes(P).length) { player.unload(); video = null; $('#downloadBox').hidden = true; updateMotionStatus(); return; }
  if (!timeline || !mixBuf || $('[data-panel=film]').hidden) return;
  const t = player.time();
  player.load(await previewRenderer(), mixBuf);
  player.seek(t);
}

async function enterFilm() {
  await document.fonts.load('700 40px Cinzel'); await document.fonts.load('800 40px Inter');
  renderMeta(); renderChecklist(); renderShare();
  $('#filmTitle').textContent = P.title;
  // Arriving here with missing portraits, scenes or sound (e.g. after "write the
  // story first"): make them now instead of rendering placeholders.
  const noPortrait = () => P.characters.some(c => !P.images['char-' + c.id] && !triedPortraits.has(c.id));
  let generated = false;
  const noClips = () => missingVideoScenes(P).length > 0;
  if (!job && (noPortrait() || !allPainted() || !mixBuf || noClips())) {
    $('#filmMeta').textContent = 'Designing characters, painting scenes and recording the voice before your film can play…';
    const ok = await runJob(signal => ensureFilmParts(signal));
    renderChecklist();
    if (!ok) return;
    generated = true;
  }
  if (!mixBuf) return;
  assertGeneratedVideo(P);
  renderChecklist();
  $('#filmMeta').textContent = `${fmtTime(mixBuf.duration)} · ${P.scenes.length} scene clips joined into one film · ${P.options.format} · ${filmMood()} score`;
  player.load(await previewRenderer(), mixBuf);
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
  if (!requiresGeneratedVideo(P) && P.look?.depth !== false) {
    setStatus('Adding 3D camera motion…', 'Measuring depth in each scene (in your browser)', 0.9);
    await sceneDepths();
  }
  if (requiresGeneratedVideo(P)) await doAnimate(signal);
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
  if (!mixBuf || missingVideoScenes(P).length) {
    toast('Making the voice and music for your clips first…');
    const ok = await runJob(signal => ensureFilmParts(signal));
    if (!ok) return;
  }
  const box = card.querySelector('.scene-img');
  const s = timeline.scenes[i];
  const { W, H } = sizeFor(P.options.format, 1080);
  const k = Math.min(1, 640 / Math.max(W, H));
  const r = new Renderer(P, await sceneBitmaps(), timeline, Math.round(W * k), Math.round(H * k), await sceneDepths(), await sceneVideos(), brand);
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
    if (!mixBuf || missingVideoScenes(P).length) await ensureFilmParts(signal);
    assertGeneratedVideo(P);
    const s = timeline.scenes[i];
    const q = +(localStorage.getItem('vf_quality') || 1080);
    const { W, H } = sizeFor(P.options.format, q);
    await document.fonts.load('700 40px Cinzel');
    const full = new Renderer(P, await sceneBitmaps(), timeline, W, H, await sceneDepths(), await sceneVideos(), brand);
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
// The full-length film: every scene clip, in order, with transitions, title and end card.
const renderFull = () => runJob(async signal => {
  player.pause();
  clipStop?.();
  if (!mixBuf || !allPainted() || missingVideoScenes(P).length) await ensureFilmParts(signal);
  assertGeneratedVideo(P);
  const q = +(localStorage.getItem('vf_quality') || 1080);
  const { W, H } = sizeFor(P.options.format, q);
  await document.fonts.load('700 40px Cinzel');
  const renderer = new Renderer(P, await sceneBitmaps(), timeline, W, H, await sceneDepths(), await sceneVideos(), brand);
  $('#renderBox').hidden = false; $('#downloadBox').hidden = true;
  setStatus('Rendering your film…', `${W}×${H}`, 0);
  const blob = await exportFilm({
    renderer, audio: mixBuf, W, H, signal,
    onProgress: (p, eta) => {
      const txt = `${Math.round(p * 100)}% · about ${Math.max(1, Math.round(eta))}s left`;
      $('#renderBar').style.width = (p * 100).toFixed(1) + '%'; $('#renderText').textContent = txt;
      setStatus('Rendering your film…', `${W}×${H} · ${txt}`, p);
    }
  }).finally(() => { $('#renderBox').hidden = true; });
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  video = { blob, name: `${slug(P.title)}.${ext}`, downloaded: false };
  const a = $('#dlVideo');
  a.href = blobURL('video', blob); a.download = video.name;
  a.textContent = `⬇ Download ${ext.toUpperCase()} (${(blob.size / 1048576).toFixed(1)} MB)`;
  $('#downloadBox').hidden = false;
  $('#btnNativeShare').hidden = !(navigator.canShare && navigator.canShare({ files: [new File([blob], video.name, { type: blob.type })] }));
  toast(`✅ Full film ready: ${P.scenes.length} scene clips joined into one ${ext.toUpperCase()}. Download or share it below.`, false, 7000);
});
$('#dlVideo').addEventListener('click', () => { if (video) video.downloaded = true; });
$('#dlCredits').onclick = () => download(new Blob([CR.credits(P)], { type: 'text/plain' }), `${slug(P.title)}-licence-report.txt`);
$('#dlSrt').onclick = () => timeline && download(new Blob([srt(timeline)], { type: 'text/plain' }), `${slug(P.title)}.srt`);
$('#dlThumb').onclick = async () => {
  const { W, H } = sizeFor(P.options.format, 1080);
  const c = new OffscreenCanvas(W, H);
  const r = new Renderer({ ...P, look: { ...P.look, captions: 'none' } }, await sceneBitmaps(), timeline, W, H, await sceneDepths(), await sceneVideos(), brand);
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
  updateMotionStatus();
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
  try {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const s = Math.max(256 / bmp.width, 256 / bmp.height);
    c.getContext('2d').drawImage(bmp, (256 - bmp.width * s) / 2, (256 - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    await saveBrand({ logo: c.toDataURL('image/png') });
    toast('Logo added. It appears on every film.');
  } catch { toast('Could not read that image. Try a PNG or JPG.', true); }
}
['#brandLogo', '#brandLogo2'].forEach(s => $(s).addEventListener('change', e => setLogo(e.target.files[0])));
$('#brandRemove').onclick = () => saveBrand({ logo: null });
$('#brandName').addEventListener('change', e => saveBrand({ name: e.target.value.trim() }));
$('#brandSub').addEventListener('change', e => saveBrand({ subscribe: e.target.checked }));
loadBrand();

// ============ settings ============
$('#btnSettings').onclick = () => {
  $('#setKey').value = localStorage.getItem('vf_pollen_key') || '';
  $('#setHf').value = localStorage.getItem('vf_hf_token') || '';
  $('#setEngine').value = localStorage.getItem('vf_voice_mode') || 'auto';
  $('#setQuality').value = localStorage.getItem('vf_quality') || '1080';
  $('#settingsDialog').showModal();
};
$('#settingsDialog').addEventListener('close', () => {
  if ($('#settingsDialog').returnValue !== 'save') return;
  const k = $('#setKey').value.trim();
  if (k) localStorage.setItem('vf_pollen_key', k); else localStorage.removeItem('vf_pollen_key');
  localStorage.setItem('vf_voice_mode', $('#setEngine').value);
  localStorage.setItem('vf_quality', $('#setQuality').value);
  const hf = $('#setHf').value.trim();
  if (hf) localStorage.setItem('vf_hf_token', hf); else localStorage.removeItem('vf_hf_token');
  sceneAudio = null; mixBuf = null;
  speedNote();
  toast('Settings saved.');
});

// ============ hero animation ============
let heroRAF = 0;
function startHero() {
  const c = $('#heroCanvas'); if (!c || heroRAF) return;
  const x = c.getContext('2d');
  const dots = Array.from({ length: 70 }, (_, i) => ({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 3, s: 0.2 + Math.random(), h: i % 3 }));
  const frame = t => {
    const w = c.width = c.clientWidth * devicePixelRatio, h = c.height = c.clientHeight * devicePixelRatio;
    const g = x.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.35, w * 0.7);
    g.addColorStop(0, '#2a1a3e'); g.addColorStop(0.5, '#140f22'); g.addColorStop(1, '#0b0a12');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    // drifting film frames
    x.save(); x.globalAlpha = 0.08; x.strokeStyle = '#f5b544'; x.lineWidth = 2 * devicePixelRatio;
    for (let k = 0; k < 7; k++) {
      const fw = w * 0.16, fh = fw * 0.56, px = ((k * 0.17 + t * 0.00002 * (k % 2 ? 1 : -1)) % 1.2 - 0.1) * w, py = h * (0.15 + (k * 0.13) % 0.75);
      x.strokeRect(px, py, fw, fh);
    }
    x.restore();
    for (const d of dots) {
      const px = (d.x * w + Math.sin(t * 0.0003 * d.s + d.y * 9) * 40) % w, py = ((d.y * h - t * 0.02 * d.s) % h + h) % h;
      const col = ['245,181,68', '255,122,61', '194,107,255'][d.h];
      x.fillStyle = `rgba(${col},${0.25 + 0.35 * Math.sin(t * 0.002 * d.s + d.x * 20) ** 2})`;
      x.shadowColor = `rgba(${col},1)`; x.shadowBlur = 12;
      x.beginPath(); x.arc(px, py, d.r * devicePixelRatio, 0, 7); x.fill();
    }
    x.shadowBlur = 0;
    heroRAF = requestAnimationFrame(frame);
  };
  heroRAF = requestAnimationFrame(frame);
}
function stopHero() { cancelAnimationFrame(heroRAF); heroRAF = 0; }

// ============ boot ============
$('#year').textContent = new Date().getFullYear();
setAuthMode('signin');
const mode = await Auth.initAuth();
$('#authModeNote').textContent = mode === 'local' ? 'Accounts are saved on this device.' : 'Secured by Google Firebase Authentication.';
if (mode === 'local') $('#btnGoogle').hidden = true, $('.divider').hidden = true;
show('landing');

function updateMotionStatus() {
  const target = $('#motionStatus');
  if (!target || !P) return;
  const count = P.scenes?.length || 0;
  if (!count) { target.textContent = 'Write a story before generating motion clips.'; return; }
  if (!requiresGeneratedVideo(P)) {
    target.textContent = 'Photo-animation mode selected. This uses moving still images, not AI-generated footage.';
    return;
  }
  const missing = missingVideoScenes(P).length;
  target.textContent = `${count - missing} / ${count} genuine AI video clips ready. ${missing ? 'Generation must finish for every scene before export. Completed clips are kept for retry.' : 'All scenes have generated clips.'} Providers: LTX-Video / Wan 2.2. Google Flow and dialogue lip-sync are not connected.`;
}
