// Tests for the layer that decides what the app tells you.
//
// Run: `node --test` from the repo root. No framework, no package.json, no
// dependency, no build step: node:test ships with Node, and every module tested
// here is DOM-free, so it imports straight from js/ with nothing stubbed. The
// browser never loads this directory.
//
// What is worth testing here is narrow on purpose. Not the rating weights —
// those are judgement calls against the literature and will move again. What is
// tested is the arithmetic underneath them and the invariants that have already
// broken once:
//
//   * dates, because every silent breakage so far has been a date  (weekStreak,
//     weeklyMuscleSets, the meal window) and the failure is invisible until a
//     clock change six months later;
//   * the two counts that must agree — a plan's target and a week's actual,
//     which disagreed for months because each screen counted its own way;
//   * the honesty rules, which are the whole point of the app and are exactly
//     the kind of thing a refactor quietly reverses.

import test from 'node:test';
import assert from 'node:assert/strict';

// Fixed zone, so the DST cases below are not "whatever the machine thinks".
// Set before any Date is constructed; imports above only define functions.
process.env.TZ = 'Europe/Berlin';

const { e1rm, isCounted, startOfWeek, entryStats, sessionStats, newMeal, dayKey, slotFor, seedExercises, bestOneRepMaxByName, estimatePlanDuration, bodyweightLoadMode } = await import('../js/models.js');
const { scoreFor, scoreForMachine, buildRating, ANATOMY } = await import('../js/standards.js');
const { analyseWeek, compareToPlan, weekVerdict, weekStreak } = await import('../js/log-analysis.js');
const { analysePlan } = await import('../js/plan-rating.js');
const { rateExercise } = await import('../js/exercise-rating.js');
const { regionProgress } = await import('../js/region-progress.js');
const { bodyweightAt, strengthAt, strengthHistory } = await import('../js/history.js');
const { decodeLink, planLink, resolveAgainstLibrary } = await import('../js/plan-share.js');
const { weekSummary } = await import('../js/week-card.js');
const { THRESHOLDS } = await import('../js/evidence.js');
const { dayTotals, energySplit, maintenanceEstimate, NUTRIENTS, macroTargets } = await import('../js/nutrition.js');
const { latestWeight } = await import('../js/models.js');
const { STORES } = await import('../js/db.js');
const { searchLibrary, searchFoods, toFoodFields } = await import('../js/foodsearch.js');
const { normaliseBarcode, nutritionLooksPlausible } = await import('../js/foodlookup.js');
const { parseNumber, plural } = await import('../js/ui.js');
const { platePlan, describePlates } = await import('../js/plates.js');
const { warmupSets, warmupCount } = await import('../js/warmup.js');
const { stallReport, describeStall } = await import('../js/fatigue.js');
const { setLanguage } = await import('../js/i18n.js');
const { timeline, timelineReady, MIN_LOGGED_DAYS } = await import('../js/timeline.js');
const { mergeSnapshots, mergeDetailed } = await import('../js/sync.js');
const { exerciseSearchScore, searchText } = await import('../js/exercise-search.js');
const { distanceMeters, nearbyPlannedWorkout } = await import('../js/gym-location.js');

test('gym arrival only matches a scheduled workout inside the chosen radius', () => {
  const now = Date.now();
  const day = { id: 'push', name: 'Push', weekday: new Date(now).getDay(), items: [] };
  const plan = { id: 'p', days: [day] };
  const config = { enabled: true, latitude: 52.30, longitude: 8.90, radius: 120 };
  const near = { latitude: 52.3005, longitude: 8.90, accuracy: 10 };
  const far = { latitude: 52.31, longitude: 8.90, accuracy: 10 };
  assert.equal(nearbyPlannedWorkout(config, near, plan, [], now)?.day.id, 'push');
  assert.equal(nearbyPlannedWorkout(config, far, plan, [], now), null);
  assert.ok(distanceMeters(config, near) > 40 && distanceMeters(config, near) < 70);
  const date = new Date(now), pad = (n) => String(n).padStart(2, '0');
  const today = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  assert.equal(nearbyPlannedWorkout({ ...config, lastPromptDay: today }, near, plan, [], now), null);
});

test('exercise search understands German aliases, accents and one typo', () => {
  const pullUp = { name: 'Pull-Up', muscle: 'Back', equipment: 'Bodyweight' };
  const bench = { name: 'Barbell Bench Press', muscle: 'Chest', equipment: 'Barbell' };
  assert.ok(exerciseSearchScore(pullUp, 'Klimmzüge') > 0);
  assert.ok(exerciseSearchScore(bench, 'Bankdrücken') > 0);
  assert.ok(exerciseSearchScore(pullUp, 'Pull-Uo') > 0);
  assert.equal(searchText('Körpergröße'), 'korpergrosse');
});

test('pull-ups estimate total system load before applying the repetition formula', () => {
  const exercises = new Map([['pull', { id: 'pull', name: 'Pull-Up' }]]);
  const sessions = [{ finishedAt: '2026-01-01', entries: [{ exerciseId: 'pull', sets: [
    { type: 'working', done: true, weight: 0, reps: 10 },
  ] }] }];
  const best = bestOneRepMaxByName(sessions, exercises, { bodyweight: 80 });
  assert.ok(Math.abs(best.get('Pull-Up') - e1rm(80, 10)) < 0.001);
  assert.ok(scoreFor('Pull-Up', best.get('Pull-Up'), { sex: 'male', bodyweight: 80, age: 25 }) < 80);
});

test('bodyweight movements use bodyweight while weighted variants collect only added load', () => {
  assert.equal(bodyweightLoadMode({ name: 'Dip', equipment: 'Bodyweight' }), 'bodyweight');
  assert.equal(bodyweightLoadMode({ name: 'Weighted Dip', equipment: 'Bodyweight' }), 'added');
  const weighted = new Map([['dip', { id: 'dip', name: 'Weighted Dip' }]]);
  const sessions = [{ finishedAt: '2026-01-01', entries: [{ exerciseId: 'dip', sets: [
    { type: 'working', done: true, weight: 20, systemWeight: 100, loadMode: 'added', reps: 8 },
  ] }] }];
  const best = bestOneRepMaxByName(sessions, weighted, { bodyweight: 80 });
  assert.equal(best.get('Weighted Dip'), e1rm(100, 8));
  assert.ok(scoreFor('Weighted Dip', best.get('Weighted Dip'), { sex: 'male', bodyweight: 80, age: 25 }) > 0);
  assert.equal(entryStats({ sets: [{ type: 'working', done: true, weight: 20,
    systemWeight: 100, loadMode: 'added', reps: 8 }] }).volume, 800);
});

test('ambiguous old weighted pull-up entries cannot create a false Elite score', () => {
  const exercises = new Map([['pull', { id: 'pull', name: 'Pull-Up' }]]);
  const make = (set) => [{ finishedAt: '2026-01-01', entries: [{ exerciseId: 'pull', sets: [set] }] }];
  const old = { type: 'working', done: true, weight: 80, reps: 10 };
  assert.equal(bestOneRepMaxByName(make(old), exercises, { bodyweight: 80 }).has('Pull-Up'), false);
  const confirmed = { ...old, weight: 20, loadMode: 'added' };
  assert.ok(bestOneRepMaxByName(make(confirmed), exercises, { bodyweight: 80 }).get('Pull-Up') > 100);
});

test('allometric bodyweight scaling reduces the former light-lifter bias', () => {
  const light = scoreFor('Barbell Bench Press', 100, { sex: 'male', bodyweight: 70, age: 25 });
  const heavy = scoreFor('Barbell Bench Press', 100, { sex: 'male', bodyweight: 100, age: 25 });
  assert.ok(light > heavy);
  assert.ok(light - heavy < 20);
});

test('common machines contribute to the muscle map without fake strength tiers', () => {
  for (const name of ['Hack Squat', 'Leg Extension', 'Seated Leg Curl', 'Pec Deck', 'Seated Cable Row',
    'Chest-Supported T-Bar Row', 'Smith Machine Incline Bench Press', 'Butterfly',
    'Lateral Raise Machine', 'Preacher Curl Machine', 'Overhead Rope Triceps Extension',
    'Triceps Pushdown', 'Rope Hammer Curl', 'Close-Grip Seated Row']) {
    assert.ok(ANATOMY[name], `${name} should have anatomy`);
  }
});

test('machine records get provisional tiers and contribute cautiously to strength regions', () => {
  const profile = { sex: 'male', bodyweight: 80, age: 25 };
  const score = scoreForMachine('Machine Chest Press', 90, profile);
  assert.ok(score > 0 && score < 100);
  const rating = buildRating(new Map([['Machine Chest Press', 90]]), profile,
    { machineNames: new Set(['Machine Chest Press']) });
  assert.equal(rating.lifts[0].machine, true);
  assert.equal(rating.lifts[0].provisional, true);
  assert.ok(rating.regions.chest.score > 0);
  assert.ok(rating.regions.chest.score < score, 'uncertain machine data is discounted on the combined map');
});

test('same-model observations gradually adjust rather than replace the seed standard', () => {
  const profile = { sex: 'male', bodyweight: 80, age: 25 };
  const seed = scoreForMachine('Machine Chest Press', 90, profile);
  const adjusted = scoreForMachine('Machine Chest Press', 90, profile,
    { count: 100, q20: 0.3, q40: 0.5, q60: 0.7, q80: 0.9 });
  assert.notEqual(adjusted, seed);
  assert.ok(adjusted < 100 && adjusted > 0);
});

test('planned duration excludes a pointless rest after every exercise', () => {
  const items = [{ targetSets: 3 }, { targetSets: 3 }];
  assert.equal(estimatePlanDuration(items, 180), (6 * 45 + 4 * 180 + 90) * 1000);
});

test('a stable machine fly outranks the rolling bodyweight fly', () => {
  const common = { muscle: 'Chest', primary: ['chest'], instructions: ['Controlled reps'] };
  const unstable = rateExercise({ ...common, name: 'Bodyweight Flyes', equipment: 'Barbell',
    secondary: ['abs', 'delts-front', 'triceps'], mech: 'isolation' });
  const machine = rateExercise({ ...common, name: 'Butterfly', equipment: 'Machine',
    secondary: [], mech: 'isolation' });
  assert.ok(machine.stars >= unstable.stars + 1.5);
  assert.equal(unstable.stability.level, 'unstable');
  assert.equal(machine.stability.level, 'supported');
  assert.equal(unstable.criteria.find((c) => c.label === 'exRating.progression').points, 0.5);
});

test('stabilizer tags do not turn an isolation movement into a compound bonus', () => {
  const rating = rateExercise({ name: 'Bodyweight Flyes', muscle: 'Chest', equipment: 'Barbell',
    primary: ['chest'], secondary: ['abs', 'delts-front', 'triceps'], mech: 'isolation', instructions: ['x'] });
  assert.equal(rating.criteria.find((c) => c.label === 'exRating.breadth').points, 0.5);
});

test('chest support keeps a T-bar row from inheriting the bent-over torso limiter', () => {
  const supported = rateExercise({ name: 'Chest-Supported T-Bar Row', muscle: 'Back', equipment: 'Machine',
    primary: ['lats'], secondary: ['biceps', 'delts-rear'], mech: 'compound', instructions: ['x'] });
  const unsupported = rateExercise({ name: 'T-Bar Row', muscle: 'Back', equipment: 'Barbell',
    primary: ['lats'], secondary: ['biceps', 'delts-rear', 'lower-back'], mech: 'compound', instructions: ['x'] });
  assert.equal(supported.limit.level, 'target');
  assert.equal(supported.limit.why, 'science.chestSupportedRow');
  assert.equal(unsupported.limit.level, 'other');
});

test('a Smith incline press outranks the redundant shorter-ROM decline press', () => {
  const common = { muscle: 'Chest', equipment: 'Machine', primary: ['chest'],
    secondary: ['delts-front', 'triceps'], mech: 'compound', instructions: ['x'] };
  const incline = rateExercise({ ...common, name: 'Smith Machine Incline Bench Press' });
  const decline = rateExercise({ ...common, name: 'Smith Machine Decline Press' });
  assert.ok(incline.stars > decline.stars);
  assert.equal(decline.length.bias, 'short');
  assert.equal(decline.length.why, 'science.declinePress');
});

test('the curated catalogue keeps corrected anatomy, equipment and plain instructions', () => {
  let id = 0;
  const catalogue = seedExercises(() => `exercise_${++id}`);
  const byName = new Map(catalogue.map((exercise) => [exercise.name, exercise]));
  const additions = [
    'Pendulum Squat', 'Belt Squat', 'Smith Machine Romanian Deadlift',
    'Bayesian Cable Curl', 'Cross-Body Cable Lateral Raise', 'Single-Arm Lat Pulldown',
    'Reverse Nordic Curl', 'Glute-Biased 45-Degree Back Extension', 'Cable Y-Raise',
    'Iso-Lateral Chest Press', 'Iso-Lateral Incline Chest Press', 'Iso-Lateral Shoulder Press',
    'Iso-Lateral High Row', 'Iso-Lateral Low Row', 'Plate-Loaded Pullover',
    'Glute Drive Machine', 'Standing Hip Abduction Machine', 'Kneeling Leg Curl Machine',
    'Seated Dip Machine', 'Weighted Pull-Up', 'Weighted Chin-Up', 'Weighted Dip', 'Weighted Push-Up',
  ];

  additions.forEach((name) => assert.ok(byName.has(name), `${name} is missing`));
  assert.equal(byName.get('Bodyweight Flyes').equipment, 'Bodyweight');
  assert.deepEqual(byName.get('Machine Hip Adduction').primary, ['adductors']);
  assert.equal(catalogue.some((exercise) => !exercise.primary?.length), false);
  assert.equal(catalogue.some((exercise) => exercise.instructions?.some((step) => /<\/?(?:h\d|p|li|div|br)\b/i.test(step))), false);
});

test('multi-device backup merge keeps new workouts from both devices', () => {
  const base = { format: 'liftlog-backup', version: 1, settings: {}, exercises: [], plans: [],
    bodyweight: [], foods: [], meals: [], water: [], templates: [] };
  const local = { ...base, sessions: [
    { id: 'shared', startedAt: 1, updatedAt: 30, notes: 'new local edit' },
    { id: 'phone', startedAt: 40, updatedAt: 40 },
  ] };
  const remote = { ...base, sessions: [
    { id: 'shared', startedAt: 1, updatedAt: 20, notes: 'old remote edit' },
    { id: 'tablet', startedAt: 50, updatedAt: 50 },
  ] };
  const merged = mergeSnapshots(local, remote);
  assert.deepEqual(new Set(merged.sessions.map((s) => s.id)), new Set(['shared', 'phone', 'tablet']));
  assert.equal(merged.sessions.find((s) => s.id === 'shared').notes, 'new local edit');
});

test('a synced workout deletion cannot be resurrected by an older device', () => {
  const base = { format: 'liftlog-backup', version: 1, settings: {}, exercises: [], plans: [],
    bodyweight: [], foods: [], meals: [], water: [], templates: [] };
  const oldDevice = { ...base, sessions: [{ id: 'gone', startedAt: 1, updatedAt: 20 }] };
  const deletingDevice = { ...base, sessions: [],
    deletions: [{ collection: 'sessions', id: 'gone', deletedAt: 21 }] };
  const merged = mergeSnapshots(oldDevice, deletingDevice);
  assert.equal(merged.sessions.some((session) => session.id === 'gone'), false);
  assert.equal(merged.deletions.length, 1);
});

test('a newer intentional restore wins over an older deletion marker', () => {
  const base = { format: 'liftlog-backup', version: 1, settings: {}, exercises: [], plans: [],
    bodyweight: [], foods: [], meals: [], water: [], templates: [] };
  const restored = { ...base, sessions: [{ id: 'back', startedAt: 1, updatedAt: 50 }] };
  const deleted = { ...base, sessions: [], deletions: [{ collection: 'sessions', id: 'back', deletedAt: 40 }] };
  assert.equal(mergeSnapshots(restored, deleted).sessions.length, 1);
});

// The flag that stops two phones uploading at each other forever. A device that
// pulls a newer snapshot and adds nothing of its own already holds exactly what
// the server holds, so it must not push an identical copy back as the next
// version — which the other phone would pull, and answer in kind.
test('a device that contributes nothing to the merge knows it contributed nothing', () => {
  const base = { format: 'liftlog-backup', version: 1, settings: {}, exercises: [], plans: [],
    bodyweight: [], foods: [], meals: [], water: [], templates: [] };
  const remote = { ...base, sessions: [
    { id: 'a', startedAt: 1, updatedAt: 20 },
    { id: 'b', startedAt: 2, updatedAt: 30 },
  ] };

  const behind = { ...base, sessions: [{ id: 'a', startedAt: 1, updatedAt: 20 }] };
  const behindResult = mergeDetailed(behind, remote);
  assert.equal(behindResult.tookLocal, false);
  assert.equal(behindResult.summary.remoteNewer, 0);

  const identical = { ...base, sessions: remote.sessions.map((s) => ({ ...s })) };
  assert.equal(mergeDetailed(identical, remote).tookLocal, false);

  const ahead = { ...base, sessions: [...remote.sessions, { id: 'c', startedAt: 3, updatedAt: 40 }] };
  assert.equal(mergeDetailed(ahead, remote).tookLocal, true);

  const edited = { ...base, sessions: [
    { id: 'a', startedAt: 1, updatedAt: 99 }, { id: 'b', startedAt: 2, updatedAt: 30 },
  ] };
  const editedResult = mergeDetailed(edited, remote);
  assert.equal(editedResult.tookLocal, true);
  assert.equal(editedResult.summary.localNewer, 1);
});

// `cloudBaseVersion` and friends describe this installation's relationship to
// the server. A remote copy of them is not stale, it is about a different phone,
// and letting one in makes a device believe it is at a version it never pulled.
test('cloud bookkeeping is never taken from the other device snapshot', () => {
  const base = { format: 'liftlog-backup', version: 1, exercises: [], plans: [], sessions: [],
    bodyweight: [], foods: [], meals: [], water: [], templates: [] };
  const local = { ...base, settings: { cloudBaseVersion: 4, cloudLastFingerprint: 'mine', units: 'kg' } };
  const remote = { ...base, settings: { cloudBaseVersion: 91, cloudLastFingerprint: 'theirs', units: 'lb' } };

  const { merged } = mergeDetailed(local, remote);
  assert.equal(merged.settings.cloudBaseVersion, 4);
  assert.equal(merged.settings.cloudLastFingerprint, 'mine');
  // Everything that is genuinely about the account still follows the remote.
  assert.equal(merged.settings.units, 'lb');
});

const INDIRECT = THRESHOLDS.indirectSetWeight.value;

/* ============================ fixtures ============================ */

const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h).getTime();

const exercise = (id, name, primary, secondary = []) => ({
  id, name, primary, secondary, muscle: 'Chest', equipment: 'Barbell',
});

const set = (weight, reps, extra = {}) =>
  ({ weight, reps, rir: null, type: 'working', done: true, ...extra });

const session = (startedAt, entries, extra = {}) => ({
  id: `s_${startedAt}`, name: 'Workout', startedAt, finishedAt: startedAt + 3600e3,
  planId: null, dayId: null, routineId: null, notes: '', entries, ...extra,
});

const entry = (exerciseId, sets) => ({ exerciseId, sets, note: '' });

const BENCH = exercise('ex_bench', 'Barbell Bench Press', ['chest'], ['triceps']);
const byId = new Map([[BENCH.id, BENCH]]);

/* ============================== maths ============================== */

test('e1rm: a single rep is the weight itself', () => {
  assert.equal(e1rm(100, 1), 100);
});

test('e1rm: Epley above one rep', () => {
  assert.equal(e1rm(100, 10), 100 * (1 + 10 / 30));
});

test('e1rm: nothing lifted, nothing estimated', () => {
  // Guards the callers that divide by a previous best.
  assert.equal(e1rm(100, 0), 0);
  assert.equal(e1rm(0, 5), 0);
  assert.equal(e1rm(null, null), 0);
});

test('isCounted: only finished working sets with reps', () => {
  assert.equal(isCounted(set(60, 8)), true);
  assert.equal(isCounted(set(60, 8, { type: 'warmup' })), false);
  assert.equal(isCounted(set(60, 8, { done: false })), false);
  assert.equal(isCounted(set(60, 0)), false);
});

test('entryStats ignores warm-ups in every number it reports', () => {
  const st = entryStats(entry(BENCH.id, [
    set(40, 10, { type: 'warmup' }),
    set(80, 8),
    set(80, 6),
  ]));
  assert.equal(st.sets, 2);
  assert.equal(st.volume, 80 * 8 + 80 * 6);
  assert.equal(st.reps, 14);
});

test('unilateral volume counts both sides but strength uses the weaker side', () => {
  const unilateral = set(18, 9, {
    leftWeight: 20, leftReps: 10, rightWeight: 18, rightReps: 9,
  });
  const st = entryStats(entry(BENCH.id, [unilateral]));
  assert.equal(st.volume, 20 * 10 + 18 * 9);
  assert.equal(st.e1rm, e1rm(18, 9));
});

test('paused time is excluded from workout duration', () => {
  const stopped = session(1000, [], { finishedAt: 11000, pausedMs: 4000 });
  assert.equal(sessionStats(stopped).durationMs, 6000);
  const paused = session(1000, [], { finishedAt: null, pausedAt: 8000, pausedMs: 2000 });
  assert.equal(sessionStats(paused).durationMs, 5000);
});

test('parseNumber takes the separator the keyboard offers', () => {
  // A German phone's decimal key is a comma. <input type="number"> reports an
  // empty string for "82,5", which silently swallowed the weight of a set.
  assert.equal(parseNumber('82,5'), 82.5);
  assert.equal(parseNumber('82.5'), 82.5);
  assert.equal(parseNumber(' 82 '), 82);
  assert.equal(parseNumber(82.5), 82.5);
});

test('parseNumber says null rather than guessing', () => {
  for (const junk of ['', '   ', 'abc', '8o', null, undefined, NaN]) {
    assert.equal(parseNumber(junk), null, `expected null for ${JSON.stringify(junk)}`);
  }
  // 0 is a real value, not an absence — reps of 0 must not read as "blank".
  assert.equal(parseNumber('0'), 0);
});

test('plural counts one of a thing correctly', () => {
  // "1 sessions" was on screen for months, in four different files.
  assert.equal(plural(1, 'session'), '1 session');
  assert.equal(plural(0, 'session'), '0 sessions');
  assert.equal(plural(2, 'set'), '2 sets');
  assert.equal(plural(1, 'exercise', 'exercises'), '1 exercise');
});

/* ============================== dates ============================== */

test('the fixed test timezone is in effect', () => {
  // Without this the two DST cases below silently prove nothing.
  assert.equal(new Date(2026, 2, 23).getTimezoneOffset(), -60, 'expected CET before the change');
  assert.equal(new Date(2026, 2, 30).getTimezoneOffset(), -120, 'expected CEST after it');
});

test('startOfWeek: weeks start on Monday', () => {
  const monday = at(2026, 7, 27, 0);
  assert.equal(startOfWeek(at(2026, 7, 27, 9)), monday);
  assert.equal(startOfWeek(at(2026, 8, 2, 23)), monday, 'Sunday belongs to the week it ends');
  assert.notEqual(startOfWeek(at(2026, 8, 3, 1)), monday, 'Monday starts a new one');
});

test('startOfWeek: a clock change does not move the week boundary', () => {
  // 2026-03-29 is the spring change. Sunday still belongs to the Monday before.
  assert.equal(startOfWeek(at(2026, 3, 29, 12)), at(2026, 3, 23, 0));
  assert.equal(startOfWeek(at(2026, 10, 25, 12)), at(2026, 10, 19, 0));
});

test('weekStreak: counts consecutive weeks across a clock change', () => {
  // The regression: stepping back a fixed 7 x 86400000 ms lands an hour off
  // midnight here, the week key stops matching, and the streak reads 1.
  const sessions = [
    session(at(2026, 3, 17), []),   // week of Mar 16
    session(at(2026, 3, 24), []),   // week of Mar 23 — contains the change
    session(at(2026, 3, 31), []),   // week of Mar 30
  ];
  assert.equal(weekStreak(sessions, at(2026, 3, 31)), 3);
});

test('weekStreak: the current week may still be empty', () => {
  const sessions = [session(at(2026, 7, 21), [])];        // last week only
  assert.equal(weekStreak(sessions, at(2026, 7, 27)), 1, 'Monday morning still has a streak');
  assert.equal(weekStreak(sessions, at(2026, 8, 5)), 0, 'but not once a whole week is missed');
});

test('weekStreak: unfinished sessions do not keep a streak alive', () => {
  const open = { ...session(at(2026, 7, 28), []), finishedAt: null };
  assert.equal(weekStreak([open], at(2026, 7, 28)), 0);
});

/* ================== the two counts that must agree ================== */

test('planned and done are counted the same way', () => {
  // This is the invariant js/log-analysis.js exists for: the plan says "chest
  // 4", the week must not say "chest 8" because one side counted differently.
  const week = analyseWeek(
    [session(at(2026, 7, 28), [entry(BENCH.id, [set(80, 8), set(80, 8), set(80, 8), set(80, 8)])])],
    byId,
    startOfWeek(at(2026, 7, 28))
  );
  const plan = analysePlan(
    { name: 'P', perWeek: 1, days: [{ id: 'd1', name: 'Day', items: [{ exerciseId: BENCH.id, targetSets: 4, targetReps: '6-10' }] }] },
    byId
  );

  assert.equal(week.volume.chest, 4);
  assert.equal(plan.volume.chest, 4);
  assert.equal(week.volume.triceps, 4 * INDIRECT, 'secondary muscles count fractionally');
  assert.equal(plan.volume.triceps, plan.volume.chest * INDIRECT);
});

test('analyseWeek only looks at the week it was asked about', () => {
  const sessions = [
    session(at(2026, 7, 28), [entry(BENCH.id, [set(80, 8)])]),
    session(at(2026, 7, 21), [entry(BENCH.id, [set(80, 8)])]),
  ];
  const week = analyseWeek(sessions, byId, startOfWeek(at(2026, 7, 28)));
  assert.equal(week.workouts, 1);
  assert.equal(week.totalSets, 1);
});

test('a muscle trained but not planned has no target, not a target of zero', () => {
  // Why the card and Home draw those bars grey: ratio 1 means "nothing to
  // compare against", not "you hit it".
  const week = analyseWeek(
    [session(at(2026, 7, 28), [entry(BENCH.id, [set(80, 8)])])],
    byId, startOfWeek(at(2026, 7, 28))
  );
  const rows = compareToPlan(week, { volume: {} });
  const chest = rows.find((r) => r.region === 'chest');
  assert.equal(chest.target, 0);
  assert.equal(chest.ratio, 1);
  assert.equal(chest.short, 0);
});

test('weekVerdict says nothing about sessions it cannot count', () => {
  const week = analyseWeek(
    [session(at(2026, 7, 28), [entry(BENCH.id, [set(80, 8)])])],
    byId, startOfWeek(at(2026, 7, 28))
  );
  const rows = compareToPlan(week, null);
  assert.ok(!weekVerdict(week, rows, 0).headline.includes('?'), 'no "2 of ? sessions in"');
  assert.match(weekVerdict(week, rows, 5).headline, /of 5 sessions in/);
});

/* ========================== time windows ========================== */

test('regionProgress cannot see past the moment it was asked about', () => {
  // A card about last week must not change when this week is logged.
  const sessions = [
    session(at(2026, 7, 6), [entry(BENCH.id, [set(80, 8)])]),
    session(at(2026, 7, 13), [entry(BENCH.id, [set(85, 8)])]),
    session(at(2026, 7, 20), [entry(BENCH.id, [set(90, 8)])]),
    session(at(2026, 7, 27), [entry(BENCH.id, [set(200, 8)])]),   // after the cutoff
  ];
  const upToJul26 = regionProgress(sessions, byId, { now: at(2026, 7, 26) });
  const upToNow = regionProgress(sessions, byId, { now: at(2026, 7, 28) });
  assert.ok(upToJul26.chest.pctPerWeek < upToNow.chest.pctPerWeek,
    'the later session must not leak into the earlier window');
});

test('regionProgress refuses to call three points a trend', () => {
  const thin = regionProgress(
    [session(at(2026, 7, 20), [entry(BENCH.id, [set(80, 8)])]),
     session(at(2026, 7, 22), [entry(BENCH.id, [set(85, 8)])])],
    byId, { now: at(2026, 7, 28) }
  );
  assert.equal(thin.chest.state, 'thin');
  assert.equal(thin.chest.pctPerWeek, null, 'no number where there is no trend');
});

test('bodyweightAt reads the entry in force at a moment', () => {
  const log = [
    { id: 'a', date: at(2026, 6, 1), weight: 80 },
    { id: 'b', date: at(2026, 7, 1), weight: 82 },
  ];
  assert.equal(bodyweightAt(log, at(2026, 5, 1)), null, 'nothing before the first entry');
  assert.equal(bodyweightAt(log, at(2026, 6, 15)), 80);
  assert.equal(bodyweightAt(log, at(2026, 8, 1)), 82);
});

/* ============================ nutrition ============================ */

const meal = (over = {}) => ({
  id: `m_${Math.random()}`, day: '2026-07-28', at: at(2026, 7, 28), slot: 'lunch',
  name: 'Food', portion: '100 g', amount: 1,
  protein: 20, kcal: 200, carbs: 10, fat: 5, fibre: 2, ...over,
});

test('unrecorded macros are unknown, not zero', () => {
  // The whole reason carbs/fat/fibre are nullable: a food typed off a label
  // that only lists protein must not drag the day's carb total down.
  const totals = dayTotals([meal(), meal({ carbs: null, fat: null, fibre: null })]);
  assert.equal(totals.protein, 40);
  assert.equal(totals.carbs, 10, 'only the item that had a value counts');
  assert.equal(totals.missing.carbs, 1);
  assert.equal(totals.missing.fat, 1);
  assert.equal(totals.items, 2);
});

test('the energy split refuses to draw itself on partial data', () => {
  assert.equal(energySplit(dayTotals([meal(), meal({ carbs: null })])), null);
  assert.equal(energySplit(dayTotals([])), null);

  const split = energySplit(dayTotals([meal({ protein: 25, carbs: 50, fat: 10 })]));
  // Atwater: 100 + 200 + 90 = 390 kcal accounted for.
  assert.equal(split.fromMacros, 390);
  assert.ok(Math.abs(split.share.carbs - 200 / 390) < 1e-9);
});

test('a meal scales every recorded macro and leaves the unknown ones alone', () => {
  const food = { id: 'f1', name: 'Quark', portion: '250 g', protein: 30, kcal: 160, carbs: 10, fat: null, fibre: null };
  // `at` is passed explicitly: without it the slot comes from the wall clock and
  // this test would pass all morning and fail after lunch.
  const m = newMeal((p) => `${p}x`, food, { amount: 2, at: at(2026, 7, 28, 12) });
  assert.equal(m.protein, 60);
  assert.equal(m.carbs, 20);
  assert.equal(m.fat, null, 'unknown times two is still unknown');
  assert.equal(m.slot, 'lunch', 'a slot is picked from the clock when none is given');
});

test('slotFor splits the day at the hours people eat', () => {
  assert.equal(slotFor(at(2026, 7, 28, 8)), 'breakfast');
  assert.equal(slotFor(at(2026, 7, 28, 13)), 'lunch');
  assert.equal(slotFor(at(2026, 7, 28, 19)), 'dinner');
  assert.equal(slotFor(at(2026, 7, 28, 22)), 'snack');
});

test('the food library is searchable and scales to a portion', () => {
  const hits = searchLibrary('chicken');
  assert.ok(hits.length > 0, 'the bundled library answers a plain query');
  assert.ok(hits.every((f) => f.name.toLowerCase().includes('chicken')));
  assert.deepEqual(searchLibrary('c'), [], 'one letter is not a search');
  assert.deepEqual(searchLibrary('zzzzzz'), []);

  const oats = searchLibrary('oats')[0];
  // The generator's word-boundary rule exists because a substring match filed
  // "Buckwheat groats" under Oats, and nothing downstream would have caught it.
  assert.ok(/oat/i.test(oats.usda), `expected an oat row, got "${oats.usda}"`);

  const fields = toFoodFields(oats, 50);
  assert.equal(fields.portion, '50 g');
  assert.equal(fields.kcal, Math.round(oats.per100.kcal / 2));
  assert.ok(fields.protein > 0);
  assert.equal(typeof fields.micros, 'object');
});

test('German food terms find the measured offline library', () => {
  assert.ok(searchLibrary('Hähnchen').some((food) => /chicken/i.test(food.name)));
  assert.ok(searchLibrary('Haferflocken').some((food) => /oat/i.test(food.name)));
  assert.ok(searchLibrary('Kartoffel').some((food) => /potato/i.test(food.name)));
  assert.ok(searchLibrary('Tomato paste').length > 0, 'new common foods are bundled');
});

test('barcodes require a valid GTIN check digit and nutrition is sanity checked', () => {
  assert.equal(normaliseBarcode('40084015'), '40084015');
  assert.equal(normaliseBarcode('40084016'), null);
  assert.equal(normaliseBarcode('123456789'), null);
  assert.equal(nutritionLooksPlausible({ protein: 13, carbs: 1, fat: 11, kcal: 155 }), true);
  assert.equal(nutritionLooksPlausible({ protein: 13, carbs: 1, fat: 11, kcal: 700 }), false);
});

test('branded products are searchable and rank behind measured ones', () => {
  const hits = searchFoods('nutella');
  assert.ok(hits.some((h) => h.kind === 'brand'), 'the brand library answers a brand name');

  // Generic entries are lab measurements; branded ones are what a contributor
  // typed off a packet. When both could answer, the measured one leads.
  const both = searchFoods('milk');
  const firstBrand = both.findIndex((h) => h.kind === 'brand');
  const lastGeneric = both.map((h) => h.kind).lastIndexOf('generic');
  if (firstBrand !== -1 && lastGeneric !== -1) {
    assert.ok(lastGeneric < firstBrand, 'generic results come first');
  }

  for (const hit of searchFoods('protein')) {
    assert.ok(hit.entry.per100.kcal !== undefined, 'every bundled row carries energy');
    assert.ok(hit.entry.per100.protein !== undefined, 'and protein');
  }
});

test('maintenance refuses to answer on thin data', () => {
  assert.equal(maintenanceEstimate([], []).ok, false);

  // Enough days logged, but only one weigh-in: no direction, no answer.
  const meals = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(at(2026, 7, 28)); d.setDate(d.getDate() - i);
    meals.push(meal({ day: dayKey(d.getTime()), at: d.getTime(), kcal: 2600, protein: 150 }));
  }
  const only = maintenanceEstimate(meals, [{ id: 'b', date: at(2026, 7, 20), weight: 82 }], { endTs: at(2026, 7, 28) });
  assert.equal(only.ok, false);
  assert.equal(only.reason, 'weight');
});

test('maintenance subtracts what the scale accounts for', () => {
  const END = at(2026, 7, 29);
  const meals = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(END); d.setDate(d.getDate() - i);
    meals.push(meal({ day: dayKey(d.getTime()), at: d.getTime(), kcal: 2600 }));
  }
  // +0.8 kg across exactly 28 days: 0.2 kg a week, which at 7,700 kcal/kg is
  // 220 kcal a day of the 2,600 going into the gain. Maintenance was 2,380.
  const weights = [
    { id: 'a', date: at(2026, 7, 1), weight: 82 },
    { id: 'b', date: END, weight: 82.8 },
  ];
  const est = maintenanceEstimate(meals, weights, { endTs: END });

  assert.equal(est.ok, true);
  assert.equal(est.meanIntake, 2600);
  assert.equal(est.kgPerWeek, 0.2);
  assert.equal(est.maintenance, 2380);
});

test('macro targets wait for a calorie figure they can trust', () => {
  const settings = { bodyweight: 82, units: 'kg', sex: 'male', goal: 'hold' };
  const t = macroTargets(settings, { ok: false, reason: 'days' });
  assert.equal(t.ok, false);
  // Protein does not depend on calories, so it is still answered.
  assert.ok(t.protein.low > 0);
});

test('macro targets fall out of calories, not out of a ratio', () => {
  const settings = { bodyweight: 82, units: 'kg', sex: 'male', goal: 'hold' };
  const t = macroTargets(settings, { ok: true, maintenance: 2800 });

  assert.equal(t.kcal, 2800, 'holding means maintenance, untouched');
  // Fat is 20-35% of energy, at 9 kcal/g.
  assert.equal(t.fat.low, Math.round(2800 * 0.20 / 9));
  assert.equal(t.fat.high, Math.round(2800 * 0.35 / 9));

  // Carbs are the remainder, so their range runs the other way: most carbs
  // when fat sits at its floor.
  assert.ok(t.carbs.high > t.carbs.low);
  const proteinKcal = ((t.protein.low + t.protein.high) / 2) * 4;
  assert.equal(t.carbs.low, Math.round((2800 - proteinKcal - t.fat.high * 9) / 4));

  // And the whole thing adds up: protein + fat floor + max carbs ≈ the target.
  const total = proteinKcal + t.fat.low * 9 + t.carbs.high * 4;
  assert.ok(Math.abs(total - 2800) < 5, `expected ~2800 kcal, got ${total}`);
});

test('the goal moves calories in the right direction', () => {
  const base = { bodyweight: 82, units: 'kg', sex: 'male' };
  const hold = macroTargets({ ...base, goal: 'hold' }, { ok: true, maintenance: 2800 });
  const gain = macroTargets({ ...base, goal: 'gain' }, { ok: true, maintenance: 2800 });
  const lose = macroTargets({ ...base, goal: 'lose' }, { ok: true, maintenance: 2800 });

  assert.ok(gain.kcal > hold.kcal && hold.kcal > lose.kcal);
  assert.equal(gain.offset, -lose.offset, 'the pace is symmetric');
  assert.ok(gain.kgPerWeek > 0 && lose.kgPerWeek < 0);
  // 0.375% of 82 kg is about 0.31 kg a week — the convention, not a finding.
  assert.ok(Math.abs(gain.kgPerWeek) < 0.5, 'and slow');
});

/* ========================== loading a bar ========================== */

test('platePlan splits the load evenly and names every disc', () => {
  const plan = platePlan(100, 20, 'kg');
  assert.equal(plan.loaded, 100);
  assert.equal(plan.exact, true);
  assert.equal(plan.perSide.reduce((a, b) => a + b, 0) * 2 + 20, 100);
  // Heaviest discs first: 40 a side is 25 + 15, not 20 + 15 + 5.
  assert.equal(describePlates(plan.perSide), '1 × 25, 1 × 15');
});

test('platePlan admits when a weight cannot be loaded', () => {
  // Nothing under 1.25 kg exists on the rack, so 101 kg is not a thing you can
  // put on a bar — printing a plate list for it would be a small daily lie.
  // 40.5 a side loads as 25 + 15; the last half kilo has no disc, so the bar
  // ends up at 100 and the answer says so rather than claiming 101.
  const plan = platePlan(101, 20, 'kg');
  assert.equal(plan.exact, false);
  assert.equal(plan.loaded, 100);
  assert.equal(plan.off, -1);
});

test('platePlan handles the bar on its own and refuses less', () => {
  const barOnly = platePlan(20, 20, 'kg');
  assert.equal(barOnly.barOnly, true);
  assert.equal(describePlates(barOnly.perSide), 'just the bar');
  assert.equal(platePlan(15, 20, 'kg'), null, 'lighter than the bar has no answer');
  assert.equal(platePlan(null, 20, 'kg'), null);
});

test('platePlan uses the pound rack for pounds', () => {
  const plan = platePlan(225, 45, 'lb');
  assert.equal(plan.exact, true);
  assert.equal(describePlates(plan.perSide), '2 × 45');
});

/* ========================== warming up ========================== */

test('warm-up sets: two on a barbell lift, one on everything else', () => {
  assert.equal(warmupCount(BENCH), 2);
  assert.equal(warmupCount(exercise('m', 'Machine Chest Press', ['chest'])), 2,
    'a benchmark name counts even without barbell equipment');
  assert.equal(warmupCount({ name: 'Cable Fly', equipment: 'Cable' }), 1);
  assert.equal(warmupCount({ name: 'Lateral Raise', equipment: 'Dumbbell' }), 1);
});

test('warm-up weights stay under the working set and land on real plates', () => {
  const sets = warmupSets(BENCH, 100, { units: 'kg', barWeight: 20 });
  assert.equal(sets.length, 2);
  for (const s of sets) {
    assert.ok(s.weight < 100, 'a warm-up heavier than the work is not a warm-up');
    assert.ok(s.weight >= 20, 'and never lighter than the empty bar');
    // Loadable: (weight - bar) / 2 must come out of the plate set.
    const plan = platePlan(s.weight, 20, 'kg');
    assert.equal(plan.exact, true, `${s.weight} kg cannot be loaded`);
  }
  assert.ok(sets[0].weight < sets[1].weight, 'and they ramp upwards');
  assert.ok(sets[0].reps > sets[1].reps, 'with reps coming down as weight goes up');
});

test('warm-up sets refuse when there is nothing to ramp towards', () => {
  assert.deepEqual(warmupSets(BENCH, 0), []);
  assert.deepEqual(warmupSets(BENCH, null), []);
  // A working weight at or under the empty bar leaves nothing sensible to do.
  assert.deepEqual(warmupSets(BENCH, 20, { units: 'kg', barWeight: 20 }), []);
});

test('warm-up sets do not repeat the same weight twice', () => {
  // Light dumbbell work rounds both steps onto the same number.
  const sets = warmupSets({ name: 'Lateral Raise', equipment: 'Dumbbell' }, 8, { units: 'kg' });
  const weights = sets.map((s) => s.weight);
  assert.equal(new Set(weights).size, weights.length);
});

/* ===================== is it still moving ===================== */

/** n sessions of one exercise, one a week, at a constant or climbing load. */
function series(exercise, { weeks, from, step }) {
  const out = [];
  for (let i = 0; i < weeks; i++) {
    const t = at(2026, 7, 28) - (weeks - 1 - i) * 7 * 86400000;
    out.push(session(t, [entry(exercise.id, [set(from + i * step, 8)])]));
  }
  return out;
}

test('stallReport says nothing without enough lifts to compare', () => {
  const only = series(BENCH, { weeks: 6, from: 80, step: 2.5 });
  assert.equal(stallReport(only, byId), null, 'one lift is not a picture');
});

test('stallReport separates climbing lifts from stalled ones', () => {
  const squat = exercise('ex_squat', 'Back Squat', ['quads']);
  const row = exercise('ex_row', 'Barbell Row', ['lats']);
  const all = new Map([[BENCH.id, BENCH], [squat.id, squat], [row.id, row]]);

  const sessions = [
    ...series(BENCH, { weeks: 6, from: 80, step: 2.5 }),   // climbing
    ...series(squat, { weeks: 6, from: 100, step: 0 }),    // flat
    ...series(row, { weeks: 6, from: 70, step: -1 }),      // falling
  ];

  const report = stallReport(sessions, all);
  assert.equal(report.tracked, 3);
  assert.equal(report.stalled, 2, 'flat and falling both count as not gaining');
  assert.equal(report.falling, 1);
  assert.ok(report.names.includes('Barbell Row'));
  assert.ok(!report.names.includes('Barbell Bench Press'));
});

test('describeStall reports and never prescribes', () => {
  const squat = exercise('ex_squat', 'Back Squat', ['quads']);
  const row = exercise('ex_row', 'Barbell Row', ['lats']);
  const all = new Map([[BENCH.id, BENCH], [squat.id, squat], [row.id, row]]);
  const sessions = [
    ...series(BENCH, { weeks: 6, from: 80, step: 0 }),
    ...series(squat, { weeks: 6, from: 100, step: 0 }),
    ...series(row, { weeks: 6, from: 70, step: 0 }),
  ];

  const report = stallReport(sessions, all);

  // Both languages, because the rule is about what the app is allowed to say,
  // not about which table the sentence happens to live in. A German
  // translation that slipped in a "solltest" would break the promise just as
  // thoroughly as an English "you should".
  const BANNED = {
    en: ['deload', 'should', 'need to', 'take a', 'too much', 'overtrain'],
    de: ['deload', 'solltest', 'musst', 'zu viel', 'übertrain', 'leg eine', 'nimm dir'],
  };

  for (const lang of ['en', 'de']) {
    setLanguage(lang);
    const text = describeStall(report).join(' ').toLowerCase();
    assert.ok(text.includes('3'), `${lang}: the count has to survive translation`);
    for (const word of BANNED[lang]) {
      assert.ok(!text.includes(word), `${lang}: the observation must not say "${word}"`);
    }
  }
  setLanguage('en');
});

test('a week boundary is a calendar week, not seven times 86400000', () => {
  // Europe/Berlin puts the clocks forward on Sunday 29 March 2026, so the week
  // starting Monday the 23rd is 167 hours long. Adding a fixed seven days of
  // milliseconds to its start lands on Monday the 30th at 01:00, and everything
  // logged in that first hour of the next week gets counted in this one.
  //
  // This is the third time this app has been bitten by fixed-millisecond week
  // arithmetic. The first two only surfaced months later, at a clock change.
  const now = new Date(2026, 3, 10, 12).getTime();        // 10 April 2026
  const mondayAfter = new Date(2026, 2, 30, 0, 30).getTime();  // Mon 30 Mar, 00:30

  const { weeks } = timeline(
    { bodyweight: [{ id: 'b', date: mondayAfter, weight: 80 }] },
    { weeks: 4, now },
  );

  const dstWeek = weeks.find((w) => new Date(w.week).getDate() === 23
    && new Date(w.week).getMonth() === 2);
  assert.ok(dstWeek, 'the week of 23 March is in the window');
  assert.equal(dstWeek.bodyweight, null,
    'a weigh-in on the Monday belongs to the Monday, not to the week before it');

  const ownWeek = weeks.find((w) => new Date(w.week).getDate() === 30
    && new Date(w.week).getMonth() === 2);
  assert.equal(ownWeek.bodyweight, 80, 'and it does land in its own week');
});

/* ============ what a restore must not destroy ============ */

test('the device key store is not in the list a restore wipes', () => {
  // A restore clears every store and writes the backup in. `keys` holds this
  // device's identity for the cloud backup, which no backup contains, so
  // clearing it turned "restore from the cloud" into "lock this device out of
  // the cloud": it came back a stranger and could no longer unwrap the data key
  // it had just used to read the download.
  const wiped = Object.values(STORES).filter((store) => store !== STORES.keys);

  assert.ok(STORES.keys, 'the store exists');
  assert.ok(!wiped.includes(STORES.keys), 'and a restore leaves it alone');
  assert.ok(wiped.includes(STORES.sessions), 'while still clearing the log itself');
  assert.equal(wiped.length, Object.values(STORES).length - 1, 'exactly one exception');
});

/* ============ the app's two bodyweights ============ */

test('macro targets refuse to answer without a protein band', () => {
  // Reachable: maintenance is derived from the weigh-in log, the protein band
  // from the profile setting, and only the profile form writes both. Log your
  // weight from the Progress screen and never open the profile, and this pair
  // disagrees. Returning ok:true here handed the screen a null protein band to
  // read `.low` off, and carbs silently absorbed protein's whole share.
  const maintenance = { ok: true, maintenance: 2400 };
  const targets = macroTargets({ units: 'kg', goal: 'hold' }, maintenance);

  assert.equal(targets.ok, false, 'no bodyweight means no protein band means no chain');
  assert.equal(targets.protein, null);
  assert.ok(targets.reason, 'and it says which part is missing');
});

test('macro targets still answer once the bodyweight is there', () => {
  const targets = macroTargets({ units: 'kg', goal: 'hold', bodyweight: 82 },
    { ok: true, maintenance: 2400 });
  assert.equal(targets.ok, true);
  assert.ok(targets.protein.low > 0 && targets.carbs.high > 0);
});

test('latestWeight is the newest weigh-in, whatever order the log is in', () => {
  const log = [
    { id: 'a', date: 1000, weight: 80 },
    { id: 'c', date: 3000, weight: 84 },
    { id: 'b', date: 2000, weight: 82 },
  ];
  assert.equal(latestWeight(log), 84);
  // Backdating an entry must not become "your weight now".
  assert.equal(latestWeight([...log, { id: 'old', date: 500, weight: 70 }]), 84);
  assert.equal(latestWeight([]), null);
});

/* ================= eating next to training ================= */

/** `n` days back from `at`, as the day key meals are stored under. */
function dayBack(n, at = Date.now()) {
  const d = new Date(at);
  d.setDate(d.getDate() - n);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dayMeal = (day, kcal, protein) => ({
  day, kcal, protein, carbs: 40, fat: 10, fibre: 3, amount: 1, micros: {},
});

test('a week without enough logged days reports no intake, not a zero', () => {
  // Three days in the most recent week, which is one short of the convention.
  // Anchor on a Wednesday so this remains one week even when the suite itself
  // happens to run on a Sunday or Monday.
  const now = new Date('2026-08-12T12:00:00').getTime();
  const meals = [0, 1, 2].map((i) => dayMeal(dayBack(i, now), 2000, 150));
  const { weeks } = timeline({ meals }, { weeks: 2, now });
  const last = weeks[weeks.length - 1];

  assert.equal(last.loggedDays, 3, 'the days themselves are still counted');
  assert.equal(last.intake, null, 'three days is below the floor, so there is no average');
  assert.ok(MIN_LOGGED_DAYS > 3, 'this test only means anything while the floor is above three');
});

test('an intake average counts only the days that carry the value', () => {
  // Five logged days, two of them with no calorie figure at all. Averaging
  // those in as zero would report 1200 kcal for a 2000 kcal week.
  const meals = [
    dayMeal(dayBack(0), 2000, 150),
    dayMeal(dayBack(1), 2000, 150),
    dayMeal(dayBack(2), 2000, 150),
    dayMeal(dayBack(3), 0, 150),
    dayMeal(dayBack(4), 0, 150),
  ];
  const { weeks } = timeline({ meals }, { weeks: 3 });
  const withIntake = weeks.filter((w) => w.intake);
  const total = withIntake.reduce((n, w) => n + w.intake.kcal, 0) / withIntake.length;

  assert.ok(withIntake.length >= 1, 'five days clears the floor');
  assert.equal(Math.round(total), 2000, 'the days without calories are unknown, not zero');
});

test('bodyweight is only reported for weeks you actually weighed', () => {
  const now = Date.now();
  const meals = [0, 1, 2, 3, 4].map((i) => dayMeal(dayBack(i), 2200, 160));
  // Deliberately in an older week: a weigh-in in the newest week cannot be
  // carried forward into anything, so a fixture built that way would pass
  // against the very bug this test exists to catch.
  const bodyweight = [{ id: 'b1', date: now - 16 * 86400000, weight: 82 }];

  const { weeks } = timeline({ meals, bodyweight }, { weeks: 4 });
  const weighed = weeks.filter((w) => w.bodyweight !== null);

  assert.equal(weighed.length, 1, 'one weigh-in shows up in exactly one week, not in every week after it');
  assert.equal(weighed[0].bodyweight, 82);
  assert.equal(weighed[0].weighIns, 1);
  assert.equal(weeks[weeks.length - 1].bodyweight, null,
    'the newest week did not weigh, so it stays empty rather than repeating 82');
});

test('training and eating land in the same week buckets', () => {
  const now = Date.now();
  const meals = [0, 1, 2, 3, 4].map((i) => dayMeal(dayBack(i), 2200, 160));
  const sessions = [{
    id: 's1', startedAt: now - 86400000, finishedAt: now - 86400000 + 3600000,
    entries: [{ exerciseId: 'ex', sets: [{ weight: 100, reps: 5, done: true, type: 'working' }] }],
  }];

  const { weeks } = timeline({ sessions, meals }, { weeks: 4 });
  const trained = weeks.filter((w) => w.sets > 0);
  const ate = weeks.filter((w) => w.intake);

  assert.equal(trained.length, 1);
  assert.ok(ate.length >= 1);
  assert.equal(trained[0].week, ate[ate.length - 1].week,
    'a session and the meals from the same days share one bucket');
});

test('the timeline waits for a second week rather than drawing one point', () => {
  const oneWeek = [0, 1, 2, 3, 4].map((i) => dayMeal(dayBack(i), 2200, 160));
  assert.equal(timelineReady(timeline({ meals: oneWeek }, { weeks: 4 })), false);

  const twoWeeks = [...oneWeek, ...[7, 8, 9, 10, 11].map((i) => dayMeal(dayBack(i), 2200, 160))];
  assert.equal(timelineReady(timeline({ meals: twoWeeks }, { weeks: 4 })), true);
});

/* ======================= sharing a plan ======================= */

test('a plan survives the round trip through a link', async () => {
  const plan = {
    name: 'PPL', perWeek: 1, repTarget: '6-10',
    days: [
      // weekday 0 is Sunday and must not be read as "no day set".
      { id: 'd1', name: 'Push', weekday: 0, items: [{ exerciseId: BENCH.id, targetSets: 3, targetReps: '6-10' }] },
      { id: 'd2', name: 'Pull', weekday: null, items: [] },
    ],
  };
  const url = await planLink(plan, byId, 'https://example.test/');
  const decoded = await decodeLink(url.split('#/share/')[1]);

  assert.equal(decoded.ok, true);
  assert.equal(decoded.plan.name, 'PPL');
  assert.equal(decoded.plan.days[0].weekday, 0, 'Sunday survived');
  assert.equal(decoded.plan.days[1].weekday, null);
  assert.equal(decoded.plan.days[0].items[0].name, 'Barbell Bench Press');
  assert.equal(decoded.plan.days[0].items[0].sets, 3);
});

test('a damaged link is a message, not a crash', async () => {
  for (const code of ['', 'zzz', 'qnot-base64']) {
    const res = await decodeLink(code);
    assert.equal(res.ok, false);
    assert.ok(res.detail.length > 0);
  }
});

test('import resolves by name and reports what is missing', () => {
  const shared = { days: [{ items: [{ name: 'barbell bench press' }, { name: 'Cable Fly' }] }] };
  const { matched, missing } = resolveAgainstLibrary(shared, [BENCH]);
  assert.equal(matched.length, 1, 'case and spacing must not matter');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].name, 'Cable Fly');
});

/* ===================== what the card may claim ===================== */

const PROFILE = { sex: 'male', age: 30, bodyweight: 82, showRatings: true };
const CARD_INPUT = (over = {}) => ({
  sessions: [session(at(2026, 7, 28), [entry(BENCH.id, [set(100, 5)])])],
  exerciseById: byId,
  settings: PROFILE,
  bodyweight: [{ id: 'b', date: at(2026, 7, 1), weight: 82 }],
  plan: null,
  units: 'kg',
  weekStart: startOfWeek(at(2026, 7, 28)),
  mapMode: 'strength',
  ...over,
});

test('the card shows a score when the app would', () => {
  const s = weekSummary(CARD_INPUT());
  assert.ok(s.strength, 'a benchmark lift and a profile is all it needs');
  assert.equal(s.mapMode, 'strength');
  assert.equal(s.strengthMissing, null);
});

test('the card hides the score exactly when the app hides it', () => {
  for (const settings of [
    { ...PROFILE, showRatings: false },
    { ...PROFILE, sex: null },
    { ...PROFILE, bodyweight: null },
  ]) {
    const s = weekSummary(CARD_INPUT({ settings }));
    assert.equal(s.strength, null);
    assert.ok(s.strengthMissing, 'and says which of the reasons it is');
    assert.equal(s.mapMode, 'progress', 'no tier map without a rating behind it');
  }
});

test('a movement logged for the first time is not a personal best', () => {
  const s = weekSummary(CARD_INPUT());
  assert.deepEqual(s.bests, [], 'week one is not a wall of records');
});

test('beating your own best is', () => {
  const s = weekSummary(CARD_INPUT({
    sessions: [
      session(at(2026, 7, 20), [entry(BENCH.id, [set(90, 5)])]),
      session(at(2026, 7, 28), [entry(BENCH.id, [set(100, 5)])]),
    ],
  }));
  assert.equal(s.bests.length, 1);
  assert.equal(s.bests[0].name, 'Barbell Bench Press');
  assert.ok(s.bests[0].to > s.bests[0].from);
});

test('the score delta matches the two numbers a reader can compare', () => {
  // Printed rounded, so the delta is the difference of the rounded scores —
  // otherwise a card reads "29" next to "no change" beside last week's "28".
  const sessions = [
    session(at(2026, 7, 20), [entry(BENCH.id, [set(100, 5)])]),
    session(at(2026, 7, 28), [entry(BENCH.id, [set(130, 5)])]),
  ];
  const thisWeek = weekSummary(CARD_INPUT({ sessions }));
  const lastWeek = weekSummary(CARD_INPUT({ sessions, weekStart: startOfWeek(at(2026, 7, 20)) }));
  assert.equal(
    thisWeek.strength.delta,
    Math.round(thisWeek.strength.score) - Math.round(lastWeek.strength.score)
  );
});

test('the card reports a bodyweight move, because the score is relative to it', () => {
  const s = weekSummary(CARD_INPUT({
    bodyweight: [
      { id: 'a', date: at(2026, 7, 20), weight: 82 },
      { id: 'b', date: at(2026, 7, 30), weight: 84 },
    ],
  }));
  assert.equal(s.bodyweightShift, 2);
});

test('the strength history buckets by calendar week, not by fixed milliseconds', () => {
  // Same clock change as the timeline test: the week starting Monday 23 March
  // 2026 is 167 hours long in Europe/Berlin. `week + 7 * 86400000` therefore
  // lands at 01:00 on Monday the 30th, and a session lifted in that first hour
  // of the new week was credited to the week before it.
  const mondayAfter = new Date(2026, 2, 30, 0, 30).getTime();
  const sessions = [session(mondayAfter, [entry(BENCH.id, [set(140, 5)])])];
  const bw = [{ id: 'b', date: new Date(2026, 0, 5).getTime(), weight: 82 }];

  const history = strengthHistory(sessions, bw, PROFILE, byId, 4, new Date(2026, 3, 10, 12).getTime());
  const dstWeek = history.find((h) => new Date(h.week).getMonth() === 2
    && new Date(h.week).getDate() === 23);

  assert.equal(dstWeek, undefined,
    'the week of 23 March saw no lifting, so it gets no score');
  assert.ok(history.some((h) => new Date(h.week).getDate() === 30),
    'the session counts from the week it actually happened in');
});

test('strengthAt is the score as it stood then, not as it stands now', () => {
  const sessions = [
    session(at(2026, 7, 20), [entry(BENCH.id, [set(100, 5)])]),
    session(at(2026, 7, 28), [entry(BENCH.id, [set(140, 5)])]),
  ];
  const bw = [{ id: 'b', date: at(2026, 7, 1), weight: 82 }];
  const before = strengthAt(sessions, bw, PROFILE, byId, at(2026, 7, 26));
  const after = strengthAt(sessions, bw, PROFILE, byId, at(2026, 7, 30));
  assert.ok(after.overall > before.overall);

  // Cumulative: a week off does not undo strength you have shown.
  const later = strengthAt(sessions, bw, PROFILE, byId, at(2026, 9, 1));
  assert.equal(later.overall, after.overall);
});
