// Muscle body map. Loads the two placeholder SVGs and recolours each region by
// rating tier at runtime. The same component doubles as the "which muscles does
// this hit" illustration in the exercise library, so one asset serves both.

import { el } from './ui.js';
import { t, tRegion, tTier } from './i18n.js';
import { TIERS, tierIndex } from './standards.js';
import { rankBadge } from './rank-art.js';

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
    const label = tRegion(region);
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
    fills[region] = `var(--t${Math.max(0, Math.min(TIERS.length - 1, idx))})`;
  }

  const host = el('div.bodymap', { 'aria-label': t('bodymap.aria') });
  host.append(
    el('div', {}, [el('div.small.faint', { text: '…' })]),
    el('div')
  );

  Promise.all([loadSvg('front'), loadSvg('back')])
    .then(([front, back]) => {
      paint(front, fills, { lit });
      paint(back, fills, { lit });
      host.replaceChildren(
        el('div', {}, [front, el('div.bodymap-caption', { text: t('bodymap.front') })]),
        el('div', {}, [back, el('div.bodymap-caption', { text: t('bodymap.back') })])
      );
      if (onSelect) {
        for (const shape of host.querySelectorAll('.muscle')) {
          shape.addEventListener('click', () => onSelect(shape.getAttribute('data-region')));
        }
      }
    })
    .catch((err) => {
      console.error('[liftlog] body map', err);
      host.replaceChildren(el('div.small.faint', { text: t('bodymap.unavailable') }));
    });

  return host;
}

/** Highlight-only map for the exercise library: primary vs secondary muscles. */
export function muscleHighlight(primary = [], secondary = []) {
  const byRegion = {};
  // Two ends of the ramp, not two ranks: this map says "primary or secondary",
  // and reusing the ladder's colours keeps one visual language.
  for (const r of secondary) byRegion[r] = 1;                // dimmer step
  for (const r of primary) byRegion[r] = TIERS.length - 1;   // brightest step
  return bodyMap(byRegion, { lit: true });
}

/**
 * Legend for the strength map: a scale, not a list.
 *
 * This used to be one chip per rank. At nine that already wrapped onto two rows
 * of abbreviations, and German truncated several of them into nonsense; at
 * twelve it is unreadable in any language. The abbreviations were the wrong
 * answer to the wrong question anyway — nobody reads a legend to learn that
 * "GM" means Grandmaster, they read it to learn *which end is which*.
 *
 * So it is drawn as what it actually is: an ordinal ramp, with the two ends
 * named and badged and the middle left to speak for itself. The full scale with
 * every rank and its point range is one tap away on any muscle, which is where
 * somebody who wants the detail is already going.
 */
export function tierLegend() {
  const end = (i, align) => el(`div.legend-end.tier-${i}`, { style: { textAlign: align } }, [
    rankBadge(i, { size: 22 }),
    el('span', { text: tTier(TIERS[i].key) }),
  ]);

  return el('div.legend-scale', {}, [
    el('div.legend-ramp', { role: 'img', 'aria-label': t('bodymap.scaleAria', { n: TIERS.length }) },
      TIERS.map((tier, i) => el('i', { style: { background: `var(--t${i})` } }))),
    el('div.row.between', { style: { marginTop: '7px' } }, [
      end(0, 'left'),
      el('span.small.faint', { text: t('bodymap.scaleHint', { n: TIERS.length }) }),
      end(TIERS.length - 1, 'right'),
    ]),
  ]);
}
