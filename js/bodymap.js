// Muskelkarte. Lädt die beiden SVG-Vorlagen und färbt jede Region zur Laufzeit nach
// ihrer Rangstufe ein. Dieselbe Komponente zeigt in der Bibliothek auch, welche
// Muskeln eine Übung trifft, ein Bild für beides.

import { el } from './ui.js';
import { t, tRegion, tTier } from './i18n.js';
import { TIERS, tierIndex } from './standards.js';
import { rankBadge } from './rank-art.js';

const SRC = { front: 'assets/body-front.svg', back: 'assets/body-back.svg' };
const cache = {};

/** Einmal laden und parsen, danach wird der geparste Knoten nur noch geklont. */
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
 * @param {Object<string, {tier:number}>} byRegion  Bewertung je Muskelregion
 * @param {object} opts  { onSelect(region), lit }
 * @returns {HTMLElement} Hülle, die sich füllt, sobald die SVGs geladen sind
 */
export function bodyMap(byRegion = {}, opts = {}) {
  const { onSelect = null, lit = true } = opts;

  // Nimmt eine reine Stufe, {tier} oder die {score}-Form von buildRating.
  const fills = {};
  for (const [region, rating] of Object.entries(byRegion)) {
    if (rating === null || rating === undefined) continue;
    // Ein String ist eine Farbe und wird direkt benutzt. Das ist für Karten, die gar
    // keine Rangskala sind und sich deshalb nicht die Farben der Leiter leihen dürfen.
    if (typeof rating === 'string') { fills[region] = rating; continue; }
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

/** Karte nur zum Hervorheben in der Bibliothek: Haupt- gegen Nebenmuskeln. */
export function muscleHighlight(primary = [], secondary = []) {
  const byRegion = {};
  // Nicht die Rangfarben. Die Karte beantwortet "Haupt- oder Nebenmuskel", das ist
  // keine Skala und darf sich auch keine leihen: an den Enden der Leiter festgemacht
  // wurde aus Cyan gegen Silber fast Weiß gegen Silber, sobald oben drei Ränge dazukamen,
  // und man konnte die beiden nicht mehr unterscheiden.
  for (const r of secondary) byRegion[r] = 'var(--text-faint)';
  for (const r of primary) byRegion[r] = 'var(--accent-hi)';
  return bodyMap(byRegion, { lit: true });
}

/**
 * Legende für die Stärkekarte: eine Skala, keine Liste.
 *
 * Früher war das ein Chip pro Rang. Bei neun Rängen brach das schon auf zwei
 * Zeilen mit Abkürzungen um, und im Deutschen wurden mehrere zu Unsinn gekürzt.
 * Bei zwölf ist es in keiner Sprache mehr lesbar. Die Abkürzungen waren ohnehin
 * die falsche Antwort: niemand liest eine Legende, um zu lernen, dass "GM"
 * Grandmaster heißt, sondern um zu sehen, WELCHES Ende welches ist.
 *
 * Deshalb wird sie als das gezeichnet, was sie ist: eine geordnete Farbskala, die
 * beiden Enden mit Namen und Abzeichen, die Mitte spricht für sich. Die ganze Skala
 * mit jedem Rang und seinen Punkten ist einen Tipp auf einen Muskel entfernt, und
 * da schaut ohnehin hin, wer es genau wissen will.
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
