// What ties the three halves together: the log in js/store.js, the encryption
// in js/crypto.js, and the network in js/cloud.js.
//
// Nothing above this line knows about the others, on purpose. The store has
// never heard of a server, the crypto has never heard of a schema, and the
// network has never seen a training session. This module is the only place
// where those meet, which makes it the only place to look when a backup does
// something surprising.
//
// The rules it enforces, all of them consequences of decisions made earlier:
//
//   Approved writers. Every approved device may upload. Before it does, it
//                     folds newer cloud records into its local snapshot. The
//                     server version is still an atomic compare-and-swap, so a
//                     race becomes STALE and is retried rather than overwriting.
//   Never silent.    Every outcome lands in `state` and gets shown. A backup
//                    feature that fails quietly is worse than none, because it
//                    replaces a habit with a false sense of safety.
//   Never automatic  Consent is off until switched on, and the wording version
//   without consent. is recorded next to the timestamp.
//
// There is no background sync. iOS home-screen apps have none to offer, so this
// runs when the app is opened and when someone asks for it. Since the app gets
// opened to train, that is in practice several times a week.

import * as db from './db.js';
import * as store from './store.js';
import * as cloud from './cloud.js';
import * as crypto from './crypto.js';
import { CONSENT_VERSION } from './cloud-config.js';

/* ============================== device keys ============================== */

const DEVICE_ROW = 'device';

/**
 * This device's identity: an ECDH keypair whose private half is stored as a
 * non-extractable CryptoKey, so not even code running in the page can read the
 * bytes. It can ask the browser to use the key and nothing more.
 *
 * Kept in its own object store, never in settings, because settings are copied
 * into every exported backup.
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
    // Only ever shown back to the person approving it, so it should read like
    // something they recognise rather than a user-agent string.
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

/** The server's id for this device, once it has been registered. */
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

/* ================================= state ================================= */

/**
 * Everything the screens need to describe the situation, and nothing they have
 * to work out for themselves.
 */
export const state = {
  enabled: false,        // consent given and syncing switched on
  signedIn: false,
  profile: null,
  deviceId: null,
  isOwner: false,        // main device: may approve, block and delete
  canBackup: false,      // approved devices may write backups; owner is admin
  ownerAuthorized: false,// this install holds the server-side write capability
  lastSyncAt: null,
  lastError: null,       // an error code, never a raw message
  serverVersion: null,
  busy: false,
  pendingDevices: [],    // requests waiting for this device to approve them
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn()); }

function set(patch) { Object.assign(state, patch); emit(); }

/* ============================== the data key ============================== */

// Held in memory only, for as long as the app is open. Writing it to disk
// unwrapped would undo the point of wrapping it, and re-deriving it costs one
// unwrap against a key this device already holds.
let dataKey = null;

export const hasDataKey = () => !!dataKey;

/** Whether this installation can authorize deletion without active access. */
export async function canDeleteCloudData() {
  return !!(await localMeta()).ownerToken;
}

export async function deleteAccount() {
  const ownerToken = await requireOwnerToken();
  await cloud.deleteAccount(ownerToken);
  dataKey = null;
  // The Auth identity is gone, so this installation must not keep the local
  // invite gate or a device id that can never exist on the server again.
  // Training data stays untouched and can still be exported after signing in
  // with another authorised account.
  await Promise.all([
    db.remove(db.STORES.keys, 'gate'),
    db.remove(db.STORES.keys, 'meta'),
    store.setSetting('cloudEnabled', false),
  ]);
  set({ enabled: false, signedIn: false, profile: null, deviceId: null,
    isOwner: false, canBackup: false, ownerAuthorized: false, pendingDevices: [] });
}

/**
 * Get this device's copy of the data key, unwrapping it with the shared secret
 * the main device left for us.
 *
 * Fails with NOT_APPROVED rather than throwing something vague, because that is
 * a normal state with a clear answer: go to the main device and approve this
 * one.
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

/* ============================== setting up ============================== */

/**
 * First device on a new account: make the data key, wrap it for the recovery
 * key, wrap it for this device, and record the consent.
 *
 * The recovery key is returned once and never stored. Showing it again later is
 * impossible by construction, which is the property that makes it worth
 * writing down.
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

    // The first device wraps the key for itself the same way it will later wrap
    // it for others: ECDH against its own public key. One code path, so the
    // unusual case cannot rot while the common one keeps working.
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

/** A second device asking to be let in. Returns once the request is filed. */
export async function requestAccess() {
  const keys = await deviceKeys();
  const meta = await localMeta();
  const devices = await cloud.listDevices();
  const current = devices.find((d) => d.id === meta.deviceId);
  if (current?.status === 'revoked') {
    throw Object.assign(new Error('DEVICE_REVOKED'), { code: 'DEVICE_REVOKED' });
  }
  if (current) return current.id;

  // A previous version forgot the device id on sign-out but kept the private
  // key. Reuse the server row belonging to that key instead of registering the
  // same physical device a second time.
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

/** Server-authoritative status of this installation's registered device. */
export async function currentDeviceStatus() {
  if (!cloud.isSignedIn()) return 'signed-out';
  const meta = await localMeta();
  if (!meta.deviceId) return 'unregistered';
  const mine = (await cloud.listDevices()).find((device) => device.id === meta.deviceId);
  return mine?.status || 'missing';
}

/** From the main device: let a waiting one in, and hand it the key. */
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
 * The escape hatch: this device takes the account over using the recovery key.
 *
 * Two separate things happen, and both are needed. The verifier convinces the
 * server to move ownership and revoke the old devices, which it can check. The
 * unwrap gives this device the data key, which the server cannot help with at
 * all.
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

    // Unwrap first. If the key is wrong, nothing on the server has been touched.
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

    // Re-wrap for this device so the next launch needs no recovery key.
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

/* =============================== the sync =============================== */

/** Read where things stand, without changing anything. */
export async function load() {
  if (!cloud.isSignedIn()) {
    set({ signedIn: false, enabled: false, profile: null, isOwner: false, canBackup: false, pendingDevices: [] });
    return state;
  }
  try {
    const [profile, devices, meta, savedLocal, keys] = await Promise.all([
      cloud.getProfile(), cloud.listDevices(), cloud.latestMeta(), localMeta(), deviceKeys(),
    ]);
    // Repair duplicate rows created by the old sign-out behaviour. The owner
    // row wins when it carries this installation's exact public key.
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
 * Seal what is on this device and push it as the next version.
 *
 * Deliberately reads the server's version first rather than counting locally: a
 * device that has been offline has no idea what happened meanwhile, and guessing
 * would be the exact overwrite the version numbers exist to prevent. If the push
 * is refused as STALE anyway, that is a second device having uploaded between
 * the read and the write, and the answer is the same as it would have been.
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
 * Pull a version from the server and make it what this device holds.
 *
 * This replaces everything, which is why nothing calls it on its own. It is the
 * "new phone" and "I have made a mess" path, and the screen asks first.
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
 * Called once on boot, after the store has loaded.
 *
 * Everything here is best-effort and none of it may block the app from opening:
 * the log on the device is the thing that matters, and the cloud is a copy of
 * it. A phone with no signal must behave exactly as it did before any of this
 * existed.
 */
export async function onAppOpen() {
  if (!cloud.isSignedIn()) return { ok: false, code: 'AUTH' };
  await load();
  if (state.lastError) return { ok: false, code: state.lastError };
  if (!state.enabled) return { ok: false, code: 'DISABLED' };
  if (!state.canBackup) return { ok: false, code: 'READ_ONLY' };

  // Upload as soon as the app's next online maintenance sees a real change,
  // while never creating a new server version for an identical snapshot.
  // Cloud bookkeeping itself is excluded from the fingerprint so completing a
  // backup cannot immediately make the next check look dirty again.
  const last = Number(store.state.settings.cloudLastSyncAt) || 0;
  const fingerprint = backupFingerprint();
  if (store.state.settings.cloudLastFingerprint === fingerprint) {
    set({ lastSyncAt: last });
    return { ok: true, skipped: true };
  }
  return backupNow();
}

function backupFingerprint() {
  const payload = store.exportData();
  const settings = Object.fromEntries(Object.entries(payload.settings || {})
    .filter(([key]) => !key.startsWith('cloud')));
  // exportedAt necessarily changes on every call; everything else is real app
  // state, including edits to today's water or a set that retained the same id.
  const { exportedAt: _volatile, settings: _settings, ...data } = payload;
  return JSON.stringify({ ...data, settings });
}

const MERGE_KEYS = {
  exercises: 'id', plans: 'id', sessions: 'id', bodyweight: 'id',
  foods: 'id', meals: 'id', water: 'day', templates: 'id',
};

const changedAt = (row) => Number(row?.updatedAt || row?.finishedAt || row?.at
  || row?.date || row?.createdAt || row?.startedAt || 0);

/** Remote is authoritative for equal records; genuinely newer local edits win. */
export function mergeSnapshots(local, remote) {
  const merged = {
    format: 'liftlog-backup', version: 1, exportedAt: new Date().toISOString(),
    settings: { ...(local.settings || {}), ...(remote.settings || {}) },
  };
  for (const [list, key] of Object.entries(MERGE_KEYS)) {
    const rows = new Map((remote[list] || []).map((row) => [row[key], row]));
    for (const row of local[list] || []) {
      const existing = rows.get(row[key]);
      if (!existing || changedAt(row) > changedAt(existing)) rows.set(row[key], row);
    }
    merged[list] = [...rows.values()];
  }
  return merged;
}

function hasUserData(payload) {
  return !!((payload.sessions || []).length || (payload.plans || []).length
    || (payload.bodyweight || []).length || (payload.foods || []).length || (payload.meals || []).length
    || (payload.water || []).length || (payload.templates || []).length
    || (payload.exercises || []).some((exercise) => exercise.isCustom));
}

export async function signOutEverywhere({ forgetDevice = false } = {}) {
  dataKey = null;
  // A normal sign-out keeps this installation's device identity and encrypted
  // key material so signing back in does not manufacture a second device.
  // Full local erasure explicitly opts into forgetting it.
  await db.remove(db.STORES.keys, 'gate');
  if (forgetDevice) await db.remove(db.STORES.keys, 'meta');
  await cloud.signOut();
  if (forgetDevice) await store.setSetting('cloudEnabled', false);
  await load();
}

/** For a deletion request. Wipes the cloud copy, leaves this device untouched. */
export async function deleteCloudData() {
  await cloud.deleteEverything(await requireOwnerToken());
  dataKey = null;
  await db.remove(db.STORES.keys, 'meta');
  await store.setSetting('cloudEnabled', false);
  await load();
}
