import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeLink } from '../js/plan-share.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('oversized shared plans are rejected before decoding or inflating', async () => {
  const result = await decodeLink(`u${'A'.repeat(100001)}`);
  assert.equal(result.ok, false);
  assert.match(result.detail, /large|groß/i);
});

test('the hardened schema has no direct profile, device, or backup writes', async () => {
  const sql = await read('server/patch-002-device-capabilities.sql');
  assert.match(sql, /create policy "read own profile"[\s\S]*for select/i);
  assert.match(sql, /create policy "read own devices"[\s\S]*for select/i);
  assert.match(sql, /create policy "read own backups"[\s\S]*for select/i);
  assert.doesNotMatch(sql, /create policy[^;]+for all/i);
});

test('cloud writes require a device-local owner capability', async () => {
  const sql = await read('server/patch-002-device-capabilities.sql');
  for (const fn of ['upload_backup', 'approve_device', 'revoke_device', 'delete_cloud_data']) {
    const start = sql.indexOf(`function public.${fn}`);
    assert.notEqual(start, -1, `${fn} exists`);
    assert.match(sql.slice(start, start + 1800), /owner_capability_ok/,
      `${fn} checks the owner capability`);
  }
});

test('the reusable recovery verifier is hidden from account RLS', async () => {
  const sql = await read('server/patch-002-device-capabilities.sql');
  assert.match(sql, /recovery_proofs enable row level security/i);
  assert.match(sql, /revoke all on table public\.recovery_proofs from anon, authenticated/i);
  assert.match(sql, /drop column if exists recovery_verifier/i);
});

test('the DOM helper has no raw HTML escape hatch', async () => {
  const ui = await read('js/ui.js');
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|outerHTML/);
});

test('the invite gate never renders null optional children as text', async () => {
  const gate = await read('js/screens/gate.js');
  assert.match(gate, /function paint\(pane, \.\.\.children\)[\s\S]*children\.filter\(Boolean\)/);
  assert.equal((gate.match(/pane\.replaceChildren\(/g) || []).length, 1,
    'all gate screens go through the null-filtering paint helper');
});

test('revocable access is checked independently of the one-time invite', async () => {
  const sql = await read('server/patch-003-revocable-access.sql');
  assert.match(sql, /create table if not exists public\.access_grants/i);
  assert.match(sql, /create or replace function public\.has_active_access\(\)/i);
  assert.match(sql, /read active own profile[\s\S]*has_active_access/i);
  assert.match(sql, /read active own devices[\s\S]*has_active_access/i);
  assert.match(sql, /read active own backups[\s\S]*has_active_access/i);
  assert.match(sql, /owner_capability_ok[\s\S]*has_active_access/i);
});

test('revocation does not remove the right to delete cloud data', async () => {
  const sql = await read('server/patch-003-revocable-access.sql');
  const start = sql.indexOf('function public.delete_cloud_data');
  assert.notEqual(start, -1, 'delete_cloud_data exists');
  const functionSql = sql.slice(start);
  const body = functionSql.slice(0, functionSql.indexOf('$$;', functionSql.indexOf('as $$')) + 3);
  assert.match(body, /owner_token_hash = digest/);
  assert.doesNotMatch(body, /has_active_access/);
  assert.match(body, /delete from public\.access_grants/);
});

test('access revocation signs out before returning to the login gate', async () => {
  const gate = await read('js/screens/gate.js');
  assert.match(gate, /revokeLocalAccess[\s\S]*lock\(\)[\s\S]*cloud\.signOut\(\)[\s\S]*location\.reload\(\)/);
  assert.match(gate, /hasActiveAccess\(\)[\s\S]*revokeLocalAccess\(\)/);
  assert.match(gate, /getProfile\(\)[\s\S]*revokeLocalAccess\(\)/);
});

test('cloud maintenance retries when connectivity returns and at intervals', async () => {
  const app = await read('js/app.js');
  assert.match(app, /addEventListener\('online', \(\) => runCloudMaintenance\(\)\)/);
  assert.match(app, /visibilitychange[\s\S]*runCloudMaintenance/);
  assert.match(app, /visibilityState === 'visible'[\s\S]*runCloudMaintenance\(\)[\s\S]*60 \* 1000/);
  assert.match(app, /gate\.recheck\(\)[\s\S]*sync\.onAppOpen\(\{ immediate \}\)/);
});

test('a removed device is kicked and cannot reuse its cached cloud key', async () => {
  const gate = await read('js/screens/gate.js');
  const sync = await read('js/sync.js');
  assert.match(gate, /currentDeviceStatus\(\)[\s\S]*deviceStatus === 'revoked'[\s\S]*revokeLocalAccess\(\)/);
  assert.match(sync, /async function loadDataKey\(devices\)[\s\S]*mine\.status !== 'approved'[\s\S]*dataKey = null[\s\S]*if \(dataKey\) return dataKey/);
  assert.match(sync, /requestAccess\(\)[\s\S]*current\?\.status === 'revoked'[\s\S]*matching\?\.status === 'revoked'/);
  assert.match(sync, /localDevice\?\.status === 'revoked' \? null/);
});

test('blocked devices stay blocked and disappear from the visible device list', async () => {
  const sync = await read('js/sync.js');
  const account = await read('js/screens/account.js');
  assert.match(sync, /current\?\.status === 'revoked'[\s\S]*DEVICE_REVOKED/);
  assert.match(sync, /matching\?\.status === 'revoked'[\s\S]*DEVICE_REVOKED/);
  assert.match(account, /activeDevices = devices\.filter\(\(d\) => d\.status !== 'revoked'\)[\s\S]*activeDevices\.map/);
});

test('pending devices remain at a polling approval gate', async () => {
  const gate = await read('js/screens/gate.js');
  const app = await read('js/app.js');
  assert.match(gate, /function paintWaiting\(pane, done\)/);
  assert.match(gate, /deviceStatus === 'pending'[\s\S]*paintWaiting\(pane, done\)/);
  assert.match(gate, /setTimeout\(poll, 10 \* 1000\)/);
  assert.match(gate, /deviceStatus === 'approved'[\s\S]*sync\.load\(\)[\s\S]*done\(\)/);
  assert.match(app, /else \{[\s\S]*await showInstallHint\(\{ beforeLogin: true \}\)[\s\S]*await gate\.show\(openApp\)/);
});

test('sign-in is only persisted after active access is confirmed', async () => {
  const gate = await read('js/screens/gate.js');
  const account = await read('js/screens/account.js');
  assert.match(gate, /signIn\([^;]+persist: false[\s\S]*hasActiveAccess\(\)[\s\S]*persistSession\(\)/);
  assert.match(account, /signIn\([^;]+persist: false[\s\S]*hasActiveAccess\(\)[\s\S]*signOut\(\)[\s\S]*persistSession\(\)/);
});

test('sign-up is only persisted after an invite is accepted', async () => {
  const gate = await read('js/screens/gate.js');
  const account = await read('js/screens/account.js');
  for (const source of [gate, account]) {
    assert.match(source, /signUp\([^;]+persist: false[\s\S]*claimInvite\([^;]+[\s\S]*persistSession\(\)/);
  }
});

test('a revoked owner can still delete cloud data from the gate', async () => {
  const gate = await read('js/screens/gate.js');
  assert.match(gate, /canDeleteCloudData\(\)[\s\S]*paintRevoked/);
  assert.match(gate, /paintRevoked[\s\S]*confirmSheet[\s\S]*deleteCloudData\(\)/);
});

test('unexpected automatic backup failures become visible', async () => {
  const app = await read('js/app.js');
  assert.match(app, /sync\.onAppOpen\(\{ immediate \}\)[\s\S]*cloud\.autoBackupFailed/);
});

test('the invite gate verifies access before opening', async () => {
  const gate = await read('js/screens/gate.js');
  assert.match(gate, /claimInvite\([^;]+[\s\S]*hasActiveAccess\(\)[\s\S]*done\(\)/);
});

test('the account invite repair path asks for consent before cloud setup', async () => {
  const account = await read('js/screens/account.js');
  const start = account.indexOf('function inviteSheet()');
  const end = account.indexOf('/* ============================ the recovery key', start);
  const inviteFlow = account.slice(start, end);
  assert.match(inviteFlow, /claimInvite[\s\S]*hasActiveAccess[\s\S]*finishSetupSheet/);
  assert.doesNotMatch(inviteFlow, /createAccount/);
});

test('the invite repair migration backfills missing grants and reloads PostgREST', async () => {
  const sql = await read('server/patch-004-repair-invite-claims.sql');
  assert.match(sql, /left join public\.access_grants[\s\S]*where ag\.user_id is null/);
  assert.match(sql, /create or replace function public\.claim_invite\(invite_code text\)/);
  assert.match(sql, /from public\.access_grants ag[\s\S]*ag\.active = true/);
  assert.match(sql, /grant execute on function public\.claim_invite\(text\) to authenticated/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
});

test('authenticated RLS policies may execute their access helper', async () => {
  for (const file of [
    'server/patch-003-revocable-access.sql',
    'server/patch-005-fix-access-policy-permission.sql',
  ]) {
    const sql = await read(file);
    assert.match(sql, /grant execute on function public\.has_active_access\(\) to authenticated/i);
  }
});

test('an activated account without cloud consent is prompted on app load', async () => {
  const app = await read('js/app.js');
  assert.match(app, /sync\.state\.signedIn[\s\S]*sync\.state\.profile[\s\S]*!sync\.state\.profile\.recovery_wrap/);
  assert.match(app, /account\.promptCloudSetup\(\)/);
});

test('signing out removes the local gate and reloads into the login screen', async () => {
  const sync = await read('js/sync.js');
  const account = await read('js/screens/account.js');
  assert.match(sync, /signOutEverywhere[\s\S]*db\.remove\(db\.STORES\.keys, 'gate'\)/);
  assert.match(account, /signOutEverywhere\(\)[\s\S]*location\.reload\(\)/);
});

test('deleting the cloud account also returns this installation to the login gate', async () => {
  const sync = await read('js/sync.js');
  const account = await read('js/screens/account.js');
  assert.match(sync, /deleteAccount\(\)[\s\S]*cloud\.deleteAccount\(ownerToken\)[\s\S]*db\.remove\(db\.STORES\.keys, 'gate'\)/);
  assert.match(sync, /deleteAccount\(\)[\s\S]*db\.remove\(db\.STORES\.keys, 'meta'\)[\s\S]*cloudEnabled/);
  assert.match(account, /sync\.deleteAccount\(\)[\s\S]*location\.reload\(\)/);
});

test('a legacy deleted account repairs its stale local gate on the next launch', async () => {
  const app = await read('js/app.js');
  assert.match(app, /deviceUnlocked = await gate\.isUnlocked\(\)[\s\S]*deviceUnlocked && !cloud\.isSignedIn\(\)[\s\S]*await gate\.lock\(\)[\s\S]*deviceUnlocked = false/);
});

test('normal sign-out preserves device identity and full erasure forgets it', async () => {
  const sync = await read('js/sync.js');
  const settings = await read('js/screens/settings.js');
  const start = sync.indexOf('export async function signOutEverywhere');
  const end = sync.indexOf('/** For a deletion request', start);
  const signOut = sync.slice(start, end);
  assert.match(signOut, /forgetDevice = false/);
  assert.match(signOut, /if \(forgetDevice\) await db\.remove\(db\.STORES\.keys, 'meta'\)/);
  assert.match(settings, /signOutEverywhere\(\{ forgetDevice: true \}\)/);
});

test('an existing device row is reused by matching its public key', async () => {
  const sync = await read('js/sync.js');
  assert.match(sync, /requestAccess[\s\S]*listDevices\(\)[\s\S]*samePublicKey/);
  assert.match(sync, /owner[\s\S]*samePublicKey\(owner\.public_key, keys\.jwk\)[\s\S]*saveMeta/);
});

test('gate sign-in registers an unknown device as pending', async () => {
  const gate = await read('js/screens/gate.js');
  assert.match(gate, /profile\.owner_device[\s\S]*deviceStatus === 'unregistered'[\s\S]*sync\.requestAccess\(\)[\s\S]*paintWaiting\(pane, done\)/);
});

test('the main device can securely restore a blocked device', async () => {
  const account = await read('js/screens/account.js');
  const sql = await read('server/patch-006-unblock-devices.sql');
  assert.match(account, /status === 'revoked'[\s\S]*cloud\.blockedDevices[\s\S]*sync\.approve\(d\.id\)/);
  assert.match(sql, /owner_capability_ok\(owner_token\)/);
  assert.match(sql, /status in \('pending', 'approved', 'revoked'\)/);
  assert.match(sql, /wrapped_key = approve_device\.wrapped_key/);
  assert.match(sql, /grant execute on function public\.approve_device/);
});

test('the owner is notified about newly pending devices', async () => {
  const app = await read('js/app.js');
  assert.match(app, /sync\.state\.isOwner[\s\S]*pendingDevices\.filter[\s\S]*cloud\.pendingAlert/);
});

test('PWA launch normalizes the initial iOS scroll offset', async () => {
  const app = await read('js/app.js');
  const css = await read('css/styles.css');
  assert.match(app, /store\.load\(\)[\s\S]*scrollTop = 0[\s\S]*requestAnimationFrame/);
  assert.match(css, /@supports \(-webkit-touch-callout: none\)[\s\S]*html, body \{ height: 100lvh; \}[\s\S]*#app \{ height: 100lvh; \}/);
  assert.match(css, /#app[\s\S]*height: 100dvh[\s\S]*overflow: hidden/);
  assert.match(css, /#screen[\s\S]*overflow-y: auto/);
  assert.match(css, /#tabbar[\s\S]*position: relative/);
});

test('mobile browsers get a one-time home-screen installation hint', async () => {
  const app = await read('js/app.js');
  assert.match(app, /beforeinstallprompt[\s\S]*event\.preventDefault\(\)/);
  assert.match(app, /isMobileDevice\(\)[\s\S]*isInstalledApp\(\)[\s\S]*installHintDismissed\(\)/);
  assert.match(app, /display-mode: standalone/);
  assert.match(app, /install\.ios[\s\S]*install\.androidReady[\s\S]*install\.androidMenu/);
  assert.match(app, /localStorage\.setItem\(INSTALL_HINT_KEY, '1'\)/);
});

test('the selected colour theme is saved and applied to the whole app', async () => {
  const app = await read('js/app.js');
  const models = await read('js/models.js');
  const settings = await read('js/screens/settings.js');
  const css = await read('css/styles.css');
  assert.match(models, /theme: 'ocean'/);
  assert.match(app, /document\.documentElement\.dataset\.theme/);
  assert.match(app, /applyTheme\(store\.state\.settings\.theme\)/);
  for (const theme of ['ocean', 'violet', 'emerald', 'sunset']) {
    assert.match(settings, new RegExp(`key: '${theme}'`));
  }
  assert.match(css, /data-theme="violet"/);
  assert.match(css, /data-theme="emerald"/);
  assert.match(css, /data-theme="sunset"/);
  assert.match(settings, /const clicked = event\.currentTarget;[\s\S]*await store\.setSetting\('theme'[\s\S]*clicked\.parentElement/);
});

test('the social hub is opt-in and exposes no social tables directly', async () => {
  const sql = await read('server/patch-008-social-hub.sql');
  const screen = await read('js/screens/users.js');
  assert.match(sql, /alter table public\.social_profiles enable row level security/i);
  assert.match(sql, /revoke all on table public\.social_profiles,public\.social_friendships,public\.social_weekly_stats from anon,authenticated/i);
  assert.match(sql, /not public\.has_active_access\(\)/i);
  assert.match(sql, /leaderboard_opt_in=true/i);
  assert.match(sql, /discoverable=true/i);
  assert.match(sql, /status='blocked'/i);
  assert.match(screen, /Individual exercises|Einzelne Übungen|users\.privacyBody/);
  assert.doesNotMatch(screen, /store\.state\.bodyweight.*publishSocialWeek/);
});

test('machine-only training reaches both combined strength and personal progress maps', async () => {
  const home = await read('js/screens/home.js');
  assert.match(home, /equipment === 'Machine'[\s\S]*buildRating\(best, settings, \{ machineNames/);
  assert.match(home, /regionProgress\(done[\s\S]*home\.map\.progressNote/);
  assert.match(home, /home\.rating\.machineEstimated[\s\S]*home\.rating\.machineCommunity/);
});

test('approved secondary devices get a narrow conflict-checked backup RPC', async () => {
  const sql = await read('server/patch-009-multi-device-backups.sql');
  const sync = await read('js/sync.js');
  const cloud = await read('js/cloud.js');
  assert.match(sql, /status='approved' and d\.wrapped_key is not null/i);
  assert.match(sql, /has_active_access\(\)/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /backup_version<>expected[\s\S]*raise exception 'STALE'/i);
  assert.doesNotMatch(sql, /owner_token|owner_capability_ok/i);
  assert.match(sync, /latestVersion > baseVersion[\s\S]*mergeSnapshots[\s\S]*importData/);
  assert.match(sync, /err\.code !== 'STALE'[\s\S]*attempt === 1/);
  assert.match(sync, /payload\.foods \|\| \[\]\)\.length/, 'a foods-only device is merged rather than replaced');
  assert.match(await read('js/store.js'), /food\.updatedAt = Date\.now\(\)/,
    'food edits carry a conflict timestamp into cloud merging');
  assert.match(cloud, /rpc\/upload_backup_from_device/);
});

test('social invitations are private, friend-only and rate limited', async () => {
  const sql = await read('server/patch-010-social-plans-invites.sql');
  assert.match(sql, /training_invites enable row level security/i);
  assert.match(sql, /revoke all on table public\.training_invites,public\.push_subscriptions from anon,authenticated/i);
  assert.match(sql, /status='accepted'[\s\S]*NOT_FRIENDS/i);
  assert.match(sql, /created_at>now\(\)-interval '1 hour'[\s\S]*RATE_LIMITED/i);
  assert.match(sql, /recipient=auth\.uid\(\) and status='pending'/i);
});

test('push sender is authenticated and cannot choose an arbitrary recipient', async () => {
  const edge = await read('supabase/functions/send-training-invite/index.ts');
  assert.match(edge, /withSupabase\(\{ auth: "user" \}/);
  assert.match(edge, /\.eq\("sender", userData\.user\.id\)\.eq\("status", "pending"\)/);
  assert.match(edge, /\.eq\("user_id", invite\.recipient\)/);
});

test('rest timer unlocks and reuses audio after a user gesture', async () => {
  const rest = await read('js/rest.js');
  assert.match(rest, /document\.addEventListener\('pointerdown', unlockAudio/);
  assert.match(rest, /const ctx = audio \|\| new Ctx\(\)/);
  assert.doesNotMatch(rest, /ctx\.close\(/);
});

test('offline updates cannot activate a partial JavaScript deployment', async () => {
  const worker = await read('sw.js');
  const html = await read('index.html');
  const bootstrap = await read('js/bootstrap.js');
  assert.match(worker, /cache\.addAll\(SHELL/);
  assert.doesNotMatch(worker, /precache miss/);
  assert.match(html, /js\/bootstrap\.js[\s\S]*js\/app\.js/);
  // The reload itself now waits for the workout to end; that it still happens
  // is what this case is about.
  assert.match(bootstrap, /controllerchange[\s\S]*reloadWhenIdle/);
  assert.match(bootstrap, /location\.reload\(\)/);
});

test('social leaderboard module has a browser-parseable closing sequence', async () => {
  const users = await read('js/screens/users.js');
  assert.doesNotMatch(users, /host\.replaceChildren\([\s\S]{0,1200}\]\)\)\)\);/);
  assert.match(users, /host\.replaceChildren\([\s\S]{0,1200}\]\)\)\);/);
});

test('notification preferences are private and creatine actions are account scoped', async () => {
  const sql = await read('server/patch-011-notification-preferences.sql');
  assert.match(sql, /notification_preferences enable row level security/i);
  assert.match(sql, /revoke all on table public\.notification_preferences from anon,authenticated/i);
  assert.match(sql, /not public\.has_active_access\(\)/i);
  assert.match(sql, /where user_id=auth\.uid\(\)/i);
  assert.match(sql, /pg_timezone_names/i);
});

test('creatine reminder dispatcher requires its cron secret', async () => {
  const edge = await read('supabase/functions/send-creatine-reminders/index.ts');
  assert.match(edge, /CREATINE_CRON_SECRET/);
  assert.match(edge, /request\.headers\.get\("x-cron-secret"\) !== cronSecret/);
  assert.match(edge, /\.eq\("all_enabled", true\)\.eq\("creatine_enabled", true\)/);
});

test('automatic backups react to data changes without uploading identical snapshots', async () => {
  const sync = await read('js/sync.js');
  assert.match(sync, /cloudLastFingerprint === fingerprint[\s\S]*skipped: true/);
  assert.match(sync, /filter\(\(\[key\]\) => !key\.startsWith\('cloud'\)\)/);
  assert.match(sync, /setSetting\('cloudLastFingerprint', backupFingerprint\(\)\)/);
  assert.doesNotMatch(sync, /Date\.now\(\) - last < 3600000/);
});

test('visible social hub adopts freshly fetched server state', async () => {
  const users = await read('js/screens/users.js');
  assert.match(users, /syncPresence\(\)[\s\S]*hub = current[\s\S]*location\.hash[\s\S]*render\(\)/);
});

test('private social groups and PR reactions stay behind narrow RPCs', async () => {
  const sql = await readFile(new URL('../server/patch-012-social-groups-challenges-pr.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table public\.social_groups enable row level security/i);
  assert.match(sql, /revoke all on table public\.social_groups[\s\S]*from anon,authenticated/i);
  assert.match(sql, /not exists\([\s\S]*social_friendships[\s\S]*status='accepted'/i);
  assert.match(sql, /show_workouts[\s\S]*show_sets[\s\S]*show_strength[\s\S]*show_presence[\s\S]*show_plan[\s\S]*show_prs/i);
  assert.match(sql, /case when p\.show_strength then s\.strength_score end/i);
  assert.match(sql, /RATE_LIMITED/i);
});

test('machine comparisons expose aggregates only and require explicit opt-in', async () => {
  const sql = await read('server/patch-013-machine-strength-standards.sql');
  const home = await read('js/screens/home.js');
  assert.match(sql, /machine_strength_observations enable row level security/i);
  assert.match(sql, /revoke all on table public\.machine_strength_observations from anon,authenticated/i);
  assert.match(sql, /count\(\*\)>=10[\s\S]*percentile_cont/i);
  assert.match(sql, /machine_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(home, /profile\?\.shareComparison[\s\S]*profile\.model/);
  assert.match(home, /crypto\.subtle\.digest\('SHA-256'/);
  assert.doesNotMatch(sql, /returns setof public\.machine_strength_observations/i);
});

test('one-workout restore decrypts the backup but imports only the selected session', async () => {
  const sync = await readFile(new URL('../js/sync.js', import.meta.url), 'utf8');
  assert.match(sync, /restoreBackupSession\(version, sessionId\)[\s\S]*find\(\(row\) => row\.id === sessionId\)/);
  assert.match(sync, /sessions: \[restored\][\s\S]*replace: false/);
  assert.match(sync, /alreadyExists[\s\S]*db\.uid\('s_'\)/);
  assert.doesNotMatch(sync.match(/export async function restoreBackupSession[\s\S]*?\n\}/)?.[0] || '', /replace: true/);
});

test('a running rest timer survives the page going away', async () => {
  const rest = await read('js/rest.js');
  // iOS discards a backgrounded PWA whenever it wants the memory, and a
  // service-worker update reloads the page outright. Both used to take the
  // timer with them, in the middle of the minute it exists for.
  assert.match(rest, /localStorage\.setItem\(STATE_KEY/);
  assert.match(rest, /function restore\(\)[\s\S]*localStorage\.getItem\(STATE_KEY\)/);
  assert.match(rest, /export function init\(\)[\s\S]*restore\(\);/);
  // A deadline already in the past is dropped rather than completed: a chime
  // for a rest that ended twenty minutes ago is noise.
  assert.match(rest, /deadline <= Date\.now\(\)[\s\S]*removeItem\(STATE_KEY\)[\s\S]*return;/);
  assert.match(rest, /export function (start|stop|extend)[\s\S]*persist\(\)/);
});

test('the rest timer reaches its own deadline while the page is not painting', async () => {
  const rest = await read('js/rest.js');
  // requestAnimationFrame does not run at all while a page is hidden, so the
  // countdown froze wherever it stood and the chime waited until you looked at
  // the screen again, which is the one moment it is not needed.
  assert.doesNotMatch(rest, /(?:request|cancel)AnimationFrame\(/);
  assert.match(rest, /timer = setTimeout\(tick, 200\)/);
  assert.match(rest, /function stop\(\)[\s\S]*clearTimeout\(timer\)/);
  // And a chime that is minutes late is noise about something already on screen.
  assert.match(rest, /ANNOUNCE_GRACE_MS/);
  assert.match(rest, /remainingMs > -ANNOUNCE_GRACE_MS\)\s*\{\s*haptic/);
});

test('a service-worker update waits for the workout to finish before reloading', async () => {
  const bootstrap = await read('js/bootstrap.js');
  const store = await read('js/store.js');
  // The sets are safe in IndexedDB either way. The rest timer, a half-typed
  // weight and your place on the screen are not.
  assert.match(bootstrap, /controllerchange[\s\S]*reloadWhenIdle\(\)/);
  assert.match(bootstrap, /if \(!workoutOpen\(\)\)[\s\S]*location\.reload\(\)/);
  assert.match(bootstrap, /setTimeout\(reloadWhenIdle/);
  // Bootstrap must keep importing nothing: it has to run when the module graph
  // is only half-cached, which is the case it exists for.
  assert.doesNotMatch(bootstrap, /^\s*import\s/m);
  // A session nobody ever closed is not a workout in progress.
  assert.match(bootstrap, /STALE_WORKOUT_MS/);
  assert.match(store, /localStorage\.setItem\(WORKOUT_OPEN_KEY, String\(open\.startedAt\)\)/);
  for (const caller of ['startSession', 'finishSession', 'discardSession']) {
    assert.match(store, new RegExp(`export async function ${caller}[\\s\\S]{0,2000}markWorkoutOpen\\(\\)`),
      `${caller} has to republish whether a workout is open`);
  }
});

test('the social screen can report a failed load instead of spinning forever', async () => {
  const users = await read('js/screens/users.js');
  // Without `!problem` the failed load starts another one on the very render
  // that was meant to report it, so `unavailable()` was unreachable and the
  // screen stayed on the spinner: no error, no retry, not even after leaving
  // the tab and coming back.
  assert.match(users, /if \(!hub && !loading && !problem\) loadHub\(\);/);
  assert.match(users, /if \(problem && !hub\) return unavailable\(problem\);/);
  assert.match(users, /function unavailable[\s\S]*onclick: loadHub/);
});

test('a second device pulls newer cloud training without having changed anything', async () => {
  const sync = await read('js/sync.js');
  const onAppOpen = sync.match(/export async function onAppOpen[\s\S]*?\n\}/)?.[0] || '';
  // The fingerprint answers "has this device changed since it last pushed",
  // which is a different question from "is the server ahead of this device".
  // Only the first one used to get asked, so a phone that just sat there never
  // picked up what the other phone had logged.
  assert.match(onAppOpen, /pullIfNewer\(\)[\s\S]*cloudLastFingerprint === fingerprint/);
  assert.match(sync, /export async function pullIfNewer[\s\S]*mergeDetailed[\s\S]*importData/);
  // It merges rather than replaces: this runs by itself on launch, so it must
  // not be able to drop a session that only exists on this device.
  const pull = sync.match(/export async function pullIfNewer[\s\S]*?\n\}\n/)?.[0] || '';
  assert.match(pull, /store\.activeSession\(\)/, 'a workout in progress is not rewritten underneath itself');
  assert.match(pull, /if \(!mine \|\| !tookLocal\)[\s\S]*cloudLastFingerprint/,
    'a pull that added nothing local must not push an identical version straight back');
  assert.doesNotMatch(pull, /replace: false/);
});

test('online maintenance does not re-render the screen when nothing changed', async () => {
  const sync = await read('js/sync.js');
  // `load()` writes the same eight values back every minute and the subscriber
  // is a full re-render, so the Train screen was torn down mid-workout once a
  // minute, taking the focused input and the caret with it.
  assert.match(sync, /function set\(patch\)[\s\S]*if \(same\(state\[key\], value\)\) continue;[\s\S]*if \(changed\) emit\(\);/);
});

test('automatic backups reach the server at the moments that matter', async () => {
  const sync = await read('js/sync.js');
  const app = await read('js/app.js');
  const train = await read('js/screens/train.js');
  // Every version is a full snapshot and the server keeps only the last few, so
  // uploading once a minute through a long workout would push every rollback
  // point out of reach by the time it ended.
  assert.match(sync, /AUTO_BACKUP_MIN_GAP_MS/);
  assert.match(sync, /!immediate && last && Date\.now\(\) - last < AUTO_BACKUP_MIN_GAP_MS/);
  assert.match(app, /export function flushBackup[\s\S]*immediate: true/);
  assert.match(app, /pagehide', flushBackup/);
  assert.match(app, /visibilityState === 'visible'\) runCloudMaintenance\(\);[\s\S]*else flushBackup\(\)/);
  assert.match(train, /store\.finishSession\(session\.id\);[\s\S]*flushBackup\(\)/);
  // Finishing a workout during an already-running routine check must not lose
  // the immediate request and fall back to the five-minute cadence.
  assert.match(app, /if \(cloudMaintenanceRunning\)[\s\S]*if \(immediate\) cloudMaintenanceImmediatePending = true/);
  assert.match(app, /if \(cloudMaintenanceImmediatePending\)[\s\S]*runCloudMaintenance\(\{ immediate: true \}\)/);
});

test('screen sections collapse from their headings and remember the choice', async () => {
  const app = await read('js/app.js');
  const ui = await read('js/ui.js');
  const css = await read('css/styles.css');
  assert.match(app, /enableCollapsibleSections\(node, name\)/);
  assert.match(ui, /export function enableCollapsibleSections/);
  assert.match(ui, /localStorage\.setItem\(COLLAPSED_SECTIONS_KEY/);
  assert.match(ui, /title\.setAttribute\('aria-expanded'/);
  assert.match(ui, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(ui, /item\.hidden = collapsed/);
  assert.match(css, /\.section-head\.is-collapsed \.section-chevron/);
});

test('the invite rate limits survive the attempt they are counting', async () => {
  const sql = await read('server/patch-014-invite-hardening.sql');
  const cloud = await read('js/cloud.js');
  const claim = sql.match(/create or replace function public\.claim_invite[\s\S]*?\$\$;/)?.[0] || '';
  const ownership = sql.match(/create or replace function public\.claim_ownership[\s\S]*?\$\$;/)?.[0] || '';
  // `raise exception` aborts the transaction the RPC runs in, which rolled back
  // the counter row the same function had written one line earlier. Ten
  // attempts an hour was ten attempts a second.
  assert.doesNotMatch(claim, /raise exception/i);
  assert.doesNotMatch(ownership, /raise exception/i);
  assert.match(claim, /return 'INVITE_INVALID'/);
  assert.match(ownership, /return 'RECOVERY_WRONG'/);
  // Changing the return type is not something `create or replace` will do.
  assert.match(sql, /drop function if exists public\.claim_invite\(text\)/i);
  assert.match(sql, /drop function if exists public\.claim_ownership\(text, uuid, text\)/i);
  // A server still on the void-returning version answers null and has already
  // raised for anything that went wrong, so null has to mean success.
  assert.match(cloud, /status === null \|\| status === undefined \|\| status === 'OK'/);
  assert.match(cloud, /claimInvite[\s\S]*statusOrThrow\(status, 'INVITE_INVALID'\)/);
  assert.match(cloud, /claimOwnership[\s\S]*statusOrThrow\(status, 'RECOVERY_WRONG'\)/);
});

test('guessing an invite code is bounded across accounts, not per account', async () => {
  const sql = await read('server/patch-014-invite-hardening.sql');
  // Signing up is open and an account costs nothing, so a per-account counter
  // is not a limit at all: one attempt per throwaway account never reaches it.
  assert.match(sql, /invite_guard enable row level security/i);
  assert.match(sql, /revoke all on table public\.invite_guard from anon, authenticated/i);
  const claim = sql.match(/create or replace function public\.claim_invite[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(claim, /invites_locked\(\)[\s\S]*consume_security_attempt/,
    'the shared cap is checked before the per-account one, which cannot stop this');
  assert.match(claim, /claimed_code is null[\s\S]*note_invite_failure/);
  // Codes people choose are worth about twenty bits. These are worth seventy-eight.
  assert.match(sql, /gen_random_bytes\(16\)/);
  assert.match(sql, /revoke all on function public\.new_invite\(text\) from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /grant execute on function public\.new_invite/i);
});

test('the background chime is a separate switch that costs nothing when off', async () => {
  const rest = await read('js/rest.js');
  const train = await read('js/screens/train.js');
  const settings = await read('js/screens/settings.js');
  const models = await read('js/models.js');
  const html = await read('index.html');
  const headers = await read('_headers');

  // Its own setting, not folded into the chime and not into the timer.
  assert.match(models, /restBackgroundAudio: true/);
  assert.match(settings, /restBackgroundAudio', bgAudioToggle\.checked/);
  assert.match(settings, /checkRow\(bgAudioToggle, t\('settings\.restBackgroundAudio'\)/);
  assert.match(train, /sound: store\.state\.settings\.soundOnRestEnd !== false,\s*[\s\S]{0,220}background: store\.state\.settings\.restBackgroundAudio !== false/);

  // Off means no media element at all: no battery, no media controls.
  assert.match(rest, /keepAlive = background && withSound/);
  assert.match(rest, /function startKeeper\(\)\s*\{\s*if \(!keepAlive \|\| keeper\) return;/);
  // Playback can only begin inside the tap that logged the set.
  assert.match(rest, /export function start[\s\S]{0,600}startKeeper\(\);/);
  assert.match(rest, /function stop\(\)[\s\S]{0,200}stopKeeper\(\)/);
  // In the background the AudioContext is suspended, so the element that is
  // already playing has to carry the chime.
  assert.match(rest, /if \(sound && !keeperChime\(\)\) chime\(\);/);
  // A reload has no gesture to start from, so it must not pretend otherwise.
  assert.match(rest, /function restore\(\)[\s\S]{0,1200}keepAlive = false;/);
  // Both tracks are generated, so the "no audio asset to cache" rule holds.
  assert.match(rest, /data:audio\/wav;base64/);
  assert.doesNotMatch(await read('sw.js'), /\.(mp3|wav|m4a|ogg)/);
  // ...which means the CSP has to allow a data: URI as media, in both places.
  assert.match(html, /media-src 'self' data:/);
  assert.match(headers, /media-src 'self' data:/);
});
