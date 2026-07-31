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
