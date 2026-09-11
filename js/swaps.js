// "Gleicher Muskel, bessere Position": Alternativen zu einer Übung, die man schon macht.
//
// Hier ist der Klassifikator für die Muskellänge einmal ein Rat und keine Note.
// Pushdowns gegen Überkopf-Strecken zu tauschen kostet nichts, ändert keine
// Satzzahl und ist die billigste Verbesserung, die die Studienlage hergibt
// (SOURCES.wolf2025).
//
// Vorgeschlagen wird nur, was klar besser ist und nicht bloß anders: höher
// bewertet, oder gleich bewertet, aber mit mehr Last in der Dehnung. Übungen nur
// um des Wechselns willen zu tauschen ist genau der Fehler, vor dem die Studien
// zur Übungsvariation warnen.

import { rateExercise } from './exercise-rating.js';
import { NOT_FOR_SLOTS } from './plan-builder.js';
import { tRegion, t } from './i18n.js';

const BIAS_RANK = { short: 0, mixed: 1, long: 2 };

/**
 * Nur nach Sternen muss ein Tausch einen ganzen Stern besser sein. Ein halber
 * liegt im Rauschen einer gewichteten Faustregel, und ohne diese Grenze schlägt
 * die App fröhlich vor, Kniebeugen durch "Lying Machine Squat" zu ersetzen. Die
 * bekommt tatsächlich mehr Sterne, weil die Maschine das Gleichgewicht abnimmt,
 * für das die Langhantel Abzug bekommt.
 */
const MIN_STAR_GAIN = 1;

/**
 * Die Ausreißer im Katalog haben lange Namen ("Biceps Curl with Overhead Extension
 * using Dumbbells on Stability Ball"), die Übungen, die wirklich jemand plant,
 * kurze. Ein grober Filter, aber er macht den Unterschied zwischen Rat und Rauschen.
 */
const MAX_WORDS = 6;

/**
 * @param ex         die Übung, die ersetzt werden soll
 * @param exercises  die ganze Bibliothek
 * @param limit      wie viele zurückkommen
 * @returns [{ ex, stars, reason }]
 */
export function suggestSwaps(ex, exercises, limit = 3) {
  if (!ex) return [];
  const mine = rateExercise(ex);
  const targets = new Set(ex.primary || []);
  if (!targets.size) return [];

  const out = [];
  for (const cand of exercises) {
    if (cand.id === ex.id) continue;
    if (NOT_FOR_SLOTS.test(cand.name)) continue;
    if (cand.name.trim().split(/\s+/).length > MAX_WORDS) continue;
    // Muss denselben Muskel als Hauptaufgabe trainieren, nicht nur nebenbei.
    if (!(cand.primary || []).some((r) => targets.has(r))) continue;
    // Selbst schlecht bewertet: dann nicht als Verbesserung zurückgeben.
    if (cand.myRating && cand.myRating <= 2) continue;

    const r = rateExercise(cand);
    if (!r) continue;

    const betterPosition = BIAS_RANK[r.length.bias] > BIAS_RANK[mine.length.bias];
    const betterStars = r.stars >= mine.stars + MIN_STAR_GAIN;
    if (!betterStars && !betterPosition) continue;
    // Was der Klassifikator nicht kennt, beweist nichts.
    if (betterPosition && !r.length.classified) continue;

    let reason;
    if (betterPosition) {
      reason = betterStars
        ? t('swaps.lengthAndStars', { why: t(r.length.why) })
        : t(r.length.why);
    } else {
      reason = topGain(mine, r);
    }

    out.push({
      ex: cand,
      stars: r.stars,
      reason,
      // Die Position zählt mehr als die Sterne: dafür gibt es Belege, die Sterne
      // sind eine gewichtete Meinung über mehrere Eigenschaften zugleich.
      sort: (betterPosition ? 10 : 0) + r.stars + (cand.favourite ? 3 : 0) + (cand.myRating ? cand.myRating - 3 : 0),
    });
  }

  return out
    .sort((a, b) => b.sort - a.sort || a.ex.name.localeCompare(b.ex.name))
    .slice(0, limit);
}

/** Worin die Alternative wirklich besser ist, für eine ehrliche Zeile. */
function topGain(mine, theirs) {
  let best = null, gap = 0;
  for (let i = 0; i < theirs.criteria.length; i++) {
    const d = theirs.criteria[i].points - mine.criteria[i].points;
    if (d > gap) { gap = d; best = theirs.criteria[i]; }
  }
  return best
    ? t('swaps.scoresBetter', {
        criterion: t(best.label).toLowerCase(),
        detail: lowerFirst(t(best.detail, best.detailParams)),
      })
    : t('swaps.higherOverall');
}

/** Welche Muskeln ein Tausch abdeckt, für die Unterzeile im Sheet. */
export function targetLabel(ex) {
  return (ex.primary || []).map(tRegion).join(', ');
}

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
