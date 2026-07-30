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

const { e1rm, isCounted, startOfWeek, entryStats } = await import('../js/models.js');
const { analyseWeek, compareToPlan, weekVerdict, weekStreak } = await import('../js/log-analysis.js');
const { analysePlan } = await import('../js/plan-rating.js');
const { regionProgress } = await import('../js/region-progress.js');
const { bodyweightAt, strengthAt } = await import('../js/history.js');
const { decodeLink, planLink, resolveAgainstLibrary } = await import('../js/plan-share.js');
const { weekSummary } = await import('../js/week-card.js');
const { THRESHOLDS } = await import('../js/evidence.js');
const { parseNumber } = await import('../js/ui.js');
const { platePlan, describePlates } = await import('../js/plates.js');
const { stallReport, describeStall } = await import('../js/fatigue.js');

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

  const text = describeStall(stallReport(sessions, all)).join(' ').toLowerCase();
  assert.ok(text.includes('3 of 3'));
  for (const word of ['deload', 'should', 'need to', 'take a', 'too much', 'overtrain']) {
    assert.ok(!text.includes(word), `the observation must not say "${word}"`);
  }
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
