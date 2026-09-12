// Das Geländer für die Texttabellen.
//
// Das ganze Risiko einer Übersetzungsschicht über einer handgeschriebenen App ist das
// Auseinanderlaufen: ein Schlüssel, den es nur in einer Sprache gibt, ein Platzhalter, der
// auf einer Seite umbenannt wurde, ein Aufruf von t(), dessen Schlüssel nie jemand angelegt
// hat. Alle drei sind zur Laufzeit still (man bekommt Englisch, ein wörtliches "{name}" oder
// den Schlüssel selbst), deshalb werden sie hier abgefangen.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STRINGS } from '../js/strings.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = Object.keys(STRINGS);

const placeholders = (text) =>
  [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Jede .js-Datei unter js/, damit sich kein neuer Screen der Prüfung entziehen kann. */
function sourceFiles(dir = join(ROOT, 'js'), out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('both languages define exactly the same keys', () => {
  const [a, b] = LANGS;
  const keysA = new Set(Object.keys(STRINGS[a]));
  const keysB = new Set(Object.keys(STRINGS[b]));

  const missingInB = [...keysA].filter((k) => !keysB.has(k));
  const missingInA = [...keysB].filter((k) => !keysA.has(k));

  assert.deepEqual(missingInB, [], `missing from ${b}`);
  assert.deepEqual(missingInA, [], `missing from ${a}`);
});

test('a key takes the same placeholders in every language', () => {
  for (const key of Object.keys(STRINGS[LANGS[0]])) {
    const sets = LANGS.map((lang) => placeholders(STRINGS[lang][key]).join(','));
    assert.equal(new Set(sets).size, 1,
      `${key}: placeholders differ between languages (${sets.join(' | ')})`);
  }
});

test('no string is left empty', () => {
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      assert.equal(typeof value, 'string', `${lang}/${key} is not a string`);
      assert.ok(value.trim().length, `${lang}/${key} is empty`);
    }
  }
});

/**
 * Hausregel, und warum es ein Test ist und keine Gewohnheit: ein langer Gedankenstrich
 * wirkt auf dem Handy wie ein Stocken mitten im Satz. Ein Doppelpunkt, ein Komma oder ein
 * zweiter Satz sagen dasselbe.
 */
test('no em dash anywhere in the interface', () => {
  const offenders = [];
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      if (/[—–]/.test(value)) offenders.push(`${lang}/${key}`);
    }
  }
  assert.deepEqual(offenders, []);
});

/**
 * Fängt den vertippten Schlüssel ab, den man im Browser nicht sieht: t() fällt auf Englisch
 * und dann auf den Schlüssel selbst zurück, ein Screen zeigt also "home.stat.streek" in
 * Grau, und niemand merkt es.
 *
 * Prüfen lassen sich nur wörtliche Aufrufe. Zusammengesetzte Schlüssel
 * (`t(`weekday.${n}`)`) werden absichtlich übersprungen, statt schlecht geparst.
 */
test('every literal t() key exists in the tables', () => {
  const known = new Set(Object.keys(STRINGS[LANGS[0]]));
  const missing = new Set();

  for (const file of sourceFiles()) {
    if (file.endsWith('strings.js') || file.endsWith('i18n.js')) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\('([\w.-]+)'/g)) {
      if (!known.has(m[1])) missing.add(`${m[1]} (${file.slice(ROOT.length + 1)})`);
    }
  }

  assert.deepEqual([...missing], []);
});

/**
 * Die andere Richtung. Ein Schlüssel, den niemand sagt, ist Ballast, und im Ballast
 * versteckt sich eine falsche Übersetzung ein Jahr lang.
 *
 * Schlüssel, deren Name zur Laufzeit gebaut wird, stehen hier mit ihrem Anfang. Erreicht
 * werden sie über tRegion, tTier, tn und Co., nie als wörtlicher Text.
 */
test('no unused keys', () => {
  const COMPUTED = [
    'weekday.', 'region.', 'muscle.', 'equipment.', 'tier.', 'route.',
    // Die Progression gibt einen Grund als Schlüsselstück zurück und nicht als Satz, der Rat
    // auf dem Trainieren-Screen ist also `t('train.why.' + key)`. Das ist gewollt: die
    // Berechnung hat kein DOM und hat auch nichts Deutsches in sich zu suchen.
    'train.tip.', 'train.why.', 'train.next.',
    // Schlüssel für Fehler und Status werden über einen Code nachgeschlagen, den der Server
    // oder die Synchronisation liefert: `t('cloud.err.' + err.code)`. Die Anfänge aufzulisten
    // ist der Preis dafür, und der Test auf Gleichheit oben sorgt weiter dafür, dass beide
    // Sprachen dieselben definieren.
    'cloud.err.', 'cloud.status.',
    // Mit welcher Bevölkerungszeile ein Rang verglichen wird, hängt vom Profil ab, der
    // Schlüssel endet also auf Male oder Female und wird an der Aufrufstelle zusammengesetzt.
    'rank.pop.world', 'rank.pop.howWorld', 'rank.pop.short',
  ];
  const used = new Set();

  for (const file of sourceFiles()) {
    if (file.endsWith('strings.js')) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/'([\w.-]+\.[\w.-]+)'/g)) used.add(m[1]);
  }

  // Tab-Leiste und Pausenleiste sind Markup und keine Aufrufe: sie tragen ihren Schlüssel in
  // einem data-i18n-Attribut und würden sonst alle als unbenutzt gelten.
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-aria)?="([\w.-]+)"/g)) used.add(m[1]);

  const orphans = Object.keys(STRINGS[LANGS[0]]).filter((key) => {
    if (COMPUTED.some((p) => key.startsWith(p))) return false;
    // tn() teilt einen Zählschlüssel in .one und .other, im Quelltext steht also nur der Stamm.
    const stem = key.replace(/\.(one|other)$/, '');
    return !used.has(key) && !used.has(stem);
  });

  assert.deepEqual(orphans, []);
});
