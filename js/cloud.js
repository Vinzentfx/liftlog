// Die Verbindung zur Cloud-Sicherung. Einfaches fetch gegen PostgREST und GoTrue,
// derselbe Weg, den js/foodlookup.js schon für Barcodes nimmt. Kein SDK, kein Build-Schritt.
//
// Nichts in dieser Datei versteht Trainingsdaten. Sie bewegt einen versiegelten Blob
// und ein paar öffentliche Schlüssel und sieht nie einen Schlüssel, der etwas öffnet:
// verschlüsselt wird in js/crypto.js, bevor irgendetwas übergeben wird. Genau diese
// Trennung ist der Sinn, also bitte so lassen. An dem Tag, an dem dieses Modul ein
// Sitzungsobjekt statt eines Chiffrats annimmt, ist das Versprechen nicht mehr wahr.
//
// Jeder Fehler kommt als Error mit einem `code` zurück, an dem die Screens
// verzweigen können. "Hat nicht geklappt" darf eine Sicherungsfunktion nicht sagen.
// Die wichtigste Unterscheidung:
//
//   OFFLINE  Das Handy kam nicht an den Server. Nichts ist kaputt, später probieren.
//   STALE    Der Server hat schon eine neuere Version als die, auf der dieses Gerät
//            seinen Upload aufgebaut hat. Erst holen, dann schicken. Das ist die
//            Regel mit dem einen Schreiber bei der Arbeit, kein Fehler im üblichen Sinn.
//   DENIED   Row-Level-Security hat abgelehnt. In der Praxis: angemeldet, aber ohne Einladung.
//   AUTH     Keine Sitzung oder das Refresh-Token ist verbraucht. Nach dem Passwort fragen.

import { SUPABASE_URL, SUPABASE_ANON } from './cloud-config.js';

const AUTH = `${SUPABASE_URL}/auth/v1`;
const REST = `${SUPABASE_URL}/rest/v1`;

/* ============================== die Sitzung ============================== */

// Bewusst localStorage statt IndexedDB: das hier sind keine App-Daten, sondern ein
// Zugangsnachweis, der beim Start synchron lesbar sein muss, bevor der Store offen
// ist, und der mit den Seitendaten verschwinden soll, wenn sich jemand abmeldet oder
// den Browser leert. Fällt auf den Speicher zurück, damit sich das Modul testen lässt.
const memory = new Map();
const store = {
  get(key) {
    try { return globalThis.localStorage?.getItem(key) ?? memory.get(key) ?? null; }
    catch { return memory.get(key) ?? null; }
  },
  set(key, value) {
    memory.set(key, value);
    try { globalThis.localStorage?.setItem(key, value); } catch { /* privater Modus */ }
  },
  remove(key) {
    memory.delete(key);
    try { globalThis.localStorage?.removeItem(key); } catch { /* privater Modus */ }
  },
};

const KEY = 'liftlog.session';

let session = null;
try { session = JSON.parse(store.get(KEY) || 'null'); } catch { session = null; }
let sessionPersistent = !!session;

function keepSession(next, persistent = sessionPersistent) {
  session = next && next.access_token ? {
    access_token: next.access_token,
    refresh_token: next.refresh_token,
    // Als fester Zeitpunkt gespeichert, weil `expires_in` nur im Moment der Ankunft
    // etwas bedeutet und das hier ein schlafendes Handy übersteht.
    expires_at: Date.now() + (Number(next.expires_in) || 3600) * 1000,
    user: next.user ? { id: next.user.id, email: next.user.email } : session?.user,
  } : null;

  sessionPersistent = !!session && persistent;
  if (sessionPersistent) store.set(KEY, JSON.stringify(session));
  else store.remove(KEY);
  return session;
}

export const currentUser = () => session?.user ?? null;
export const isSignedIn = () => !!session?.access_token;

/* ================================ Leitungen ================================ */

function fail(code, message, extra = {}) {
  const err = new Error(message || code);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

/**
 * PostgREST meldet Fehler als SQL-State-Codes. Sie hier zu übersetzen heißt, dass kein
 * Screen wissen muss, was 23505 ist, und vor allem, dass die beiden, die andere Worte
 * brauchen, auch andere bekommen.
 */
function fromPostgrest(status, body) {
  const code = body?.code;
  if (code === '23505') return fail('STALE', 'the server already has a newer version');
  if (code === '42501') return fail('DENIED', body?.message || 'not allowed');
  if (code === 'P0001') return fail(body.message, body.message);   // unser eigenes raise
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(code)) {
    return fail(code, body?.message || code);
  }
  if (status === 401 || status === 403) return fail('AUTH', 'not signed in');
  return fail('SERVER', body?.message || `server said ${status}`, { status });
}

async function raw(url, { method = 'GET', headers = {}, body, token } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        apikey: SUPABASE_ANON,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // Gar keine Antwort: Flugmodus, kein Empfang, das Projekt schläft. Nie die Schuld
    // des Nutzers und nie eine beunruhigende Meldung wert.
    throw fail('OFFLINE', err?.message || 'no connection');
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    if (!res.ok) throw fromPostgrest(res.status, null);
    return null;
  }

  let parsed = null;
  const text = await res.text();
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = { message: text }; }
  }
  if (!res.ok) throw fromPostgrest(res.status, parsed);
  return parsed;
}

/** Ein Aufruf mit dem angemeldeten Nutzer, das Token wird erneuert, wenn es fällig ist. */
async function authed(url, options = {}) {
  if (!session?.access_token) throw fail('AUTH', 'not signed in');

  // Eine Minute Puffer, damit eine Anfrage kurz vor Ablauf nicht mit ihm um die Wette läuft.
  if (session.expires_at && session.expires_at - Date.now() < 60000) await refresh();

  try {
    return await raw(url, { ...options, token: session.access_token });
  } catch (err) {
    // Ein Token kann abgelehnt werden, bevor es hier abgelaufen aussieht, zum Beispiel
    // wenn das Konto auf einem anderen Gerät gelöscht wurde. Einmal wiederholen, dann aufgeben.
    if (err.code !== 'AUTH') throw err;
    await refresh();
    return raw(url, { ...options, token: session.access_token });
  }
}

async function refresh() {
  if (!session?.refresh_token) throw fail('AUTH', 'no refresh token');
  let next;
  try {
    next = await raw(`${AUTH}/token?grant_type=refresh_token`, {
      method: 'POST', body: { refresh_token: session.refresh_token },
    });
  } catch (err) {
    if (err.code === 'OFFLINE') throw err;      // Sitzung behalten, nur kein Empfang
    keepSession(null);                          // verbraucht oder entzogen: wirklich abgemeldet
    throw fail('AUTH', 'session expired');
  }
  keepSession(next, sessionPersistent);
}

/* ================================= Konto ================================= */

export async function signUp(email, password, { persist = true } = {}) {
  const out = await raw(`${AUTH}/signup`, { method: 'POST', body: { email, password } });
  // Ist die Bestätigung per E-Mail aus, kommt hier sofort eine Sitzung mit. Wird sie
  // je eingeschaltet, gibt es hier kein Token, und der Aufrufer muss das sagen, statt
  // so zu tun, als wäre das Konto fertig.
  if (!out?.access_token) throw fail('CONFIRM_EMAIL', 'this account needs email confirmation first');
  return keepSession(out, persist);
}

export async function signIn(email, password, { persist = true } = {}) {
  const out = await raw(`${AUTH}/token?grant_type=password`, {
    method: 'POST', body: { email, password },
  });
  if (!out?.access_token) throw fail('AUTH', 'wrong email or password');
  return keepSession(out, persist);
}

/** Eine Sitzung erst speichern, wenn der Server bestätigt hat, dass der Zugang weiter besteht. */
export function persistSession() {
  if (session) keepSession(session, true);
}

export async function signOut() {
  // So gut es geht: die lokale Sitzung ist das, was wirklich zählt, und auch ein Handy
  // ohne Empfang muss sich abmelden können.
  try {
    const registration = await globalThis.navigator?.serviceWorker?.getRegistration?.();
    const subscription = await registration?.pushManager?.getSubscription?.();
    if (subscription?.endpoint) {
      await authed(`${REST}/rpc/remove_push_subscription`, {
        method: 'POST', body: { push_endpoint: subscription.endpoint },
      });
      await subscription.unsubscribe();
    }
  } catch { /* eine Abmeldung offline gewinnt trotzdem, alte Endpunkte laufen beim Push aus */ }
  try { await authed(`${AUTH}/logout`, { method: 'POST' }); } catch { /* ignorieren */ }
  keepSession(null);
}

/* ================================= Profil ================================= */

/** Die Zeile, die es erst gibt, wenn eine Einladung eingelöst ist. Vorher null. */
export async function getProfile() {
  const rows = await authed(`${REST}/profiles?select=*`);
  return rows?.[0] ?? null;
}

/** Berechtigung laut Server. Anders als die lokale Sperre lässt sich die nicht umgehen. */
export async function hasActiveAccess() {
  return await authed(`${REST}/rpc/access_status`, { method: 'POST', body: {} }) === true;
}

/**
 * Einen Status, den der Server ZURÜCKGEGEBEN hat, in den Fehler verwandeln, den er
 * früher GEWORFEN hat.
 *
 * Diese RPCs werfen mit Absicht nicht mehr. Ein `raise exception` bricht die
 * Transaktion ab, in der die Funktion läuft, und hat damit die Zeile fürs Rate-Limit
 * zurückgerollt, die dieselbe Funktion eine Zeile vorher geschrieben hatte. Jeder
 * Zähler hat sich also genau bei den Versuchen zurückgesetzt, die er zählen sollte.
 * Erst ein festgeschriebener Status macht die Grenze echt. Siehe server/patch-014.
 *
 * Ein Server mit der älteren Version ohne Rückgabewert antwortet mit null und hat bei
 * jedem Problem schon geworfen. null heißt hier also Erfolg.
 */
function statusOrThrow(status, fallback) {
  if (status === null || status === undefined || status === 'OK') return;
  throw fail(typeof status === 'string' ? status : fallback, 'refused');
}

export async function claimInvite(code) {
  const status = await authed(`${REST}/rpc/claim_invite`, {
    method: 'POST', body: { invite_code: String(code || '').trim() },
  });
  statusOrThrow(status, 'INVITE_INVALID');
}

/** Legt in einem Schritt das erste Besitzergerät und das Wiederherstellungsmaterial an. */
export function configureBackup(deviceId, fields, ownerToken) {
  return authed(`${REST}/rpc/configure_backup`, {
    method: 'POST',
    body: { device: deviceId, owner_token: ownerToken, ...fields },
  });
}

/* ================================= Geräte ================================= */

export function listDevices() {
  return authed(`${REST}/devices?select=*&order=created_at`);
}

/** Meldet dieses Gerät an und bittet um Einlass. Freigegeben wird woanders. */
export async function registerDevice({ name, publicKey }) {
  const id = session?.user?.id;
  if (!id) throw fail('AUTH', 'not signed in');
  const rows = await authed(`${REST}/devices`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: { user_id: id, name, public_key: publicKey },
  });
  return rows?.[0] ?? null;
}

export function approveDevice(deviceId, { wrappedKey, wrapIv, wrappedBy }, ownerToken) {
  return authed(`${REST}/rpc/approve_device`, {
    method: 'POST', body: {
      device: deviceId, wrapped_key: wrappedKey, wrap_iv: wrapIv,
      wrapped_by: wrappedBy, owner_token: ownerToken,
    },
  });
}

export function revokeDevice(deviceId, ownerToken) {
  return authed(`${REST}/rpc/revoke_device`, {
    method: 'POST', body: { device: deviceId, owner_token: ownerToken },
  });
}

export function touchDevice(deviceId, ownerToken) {
  return authed(`${REST}/rpc/touch_device`, {
    method: 'POST', body: { device: deviceId, owner_token: ownerToken },
  });
}

/** Der Weg über die Wiederherstellung: Schlüssel beweisen, Konto übernehmen, den Rest entziehen. */
export async function claimOwnership(verifier, deviceId, ownerToken) {
  const status = await authed(`${REST}/rpc/claim_ownership`, {
    method: 'POST', body: { verifier, device: deviceId, owner_token: ownerToken },
  });
  statusOrThrow(status, 'RECOVERY_WRONG');
}

/* ================================= Sicherungen ================================= */

/** Nur Version und Größe. Reicht, um zu entscheiden, ob hochgeladen wird, ohne herunterzuladen. */
export async function latestMeta() {
  const rows = await authed(
    `${REST}/backups?select=version,bytes,created_at,device_id&order=version.desc&limit=1`);
  return rows?.[0] ?? null;
}

export async function download(version = null) {
  const where = version === null ? 'order=version.desc&limit=1' : `version=eq.${version}`;
  const rows = await authed(`${REST}/backups?select=*&${where}`);
  const row = rows?.[0];
  if (!row) throw fail('NO_BACKUP', 'nothing stored yet');
  return { version: row.version, blob: { v: 1, iv: row.iv, ct: row.ct, bytes: row.bytes } };
}

/**
 * Einen versiegelten Stand als nächste Version hochschieben.
 *
 * Die Version kommt von außen und wird nicht hier gelesen, der Aufrufer muss also
 * nachgesehen haben, was der Server hat. Ein Fehler dabei bleibt nicht still: der
 * Primärschlüssel auf (user_id, version) macht aus einem veralteten Upload ein STALE,
 * statt zu überschreiben, was ein zweites Gerät inzwischen geschrieben hat.
 */
export async function upload(blob, { version, deviceId }) {
  if (!session?.user?.id) throw fail('AUTH', 'not signed in');
  await authed(`${REST}/rpc/upload_backup_from_device`, {
    method: 'POST',
    body: {
      backup_version: version, backup_iv: blob.iv, backup_ct: blob.ct,
      backup_bytes: blob.bytes, device: deviceId,
    },
  });
  return version;
}

/**
 * Alles löschen, was dieses Konto gespeichert hat, über die RPC mit Besitzerschutz.
 *
 * Die App braucht das für eine Löschanfrage, und es ist die ehrliche Antwort darauf:
 * danach hat der Server nur noch einen Login. Den Login selbst zu löschen braucht den
 * `service_role`-Schlüssel, und den hat hier absichtlich nichts. Dieser letzte Schritt
 * passiert also im Supabase-Dashboard. Das sollte man sagen, statt so zu tun, als
 * würde der Knopf mehr machen, als er macht.
 */
export async function deleteEverything(ownerToken) {
  if (!session?.user?.id) throw fail('AUTH', 'not signed in');
  await authed(`${REST}/rpc/delete_cloud_data`, {
    method: 'POST', body: { owner_token: ownerToken },
  });
}

/** Cloud-Zeilen und die Identität in Supabase Auth über die geschützte Edge Function löschen. */
export async function deleteAccount(ownerToken) {
  if (!session?.user?.id) throw fail('AUTH', 'not signed in');
  await authed(`${SUPABASE_URL}/functions/v1/delete-account`, {
    method: 'POST', body: { owner_token: ownerToken },
  });
  keepSession(null);
}

export function listVersions() {
  return authed(`${REST}/backups?select=version,bytes,created_at,device_id&order=version.desc`);
}

/* ================================ Soziales ================================= */

const socialRpc = (name, body = {}) => authed(`${REST}/rpc/${name}`, { method: 'POST', body });

export const socialHub = () => socialRpc('social_hub');
export const socialExtras = () => socialRpc('social_extras');
export const saveSocialVisibility = (v) => socialRpc('save_social_visibility', {
  p_workouts: v.workouts, p_sets: v.sets, p_strength: v.strength,
  p_presence: v.presence, p_plan: v.plan, p_prs: v.prs,
});
export const createSocialGroup = (name) => socialRpc('create_social_group', { group_name: name });
export const addSocialGroupMember = (group, friend) => socialRpc('add_social_group_member', { p_group: group, p_friend: friend });
export const leaveSocialGroup = (group) => socialRpc('leave_social_group', { p_group: group });
export const createSocialChallenge = (group, title, metric, target, endsOn) => socialRpc('create_social_challenge', {
  p_group: group, p_title: title, p_metric: metric, p_target: target, p_ends_on: endsOn,
});
export const updateChallengeProgress = (challenge, value) => socialRpc('update_challenge_progress', { p_challenge: challenge, p_value: value });
export const publishSocialPr = (exercise, value, label) => socialRpc('publish_social_pr', { p_exercise: exercise, p_value: value, p_label: label });
export const reactSocialPr = (pr, reaction) => socialRpc('react_social_pr', { p_pr: pr, p_reaction: reaction });
export const saveSocialProfile = (profile) => socialRpc('save_social_profile', {
  new_handle: profile.handle,
  new_display_name: profile.displayName,
  is_discoverable: profile.discoverable,
  joins_leaderboard: profile.leaderboard,
});
export const publishSocialWeek = (stats) => socialRpc('publish_social_week', {
  workout_count: stats.workouts,
  working_set_count: stats.sets,
  strength_value: stats.strengthScore,
  trains_today: stats.trainingToday,
  status_text: stats.message || null,
});
export const publishSocialPresence = (stats) => socialRpc('publish_social_presence', {
  workout_count: stats.workouts,
  working_set_count: stats.sets,
  strength_value: stats.strengthScore,
  trains_today: stats.trainingToday,
  status_text: stats.message || null,
  planned_workout: stats.planToday || null,
});
export const requestFriend = (handle) => socialRpc('request_friend', { friend_handle: handle });
export const answerFriend = (requestId, accept) => socialRpc('answer_friend_request', {
  request_id: requestId, accept_request: accept,
});
export const blockSocialUser = (userId) => socialRpc('block_social_user', { blocked_user: userId });
export const sendTrainingInvite = (friendId, at, note) => socialRpc('send_training_invite', {
  friend_id: friendId, training_at: at, invite_note: note || null,
});
export const answerTrainingInvite = (inviteId, accept, message = '') => socialRpc('answer_training_invite', {
  invite_id: inviteId, accept_invite: accept, response_message: message || null,
});
export const savePushSubscription = (subscription) => socialRpc('save_push_subscription', {
  push_endpoint: subscription.endpoint,
  push_p256dh: subscription.keys.p256dh,
  push_auth: subscription.keys.auth,
});
export const saveNotificationPreferences = ({ allEnabled, creatineEnabled, creatineTime, timezone }) =>
  socialRpc('save_notification_preferences', {
    p_notifications_enabled: allEnabled,
    p_creatine_enabled: creatineEnabled,
    p_reminder_time: creatineTime,
    p_timezone_name: timezone,
  });
export const answerCreatineReminder = (action) => socialRpc('answer_creatine_reminder', {
  reminder_action: action,
});
export const shareMachineRecord = (machineHash, exercise, ratio, sex) =>
  socialRpc('share_machine_record', {
    p_machine_hash: machineHash, p_exercise: exercise, p_ratio: ratio, p_sex: sex,
  });
export const removeMachineRecord = (exercise) =>
  socialRpc('remove_machine_record', { p_exercise: exercise });

/**
 * Die eigenen Rangwerte dieses Geräts beisteuern und die Verteilung zurückbekommen.
 *
 * `entries` ist [{ key, score }]. Eine Variante nur zum Lesen gibt es absichtlich
 * nicht: wer beisteuert, bekommt die Antwort, niemand wird an einer Gruppe gemessen,
 * der er nicht beitreten wollte. Siehe server/patch-016.
 */
export const shareRankScores = (entries) => socialRpc('share_rank_scores', { p_scores: entries });
export const forgetRankScores = () => socialRpc('forget_rank_scores');
export const sendInvitePush = (inviteId) => authed(`${SUPABASE_URL}/functions/v1/send-training-invite`, {
  method: 'POST', body: { inviteId },
});
export const sendInviteResponsePush = (inviteId) => authed(`${SUPABASE_URL}/functions/v1/send-training-invite`, {
  method: 'POST', body: { inviteId, response: true },
});
