// Schlanke Promise-Hülle um IndexedDB. Ohne Abhängigkeiten, damit die App offline läuft.

const DB_NAME = 'liftlog';
const DB_VERSION = 7;

export const STORES = {
  exercises: 'exercises',
  plans: 'plans',
  sessions: 'sessions',
  bodyweight: 'bodyweight',
  settings: 'settings',
  foods: 'foods',
  meals: 'meals',
  water: 'water',
  templates: 'templates',
  keys: 'keys',
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
      // v4: `routines` entfernt. Eine Routine war ein einzelnes wiederverwendbares
      // Training und war durch Pläne überholt, bevor die App je einen Screen dafür
      // hatte. Kein Stand konnte eine anlegen, bearbeiten oder starten, der Store war
      // also immer leer, und durchs Entfernen geht nichts verloren.
      if (db.objectStoreNames.contains('routines')) db.deleteObjectStore('routines');

      // v2: Pläne über mehrere Tage (eine Routine war ein Tag, ein Plan fasst sie zusammen)
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
      // v3: Ernährung. `foods` ist die eigene Liste der Dinge, die man isst, bewusst
      // unabhängig von der Quelle. Von Hand eingetippt, aus dem Barcode geholt oder
      // per Foto vorgeschlagen, am Ende ist es derselbe Datensatz.
      if (!db.objectStoreNames.contains(STORES.foods)) {
        const s = db.createObjectStore(STORES.foods, { keyPath: 'id' });
        s.createIndex('name', 'name', { unique: false });
      }
      // v5: Wasser, eine Zeile pro Tag statt pro Glas. Interessant ist die Summe des
      // Tages, und eine Zeile pro Schluck wären viele Schreibvorgänge für eine Zahl,
      // die niemand so genau nachliest.
      if (!db.objectStoreNames.contains(STORES.water)) {
        db.createObjectStore(STORES.water, { keyPath: 'day' });
      }
      // v6: gespeicherte Mahlzeiten. Eine Liste mit Namen aus Lebensmitteln und
      // Mengen ("das übliche Frühstück"), mit einem Tipp eingetragen statt mit dreien.
      if (!db.objectStoreNames.contains(STORES.templates)) {
        db.createObjectStore(STORES.templates, { keyPath: 'id' });
      }
      // Eine Zeile pro gegessener Portion. Nach Tag indiziert, ein Datum ist also ein Lesezugriff.
      if (!db.objectStoreNames.contains(STORES.meals)) {
        const s = db.createObjectStore(STORES.meals, { keyPath: 'id' });
        s.createIndex('day', 'day', { unique: false });
      }
      // v7: die eigenen Schlüssel dieses Geräts für die Cloud-Sicherung.
      //
      // Ein eigener Store statt einer Ecke in `settings`, aus einem wichtigen Grund:
      // `exportData()` kopiert jede Einstellung in die Sicherungsdatei. Der private
      // Schlüssel eines Geräts hat in einer Sicherung nichts zu suchen, schon gar
      // nicht in einer, die dann auf ein zweites Handy zurückgespielt wird. Nichts in
      // diesem Store wird je exportiert, hochgeladen oder wiederhergestellt.
      if (!db.objectStoreNames.contains(STORES.keys)) {
        db.createObjectStore(STORES.keys, { keyPath: 'id' });
      }
      void ev;
    };

    // Ein Schema-Upgrade kann nicht laufen, solange ein anderer Tab noch die alte
    // Version offen hat. Ohne das hier wird die Anfrage einfach nie fertig: boot()
    // wartet ewig, und die App zeigt einen leeren Bildschirm, ohne dass in der Konsole
    // etwas steht. Selten, aber es passiert genau dann, wenn ein Update rauskommt,
    // also im schlechtesten Moment, um kaputt auszusehen.
    req.onblocked = () => reject(new Error('BLOCKED'));

    req.onsuccess = () => {
      _db = req.result;
      // Startet später ein anderer Tab ein Upgrade, Platz machen statt blockieren.
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

/** Alle Stores, die zur Sicherung gehören, in einer Transaktion ersetzen, die Geräteschlüssel bleiben. */
export async function replaceBackupData(rowsByStore) {
  const database = await open();
  const names = Object.keys(rowsByStore);
  const transaction = database.transaction(names, 'readwrite');
  try {
    for (const name of names) {
      const objectStore = transaction.objectStore(name);
      objectStore.clear();
      for (const row of rowsByStore[name]) objectStore.put(row);
    }
  } catch (err) {
    transaction.abort();
    throw err;
  }
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('Backup restore was cancelled.'));
    transaction.onerror = () => reject(transaction.error || new Error('Backup restore failed.'));
  });
}

export async function count(store) {
  return wrap((await tx(store)).count());
}

/** Einheiten, die neuesten zuerst. `limit` 0 heißt alle. */
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
 * Den Browser bitten, diese Herkunft vom automatischen Löschen auszunehmen.
 *
 * WebKit räumt aus drei Gründen auf: Kontingent voll, Speicherdruck im System und
 * eine lange Zeit ohne Benutzung. Der persistente Modus nimmt alle drei weg. Eine
 * Web-App auf dem Homescreen, die mehrmals die Woche geöffnet wird, ist schon ein
 * starkes Signal, meistens klappt das also einfach. Aber "meistens" ist keine
 * Sicherungsstrategie, deshalb gibt es zusätzlich den Hinweis zum Exportieren.
 *
 * Kann bei jedem Start aufgerufen werden: es ist idempotent, und Browser ohne
 * Unterstützung melden `unsupported`, statt zu werfen.
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

/** Aktueller Stand der Persistenz und grober Verbrauch, für eine ehrliche Anzeige in den Einstellungen. */
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
  } catch { /* nur zur Anzeige, die Oberfläche wartet nie darauf */ }
  return out;
}

export function uid(prefix = '') {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}${Date.now().toString(36)}${r[0].toString(36)}${r[1].toString(36)}`;
}
