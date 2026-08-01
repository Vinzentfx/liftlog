// Talking to the cloud backup. Plain fetch against PostgREST and GoTrue, the
// same mechanism js/foodlookup.js already uses for barcodes, so no SDK and no
// build step.
//
// Nothing in this file understands training data. It moves a sealed blob and
// some public keys, and it never sees a key that opens anything: encryption
// happens in js/crypto.js before anything is handed over. That separation is
// the point, so keep it. The day this module starts taking a session object
// instead of a ciphertext is the day the promise stops being true.
//
// Every failure comes back as an Error with a `code` the screens can branch on,
// because "it did not work" is not something a backup feature is allowed to
// say. The distinction that matters most:
//
//   OFFLINE  the phone could not reach the server. Nothing is wrong, try later.
//   STALE    the server already has a newer version than this device based its
//            upload on. Pull before pushing. This is the one-writer rule doing
//            its job, not an error in the usual sense.
//   DENIED   row-level security refused. In practice: signed in, but no invite.
//   AUTH     no session, or the refresh token is spent. Ask for the password.

import { SUPABASE_URL, SUPABASE_ANON } from './cloud-config.js';

const AUTH = `${SUPABASE_URL}/auth/v1`;
const REST = `${SUPABASE_URL}/rest/v1`;

/* ============================== the session ============================== */

// localStorage rather than IndexedDB, deliberately: this is not app data. It is
// a credential that has to be readable synchronously at boot, before the store
// has opened, and that should disappear with the site data when someone signs
// out or clears the browser. Falls back to memory so the module can be tested.
const memory = new Map();
const store = {
  get(key) {
    try { return globalThis.localStorage?.getItem(key) ?? memory.get(key) ?? null; }
    catch { return memory.get(key) ?? null; }
  },
  set(key, value) {
    memory.set(key, value);
    try { globalThis.localStorage?.setItem(key, value); } catch { /* private mode */ }
  },
  remove(key) {
    memory.delete(key);
    try { globalThis.localStorage?.removeItem(key); } catch { /* private mode */ }
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
    // Recorded as an absolute moment, because `expires_in` is only meaningful
    // at the instant it arrives and this survives a phone being asleep.
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

/* ================================ plumbing ================================ */

function fail(code, message, extra = {}) {
  const err = new Error(message || code);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

/**
 * PostgREST reports failures as SQL state codes. Translating them here means a
 * screen never has to know what 23505 is, and more importantly means the two
 * that need different words get them.
 */
function fromPostgrest(status, body) {
  const code = body?.code;
  if (code === '23505') return fail('STALE', 'the server already has a newer version');
  if (code === '42501') return fail('DENIED', body?.message || 'not allowed');
  if (code === 'P0001') return fail(body.message, body.message);   // our own raise
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
    // No response at all: aeroplane mode, no signal, the project asleep. Never
    // the user's fault and never worth an alarming message.
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

/** A call that carries the signed-in user, refreshing the token if it is due. */
async function authed(url, options = {}) {
  if (!session?.access_token) throw fail('AUTH', 'not signed in');

  // A minute of slack, so a request started just before expiry does not race it.
  if (session.expires_at && session.expires_at - Date.now() < 60000) await refresh();

  try {
    return await raw(url, { ...options, token: session.access_token });
  } catch (err) {
    // A token can be rejected before it looks expired here, for instance after
    // the account was deleted on another device. One retry, then give up.
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
    if (err.code === 'OFFLINE') throw err;      // keep the session, just no signal
    keepSession(null);                          // spent or revoked: really signed out
    throw fail('AUTH', 'session expired');
  }
  keepSession(next, sessionPersistent);
}

/* ================================= account ================================= */

export async function signUp(email, password, { persist = true } = {}) {
  const out = await raw(`${AUTH}/signup`, { method: 'POST', body: { email, password } });
  // With email confirmation switched off this carries a session straight away.
  // If it is ever switched on, there is no token here and the caller has to say
  // so rather than pretending the account is ready.
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

/** Persist a session only after the server has confirmed ongoing access. */
export function persistSession() {
  if (session) keepSession(session, true);
}

export async function signOut() {
  // Best effort: the local session is what actually matters, and a phone with
  // no signal must still be able to sign out.
  try {
    const registration = await globalThis.navigator?.serviceWorker?.getRegistration?.();
    const subscription = await registration?.pushManager?.getSubscription?.();
    if (subscription?.endpoint) {
      await authed(`${REST}/rpc/remove_push_subscription`, {
        method: 'POST', body: { push_endpoint: subscription.endpoint },
      });
      await subscription.unsubscribe();
    }
  } catch { /* an offline sign-out still wins; stale endpoints expire on push */ }
  try { await authed(`${AUTH}/logout`, { method: 'POST' }); } catch { /* ignore */ }
  keepSession(null);
}

/* ================================= profile ================================= */

/** The row that only exists once an invite has been redeemed. Null before that. */
export async function getProfile() {
  const rows = await authed(`${REST}/profiles?select=*`);
  return rows?.[0] ?? null;
}

/** Server-authoritative entitlement; unlike the local gate this cannot be bypassed. */
export async function hasActiveAccess() {
  return await authed(`${REST}/rpc/access_status`, { method: 'POST', body: {} }) === true;
}

export async function claimInvite(code) {
  await authed(`${REST}/rpc/claim_invite`, {
    method: 'POST', body: { invite_code: String(code || '').trim() },
  });
}

/** Atomically establishes the first owner device and recovery material. */
export function configureBackup(deviceId, fields, ownerToken) {
  return authed(`${REST}/rpc/configure_backup`, {
    method: 'POST',
    body: { device: deviceId, owner_token: ownerToken, ...fields },
  });
}

/* ================================= devices ================================= */

export function listDevices() {
  return authed(`${REST}/devices?select=*&order=created_at`);
}

/** Announces this device and asks to be let in. Approval happens elsewhere. */
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

/** The recovery route: prove the key, take the account over, revoke the rest. */
export function claimOwnership(verifier, deviceId, ownerToken) {
  return authed(`${REST}/rpc/claim_ownership`, {
    method: 'POST', body: { verifier, device: deviceId, owner_token: ownerToken },
  });
}

/* ================================= backups ================================= */

/** Version and size only. Enough to decide whether to upload, without the download. */
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
 * Push a sealed snapshot as the next version.
 *
 * The version is passed in rather than read here, so the caller has to have
 * looked at what the server holds. Getting it wrong is not silent: the primary
 * key on (user_id, version) turns a stale push into STALE rather than letting
 * it overwrite whatever a second device wrote in the meantime.
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
 * Erase everything this account has stored through the owner-protected RPC.
 *
 * The app needs this for a deletion request, and it is the honest answer to
 * one: after this the server holds nothing but a login. Removing the login
 * itself needs the `service_role` key, which by design nothing here has, so
 * that last step happens in the Supabase dashboard. Worth saying out loud
 * rather than implying the button does more than it does.
 */
export async function deleteEverything(ownerToken) {
  if (!session?.user?.id) throw fail('AUTH', 'not signed in');
  await authed(`${REST}/rpc/delete_cloud_data`, {
    method: 'POST', body: { owner_token: ownerToken },
  });
}

/** Delete cloud rows and the Supabase Auth identity through the protected Edge Function. */
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

/* ================================ social ================================= */

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
export const answerTrainingInvite = (inviteId, accept) => socialRpc('answer_training_invite', {
  invite_id: inviteId, accept_invite: accept,
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
export const sendInvitePush = (inviteId) => authed(`${SUPABASE_URL}/functions/v1/send-training-invite`, {
  method: 'POST', body: { inviteId },
});
