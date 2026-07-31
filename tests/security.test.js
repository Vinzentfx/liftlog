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
  assert.match(app, /addEventListener\('online', runCloudMaintenance\)/);
  assert.match(app, /visibilitychange[\s\S]*runCloudMaintenance/);
  assert.match(app, /setInterval\(runCloudMaintenance, 15 \* 60 \* 1000\)/);
  assert.match(app, /gate\.recheck\(\)[\s\S]*sync\.onAppOpen\(\)/);
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
  assert.match(app, /sync\.onAppOpen\(\)[\s\S]*cloud\.autoBackupFailed/);
});

test('the invite gate verifies access before opening and offers cloud consent immediately', async () => {
  const gate = await read('js/screens/gate.js');
  assert.match(gate, /claimInvite\([^;]+[\s\S]*hasActiveAccess\(\)[\s\S]*done\(\)[\s\S]*offerCloudSetup/);
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
