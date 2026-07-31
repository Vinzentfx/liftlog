// The crypto layer, checked without a server existing.
//
// Everything here is arithmetic on bytes, so it runs in the test runner exactly
// as it runs in Safari. That matters more than usual: this is the one part of
// the app where a bug is not a wrong number on a screen but a backup nobody can
// ever open again, or one anybody can.

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  generateDataKey, generateRecoveryKey, formatRecoveryKey, parseRecoveryKey,
  keyFromRecovery, wrapDataKey, unwrapDataKey,
  generateDeviceKeys, exportPublicKey, sharedKey,
  seal, open, randomBytes, toBase64, recoveryVerifier,
} = await import('../js/crypto.js');

const SAMPLE = {
  format: 'liftlog-backup',
  settings: { language: 'de', bodyweight: 84.2, sex: 'male' },
  sessions: Array.from({ length: 40 }, (_, i) => ({
    id: `s_${i}`, name: 'Push', startedAt: 1700000000000 + i * 86400000,
    entries: [{ exerciseId: 'ex_bench', sets: [{ weight: 100, reps: 5, done: true, type: 'working' }] }],
  })),
};

/* ========================= sealing the payload ========================= */

test('a sealed payload comes back exactly as it went in', async () => {
  const key = await generateDataKey();
  const blob = await seal(key, SAMPLE);
  assert.deepEqual(await open(key, blob), SAMPLE);
});

test('the wrong key fails loudly rather than returning something', async () => {
  const blob = await seal(await generateDataKey(), SAMPLE);
  const other = await generateDataKey();
  await assert.rejects(() => open(other, blob), /WRONG_KEY/);
});

test('a tampered payload will not open', async () => {
  const key = await generateDataKey();
  const blob = await seal(key, SAMPLE);

  // Flip one character in the middle of the ciphertext. AES-GCM authenticates,
  // so this has to be caught rather than decrypted into plausible rubbish: a
  // backup that half-restores is worse than one that refuses.
  const i = Math.floor(blob.ct.length / 2);
  const swapped = blob.ct[i] === 'A' ? 'B' : 'A';
  const tampered = { ...blob, ct: blob.ct.slice(0, i) + swapped + blob.ct.slice(i + 1) };

  await assert.rejects(() => open(key, tampered), /WRONG_KEY/);
});

test('the key is not sitting in the ciphertext', async () => {
  const key = await generateDataKey();
  const raw = toBase64(await globalThis.crypto.subtle.exportKey('raw', key));
  const blob = await seal(key, SAMPLE);
  assert.ok(!blob.ct.includes(raw.slice(0, 20)), 'the data key must not appear in what is uploaded');
});

test('compression happens before encryption, or the upload is pointless', async () => {
  const key = await generateDataKey();
  const plain = JSON.stringify(SAMPLE).length;
  const blob = await seal(key, SAMPLE);

  // Repetitive JSON is what a backup is. If this ratio ever collapses, the
  // order of the two steps has been swapped: ciphertext does not compress.
  assert.ok(blob.bytes < plain / 3,
    `expected the sealed payload well under a third of ${plain} bytes, got ${blob.bytes}`);
});

test('a payload the size of a real backup survives the round trip', async () => {
  // The chunked base64 helper exists because the naive version throws a
  // RangeError somewhere past a hundred thousand bytes, and it would have
  // thrown it on the first real upload rather than in any small test.
  const key = await generateDataKey();
  const big = { blobs: Array.from({ length: 4000 }, (_, i) => ({ i, note: 'Satz sauber, Griff eng.' })) };
  const blob = await seal(key, big);
  assert.deepEqual(await open(key, blob), big);
});

/* =========================== recovery key =========================== */

test('a recovery key survives being written down and typed back in', () => {
  const key = generateRecoveryKey();
  assert.match(key, /^[0-9A-F]{4}(-[0-9A-F]{4}){7}$/, 'eight groups of four, hex only');

  const bytes = parseRecoveryKey(key);
  assert.equal(bytes.length, 16);
  assert.equal(formatRecoveryKey(bytes), key);

  // Someone copying this off paper will not reproduce the dashes or the case.
  for (const variant of [
    key.toLowerCase(),
    key.replace(/-/g, ''),
    key.replace(/-/g, ' '),
    `  ${key.toLowerCase().replace(/-/g, '')}  `,
  ]) {
    assert.deepEqual(parseRecoveryKey(variant), bytes, `should accept: ${variant}`);
  }
});

test('a recovery key has no characters you could misread', () => {
  // Hex is the point: the letters O and I never occur, so the digits 0 and 1
  // cannot be transcribed as them.
  for (let i = 0; i < 50; i++) {
    assert.ok(!/[OIL]/.test(generateRecoveryKey()));
  }
});

test('something that is not a recovery key is rejected, not guessed at', () => {
  for (const junk of ['', 'hallo', '1234', null, undefined, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ']) {
    assert.equal(parseRecoveryKey(junk), null, `should reject: ${junk}`);
  }
});

test('the recovery key opens the backup, and only the right one does', async () => {
  const dataKey = await generateDataKey();
  const blob = await seal(dataKey, SAMPLE);

  const recovery = generateRecoveryKey();
  const salt = randomBytes(16);
  const wrapped = await wrapDataKey(await keyFromRecovery(recovery, salt), dataKey);

  // A new phone, months later, with nothing but the piece of paper.
  const recovered = await unwrapDataKey(await keyFromRecovery(recovery, salt), wrapped);
  assert.deepEqual(await open(recovered, blob), SAMPLE);

  const wrong = await keyFromRecovery(generateRecoveryKey(), salt);
  await assert.rejects(() => unwrapDataKey(wrong, wrapped), /WRONG_KEY/);
});

test('the same recovery key with a different salt is a different key', async () => {
  const dataKey = await generateDataKey();
  const recovery = generateRecoveryKey();
  const wrapped = await wrapDataKey(await keyFromRecovery(recovery, randomBytes(16)), dataKey);
  const elsewhere = await keyFromRecovery(recovery, randomBytes(16));
  await assert.rejects(() => unwrapDataKey(elsewhere, wrapped), /WRONG_KEY/);
});

test('the verifier proves the recovery key without revealing it', async () => {
  const recovery = generateRecoveryKey();
  const verifierSalt = randomBytes(16);
  const verifier = await recoveryVerifier(recovery, verifierSalt);

  // The server stores this and compares. Same key, same answer.
  assert.equal(await recoveryVerifier(recovery, verifierSalt), verifier);
  // Anyone else fails.
  assert.notEqual(await recoveryVerifier(generateRecoveryKey(), verifierSalt), verifier);

  // And it must not be the wrapping key, or storing it would hand the server
  // the ability to open the backup it is holding.
  const wrapSalt = randomBytes(16);
  const wrapping = await keyFromRecovery(recovery, wrapSalt);
  const raw = toBase64(await globalThis.crypto.subtle.exportKey('raw', wrapping)
    .catch(() => new ArrayBuffer(0)));
  assert.notEqual(verifier, raw);
});

/* ========================== linking a device ========================== */

test('an approved device gets the key, a third device does not', async () => {
  const main = await generateDeviceKeys();
  const tablet = await generateDeviceKeys();
  const stranger = await generateDeviceKeys();

  const dataKey = await generateDataKey();
  const blob = await seal(dataKey, SAMPLE);

  // What approving a device does: the main device derives a shared secret from
  // its own private key and the newcomer's public one, and wraps the data key
  // with it. Only the two of them can compute that secret.
  const forTablet = await wrapDataKey(
    await sharedKey(main.privateKey, await exportPublicKey(tablet)), dataKey);

  const onTablet = await unwrapDataKey(
    await sharedKey(tablet.privateKey, await exportPublicKey(main)), forTablet);
  assert.deepEqual(await open(onTablet, blob), SAMPLE, 'the tablet can read the backup');

  // Someone who grabbed the wrapped blob off the server, with their own device.
  const asStranger = await sharedKey(stranger.privateKey, await exportPublicKey(main));
  await assert.rejects(() => unwrapDataKey(asStranger, forTablet), /WRONG_KEY/);
});

test('the private half of a device key cannot be read back out', async () => {
  const device = await generateDeviceKeys();
  await assert.rejects(
    () => globalThis.crypto.subtle.exportKey('jwk', device.privateKey),
    'a device key must be usable but not copyable',
  );
  // The public half is meant to travel.
  const pub = await exportPublicKey(device);
  assert.equal(pub.kty, 'EC');
  assert.equal(pub.crv, 'P-256');
  assert.ok(!pub.d, 'the exported public key must not carry the private scalar');
});
