// The dialogue editor: every spoken line of the film, shot by shot, in the film's language and
// script, with its speaker (a character or the narrator), its words (right-to-left for
// Arabic, Hebrew, Urdu…), how it is delivered, and on request its English meaning.
// An edit re-voices only that line (the voice cache keeps every other line) and marks only
// that shot's lip-sync as out of date.
import { chat, parseJSON } from './ai.js?v=66';
import { findLanguage, isRTL, isRTLText, ensureScriptFont } from './langs.js?v=66';
import { DELIVERIES } from './voicebook.js?v=66';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let ctx = null; // { P(), save(), toast(), lineEdited(shot, {voice, lips}), hearLine(shot, k) }

// Every spoken line: { shot, k (-1 = narration), speaker ('narrator' | character id), text, delivery, en }
export function spokenLines(P) {
  const out = [];
  P.scenes.forEach((sc, i) => {
    if (sc.narration) out.push({ shot: i, k: -1, speaker: 'narrator', text: sc.narration, delivery: sc.narrDelivery || '', en: sc.narrEn?.text === sc.narration ? sc.narrEn.en : '' });
    (sc.dialogue || []).forEach((d, k) => { if (d.line != null) out.push({ shot: i, k, speaker: d.character, text: d.line, delivery: d.delivery || '', en: d.en?.text === d.line ? d.en.en : '' }); });
  });
  return out;
}
const DELIVERY_LABEL = { '': 'Natural', calm: '😌 Calm', happy: '😊 Happy', angry: '😠 Angry', sad: '😢 Sad', whisper: '🤫 Whisper', shout: '📢 Shout' };
let showEn = false;
export function openDialogue() {
  const P = ctx.P();
  if (!P?.scenes?.length) { ctx.toast('Write the story first.'); return; }
  render();
  $('#dialogueDlg').showModal();
  ensureScriptFont(P.language, spokenLines(P).map(l => l.text).join(' ')).catch(() => {});
}
function render() {
  const P = ctx.P(), lang = findLanguage(P.language), rtl = isRTL(P.language);
  const lines = spokenLines(P);
  $('#dlLang').textContent = `${lang ? (lang.name === lang.native ? lang.name : `${lang.name} · ${lang.native}`) : P.language || 'English'} · ${lines.length} spoken line${lines.length === 1 ? '' : 's'}${rtl ? ' · right to left' : ''}`;
  $('#dlMeaning').textContent = showEn ? '🌐 Hide English meaning' : '🌐 Show English meaning';
  $('#dlMeaning').hidden = !lang || lang.name === 'English';
  const speakers = [['narrator', '🎙 Narrator'], ...P.characters.map(c => [c.id, c.name])];
  let last = -1;
  $('#dlList').innerHTML = lines.map(l => {
    const head = l.shot !== last ? `<div class="dl-shot">Shot ${l.shot + 1}${P.scenes[l.shot].title ? ' · ' + esc(P.scenes[l.shot].title) : ''}${P.videos?.['scene-' + l.shot] ? ' <span class="tiny muted">(moving clip: an edited line needs its lips re-synced)</span>' : ''}</div>` : '';
    last = l.shot;
    const custom = l.delivery && !DELIVERIES.includes(l.delivery);
    const dir = rtl || isRTLText(l.text) ? 'rtl' : 'auto';
    return `${head}<div class="dl-row" data-shot="${l.shot}" data-k="${l.k}">
      <select class="dl-speaker" aria-label="Speaker">${speakers.map(([v, n]) => `<option value="${esc(v)}"${v === l.speaker ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <textarea class="dl-text" rows="2" dir="${dir}" lang="${esc(lang?.code || 'en')}" aria-label="Line">${esc(l.text)}</textarea>
      <div class="dl-del">
        <select class="dl-delivery" aria-label="Delivery">${Object.entries(DELIVERY_LABEL).map(([v, n]) => `<option value="${v}"${(custom ? '' : l.delivery) === v && !(custom && v === '') ? ' selected' : ''}>${n}</option>`).join('')}<option value="custom"${custom ? ' selected' : ''}>✏ Custom…</option></select>
        <input class="dl-custom" ${custom ? '' : 'hidden'} value="${esc(custom ? l.delivery : '')}" placeholder="e.g. tired and slow" maxlength="60" aria-label="Custom delivery">
        <button type="button" class="btn btn-ghost btn-sm dl-hear" title="Hear this line">▶</button>
      </div>
      ${showEn ? `<p class="dl-en">${l.en ? esc(l.en) : '<span class="muted">…</span>'}</p>` : ''}
    </div>`;
  }).join('') || '<p class="muted">No spoken lines yet.</p>';
}
const lineAt = (P, i, k) => k < 0 ? { get: () => P.scenes[i].narration, set: t => { P.scenes[i].narration = t; } } : { get: () => P.scenes[i].dialogue[k].line, set: t => { P.scenes[i].dialogue[k].line = t; } };
function rowOf(e) { const r = e.target.closest('.dl-row'); return r && { r, i: +r.dataset.shot, k: +r.dataset.k }; }
function setDelivery(P, i, k, v) {
  const sc = P.scenes[i];
  if (k < 0) { if (v) sc.narrDelivery = v; else delete sc.narrDelivery; }
  else { const d = sc.dialogue[k]; if (v) d.delivery = v; else delete d.delivery; }
}
// A line given to another speaker: narration becomes a character's line, or the other way.
function moveSpeaker(P, i, k, to) {
  const sc = P.scenes[i];
  if (k < 0) {
    if (to === 'narrator') return;
    (sc.dialogue ||= []).unshift({ character: to, line: sc.narration, ...(sc.narrDelivery ? { delivery: sc.narrDelivery } : {}) });
    sc.narration = ''; delete sc.narrDelivery; delete sc.narrEn;
    return;
  }
  const d = sc.dialogue[k];
  if (to !== 'narrator') { d.character = to; delete d.en; return; }
  sc.narration = [sc.narration, d.line].filter(Boolean).join(' ');
  if (d.delivery) sc.narrDelivery = d.delivery;
  sc.dialogue.splice(k, 1);
}
async function meanings() {
  const P = ctx.P();
  const todo = spokenLines(P).filter(l => !l.en && l.text.trim());
  if (!todo.length) { render(); return; }
  $('#dlMeaning').disabled = true; $('#dlState').textContent = `Asking the writer for the English meaning of ${todo.length} line${todo.length === 1 ? '' : 's'}…`;
  try {
    for (let a = 0; a < todo.length; a += 40) {
      const part = todo.slice(a, a + 40);
      const reply = await chat([
        { role: 'system', content: 'You translate film dialogue into plain English for the film-maker. Reply with ONLY valid JSON.' },
        { role: 'user', content: `Give the English meaning of each numbered ${P.language} line (natural English, same tone, names kept).\n${part.map((l, n) => `${n + 1}. ${l.text}`).join('\n')}\nJSON: {"en":["meaning of line 1", "..."]} with exactly ${part.length} items in order.` }
      ], { temperature: 0.2 });
      const en = parseJSON(reply).en || [];
      part.forEach((l, n) => {
        const t = String(en[n] || '').slice(0, 300); if (!t) return;
        const sc = P.scenes[l.shot];
        if (l.k < 0) sc.narrEn = { text: l.text, en: t }; else sc.dialogue[l.k].en = { text: l.text, en: t };
      });
    }
    ctx.save(); $('#dlState').textContent = '';
  } catch (e) { $('#dlState').textContent = 'The English meaning could not be fetched: ' + e.message; }
  finally { $('#dlMeaning').disabled = false; render(); }
}
function wire() {
  $('#dlList').addEventListener('change', e => {
    const x = rowOf(e); if (!x) return;
    const P = ctx.P(), t = e.target;
    if (t.classList.contains('dl-text')) {
      const L = lineAt(P, x.i, x.k), v = t.value.replace(/\s+/g, ' ').trim();
      if (v === L.get()) return;
      L.set(v);
      ctx.lineEdited(x.i, { voice: true, lips: true });
      ctx.toast(`Shot ${x.i + 1}: line changed. Only this line is voiced again.`);
      render(); return;
    }
    if (t.classList.contains('dl-speaker')) { moveSpeaker(P, x.i, x.k, t.value); ctx.lineEdited(x.i, { voice: true, lips: true }); render(); return; }
    if (t.classList.contains('dl-delivery')) {
      if (t.value === 'custom') { x.r.querySelector('.dl-custom').hidden = false; x.r.querySelector('.dl-custom').focus(); return; }
      setDelivery(P, x.i, x.k, t.value); ctx.lineEdited(x.i, { voice: true, lips: false }); return;
    }
    if (t.classList.contains('dl-custom')) { setDelivery(P, x.i, x.k, t.value.trim().slice(0, 60)); ctx.lineEdited(x.i, { voice: true, lips: false }); }
  });
  $('#dlList').addEventListener('input', e => {
    const t = e.target;
    if (t.classList.contains('dl-text')) t.dir = isRTL(ctx.P().language) || isRTLText(t.value) ? 'rtl' : 'auto';
  });
  $('#dlList').addEventListener('click', e => {
    const x = rowOf(e); if (!x || !e.target.closest('.dl-hear')) return;
    // the text box's words, even before it lost focus
    const box = x.r.querySelector('.dl-text');
    if (box.value.trim() !== lineAt(ctx.P(), x.i, x.k).get()) box.dispatchEvent(new Event('change', { bubbles: true }));
    ctx.hearLine(x.i, x.k);
  });
  $('#dlMeaning').onclick = () => { showEn = !showEn; if (showEn) meanings(); else render(); };
  $('#dlClose').onclick = () => $('#dialogueDlg').close();
}
export function initDialogue(c) { ctx = c; wire(); }
export { render as renderDialogue };
