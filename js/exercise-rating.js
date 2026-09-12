// Bewertung einer Übung, bezogen auf Muskelaufbau.
//
// Wichtig, was das ist und was nicht.
//
// Es gibt keinen Datensatz, der Übungen nach Hypertrophie sortiert, und es wird
// nie einen geben: niemand vergleicht 900 Bewegungen direkt in einer Studie. EMG
// ist der übliche Ersatz und sagt Wachstum schlecht voraus. Das hier ist also kein
// Forschungsergebnis, sondern eine Punktwertung der vier Eigenschaften, zu denen
// die aktuelle Literatur wirklich etwas sagt. Jeder Punkt wird angezeigt, mit Quelle.
//
// Was sich bei der Durchsicht im Juli 2026 geändert hat:
//   * Das Gerät entscheidet nicht mehr den Großteil der Punkte. Maschinen und
//     freie Gewichte bauen bei gleichem Volumen und gleicher Anstrengung gleich
//     viel Muskel auf (SOURCES.haugen2023). "Langhantel 2 Punkte, Maschine 1" hat
//     also einen Unterschied bewertet, den es nicht gibt. Das Gerät zählt jetzt nur
//     noch dafür, wie fein man die Last steigern kann. Das ist ein Argument fürs
//     Mitschreiben, nicht fürs Wachstum.
//   * Die Muskellänge unter Last ist jetzt das schwerste Kriterium. Das ist die
//     einzige Stellschraube bei der Übungswahl mit echten Belegen (SOURCES.wolf2025).
//   * Grundübungen gelten nicht mehr automatisch als besser. Sie bekommen Punkte
//     dafür, dass sie pro Satz mehr Muskeln abdecken, also für Effizienz, nicht
//     dafür, einen einzelnen Muskel stärker wachsen zu lassen.

import { isBenchmark } from './standards.js';
import { lengthBias, limiter, stability, LENGTH_LABEL } from './exercise-science.js';
import { t, tn } from './i18n.js';
import { SOURCES } from './evidence.js';
import { starString } from './ui.js';

export { starString };

/**
 * Wie fein sich die Last steigern lässt, das macht Fortschritt messbar.
 * Ausdrücklich keine Aussage über Wachstum, siehe SOURCES.haugen2023.
 */
const LOADABILITY = {
  Barbell: 2, Dumbbell: 2, Machine: 2, Cable: 2, Kettlebell: 1.5,
  Bodyweight: 1, Bands: 0.5, Other: 1,
};

function loadability(ex) {
  // Die importierten Bodyweight Flyes benutzen rollende SZ-Stangen als Griffe. Die
  // machen die Bewegung nicht von außen belastbar, steigern lässt sie sich nur über
  // Hebel und Wiederholungen, und die Instabilität ändert sich von Wiederholung zu Wiederholung.
  if (/bodyweight (fly|flye)/i.test(ex.name || '')) return 0.5;
  if (/suspension|trx|ring (fly|push)/i.test(ex.name || '')) return 0.5;
  return LOADABILITY[ex.equipment] ?? 1;
}

// Die Punkte, die es auf dem Papier gibt. Keine echte Übung landet an einem der
// beiden Enden, weil sich die Kriterien gegenseitig ausbremsen: was vom Zielmuskel
// begrenzt wird, deckt meistens nicht fünf Regionen ab. Die Sterne werden deshalb
// aus dem Bereich abgeleitet, in dem echte Übungen tatsächlich liegen. Hängt man
// sie an 0 und 9,5, landet jede Übung im Katalog zwischen drei und vier Sternen,
// und so eine Skala sagt nichts.
const MAX_SCORE = 10.5;
const STAR_FLOOR = 2.5;
const STAR_CEIL = 9;

/**
 * @returns {{stars:number, score:number, max:number, criteria:object[],
 *            reasons:string[], caveats:string[], length:object, limit:object}}
 *   stars ist 1 bis 5 in halben Schritten.
 */
export function rateExercise(ex) {
  if (!ex) return null;

  // Die Bibliothek zeichnet bei jedem Tastendruck im Suchfeld neu, 60 Zeilen
  // Regex-Abgleich laufen also ständig. Deshalb Cache je Übungsobjekt, mit den
  // Feldern als Schlüssel, die die Bewertung liest, damit eine Änderung ihn verwirft.
  const sig = `${ex.name}|${ex.equipment}|${ex.mech}|${(ex.primary || []).length}|${(ex.secondary || []).length}`;
  const hit = CACHE.get(ex);
  if (hit && hit.sig === sig) return hit.rating;

  const criteria = [];
  const reasons = [];
  const caveats = [];

  // 1. Muskellänge unter Last (0 bis 3), das schwerste Kriterium
  const length = lengthBias(ex);
  const lengthPoints = { long: 3, mixed: 1.5, short: 0.5 }[length.bias];
  criteria.push({
    label: 'exRating.length',
    points: lengthPoints, max: 3,
    detail: length.classified ? 'exRating.lengthDetail' : 'exRating.lengthUnclassified',
    detailParams: length.classified
      ? { label: t(LENGTH_LABEL[length.bias]), why: lowerFirst(t(length.why)) }
      : null,
    source: SOURCES.wolf2025,
  });
  if (length.bias === 'long' && length.classified) reasons.push(t(length.why));
  if (length.bias === 'short') {
    caveats.push(t('exRating.pairStretched', { why: t(length.why) }));
  }

  // 2. Entscheidet der Zielmuskel, wann der Satz endet (0 bis 2)
  const limit = limiter(ex);
  const limitPoints = { target: 2, mixed: 1, other: 0.5 }[limit.level];
  criteria.push({
    label: 'exRating.limiter',
    points: limitPoints, max: 2,
    detail: limit.why,
    source: null,   // Trainingspraxis, keine Studie, also auch so sagen
  });
  if (limit.level === 'target') reasons.push(t(limit.why));
  if (limit.level === 'other') caveats.push(t(limit.why));

  // 3. Stabilität für Anstrengung im Zielmuskel (0 bis 1,5)
  const stable = stability(ex);
  criteria.push({
    label: 'exRating.stability',
    points: stable.points, max: 1.5,
    detail: stable.why,
    source: SOURCES.anderson2004,
  });
  if (stable.level === 'supported') reasons.push(t(stable.why));
  if (stable.level === 'unstable' || stable.level === 'demanding') caveats.push(t(stable.why));

  // 4. Messbarer Fortschritt (0 bis 2)
  const loadPoints = loadability(ex);
  criteria.push({
    label: 'exRating.progression',
    points: loadPoints, max: 2,
    detail: loadPoints >= 2
      ? 'exRating.fineSteps'
      : ex.equipment === 'Bodyweight'
        ? 'exRating.bodyweightProgress'
        : ex.equipment === 'Bands'
          ? 'exRating.bandProgress'
          : 'exRating.coarseSteps',
    source: SOURCES.haugen2023,
  });
  if (ex.equipment === 'Bands') caveats.push(t('exRating.bandCaveat'));

  // 5. Sinnvoll abgedeckte Muskeln pro Satz (0 bis 1)
  const regions = (ex.primary || []).length + (ex.secondary || []).length;
  // Stabilisatoren, die als Nebenregionen eingetragen sind, dürfen aus einer
  // Isolationsübung keine hocheffiziente Grundübung machen. Das war der zweite
  // Grund, warum Bodyweight Flyes vor der Butterfly-Maschine lagen.
  const compound = ex.mech === 'compound';
  const breadthPoints = compound ? 1 : (ex.primary || []).length >= 2 ? 0.75 : 0.5;
  criteria.push({
    label: 'exRating.breadth',
    points: breadthPoints, max: 1,
    detail: compound ? 'exRating.compound' : (ex.primary || []).length >= 2 ? 'exRating.twoGroups' : 'exRating.isolation',
    detailParams: compound ? { regions: tn(regions, 'unit.region') } : null,
    source: SOURCES.pelland2026,
  });
  if (compound) reasons.push(t('exRating.compoundReason'));

  // 6. Veröffentlichte Kraftstandards (0 bis 0,5)
  const benchmark = isBenchmark(ex.name);
  criteria.push({
    label: 'exRating.standards',
    points: benchmark ? 0.5 : 0, max: 0.5,
    detail: benchmark ? 'exRating.hasStandards' : 'exRating.noStandards',
    source: null,
  });

  if (!(ex.instructions || []).length) caveats.push(t('exRating.noSteps'));

  const score = criteria.reduce((sum, c) => sum + c.points, 0);
  const scaled = 1 + ((score - STAR_FLOOR) / (STAR_CEIL - STAR_FLOOR)) * 4;
  const stars = Math.max(1, Math.min(5, Math.round(scaled * 2) / 2));

  const rating = {
    stars, score, max: MAX_SCORE, band: [STAR_FLOOR, STAR_CEIL],
    criteria, reasons, caveats, length, limit, stability: stable,
  };
  CACHE.set(ex, { sig, rating });
  return rating;
}

const CACHE = new WeakMap();

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
