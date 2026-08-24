// Trends over time: how much you moved, how strong you got, and which lifts are
// actually going somewhere.
//
// The app already charted a single exercise well. What it could not answer was
// the question people actually ask after a few months — "am I getting stronger?"
// — because the strength rating was only ever computed for *today*, from
// best-ever lifts. Recomputing it week by week turns a snapshot into a line.
//
// Everything here is derived from the session log on the fly. Nothing is stored:
// a cached trend would go stale the moment a session is edited or deleted, and
// the recompute is cheap at personal-log sizes.

import { startOfWeek, isCounted, e1rm, entryStats, linearFit, withinE1rmWindow } from './models.js';
import {
  buildRating, hasProfile, ratedMachineNames, isRateable, regionsFromExercises,
} from './standards.js';

// Only for durations and lookback windows, never for a week boundary: a week
// containing a clock change is not this long. Anything that decides which week
// a timestamp belongs to steps by calendar days instead.
const WEEK = 7 * 86400000;
const BODYWEIGHT_LIFTS = new Set(['Pull-Up', 'Chin-Up', 'Dip']);

/**
 * The in-window bests, topped up with out-of-window ones for lifts that have
 * nothing else, carrying the same `extrapolated` marker buildRating expects.
 */
function withFallbacks(best, outside) {
  const merged = new Map(best);
  const extrapolated = new Set();
  for (const [name, est] of outside) {
    if (merged.has(name)) continue;
    merged.set(name, est);
    extrapolated.add(name);
  }
  merged.extrapolated = extrapolated;
  return merged;
}

function historicalE1rm(name, set, bodyweight) {
  if (!BODYWEIGHT_LIFTS.has(name)) return e1rm(set.weight, set.reps);
  const added = Number(set.weight) || 0;
  if (!(bodyweight > 0) || (added > 0 && set.loadMode !== 'added')) return 0;
  return e1rm(bodyweight + added, set.reps);
}

/** Week-start timestamps, oldest first, stepping by calendar days for DST. */
function weekStarts(count, endTs = Date.now()) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(startOfWeek(endTs));
    d.setDate(d.getDate() - i * 7);
    out.push(startOfWeek(d.getTime()));
  }
  return out;
}

/**
 * Total work moved, per week.
 *
 * Tonnage is weight x reps summed over every working set. It is a blunt measure
 * — it rewards high reps on light weight and says nothing about effort — but it
 * is the honest answer to "how much did I actually shift this week", and it is
 * the number that visibly climbs long before a 1RM does.
 */
export function tonnageHistory(sessions, weeks = 12, endTs = Date.now()) {
  const buckets = weekStarts(weeks, endTs).map((week) => ({
    week, tonnage: 0, sets: 0, reps: 0, workouts: 0,
  }));
  const index = new Map(buckets.map((b) => [b.week, b]));

  for (const s of sessions) {
    if (!s.finishedAt) continue;
    const b = index.get(startOfWeek(s.startedAt));
    if (!b) continue;
    b.workouts++;
    for (const entry of s.entries || []) {
      const st = entryStats(entry);
      b.tonnage += st.volume;
      b.sets += st.sets;
      b.reps += st.reps;
    }
  }
  return buckets;
}

/**
 * The overall strength score, recomputed for each week as it stood *then*.
 *
 * Two details that decide whether the line means anything:
 *
 *  - Best-e1RM-so-far is cumulative. A week where you did not touch the bench
 *    does not drop your bench score; strength you have shown does not evaporate
 *    because you took a week off.
 *  - Bodyweight is the entry from that week, not today's. The score is relative
 *    to bodyweight, so holding today's weight fixed would rewrite history every
 *    time the scale moves — a bulk would retroactively make you look weaker in
 *    March.
 *
 * @returns [{ week, score, tier, lifts }] for weeks with enough data, or []
 */
export function strengthHistory(sessions, bodyweightLog, profile, exerciseById, weeks = 16,
  endTs = Date.now(), corrections = {}) {
  if (!hasProfile(profile)) return [];

  const finished = sessions
    .filter((s) => s.finishedAt)
    .sort((a, b) => a.startedAt - b.startedAt);
  if (!finished.length) return [];

  const bw = [...(bodyweightLog || [])].sort((a, b) => a.date - b.date);
  const best = new Map();          // lift name -> best e1RM so far, inside the window
  const outside = new Map();       // and the fallback for lifts never trained in it
  const machineNames = ratedMachineNames([...exerciseById.values()]);
  const regionsByName = regionsFromExercises([...exerciseById.values()]);
  let cursor = 0;                  // how far through `finished` we have walked

  const out = [];
  for (const week of weekStarts(weeks, endTs)) {
    // Stepped by calendar days, not by a fixed WEEK of milliseconds. A week
    // containing a clock change is 167 or 169 hours long, so the fixed version
    // put this boundary an hour into the Monday and folded that first hour of
    // the next week into this week's score, twice a year.
    const nextWeek = new Date(week);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const cutoff = nextWeek.getTime();

    // Walk forward only — the cumulative max never needs revisiting.
    while (cursor < finished.length && finished[cursor].startedAt < cutoff) {
      const s = finished[cursor++];
      const sessionBodyweight = bodyweightAt(bw, s.startedAt) ?? profile.bodyweight;
      for (const entry of s.entries || []) {
        const ex = exerciseById.get(entry.exerciseId);
        const name = ex ? ex.name : null;
        if (!isRateable(name, machineNames)) continue;
        for (const set of (entry.sets || []).filter(isCounted)) {
          const est = historicalE1rm(name, set, sessionBodyweight);
          // Same window rule as bestOneRepMaxByName, so the line on Progress and
          // the number on Home cannot be built from different sets.
          const target = withinE1rmWindow(set) ? best : outside;
          if (est > (target.get(name) || 0)) target.set(name, est);
        }
      }
    }

    const merged = withFallbacks(best, outside);
    if (!merged.size) continue;
    const rating = buildRating(merged, {
      ...profile,
      bodyweight: bodyweightAt(bw, cutoff) ?? profile.bodyweight,
    }, { machineNames, regionsByName, ...corrections });
    if (rating.overall === null) continue;
    out.push({ week, score: rating.overall, tier: rating.overallTier, lifts: rating.lifts.length });
  }

  // A single point is not a trend, and drawing one implies more than it says.
  return out.length >= 2 ? out : [];
}

/**
 * The full rating as it stood at one moment, or null when it cannot be built.
 *
 * Same two rules as strengthHistory above — cumulative best e1RM, bodyweight as
 * it was then — for callers that want a single point rather than a line. The
 * week card uses it twice, at both ends of a week, to say what the week changed.
 * Kept separate rather than folded into strengthHistory: that function walks the
 * log once for sixteen weeks, and rewriting it to call this one would turn one
 * pass into sixteen for no gain.
 */
export function strengthAt(sessions, bodyweightLog, profile, exerciseById, at = Date.now(),
  corrections = {}) {
  if (!hasProfile(profile)) return null;

  const best = new Map();
  const outside = new Map();
  const machineNames = ratedMachineNames([...exerciseById.values()]);
  const regionsByName = regionsFromExercises([...exerciseById.values()]);
  const bw = [...(bodyweightLog || [])].sort((a, b) => a.date - b.date);
  for (const s of sessions) {
    if (!s.finishedAt || s.startedAt > at) continue;
    for (const entry of s.entries || []) {
      const ex = exerciseById.get(entry.exerciseId);
      if (!isRateable(ex?.name, machineNames)) continue;
      for (const set of (entry.sets || []).filter(isCounted)) {
        const sessionBodyweight = bodyweightAt(bw, s.startedAt) ?? profile.bodyweight;
        const est = historicalE1rm(ex.name, set, sessionBodyweight);
        const target = withinE1rmWindow(set) ? best : outside;
        if (est > (target.get(ex.name) || 0)) target.set(ex.name, est);
      }
    }
  }
  const merged = withFallbacks(best, outside);
  if (!merged.size) return null;

  const rating = buildRating(merged, {
    ...profile,
    bodyweight: bodyweightAt(bw, at) ?? profile.bodyweight,
  }, { machineNames, regionsByName, ...corrections });
  return rating.overall === null ? null : rating;
}

/** Bodyweight as recorded on or before a moment, or null before the first entry. */
export function bodyweightAt(sorted, ts) {
  let value = null;
  for (const b of sorted) {
    if (b.date > ts) break;
    value = b.weight;
  }
  return value;
}

/**
 * Which lifts are moving and which have stalled.
 *
 * Fitted on estimated 1RM rather than top weight, so a session where you added
 * reps instead of plates still counts as progress. Three sessions is the floor —
 * a line through two points is not a trend, it is a line through two points.
 */
export function movers(sessions, exerciseById, { minSessions = 3, sinceWeeks = 12 } = {}) {
  const since = Date.now() - sinceWeeks * WEEK;
  const byExercise = new Map();

  for (const s of sessions) {
    if (!s.finishedAt || s.startedAt < since) continue;
    for (const entry of s.entries || []) {
      const st = entryStats(entry);
      if (!st.sets || !st.e1rm) continue;
      if (!byExercise.has(entry.exerciseId)) byExercise.set(entry.exerciseId, []);
      byExercise.get(entry.exerciseId).push({ t: s.startedAt, y: st.e1rm });
    }
  }

  const out = [];
  for (const [id, pointsRaw] of byExercise) {
    const ex = exerciseById.get(id);
    if (!ex) continue;
    const points = pointsRaw.sort((a, b) => a.t - b.t);
    if (points.length < minSessions) continue;

    const t0 = points[0].t;
    const fit = linearFit(points.map((p) => [(p.t - t0) / WEEK, p.y]));
    if (!fit) continue;

    const first = points[0].y;
    const last = points[points.length - 1].y;
    const spanWeeks = Math.max(1, (points[points.length - 1].t - t0) / WEEK);

    out.push({
      ex,
      sessions: points.length,
      first, last,
      perWeek: fit.slope,                       // kg of e1RM per week
      pctTotal: first > 0 ? ((last - first) / first) * 100 : 0,
      spanWeeks: Math.round(spanWeeks),
    });
  }

  return out.sort((a, b) => b.perWeek - a.perWeek);
}
