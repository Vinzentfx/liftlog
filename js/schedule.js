// Welcher Plantag auf welchen Wochentag fällt.
//
// Überall optional. Ein Plan ohne Wochentage verhält sich wie vorher: der
// Trainieren-Tab schlägt den Tag vor, der am längsten nicht dran war. Das passt
// für alle, die "fünfmal die Woche, wann es gerade passt" trainieren. Wochentage
// sind für Leute, die Montag, Mittwoch und Freitag gehen und das der App sagen wollen.
//
// Ein Wochentag kann mehrere Tage haben (morgens und abends), und ein Plantag
// muss auf keinem Wochentag liegen. Beides ist kein Fehler, deshalb wird hier
// nichts davon wegvalidiert.

import { t } from './i18n.js';

/** Montag zuerst, so liest sich eine Trainingswoche. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const isDay = (n) => Number.isInteger(n) && n >= 0 && n <= 6;

export const weekdayName = (n) => (isDay(n) ? t(`weekday.${n}`) : t('common.empty'));
export const weekdayShort = (n) => (isDay(n) ? t(`weekday.${n}.short`) : t('common.empty'));

/** JS-Wochentag für einen Zeitstempel (0 = Sonntag). */
export const weekdayOf = (ts = Date.now()) => new Date(ts).getDay();

/** Ist in diesem Plan überhaupt etwas eingeplant? */
export function isScheduled(plan) {
  return !!(plan?.days || []).some((d) => Number.isInteger(d.weekday));
}

/** Plantage an einem Wochentag, in der Reihenfolge des Plans. */
export function daysOn(plan, weekday) {
  return (plan?.days || []).filter((d) => d.weekday === weekday);
}

/** Die ganze Woche als Zeilen für die Übersicht. Ruhetage sind mit Absicht dabei. */
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
 * Was heute dran ist und was als Nächstes kommt.
 *
 * Mit Wochentagen heißt das einfach "was steht heute an". Ohne fällt es auf den
 * Tag zurück, der am längsten nicht trainiert wurde. So hat sich der Tab vorher
 * verhalten, und für alle, die nach Gefühl statt nach Kalender trainieren, ist
 * das auch die bessere Antwort.
 */
export function todaysDays(plan, sessions) {
  if (!plan || !plan.days || !plan.days.length) return { scheduled: false, days: [], next: null };

  if (isScheduled(plan)) {
    const today = daysOn(plan, weekdayOf());
    return { scheduled: true, days: today, next: today.length ? null : nextScheduled(plan) };
  }

  // Ohne Wochentage: was am längsten her ist, zuerst.
  const lastByDay = new Map();
  for (const s of sessions) {
    if (s.finishedAt && s.dayId && !lastByDay.has(s.dayId)) lastByDay.set(s.dayId, s.startedAt);
  }
  const suggested = [...plan.days].sort(
    (a, b) => (lastByDay.get(a.id) || 0) - (lastByDay.get(b.id) || 0))[0];
  return { scheduled: false, days: suggested ? [suggested] : [], next: null };
}

/** Der nächste eingeplante Tag nach heute, für die Zeile "als Nächstes" am Ruhetag. */
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
 * An wie vielen Wochentagen ein Plan trainiert, verglichen mit dem, was der Plan
 * über seine Häufigkeit sagt.
 *
 * Das lohnt sich anzuzeigen, weil beides still auseinanderlaufen kann: ein Plan
 * mit perWeek 2 und drei eingeplanten Tagen rechnet mit Volumen, das der
 * Kalender nie liefert, und die Bewertung benotet eine Woche, die es nicht gibt.
 */
export function scheduleConflict(plan) {
  if (!plan || !isScheduled(plan)) return null;
  const scheduledDays = (plan.days || []).filter((d) => Number.isInteger(d.weekday)).length;
  const expected = (plan.days || []).length * (plan.perWeek || 1);
  if (scheduledDays === expected) return null;
  return {
    scheduled: scheduledDays,
    expected,
    text: t(scheduledDays < expected ? 'schedule.fewer' : 'schedule.more',
      { scheduled: scheduledDays, expected }),
  };
}
