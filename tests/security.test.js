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

test('the DOM helper applies custom colour properties used by theme previews', async () => {
  const ui = await read('js/ui.js');
  assert.match(ui, /property\.startsWith\('--'\)[\s\S]*style\.setProperty\(property, value\)/);
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
  // Das native replaceChildren macht aus null einen Text, anders als unser el(). Die
  // optionale Überschrift ganz wegzulassen verhindert ein sichtbares "null" unter der Liste.
  assert.match(account, /\.\.\.\(blockedDevices\.length \? \[el\('div\.section-head'/);
  assert.doesNotMatch(account, /blockedDevices\.length \? el\('div\.section-head'[\s\S]{0,150}: null/);
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
  const end = account.indexOf('/* Wiederherstellungsschlüssel */', start);
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
  assert.match(app, /deviceUnlocked = browserTest \|\| DEMO \|\| await gate\.isUnlocked\(\)[\s\S]*deviceUnlocked && !browserTest && !DEMO && !cloud\.isSignedIn\(\)[\s\S]*await gate\.lock\(\)[\s\S]*deviceUnlocked = false/);
  assert.match(app, /\['localhost', '127\.0\.0\.1'\]\.includes\(location\.hostname\)[\s\S]*searchParams\.get\('e2e'\) === '1'/);
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

test('the installation hint cannot interrupt browser tests', async () => {
  const app = await read('js/app.js');
  assert.match(app, /openApp\(\{ skipInstallHint: browserTest \|\| DEMO \}\)/);
  assert.match(app, /if \(!skipInstallHint\) scheduleInstallHint\(\)/);
});

test('gym arrival is opt-in, local-only and allowed by the production headers', async () => {
  const gym = await read('js/gym-location.js');
  const app = await read('js/app.js');
  const headers = await read('_headers');
  const store = await read('js/store.js');
  assert.match(gym, /localStorage\.setItem\(KEY/);
  assert.doesNotMatch(store, /gymLatitude|gymLongitude|gymLocation/);
  assert.match(app, /!config\?\.enabled \|\| !plan \|\| store\.activeSession\(\)/);
  assert.match(headers, /Permissions-Policy:[^\n]*geolocation=\(self\)/);
  assert.doesNotMatch(headers, /img-src[^;]*cartocdn/);
  assert.doesNotMatch(headers, /connect-src[^;]*overpass/);
  assert.match(gym, /\.\/api\/map-tile/);
  assert.match(gym, /\.\/api\/nearby-gyms/);
});

test('map relays are fixed upstreams with bounded numeric inputs', async () => {
  const tiles = await read('functions/api/map-tile.js');
  const gyms = await read('functions/api/nearby-gyms.js');
  assert.match(tiles, /zoom < 13 \|\| zoom > 19/);
  assert.match(tiles, /https:\/\/a\.basemaps\.cartocdn\.com/);
  assert.doesNotMatch(tiles, /searchParams\.get\(['"](?:url|host|origin)/);
  assert.match(gyms, /latitude < -90 \|\| latitude > 90/);
  assert.match(gyms, /longitude < -180 \|\| longitude > 180/);
  assert.match(gyms, /leisure.+fitness_centre/);
  assert.match(gyms, /https:\/\/photon\.komoot\.io\/api/);
  assert.match(gyms, /distanceMetres[\s\S]*<= 7000/);
  assert.doesNotMatch(gyms, /tags:\s*item\.tags/);
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

test('the rank ladder reports a drop as plainly as a climb', async () => {
  const home = await read('js/screens/home.js');
  // Eine Anzeigetafel, die nur gute Nachrichten verkündet, glaubt niemand. Beide Richtungen
  // müssen also einen Umbau überleben.
  assert.match(home, /recentRankChange[\s\S]*home\.rating\.rankUp[\s\S]*home\.rating\.rankDown/);
  assert.match(home, /rankDownWhy/, 'and a demotion says it may just be bodyweight');
});

test('the warm-up offer disappears once the exercise has started', async () => {
  const train = await read('js/screens/train.js');
  const start = train.indexOf('function warmupOffer');
  assert.notEqual(start, -1);
  assert.match(train.slice(start, start + 700), /entry\.sets\.some\(isCounted\)[\s\S]*return wrap/,
    'offering a warm-up for work already done is worse than offering none');
});

test('every weight the app suggests can be made on the equipment it names', async () => {
  const progression = await read('js/progression.js');
  const warmup = await read('js/warmup.js');
  // Ein Steckgewicht hat keine 102,5 und eine Stange keine 0,5-kg-Scheibe. Beide Wege müssen
  // in roundLoad und loadable bleiben und dürfen nicht zurück zu nackter Rechnerei driften.
  assert.match(progression, /export function roundLoad[\s\S]*platePlan/);
  assert.match(progression, /loadStep\(exercise, units, override = null\)/);
  assert.match(warmup, /step: stackStep/);
});

test('machine-only training reaches both combined strength and personal progress maps', async () => {
  const home = await read('js/screens/home.js');
  // Maschinen und Kabel, jetzt, wo ein Kabelblock wie jeder andere eingestuft wird:
  // ratedMachineNames ist das eine Tor, das hier prüft also das Tor und keinen Textvergleich,
  // der früher direkt hier stand.
  assert.match(home, /ratedMachineNames\(store\.state\.exercises\)[\s\S]*buildRating\(best, settings, \{\s*machineNames/);
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
  assert.match(edge, /const target = response \? invite\.sender : invite\.recipient/);
});

test('training invite replies are private and their push cannot be replayed', async () => {
  const sql = await read('server/patch-015-training-invite-responses.sql');
  const edge = await read('supabase/functions/send-training-invite/index.ts');
  assert.match(sql, /recipient=auth\.uid\(\) and status='pending'/i);
  assert.match(sql, /response_note=nullif\(left\(trim\(response_message\),140\)/i);
  assert.match(sql, /revoke all on function public\.answer_training_invite\(uuid,boolean,text\) from public,anon/i);
  assert.match(edge, /\.eq\("recipient", userData\.user\.id\)\.in\("status", \["accepted", "declined"\]\)/);
  assert.match(edge, /\.is\("response_push_sent_at", null\)/);
  assert.match(edge, /RESPONSE_ALREADY_SENT/);
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
  // Weiterhin ein atomares addAll über die ganze Hülle: eine abgelehnte Installation wird
  // wiederholt, eine Schleife pro Datei ließe einen halben Deploy im Cache und startbar zurück.
  assert.match(worker, /addAll\(SHELL\.map/);
  assert.doesNotMatch(worker, /precache miss/);
  // Die großen Datentabellen liegen in einem eigenen Cache, damit ein neuer Stand der Hülle
  // nicht jedes Gerät noch einmal 840 KB kostet. Zwei Eigenschaften halten das ehrlich:
  // activate muss diesen Cache verschonen, und install darf nur holen, was wirklich fehlt.
  assert.match(worker, /k !== CACHE && k !== DATA_CACHE/);
  assert.match(worker, /const missing = DATA\.filter\([\s\S]{0,120}addAll\(missing/);
  // strings.js ändert sich ständig und darf nie in den Daten-Cache rutschen.
  const dataList = worker.split('const DATA = [')[1].split('];')[0];
  assert.doesNotMatch(dataList, /strings\.js/);
  for (const file of ['exercise-library', 'brand-library', 'food-library']) {
    assert.match(dataList, new RegExp(file), `${file} belongs in the data cache`);
    assert.doesNotMatch(worker.split('const SHELL = [')[1].split('\n];')[0],
      new RegExp(file), `${file} must not also sit in the shell`);
  }
  assert.match(html, /js\/bootstrap\.js[\s\S]*js\/app\.js/);
  // Das Neuladen wartet jetzt aufs Ende des Trainings. Dass es trotzdem passiert, darum geht
  // es in diesem Fall.
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
  assert.match(sync, /filter\(\(\[key\]\) => !key\.startsWith\('cloud'\)[^)]*\)/);
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

test('a load correction survives the other sheet that writes the same record', async () => {
  const train = await read('js/screens/train.js');
  const home = await read('js/screens/home.js');
  // Zwei Sheets schreiben machineSetups[exId]: die Maschineneinstellung beim Trainieren und die
  // Lastkorrektur auf Home. Wer als Zweites speichert, darf den Eintrag nicht aus den eigenen
  // Feldern neu bauen, sonst verschwindet der des anderen.
  assert.match(train, /const next = \{ \.\.\.saved,/);
  assert.match(home, /const next = \{ \.\.\.\(setups\[ex\.id\] \|\| \{\}\) \}/);

  // Und die Korrektur ändert, wie die Zahl gelesen wird, nie das Log.
  assert.match(home, /loadFactors\[ex\.name\] = Number\(setup\.loadFactor\)/);
  assert.doesNotMatch(home, /set\.weight\s*[*/]=/);
});

test('the rank-up celebration fires on a real step and respects reduced motion', async () => {
  const home = await read('js/screens/home.js');
  const art = await read('js/rank-art.js');
  const css = await read('css/styles.css');

  // Number(null) ist 0 und endlich. Eine Prüfung auf null über Number() liest ein Gerät, das
  // nie eine Stufe gespeichert hat, als "war auf Stufe 0" und gratuliert jedem bestehenden
  // Nutzer beim ersten Start. Es muss über die Identität geprüft werden.
  assert.match(home, /seen === null \|\| seen === undefined/);
  // Ein Abstieg wird still gespeichert. Einen Abstieg zu melden ist Sache des Banners.
  assert.match(home, /if \(rank\.step <= from\)[\s\S]*return;/);

  assert.match(art, /prefers-reduced-motion: reduce/);
  assert.match(art, /if \(still\) overlay\.classList\.add\('still'\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*rank-up-overlay/);

  // Für ein Abzeichen wird nichts geladen: die Zeichnung sind Pfade im Modul, sie geht also
  // offline, und es gibt keinen Dritten, dem man danken muss oder der vor der App
  // verschwindet. Die einzige erlaubte URL in der Datei ist der SVG-Namensraum, und die
  // einzigen anderen Erwähnungen sind die Lizenzen im Kopf, der erklärt, was nicht benutzt wurde.
  assert.doesNotMatch(art, /\bfetch\(/);
  const urls = [...art.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0])
    .filter((url) => url !== 'http://www.w3.org/2000/svg');
  assert.deepEqual(urls.filter((url) => !/game-icons\.net/.test(url)), []);
});

test('the rank comparison is an aggregate, opt-in, and withdrawable', async () => {
  const sql = await read('server/patch-016-rank-percentiles.sql');
  const home = await read('js/screens/home.js');
  const settings = await read('js/screens/settings.js');
  const models = await read('js/models.js');

  assert.match(sql, /rank_observations enable row level security/i);
  assert.match(sql, /revoke all on table public\.rank_observations from anon,authenticated/i);
  // Zehn andere Leute, bevor überhaupt eine Zahl zurückkommt, und nie die eigene Zeile: ein
  // Perzentil aus einer Person ist eine Beschreibung dieser Person.
  assert.match(sql, /stats\.n >= 10/);
  assert.match(sql, /o\.user_id <> auth\.uid\(\)/);
  assert.match(sql, /has_active_access/);
  // Kein Weg, der eine Zeile, eine ID oder eine Reihenfolge zurückgibt.
  assert.doesNotMatch(sql, /returns setof public\.rank_observations/i);
  assert.doesNotMatch(sql, /order by score desc/i);
  assert.match(sql, /function public\.forget_rank_scores/);
  assert.match(sql, /delete from public\.rank_observations where user_id = auth\.uid\(\)/);
  // Von PUBLIC zu entziehen reicht bei Supabase nicht: die Standardrechte geben EXECUTE für
  // jede neue Funktion direkt an anon, und ein Entzug von PUBLIC nimmt kein Recht weg, das
  // einer Rolle gegeben wurde.
  assert.match(sql, /revoke execute on function public\.share_rank_scores\(jsonb\) from anon/);
  assert.match(sql, /revoke execute on function public\.forget_rank_scores\(\) from anon/);

  // Aus, bis man es einschaltet, und Ausschalten zieht zurück, statt nur zu pausieren.
  assert.match(models, /shareRankComparison: false/);
  // Der Hinweis auf Ausreißer lässt sich abschalten, und dann wird der Hinweis versteckt und
  // nicht die Erkennung angehalten: der Rang darf sich nicht ändern, weil jemand einen Tipp
  // ausgeschaltet hat.
  assert.match(models, /outlierHints: true/);
  assert.match(home, /if \(settings\.outlierHints === false\) return null;/);
  // Nur Maschinen und Kabel. Jede Ursache, die das Sheet erklärt, betrifft, wie eine Maschine
  // Last anzeigt. "Die Hälfte zählen" bei einer Kniebeuge mit der Langhantel wäre ein
  // Angebot, das Log falsch zu machen.
  assert.match(home, /if \(!lift\.machine\) return null;/);
  const standards = await read('js/standards.js');
  assert.doesNotMatch(standards, /outlierHints/);
  assert.match(home, /if \(rankSyncing \|\| !settings\.shareRankComparison/);
  assert.match(settings, /forgetRankScores/);

  // Nur Namen von Referenzübungen verlassen das Gerät. Der Name einer eigenen Übung wäre eine
  // Gruppe aus einer Person, und der Name wäre das, woran man sie erkennt.
  assert.match(home, /if \(!isBenchmark\(lift\.name\)/);
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
  // iOS wirft eine PWA im Hintergrund weg, wann immer es Speicher braucht, und ein Update des
  // Service Workers lädt die Seite einfach neu. Beides hat früher den Timer mitgenommen,
  // mitten in der Minute, für die es ihn gibt.
  assert.match(rest, /localStorage\.setItem\(STATE_KEY/);
  assert.match(rest, /function restore\(\)[\s\S]*localStorage\.getItem\(STATE_KEY\)/);
  assert.match(rest, /export function init\(\)[\s\S]*restore\(\);/);
  // Ein Ende, das schon vorbei ist, wird verworfen statt abgeschlossen: ein Ton für eine
  // Pause, die vor zwanzig Minuten zu Ende war, ist Lärm.
  assert.match(rest, /deadline <= Date\.now\(\)[\s\S]*removeItem\(STATE_KEY\)[\s\S]*return;/);
  assert.match(rest, /export function (start|stop|extend)[\s\S]*persist\(\)/);
});

test('the rest timer reaches its own deadline while the page is not painting', async () => {
  const rest = await read('js/rest.js');
  // requestAnimationFrame läuft bei einer versteckten Seite gar nicht, der Countdown blieb
  // also stehen, wo er war, und der Ton wartete, bis man wieder auf den Bildschirm schaute,
  // genau der eine Moment, in dem man ihn nicht braucht.
  assert.doesNotMatch(rest, /(?:request|cancel)AnimationFrame\(/);
  assert.match(rest, /timer = setTimeout\(tick, 200\)/);
  assert.match(rest, /function stop\(\)[\s\S]*clearTimeout\(timer\)/);
  // Und ein Ton, der Minuten zu spät kommt, ist Lärm über etwas, das schon auf dem Screen steht.
  assert.match(rest, /ANNOUNCE_GRACE_MS/);
  assert.match(rest, /remainingMs > -ANNOUNCE_GRACE_MS\)\s*\{\s*haptic/);
});

test('a service-worker update waits for the workout to finish before reloading', async () => {
  const bootstrap = await read('js/bootstrap.js');
  const store = await read('js/store.js');
  // Die Sätze liegen so oder so sicher in IndexedDB. Der Pausentimer, ein halb eingetipptes
  // Gewicht und die Stelle auf dem Bildschirm nicht.
  assert.match(bootstrap, /controllerchange[\s\S]*reloadWhenIdle\(\)/);
  assert.match(bootstrap, /if \(!workoutOpen\(\)\)[\s\S]*location\.reload\(\)/);
  assert.match(bootstrap, /setTimeout\(reloadWhenIdle/);
  // Bootstrap darf weiterhin nichts importieren: es muss laufen, wenn der Modulbaum nur halb
  // im Cache ist, und genau für diesen Fall gibt es das.
  assert.doesNotMatch(bootstrap, /^\s*import\s/m);
  // Eine Einheit, die nie beendet wurde, ist kein laufendes Training.
  assert.match(bootstrap, /STALE_WORKOUT_MS/);
  assert.match(store, /localStorage\.setItem\(WORKOUT_OPEN_KEY, String\(open\.startedAt\)\)/);
  for (const caller of ['startSession', 'finishSession', 'discardSession']) {
    assert.match(store, new RegExp(`export async function ${caller}[\\s\\S]{0,2000}markWorkoutOpen\\(\\)`),
      `${caller} has to republish whether a workout is open`);
  }
});

test('the social screen can report a failed load instead of spinning forever', async () => {
  const users = await read('js/screens/users.js');
  // Ohne `!problem` startet ein fehlgeschlagenes Laden im selben Zeichnen, das es melden
  // sollte, gleich das nächste. `unavailable()` war also nicht erreichbar, und der Screen blieb
  // beim Ladekreis: kein Fehler, kein Wiederholen, nicht einmal nach einem Tabwechsel.
  assert.match(users, /if \(!hub && !loading && !problem\) loadHub\(\);/);
  assert.match(users, /if \(problem && !hub\) return unavailable\(problem\);/);
  assert.match(users, /function unavailable[\s\S]*onclick: loadHub/);
});

test('a second device pulls newer cloud training without having changed anything', async () => {
  const sync = await read('js/sync.js');
  const onAppOpen = sync.match(/export async function onAppOpen[\s\S]*?\n\}/)?.[0] || '';
  // Der Fingerabdruck beantwortet "hat sich dieses Gerät seit dem letzten Upload geändert",
  // und das ist eine andere Frage als "ist der Server weiter als dieses Gerät". Früher wurde
  // nur die erste gestellt, ein Handy, das nur dalag, hat also nie mitbekommen, was auf dem
  // anderen eingetragen wurde.
  assert.match(onAppOpen, /pullIfNewer\(\)[\s\S]*cloudLastFingerprint === fingerprint/);
  assert.match(sync, /export async function pullIfNewer[\s\S]*mergeDetailed[\s\S]*importData/);
  // Es führt zusammen statt zu ersetzen: das läuft von selbst beim Start und darf keine
  // Einheit verlieren können, die es nur auf diesem Gerät gibt.
  const pull = sync.match(/export async function pullIfNewer[\s\S]*?\n\}\n/)?.[0] || '';
  assert.match(pull, /store\.activeSession\(\)/, 'a workout in progress is not rewritten underneath itself');
  assert.match(pull, /if \(!mine \|\| !tookLocal\)[\s\S]*cloudLastFingerprint/,
    'a pull that added nothing local must not push an identical version straight back');
  assert.doesNotMatch(pull, /replace: false/);
});

test('online maintenance does not re-render the screen when nothing changed', async () => {
  const sync = await read('js/sync.js');
  // `load()` schreibt jede Minute dieselben acht Werte zurück, und der Abonnent zeichnet alles
  // neu. Der Trainieren-Screen wurde also mitten im Training einmal pro Minute abgerissen,
  // mitsamt dem Feld, in dem man tippte, und dem Cursor.
  assert.match(sync, /function set\(patch\)[\s\S]*if \(same\(state\[key\], value\)\) continue;[\s\S]*if \(changed\) emit\(\);/);
});

test('automatic backups reach the server at the moments that matter', async () => {
  const sync = await read('js/sync.js');
  const app = await read('js/app.js');
  const train = await read('js/screens/train.js');
  // Jede Version ist ein vollständiger Stand, und der Server behält nur die letzten paar.
  // Einmal pro Minute durch ein langes Training hochzuladen würde jeden Punkt zum
  // Zurückgehen verdrängen, bevor es vorbei ist.
  assert.match(sync, /AUTO_BACKUP_MIN_GAP_MS/);
  assert.match(sync, /!immediate && last && Date\.now\(\) - last < AUTO_BACKUP_MIN_GAP_MS/);
  assert.match(app, /export function flushBackup[\s\S]*immediate: true/);
  assert.match(app, /pagehide', flushBackup/);
  assert.match(app, /visibilityState === 'visible'\) runCloudMaintenance\(\);[\s\S]*else flushBackup\(\)/);
  assert.match(train, /store\.finishSession\(session\.id\);[\s\S]*flushBackup\(\)/);
  // Ein Training während einer laufenden normalen Prüfung zu beenden darf die sofortige
  // Anfrage nicht verlieren und auf den Fünf-Minuten-Takt zurückfallen.
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
  // `raise exception` bricht die Transaktion ab, in der die RPC läuft, und hat damit die
  // Zählerzeile zurückgerollt, die dieselbe Funktion eine Zeile vorher geschrieben hatte. Aus
  // zehn Versuchen pro Stunde wurden zehn Versuche pro Sekunde.
  assert.doesNotMatch(claim, /raise exception/i);
  assert.doesNotMatch(ownership, /raise exception/i);
  assert.match(claim, /return 'INVITE_INVALID'/);
  assert.match(ownership, /return 'RECOVERY_WRONG'/);
  // Den Rückgabetyp zu ändern macht `create or replace` nicht mit.
  assert.match(sql, /drop function if exists public\.claim_invite\(text\)/i);
  assert.match(sql, /drop function if exists public\.claim_ownership\(text, uuid, text\)/i);
  // Ein Server mit der alten Version ohne Rückgabewert antwortet null und hat bei jedem
  // Problem schon geworfen, null muss also Erfolg heißen.
  assert.match(cloud, /status === null \|\| status === undefined \|\| status === 'OK'/);
  assert.match(cloud, /claimInvite[\s\S]*statusOrThrow\(status, 'INVITE_INVALID'\)/);
  assert.match(cloud, /claimOwnership[\s\S]*statusOrThrow\(status, 'RECOVERY_WRONG'\)/);
});

test('guessing an invite code is bounded across accounts, not per account', async () => {
  const sql = await read('server/patch-014-invite-hardening.sql');
  // Registrieren ist offen und ein Konto kostet nichts, ein Zähler pro Konto ist also gar
  // keine Grenze: ein Versuch pro Wegwerfkonto erreicht ihn nie.
  assert.match(sql, /invite_guard enable row level security/i);
  assert.match(sql, /revoke all on table public\.invite_guard from anon, authenticated/i);
  const claim = sql.match(/create or replace function public\.claim_invite[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(claim, /invites_locked\(\)[\s\S]*consume_security_attempt/,
    'the shared cap is checked before the per-account one, which cannot stop this');
  assert.match(claim, /claimed_code is null[\s\S]*note_invite_failure/);
  // Selbst gewählte Codes sind etwa zwanzig Bit wert. Diese sind achtundsiebzig wert.
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

  // Eine eigene Einstellung, nicht in den Ton und nicht in den Timer gesteckt.
  assert.match(models, /restBackgroundAudio: true/);
  assert.match(settings, /restBackgroundAudio', bgAudioToggle\.checked/);
  assert.match(settings, /checkRow\(bgAudioToggle, t\('settings\.restBackgroundAudio'\)/);
  assert.match(train, /sound: store\.state\.settings\.soundOnRestEnd !== false,\s*[\s\S]{0,220}background: store\.state\.settings\.restBackgroundAudio !== false/);

  // Aus heißt gar kein Medienelement: kein Akku, keine Mediensteuerung.
  assert.match(rest, /keepAlive = background && withSound/);
  assert.match(rest, /function startKeeper\(\)\s*\{\s*if \(!keepAlive \|\| keeper\) return;/);
  // Abspielen darf nur innerhalb des Tipps beginnen, der den Satz eingetragen hat.
  assert.match(rest, /export function start[\s\S]{0,600}startKeeper\(\);/);
  assert.match(rest, /function stop\(\)[\s\S]{0,200}stopKeeper\(\)/);
  // Im Hintergrund ist der AudioContext angehalten, das Element, das schon spielt, muss also
  // den Ton übernehmen.
  assert.match(rest, /if \(sound && !keeperChime\(\)\) chime\(\);/);
  // Ein Neuladen hat keine Nutzeraktion, von der aus es starten könnte, und darf nicht so tun.
  assert.match(rest, /function restore\(\)[\s\S]{0,1200}keepAlive = false;/);
  // Beide Spuren werden erzeugt, die Regel "keine Audiodatei zum Cachen" hält also.
  assert.match(rest, /data:audio\/wav;base64/);
  assert.doesNotMatch(await read('sw.js'), /\.(mp3|wav|m4a|ogg)/);
  // ...und deshalb muss die CSP eine data:-URI als Medium erlauben, an beiden Stellen.
  assert.match(html, /media-src 'self' data:/);
  assert.match(headers, /media-src 'self' data:/);
});

test('closing the workout preview cancels its pending start', async () => {
  const preview = await read('js/workout-start.js');
  assert.match(preview, /let settled = false/);
  assert.match(preview, /onClose: dismiss/);
  assert.match(preview, /if \(settled\) return;[\s\S]*settled = true;[\s\S]*startWorkout/);
});

test('duplicating cannot claim success when another workout is active', async () => {
  const app = await read('js/app.js');
  const calendar = await read('js/screens/calendar.js');
  assert.match(app, /duplicateWorkout\(source\)[\s\S]{0,300}if \(existing\) return null/);
  assert.match(calendar, /if \(!duplicated\) \{ toast\(t\('calendar\.activeWorkout'\)\); navigate\('train'\); return; \}/);
});

test('the repository never ships the public preview', async () => {
  // Als true eingecheckt würde das beim nächsten Deploy für jeden Freund die Einladungssperre
  // abschalten und die Cloud-Sicherung ausschalten. Nur der Pages-Workflow dreht es um, und
  // nur in der Kopie, die er veröffentlicht.
  const { DEMO } = await import('../js/demo.js');
  assert.equal(DEMO, false);
  // app.js importiert die Markierung, ein Handy ohne Netz braucht sie also auch in der Hülle.
  const shell = (await read('sw.js')).split('const SHELL = [')[1].split('\n];')[0];
  assert.match(shell, /'\.\/js\/demo\.js'/);
  // Die veröffentlichte Kopie darf das echte Projekt überhaupt nicht erreichen können.
  const pages = await read('.github/workflows/pages.yml');
  assert.match(pages, /export const DEMO = true;/);
  assert.match(pages, /sed -i .*supabase/, 'the workflow strips the Supabase host from the CSP');
});

test('the preview worker clears the old app and never answers a request', async () => {
  // Nur Code: der Kopf erklärt in Worten genau die Aufrufe, die vermieden werden.
  const worker = (await read('tools/preview-sw.js')).replace(/^\s*\/\/.*$/gm, '');
  assert.match(worker, /skipWaiting\(\)/);
  assert.match(worker, /caches\.delete/);
  assert.match(worker, /\.navigate\(/);
  assert.doesNotMatch(worker, /addEventListener\('fetch'/);
  // claim() würde auch einen ersten Besuch übernehmen, und dann würde navigate() oben eine
  // Seite neu laden, die schon aktuell ist.
  assert.doesNotMatch(worker, /clients\.claim\(/);
  assert.match(await read('.github/workflows/pages.yml'), /cp tools\/preview-sw\.js _site\/sw\.js/);
});
