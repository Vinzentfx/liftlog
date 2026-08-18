// The guard rail for the string tables.
//
// The whole risk of an i18n layer over a hand-written app is drift: a key that
// exists in one language, a placeholder that got renamed on one side, a call to
// t() whose key nobody ever added. All three are silent at runtime (you get
// English, or a literal "{name}", or the key itself), so they are caught here
// instead.

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

/** Every .js file under js/, so a new screen cannot escape the scan. */
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
 * House rule, and the reason it is a test rather than a habit: an em dash reads
 * as a stall mid-sentence on a phone. A colon, a comma or a second sentence
 * says the same thing.
 */
test('no em dash anywhere in the interface', () => {
  const offenders = [];
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      if (value.includes('—')) offenders.push(`${lang}/${key}`);
    }
  }
  assert.deepEqual(offenders, []);
});

/**
 * Catches the typo'd key, which is invisible in the browser: t() falls back to
 * English and then to the key itself, so a screen shows "home.stat.streek" in
 * grey and nobody notices.
 *
 * Only literal calls can be checked. Computed keys (`t(`weekday.${n}`)`) are
 * skipped on purpose rather than parsed badly.
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
 * The other direction. A key nobody says is dead weight, and dead weight is
 * where a wrong translation hides for a year.
 *
 * Keys whose name is built at runtime are listed by prefix; they are reached
 * through tRegion / tTier / tn and friends, never as a literal.
 */
test('no unused keys', () => {
  const COMPUTED = [
    'weekday.', 'region.', 'muscle.', 'equipment.', 'tier.', 'route.',
    // The progression engine returns a reason as a key fragment rather than a
    // sentence, so the advice on the training screen is `t('train.why.' + key)`.
    // That is deliberate: the engine is DOM-free and has no business holding
    // German in it.
    'train.tip.', 'train.why.', 'train.next.',
    // Error and status keys are looked up from a code the server or the sync
    // layer produced: `t('cloud.err.' + err.code)`. Listing the prefixes is the
    // price of that, and the parity test above still guarantees both languages
    // define the same set of them.
    'cloud.err.', 'cloud.status.',
  ];
  const used = new Set();

  for (const file of sourceFiles()) {
    if (file.endsWith('strings.js')) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/'([\w.-]+\.[\w.-]+)'/g)) used.add(m[1]);
  }

  // The tab bar and the rest bar are markup, not calls: they carry their key in
  // a data-i18n attribute and would otherwise all read as unused.
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-aria)?="([\w.-]+)"/g)) used.add(m[1]);

  const orphans = Object.keys(STRINGS[LANGS[0]]).filter((key) => {
    if (COMPUTED.some((p) => key.startsWith(p))) return false;
    // tn() splits a count key into .one / .other, so the source only ever
    // mentions the stem.
    const stem = key.replace(/\.(one|other)$/, '');
    return !used.has(key) && !used.has(stem);
  });

  assert.deepEqual(orphans, []);
});
