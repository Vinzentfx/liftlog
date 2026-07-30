// Minimal promise wrapper over IndexedDB. No dependencies so the app works offline.

const DB_NAME = 'liftlog';
const DB_VERSION = 4;

export const STORES = {
  exercises: 'exercises',
  plans: 'plans',
  sessions: 'sessions',
  bodyweight: 'bodyweight',
  settings: 'settings',
  foods: 'foods',
  meals: 'meals',
};

let _db = null;

export function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (ev) => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORES.exercises)) {
        const s = db.createObjectStore(STORES.exercises, { keyPath: 'id' });
        s.createIndex('name', 'name', { unique: false });
        s.createIndex('muscle', 'muscle', { unique: false });
      }
      // v4: `routines` dropped. A routine was a single reusable workout, made
      // obsolete by plans before the app ever shipped a screen for one — no
      // build ever contained a way to create, edit or start one, so the store
      // could only ever be empty and nothing is lost by removing it.
      if (db.objectStoreNames.contains('routines')) db.deleteObjectStore('routines');

      // v2: multi-day workout plans (a routine was a single day; a plan groups them)
      if (!db.objectStoreNames.contains(STORES.plans)) {
        db.createObjectStore(STORES.plans, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.sessions)) {
        const s = db.createObjectStore(STORES.sessions, { keyPath: 'id' });
        s.createIndex('startedAt', 'startedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.bodyweight)) {
        const s = db.createObjectStore(STORES.bodyweight, { keyPath: 'id' });
        s.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
      // v3: nutrition. `foods` is the user's own list of things they eat —
      // deliberately source-agnostic, so an entry typed by hand, filled from a
      // barcode lookup or drafted by a photo all end up as the same record.
      if (!db.objectStoreNames.contains(STORES.foods)) {
        const s = db.createObjectStore(STORES.foods, { keyPath: 'id' });
        s.createIndex('name', 'name', { unique: false });
      }
      // One row per portion eaten. Indexed by day so a date's log is one read.
      if (!db.objectStoreNames.contains(STORES.meals)) {
        const s = db.createObjectStore(STORES.meals, { keyPath: 'id' });
        s.createIndex('day', 'day', { unique: false });
      }
      void ev;
    };

    // A schema upgrade cannot run while another tab still holds the old
    // version open. Without this the request simply never settles: boot() awaits
    // forever and the app shows an empty screen with nothing in the console.
    // Rare, but it lands exactly when an update ships, which is the worst
    // moment to look broken.
    req.onblocked = () => reject(new Error('BLOCKED'));

    req.onsuccess = () => {
      _db = req.result;
      // If another tab later starts an upgrade, step aside rather than block it.
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return open().then((db) => db.transaction(store, mode).objectStore(store));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(store) {
  return wrap((await tx(store)).getAll());
}

export async function get(store, key) {
  return wrap((await tx(store)).get(key));
}

export async function put(store, value) {
  await wrap((await tx(store, 'readwrite')).put(value));
  return value;
}

export async function putMany(store, values) {
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  const os = t.objectStore(store);
  values.forEach((v) => os.put(v));
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(values);
    t.onerror = () => reject(t.error);
  });
}

export async function remove(store, key) {
  return wrap((await tx(store, 'readwrite')).delete(key));
}

export async function clear(store) {
  return wrap((await tx(store, 'readwrite')).clear());
}

export async function count(store) {
  return wrap((await tx(store)).count());
}

/** Sessions newest-first. `limit` of 0 means all. */
export async function recentSessions(limit = 0) {
  const db = await open();
  const idx = db.transaction(STORES.sessions).objectStore(STORES.sessions).index('startedAt');
  const out = [];
  return new Promise((resolve, reject) => {
    const req = idx.openCursor(null, 'prev');
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || (limit && out.length >= limit)) return resolve(out);
      out.push(cur.value);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Ask the browser to exempt this origin from storage eviction.
 *
 * WebKit evicts on three triggers: quota exceeded, system storage pressure, and
 * a long stretch without user interaction. Persistent mode removes all three.
 * A home-screen web app that gets opened several times a week is already a
 * strong signal, so this usually just gets granted — but "usually" is not a
 * backup strategy, which is why the export nudge exists as well.
 *
 * Safe to call on every boot: it is idempotent, and unsupported browsers simply
 * report `unsupported` rather than throwing.
 */
export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) return 'granted';
    return (await navigator.storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

/** Current persistence state and rough usage, for an honest Settings readout. */
export async function storageStatus() {
  const out = { persisted: null, usage: null, quota: null };
  if (!navigator.storage) return out;
  try {
    if (navigator.storage.persisted) out.persisted = await navigator.storage.persisted();
    if (navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      out.usage = est.usage ?? null;
      out.quota = est.quota ?? null;
    }
  } catch { /* reporting only — never block the UI on it */ }
  return out;
}

export function uid(prefix = '') {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}${Date.now().toString(36)}${r[0].toString(36)}${r[1].toString(36)}`;
}
