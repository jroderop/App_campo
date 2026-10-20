/* Almacén local (IndexedDB). Lo usan la página y el service worker. */
(function (g) {
  const NAME = 'instalaciones-' + (g.APP_CONFIG ? g.APP_CONFIG.project : 'app');
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('records')) d.createObjectStore('records', { keyPath: 'localId' });
        if (!d.objectStoreNames.contains('photos')) {
          const s = d.createObjectStore('photos', { keyPath: 'id' });
          s.createIndex('recordId', 'recordId');
        }
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  const wrap = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  async function store(name, mode) {
    const d = await open();
    return d.transaction(name, mode).objectStore(name);
  }

  const DB = {
    get: async (s, k) => wrap((await store(s, 'readonly')).get(k)),
    put: async (s, v) => wrap((await store(s, 'readwrite')).put(v)),
    del: async (s, k) => wrap((await store(s, 'readwrite')).delete(k)),
    all: async (s) => wrap((await store(s, 'readonly')).getAll()),
    byIndex: async (s, i, v) => wrap((await store(s, 'readonly')).index(i).getAll(v)),
    clear: async (s) => wrap((await store(s, 'readwrite')).clear()),
    /* Reserva atómica de un registro para un proceso de envío (página o service worker).
       Devuelve el registro reservado, o null si otro proceso lo tiene reservado y su reserva no ha caducado. */
    claim: async (localId, owner, ms) => {
      const d = await open();
      return new Promise((resolve, reject) => {
        const t = d.transaction('records', 'readwrite');
        const s = t.objectStore('records');
        let out = null;
        const g = s.get(localId);
        g.onsuccess = () => {
          const r = g.result;
          if (!r || (r.status !== 'pending' && r.status !== 'syncing')) return;
          if (r.lease && r.lease.owner !== owner && r.lease.until > Date.now()) return;
          r.lease = { owner, until: Date.now() + ms };
          r.status = 'syncing';
          s.put(r);
          out = r;
        };
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    },
    kvGet: async (k) => { const r = await DB.get('kv', k); return r ? r.v : undefined; },
    kvSet: (k, v) => DB.put('kv', { k, v })
  };

  g.DB = DB;
})(self);
