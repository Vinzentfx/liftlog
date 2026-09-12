// Was die drei Hälften zusammenhält: das Log in js/store.js, die Verschlüsselung in
// js/crypto.js und das Netz in js/cloud.js.
//
// Keins davon weiß von den anderen, mit Absicht. Der Store hat nie von einem Server
// gehört, die Verschlüsselung nie von einem Schema, und das Netz hat nie eine
// Trainingseinheit gesehen. Nur in diesem Modul treffen sie sich, und deshalb ist es
// der einzige Ort, an dem man suchen muss, wenn eine Sicherung etwas Seltsames macht.
//
// Die Regeln, die es durchsetzt, alle als Folge früherer Entscheidungen:
//
//   Freigegebene     Jedes freigegebene Gerät darf hochladen. Vorher arbeitet es
//   Schreiber        neuere Einträge aus der Cloud in seinen Stand ein. Die Version
//                    auf dem Server ist weiterhin ein atomares Vergleichen und
//                    Tauschen, ein Wettlauf wird also zu STALE und wiederholt, statt
//                    zu überschreiben.
//   Nie still        Jedes Ergebnis landet in `state` und wird gezeigt. Eine
//                    Sicherung, die leise scheitert, ist schlimmer als keine, weil sie
//                    eine Gewohnheit durch falsche Sicherheit ersetzt.
//   Nie ohne         Die Zustimmung ist aus, bis man sie einschaltet, und die Version
//   Zustimmung       des Textes steht neben dem Zeitstempel.
//
// Es gibt keine Synchronisation im Hintergrund. Apps auf dem iOS-Homescreen haben so
// etwas nicht, das hier läuft also beim Öffnen der App und wenn jemand darum bittet.
// Weil man die App zum Trainieren öffnet, ist das in der Praxis mehrmals pro Woche.

import * as db from './db.js';
import * as store from './store.js';
import * as cloud from './cloud.js';
import * as crypto from './crypto.js';
import { CONSENT_VERSION } from './cloud-config.js';

/* Geräteschlüssel */

const DEVICE_ROW = 'device';

/**
 * Die Identität dieses Geräts: ein ECDH-Schlüsselpaar, dessen private Hälfte als nicht
 * exportierbarer CryptoKey liegt. Nicht einmal Code auf der Seite kann die Bytes lesen,
 * er kann den Browser nur bitten, den Schlüssel zu benutzen.
 *
 * Liegt in einem eigenen Store und nie in den Einstellungen, weil die in jede
 * exportierte Sicherung kopiert werden.
 */
export async function deviceKeys() {
  const saved = await db.get(db.STORES.keys, DEVICE_ROW);
  if (saved?.privateKey) return saved;

  const pair = await crypto.generateDeviceKeys();
  const row = {
    id: DEVICE_ROW,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    jwk: await crypto.exportPublicKey(pair),
    // Wird nur der Person gezeigt, die freigibt, soll also nach etwas aussehen, das sie
    // wiedererkennt, und nicht nach einem User-Agent-Text.
    name: guessDeviceName(),
    createdAt: Date.now(),
  };
  await db.put(db.STORES.keys, row);
  return row;
}

function guessDeviceName() {
  const ua = globalThis.navigator?.userAgent || '';
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Gerät';
}

/** Die ID des Servers für dieses Gerät, sobald es angemeldet ist. */
async function localMeta() {
  return (await db.get(db.STORES.keys, 'meta')) || { id: 'meta' };
}
async function saveMeta(patch) {
  const next = { ...(await localMeta()), ...patch, id: 'meta' };
  await db.put(db.STORES.keys, next);
  return next;
}

function newOwnerToken() {
  return crypto.toBase64(crypto.randomBytes(32));
}

function samePublicKey(a, b) {
  return !!a && !!b
    && a.kty === b.kty && a.crv === b.crv
    && a.x === b.x && a.y === b.y;
}

async function requireOwnerToken() {
  const token = (await localMeta()).ownerToken;
  if (!token) throw Object.assign(new Error('RECOVERY_REQUIRED'), { code: 'RECOVERY_REQUIRED' });
  return token;
}

/* Zustand */

/**
 * Alles, was die Screens brauchen, um die Lage zu beschreiben, und nichts, was sie
 * selbst ausrechnen müssen.
 */
export const state = {
  enabled: false,        // Zustimmung gegeben und Synchronisation an
  signedIn: false,
  profile: null,
  deviceId: null,
  isOwner: false,        // Hauptgerät: darf freigeben, sperren und löschen
  canBackup: false,      // freigegebene Geräte dürfen sichern, der Besitzer verwaltet
  ownerAuthorized: false,// diese Installation hat die Schreibberechtigung auf dem Server
  lastSyncAt: null,
  lastError: null,       // ein Fehlercode, nie eine rohe Meldung
  serverVersion: null,
  busy: false,
  pendingDevices: [],    // Anfragen, die auf die Freigabe durch dieses Gerät warten
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn()); }

// Die Objekte hier sind kleine Serverzeilen und kurze Gerätelisten. Sie als JSON zu
// vergleichen ist genau genug und billiger als das Neuzeichnen, das es verhindert.
const same = (a, b) => a === b
  || (a !== null && b !== null && typeof a === 'object' && typeof b === 'object'
      && JSON.stringify(a) === JSON.stringify(b));

/**
 * Den Zustand ändern und nur Bescheid geben, wenn sich wirklich etwas geändert hat.
 *
 * Der Abonnent zeichnet einen ganzen Screen neu. Die Online-Wartung ruft jede Minute
 * `load()` auf und schreibt jedes Mal dieselben acht Werte zurück. Ohne das hier wurde
 * der Trainieren-Screen während eines Trainings einmal pro Minute abgerissen und neu
 * gebaut, mitsamt dem Feld, in dem man gerade tippte, und dem Cursor. Wer ein Gewicht
 * langsam eintippte, konnte zusehen, wie sich das Feld unter dem Daumen leerte.
 */
function set(patch) {
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (same(state[key], value)) continue;
    state[key] = value;
    changed = true;
  }
  if (changed) emit();
}

/* der Datenschlüssel */

// Nur im Speicher, solange die App offen ist. Ihn ausgepackt auf die Platte zu
// schreiben würde das Einpacken sinnlos machen, und ihn neu zu gewinnen kostet ein
// Auspacken mit einem Schlüssel, den dieses Gerät ohnehin hat.
let dataKey = null;

export const hasDataKey = () => !!dataKey;

/** Ob diese Installation das Löschen ohne aktiven Zugang freigeben kann. */
export async function canDeleteCloudData() {
  return !!(await localMeta()).ownerToken;
}

export async function deleteAccount() {
  const ownerToken = await requireOwnerToken();
  await cloud.deleteAccount(ownerToken);
  dataKey = null;
  // Die Auth-Identität ist weg, diese Installation darf also weder die lokale
  // Einladungssperre noch eine Geräte-ID behalten, die es auf dem Server nie wieder geben
  // kann. Die Trainingsdaten bleiben unberührt und lassen sich nach dem Anmelden mit
  // einem anderen berechtigten Konto weiterhin exportieren.
  await Promise.all([
    db.remove(db.STORES.keys, 'gate'),
    db.remove(db.STORES.keys, 'meta'),
    store.setSetting('cloudEnabled', false),
  ]);
  set({ enabled: false, signedIn: false, profile: null, deviceId: null,
    isOwner: false, canBackup: false, ownerAuthorized: false, pendingDevices: [] });
}

/**
 * Die Kopie des Datenschlüssels für dieses Gerät holen und mit dem gemeinsamen
 * Geheimnis auspacken, das das Hauptgerät hinterlassen hat.
 *
 * Scheitert mit NOT_APPROVED statt mit etwas Unklarem, weil das ein normaler Zustand
 * mit einer klaren Antwort ist: zum Hauptgerät gehen und dieses hier freigeben.
 */
async function loadDataKey(devices) {
  const meta = await localMeta();
  const mine = devices.find((d) => d.id === meta.deviceId);

  if (!mine || mine.status !== 'approved' || !mine.wrapped_key) {
    dataKey = null;
    throw Object.assign(new Error('NOT_APPROVED'), { code: 'NOT_APPROVED' });
  }

  if (dataKey) return dataKey;

  const keys = await deviceKeys();

  const shared = await crypto.sharedKey(keys.privateKey, mine.wrapped_by);
  dataKey = await crypto.unwrapDataKey(shared, { wrapped: mine.wrapped_key, iv: mine.wrap_iv });
  return dataKey;
}

/* Einrichten */

/**
 * Erstes Gerät eines neuen Kontos: Datenschlüssel erzeugen, für den
 * Wiederherstellungsschlüssel einpacken, für dieses Gerät einpacken und die Zustimmung
 * festhalten.
 *
 * Der Wiederherstellungsschlüssel kommt einmal zurück und wird nie gespeichert. Ihn
 * später noch einmal zu zeigen ist vom Aufbau her unmöglich, und genau deshalb lohnt es
 * sich, ihn aufzuschreiben.
 */
export async function createAccount({ consent }) {
  if (!consent) throw Object.assign(new Error('NO_CONSENT'), { code: 'NO_CONSENT' });
  set({ busy: true, lastError: null });
  try {
    const keys = await deviceKeys();
    const device = await cloud.registerDevice({ name: keys.name, publicKey: keys.jwk });
    const ownerToken = newOwnerToken();
    await saveMeta({ deviceId: device.id, ownerToken });

    dataKey = await crypto.generateDataKey();

    const recovery = crypto.generateRecoveryKey();
    const salt = crypto.randomBytes(16);
    const verifierSalt = crypto.randomBytes(16);
    const wrapped = await crypto.wrapDataKey(await crypto.keyFromRecovery(recovery, salt), dataKey);

    // Das erste Gerät packt den Schlüssel für sich genauso ein, wie es ihn später für
    // andere einpackt: ECDH mit seinem eigenen öffentlichen Schlüssel. Ein Codeweg, damit
    // der seltene Fall nicht verrottet, während der häufige weiter funktioniert.
    const selfShared = await crypto.sharedKey(keys.privateKey, keys.jwk);
    const forSelf = await crypto.wrapDataKey(selfShared, dataKey);

    await cloud.configureBackup(device.id, {
      recovery_wrap: wrapped.wrapped,
      recovery_iv: wrapped.iv,
      recovery_salt: crypto.toBase64(salt),
      recovery_verifier: await crypto.recoveryVerifier(recovery, verifierSalt),
      recovery_verifier_salt: crypto.toBase64(verifierSalt),
      consent_at: new Date().toISOString(),
      consent_version: CONSENT_VERSION,
      wrapped_key: forSelf.wrapped,
      wrap_iv: forSelf.iv,
      wrapped_by: keys.jwk,
    }, ownerToken);

    await store.setSetting('cloudEnabled', true);
    await load();
    return recovery;
  } finally {
    set({ busy: false });
  }
}

/** Ein zweites Gerät bittet um Einlass. Kommt zurück, sobald die Anfrage abgelegt ist. */
export async function requestAccess() {
  const keys = await deviceKeys();
  const meta = await localMeta();
  const devices = await cloud.listDevices();
  const current = devices.find((d) => d.id === meta.deviceId);
  if (current?.status === 'revoked') {
    throw Object.assign(new Error('DEVICE_REVOKED'), { code: 'DEVICE_REVOKED' });
  }
  if (current) return current.id;

  // Eine frühere Version hat beim Abmelden die Geräte-ID vergessen, aber den privaten
  // Schlüssel behalten. Die Serverzeile zu diesem Schlüssel wiederverwenden, statt
  // dasselbe Gerät ein zweites Mal anzumelden.
  const matching = devices.find((d) => samePublicKey(d.public_key, keys.jwk));
  if (matching?.status === 'revoked') {
    throw Object.assign(new Error('DEVICE_REVOKED'), { code: 'DEVICE_REVOKED' });
  }
  const existing = matching;
  if (existing) {
    await saveMeta({ deviceId: existing.id });
    await load();
    return existing.id;
  }

  const device = await cloud.registerDevice({ name: keys.name, publicKey: keys.jwk });
  await saveMeta({ deviceId: device.id });
  await load();
  return device.id;
}

/** Status des angemeldeten Geräts dieser Installation laut Server. */
export async function currentDeviceStatus() {
  if (!cloud.isSignedIn()) return 'signed-out';
  const meta = await localMeta();
  if (!meta.deviceId) return 'unregistered';
  const mine = (await cloud.listDevices()).find((device) => device.id === meta.deviceId);
  return mine?.status || 'missing';
}

/** Vom Hauptgerät aus: ein wartendes Gerät hereinlassen und ihm den Schlüssel geben. */
export async function approve(deviceId) {
  const devices = await cloud.listDevices();
  const target = devices.find((d) => d.id === deviceId);
  if (!target) throw Object.assign(new Error('NO_SUCH_DEVICE'), { code: 'NO_SUCH_DEVICE' });

  const keys = await deviceKeys();
  const key = await loadDataKey(devices);
  const shared = await crypto.sharedKey(keys.privateKey, target.public_key);
  const wrapped = await crypto.wrapDataKey(shared, key);

  await cloud.approveDevice(deviceId, {
    wrappedKey: wrapped.wrapped, wrapIv: wrapped.iv, wrappedBy: keys.jwk,
  }, await requireOwnerToken());
  await load();
}

export async function revoke(deviceId) {
  await cloud.revokeDevice(deviceId, await requireOwnerToken());
  await load();
}

/**
 * Der Notausgang: dieses Gerät übernimmt das Konto mit dem Wiederherstellungsschlüssel.
 *
 * Es passieren zwei getrennte Dinge, und beide sind nötig. Der Prüfwert überzeugt den
 * Server, den Besitz zu verschieben und die alten Geräte zu entziehen, das kann er
 * prüfen. Das Auspacken gibt diesem Gerät den Datenschlüssel, und dabei kann der
 * Server überhaupt nicht helfen.
 */
export async function recoverWith(recoveryKey) {
  set({ busy: true, lastError: null });
  try {
    if (!crypto.parseRecoveryKey(recoveryKey)) {
      throw Object.assign(new Error('RECOVERY_MALFORMED'), { code: 'RECOVERY_MALFORMED' });
    }
    const profile = await cloud.getProfile();
    if (!profile?.recovery_wrap) {
      throw Object.assign(new Error('NO_RECOVERY_SET'), { code: 'NO_RECOVERY_SET' });
    }

    // Erst auspacken. Ist der Schlüssel falsch, wurde auf dem Server noch nichts angefasst.
    const unwrapKey = await crypto.keyFromRecovery(
      recoveryKey, crypto.fromBase64(profile.recovery_salt));
    const key = await crypto.unwrapDataKey(unwrapKey, {
      wrapped: profile.recovery_wrap, iv: profile.recovery_iv,
    });

    const deviceId = await requestAccess();
    const ownerToken = newOwnerToken();
    await cloud.claimOwnership(
      await crypto.recoveryVerifier(recoveryKey, crypto.fromBase64(profile.recovery_verifier_salt)),
      deviceId, ownerToken,
    );

    // Für dieses Gerät neu einpacken, damit der nächste Start keinen Wiederherstellungsschlüssel braucht.
    const keys = await deviceKeys();
    const wrapped = await crypto.wrapDataKey(await crypto.sharedKey(keys.privateKey, keys.jwk), key);
    await cloud.approveDevice(deviceId, {
      wrappedKey: wrapped.wrapped, wrapIv: wrapped.iv, wrappedBy: keys.jwk,
    }, ownerToken);

    dataKey = key;
    await saveMeta({ deviceId, ownerToken });
    await store.setSetting('cloudEnabled', true);
    await load();
  } finally {
    set({ busy: false });
  }
}

/* die Synchronisation */

/** Lesen, wie es steht, ohne etwas zu ändern. */
export async function load() {
  if (!cloud.isSignedIn()) {
    set({ signedIn: false, enabled: false, profile: null, isOwner: false, canBackup: false, pendingDevices: [] });
    return state;
  }
  try {
    const [profile, devices, meta, savedLocal, keys] = await Promise.all([
      cloud.getProfile(), cloud.listDevices(), cloud.latestMeta(), localMeta(), deviceKeys(),
    ]);
    // Doppelte Zeilen reparieren, die das alte Abmelden erzeugt hat. Die Besitzerzeile
    // gewinnt, wenn sie genau den öffentlichen Schlüssel dieser Installation trägt.
    const owner = devices.find((d) => d.id === profile?.owner_device);
    const local = owner && samePublicKey(owner.public_key, keys.jwk)
      ? await saveMeta({ deviceId: owner.id })
      : savedLocal;
    const localDevice = devices.find((d) => d.id === local.deviceId);
    set({
      signedIn: true,
      profile,
      deviceId: localDevice?.status === 'revoked' ? null : (local.deviceId ?? null),
      isOwner: !!profile && localDevice?.status !== 'revoked' && profile.owner_device === local.deviceId,
      canBackup: !!profile && localDevice?.status === 'approved' && !!localDevice.wrapped_key,
      ownerAuthorized: !!local.ownerToken,
      serverVersion: meta?.version ?? 0,
      enabled: !!profile?.consent_at && store.state.settings.cloudEnabled !== false,
      pendingDevices: devices.filter((d) => d.status === 'pending' && d.id !== local.deviceId),
      lastError: null,
    });
  } catch (err) {
    set({ signedIn: cloud.isSignedIn(), lastError: err.code || 'SERVER' });
  }
  return state;
}

/**
 * Versiegeln, was auf diesem Gerät ist, und als nächste Version hochschieben.
 *
 * Liest absichtlich zuerst die Version des Servers, statt lokal zu zählen: ein Gerät,
 * das offline war, hat keine Ahnung, was inzwischen passiert ist, und Raten wäre genau
 * das Überschreiben, gegen das es die Versionsnummern gibt. Wird der Upload trotzdem
 * als STALE abgelehnt, hat ein zweites Gerät zwischen Lesen und Schreiben hochgeladen,
 * und die Antwort ist dieselbe wie sonst auch.
 */
export async function backupNow({ force = false } = {}) {
  if (!cloud.isSignedIn()) return { ok: false, code: 'AUTH' };
  if (!state.enabled && !force) return { ok: false, code: 'DISABLED' };
  if (state.busy) return { ok: false, code: 'BUSY' };

  set({ busy: true, lastError: null });
  try {
    const devices = await cloud.listDevices();
    const meta = await localMeta();
    const mine = devices.find((device) => device.id === meta.deviceId);
    if (!mine || mine.status !== 'approved' || !mine.wrapped_key) {
      set({ canBackup: false });
      return { ok: false, code: 'READ_ONLY' };
    }

    const key = await loadDataKey(devices);
    let version;
    let blob;
    for (let attempt = 0; attempt < 2; attempt++) {
      const latest = await cloud.latestMeta();
      const latestVersion = latest?.version ?? 0;
      const baseVersion = Number(store.state.settings.cloudBaseVersion) || 0;
      let payload = store.exportData();

      if (latestVersion > baseVersion) {
        const remote = await cloud.download(latestVersion);
        const remotePayload = await crypto.open(key, remote.blob);
        payload = hasUserData(payload) ? mergeSnapshots(payload, remotePayload) : remotePayload;
        await store.importData(payload, { replace: true });
        await store.setSetting('cloudBaseVersion', latestVersion);
        payload = store.exportData();
      }

      version = latestVersion + 1;
      blob = await crypto.seal(key, payload);
      try {
        await cloud.upload(blob, { version, deviceId: meta.deviceId });
        break;
      } catch (err) {
        if (err.code !== 'STALE' || attempt === 1) throw err;
      }
    }

    if (meta.deviceId) await cloud.touchDevice(meta.deviceId).catch(() => {});
    await store.setSetting('cloudBaseVersion', version);
    await store.setSetting('cloudLastSyncAt', Date.now());
    await store.setSetting('cloudLastFingerprint', backupFingerprint());
    set({ lastSyncAt: Date.now(), serverVersion: version });
    return { ok: true, version, bytes: blob.bytes };
  } catch (err) {
    const code = err.code || 'SERVER';
    set({ lastError: code });
    return { ok: false, code };
  } finally {
    set({ busy: false });
  }
}

/**
 * Eine Version vom Server holen und zu dem machen, was dieses Gerät hat.
 *
 * Das ersetzt alles, deshalb ruft es nichts von allein auf. Es ist der Weg für "neues
 * Handy" und "ich habe Mist gebaut", und der Screen fragt vorher.
 */
export async function restore(version = null) {
  set({ busy: true, lastError: null });
  try {
    const devices = await cloud.listDevices();
    const key = await loadDataKey(devices);
    const { blob, version: got } = await cloud.download(version);
    const payload = await crypto.open(key, blob);
    await store.importData(payload, { replace: true });
    await store.setSetting('cloudBaseVersion', got);
    set({ serverVersion: got });
    return { ok: true, version: got };
  } catch (err) {
    const code = err.code || 'SERVER';
    set({ lastError: code });
    return { ok: false, code };
  } finally {
    set({ busy: false });
  }
}

async function openBackupPayload(version) {
  const devices = await cloud.listDevices();
  const key = await loadDataKey(devices);
  const { blob, version: got } = await cloud.download(version);
  return { payload: await crypto.open(key, blob), version: got };
}

export async function backupSessions(version) {
  const { payload } = await openBackupPayload(version);
  return (payload.sessions || []).filter((session) => session?.id && session.finishedAt)
    .map((session) => ({ id: session.id, name: session.name, startedAt: session.startedAt,
      finishedAt: session.finishedAt, exercises: (session.entries || []).length }));
}

export async function restoreBackupSession(version, sessionId) {
  const { payload } = await openBackupPayload(version);
  const session = (payload.sessions || []).find((row) => row.id === sessionId);
  if (!session) throw Object.assign(new Error('SESSION_NOT_FOUND'), { code: 'SESSION_NOT_FOUND' });
  const ids = new Set((session.entries || []).map((entry) => entry.exerciseId));
  const alreadyExists = store.state.sessions.some((row) => row.id === session.id);
  const restored = alreadyExists ? { ...session, id: db.uid('s_'), name: `${session.name} (restored)`,
    updatedAt: Date.now() } : session;
  await store.importData({ format: 'liftlog-backup', version: 1,
    exercises: (payload.exercises || []).filter((exercise) => ids.has(exercise.id))
      .filter((exercise) => !store.state.exerciseById.has(exercise.id)), sessions: [restored],
    plans: [], bodyweight: [], foods: [], meals: [], water: [], templates: [],
  }, { replace: false });
  return restored;
}

/**
 * Wird einmal beim Start aufgerufen, nachdem der Store geladen ist.
 *
 * Alles hier ist nur ein Versuch, und nichts davon darf das Öffnen der App aufhalten:
 * das Log auf dem Gerät ist das, worauf es ankommt, die Cloud ist eine Kopie davon. Ein
 * Handy ohne Empfang muss sich genau so verhalten wie vor alldem.
 */
/**
 * Wie lange eine normale automatische Sicherung nach der letzten wartet.
 *
 * Jede Version ist ein vollständiger versiegelter Stand, und der Server behält nur die
 * letzten paar. Einmal pro Minute durch ein Training von neunzig Minuten hochzuladen
 * würde jeden Punkt zum Zurückgehen verdrängen, bevor es vorbei ist. Die Momente, die
 * sich wirklich lohnen, verlangen `immediate` und ignorieren das hier.
 */
export const AUTO_BACKUP_MIN_GAP_MS = 5 * 60 * 1000;

export async function onAppOpen({ immediate = false } = {}) {
  if (!cloud.isSignedIn()) return { ok: false, code: 'AUTH' };
  await load();
  if (state.lastError) return { ok: false, code: state.lastError };
  if (!state.enabled) return { ok: false, code: 'DISABLED' };
  if (!state.canBackup) return { ok: false, code: 'READ_ONLY' };

  // Herunterladen, bevor entschieden wird, ob hochgeladen wird. Die Prüfung mit dem
  // Fingerabdruck unten beantwortet "hat sich dieses Gerät seit dem letzten Upload
  // geändert", und das ist eine andere Frage als "ist der Server weiter als dieses
  // Gerät". Früher wurde nur die erste gestellt. Ein Handy, das einfach nur dalag, hat
  // also nie mitbekommen, was auf dem anderen eingetragen wurde.
  const pulled = await pullIfNewer();
  // Ein fehlgeschlagenes Holen wird gemeldet, darf den Upload aber nicht aufhalten: das
  // eigene Training auf den Server zu bringen ist die wichtigere Hälfte, und der
  // häufigste Grund für ein gescheitertes Holen ist, dass es nichts zu holen gibt.
  if (!pulled.ok && !['DISABLED', 'BUSY', 'TRAINING', 'NO_BACKUP'].includes(pulled.code)) {
    set({ lastError: pulled.code });
  }

  // Hochladen, sobald die nächste Online-Wartung eine echte Änderung sieht, aber nie eine
  // neue Serverversion für einen identischen Stand anlegen. Die Buchführung der Cloud
  // selbst ist aus dem Fingerabdruck herausgenommen, damit eine fertige Sicherung die
  // nächste Prüfung nicht gleich wieder wie eine Änderung aussehen lässt.
  const last = Number(store.state.settings.cloudLastSyncAt) || 0;
  const fingerprint = backupFingerprint();
  if (store.state.settings.cloudLastFingerprint === fingerprint) {
    set({ lastSyncAt: last });
    return { ok: true, skipped: true, pulled: pulled.version || null };
  }
  if (!immediate && last && Date.now() - last < AUTO_BACKUP_MIN_GAP_MS) {
    return { ok: true, deferred: true, pulled: pulled.version || null };
  }
  const pushed = await backupNow();
  return pushed.ok ? { ...pushed, pulled: pulled.version || null } : pushed;
}

function backupFingerprint() {
  const payload = store.exportData();
  const settings = Object.fromEntries(Object.entries(payload.settings || {})
    .filter(([key]) => !key.startsWith('cloud') && key !== 'syncDeletions'));
  // exportedAt ändert sich zwangsläufig bei jedem Aufruf. Alles andere ist echter Zustand
  // der App, auch Änderungen am Wasser von heute oder ein Satz, der dieselbe ID behalten hat.
  const { exportedAt: _volatile, settings: _settings, ...data } = payload;
  return JSON.stringify({ ...data, settings });
}

/** Einfache, nicht geheime Angaben für die Diagnose in den Einstellungen. */
export async function diagnostics() {
  let latest = null;
  try { latest = await cloud.latestMeta(); } catch { /* state.lastError erklärt es */ }
  const active = store.state.sessions.filter((session) => !session.finishedAt);
  return {
    online: navigator.onLine,
    signedIn: cloud.isSignedIn(),
    enabled: state.enabled,
    canBackup: state.canBackup,
    busy: state.busy,
    lastError: state.lastError,
    lastSyncAt: Number(store.state.settings.cloudLastSyncAt) || null,
    baseVersion: Number(store.state.settings.cloudBaseVersion) || 0,
    serverVersion: Number(latest?.version ?? state.serverVersion) || 0,
    unsyncedChanges: store.state.settings.cloudLastFingerprint !== backupFingerprint(),
    deletionCount: (store.state.settings.syncDeletions || []).length,
    activeWorkouts: active.length,
    activeElsewhere: active.some((session) => session.originDevice
      && session.originDevice !== store.installationId()),
    lastMerge: store.state.settings.cloudLastMergeSummary || null,
  };
}

/**
 * Eine neuere Version aus der Cloud nehmen und in das einarbeiten, was dieses Gerät hat.
 *
 * Das ist die Hälfte der Synchronisation, die gefehlt hat. `backupNow` führt vor dem
 * Hochladen schon zusammen, ein Handy, das etwas geändert hatte, hat also am Ende das
 * Training des anderen gehabt. Ein Handy, das nichts geändert hatte, kam nie so weit:
 * `onAppOpen` hat Fingerabdrücke verglichen und ist zurückgekehrt, bevor irgendetwas
 * den Server angeschaut hat. Zwei Geräte an einem Konto konnten so beliebig lange
 * verschieden bleiben, jedes überzeugt, aktuell zu sein, und der Unterschied fiel nur
 * als fehlende Trainings auf.
 *
 * Es wird zusammengeführt, nicht ersetzt. `restore()` ersetzt, aber darum hat jemand
 * gebeten und wurde gewarnt. Das hier läuft von selbst beim Start und darf deshalb
 * keine Einheit verlieren können, die es nur hier gibt.
 */
export async function pullIfNewer() {
  if (!cloud.isSignedIn()) return { ok: false, code: 'AUTH' };
  if (!state.enabled) return { ok: false, code: 'DISABLED' };
  if (state.busy) return { ok: false, code: 'BUSY' };
  // Jeden Store unter einem laufenden Training neu zu schreiben würde die offene Einheit
  // unter dem Screen wegziehen, der sie anzeigt. Das Herunterladen kann bis zum Ende der
  // Einheit warten, eilig ist daran nichts.
  if (store.activeSession()) return { ok: false, code: 'TRAINING' };

  set({ busy: true });
  try {
    const latest = await cloud.latestMeta();
    const latestVersion = latest?.version ?? 0;
    const baseVersion = Number(store.state.settings.cloudBaseVersion) || 0;
    if (!latestVersion || latestVersion <= baseVersion) return { ok: true, skipped: true };

    const devices = await cloud.listDevices();
    const key = await loadDataKey(devices);
    const remote = await cloud.download(latestVersion);
    const remotePayload = await crypto.open(key, remote.blob);

    const local = store.exportData();
    const mine = hasUserData(local);
    const { merged, tookLocal, summary } = mergeDetailed(local, remotePayload);
    await store.importData(mine ? merged : remotePayload, { replace: true });
    await store.setSetting('cloudBaseVersion', latestVersion);
    await store.setSetting('cloudLastMergeSummary', { ...summary, at: Date.now(), version: latestVersion });

    // Nichts von uns hat überlebt, was der Server nicht schon hatte, dieses Gerät hat
    // jetzt also genau diese Version. Den Fingerabdruck festzuhalten verhindert, dass der
    // Upload unten eine identische Kopie als nächste Version hochlädt, die das andere
    // Handy dann holt und genauso beantwortet, für immer.
    if (!mine || !tookLocal) {
      await store.setSetting('cloudLastFingerprint', backupFingerprint());
      await store.setSetting('cloudLastSyncAt', Date.now());
    }
    set({ serverVersion: latestVersion, lastSyncAt: Date.now(), lastError: null });
    return { ok: true, version: latestVersion, merged: mine && tookLocal };
  } catch (err) {
    const code = err.code || 'SERVER';
    set({ lastError: code });
    return { ok: false, code };
  } finally {
    set({ busy: false });
  }
}

const MERGE_KEYS = {
  exercises: 'id', plans: 'id', sessions: 'id', bodyweight: 'id',
  foods: 'id', meals: 'id', water: 'day', templates: 'id',
};

const changedAt = (row) => Number(row?.updatedAt || row?.finishedAt || row?.at
  || row?.date || row?.createdAt || row?.startedAt || 0);

/** Bei gleichen Einträgen hat die Gegenseite recht, wirklich neuere lokale Änderungen gewinnen. */
export function mergeSnapshots(local, remote) {
  return mergeDetailed(local, remote).merged;
}

/**
 * Das Zusammenführen, und ob etwas von diesem Gerät dabei überlebt hat.
 *
 * `tookLocal` verhindert, dass zwei Handys sich für immer gegenseitig Versionen
 * zuschieben. Ein Gerät, das einen neueren Stand holt und nichts Eigenes beiträgt, hat
 * jetzt genau das, was der Server hat, und darf nicht umgekehrt eine identische Kopie
 * als nächste Version hochladen, die das andere Handy dann holt und genauso beantwortet.
 * Die Markierung kommt aus dem Zusammenführen selbst und nicht aus einem zweiten
 * Vergleich, damit es nur eine Regel dafür gibt, was als neuer zählt.
 */
export function mergeDetailed(local, remote) {
  // Die Buchführung des Geräts wird nie aus einem Stand übernommen. `cloudBaseVersion` und
  // Co. beschreiben das Verhältnis dieser Installation zum Server. Eine Kopie von der
  // Gegenseite ist also nicht nur alt, sie handelt von einem anderen Handy.
  const remoteSettings = Object.fromEntries(Object.entries(remote.settings || {})
    .filter(([key]) => !key.startsWith('cloud') && key !== 'syncDeletions'));
  const remoteDeletionRows = new Map((remote.deletions || remote.settings?.syncDeletions || [])
    .filter((row) => row?.collection && row?.id)
    .map((row) => [`${row.collection}:${row.id}`, row]));
  const deletionRows = new Map();
  for (const row of [...(remote.deletions || remote.settings?.syncDeletions || []),
    ...(local.deletions || local.settings?.syncDeletions || [])]) {
    if (!row?.collection || !row?.id) continue;
    const key = `${row.collection}:${row.id}`;
    if (!deletionRows.has(key) || Number(row.deletedAt) > Number(deletionRows.get(key).deletedAt)) {
      deletionRows.set(key, row);
    }
  }
  const deletions = [...deletionRows.values()];
  // Die Einstellungen waren früher ein flaches Zusammenwerfen mit der Gegenseite oben,
  // eine Änderung auf diesem Gerät, die noch nicht hochgeladen war, ging also verloren,
  // sobald ein neuerer Stand von einem anderen kam. Das ist nicht ausgedacht:
  // machineSetups liegt hier, ein im Studio eingetipptes Maximum an einer Maschine
  // konnte also verschwinden, weil ein Tablet zuerst hochgeladen hat. Jeder Schlüssel
  // trägt jetzt den Zeitpunkt, an dem er zuletzt geschrieben wurde, und das neuere
  // Schreiben gewinnt, genau wie bei den Zeilen weiter unten.
  //
  // Schlüssel ohne Zeitpunkt verhalten sich wie früher. Stände von vor dieser Änderung
  // haben gar keine Zeiten, und "die Gegenseite gewinnt" ist die richtige Antwort, wenn
  // keine Seite sagen kann, wann sie sich geändert hat.
  const localTimes = local.settingsUpdatedAt || {};
  const remoteTimes = remote.settingsUpdatedAt || {};
  const settings = { ...(local.settings || {}) };
  const settingsUpdatedAt = { ...localTimes };
  let keptLocalSetting = false;
  for (const [key, value] of Object.entries(remoteSettings)) {
    const localAt = Number(localTimes[key]) || 0;
    const remoteAt = Number(remoteTimes[key]) || 0;
    if (localAt > remoteAt && Object.hasOwn(settings, key)) { keptLocalSetting = true; continue; }
    settings[key] = value;
    if (remoteAt) settingsUpdatedAt[key] = remoteAt;
  }

  const merged = {
    format: 'liftlog-backup', version: 1, exportedAt: new Date().toISOString(),
    settings: { ...settings, syncDeletions: deletions },
    settingsUpdatedAt,
    deletions,
  };
  let tookLocal = keptLocalSetting
    || (local.deletions || local.settings?.syncDeletions || []).some((row) => {
    const remoteRow = remoteDeletionRows.get(`${row.collection}:${row.id}`);
    return !remoteRow || Number(row.deletedAt) > Number(remoteRow.deletedAt);
  });
  const summary = { localAdded: 0, localNewer: 0, remoteNewer: 0, deletions: 0 };
  for (const [list, key] of Object.entries(MERGE_KEYS)) {
    const rows = new Map((remote[list] || []).map((row) => [row[key], row]));
    for (const row of local[list] || []) {
      const existing = rows.get(row[key]);
      if (!existing || changedAt(row) > changedAt(existing)) {
        if (!existing) summary.localAdded++;
        else summary.localNewer++;
        rows.set(row[key], row);
        tookLocal = true;
      } else if (changedAt(existing) > changedAt(row)) summary.remoteNewer++;
    }
    for (const deletion of deletions) {
      if (deletion.collection !== list) continue;
      const existing = rows.get(deletion.id);
      if (existing && Number(deletion.deletedAt) >= changedAt(existing)) {
        rows.delete(deletion.id); summary.deletions++;
      }
    }
    merged[list] = [...rows.values()];
  }
  return { merged, tookLocal, summary };
}

function hasUserData(payload) {
  return !!((payload.sessions || []).length || (payload.plans || []).length
    || (payload.bodyweight || []).length || (payload.foods || []).length || (payload.meals || []).length
    || (payload.water || []).length || (payload.templates || []).length
    || (payload.exercises || []).some((exercise) => exercise.isCustom));
}

export async function signOutEverywhere({ forgetDevice = false } = {}) {
  dataKey = null;
  // Ein normales Abmelden behält die Geräteidentität und das verschlüsselte
  // Schlüsselmaterial dieser Installation, damit ein erneutes Anmelden kein zweites Gerät
  // erzeugt. Nur das vollständige lokale Löschen vergisst sie ausdrücklich.
  await db.remove(db.STORES.keys, 'gate');
  if (forgetDevice) await db.remove(db.STORES.keys, 'meta');
  await cloud.signOut();
  if (forgetDevice) await store.setSetting('cloudEnabled', false);
  await load();
}

/** Für eine Löschanfrage. Löscht die Cloud-Kopie und lässt dieses Gerät in Ruhe. */
export async function deleteCloudData() {
  await cloud.deleteEverything(await requireOwnerToken());
  dataKey = null;
  await db.remove(db.STORES.keys, 'meta');
  await store.setSetting('cloudEnabled', false);
  await load();
}
