// Plan quality rating, tuned for hypertrophy.
//
// Scored against the volume/frequency literature rather than taste, but the
// thresholds are a defensible consensus, not settled fact — the UI says so.
//
// What it rewards, in weight order:
//   frequency (30%)  each muscle trained 2x+ per week beats the same volume in
//                    one session
//   volume    (30%)  10-20 hard sets per muscle per week; below is undertraining,
//                    far above is fatigue you can't recover from
//   spread    (15%)  many exercises x few sets beats few exercises x many sets —
//                    more of the muscle's regions get loaded, less junk volume
//   coverage  (15%)  no major muscle group left untrained
//   recovery  (10%)  sessions that aren't so long that the last sets are wasted
//
// Secondary muscles count as half a set, the usual "fractional volume"
// convention: a row does train the biceps, just not as much as a curl does.

import { REGIONS } from './standards.js';

export const WEEKLY_SETS = { low: 10, high: 20, hardCeiling: 26 };
export const SESSION_SET_CEILING = 24;

/** Groups a hypertrophy plan is expected to cover. Forearms are trained indirectly. */
const MAJOR = [
  'chest', 'lats', 'traps', 'delts-front', 'delts-rear',
  'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs',
];

/**
 * Per-muscle floor. Small muscles that also pick up a lot of indirect work don't
 * need a big compound's set count — holding rear delts to the same 10-set floor
 * as chest just inflates plans instead of improving them.
 */
const LOW_FLOOR = new Set(['delts-rear', 'traps', 'abs', 'calves', 'biceps', 'triceps']);
const floorFor = (region) => (LOW_FLOOR.has(region) ? 8 : WEEKLY_SETS.low);

const PUSH = ['chest', 'delts-front', 'triceps'];
const PULL = ['lats', 'traps', 'delts-rear', 'biceps'];

/**
 * @param plan      {days:[{name, items:[{exerciseId,targetSets}]}]}
 * @param byId      Map exerciseId -> exercise
 * @param perWeek   how many times the whole plan runs per week (usually 1)
 */
export function analysePlan(plan, byId, perWeek = plan.perWeek || 1) {
  const volume = {};       // region -> weekly fractional sets
  const frequency = {};    // region -> sessions per week touching it
  const exercisesPer = {}; // region -> Set of exercise ids
  const sessions = [];
  let totalSets = 0;
  let maxSetsPerExercise = 0;
  let exerciseCount = 0;

  for (const day of plan.days || []) {
    let daySets = 0;
    const touched = new Set();

    for (const item of day.items || []) {
      const ex = byId.get(item.exerciseId);
      if (!ex) continue;
      const sets = Math.max(0, Number(item.targetSets) || 0);
      if (!sets) continue;

      exerciseCount++;
      daySets += sets;
      totalSets += sets;
      maxSetsPerExercise = Math.max(maxSetsPerExercise, sets);

      for (const r of ex.primary || []) {
        volume[r] = (volume[r] || 0) + sets;
        touched.add(r);
        (exercisesPer[r] = exercisesPer[r] || new Set()).add(item.exerciseId);
      }
      for (const r of ex.secondary || []) {
        volume[r] = (volume[r] || 0) + sets * 0.5;
        touched.add(r);
      }
    }

    for (const r of touched) frequency[r] = (frequency[r] || 0) + 1;
    sessions.push({ name: day.name, sets: daySets });
  }

  // scale to a week
  for (const r of Object.keys(volume)) volume[r] *= perWeek;
  for (const r of Object.keys(frequency)) frequency[r] *= perWeek;

  const trained = MAJOR.filter((r) => (volume[r] || 0) >= 2);
  const untrained = MAJOR.filter((r) => (volume[r] || 0) < 2);

  // ---- frequency (0-1) ----
  const freqScores = trained.map((r) => {
    const f = frequency[r] || 0;
    if (f >= 2) return 1;
    if (f >= 1.5) return 0.75;
    return 0.4;               // once a week: works, but leaves growth on the table
  });
  const freqScore = freqScores.length ? avg(freqScores) : 0;

  // ---- volume (0-1) ----
  const volScores = trained.map((r) => {
    const v = volume[r] || 0;
    if (v >= floorFor(r) && v <= WEEKLY_SETS.high) return 1;
    if (v > WEEKLY_SETS.hardCeiling) return 0.25;   // beyond what you recover from
    if (v > WEEKLY_SETS.high) return 0.7;
    if (v >= floorFor(r) - 4) return 0.6;
    return 0.3;
  });
  const volScore = volScores.length ? avg(volScores) : 0;

  // ---- spread: exercises per muscle, and sets per exercise ----
  const spreadScores = trained.map((r) => {
    const n = (exercisesPer[r] || new Set()).size;
    const v = volume[r] || 0;
    if (v < 6) return 0.5;
    if (n >= 3) return 1;
    if (n === 2) return 0.75;
    return 0.4;               // all of a muscle's volume from one movement
  });
  let spreadScore = spreadScores.length ? avg(spreadScores) : 0;
  if (maxSetsPerExercise >= 4) spreadScore *= 0.7;
  else if (maxSetsPerExercise === 3) spreadScore *= 0.9;

  // ---- coverage (0-1) ----
  const coverScore = MAJOR.length ? trained.length / MAJOR.length : 0;

  // ---- recovery (0-1) ----
  const worstSession = Math.max(0, ...sessions.map((s) => s.sets));
  let recoveryScore = 1;
  if (worstSession > SESSION_SET_CEILING) recoveryScore = 0.5;
  else if (worstSession > SESSION_SET_CEILING - 6) recoveryScore = 0.8;
  const weeklyTotal = totalSets * perWeek;
  if (weeklyTotal > 110) recoveryScore = Math.min(recoveryScore, 0.5);

  const score =
    freqScore * 0.30 + volScore * 0.30 + spreadScore * 0.15 +
    coverScore * 0.15 + recoveryScore * 0.10;

  const stars = Math.max(0.5, Math.round(score * 5 * 2) / 2);

  return {
    stars, score,
    volume, frequency,
    exercisesPer: Object.fromEntries(Object.entries(exercisesPer).map(([k, v]) => [k, v.size])),
    sessions, totalSets: weeklyTotal, exerciseCount, maxSetsPerExercise,
    trained, untrained,
    parts: { frequency: freqScore, volume: volScore, spread: spreadScore, coverage: coverScore, recovery: recoveryScore },
    ...verdict({ volume, frequency, exercisesPer, untrained, maxSetsPerExercise, sessions, weeklyTotal, trained }),
  };
}

/** Plain-language "what's good / what's missing". */
function verdict(a) {
  const good = [];
  const missing = [];
  const name = (r) => REGIONS[r] || r;

  const twice = a.trained.filter((r) => (a.frequency[r] || 0) >= 2);
  if (twice.length && twice.length === a.trained.length) {
    good.push('Every muscle you train gets hit at least twice a week');
  } else if (twice.length >= a.trained.length * 0.6) {
    good.push(`${twice.length} of ${a.trained.length} muscles are trained 2x a week`);
  }
  const once = a.trained.filter((r) => (a.frequency[r] || 0) < 2);
  if (once.length) {
    missing.push(`Only once a week: ${once.slice(0, 4).map(name).join(', ')}${once.length > 4 ? '…' : ''} — splitting those sets over two days would grow them faster`);
  }

  const inRange = a.trained.filter((r) => a.volume[r] >= floorFor(r) && a.volume[r] <= WEEKLY_SETS.high);
  if (inRange.length >= a.trained.length * 0.7) good.push(`Weekly volume is in range for ${inRange.length} muscle groups`);

  const under = a.trained.filter((r) => a.volume[r] < floorFor(r));
  if (under.length) {
    missing.push(`Below the weekly target: ${under.slice(0, 4).map((r) => `${name(r)} (${Math.round(a.volume[r])}/${floorFor(r)})`).join(', ')}${under.length > 4 ? '…' : ''}`);
  }

  const over = a.trained.filter((r) => a.volume[r] > WEEKLY_SETS.hardCeiling);
  if (over.length) missing.push(`Over ${WEEKLY_SETS.hardCeiling} sets a week: ${over.map(name).join(', ')} — that is more than most people recover from`);

  if (a.untrained.length) {
    missing.push(`Not trained at all: ${a.untrained.map(name).join(', ')}`);
  } else {
    good.push('No major muscle group is left out');
  }

  if (a.maxSetsPerExercise <= 2) good.push('Never more than 2 sets per exercise — spread across movements rather than piled onto one');
  else if (a.maxSetsPerExercise >= 4) missing.push(`Up to ${a.maxSetsPerExercise} sets on a single exercise — 2 sets across more exercises covers the muscle better`);

  const single = a.trained.filter((r) => (a.exercisesPer[r] || new Set()).size === 1 && a.volume[r] >= 8);
  if (single.length) missing.push(`All ${single.map(name).join(' / ')} volume comes from one exercise — add a second angle`);

  const worst = Math.max(0, ...a.sessions.map((s) => s.sets));
  if (worst > SESSION_SET_CEILING) {
    const s = a.sessions.find((x) => x.sets === worst);
    missing.push(`${s.name} is ${worst} sets — long enough that the last ones add fatigue more than stimulus`);
  } else if (worst && worst <= 18) {
    good.push(`Sessions stay short (max ${worst} sets)`);
  }

  const push = sum(PUSH.map((r) => a.volume[r] || 0));
  const pull = sum(PULL.map((r) => a.volume[r] || 0));
  if (push > 0 && pull > 0) {
    if (pull < push * 0.8) missing.push('More pushing than pulling volume — the reverse is kinder to your shoulders');
    else good.push('Pushing and pulling volume are balanced');
  }

  return { good, missing };
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export function starString(stars) {
  const full = Math.floor(stars);
  const half = stars - full >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
}
