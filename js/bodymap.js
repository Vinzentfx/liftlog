// Muscle body map. Loads the two placeholder SVGs and recolours each region by
// rating tier at runtime. The same component doubles as the "which muscles does
// this hit" illustration in the exercise library, so one asset serves both.

import { el } from './ui.js';
import { REGIONS, TIERS, tierIndex } from './standards.js';

const SRC = { front: 'assets/body-front.svg', back: 'assets/body-back.svg' };
const cache = {};

/** Fetch + parse once; later calls clone the parsed node. */
async function loadSvg(view) {
  if (cache[view]) return cache[view].cloneNode(true);
  const res = await fetch(SRC[view]);
  if (!res.ok) throw new Error(`body map ${view} failed: ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) throw new Error(`body map ${view} has no <svg>`);
  cache[view] = svg;
  return svg.cloneNode(true);
}

function paint(svg, fills, { lit = true } = {}) {
  for (const shape of svg.querySelectorAll('.muscle')) {
    const region = shape.getAttribute('data-region');
    const fill = fills[region];
    if (fill) {
      shape.style.setProperty('--m-fill', fill);
      if (lit) shape.classList.add('lit');
    } else {
      shape.style.removeProperty('--m-fill');
      shape.classList.remove('lit');
    }
    const label = REGIONS[region] || region;
    shape.setAttribute('role', 'img');
    shape.setAttribute('aria-label', label);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = label;
    shape.append(title);
  }
}

/**
 * @param {Object<string, {tier:number}>} byRegion  rating per muscle region
 * @param {object} opts  { onSelect(region), lit }
 * @returns {HTMLElement} host that fills itself in once the SVGs load
 */
export function bodyMap(byRegion = {}, opts = {}) {
  const { onSelect = null, lit = true } = opts;

  // Accepts a bare tier index, {tier}, or the {score} shape buildRating emits.
  const fills = {};
  for (const [region, rating] of Object.entries(byRegion)) {
    if (rating === null || rating === undefined) continue;
    let idx;
    if (typeof rating === 'number') idx = rating;
    else if (rating.tier !== undefined && rating.tier !== null) idx = rating.tier;
    else if (rating.score !== undefined) idx = tierIndex(rating.score);
    if (idx === null || idx === undefined) continue;
    fills[region] = `var(--t${Math.max(0, Math.min(4, idx))})`;
  }

  const host = el('div.bodymap', { 'aria-label': 'Muscle rating map' });
  host.append(
    el('div', {}, [el('div.small.faint', { text: '…' })]),
    el('div')
  );

  Promise.all([loadSvg('front'), loadSvg('back')])
    .then(([front, back]) => {
      paint(front, fills, { lit });
      paint(back, fills, { lit });
      host.replaceChildren(
        el('div', {}, [front, el('div.bodymap-caption', { text: 'Front' })]),
        el('div', {}, [back, el('div.bodymap-caption', { text: 'Back' })])
      );
      if (onSelect) {
        for (const shape of host.querySelectorAll('.muscle')) {
          shape.addEventListener('click', () => onSelect(shape.getAttribute('data-region')));
        }
      }
    })
    .catch((err) => {
      console.error('[liftlog] body map', err);
      host.replaceChildren(el('div.small.faint', { text: 'Body map unavailable.' }));
    });

  return host;
}

/** Highlight-only map for the exercise library: primary vs secondary muscles. */
export function muscleHighlight(primary = [], secondary = []) {
  const byRegion = {};
  for (const r of secondary) byRegion[r] = 1;   // dimmer step
  for (const r of primary) byRegion[r] = 4;     // brightest step
  return bodyMap(byRegion, { lit: true });
}

/** Legend row — tiers are never communicated by colour alone. */
export function tierLegend() {
  return el('div.legend', {}, TIERS.map((t, i) =>
    el('span', {}, [
      el('b', { style: { background: `var(--t${i})` } }),
      t.label,
    ])
  ));
}
