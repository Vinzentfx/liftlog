// Warm-up sets for the weight you are about to lift.
//
// Stated plainly, because it is the kind of number this app normally refuses:
// **there is no evidence base for a warm-up ramp.** No trial establishes an
// optimal number of sets, an optimal percentage, or that any particular ramp
// beats another. What exists is near-universal gym practice, and practice is
// what this is. The UI says so where it offers them.
//
// What that means for the design: keep it small and keep it out of the way. Two
// sets on a heavy barbell lift, one on everything else, and nothing at all when
// there is no working weight to ramp towards. An app that cannot know the right
// answer should at least not take up much room being wrong.

import { isBenchmark } from './standards.js';
import { platePlan } from './plates.js';

/**
 * How many warm-up sets an exercise gets.
 *
 * Two for the heavy compound barbell lifts — the ones with a strength standard,
 * plus anything else loaded on a bar — because that is where the jump from
 * nothing to a working set is largest. One for machines, cables, dumbbells and
 * bodyweight, where the movement is guided and the load is lighter.
 */
export function warmupCount(exercise) {
  if (!exercise) return 1;
  return isBenchmark(exercise.name) || exercise.equipment === 'Barbell' ? 2 : 1;
}

/**
 * The ramp itself.
 *
 * Percentages are the conventional ones — roughly half, then three-quarters —
 * and reps come down as the weight goes up, which is the whole point: warming
 * the movement without spending anything on it.
 *
 * Weights are rounded to something you can actually load. For a barbell that
 * means real plates, via the same maths the plate calculator uses, so a
 * suggestion is never a weight the rack cannot make.
 *
 * @returns [{ weight, reps }], or [] when there is nothing to ramp towards
 */
export function warmupSets(exercise, workingWeight, { units = 'kg', barWeight = 20 } = {}) {
  const target = Number(workingWeight) || 0;
  if (target <= 0) return [];

  const count = warmupCount(exercise);
  const ramp = count === 2 ? [[0.5, 5], [0.75, 3]] : [[0.6, 5]];
  const barbell = exercise && exercise.equipment === 'Barbell';

  const out = [];
  for (const [share, reps] of ramp) {
    const raw = target * share;
    const weight = barbell ? loadable(raw, barWeight, units) : round(raw, units);
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

const step = (units) => (units === 'lb' ? 5 : 2.5);
const round = (weight, units) => Math.round(weight / step(units)) * step(units);
