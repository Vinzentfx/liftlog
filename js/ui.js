// DOM + formatting helpers shared by every screen.

/** el('div.card', {onclick}, [children]) */
export function el(spec, props = {}, children = []) {
  const [tagPart, ...classes] = String(spec).split('.');
  const tag = tagPart || 'div';
  const node = document.createElement(tag);
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = [node.className, v].filter(Boolean).join(' ');
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
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

export const $ = (sel, root = document) => root.querySelector(sel);

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

export function fmtDate(ts, opts = {}) {
  return new Date(ts).toLocaleDateString(undefined,
    { day: 'numeric', month: 'short', ...opts });
}

export function relDay(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today - d) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
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
    'aria-label': `${stars} out of 5 stars`,
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
export function confirmSheet(title, message, { danger = true, confirmLabel = 'Delete' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; resolve(v); closeSheet(); };
    const body = el('div.stack', {}, [
      el('p.muted', { text: message, style: { margin: '0 0 4px' } }),
      el('button.btn.full' + (danger ? '.danger' : '.primary'), { onclick: () => finish(true) }, [confirmLabel]),
      el('button.btn.full.ghost', { onclick: () => finish(false) }, ['Cancel']),
    ]);
    openSheet(title, body, { onClose: () => finish(false) });
  });
}

// ---------- misc ----------

/**
 * Tappable row. Goes through one helper so every one of them carries an
 * accessible name — nested text alone leaves screen readers announcing "button".
 */
export function listItem({ title, sub, onclick, chev = '›', ariaLabel, style, right }) {
  return el('button.list-item', {
    onclick,
    style,
    'aria-label': ariaLabel || (sub ? `${title} — ${sub}` : title),
  }, [
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

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
