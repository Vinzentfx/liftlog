// Plan-Vorlagen und die Übungsauswahl, die sie füllt.
//
// Eine Vorlage beschreibt einen Tag als Muskel-PLÄTZE statt fester Übungsnamen:
// "Push = 3 Brust, 2 vordere Schulter, 2 Trizeps". Jeder Platz ist eine Übung mit
// SETS_PER_EXERCISE Sätzen. Dadurch ist "mehr Übungen, weniger Sätze pro Übung"
// der Normalfall und nichts, was man sich von Hand zusammenbauen muss.
//
// Die Anzahl der Plätze ist so gewählt, dass jeder Muskel bei zweimal pro Woche
// auf 10 bis 20 Sätze kommt. Warum das die Ziele sind, steht in js/plan-rating.js.

import { rateExercise } from './exercise-rating.js';
import { isBenchmark } from './standards.js';

// Rückfallwerte, keine Vorgabe. Beides lässt sich in den Einstellungen ändern.
// Das hier nimmt eine Vorlage, wenn niemand etwas anderes gesagt hat, die
// Begründung für die Zahlen steht im Kommentar zu den Plätzen oben.
export const SETS_PER_EXERCISE = 2;
export const REP_TARGET = '6-10';

export const PLAN_BLUEPRINTS = [
  {
    key: 'pplul',
    name: 'PPL + Upper / Lower',
    blurb: 'blueprint.ppl',
    recommended: true,
    days: [
      { name: 'Push',  slots: [['chest', 3], ['delts-front', 2], ['triceps', 2]] },
      // Hintere Schulter bekommt hier 2 Plätze und 2 im Oberkörpertag: Drücken
      // belastet den vorderen Kopf stark mit, der hintere braucht also eigene Arbeit.
      { name: 'Pull',  slots: [['lats', 3], ['delts-rear', 2], ['biceps', 2], ['abs', 1]] },
      { name: 'Legs',  slots: [['quads', 3], ['hamstrings', 2], ['glutes', 1], ['calves', 2]] },
      { name: 'Upper', slots: [['chest', 2], ['lats', 2], ['delts-rear', 2], ['biceps', 1], ['triceps', 1]] },
      { name: 'Lower', slots: [['quads', 2], ['hamstrings', 2], ['glutes', 2], ['calves', 1], ['abs', 1]] },
    ],
  },
  {
    key: 'ppl',
    name: 'Push / Pull / Legs',
    blurb: 'blueprint.fullSplit',
    perWeek: 2,
    days: [
      // Halbiert gegenüber einem Plan für einmal pro Woche. Dieser Zyklus läuft
      // zweimal, die Plätze hier gelten also pro Einheit und nicht pro Woche.
      { name: 'Push', slots: [['chest', 3], ['delts-front', 1], ['triceps', 1]] },
      { name: 'Pull', slots: [['lats', 3], ['delts-rear', 1], ['biceps', 1]] },
      { name: 'Legs', slots: [['quads', 2], ['hamstrings', 2], ['glutes', 1], ['calves', 1], ['abs', 1]] },
    ],
  },
  {
    key: 'ul',
    name: 'Upper / Lower',
    blurb: 'blueprint.upperLower',
    days: [
      { name: 'Upper A', slots: [['chest', 3], ['lats', 3], ['delts-rear', 1], ['biceps', 1], ['triceps', 1]] },
      { name: 'Lower A', slots: [['quads', 3], ['hamstrings', 2], ['glutes', 1], ['calves', 2], ['abs', 1]] },
      { name: 'Upper B', slots: [['lats', 3], ['chest', 2], ['delts-rear', 2], ['biceps', 1], ['triceps', 1]] },
      { name: 'Lower B', slots: [['hamstrings', 3], ['quads', 2], ['glutes', 1], ['calves', 1], ['abs', 2]] },
    ],
  },
  {
    key: 'fullbody',
    name: 'Full Body',
    perWeek: 1,
    blurb: 'blueprint.fullBody',
    days: [
      { name: 'Day A', slots: [['quads', 2], ['chest', 2], ['lats', 2], ['delts-front', 1], ['calves', 1]] },
      { name: 'Day B', slots: [['hamstrings', 2], ['lats', 2], ['delts-rear', 1], ['triceps', 1], ['biceps', 1], ['abs', 1]] },
      { name: 'Day C', slots: [['glutes', 2], ['chest', 2], ['quads', 1], ['delts-rear', 1], ['triceps', 1], ['calves', 1]] },
    ],
  },
];

/**
 * Kandidaten für einen Muskelplatz sortieren.
 *
 * Favoriten gewinnen immer: wer eine Übung markiert hat, macht sie auch, und das
 * schlägt jede Wertung. Danach kommt die Qualität der Übung, dann ein kleiner
 * Schubs dahin, mit einer Grundübung anzufangen.
 */
/**
 * Bewegungen, die der Katalog unter einem Muskel führt, die aber Mobility,
 * Aufwärmen oder Explosivübungen sind. Eintragen ist in Ordnung, automatisch als
 * Hypertrophie-Satz vorschlagen nicht. Erkannt am Namen, weil die Quelldaten ohne
 * das Kategoriefeld kein verlässliches Merkmal dafür haben.
 */
export const NOT_FOR_SLOTS = /(circle|balance board|bosu|stretch|warm[- ]?up|foam roll|mobility|\bclean\b|\bsnatch\b|\bjerk\b|\bjump|\bhop\b|plyo|wall sit|breathing|muscle up|\bsprint\b|\bdrill\b|\bchair\b|\bthrow\b|sled|\bdrag\b|\bcuban\b|rotation|isometric|\bneck\b)/i;

/**
 * Die beste noch nicht benutzte Übung für einen Muskel. Exportiert, damit der
 * Plan-Doktor eine Lücke mit genau der Übung füllt, die der Generator gewählt
 * hätte. Ein Plan, der von Hand repariert wird, und einer, der erzeugt wird,
 * sollen sich nicht widersprechen.
 */
export function pickForRegion(region, exercises, { used = new Set(), preferCompound = false } = {}) {
  const ranked = rankFor(region, exercises, { used, preferCompound });
  return ranked.length ? ranked[0].ex : null;
}

function rankFor(region, exercises, { used, preferCompound }) {
  const out = [];
  for (const ex of exercises) {
    if (used.has(ex.id)) continue;
    if (!(ex.primary || []).includes(region)) continue;
    if (NOT_FOR_SLOTS.test(ex.name)) continue;

    const rating = rateExercise(ex);
    let score = rating ? rating.stars : 2;
    if (ex.favourite) score += 10;
    // Die eigene Bewertung zählt mehr als die aus den Studien und kann ein Veto
    // einlegen: eine Übung mit 1 oder 2 Sternen tut weh, fehlt im Studio oder wird
    // einfach nicht gemacht. Die beste Übung, die man auslässt, ist nichts wert.
    if (ex.myRating) score += (ex.myRating - 3) * 2.5;
    // Referenzübungen sind die mit veröffentlichten Standards und dem meisten
    // Anleitungsmaterial. Der Bonus muss groß bleiben: die Bewertung benotet, was
    // eine Bewegung IST, und danach schneiden "Chair Squat" und "Lunge Sprint"
    // (Ausreißer im Katalog, als Maschine markiert) so gut ab wie eine Hackenschmidt-
    // Kniebeuge. Nur dieser Bonus sorgt dafür, dass ein erzeugter Plan aus Übungen
    // besteht, die es in echten Studios gibt.
    if (isBenchmark(ex.name)) score += 3;
    // Eine Bewegung, die die Regeln zur Muskellänge kennen, ist eine, über die die
    // App etwas sagen kann. In der Praxis sind das die Standardübungen und nicht die
    // 900 Ausreißer im Katalog.
    if (rating && rating.length.classified) score += 1;
    // Seltene Einzelvarianten sollen eine Standardübung nicht überholen, nur weil
    // der Katalog sie als Grundübung markiert hat.
    if (!ex.instructions || ex.instructions.length < 2) score -= 1.5;
    if (preferCompound && ex.mech === 'compound') score += 1.5;
    if (!preferCompound && ex.mech === 'isolation') score += 0.5;
    // Eine Bewegung ohne Beschreibung und ohne Bild taugt schlecht für jemanden,
    // der sie noch nie gemacht hat.
    if (!(ex.instructions || []).length) score -= 0.5;

    out.push({ ex, score });
  }
  return out.sort((a, b) => b.score - a.score || a.ex.name.localeCompare(b.ex.name));
}

/**
 * Eine Vorlage mit echten Übungen füllen.
 *
 * @param blueprint  ein Eintrag aus PLAN_BLUEPRINTS
 * @param exercises  die ganze Bibliothek
 * @param opts       { empty }, bei true kommt der Tagesaufbau ohne Übungen zurück
 */
export function buildPlanDays(blueprint, exercises, { empty = false, sets = SETS_PER_EXERCISE, reps = REP_TARGET } = {}) {
  if (empty) {
    return blueprint.days.map((d) => ({
      id: uid(),
      name: d.name,
      items: [],
      // bleibt stehen, damit der leere Plan trotzdem sagt, was er erwartet
      target: d.slots.map(([region, n]) => ({ region, slots: n })),
    }));
  }

  // Gilt für den ganzen Plan, damit dieselbe Übung nicht an zwei Tagen auftaucht.
  // Um die Abwechslung geht es bei den Plätzen ja.
  const used = new Set();

  return blueprint.days.map((day) => {
    const items = [];
    for (const [region, count] of day.slots) {
      for (let i = 0; i < count; i++) {
        let ranked = rankFor(region, exercises, { used, preferCompound: i === 0 });
        // Manche Regionen haben nur wenige Übungen (vor allem die hintere Schulter).
        // Statt den Platz still wegzulassen, wodurch der Muskel zu wenig bekommt,
        // darf sich eine Übung wiederholen, wenn die unbenutzten ausgehen.
        if (!ranked.length) ranked = rankFor(region, exercises, { used: new Set(), preferCompound: false });
        const pick = ranked[0];
        if (!pick) continue;
        used.add(pick.ex.id);
        items.push({
          exerciseId: pick.ex.id,
          targetSets: sets,
          targetReps: reps,
          note: '',
        });
      }
    }
    return { id: uid(), name: day.name, items, target: day.slots.map(([region, n]) => ({ region, slots: n })) };
  });
}

function uid() {
  return `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
