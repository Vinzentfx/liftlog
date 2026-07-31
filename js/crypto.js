// End-to-end encryption for the cloud backup.
//
// The rule this file exists to keep: **nothing readable leaves the phone.** The
// server stores ciphertext and public keys and never sees a key that opens
// anything. That is not a nicety here, it is what makes it defensible to hold
// other people's training and bodyweight data at all.
//
// Web Crypto only, so no dependency and no build step, the same constraint the
// rest of the app runs under. Everything below is available in Safari, in
// Chrome and in Node's test runner, which is why the whole file is testable
// without a server existing.
//
// The key hierarchy, because getting this wrong is the expensive kind of wrong:
//
//   dataKey        AES-GCM 256, random, created once with the account.
//                  Encrypts the backup. Never transmitted in the clear.
//   recoveryKey    128 random bits, shown to the user exactly once. Stretched
//                  with PBKDF2 and used to wrap dataKey. The wrapped copy sits
//                  on the server, which is useless without the key itself.
//   device keypair ECDH P-256, one per device, private half never leaves it.
//                  Approving a device means the main device does ECDH against
//                  the newcomer's public key and wraps dataKey for it.
//
// The login password is deliberately NOT in that list. It authenticates to the
// server and nothing else. Someone who learns the password can fetch the
// ciphertext and gets nowhere with it, which is exactly the property the
// device-approval flow is asking for: the password gets you the box, an
// approved device or the recovery key gets you the lid.
//
// Consequence, stated plainly because it cannot be softened: lose the main
// device and the recovery key together and the cloud copy is gone forever. The
// server cannot help. That is what end-to-end means.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

/** OWASP's floor for PBKDF2-SHA256 at the time of writing. */
const PBKDF2_ROUNDS = 600000;

/* ============================ small helpers ============================ */

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function toBase64(bytes) {
  let s = '';
  const view = new Uint8Array(bytes);
  // Chunked: String.fromCharCode(...bigArray) blows the argument limit on a
  // backup-sized payload, and it does it as a RangeError far from here.
  for (let i = 0; i < view.length; i += 0x8000) {
    s += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(text) {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/* ============================ recovery key ============================ */

/**
 * The escape hatch, in hex.
 *
 * Hex rather than something denser because it has no confusable characters:
 * the letters O and I never appear, so the digits 0 and 1 cannot be misread as
 * them. Someone copying this off a piece of paper months after a lost phone
 * gets exactly one chance, and a base32 alphabet that saves eight characters is
 * not worth a transcription that silently fails.
 *
 * 128 bits, stretched by PBKDF2 before it wraps anything.
 */
export function generateRecoveryKey() {
  return formatRecoveryKey(randomBytes(16));
}

export function formatRecoveryKey(bytes) {
  const hex = [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return (hex.match(/.{4}/g) || []).join('-');
}

/**
 * Tolerant on purpose: spaces, missing dashes and lower case all parse. The
 * person typing this has already had a bad day.
 *
 * @returns {Uint8Array|null} null when it is not a recovery key at all
 */
export function parseRecoveryKey(text) {
  const hex = String(text || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  if (hex.length !== 32) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Proof that you hold the recovery key, for the server.
 *
 * Needed for the one thing the recovery key does that is not decryption: making
 * a fresh phone the main device when the old one is gone. That is a change to a
 * row on the server, so the server has to be convinced, and by design it knows
 * nothing that could convince it.
 *
 * So it stores a hash instead. The client sends this verifier, the server
 * compares it to the stored one, and a match authorises the takeover. A
 * verifier is not a key: it cannot decrypt anything, and working backwards from
 * it means guessing 128 random bits. The salt here is deliberately a different
 * one from the salt that wraps the data key, so the stored verifier gives no
 * head start on the wrapping key either.
 */
export async function recoveryVerifier(recovery, verifierSalt) {
  const bytes = typeof recovery === 'string' ? parseRecoveryKey(recovery) : new Uint8Array(recovery);
  if (!bytes) throw new Error('RECOVERY_MALFORMED');
  const input = new Uint8Array(bytes.length + verifierSalt.length);
  input.set(bytes, 0);
  input.set(new Uint8Array(verifierSalt), bytes.length);
  return toBase64(await subtle.digest('SHA-256', input));
}

/* ========================== keys and wrapping ========================== */

/** The key the backup is actually encrypted with. Extractable, so it can be wrapped. */
export function generateDataKey() {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Stretches a recovery key into something that can wrap the data key. */
export async function keyFromRecovery(recovery, salt) {
  const bytes = typeof recovery === 'string' ? parseRecoveryKey(recovery) : new Uint8Array(recovery);
  if (!bytes) throw new Error('RECOVERY_MALFORMED');
  const base = await subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(salt), iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Wrap the data key so it can be stored somewhere untrusted.
 *
 * Plain AES-GCM over the raw key bytes rather than wrapKey/unwrapKey, because
 * the two produce the same result here and this way the wrapped blob is just
 * another authenticated ciphertext, handled by the same code path as everything
 * else. One less thing that can be subtly different.
 */
export async function wrapDataKey(wrappingKey, dataKey) {
  const raw = await subtle.exportKey('raw', dataKey);
  const iv = randomBytes(12);
  const wrapped = await subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, raw);
  return { wrapped: toBase64(wrapped), iv: toBase64(iv) };
}

export async function unwrapDataKey(wrappingKey, { wrapped, iv }) {
  let raw;
  try {
    raw = await subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv) }, wrappingKey, fromBase64(wrapped));
  } catch {
    // AES-GCM authenticates, so this is the wrong key or a tampered blob and
    // never a plausible-but-wrong result. Say which, rather than letting a
    // decode error surface three layers up as something unrelated.
    throw new Error('WRONG_KEY');
  }
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

/* =========================== device linking =========================== */

/**
 * One keypair per device. The private half stays in IndexedDB as a
 * non-extractable CryptoKey, so even code running in the page cannot read the
 * bytes back out; it can only ask the browser to use it.
 */
export function generateDeviceKeys() {
  return subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
}

export function exportPublicKey(keyPair) {
  return subtle.exportKey('jwk', keyPair.publicKey);
}

/**
 * The shared secret between two devices, from one side's private key and the
 * other side's public key. Both sides compute the same thing without it ever
 * crossing the network, which is the whole point of approving a device rather
 * than emailing it a key.
 */
export async function sharedKey(privateKey, otherPublicJwk) {
  const theirs = await subtle.importKey(
    'jwk', otherPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return subtle.deriveKey(
    { name: 'ECDH', public: theirs },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/* ============================ the payload ============================ */

/**
 * Compress, then encrypt. In that order, always.
 *
 * Compression first because ciphertext does not compress: encrypt-then-deflate
 * would upload the full size for nothing. A backup is mostly repeated JSON keys
 * and exercise prose, so deflate takes roughly a megabyte down to a tenth of
 * that, which is the difference between a free database tier lasting years and
 * lasting months.
 *
 * `CompressionStream` is already how a shared plan gets into a URL, so this is
 * the same trick the app plays elsewhere rather than a new dependency.
 *
 * The known caveat, since compressing before encrypting has a bad name: the
 * length of the result leaks something about the content. That attack needs an
 * adversary who can inject text into your data and watch the size change
 * repeatedly. Nobody can inject anything into your own training log, and the
 * only observer is a server that already knows how big your backup is.
 */
export async function seal(dataKey, value) {
  const json = enc.encode(JSON.stringify(value));
  const packed = await deflate(json);
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, packed);
  return {
    v: 1,
    iv: toBase64(iv),
    ct: toBase64(ct),
    // Recorded so a restore screen can say how big the thing is before pulling
    // it, and so a truncated upload is visible rather than merely broken.
    bytes: ct.byteLength,
  };
}

export async function open(dataKey, blob) {
  if (!blob || blob.v !== 1) throw new Error('BLOB_VERSION');
  let packed;
  try {
    packed = await subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(blob.iv) }, dataKey, fromBase64(blob.ct));
  } catch {
    throw new Error('WRONG_KEY');
  }
  return JSON.parse(dec.decode(await inflate(packed)));
}

/* ============================ compression ============================ */

async function through(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const deflate = (bytes) => through(bytes, new CompressionStream('deflate-raw'));
const inflate = (bytes) => through(bytes, new DecompressionStream('deflate-raw'));
