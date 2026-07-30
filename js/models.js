// Data model, seed library, and the derived-stat maths.

import { LIBRARY as LIBRARY_MAIN } from './exercise-library.js';
import { LIBRARY_EXTRA } from './exercise-extra.js';
import { CONTRIB, ANATOMY } from './standards.js';

// free-exercise-db catalogue plus the everkinetic exercises adopted for their art
const LIBRARY = [...LIBRARY_MAIN, ...LIBRARY_EXTRA];

export const MUSCLES = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Other',
];

export const DEFAULT_SETTINGS = {
  units: 'kg',            // 'kg' | 'lb'
  restSeconds: 180,
  autoStartRest: true,
  soundOnRestEnd: true,
  showRatings: true,      // strength tiers can be demotivating — let them be hidden
  showStars: true,        // exercise/plan quality stars, separate from the tiers
  logRir: true,           // reps-in-reserve column on the set row
  // What a newly added plan exercise starts at. 2 x 6-10 is the app's default
  // for reasons documented in plan-builder.js, but it is a preference, not a
  // finding — someone running 3 x 8-12 should not have to retype it every time.
  defaultSets: 2,
  defaultReps: '6-10',
  // What the empty bar weighs, for the plate maths. null means "the standard
  // Olympic bar for the current unit" — a setting rather than a constant
  // because training bars, women's bars and safety-squat bars all differ.
  barWeight: null,
  // Profile. sex and bodyweight drive the strength standards; height is
  // recorded for reference only and is deliberately not used in any rating
  // (no published standard normalises by height).
  sex: null,              // 'male' | 'female' | null
  age: null,
  height: null,           // cm
  activePlanId: null,
};

/** name | muscle | equipment */
const SEED = [
  ['Barbell Bench Press', 'Chest', 'Barbell'],
  ['Incline Barbell Bench Press', 'Chest', 'Barbell'],
  ['Dumbbell Bench Press', 'Chest', 'Dumbbell'],
  ['Incline Dumbbell Press', 'Chest', 'Dumbbell'],
  ['Cable Fly', 'Chest', 'Cable'],
  ['Pec Deck', 'Chest', 'Machine'],
  ['Push-Up', 'Chest', 'Bodyweight'],
  ['Dip', 'Chest', 'Bodyweight'],

  ['Deadlift', 'Back', 'Barbell'],
  ['Barbell Row', 'Back', 'Barbell'],
  ['Pendlay Row', 'Back', 'Barbell'],
  ['Dumbbell Row', 'Back', 'Dumbbell'],
  ['Pull-Up', 'Back', 'Bodyweight'],
  ['Chin-Up', 'Back', 'Bodyweight'],
  ['Lat Pulldown', 'Back', 'Cable'],
  ['Seated Cable Row', 'Back', 'Cable'],
  ['T-Bar Row', 'Back', 'Machine'],
  ['Face Pull', 'Back', 'Cable'],
  ['Rack Pull', 'Back', 'Barbell'],

  ['Overhead Press', 'Shoulders', 'Barbell'],
  ['Seated Dumbbell Press', 'Shoulders', 'Dumbbell'],
  ['Arnold Press', 'Shoulders', 'Dumbbell'],
  ['Lateral Raise', 'Shoulders', 'Dumbbell'],
  ['Cable Lateral Raise', 'Shoulders', 'Cable'],
  ['Rear Delt Fly', 'Shoulders', 'Dumbbell'],
  ['Upright Row', 'Shoulders', 'Barbell'],

  ['Barbell Curl', 'Biceps', 'Barbell'],
  ['Dumbbell Curl', 'Biceps', 'Dumbbell'],
  ['Hammer Curl', 'Biceps', 'Dumbbell'],
  ['Incline Dumbbell Curl', 'Biceps', 'Dumbbell'],
  ['Preacher Curl', 'Biceps', 'Machine'],
  ['Cable Curl', 'Biceps', 'Cable'],

  ['Close-Grip Bench Press', 'Triceps', 'Barbell'],
  ['Skull Crusher', 'Triceps', 'Barbell'],
  ['Triceps Pushdown', 'Triceps', 'Cable'],
  ['Overhead Cable Extension', 'Triceps', 'Cable'],
  ['Dumbbell Kickback', 'Triceps', 'Dumbbell'],

  ['Back Squat', 'Quads', 'Barbell'],
  ['Front Squat', 'Quads', 'Barbell'],
  ['Hack Squat', 'Quads', 'Machine'],
  ['Leg Press', 'Quads', 'Machine'],
  ['Bulgarian Split Squat', 'Quads', 'Dumbbell'],
  ['Walking Lunge', 'Quads', 'Dumbbell'],
  ['Leg Extension', 'Quads', 'Machine'],

  ['Romanian Deadlift', 'Hamstrings', 'Barbell'],
  ['Stiff-Leg Deadlift', 'Hamstrings', 'Barbell'],
  ['Lying Leg Curl', 'Hamstrings', 'Machine'],
  ['Seated Leg Curl', 'Hamstrings', 'Machine'],
  ['Good Morning', 'Hamstrings', 'Barbell'],
  ['Nordic Curl', 'Hamstrings', 'Bodyweight'],

  ['Hip Thrust', 'Glutes', 'Barbell'],
  ['Glute Bridge', 'Glutes', 'Barbell'],
  ['Cable Kickback', 'Glutes', 'Cable'],
  ['Sumo Deadlift', 'Glutes', 'Barbell'],

  ['Standing Calf Raise', 'Calves', 'Machine'],
  ['Seated Calf Raise', 'Calves', 'Machine'],

  ['Plank', 'Core', 'Bodyweight'],
  ['Hanging Leg Raise', 'Core', 'Bodyweight'],
  ['Cable Crunch', 'Core', 'Cable'],
  ['Ab Wheel Rollout', 'Core', 'Bodyweight'],
  ['Russian Twist', 'Core', 'Dumbbell'],

  // Machine work. The imported catalogue is heavy on barbell, dumbbell and
  // cable and thin on machines — 72 of 850 entries — which leaves anyone who
  // trains in a machine-equipped gym typing their own. These carry hand-written
  // anatomy from CONTRIB_EXTRA, and deliberately no strength standard.
  ['Machine Chest Press', 'Chest', 'Machine'],
  ['Incline Machine Press', 'Chest', 'Machine'],
  ['Machine Chest Fly', 'Chest', 'Machine'],
  ['Smith Machine Bench Press', 'Chest', 'Machine'],
  ['Machine Dip', 'Triceps', 'Machine'],

  ['Chest-Supported T-Bar Row', 'Back', 'Machine'],
  ['Chest-Supported Row', 'Back', 'Machine'],
  ['Close-Grip Seated Row', 'Back', 'Machine'],
  ['Machine Row', 'Back', 'Machine'],
  ['Machine High Row', 'Back', 'Machine'],
  ['Machine Pullover', 'Back', 'Machine'],
  ['Assisted Pull-Up Machine', 'Back', 'Machine'],

  ['Machine Shoulder Press', 'Shoulders', 'Machine'],
  ['Machine Lateral Raise', 'Shoulders', 'Machine'],
  ['Machine Rear Delt Fly', 'Shoulders', 'Machine'],

  ['Machine Biceps Curl', 'Biceps', 'Machine'],
  ['Machine Preacher Curl', 'Biceps', 'Machine'],
  ['Machine Triceps Extension', 'Triceps', 'Machine'],

  ['Smith Machine Squat', 'Quads', 'Machine'],
  ['Machine Hip Abduction', 'Glutes', 'Machine'],
  ['Machine Hip Adduction', 'Quads', 'Machine'],
  ['Machine Back Extension', 'Hamstrings', 'Machine'],
  ['Machine Crunch', 'Core', 'Machine'],
];

/** Coarse muscle -> body-map regions, for the curated seed entries. */
const COARSE_REGIONS = {
  Chest: ['chest'], Back: ['lats'], Shoulders: ['delts-front'],
  Biceps: ['biceps'], Triceps: ['triceps'], Quads: ['quads'],
  Hamstrings: ['hamstrings'], Glutes: ['glutes'], Calves: ['calves'],
  Core: ['abs'], Other: [],
};

/**
 * Regions for an exercise the user typed in themselves. Coarse, but a coarse
 * answer is what makes a custom exercise visible at all: without regions it
 * contributes nothing to the muscle map, nothing to a plan's volume and scores
 * as a no-muscle movement in the exercise rating.
 */
export function regionsForMuscle(muscle) {
  return [...(COARSE_REGIONS[muscle] || [])];
}

/** Bumped whenever the bundled catalogue changes, to top up existing installs. */
export const LIBRARY_VERSION = 8;

/**
 * Bumped for one-off repairs to *stored* records, independently of the
 * catalogue. Separate from LIBRARY_VERSION on purpose: a data fix must run even
 * when the exercise list itself has not changed, and bumping the catalogue
 * version to trigger a migration would re-run the top-up for no reason.
 */
export const DATA_VERSION = 2;

/**
 * The curated list first — the strength standards are keyed by those exact
 * names, so they stay canonical — then everything from the imported catalogue
 * whose name doesn't already exist.
 */
const STOPWORDS = new Set(['with', 'the', 'a', 'on', 'and', 'to', 'of', 'for']);

function tokenSet(name) {
  const out = new Set();
  for (let w of String(name).toLowerCase().split(/[^a-z0-9]+/)) {
    if (!w || STOPWORDS.has(w)) continue;
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    out.add(w);
  }
  return out;
}

/**
 * Borrow *written steps only* from the closest catalogue entry, at a strict
 * threshold.
 *
 * Anatomy is deliberately never borrowed. A fuzzy name match is good enough to
 * lend prose but not to assign muscles — an early version of this inferred
 * "Deadlift -> lats" and "Barbell Row -> front delts", which would quietly
 * corrupt the muscle map. Regions come from CONTRIB (hand-written, per lift)
 * or the coarse fallback, never from a guess.
 */
function borrowInstructions(name) {
  const want = tokenSet(name);
  if (!want.size) return [];
  let best = null, score = 0;
  for (const item of LIBRARY) {
    if (!item.i || !item.i.length) continue;
    const have = tokenSet(item.n);
    let inter = 0;
    for (const t of want) if (have.has(t)) inter++;
    if (!inter) continue;
    const j = inter / (want.size + have.size - inter);
    if (j > score) { score = j; best = item; }
  }
  return score >= 0.7 && best ? best.i : [];
}

/**
 * Regions for a curated lift: the hand-written anatomy table first, coarse
 * fallback after.
 *
 * ANATOMY covers both benchmark lifts and the curated machine movements. Having
 * accurate regions and having a strength standard are separate questions, and
 * this only answers the first — see standards.js for why machines get one and
 * not the other.
 */
function regionsFor(name, muscle) {
  const contrib = ANATOMY[name];
  if (contrib) {
    const entries = Object.entries(contrib).sort((a, b) => b[1] - a[1]);
    return {
      primary: entries.filter(([, w]) => w >= 0.9).map(([r]) => r),
      secondary: entries.filter(([, w]) => w < 0.9).map(([r]) => r),
    };
  }
  return { primary: COARSE_REGIONS[muscle] || [], secondary: [] };
}

export function seedExercises(uid) {
  const out = SEED.map(([name, muscle, equipment]) => {
    const { primary, secondary } = regionsFor(name, muscle);
    return {
      id: uid('ex_'),
      name, muscle, equipment,
      primary, secondary,
      instructions: borrowInstructions(name),
      // Curated lifts carry no mechanic flag of their own. Without this they
      // score below imported variants in the plan generator, which is how a
      // plan ends up recommending "Bodyweight Flyes" over the bench press.
      // Benchmarks stay compound unconditionally: without an explicit flag they
      // rank below obscure imported variants in the plan generator, which is
      // how a plan once recommended "Bodyweight Flyes" over the bench press.
      // Curated machine work gets the honest region-count rule instead.
      mech: CONTRIB[name] ? 'compound' : (primary.length + secondary.length >= 3 ? 'compound' : 'isolation'),
      level: null,
      isCustom: false,
      createdAt: Date.now(),
    };
  });

  const taken = new Set(out.map((e) => normName(e.name)));
  for (const item of LIBRARY) {
    const key = normName(item.n);
    if (taken.has(key)) continue;
    taken.add(key);
    const refined = refineRegions(item.n, item.p || [], item.s || []);
    out.push({
      id: uid('ex_'),
      name: item.n,
      muscle: item.m,
      equipment: item.e,
      primary: refined.primary,
      secondary: refined.secondary,
      instructions: item.i || [],
      mech: item.mech || null,
      level: item.lvl || null,
      isCustom: false,
      createdAt: Date.now(),
    });
  }
  return out;
}

export function normName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * free-exercise-db files every deltoid movement under one "shoulders" bucket,
 * so reverse flyes and face pulls arrive tagged as *front* delts. Left alone
 * that leaves only two rear-delt exercises in the whole catalogue, which starves
 * the plan generator and makes the muscle map wrong.
 *
 * Matching on the movement name is crude but the names are unusually explicit
 * here — "Rear Delt Fly", "Reverse Machine Flyes", "Face Pull".
 */
const REAR_DELT = /(rear[- ]?delt|reverse (machine )?(fly|flye)|rear (lateral|fly)|face pull|bent[- ]?over (lateral|reverse))/i;

export function refineRegions(name, primary = [], secondary = []) {
  if (!REAR_DELT.test(name)) return { primary, secondary };
  const p = ['delts-rear', ...primary.filter((r) => r !== 'delts-front' && r !== 'delts-rear')];
  const s = secondary.filter((r) => r !== 'delts-rear');
  return { primary: p, secondary: s };
}

// ---------- factories ----------

export function newSession(uid, { name = 'Workout', planId = null, dayId = null, entries = [] } = {}) {
  return {
    id: uid('s_'),
    planId,
    dayId,
    name,
    startedAt: Date.now(),
    finishedAt: null,
    notes: '',
    entries,
  };
}

export function newEntry(exerciseId, sets = []) {
  return { exerciseId, sets, note: '' };
}

/**
 * One entry in your own food list.
 *
 * Deliberately source-agnostic: name, portion, protein, calories. An item typed
 * by hand, filled in from a barcode lookup, or drafted from a photo all end up
 * as the same record, so where the numbers came from never constrains what the
 * app can do with them. `source` is recorded for honesty, not for logic.
 */
export function newFood(uid, {
  name, portion, portionGrams, protein, kcal,
  carbs = null, fat = null, fibre = null,
  source = 'manual', barcode = null, per100 = null,
}) {
  return {
    id: uid('f_'),
    name: String(name).trim(),
    portion: (portion || '1 Portion').trim(),   // human label: "100 g", "1 Scoop"
    portionGrams: Number(portionGrams) || null, // optional, for scaling later
    protein: Math.max(0, Number(protein) || 0),
    kcal: Math.max(0, Number(kcal) || 0),
    // Carbs, fat and fibre stay nullable, and null is not zero. A food logged
    // before these fields existed, or typed off a label that only lists protein,
    // genuinely has no value here — counting it as 0 g would quietly understate
    // every day it appears in. The totals carry the gap instead.
    carbs: optionalGrams(carbs),
    fat: optionalGrams(fat),
    fibre: optionalGrams(fibre),
    source,                                     // 'manual' | 'barcode' | 'photo'
    // Kept so a second lookup of the same product answers from this list
    // instead of the network, and so the portion can be re-scaled later without
    // asking Open Food Facts again.
    barcode,
    per100,
    uses: 0,
    createdAt: Date.now(),
  };
}

/** Meal slots. Purely organisational — nothing in the app scores timing. */
export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

/** A portion actually eaten. Values are copied, not referenced — see store.js. */
export function newMeal(uid, food, { amount = 1, day = dayKey(), at = Date.now(), slot = null } = {}) {
  const n = Number(amount) || 1;
  const scale = (v) => (v === null || v === undefined ? null : Math.round(v * n * 10) / 10);
  return {
    id: uid('m_'),
    day,                       // 'YYYY-MM-DD', local
    at,
    slot: MEAL_SLOTS.includes(slot) ? slot : slotFor(at),
    foodId: food.id,
    name: food.name,
    portion: food.portion,
    amount: n,
    protein: food.protein * n,
    kcal: food.kcal * n,
    carbs: scale(food.carbs ?? null),
    fat: scale(food.fat ?? null),
    fibre: scale(food.fibre ?? null),
  };
}

/**
 * A default slot from the clock, so logging stays one tap.
 *
 * Boundaries are a convention about when people eat, nothing more — the app
 * never scores meal timing, because total daily intake matters far more than
 * distribution and the "anabolic window" is largely debunked. It is a way to
 * group a list, and every entry can be moved by hand.
 */
export function slotFor(ts = Date.now()) {
  const h = new Date(ts).getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

const optionalGrams = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : null;
};

/** Local calendar day as 'YYYY-MM-DD'. Local, not UTC — a 23:00 snack is today. */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function newSet(prev = null) {
  return {
    weight: prev ? prev.weight : null,
    reps: prev ? prev.reps : null,
    // Reps in reserve. Deliberately NOT carried over from the previous set —
    // weight and reps are a plan you repeat, effort is an observation you make
    // after the fact, and pre-filling it would turn it into a default nobody
    // corrects.
    rir: null,
    type: 'working',   // 'working' | 'warmup'
    done: false,
  };
}

// ---------- maths ----------

/** Epley estimated one-rep max. A single rep is just the weight itself. */
export function e1rm(weight, reps) {
  const w = Number(weight), r = Number(reps);
  if (!w || !r || r < 1) return 0;
  if (r === 1) return w;
  return w * (1 + r / 30);
}

export function isCounted(set) {
  return set.done && set.type === 'working' && Number(set.reps) > 0;
}

export function setVolume(set) {
  return (Number(set.weight) || 0) * (Number(set.reps) || 0);
}

export function entryStats(entry) {
  const counted = entry.sets.filter(isCounted);
  let volume = 0, topWeight = 0, best = 0, reps = 0;
  for (const s of counted) {
    volume += setVolume(s);
    topWeight = Math.max(topWeight, Number(s.weight) || 0);
    best = Math.max(best, e1rm(s.weight, s.reps));
    reps += Number(s.reps) || 0;
  }
  return { sets: counted.length, volume, topWeight, e1rm: best, reps };
}

export function sessionStats(session) {
  let volume = 0, sets = 0, reps = 0;
  for (const e of session.entries) {
    const st = entryStats(e);
    volume += st.volume; sets += st.sets; reps += st.reps;
  }
  const durationMs = (session.finishedAt || Date.now()) - session.startedAt;
  return { volume, sets, reps, durationMs, exercises: session.entries.length };
}

/**
 * The most recent *completed* session that contains real work for this exercise.
 * This is what powers the "last time" line — the single most important number on
 * the logging screen.
 */
export function lastPerformance(sessions, exerciseId, excludeSessionId = null) {
  for (const s of sessions) {
    if (!s.finishedAt) continue;
    if (s.id === excludeSessionId) continue;
    const entry = s.entries.find((e) => e.exerciseId === exerciseId);
    if (!entry) continue;
    const counted = entry.sets.filter(isCounted);
    if (!counted.length) continue;
    return { session: s, entry, sets: counted, stats: entryStats(entry) };
  }
  return null;
}

/** One point per session for a given exercise, oldest first. */
export function exerciseSeries(sessions, exerciseId) {
  const pts = [];
  for (const s of sessions) {
    if (!s.finishedAt) continue;
    const entry = s.entries.find((e) => e.exerciseId === exerciseId);
    if (!entry) continue;
    const st = entryStats(entry);
    if (!st.sets) continue;
    pts.push({ t: s.startedAt, sessionId: s.id, ...st });
  }
  return pts.sort((a, b) => a.t - b.t);
}

export function startOfWeek(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;   // Monday = 0
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

/**
 * Working sets per muscle group, bucketed by ISO week.
 * Weekly set count is the metric that actually tracks hypertrophy stimulus.
 */
export function weeklyMuscleSets(sessions, exerciseById, weeks = 8) {
  const buckets = [];
  // Stepping by calendar days rather than subtracting 7 x 86400000: across a
  // DST change a fixed-millisecond week is an hour off midnight, the bucket key
  // stops matching startOfWeek() below, and a whole week of training silently
  // vanishes from the chart. Twice a year, which is exactly often enough to be
  // baffling and rare enough never to get reported.
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(startOfWeek(Date.now()));
    d.setDate(d.getDate() - i * 7);
    buckets.push({ week: startOfWeek(d.getTime()), byMuscle: {}, total: 0 });
  }
  const index = new Map(buckets.map((b) => [b.week, b]));

  for (const s of sessions) {
    if (!s.finishedAt) continue;
    const wk = startOfWeek(s.startedAt);
    const bucket = index.get(wk);
    if (!bucket) continue;
    for (const e of s.entries) {
      const ex = exerciseById.get(e.exerciseId);
      const muscle = ex ? ex.muscle : 'Other';
      const n = e.sets.filter(isCounted).length;
      if (!n) continue;
      bucket.byMuscle[muscle] = (bucket.byMuscle[muscle] || 0) + n;
      bucket.total += n;
    }
  }
  return buckets;
}

/** Best-ever e1RM, top weight and rep count per exercise. */
export function personalRecords(sessions, exerciseId) {
  let bestE1rm = null, bestWeight = null, bestReps = null, bestVolume = null;
  for (const s of sessions) {
    if (!s.finishedAt) continue;
    const entry = s.entries.find((e) => e.exerciseId === exerciseId);
    if (!entry) continue;
    const st = entryStats(entry);
    if (!st.sets) continue;
    if (!bestVolume || st.volume > bestVolume.value) bestVolume = { value: st.volume, at: s.startedAt };
    for (const set of entry.sets.filter(isCounted)) {
      const est = e1rm(set.weight, set.reps);
      const w = Number(set.weight) || 0, r = Number(set.reps) || 0;
      if (!bestE1rm || est > bestE1rm.value) bestE1rm = { value: est, at: s.startedAt, weight: w, reps: r };
      if (!bestWeight || w > bestWeight.value) bestWeight = { value: w, at: s.startedAt, reps: r };
      if (!bestReps || r > bestReps.value) bestReps = { value: r, at: s.startedAt, weight: w };
    }
  }
  return { e1rm: bestE1rm, weight: bestWeight, reps: bestReps, volume: bestVolume };
}

/**
 * Best estimated 1RM ever achieved per exercise, keyed by exercise *name*
 * (the strength-standard tables are keyed by name, not id).
 * @returns {Map<string, number>}
 */
export function bestOneRepMaxByName(sessions, exerciseById) {
  const best = new Map();
  for (const s of sessions) {
    if (!s.finishedAt) continue;
    for (const entry of s.entries) {
      const ex = exerciseById.get(entry.exerciseId);
      if (!ex) continue;
      for (const set of entry.sets.filter(isCounted)) {
        const est = e1rm(set.weight, set.reps);
        if (est > (best.get(ex.name) || 0)) best.set(ex.name, est);
      }
    }
  }
  return best;
}

/** Least-squares fit over [x, y] pairs → { slope, intercept } or null. */
export function linearFit(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const [x, y] of points) { sx += x; sy += y; sxy += x * y; sxx += x * x; }
  const denom = n * sxx - sx * sx;
  if (!denom) return null;
  const slope = (n * sxy - sx * sy) / denom;
  return { slope, intercept: (sy - slope * sx) / n };
}
