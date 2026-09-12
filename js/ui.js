// Helfer für DOM und Formatierung, die jeder Screen benutzt.

import { t, locale } from './i18n.js';

/** el('div.card', {onclick}, [Kinder]) */
export function el(spec, props = {}, children = []) {
  const [tagPart, ...classes] = String(spec).split('.');
  const tag = tagPart || 'div';
  const node = document.createElement(tag);
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = [node.className, v].filter(Boolean).join(' ');
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [property, value] of Object.entries(v)) {
        if (property.startsWith('--')) node.style.setProperty(property, value);
        else node.style[property] = value;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }

  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/**
 * `parent.append(...)` mit den Regeln von `el` für Kinder.
 *
 * `el` überspringt ein null-Kind, das `append` des DOM macht daraus einen Text. Eine
 * Funktion, die null für "hier gibt es nichts" zurückgibt, schreibt also das Wort
 * NULL auf den Bildschirm, sobald jemand ihr Ergebnis direkt anhängt statt es als
 * Kind aufzuführen. Das ist nicht ausgedacht: die Stärkekarte hat bei jedem mit fünf
 * oder weniger Übungen ein wörtliches "null" unter die Liste geschrieben und noch
 * einmal unter die Maschinenrekorde, weil der Schalter "alle zeigen" genau dann
 * nichts anzubieten hat und das mit null sagt.
 *
 * Überall benutzen, wo das Kind aus einem Aufruf kommt, der auch ablehnen kann.
 */
export function add(parent, ...children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

const AUTH_ICONS = {
  email: ['M4 6h16v12H4z', 'm4 7 8 6 8-6'],
  lock: ['M6 10h12v10H6z', 'M8 10V7a4 4 0 0 1 8 0v3', 'M12 14v2'],
  key: ['M14 7a4 4 0 1 1-3.8 5.2L4 18.4V21h2.6l1-1H10l1-1v-2.4l1.8-1.8A4 4 0 0 1 14 7z'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
  search: ['M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z', 'm16 16 5 5'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  note: ['M5 3h14v18H5z', 'M8 8h8', 'M8 12h8', 'M8 16h5'],
};

/** Einheitliches, fingerfreundliches Feld für Anmelden, Registrieren und Wiederherstellen. */
export function authField(label, input, { icon = 'email', note = null } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of AUTH_ICONS[icon] || AUTH_ICONS.email) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return el('label.auth-field', {}, [
    el('span.auth-label', { text: label }),
    el('span.auth-control', {}, [svg, input]),
    note ? el('span.auth-note', { text: note }) : null,
  ]);
}

export const $ = (sel, root = document) => root.querySelector(sel);

const COLLAPSED_SECTIONS_KEY = 'liftlog.collapsedSections.v1';

function collapsedSections() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_SECTIONS_KEY) || '[]');
    return new Set(Array.isArray(saved) ? saved : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedSections(sections) {
  try { localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...sections])); }
  catch { /* privater Modus: Einklappen geht trotzdem bis zum nächsten Zeichnen */ }
}

/** Normale Überschriften klappen die Karten und Zeilen darunter ein und aus. */
export function enableCollapsibleSections(root, route) {
  const saved = collapsedSections();
  const occurrences = new Map();

  root.querySelectorAll('.section-head').forEach((head) => {
    const title = head.querySelector(':scope > h2');
    if (!title || head.dataset.fixed === 'true') return;

    const content = [];
    for (let next = head.nextElementSibling; next; next = next.nextElementSibling) {
      // Eine direkte Überschrift oder eine benachbarte Hülle, die mit einer
      // Überschrift anfängt, ist ein neuer Abschnitt und gehört nicht zum aktuellen.
      if (next.matches('.section-head')
          || next.firstElementChild?.matches('.section-head')) break;
      content.push(next);
    }
    if (!content.length) return;

    const label = title.textContent.trim().toLocaleLowerCase();
    const occurrence = occurrences.get(label) || 0;
    occurrences.set(label, occurrence + 1);
    const key = `${route}:${label}:${occurrence}`;
    title.append(el('span.section-chevron', { 'aria-hidden': 'true', text: '⌄' }));
    title.classList.add('section-toggle');
    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');

    const apply = (collapsed) => {
      title.setAttribute('aria-expanded', String(!collapsed));
      head.classList.toggle('is-collapsed', collapsed);
      content.forEach((item) => { item.hidden = collapsed; });
    };
    apply(saved.has(key));

    const toggle = () => {
      const collapsed = title.getAttribute('aria-expanded') === 'true';
      if (collapsed) saved.add(key); else saved.delete(key);
      saveCollapsedSections(saved);
      apply(collapsed);
    };
    title.addEventListener('click', toggle);
    title.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle();
    });
  });
}

/**
 * Ein Zahlenfeld, das das Trennzeichen annimmt, das die Tastatur wirklich anbietet.
 *
 * `<input type="number">` nimmt nur einen Punkt, egal welche Sprache. Auf einem
 * deutschen Handy ist die Dezimaltaste aber ein Komma. Wer "82,5" tippt, sieht die
 * Ziffern im Feld, `.value` ist aber leer, die App hat nichts gespeichert und nichts
 * gesagt. Mitten im Training ist das ein verlorener Satz.
 *
 * Ein Textfeld mit inputmode="decimal" behält unter iOS die Zifferntastatur, und
 * `parseNumber` nimmt beide Trennzeichen. Dafür fällt die Prüfung von min/step durch
 * den Browser weg, die hat die App aber sowieso schon in JS gemacht.
 */
export function numberInput({ decimal = false, ...props } = {}) {
  return el('input', {
    type: 'text',
    inputmode: decimal ? 'decimal' : 'numeric',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    ...props,
  });
}

/** '82,5' und '82.5' gehen beide, alles andere, auch '', ist null. */
export function parseNumber(value) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Beim Verlassen ein Feld auf die saubere Form dessen bringen, was drinsteht.
 *
 * Ohne das zeigt ein Zahlenfeld im Textmodus fröhlich weiter "8o", während die App
 * nichts gespeichert hat. Das alte type="number" hat sich wenigstens selbst geleert.
 */
export function normaliseOnBlur(input, { integer = false } = {}) {
  input.addEventListener('blur', () => {
    const n = parseNumber(input.value);
    input.value = n === null ? '' : String(integer ? Math.round(n) : n);
  });
  return input;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

// Formatierung

/**
 * Das Dezimalzeichen, das diese Sprache wirklich schreibt.
 *
 * Seit die Oberfläche übersetzt ist, stand auf Deutsch "6.1kg" und "1.8kg pro Woche",
 * weil jede Zahl durch `toFixed` ging, und das kennt nur ein Trennzeichen. Nur für
 * die Anzeige: `parseNumber` nimmt weiter beide, und der Wert, der zurück in ein Feld
 * geschrieben wird, bleibt in der Standardform. Was gespeichert oder verglichen wird,
 * ändert seine Form nicht.
 */
const decimalMark = () => (1.1).toLocaleString(locale()).charAt(1);
const localiseDecimal = (text) => text.replace('.', decimalMark());

/**
 * Eine Zahl zum Lesen für Menschen, in der Schreibweise dieser Sprache.
 *
 * Exportiert, weil `fmtWeight` und `fmtNum` nicht die einzigen Stellen sind, an denen
 * eine Dezimalzahl auf den Bildschirm kommt: Raten pro Woche, Prozente, Liter,
 * Megabyte, Sterne-Durchschnitte und die Achsen der Diagramme formatieren alle
 * selbst, und jede davon hat auf Deutsch "+2.6 kg/Woche" gezeigt. Die Geometrie von
 * SVG-Pfaden geht bewusst nicht hier durch, ein `d`-Attribut ist kein Text, und ein
 * Komma darin ist ein Fehler.
 */
export function fmtDecimal(value, digits = 1) {
  const n = Number(value) || 0;
  return localiseDecimal(n.toFixed(digits));
}

export function fmtWeight(v, units = 'kg') {
  const n = Number(v) || 0;
  const s = Number.isInteger(n) ? String(n) : localiseDecimal(n.toFixed(1).replace(/\.0$/, ''));
  return `${s}${units}`;
}

export function fmtNum(v, digits = 0) {
  const n = Number(v) || 0;
  if (n >= 10000) return `${localiseDecimal((n / 1000).toFixed(n >= 100000 ? 0 : 1))}k`;
  return localiseDecimal(n.toFixed(digits));
}

/**
 * Eine Volumensumme mit angehängter Einheit.
 *
 * `fmtNum` kürzt alles über zehntausend auf "12.9k", und jeder Aufrufer hat die
 * Einheit direkt dahinter gehängt, so kam eine Einheit als "12.9kkg" heraus. Volumen
 * ist außerdem die einzige Zahl in der App, die sechsstellig wird. Sie bekommt also
 * Tausendertrennzeichen und wird in Kilo zu Tonnen, sobald man die Ziffern nicht
 * mehr als Gewicht lesen kann.
 */
export function fmtVolume(v, units = 'kg') {
  const n = Math.round(Number(v) || 0);
  if (n >= 100000) {
    const thousands = Math.round(n / 1000).toLocaleString(locale());
    return units === 'kg' ? `${thousands} t` : `${thousands}k ${units}`;
  }
  return `${n.toLocaleString(locale())} ${units}`;
}

export function fmtDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Datumsangaben folgen der Sprache der Oberfläche, nicht der des Handys. */
export function fmtDate(ts, opts = {}) {
  return new Date(ts).toLocaleDateString(locale(),
    { day: 'numeric', month: 'short', ...opts });
}

export function relDay(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today - d) / 86400000);
  if (days === 0) return t('common.today');
  if (days === 1) return t('common.yesterday');
  if (days < 7) return t('common.daysAgo', { n: days });
  if (days < 14) return t('common.lastWeek');
  return fmtDate(ts, { year: days > 300 ? 'numeric' : undefined });
}

/** "80kg × 8, 8, 7", kurz genug, um es mitten im Satz zu lesen. */
export function setsSummary(sets, units) {
  if (!sets.length) return '';
  const groups = [];
  for (const s of sets) {
    const w = Number(s.weight) || 0;
    const last = groups[groups.length - 1];
    if (last && last.w === w) last.reps.push(Number(s.reps) || 0);
    else groups.push({ w, reps: [Number(s.reps) || 0] });
  }
  return groups.map((g) => `${fmtWeight(g.w, units)} × ${g.reps.join(', ')}`).join('  ·  ');
}

// Sternebewertung

/** Text wie '★★★★☆', halbe Sterne als ½. */
export function starString(stars) {
  const full = Math.floor(stars);
  const half = stars - full >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
}

/** Screenreader bekommen eine Zahl, alle anderen die Sterne. */
export function starBadge(stars, { size = '13px', dim = false } = {}) {
  return el('span.stars', {
    style: {
      fontSize: size,
      letterSpacing: '.04em',
      color: dim ? 'var(--text-faint)' : 'var(--t4)',
      whiteSpace: 'nowrap',
    },
    'aria-label': t('common.stars', { n: stars }),
    role: 'img',
    text: starString(stars),
  });
}

// Rückmeldung

let toastTimer = null;
export function toast(message, ms = 2000) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, ms);
}

/** Ein Toast mit einer kurzen Rückgängig-Aktion für versehentliches Löschen. */
export function undoToast(message, undo, ms = 6000) {
  const node = $('#toast');
  const button = el('button.toast-action', { onclick: async () => {
    clearTimeout(toastTimer);
    node.hidden = true;
    await undo();
  } }, [t('common.undo')]);
  node.replaceChildren(el('span', { text: message }), button);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, ms);
}

export function haptic(pattern = 8) {
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* nicht unterstützt */ } }
}

// Sheet von unten

let sheetOnClose = null;

export function openSheet(title, bodyNode, { onClose } = {}) {
  $('#sheet-title').textContent = title;
  const body = clear($('#sheet-body'));
  body.append(bodyNode);
  $('#sheet-host').hidden = false;
  sheetOnClose = onClose || null;
  document.body.style.overflow = 'hidden';
  const focusable = body.querySelector('input, select, textarea, button');
  if (focusable && !('ontouchstart' in window)) focusable.focus();
}

export function closeSheet() {
  if ($('#sheet-host').hidden) return;
  $('#sheet-host').hidden = true;
  clear($('#sheet-body'));
  document.body.style.overflow = '';
  const cb = sheetOnClose; sheetOnClose = null;
  if (cb) cb();
}

export function initSheet() {
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#sheet-scrim').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });
}

/** Bestätigung als Promise im Sheet, damit sie zur App passt. */
export function confirmSheet(title, message, { danger = true, confirmLabel = null } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; resolve(v); closeSheet(); };
    const body = el('div.stack', {}, [
      el('p.muted', { text: message, style: { margin: '0 0 4px' } }),
      el('button.btn.full' + (danger ? '.danger' : '.primary'),
        { onclick: () => finish(true) }, [confirmLabel || t('common.delete')]),
      el('button.btn.full.ghost', { onclick: () => finish(false) }, [t('common.cancel')]),
    ]);
    openSheet(title, body, { onClose: () => finish(false) });
  });
}

// Sonstiges

/**
 * Antippbare Zeile. Läuft über einen Helfer, damit jede einen Namen für
 * Screenreader hat. Nur verschachtelter Text lässt sie "Schaltfläche" vorlesen.
 */
export function listItem({ title, sub, onclick, chev = '›', ariaLabel, style, right, lead }) {
  return el('button.list-item', {
    onclick,
    style,
    'aria-label': ariaLabel || (sub ? `${title}, ${sub}` : title),
  }, [
    lead || null,
    el('div.grow', {}, [
      el('div.li-title', { text: title }),
      sub ? el('div.li-sub', { text: sub }) : null,
    ]),
    right || null,
    el('span.chev', { text: chev, 'aria-hidden': 'true' }),
  ]);
}

export function emptyState(title, hint, action) {
  return el('div.empty', {}, [el('strong', { text: title }), el('div', { text: hint }), action || null]);
}

/**
 * `plural(1, 'Satz', 'Sätze')` ergibt "1 Satz". Nur eine Kopie, damit Anzahlen überall
 * gleich klingen.
 *
 * Beide Wörter kommen vom Aufrufer, deshalb funktioniert es auch in Sprachen, deren
 * Mehrzahl nicht "ein s anhängen" ist. Gehört eine Anzahl zu einem Wort, das die App
 * oft sagt, lieber `tn(n, 'unit.set')` aus i18n.js nehmen: dort stehen beide Formen
 * in der Texttabelle, und der Test sieht sie.
 */
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
