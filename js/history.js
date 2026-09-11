// Verläufe über die Zeit: wie viel bewegt wurde, wie stark man geworden ist und
// welche Übungen wirklich vorankommen.
//
// Eine einzelne Übung konnte die App schon gut zeichnen. Was sie nicht beantworten
// konnte, war die Frage, die man sich nach ein paar Monaten wirklich stellt: "werde
// ich stärker?". Die Stärkebewertung wurde nur für HEUTE berechnet, aus den besten
// Werten aller Zeiten. Sie Woche für Woche neu zu rechnen macht aus einem
// Schnappschuss eine Linie.
//
// Alles hier wird bei Bedarf aus dem Trainingslog abgeleitet, gespeichert wird
// nichts. Ein zwischengespeicherter Verlauf wäre veraltet, sobald eine Einheit
// geändert oder gelöscht wird, und das Neurechnen ist bei einem persönlichen Log billig.

import { startOfWeek, isCounted, e1rm, entryStats, linearFit, withinE1rmWindow } from './models.js';
import {
  buildRating, hasProfile, ratedMachineNames, isRateable, regionsFromExercises,
} from './standards.js';

// Nur für Dauern und Rückblick-Fenster, nie für eine Wochengrenze: eine Woche mit
// Zeitumstellung ist nicht so lang. Alles, was entscheidet, in welche Woche ein
// Zeitstempel gehört, zählt stattdessen in Kalendertagen.
const WEEK = 7 * 86400000;
const BODYWEIGHT_LIFTS = new Set(['Pull-Up', 'Chin-Up', 'Dip']);

/**
 * Die Bestwerte im Zeitfenster, ergänzt um ältere für Übungen, die sonst nichts
 * haben, mit derselben `extrapolated`-Markierung, die buildRating erwartet.
 */
function withFallbacks(best, outside) {
  const merged = new Map(best);
  const extrapolated = new Set();
  for (const [name, est] of outside) {
    if (merged.has(name)) continue;
    merged.set(name, est);
    extrapolated.add(name);
  }
  merged.extrapolated = extrapolated;
  return merged;
}

function historicalE1rm(name, set, bodyweight) {
  if (!BODYWEIGHT_LIFTS.has(name)) return e1rm(set.weight, set.reps);
  const added = Number(set.weight) || 0;
  if (!(bodyweight > 0) || (added > 0 && set.loadMode !== 'added')) return 0;
  return e1rm(bodyweight + added, set.reps);
}

/** Wochenanfänge als Zeitstempel, die ältesten zuerst, in Kalendertagen wegen der Zeitumstellung. */
function weekStarts(count, endTs = Date.now()) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(startOfWeek(endTs));
    d.setDate(d.getDate() - i * 7);
    out.push(startOfWeek(d.getTime()));
  }
  return out;
}

/**
 * Bewegte Last pro Woche.
 *
 * Tonnage ist Gewicht x Wiederholungen über alle Arbeitssätze. Ein grobes Maß:
 * es belohnt viele Wiederholungen mit wenig Gewicht und sagt nichts über die
 * Anstrengung. Aber es ist die ehrliche Antwort auf "wie viel habe ich diese Woche
 * bewegt", und die Zahl steigt sichtbar, lange bevor sich beim 1RM etwas tut.
 */
export function tonnageHistory(sessions, weeks = 12, endTs = Date.now()) {
  const buckets = weekStarts(weeks, endTs).map((week) => ({
    week, tonnage: 0, sets: 0, reps: 0, workouts: 0,
  }));
  const index = new Map(buckets.map((b) => [b.week, b]));

  for (const s of sessions) {
    if (!s.finishedAt) continue;
    const b = index.get(startOfWeek(s.startedAt));
    if (!b) continue;
    b.workouts++;
    for (const entry of s.entries || []) {
      const st = entryStats(entry);
      b.tonnage += st.volume;
      b.sets += st.sets;
      b.reps += st.reps;
    }
  }
  return buckets;
}

/**
 * Die Gesamtstärke, für jede Woche so neu berechnet, wie sie DAMALS stand.
 *
 * Zwei Details entscheiden, ob die Linie etwas bedeutet:
 *
 *  - Das beste e1RM bis dahin ist kumulativ. Eine Woche ohne Bankdrücken senkt
 *    den Wert fürs Bankdrücken nicht. Gezeigte Stärke verschwindet nicht, nur weil
 *    man eine Woche Pause gemacht hat.
 *  - Das Körpergewicht ist der Eintrag aus dieser Woche, nicht der von heute. Die
 *    Wertung hängt am Körpergewicht, und das heutige festzuhalten würde bei jeder
 *    Bewegung der Waage die Vergangenheit umschreiben. Ein Aufbau würde einen im
 *    Nachhinein im März schwächer aussehen lassen.
 *
 * @returns [{ week, score, tier, lifts }] für Wochen mit genug Daten, sonst []
 */
export function strengthHistory(sessions, bodyweightLog, profile, exerciseById, weeks = 16,
  endTs = Date.now(), corrections = {}) {
  if (!hasProfile(profile)) return [];

  const finished = sessions
    .filter((s) => s.finishedAt)
    .sort((a, b) => a.startedAt - b.startedAt);
  if (!finished.length) return [];

  const bw = [...(bodyweightLog || [])].sort((a, b) => a.date - b.date);
  const best = new Map();          // Übungsname -> bestes e1RM bis dahin, im Fenster
  const outside = new Map();       // und der Rückfall für Übungen, die darin nie trainiert wurden
  const machineNames = ratedMachineNames([...exerciseById.values()]);
  const regionsByName = regionsFromExercises([...exerciseById.values()]);
  let cursor = 0;                  // wie weit wir in `finished` schon sind

  const out = [];
  for (const week of weekStarts(weeks, endTs)) {
    // In Kalendertagen weitergezählt, nicht in einer festen WEEK in Millisekunden.
    // Eine Woche mit Zeitumstellung hat 167 oder 169 Stunden, mit festen Werten lag
    // diese Grenze eine Stunde im Montag, und die erste Stunde der nächsten Woche
    // landete zweimal im Jahr in der Wertung dieser Woche.
    const nextWeek = new Date(week);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const cutoff = nextWeek.getTime();

    // Nur vorwärts, das kumulative Maximum muss nie noch mal angeschaut werden.
    while (cursor < finished.length && finished[cursor].startedAt < cutoff) {
      const s = finished[cursor++];
      const sessionBodyweight = bodyweightAt(bw, s.startedAt) ?? profile.bodyweight;
      for (const entry of s.entries || []) {
        const ex = exerciseById.get(entry.exerciseId);
        const name = ex ? ex.name : null;
        if (!isRateable(name, machineNames)) continue;
        for (const set of (entry.sets || []).filter(isCounted)) {
          const est = historicalE1rm(name, set, sessionBodyweight);
          // Dieselbe Fensterregel wie bestOneRepMaxByName, damit die Linie in
          // Fortschritt und die Zahl auf Home nicht aus verschiedenen Sätzen entstehen.
          const target = withinE1rmWindow(set) ? best : outside;
          if (est > (target.get(name) || 0)) target.set(name, est);
        }
      }
    }

    const merged = withFallbacks(best, outside);
    if (!merged.size) continue;
    const rating = buildRating(merged, {
      ...profile,
      bodyweight: bodyweightAt(bw, cutoff) ?? profile.bodyweight,
    }, { machineNames, regionsByName, ...corrections });
    if (rating.overall === null) continue;
    out.push({ week, score: rating.overall, tier: rating.overallTier, lifts: rating.lifts.length });
  }

  // Ein einzelner Punkt ist kein Verlauf, und ihn zu zeichnen behauptet mehr, als er sagt.
  return out.length >= 2 ? out : [];
}

/**
 * Die ganze Bewertung, wie sie zu einem Zeitpunkt stand, oder null, wenn sie sich
 * nicht bauen lässt.
 *
 * Dieselben zwei Regeln wie bei strengthHistory oben (kumulatives bestes e1RM,
 * Körpergewicht wie damals), für Aufrufer, die einen Punkt statt einer Linie
 * wollen. Die Wochenkarte ruft das zweimal auf, an beiden Enden einer Woche, um
 * zu sagen, was die Woche verändert hat. Absichtlich nicht in strengthHistory
 * eingebaut: die Funktion läuft einmal für sechzehn Wochen durchs Log, und wenn sie
 * das hier aufriefe, würden aus einem Durchlauf sechzehn, ohne dass es etwas bringt.
 */
export function strengthAt(sessions, bodyweightLog, profile, exerciseById, at = Date.now(),
  corrections = {}) {
  if (!hasProfile(profile)) return null;

  const best = new Map();
  const outside = new Map();
  const machineNames = ratedMachineNames([...exerciseById.values()]);
  const regionsByName = regionsFromExercises([...exerciseById.values()]);
  const bw = [...(bodyweightLog || [])].sort((a, b) => a.date - b.date);
  for (const s of sessions) {
    if (!s.finishedAt || s.startedAt > at) continue;
    for (const entry of s.entries || []) {
      const ex = exerciseById.get(entry.exerciseId);
      if (!isRateable(ex?.name, machineNames)) continue;
      for (const set of (entry.sets || []).filter(isCounted)) {
        const sessionBodyweight = bodyweightAt(bw, s.startedAt) ?? profile.bodyweight;
        const est = historicalE1rm(ex.name, set, sessionBodyweight);
        const target = withinE1rmWindow(set) ? best : outside;
        if (est > (target.get(ex.name) || 0)) target.set(ex.name, est);
      }
    }
  }
  const merged = withFallbacks(best, outside);
  if (!merged.size) return null;

  const rating = buildRating(merged, {
    ...profile,
    bodyweight: bodyweightAt(bw, at) ?? profile.bodyweight,
  }, { machineNames, regionsByName, ...corrections });
  return rating.overall === null ? null : rating;
}

/** Körpergewicht zu oder vor einem Zeitpunkt, null vor dem ersten Eintrag. */
export function bodyweightAt(sorted, ts) {
  let value = null;
  for (const b of sorted) {
    if (b.date > ts) break;
    value = b.weight;
  }
  return value;
}

/**
 * Welche Übungen vorankommen und welche stehen.
 *
 * Gerechnet mit geschätztem 1RM statt Höchstgewicht, damit eine Einheit mit mehr
 * Wiederholungen statt mehr Scheiben trotzdem als Fortschritt zählt. Drei Einheiten
 * sind die Untergrenze. Eine Linie durch zwei Punkte ist kein Trend, sondern eine
 * Linie durch zwei Punkte.
 */
export function movers(sessions, exerciseById, { minSessions = 3, sinceWeeks = 12, now = Date.now() } = {}) {
  // Die Uhrzeit kommt von außen und wird nicht hier gelesen, damit ein Test sie
  // festhalten kann. Jedes andere Fenster in dieser Datei bekommt sein Ende schon
  // als Argument, dieses nicht, und damit hingen die einzigen Tests dafür am echten
  // Datum. Eine Zeitbombe, die im August 2026 hochgegangen ist.
  const since = now - sinceWeeks * WEEK;
  const byExercise = new Map();

  for (const s of sessions) {
    if (!s.finishedAt || s.startedAt < since) continue;
    for (const entry of s.entries || []) {
      const st = entryStats(entry);
      if (!st.sets || !st.e1rm) continue;
      if (!byExercise.has(entry.exerciseId)) byExercise.set(entry.exerciseId, []);
      byExercise.get(entry.exerciseId).push({ t: s.startedAt, y: st.e1rm });
    }
  }

  const out = [];
  for (const [id, pointsRaw] of byExercise) {
    const ex = exerciseById.get(id);
    if (!ex) continue;
    const points = pointsRaw.sort((a, b) => a.t - b.t);
    if (points.length < minSessions) continue;

    const t0 = points[0].t;
    const fit = linearFit(points.map((p) => [(p.t - t0) / WEEK, p.y]));
    if (!fit) continue;

    const first = points[0].y;
    const last = points[points.length - 1].y;
    const spanWeeks = Math.max(1, (points[points.length - 1].t - t0) / WEEK);

    out.push({
      ex,
      sessions: points.length,
      first, last,
      perWeek: fit.slope,                       // kg e1RM pro Woche
      pctTotal: first > 0 ? ((last - first) / first) * 100 : 0,
      spanWeeks: Math.round(spanWeeks),
    });
  }

  return out.sort((a, b) => b.perWeek - a.perWeek);
}
