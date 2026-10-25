// Project library in IndexedDB (per signed-in user). Images are stored as Blobs.
const DB = 'voiceframe', VER = 1;
let dbp;

function db() {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore('projects', { keyPath: 'id' });
      s.createIndex('uid', 'uid');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function tx(mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction('projects', mode);
    const out = fn(t.objectStore('projects'));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  }));
}

export const saveProject = p => tx('readwrite', s => s.put({ ...p, updatedAt: Date.now() }));
export const getProject = id => tx('readonly', s => s.get(id));
export const deleteProject = id => tx('readwrite', s => s.delete(id));
export const listProjects = uid => tx('readonly', s => s.index('uid').getAll(uid))
  .then(list => list.sort((a, b) => b.updatedAt - a.updatedAt));
