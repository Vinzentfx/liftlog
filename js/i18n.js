// Interface language. The tables live in strings.js; this is the lookup.
//
// Why a table and not German in place: the app is used by a German group, but
// the wording of a good deal of this app *is* the app — the stall report, the
// deload note, the "not recorded" rules. Keeping both languages side by side in
// one file makes it visible when one of them drifts, and a parity test in
// tests/i18n.test.js fails the moment a key exists in one language only. A
// silent fallback to English is the failure mode this design is guarding
// against, so the fallback is loud: it warns, and the test goes red.
//
// Exercise names, exercise instructions and the food libraries are NOT
// translated. They are generated data files (free-exercise-db, USDA FoodData
// Central, Open Food Facts) with no German source, and the exercise name is
// also the key `plan-share.js` resolves a shared plan by — translating it would
// break every link between two installs.

import { STRINGS } from './strings.js';

export const LANGUAGES = [
  { key: 'de', label: 'Deutsch' },
  { key: 'en', label: 'English' },
];

const LOCALES = { de: 'de-DE', en: 'en-GB' };
const FALLBACK = 'en';

let current = 'en';

/** 'de' | 'en' | null → a language that exists. null/'auto' follows the device. */
export function resolveLanguage(pref) {
  if (pref && STRINGS[pref]) return pref;
  const device = typeof navigator === 'undefined'
    ? '' : (navigator.language || '').slice(0, 2).toLowerCase();
  return STRINGS[device] ? device : FALLBACK;
}

export const language = () => current;

/** BCP-47 tag for Intl. Dates follow the interface, not the phone. */
export const locale = () => LOCALES[current] || LOCALES[FALLBACK];

/**
 * Deliberately re-applies even when the language has not changed: boot resolves
 * to the same language the module starts on more often than not, and an early
 * return there would leave the static markup in index.html untranslated.
 */
export function setLanguage(pref) {
  current = resolveLanguage(pref);
  // Guarded so the string tables can be exercised from a test runner, which is
  // the only way the German wording rules get checked at all.
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current;
    applyStatic();
  }
  return current;
}

// Warned-about keys, so a missing string in a re-rendering screen does not
// print sixty times a minute and bury everything else in the console.
const warned = new Set();

function lookup(key) {
  const hit = STRINGS[current]?.[key];
  if (hit !== undefined) return hit;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`[i18n] missing ${current}: ${key}`);
  }
  return STRINGS[FALLBACK]?.[key] ?? key;
}

function fill(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) =>
    (params[name] === undefined || params[name] === null ? whole : String(params[name])));
}

/** t('home.title'), t('home.sets', { n: 4 }) */
export function t(key, params) {
  return fill(lookup(key), params);
}

/**
 * Count-aware lookup: `tn(2, 'unit.set')` reads `unit.set.one` / `unit.set.other`
 * and fills `{n}`.
 *
 * Only two forms, which covers both languages here — German pluralises like
 * English for every noun this app says out loud. A language with more forms
 * would need this to grow; nothing is pretending otherwise.
 */
export function tn(n, key, params) {
  return fill(lookup(`${key}.${n === 1 ? 'one' : 'other'}`), { n, ...params });
}

/**
 * Values that are stored in English and only translated on the way to the screen.
 *
 * `exercise.muscle` is 'Chest' on disk, in a shared plan link and in an export,
 * and it stays that way: these turn it into a label without touching the value.
 * An unknown value falls through to itself, which is what a custom exercise
 * from an older install needs.
 */
export const tMuscle = (value) => lookupOrSelf('muscle', value);
export const tEquipment = (value) => lookupOrSelf('equipment', value);
export const tRegion = (id) => lookupOrSelf('region', id);
export const tTier = (key, { short = false } = {}) =>
  t(`tier.${key}${short ? '.short' : ''}`);

function lookupOrSelf(namespace, value) {
  const key = `${namespace}.${String(value ?? '').toLowerCase()}`;
  const hit = STRINGS[current]?.[key] ?? STRINGS[FALLBACK]?.[key];
  return hit === undefined ? String(value ?? '') : hit;
}

/**
 * Translate the markup that is in index.html rather than built by a screen:
 * the tab bar, the rest bar, the sheet's close button.
 *
 * `data-i18n` sets text, `data-i18n-aria` sets the accessible name. Elements
 * carrying either are re-read on every language change, so the switch takes
 * effect without a reload.
 */
export function applyStatic(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-aria]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  }
}
