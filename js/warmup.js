// Warm-up sets for the weight you are about to lift.
//
// This used to open by saying there is no evidence base for a warm-up ramp.
// That was true of the *number* of sets and it is still mostly true, but it was
// never true of the shape, and the shape the app suggested — roughly half for
// five reps, then three-quarters for three — turns out to be the one arm of the
// comparison that loses.
//
// What the trials actually say:
//
//  * Ribeiro 2020 (SOURCES.ribeiro2020) put forty trained men through squat and
//    bench at 80% of maximum after three different warm-ups: light only, heavy
//    only, and light-then-heavy. Light only came last on both lifts. The heavy
//    set was best on the squat, the progressive pair best on the bench. So the
//    last warm-up set belongs *near* the working weight, not well below it.
//
//  * A 2025 crossover in 29 trained lifters (SOURCES.warmup2025) compared no
//    specific warm-up, one set of 3–4 at 75%, and two sets at 55% then 75%,
//    at roughly 10RM loads. The differences were negligible in every direction,
//    including between one set and two. More warm-up bought nothing.
//
// Put together: fewer sets, fewer reps, closer to the working weight. Which is
// what this file now offers, and much less of it than it used to.
//
// What is still practice rather than finding: the three-set ramp for heavy
// low-rep work. Both trials above tested moderate loads, so neither says
// anything about a triple at 90%, and the app does not pretend otherwise.

import { isBenchmark } from './standards.js';
import { platePlan } from './plates.js';
import { THRESHOLDS } from './evidence.js';

const TOP_SHARE = THRESHOLDS.warmupTopShare.value;

/**
 * The ramp for an exercise, before any weights are worked out.
 *
 * @returns [[share of working weight, reps]], lightest first
 */
function ramp(exercise, { targetReps = 10, alreadyWarm = false } = {}) {
  const heavyBar = isBenchmark(exercise?.name) || exercise?.equipment === 'Barbell';
  // Guarded against a nonsense target: a negative or zero rep goal used to
  // fall into the heavy-single branch and offer a three-step ramp.
  const parsed = Number(targetReps);
  const reps = Number.isFinite(parsed) && parsed > 0 ? parsed : 10;

  // Heavy, low-rep work. Not covered by either trial — see the header — so this
  // stays the conventional three-step ramp, and the caveat in the UI says which
  // half of the advice it belongs to.
  if (heavyBar && reps <= 5) {
    return alreadyWarm ? [[0.65, 3], [0.85, 2]] : [[0.45, 5], [0.65, 3], [0.85, 2]];
  }

  // Normal training loads on a bar: the progressive pair that won the bench
  // comparison, collapsing to the single heavy set once the muscle has already
  // done work this session.
  if (heavyBar && reps <= 15) {
    return alreadyWarm ? [[TOP_SHARE, 2]] : [[0.55, 4], [TOP_SHARE, 2]];
  }

  // Everything else: machines, cables, dumbbells. Guided path, lighter load, and
  // one set is as good as two. A muscle that has already been trained in this
  // session does not need re-introducing to a pec deck.
  if (alreadyWarm) return [];
  return reps <= 15 ? [[0.7, 3]] : [[0.6, 4]];
}

/**
 * How many warm-up sets an exercise gets, given its context.
 *
 * Kept as an exported function because the count alone is what the plan editor
 * and the tests want to ask about.
 */
export function warmupCount(exercise, context = {}) {
  return ramp(exercise, context).length;
}

/**
 * Which of this exercise's muscles have already been worked today.
 *
 * The point is not bookkeeping, it is that the second chest exercise of a
 * session does not need its own introduction: the tissue is warm, the joint has
 * moved, and the set that would have done that job has already happened. Only
 * primary regions count — a triceps that took half a set of incline press is
 * not a warmed triceps.
 */
export function alreadyWarm(exercise, warmedRegions) {
  if (!warmedRegions || !warmedRegions.size) return false;
  return (exercise?.primary || []).some((region) => warmedRegions.has(region));
}

/**
 * The ramp itself, in weights you can load.
 *
 * For a barbell that means real plates, via the same maths the plate calculator
 * uses, so a suggestion is never a weight the rack cannot make.
 *
 * @param context { targetReps, warmedRegions } — the session so far
 * @returns [{ weight, reps }], or [] when there is nothing worth ramping
 */
export function warmupSets(exercise, workingWeight, {
  units = 'kg', barWeight = 20, targetReps = 10, warmedRegions = null, step: stackStep = null,
} = {}) {
  const target = Number(workingWeight) || 0;
  if (target <= 0) return [];

  const steps = ramp(exercise, { targetReps, alreadyWarm: alreadyWarm(exercise, warmedRegions) });
  const barbell = exercise && exercise.equipment === 'Barbell';

  const out = [];
  for (const [share, reps] of steps) {
    const raw = target * share;
    const weight = barbell && !(Number(stackStep) > 0)
      ? loadable(raw, barWeight, units)
      : round(raw, units, stackStep);
    // A warm-up heavier than the work, or lighter than the empty bar, is not a
    // warm-up. Both happen at the bottom of the range — an empty bar already
    // exceeds half of 30 kg.
    if (weight <= 0 || weight >= target) continue;
    if (out.some((s) => s.weight === weight)) continue;
    out.push({ weight, reps });
  }
  return out;
}

/** Nearest weight the bar can actually hold, never above the asking figure. */
function loadable(weight, barWeight, units) {
  const plan = platePlan(weight, barWeight, units);
  if (!plan) return 0;                     // lighter than the bar itself
  return plan.loaded > weight ? Math.max(barWeight, plan.loaded - step(units)) : plan.loaded;
}

const step = (units, override = null) => (Number(override) > 0 ? Number(override) : units === 'lb' ? 5 : 2.5);
const round = (weight, units, override = null) =>
  Math.round(weight / step(units, override)) * step(units, override);
