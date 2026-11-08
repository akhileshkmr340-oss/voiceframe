// Characters follow the login (2026-11-07): a copy of every character saved to the
// directory is kept in the signed-in person's own Firebase account (Cloud Firestore, free
// tier), so signing in on any device brings them back. Only that person can read, change or
// delete their copies (firestore.rules). Device-only accounts (local testing), and a
// project whose Firestore is not switched on yet, simply stay on this device.
//
// One document per character: users/{uid}/characters/{lid} = { data: <the character file
// as JSON, pictures made smaller>, updatedAt: <ms> }. Plain REST with the person's ID token.
import { idToken, authMode, currentUser } from './auth.js?v=63';

const deps = { fetch: (...a) => fetch(...a), token: idToken, mode: authMode, user: currentUser, projectId: () => window.VF_CONFIG?.firebase?.projectId };
// (tests swap the network and the login)
export function _testDeps(d) { Object.assign(deps, d); state.off = false; state.why = ''; }

const state = { off: false, why: '' };
const base = uid => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(deps.projectId())}/databases/(default)/documents/users/${encodeURIComponent(uid)}/characters`;
export const MAX_CLOUD = 100; // characters a person keeps in their account
const LID = /^ch-[a-z0-9]{4,16}$/;

// whether copies can go to the account now (a signed-in Firebase login, Firestore reachable)
export const cloudOn = () => !state.off && deps.mode() === 'firebase' && !!deps.projectId() && !!deps.user()?.uid;
export const cloudWhy = () => state.why;

async function call(url, init = {}) {
  const tok = await deps.token();
  if (!tok) throw Object.assign(new Error('not signed in'), { quiet: true });
  const r = await deps.fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + tok, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (r.ok) return r.status === 204 ? null : r.json();
  const text = await r.text().catch(() => '');
  // Firestore not switched on in the project (or no database): stop trying for this visit
  if (r.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(text) || r.status === 404 && /database|does not exist/i.test(text) && !/Document/i.test(text)) {
    state.off = true; state.why = 'Saving to your account is not switched on yet.';
    throw Object.assign(new Error(state.why), { quiet: true });
  }
  throw new Error(`account save ${r.status}: ${text.slice(0, 120)}`);
}

// the character's copy in the account (replaces any older one)
// (updatedAt: the device copy's own time, so this device never takes its own copy for a newer one)
export async function putCloud(lid, file, updatedAt = Date.now()) {
  if (!cloudOn() || !LID.test(lid)) return false;
  const data = JSON.stringify(file);
  if (data.length > 950000) throw new Error('this character is too big to keep in your account (pictures too large)');
  await call(`${base(deps.user().uid)}/${lid}`, { method: 'PATCH', body: JSON.stringify({ fields: { data: { stringValue: data }, updatedAt: { integerValue: String(Math.round(updatedAt)) } } }) });
  return true;
}
export async function deleteCloud(lid) {
  if (!cloudOn() || !LID.test(lid)) return false;
  await call(`${base(deps.user().uid)}/${lid}`, { method: 'DELETE' }).catch(e => { if (!/ 404/.test(e.message)) throw e; });
  return true;
}
// every copy in the account: [{ lid, updatedAt, file }]
export async function listCloud() {
  if (!cloudOn()) return [];
  const out = [];
  let page = '';
  do {
    const j = await call(`${base(deps.user().uid)}?pageSize=100${page ? '&pageToken=' + encodeURIComponent(page) : ''}`);
    for (const d of j?.documents || []) {
      const lid = String(d.name || '').split('/').pop();
      if (!LID.test(lid)) continue;
      try { out.push({ lid, updatedAt: +(d.fields?.updatedAt?.integerValue || 0), file: JSON.parse(d.fields?.data?.stringValue || 'null') }); }
      catch { /* an unreadable copy is left out */ }
    }
    page = j?.nextPageToken || '';
  } while (page && out.length < MAX_CLOUD * 2);
  return out;
}

// pictures for the account copy: a portrait up to 640 px and a sheet up to 1280 px (JPEG),
// so a character fits in one document (1 MB)
export async function smaller(blob, max) {
  if (!blob || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return blob;
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (k === 1 && blob.size < 250000) { bmp.close(); return blob; }
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
}
