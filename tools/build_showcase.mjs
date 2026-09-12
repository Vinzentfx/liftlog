// Erzeugt eine Vorführ-Sicherung: ein halbes Jahr glaubwürdiges Training und vier Monate
// Essen, damit jeder Screen der App etwas Echtes zu zeigen hat.
//
//   node tools/build_showcase.mjs > showcase-backup.json
//
// Warum eine Sicherungsdatei und kein Knopf "Beispieldaten laden" in den Einstellungen: ein
// Import ersetzt alles. Ein Knopf, der das eigene Trainingslog löscht, ist einen Fehltipp von
// einer Katastrophe entfernt und stünde für immer in der App, wegen einer Vorführung, die man
// zweimal macht. Als Datei geht es über Wiederherstellen, und das fragt schon vorher und sagt,
// was ersetzt wird.
//
// Die Einträge kommen aus js/models.js und nicht aus JSON, das hier von Hand geschrieben wird.
// Alles andere würde beim ersten neuen Feld von der echten Form der App abweichen, und zwar
// still: der Store prüft keine Einträge, er liest einfach Felder, die vielleicht fehlen.
//
// Alles ist abgeleitet, nichts behauptet. Bedarf, Stärkewertung, Stillstandsbericht und
// Zeitleiste rechnen sich selbst aus diesen Daten aus, die Zahlen auf dem Screen sind also die,
// die aus dieser Datei folgen. Sieht die Vorführung falsch aus, sind die Daten falsch, und das
// ist die ehrliche Art zu scheitern.

import {
  seedExercises, newSession, newEntry, newSet, newFood, newMeal, newTemplate,
  dayKey, DEFAULT_SETTINGS, normName,
} from '../js/models.js';
import { PLAN_BLUEPRINTS, buildPlanDays } from '../js/plan-builder.js';

/* Wiederholbarkeit */

/** Mit festem Startwert, damit ein neuer Lauf dieselbe Datei ergibt. Eine Vorführung soll nicht wandern. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260731);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);
const chance = (p) => rand() < p;

let counter = 0;
const uid = (prefix = '') => `${prefix}sc${(counter++).toString(36).padStart(4, '0')}`;

/* Profil */

const WEEKS = 26;
const START_BW = 78.5;
const END_BW = 84.0;

// Mittags, damit nichts auf einer Tagesgrenze landet und nichts von der Uhrzeit abhängt.
const today = new Date(); today.setHours(12, 0, 0, 0);
const dayOffset = (n) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d;
};

/* Übungen */

const exercises = seedExercises(uid);
const byName = new Map(exercises.map((e) => [normName(e.name), e]));

// Ein paar als Favoriten markiert und selbst bewertet, weil das ändert, was Bibliothek,
// Generator und Tauschvorschläge machen.
for (const [name, rating] of [
  ['Barbell Bench Press', 5], ['Lat Pulldown', 4], ['Back Squat', 5],
  ['Romanian Deadlift', 4], ['Lateral Raise', 3], ['Leg Extension', 2],
  ['Upright Row', 1],
]) {
  const ex = byName.get(normName(name));
  if (!ex) continue;
  ex.myRating = rating;
  if (rating >= 4) ex.favourite = true;
}

/* Plan */

const blueprint = PLAN_BLUEPRINTS.find((b) => b.key === 'pplul') || PLAN_BLUEPRINTS[0];
const days = buildPlanDays(blueprint, exercises, { sets: 2, reps: '6-10' });

// Mit Wochentagen, damit Trainieren-Tab, Wochenübersicht und Wochenkarte einen Plan haben,
// über den sie reden können, statt auf "am längsten nicht trainiert" zurückzufallen.
// Mo/Di/Do/Fr/Sa.
const WEEKDAYS = [1, 2, 4, 5, 6];
days.forEach((d, i) => { d.weekday = WEEKDAYS[i] ?? null; });

const plan = {
  id: uid('p_'),
  name: blueprint.name,
  presetKey: blueprint.key,
  repTarget: '6-10',
  perWeek: blueprint.perWeek || 1,
  days,
  createdAt: dayOffset(WEEKS * 7).getTime(),
  updatedAt: today.getTime(),
};

/* Training */

/**
 * Wo jede Übung anfängt und wie schnell sie steigt.
 *
 * Die absoluten Zahlen zählen hier: die Stärkestufen hängen am Körpergewicht, ein
 * ausgedachtes Bankdrücken mit 200 kg würde ein Vorführprofil als Elite zeigen und jeden
 * Screen, der Stufen erwähnt, nutzlos machen. Diese hier legen jemanden mit 84 kg, gut
 * trainiert, aber kein Ausnahmefall, etwa in die Mitte der Skala, und dort passiert das
 * Interessante in der Oberfläche.
 */
const START = {
  'Barbell Bench Press': [72.5, 1.25],
  'Back Squat': [100, 1.7],
  Deadlift: [125, 2.1],
  'Overhead Press': [47.5, 0.7],
  'Barbell Row': [70, 1.0],
  'Romanian Deadlift': [85, 1.3],
  'Pull-Up': [5, 0.6],
  'Chin-Up': [5, 0.55],
  'Lat Pulldown': [62.5, 0.95],
  'Incline Barbell Bench Press': [60, 1.0],
  'Front Squat': [72.5, 1.1],
  'Leg Press': [170, 2.8],
  'Hip Thrust': [100, 1.8],
};

/** Glaubwürdige Startlast für alles, was oben nicht genannt ist. */
function startWeight(ex) {
  if (START[ex.name]) return START[ex.name];
  switch (ex.equipment) {
    case 'Barbell': return [between(35, 55), between(0.6, 0.9)];
    case 'Machine': return [between(35, 70), between(0.7, 1.2)];
    case 'Cable': return [between(20, 45), between(0.4, 0.8)];
    case 'Dumbbell': return [between(10, 24), between(0.18, 0.32)];
    // Körpergewicht und "Other" bekommen Zusatzgewicht. Das machen Leute wirklich, sobald sie
    // können, und es hält sie aus dem Stillstandsbericht: ein geschätztes 1RM aus null Gewicht
    // ist jede Woche null, und eine flache Linie bei null sieht genauso aus wie eine Übung, die
    // nicht mehr vorankommt.
    default: return [between(5, 14), between(0.2, 0.4)];
  }
}

const progress = new Map();
for (const day of days) {
  for (const item of day.items) {
    const ex = exercises.find((e) => e.id === item.exerciseId);
    if (ex && !progress.has(ex.id)) progress.set(ex.id, startWeight(ex));
  }
}

/**
 * Zwei Übungen, die nach zwei Dritteln stehen bleiben.
 *
 * Mit Absicht: der Stillstandsbericht und die Liste "was sich bewegt" gehören zum
 * Interessanteren an dieser App, und wenn alles für immer steigt, haben beide nichts zu sagen.
 */
const STALLS = ['Overhead Press', 'Lateral Raise'];
const stallIds = new Set(
  STALLS.map((n) => byName.get(normName(n))).filter(Boolean).map((e) => e.id));
const STALL_WEEK = Math.round(WEEKS * 0.62);

const step = (equipment) => (equipment === 'Dumbbell' ? 2 : equipment === 'Cable' ? 2.5 : 2.5);
const roundTo = (v, s) => Math.max(0, Math.round(v / s) * s);

const sessions = [];
const NOTES = [
  'Rechte Schulter hat gezwickt, Griff enger genommen.',
  'Gut geschlafen, ging leicht.',
  'Letzter Satz bis kurz vors Limit.',
  'Bank war belegt, erst nach 10 Minuten dran.',
  'Neue Schuhe, Stand fühlt sich stabiler an.',
  'Nach der Arbeit, Kopf war nicht dabei.',
  'Griffkraft war vor dem Rücken am Ende.',
];

for (let week = WEEKS - 1; week >= 0; week--) {
  for (const [dayIndex, day] of days.entries()) {
    // Ab und zu fällt eine Einheit aus, damit Serien, "Woche gegen Plan" und die Heatmap nicht
    // ein durchgehend grüner Block sind.
    if (chance(0.11)) continue;

    // Wochentag des Plantags, von heute aus zurückgezählt.
    const daysAgo = week * 7 + (6 - dayIndex);
    const when = dayOffset(daysAgo);
    when.setHours(17 + Math.floor(rand() * 3), Math.floor(rand() * 60), 0, 0);
    const startedAt = when.getTime();
    if (startedAt > Date.now()) continue;

    const entries = [];
    for (const item of day.items) {
      const ex = exercises.find((e) => e.id === item.exerciseId);
      if (!ex) continue;
      const [base, perWeek] = progress.get(ex.id);

      const weeksIn = WEEKS - 1 - week;
      const capped = stallIds.has(ex.id) ? Math.min(weeksIn, STALL_WEEK) : weeksIn;
      const target = base + capped * perWeek;
      const s = step(ex.equipment);
      const working = roundTo(target * between(0.97, 1.02), s);

      const sets = [];

      // Aufwärmsätze bei den schweren Langhantelübungen, so wie die App sie selbst anbietet.
      if (ex.equipment === 'Barbell' && working > 40) {
        sets.push({ ...newSet(), weight: roundTo(working * 0.5, s), reps: 5, type: 'warmup', done: true });
        sets.push({ ...newSet(), weight: roundTo(working * 0.75, s), reps: 3, type: 'warmup', done: true });
      }

      const targetReps = 8;
      for (let i = 0; i < item.targetSets; i++) {
        const reps = Math.max(4, Math.round(targetReps - i * between(0, 1.4) + between(-1, 1)));
        sets.push({
          ...newSet(),
          weight: working,
          reps,
          // RIR fehlt bei etwa einem Fünftel der Sätze, weil die App ein leeres Feld als
          // unbekannt behandelt und dieser Weg sichtbar sein soll.
          rir: chance(0.2) ? null : Math.max(0, Math.round(between(0, 3))),
          done: true,
        });
      }

      const entry = newEntry(ex.id, sets);
      if (chance(0.06)) entry.note = pick(NOTES);
      entries.push(entry);
    }

    const session = newSession(uid, { name: day.name, planId: plan.id, dayId: day.id, entries });
    session.startedAt = startedAt;
    session.finishedAt = startedAt + Math.round(between(52, 78)) * 60000;
    sessions.push(session);
  }
}

/* Körpergewicht */

const bodyweight = [];
for (let d = WEEKS * 7; d >= 0; d--) {
  // Zwei oder drei Wiegungen pro Woche, nicht jeden Tag: die Regel der Zeitleiste "Wochen ohne
  // Wiegen bleiben leer" braucht Lücken, damit man sie sieht.
  if (!chance(0.36)) continue;
  const t = 1 - d / (WEEKS * 7);
  const date = dayOffset(d);
  date.setHours(7, 30, 0, 0);
  bodyweight.push({
    id: uid('bw_'),
    date: date.getTime(),
    // Trend plus das tägliche Rauschen einer echten Waage, gerundet, wie man sie abliest.
    weight: Math.round((START_BW + (END_BW - START_BW) * t + between(-0.5, 0.5)) * 10) / 10,
  });
}

/* Essen */

/** Name, Portion, Eiweiß, kcal, Kohlenhydrate, Fett, Ballaststoffe */
const FOODS = [
  ['Magerquark 500 g', '500 g', 60, 345, 20, 1, 0],
  ['Haferflocken', '80 g', 11, 303, 49, 6, 8],
  ['Vollkornbrot', '2 Scheiben', 8, 220, 38, 3, 6],
  ['Hähnchenbrust', '200 g', 46, 220, 0, 3, 0],
  ['Rinderhack 5 %', '200 g', 42, 290, 0, 10, 0],
  ['Lachsfilet', '150 g', 32, 310, 0, 20, 0],
  ['Eier', '3 Stück', 20, 234, 1, 17, 0],
  ['Reis gekocht', '250 g', 6, 325, 70, 1, 1],
  ['Kartoffeln', '300 g', 6, 231, 51, 0, 5],
  ['Vollkornnudeln', '125 g roh', 15, 440, 82, 3, 11],
  ['Olivenöl', '1 EL', 0, 120, 0, 14, 0],
  ['Whey Protein', '30 g', 24, 118, 2, 2, 0],
  ['Banane', '1 Stück', 1, 105, 27, 0, 3],
  ['Apfel', '1 Stück', 0, 95, 25, 0, 4],
  ['Brokkoli', '200 g', 6, 68, 8, 1, 5],
  ['Skyr Natur', '250 g', 28, 158, 10, 1, 0],
  ['Erdnussbutter', '30 g', 8, 180, 6, 15, 2],
  ['Kaffee mit Milch', '1 Tasse', 2, 40, 3, 2, 0],
  ['Mandeln', '30 g', 6, 174, 5, 15, 4],
  ['Thunfisch in Wasser', '1 Dose', 26, 116, 0, 1, 0],
  ['Käse Gouda', '2 Scheiben', 12, 160, 0, 13, 0],
  ['Pizza Salami', '1/2 Stück', 24, 620, 62, 28, 4],
  ['Döner', '1 Stück', 38, 750, 68, 32, 7],
  ['Bier', '0,5 l', 2, 210, 16, 0, 0],
  ['Proteinriegel', '1 Riegel', 20, 210, 18, 7, 3],
  ['Milch 1,5 %', '250 ml', 9, 118, 12, 4, 0],
  ['Reiswaffeln', '3 Stück', 2, 105, 22, 1, 1],
  ['Avocado', '1/2 Stück', 2, 160, 2, 15, 5],
  ['Linsen gekocht', '200 g', 18, 232, 34, 1, 15],
  ['Olivenöl-Dressing', '2 EL', 0, 140, 2, 15, 0],
];

const foods = FOODS.map(([name, portion, protein, kcal, carbs, fat, fibre]) =>
  newFood(uid, { name, portion, protein, kcal, carbs, fat, fibre, source: 'manual' }));
const food = (name) => foods.find((f) => f.name === name);

// Ein Lebensmittel absichtlich ohne Kohlenhydrate, Fett und Ballaststoffe, damit sich die
// Energieaufteilung an manchen Tagen weigern kann und der Text "nicht eingetragen" erreichbar ist.
const incomplete = newFood(uid, {
  name: 'Kantine Tagesgericht', portion: '1 Portion', protein: 30, kcal: 640, source: 'manual',
});
foods.push(incomplete);

const BREAKFAST = ['Haferflocken', 'Magerquark 500 g', 'Eier', 'Skyr Natur', 'Kaffee mit Milch', 'Banane'];
const LUNCH = ['Hähnchenbrust', 'Reis gekocht', 'Brokkoli', 'Kartoffeln', 'Linsen gekocht', 'Vollkornnudeln'];
const DINNER = ['Rinderhack 5 %', 'Lachsfilet', 'Vollkornbrot', 'Käse Gouda', 'Avocado', 'Thunfisch in Wasser'];
const SNACK = ['Whey Protein', 'Proteinriegel', 'Mandeln', 'Apfel', 'Erdnussbutter', 'Milch 1,5 %', 'Reiswaffeln'];
const TREAT = ['Pizza Salami', 'Döner', 'Bier'];

const FOOD_WEEKS = 17;
const meals = [];
const water = [];

/**
 * Ein Tag wird bis zu einem Kalorienziel aufgebaut, statt blind Einträge zu ziehen.
 *
 * Gleichmäßig aus einer Liste zu ziehen ergab 1.500 kcal im Schnitt für jemanden, der ein
 * halbes Kilo im Monat zunimmt, und jede Zahl danach hat das geerbt: der Bedarf kam bei
 * 1.193 kcal heraus, und die daraus abgeleiteten Ziele für Kalorien und Kohlenhydrate waren
 * Unsinn. Die Vorführung muss rechnerisch zusammenpassen, sonst führt sie vor, wie die App Mist rechnet.
 */
function buildDay(date, key, targetKcal) {
  const weekend = [0, 6].includes(date.getDay());
  let total = 0;

  const add = (name, slot, hour, amount = 1) => {
    const f = food(name) || incomplete;
    const at = new Date(date); at.setHours(hour, Math.floor(rand() * 50), 0, 0);
    meals.push(newMeal(uid, f, { amount, day: key, at: at.getTime(), slot }));
    total += f.kcal * amount;
  };

  // Frühstück und Abendessen sind die Anker, Mittagessen und Snacks füllen die Lücke.
  add(pick(BREAKFAST), 'breakfast', 8);
  add(pick(BREAKFAST), 'breakfast', 8);
  if (chance(0.55)) add('Kaffee mit Milch', 'breakfast', 9);

  if (weekend && chance(0.4)) {
    add(pick(TREAT), 'lunch', 13);
    if (chance(0.4)) add('Bier', 'dinner', 20);
  } else if (chance(0.12)) {
    add('Kantine Tagesgericht', 'lunch', 12);
  } else {
    add(pick(LUNCH), 'lunch', 12);
    add(pick(LUNCH), 'lunch', 12);
  }

  add(pick(DINNER), 'dinner', 19);
  add(pick(DINNER), 'dinner', 19);

  // Mit Snacks bis zum Ziel auffüllen, so füllt sich ein Tag wirklich. Gedeckelt, damit eine
  // Reihe kalorienarmer Züge nicht ausufert.
  // Der Deckel muss locker genug sein, um das Ziel wirklich zu erreichen. Bei sechs hat er an
  // den meisten Tagen gegriffen, und das ganze Log kam ~700 kcal zu leicht heraus. Der Bedarf
  // hat das dann brav als 1.984 kcal gemeldet, für jemanden mit 84 kg, der zunimmt.
  let guard = 0;
  while (total < targetKcal - 200 && guard++ < 14) {
    add(pick(SNACK), 'snack', guard % 2 ? 16 : 21, chance(0.3) ? 2 : 1);
  }
}

for (let d = FOOD_WEEKS * 7; d >= 0; d--) {
  const date = dayOffset(d);
  const key = dayKey(date.getTime());

  // Eine Woche weg, nur zweimal eingetragen: die Untergrenze von vier Tagen in der Zeitleiste und
  // die Regel "ein Tag ohne Einträge ist leer, nicht null" brauchen beide eine Woche darunter,
  // sonst sieht man keins von beiden in der Vorführung.
  const awayWeek = d >= 63 && d <= 69;
  const logChance = awayWeek ? 0.28 : 0.78;
  if (!chance(logChance)) continue;

  // Langsame Zunahme, das Essen liegt also ein paar hundert über dem Bedarf, mit den
  // Schwankungen am Wochenende, die jedes echte Log hat.
  const weekend = [0, 6].includes(date.getDay());
  const target = Math.round(between(2950, 3250) + (weekend ? between(0, 500) : 0));
  buildDay(date, key, target);

  if (chance(0.85)) water.push({ day: key, ml: 250 * Math.round(between(5, 11)) });
}

/* gespeicherte Mahlzeiten */

const templates = [
  newTemplate(uid, {
    name: 'Übliches Frühstück', slot: 'breakfast',
    items: [{ foodId: food('Haferflocken').id, amount: 1 },
            { foodId: food('Magerquark 500 g').id, amount: 0.5 },
            { foodId: food('Banane').id, amount: 1 }],
  }),
  newTemplate(uid, {
    name: 'Meal Prep Mittag', slot: 'lunch',
    items: [{ foodId: food('Hähnchenbrust').id, amount: 1 },
            { foodId: food('Reis gekocht').id, amount: 1 },
            { foodId: food('Brokkoli').id, amount: 1 }],
  }),
  newTemplate(uid, {
    name: 'Nach dem Training', slot: 'snack',
    items: [{ foodId: food('Whey Protein').id, amount: 1 },
            { foodId: food('Banane').id, amount: 1 }],
  }),
];
templates[0].uses = 23;
templates[1].uses = 14;
templates[2].uses = 31;

// `uses` bestimmt die Reihenfolge der Lebensmittelliste, die Klassiker stehen also oben, wie
// nach vier Monaten echtem Eintragen.
for (const f of foods) {
  f.uses = meals.filter((m) => m.foodId === f.id).length;
}

/* Ausgabe */

const settings = {
  ...DEFAULT_SETTINGS,
  language: 'de',
  units: 'kg',
  sex: 'male',
  age: 28,
  height: 181,
  bodyweight: bodyweight.length ? bodyweight[bodyweight.length - 1].weight : END_BW,
  goal: 'gain',
  activePlanId: plan.id,
  restSeconds: 180,
  // Kürzlich genug gesichert, dass die Karte "sichere dein Training" auf Home still bleibt: der
  // Hinweis braucht 10 Einheiten oder 28 Tage, und ein Warnbanner oben über einer Vorführung ist
  // Lärm. Weiter zurücklegen, wenn man die Karte selbst zeigen will.
  lastExportAt: dayOffset(9).getTime(),
};

const payload = {
  format: 'liftlog-backup',
  version: 1,
  exportedAt: new Date().toISOString(),
  settings,
  exercises,
  plans: [plan],
  sessions: sessions.sort((a, b) => b.startedAt - a.startedAt),
  bodyweight,
  foods,
  meals: meals.sort((a, b) => b.at - a.at),
  water,
  templates,
};

process.stdout.write(JSON.stringify(payload));

// Ein kurzer Bericht auf stderr, damit man auch beim Umleiten von stdout in eine Datei sieht,
// was herauskam. Eine Vorführung, die man nicht angeschaut hat, führt einen Fehler vor.
const totalSets = sessions.reduce(
  (n, s) => n + s.entries.reduce((m, e) => m + e.sets.filter((x) => x.done && x.type === 'working').length, 0), 0);
const loggedDays = new Set(meals.map((m) => m.day)).size;
process.stderr.write([
  `exercises      ${exercises.length}`,
  `plan           ${plan.name}, ${plan.days.length} days`,
  `sessions       ${sessions.length} over ${WEEKS} weeks, ${totalSets} working sets`,
  `bodyweight     ${bodyweight.length} weigh-ins, ${START_BW} to ${settings.bodyweight} kg`,
  `foods          ${foods.length}, ${templates.length} saved meals`,
  `meals          ${meals.length} across ${loggedDays} logged days`,
  `water          ${water.length} days`,
  '',
].join('\n'));
