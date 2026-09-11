// Ende-zu-Ende-Verschlüsselung für die Cloud-Sicherung.
//
// Die Regel, für die es diese Datei gibt: NICHTS LESBARES VERLÄSST DAS HANDY. Der
// Server speichert Chiffrat und öffentliche Schlüssel und sieht nie einen Schlüssel,
// der etwas öffnet. Das ist hier kein nettes Extra, sondern der Grund, warum man
// Trainings- und Körpergewichtsdaten anderer Leute überhaupt verantworten kann.
//
// Nur Web Crypto, also keine Abhängigkeit und kein Build-Schritt, dieselbe Vorgabe wie
// im Rest der App. Alles hier gibt es in Safari, in Chrome und im Testrunner von Node,
// deshalb lässt sich die ganze Datei testen, ohne dass es einen Server gibt.
//
// Die Schlüsselhierarchie, weil ein Fehler hier von der teuren Sorte ist:
//
//   dataKey         AES-GCM 256, zufällig, einmal mit dem Konto erzeugt.
//                   Verschlüsselt die Sicherung. Wird nie im Klartext übertragen.
//   recoveryKey     128 Zufallsbits, dem Nutzer genau einmal gezeigt. Mit PBKDF2
//                   gestreckt und benutzt, um dataKey einzupacken. Die eingepackte
//                   Kopie liegt auf dem Server und ist ohne den Schlüssel nutzlos.
//   Geräte-Paar     ECDH P-256, eins pro Gerät, die private Hälfte verlässt es nie.
//                   Ein Gerät freizugeben heißt: das Hauptgerät macht ECDH mit dem
//                   öffentlichen Schlüssel des neuen und packt dataKey dafür ein.
//
// Das Login-Passwort steht absichtlich NICHT in dieser Liste. Es meldet beim Server an
// und sonst nichts. Wer das Passwort kennt, kann das Chiffrat abholen und kommt damit
// nicht weiter, und genau das will die Gerätefreigabe: das Passwort bringt einem die
// Kiste, ein freigegebenes Gerät oder der Wiederherstellungsschlüssel den Deckel.
//
// Die Folge, klar gesagt, weil man sie nicht abmildern kann: wer Hauptgerät und
// Wiederherstellungsschlüssel zusammen verliert, hat die Cloud-Kopie für immer
// verloren. Der Server kann nicht helfen. Genau das heißt Ende-zu-Ende.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

/** Die Untergrenze von OWASP für PBKDF2-SHA256, Stand beim Schreiben. */
const PBKDF2_ROUNDS = 600000;

/* ============================ kleine Helfer ============================ */

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function toBase64(bytes) {
  let s = '';
  const view = new Uint8Array(bytes);
  // In Stücken: String.fromCharCode(...großesArray) sprengt bei einer Sicherung die
  // Grenze für Argumente, und zwar als RangeError weit weg von hier.
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

/* ============================ Wiederherstellungsschlüssel ============================ */

/**
 * Der Notausgang, in Hex.
 *
 * Hex statt etwas Dichterem, weil es keine verwechselbaren Zeichen hat: O und I kommen
 * nie vor, 0 und 1 lassen sich also nicht mit ihnen verwechseln. Wer das Monate nach
 * einem verlorenen Handy von einem Zettel abschreibt, hat genau einen Versuch, und ein
 * Base32-Alphabet, das acht Zeichen spart, ist keine Abschrift wert, die still scheitert.
 *
 * 128 Bit, mit PBKDF2 gestreckt, bevor damit etwas eingepackt wird.
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
 * Absichtlich großzügig: Leerzeichen, fehlende Bindestriche und Kleinbuchstaben gehen
 * alle. Wer das eintippt, hatte schon einen schlechten Tag.
 *
 * @returns {Uint8Array|null} null, wenn es gar kein Wiederherstellungsschlüssel ist
 */
export function parseRecoveryKey(text) {
  const hex = String(text || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  if (hex.length !== 32) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Beweis für den Server, dass man den Wiederherstellungsschlüssel hat.
 *
 * Nötig für das Eine, was der Schlüssel außer Entschlüsseln tut: ein neues Handy zum
 * Hauptgerät zu machen, wenn das alte weg ist. Das ist eine Änderung an einer Zeile
 * auf dem Server, der Server muss also überzeugt werden, und absichtlich weiß er nichts,
 * womit man ihn überzeugen könnte.
 *
 * Er speichert deshalb einen Hash. Der Client schickt diesen Prüfwert, der Server
 * vergleicht ihn mit dem gespeicherten, und bei Gleichheit ist die Übernahme erlaubt.
 * Ein Prüfwert ist kein Schlüssel: er entschlüsselt nichts, und rückwärts heißt 128
 * Zufallsbits raten. Das Salz hier ist absichtlich ein anderes als das zum Einpacken
 * des Datenschlüssels, der gespeicherte Prüfwert hilft also auch dort keinen Schritt weiter.
 */
export async function recoveryVerifier(recovery, verifierSalt) {
  const bytes = typeof recovery === 'string' ? parseRecoveryKey(recovery) : new Uint8Array(recovery);
  if (!bytes) throw new Error('RECOVERY_MALFORMED');
  const input = new Uint8Array(bytes.length + verifierSalt.length);
  input.set(bytes, 0);
  input.set(new Uint8Array(verifierSalt), bytes.length);
  return toBase64(await subtle.digest('SHA-256', input));
}

/* ========================== Schlüssel und Einpacken ========================== */

/** Der Schlüssel, mit dem die Sicherung wirklich verschlüsselt ist. Exportierbar, damit er sich einpacken lässt. */
export function generateDataKey() {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Streckt einen Wiederherstellungsschlüssel zu etwas, das den Datenschlüssel einpacken kann. */
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
 * Den Datenschlüssel einpacken, damit er an einem nicht vertrauenswürdigen Ort liegen kann.
 *
 * Einfaches AES-GCM über die rohen Schlüsselbytes statt wrapKey/unwrapKey. Beides ergibt
 * hier dasselbe, und so ist der eingepackte Blob einfach ein weiteres authentifiziertes
 * Chiffrat, das über denselben Code läuft wie alles andere. Eine Sache weniger, die
 * sich unbemerkt unterscheiden kann.
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
    // AES-GCM authentifiziert, das hier ist also der falsche Schlüssel oder ein
    // manipulierter Blob, nie ein plausibles, aber falsches Ergebnis. Sagen, was davon,
    // statt einen Fehler beim Dekodieren drei Ebenen weiter oben als etwas anderes auftauchen zu lassen.
    throw new Error('WRONG_KEY');
  }
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

/* =========================== Geräte verbinden =========================== */

/**
 * Ein Schlüsselpaar pro Gerät. Die private Hälfte bleibt als nicht exportierbarer
 * CryptoKey in IndexedDB, selbst Code auf der Seite kann die Bytes also nicht
 * auslesen, er kann den Browser nur bitten, ihn zu benutzen.
 */
export function generateDeviceKeys() {
  return subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
}

export function exportPublicKey(keyPair) {
  return subtle.exportKey('jwk', keyPair.publicKey);
}

/**
 * Das gemeinsame Geheimnis zweier Geräte, aus dem privaten Schlüssel der einen und dem
 * öffentlichen der anderen Seite. Beide rechnen dasselbe aus, ohne dass es je übers Netz
 * geht. Genau darum gibt man ein Gerät frei, statt ihm einen Schlüssel zu mailen.
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

/* ============================ der Inhalt ============================ */

/**
 * Erst komprimieren, dann verschlüsseln. Immer in dieser Reihenfolge.
 *
 * Erst komprimieren, weil Chiffrat sich nicht komprimieren lässt: erst verschlüsseln,
 * dann packen würde die volle Größe umsonst hochladen. Eine Sicherung besteht vor allem
 * aus wiederholten JSON-Schlüsseln und Übungstexten, deflate macht aus etwa einem
 * Megabyte ein Zehntel. Das ist der Unterschied, ob die kostenlose Datenbank Jahre oder
 * nur Monate reicht.
 *
 * `CompressionStream` bringt schon einen geteilten Plan in eine URL, das ist also
 * derselbe Trick wie anderswo in der App und keine neue Abhängigkeit.
 *
 * Der bekannte Haken, weil Komprimieren vor dem Verschlüsseln einen schlechten Ruf hat:
 * die Länge des Ergebnisses verrät etwas über den Inhalt. Für den Angriff braucht es
 * jemanden, der Text in die Daten einschleusen und immer wieder zusehen kann, wie sich
 * die Größe ändert. In das eigene Trainingslog kann niemand etwas einschleusen, und der
 * einzige Beobachter ist ein Server, der ohnehin weiß, wie groß die Sicherung ist.
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
    // Gespeichert, damit ein Wiederherstellungs-Screen vor dem Holen sagen kann, wie groß
    // es ist, und damit ein abgeschnittener Upload auffällt, statt einfach kaputt zu sein.
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

/* ============================ Kompression ============================ */

async function through(bytes, stream, maxBytes = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('BACKUP_TOO_LARGE');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

const deflate = (bytes) => through(bytes, new CompressionStream('deflate-raw'));
const inflate = (bytes) => through(bytes, new DecompressionStream('deflate-raw'), 50 * 1024 * 1024);
