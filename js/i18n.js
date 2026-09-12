// Sprache der Oberfläche. Die Tabellen stehen in strings.js, hier wird nachgeschlagen.
//
// Warum eine Tabelle und nicht einfach alles auf Deutsch: die App wird von einer
// deutschen Gruppe benutzt, aber bei vielem hier ist die Formulierung selbst das
// Wichtige, etwa beim Stillstandsbericht, beim Hinweis zur Deload-Woche oder bei
// den Regeln zu "nicht eingetragen". Stehen beide Sprachen nebeneinander in einer
// Datei, sieht man, wenn eine davon abdriftet, und ein Test in tests/i18n.test.js
// schlägt fehl, sobald ein Schlüssel nur in einer Sprache existiert. Ein stiller
// Rückfall auf Englisch ist genau das, was verhindert werden soll. Deshalb ist der
// Rückfall laut: er warnt, und der Test wird rot.
//
// Übungsnamen, Anleitungen und die Lebensmittel werden nicht übersetzt. Das sind
// erzeugte Datendateien (free-exercise-db, USDA FoodData Central, Open Food Facts)
// ohne deutsche Quelle. Der Übungsname ist außerdem der Schlüssel, über den
// `plan-share.js` einen geteilten Plan auflöst. Ihn zu übersetzen würde jeden Link
// zwischen zwei Installationen kaputtmachen.

import { STRINGS } from './strings.js';

export const LANGUAGES = [
  { key: 'de', label: 'Deutsch' },
  { key: 'en', label: 'English' },
];

const LOCALES = { de: 'de-DE', en: 'en-GB' };
const FALLBACK = 'en';

let current = 'en';

/** Macht aus 'de' | 'en' | null eine Sprache, die es gibt. null oder 'auto' folgt dem Gerät. */
export function resolveLanguage(pref) {
  if (pref && STRINGS[pref]) return pref;
  const device = typeof navigator === 'undefined'
    ? '' : (navigator.language || '').slice(0, 2).toLowerCase();
  return STRINGS[device] ? device : FALLBACK;
}

export const language = () => current;

/** BCP-47-Tag für Intl. Datumsangaben folgen der Oberfläche, nicht dem Handy. */
export const locale = () => LOCALES[current] || LOCALES[FALLBACK];

/**
 * Wendet absichtlich auch dann neu an, wenn sich die Sprache nicht geändert hat:
 * beim Start kommt meistens dieselbe Sprache heraus, mit der das Modul anfängt,
 * und ein frühes return würde das feste Markup in index.html unübersetzt lassen.
 */
export function setLanguage(pref) {
  current = resolveLanguage(pref);
  // Abgesichert, damit die Tabellen auch aus einem Testlauf heraus benutzt werden
  // können. Nur so werden die Regeln für die deutschen Texte überhaupt geprüft.
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current;
    applyStatic();
  }
  return current;
}

// Schlüssel, vor denen schon gewarnt wurde. Sonst meldet ein Screen, der ständig
// neu zeichnet, einen fehlenden Text sechzigmal pro Minute und die Konsole ist voll.
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
 * Nachschlagen mit Anzahl: `tn(2, 'unit.set')` liest `unit.set.one` bzw.
 * `unit.set.other` und setzt `{n}` ein.
 *
 * Nur zwei Formen. Das reicht für beide Sprachen hier, weil Deutsch bei allen
 * Wörtern, die die App benutzt, wie Englisch pluralisiert. Eine Sprache mit mehr
 * Formen bräuchte mehr, das ist bewusst nicht eingebaut.
 */
export function tn(n, key, params) {
  return fill(lookup(`${key}.${n === 1 ? 'one' : 'other'}`), { n, ...params });
}

/**
 * Werte, die auf Englisch gespeichert und erst auf dem Weg zum Bildschirm übersetzt werden.
 *
 * `exercise.muscle` ist 'Chest' auf der Platte, in einem geteilten Plan-Link und
 * im Export, und das bleibt so: die Funktionen machen daraus eine Beschriftung,
 * ohne den Wert anzufassen. Ein unbekannter Wert kommt unverändert zurück, das
 * braucht eine eigene Übung aus einer älteren Installation.
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
 * Das Markup übersetzen, das in index.html steht und nicht von einem Screen gebaut
 * wird: Tab-Leiste, Pausenleiste, Schließen-Knopf im Sheet.
 *
 * `data-i18n` setzt den Text, `data-i18n-aria` den Namen für Screenreader. Beide
 * werden bei jedem Sprachwechsel neu gelesen, der Wechsel greift also ohne Neuladen.
 */
export function applyStatic(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-aria]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  }
}
