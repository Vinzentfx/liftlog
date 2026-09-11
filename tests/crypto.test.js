// Die Verschlüsselung, geprüft, ohne dass es einen Server gibt.
//
// Alles hier ist Rechnen mit Bytes, es läuft im Testrunner also genau wie in Safari. Das
// ist wichtiger als sonst: das ist der eine Teil der App, in dem ein Fehler keine falsche
// Zahl auf dem Bildschirm ist, sondern eine Sicherung, die niemand mehr öffnen kann, oder
// eine, die jeder öffnen kann.

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

/* ========================= den Inhalt versiegeln ========================= */

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

  // Ein Zeichen mitten im Chiffrat umdrehen. AES-GCM authentifiziert, das muss also
  // auffallen, statt zu plausiblem Unsinn entschlüsselt zu werden: eine Sicherung, die sich
  // halb wiederherstellt, ist schlimmer als eine, die sich weigert.
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

  // Eine Sicherung ist sich wiederholendes JSON. Bricht dieses Verhältnis je ein, wurde die
  // Reihenfolge der zwei Schritte vertauscht: Chiffrat lässt sich nicht komprimieren.
  assert.ok(blob.bytes < plain / 3,
    `expected the sealed payload well under a third of ${plain} bytes, got ${blob.bytes}`);
});

test('a payload the size of a real backup survives the round trip', async () => {
  // Den Helfer für base64 in Stücken gibt es, weil die naive Version irgendwo jenseits von
  // hunderttausend Bytes einen RangeError wirft, und zwar beim ersten echten Upload und in
  // keinem kleinen Test.
  const key = await generateDataKey();
  const big = { blobs: Array.from({ length: 4000 }, (_, i) => ({ i, note: 'Satz sauber, Griff eng.' })) };
  const blob = await seal(key, big);
  assert.deepEqual(await open(key, blob), big);
});

/* =========================== Wiederherstellungsschlüssel =========================== */

test('a recovery key survives being written down and typed back in', () => {
  const key = generateRecoveryKey();
  assert.match(key, /^[0-9A-F]{4}(-[0-9A-F]{4}){7}$/, 'eight groups of four, hex only');

  const bytes = parseRecoveryKey(key);
  assert.equal(bytes.length, 16);
  assert.equal(formatRecoveryKey(bytes), key);

  // Wer das von einem Zettel abschreibt, schreibt weder die Bindestriche noch Groß und Klein genau ab.
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
  // Genau darum Hex: die Buchstaben O und I kommen nie vor, 0 und 1 können also nicht als
  // diese abgeschrieben werden.
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

  // Ein neues Handy, Monate später, mit nichts als dem Zettel.
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

  // Der Server speichert das und vergleicht. Gleicher Schlüssel, gleiche Antwort.
  assert.equal(await recoveryVerifier(recovery, verifierSalt), verifier);
  // Jeder andere scheitert.
  assert.notEqual(await recoveryVerifier(generateRecoveryKey(), verifierSalt), verifier);

  // Und es darf nicht der Schlüssel zum Einpacken sein, sonst gäbe man dem Server mit dem
  // Speichern die Möglichkeit, die Sicherung zu öffnen, die er aufbewahrt.
  const wrapSalt = randomBytes(16);
  const wrapping = await keyFromRecovery(recovery, wrapSalt);
  const raw = toBase64(await globalThis.crypto.subtle.exportKey('raw', wrapping)
    .catch(() => new ArrayBuffer(0)));
  assert.notEqual(verifier, raw);
});

/* ========================== ein Gerät verbinden ========================== */

test('an approved device gets the key, a third device does not', async () => {
  const main = await generateDeviceKeys();
  const tablet = await generateDeviceKeys();
  const stranger = await generateDeviceKeys();

  const dataKey = await generateDataKey();
  const blob = await seal(dataKey, SAMPLE);

  // Was eine Freigabe macht: das Hauptgerät leitet aus seinem privaten Schlüssel und dem
  // öffentlichen des neuen ein gemeinsames Geheimnis ab und packt den Datenschlüssel damit
  // ein. Nur die beiden können dieses Geheimnis ausrechnen.
  const forTablet = await wrapDataKey(
    await sharedKey(main.privateKey, await exportPublicKey(tablet)), dataKey);

  const onTablet = await unwrapDataKey(
    await sharedKey(tablet.privateKey, await exportPublicKey(main)), forTablet);
  assert.deepEqual(await open(onTablet, blob), SAMPLE, 'the tablet can read the backup');

  // Jemand, der den eingepackten Blob vom Server geholt hat, mit seinem eigenen Gerät.
  const asStranger = await sharedKey(stranger.privateKey, await exportPublicKey(main));
  await assert.rejects(() => unwrapDataKey(asStranger, forTablet), /WRONG_KEY/);
});

test('the private half of a device key cannot be read back out', async () => {
  const device = await generateDeviceKeys();
  await assert.rejects(
    () => globalThis.crypto.subtle.exportKey('jwk', device.privateKey),
    'a device key must be usable but not copyable',
  );
  // Die öffentliche Hälfte darf reisen.
  const pub = await exportPublicKey(device);
  assert.equal(pub.kty, 'EC');
  assert.equal(pub.crv, 'P-256');
  assert.ok(!pub.d, 'the exported public key must not carry the private scalar');
});
