// "Same muscle, better position" — alternatives for a movement you already do.
//
// This is the one place where the length-bias classifier earns its keep as
// advice rather than as a score. Swapping a pushdown for an overhead extension
// costs nothing, changes no set count, and is the cheapest improvement the
// evidence supports (SOURCES.wolf2025).
//
// A swap is only offered when it is clearly better, not merely different:
// higher rated, or equally rated but loading the muscle at a longer length.
// Shuffling exercises for the sake of it is the failure mode the variation
// literature warns about.

import { rateExercise } from './exercise-rating.js';
import { NOT_FOR_SLOTS } from './plan-builder.js';
import { tRegion, t } from './i18n.js';

const BIAS_RANK = { short: 0, mixed: 1, long: 2 };

/**
 * On star count alone a swap has to be a full star better. Half a star is
 * inside the noise of a weighted heuristic, and without this the app cheerfully
 * proposes replacing a back squat with "Lying Machine Squat" — which the rating
 * genuinely scores higher, because a machine removes the balance component it
 * docks the barbell for.
 */
const MIN_STAR_GAIN = 1;

/**
 * Catalogue oddities are verbose ("Biceps Curl with Overhead Extension using
 * Dumbbells on Stability Ball"); the movements anyone actually programmes are
 * short. A crude filter, but it is the difference between advice and noise.
 */
const MAX_WORDS = 6;

/**
 * @param ex         the exercise to replace
 * @param exercises  the full library
 * @param limit      how many to return
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
    // Must train the same muscle as its own main job, not as a bystander.
    if (!(cand.primary || []).some((r) => targets.has(r))) continue;
    // You rated it badly; do not hand it back as an improvement.
    if (cand.myRating && cand.myRating <= 2) continue;

    const r = rateExercise(cand);
    if (!r) continue;

    const betterPosition = BIAS_RANK[r.length.bias] > BIAS_RANK[mine.length.bias];
    const betterStars = r.stars >= mine.stars + MIN_STAR_GAIN;
    if (!betterStars && !betterPosition) continue;
    // A candidate the classifier does not recognise is not evidence of anything.
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
      // Position beats stars: it is the finding with evidence behind it, where
      // the star total is a weighted opinion about several properties at once.
      sort: (betterPosition ? 10 : 0) + r.stars + (cand.favourite ? 3 : 0) + (cand.myRating ? cand.myRating - 3 : 0),
    });
  }

  return out
    .sort((a, b) => b.sort - a.sort || a.ex.name.localeCompare(b.ex.name))
    .slice(0, limit);
}

/** Which criterion the alternative actually wins on, for an honest one-liner. */
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

/** Muscles a swap would cover, for the sheet subtitle. */
export function targetLabel(ex) {
  return (ex.primary || []).map(tRegion).join(', ');
}

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
