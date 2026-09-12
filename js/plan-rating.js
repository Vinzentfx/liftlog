// Bewertung eines Plans, bezogen auf Muskelaufbau.
//
// Im Juli 2026 an der aktuellen Literatur neu gebaut. Was sich dabei geändert hat und
// warum: die alten Zahlen waren ein vernünftiger Konsens von etwa 2019, den drei
// neuere Arbeiten verschoben haben.
//
//   * Die Obergrenze fürs Wochenvolumen ist weg. Die alte Bewertung hat einem Plan
//     ab 26 Sätzen pro Muskel und Woche kräftig abgezogen. Pelland et al. fanden das
//     Wachstum am oberen Ende des untersuchten Bereichs noch steigend und ohne
//     Plateau. Es gibt keinen Beleg für eine Satzzahl, ab der mehr Volumen Muskeln
//     kostet. Viel Volumen bekommt jetzt einen Hinweis zu Erholung und
//     Durchhalten, aber keinen Abzug.
//   * Die Frequenz ist von 30 % der Wertung auf 10 % gefallen. Bei gleichem
//     Wochenvolumen ist ihr eigener Einfluss aufs Wachstum verschwindend klein. Die
//     10 % behält sie, weil sie der Hebel ist, der eine einzelne Einheit unter dem
//     Punkt hält, ab dem weitere Sätze nichts mehr bringen.
//   * Dieser Punkt wird jetzt pro Muskel und Einheit bewertet, nicht pro Einheit
//     insgesamt: etwa 11 anteilige Sätze für einen Muskel in einem Training
//     (Remmert et al.). Ein Beintag mit 30 Sätzen ist nicht das Problem, 16 Sätze
//     Quadrizeps darin schon.
//   * Die Übungsauswahl wird überhaupt bewertet, mit 15 %. Wo die Last auf den
//     Muskel trifft, ist die einzige Stellschraube auf Ebene der Übung mit echten
//     Belegen, und ein Plan nur aus Übungen in verkürzter Position ist bei gleichem
//     Volumen der schlechtere.
//
// Zählweise: ein Satz zählt voll für die Muskeln, die er hauptsächlich trainiert,
// und halb für die Nebenmuskeln. Das ist keine Geschmacksfrage, die Methode mit dem
// halben Satz hat die Ergebnisse der Metaanalyse besser vorhergesagt als indirekte
// Sätze voll zu zählen oder wegzulassen (SOURCES.pelland2026).

import { tRegion, t } from './i18n.js';
import { THRESHOLDS, SOURCES } from './evidence.js';
import { rateExercise } from './exercise-rating.js';
import { starString, fmtDecimal } from './ui.js';

export { starString };

/** Gewichte der Wertung. Sie ergeben zusammen 1, und die Oberfläche zeigt jedes davon. */
export const WEIGHTS = {
  volume:    0.35,
  coverage:  0.15,
  session:   0.15,
  selection: 0.15,
  variety:   0.10,
  frequency: 0.10,
};

// Schlüssel, siehe js/strings.js.
export const WEIGHT_WHY = {
  volume: 'planRating.why.volume',
  coverage: 'planRating.why.coverage',
  session: 'planRating.why.session',
  selection: 'planRating.why.selection',
  variety: 'planRating.why.variety',
  frequency: 'planRating.why.frequency',
};

/** Gruppen, die ein Hypertrophie-Plan abdecken sollte. Unterarme werden indirekt trainiert. */
const MAJOR = [
  'chest', 'lats', 'traps', 'delts-front', 'delts-rear',
  'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs',
];

const PUSH = ['chest', 'delts-front', 'triceps'];
const PULL = ['lats', 'traps', 'delts-rear', 'biceps'];

const FLOOR = THRESHOLDS.weeklyFloor.value;          // 10
const STRONG = THRESHOLDS.weeklyStrong.value;        // 20
const UNCHARTED = THRESHOLDS.weeklyUncharted.value;  // 30
const PER_SESSION = THRESHOLDS.sessionPerMuscle.value; // 11
const INDIRECT = THRESHOLDS.indirectSetWeight.value;   // 0.5

/**
 * Wochenvolumen für einen Muskel, 0 bis 1.
 *
 * Steigt steil bis zur Untergrenze von 10 Sätzen, dann weiter bis etwa 20, danach
 * flach. Es geht nie wieder nach unten, weil keine Metaanalyse den Punkt gefunden hat,
 * an dem es das sollte. Siehe SOURCES.acsm2026 und SOURCES.pelland2026.
 */
export function volumeScore(v) {
  if (v <= 0) return 0;
  if (v < 4) return 0.25;
  if (v < FLOOR) return 0.4 + 0.4 * (v - 4) / (FLOOR - 4);
  if (v < STRONG) return 0.8 + 0.2 * (v - FLOOR) / (STRONG - FLOOR);
  return 1;
}

/** Anteilige Sätze für einen Muskel in einer Einheit, 0 bis 1. SOURCES.remmert2025. */
export function sessionScore(m) {
  if (m <= PER_SESSION) return 1;
  if (m >= PER_SESSION + 9) return 0.4;
  return 1 - 0.6 * (m - PER_SESSION) / 9;
}

/**
 * @param plan      {days:[{name, items:[{exerciseId,targetSets,targetReps}]}]}
 * @param byId      Map von Übungs-ID auf Übung
 * @param perWeek   wie oft der ganze Plan pro Woche läuft (meistens 1)
 */
export function analysePlan(plan, byId, perWeek = plan.perWeek || 1) {
  const volume = {};        // je Region:anteilige Sätze pro Woche
  const frequency = {};     // je Region:Einheiten pro Woche, die sie treffen
  const exercisesPer = {};  // je Region:Set der Übungs-IDs
  const peakSession = {};   // je Region:meiste anteilige Sätze in einer Einheit
  const sessions = [];
  const repFlags = [];

  let totalSets = 0;
  let exerciseCount = 0;
  let starSum = 0;          // nach Sätzen gewichtet
  let longSets = 0;
  let shortSets = 0;
  let stableSets = 0;
  let ratedSets = 0;

  for (const day of plan.days || []) {
    let daySets = 0;
    const touched = new Set();
    const inDay = {};

    for (const item of day.items || []) {
      const ex = byId.get(item.exerciseId);
      if (!ex) continue;
      const sets = Math.max(0, Number(item.targetSets) || 0);
      if (!sets) continue;

      exerciseCount++;
      daySets += sets;
      totalSets += sets;

      const rating = rateExercise(ex);
      if (rating) {
        starSum += rating.stars * sets;
        ratedSets += sets;
        if (rating.length.bias === 'long') longSets += sets;
        if (rating.length.bias === 'short') shortSets += sets;
        if (rating.stability?.level !== 'unstable' && rating.stability?.level !== 'demanding') stableSets += sets;
      }

      const reps = repRange(item.targetReps);
      if (reps && (reps.low < THRESHOLDS.repWindow.low || reps.high > THRESHOLDS.repWindow.high)) {
        repFlags.push({ name: ex.name, reps: item.targetReps });
      }

      for (const r of ex.primary || []) {
        volume[r] = (volume[r] || 0) + sets;
        inDay[r] = (inDay[r] || 0) + sets;
        touched.add(r);
        (exercisesPer[r] = exercisesPer[r] || new Set()).add(item.exerciseId);
      }
      for (const r of ex.secondary || []) {
        volume[r] = (volume[r] || 0) + sets * INDIRECT;
        inDay[r] = (inDay[r] || 0) + sets * INDIRECT;
        touched.add(r);
      }
    }

    for (const r of touched) frequency[r] = (frequency[r] || 0) + 1;
    for (const [r, n] of Object.entries(inDay)) peakSession[r] = Math.max(peakSession[r] || 0, n);
    sessions.push({ name: day.name, sets: daySets });
  }

  // auf eine Woche hochrechnen, Werte pro Einheit bleiben absichtlich pro Einheit
  for (const r of Object.keys(volume)) volume[r] *= perWeek;
  for (const r of Object.keys(frequency)) frequency[r] *= perWeek;

  const trained = MAJOR.filter((r) => (volume[r] || 0) >= 2);
  const untrained = MAJOR.filter((r) => (volume[r] || 0) < 2);

  // Volumen (35 %)
  const volScore = trained.length ? avg(trained.map((r) => volumeScore(volume[r] || 0))) : 0;

  // Abdeckung (15 %)
  const coverScore = MAJOR.length ? trained.length / MAJOR.length : 0;

  // Aufbau der Einheiten (15 %)
  const sessScore = trained.length ? avg(trained.map((r) => sessionScore(peakSession[r] || 0))) : 0;

  // Übungsauswahl (15 %)
  const meanStars = ratedSets ? starSum / ratedSets : 0;
  const longShare = totalSets ? longSets / totalSets : 0;
  const stableShare = totalSets ? stableSets / totalSets : 0;
  const selScore = ratedSets
    ? 0.7 * ((meanStars - 1) / 4) + 0.2 * longShare + 0.1 * stableShare
    : 0;

  // Abwechslung (10 %)
  const varScore = trained.length ? avg(trained.map((r) => {
    const n = (exercisesPer[r] || new Set()).size;
    if ((volume[r] || 0) < 6) return 0.7;   // zu wenig Volumen, als dass Abwechslung eine Rolle spielt
    if (n >= 3) return 1;
    if (n >= THRESHOLDS.exercisesPerMuscle.value) return 0.9;
    return 0.55;
  })) : 0;

  // Frequenz (10 %)
  const freqScore = trained.length ? avg(trained.map((r) => {
    const f = frequency[r] || 0;
    if (f >= THRESHOLDS.minFrequency.value) return 1;
    if (f >= 1.5) return 0.8;
    if (f >= 1) return 0.6;
    return 0.4;
  })) : 0;

  const parts = {
    volume: volScore, coverage: coverScore, session: sessScore,
    selection: selScore, variety: varScore, frequency: freqScore,
  };
  const score = Object.entries(parts).reduce((s, [k, v]) => s + v * WEIGHTS[k], 0);
  const stars = Math.max(0.5, Math.round(score * 5 * 2) / 2);

  const a = {
    stars, score, parts,
    volume, frequency, peakSession,
    exercisesPer: Object.fromEntries(Object.entries(exercisesPer).map(([k, v]) => [k, v.size])),
    sessions, totalSets: totalSets * perWeek, exerciseCount,
    trained, untrained, meanStars, longShare, stableShare, shortSets, repFlags, perWeek,
  };
  return { ...a, ...verdict(a) };
}

/** In Klartext: was ist gut, was fehlt. */
function verdict(a) {
  const good = [];
  const missing = [];
  const name = tRegion;

  // Volumen
  const atFloor = a.trained.filter((r) => a.volume[r] >= FLOOR);
  if (atFloor.length && atFloor.length === a.trained.length) {
    good.push(t('planRating.allClearFloor', { floor: FLOOR }));
  } else if (atFloor.length >= a.trained.length * 0.6) {
    good.push(t('planRating.someClearFloor', { at: atFloor.length, total: a.trained.length, floor: FLOOR }));
  }

  const under = a.trained.filter((r) => a.volume[r] < FLOOR);
  if (under.length) {
    missing.push(t('planRating.underFloor', {
      floor: FLOOR, muscles: listOf(under.map((r) => `${name(r)} (${round(a.volume[r])})`)),
    }));
  }

  const high = a.trained.filter((r) => a.volume[r] > UNCHARTED);
  if (high.length) {
    missing.push(t('planRating.overUncharted', { uncharted: UNCHARTED, muscles: listOf(high.map(name)) }));
  }

  // Last pro Einheit
  const crowded = a.trained
    .filter((r) => (a.peakSession[r] || 0) > PER_SESSION)
    .sort((x, y) => a.peakSession[y] - a.peakSession[x]);
  if (crowded.length) {
    missing.push(t('planRating.crowded', {
      muscles: listOf(crowded.map((r) => t('planRating.setsInOneSession', {
        muscle: name(r), n: round(a.peakSession[r]),
      }))),
      perSession: PER_SESSION,
    }));
  } else if (a.trained.length) {
    good.push(t('planRating.sessionOk', { perSession: PER_SESSION }));
  }

  // Abdeckung
  if (a.untrained.length) missing.push(t('planRating.untrained', { muscles: a.untrained.map(name).join(', ') }));
  else if (a.trained.length) good.push(t('planRating.allCovered'));

  // Frequenz
  const once = a.trained.filter((r) => (a.frequency[r] || 0) < THRESHOLDS.minFrequency.value);
  if (once.length) {
    missing.push(t('planRating.onceAWeek', { muscles: listOf(once.map(name)) }));
  } else if (a.trained.length) {
    good.push(t('planRating.twiceAWeek'));
  }

  // Übungsauswahl
  if (a.longShare >= 0.5) {
    good.push(t('planRating.longShareGood', { pct: Math.round(a.longShare * 100) }));
  } else if (a.exerciseCount && a.longShare < 0.3) {
    missing.push(t('planRating.longShareLow', { pct: Math.round(a.longShare * 100) }));
  }
  if (a.meanStars >= 3.75) good.push(t('planRating.starsGood', { stars: fmtDecimal(a.meanStars) }));
  else if (a.exerciseCount && a.meanStars < 2.75) {
    missing.push(t('planRating.starsLow', { stars: fmtDecimal(a.meanStars) }));
  }
  if (a.stableShare >= 0.6) good.push(t('planRating.stabilityGood', { pct: Math.round(a.stableShare * 100) }));
  else if (a.exerciseCount && a.stableShare < 0.25) {
    missing.push(t('planRating.stabilityLow', { pct: Math.round(a.stableShare * 100) }));
  }

  // Abwechslung
  const single = a.trained.filter((r) => (a.exercisesPer[r] || 0) === 1 && a.volume[r] >= 8);
  if (single.length) {
    missing.push(t('planRating.oneMovement', { muscles: listOf(single.map(name)) }));
  }

  // Wiederholungsziele
  if (a.repFlags.length) {
    missing.push(t('planRating.repFlags', {
      low: THRESHOLDS.repWindow.low, high: THRESHOLDS.repWindow.high,
      exercises: listOf(a.repFlags.map((f) => `${f.name} (${f.reps})`)),
    }));
  }

  // Gleichgewicht (Praxis, keine Belege)
  const push = sum(PUSH.map((r) => a.volume[r] || 0));
  const pull = sum(PULL.map((r) => a.volume[r] || 0));
  if (push > 0 && pull > 0) {
    if (pull < push * 0.8) missing.push(t('planRating.pushHeavy'));
    else good.push(t('planRating.balanced'));
  }

  return { good, missing };
}

/** Liest '8-12' oder '10' als {low, high}, auch mit langem Strich im Bereich */
function repRange(spec) {
  if (!spec) return null;
  const nums = String(spec).match(/\d+/g);
  if (!nums || !nums.length) return null;
  const ns = nums.map(Number);
  return { low: Math.min(...ns), high: Math.max(...ns) };
}

const listOf = (xs) => xs.slice(0, 4).join(', ')
  + (xs.length > 4 ? t('planRating.andMore', { n: xs.length - 4 }) : '');
const round = (n) => Math.round(n * 10) / 10;
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export const PLAN_SOURCES = [
  SOURCES.acsm2026, SOURCES.pelland2026, SOURCES.remmert2025,
  SOURCES.wolf2025, SOURCES.variation2024,
];
