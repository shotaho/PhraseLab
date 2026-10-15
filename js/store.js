// IndexedDB への保存(プロジェクト本体と伴奏音源)
var PL = (globalThis.PL = globalThis.PL || {});

(function () {
  const DB_NAME = 'phraselab';
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      const r = fn(s);
      if (r) r.onsuccess = () => (result = r.result);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  PL.store = {
    listProjects: () =>
      tx('projects', 'readonly', (s) => s.getAll()).then((list) =>
        (list || []).map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt || 0 }))
      ),
    getProject: (id) => tx('projects', 'readonly', (s) => s.get(id)),
    putProject: (p) => tx('projects', 'readwrite', (s) => s.put(p)),
    deleteProject: async (id) => {
      await tx('projects', 'readwrite', (s) => s.delete(id));
      await tx('audio', 'readwrite', (s) => s.delete(id));
    },
    getAudio: (id) => tx('audio', 'readonly', (s) => s.get(id)),
    putAudio: (id, rec) => tx('audio', 'readwrite', (s) => s.put(rec, id)),
    deleteAudio: (id) => tx('audio', 'readwrite', (s) => s.delete(id)),
    getMeta: (k) => tx('meta', 'readonly', (s) => s.get(k)),
    setMeta: (k, v) => tx('meta', 'readwrite', (s) => s.put(v, k)),
  };
})();
