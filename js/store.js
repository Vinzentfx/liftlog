// Single source of truth. Screens read `state` and call actions; actions persist
// to IndexedDB and notify subscribers.

import * as db from './db.js';
import {
  DEFAULT_SETTINGS, seedExercises, newSession, newEntry, newSet,
  newFood, newMeal, dayKey,
  LIBRARY_VERSION, DATA_VERSION, normName, regionsForMuscle,
} from './models.js';
import { buildPlanDays, SETS_PER_EXERCISE, REP_TARGET } from './plan-builder.js';

export const state = {
  ready: false,
  exercises: [],
  routines: [],
  plans: [],
  sessions: [],       // newest first, includes the in-progress one
  bodyweight: [],     // newest first
  foods: [],          // the user's own food list
  meals: [],          // newest first
  settings: { ...DEFAULT_SETTINGS },
  exerciseById: new Map(),
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn()); }

function reindex() {
  state.exerciseById = new Map(state.exercises.map((e) => [e.id, e]));
  state.exercises.sort((a, b) => a.name.localeCompare(b.name));
  state.sessions.sort((a, b) => b.startedAt - a.startedAt);
  state.bodyweight.sort((a, b) => b.date - a.date);
  state.meals.sort((a, b) => b.at - a.at);
  // Most-eaten first: the list you pick from should put your staples on top,
  // because 95% of what anyone eats is the same 30 things.
  state.foods.sort((a, b) => (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name));
}

export async function load() {
  const [exercises, routines, plans, sessions, bodyweight, foods, meals, settingsRows] = await Promise.all([
    db.getAll(db.STORES.exercises),
    db.getAll(db.STORES.routines),
    db.getAll(db.STORES.plans),
    db.recentSessions(0),
    db.getAll(db.STORES.bodyweight),
    db.getAll(db.STORES.foods),
    db.getAll(db.STORES.meals),
    db.getAll(db.STORES.settings),
  ]);

  state.exercises = exercises;
  state.routines = routines;
  state.plans = plans;
  state.sessions = sessions;
  state.bodyweight = bodyweight;
  state.foods = foods;
  state.meals = meals;
  state.settings = { ...DEFAULT_SETTINGS };
  for (const row of settingsRows) state.settings[row.key] = row.value;

  if (!state.exercises.length) {
    state.exercises = seedExercises(db.uid);
    await db.putMany(db.STORES.exercises, state.exercises);
    await db.put(db.STORES.settings, { key: 'libraryVersion', value: LIBRARY_VERSION });
    state.settings.libraryVersion = LIBRARY_VERSION;
  } else if ((state.settings.libraryVersion || 1) < LIBRARY_VERSION) {
    // Existing install: top up with catalogue entries it doesn't have yet.
    // Matched by name so nothing the user edited or logged against is touched.
    const have = new Set(state.exercises.map((e) => normName(e.name)));
    const added = seedExercises(db.uid).filter((e) => !have.has(normName(e.name)));
    if (added.length) {
      state.exercises.push(...added);
      await db.putMany(db.STORES.exercises, added);
    }
    // Backfill body-map regions on the original curated rows.
    const missing = state.exercises.filter((e) => !e.primary);
    if (missing.length) {
      const byName = new Map(seedExercises(db.uid).map((e) => [normName(e.name), e]));
      for (const e of missing) {
        const match = byName.get(normName(e.name));
        e.primary = match ? match.primary : [];
        e.secondary = match ? match.secondary : [];
        e.instructions = e.instructions || (match ? match.instructions : []);
      }
      await db.putMany(db.STORES.exercises, missing);
    }
    await db.put(db.STORES.settings, { key: 'libraryVersion', value: LIBRARY_VERSION });
    state.settings.libraryVersion = LIBRARY_VERSION;
    console.info(`[liftlog] library topped up: +${added.length} exercises`);
  }

  await migrate();

  reindex();
  state.ready = true;
  emit();
}

/**
 * One-off repairs to stored records.
 *
 * v2 — exercises with no body-map regions. Anything the user created themselves
 * was stored without `primary`/`secondary` at all, and the catalogue top-up only
 * ever fixed rows it could match against the bundled seed by name — a custom
 * exercise matches nothing and was left with an empty array. The effect was
 * silent and total: no colour on the muscle map, no volume in a plan's rating,
 * and a zero-muscle score in the exercise rating. Fixed at creation time now;
 * this repairs what is already stored.
 */
async function migrate() {
  const from = Number(state.settings.dataVersion) || 1;
  if (from >= DATA_VERSION) return;

  if (from < 2) {
    const seedByName = new Map(seedExercises(db.uid).map((e) => [normName(e.name), e]));
    const repaired = [];

    for (const ex of state.exercises) {
      if ((ex.primary || []).length) continue;
      // Catalogue entries get their curated regions back; anything else falls to
      // the coarse muscle mapping, which is rough but is the difference between
      // counting and not counting at all.
      const match = seedByName.get(normName(ex.name));
      const primary = match && match.primary.length ? match.primary : regionsForMuscle(ex.muscle);
      if (!primary.length) continue;      // "Other" genuinely has no region

      ex.primary = primary;
      ex.secondary = match ? match.secondary : [];
      repaired.push(ex);
    }

    if (repaired.length) {
      await db.putMany(db.STORES.exercises, repaired);
      console.info(`[liftlog] migration v2: regions restored on ${repaired.length} exercises`);
    }
  }

  state.settings.dataVersion = DATA_VERSION;
  await db.put(db.STORES.settings, { key: 'dataVersion', value: DATA_VERSION });
}

export function activeSession() {
  return state.sessions.find((s) => !s.finishedAt) || null;
}

export const units = () => state.settings.units;

/** What a newly added plan exercise starts at. Settings first, app default after. */
export const defaultSets = () => {
  const n = Number(state.settings.defaultSets);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : SETS_PER_EXERCISE;
};
export const defaultReps = () =>
  (state.settings.defaultReps || '').trim() || REP_TARGET;

/** Quality stars are hidden separately from the strength tiers — different things. */
export const starsShown = () => state.settings.showStars !== false;

// ---------- settings ----------

export async function setSetting(key, value) {
  state.settings[key] = value;
  await db.put(db.STORES.settings, { key, value });
  emit();
}

// ---------- exercises ----------

export async function addExercise({ name, muscle, equipment }) {
  const ex = {
    id: db.uid('ex_'),
    name: name.trim(), muscle, equipment: equipment || 'Other',
    // Without these a custom exercise is invisible to everything that matters:
    // it colours no muscle on the map, adds no volume to a plan's rating, and
    // scores as a movement that trains nothing.
    primary: regionsForMuscle(muscle),
    secondary: [],
    instructions: [],
    mech: null,
    isCustom: true, createdAt: Date.now(),
  };
  state.exercises.push(ex);
  await db.put(db.STORES.exercises, ex);
  reindex(); emit();
  return ex;
}

export async function toggleFavourite(id) {
  const ex = state.exerciseById.get(id);
  if (!ex) return null;
  ex.favourite = !ex.favourite;
  await db.put(db.STORES.exercises, ex);
  emit();
  return ex.favourite;
}

/** Favourites first, then the caller's own order. */
export function favouriteFirst(list) {
  return [...list].sort((a, b) => (b.favourite ? 1 : 0) - (a.favourite ? 1 : 0));
}

export async function updateExercise(id, patch) {
  const ex = state.exerciseById.get(id);
  if (!ex) return null;
  // Moving an exercise to another muscle group has to move its body-map regions
  // with it, or the map and every volume count keep answering for the old one.
  // Only on an actual change: the curated entries have hand-written regions from
  // CONTRIB that are far better than the coarse mapping.
  const movedGroup = patch.muscle && patch.muscle !== ex.muscle;
  Object.assign(ex, patch);
  if (movedGroup) {
    ex.primary = regionsForMuscle(ex.muscle);
    ex.secondary = [];
  }
  await db.put(db.STORES.exercises, ex);
  reindex(); emit();
  return ex;
}

/** Personal 1–5 rating, or 0 to clear it. Separate from the evidence rating. */
export async function setMyRating(id, value) {
  const ex = state.exerciseById.get(id);
  if (!ex) return null;
  ex.myRating = value > 0 ? Math.max(1, Math.min(5, Math.round(value))) : null;
  await db.put(db.STORES.exercises, ex);
  emit();
  return ex.myRating;
}

export function exerciseUsageCount(id) {
  return state.sessions.reduce(
    (n, s) => n + (s.entries.some((e) => e.exerciseId === id) ? 1 : 0), 0);
}

export async function deleteExercise(id) {
  state.exercises = state.exercises.filter((e) => e.id !== id);
  await db.remove(db.STORES.exercises, id);
  // Drop it from routines too, or they'd render blank rows.
  for (const r of state.routines) {
    const before = r.items.length;
    r.items = r.items.filter((i) => i.exerciseId !== id);
    if (r.items.length !== before) await db.put(db.STORES.routines, r);
  }
  // And from plans. This was missing: the delete dialog promised it, the plan
  // screen rendered an empty row where the exercise had been, and the plan
  // rating quietly counted a slot that trained nothing.
  for (const p of state.plans) {
    let touched = false;
    for (const day of p.days || []) {
      const before = day.items.length;
      day.items = day.items.filter((i) => i.exerciseId !== id);
      if (day.items.length !== before) touched = true;
    }
    if (touched) { p.updatedAt = Date.now(); await db.put(db.STORES.plans, p); }
  }
  reindex(); emit();
}

/** How many plan days reference an exercise — for an honest delete warning. */
export function planUsageCount(id) {
  return state.plans.reduce((n, p) =>
    n + (p.days || []).filter((d) => d.items.some((i) => i.exerciseId === id)).length, 0);
}

// ---------- routines ----------

export async function saveRoutine(routine) {
  const existing = state.routines.find((r) => r.id === routine.id);
  const rec = {
    id: routine.id || db.uid('r_'),
    name: routine.name.trim() || 'Routine',
    items: routine.items || [],
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now(),
  };
  if (existing) Object.assign(existing, rec);
  else state.routines.push(rec);
  await db.put(db.STORES.routines, rec);
  emit();
  return rec;
}

export async function deleteRoutine(id) {
  state.routines = state.routines.filter((r) => r.id !== id);
  await db.remove(db.STORES.routines, id);
  emit();
}

// ---------- plans ----------

export function activePlan() {
  const id = state.settings.activePlanId;
  return (id && state.plans.find((p) => p.id === id)) || null;
}

/**
 * Build a plan from a blueprint.
 * @param opts { empty } — true keeps the day layout but adds no exercises,
 *   so the user fills it in themselves.
 */
export async function createPlanFromBlueprint(blueprint, { empty = false } = {}) {
  const days = buildPlanDays(blueprint, state.exercises, {
    empty,
    sets: defaultSets(),
    reps: defaultReps(),
  });

  const plan = {
    id: db.uid('p_'),
    name: blueprint.name,
    presetKey: blueprint.key || null,
    repTarget: defaultReps(),
    // how many times the whole cycle runs per week — the rating scales by this
    perWeek: blueprint.perWeek || 1,
    days,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  state.plans.push(plan);
  await db.put(db.STORES.plans, plan);
  await setSetting('activePlanId', plan.id);
  return plan;
}

export async function savePlan(plan) {
  const existing = state.plans.find((p) => p.id === plan.id);
  const rec = {
    id: plan.id || db.uid('p_'),
    name: (plan.name || 'Plan').trim(),
    presetKey: plan.presetKey ?? (existing ? existing.presetKey : null),
    repTarget: plan.repTarget ?? (existing ? existing.repTarget : defaultReps()),
    perWeek: plan.perWeek ?? (existing ? existing.perWeek : 1),
    days: plan.days || [],
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now(),
  };
  if (existing) Object.assign(existing, rec);
  else state.plans.push(rec);
  await db.put(db.STORES.plans, rec);
  if (!state.settings.activePlanId) await setSetting('activePlanId', rec.id);
  else emit();
  return rec;
}

/**
 * Materialise a plan that arrived over a share link.
 *
 * Exercises are matched by normalised name against the existing library, and
 * anything missing is created as a custom entry — with regions from its muscle
 * group, so a shared plan never leaves silent holes in the muscle map or the
 * volume count the way an exercise without regions would.
 *
 * @returns {{plan:object, created:string[]}}
 */
export async function importSharedPlan(shared) {
  const byName = new Map(state.exercises.map((e) => [normName(e.name), e]));
  const created = [];

  // One pass to create everything missing, so the day mapping below can assume
  // every name resolves.
  for (const day of shared.days) {
    for (const item of day.items) {
      const key = normName(item.name);
      if (byName.has(key)) continue;
      const ex = await addExercise({
        name: item.name,
        muscle: item.muscle,
        equipment: item.equipment,
      });
      byName.set(key, ex);
      created.push(ex.name);
    }
  }

  const plan = {
    id: db.uid('p_'),
    name: shared.name,
    presetKey: null,
    repTarget: shared.repTarget || defaultReps(),
    perWeek: shared.perWeek || 1,
    days: shared.days.map((day) => ({
      id: db.uid('d_'),
      name: day.name,
      weekday: Number.isInteger(day.weekday) ? day.weekday : null,
      items: day.items.map((item) => ({
        exerciseId: byName.get(normName(item.name)).id,
        targetSets: item.sets,
        targetReps: item.reps || shared.repTarget || defaultReps(),
        note: '',
      })),
      target: [],
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  state.plans.push(plan);
  await db.put(db.STORES.plans, plan);
  // Deliberately not made active: importing someone's plan is browsing, not
  // committing to it. The plan screen offers the switch.
  emit();
  return { plan, created };
}

export async function deletePlan(id) {
  state.plans = state.plans.filter((p) => p.id !== id);
  await db.remove(db.STORES.plans, id);
  if (state.settings.activePlanId === id) {
    await setSetting('activePlanId', state.plans.length ? state.plans[0].id : null);
  } else {
    emit();
  }
}

// ---------- sessions ----------

async function persistSession(session) {
  await db.put(db.STORES.sessions, session);
  emit();
}

export async function startSession({ routineId = null, planId = null, dayId = null, name } = {}) {
  const existing = activeSession();
  if (existing) return existing;

  // A session can be seeded from a plan day or a standalone routine.
  let items = null;
  let label = null;

  if (planId && dayId) {
    const plan = state.plans.find((p) => p.id === planId);
    const day = plan && plan.days.find((d) => d.id === dayId);
    if (day) { items = day.items; label = `${day.name}`; }
  } else if (routineId) {
    const routine = state.routines.find((r) => r.id === routineId);
    if (routine) { items = routine.items; label = routine.name; }
  }

  const entries = (items || []).map((item) => {
    const sets = [];
    const target = Math.max(1, Number(item.targetSets) || 3);
    for (let i = 0; i < target; i++) sets.push(newSet());
    // targetReps travels with the entry so the logging screen can tell you
    // whether you cleared the range — without it the progression suggestion has
    // nothing to compare against.
    return {
      ...newEntry(item.exerciseId, sets),
      note: item.note || '',
      targetReps: item.targetReps || null,
    };
  });

  const session = newSession(db.uid, {
    routineId,
    planId,
    dayId,
    name: name || label || 'Quick Workout',
    entries,
  });
  state.sessions.unshift(session);
  await persistSession(session);
  return session;
}

export async function updateSession(id, mutate) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return null;
  mutate(s);
  await persistSession(s);
  return s;
}

/**
 * Persist without notifying subscribers. Used for keystroke-level edits — a
 * re-render mid-typing would blow away the focused input and the caret.
 */
export async function saveSessionQuiet(session) {
  await db.put(db.STORES.sessions, session);
}

export async function finishSession(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return null;
  // Drop empty sets and exercises so history stays clean.
  s.entries = s.entries
    .map((e) => ({ ...e, sets: e.sets.filter((st) => st.done && Number(st.reps) > 0) }))
    .filter((e) => e.sets.length > 0);
  s.finishedAt = Date.now();
  await persistSession(s);
  return s;
}

export async function discardSession(id) {
  state.sessions = state.sessions.filter((s) => s.id !== id);
  await db.remove(db.STORES.sessions, id);
  emit();
}

// ---------- nutrition ----------

export async function addFood(fields) {
  const food = newFood(db.uid, fields);
  state.foods.push(food);
  await db.put(db.STORES.foods, food);
  reindex(); emit();
  return food;
}

export async function updateFood(id, patch) {
  const food = state.foods.find((f) => f.id === id);
  if (!food) return null;
  Object.assign(food, patch);
  await db.put(db.STORES.foods, food);
  reindex(); emit();
  return food;
}

export async function deleteFood(id) {
  state.foods = state.foods.filter((f) => f.id !== id);
  await db.remove(db.STORES.foods, id);
  // Logged meals deliberately survive. They carry their own copy of the name
  // and numbers (see newMeal), so deleting a food edits your list, never your
  // history — the same rule the exercise library follows for logged sessions.
  emit();
}

/** Log a portion. Values are snapshotted so editing the food never rewrites the past. */
export async function logMeal(foodId, { amount = 1, day = dayKey(), at = Date.now() } = {}) {
  const food = state.foods.find((f) => f.id === foodId);
  if (!food) return null;

  const meal = newMeal(db.uid, food, { amount, day, at });
  state.meals.unshift(meal);
  food.uses = (food.uses || 0) + 1;

  await Promise.all([
    db.put(db.STORES.meals, meal),
    db.put(db.STORES.foods, food),
  ]);
  reindex(); emit();
  return meal;
}

export async function deleteMeal(id) {
  state.meals = state.meals.filter((m) => m.id !== id);
  await db.remove(db.STORES.meals, id);
  emit();
}

export function mealsOn(day = dayKey()) {
  return state.meals.filter((m) => m.day === day).sort((a, b) => a.at - b.at);
}

// ---------- bodyweight ----------

export async function logBodyweight(weight, date = Date.now()) {
  const day = new Date(date); day.setHours(12, 0, 0, 0);
  const existing = state.bodyweight.find(
    (b) => new Date(b.date).toDateString() === day.toDateString());
  const rec = existing
    ? { ...existing, weight: Number(weight) }
    : { id: db.uid('bw_'), date: day.getTime(), weight: Number(weight) };
  if (existing) Object.assign(existing, rec);
  else state.bodyweight.push(rec);
  await db.put(db.STORES.bodyweight, rec);
  reindex(); emit();
  return rec;
}

export async function deleteBodyweight(id) {
  state.bodyweight = state.bodyweight.filter((b) => b.id !== id);
  await db.remove(db.STORES.bodyweight, id);
  emit();
}

// ---------- backup ----------

/**
 * Whether it is time to nag about a backup, and why.
 *
 * The export has always existed; what was missing was the reminder. On an
 * installed home-screen web app the data is reasonably safe from eviction —
 * what it is not safe from is deleting the app, losing the phone, or a restore
 * going sideways, and none of those give you a warning first.
 */
export const BACKUP_AFTER_WORKOUTS = 10;
export const BACKUP_AFTER_DAYS = 28;

export function backupStatus() {
  const last = Number(state.settings.lastExportAt) || 0;
  const finished = state.sessions.filter((s) => s.finishedAt);
  if (!finished.length) return { due: false, since: 0, days: 0, last };

  const since = finished.filter((s) => s.finishedAt > last).length;
  const days = last ? Math.floor((Date.now() - last) / 86400000) : null;

  if (!last) {
    return { due: finished.length >= 3, since, days, last, reason: 'never' };
  }
  if (since >= BACKUP_AFTER_WORKOUTS) return { due: true, since, days, last, reason: 'workouts' };
  if (days >= BACKUP_AFTER_DAYS && since > 0) return { due: true, since, days, last, reason: 'time' };
  return { due: false, since, days, last };
}

export async function markExported() {
  await setSetting('lastExportAt', Date.now());
}

export function exportData() {
  return {
    format: 'liftlog-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    exercises: state.exercises,
    routines: state.routines,
    plans: state.plans,
    sessions: state.sessions,
    bodyweight: state.bodyweight,
    foods: state.foods,
    meals: state.meals,
  };
}

export async function importData(payload, { replace = true } = {}) {
  if (!payload || payload.format !== 'liftlog-backup') {
    throw new Error('Not a LiftLog backup file.');
  }
  if (replace) {
    await Promise.all(Object.values(db.STORES).map((s) => db.clear(s)));
  }
  const settingRows = Object.entries(payload.settings || {}).map(([key, value]) => ({ key, value }));
  // `plans` was missing from both sides of this until now: exportData never
  // wrote it and importData never read it, so restoring a backup silently
  // dropped every training plan. Older backup files simply have no `plans` key
  // and fall through to the empty array.
  await Promise.all([
    db.putMany(db.STORES.exercises, payload.exercises || []),
    db.putMany(db.STORES.routines, payload.routines || []),
    db.putMany(db.STORES.plans, payload.plans || []),
    db.putMany(db.STORES.sessions, payload.sessions || []),
    db.putMany(db.STORES.bodyweight, payload.bodyweight || []),
    db.putMany(db.STORES.foods, payload.foods || []),
    db.putMany(db.STORES.meals, payload.meals || []),
    db.putMany(db.STORES.settings, settingRows),
  ]);
  await load();
}
