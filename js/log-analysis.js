// What you actually trained, counted exactly the way a plan is counted.
//
// The Workload chart on Home used to count raw working sets against the coarse
// muscle labels ("Chest", "Back"), while the plan rating counted fractional sets
// across the 15 body-map regions. Two different numbers for the same thing: the
// plan would say "Lats 12" and the chart would say "Back 8", and nothing in the
// app admitted they were measuring differently. Everything here uses the plan's
// convention — primary muscles get the full set, secondary muscles half of one
// (SOURCES.pelland2026) — so "planned" and "done" are finally comparable.

import { startOfWeek, isCounted } from './models.js';
import { rateExercise } from './exercise-rating.js';
import { THRESHOLDS } from './evidence.js';

const INDIRECT = THRESHOLDS.indirectSetWeight.value;

/**
 * One week of finished sessions.
 *
 * @param sessions  all sessions, any order
 * @param byId      Map exerciseId -> exercise
 * @param weekStart ms timestamp of the Monday to report on
 */
export function analyseWeek(sessions, byId, weekStart = startOfWeek(Date.now())) {
  const volume = {};       // region -> fractional sets
  const frequency = {};    // region -> sessions touching it
  const peakSession = {};  // region -> most fractional sets in one session
  let totalSets = 0;
  let longSets = 0;
  let workouts = 0;

  // Effort. Counted over working sets only — a warm-up with 8 in reserve is not
  // a data point about how hard you trained.
  let rirLogged = 0;
  let rirHard = 0;     // 0-2 reps in reserve
  let rirSum = 0;

  for (const s of sessions) {
    if (!s.finishedAt) continue;
    if (startOfWeek(s.startedAt) !== weekStart) continue;
    workouts++;

    const inDay = {};
    const touched = new Set();

    for (const entry of s.entries || []) {
      const ex = byId.get(entry.exerciseId);
      if (!ex) continue;
      const counted = (entry.sets || []).filter(isCounted);
      if (!counted.length) continue;

      totalSets += counted.length;
      const rating = rateExercise(ex);
      if (rating && rating.length.bias === 'long') longSets += counted.length;

      for (const set of counted) {
        if (set.rir === null || set.rir === undefined) continue;
        rirLogged++;
        rirSum += Number(set.rir);
        if (Number(set.rir) <= 2) rirHard++;
      }

      for (const r of ex.primary || []) {
        volume[r] = (volume[r] || 0) + counted.length;
        inDay[r] = (inDay[r] || 0) + counted.length;
        touched.add(r);
      }
      for (const r of ex.secondary || []) {
        volume[r] = (volume[r] || 0) + counted.length * INDIRECT;
        inDay[r] = (inDay[r] || 0) + counted.length * INDIRECT;
        touched.add(r);
      }
    }

    for (const r of touched) frequency[r] = (frequency[r] || 0) + 1;
    for (const [r, n] of Object.entries(inDay)) peakSession[r] = Math.max(peakSession[r] || 0, n);
  }

  return {
    weekStart, workouts, volume, frequency, peakSession, totalSets,
    longShare: totalSets ? longSets / totalSets : 0,
    effort: {
      logged: rirLogged,
      total: totalSets,
      mean: rirLogged ? rirSum / rirLogged : null,
      hardShare: rirLogged ? rirHard / rirLogged : null,
    },
  };
}

/**
 * Done versus planned, per muscle. `plan` is an analysePlan() result, or null
 * when there is no active plan — then the ACSM weekly floor is the target.
 *
 * @returns rows sorted worst-shortfall first
 */
export function compareToPlan(week, plan) {
  const floor = THRESHOLDS.weeklyFloor.value;
  const regions = new Set([
    ...Object.keys(week.volume),
    ...(plan ? Object.keys(plan.volume) : []),
  ]);

  const rows = [];
  for (const r of regions) {
    const done = week.volume[r] || 0;
    const target = plan ? (plan.volume[r] || 0) : floor;
    // Muscles neither trained nor planned are noise, not a shortfall.
    if (!done && !target) continue;
    rows.push({
      region: r,
      done: Math.round(done * 10) / 10,
      target: Math.round(target * 10) / 10,
      ratio: target > 0 ? done / target : 1,
      short: target > 0 ? Math.max(0, target - done) : 0,
    });
  }
  return rows.sort((a, b) => b.short - a.short || b.done - a.done);
}

/**
 * Consecutive weeks, ending at `at`, with at least one finished workout.
 *
 * The week containing `at` is allowed to be empty without breaking the run —
 * without that grace every streak reads 0 until the first session of the week,
 * which is exactly when you least want to be told you have none.
 *
 * Stepping back with setDate rather than subtracting 7 x 86400000: across a DST
 * change a fixed-millisecond week lands an hour off midnight, the key stops
 * matching startOfWeek(), and the streak silently collapses to 1 twice a year.
 * The weekly charts were fixed for this; the two copies of this function on Home
 * and Progress were not, which is why there is now one copy here.
 */
export function weekStreak(sessions, at = Date.now()) {
  const weeks = new Set(
    sessions.filter((s) => s.finishedAt).map((s) => startOfWeek(s.startedAt))
  );
  let cursor = startOfWeek(at);
  if (!weeks.has(cursor)) cursor = previousWeek(cursor);
  let n = 0;
  while (weeks.has(cursor)) { n++; cursor = previousWeek(cursor); }
  return n;
}

function previousWeek(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() - 7);
  return startOfWeek(d.getTime());
}

/**
 * Is the week on track *so far*?
 *
 * Judging Tuesday against a full week's target would mark every week red until
 * Sunday, which is a scoreboard nobody reads twice. Progress is measured against
 * how much of the plan you have got through: two of five days done means you are
 * expected to be about 40% of the way there.
 *
 * @param plannedDays how many sessions the active plan has, or 0 without one
 */
export function weekVerdict(week, rows, plannedDays = 0) {
  if (!week.workouts) return { headline: 'Nothing logged this week yet', tone: 'faint', behind: [], pace: 0 };

  const daysIn = Math.min(7, Math.floor((Date.now() - week.weekStart) / 86400000) + 1);
  const pace = plannedDays
    ? Math.min(1, week.workouts / plannedDays)
    : Math.min(1, daysIn / 7);

  const withTarget = rows.filter((r) => r.target > 0);
  const onTrack = withTarget.filter((r) => r.ratio >= pace * 0.9);
  const behind = withTarget.filter((r) => r.ratio < pace * 0.7);

  const done = pace >= 1;
  return {
    headline: withTarget.length
      ? done
        ? `${withTarget.filter((r) => r.ratio >= 1).length} of ${withTarget.length} muscles hit this week's target`
        // Without a plan there is no session count to be part-way through, and
        // "2 of ? sessions in" reads like a bug — say only what is known.
        : plannedDays
          ? `${onTrack.length} of ${withTarget.length} muscles are on pace — ${week.workouts} of ${plannedDays} sessions in`
          : `${onTrack.length} of ${withTarget.length} muscles are on pace`
      : `${week.totalSets} sets logged`,
    tone: behind.length > withTarget.length * 0.4 ? 'warn' : 'good',
    behind,
    pace,
  };
}
