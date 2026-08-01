// Exercise quality rating, scored for muscle growth.
//
// IMPORTANT — what this is and is not.
//
// There is no dataset that ranks exercises for hypertrophy, and there never
// will be: nobody is going to run a head-to-head trial on 900 movements. EMG is
// the usual stand-in and it is a poor predictor of growth. So this is not a
// research result. It is a scoring of the four properties the current
// literature actually says something about, with every point shown to the user
// and its source named.
//
// What changed in the July 2026 review of the evidence:
//   - Equipment no longer decides most of the score. Machines and free weights
//     build the same muscle at matched volume and effort (SOURCES.haugen2023),
//     so the old "barbell 2 points, machine 1 point" was scoring a difference
//     that does not exist. Equipment now only affects how finely you can load
//     the thing, which is a tracking argument, not a growth one.
//   - Muscle length under load is now the heaviest criterion. It is the one
//     exercise-selection variable with real evidence behind it
//     (SOURCES.wolf2025).
//   - "Compound" is no longer treated as automatically better. A compound gets
//     credit for covering more muscle per set — efficiency — not for growing
//     any single muscle harder.

import { isBenchmark } from './standards.js';
import { lengthBias, limiter, stability, LENGTH_LABEL } from './exercise-science.js';
import { t, tn } from './i18n.js';
import { SOURCES } from './evidence.js';
import { starString } from './ui.js';

export { starString };

/**
 * How finely you can add load, which is what makes progression measurable.
 * Explicitly NOT a claim about growth — see SOURCES.haugen2023.
 */
const LOADABILITY = {
  Barbell: 2, Dumbbell: 2, Machine: 2, Cable: 2, Kettlebell: 1.5,
  Bodyweight: 1, Bands: 0.5, Other: 1,
};

function loadability(ex) {
  // Imported Bodyweight Flyes use rolling EZ-bars as handles. The bars do not
  // make the movement externally loadable; leverage and reps are the only
  // practical progression, and instability changes between repetitions.
  if (/bodyweight (fly|flye)/i.test(ex.name || '')) return 0.5;
  if (/suspension|trx|ring (fly|push)/i.test(ex.name || '')) return 0.5;
  return LOADABILITY[ex.equipment] ?? 1;
}

// Points available on paper. Nothing real scores at either end of that range —
// the criteria pull against each other, so a movement that is target-limited is
// usually not the one covering five muscle regions. Stars are therefore mapped
// from the window real exercises actually occupy; anchoring them to 0 and 9.5
// would squash every movement in the catalogue between three and four stars,
// which is a scale that tells you nothing.
const MAX_SCORE = 10.5;
const STAR_FLOOR = 2.5;
const STAR_CEIL = 9;

/**
 * @returns {{stars:number, score:number, max:number, criteria:object[],
 *            reasons:string[], caveats:string[], length:object, limit:object}}
 *   stars is 1–5 in half steps.
 */
export function rateExercise(ex) {
  if (!ex) return null;

  // The library repaints on every keystroke of the search box, so 60 rows worth
  // of regex matching runs constantly. Cache per exercise object, keyed on the
  // fields the rating reads so an edit invalidates it.
  const sig = `${ex.name}|${ex.equipment}|${ex.mech}|${(ex.primary || []).length}|${(ex.secondary || []).length}`;
  const hit = CACHE.get(ex);
  if (hit && hit.sig === sig) return hit.rating;

  const criteria = [];
  const reasons = [];
  const caveats = [];

  // ---- 1. muscle length under load (0–3) — the heaviest criterion ----
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

  // ---- 2. does the target muscle decide when the set ends (0–2) ----
  const limit = limiter(ex);
  const limitPoints = { target: 2, mixed: 1, other: 0.5 }[limit.level];
  criteria.push({
    label: 'exRating.limiter',
    points: limitPoints, max: 2,
    detail: limit.why,
    source: null,   // training practice, not a study, so say so
  });
  if (limit.level === 'target') reasons.push(t(limit.why));
  if (limit.level === 'other') caveats.push(t(limit.why));

  // ---- 3. stability for target-muscle effort (0–1.5) ----
  const stable = stability(ex);
  criteria.push({
    label: 'exRating.stability',
    points: stable.points, max: 1.5,
    detail: stable.why,
    source: SOURCES.anderson2004,
  });
  if (stable.level === 'supported') reasons.push(t(stable.why));
  if (stable.level === 'unstable' || stable.level === 'demanding') caveats.push(t(stable.why));

  // ---- 4. progression you can measure (0–2) ----
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

  // ---- 5. productive muscle coverage per set (0–1) ----
  const regions = (ex.primary || []).length + (ex.secondary || []).length;
  // Stabilizers listed as secondary regions must not turn an isolation exercise
  // into a high-efficiency compound. That was the second reason Bodyweight
  // Flyes outranked the pec deck.
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

  // ---- 6. published strength standards (0–0.5) ----
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
