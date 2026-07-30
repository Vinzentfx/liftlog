// Per-muscle progression, from your own numbers.
//
// This exists because of a question the strength rating cannot answer: what if
// you train on machines?
//
// The tiers compare you against published standards, and those only exist for
// about seventeen barbell and bodyweight lifts. There is no standard for a
// machine chest press, and there cannot be a useful one — a "100 kg" press on
// one manufacturer's frame is not 100 kg on another, because the lever arms,
// the sled weight and the starting resistance all differ. Inventing a tier for
// it would be a number with nothing behind it.
//
// So this module answers the other half of the question instead. "Am I strong
// compared to other people" needs standards. "Am I getting stronger" does not —
// it only needs you, last month. That comparison is valid on any equipment,
// which makes it exactly the right signal for someone training in a machine
// gym, and it means every exercise you log counts toward it rather than only
// the seventeen.

import { entryStats, linearFit } from './models.js';
import { REGIONS } from './standards.js';

const WEEK = 7 * 86400000;

/** Minimum sessions on one exercise before its slope means anything. */
const MIN_SESSIONS = 3;

/**
 * Estimated-1RM trend per body-map region.
 *
 * Fitted on e1RM rather than top weight so that adding reps counts as progress
 * — which matters more here than on the strength card, because machine users
 * often progress in reps between the stack's coarse weight steps.
 *
 * `now` ends the window. It exists for the week card: a card about last week
 * must not be able to see sessions logged since, or re-opening it next month
 * would quietly change what it said.
 *
 * @returns {Object<string, {state, pctPerWeek, exercises, sessions, best}>}
 */
export function regionProgress(sessions, exerciseById, { weeks = 12, now = Date.now() } = {}) {
  const since = now - weeks * WEEK;

  // exerciseId -> [{t, e1rm}]
  const series = new Map();
  for (const s of sessions) {
    if (!s.finishedAt || s.startedAt < since || s.startedAt > now) continue;
    for (const entry of s.entries || []) {
      const st = entryStats(entry);
      if (!st.sets || !st.e1rm) continue;
      if (!series.has(entry.exerciseId)) series.set(entry.exerciseId, []);
      series.get(entry.exerciseId).push({ t: s.startedAt, y: st.e1rm });
    }
  }

  // region -> contributions
  const acc = {};
  const touch = (region) => (acc[region] = acc[region] || { weighted: 0, weight: 0, exercises: 0, sessions: 0, best: null, thin: 0 });

  for (const [id, raw] of series) {
    const ex = exerciseById.get(id);
    if (!ex) continue;
    const points = raw.sort((a, b) => a.t - b.t);

    // A region is "trained" as soon as you log it, even once — the map should
    // show that. Whether it is *progressing* needs more than one data point.
    const regions = [
      ...(ex.primary || []).map((r) => [r, 1]),
      ...(ex.secondary || []).map((r) => [r, 0.5]),
    ];
    if (points.length < MIN_SESSIONS) {
      for (const [r] of regions) { touch(r).thin++; touch(r).sessions += points.length; }
      continue;
    }

    const t0 = points[0].t;
    const fit = linearFit(points.map((p) => [(p.t - t0) / WEEK, p.y]));
    if (!fit) continue;
    const first = points[0].y;
    if (!first) continue;
    const pctPerWeek = (fit.slope / first) * 100;

    for (const [r, w] of regions) {
      const a = touch(r);
      a.weighted += pctPerWeek * w;
      a.weight += w;
      a.exercises++;
      a.sessions += points.length;
      if (!a.best || pctPerWeek > a.best.pctPerWeek) {
        a.best = { name: ex.name, pctPerWeek, from: first, to: points[points.length - 1].y };
      }
    }
  }

  const out = {};
  for (const [region, a] of Object.entries(acc)) {
    if (!a.weight) {
      // Logged, but never enough sessions on one movement to fit a line.
      out[region] = { state: 'thin', pctPerWeek: null, exercises: 0, sessions: a.sessions, best: null };
      continue;
    }
    const pct = a.weighted / a.weight;
    out[region] = {
      state: pct > 0.3 ? 'climbing' : pct < -0.3 ? 'falling' : 'flat',
      pctPerWeek: pct,
      exercises: a.exercises,
      sessions: a.sessions,
      best: a.best,
    };
  }
  return out;
}

/**
 * Map the progression states onto the body map's five colour steps.
 *
 * Reusing the tier ramp keeps one visual language, but the meaning is different
 * and the legend says so — this is rate of change, not rank against anyone.
 */
export const PROGRESS_TIER = { falling: 0, flat: 1, thin: 1, climbing: 4 };

export function progressFills(byRegion) {
  const out = {};
  for (const [region, p] of Object.entries(byRegion)) {
    const idx = PROGRESS_TIER[p.state];
    if (idx !== undefined) out[region] = idx;
  }
  return out;
}

export const PROGRESS_LABEL = {
  climbing: 'Going up',
  flat: 'Holding',
  falling: 'Falling',
  thin: 'Too few sessions to tell',
};

/** One-line summary for a region, in plain language. */
export function describeRegion(region, p) {
  const name = REGIONS[region] || region;
  if (!p) return `${name} — nothing logged in this window.`;
  if (p.state === 'thin') {
    return `${name} — logged ${p.sessions} ${p.sessions === 1 ? 'time' : 'times'}, but no single movement has the three sessions a trend needs.`;
  }
  // `-0.0%` is what a flat fit prints without this, and it reads like a bug.
  const v = Math.abs(p.pctPerWeek) < 0.05 ? 0 : p.pctPerWeek;
  const rate = `${v > 0 ? '+' : ''}${v.toFixed(1)}% a week`;
  const via = p.best ? ` Best mover: ${p.best.name}.` : '';
  return `${name} — ${PROGRESS_LABEL[p.state].toLowerCase()} at ${rate} across ${p.exercises} ${p.exercises === 1 ? 'exercise' : 'exercises'}.${via}`;
}
