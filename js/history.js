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

import { startOfWeek, isCounted, e1rm, entryStats, linearFit } from './models.js';
import { buildRating, isBenchmark, hasProfile } from './standards.js';

const WEEK = 7 * 86400000;

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
export function tonnageHistory(sessions, weeks = 12) {
  const buckets = weekStarts(weeks).map((week) => ({
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
export function strengthHistory(sessions, bodyweightLog, profile, exerciseById, weeks = 16) {
  if (!hasProfile(profile)) return [];

  const finished = sessions
    .filter((s) => s.finishedAt)
    .sort((a, b) => a.startedAt - b.startedAt);
  if (!finished.length) return [];

  const bw = [...(bodyweightLog || [])].sort((a, b) => a.date - b.date);
  const best = new Map();          // lift name -> best e1RM so far
  let cursor = 0;                  // how far through `finished` we have walked

  const out = [];
  for (const week of weekStarts(weeks)) {
    const cutoff = week + WEEK;

    // Walk forward only — the cumulative max never needs revisiting.
    while (cursor < finished.length && finished[cursor].startedAt < cutoff) {
      const s = finished[cursor++];
      for (const entry of s.entries || []) {
        const ex = exerciseById.get(entry.exerciseId);
        const name = ex ? ex.name : null;
        if (!name || !isBenchmark(name)) continue;
        for (const set of (entry.sets || []).filter(isCounted)) {
          const est = e1rm(set.weight, set.reps);
          if (est > (best.get(name) || 0)) best.set(name, est);
        }
      }
    }

    if (!best.size) continue;
    const rating = buildRating(new Map(best), {
      ...profile,
      bodyweight: bodyweightAt(bw, cutoff) ?? profile.bodyweight,
    });
    if (rating.overall === null) continue;
    out.push({ week, score: rating.overall, tier: rating.overallTier, lifts: rating.lifts.length });
  }

  // A single point is not a trend, and drawing one implies more than it says.
  return out.length >= 2 ? out : [];
}

/** Bodyweight as recorded on or before a moment, or null before the first entry. */
function bodyweightAt(sorted, ts) {
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
