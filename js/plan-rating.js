// Plan quality rating, scored for muscle growth.
//
// Rebuilt in July 2026 against the current literature. What the review changed,
// and why — the old numbers were a reasonable 2019-era consensus that three
// recent papers have moved:
//
//   - The weekly-volume ceiling is gone. The old rating docked a plan hard past
//     26 sets per muscle per week. Pelland et al. found growth still rising at
//     the top of the studied range with no plateau — there is no evidence for a
//     set count where more volume starts costing you muscle. High volume now
//     gets an advisory note about recovery and adherence, not a deduction.
//   - Frequency dropped from 30% of the score to 10%. Once weekly volume is
//     held equal, frequency's own effect on hypertrophy is negligible. It still
//     earns its 10% because it is the lever that keeps any one session under
//     the point where extra sets stop paying.
//   - That point is now scored per muscle per session rather than per session
//     overall: roughly 11 fractional sets for one muscle in one workout
//     (Remmert et al.). A 30-set leg day is not the problem; 16 sets of quads
//     inside it is.
//   - Exercise selection is scored at all now, at 15%. Where the load lands on
//     the muscle is the one exercise-level variable with real evidence behind
//     it, and a plan built entirely from short-position movements is a worse
//     plan at identical volume.
//
// Counting convention: a set counts fully for the muscles it primarily trains
// and as half a set for the secondary ones. That is not a house style — the
// half-set method predicted the meta-analytic results better than counting
// indirect sets fully or ignoring them (SOURCES.pelland2026).

import { REGIONS } from './standards.js';
import { THRESHOLDS, SOURCES } from './evidence.js';
import { rateExercise } from './exercise-rating.js';
import { starString } from './ui.js';

export { starString };

/** Score weights. They sum to 1 and the UI shows every one of them. */
export const WEIGHTS = {
  volume:    0.35,
  coverage:  0.15,
  session:   0.15,
  selection: 0.15,
  variety:   0.10,
  frequency: 0.10,
};

export const WEIGHT_WHY = {
  volume: 'The single best-supported lever there is. More weekly sets, more growth, with diminishing returns.',
  coverage: 'A muscle you never train does not grow. Cheap to fix, so it is worth real weight.',
  session: 'Sets past roughly 11 for one muscle in one workout stop paying for themselves.',
  selection: 'Exercises that load a muscle stretched beat ones that only load it short.',
  variety: 'Muscles grow unevenly — two movements cover more of one than a single movement does.',
  frequency: 'Low weight on purpose: at equal weekly volume its own effect is negligible. It matters as the way you keep sessions from getting too big.',
};

/** Groups a hypertrophy plan is expected to cover. Forearms are trained indirectly. */
const MAJOR = [
  'chest', 'lats', 'traps', 'delts-front', 'delts-rear',
  'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs',
];

const PUSH = ['chest', 'delts-front', 'triceps'];
const PULL = ['lats', 'traps', 'delts-rear', 'biceps'];

const FLOOR = THRESHOLDS.weeklyFloor.value;          // 10
const STRONG = THRESHOLDS.weeklyStrong.value;        // 20
const UNCHARTED = THRESHOLDS.weeklyUncharted.value;  // 30
const PER_SESSION = THRESHOLDS.sessionPerMuscle.value; // 11
const INDIRECT = THRESHOLDS.indirectSetWeight.value;   // 0.5

/**
 * Weekly volume for one muscle, 0–1.
 *
 * Rises steeply to the 10-set floor, keeps rising to about 20, then flat. It
 * never turns back down, because no meta-analysis has found the point where it
 * should. See SOURCES.acsm2026 and SOURCES.pelland2026.
 */
export function volumeScore(v) {
  if (v <= 0) return 0;
  if (v < 4) return 0.25;
  if (v < FLOOR) return 0.4 + 0.4 * (v - 4) / (FLOOR - 4);
  if (v < STRONG) return 0.8 + 0.2 * (v - FLOOR) / (STRONG - FLOOR);
  return 1;
}

/** Fractional sets for one muscle inside one session, 0–1. SOURCES.remmert2025. */
export function sessionScore(m) {
  if (m <= PER_SESSION) return 1;
  if (m >= PER_SESSION + 9) return 0.4;
  return 1 - 0.6 * (m - PER_SESSION) / 9;
}

/**
 * @param plan      {days:[{name, items:[{exerciseId,targetSets,targetReps}]}]}
 * @param byId      Map exerciseId -> exercise
 * @param perWeek   how many times the whole plan runs per week (usually 1)
 */
export function analysePlan(plan, byId, perWeek = plan.perWeek || 1) {
  const volume = {};        // region -> weekly fractional sets
  const frequency = {};     // region -> sessions per week touching it
  const exercisesPer = {};  // region -> Set of exercise ids
  const peakSession = {};   // region -> most fractional sets in a single session
  const sessions = [];
  const repFlags = [];

  let totalSets = 0;
  let exerciseCount = 0;
  let starSum = 0;          // sets-weighted
  let longSets = 0;
  let shortSets = 0;
  let ratedSets = 0;

  for (const day of plan.days || []) {
    let daySets = 0;
    const touched = new Set();
    const inDay = {};

    for (const item of day.items || []) {
      const ex = byId.get(item.exerciseId);
      if (!ex) continue;
      const sets = Math.max(0, Number(item.targetSets) || 0);
      if (!sets) continue;

      exerciseCount++;
      daySets += sets;
      totalSets += sets;

      const rating = rateExercise(ex);
      if (rating) {
        starSum += rating.stars * sets;
        ratedSets += sets;
        if (rating.length.bias === 'long') longSets += sets;
        if (rating.length.bias === 'short') shortSets += sets;
      }

      const reps = repRange(item.targetReps);
      if (reps && (reps.low < THRESHOLDS.repWindow.low || reps.high > THRESHOLDS.repWindow.high)) {
        repFlags.push({ name: ex.name, reps: item.targetReps });
      }

      for (const r of ex.primary || []) {
        volume[r] = (volume[r] || 0) + sets;
        inDay[r] = (inDay[r] || 0) + sets;
        touched.add(r);
        (exercisesPer[r] = exercisesPer[r] || new Set()).add(item.exerciseId);
      }
      for (const r of ex.secondary || []) {
        volume[r] = (volume[r] || 0) + sets * INDIRECT;
        inDay[r] = (inDay[r] || 0) + sets * INDIRECT;
        touched.add(r);
      }
    }

    for (const r of touched) frequency[r] = (frequency[r] || 0) + 1;
    for (const [r, n] of Object.entries(inDay)) peakSession[r] = Math.max(peakSession[r] || 0, n);
    sessions.push({ name: day.name, sets: daySets });
  }

  // scale to a week — per-session figures deliberately stay per session
  for (const r of Object.keys(volume)) volume[r] *= perWeek;
  for (const r of Object.keys(frequency)) frequency[r] *= perWeek;

  const trained = MAJOR.filter((r) => (volume[r] || 0) >= 2);
  const untrained = MAJOR.filter((r) => (volume[r] || 0) < 2);

  // ---- volume (35%) ----
  const volScore = trained.length ? avg(trained.map((r) => volumeScore(volume[r] || 0))) : 0;

  // ---- coverage (15%) ----
  const coverScore = MAJOR.length ? trained.length / MAJOR.length : 0;

  // ---- session structure (15%) ----
  const sessScore = trained.length ? avg(trained.map((r) => sessionScore(peakSession[r] || 0))) : 0;

  // ---- exercise selection (15%) ----
  const meanStars = ratedSets ? starSum / ratedSets : 0;
  const longShare = totalSets ? longSets / totalSets : 0;
  const selScore = ratedSets ? 0.7 * ((meanStars - 1) / 4) + 0.3 * longShare : 0;

  // ---- variety (10%) ----
  const varScore = trained.length ? avg(trained.map((r) => {
    const n = (exercisesPer[r] || new Set()).size;
    if ((volume[r] || 0) < 6) return 0.7;   // too little volume for variety to matter
    if (n >= 3) return 1;
    if (n >= THRESHOLDS.exercisesPerMuscle.value) return 0.9;
    return 0.55;
  })) : 0;

  // ---- frequency (10%) ----
  const freqScore = trained.length ? avg(trained.map((r) => {
    const f = frequency[r] || 0;
    if (f >= THRESHOLDS.minFrequency.value) return 1;
    if (f >= 1.5) return 0.8;
    if (f >= 1) return 0.6;
    return 0.4;
  })) : 0;

  const parts = {
    volume: volScore, coverage: coverScore, session: sessScore,
    selection: selScore, variety: varScore, frequency: freqScore,
  };
  const score = Object.entries(parts).reduce((s, [k, v]) => s + v * WEIGHTS[k], 0);
  const stars = Math.max(0.5, Math.round(score * 5 * 2) / 2);

  const a = {
    stars, score, parts,
    volume, frequency, peakSession,
    exercisesPer: Object.fromEntries(Object.entries(exercisesPer).map(([k, v]) => [k, v.size])),
    sessions, totalSets: totalSets * perWeek, exerciseCount,
    trained, untrained, meanStars, longShare, shortSets, repFlags, perWeek,
  };
  return { ...a, ...verdict(a) };
}

/** Plain-language "what's good / what's missing". */
function verdict(a) {
  const good = [];
  const missing = [];
  const name = (r) => REGIONS[r] || r;

  // --- volume ---
  const atFloor = a.trained.filter((r) => a.volume[r] >= FLOOR);
  if (atFloor.length && atFloor.length === a.trained.length) {
    good.push(`Every muscle you train clears ${FLOOR} sets a week`);
  } else if (atFloor.length >= a.trained.length * 0.6) {
    good.push(`${atFloor.length} of ${a.trained.length} muscles clear the ${FLOOR}-set weekly floor`);
  }

  const under = a.trained.filter((r) => a.volume[r] < FLOOR);
  if (under.length) {
    missing.push(`Under ${FLOOR} sets a week: ${listOf(under.map((r) => `${name(r)} (${round(a.volume[r])})`))}`);
  }

  const high = a.trained.filter((r) => a.volume[r] > UNCHARTED);
  if (high.length) {
    missing.push(`Over ${UNCHARTED} sets a week on ${listOf(high.map(name))} — not scored against you, the research finds no ceiling, but that is past where the studies can guide you. Judge it by whether you recover.`);
  }

  // --- per-session load ---
  const crowded = a.trained
    .filter((r) => (a.peakSession[r] || 0) > PER_SESSION)
    .sort((x, y) => a.peakSession[y] - a.peakSession[x]);
  if (crowded.length) {
    missing.push(`${listOf(crowded.map((r) => `${name(r)} (${round(a.peakSession[r])} sets in one session)`))} — past about ${PER_SESSION} sets for one muscle in one workout the extra sets stop paying. Move some to another day.`);
  } else if (a.trained.length) {
    good.push(`No muscle gets more than ${PER_SESSION} sets in a single session`);
  }

  // --- coverage ---
  if (a.untrained.length) missing.push(`Not trained at all: ${a.untrained.map(name).join(', ')}`);
  else if (a.trained.length) good.push('No major muscle group is left out');

  // --- frequency ---
  const once = a.trained.filter((r) => (a.frequency[r] || 0) < THRESHOLDS.minFrequency.value);
  if (once.length) {
    missing.push(`Only once a week: ${listOf(once.map(name))} — at equal weekly volume that costs little growth, but it forces bigger single sessions`);
  } else if (a.trained.length) {
    good.push('Every muscle you train is hit at least twice a week');
  }

  // --- exercise selection ---
  if (a.longShare >= 0.5) {
    good.push(`${Math.round(a.longShare * 100)}% of your sets load the muscle at a long length — the selection is doing work for you`);
  } else if (a.exerciseCount && a.longShare < 0.3) {
    missing.push(`Only ${Math.round(a.longShare * 100)}% of sets load a muscle stretched. Swapping a few short-position movements (pushdowns, hip thrusts, lateral raises) for stretched ones (overhead extensions, deep split squats, incline curls) is free growth at the same volume.`);
  }
  if (a.meanStars >= 3.75) good.push(`Exercise selection averages ${a.meanStars.toFixed(1)} stars`);
  else if (a.exerciseCount && a.meanStars < 2.75) {
    missing.push(`Exercise selection averages only ${a.meanStars.toFixed(1)} stars — open a few in the Library to see what is dragging them down`);
  }

  // --- variety ---
  const single = a.trained.filter((r) => (a.exercisesPer[r] || 0) === 1 && a.volume[r] >= 8);
  if (single.length) {
    missing.push(`All ${listOf(single.map(name))} volume comes from one movement — muscles grow unevenly, so a second angle covers more of it`);
  }

  // --- rep targets ---
  if (a.repFlags.length) {
    missing.push(`Rep targets outside ${THRESHOLDS.repWindow.low}–${THRESHOLDS.repWindow.high} on ${listOf(a.repFlags.map((f) => `${f.name} (${f.reps})`))} — anything inside that window grows muscle if the set is taken close to failure, outside it you are training something else`);
  }

  // --- balance (practice, not evidence) ---
  const push = sum(PUSH.map((r) => a.volume[r] || 0));
  const pull = sum(PULL.map((r) => a.volume[r] || 0));
  if (push > 0 && pull > 0) {
    if (pull < push * 0.8) missing.push('More pushing than pulling volume — the reverse is kinder to your shoulders');
    else good.push('Pushing and pulling volume are balanced');
  }

  return { good, missing };
}

/** '8-12' / '10' / '6–10' -> {low, high} */
function repRange(spec) {
  if (!spec) return null;
  const nums = String(spec).match(/\d+/g);
  if (!nums || !nums.length) return null;
  const ns = nums.map(Number);
  return { low: Math.min(...ns), high: Math.max(...ns) };
}

const listOf = (xs) => xs.slice(0, 4).join(', ') + (xs.length > 4 ? `, +${xs.length - 4} more` : '');
const round = (n) => Math.round(n * 10) / 10;
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export const PLAN_SOURCES = [
  SOURCES.acsm2026, SOURCES.pelland2026, SOURCES.remmert2025,
  SOURCES.wolf2025, SOURCES.variation2024,
];
