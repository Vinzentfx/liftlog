// Where a rank sits in a population, estimated rather than measured.
//
// The app already had one percentile, and it is a real one: `shareRankScores`
// asks the server how many other LiftLog users score below you. It is also
// unavailable to most people most of the time, because it needs an account, a
// connection, an opt-in, and a population that has already logged the same
// lift. So the rank stood on its own on screen, and a rank on its own does not
// answer the question people actually have.
//
// That question is "is this good", and without an answer the ladder actively
// misleads. Legend is the ninth of twelve ranks, so Legend II reads as
// mid-table when it is in fact the top one percent of adult men. Somebody
// pressing an incline that essentially nobody in their gym presses was being
// shown a number that looked like a C grade. This file is the fix, and it is
// deliberately a model rather than a measurement, said out loud everywhere it
// is displayed.
//
// Two numbers come out of it, and they are not the same kind of claim:
//
//   `lifters` is close to arithmetic. The four published anchors the whole
//   ladder is built from are themselves percentile statements about people who
//   train and log: novice is the 20th, intermediate the 50th, advanced the
//   80th, elite the 95th. Turning a score back into a percentile is reading the
//   table in the direction it was written.
//
//   `world` adds one modelling step on top, mixing in the large majority of
//   adults who never touch a barbell. That step is an assumption, the numbers
//   behind it are below with their reasoning, and it is why every screen calls
//   this an estimate.

import { BAND, DIVISIONS } from './standards.js';

/**
 * Score on the ladder against z on a standard normal of lifters.
 *
 * Each row is a published anchor and the percentile the standards it came from
 * assign to it. The score column is not chosen: it falls out of `ladder()`,
 * which puts novice at the entry to Gold, intermediate at Diamond, advanced at
 * Grandmaster and elite at Legend.
 *
 * The striking part, and the reason this file can be short: those four points
 * are almost exactly collinear in z. Gold to Diamond is 0.842 z across 16.67
 * score, Diamond to Grandmaster is 0.842 across 16.67, Grandmaster to Legend is
 * 0.803 across 16.67. The rank ladder is already a linear standard-normal
 * scale, which nobody designed it to be, and which is a decent sign that the
 * geometric interpolation in `ladder()` is the right shape.
 *
 * Above Legend it bends away from that line, correctly: BEYOND_ELITE is
 * calibrated against competition, and the last three ranks are much thinner
 * slices of the population than a straight extension would make them.
 */
const ANCHORS = [
  // [score, share of lifters below]
  [100 / 12 * 1,  0.05],    // Silver      — a little over half the novice standard
  [100 / 12 * 2,  0.20],    // Gold        — published Novice
  [100 / 12 * 4,  0.50],    // Diamond     — published Intermediate
  [100 / 12 * 6,  0.80],    // Grandmaster — published Advanced
  [100 / 12 * 8,  0.95],    // Legend      — published Elite
  [100 / 12 * 9,  0.99],    // Challenger  — extrapolated, see BEYOND_ELITE
  [100 / 12 * 10, 0.998],   // Immortal
  [100 / 12 * 11, 0.9995],  // Radiant
  [100,           0.9999],  // the top of the scale
];

/**
 * The share of adults who train with resistance often enough to be described by
 * the standards table at all.
 *
 * Self-reported "meets muscle-strengthening guidelines" runs near 30% in
 * national surveys, and self-report on exercise is generous in one direction
 * only. Regular barbell or machine training, the thing the standards are
 * written about, is meaningfully rarer than that. A fifth is the conservative
 * reading, and conservative here means the world percentile comes out *lower*,
 * which is the correct direction for a number that flatters.
 */
const TRAINING_SHARE = 0.20;

/**
 * Where the untrained sit on the same scale, as mean and spread in z.
 *
 * -1.45 puts the untrained median at roughly half of bodyweight on the bench,
 * which is the middle of the range usually reported for adult men who do not
 * train. It lands between Bronze and Silver on this ladder, below the published
 * novice standard, which is the whole point: the novice standard describes
 * somebody who has already started.
 *
 * 0.50 is the honest part of the uncertainty. Too narrow and the curve develops
 * a cliff, where one division of rank moves the world percentile by thirty
 * points; too wide and one untrained adult in five is claimed to out-bench the
 * novice standard. At 0.50 about one in nine does, which is roughly the share
 * of adults who are strong from work or sport without ever lifting.
 *
 * These two are the only invented numbers in this file, and they only affect
 * `world`. `lifters` never touches them.
 */
const UNTRAINED_MEAN_Z = -1.45;
const UNTRAINED_SD_Z = 0.50;

/**
 * The normal CDF, via Abramowitz and Stegun 7.1.26.
 *
 * Accurate to about 1.5e-7, which is four orders of magnitude better than
 * anything displayed here needs, and it is fifteen lines instead of a
 * dependency.
 */
function phi(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** The inverse, for turning the anchor percentiles into z once at load time. */
function probit(p) {
  // Acklam's rational approximation. Only ever called on the nine constants
  // above, so speed is irrelevant and clarity is not.
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) return -probit(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** The anchor table in z, built once. */
const CURVE = ANCHORS.map(([score, share]) => [score, probit(share)]);

/**
 * A ladder score as a z-value on the distribution of people who train.
 *
 * Linear between anchors, and linearly extended below the first one rather than
 * clamped: a score of zero is a real place on the ladder that somebody's first
 * session can land on, and pinning everything under Silver to the same number
 * would make the whole bottom of the app say one thing.
 */
export function zForScore(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  if (s <= CURVE[0][0]) {
    const [x0, z0] = CURVE[0], [x1, z1] = CURVE[1];
    return z0 + (s - x0) * (z1 - z0) / (x1 - x0);
  }
  for (let i = 1; i < CURVE.length; i++) {
    if (s <= CURVE[i][0]) {
      const [x0, z0] = CURVE[i - 1], [x1, z1] = CURVE[i];
      return z0 + (s - x0) * (z1 - z0) / (x1 - x0);
    }
  }
  return CURVE[CURVE.length - 1][1];
}

/**
 * Both readings of one score, as fractions between 0 and 1, or null.
 *
 * @returns { lifters, world } or null when there is no score to read
 */
export function percentiles(score) {
  const z = zForScore(score);
  if (z === null) return null;
  const lifters = phi(z);
  const untrained = phi((z - UNTRAINED_MEAN_Z) / UNTRAINED_SD_Z);
  return {
    lifters,
    world: TRAINING_SHARE * lifters + (1 - TRAINING_SHARE) * untrained,
  };
}

/**
 * How many decimals a share deserves, which is not a formatting preference.
 *
 * The interesting half of this scale is compressed into its last two percent:
 * Legend, Challenger, Immortal and Radiant all round to 99% or 100%, and a
 * lifter climbing three whole ranks would watch the number not move. So the
 * closer to the ceiling, the more decimals, and above 99.95 the honest thing is
 * to stop claiming a percentile at all and name the slice instead.
 */
export function shareDigits(fraction) {
  const pct = fraction * 100;
  if (pct >= 99.9) return 2;
  if (pct >= 99) return 1;
  return 0;
}

/**
 * "Top 3%" — the same fact from the other end, for the lifter-relative number.
 *
 * Rounded to something a person would say out loud. Nobody says top 37.2%, and
 * a top-half number is better read as "top half" than as a decimal.
 */
export function topSlice(fraction) {
  const rest = (1 - fraction) * 100;
  if (rest >= 10) return Math.round(rest / 5) * 5;
  if (rest >= 1) return Math.round(rest);
  if (rest >= 0.1) return Math.round(rest * 10) / 10;
  return Math.max(0.01, Math.round(rest * 100) / 100);
}

/**
 * The step on the ladder a percentile answers for, so the two never disagree.
 *
 * Only used by the tests: it is the guard against somebody changing ANCHORS and
 * quietly moving what a rank is worth without noticing which rank moved.
 */
export function anchorTable() {
  return CURVE.map(([score, z]) => ({
    score,
    step: Math.round(score / (BAND / DIVISIONS.length)),
    z,
    ...percentiles(score),
  }));
}
