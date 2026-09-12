// Die Abzeichen und der Moment, in dem man eins bekommt.
//
// Die werden hier gezeichnet und nicht heruntergeladen, und das war eine Entscheidung,
// keine Faulheit. Die Sammlungen, die sich lohnen würden, sind game-icons.net (CC BY
// 3.0), das Noun Project, Flaticon und Vecteezy. Alle lassen sich mit Quellenangabe
// benutzen, und dafür hat die App schon alles (NOTICE, Einstellungen, Credits). Das
// Problem ist nicht die Lizenz, sondern dass keine davon eine Leiter ist. Eine
// Bronzemedaille aus der einen Sammlung, ein Diamant aus der zweiten und eine Krone
// aus der dritten teilen weder Umriss noch Strichstärke noch optische Größe, und der
// ganze Sinn von siebenundzwanzig Stufen ist, dass die Abzeichen wie eine Familie
// wirken, die sich steigert. Neun Symbole ohne Zusammenhang sähen aus wie Clipart.
//
// Also gibt es einen Schild, und der verdient sich Dinge: Winkel, dann einen Edelstein,
// dann einen Stern, dann Flügel, dann eine Krone. Jeder Teil wird mit `var(--tier)`
// eingefärbt, der Skala, die schon auf Farbenblindheit geprüft ist. Die Zeichnung
// übernimmt also das Farbsystem, statt dagegen zu arbeiten. Sie kostet keine
// Übertragung, sieht in jeder Größe gut aus, und es gibt keinen Dritten, dem man danken
// muss oder der vor der App verschwindet.

import { el, haptic, openSheet } from './ui.js';
import { TIERS } from './standards.js';
import { percentiles, shareDigits, topSlice } from './percentile.js';
import { t, locale } from './i18n.js';

// Die IDs der Verläufe müssen im Dokument eindeutig sein, sonst leiht sich das zweite
// Abzeichen auf einem Screen die Füllung des ersten. Ein Zähler reicht und hält das Markup kurz.
let seq = 0;

/**
 * Welche Verzierungen jeder Rang verdient hat. Der Index passt zu TIERS.
 *
 * `stud` gibt es, damit das untere Ende der Leiter schlicht und nicht leer ist. Ein
 * Schild ganz ohne Schmuck sieht aus wie ein Abzeichen, das nicht geladen hat, und das
 * ist ein schlechtes Erstes, was man jemandem in seiner ersten Woche zeigt.
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
  // Über den veröffentlichten Standards kommen keine neuen Dinge mehr dazu, sondern
  // Licht. Das ist die einzige Steigerung, die den Schild nicht zur Collage macht.
  { stud: false, chevrons: 3, gem: true, stars: 2, wings: true, crown: true, halo: true },
  { stud: false, chevrons: 3, gem: true, stars: 3, wings: true, crown: true, halo: true, flare: true },
  { stud: false, chevrons: 3, gem: true, stars: 3, wings: true, crown: true, halo: true, flare: true, aura: true },
];

// Der Schild wird in einem Kasten von 0..64 gezeichnet, und die viewBox ist auf jeder
// Seite breiter. Alle neun Abzeichen teilen sich den Rahmen, der Schild muss also in
// allen gleich groß bleiben. Krone und Flügel brauchen deshalb Platz drumherum statt
// eines kleineren Schilds bei den zwei Rängen, die sie haben.
const VIEW_BOX = '-10 -14 84 84';

const SHIELD = 'M32 3 L57 13 V33 C57 47.5 45.5 57 32 62 C18.5 57 7 47.5 7 33 V13 Z';
const INNER = 'M32 10 L50 17.2 V33 C50 43.8 41.5 51 32 54.8 C22.5 51 14 43.8 14 33 V17.2 Z';
const GEM = 'M32 20 L41 27.5 L32 41 L23 27.5 Z';
const STAR = 'M0 -7 L2 -2.2 L7.2 -2.2 L3 1 L4.6 6 L0 3 L-4.6 6 L-3 1 L-7.2 -2.2 L-2 -2.2 Z';
// Ein geschwungener Flügel mit drei Federn, an der Schulter des Schilds angesetzt und
// über den Kasten von 0..64 hinaus, dafür ist die breitere viewBox da.
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
 * Ein Rang-Abzeichen als eingebettetes SVG.
 *
 * @param tierIndex 0 bis 8, passend zu TIERS
 * @param opts { size, glow }, glow ist für die Feier, nicht für eine Listenzeile
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
  // Zwei Stufen derselben Rangfarbe statt zweier Farben: das Abzeichen soll wie ein
  // Material wirken, das Licht fängt, nicht wie ein Verlauf um des Verlaufs willen.
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

  // Das Hinterste zuerst. Aura, dann Aufleuchten, dann Heiligenschein, dann Flügel, dann
  // der Schild: alles, was die oberen Ränge dazubekommen, ist Licht hinter dem Ding und
  // kein weiteres Ding obendrauf.
  if (parts.aura) {
    const aura = node('radialGradient', { id: `${id}-aura` });
    aura.append(
      node('stop', { offset: '0.25', 'stop-color': 'var(--tier)', 'stop-opacity': '0.55' }),
      node('stop', { offset: '1', 'stop-color': 'var(--tier)', 'stop-opacity': '0' })
    );
    defs.append(aura);
    svg.append(node('circle', { cx: 32, cy: 32, r: 44, fill: `url(#${id}-aura)` }));
  }
  if (parts.flare) {
    for (let n = 0; n < 8; n++) {
      svg.append(node('path', {
        d: 'M32 -13 L34.4 -3 L32 1 L29.6 -3 Z', fill: 'var(--tier)', opacity: '0.7',
        transform: `rotate(${n * 45} 32 32)`,
      }));
    }
  }
  if (parts.halo) {
    svg.append(node('circle', {
      cx: 32, cy: 32, r: 35, fill: 'none', stroke: 'var(--tier)',
      'stroke-width': '2', opacity: '0.55',
    }));
  }
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
    // Drei Zacken, drei Steine. Ohne die ist eine Krone in dieser Größe eine Säge.
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
    // Ein Brillantschliff und kein Drachen: eine flache Tafel oben, zwei Schulterfacetten
    // hinunter zur Rundiste und der Unterteil, der in der Spitze endet. Vier Linien sind
    // das Mindeste, damit es geschliffen und nicht wie eine Raute aussieht.
    svg.append(node('path', {
      d: 'M23 27.5 L41 27.5 M26.6 23.5 L29 27.5 L32 41 M37.4 23.5 L35 27.5 L32 41',
      fill: 'none', stroke: 'var(--bg-sunken, #0d1422)',
      'stroke-width': '1.1', 'stroke-linejoin': 'round', opacity: '0.65',
    }));
    // Die Tafel fängt das Licht, dadurch sieht es aus wie ein Stein.
    svg.append(node('path', { d: 'M26.6 23.5 L37.4 23.5 L35 27.5 L29 27.5 Z',
      fill: '#fff', opacity: '0.22' }));
  }

  // Ein Stern in der Mitte, zwei links und rechts, drei in einer Reihe: der Abstand muss
  // aus der Anzahl kommen, sonst sitzt der mittlere von dreien auf einem der zwei.
  const starX = { 1: [32], 2: [23, 41], 3: [21, 32, 43] }[parts.stars] || [];
  const starScale = { 1: 1, 2: 0.72, 3: 0.58 }[parts.stars] || 1;
  for (const x of starX) {
    svg.append(node('path', { d: STAR, fill: 'var(--tier)',
      transform: `translate(${x} ${parts.gem ? 15 : 26}) scale(${starScale})` }));
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

/* Einordnung in eine Bevölkerung */

/**
 * Ein Anteil als Prozent, mit so vielen Nachkommastellen, wie das obere Ende der Skala braucht.
 *
 * Über Intl lokalisiert und nicht einfach Punkt gegen Komma getauscht, weil
 * Tausendertrennung und Dezimalzeichen nicht in jeder Sprache, in die die App wachsen
 * könnte, dieselbe Entscheidung sind.
 */
const num = (value, digits) => new Intl.NumberFormat(locale(), {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
}).format(value);

const pct = (fraction) => num(fraction * 100, shareDigits(fraction));

/**
 * Die Zahl für "Top X %", die braucht eine eigene Regel.
 *
 * Sie durch `pct` zu schicken war an der einen Stelle falsch, an der es darauf ankommt:
 * Radiant sind die obersten 0,05 %, `shareDigits` sieht einen winzigen Anteil und
 * will keine Nachkommastellen, und das Ende der Leiter stand als "Top 0 %" da. Die
 * Scheibe ist durch `topSlice` schon auf etwas Sagbares gerundet, hier müssen nur die
 * Stellen erhalten bleiben, die das Runden übrig gelassen hat.
 */
const slice = (value) => num(value, value >= 1 ? 0 : value >= 0.1 ? 1 : 2);

/**
 * Die zwei Einordnungen einer Wertung in die Bevölkerung, als eine oder zwei Zeilen.
 *
 * Warum beide, wenn eine Zahl aufgeräumter wäre: sie behaupten verschiedene Dinge, und
 * sie zusammenzulegen würde verstecken, welche welche ist. Die Zahl unter Trainierenden
 * sind die veröffentlichten Standards rückwärts gelesen, fast nur Rechnen. Die Zahl für
 * die Welt nimmt eine Annahme darüber dazu, wie viele Erwachsene überhaupt trainieren,
 * und sie beantwortet die Frage, die man eigentlich stellt. Beide zusammen halten die
 * zweite ehrlich: "Top 3 % der Trainierenden" macht klar, dass "99 % der Männer" keine
 * Aussage über das Studio ist.
 *
 * Unter dem Median der Trainierenden wird "Top X %" nicht mehr schmeichelhaft, sondern
 * albern ("Top 95 %"), dann kommt derselbe Satz wie in der Zeile für die Welt.
 *
 * @param score     Wertung 0 bis 100 auf der Leiter
 * @param sex       'male' | 'female' | null, mit wem die Zeile für die Welt vergleicht
 * @param compact   eine Zeile statt zwei, für die kleinen Karten
 */
export function populationNote(score, sex, { compact = false, onExplain = null } = {}) {
  const p = percentiles(score);
  if (!p) return null;

  const group = sex === 'female' ? 'Female' : 'Male';
  const world = t(`rank.pop.world${group}`, { pct: pct(p.world) });
  const lifters = p.lifters >= 0.5
    ? t('rank.pop.top', { pct: slice(topSlice(p.lifters)) })
    : t('rank.pop.amongLifters', { pct: pct(p.lifters) });

  // Auf einer Übungskarte ist der ganze Satz bei jedem einzelnen Rekord auf zwei Zeilen
  // umgebrochen, und aus einer nützlichen Randnotiz wurde das Lauteste in der Liste.
  // Dieselben zwei Tatsachen, abgekürzt, der volle Wortlaut ist im Kopf und im
  // Muskel-Sheet einen Tipp entfernt.
  if (compact) {
    const short = p.lifters >= 0.5
      ? t('rank.pop.shortTop', { pct: slice(topSlice(p.lifters)) })
      : t('rank.pop.shortAmong', { pct: pct(p.lifters) });
    return el('div.small.faint.pop-line', { style: { marginTop: '2px' },
      text: `${t(`rank.pop.short${group}`, { pct: pct(p.world) })} · ${short}` });
  }

  const block = el('div.pop-note', {}, [
    el('div.pop-world', { text: world }),
    el('div.pop-lifters', {}, [
      el('span', { text: lifters }),
      el('button.pop-why', {
        onclick: onExplain || (() => populationSheet(sex)),
        'aria-label': t('rank.pop.howTitle'),
      }, [t('rank.pop.how')]),
    ]),
  ]);
  return block;
}

/** Woher die Schätzung kommt und was sie nicht ist. */
export function populationSheet(sex) {
  const group = sex === 'female' ? 'Female' : 'Male';
  openSheet(t('rank.pop.howTitle'), el('div', {}, [
    el('div.small.muted', { text: t('rank.pop.howLifters') }),
    el('div.small.muted', { style: { marginTop: '12px' }, text: t(`rank.pop.howWorld${group}`) }),
    el('div.small.faint', { style: { marginTop: '12px' }, text: t('rank.pop.howCaveat') }),
  ]));
}

/* der Moment, in dem man eins bekommt */

/**
 * Die Feier beim Aufstieg.
 *
 * Kommt einmal pro wirklich gewonnener Stufe, nie beim Neuzeichnen, weil der Aufrufer
 * sie nur aufruft, wenn die gespeicherte Stufe hinter der berechneten liegt (siehe
 * `lastSeenRankStep` in den Einstellungen). Bei siebenundzwanzig Stufen ist das selten
 * genug, um noch etwas zu bedeuten, und häufig genug, um es zu bauen.
 *
 * Unter `prefers-reduced-motion` fällt die Bewegung ganz weg: Abzeichen und Worte sind
 * der Inhalt, der Knall ist Deko, und Deko kann man gefahrlos weglassen.
 */
export function celebrateRankUp(rank, { title, subtitle, dismiss }) {
  const overlay = el('div.rank-up-overlay', { role: 'dialog', 'aria-live': 'polite', 'aria-label': title });
  const still = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) overlay.classList.add('still');

  const stage = el(`div.rank-up-stage.tier-${rank.tierIndex}`);
  if (!still) {
    // Strahlen, als Ganzes gezeichnet und nicht einzeln animiert: ein drehendes Element
    // ist eine Ebene, zwölf animierte sind zwölf.
    stage.append(el('div.rank-up-rays', { 'aria-hidden': 'true' }));
  }
  stage.append(el('div.rank-up-badge', {}, [rankBadge(rank.tierIndex, { size: 132, glow: true })]));

  overlay.append(stage);
  overlay.append(el('div.rank-up-title', { text: title }));
  overlay.append(el('div.rank-up-sub', { text: subtitle }));
  overlay.append(el('button.btn.primary', { style: { marginTop: '22px', minWidth: '160px' },
    onclick: () => close() }, [dismiss]));

  // Kostet nichts, wo es nicht geht, und iOS Safari ist so ein Ort (navigator.vibrate
  // gibt es dort nicht). Das ist also für Android und für das, was iOS später macht.
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
