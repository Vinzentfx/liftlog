// Was wirklich trainiert wurde, genauso gezählt wie ein Plan.
//
// Das Belastungsdiagramm auf Home hat früher rohe Arbeitssätze gegen die groben
// Muskelnamen gezählt ("Brust", "Rücken"), die Planbewertung dagegen anteilige
// Sätze über die 15 Regionen der Muskelkarte. Zwei Zahlen für dieselbe Sache: der
// Plan sagte "Latissimus 12", das Diagramm "Rücken 8", und nirgends stand, dass
// verschieden gemessen wird. Hier gilt überall die Zählweise des Plans:
// Hauptmuskeln bekommen den ganzen Satz, Nebenmuskeln einen halben
// (SOURCES.pelland2026). "Geplant" und "gemacht" lassen sich jetzt vergleichen.

import { t } from './i18n.js';
import { startOfWeek, isCounted } from './models.js';
import { rateExercise } from './exercise-rating.js';
import { THRESHOLDS } from './evidence.js';

const INDIRECT = THRESHOLDS.indirectSetWeight.value;

/**
 * Eine Woche abgeschlossener Einheiten.
 *
 * @param sessions  alle Einheiten, Reihenfolge egal
 * @param byId      Map von Übungs-ID auf Übung
 * @param weekStart Zeitstempel (ms) des Montags, um den es geht
 */
export function analyseWeek(sessions, byId, weekStart = startOfWeek(Date.now())) {
  const volume = {};       // je Region:anteilige Sätze
  const frequency = {};    // je Region:Einheiten, die sie treffen
  const peakSession = {};  // je Region:meiste anteilige Sätze in einer Einheit
  let totalSets = 0;
  let longSets = 0;
  let workouts = 0;

  // Anstrengung. Gezählt werden nur Arbeitssätze, ein Aufwärmsatz mit 8 in Reserve
  // sagt nichts darüber, wie hart trainiert wurde.
  let rirLogged = 0;
  let rirHard = 0;     // 0 bis 2 Wiederholungen in Reserve
  let rirSum = 0;

  for (const s of sessions) {
    if (!s.finishedAt) continue;
    if (startOfWeek(s.startedAt) !== weekStart) continue;
    workouts++;

    const inDay = {};
    const touched = new Set();

    for (const entry of s.entries || []) {
      const ex = byId.get(entry.exerciseId);
      if (!ex) continue;
      const counted = (entry.sets || []).filter(isCounted);
      if (!counted.length) continue;

      totalSets += counted.length;
      const rating = rateExercise(ex);
      if (rating && rating.length.bias === 'long') longSets += counted.length;

      for (const set of counted) {
        if (set.rir === null || set.rir === undefined) continue;
        rirLogged++;
        rirSum += Number(set.rir);
        if (Number(set.rir) <= 2) rirHard++;
      }

      for (const r of ex.primary || []) {
        volume[r] = (volume[r] || 0) + counted.length;
        inDay[r] = (inDay[r] || 0) + counted.length;
        touched.add(r);
      }
      for (const r of ex.secondary || []) {
        volume[r] = (volume[r] || 0) + counted.length * INDIRECT;
        inDay[r] = (inDay[r] || 0) + counted.length * INDIRECT;
        touched.add(r);
      }
    }

    for (const r of touched) frequency[r] = (frequency[r] || 0) + 1;
    for (const [r, n] of Object.entries(inDay)) peakSession[r] = Math.max(peakSession[r] || 0, n);
  }

  return {
    weekStart, workouts, volume, frequency, peakSession, totalSets,
    longShare: totalSets ? longSets / totalSets : 0,
    effort: {
      logged: rirLogged,
      total: totalSets,
      mean: rirLogged ? rirSum / rirLogged : null,
      hardShare: rirLogged ? rirHard / rirLogged : null,
    },
  };
}

/**
 * Gemacht gegen geplant, je Muskel. `plan` ist ein Ergebnis von analysePlan()
 * oder null, wenn kein Plan aktiv ist, dann gilt die ACSM-Untergrenze pro Woche.
 *
 * @returns Zeilen, die mit dem größten Rückstand zuerst
 */
export function compareToPlan(week, plan) {
  const floor = THRESHOLDS.weeklyFloor.value;
  const regions = new Set([
    ...Object.keys(week.volume),
    ...(plan ? Object.keys(plan.volume) : []),
  ]);

  const rows = [];
  for (const r of regions) {
    const done = week.volume[r] || 0;
    const target = plan ? (plan.volume[r] || 0) : floor;
    // Muskeln, die weder trainiert noch geplant sind, sind Rauschen und kein Rückstand.
    if (!done && !target) continue;
    rows.push({
      region: r,
      done: Math.round(done * 10) / 10,
      target: Math.round(target * 10) / 10,
      ratio: target > 0 ? done / target : 1,
      short: target > 0 ? Math.max(0, target - done) : 0,
    });
  }
  return rows.sort((a, b) => b.short - a.short || b.done - a.done);
}

/**
 * Wochen am Stück bis `at` mit mindestens einem abgeschlossenen Training.
 *
 * Die Woche, in der `at` liegt, darf leer sein, ohne die Serie zu brechen. Ohne
 * diese Kulanz stünde jede Serie bis zum ersten Training der Woche auf 0, also
 * genau dann, wenn man am wenigsten hören will, dass man keine hat.
 *
 * Zurückgezählt wird mit setDate statt 7 x 86400000 abzuziehen: über eine
 * Zeitumstellung landet eine Woche mit festen Millisekunden eine Stunde neben
 * Mitternacht, der Schlüssel passt nicht mehr zu startOfWeek(), und die Serie
 * fällt zweimal im Jahr still auf 1. In den Wochendiagrammen war das behoben, in
 * den beiden Kopien dieser Funktion auf Home und Fortschritt nicht. Deshalb gibt
 * es jetzt nur noch diese eine hier.
 */
export function weekStreak(sessions, at = Date.now()) {
  const weeks = new Set(
    sessions.filter((s) => s.finishedAt).map((s) => startOfWeek(s.startedAt))
  );
  let cursor = startOfWeek(at);
  if (!weeks.has(cursor)) cursor = previousWeek(cursor);
  let n = 0;
  while (weeks.has(cursor)) { n++; cursor = previousWeek(cursor); }
  return n;
}

function previousWeek(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() - 7);
  return startOfWeek(d.getTime());
}

/**
 * Liegt die Woche bis jetzt im Plan?
 *
 * Den Dienstag an einem ganzen Wochenziel zu messen würde jede Woche bis Sonntag
 * rot anzeigen, und so eine Anzeige schaut man sich kein zweites Mal an. Gemessen
 * wird deshalb daran, wie weit man im Plan ist: zwei von fünf Tagen erledigt heißt,
 * man sollte etwa bei 40 % sein.
 *
 * @param plannedDays wie viele Einheiten der aktive Plan hat, 0 ohne Plan
 */
export function weekVerdict(week, rows, plannedDays = 0) {
  if (!week.workouts) return { headline: t('weekVerdict.nothing'), tone: 'faint', behind: [], pace: 0 };

  const daysIn = Math.min(7, Math.floor((Date.now() - week.weekStart) / 86400000) + 1);
  const pace = plannedDays
    ? Math.min(1, week.workouts / plannedDays)
    : Math.min(1, daysIn / 7);

  const withTarget = rows.filter((r) => r.target > 0);
  const onTrack = withTarget.filter((r) => r.ratio >= pace * 0.9);
  const behind = withTarget.filter((r) => r.ratio < pace * 0.7);

  const done = pace >= 1;
  return {
    headline: withTarget.length
      ? done
        ? t('weekVerdict.hit', {
            hit: withTarget.filter((r) => r.ratio >= 1).length, total: withTarget.length,
          })
        // Ohne Plan gibt es keine Anzahl an Einheiten, bei der man mittendrin sein
        // könnte, und "2 von ? Einheiten" sieht aus wie ein Fehler. Also nur sagen, was man weiß.
        : plannedDays
          ? t('weekVerdict.onPaceWithPlan', {
              onTrack: onTrack.length, total: withTarget.length,
              done: week.workouts, planned: plannedDays,
            })
          : t('weekVerdict.onPace', { onTrack: onTrack.length, total: withTarget.length })
      : t('weekVerdict.setsLogged', { n: week.totalSets }),
    tone: behind.length > withTarget.length * 0.4 ? 'warn' : 'good',
    behind,
    pace,
  };
}
