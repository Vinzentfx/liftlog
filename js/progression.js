// What to put on the bar next, and why.
//
// The old version of this lived in one function on the training screen and
// asked a single question: did every set last time clear the top of the rep
// range? That rule is wrong in both directions at once. It refuses a weight
// increase because set four dropped to seven reps — which is what set four is
// *supposed* to do — and it has no idea whether the last session was your first
// exercise of the day or your fifth. Two lifters with identical logs, one of
// whom benched fresh and one of whom benched after nine sets of chest work, got
// the same advice.
//
// What is here instead:
//
//  1. Effort-adjusted load. A set is worth what it says plus what was left in
//     reserve. Where RIR is missing the set is taken at face value, which is
//     the same assumption the rest of the app makes and errs downwards.
//
//  2. A fatigue correction for where in the session the work happened, so every
//     past session can be compared on the same footing. See `readiness`.
//
//  3. A trend across sessions rather than a verdict on the last one. Three
//     sessions is the floor; below that the last session is all there is.
//
//  4. The first working set decides. Later sets fall off for reasons that have
//     nothing to do with whether the weight was right, so they inform the
//     *within-session* advice and never the between-session one.
//
// Two constants below are priors rather than findings, and are marked as such.
// Both are replaced by the lifter's own numbers as soon as there are enough of
// them, which is the point: the prior only has to be right until it isn't
// needed.

import { e1rm, isCounted, effectiveSetWeight, linearFit } from './models.js';
import { platePlan } from './plates.js';

/* ===================== effort ===================== */

/**
 * What a set says about maximum strength, counting what was left in reserve.
 *
 * A set of 8 with 3 RIR is a set of 11 that stopped early, and treating it as
 * an 8 is why the old rule kept telling people to stay at a weight they were
 * nowhere near. Without RIR the set is taken as written — the same thing the
 * PR check, the charts and the strength ranks do, and it underestimates rather
 * than over, so nothing built on it ever suggests too much weight.
 */
export function effortE1rm(set, assumedRir = 0) {
  const weight = effectiveSetWeight(set);
  const reps = Number(set.reps) || 0;
  if (!weight || !reps) return 0;
  return e1rm(weight, reps + reserveOf(set, assumedRir));
}

/** Was effort actually recorded, or is the estimate resting on the assumption? */
const hasEffort = (set) => set.rir !== null && set.rir !== undefined;

/**
 * Reps left in reserve, logged or assumed.
 *
 * The assumption is capped at 4 whatever the setting says: past that the number
 * stops being "how I train" and starts being a lever for making the app
 * recommend heavier weights, which is not what it is for.
 */
const reserveOf = (set, assumedRir = 0) =>
  hasEffort(set) ? Math.max(0, Number(set.rir)) : Math.max(0, Math.min(4, Number(assumedRir) || 0));

/* ===================== where in the session ===================== */

/**
 * The fatigue cost of a set already done, per set, before this exercise starts.
 *
 * Priors, not findings. Pre-exhaustion work puts the cost of three isolation
 * sets on a following compound at roughly 5%, which is where SAME_REGION comes
 * from; OTHER is the much smaller systemic cost of simply having been in the
 * gym a while. Both are replaced by the lifter's own numbers in
 * `observedOrderCost` once there is enough spread in their log to measure it.
 */
const SAME_REGION = 0.015;
const OTHER_REGION = 0.003;

/** However long the session, there is a floor under what is left. */
const MAX_FATIGUE = 0.15;

/**
 * How much of the same muscle two exercises share, 0–1.
 *
 * Primary against primary is the full cost. A primary that is somebody else's
 * secondary is half, because that is the convention the whole app counts
 * fractional sets with (THRESHOLDS.indirectSetWeight).
 */
function overlap(exercise, earlier) {
  const primary = new Set(exercise?.primary || []);
  if (!primary.size) return 0;
  let hit = 0;
  for (const region of earlier?.primary || []) if (primary.has(region)) hit += 1;
  for (const region of earlier?.secondary || []) if (primary.has(region)) hit += 0.5;
  return Math.min(1, hit / primary.size);
}

/**
 * The work standing between the start of a session and one of its exercises.
 *
 * @param entries   the session's entries, in the order they were performed
 * @param index     which entry is being asked about
 * @param byId      Map exerciseId -> exercise
 * @returns { same, other, warmedRegions }
 */
export function priorWork(entries, index, byId) {
  const exercise = byId.get(entries[index]?.exerciseId);
  let same = 0, other = 0;
  const warmedRegions = new Set();

  for (let i = 0; i < index; i++) {
    const earlier = byId.get(entries[i].exerciseId);
    const sets = (entries[i].sets || []).filter(isCounted).length;
    if (!sets) continue;
    for (const region of earlier?.primary || []) warmedRegions.add(region);
    const share = overlap(exercise, earlier);
    same += sets * share;
    other += sets * (1 - share);
  }
  return { same, other, warmedRegions };
}

/**
 * The share of a fresh lifter's strength still available at this point.
 *
 * 1.0 for the first exercise of the day. The example this exists for: bench
 * first at 100 × 8 last week, bench after three sets of butterfly this week.
 * Same lifter, same strength, and without this correction the app would read
 * the second week as a regression and tell them to go backwards.
 */
export function readiness({ same = 0, other = 0 } = {}, cost = null) {
  const perSame = cost?.same ?? SAME_REGION;
  const perOther = cost?.other ?? OTHER_REGION;
  return 1 - Math.min(MAX_FATIGUE, same * perSame + other * perOther);
}

/**
 * The order cost measured from the lifter's own log, or null.
 *
 * Split the sessions into the ones with little preceding same-muscle work and
 * the ones with a lot, and compare what they lifted. Only answered when the two
 * groups are genuinely different sessions — at least two each and a real gap
 * between them — because below that this is fitting a line to noise and the
 * prior is the better answer.
 */
export function observedOrderCost(rows) {
  const usable = rows.filter((r) => r.rawE1rm > 0);
  if (usable.length < 6) return null;
  const loads = usable.map((r) => r.prior.same);
  const spread = Math.max(...loads) - Math.min(...loads);
  if (spread < 3) return null;

  const mid = (Math.max(...loads) + Math.min(...loads)) / 2;
  const light = usable.filter((r) => r.prior.same <= mid);
  const heavy = usable.filter((r) => r.prior.same > mid);
  if (light.length < 2 || heavy.length < 2) return null;

  const mean = (list, pick) => list.reduce((n, r) => n + pick(r), 0) / list.length;
  const lightMean = mean(light, (r) => r.rawE1rm);
  const heavyMean = mean(heavy, (r) => r.rawE1rm);
  const gap = mean(heavy, (r) => r.prior.same) - mean(light, (r) => r.prior.same);
  if (!lightMean || gap <= 0) return null;

  const perSet = (1 - heavyMean / lightMean) / gap;
  // Half the lifter, half the prior. A single unlucky session should move this
  // a little and never invert it: a negative measurement means "no cost found",
  // not "training tired makes you stronger".
  const blended = (Math.max(0, perSet) + SAME_REGION) / 2;
  return { same: Math.min(0.04, blended), other: OTHER_REGION, measured: true };
}

/**
 * The same measurement, pooled across every exercise in the log.
 *
 * `observedOrderCost` can only answer once *one* exercise has been trained from
 * enough different positions, which for most people is months away and for some
 * never: if bench is always first and flyes are always fourth, that exercise
 * will never produce the spread it needs, however long the log gets.
 *
 * Pooling fixes the arithmetic rather than the training. Each exercise's
 * estimates are divided by that exercise's own mean first, so a 140 kg squat and
 * a 20 kg lateral raise contribute the same *shape* rather than the squat
 * drowning out the raise, and the light/heavy split then runs across everything
 * at once. It answers far sooner and is used only where the exercise's own
 * measurement cannot.
 *
 * Memoised, because the training screen asks once per exercise block and this
 * walks the whole log. The key is deliberately cheap and deliberately
 * conservative: a new finished session changes it, and nothing else needs to.
 */
let pooledCache = { key: null, value: null };

export function pooledOrderCost(sessions, byId, { minExercises = 3, minRows = 12, assumedRir = 0 } = {}) {
  const finished = (sessions || []).filter((s) => s.finishedAt);
  const key = `${finished.length}:${assumedRir}:${Math.max(0, ...finished.map((s) => s.startedAt || 0))}`;
  if (pooledCache.key === key) return pooledCache.value;

  const byExercise = new Map();
  for (const session of finished) {
    (session.entries || []).forEach((entry, index) => {
      const sets = (entry.sets || []).filter(isCounted);
      if (!sets.length) return;
      const best = Math.max(...sets.map((set) => effortE1rm(set, assumedRir)));
      if (!best) return;
      const list = byExercise.get(entry.exerciseId) || [];
      list.push({ same: priorWork(session.entries, index, byId).same, value: best });
      byExercise.set(entry.exerciseId, list);
    });
  }

  const pooled = [];
  let exercises = 0;
  for (const list of byExercise.values()) {
    if (list.length < 3) continue;      // one or two sessions say nothing about order
    const mean = list.reduce((n, r) => n + r.value, 0) / list.length;
    if (!mean) continue;
    exercises++;
    for (const row of list) pooled.push({ prior: { same: row.same }, rawE1rm: row.value / mean });
  }

  const value = exercises >= minExercises && pooled.length >= minRows
    ? observedOrderCost(pooled)
    : null;
  pooledCache = { key, value };
  return value;
}

/* ===================== the log, comparable ===================== */

/**
 * Every past session of one exercise, corrected onto a common footing.
 *
 * `freshE1rm` is the number that makes sessions comparable: what the same work
 * would have been worth done first in the session. It is what the trend is
 * fitted on and what today's target is projected from.
 *
 * The returned array carries an `orderCost` property: the measured cost of
 * preceding work, the pooled `fallbackCost` when this exercise cannot produce
 * one on its own, or null when neither is available.
 * It hangs off the array rather than forcing every caller to unwrap a
 * `{ rows, orderCost }` pair for a value only two of them read.
 */
export function exerciseHistory(sessions, exerciseId, byId,
  { excludeSessionId = null, limit = 8, fallbackCost = null, assumedRir = 0 } = {}) {
  const rows = [];
  for (const session of sessions) {
    if (!session.finishedAt || session.id === excludeSessionId) continue;
    const index = (session.entries || []).findIndex((e) => e.exerciseId === exerciseId);
    if (index < 0) continue;
    const entry = session.entries[index];
    const sets = (entry.sets || []).filter(isCounted);
    if (!sets.length) continue;

    const prior = priorWork(session.entries, index, byId);
    const best = Math.max(...sets.map((set) => effortE1rm(set, assumedRir)));
    rows.push({
      at: session.startedAt,
      sessionId: session.id,
      position: index,
      sets,
      firstSet: sets[0],
      // The weight the exercise *opened* on, which is the one a recommendation
      // for the opening set has to be built from. Not the same thing as the
      // heaviest set: plenty of people ramp across their working sets, and
      // judging the reps of set one against the load of set three produced
      // advice that was wrong by two increments every session.
      openingWeight: effectiveSetWeight(sets[0]),
      topWeight: Math.max(...sets.map(effectiveSetWeight)),
      prior,
      rawE1rm: best,
      effortLogged: sets.some(hasEffort),
      assumedRir,
    });
    if (rows.length >= limit) break;
  }

  // Newest first on the way in, oldest first on the way out: everything below
  // reads as a series.
  rows.reverse();
  // This exercise's own measurement first, the pooled one when it cannot
  // answer, and the prior when neither can.
  const cost = observedOrderCost(rows) || fallbackCost;
  for (const row of rows) {
    row.readiness = readiness(row.prior, cost);
    row.freshE1rm = row.rawE1rm / row.readiness;
  }
  rows.orderCost = cost;
  return rows;
}

/**
 * Fresh-equivalent strength projected to today.
 *
 * Three sessions before a line is drawn, and the line is capped: a fortnight of
 * good luck should not extrapolate into a weight nobody can lift. Without
 * enough points the last session stands on its own, which is what it is.
 */
export function projectFresh(rows, now = Date.now()) {
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  if (rows.length < 3) return { value: last.freshE1rm, slope: null, sessions: rows.length };

  const recent = rows.slice(-6);
  const base = recent[0].at;
  const fit = linearFit(recent.map((r) => [(r.at - base) / (7 * 86400000), r.freshE1rm]));
  if (!fit) return { value: last.freshE1rm, slope: null, sessions: rows.length };

  const weeksSince = Math.min(3, (now - last.at) / (7 * 86400000));
  const projected = last.freshE1rm + fit.slope * weeksSince;
  return {
    // Never more than 5% above what was actually done, whatever the fit says.
    value: Math.max(last.freshE1rm * 0.9, Math.min(last.freshE1rm * 1.05, projected)),
    slope: fit.slope,
    sessions: rows.length,
  };
}

/**
 * How much a set costs the ones after it, measured from this lifter.
 *
 * Every past session where two or more sets were logged says something about
 * this, and it is one of the few things in training that is genuinely personal:
 * some people lose two reps a set, some lose none. The 4% fallback is a prior
 * and is only used until three sessions exist.
 */
export function setDecay(rows, assumedRir = 0) {
  const samples = [];
  for (const row of rows) {
    const first = effortE1rm(row.sets[0], assumedRir);
    if (!first) continue;
    row.sets.slice(1).forEach((set, i) => {
      const value = effortE1rm(set, assumedRir);
      if (value) samples.push((1 - value / first) / (i + 1));
    });
  }
  if (samples.length < 3) return { value: 0.04, measured: false };
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  return { value: Math.max(0.005, Math.min(0.12, median)), measured: true };
}

/* ===================== rounding ===================== */

export function parseReps(spec) {
  if (!spec) return null;
  // "3x8" is three sets of eight, not a range of three to eight. Written that
  // way it used to widen the target to 3–8, which made the engine chase eight
  // reps as the *top* of a range whose bottom was three, and recommend weight
  // increases off a set of three.
  const text = String(spec).replace(/^\s*\d+\s*[x×*]\s*/i, '');
  const nums = text.match(/\d+/g);
  if (!nums || !nums.length) return null;
  const ns = nums.map(Number).filter((n) => n > 0);
  if (!ns.length) return null;
  return { low: Math.min(...ns), high: Math.max(...ns) };
}

/**
 * The smallest change worth making on this equipment.
 *
 * `override` is the per-machine stack increment from the setup sheet, and it
 * wins where it exists: the equipment default is a guess about a frame nobody
 * has looked at, and the override is somebody who has.
 */
export function loadStep(exercise, units, override = null) {
  if (Number(override) > 0) return Number(override);
  if (exercise?.equipment === 'Dumbbell') return units === 'lb' ? 5 : 2;
  return units === 'lb' ? 5 : 2.5;
}

/**
 * A weight that can actually be made.
 *
 * On a barbell that means real plates — a suggestion of 101 kg is a suggestion
 * to go and find a 0.5 kg disc. Everywhere else it is the nearest increment,
 * which on a pin stack is the only weight that exists at all.
 */
export function roundLoad(weight, exercise, { units = 'kg', barWeight = 20, step = null } = {}) {
  const increment = loadStep(exercise, units, step);
  if (exercise?.equipment !== 'Barbell' || Number(step) > 0) {
    return Math.round(weight / increment) * increment;
  }
  const plan = platePlan(weight, barWeight, units);
  if (!plan) return barWeight;
  return plan.loaded;
}

/** Reps a load is good for, given a capacity, leaving `reserve` in the tank. */
const repsAt = (capacity, weight, reserve) =>
  Math.floor(30 * (capacity / weight - 1) - reserve);

/** The load that lands on a rep target with `reserve` left over. */
const loadFor = (capacity, reps, reserve) => capacity / (1 + (reps + reserve) / 30);

/** How close to failure the first working set is aimed. Practice, not a finding. */
const TARGET_RESERVE = 1;

/**
 * And how close the ones after it.
 *
 * Zero, because a later set is where the reserve gets spent. Aiming the third
 * set of the day at one-in-reserve as well is how an app ends up recommending a
 * weight drop for a session that is going exactly as it should.
 */
const LATER_RESERVE = 0;

/* ===================== between sessions ===================== */

/**
 * What to open with today.
 *
 * @param rows      exerciseHistory output, oldest first
 * @param options   { exercise, targetReps, rule, units, barWeight, prior, now }
 * @returns { weight, reps, change, reasons, confidence } or null
 */
export function openingSet(rows, {
  exercise = null, targetReps = null, rule = 'double', units = 'kg', barWeight = 20,
  prior = null, now = Date.now(), step: stackStep = null, assumedRir = 0,
} = {}) {
  if (!rows.length) return null;
  const range = parseReps(targetReps) || { low: 6, high: 10 };
  const last = rows[rows.length - 1];
  const step = loadStep(exercise, units, stackStep);
  if (!last.openingWeight) return null;
  if (rule === 'manual') return null;

  const projected = projectFresh(rows, now);
  const today = readiness(prior || { same: 0, other: 0 }, rows.orderCost);
  const capacity = projected.value * today;

  const reasons = [];
  const firstReps = Number(last.firstSet.reps) || 0;
  const firstReserve = reserveOf(last.firstSet, assumedRir);
  const reserveLogged = hasEffort(last.firstSet);

  // The rule the user actually asked for: the *first* working set clearing the
  // target is enough. Sets three and four falling off is fatigue, not a verdict
  // on the weight, and holding progression hostage to them is why this used to
  // recommend the same number for months.
  //
  // "Clearing" counts what was left in reserve. Seven reps with three in the
  // tank is a set of ten that stopped early, and a lifter who stops early does
  // not need the weight kept where it is — they need it moved.
  const firstCapable = firstReps + firstReserve;
  const clearedTarget = firstCapable >= range.high;
  const falling = projected.slope !== null && projected.slope < -0.5;

  // Order. Reported before anything else because it is the one the lifter can
  // see on their own screen and would otherwise read as a regression.
  const orderShift = today - last.readiness;
  if (Math.abs(orderShift) >= 0.01) {
    reasons.push({
      key: orderShift < 0 ? 'later' : 'earlier',
      params: {
        pct: Math.abs(Math.round(orderShift * 100)),
        weight: Math.abs(last.openingWeight * orderShift),
      },
    });
  }

  let weight, reps, change;
  if (rule === 'reps') {
    weight = roundLoad(last.openingWeight * (1 + orderShift), exercise, { units, barWeight, step: stackStep });
    reps = Math.max(range.low, Math.min(range.high, repsAt(capacity, weight, TARGET_RESERVE)));
    change = 'hold';
    reasons.push({ key: 'repRule', params: { high: range.high } });
  } else if (rule === 'weight' || (clearedTarget && !falling)) {
    // Up. Bounded on both sides: at least one increment so the suggestion is
    // actually a change, at most three so a single very good session cannot
    // fling the weight somewhere the lifter has never been.
    const wanted = loadFor(capacity, range.low, TARGET_RESERVE);
    weight = roundLoad(
      Math.max(last.openingWeight + step, Math.min(last.openingWeight + step * 3, wanted)),
      exercise, { units, barWeight, step: stackStep }
    );
    if (weight <= last.openingWeight) {
      weight = roundLoad(last.openingWeight + step, exercise, { units, barWeight, step: stackStep });
    }
    reps = Math.max(range.low, Math.min(range.high, repsAt(capacity, weight, TARGET_RESERVE)));
    change = 'up';
    reasons.unshift(rule === 'weight'
      ? { key: 'weightRule', params: {} }
      : firstReps >= range.high
        ? { key: 'clearedFirstSet', params: { reps: firstReps, high: range.high } }
        : {
            // Say which it was. A weight increase built on an assumption the
            // user never made should announce itself as one.
            key: reserveLogged ? 'easyFirstSet' : 'assumedFirstSet',
            params: { reps: firstReps, rir: firstReserve, capable: firstCapable },
          });
  } else {
    // Hold, or step back when the trend and today's fatigue agree that the old
    // weight is not there. Stepping back is rare and deliberate: it needs the
    // projection to say so, not a single bad set.
    const holdReps = repsAt(capacity, last.openingWeight, TARGET_RESERVE);
    if (holdReps < range.low) {
      // Far enough down to actually reach the bottom of the range, not one
      // increment. After a heavy single, one increment still leaves a weight
      // nobody is doing six reps with, and the old version printed exactly that.
      const wanted = loadFor(capacity, range.low, TARGET_RESERVE);
      weight = roundLoad(Math.max(step, Math.min(last.openingWeight - step, wanted)),
        exercise, { units, barWeight, step: stackStep });
      change = 'down';
      reasons.unshift({ key: falling ? 'trendDown' : 'tooHeavyToday', params: { low: range.low } });
    } else {
      weight = roundLoad(last.openingWeight, exercise, { units, barWeight, step: stackStep });
      change = 'hold';
      reasons.unshift({ key: 'buildReps', params: { reps: firstReps, high: range.high } });
    }
    reps = repsAt(capacity, weight, TARGET_RESERVE);
  }

  // Reported as predicted, never rounded up into the range. `nextSet` has
  // always done it this way; this one used to clamp upward, so a suggestion
  // built on a 200 kg single came out as "197.5 kg × 6".
  reps = Math.min(range.high, Math.max(1, reps));

  if (projected.slope !== null && Math.abs(projected.slope) >= 0.5) {
    reasons.push({
      key: projected.slope > 0 ? 'trendUp' : 'trendFlat',
      params: { perWeek: Math.abs(projected.slope).toFixed(1), sessions: projected.sessions },
    });
  }
  if (!rows.some((r) => r.effortLogged)) reasons.push({ key: 'noRir', params: { rir: assumedRir } });

  return {
    weight, reps, change, reasons,
    range,
    capacity,
    fromWeight: last.openingWeight,
    sessions: rows.length,
    orderAware: Math.abs(orderShift) >= 0.01,
  };
}

/* ===================== inside a session ===================== */

/**
 * What to put on for the next set, given how the ones before it went today.
 *
 * This is the number the old app never had. It knew what you did last week and
 * said nothing at all once the session started, which is exactly when the
 * information is best: one completed set today says more about today than four
 * sessions of history do.
 *
 * @param doneSets  the working sets already completed today, in order
 * @param rows      exerciseHistory output, for the personal set-to-set decay
 */
export function nextSet(doneSets, rows, {
  exercise = null, targetReps = null, units = 'kg', barWeight = 20, step: stackStep = null,
  assumedRir = 0,
} = {}) {
  const done = (doneSets || []).filter(isCounted);
  if (!done.length) return null;
  const range = parseReps(targetReps) || { low: 6, high: 10 };
  const step = loadStep(exercise, units, stackStep);

  const opener = effortE1rm(done[0], assumedRir);
  if (!opener) return null;
  const decay = setDecay(rows || [], assumedRir);
  const lastWeight = effectiveSetWeight(done[done.length - 1]);
  if (!lastWeight) return null;

  // Where the lifter will be on the set about to be done, not where they were.
  const capacity = opener * Math.max(0.6, 1 - decay.value * done.length);

  const holdReps = repsAt(capacity, lastWeight, LATER_RESERVE);
  const first = done[0];
  // Same reading as between sessions: reps plus reserve is what the set was
  // actually worth. Two clear of the top of the range means the opener was
  // light, and the set about to be done should not repeat that.
  const blewPast = Number(first.reps) + reserveOf(first, assumedRir) >= range.high + 2;

  // The weight that would land the next set on the bottom of the range.
  const wanted = loadFor(capacity, range.low, LATER_RESERVE);

  let weight = lastWeight, change = 'hold', key = holdReps >= range.low ? 'holdWeight' : 'holdFade';
  if (blewPast && done.length === 1) {
    weight = roundLoad(lastWeight + step, exercise, { units, barWeight, step: stackStep });
    change = 'up';
    key = 'setTooLight';
  } else if (wanted <= lastWeight - step * 2) {
    // Only when a step down actually buys something. Reps falling away set by
    // set is what sets do — demanding every one of them stay inside the range
    // is the exact mistake the between-session rule used to make, and repeating
    // it here would just move it four inches down the screen.
    weight = roundLoad(Math.max(step, wanted), exercise, { units, barWeight, step: stackStep });
    change = 'down';
    key = 'dropToRange';
  }

  // Reported as predicted, not as hoped: a later set that lands under the range
  // is information, and rounding it up into the range would be a lie told to
  // make a number look tidy. The ceiling is only there so a very light set does
  // not print a rep count nobody is going to do.
  const reps = Math.min(range.high, Math.max(1, repsAt(capacity, weight, LATER_RESERVE)));
  return {
    setNumber: done.length + 1,
    weight,
    reps,
    change,
    reason: { key, params: { low: range.low, high: range.high, reps } },
    decayPct: Math.round(decay.value * 100),
    decayMeasured: decay.measured,
    range,
  };
}
