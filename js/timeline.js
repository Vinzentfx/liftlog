// Eating and training on one set of week buckets.
//
// The app has always had both halves and never put them next to each other, so
// "I ate more and my sets went up" was a thing you had to hold in your head
// across two screens. This lines them up on a shared x-axis and stops there.
//
// It stops there on purpose. Three series moving together is not evidence that
// one moved the other: a training block, a holiday, an illness and a change of
// job all push several of these at once, and n=1 with no control has nothing to
// say about which way the arrow points. So this module computes, the screen
// draws, and neither of them uses the word "because". There is no correlation
// coefficient here either, for the same reason: a number would read as a finding.
//
// The rule the rest of the app lives by carries over unchanged: a week nobody
// logged reports null, never zero. Averaging in the weeks you forgot would make
// a good month look like a bad one, which is the fastest way to stop logging.

import { startOfWeek } from './models.js';
import { dayTotals } from './nutrition.js';
import { tonnageHistory } from './history.js';

/**
 * How many logged days a week needs before its average intake is reported.
 *
 * A convention, not a finding: with two logged days out of seven the mean says
 * more about which days you remembered than about what you ate. Four is a bare
 * majority of the week and is named as a convention wherever it is shown.
 */
export const MIN_LOGGED_DAYS = 4;

/**
 * @param {object} sources  { sessions, meals, bodyweight }
 * @param {object} opts     { weeks, now }
 * @returns {{weeks: object[], coverage: {withIntake: number, total: number}}}
 */
export function timeline({ sessions = [], meals = [], bodyweight = [] },
  { weeks = 12, now = Date.now() } = {}) {

  const training = tonnageHistory(sessions, weeks);

  // Meals carry a day key rather than a timestamp, so the week they belong to
  // comes from parsing that key at midday: parsing a bare date as UTC and then
  // reading it back in a negative offset would land it on the day before.
  const mealsByWeek = new Map();
  for (const m of meals) {
    const ts = new Date(`${m.day}T12:00:00`).getTime();
    if (!Number.isFinite(ts)) continue;
    const week = startOfWeek(ts);
    if (!mealsByWeek.has(week)) mealsByWeek.set(week, new Map());
    const days = mealsByWeek.get(week);
    if (!days.has(m.day)) days.set(m.day, []);
    days.get(m.day).push(m);
  }

  const weighIns = [...bodyweight].sort((a, b) => a.date - b.date);

  const out = training.map((bucket) => {
    const days = mealsByWeek.get(bucket.week) || new Map();
    const totals = [...days.values()].map((dayMeals) => dayTotals(dayMeals));
    const loggedDays = totals.length;

    // Only the days that actually carry the value count towards its mean. A day
    // logged without calories is a logged day and not a zero-calorie one.
    const meanOf = (pick) => {
      const values = totals.map(pick).filter((v) => Number.isFinite(v) && v > 0);
      if (!values.length) return null;
      return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    };

    const intake = loggedDays >= MIN_LOGGED_DAYS
      ? { kcal: meanOf((t) => t.kcal), protein: meanOf((t) => t.protein), days: loggedDays }
      : null;

    // Only weigh-ins that happened inside the week. Carrying the last one
    // forward would draw a flat line through days nobody stood on a scale, and
    // a chart of bodyweight has to show weighing, not interpolation.
    const weekEnd = bucket.week + 7 * 86400000;
    const inWeek = weighIns.filter((b) => b.date >= bucket.week && b.date < weekEnd);
    const weight = inWeek.length
      ? Math.round((inWeek.reduce((n, b) => n + b.weight, 0) / inWeek.length) * 10) / 10
      : null;

    return {
      week: bucket.week,
      loggedDays,
      intake,
      bodyweight: weight,
      weighIns: inWeek.length,
      sets: bucket.sets,
      tonnage: bucket.tonnage,
      workouts: bucket.workouts,
    };
  });

  return {
    weeks: out,
    coverage: {
      withIntake: out.filter((w) => w.intake).length,
      withWeight: out.filter((w) => w.bodyweight !== null).length,
      total: out.length,
      now,
    },
  };
}

/**
 * Is there enough here to be worth drawing?
 *
 * Two weeks of intake is the floor, because one point is not a timeline and the
 * whole promise of the screen is that you can see two things move over the same
 * stretch of weeks.
 */
export function timelineReady(data) {
  return data.coverage.withIntake >= 2;
}
