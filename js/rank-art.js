// The badges, and the moment you earn one.
//
// These are drawn here rather than downloaded, and that was a decision rather
// than laziness. The sets worth having are game-icons.net (CC BY 3.0), the
// Noun Project, Flaticon and Vecteezy; all of them are usable with attribution,
// and this app already has the machinery for that (NOTICE, Settings → Credits).
// The problem is not the licence, it is that none of them is a *ladder*. A
// bronze medal from one set, a diamond from another and a crown from a third do
// not share a silhouette, a stroke weight or an optical size, and the whole
// point of twenty-seven steps is that the badges read as one family that
// escalates. Nine unrelated icons would look like clip art in a row.
//
// So there is one shield, and it earns things: chevrons, then a gem, then a
// star, then wings, then a crown. Every part is tinted with `var(--tier)`, the
// ramp already validated for colourblind separation, so the artwork inherits
// the colour system instead of fighting it. It costs nothing over the wire, it
// draws at any size, and there is no third party to credit or to outlive.

import { el, haptic } from './ui.js';
import { TIERS } from './standards.js';

// Gradient ids have to be unique per document or the second badge on a screen
// borrows the first one's fill. A counter is enough and keeps the markup short.
let seq = 0;

/**
 * Which embellishments each rank has earned. Index matches TIERS.
 *
 * `stud` exists so the bottom of the ladder is plain rather than empty: an
 * undecorated shield reads as a badge that failed to load, which is a poor
 * first thing to show somebody on their first week.
 */
export const PARTS = [
  { stud: true, chevrons: 0, gem: false, stars: 0, wings: false, crown: false },  // Bronze
  { stud: false, chevrons: 1, gem: false, stars: 0, wings: false, crown: false }, // Silver
  { stud: false, chevrons: 2, gem: false, stars: 0, wings: false, crown: false }, // Gold
  { stud: false, chevrons: 3, gem: false, stars: 0, wings: false, crown: false }, // Platinum
  { stud: false, chevrons: 1, gem: true,  stars: 0, wings: false, crown: false }, // Diamond
  { stud: false, chevrons: 2, gem: true,  stars: 1, wings: false, crown: false }, // Master
  { stud: false, chevrons: 3, gem: true,  stars: 2, wings: false, crown: false }, // Grandmaster
  { stud: false, chevrons: 3, gem: true,  stars: 1, wings: true,  crown: false }, // Elite
  { stud: false, chevrons: 3, gem: true,  stars: 1, wings: true,  crown: true },  // Legend
];

// The shield is drawn in a 0..64 box, and the viewBox is wider than that on
// every side. All nine badges share the frame, so the shield has to stay the
// same size in all of them — which means the crown and the wings need room
// around it rather than a smaller shield on the two ranks that have them.
const VIEW_BOX = '-10 -14 84 84';

const SHIELD = 'M32 3 L57 13 V33 C57 47.5 45.5 57 32 62 C18.5 57 7 47.5 7 33 V13 Z';
const INNER = 'M32 10 L50 17.2 V33 C50 43.8 41.5 51 32 54.8 C22.5 51 14 43.8 14 33 V17.2 Z';
const GEM = 'M32 20 L41 27.5 L32 41 L23 27.5 Z';
const STAR = 'M0 -7 L2 -2.2 L7.2 -2.2 L3 1 L4.6 6 L0 3 L-4.6 6 L-3 1 L-7.2 -2.2 L-2 -2.2 Z';
// A swept wing with three feathers, hinged at the shoulder of the shield and
// reaching outside the 0..64 box, which is what the wider viewBox is for.
const WING_LEFT = 'M11 20 C-1 21 -8 28 -9 38 C-4 31 1 28 6 27.5 '
  + 'C0 31 -3 36 -3 43 C2 36 6 33 10 32 C6 36 4 41 5 47 C10 39 15 34 19 31 Z';
const CROWN = 'M17 4 L21.5 -8 L27 -1.5 L32 -13 L37 -1.5 L42.5 -8 L47 4 Z';

const ns = 'http://www.w3.org/2000/svg';
const node = (name, attrs = {}) => {
  const n = document.createElementNS(ns, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

/**
 * One rank badge as an inline SVG.
 *
 * @param tierIndex 0–8, matching TIERS
 * @param opts { size, glow } — glow is for the celebration, not for a list row
 */
export function rankBadge(tierIndex, { size = 34, glow = false } = {}) {
  const i = Math.max(0, Math.min(TIERS.length - 1, Number(tierIndex) || 0));
  const parts = PARTS[i];
  const id = `rb${++seq}`;

  const svg = node('svg', {
    viewBox: VIEW_BOX, width: size, height: size,
    class: `rank-badge tier-${i}${glow ? ' glow' : ''}`,
    role: 'img', 'aria-hidden': 'true', focusable: 'false',
  });

  const defs = node('defs');
  // Two stops of the same tier colour rather than two colours: the badge should
  // read as one material catching light, not as a gradient for its own sake.
  const grad = node('linearGradient', { id: `${id}-face`, x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.append(
    node('stop', { offset: '0', 'stop-color': 'var(--tier)', 'stop-opacity': '0.95' }),
    node('stop', { offset: '1', 'stop-color': 'var(--tier)', 'stop-opacity': '0.35' })
  );
  const sheen = node('linearGradient', { id: `${id}-sheen`, x1: '0', y1: '0', x2: '1', y2: '1' });
  sheen.append(
    node('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0.30' }),
    node('stop', { offset: '0.5', 'stop-color': '#fff', 'stop-opacity': '0.04' }),
    node('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' })
  );
  defs.append(grad, sheen);
  svg.append(defs);

  // Behind the shield, so the shield reads as the object and these as what it
  // sits in front of.
  if (parts.wings) {
    for (const flip of [false, true]) {
      svg.append(node('path', {
        d: WING_LEFT, fill: 'var(--tier)', opacity: '0.7',
        transform: flip ? 'translate(64 0) scale(-1 1)' : '',
      }));
    }
  }
  if (parts.crown) {
    svg.append(node('path', { d: CROWN, fill: 'var(--tier)', opacity: '0.95' }));
    // Three points, three stones. Without them a crown at this size is a saw.
    for (const [cx, cy, r] of [[21.5, -6, 1.8], [32, -10.5, 2.2], [42.5, -6, 1.8]]) {
      svg.append(node('circle', { cx, cy, r, fill: 'var(--bg-sunken, #0d1422)', opacity: '0.55' }));
    }
  }

  svg.append(node('path', { d: SHIELD, fill: `url(#${id}-face)`,
    stroke: 'var(--tier)', 'stroke-width': '2', 'stroke-linejoin': 'round' }));
  svg.append(node('path', { d: INNER, fill: 'var(--bg-sunken, #0d1422)', opacity: '0.55' }));
  svg.append(node('path', { d: SHIELD, fill: `url(#${id}-sheen)` }));

  if (parts.gem) {
    svg.append(node('path', { d: GEM, fill: 'var(--tier)', opacity: '0.92' }));
    // A brilliant cut, not a kite: a flat table across the crown, two shoulder
    // facets down to the girdle, and the pavilion meeting at the point. Four
    // lines is the least that reads as cut rather than as a lozenge.
    svg.append(node('path', {
      d: 'M23 27.5 L41 27.5 M26.6 23.5 L29 27.5 L32 41 M37.4 23.5 L35 27.5 L32 41',
      fill: 'none', stroke: 'var(--bg-sunken, #0d1422)',
      'stroke-width': '1.1', 'stroke-linejoin': 'round', opacity: '0.65',
    }));
    // The table catches the light, which is what makes it look like a stone.
    svg.append(node('path', { d: 'M26.6 23.5 L37.4 23.5 L35 27.5 L29 27.5 Z',
      fill: '#fff', opacity: '0.22' }));
  }

  for (let n = 0; n < parts.stars; n++) {
    const x = parts.stars === 1 ? 32 : 32 + (n === 0 ? -9 : 9);
    svg.append(node('path', { d: STAR, fill: 'var(--tier)',
      transform: `translate(${x} ${parts.gem ? 15 : 26}) scale(${parts.stars === 1 ? 1 : 0.72})` }));
  }

  if (parts.stud) {
    svg.append(node('circle', { cx: 32, cy: 32, r: 6, fill: 'var(--tier)', opacity: '0.75' }));
    svg.append(node('circle', { cx: 32, cy: 32, r: 2.6, fill: 'var(--bg-sunken, #0d1422)', opacity: '0.6' }));
  }

  for (let n = 0; n < parts.chevrons; n++) {
    const y = 40 + n * 5;
    svg.append(node('path', {
      d: `M24 ${y} L32 ${y + 4.5} L40 ${y}`, fill: 'none', stroke: 'var(--tier)',
      'stroke-width': '2.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      opacity: String(0.9 - n * 0.15),
    }));
  }

  return svg;
}

/* ===================== the moment you earn one ===================== */

/**
 * The rank-up celebration.
 *
 * Fires once per step actually gained, never on a re-render, because the caller
 * only calls it when the stored step is behind the computed one — see
 * `lastSeenRankStep` on the settings. Twenty-seven steps means this is rare
 * enough to still mean something and frequent enough to be worth building.
 *
 * Motion is skipped entirely under `prefers-reduced-motion`: the badge and the
 * words are the content, the burst is decoration, and decoration is the part
 * that is safe to drop.
 */
export function celebrateRankUp(rank, { title, subtitle, dismiss }) {
  const overlay = el('div.rank-up-overlay', { role: 'dialog', 'aria-live': 'polite', 'aria-label': title });
  const still = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) overlay.classList.add('still');

  const stage = el(`div.rank-up-stage.tier-${rank.tierIndex}`);
  if (!still) {
    // Rays, drawn rather than animated individually: one rotating element is
    // one composited layer, twelve animated ones are twelve.
    stage.append(el('div.rank-up-rays', { 'aria-hidden': 'true' }));
  }
  stage.append(el('div.rank-up-badge', {}, [rankBadge(rank.tierIndex, { size: 132, glow: true })]));

  overlay.append(stage);
  overlay.append(el('div.rank-up-title', { text: title }));
  overlay.append(el('div.rank-up-sub', { text: subtitle }));
  overlay.append(el('button.btn.primary', { style: { marginTop: '22px', minWidth: '160px' },
    onclick: () => close() }, [dismiss]));

  // Costs nothing where it is unsupported, and iOS Safari is one of those
  // places (navigator.vibrate is not implemented there), so this is for Android
  // and for whatever iOS does later.
  haptic([28, 40, 28, 40, 60]);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    overlay.classList.add('leaving');
    setTimeout(() => overlay.remove(), still ? 0 : 220);
  }
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  document.body.append(overlay);
  return close;
}
