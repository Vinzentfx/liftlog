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
import { lengthBias, limiter, LENGTH_LABEL } from './exercise-science.js';
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

// Points available on paper. Nothing real scores at either end of that range —
// the criteria pull against each other, so a movement that is target-limited is
// usually not the one covering five muscle regions. Stars are therefore mapped
// from the window real exercises actually occupy; anchoring them to 0 and 9.5
// would squash every movement in the catalogue between three and four stars,
// which is a scale that tells you nothing.
const MAX_SCORE = 9.5;
const STAR_FLOOR = 2.5;
const STAR_CEIL = 8.5;

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
    label: 'Muscle length under load',
    points: lengthPoints, max: 3,
    detail: length.classified
      ? `${LENGTH_LABEL[length.bias]} — ${lowerFirst(length.why)}`
      : 'Not classified, so scored neutrally rather than guessed at',
    source: SOURCES.wolf2025,
  });
  if (length.bias === 'long' && length.classified) reasons.push(length.why);
  if (length.bias === 'short') {
    caveats.push(`${length.why}. Pair it with something that loads the same muscle stretched.`);
  }

  // ---- 2. does the target muscle decide when the set ends (0–2) ----
  const limit = limiter(ex);
  const limitPoints = { target: 2, mixed: 1, other: 0.5 }[limit.level];
  criteria.push({
    label: 'Target muscle is the limit',
    points: limitPoints, max: 2,
    detail: limit.why,
    source: null,   // training practice, not a study — say so
  });
  if (limit.level === 'target') reasons.push(limit.why);
  if (limit.level === 'other') caveats.push(limit.why);

  // ---- 3. progression you can measure (0–2) ----
  const loadPoints = LOADABILITY[ex.equipment] ?? 1;
  criteria.push({
    label: 'Progression you can track',
    points: loadPoints, max: 2,
    detail: loadPoints >= 2
      ? 'Loads in small steps, so week-to-week progress is a number'
      : ex.equipment === 'Bodyweight'
        ? 'Bodyweight — you progress in reps until you can hang plates on it'
        : ex.equipment === 'Bands'
          ? 'Band tension is not measurable, so progress is guesswork'
          : 'Loadable, but not in fine steps',
    source: SOURCES.haugen2023,
  });
  if (ex.equipment === 'Bands') caveats.push('Band tension cannot be quantified — hard to progress deliberately');

  // ---- 4. muscle covered per set (0–1.5) ----
  const regions = (ex.primary || []).length + (ex.secondary || []).length;
  const compound = ex.mech === 'compound' || regions >= 4;
  const breadthPoints = compound ? 1.5 : regions >= 2 ? 1 : 0.5;
  criteria.push({
    label: 'Muscle covered per set',
    points: breadthPoints, max: 1.5,
    detail: compound
      ? `Compound — ${regions} muscle ${regions === 1 ? 'region' : 'regions'} per set, so your time goes further`
      : regions >= 2
        ? 'Reaches more than one muscle group'
        : 'Isolation — one muscle group, which is a job, not a flaw',
    source: SOURCES.pelland2026,
  });
  if (compound) reasons.push('One set trains several muscles at once');

  // ---- 5. published strength standards (0–0.5) ----
  const benchmark = isBenchmark(ex.name);
  criteria.push({
    label: 'Has strength standards',
    points: benchmark ? 0.5 : 0, max: 0.5,
    detail: benchmark
      ? 'Published standards exist, so LiftLog can score you on it'
      : 'No published standards for this movement',
    source: null,
  });

  if (!(ex.instructions || []).length) caveats.push('No written technique steps for this one');

  const score = criteria.reduce((sum, c) => sum + c.points, 0);
  const scaled = 1 + ((score - STAR_FLOOR) / (STAR_CEIL - STAR_FLOOR)) * 4;
  const stars = Math.max(1, Math.min(5, Math.round(scaled * 2) / 2));

  const rating = {
    stars, score, max: MAX_SCORE, band: [STAR_FLOOR, STAR_CEIL],
    criteria, reasons, caveats, length, limit,
  };
  CACHE.set(ex, { sig, rating });
  return rating;
}

const CACHE = new WeakMap();

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
