// Which plan day belongs to which weekday.
//
// Optional throughout. A plan with nothing scheduled behaves exactly as before —
// the Train tab suggests whatever has gone longest without being trained, which
// is the right answer when you train "five times a week, whenever". Scheduling
// is for people who train Monday/Wednesday/Friday and want the app to know it.
//
// A weekday can hold more than one day (a morning and an evening session), and a
// plan day can sit on no weekday at all. Neither is an error state, so nothing
// here validates them away.

const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Monday-first order, because that is how a training week reads. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const weekdayName = (n) => NAMES[n] ?? '—';
export const weekdayShort = (n) => SHORT[n] ?? '—';

/** JS weekday for a timestamp (0 = Sunday). */
export const weekdayOf = (ts = Date.now()) => new Date(ts).getDay();

/** Is anything in this plan scheduled at all? */
export function isScheduled(plan) {
  return !!(plan?.days || []).some((d) => Number.isInteger(d.weekday));
}

/** Plan days assigned to a weekday, in plan order. */
export function daysOn(plan, weekday) {
  return (plan?.days || []).filter((d) => d.weekday === weekday);
}

/** The whole week as rows, for the overview. Rest days are included on purpose. */
export function weekRows(plan) {
  return WEEK_ORDER.map((weekday) => ({
    weekday,
    name: weekdayName(weekday),
    short: weekdayShort(weekday),
    days: daysOn(plan, weekday),
    isToday: weekday === weekdayOf(),
  }));
}

/**
 * What to train today, and what is next.
 *
 * With a schedule this is simply "what is on today". Without one it falls back
 * to the day that has gone longest untrained — the behaviour the Train tab had
 * before scheduling existed, kept because it is genuinely the better answer for
 * anyone training on feel rather than on a calendar.
 */
export function todaysDays(plan, sessions) {
  if (!plan || !plan.days || !plan.days.length) return { scheduled: false, days: [], next: null };

  if (isScheduled(plan)) {
    const today = daysOn(plan, weekdayOf());
    return { scheduled: true, days: today, next: today.length ? null : nextScheduled(plan) };
  }

  // Unscheduled: least-recently-trained first.
  const lastByDay = new Map();
  for (const s of sessions) {
    if (s.finishedAt && s.dayId && !lastByDay.has(s.dayId)) lastByDay.set(s.dayId, s.startedAt);
  }
  const suggested = [...plan.days].sort(
    (a, b) => (lastByDay.get(a.id) || 0) - (lastByDay.get(b.id) || 0))[0];
  return { scheduled: false, days: suggested ? [suggested] : [], next: null };
}

/** The next scheduled day after today, for a rest day's "next up" line. */
function nextScheduled(plan) {
  const today = weekdayOf();
  for (let step = 1; step <= 7; step++) {
    const wd = (today + step) % 7;
    const days = daysOn(plan, wd);
    if (days.length) return { weekday: wd, in: step, day: days[0] };
  }
  return null;
}

/**
 * Weekdays a plan trains, versus how often the plan says it runs.
 *
 * Worth surfacing because the two can silently disagree: a plan with perWeek 2
 * and three scheduled weekdays is counting volume that the calendar will not
 * deliver, and the rating would be scoring a week that never happens.
 */
export function scheduleConflict(plan) {
  if (!plan || !isScheduled(plan)) return null;
  const scheduledDays = (plan.days || []).filter((d) => Number.isInteger(d.weekday)).length;
  const expected = (plan.days || []).length * (plan.perWeek || 1);
  if (scheduledDays === expected) return null;
  return {
    scheduled: scheduledDays,
    expected,
    text: scheduledDays < expected
      ? `${scheduledDays} of ${expected} sessions a week are on the calendar — the rating counts all ${expected}.`
      : `${scheduledDays} sessions scheduled but the plan describes ${expected} a week.`,
  };
}
