// DOM + formatting helpers shared by every screen.

import { t, locale } from './i18n.js';

/** el('div.card', {onclick}, [children]) */
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

const AUTH_ICONS = {
  email: ['M4 6h16v12H4z', 'm4 7 8 6 8-6'],
  lock: ['M6 10h12v10H6z', 'M8 10V7a4 4 0 0 1 8 0v3', 'M12 14v2'],
  key: ['M14 7a4 4 0 1 1-3.8 5.2L4 18.4V21h2.6l1-1H10l1-1v-2.4l1.8-1.8A4 4 0 0 1 14 7z'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
  search: ['M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z', 'm16 16 5 5'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  note: ['M5 3h14v18H5z', 'M8 8h8', 'M8 12h8', 'M8 16h5'],
};

/** Consistent, touch-friendly field used by sign-in, sign-up and recovery. */
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
  catch { /* private mode: collapsing still works until the next render */ }
}

/** Make ordinary screen headings toggle the cards and rows below them. */
export function enableCollapsibleSections(root, route) {
  const saved = collapsedSections();
  const occurrences = new Map();

  root.querySelectorAll('.section-head').forEach((head) => {
    const title = head.querySelector(':scope > h2');
    if (!title || head.dataset.fixed === 'true') return;

    const content = [];
    for (let next = head.nextElementSibling; next; next = next.nextElementSibling) {
      // A direct heading or a neighbouring wrapper beginning with a heading is
      // a new section, not part of the current one.
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
 * A number field that accepts the separator the keyboard actually offers.
 *
 * `<input type="number">` only accepts a full stop, whatever the locale. On a
 * German phone the decimal key *is* a comma, so typing "82,5" leaves the digits
 * visible in the box while `.value` reads as the empty string — the app stored
 * nothing and said nothing. Mid-workout that is a lost set.
 *
 * A text field with inputmode="decimal" keeps the numeric keypad on iOS, and
 * `parseNumber` takes either separator. The cost is losing the browser's own
 * min/step validation, which this app was already doing in JS anyway.
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

/** '82,5' and '82.5' both parse; anything else, including '', is null. */
export function parseNumber(value) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Rewrite a field to the canonical form of what it holds, on blur.
 *
 * Without this a text-mode number field will happily keep showing "8o" while
 * the app has stored nothing — the old type="number" at least cleared itself.
 */
export function normaliseOnBlur(input, { integer = false } = {}) {
  input.addEventListener('blur', () => {
    const n = parseNumber(input.value);
    input.value = n === null ? '' : String(integer ? Math.round(n) : n);
  });
  return input;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

// ---------- formatting ----------

export function fmtWeight(v, units = 'kg') {
  const n = Number(v) || 0;
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
  return `${s}${units}`;
}

export function fmtNum(v, digits = 0) {
  const n = Number(v) || 0;
  if (n >= 10000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`;
  return n.toFixed(digits);
}

/**
 * A volume total with its unit attached.
 *
 * `fmtNum` compacts anything over ten thousand to "12.9k", and every caller
 * then appended the unit straight onto it, which is how a session came out as
 * "12.9kkg". Volume is also the one figure in the app that reaches six digits,
 * so it gets thousands separators, and in kilos it becomes tonnes at the point
 * where the digits stop being readable as a weight.
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

/** Dates follow the interface language, not the phone's. */
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

/** "80kg × 8, 8, 7" — compact enough to read mid-set. */
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

// ---------- star ratings ----------

/** '★★★★☆' style string, halves shown as ½. */
export function starString(stars) {
  const full = Math.floor(stars);
  const half = stars - full >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
}

/** Screen readers get a number; sighted users get the stars. */
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

// ---------- feedback ----------

let toastTimer = null;
export function toast(message, ms = 2000) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, ms);
}

/** A toast with one short-lived recovery action for accidental destructive taps. */
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
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* unsupported */ } }
}

// ---------- bottom sheet ----------

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

/** Promise-based confirm rendered in the sheet, so it matches the app. */
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

// ---------- misc ----------

/**
 * Tappable row. Goes through one helper so every one of them carries an
 * accessible name — nested text alone leaves screen readers announcing "button".
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
 * `plural(1, 'Satz', 'Sätze')` -> "1 Satz". One copy, so counts read the same
 * everywhere.
 *
 * Both words come from the caller, which is what makes it work in a language
 * whose plural is not "add an s". Where a count belongs to a noun the app says
 * often, prefer `tn(n, 'unit.set')` from i18n.js: the two forms live in the
 * string table and the parity test can see them.
 */
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
