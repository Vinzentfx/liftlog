// Aufwärmsätze für das Gewicht, das gleich kommt.
//
// Früher stand hier am Anfang, dass es für eine Aufwärmrampe keine Studienlage
// gibt. Für die ANZAHL der Sätze stimmte das und stimmt meistens immer noch, für
// die Form aber nie. Und genau die Form, die die App vorgeschlagen hat (etwa die
// Hälfte für fünf Wiederholungen, dann drei Viertel für drei), ist die Variante,
// die im Vergleich verliert.
//
// Was die Studien tatsächlich sagen:
//
//  * Ribeiro 2020 (SOURCES.ribeiro2020) hat vierzig trainierte Männer Kniebeuge
//    und Bankdrücken mit 80 % vom Maximum machen lassen, nach drei verschiedenen
//    Aufwärmvarianten: nur leicht, nur schwer, erst leicht dann schwer. Nur leicht
//    war bei beiden Übungen am schlechtesten. Bei der Kniebeuge war der schwere
//    Satz am besten, beim Bankdrücken das Paar. Der letzte Aufwärmsatz gehört also
//    NAHE an das Arbeitsgewicht, nicht weit darunter.
//
//  * Eine Crossover-Studie von 2025 mit 29 Trainierten (SOURCES.warmup2025) hat
//    kein spezielles Aufwärmen, einen Satz mit 3 bis 4 Wiederholungen bei 75 % und
//    zwei Sätze bei 55 % und 75 % verglichen, jeweils bei etwa 10RM. Die
//    Unterschiede waren in jede Richtung verschwindend klein, auch zwischen einem
//    und zwei Sätzen. Mehr Aufwärmen hat nichts gebracht.
//
// Zusammen heißt das: weniger Sätze, weniger Wiederholungen, näher am
// Arbeitsgewicht. Genau das schlägt diese Datei jetzt vor, und deutlich weniger
// davon als früher.
//
// Was weiterhin Praxis und kein Befund ist: die dreistufige Rampe für schwere
// Arbeit mit wenigen Wiederholungen. Beide Studien haben mittlere Lasten
// getestet, zu einem Triple bei 90 % sagen sie nichts, und die App tut auch nicht so.

import { isBenchmark } from './standards.js';
import { platePlan } from './plates.js';
import { THRESHOLDS } from './evidence.js';

const TOP_SHARE = THRESHOLDS.warmupTopShare.value;

/**
 * Die Rampe für eine Übung, bevor Gewichte ausgerechnet werden.
 *
 * @returns [[Anteil vom Arbeitsgewicht, Wiederholungen]], das leichteste zuerst
 */
function ramp(exercise, { targetReps = 10, alreadyWarm = false } = {}) {
  const heavyBar = isBenchmark(exercise?.name) || exercise?.equipment === 'Barbell';
  // Abgesichert gegen Unsinn: ein Wiederholungsziel von null oder weniger fiel
  // früher in den Zweig für schwere Einzelwiederholungen und bekam drei Stufen.
  const parsed = Number(targetReps);
  const reps = Number.isFinite(parsed) && parsed > 0 ? parsed : 10;

  // Schwer, wenige Wiederholungen. Deckt keine der beiden Studien ab (siehe oben),
  // deshalb bleibt es bei der üblichen dreistufigen Rampe, und der Hinweis in der
  // Oberfläche sagt, zu welcher Hälfte des Rats das gehört.
  if (heavyBar && reps <= 5) {
    return alreadyWarm ? [[0.65, 3], [0.85, 2]] : [[0.45, 5], [0.65, 3], [0.85, 2]];
  }

  // Normale Trainingslasten an der Stange: das Paar, das beim Bankdrücken gewonnen
  // hat. Hat der Muskel in dieser Einheit schon gearbeitet, bleibt nur der eine
  // schwere Satz.
  if (heavyBar && reps <= 15) {
    return alreadyWarm ? [[TOP_SHARE, 2]] : [[0.55, 4], [TOP_SHARE, 2]];
  }

  // Alles andere: Maschinen, Kabel, Kurzhanteln. Geführte Bewegung, weniger Last,
  // ein Satz reicht so gut wie zwei. Ein Muskel, der in dieser Einheit schon
  // trainiert wurde, muss nicht noch einmal an die Butterfly-Maschine gewöhnt werden.
  if (alreadyWarm) return [];
  return reps <= 15 ? [[0.7, 3]] : [[0.6, 4]];
}

/**
 * Wie viele Aufwärmsätze eine Übung in diesem Zusammenhang bekommt.
 *
 * Eigene exportierte Funktion, weil der Plan-Editor und die Tests nur nach der
 * Anzahl fragen wollen.
 */
export function warmupCount(exercise, context = {}) {
  return ramp(exercise, context).length;
}

/**
 * Welche Muskeln dieser Übung heute schon gearbeitet haben.
 *
 * Es geht nicht um Buchhaltung, sondern darum, dass die zweite Brustübung einer
 * Einheit keine eigene Einführung braucht: das Gewebe ist warm, das Gelenk hat
 * sich bewegt, und der Satz, der das erledigt hätte, ist schon passiert. Es zählen
 * nur Hauptmuskeln. Ein Trizeps, der einen halben Satz Schrägbankdrücken
 * abbekommen hat, ist kein aufgewärmter Trizeps.
 */
export function alreadyWarm(exercise, warmedRegions) {
  if (!warmedRegions || !warmedRegions.size) return false;
  return (exercise?.primary || []).some((region) => warmedRegions.has(region));
}

/**
 * Die Rampe selbst, in Gewichten, die man stecken kann.
 *
 * Bei der Langhantel heißt das: echte Scheiben, mit derselben Rechnung wie der
 * Scheibenrechner, damit nie ein Gewicht vorgeschlagen wird, das der Ständer nicht hergibt.
 *
 * @param context { targetReps, warmedRegions }, die Einheit bis jetzt
 * @returns [{ weight, reps }], oder [], wenn sich keine Rampe lohnt
 */
export function warmupSets(exercise, workingWeight, {
  units = 'kg', barWeight = 20, targetReps = 10, warmedRegions = null, step: stackStep = null,
} = {}) {
  const target = Number(workingWeight) || 0;
  if (target <= 0) return [];

  const steps = ramp(exercise, { targetReps, alreadyWarm: alreadyWarm(exercise, warmedRegions) });
  const barbell = exercise && exercise.equipment === 'Barbell';

  const out = [];
  for (const [share, reps] of steps) {
    const raw = target * share;
    const weight = barbell && !(Number(stackStep) > 0)
      ? loadable(raw, barWeight, units)
      : round(raw, units, stackStep);
    // Ein Aufwärmsatz, der schwerer ist als die Arbeit oder leichter als die leere
    // Stange, ist keiner. Beides passiert am unteren Ende, eine leere Stange ist
    // schon mehr als die Hälfte von 30 kg.
    if (weight <= 0 || weight >= target) continue;
    if (out.some((s) => s.weight === weight)) continue;
    out.push({ weight, reps });
  }
  return out;
}

/** Das nächste Gewicht, das die Stange wirklich tragen kann, nie über dem Wunsch. */
function loadable(weight, barWeight, units) {
  const plan = platePlan(weight, barWeight, units);
  if (!plan) return 0;                     // leichter als die Stange selbst
  return plan.loaded > weight ? Math.max(barWeight, plan.loaded - step(units)) : plan.loaded;
}

const step = (units, override = null) => (Number(override) > 0 ? Number(override) : units === 'lb' ? 5 : 2.5);
const round = (weight, units, override = null) =>
  Math.round(weight / step(units, override)) * step(units, override);
