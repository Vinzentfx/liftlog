// Turns the plan rating's complaints into edits you can actually apply.
//
// The rating already knows the exact problem — "Abs 6 sets", "Quads 14 in one
// session", "this is loaded short". Making the user translate that back into
// which day to open and which exercise to add is work the app can do itself.
//
// Every fix is a small, reversible edit to one day. Nothing here restructures a
// plan: no fix removes a training day, changes the split, or touches an exercise
// you picked deliberately without saying so.

import { REGIONS } from './standards.js';
import { THRESHOLDS } from './evidence.js';
import { rateExercise } from './exercise-rating.js';
import { pickForRegion, SETS_PER_EXERCISE, REP_TARGET } from './plan-builder.js';
import { suggestSwaps } from './swaps.js';

const FLOOR = THRESHOLDS.weeklyFloor.value;
const PER_SESSION = THRESHOLDS.sessionPerMuscle.value;

const name = (r) => REGIONS[r] || r;
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/**
 * @param plan      the plan being edited (not mutated here)
 * @param analysis  an analysePlan() result for it
 * @param exercises the full library
 * @returns [{ id, title, detail, severity, apply(plan) }]
 */
export function diagnose(plan, analysis, exercises, byId, { sets = SETS_PER_EXERCISE } = {}) {
  const fixes = [];
  const used = new Set();
  for (const d of plan.days || []) for (const i of d.items) used.add(i.exerciseId);

  // ---- 1. muscles that get nothing at all ----
  for (const region of analysis.untrained) {
    const pick = pickForRegion(region, exercises, { used, preferCompound: true });
    if (!pick) continue;
    used.add(pick.id);
    const day = lightestDay(plan, byId, region, pick);
    if (!day) continue;
    fixes.push({
      id: `cover-${region}`,
      severity: 3,
      title: `Add ${name(region)} to ${day.name}`,
      detail: `${pick.name}, ${sets} sets. ${name(region)} is not trained at all right now.`,
      apply: (p) => addItem(p, day.id, pick.id, sets),
    });
  }

  // ---- 2. muscles under the weekly floor ----
  const under = analysis.trained
    .filter((r) => analysis.volume[r] < FLOOR)
    .sort((a, b) => analysis.volume[a] - analysis.volume[b]);
  for (const region of under.slice(0, 4)) {
    const pick = pickForRegion(region, exercises, { used, preferCompound: false });
    if (!pick) continue;
    used.add(pick.id);
    const day = lightestDay(plan, byId, region, pick);
    if (!day) continue;
    const gap = Math.ceil(FLOOR - analysis.volume[region]);
    fixes.push({
      id: `volume-${region}`,
      severity: 2,
      title: `Add ${article(name(region))} ${name(region)} exercise to ${day.name}`,
      detail: `${pick.name}, ${sets} sets — ${name(region)} is ${gap} short of the ${FLOOR}-set floor.`,
      apply: (p) => addItem(p, day.id, pick.id, sets),
    });
  }

  // ---- 3. one muscle crammed into one session ----
  for (const region of analysis.trained) {
    const peak = analysis.peakSession[region] || 0;
    if (peak <= PER_SESSION) continue;
    const move = findMove(plan, byId, region);
    if (!move) continue;
    fixes.push({
      id: `session-${region}`,
      severity: 2,
      title: `Move ${move.exName} to ${move.toDay.name}`,
      detail: `${name(region)} gets ${Math.round(peak)} sets in ${move.fromDay.name}. Past about ${PER_SESSION} in one session the extra sets stop paying.`,
      apply: (p) => moveItem(p, move.fromDay.id, move.toDay.id, move.exerciseId),
    });
  }

  // ---- 4. movements loaded in the shortened position ----
  for (const day of plan.days || []) {
    for (const item of day.items) {
      const ex = byId.get(item.exerciseId);
      if (!ex) continue;
      const r = rateExercise(ex);
      if (!r || r.length.bias !== 'short') continue;
      const better = suggestSwaps(ex, exercises, 1)[0];
      if (!better || used.has(better.ex.id)) continue;
      fixes.push({
        id: `swap-${item.exerciseId}`,
        severity: 1,
        title: `Swap ${ex.name} for ${better.ex.name}`,
        detail: `${r.length.why}. ${better.reason}.`,
        apply: (p) => replaceItem(p, day.id, item.exerciseId, better.ex.id),
      });
    }
  }

  // ---- 5. a muscle carried by a single movement ----
  for (const region of analysis.trained) {
    if ((analysis.exercisesPer[region] || 0) !== 1) continue;
    if (analysis.volume[region] < 8) continue;
    const pick = pickForRegion(region, exercises, { used, preferCompound: false });
    if (!pick) continue;
    used.add(pick.id);
    const day = lightestDay(plan, byId, region, pick);
    if (!day) continue;
    fixes.push({
      id: `variety-${region}`,
      severity: 1,
      title: `Add a second ${name(region)} movement`,
      detail: `${pick.name} on ${day.name}. All your ${name(region)} volume comes from one exercise, and muscles do not grow evenly.`,
      apply: (p) => addItem(p, day.id, pick.id, sets),
    });
  }

  return fixes.sort((a, b) => b.severity - a.severity).slice(0, 8);
}

/* ---------------- edits ---------------- */

function addItem(plan, dayId, exerciseId, sets = SETS_PER_EXERCISE) {
  const day = plan.days.find((d) => d.id === dayId);
  if (!day) return;
  day.items.push({
    exerciseId,
    targetSets: sets,
    targetReps: plan.repTarget || REP_TARGET,
    note: '',
  });
}

function replaceItem(plan, dayId, oldId, newId) {
  const day = plan.days.find((d) => d.id === dayId);
  const item = day && day.items.find((i) => i.exerciseId === oldId);
  if (item) item.exerciseId = newId;
}

function moveItem(plan, fromId, toId, exerciseId) {
  const from = plan.days.find((d) => d.id === fromId);
  const to = plan.days.find((d) => d.id === toId);
  if (!from || !to) return;
  const idx = from.items.findIndex((i) => i.exerciseId === exerciseId);
  if (idx < 0) return;
  const [item] = from.items.splice(idx, 1);
  to.items.push(item);
}

/* ---------------- helpers ---------------- */

/**
 * Where an extra exercise for a muscle belongs.
 *
 * Order matters more than it looks. Sorting only by "which day is emptiest"
 * puts a back squat on pull day — technically the lightest, obviously wrong. So
 * the plan's own structure wins first: a generated day carries the muscle slots
 * it was built from, and that is the plan telling you where the muscle lives.
 * Only after that does load, and only then size, get a say.
 */
function lightestDay(plan, byId, region, pick = null) {
  const days = (plan.days || []).filter((d) => d.items);
  if (!days.length) return null;

  // Everything the new exercise touches, so a hand-built plan with no slot
  // targets can still tell a leg day from a pull day: a back squat also loads
  // glutes and hamstrings, and the day that already trains those is the day it
  // belongs on.
  const kin = new Set([...(pick?.primary || []), ...(pick?.secondary || [])]);

  const scored = days.map((d) => ({
    d,
    // 2 = the blueprint put this muscle on this day, 1 = something here trains
    // it today, 0 = no relationship at all.
    fit: (d.target || []).some((t) => t.region === region) ? 2
      : regionLoad(d, byId, region) > 0 ? 1 : 0,
    kinship: [...kin].filter((r) => regionLoad(d, byId, r) > 0).length,
    load: regionLoad(d, byId, region),
    size: d.items.length,
  }));

  return scored
    .sort((a, b) => b.fit - a.fit || b.kinship - a.kinship || a.load - b.load || a.size - b.size)
    .map((x) => x.d)[0];
}

function regionLoad(day, byId, region) {
  let n = 0;
  for (const item of day.items) {
    const ex = byId.get(item.exerciseId);
    if (!ex) continue;
    const sets = Number(item.targetSets) || 0;
    if ((ex.primary || []).includes(region)) n += sets;
    else if ((ex.secondary || []).includes(region)) n += sets * THRESHOLDS.indirectSetWeight.value;
  }
  return n;
}

/** Heaviest day for a muscle, and the lightest day that could take one of them. */
function findMove(plan, byId, region) {
  const scored = (plan.days || []).map((d) => ({ d, load: regionLoad(d, byId, region) }));
  const from = [...scored].sort((a, b) => b.load - a.load)[0];
  const to = [...scored].sort((a, b) => a.load - b.load)[0];
  if (!from || !to || from.d.id === to.d.id) return null;

  // Move a movement whose *main* job is this muscle; shifting a compound that
  // only touches it as a secondary would move the wrong load.
  const item = from.d.items.find((i) => {
    const ex = byId.get(i.exerciseId);
    return ex && (ex.primary || []).includes(region);
  });
  if (!item) return null;
  const ex = byId.get(item.exerciseId);

  return { fromDay: from.d, toDay: to.d, exerciseId: item.exerciseId, exName: ex.name };
}
