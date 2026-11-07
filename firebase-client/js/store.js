// Project library in IndexedDB (per signed-in user). A project record holds the text;
// its pictures and clips live in a separate store, one entry each, and are written once.
// Rewriting every picture and clip on each save made long films (hundreds of shots)
// lag, so a save now only writes the media that changed.
// Version 3 adds the character directory ('characters'), one record per saved character
// (its sheet, portrait, history, voice and info, all on this device). The upgrade only adds
// that store: the projects and media stores are left exactly as they are.
const DB = 'voiceframe', VER = 3;
const KINDS = ['images', 'videos', 'files']; // files: e.g. the narration a film was made from
let dbp;

function db() {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' }).createIndex('uid', 'uid');
      if (!d.objectStoreNames.contains('media')) d.createObjectStore('media'); // key: "<project id>|images|scene-3"
      if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'lid' }).createIndex('uid', 'uid');
    };
    // another tab still has the older version open: it is asked to let go (below), and
    // this page says so instead of waiting silently
    r.onblocked = () => console.warn('VoiceFrame is open in another tab with an older version: close it to finish updating your library.');
    r.onsuccess = () => {
      const d = r.result;
      // a newer version of the site opened in another tab: close, so its upgrade can run
      d.onversionchange = () => { d.close(); dbp = null; };
      // the browser closed the connection itself (storage full, site data cleared, disk
      // error): open a new one next time instead of failing every save until a reload
      d.onclose = () => { dbp = null; };
      res(d);
    };
    r.onerror = () => { dbp = null; rej(r.error); };
  });
  return dbp;
}

function tx(stores, mode, fn, retry = true) {
  return db().then(d => new Promise((res, rej) => {
    let t;
    try { t = d.transaction(stores, mode); } catch (e) {
      // a connection that is closing: drop it and try once more on a new one
      if (retry && e.name === 'InvalidStateError') { if (dbp) dbp = null; return tx(stores, mode, fn, false).then(res, rej); }
      throw e;
    }
    const out = fn(...[].concat(stores).map(s => t.objectStore(s)));
    t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('save aborted'));
  }));
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const range = id => IDBKeyRange.bound(id + '|', id + '|￿');

// which Blob is already stored under which key, so unchanged media is never rewritten
const stored = new WeakMap(); // Blob -> media key
const keysOf = new Map();     // project id -> Set of media keys in the store

export async function saveProject(p) {
  const meta = { ...p, updatedAt: Date.now() };
  KINDS.forEach(k => delete meta[k]);
  meta.media = 2;
  const want = new Map();
  for (const kind of KINDS) for (const [name, blob] of Object.entries(p[kind] || {})) if (blob) want.set(`${p.id}|${kind}|${name}`, blob);
  let have = keysOf.get(p.id);
  if (!have) {
    have = new Set(await tx('media', 'readonly', m => m.getAllKeys(range(p.id))).catch(() => []));
    keysOf.set(p.id, have);
  }
  return tx(['projects', 'media'], 'readwrite', (projects, media) => {
    projects.put(meta);
    for (const [key, blob] of want) {
      if (stored.get(blob) === key && have.has(key)) continue;
      media.put(blob, key); stored.set(blob, key); have.add(key);
    }
    for (const key of [...have]) if (!want.has(key)) { media.delete(key); have.delete(key); }
  });
}

export async function getProject(id) {
  const p = await tx('projects', 'readonly', s => s.get(id));
  if (!p || p.media !== 2) return p; // saved before media had its own store: moved on its next save
  const [keys, blobs] = await tx('media', 'readonly', m => Promise.all([req(m.getAllKeys(range(id))), req(m.getAll(range(id)))]));
  KINDS.forEach(k => { p[k] = {}; });
  keys.forEach((key, i) => {
    const [, kind, name] = key.split('|');
    (p[kind] ||= {})[name] = blobs[i];
    stored.set(blobs[i], key);
  });
  keysOf.set(id, new Set(keys));
  return p;
}

export async function deleteProject(id) {
  keysOf.delete(id);
  return tx(['projects', 'media'], 'readwrite', (projects, media) => { projects.delete(id); media.delete(range(id)); });
}

// ---------------- the character directory ----------------
// A record: { lid, uid, name, gender, age, role, era, setting, language, appearance,
// personality, info, voice, studioVoice, perf, realPhoto, consent, portrait: Blob,
// sheet: Blob, history: [{ id, blob, kind, fav, at, note }], createdAt, updatedAt }
export const saveCharacter = ch => tx('characters', 'readwrite', s => s.put({ ...ch, updatedAt: Date.now() }));
export const getCharacter = lid => tx('characters', 'readonly', s => s.get(lid));
export const deleteCharacter = lid => tx('characters', 'readwrite', s => s.delete(lid));
export async function listCharacters(uid) {
  const list = await tx('characters', 'readonly', s => s.index('uid').getAll(uid));
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// The library list carries only each film's first picture (for its card).
export async function listProjects(uid) {
  const list = await tx('projects', 'readonly', s => s.index('uid').getAll(uid));
  await Promise.all(list.filter(p => p.media === 2).map(async p => {
    const thumb = await tx('media', 'readonly', m => m.get(`${p.id}|images|scene-0`)).catch(() => null);
    p.images = thumb ? { 'scene-0': thumb } : {};
  }));
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}
