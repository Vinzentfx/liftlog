// Essen und Training in denselben Wochen.
//
// Beides gab es in der App schon immer, nur nie nebeneinander. "Ich habe mehr
// gegessen und meine Sätze sind hochgegangen" musste man sich über zwei Screens
// hinweg merken. Das hier legt beides auf eine gemeinsame Zeitachse, und mehr nicht.
//
// Mehr nicht, mit Absicht. Drei Kurven, die sich zusammen bewegen, beweisen
// nicht, dass die eine die andere bewegt hat: ein Trainingsblock, Urlaub,
// Krankheit oder ein neuer Job schieben mehrere davon gleichzeitig, und bei n=1
// ohne Vergleich lässt sich nicht sagen, in welche Richtung der Pfeil zeigt. Also
// rechnet dieses Modul, der Screen zeichnet, und keiner von beiden benutzt das
// Wort "weil". Aus demselben Grund gibt es keinen Korrelationskoeffizienten, eine
// Zahl würde sich wie ein Befund lesen.
//
// Die Regel aus dem Rest der App gilt auch hier: eine Woche, in der nichts
// eingetragen wurde, ist null und nie null Kalorien. Vergessene Wochen
// mitzurechnen würde einen guten Monat schlecht aussehen lassen, und dann hört
// man am schnellsten auf einzutragen.

import { startOfWeek } from './models.js';
import { dayTotals } from './nutrition.js';
import { tonnageHistory } from './history.js';

/**
 * Wie viele eingetragene Tage eine Woche braucht, bevor ihr Durchschnitt angezeigt wird.
 *
 * Eine Festlegung, kein Befund: bei zwei von sieben Tagen sagt der Mittelwert
 * mehr darüber, an welche Tage man gedacht hat, als darüber, was man gegessen
 * hat. Vier ist knapp die Mehrheit der Woche und wird überall, wo es steht, als
 * Festlegung benannt.
 */
export const MIN_LOGGED_DAYS = 4;

/**
 * @param {object} sources  { sessions, meals, bodyweight }
 * @param {object} opts     { weeks, now }
 * @returns {{weeks: object[], coverage: {withIntake: number, total: number}}}
 */
export function timeline({ sessions = [], meals = [], bodyweight = [] },
  { weeks = 12, now = Date.now() } = {}) {

  const training = tonnageHistory(sessions, weeks, now);

  // Mahlzeiten haben einen Tagesschlüssel statt eines Zeitstempels. Die Woche kommt
  // deshalb aus diesem Schlüssel, gelesen um 12 Uhr mittags: ein reines Datum als
  // UTC zu lesen und in einer negativen Zeitzone zurückzurechnen landet am Vortag.
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

    // Für den Mittelwert zählen nur Tage, die den Wert auch haben. Ein Tag ohne
    // Kalorien ist ein eingetragener Tag und kein Tag mit null Kalorien.
    const meanOf = (pick) => {
      const values = totals.map(pick).filter((v) => Number.isFinite(v) && v > 0);
      if (!values.length) return null;
      return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    };

    const intake = loggedDays >= MIN_LOGGED_DAYS
      ? { kcal: meanOf((t) => t.kcal), protein: meanOf((t) => t.protein), days: loggedDays }
      : null;

    // Nur Wiegen, das in der Woche stattgefunden hat. Den letzten Wert
    // weiterzuziehen würde eine flache Linie durch Tage malen, an denen niemand
    // auf der Waage stand, und eine Gewichtskurve muss Wiegen zeigen, keine Interpolation.
    //
    // In Kalendertagen weitergezählt statt in 7 * 86400000: eine Woche mit
    // Zeitumstellung hat 167 oder 169 Stunden, und mit festen Millisekunden lag die
    // Grenze eine Stunde im Montag. Alles, was in dieser Stunde gewogen wurde, landete
    // in der Woche davor. Den Fehler hatte die App schon zweimal und hat es jedes Mal
    // erst Monate später gemerkt.
    const end = new Date(bucket.week);
    end.setDate(end.getDate() + 7);
    const weekEnd = end.getTime();
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
 * Reicht das, um etwas zu zeichnen?
 *
 * Zwei Wochen mit Essen sind die Untergrenze. Ein Punkt ist keine Zeitleiste, und
 * der ganze Sinn des Screens ist, dass man zwei Dinge über dieselben Wochen sieht.
 */
export function timelineReady(data) {
  return data.coverage.withIntake >= 2;
}
