// Single source of truth. Screens read `state` and call actions; actions persist
// to IndexedDB and notify subscribers.

import * as idb from './db.js';
import {
  DEFAULT_SETTINGS, seedExercises, newSession, newEntry, newSet,
  newFood, newMeal, newTemplate, dayKey, latestWeight,
  LIBRARY_VERSION, DATA_VERSION, normName, regionsForMuscle,
  estimatePlanDuration,
} from './models.js';
import { buildPlanDays, SETS_PER_EXERCISE, REP_TARGET } from './plan-builder.js';
import { DEFAULT_BAR } from './plates.js';
import { t } from './i18n.js';

/**
 * Every write goes through this wrapper, so a failed one can never be silent.
 *
 * The failure mode it exists for: an action changes `state` first and persists
 * afterwards, which is what keeps the UI instant. If the write then fails —
 * quota exhausted, the origin evicted, private browsing — the screen shows a
 * set as logged that never reached the disk, and it disappears at the next
 * launch. Silent data loss that looks like success is the worst thing a
 * training log can do, so the failure is recorded on `state.storageError`,
 * every subscriber is notified, and the error still propagates to the caller.
 *
 * Reads are passed through untouched; a failed read already shows up as a
 * screen that will not load.
 */
const db = {
  ...idb,
  put: (store, value) => guard(() => idb.put(store, value)),
  putMany: (store, values) => guard(() => idb.putMany(store, values)),
  remove: (store, key) => guard(() => idb.remove(store, key)),
  clear: (store) => guard(() => idb.clear(store)),
};

async function guard(run) {
  try {
    const out = await run();
    // A write that works clears the warning — no point nagging about a full
    // disk after the user has freed some.
    if (state.storageError) { state.storageError = null; emit(); }
    return out;
  } catch (err) {
    console.error('[liftlog] write failed', err);
    state.storageError = {
      at: Date.now(),
      // Safari reports a full quota under two different names depending on
      // version; both mean "delete something or export".
      quota: !!err && (err.name === 'QuotaExceededError' || err.code === 22),
      message: (err && err.message) || String(err),
    };
    emit();
    throw err;
  }
}

export const state = {
  ready: false,
  exercises: [],
  plans: [],
  sessions: [],       // newest first, includes the in-progress one
  bodyweight: [],     // newest first
  foods: [],          // the user's own food list
  water: [],          // one row per day: { day, ml }
  templates: [],      // saved meals: a name and a list of foods
  meals: [],          // newest first
  settings: { ...DEFAULT_SETTINGS },
  exerciseById: new Map(),
  // Set by `guard` when a write fails; cleared by the next one that works.
  storageError: null,
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
  state.templates.sort((a, b) => (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name));
}

export async function load() {
  const [exercises, plans, sessions, bodyweight, foods, meals, water, templates, settingsRows] = await Promise.all([
    db.getAll(db.STORES.exercises),
    db.getAll(db.STORES.plans),
    db.recentSessions(0),
    db.getAll(db.STORES.bodyweight),
    db.getAll(db.STORES.foods),
    db.getAll(db.STORES.meals),
    db.getAll(db.STORES.water),
    db.getAll(db.STORES.templates),
    db.getAll(db.STORES.settings),
  ]);

  state.exercises = exercises;
  state.plans = plans;
  state.sessions = sessions;
  state.bodyweight = bodyweight;
  state.foods = foods;
  state.meals = meals;
  state.water = water;
  state.templates = templates;
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
  markWorkoutOpen();
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
 *
 * v3 — repair catalogue metadata: Bodyweight Flyes used rolling EZ-bars as
 * handles and was incorrectly filtered/scored as a barbell exercise; imported
 * instruction headings also appeared as literal HTML text. Hip adduction gets
 * its real target region instead of an empty muscle map.
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

  if (from < 3) {
    const seedByName = new Map(seedExercises(db.uid).map((e) => [normName(e.name), e]));
    const repaired = [];
    for (const ex of state.exercises) {
      const match = seedByName.get(normName(ex.name));
      if (!match || ex.isCustom) continue;
      let changed = false;
      if (/bodyweight (fly|flye)/i.test(ex.name) && ex.equipment !== 'Bodyweight') {
        ex.equipment = 'Bodyweight';
        changed = true;
      }
      if (ex.name === 'Machine Hip Adduction' && !(ex.primary || []).includes('adductors')) {
        ex.primary = match.primary;
        ex.secondary = match.secondary;
        changed = true;
      }
      if ((ex.instructions || []).some((step) => /<[^>]+>/.test(step))) {
        ex.instructions = match.instructions;
        changed = true;
      }
      if (changed) repaired.push(ex);
    }
    if (repaired.length) await db.putMany(db.STORES.exercises, repaired);
  }

  state.settings.dataVersion = DATA_VERSION;
  await db.put(db.STORES.settings, { key: 'dataVersion', value: DATA_VERSION });
}

export function activeSession() {
  return state.sessions.find((s) => !s.finishedAt) || null;
}

const INSTALLATION_KEY = 'liftlog.installationId';
export function installationId() {
  try {
    let id = localStorage.getItem(INSTALLATION_KEY);
    if (!id) { id = db.uid('install_'); localStorage.setItem(INSTALLATION_KEY, id); }
    return id;
  } catch {
    return 'installation-unavailable';
  }
}

const WORKOUT_OPEN_KEY = 'liftlog.workoutOpen';

/**
 * Publish "a workout is open" outside the module graph.
 *
 * The reader is `js/bootstrap.js`, which decides whether a service-worker
 * update may reload the page, and which deliberately imports nothing so it can
 * still run when the module graph is half-cached. localStorage is the only
 * channel both ends can reach, and the value is the session's start time so a
 * reader can tell an actual workout from one nobody ever closed.
 *
 * Called at the four points where the answer can change, not from `emit`: this
 * is a synchronous write and `emit` fires on every logged set.
 */
function markWorkoutOpen() {
  const open = activeSession();
  try {
    if (open) localStorage.setItem(WORKOUT_OPEN_KEY, String(open.startedAt));
    else localStorage.removeItem(WORKOUT_OPEN_KEY);
  } catch { /* private mode: updates reload exactly as they did before */ }
}

/**
 * How long a workout has been open, past the point where it is plausible.
 *
 * Nothing ever closes a session by itself, and `startSession` hands back the
 * open one rather than starting a second — which is right during a workout and
 * wrong three days later, when it quietly means you cannot start anything and
 * the elapsed clock reads 72h. Twelve hours is not a rule about training, just
 * longer than any session anyone actually does.
 */
export const STALE_SESSION_HOURS = 12;

export function staleSession() {
  const open = activeSession();
  if (!open) return null;
  const hours = (Date.now() - open.startedAt) / 3600000;
  return hours >= STALE_SESSION_HOURS ? { session: open, hours } : null;
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

/** The bar the plate maths assumes, falling back to the standard for the unit. */
export const barWeight = () => {
  const set = Number(state.settings.barWeight);
  return set > 0 ? set : DEFAULT_BAR[units()] ?? DEFAULT_BAR.kg;
};

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
  const removed = state.exercises.find((e) => e.id === id);
  state.exercises = state.exercises.filter((e) => e.id !== id);
  await db.remove(db.STORES.exercises, id);
  if (removed) await recordDeletion('exercises', id, removed.updatedAt || removed.createdAt);
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
  const persisted = plan.id ? await db.get(db.STORES.plans, plan.id) : null;
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
  if (persisted && JSON.stringify(persisted.days) !== JSON.stringify(rec.days)) {
    const versions = { ...(state.settings.planVersions || {}) };
    const rows = [...(versions[rec.id] || []), {
      savedAt: Date.now(), name: persisted.name, days: persisted.days,
      repTarget: persisted.repTarget, perWeek: persisted.perWeek,
    }].slice(-10);
    versions[rec.id] = rows;
    state.settings.planVersions = versions;
    await db.put(db.STORES.settings, { key: 'planVersions', value: versions });
  }
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
  const removed = state.plans.find((p) => p.id === id);
  state.plans = state.plans.filter((p) => p.id !== id);
  await db.remove(db.STORES.plans, id);
  if (removed) await recordDeletion('plans', id, removed.updatedAt || removed.createdAt);
  if (state.settings.activePlanId === id) {
    await setSetting('activePlanId', state.plans.length ? state.plans[0].id : null);
  } else {
    emit();
  }
}

// ---------- sessions ----------

async function persistSession(session) {
  session.updatedAt = Date.now();
  await db.put(db.STORES.sessions, session);
  emit();
}

export async function startSession({ planId = null, dayId = null, name } = {}) {
  const existing = activeSession();
  if (existing) return existing;

  // A session is either seeded from a plan day or started empty.
  let items = null;
  let label = null;

  if (planId && dayId) {
    const plan = state.plans.find((p) => p.id === planId);
    const day = plan && plan.days.find((d) => d.id === dayId);
    if (day) { items = day.items; label = `${day.name}`; }
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
      progressionRule: item.progressionRule || 'double',
      alternativeExerciseId: item.alternativeExerciseId || null,
    };
  });

  const session = newSession(db.uid, {
    planId,
    dayId,
    // Translated at creation time, then it is data like any other name the
    // user could have typed. A later language switch does not rewrite history.
    name: name || label || t('train.quickWorkout'),
    entries,
    plannedDurationMs: items ? estimatePlanDuration(items, state.settings.restSeconds) : null,
  });
  session.originDevice = installationId();
  state.sessions.unshift(session);
  await persistSession(session);
  markWorkoutOpen();
  return session;
}

export async function pauseSession(id) {
  return updateSession(id, (session) => {
    if (!session.finishedAt && !session.pausedAt) session.pausedAt = Date.now();
  });
}

export async function resumeSession(id) {
  return updateSession(id, (session) => {
    if (!session.pausedAt) return;
    session.pausedMs = (Number(session.pausedMs) || 0) + Math.max(0, Date.now() - session.pausedAt);
    session.pausedAt = null;
  });
}

/**
 * Mutate the live session and persist it, or leave no trace of the attempt.
 *
 * This is the one path where optimism is not affordable: it runs on every
 * completed set, mid-workout, and a set that looks logged but was never written
 * is worse than one that visibly failed — you would only find out weeks later,
 * with no way to reconstruct it. So the session is copied first and put back if
 * the write fails, which makes the screen agree with the disk again. The copy
 * is a JSON round trip on purpose: these records are plain data by definition
 * (they are also what the backup file contains), so it is exact, and it needs
 * no support for structuredClone.
 *
 * The contract that makes this work: `mutate` must contain *every* change. A
 * caller that edits the session first and then calls this with an empty
 * callback gets a snapshot of the already-changed session, and the rollback
 * silently does nothing.
 */
export async function updateSession(id, mutate) {
  const index = state.sessions.findIndex((x) => x.id === id);
  if (index === -1) return null;

  const before = JSON.parse(JSON.stringify(state.sessions[index]));
  const s = state.sessions[index];
  mutate(s);
  try {
    await persistSession(s);
  } catch {
    // guard() has already recorded the failure and notified; this only undoes
    // the optimistic change so the UI stops claiming the set was saved.
    state.sessions[index] = before;
    emit();
    return null;
  }
  return s;
}

/**
 * Persist without notifying subscribers. Used for keystroke-level edits — a
 * re-render mid-typing would blow away the focused input and the caret.
 */
export async function saveSessionQuiet(session) {
  session.updatedAt = Date.now();
  await db.put(db.STORES.sessions, session);
}

export async function finishSession(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return null;
  // Drop empty sets and exercises so history stays clean.
  s.entries = s.entries
    .map((e) => ({ ...e, sets: e.sets.filter((st) => st.done && Number(st.reps) > 0) }))
    .filter((e) => e.sets.length > 0);
  const now = Date.now();
  if (s.pausedAt) {
    s.pausedMs = (Number(s.pausedMs) || 0) + Math.max(0, now - s.pausedAt);
    s.pausedAt = null;
  }
  s.finishedAt = now;
  await persistSession(s);
  markWorkoutOpen();
  return s;
}

export async function discardSession(id) {
  const removed = state.sessions.find((s) => s.id === id);
  state.sessions = state.sessions.filter((s) => s.id !== id);
  await db.remove(db.STORES.sessions, id);
  if (removed) await recordDeletion('sessions', id, removed.updatedAt || Date.now());
  markWorkoutOpen();
  emit();
}

export async function restoreSession(session) {
  const restored = JSON.parse(JSON.stringify(session));
  restored.updatedAt = Date.now();
  state.sessions = state.sessions.filter((row) => row.id !== restored.id);
  state.sessions.push(restored);
  const deletions = (state.settings.syncDeletions || [])
    .filter((row) => !(row.collection === 'sessions' && row.id === restored.id));
  await db.put(db.STORES.settings, { key: 'syncDeletions', value: deletions });
  state.settings.syncDeletions = deletions;
  await db.put(db.STORES.sessions, restored);
  reindex(); markWorkoutOpen(); emit();
  return restored;
}

async function recordDeletion(collection, id, rowUpdatedAt = 0) {
  const previous = Number(rowUpdatedAt);
  const deletions = [...(state.settings.syncDeletions || [])
    .filter((row) => !(row.collection === collection && row.id === id)), {
      collection, id, deletedAt: Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0),
    }];
  state.settings.syncDeletions = deletions;
  await db.put(db.STORES.settings, { key: 'syncDeletions', value: deletions });
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
  food.updatedAt = Date.now();
  await db.put(db.STORES.foods, food);
  reindex(); emit();
  return food;
}

export async function deleteFood(id) {
  const removed = state.foods.find((f) => f.id === id);
  state.foods = state.foods.filter((f) => f.id !== id);
  await db.remove(db.STORES.foods, id);
  if (removed) await recordDeletion('foods', id, removed.updatedAt || removed.createdAt);
  // Logged meals deliberately survive. They carry their own copy of the name
  // and numbers (see newMeal), so deleting a food edits your list, never your
  // history — the same rule the exercise library follows for logged sessions.
  emit();
}

/** Log a portion. Values are snapshotted so editing the food never rewrites the past. */
export async function logMeal(foodId, { amount = 1, day = dayKey(), at = Date.now(), slot = null } = {}) {
  const food = state.foods.find((f) => f.id === foodId);
  if (!food) return null;

  const meal = newMeal(db.uid, food, { amount, day, at, slot });
  state.meals.unshift(meal);
  food.uses = (food.uses || 0) + 1;
  food.updatedAt = Date.now();

  await Promise.all([
    db.put(db.STORES.meals, meal),
    db.put(db.STORES.foods, food),
  ]);
  reindex(); emit();
  return meal;
}

export async function deleteMeal(id) {
  const removed = state.meals.find((m) => m.id === id);
  state.meals = state.meals.filter((m) => m.id !== id);
  await db.remove(db.STORES.meals, id);
  if (removed) await recordDeletion('meals', id, removed.updatedAt || removed.at);
  emit();
}

/** Move a logged portion between slots, or change how much of it there was. */
export async function updateMeal(id, patch) {
  const meal = state.meals.find((m) => m.id === id);
  if (!meal) return null;

  if (patch.amount !== undefined) {
    // Rescale from the per-portion values rather than the current totals, so
    // repeated edits cannot drift.
    const factor = (Number(patch.amount) || 1) / (meal.amount || 1);
    for (const key of ['protein', 'kcal', 'carbs', 'fat', 'fibre']) {
      if (meal[key] !== null && meal[key] !== undefined) {
        meal[key] = Math.round(meal[key] * factor * 10) / 10;
      }
    }
    for (const [key, value] of Object.entries(meal.micros || {})) {
      if (value !== null && value !== undefined) {
        meal.micros[key] = Math.round(value * factor * 10) / 10;
      }
    }
    meal.amount = Number(patch.amount) || 1;
  }
  if (patch.slot !== undefined) meal.slot = patch.slot;
  meal.updatedAt = Date.now();

  await db.put(db.STORES.meals, meal);
  emit();
  return meal;
}

/**
 * Copy every portion from one day onto another.
 *
 * The meals are copied as they were logged, not re-derived from the food list —
 * a day you repeat should be the day you actually ate, even if you have edited
 * the food since. Returns how many were copied.
 */
export async function copyDay(fromDay, toDay = dayKey()) {
  const source = mealsOn(fromDay);
  if (!source.length) return 0;

  const copies = source.map((m) => ({
    ...m,
    id: db.uid('m_'),
    day: toDay,
    // Same time of day, new date, so the order and the slots survive.
    at: shiftToDay(m.at, toDay),
    updatedAt: Date.now(),
  }));

  state.meals.unshift(...copies);
  await db.putMany(db.STORES.meals, copies);
  reindex(); emit();
  return copies.length;
}

function shiftToDay(at, day) {
  const from = new Date(at);
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, from.getHours(), from.getMinutes()).getTime();
}

// ---------- saved meals ----------

/**
 * Save a combination of foods under a name.
 *
 * Stores food *ids*, not values, unlike a logged meal. A logged meal is history
 * and must never move; a saved meal is a recipe, so correcting the protein on
 * your quark should carry into the next breakfast you log from it.
 */
export async function saveTemplate({ name, items, slot = null, id = null }) {
  const existing = id && state.templates.find((t) => t.id === id);
  const rec = existing
    ? { ...existing, name: String(name).trim() || existing.name, items, slot, updatedAt: Date.now() }
    : newTemplate(db.uid, { name, items, slot });

  if (existing) Object.assign(existing, rec);
  else state.templates.push(rec);

  await db.put(db.STORES.templates, rec);
  reindex(); emit();
  return rec;
}

export async function deleteTemplate(id) {
  const removed = state.templates.find((t) => t.id === id);
  state.templates = state.templates.filter((t) => t.id !== id);
  await db.remove(db.STORES.templates, id);
  if (removed) await recordDeletion('templates', id, removed.updatedAt || removed.createdAt);
  emit();
}

/**
 * Log every food in a saved meal.
 *
 * A food deleted since the template was saved is skipped and counted rather
 * than logged as a blank — the same rule the rest of the app follows for
 * references that no longer resolve. The caller can then say so.
 */
export async function logTemplate(id, { day = dayKey(), slot = null } = {}) {
  const template = state.templates.find((t) => t.id === id);
  if (!template) return null;

  let logged = 0, missing = 0;
  for (const item of template.items) {
    const meal = await logMeal(item.foodId, { day, amount: item.amount, slot: slot || template.slot });
    if (meal) logged++;
    else missing++;
  }

  template.uses = (template.uses || 0) + 1;
  template.updatedAt = Date.now();
  await db.put(db.STORES.templates, template);
  reindex(); emit();
  return { logged, missing, name: template.name };
}

// ---------- water ----------

/** Millilitres drunk on a day, 0 when nothing is recorded. */
export function waterOn(day = dayKey()) {
  const row = state.water.find((w) => w.day === day);
  return row ? row.ml : 0;
}

/** Add (or subtract) millilitres. Never goes below zero. */
export async function addWater(ml, day = dayKey()) {
  const next = Math.max(0, waterOn(day) + (Number(ml) || 0));
  const row = { day, ml: next, updatedAt: Date.now() };
  const existing = state.water.find((w) => w.day === day);
  if (existing) Object.assign(existing, row);
  else state.water.push(row);

  if (next === 0) {
    await db.remove(db.STORES.water, day);
    if (existing) await recordDeletion('water', day, existing.updatedAt);
    state.water = state.water.filter((item) => item.day !== day);
  }
  else await db.put(db.STORES.water, row);
  emit();
  return next;
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

  // Keep the profile figure in step with the log.
  //
  // The app has two bodyweights and used to keep them in step in exactly one
  // place, the profile form. Everything bodyweight-relative reads the profile
  // one: the strength score on Home, the strength tier of every lift, the
  // protein band, and through it the calorie and carb targets. The weekly
  // strength history and the maintenance estimate read the log. So weighing in
  // from the Progress screen moved one number and not the other, and the two
  // then quietly disagreed for as long as you never opened Settings.
  //
  // Only the newest entry counts, because `date` is editable: correcting last
  // Tuesday's weigh-in must not become "your weight now".
  const latest = latestWeight(state.bodyweight);
  if (latest !== null && latest !== Number(state.settings.bodyweight)) {
    await setSetting('bodyweight', latest);
  }

  reindex(); emit();
  return rec;
}

export async function deleteBodyweight(id) {
  const removed = state.bodyweight.find((b) => b.id === id);
  state.bodyweight = state.bodyweight.filter((b) => b.id !== id);
  await db.remove(db.STORES.bodyweight, id);
  if (removed) await recordDeletion('bodyweight', id, removed.updatedAt || removed.date);
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
    plans: state.plans,
    sessions: state.sessions,
    bodyweight: state.bodyweight,
    foods: state.foods,
    meals: state.meals,
    water: state.water,
    templates: state.templates,
    deletions: state.settings.syncDeletions || [],
  };
}

export async function importData(payload, { replace = true } = {}) {
  if (!payload || payload.format !== 'liftlog-backup') {
    throw new Error('Not a LiftLog backup file.');
  }
  // Check the whole file before erasing anything. A restore wipes every store
  // and then writes, so a payload that passes the format check but carries a
  // truncated or wrong-typed body used to leave you with neither the backup nor
  // what you had. Cheap to verify, impossible to undo.
  const lists = ['exercises', 'plans', 'sessions', 'bodyweight', 'foods', 'meals', 'water', 'templates', 'deletions'];
  for (const key of lists) {
    if (payload[key] !== undefined && !Array.isArray(payload[key])) {
      throw new Error(`This backup is damaged — "${key}" is not a list.`);
    }
  }
  if (payload.settings !== undefined && (typeof payload.settings !== 'object' || payload.settings === null)) {
    throw new Error('This backup is damaged — its settings are unreadable.');
  }
  if (!lists.some((key) => (payload[key] || []).length)) {
    throw new Error('This backup is empty — nothing would be restored.');
  }

  // IndexedDB would reject a missing key only after the old log had already
  // been touched. Validate every record and bound hostile/corrupt files first.
  const keyFor = {
    exercises: 'id', plans: 'id', sessions: 'id', bodyweight: 'id',
    foods: 'id', meals: 'id', water: 'day', templates: 'id', deletions: 'id',
  };
  const totalRows = lists.reduce((sum, key) => sum + (payload[key] || []).length, 0);
  if (totalRows > 100000) throw new Error('This backup contains too many records.');
  for (const key of lists) {
    for (const [index, row] of (payload[key] || []).entries()) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`This backup is damaged — "${key}" item ${index + 1} is invalid.`);
      }
      const recordKey = row[keyFor[key]];
      if ((typeof recordKey !== 'string' && typeof recordKey !== 'number') || String(recordKey).length > 256) {
        throw new Error(`This backup is damaged — "${key}" item ${index + 1} has no valid key.`);
      }
      if (key === 'deletions') {
        const allowed = ['exercises', 'plans', 'sessions', 'bodyweight', 'foods', 'meals', 'water', 'templates'];
        if (!allowed.includes(row.collection) || !Number.isFinite(Number(row.deletedAt))) {
          throw new Error(`This backup is damaged — deletion ${index + 1} is invalid.`);
        }
      }
    }
  }
  const settings = { ...(payload.settings || {}) };
  if (payload.deletions !== undefined) settings.syncDeletions = payload.deletions;
  if (Object.keys(settings).length > 500) throw new Error('This backup contains too many settings.');
  for (const key of Object.keys(settings)) {
    if (!key || key.length > 128) throw new Error('This backup contains an invalid setting name.');
  }

  const settingRows = Object.entries(settings).map(([key, value]) => ({ key, value }));
  if (replace) {
    // Everything except this device's own crypto keys.
    //
    // `keys` holds the device identity for the cloud backup: its keypair, and
    // the id the server knows it by. Those are properties of the phone, not of
    // the log, and a backup never contains them. Wiping them here meant that
    // restoring from the cloud destroyed the very thing that had just decrypted
    // the download: the device came back as a stranger, could no longer unwrap
    // its own data key, and had to be approved again or recovered.
    await db.replaceBackupData({
      [db.STORES.exercises]: payload.exercises || [],
      [db.STORES.plans]: payload.plans || [],
      [db.STORES.sessions]: payload.sessions || [],
      [db.STORES.bodyweight]: payload.bodyweight || [],
      [db.STORES.foods]: payload.foods || [],
      [db.STORES.meals]: payload.meals || [],
      [db.STORES.water]: payload.water || [],
      [db.STORES.templates]: payload.templates || [],
      [db.STORES.settings]: settingRows,
    });
    await load();
    return;
  }
  // `plans` was missing from both sides of this until now: exportData never
  // wrote it and importData never read it, so restoring a backup silently
  // dropped every training plan. Older backup files simply have no `plans` key
  // and fall through to the empty array.
  await Promise.all([
    db.putMany(db.STORES.exercises, payload.exercises || []),
    db.putMany(db.STORES.plans, payload.plans || []),
    db.putMany(db.STORES.sessions, payload.sessions || []),
    db.putMany(db.STORES.bodyweight, payload.bodyweight || []),
    db.putMany(db.STORES.foods, payload.foods || []),
    db.putMany(db.STORES.meals, payload.meals || []),
    db.putMany(db.STORES.water, payload.water || []),
    db.putMany(db.STORES.templates, payload.templates || []),
    db.putMany(db.STORES.settings, settingRows),
  ]);
  await load();
}
