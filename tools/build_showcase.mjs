// Generates a showcase backup: half a year of plausible training and four
// months of food, so every screen in the app has something real to show.
//
//   node tools/build_showcase.mjs > showcase-backup.json
//
// Why a backup file and not a "load demo data" button in Settings: importing
// replaces everything. A button that wipes your training log is one mis-tap
// away from being a disaster, and it would sit permanently in the app for the
// sake of a demo you give twice. As a file it goes through the Restore path,
// which already asks first and says what it will replace.
//
// The records come from js/models.js rather than from JSON written here by
// hand. Anything else would drift from the app's actual shape the first time a
// field is added, and would fail silently: the store does not validate records,
// it just reads fields that may not be there.
//
// Everything is derived, nothing is asserted. The maintenance estimate, the
// strength score, the stall report and the timeline all compute themselves out
// of this data, so the numbers on screen are the numbers this file implies. If
// the demo looks wrong, the data is wrong, which is the honest failure mode.

import {
  seedExercises, newSession, newEntry, newSet, newFood, newMeal, newTemplate,
  dayKey, DEFAULT_SETTINGS, normName,
} from '../js/models.js';
import { PLAN_BLUEPRINTS, buildPlanDays } from '../js/plan-builder.js';

/* ============================ determinism ============================ */

/** Seeded so re-running produces the same file; a demo should not drift. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260731);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);
const chance = (p) => rand() < p;

let counter = 0;
const uid = (prefix = '') => `${prefix}sc${(counter++).toString(36).padStart(4, '0')}`;

/* ============================== profile ============================== */

const WEEKS = 26;
const START_BW = 78.5;
const END_BW = 84.0;

// Noon, so nothing lands on a day boundary and nothing depends on the hour.
const today = new Date(); today.setHours(12, 0, 0, 0);
const dayOffset = (n) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d;
};

/* ============================= exercises ============================= */

const exercises = seedExercises(uid);
const byName = new Map(exercises.map((e) => [normName(e.name), e]));

// A few marked as favourites and personally rated, because those change what
// the library, the generator and the swap suggestions do.
for (const [name, rating] of [
  ['Barbell Bench Press', 5], ['Lat Pulldown', 4], ['Back Squat', 5],
  ['Romanian Deadlift', 4], ['Lateral Raise', 3], ['Leg Extension', 2],
  ['Upright Row', 1],
]) {
  const ex = byName.get(normName(name));
  if (!ex) continue;
  ex.myRating = rating;
  if (rating >= 4) ex.favourite = true;
}

/* =============================== plan =============================== */

const blueprint = PLAN_BLUEPRINTS.find((b) => b.key === 'pplul') || PLAN_BLUEPRINTS[0];
const days = buildPlanDays(blueprint, exercises, { sets: 2, reps: '6-10' });

// Weekdays assigned, so the Train tab, the week overview and the week card all
// have a schedule to talk about rather than falling back to "least recently
// trained". Mon/Tue/Thu/Fri/Sat.
const WEEKDAYS = [1, 2, 4, 5, 6];
days.forEach((d, i) => { d.weekday = WEEKDAYS[i] ?? null; });

const plan = {
  id: uid('p_'),
  name: blueprint.name,
  presetKey: blueprint.key,
  repTarget: '6-10',
  perWeek: blueprint.perWeek || 1,
  days,
  createdAt: dayOffset(WEEKS * 7).getTime(),
  updatedAt: today.getTime(),
};

/* ============================= training ============================= */

/**
 * Where each lift starts and how fast it climbs.
 *
 * Absolute numbers matter here: the strength tiers are bodyweight-relative, so
 * a made-up 200 kg bench would show a demo profile as Elite and make every
 * screen that mentions tiers useless. These land a well-trained-but-not-freak
 * 84 kg lifter around the middle of the scale, which is where the interesting
 * parts of the UI live.
 */
const START = {
  'Barbell Bench Press': [72.5, 1.25],
  'Back Squat': [100, 1.7],
  Deadlift: [125, 2.1],
  'Overhead Press': [47.5, 0.7],
  'Barbell Row': [70, 1.0],
  'Romanian Deadlift': [85, 1.3],
  'Pull-Up': [5, 0.6],
  'Chin-Up': [5, 0.55],
  'Lat Pulldown': [62.5, 0.95],
  'Incline Barbell Bench Press': [60, 1.0],
  'Front Squat': [72.5, 1.1],
  'Leg Press': [170, 2.8],
  'Hip Thrust': [100, 1.8],
};

/** Plausible starting load for anything not named above. */
function startWeight(ex) {
  if (START[ex.name]) return START[ex.name];
  switch (ex.equipment) {
    case 'Barbell': return [between(35, 55), between(0.6, 0.9)];
    case 'Machine': return [between(35, 70), between(0.7, 1.2)];
    case 'Cable': return [between(20, 45), between(0.4, 0.8)];
    case 'Dumbbell': return [between(10, 24), between(0.18, 0.32)];
    // Bodyweight and "other" work carries added load, which is both what people
    // actually do once they can and what keeps it out of the stall report: an
    // estimated 1RM computed from a zero weight is zero every week, and a flat
    // line at zero is indistinguishable from a lift that stopped moving.
    default: return [between(5, 14), between(0.2, 0.4)];
  }
}

const progress = new Map();
for (const day of days) {
  for (const item of day.items) {
    const ex = exercises.find((e) => e.id === item.exerciseId);
    if (ex && !progress.has(ex.id)) progress.set(ex.id, startWeight(ex));
  }
}

/**
 * Two lifts that stop moving two thirds of the way in.
 *
 * Deliberate: the stall report and the "what is moving" list are among the more
 * interesting things this app does, and with everything climbing forever they
 * both have nothing to say.
 */
const STALLS = ['Overhead Press', 'Lateral Raise'];
const stallIds = new Set(
  STALLS.map((n) => byName.get(normName(n))).filter(Boolean).map((e) => e.id));
const STALL_WEEK = Math.round(WEEKS * 0.62);

const step = (equipment) => (equipment === 'Dumbbell' ? 2 : equipment === 'Cable' ? 2.5 : 2.5);
const roundTo = (v, s) => Math.max(0, Math.round(v / s) * s);

const sessions = [];
const NOTES = [
  'Rechte Schulter hat gezwickt, Griff enger genommen.',
  'Gut geschlafen, ging leicht.',
  'Letzter Satz bis kurz vors Limit.',
  'Bank war belegt, erst nach 10 Minuten dran.',
  'Neue Schuhe, Stand fühlt sich stabiler an.',
  'Nach der Arbeit, Kopf war nicht dabei.',
  'Griffkraft war vor dem Rücken am Ende.',
];

for (let week = WEEKS - 1; week >= 0; week--) {
  for (const [dayIndex, day] of days.entries()) {
    // A missed session here and there, so streaks, "week vs plan" and the
    // consistency heatmap are not a solid block of green.
    if (chance(0.11)) continue;

    // Weekday of the plan day, counted back from today.
    const daysAgo = week * 7 + (6 - dayIndex);
    const when = dayOffset(daysAgo);
    when.setHours(17 + Math.floor(rand() * 3), Math.floor(rand() * 60), 0, 0);
    const startedAt = when.getTime();
    if (startedAt > Date.now()) continue;

    const entries = [];
    for (const item of day.items) {
      const ex = exercises.find((e) => e.id === item.exerciseId);
      if (!ex) continue;
      const [base, perWeek] = progress.get(ex.id);

      const weeksIn = WEEKS - 1 - week;
      const capped = stallIds.has(ex.id) ? Math.min(weeksIn, STALL_WEEK) : weeksIn;
      const target = base + capped * perWeek;
      const s = step(ex.equipment);
      const working = roundTo(target * between(0.97, 1.02), s);

      const sets = [];

      // Warm-ups on the heavy barbell lifts, the way the app itself offers them.
      if (ex.equipment === 'Barbell' && working > 40) {
        sets.push({ ...newSet(), weight: roundTo(working * 0.5, s), reps: 5, type: 'warmup', done: true });
        sets.push({ ...newSet(), weight: roundTo(working * 0.75, s), reps: 3, type: 'warmup', done: true });
      }

      const targetReps = 8;
      for (let i = 0; i < item.targetSets; i++) {
        const reps = Math.max(4, Math.round(targetReps - i * between(0, 1.4) + between(-1, 1)));
        sets.push({
          ...newSet(),
          weight: working,
          reps,
          // RIR missing on roughly a fifth of sets, because the app treats a
          // blank as unknown and that path deserves to be visible.
          rir: chance(0.2) ? null : Math.max(0, Math.round(between(0, 3))),
          done: true,
        });
      }

      const entry = newEntry(ex.id, sets);
      if (chance(0.06)) entry.note = pick(NOTES);
      entries.push(entry);
    }

    const session = newSession(uid, { name: day.name, planId: plan.id, dayId: day.id, entries });
    session.startedAt = startedAt;
    session.finishedAt = startedAt + Math.round(between(52, 78)) * 60000;
    sessions.push(session);
  }
}

/* ============================ bodyweight ============================ */

const bodyweight = [];
for (let d = WEEKS * 7; d >= 0; d--) {
  // Two or three weigh-ins a week, not every day: the timeline's "weeks you did
  // not weigh stay empty" rule needs gaps to show.
  if (!chance(0.36)) continue;
  const t = 1 - d / (WEEKS * 7);
  const date = dayOffset(d);
  date.setHours(7, 30, 0, 0);
  bodyweight.push({
    id: uid('bw_'),
    date: date.getTime(),
    // Trend plus the daily noise a real scale has, rounded the way one reads.
    weight: Math.round((START_BW + (END_BW - START_BW) * t + between(-0.5, 0.5)) * 10) / 10,
  });
}

/* ============================== food ============================== */

/** name, portion, protein, kcal, carbs, fat, fibre */
const FOODS = [
  ['Magerquark 500 g', '500 g', 60, 345, 20, 1, 0],
  ['Haferflocken', '80 g', 11, 303, 49, 6, 8],
  ['Vollkornbrot', '2 Scheiben', 8, 220, 38, 3, 6],
  ['Hähnchenbrust', '200 g', 46, 220, 0, 3, 0],
  ['Rinderhack 5 %', '200 g', 42, 290, 0, 10, 0],
  ['Lachsfilet', '150 g', 32, 310, 0, 20, 0],
  ['Eier', '3 Stück', 20, 234, 1, 17, 0],
  ['Reis gekocht', '250 g', 6, 325, 70, 1, 1],
  ['Kartoffeln', '300 g', 6, 231, 51, 0, 5],
  ['Vollkornnudeln', '125 g roh', 15, 440, 82, 3, 11],
  ['Olivenöl', '1 EL', 0, 120, 0, 14, 0],
  ['Whey Protein', '30 g', 24, 118, 2, 2, 0],
  ['Banane', '1 Stück', 1, 105, 27, 0, 3],
  ['Apfel', '1 Stück', 0, 95, 25, 0, 4],
  ['Brokkoli', '200 g', 6, 68, 8, 1, 5],
  ['Skyr Natur', '250 g', 28, 158, 10, 1, 0],
  ['Erdnussbutter', '30 g', 8, 180, 6, 15, 2],
  ['Kaffee mit Milch', '1 Tasse', 2, 40, 3, 2, 0],
  ['Mandeln', '30 g', 6, 174, 5, 15, 4],
  ['Thunfisch in Wasser', '1 Dose', 26, 116, 0, 1, 0],
  ['Käse Gouda', '2 Scheiben', 12, 160, 0, 13, 0],
  ['Pizza Salami', '1/2 Stück', 24, 620, 62, 28, 4],
  ['Döner', '1 Stück', 38, 750, 68, 32, 7],
  ['Bier', '0,5 l', 2, 210, 16, 0, 0],
  ['Proteinriegel', '1 Riegel', 20, 210, 18, 7, 3],
  ['Milch 1,5 %', '250 ml', 9, 118, 12, 4, 0],
  ['Reiswaffeln', '3 Stück', 2, 105, 22, 1, 1],
  ['Avocado', '1/2 Stück', 2, 160, 2, 15, 5],
  ['Linsen gekocht', '200 g', 18, 232, 34, 1, 15],
  ['Olivenöl-Dressing', '2 EL', 0, 140, 2, 15, 0],
];

const foods = FOODS.map(([name, portion, protein, kcal, carbs, fat, fibre]) =>
  newFood(uid, { name, portion, protein, kcal, carbs, fat, fibre, source: 'manual' }));
const food = (name) => foods.find((f) => f.name === name);

// One food deliberately without carbs, fat or fibre, so the energy split has a
// reason to refuse on some days and the "not recorded" wording is reachable.
const incomplete = newFood(uid, {
  name: 'Kantine Tagesgericht', portion: '1 Portion', protein: 30, kcal: 640, source: 'manual',
});
foods.push(incomplete);

const BREAKFAST = ['Haferflocken', 'Magerquark 500 g', 'Eier', 'Skyr Natur', 'Kaffee mit Milch', 'Banane'];
const LUNCH = ['Hähnchenbrust', 'Reis gekocht', 'Brokkoli', 'Kartoffeln', 'Linsen gekocht', 'Vollkornnudeln'];
const DINNER = ['Rinderhack 5 %', 'Lachsfilet', 'Vollkornbrot', 'Käse Gouda', 'Avocado', 'Thunfisch in Wasser'];
const SNACK = ['Whey Protein', 'Proteinriegel', 'Mandeln', 'Apfel', 'Erdnussbutter', 'Milch 1,5 %', 'Reiswaffeln'];
const TREAT = ['Pizza Salami', 'Döner', 'Bier'];

const FOOD_WEEKS = 17;
const meals = [];
const water = [];

/**
 * A day is built up to a calorie target rather than by picking items blind.
 *
 * Picking uniformly from a list produced a 1,500 kcal average for someone
 * gaining half a kilo a month, and every number downstream inherited it: the
 * maintenance estimate came out at 1,193 kcal, and the calorie and carb targets
 * derived from it were nonsense. The demo has to hold together arithmetically
 * or it demonstrates the app computing rubbish.
 */
function buildDay(date, key, targetKcal) {
  const weekend = [0, 6].includes(date.getDay());
  let total = 0;

  const add = (name, slot, hour, amount = 1) => {
    const f = food(name) || incomplete;
    const at = new Date(date); at.setHours(hour, Math.floor(rand() * 50), 0, 0);
    meals.push(newMeal(uid, f, { amount, day: key, at: at.getTime(), slot }));
    total += f.kcal * amount;
  };

  // Breakfast and dinner are the anchors; lunch and snacks fill the gap.
  add(pick(BREAKFAST), 'breakfast', 8);
  add(pick(BREAKFAST), 'breakfast', 8);
  if (chance(0.55)) add('Kaffee mit Milch', 'breakfast', 9);

  if (weekend && chance(0.4)) {
    add(pick(TREAT), 'lunch', 13);
    if (chance(0.4)) add('Bier', 'dinner', 20);
  } else if (chance(0.12)) {
    add('Kantine Tagesgericht', 'lunch', 12);
  } else {
    add(pick(LUNCH), 'lunch', 12);
    add(pick(LUNCH), 'lunch', 12);
  }

  add(pick(DINNER), 'dinner', 19);
  add(pick(DINNER), 'dinner', 19);

  // Top up towards the target with snacks, which is how the day actually gets
  // filled. Capped so a low-calorie run of picks cannot spiral.
  // The cap has to be loose enough to actually reach the target. At six it was
  // binding on most days and the whole log came out ~700 kcal light, which the
  // maintenance estimate then faithfully reported as a 1,984 kcal maintenance
  // for an 84 kg lifter who was gaining weight.
  let guard = 0;
  while (total < targetKcal - 200 && guard++ < 14) {
    add(pick(SNACK), 'snack', guard % 2 ? 16 : 21, chance(0.3) ? 2 : 1);
  }
}

for (let d = FOOD_WEEKS * 7; d >= 0; d--) {
  const date = dayOffset(d);
  const key = dayKey(date.getTime());

  // One week away, logged only twice: the timeline's four-day floor and the
  // "a day nobody logged is blank, not zero" rule both need a week that falls
  // below them, or neither is visible in the demo.
  const awayWeek = d >= 63 && d <= 69;
  const logChance = awayWeek ? 0.28 : 0.78;
  if (!chance(logChance)) continue;

  // Gaining slowly, so intake sits a few hundred over maintenance, with the
  // weekend variance any real log has.
  const weekend = [0, 6].includes(date.getDay());
  const target = Math.round(between(2950, 3250) + (weekend ? between(0, 500) : 0));
  buildDay(date, key, target);

  if (chance(0.85)) water.push({ day: key, ml: 250 * Math.round(between(5, 11)) });
}

/* ========================== saved meals ========================== */

const templates = [
  newTemplate(uid, {
    name: 'Übliches Frühstück', slot: 'breakfast',
    items: [{ foodId: food('Haferflocken').id, amount: 1 },
            { foodId: food('Magerquark 500 g').id, amount: 0.5 },
            { foodId: food('Banane').id, amount: 1 }],
  }),
  newTemplate(uid, {
    name: 'Meal Prep Mittag', slot: 'lunch',
    items: [{ foodId: food('Hähnchenbrust').id, amount: 1 },
            { foodId: food('Reis gekocht').id, amount: 1 },
            { foodId: food('Brokkoli').id, amount: 1 }],
  }),
  newTemplate(uid, {
    name: 'Nach dem Training', slot: 'snack',
    items: [{ foodId: food('Whey Protein').id, amount: 1 },
            { foodId: food('Banane').id, amount: 1 }],
  }),
];
templates[0].uses = 23;
templates[1].uses = 14;
templates[2].uses = 31;

// `uses` drives the order of the food list, so the staples sit on top the way
// they would after four months of real logging.
for (const f of foods) {
  f.uses = meals.filter((m) => m.foodId === f.id).length;
}

/* ============================= output ============================= */

const settings = {
  ...DEFAULT_SETTINGS,
  language: 'de',
  units: 'kg',
  sex: 'male',
  age: 28,
  height: 181,
  bodyweight: bodyweight.length ? bodyweight[bodyweight.length - 1].weight : END_BW,
  goal: 'gain',
  activePlanId: plan.id,
  restSeconds: 180,
  // Backed up recently enough that the "back up your training" card on Home
  // stays quiet: the nudge needs 10 sessions or 28 days since, and a warning
  // banner across the top of a demo is noise. Push this further back if you
  // want to show the card itself.
  lastExportAt: dayOffset(9).getTime(),
};

const payload = {
  format: 'liftlog-backup',
  version: 1,
  exportedAt: new Date().toISOString(),
  settings,
  exercises,
  plans: [plan],
  sessions: sessions.sort((a, b) => b.startedAt - a.startedAt),
  bodyweight,
  foods,
  meals: meals.sort((a, b) => b.at - a.at),
  water,
  templates,
};

process.stdout.write(JSON.stringify(payload));

// A short report on stderr, so piping stdout to a file still tells you what
// came out. A showcase you have not looked at is a showcase that demos a bug.
const totalSets = sessions.reduce(
  (n, s) => n + s.entries.reduce((m, e) => m + e.sets.filter((x) => x.done && x.type === 'working').length, 0), 0);
const loggedDays = new Set(meals.map((m) => m.day)).size;
process.stderr.write([
  `exercises      ${exercises.length}`,
  `plan           ${plan.name}, ${plan.days.length} days`,
  `sessions       ${sessions.length} over ${WEEKS} weeks, ${totalSets} working sets`,
  `bodyweight     ${bodyweight.length} weigh-ins, ${START_BW} to ${settings.bodyweight} kg`,
  `foods          ${foods.length}, ${templates.length} saved meals`,
  `meals          ${meals.length} across ${loggedDays} logged days`,
  `water          ${water.length} days`,
  '',
].join('\n'));
