// Tests für die Schicht, die entscheidet, was die App einem sagt.
//
// Starten: `node --test` im Hauptordner des Repos. Kein Framework, keine Abhängigkeit, kein
// Build-Schritt: node:test kommt mit Node, und jedes Modul, das hier getestet wird, hat kein
// DOM. Es wird also direkt aus js/ importiert, ohne Attrappen. Der Browser lädt diesen
// Ordner nie.
//
// Was sich hier zu testen lohnt, ist absichtlich eng. Nicht die Gewichte der Bewertungen,
// das sind Abwägungen gegen die Literatur, und die werden sich wieder ändern. Getestet
// wird die Rechnung darunter und die Regeln, die schon einmal kaputt waren:
//
//   * Datumsangaben, weil bisher jeder stille Fehler ein Datum war (weekStreak,
//     weeklyMuscleSets, das Fenster für Mahlzeiten), und man sieht ihn erst bei der
//     Zeitumstellung ein halbes Jahr später;
//   * die zwei Zählungen, die übereinstimmen müssen, das Ziel eines Plans und der Stand
//     einer Woche, die monatelang auseinanderlagen, weil jeder Screen selbst gezählt hat;
//   * die Ehrlichkeitsregeln, um die es in der App eigentlich geht, und genau die Sorte
//     Sache, die ein Umbau still umdreht.

import test from 'node:test';
import assert from 'node:assert/strict';

// Feste Zeitzone, damit die Fälle mit Zeitumstellung unten nicht "was die Maschine gerade
// denkt" sind. Gesetzt, bevor ein Date gebaut wird, die Importe oben definieren nur Funktionen.
process.env.TZ = 'Europe/Berlin';

const { e1rm, isCounted, startOfWeek, entryStats, sessionStats, newMeal, dayKey, slotFor, seedExercises, bestOneRepMaxByName, estimatePlanDuration, bodyweightLoadMode } = await import('../js/models.js');
const { scoreFor, scoreForMachine, buildRating, ANATOMY, TIERS, DIVISIONS, RANK_STEPS,
  rankOf, ladder, boundsFor, toNextDivision, ratedMachineNames, machineCategory,
  LOW_CONFIDENCE, EXTRAPOLATED_TIERS, isBenchmark, BAND, canonical,
  weightForRatio, isPlateLoaded, liftsThatRank, REGIONS, canRank,
  drivesRegion, isRateable } = await import('../js/standards.js');
const { analyseWeek, compareToPlan, weekVerdict, weekStreak } = await import('../js/log-analysis.js');
const { analysePlan } = await import('../js/plan-rating.js');
const { rateExercise } = await import('../js/exercise-rating.js');
const { regionProgress } = await import('../js/region-progress.js');
const { bodyweightAt, strengthAt, strengthHistory } = await import('../js/history.js');
const { decodeLink, planLink, resolveAgainstLibrary } = await import('../js/plan-share.js');
const { weekSummary } = await import('../js/week-card.js');
const { THRESHOLDS } = await import('../js/evidence.js');
const { dayTotals, energySplit, maintenanceEstimate, NUTRIENTS, macroTargets } = await import('../js/nutrition.js');
const { latestWeight, withinE1rmWindow } = await import('../js/models.js');
const { PARTS: BADGE_PARTS } = await import('../js/rank-art.js');
const { STORES } = await import('../js/db.js');
const { searchLibrary, searchFoods, toFoodFields } = await import('../js/foodsearch.js');
const { normaliseBarcode, nutritionLooksPlausible } = await import('../js/foodlookup.js');
const { parseNumber, plural } = await import('../js/ui.js');
const { platePlan, describePlates } = await import('../js/plates.js');
const { warmupSets, warmupCount, alreadyWarm } = await import('../js/warmup.js');
const { exerciseHistory, priorWork, readiness, openingSet, nextSet, projectFresh, setDecay,
  effortE1rm, pooledOrderCost, loadStep, roundLoad, parseReps,
  capacityToday, predictReps, predictReserve, leadingRegions } = await import('../js/progression.js');
const { percentiles, zForScore, topSlice, anchorTable } = await import('../js/percentile.js');
const { stallReport, describeStall } = await import('../js/fatigue.js');
const { setLanguage } = await import('../js/i18n.js');
const { timeline, timelineReady, MIN_LOGGED_DAYS } = await import('../js/timeline.js');
const { mergeSnapshots, mergeDetailed } = await import('../js/sync.js');
const { exerciseSearchScore, searchText } = await import('../js/exercise-search.js');
const { distanceMeters, nearbyPlannedWorkout } = await import('../js/gym-location.js');

test('gym arrival only matches a scheduled workout inside the chosen radius', () => {
  const now = Date.now();
  const day = { id: 'push', name: 'Push', weekday: new Date(now).getDay(), items: [] };
  const plan = { id: 'p', days: [day] };
  const config = { enabled: true, latitude: 52.30, longitude: 8.90, radius: 120 };
  const near = { latitude: 52.3005, longitude: 8.90, accuracy: 10 };
  const far = { latitude: 52.31, longitude: 8.90, accuracy: 10 };
  assert.equal(nearbyPlannedWorkout(config, near, plan, [], now)?.day.id, 'push');
  assert.equal(nearbyPlannedWorkout(config, far, plan, [], now), null);
  assert.ok(distanceMeters(config, near) > 40 && distanceMeters(config, near) < 70);
  const date = new Date(now), pad = (n) => String(n).padStart(2, '0');
  const today = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  assert.equal(nearbyPlannedWorkout({ ...config, lastPromptDay: today }, near, plan, [], now), null);
});

test('exercise search understands German aliases, accents and one typo', () => {
  const pullUp = { name: 'Pull-Up', muscle: 'Back', equipment: 'Bodyweight' };
  const bench = { name: 'Barbell Bench Press', muscle: 'Chest', equipment: 'Barbell' };
  assert.ok(exerciseSearchScore(pullUp, 'Klimmzüge') > 0);
  assert.ok(exerciseSearchScore(bench, 'Bankdrücken') > 0);
  assert.ok(exerciseSearchScore(pullUp, 'Pull-Uo') > 0);
  assert.equal(searchText('Körpergröße'), 'korpergrosse');
});

test('pull-ups estimate total system load before applying the repetition formula', () => {
  const exercises = new Map([['pull', { id: 'pull', name: 'Pull-Up' }]]);
  const sessions = [{ finishedAt: '2026-01-01', entries: [{ exerciseId: 'pull', sets: [
    { type: 'working', done: true, weight: 0, reps: 10 },
  ] }] }];
  const best = bestOneRepMaxByName(sessions, exercises, { bodyweight: 80 });
  assert.ok(Math.abs(best.get('Pull-Up') - e1rm(80, 10)) < 0.001);
  assert.ok(scoreFor('Pull-Up', best.get('Pull-Up'), { sex: 'male', bodyweight: 80, age: 25 }) < 80);
});

test('bodyweight movements use bodyweight while weighted variants collect only added load', () => {
  assert.equal(bodyweightLoadMode({ name: 'Dip', equipment: 'Bodyweight' }), 'bodyweight');
  assert.equal(bodyweightLoadMode({ name: 'Weighted Dip', equipment: 'Bodyweight' }), 'added');
  const weighted = new Map([['dip', { id: 'dip', name: 'Weighted Dip' }]]);
  const sessions = [{ finishedAt: '2026-01-01', entries: [{ exerciseId: 'dip', sets: [
    { type: 'working', done: true, weight: 20, systemWeight: 100, loadMode: 'added', reps: 8 },
  ] }] }];
  const best = bestOneRepMaxByName(sessions, weighted, { bodyweight: 80 });
  assert.equal(best.get('Weighted Dip'), e1rm(100, 8));
  assert.ok(scoreFor('Weighted Dip', best.get('Weighted Dip'), { sex: 'male', bodyweight: 80, age: 25 }) > 0);
  assert.equal(entryStats({ sets: [{ type: 'working', done: true, weight: 20,
    systemWeight: 100, loadMode: 'added', reps: 8 }] }).volume, 800);
});

test('ambiguous old weighted pull-up entries cannot create a false Elite score', () => {
  const exercises = new Map([['pull', { id: 'pull', name: 'Pull-Up' }]]);
  const make = (set) => [{ finishedAt: '2026-01-01', entries: [{ exerciseId: 'pull', sets: [set] }] }];
  const old = { type: 'working', done: true, weight: 80, reps: 10 };
  assert.equal(bestOneRepMaxByName(make(old), exercises, { bodyweight: 80 }).has('Pull-Up'), false);
  const confirmed = { ...old, weight: 20, loadMode: 'added' };
  assert.ok(bestOneRepMaxByName(make(confirmed), exercises, { bodyweight: 80 }).get('Pull-Up') > 100);
});

test('the same lifter ranks the same in pounds as in kilograms', () => {
  // Die Standards sind Vielfache des Körpergewichts gegen eine Referenz von 60 oder 80 kg,
  // und durch den allometrischen Exponenten hebt sich die Rechnung nicht auf: mit Pfund
  // gefüttert bläht sie auf. Dieselbe Person kam in Pfund anderthalb Ränge stärker heraus
  // als in Kilo, still, solange es die Einstellung gab.
  const inKg = { sex: 'male', bodyweight: 81.6, age: 24, units: 'kg' };
  const inLb = { sex: 'male', bodyweight: 180, age: 24, units: 'lb' };
  const kg = scoreFor('Barbell Bench Press', 102, inKg);
  const lb = scoreFor('Barbell Bench Press', 225, inLb);
  assert.ok(Math.abs(kg - lb) < 0.2, `${kg.toFixed(1)} in kg against ${lb.toFixed(1)} in lb`);

  // Und was für einen Screen zurückkommt, ist in der Einheit, die dieser Screen benutzt.
  const nextKg = toNextDivision('Barbell Bench Press', kg, inKg).weight;
  const nextLb = toNextDivision('Barbell Bench Press', lb, inLb).weight;
  assert.ok(Math.abs(nextLb / 2.2046226218 - nextKg) < 0.5,
    `${nextKg.toFixed(1)} kg against ${nextLb.toFixed(1)} lb`);

  // Ein Profil ganz ohne Einheit wird als Kilo behandelt, das meint jeder Eintrag von vor
  // der Einstellung.
  assert.equal(scoreFor('Barbell Bench Press', 102, { sex: 'male', bodyweight: 81.6, age: 24 }).toFixed(3),
    kg.toFixed(3));
});

test('allometric bodyweight scaling reduces the former light-lifter bias', () => {
  const light = scoreFor('Barbell Bench Press', 100, { sex: 'male', bodyweight: 70, age: 25 });
  const heavy = scoreFor('Barbell Bench Press', 100, { sex: 'male', bodyweight: 100, age: 25 });
  assert.ok(light > heavy);
  assert.ok(light - heavy < 20);
});

test('common machines contribute to the muscle map without fake strength tiers', () => {
  for (const name of ['Hack Squat', 'Leg Extension', 'Seated Leg Curl', 'Pec Deck', 'Seated Cable Row',
    'Chest-Supported T-Bar Row', 'Smith Machine Incline Bench Press', 'Butterfly',
    'Lateral Raise Machine', 'Preacher Curl Machine', 'Overhead Rope Triceps Extension',
    'Triceps Pushdown', 'Rope Hammer Curl', 'Close-Grip Seated Row']) {
    assert.ok(ANATOMY[name], `${name} should have anatomy`);
  }
});

test('a machine with a derived standard counts fully on the body map', () => {
  const profile = { sex: 'male', bodyweight: 80, age: 25 };
  const score = scoreForMachine('Machine Chest Press', 90, profile);
  assert.ok(score > 0 && score < 100);
  const rating = buildRating(new Map([['Machine Chest Press', 90]]), profile,
    { machineNames: new Set(['Machine Chest Press']) });
  assert.equal(rating.lifts[0].machine, true);
  assert.equal(rating.lifts[0].derived, true, 'anchored to the bench press standard');
  // Wurde hier früher auf 0,65 abgewertet. Maschinenarbeit hat also den Rang aufgebläht und
  // dann zu der Karte, die sie aufgebläht hat, fast nichts beigetragen.
  assert.equal(Math.round(rating.regions.chest.score), Math.round(score));
});

test('a machine with no anchor is still ranked, just less confidently', () => {
  const profile = { sex: 'male', bodyweight: 80, age: 25 };
  const rating = buildRating(new Map([['Some Gym Brand Chest Press', 90]]), profile,
    { machineNames: new Set(['Some Gym Brand Chest Press']) });
  assert.equal(rating.lifts.length, 1);
  assert.equal(rating.lifts[0].derived, false);
});

test('cables are ranked and assisted machines never are', () => {
  const names = ratedMachineNames([
    { name: 'Triceps Pushdown', equipment: 'Cable' },
    { name: 'Machine Chest Press', equipment: 'Machine' },
    { name: 'Assisted Pull-Up Machine', equipment: 'Machine' },
    { name: 'Barbell Bench Press', equipment: 'Barbell' },
  ]);
  assert.ok(names.has('Triceps Pushdown'), 'a stack is a stack whichever side the pulley is on');
  assert.ok(names.has('Machine Chest Press'));
  // Die Zahl an einer Maschine mit Unterstützung ist, wie viel von einem sie trägt. Sie
  // einzustufen würde die Stärksten nach unten stellen.
  assert.equal(names.has('Assisted Pull-Up Machine'), false);
  assert.equal(names.has('Barbell Bench Press'), false, 'that one has a published standard');
  assert.equal(boundsFor('Assisted Pull-Up Machine', { sex: 'male', bodyweight: 80 }, { machine: true }), null);
});

test('a muscle seen only through somebody else\'s lift gets no rank at all', () => {
  // Der Fehler, den das ersetzt hat, in zwei Hälften. Die Wertung einer Region war
  // `Wertung der Übung x wie stark die Übung sie trainiert`, und diese zweite Zahl ist ein
  // BEITRAGS-Gewicht, kein Abschlag auf die Stärke. So gelesen sah jemand, dessen einziger
  // Beleg für den Trapez ein T-Bar-Rudern war, "Diamond II", gerechnet als
  // `Rang beim Rudern x 0,7`. Das ist kein schwacher Trapez, das ist Rudern.
  //
  // Sie aus dem Durchschnitt zu nehmen war die erste Hälfte. Das hier ist die zweite: das
  // Gewicht ist eine Schwelle und kein Faktor, unter der Schwelle gibt es also nirgends eine
  // Zahl zum Drucken.
  // Ein Latzug treibt den Latissimus an und beteiligt Bizeps und hintere Schulter nur. Das
  // ist die ehrliche Fassung davon: aus einem Latzug kann man keine Bizepsstärke ablesen,
  // Rudern treibt den mittleren Rücken aber wirklich an.
  const profile = { sex: 'male', bodyweight: 82, age: 24, units: 'kg' };
  const rating = buildRating(new Map([['Lat Pulldown', 111]]), profile, {});

  // Der Latissimus ist das, was die Übung antreibt (Gewicht 1,0), er bekommt ihren Rang also ganz.
  assert.ok(rating.regions.lats);
  const lift = rating.lifts[0];
  assert.ok(Math.abs(rating.regions.lats.score - lift.score) < 0.01,
    'a lift that drives a region gives it that rank, not a fraction of it');

  // Bizeps und hintere Schulter werden mit 0,55 und 0,35 berührt. Keiner bekommt einen Rang,
  // und jeder wird mit der Übung gemerkt, die ihn erreicht.
  for (const region of ['biceps', 'delts-rear']) {
    assert.equal(rating.regions[region], undefined, `${region} must not carry a rank`);
    assert.equal(rating.indirect[region].via, 'Lat Pulldown');
    assert.equal(rating.indirect[region].score, undefined, 'and no number to print');
  }
  assert.equal(rating.ratedRegions, 1);

  // Eine Region, die etwas anderes richtig einstuft, braucht nicht noch einen Hinweis.
  const withDirect = buildRating(new Map([['Lat Pulldown', 111], ['Machine Rear Delt Fly', 90]]),
    profile, { machineNames: new Set(['Machine Rear Delt Fly']) });
  assert.ok(withDirect.regions['delts-rear'], 'a rear delt fly does rank rear delts');
  assert.equal(withDirect.indirect['delts-rear'], undefined);
});

test('every muscle region can be ranked by something in the library', () => {
  // Die Beschwerde, auf die das antwortet: eine Region, die nur eine Isolationsmaschine
  // einstufen konnte, schalten die meisten nie frei. Der Trapez war der schlimmste Fall,
  // erreicht von 22 Bewegungen und einstufbar von genau einer, weil sich jedes Rudern als
  // Latissimus-Übung beschrieben hat. Die seitlichen Bauchmuskeln waren gar nicht einstufbar.
  for (const region of Object.keys(REGIONS)) {
    const drivers = liftsThatRank(region);
    assert.ok(drivers.length >= 1, `${region} has nothing that can rank it`);
  }
  // Und der mittlere Rücken ist über normales Rudern erreichbar, nicht nur über Shrugs.
  const traps = liftsThatRank('traps');
  assert.ok(traps.length >= 5, `only ${traps.length} movements can rank the trapezius`);
  assert.ok(traps.includes('Chest-Supported T-Bar Row'),
    'a chest-supported row is an upper-back movement and has to rank the upper back');
  assert.ok(traps.includes('Barbell Row'));
});

test('a region rank is the best driver, with the corroboration alongside it', () => {
  // Absichtlich kein Durchschnitt der Bewegungen, die einen Muskel trainieren. Mitteln
  // bestraft es, mehrere zu haben: wer schwer drückt und dazu zwei leichte Flys macht, läge
  // unter jemandem, der nur drückt, und die Brust drückt ja immer noch, was sie drückt. Die
  // Zahl ist also die beste gezeigte Leistung, und die Streuung fährt nebenher.
  const profile = { sex: 'male', bodyweight: 82, age: 24, units: 'kg' };
  const rating = buildRating(new Map([
    ['Barbell Bench Press', 140],      // die starke
    ['Machine Chest Press', 100],      // eine viel leichtere Zusatzübung
    ['Butterfly', 70],
  ]), profile, { machineNames: new Set(['Machine Chest Press', 'Butterfly']) });

  const bench = rating.lifts.find((l) => l.name === 'Barbell Bench Press');
  assert.ok(Math.abs(rating.regions.chest.score - bench.score) < 0.01,
    'three chest movements must not average the bench down');
  assert.equal(rating.regions.chest.drivers, 3);
  assert.ok(rating.regions.chest.spread > BAND, 'and the disagreement is recorded, not hidden');

  // Ein Treiber wird als ein Treiber gemeldet, ohne nennenswerte Streuung.
  const alone = buildRating(new Map([['Barbell Bench Press', 140]]), profile, {});
  assert.equal(alone.regions.chest.drivers, 1);
  assert.equal(alone.regions.chest.spread, 0);

  // Eine zusätzliche Bewegung kann eine Region nie senken. Genau diese Eigenschaft hätte ein
  // Durchschnitt kaputtgemacht.
  const before = alone.regions.chest.score;
  assert.ok(rating.regions.chest.score >= before);
});

test('a suggestion is phrased in the names the library actually uses', () => {
  // Die gepflegten Tabellen nennen es "Cable Oblique Twist", der mitgelieferte Katalog
  // "Cable Russian Twists". Jemandem das Erste zu empfehlen ist nutzloser Rat für eine Übung,
  // die er nicht findet.
  assert.equal(drivesRegion('Cable Russian Twists', 'obliques'), 1);
  assert.ok(canRank('Cable Russian Twists', 'obliques'));
  assert.ok(canRank('One-Arm High-Pulley Cable Side Bends', 'obliques'));
  // Und Rudern wird nicht zur Bizepsübung, nur weil der Bizeps mitmacht.
  assert.equal(canRank('Lat Pulldown', 'biceps'), false);
  assert.ok(canRank('Machine Biceps Curl', 'biceps'));
  assert.equal(drivesRegion('Zzz Nothing At All', 'biceps'), 0);
});

test('a log with nothing trained directly still gets a number', () => {
  // Rückfall auf alles Bewertete, weil einem ganz neuen Log mit einer indirekten Region eine
  // grobe Antwort mehr hilft als ein leeres Feld.
  const profile = { sex: 'male', bodyweight: 82, age: 24, units: 'kg' };
  const rating = buildRating(new Map([['Barbell Row', 100]]), profile, {});
  const anyDirect = Object.values(rating.regions).some((r) => r.direct);
  if (!anyDirect) assert.ok(rating.overall > 0, 'no direct regions must not mean no rating');
  assert.ok(rating.overall !== null);
});

test('a plate-loaded bar is ranked, and is not treated as a stack', () => {
  // Ein T-Bar-Rudern mit Bruststütze ist eine Langhantel mit Polster. Der Katalog markiert
  // manche davon als Barbell, damit fielen sie ganz aus den bewerteten heraus: ein T-Bar-Rudern
  // mit Scheiben ergab gar keinen Rang.
  const barTagged = { name: 'T-Bar Row with Handle', equipment: 'Barbell' };
  assert.ok(ratedMachineNames([barTagged]).has(barTagged.name),
    'plate-loaded work is rankable whatever the catalogue calls its equipment');
  assert.ok(isPlateLoaded('Chest-Supported T-Bar Row'));
  assert.ok(isPlateLoaded('Lying T-Bar Row'), 'and the catalogue name resolves through the alias');
  assert.equal(isPlateLoaded('Seated Cable Row'), false, 'a stack is not plate-loaded');

  // Auf der Muskelkarte gewinnt eine Stange mit Scheiben einen Gleichstand wie eine
  // Langhantel, weil sie eine ist. Nur ein Block verliert einen gegen einen veröffentlichten Standard.
  const profile = { sex: 'male', bodyweight: 82, age: 24, units: 'kg' };
  const factor = boundsFor('Chest-Supported T-Bar Row', profile, { machine: true })[0]
    / boundsFor('Barbell Row', profile)[0];
  const tie = buildRating(new Map([['Chest-Supported T-Bar Row', 120 * factor], ['Barbell Row', 120]]),
    profile, { machineNames: new Set(['Chest-Supported T-Bar Row']) });
  assert.equal(tie.regions.lats.stack, false);

  const stackTie = buildRating(new Map([['Seated Cable Row', 120 * 1.17], ['Barbell Row', 120]]),
    profile, { machineNames: new Set(['Seated Cable Row']) });
  assert.equal(stackTie.regions.lats.via, 'Barbell Row', 'a stack still yields to the standard');
});

test('a free-weight lift keeps a region it ties a machine on', () => {
  const profile = { sex: 'male', bodyweight: 80, age: 25 };
  // So gewählt, dass beide auf derselben Wertung landen. Der Maschinenstandard ist der
  // Bankdrück-Standard mal einem Faktor, der Gleichstand liegt also bei der Last beim
  // Bankdrücken mal diesem Faktor. Abgeleitet und nicht hingeschrieben, weil sich der Faktor
  // bei jeder Neueinstellung der Maschinen ändert und eine feste Kopie davon still verrottet.
  const factor = boundsFor('Machine Chest Press', profile, { machine: true })[0]
    / boundsFor('Barbell Bench Press', profile)[0];
  const bench = 140;
  const rating = buildRating(new Map([['Machine Chest Press', bench * factor], ['Barbell Bench Press', bench]]),
    profile, { machineNames: new Set(['Machine Chest Press']) });
  assert.ok(Math.abs(rating.lifts[0].score - rating.lifts[1].score) < 0.001, 'the two really do tie');
  assert.equal(rating.regions.chest.via, 'Barbell Bench Press');
  assert.equal(rating.regions.chest.machine, false);
});

/* ===================== die Rangleiter ===================== */

test('the ladder keeps every published anchor where it was', () => {
  // Die Version mit fünf Stufen hatte Anfänger, Fortgeschritten, Weit fortgeschritten und
  // Elite bei diesen vier Vielfachen des Körpergewichts. Neun Ränge dürfen sie nicht still verschieben.
  const anchors = [0.75, 1.25, 1.75, 2.25];
  const eight = ladder(anchors);
  assert.equal(eight.length, TIERS.length - 1);
  assert.equal(eight[1], anchors[0], 'Gold is the published novice standard');
  assert.equal(eight[3], anchors[1], 'Diamond is the published intermediate standard');
  assert.equal(eight[5], anchors[2], 'Grandmaster is the published advanced standard');
  assert.equal(eight[7], anchors[3], 'Legend is the published elite standard');
  for (let i = 1; i < eight.length; i++) assert.ok(eight[i] > eight[i - 1], 'and it only goes up');
});

test('the ranks above the published standards are extrapolation, and say so', () => {
  // Alles bis Legend hängt an einer veröffentlichten Zahl. Die drei darüber nicht, und die
  // App muss weiter wissen, welche welche sind.
  assert.equal(EXTRAPOLATED_TIERS.size, 3);
  for (const key of EXTRAPOLATED_TIERS) {
    assert.ok(TIERS.some((tier) => tier.key === key), `${key} is a real rank`);
  }
  const anchored = TIERS.filter((tier) => !EXTRAPOLATED_TIERS.has(tier.key));
  assert.equal(anchored[anchored.length - 1].key, 'legend',
    'Legend is the last rank with a table behind it');

  // Und die sind wirklich schwer: bei 80 kg Körpergewicht ist das obere Ende der Leiter ein
  // Bankdrücken, das niemand zufällig schafft.
  const profile = { sex: 'male', bodyweight: 80, age: 25 };
  const bounds = boundsFor('Barbell Bench Press', profile);
  assert.equal(bounds.length, TIERS.length - 1);
  assert.ok(bounds[bounds.length - 1] * 80 > 230, 'Radiant asks for more than 230 kg');
  for (let i = 1; i < bounds.length; i++) {
    assert.ok(bounds[i] > bounds[i - 1], 'and the ladder never goes backwards');
  }
});

test('elite is no longer the fourth of four boundaries', () => {
  const profile = { sex: 'male', bodyweight: 80, age: 25 };
  // Das 1,75-Fache des Körpergewichts auf der Bank: die alte Tabelle nannte das Weit
  // fortgeschritten, und die alte Leiter hatte darüber genau noch einen Rang. Jetzt sind es drei.
  const rank = rankOf(scoreFor('Barbell Bench Press', 140, profile));
  assert.equal(rank.tier.key, 'grandmaster');
  assert.ok(rank.step < RANK_STEPS - 3, 'there is still somewhere to go');
  assert.equal(rankOf(scoreFor('Barbell Bench Press', 180, profile)).tier.key, 'legend');
  assert.equal(rankOf(scoreFor('Barbell Bench Press', 60, profile)).tier.key, 'gold');
});

test('rank divisions cover the band without gaps or overlap', () => {
  const seen = new Set();
  for (let score = 0; score <= 100; score += 0.25) {
    const rank = rankOf(score);
    assert.ok(rank.divisionIndex >= 0 && rank.divisionIndex < DIVISIONS.length);
    assert.ok(rank.progress >= 0 && rank.progress < 1.0001);
    assert.equal(rank.step, rank.tierIndex * DIVISIONS.length + rank.divisionIndex + 1);
    seen.add(rank.step);
  }
  assert.equal(seen.size, RANK_STEPS, 'every one of the 27 steps is reachable');
  assert.equal(rankOf(0).step, 1);
  assert.equal(rankOf(100).step, RANK_STEPS);
  assert.equal(rankOf(null), null);
});

test('the next division is a weight you can picture reaching', () => {
  const profile = { sex: 'male', bodyweight: 80, age: 25 };
  const score = scoreFor('Barbell Bench Press', 100, profile);
  const next = toNextDivision('Barbell Bench Press', score, profile);
  assert.ok(next.weight > 100 && next.weight < 112, `one division is ${next.weight} kg away`);
  // Und wer darauf landet, steigt wirklich auf.
  assert.equal(rankOf(scoreFor('Barbell Bench Press', next.weight + 0.01, profile)).step,
    rankOf(score).step + 1);
});

test('a pull-up standard still asks for added weight, not total load', () => {
  const profile = { sex: 'male', bodyweight: 80, age: 25 };
  const score = scoreFor('Pull-Up', 110, profile);
  const next = toNextDivision('Pull-Up', score, profile);
  assert.ok(next.weight < 80, 'the belt carries the difference, not the whole system');
});

test('same-model observations gradually adjust rather than replace the seed standard', () => {
  const profile = { sex: 'male', bodyweight: 80, age: 25 };
  const seed = scoreForMachine('Machine Chest Press', 90, profile);
  const adjusted = scoreForMachine('Machine Chest Press', 90, profile,
    { count: 100, q20: 0.3, q40: 0.5, q60: 0.7, q80: 0.9 });
  assert.notEqual(adjusted, seed);
  assert.ok(adjusted < 100 && adjusted > 0);
});

test('planned duration excludes a pointless rest after every exercise', () => {
  const items = [{ targetSets: 3 }, { targetSets: 3 }];
  assert.equal(estimatePlanDuration(items, 180), (6 * 45 + 4 * 180 + 90) * 1000);
});

test('a stable machine fly outranks the rolling bodyweight fly', () => {
  const common = { muscle: 'Chest', primary: ['chest'], instructions: ['Controlled reps'] };
  const unstable = rateExercise({ ...common, name: 'Bodyweight Flyes', equipment: 'Barbell',
    secondary: ['abs', 'delts-front', 'triceps'], mech: 'isolation' });
  const machine = rateExercise({ ...common, name: 'Butterfly', equipment: 'Machine',
    secondary: [], mech: 'isolation' });
  assert.ok(machine.stars >= unstable.stars + 1.5);
  assert.equal(unstable.stability.level, 'unstable');
  assert.equal(machine.stability.level, 'supported');
  assert.equal(unstable.criteria.find((c) => c.label === 'exRating.progression').points, 0.5);
});

test('stabilizer tags do not turn an isolation movement into a compound bonus', () => {
  const rating = rateExercise({ name: 'Bodyweight Flyes', muscle: 'Chest', equipment: 'Barbell',
    primary: ['chest'], secondary: ['abs', 'delts-front', 'triceps'], mech: 'isolation', instructions: ['x'] });
  assert.equal(rating.criteria.find((c) => c.label === 'exRating.breadth').points, 0.5);
});

test('chest support keeps a T-bar row from inheriting the bent-over torso limiter', () => {
  const supported = rateExercise({ name: 'Chest-Supported T-Bar Row', muscle: 'Back', equipment: 'Machine',
    primary: ['lats'], secondary: ['biceps', 'delts-rear'], mech: 'compound', instructions: ['x'] });
  const unsupported = rateExercise({ name: 'T-Bar Row', muscle: 'Back', equipment: 'Barbell',
    primary: ['lats'], secondary: ['biceps', 'delts-rear', 'lower-back'], mech: 'compound', instructions: ['x'] });
  assert.equal(supported.limit.level, 'target');
  assert.equal(supported.limit.why, 'science.chestSupportedRow');
  assert.equal(unsupported.limit.level, 'other');
});

test('a Smith incline press outranks the redundant shorter-ROM decline press', () => {
  const common = { muscle: 'Chest', equipment: 'Machine', primary: ['chest'],
    secondary: ['delts-front', 'triceps'], mech: 'compound', instructions: ['x'] };
  const incline = rateExercise({ ...common, name: 'Smith Machine Incline Bench Press' });
  const decline = rateExercise({ ...common, name: 'Smith Machine Decline Press' });
  assert.ok(incline.stars > decline.stars);
  assert.equal(decline.length.bias, 'short');
  assert.equal(decline.length.why, 'science.declinePress');
});

test('the curated catalogue keeps corrected anatomy, equipment and plain instructions', () => {
  let id = 0;
  const catalogue = seedExercises(() => `exercise_${++id}`);
  const byName = new Map(catalogue.map((exercise) => [exercise.name, exercise]));
  const additions = [
    'Pendulum Squat', 'Belt Squat', 'Smith Machine Romanian Deadlift',
    'Bayesian Cable Curl', 'Cross-Body Cable Lateral Raise', 'Single-Arm Lat Pulldown',
    'Reverse Nordic Curl', 'Glute-Biased 45-Degree Back Extension', 'Cable Y-Raise',
    'Iso-Lateral Chest Press', 'Iso-Lateral Incline Chest Press', 'Iso-Lateral Shoulder Press',
    'Iso-Lateral High Row', 'Iso-Lateral Low Row', 'Plate-Loaded Pullover',
    'Glute Drive Machine', 'Standing Hip Abduction Machine', 'Kneeling Leg Curl Machine',
    'Seated Dip Machine', 'Weighted Pull-Up', 'Weighted Chin-Up', 'Weighted Dip', 'Weighted Push-Up',
  ];

  additions.forEach((name) => assert.ok(byName.has(name), `${name} is missing`));
  assert.equal(byName.get('Bodyweight Flyes').equipment, 'Bodyweight');
  assert.deepEqual(byName.get('Machine Hip Adduction').primary, ['adductors']);
  assert.equal(catalogue.some((exercise) => !exercise.primary?.length), false);
  assert.equal(catalogue.some((exercise) => exercise.instructions?.some((step) => /<\/?(?:h\d|p|li|div|br)\b/i.test(step))), false);
});

test('multi-device backup merge keeps new workouts from both devices', () => {
  const base = { format: 'liftlog-backup', version: 1, settings: {}, exercises: [], plans: [],
    bodyweight: [], foods: [], meals: [], water: [], templates: [] };
  const local = { ...base, sessions: [
    { id: 'shared', startedAt: 1, updatedAt: 30, notes: 'new local edit' },
    { id: 'phone', startedAt: 40, updatedAt: 40 },
  ] };
  const remote = { ...base, sessions: [
    { id: 'shared', startedAt: 1, updatedAt: 20, notes: 'old remote edit' },
    { id: 'tablet', startedAt: 50, updatedAt: 50 },
  ] };
  const merged = mergeSnapshots(local, remote);
  assert.deepEqual(new Set(merged.sessions.map((s) => s.id)), new Set(['shared', 'phone', 'tablet']));
  assert.equal(merged.sessions.find((s) => s.id === 'shared').notes, 'new local edit');
});

test('a setting changed here survives a newer snapshot from another device', () => {
  const base = { format: 'liftlog-backup', version: 1, exercises: [], plans: [],
    sessions: [], bodyweight: [], foods: [], meals: [], water: [], templates: [] };

  // Der Fall aus dem Studio: um 17 Uhr auf diesem Handy ein Maximum für den Block eingetippt,
  // während das Tablet um 16 Uhr einen Stand hochgeladen hat, der noch die alten Einheiten hat.
  const local = { ...base,
    settings: { machineSetups: { ex_1: { stackMax: 85 } }, units: 'kg' },
    settingsUpdatedAt: { machineSetups: 1700, units: 900 } };
  const remote = { ...base,
    settings: { machineSetups: {}, units: 'lb' },
    settingsUpdatedAt: { machineSetups: 1600, units: 1500 } };

  const { merged, tookLocal } = mergeDetailed(local, remote);
  assert.deepEqual(merged.settings.machineSetups, { ex_1: { stackMax: 85 } },
    'the newer local edit is kept');
  assert.equal(merged.settings.units, 'lb', 'the newer remote edit still wins');
  assert.equal(tookLocal, true, 'and the result has to be uploaded');
  // Die Zeitpunkte reisen mit, sonst wäre das nächste Zusammenführen wieder blind.
  assert.equal(merged.settingsUpdatedAt.machineSetups, 1700);
  assert.equal(merged.settingsUpdatedAt.units, 1500);
});

test('settings with no timestamps merge the way they always did', () => {
  const base = { format: 'liftlog-backup', version: 1, exercises: [], plans: [],
    sessions: [], bodyweight: [], foods: [], meals: [], water: [], templates: [] };
  // Ein Stand von vor den Zeitpunkten je Schlüssel. Keine Seite kann sagen, wann sich etwas
  // geändert hat, also gewinnt die Gegenseite, und nichts behauptet eine lokale Änderung.
  const local = { ...base, settings: { units: 'kg', restSeconds: 90 } };
  const remote = { ...base, settings: { units: 'lb' } };
  const { merged, tookLocal } = mergeDetailed(local, remote);
  assert.equal(merged.settings.units, 'lb');
  assert.equal(merged.settings.restSeconds, 90, 'a key only this side has is kept');
  assert.equal(tookLocal, false);
});

test('a synced workout deletion cannot be resurrected by an older device', () => {
  const base = { format: 'liftlog-backup', version: 1, settings: {}, exercises: [], plans: [],
    bodyweight: [], foods: [], meals: [], water: [], templates: [] };
  const oldDevice = { ...base, sessions: [{ id: 'gone', startedAt: 1, updatedAt: 20 }] };
  const deletingDevice = { ...base, sessions: [],
    deletions: [{ collection: 'sessions', id: 'gone', deletedAt: 21 }] };
  const merged = mergeSnapshots(oldDevice, deletingDevice);
  assert.equal(merged.sessions.some((session) => session.id === 'gone'), false);
  assert.equal(merged.deletions.length, 1);
});

test('a newer intentional restore wins over an older deletion marker', () => {
  const base = { format: 'liftlog-backup', version: 1, settings: {}, exercises: [], plans: [],
    bodyweight: [], foods: [], meals: [], water: [], templates: [] };
  const restored = { ...base, sessions: [{ id: 'back', startedAt: 1, updatedAt: 50 }] };
  const deleted = { ...base, sessions: [], deletions: [{ collection: 'sessions', id: 'back', deletedAt: 40 }] };
  assert.equal(mergeSnapshots(restored, deleted).sessions.length, 1);
});

// Die Markierung, die verhindert, dass zwei Handys sich für immer gegenseitig hochladen.
// Ein Gerät, das einen neueren Stand holt und nichts Eigenes beiträgt, hat schon genau das,
// was der Server hat. Es darf also keine identische Kopie als nächste Version zurückschieben,
// die das andere Handy dann holt und genauso beantwortet.
test('a device that contributes nothing to the merge knows it contributed nothing', () => {
  const base = { format: 'liftlog-backup', version: 1, settings: {}, exercises: [], plans: [],
    bodyweight: [], foods: [], meals: [], water: [], templates: [] };
  const remote = { ...base, sessions: [
    { id: 'a', startedAt: 1, updatedAt: 20 },
    { id: 'b', startedAt: 2, updatedAt: 30 },
  ] };

  const behind = { ...base, sessions: [{ id: 'a', startedAt: 1, updatedAt: 20 }] };
  const behindResult = mergeDetailed(behind, remote);
  assert.equal(behindResult.tookLocal, false);
  assert.equal(behindResult.summary.remoteNewer, 0);

  const identical = { ...base, sessions: remote.sessions.map((s) => ({ ...s })) };
  assert.equal(mergeDetailed(identical, remote).tookLocal, false);

  const ahead = { ...base, sessions: [...remote.sessions, { id: 'c', startedAt: 3, updatedAt: 40 }] };
  assert.equal(mergeDetailed(ahead, remote).tookLocal, true);

  const edited = { ...base, sessions: [
    { id: 'a', startedAt: 1, updatedAt: 99 }, { id: 'b', startedAt: 2, updatedAt: 30 },
  ] };
  const editedResult = mergeDetailed(edited, remote);
  assert.equal(editedResult.tookLocal, true);
  assert.equal(editedResult.summary.localNewer, 1);
});

// `cloudBaseVersion` und Co. beschreiben das Verhältnis dieser Installation zum Server. Eine
// Kopie von der Gegenseite ist nicht alt, sie handelt von einem anderen Handy, und eine
// hereinzulassen lässt ein Gerät glauben, es sei bei einer Version, die es nie geholt hat.
test('cloud bookkeeping is never taken from the other device snapshot', () => {
  const base = { format: 'liftlog-backup', version: 1, exercises: [], plans: [], sessions: [],
    bodyweight: [], foods: [], meals: [], water: [], templates: [] };
  const local = { ...base, settings: { cloudBaseVersion: 4, cloudLastFingerprint: 'mine', units: 'kg' } };
  const remote = { ...base, settings: { cloudBaseVersion: 91, cloudLastFingerprint: 'theirs', units: 'lb' } };

  const { merged } = mergeDetailed(local, remote);
  assert.equal(merged.settings.cloudBaseVersion, 4);
  assert.equal(merged.settings.cloudLastFingerprint, 'mine');
  // Alles, was wirklich zum Konto gehört, folgt weiter der Gegenseite.
  assert.equal(merged.settings.units, 'lb');
});

const INDIRECT = THRESHOLDS.indirectSetWeight.value;

/* ============================ Testdaten ============================ */

const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h).getTime();

const exercise = (id, name, primary, secondary = []) => ({
  id, name, primary, secondary, muscle: 'Chest', equipment: 'Barbell',
});

const set = (weight, reps, extra = {}) =>
  ({ weight, reps, rir: null, type: 'working', done: true, ...extra });

const session = (startedAt, entries, extra = {}) => ({
  id: `s_${startedAt}`, name: 'Workout', startedAt, finishedAt: startedAt + 3600e3,
  planId: null, dayId: null, routineId: null, notes: '', entries, ...extra,
});

const entry = (exerciseId, sets) => ({ exerciseId, sets, note: '' });

const BENCH = exercise('ex_bench', 'Barbell Bench Press', ['chest'], ['triceps']);
const byId = new Map([[BENCH.id, BENCH]]);

/* ============================== Rechnerei ============================== */

test('e1rm: a single rep is the weight itself', () => {
  assert.equal(e1rm(100, 1), 100);
});

test('e1rm: Epley above one rep', () => {
  assert.equal(e1rm(100, 10), 100 * (1 + 10 / 30));
});

test('e1rm: nothing lifted, nothing estimated', () => {
  // Schützt die Aufrufer, die durch einen früheren Bestwert teilen.
  assert.equal(e1rm(100, 0), 0);
  assert.equal(e1rm(0, 5), 0);
  assert.equal(e1rm(null, null), 0);
});

test('isCounted: only finished working sets with reps', () => {
  assert.equal(isCounted(set(60, 8)), true);
  assert.equal(isCounted(set(60, 8, { type: 'warmup' })), false);
  assert.equal(isCounted(set(60, 8, { done: false })), false);
  assert.equal(isCounted(set(60, 0)), false);
});

test('entryStats ignores warm-ups in every number it reports', () => {
  const st = entryStats(entry(BENCH.id, [
    set(40, 10, { type: 'warmup' }),
    set(80, 8),
    set(80, 6),
  ]));
  assert.equal(st.sets, 2);
  assert.equal(st.volume, 80 * 8 + 80 * 6);
  assert.equal(st.reps, 14);
});

test('unilateral volume counts both sides but strength uses the weaker side', () => {
  const unilateral = set(18, 9, {
    leftWeight: 20, leftReps: 10, rightWeight: 18, rightReps: 9,
  });
  const st = entryStats(entry(BENCH.id, [unilateral]));
  assert.equal(st.volume, 20 * 10 + 18 * 9);
  assert.equal(st.e1rm, e1rm(18, 9));
});

test('paused time is excluded from workout duration', () => {
  const stopped = session(1000, [], { finishedAt: 11000, pausedMs: 4000 });
  assert.equal(sessionStats(stopped).durationMs, 6000);
  const paused = session(1000, [], { finishedAt: null, pausedAt: 8000, pausedMs: 2000 });
  assert.equal(sessionStats(paused).durationMs, 5000);
});

test('parseNumber takes the separator the keyboard offers', () => {
  // Die Dezimaltaste eines deutschen Handys ist ein Komma. <input type="number"> meldet bei
  // "82,5" einen leeren Text, und damit ist das Gewicht eines Satzes still verschwunden.
  assert.equal(parseNumber('82,5'), 82.5);
  assert.equal(parseNumber('82.5'), 82.5);
  assert.equal(parseNumber(' 82 '), 82);
  assert.equal(parseNumber(82.5), 82.5);
});

test('parseNumber says null rather than guessing', () => {
  for (const junk of ['', '   ', 'abc', '8o', null, undefined, NaN]) {
    assert.equal(parseNumber(junk), null, `expected null for ${JSON.stringify(junk)}`);
  }
  // 0 ist ein echter Wert und kein Fehlen, 0 Wiederholungen dürfen nicht als "leer" gelten.
  assert.equal(parseNumber('0'), 0);
});

test('plural counts one of a thing correctly', () => {
  // "1 sessions" stand monatelang auf dem Screen, in vier verschiedenen Dateien.
  assert.equal(plural(1, 'session'), '1 session');
  assert.equal(plural(0, 'session'), '0 sessions');
  assert.equal(plural(2, 'set'), '2 sets');
  assert.equal(plural(1, 'exercise', 'exercises'), '1 exercise');
});

/* ============================== Datum ============================== */

test('the fixed test timezone is in effect', () => {
  // Ohne das beweisen die zwei Fälle mit Zeitumstellung unten still gar nichts.
  assert.equal(new Date(2026, 2, 23).getTimezoneOffset(), -60, 'expected CET before the change');
  assert.equal(new Date(2026, 2, 30).getTimezoneOffset(), -120, 'expected CEST after it');
});

test('startOfWeek: weeks start on Monday', () => {
  const monday = at(2026, 7, 27, 0);
  assert.equal(startOfWeek(at(2026, 7, 27, 9)), monday);
  assert.equal(startOfWeek(at(2026, 8, 2, 23)), monday, 'Sunday belongs to the week it ends');
  assert.notEqual(startOfWeek(at(2026, 8, 3, 1)), monday, 'Monday starts a new one');
});

test('startOfWeek: a clock change does not move the week boundary', () => {
  // Am 29.03.2026 ist die Umstellung im Frühjahr. Der Sonntag gehört trotzdem noch zum Montag davor.
  assert.equal(startOfWeek(at(2026, 3, 29, 12)), at(2026, 3, 23, 0));
  assert.equal(startOfWeek(at(2026, 10, 25, 12)), at(2026, 10, 19, 0));
});

test('weekStreak: counts consecutive weeks across a clock change', () => {
  // Der Rückfall: wer feste 7 x 86400000 ms zurückgeht, landet hier eine Stunde neben
  // Mitternacht, der Wochenschlüssel passt nicht mehr, und die Serie steht auf 1.
  const sessions = [
    session(at(2026, 3, 17), []),   // Woche ab 16. März
    session(at(2026, 3, 24), []),   // Woche ab 23. März, mit der Umstellung
    session(at(2026, 3, 31), []),   // Woche ab 30. März
  ];
  assert.equal(weekStreak(sessions, at(2026, 3, 31)), 3);
});

test('weekStreak: the current week may still be empty', () => {
  const sessions = [session(at(2026, 7, 21), [])];        // nur letzte Woche
  assert.equal(weekStreak(sessions, at(2026, 7, 27)), 1, 'Monday morning still has a streak');
  assert.equal(weekStreak(sessions, at(2026, 8, 5)), 0, 'but not once a whole week is missed');
});

test('weekStreak: unfinished sessions do not keep a streak alive', () => {
  const open = { ...session(at(2026, 7, 28), []), finishedAt: null };
  assert.equal(weekStreak([open], at(2026, 7, 28)), 0);
});

/* ================== die zwei Zählungen, die übereinstimmen müssen ================== */

test('planned and done are counted the same way', () => {
  // Für genau diese Regel gibt es js/log-analysis.js: sagt der Plan "Brust 4", darf die
  // Woche nicht "Brust 8" sagen, weil eine Seite anders gezählt hat.
  const week = analyseWeek(
    [session(at(2026, 7, 28), [entry(BENCH.id, [set(80, 8), set(80, 8), set(80, 8), set(80, 8)])])],
    byId,
    startOfWeek(at(2026, 7, 28))
  );
  const plan = analysePlan(
    { name: 'P', perWeek: 1, days: [{ id: 'd1', name: 'Day', items: [{ exerciseId: BENCH.id, targetSets: 4, targetReps: '6-10' }] }] },
    byId
  );

  assert.equal(week.volume.chest, 4);
  assert.equal(plan.volume.chest, 4);
  assert.equal(week.volume.triceps, 4 * INDIRECT, 'secondary muscles count fractionally');
  assert.equal(plan.volume.triceps, plan.volume.chest * INDIRECT);
});

test('analyseWeek only looks at the week it was asked about', () => {
  const sessions = [
    session(at(2026, 7, 28), [entry(BENCH.id, [set(80, 8)])]),
    session(at(2026, 7, 21), [entry(BENCH.id, [set(80, 8)])]),
  ];
  const week = analyseWeek(sessions, byId, startOfWeek(at(2026, 7, 28)));
  assert.equal(week.workouts, 1);
  assert.equal(week.totalSets, 1);
});

test('a muscle trained but not planned has no target, not a target of zero', () => {
  // Warum Karte und Home diese Balken grau zeichnen: Verhältnis 1 heißt "nichts zum
  // Vergleichen", nicht "getroffen".
  const week = analyseWeek(
    [session(at(2026, 7, 28), [entry(BENCH.id, [set(80, 8)])])],
    byId, startOfWeek(at(2026, 7, 28))
  );
  const rows = compareToPlan(week, { volume: {} });
  const chest = rows.find((r) => r.region === 'chest');
  assert.equal(chest.target, 0);
  assert.equal(chest.ratio, 1);
  assert.equal(chest.short, 0);
});

test('weekVerdict says nothing about sessions it cannot count', () => {
  const week = analyseWeek(
    [session(at(2026, 7, 28), [entry(BENCH.id, [set(80, 8)])])],
    byId, startOfWeek(at(2026, 7, 28))
  );
  const rows = compareToPlan(week, null);
  assert.ok(!weekVerdict(week, rows, 0).headline.includes('?'), 'no "2 of ? sessions in"');
  assert.match(weekVerdict(week, rows, 5).headline, /of 5 sessions in/);
});

/* ========================== Zeitfenster ========================== */

test('regionProgress cannot see past the moment it was asked about', () => {
  // Eine Karte über die letzte Woche darf sich nicht ändern, wenn diese Woche eingetragen wird.
  const sessions = [
    session(at(2026, 7, 6), [entry(BENCH.id, [set(80, 8)])]),
    session(at(2026, 7, 13), [entry(BENCH.id, [set(85, 8)])]),
    session(at(2026, 7, 20), [entry(BENCH.id, [set(90, 8)])]),
    session(at(2026, 7, 27), [entry(BENCH.id, [set(200, 8)])]),   // nach der Grenze
  ];
  const upToJul26 = regionProgress(sessions, byId, { now: at(2026, 7, 26) });
  const upToNow = regionProgress(sessions, byId, { now: at(2026, 7, 28) });
  assert.ok(upToJul26.chest.pctPerWeek < upToNow.chest.pctPerWeek,
    'the later session must not leak into the earlier window');
});

test('regionProgress refuses to call three points a trend', () => {
  const thin = regionProgress(
    [session(at(2026, 7, 20), [entry(BENCH.id, [set(80, 8)])]),
     session(at(2026, 7, 22), [entry(BENCH.id, [set(85, 8)])])],
    byId, { now: at(2026, 7, 28) }
  );
  assert.equal(thin.chest.state, 'thin');
  assert.equal(thin.chest.pctPerWeek, null, 'no number where there is no trend');
});

test('bodyweightAt reads the entry in force at a moment', () => {
  const log = [
    { id: 'a', date: at(2026, 6, 1), weight: 80 },
    { id: 'b', date: at(2026, 7, 1), weight: 82 },
  ];
  assert.equal(bodyweightAt(log, at(2026, 5, 1)), null, 'nothing before the first entry');
  assert.equal(bodyweightAt(log, at(2026, 6, 15)), 80);
  assert.equal(bodyweightAt(log, at(2026, 8, 1)), 82);
});

/* ============================ Ernährung ============================ */

const meal = (over = {}) => ({
  id: `m_${Math.random()}`, day: '2026-07-28', at: at(2026, 7, 28), slot: 'lunch',
  name: 'Food', portion: '100 g', amount: 1,
  protein: 20, kcal: 200, carbs: 10, fat: 5, fibre: 2, ...over,
});

test('unrecorded macros are unknown, not zero', () => {
  // Der ganze Grund, warum Kohlenhydrate, Fett und Ballaststoffe null sein dürfen: ein
  // Lebensmittel von einem Etikett nur mit Eiweiß darf die Kohlenhydrate des Tages nicht runterziehen.
  const totals = dayTotals([meal(), meal({ carbs: null, fat: null, fibre: null })]);
  assert.equal(totals.protein, 40);
  assert.equal(totals.carbs, 10, 'only the item that had a value counts');
  assert.equal(totals.missing.carbs, 1);
  assert.equal(totals.missing.fat, 1);
  assert.equal(totals.items, 2);
});

test('the energy split refuses to draw itself on partial data', () => {
  assert.equal(energySplit(dayTotals([meal(), meal({ carbs: null })])), null);
  assert.equal(energySplit(dayTotals([])), null);

  const split = energySplit(dayTotals([meal({ protein: 25, carbs: 50, fat: 10 })]));
  // Atwater: 100 + 200 + 90 = 390 kcal erklärt.
  assert.equal(split.fromMacros, 390);
  assert.ok(Math.abs(split.share.carbs - 200 / 390) < 1e-9);
});

test('a meal scales every recorded macro and leaves the unknown ones alone', () => {
  const food = { id: 'f1', name: 'Quark', portion: '250 g', protein: 30, kcal: 160, carbs: 10, fat: null, fibre: null };
  // `at` wird ausdrücklich übergeben: ohne das kommt die Tageszeit von der Uhr, und dieser
  // Test liefe den ganzen Vormittag durch und scheiterte nach dem Mittagessen.
  const m = newMeal((p) => `${p}x`, food, { amount: 2, at: at(2026, 7, 28, 12) });
  assert.equal(m.protein, 60);
  assert.equal(m.carbs, 20);
  assert.equal(m.fat, null, 'unknown times two is still unknown');
  assert.equal(m.slot, 'lunch', 'a slot is picked from the clock when none is given');
});

test('slotFor splits the day at the hours people eat', () => {
  assert.equal(slotFor(at(2026, 7, 28, 8)), 'breakfast');
  assert.equal(slotFor(at(2026, 7, 28, 13)), 'lunch');
  assert.equal(slotFor(at(2026, 7, 28, 19)), 'dinner');
  assert.equal(slotFor(at(2026, 7, 28, 22)), 'snack');
});

test('the food library is searchable and scales to a portion', () => {
  const hits = searchLibrary('chicken');
  assert.ok(hits.length > 0, 'the bundled library answers a plain query');
  assert.ok(hits.every((f) => f.name.toLowerCase().includes('chicken')));
  assert.deepEqual(searchLibrary('c'), [], 'one letter is not a search');
  assert.deepEqual(searchLibrary('zzzzzz'), []);

  const oats = searchLibrary('oats')[0];
  // Die Wortgrenzen-Regel des Generators gibt es, weil ein Teilstring-Vergleich
  // "Buckwheat groats" unter Hafer einsortiert hat, und nichts danach hätte es gemerkt.
  assert.ok(/oat/i.test(oats.usda), `expected an oat row, got "${oats.usda}"`);

  const fields = toFoodFields(oats, 50);
  assert.equal(fields.portion, '50 g');
  assert.equal(fields.kcal, Math.round(oats.per100.kcal / 2));
  assert.ok(fields.protein > 0);
  assert.equal(typeof fields.micros, 'object');
});

test('German food terms find the measured offline library', () => {
  assert.ok(searchLibrary('Hähnchen').some((food) => /chicken/i.test(food.name)));
  assert.ok(searchLibrary('Haferflocken').some((food) => /oat/i.test(food.name)));
  assert.ok(searchLibrary('Kartoffel').some((food) => /potato/i.test(food.name)));
  assert.ok(searchLibrary('Tomato paste').length > 0, 'new common foods are bundled');
});

test('barcodes require a valid GTIN check digit and nutrition is sanity checked', () => {
  assert.equal(normaliseBarcode('40084015'), '40084015');
  assert.equal(normaliseBarcode('40084016'), null);
  assert.equal(normaliseBarcode('123456789'), null);
  assert.equal(nutritionLooksPlausible({ protein: 13, carbs: 1, fat: 11, kcal: 155 }), true);
  assert.equal(nutritionLooksPlausible({ protein: 13, carbs: 1, fat: 11, kcal: 700 }), false);
});

test('branded products are searchable and rank behind measured ones', () => {
  const hits = searchFoods('nutella');
  assert.ok(hits.some((h) => h.kind === 'brand'), 'the brand library answers a brand name');

  // Allgemeine Einträge sind Labormessungen, Markenprodukte das, was jemand von einer Packung
  // abgetippt hat. Können beide antworten, kommt das Gemessene zuerst.
  const both = searchFoods('milk');
  const firstBrand = both.findIndex((h) => h.kind === 'brand');
  const lastGeneric = both.map((h) => h.kind).lastIndexOf('generic');
  if (firstBrand !== -1 && lastGeneric !== -1) {
    assert.ok(lastGeneric < firstBrand, 'generic results come first');
  }

  for (const hit of searchFoods('protein')) {
    assert.ok(hit.entry.per100.kcal !== undefined, 'every bundled row carries energy');
    assert.ok(hit.entry.per100.protein !== undefined, 'and protein');
  }
});

test('maintenance refuses to answer on thin data', () => {
  assert.equal(maintenanceEstimate([], []).ok, false);

  // Genug Tage eingetragen, aber nur ein Wiegen: keine Richtung, keine Antwort.
  const meals = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(at(2026, 7, 28)); d.setDate(d.getDate() - i);
    meals.push(meal({ day: dayKey(d.getTime()), at: d.getTime(), kcal: 2600, protein: 150 }));
  }
  const only = maintenanceEstimate(meals, [{ id: 'b', date: at(2026, 7, 20), weight: 82 }], { endTs: at(2026, 7, 28) });
  assert.equal(only.ok, false);
  assert.equal(only.reason, 'weight');
});

test('maintenance subtracts what the scale accounts for', () => {
  const END = at(2026, 7, 29);
  const meals = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(END); d.setDate(d.getDate() - i);
    meals.push(meal({ day: dayKey(d.getTime()), at: d.getTime(), kcal: 2600 }));
  }
  // +0,8 kg über genau 28 Tage: 0,2 kg pro Woche, bei 7.700 kcal/kg also 220 kcal am Tag der
  // 2.600, die in die Zunahme gegangen sind. Der Bedarf lag bei 2.380.
  const weights = [
    { id: 'a', date: at(2026, 7, 1), weight: 82 },
    { id: 'b', date: END, weight: 82.8 },
  ];
  const est = maintenanceEstimate(meals, weights, { endTs: END });

  assert.equal(est.ok, true);
  assert.equal(est.meanIntake, 2600);
  assert.equal(est.kgPerWeek, 0.2);
  assert.equal(est.maintenance, 2380);
});

test('macro targets wait for a calorie figure they can trust', () => {
  const settings = { bodyweight: 82, units: 'kg', sex: 'male', goal: 'hold' };
  const t = macroTargets(settings, { ok: false, reason: 'days' });
  assert.equal(t.ok, false);
  // Eiweiß hängt nicht an den Kalorien, wird also trotzdem beantwortet.
  assert.ok(t.protein.low > 0);
});

test('macro targets fall out of calories, not out of a ratio', () => {
  const settings = { bodyweight: 82, units: 'kg', sex: 'male', goal: 'hold' };
  const t = macroTargets(settings, { ok: true, maintenance: 2800 });

  assert.equal(t.kcal, 2800, 'holding means maintenance, untouched');
  // Fett sind 20 bis 35 % der Energie, bei 9 kcal/g.
  assert.equal(t.fat.low, Math.round(2800 * 0.20 / 9));
  assert.equal(t.fat.high, Math.round(2800 * 0.35 / 9));

  // Kohlenhydrate sind der Rest, ihr Bereich läuft also andersherum: die meisten
  // Kohlenhydrate, wenn das Fett an der Untergrenze liegt.
  assert.ok(t.carbs.high > t.carbs.low);
  const proteinKcal = ((t.protein.low + t.protein.high) / 2) * 4;
  assert.equal(t.carbs.low, Math.round((2800 - proteinKcal - t.fat.high * 9) / 4));

  // Und alles geht auf: Eiweiß + Fett-Untergrenze + höchste Kohlenhydrate ≈ das Ziel.
  const total = proteinKcal + t.fat.low * 9 + t.carbs.high * 4;
  assert.ok(Math.abs(total - 2800) < 5, `expected ~2800 kcal, got ${total}`);
});

test('the goal moves calories in the right direction', () => {
  const base = { bodyweight: 82, units: 'kg', sex: 'male' };
  const hold = macroTargets({ ...base, goal: 'hold' }, { ok: true, maintenance: 2800 });
  const gain = macroTargets({ ...base, goal: 'gain' }, { ok: true, maintenance: 2800 });
  const lose = macroTargets({ ...base, goal: 'lose' }, { ok: true, maintenance: 2800 });

  assert.ok(gain.kcal > hold.kcal && hold.kcal > lose.kcal);
  assert.equal(gain.offset, -lose.offset, 'the pace is symmetric');
  assert.ok(gain.kgPerWeek > 0 && lose.kgPerWeek < 0);
  // 0,375 % von 82 kg sind etwa 0,31 kg pro Woche, eine Festlegung, kein Befund.
  assert.ok(Math.abs(gain.kgPerWeek) < 0.5, 'and slow');
});

/* ========================== eine Stange beladen ========================== */

test('platePlan splits the load evenly and names every disc', () => {
  const plan = platePlan(100, 20, 'kg');
  assert.equal(plan.loaded, 100);
  assert.equal(plan.exact, true);
  assert.equal(plan.perSide.reduce((a, b) => a + b, 0) * 2 + 20, 100);
  // Die schwersten Scheiben zuerst: 40 pro Seite sind 25 + 15, nicht 20 + 15 + 5.
  assert.equal(describePlates(plan.perSide), '1 × 25, 1 × 15');
});

test('platePlan admits when a weight cannot be loaded', () => {
  // Unter 1,25 kg gibt es nichts im Ständer, 101 kg kann man also nicht auf eine Stange
  // stecken. Eine Scheibenliste dafür zu drucken wäre eine kleine tägliche Lüge. 40,5 pro
  // Seite ergeben 25 + 15, für das letzte halbe Kilo gibt es keine Scheibe, die Stange landet
  // also bei 100, und die Antwort sagt das, statt 101 zu behaupten.
  const plan = platePlan(101, 20, 'kg');
  assert.equal(plan.exact, false);
  assert.equal(plan.loaded, 100);
  assert.equal(plan.off, -1);
});

test('platePlan handles the bar on its own and refuses less', () => {
  const barOnly = platePlan(20, 20, 'kg');
  assert.equal(barOnly.barOnly, true);
  assert.equal(describePlates(barOnly.perSide), 'just the bar');
  assert.equal(platePlan(15, 20, 'kg'), null, 'lighter than the bar has no answer');
  assert.equal(platePlan(null, 20, 'kg'), null);
});

test('platePlan uses the pound rack for pounds', () => {
  const plan = platePlan(225, 45, 'lb');
  assert.equal(plan.exact, true);
  assert.equal(describePlates(plan.perSide), '2 × 45');
});

/* ========================== Aufwärmen ========================== */

test('the ramp tops out near the working weight, not well below it', () => {
  // Ribeiro 2020: nur leichte Aufwärmsätze haben gegen beide Alternativen verloren. Der letzte
  // Satz muss nah genug an der Arbeit sein, damit er sich lohnt.
  const sets = warmupSets(BENCH, 100, { units: 'kg', barWeight: 20, targetReps: 8 });
  assert.equal(sets.length, 2);
  assert.ok(sets[1].weight >= 75, `last warm-up set was only ${sets[1].weight} kg`);
  assert.ok(sets[1].weight < 100, 'a warm-up heavier than the work is not a warm-up');
  assert.ok(sets[1].reps <= 3, 'and it costs almost nothing in reps');
  assert.ok(sets[0].weight < sets[1].weight, 'they ramp upwards');
  assert.ok(sets[0].reps > sets[1].reps, 'with reps coming down as weight goes up');
  for (const s of sets) {
    assert.equal(platePlan(s.weight, 20, 'kg').exact, true, `${s.weight} kg cannot be loaded`);
  }
});

test('one set on a machine, three only for heavy low-rep barbell work', () => {
  const machine = { name: 'Machine Chest Press', equipment: 'Machine', primary: ['chest'] };
  assert.equal(warmupCount(machine, { targetReps: 10 }), 1);
  assert.equal(warmupCount(BENCH, { targetReps: 10 }), 2);
  // Keine der beiden Studien hat schwere Einzelwiederholungen abgedeckt. Dieser Zweig bleibt
  // also beim Üblichen, und die Oberfläche sagt, zu welcher Hälfte des Rats er gehört.
  assert.equal(warmupCount(BENCH, { targetReps: 3 }), 3);
});

test('a muscle that has already worked today needs less introduction, or none', () => {
  const machine = { name: 'Butterfly', equipment: 'Machine', primary: ['chest'] };
  const warmed = new Set(['chest']);
  assert.deepEqual(warmupSets(machine, 60, { units: 'kg', targetReps: 12, warmedRegions: warmed }), [],
    'a pec deck after chest work does not need its own ramp');
  assert.equal(warmupSets(machine, 60, { units: 'kg', targetReps: 12 }).length, 1);
  // Die Stange behält einen Satz, weil die Last ist, was sie ist.
  assert.equal(warmupSets(BENCH, 100, { units: 'kg', barWeight: 20, targetReps: 8, warmedRegions: warmed }).length, 1);
  assert.equal(alreadyWarm(machine, warmed), true);
  assert.equal(alreadyWarm(machine, new Set(['quads'])), false);
  assert.equal(alreadyWarm(machine, null), false);
});

test('warm-up sets refuse when there is nothing to ramp towards', () => {
  assert.deepEqual(warmupSets(BENCH, 0), []);
  assert.deepEqual(warmupSets(BENCH, null), []);
  // Ein Arbeitsgewicht auf oder unter der leeren Stange lässt nichts Sinnvolles übrig.
  assert.deepEqual(warmupSets(BENCH, 20, { units: 'kg', barWeight: 20 }), []);
});

test('warm-up sets do not repeat the same weight twice', () => {
  // Leichte Kurzhantelarbeit rundet beide Schritte auf dieselbe Zahl.
  const sets = warmupSets({ name: 'Lateral Raise', equipment: 'Dumbbell' }, 8, { units: 'kg', targetReps: 4 });
  const weights = sets.map((s) => s.weight);
  assert.equal(new Set(weights).size, weights.length);
});

/* ===================== was als Nächstes aufgelegt wird ===================== */

/** Eine Reihe von Einheiten, in denen diese Übung zuerst kam und nichts davor. */
const solo = (weights, { reps = 8, rir = null, from = at(2026, 6, 1) } = {}) =>
  weights.map((w, i) => session(from + i * 7 * 86400000,
    [entry(BENCH.id, [set(w, reps, { rir }), set(w, reps - 1, { rir }), set(w, reps - 2, { rir })])]));

test('the first working set decides, not the ones that fatigue took', () => {
  // Acht, sieben, sechs mit demselben Gewicht gegen ein Ziel von 6-10. Die alte Regel wollte,
  // dass jeder Satz zehn schafft, und hat dieses Gewicht deshalb für immer empfohlen.
  const rows = exerciseHistory(solo([100], { reps: 10 }).reverse(), BENCH.id, byId);
  const tip = openingSet(rows, { exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20 });
  assert.equal(tip.change, 'up');
  assert.ok(tip.weight > 100);
  assert.equal(tip.reasons[0].key, 'clearedFirstSet');
});

test('a ramp across the working sets is judged on the set it opened with', () => {
  // 100 x 10, dann 110 x 6, dann 110 x 5, gegen ein Ziel von 6-10. Die Wiederholungen, die das
  // Ziel geschafft haben, gab es bei 100, die Empfehlung muss also aus 100 gebaut werden und
  // nicht aus dem schwersten Satz des Tages.
  const ramp = [session(at(2026, 7, 1), [entry(BENCH.id, [set(100, 10), set(110, 6), set(110, 5)])])];
  const rows = exerciseHistory(ramp, BENCH.id, byId);
  assert.equal(rows[0].openingWeight, 100);
  assert.equal(rows[0].topWeight, 110);

  const tip = openingSet(rows, { exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20 });
  assert.equal(tip.fromWeight, 100);
  assert.ok(tip.weight <= 100 + loadStep(BENCH, 'kg') * 3,
    `${tip.weight} is more than three steps off the opening set`);
});

/* --- die Familie "gleiches Gewicht, weniger Wiederholungen" --- */

test('holding a weight asks for more reps than last time, never fewer', () => {
  // Die Beschwerde, für die es diese ganze Familie gibt: 135 x 8 eingetragen, und die App kam
  // mit "bleib bei 135 x 6" zurück. Zwei Wiederholungen unter dem, was gerade geschafft war,
  // als Rat gedruckt.
  const rows = exerciseHistory(solo([135], { reps: 8 }).reverse(), BENCH.id, byId);
  const tip = openingSet(rows, { exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20 });
  assert.equal(tip.change, 'hold');
  assert.equal(tip.weight, 135);
  assert.equal(tip.reps, 9, 'double progression asks for one more rep, not one fewer');
});

test('landing exactly on the bottom of the range is not a reason to back off', () => {
  // 135 x 8 gegen ein Ziel von 8-12 kam früher als "zurück auf 130 x 8" zurück: die
  // Wiederholung, die die Gleitkommazahl verloren hat, legte die Schätzung unter den Bereich,
  // und zwischen "unter dem Bereich" und "Gewicht runter" gab es keinen Puffer.
  const rows = exerciseHistory(solo([135], { reps: 8 }).reverse(), BENCH.id, byId);
  const tip = openingSet(rows, { exercise: BENCH, targetReps: '8-12', units: 'kg', barWeight: 20 });
  assert.equal(tip.change, 'hold');
  assert.equal(tip.weight, 135);
});

test('a fresh session is never told to do less than it already did', () => {
  // Die Regel, nicht ein Beispiel dafür. Epley vorwärts und zurück landet nicht, wo es
  // angefangen hat (135 x 8 kommt als 170.99999999999997 heraus), ein floor hat also bei jedem
  // Gewicht, jeder Wiederholungszahl und jedem Bereich eine Wiederholung in Luft aufgelöst.
  for (const reps of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    for (const [low, high] of [[3, 5], [5, 8], [6, 10], [8, 12], [10, 15]]) {
      const rows = exerciseHistory(solo([135], { reps }).reverse(), BENCH.id, byId);
      const tip = openingSet(rows, {
        exercise: BENCH, targetReps: `${low}-${high}`, units: 'kg', barWeight: 20,
      });
      if (tip.change !== 'hold') continue;
      assert.ok(tip.reps >= Math.min(reps, high),
        `held ${135} kg after ${reps} reps and asked for ${tip.reps} (range ${low}-${high})`);
    }
  }
});

test('work done earlier in the session costs reps, not kilos', () => {
  const fly = exercise('ex_fly', 'Butterfly', ['chest']);
  const both = new Map([[BENCH.id, BENCH], [fly.id, fly]]);
  const past = [session(at(2026, 7, 1), [entry(BENCH.id, [set(135, 8), set(135, 7)])])];
  const rows = exerciseHistory(past, BENCH.id, both);

  const tired = openingSet(rows, {
    exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20,
    prior: priorWork([entry(fly.id, [set(50, 12), set(50, 12), set(50, 12)]),
      entry(BENCH.id, [])], 1, both),
  });
  // Drei Sätze Flys sind ein paar Prozent, also etwa eine Wiederholung. Das ist kein Grund,
  // die Stange zu verändern, und "135 x 8 -> 130 x 7" war genau der Vorschlag, der für
  // niemanden Sinn ergab, der ihn gelesen hat.
  assert.equal(tired.change, 'hold');
  assert.equal(tired.weight, 135);
  assert.ok(tired.reps < 9, 'and the rep target carries the cost instead');
  assert.equal(tired.reasons[0].key, 'holdTired');
});

test('a step back needs a real gap, and has to actually buy a lighter bar', () => {
  // Acht Sätze Brust vorher: über dem Puffer, das Gewicht bewegt sich also.
  const fly = exercise('ex_fly', 'Butterfly', ['chest']);
  const both = new Map([[BENCH.id, BENCH], [fly.id, fly]]);
  const past = [session(at(2026, 7, 1), [entry(BENCH.id, [set(135, 6)])])];
  const rows = exerciseHistory(past, BENCH.id, both);
  const buried = openingSet(rows, {
    exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20,
    prior: priorWork([entry(fly.id, Array.from({ length: 8 }, () => set(50, 12))),
      entry(BENCH.id, [])], 1, both),
  });
  assert.equal(buried.change, 'down');
  assert.ok(buried.weight < 135);
  assert.ok(buried.reasons[0].params.from === 135, 'and it names the weight it is stepping off');
});

test('a pull-up that clears the range is told to do more, not fewer', () => {
  // Der schlechteste Vorschlag, den die App je gemacht hat: zehn Klimmzüge gegen ein Ziel
  // von 6-10 kamen als "Ziel 6" zurück. Die Berechnung war im Zweig für mehr Gewicht, hatte
  // dem KÖRPERGEWICHT einen Schritt draufgelegt und ehrlich gemeldet, was ein Körper mit 90 kg
  // an Wiederholungen schafft.
  const pull = { ...exercise('ex_pull', 'Pull-Up', ['lats']), equipment: 'Bodyweight' };
  const byPull = new Map([[pull.id, pull]]);
  const run = (reps) => {
    const sets = [{ ...set(0, reps), systemWeight: 82 }];
    const rows = exerciseHistory([session(at(2026, 7, 1), [entry(pull.id, sets)])], pull.id, byPull);
    return openingSet(rows, { exercise: pull, targetReps: '6-10', units: 'kg', barWeight: 20 });
  };
  for (const reps of [8, 9, 10, 12]) {
    const tip = run(reps);
    assert.equal(tip.change, 'hold', 'there is no load to add to a pull-up');
    assert.equal(tip.weight, 82, 'and no increment to round a bodyweight onto');
    assert.ok(tip.reps > reps, `did ${reps} pull-ups and was asked for ${tip.reps}`);
  }
  assert.equal(run(12).reasons[0].key, 'bodyweightClimb');
});

test('a weight increase reports the reps it will actually buy', () => {
  // 60 x 10 gegen ein festes Ziel von 10 hat früher "hoch: 65 x 10" gedruckt, und das
  // behauptet die Steigerung und die Wiederholungen in einem Atemzug.
  const rows = exerciseHistory(solo([60], { reps: 10 }).reverse(), BENCH.id, byId);
  const tip = openingSet(rows, { exercise: BENCH, targetReps: '10', units: 'kg', barWeight: 20 });
  assert.equal(tip.change, 'up');
  assert.ok(tip.weight > 60);
  assert.ok(tip.reps < 10, 'a heavier bar buys fewer reps; that is what makes it heavier');
});

test('an increase is capped as a share of the load, not only in increments', () => {
  // Drei Schritte an der Kurzhantel sind 6 kg, das sind 60 % einer 10-kg-Hantel.
  const db = { ...exercise('ex_curl', 'Dumbbell Curl', ['biceps']), equipment: 'Dumbbell' };
  const sessions = [session(at(2026, 7, 1), [entry(db.id, [set(10, 14, { rir: 4 })])])];
  const rows = exerciseHistory(sessions, db.id, new Map([[db.id, db]]));
  const tip = openingSet(rows, { exercise: db, targetReps: '8-12', units: 'kg' });
  assert.equal(tip.change, 'up');
  assert.ok(tip.weight <= 12, `${tip.weight} kg is more than a step off a 10 kg bell`);
});

test('rep progression never moves the load, however tired the day is', () => {
  const fly = exercise('ex_fly', 'Butterfly', ['chest']);
  const both = new Map([[BENCH.id, BENCH], [fly.id, fly]]);
  const past = [session(at(2026, 7, 1), [entry(BENCH.id, [set(100, 8)])])];
  const rows = exerciseHistory(past, BENCH.id, both);
  const tip = openingSet(rows, {
    exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20, rule: 'reps',
    prior: priorWork([entry(fly.id, Array.from({ length: 6 }, () => set(50, 12))),
      entry(BENCH.id, [])], 1, both),
  });
  assert.equal(tip.change, 'hold');
  assert.equal(tip.weight, 100, 'the one rule that exists to not change the weight changed it');
});

/* --- die Einstellung "im Wiederholungsbereich bleiben" --- */

test('with the range setting on, a fading set loses weight instead of reps', () => {
  const rows = exerciseHistory(solo([135], { reps: 8 }).reverse(), BENCH.id, byId);
  const opts = (keepInRange) => ({
    exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20, keepInRange,
  });

  let off = [set(135, 8, { rir: 0 })];
  let on = [set(135, 8, { rir: 0 })];
  const seen = { off: [], on: [] };
  for (let n = 2; n <= 6; n++) {
    const a = nextSet(off, rows, opts(false));
    const b = nextSet(on, rows, opts(true));
    seen.off.push(a.reps);
    seen.on.push(b.reps);
    off = [...off, set(a.weight, a.reps, { rir: 0 })];
    on = [...on, set(b.weight, b.reps, { rir: 0 })];
  }
  // Ohne die Einstellung bleibt die Last auf der Stange, und die Wiederholungen schwinden.
  // Das machen Sätze nun mal, und deshalb ist es der Standard.
  assert.ok(Math.min(...seen.off) < 6, `default never dipped under the range: ${seen.off}`);
  // Mit der Bitte, den Bereich einzuhalten, bleibt jeder Satz darin.
  assert.ok(seen.on.every((r) => r >= 6), `range setting let a set through at ${seen.on}`);
});

test('the range setting only moves the bar when a step actually fixes it', () => {
  const rows = exerciseHistory(solo([135], { reps: 8 }).reverse(), BENCH.id, byId);
  const opts = { exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20, keepInRange: true };
  // Satz zwei liegt locker im Bereich, es soll sich also nichts bewegen.
  const second = nextSet([set(135, 8, { rir: 0 })], rows, opts);
  assert.equal(second.change, 'hold');
  assert.equal(second.weight, 135);
});

test('the range setting reaches the range on an opening set too', () => {
  const fly = exercise('ex_fly', 'Butterfly', ['chest']);
  const both = new Map([[BENCH.id, BENCH], [fly.id, fly]]);
  const rows = exerciseHistory([session(at(2026, 7, 1), [entry(BENCH.id, [set(135, 8)])])], BENCH.id, both);
  const prior = priorWork([entry(fly.id, Array.from({ length: 5 }, () => set(50, 12))),
    entry(BENCH.id, [])], 1, both, { live: true });
  const base = { exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20, prior };

  const loose = openingSet(rows, base);
  const strict = openingSet(rows, { ...base, keepInRange: true });
  // Locker hält die Last und sagt, dass die Wiederholungen knapp werden, streng nimmt Gewicht
  // runter, bis das untere Ende des Bereichs wieder erreichbar ist. Beides ist ehrlich, deshalb
  // ist das eine Einstellung und keine Reparatur.
  assert.equal(loose.change, 'hold');
  assert.ok(loose.reps < 6);
  assert.equal(strict.change, 'down');
  assert.ok(strict.weight < 135);
  assert.ok(strict.reps >= 6, `strict landed on ${strict.reps} reps`);
});

test('the live advice tracks a real set-to-set fade rather than falling off a cliff', () => {
  const rows = exerciseHistory(solo([135], { reps: 8 }).reverse(), BENCH.id, byId);
  const opts = { exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20 };
  const two = nextSet([set(135, 8, { rir: 0 })], rows, opts);
  const three = nextSet([set(135, 8, { rir: 0 }), set(135, 7, { rir: 0 })], rows, opts);
  assert.equal(two.reps, 7);
  assert.equal(three.reps, 6, '8-7-6 is what a set of three looks like, not 8-6-4');
});

test('the live advice reads a ramp off the heaviest set, not the first one', () => {
  const rows = exerciseHistory(solo([100], { reps: 8 }).reverse(), BENCH.id, byId);
  const ramped = nextSet([set(60, 10, { rir: 4 }), set(100, 8, { rir: 0 })], rows,
    { exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20 });
  assert.ok(ramped.reps >= 5, `estimated ${ramped.reps} reps at 100 kg off a 60 kg opener`);
});

test('a later set that still has reps in the tank earns the weight, not just set one', () => {
  const rows = exerciseHistory(solo([100], { reps: 8 }).reverse(), BENCH.id, byId);
  const late = nextSet([set(100, 8, { rir: 0 }), set(100, 12, { rir: 3 })], rows,
    { exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20 });
  assert.equal(late.change, 'up');
  assert.equal(late.reason.key, 'setTooLight');
});

test('a first set short of the target holds the weight', () => {
  const rows = exerciseHistory(solo([100], { reps: 7 }).reverse(), BENCH.id, byId);
  const tip = openingSet(rows, { exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20 });
  assert.equal(tip.change, 'hold');
  assert.equal(tip.weight, 100);
});

test('reps left in reserve are counted before a weight is refused', () => {
  // Sieben Wiederholungen mit drei in Reserve sind ein Satz mit zehn, der früher aufgehört hat.
  const rows = exerciseHistory(solo([100], { reps: 7, rir: 3 }).reverse(), BENCH.id, byId);
  const tip = openingSet(rows, { exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20 });
  assert.ok(tip.weight > 100, 'a set with three in reserve did not earn a repeat');
});

test('an exercise moved later in the session is not read as a regression', () => {
  const fly = exercise('ex_fly', 'Butterfly', ['chest']);
  const both = new Map([[BENCH.id, BENCH], [fly.id, fly]]);

  // Letztes Mal: Bankdrücken zuerst. Heute: drei Sätze Flys kamen vorher.
  const past = [session(at(2026, 7, 1), [entry(BENCH.id, [set(100, 8), set(100, 7)])])];
  const rows = exerciseHistory(past, BENCH.id, both);
  assert.equal(rows[0].readiness, 1, 'nothing came before it, so nothing is taken off');

  const fresh = openingSet(rows, { exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20 });
  const tired = openingSet(rows, {
    exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20,
    prior: priorWork(
      [entry(fly.id, [set(50, 12), set(50, 12), set(50, 12)]), entry(BENCH.id, [])], 1, both
    ),
  });
  assert.ok(tired.weight <= fresh.weight, 'the tired version never asks for more');
  assert.equal(tired.orderAware, true);
  assert.ok(tired.reasons.some((r) => r.key === 'later'), 'and it says why');
});

/* --- die Anordnung auf dem Screen, so wie sie gerade ist --- */

test('a finished session counts only what was ticked off above the exercise', () => {
  const fly = exercise('ex_fly', 'Butterfly', ['chest']);
  const both = new Map([[BENCH.id, BENCH], [fly.id, fly]]);
  const entries = [
    entry(fly.id, [set(50, 12), set(50, 12), { ...set(50, 12), done: false }]),
    entry(BENCH.id, [set(100, 8)]),
  ];
  // Die Aufzeichnung ist die Aufzeichnung: zwei Sätze Flys sind passiert, der dritte nicht.
  const past = priorWork(entries, 1, both);
  assert.equal(past.same, 2);
  assert.equal(past.planned, 0);
});

test('a live session counts the work still sitting above the exercise', () => {
  const fly = exercise('ex_fly', 'Butterfly', ['chest']);
  const both = new Map([[BENCH.id, BENCH], [fly.id, fly]]);
  const blank = { weight: null, reps: null, rir: null, type: 'working', done: false };
  const entries = [entry(fly.id, [blank, blank, blank]), entry(BENCH.id, [blank])];

  // Noch nichts ist abgehakt, die Regel nach Position sah also ein Bankdrücken als Erstes am
  // Morgen und hat drei Sätze später ihre Meinung geändert.
  assert.equal(priorWork(entries, 1, both).same, 0);
  const live = priorWork(entries, 1, both, { live: true });
  assert.equal(live.same, 3);
  assert.equal(live.planned, 3, 'and it knows none of it has happened yet');
});

test('moving an exercise up changes its advice on the spot', () => {
  const fly = exercise('ex_fly', 'Butterfly', ['chest']);
  const both = new Map([[BENCH.id, BENCH], [fly.id, fly]]);
  const blank = { weight: null, reps: null, rir: null, type: 'working', done: false };
  const flyEntry = entry(fly.id, [blank, blank, blank, blank, blank, blank]);
  const benchEntry = entry(BENCH.id, [blank]);
  const rows = exerciseHistory([session(at(2026, 7, 1), [entry(BENCH.id, [set(135, 8)])])], BENCH.id, both);
  const advise = (entries, index) => openingSet(rows, {
    exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20,
    prior: priorWork(entries, index, both, { live: true }),
  });

  const buried = advise([flyEntry, benchEntry], 1);
  const first = advise([benchEntry, flyEntry], 0);
  assert.ok(buried.reps < first.reps, 'the same exercise, two positions, one answer');
  assert.equal(first.reps, 9);
  // Und die verschobene sagt, welche Sätze sie zählt und dass die noch vor ihr liegen.
  assert.equal(buried.reasons.find((r) => r.key.startsWith('later'))?.key, 'laterPlanned');
});

test('work already ticked off counts wherever it sits on the list', () => {
  const fly = exercise('ex_fly', 'Butterfly', ['chest']);
  const both = new Map([[BENCH.id, BENCH], [fly.id, fly]]);
  const blank = { weight: null, reps: null, rir: null, type: 'working', done: false };
  // Bankdrücken steht zuerst auf der Liste, aber die Flys darunter sind schon gemacht: man
  // hat außer der Reihe trainiert, weil die Bank besetzt war.
  const entries = [entry(BENCH.id, [blank]), entry(fly.id, [set(50, 12), set(50, 12), set(50, 12)])];
  const live = priorWork(entries, 0, both, { live: true });
  assert.equal(live.same, 3, 'three sets of chest work happened, whatever the order says');
  assert.equal(live.planned, 0, 'and every one of them is a fact, not a plan');
});

test('an exercise nobody has started has not warmed anything up', () => {
  const fly = exercise('ex_fly', 'Butterfly', ['chest']);
  const both = new Map([[BENCH.id, BENCH], [fly.id, fly]]);
  const blank = { weight: null, reps: null, rir: null, type: 'working', done: false };
  const cold = priorWork([entry(fly.id, [blank, blank]), entry(BENCH.id, [blank])], 1, both, { live: true });
  assert.equal(cold.warmedRegions.has('chest'), false,
    'the warm-up offer would have skipped a warm-up for work not yet done');
  const warm = priorWork([entry(fly.id, [set(50, 12)]), entry(BENCH.id, [blank])], 1, both, { live: true });
  assert.equal(warm.warmedRegions.has('chest'), true);
});

test('priorWork separates same-muscle work from everything else', () => {
  const fly = exercise('ex_fly', 'Butterfly', ['chest']);
  const curl = exercise('ex_curl', 'Machine Biceps Curl', ['biceps']);
  const all = new Map([[BENCH.id, BENCH], [fly.id, fly], [curl.id, curl]]);
  const entries = [
    entry(fly.id, [set(50, 12), set(50, 12)]),
    entry(curl.id, [set(30, 12), set(30, 12), set(30, 12)]),
    entry(BENCH.id, []),
  ];
  const prior = priorWork(entries, 2, all);
  assert.equal(prior.same, 2, 'the flyes hit the same muscle');
  assert.equal(prior.other, 3, 'the curls did not');
  assert.ok(prior.warmedRegions.has('chest'));
  assert.ok(readiness(prior) < 1 && readiness(prior) > 0.9);
  assert.equal(readiness({ same: 0, other: 0 }), 1);
});

test('the order cost is pooled across exercises when one cannot answer alone', () => {
  // Drei Brustübungen, abwechselnd an erster, zweiter und dritter Stelle, und jede ein bisschen
  // leichter, je später sie kommt. Keine einzelne Übung hat genug Einheiten an jeder Position,
  // um zu antworten, zusammen schon.
  const a = exercise('ex_a', 'Barbell Bench Press', ['chest']);
  const b = exercise('ex_b', 'Incline Barbell Bench Press', ['chest']);
  const c = exercise('ex_c', 'Machine Chest Press', ['chest']);
  const all = new Map([[a.id, a], [b.id, b], [c.id, c]]);
  const four = (w) => [set(w, 8), set(w, 8), set(w, 8), set(w, 8)];

  const sessions = [];
  for (let i = 0; i < 6; i++) {
    const order = [[a, b, c], [b, c, a], [c, a, b]][i % 3];
    sessions.push(session(at(2026, 6, 1) + i * 7 * 86400000,
      order.map((ex, place) => entry(ex.id, four(100 - place * 6)))));
  }

  const pooled = pooledOrderCost(sessions, all);
  assert.ok(pooled, 'six sessions across three exercises is enough to measure something');
  assert.ok(pooled.same > 0 && pooled.same <= 0.04, `cost per set was ${pooled?.same}`);
  assert.equal(pooled.measured, true);

  // Und es erreicht eine Übung, die ihre eigenen Kosten nicht messen kann.
  const flat = [session(at(2026, 7, 1), [entry(a.id, [set(100, 8)])])];
  assert.equal(exerciseHistory(flat, a.id, all).orderCost, null);
  assert.equal(exerciseHistory(flat, a.id, all, { fallbackCost: pooled }).orderCost, pooled);

  assert.equal(pooledOrderCost([], all), null);
});

test('a climbing trend is projected forward, and never off a cliff', () => {
  const rows = exerciseHistory(solo([90, 95, 100, 105]).reverse(), BENCH.id, byId);
  const projected = projectFresh(rows, at(2026, 6, 29));
  assert.ok(projected.slope > 0);
  const last = rows[rows.length - 1].freshE1rm;
  assert.ok(projected.value > last, 'the trend counts for something');
  assert.ok(projected.value <= last * 1.05, 'but never for more than 5%');
});

test('the set-to-set drop-off is measured from the lifter, not assumed', () => {
  const assumed = setDecay([]);
  assert.equal(assumed.measured, false);
  const rows = exerciseHistory(solo([100, 100, 100]).reverse(), BENCH.id, byId);
  const measured = setDecay(rows);
  assert.equal(measured.measured, true);
  assert.ok(measured.value > 0 && measured.value < 0.12);
});

test('after one set today the advice comes from today', () => {
  const rows = exerciseHistory(solo([100, 100, 100]).reverse(), BENCH.id, byId);
  const opener = [set(100, 10, { rir: 3 })];
  const advice = nextSet(opener, rows, { exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20 });
  assert.equal(advice.setNumber, 2);
  assert.equal(advice.change, 'up', 'ten reps with three in reserve is not the right weight');
  assert.ok(advice.weight > 100);

  // Dass die Wiederholungen von Satz zu Satz nachlassen, machen Sätze nun mal. Ein zweiter Satz,
  // knapp unter dem Bereich vorhergesagt, behält das Gewicht, statt es zu senken. Das ist die
  // ganze Beschwerde über die alte Regel zwischen den Einheiten, nur nach drinnen verlegt.
  const fading = nextSet([set(100, 8, { rir: 0 })], rows,
    { exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20 });
  assert.equal(fading.change, 'hold');
  assert.equal(fading.weight, 100);

  // Ein Schritt runter wird nur angeboten, wenn er wirklich Wiederholungen zurückbringt.
  const wall = nextSet([set(100, 3, { rir: 0 })], rows,
    { exercise: BENCH, targetReps: '8-12', units: 'kg', barWeight: 20 });
  assert.equal(wall.change, 'down');
  assert.ok(wall.weight <= 95);
  assert.equal(nextSet([], rows, { exercise: BENCH }), null);
});

test('a machine with a five-kilo stack is never asked for 102.5', () => {
  const machine = { id: 'ex_press', name: 'Machine Chest Press', equipment: 'Machine', primary: ['chest'] };
  assert.equal(loadStep(machine, 'kg'), 5, 'the default is still the default');
  assert.equal(loadStep(machine, 'kg', 5), 5);
  assert.equal(roundLoad(103, machine, { units: 'kg', step: 5 }), 105);
  assert.equal(roundLoad(101, machine, { units: 'kg', step: 5 }), 100);

  const sessions = [session(at(2026, 7, 1), [entry(machine.id, [set(80, 10), set(80, 9)])])];
  const rows = exerciseHistory(sessions, machine.id, new Map([[machine.id, machine]]));
  const tip = openingSet(rows, { exercise: machine, targetReps: '6-10', units: 'kg', step: 5 });
  assert.equal(tip.weight % 5, 0, `${tip.weight} is not on the stack`);

  // Und das Aufwärmen landet auf denselben Stiften.
  for (const w of warmupSets(machine, 100, { units: 'kg', targetReps: 8, step: 5 })) {
    assert.equal(w.weight % 5, 0, `${w.weight} is not on the stack`);
  }
});

test('a barbell still gets real plates, not a rounded increment', () => {
  assert.equal(roundLoad(101, BENCH, { units: 'kg', barWeight: 20 }), 100);
});

/* ===================== woraus eine Schätzung gebaut werden darf ===================== */

test('the rank prefers sets a 1RM estimate is valid for', () => {
  const machine = { id: 'ex_ext', name: 'Leg Extension' };
  const byName = new Map([[machine.id, machine]]);
  const sessions = [session(at(2026, 7, 1), [entry(machine.id, [set(60, 20), set(90, 8)])])];
  const best = bestOneRepMaxByName(sessions, byName, { bodyweight: 80 });
  // Der Satz mit zwanzig schätzt höher (60 x 20 = 100 gegen 90 x 8 = 114) ... tut er nicht, und
  // genau darum geht es: das Fenster entscheidet, nicht die größere Zahl.
  assert.equal(Math.round(best.get('Leg Extension')), Math.round(e1rm(90, 8)));
  assert.equal(best.extrapolated.size, 0);
  assert.equal(withinE1rmWindow({ reps: 20 }), false);
  assert.equal(withinE1rmWindow({ reps: 12 }), true);
});

test('a lift only ever trained above the window is ranked, and marked', () => {
  const machine = { id: 'ex_ext', name: 'Leg Extension' };
  const byName = new Map([[machine.id, machine]]);
  const sessions = [session(at(2026, 7, 1), [entry(machine.id, [set(60, 20)])])];
  const best = bestOneRepMaxByName(sessions, byName, { bodyweight: 80 });
  assert.ok(best.get('Leg Extension') > 0, 'a blank would be worse than a caveat');
  assert.ok(best.extrapolated.has('Leg Extension'));

  const profile = { sex: 'male', bodyweight: 80, age: 25 };
  const rating = buildRating(best, profile, { machineNames: new Set(['Leg Extension']) });
  assert.equal(rating.lifts[0].extrapolated, true);
  assert.equal(rating.regions.quads.extrapolated, true);
  // Dieselbe Übung auf zwei Screens mit einem Rang. Der Abschlag wurde früher in die Wertung der
  // Region hineinmultipliziert, eine Übung auf Diamond I stand damit auf der Muskelkarte als
  // Diamond III, ohne dass etwas den Abstand erklärt hat. Unsicherheit über eine Messung ist
  // kein Beleg für Schwäche.
  assert.equal(rating.regions.quads.score, rating.lifts[0].score,
    'the body map and the lift list disagreed about the same lift');
  assert.ok(rating.regions.quads.confidence < 1,
    'and the doubt is carried as a confidence, not baked into the rank');
  // Weniger zählt sie im Durchschnitt, und das ist eine Aussage über den ganzen Menschen, die
  // ihre Belege gewichten darf.
  assert.ok(rating.overall < rating.regions.quads.score
    || rating.ratedRegions > 1);
});

test('the overall weighs a region by how well it is measured', () => {
  const profile = { sex: 'male', bodyweight: 80, age: 25 };
  const both = new Map([['Barbell Bench Press', 120], ['Leg Extension', 90]]);
  const solid = buildRating(both, profile, { machineNames: new Set(['Leg Extension']) });
  const shaky = buildRating(both, profile, {
    machineNames: new Set(['Leg Extension']), extrapolated: new Set(['Leg Extension']),
  });
  // Der Beinstrecker ist die schwächere der beiden. Ihm weniger zu trauen muss den Durchschnitt
  // ZUR Übung ziehen, der getraut wird, und nicht von ihr weg.
  assert.ok(solid.regions.quads.score < solid.regions.chest.score);
  assert.ok(shaky.overall > solid.overall,
    'a doubted weak region dragged the average down as hard as a certain one');
  assert.equal(shaky.regions.quads.score, solid.regions.quads.score,
    'and the doubt did not move the rank it shows');
});

test('a blank RIR is unknown, not a set taken to failure', () => {
  // 8 Wiederholungen gegen ein Ziel von 6-10 und nichts in der RIR-Spalte. Als Versagen gelesen
  // heißt das halten, mit der Reserve gelesen, die dieser Mensch immer lässt, heißt es mehr
  // Gewicht, und für alle mit ausgeschalteter Spalte ist das der Unterschied bei jeder Einheit.
  const rows = exerciseHistory(solo([100], { reps: 8 }).reverse(), BENCH.id, byId);
  const strict = openingSet(rows, { exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20 });
  assert.equal(strict.change, 'hold');

  const assumed = exerciseHistory(solo([100], { reps: 8 }).reverse(), BENCH.id, byId, { assumedRir: 2 });
  const tip = openingSet(assumed, {
    exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20, assumedRir: 2,
  });
  assert.equal(tip.change, 'up');
  // Und es sagt, dass die Reserve angenommen und nicht eingetragen war.
  assert.equal(tip.reasons[0].key, 'assumedFirstSet');
  assert.ok(tip.reasons.some((r) => r.key === 'noRir'));

  // Eine eingetragene Reserve behält die ehrliche Formulierung.
  const logged = exerciseHistory(solo([100], { reps: 8, rir: 2 }).reverse(), BENCH.id, byId);
  assert.equal(openingSet(logged, { exercise: BENCH, targetReps: '6-10', units: 'kg' }).reasons[0].key,
    'easyFirstSet');
});

test('the assumption cannot be turned into a lever', () => {
  const rows = exerciseHistory(solo([100], { reps: 8 }).reverse(), BENCH.id, byId, { assumedRir: 99 });
  const wild = openingSet(rows, {
    exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20, assumedRir: 99,
  });
  // Bei vier in Reserve gedeckelt, und die Steigerung bleibt auf drei Schritte begrenzt.
  const step = loadStep(BENCH, 'kg');
  assert.ok(wild.weight <= 100 + step * 3, `${wild.weight} is not a bounded suggestion`);
});

test('the same curl ranks whether the load is on a cable or on a bar', () => {
  const profile = { sex: 'male', bodyweight: 80, age: 28 };
  const stack = buildRating(new Map([['Machine Biceps Curl', 55]]), profile,
    { machineNames: new Set(['Machine Biceps Curl']) });
  const bar = buildRating(new Map([['Wide-Grip Standing Barbell Curl', 55]]), profile, {});

  // Die Version mit Stange hat früher gar nichts bekommen: die Bewertbarkeit hing am Gerät, und
  // "Barbell" stand nicht auf der Liste.
  assert.ok(bar.regions.biceps, 'a barbell curl left the biceps unranked');
  assert.ok(stack.regions.biceps);
  // Ein freies Gewicht ist keine Maschine, egal aus welcher Tabelle sein Standard kommt.
  assert.equal(bar.lifts[0].machine, false, 'a barbell curl would show under machine records');
  assert.ok(bar.regions.biceps.confidence < 1, 'a derived standard is trusted less');
  assert.equal(bar.regions.biceps.score, bar.lifts[0].score,
    'and the doubt weighs the average, it does not move the rank');
  // Das nächste Ziel muss aus derselben Tabelle kommen wie die Wertung. Es aus den
  // veröffentlichten Tabellen zu lesen fand nichts und druckte "oberes Ende der Leiter" bei
  // einer Übung mit noch sechs Rängen darüber.
  assert.ok(bar.lifts[0].nextDivision, 'a mid-ladder curl was told it had finished');
  assert.ok(bar.lifts[0].nextDivision.weight > 55);
});

test('Home and the Progress line admit exactly the same lifts', () => {
  // Die Regel stand in drei Kopien von Hand und war schon auseinandergelaufen. Freie Gewichte in
  // eine davon aufzunehmen hätte die zwei Screens auseinandergerissen.
  const curl = { ...exercise('ex_curl', 'Wide-Grip Standing Barbell Curl', ['biceps']), equipment: 'Barbell' };
  const machine = { ...exercise('ex_ext', 'Leg Extension', ['quads']), equipment: 'Machine' };
  const junk = { ...exercise('ex_junk', 'Ball Wall Circles', ['delts-front']), equipment: 'Other' };
  const all = [BENCH, curl, machine, junk];
  const names = ratedMachineNames(all);
  assert.deepEqual(all.map((ex) => isRateable(ex.name, names)), [true, true, true, false]);
});

test('the barbell curl ladder lands where the published standard does', () => {
  const profile = { sex: 'male', bodyweight: 80, age: 28 };
  const at = (kg) => rankOf(scoreForMachine('Barbell Curl', kg, profile)).tier.key;
  // Elite ist bei jemandem, der stark ist, knapp unter dem Körpergewicht, ein Curl mit 30 kg
  // ist ein Anfängercurl. Über den eigenen Faktor des Maschinencurls lag das Elite-Band bei
  // 107 kg, weil ein Exzenter hilft und eine Stange nicht.
  assert.equal(at(30), 'gold');
  assert.equal(at(60), 'master');
  assert.equal(at(77), 'legend');
});

test('gaining weight does not earn a better pull-up rank', () => {
  // Die Last beim Klimmzug IST der Mensch, der allometrische Nenner hat das Körpergewicht also
  // auf beiden Seiten gezählt, und die haben sich nicht aufgehoben: ohne Zusatzgewicht blieb
  // (bw / 80) ^ 0.33, eine Zahl, die an nichts hängt als der Waage im Bad. Eine Wiederholung
  // bei 70 kg war Silver I, dieselbe bei 100 kg Gold II. Drei Stufen fürs Essen.
  const at = (bw) => rankOf(scoreFor('Pull-Up', bw, { sex: 'male', bodyweight: bw, age: 28 })).step;
  const steps = [60, 70, 80, 90, 100, 120].map(at);
  assert.equal(new Set(steps).size, 1, `one pull-up ranked ${steps} across bodyweights`);

  // Und eine Langhantelübung bewegt sich weiter in die andere Richtung, das ist die Gegenprobe.
  const bench = (bw) => rankOf(scoreFor('Barbell Bench Press', 100, { sex: 'male', bodyweight: bw, age: 28 })).step;
  assert.ok(bench(70) > bench(100), 'the same bench got easier for a heavier lifter');
});

test('a weighted pull-up is worth more to a lighter lifter', () => {
  // 40 kg am Gürtel sind der Großteil eines kleinen Menschen und ein Drittel eines großen, und
  // der Rang muss das sagen.
  const rank = (bw) => rankOf(scoreFor('Weighted Pull-Up', bw + 40,
    { sex: 'male', bodyweight: bw, age: 28 })).step;
  assert.ok(rank(60) > rank(90), 'the same belt weighed the same at any size');
});

test('an unknown leg machine is not ranked against a triceps standard', () => {
  assert.equal(machineCategory('Ai Fitness Leg Blaster'), 'lowerIsolation');
  assert.equal(machineCategory('Glute Machine 3000'), 'lowerIsolation');
  assert.equal(machineCategory('Some Ab Crunch Thing'), 'core');
  assert.equal(machineCategory('Unnamed Arm Contraption'), 'upperIsolation');
  // Die benannten Kategorien gewinnen weiter vor dem Rückfall.
  assert.equal(machineCategory('Leg Press'), 'lowerPress');
});

test('every caveat the rating shows is a translatable key', () => {
  for (const value of Object.values(LOW_CONFIDENCE)) {
    assert.match(value, /^[a-z][\w.]+$/, `${value} looks like prose, not a key`);
  }
});

test('every rank has a badge, and the badges only ever gain', () => {
  assert.equal(BADGE_PARTS.length, TIERS.length, 'one badge per rank, no gaps');

  // Die Leiter muss sich wie eine Leiter lesen: ein Rang verliert nie eine Verzierung, die der
  // darunter hatte. Die Winkel fangen einmal neu an, wenn der Edelstein kommt. Das ist die eine
  // bewusste Ausnahme, und sie wird geprüft und nicht zufällig erlaubt.
  const gemAt = BADGE_PARTS.findIndex((p) => p.gem);
  assert.ok(gemAt > 0);
  for (let i = 1; i < BADGE_PARTS.length; i++) {
    const prev = BADGE_PARTS[i - 1], here = BADGE_PARTS[i];
    if (i !== gemAt) assert.ok(here.chevrons >= prev.chevrons, `rank ${i} lost a chevron`);
    assert.ok(here.stars >= prev.stars || here.wings, `rank ${i} lost a star for nothing`);
    for (const key of ['gem', 'wings', 'crown']) {
      assert.ok(!prev[key] || here[key], `rank ${i} lost its ${key}`);
    }
  }
  // Und der oberste Rang hat alles, was es gibt, Licht eingeschlossen.
  const top = BADGE_PARTS[BADGE_PARTS.length - 1];
  assert.ok(top.gem && top.wings && top.crown && top.chevrons === 3);
  assert.ok(top.halo && top.flare && top.aura, 'the end of the ladder looks like it');
  // Unten ist es schlicht, aber nicht leer.
  assert.equal(BADGE_PARTS[0].stud, true);
});

test('a lift standing ranks clear of the rest is questioned, not corrected', () => {
  const profile = { sex: 'male', bodyweight: 82, age: 24 };
  const machines = new Set(['Machine Lateral Raise']);
  // 70 kg für 12 an einem 85-kg-Block, als beide Seiten auf einmal eingetragen: 140 kg, das ergibt
  // geschätzt etwa 187. Das kann die Maschine nicht, und genau diese Form soll das hier erwischen.
  const best = new Map([
    ['Barbell Bench Press', 144], ['Back Squat', 198], ['Deadlift', 232],
    ['Overhead Press', 84], ['Machine Lateral Raise', 187],
  ]);

  const flagged = buildRating(best, profile, { machineNames: machines });
  const raise = flagged.lifts.find((l) => l.name === 'Machine Lateral Raise');
  assert.ok(raise.outlier, 'a machine several ranks clear of everything else is worth a question');
  assert.ok(raise.outlier.ranks >= 2);
  // Und sonst nichts: verglichen wird mit dem Median der anderen, jemand wirklich Starkes bekommt
  // also keine fünf Warnungen.
  assert.equal(flagged.lifts.filter((l) => l.outlier).length, 1);

  // Die Lösung liest die Zahl anders. Sie fasst das Log nicht an, und der Aufrufer gibt weiter
  // dieselbe Schätzung hinein.
  const halved = buildRating(best, profile, {
    machineNames: machines, loadFactors: { 'Machine Lateral Raise': 0.5 },
  });
  const fixed = halved.lifts.find((l) => l.name === 'Machine Lateral Raise');
  assert.equal(fixed.corrected, true);
  assert.ok(fixed.score < raise.score - 20, 'and it actually moves the rank');
  assert.ok(fixed.rank.tierIndex < raise.rank.tierIndex, 'by whole ranks, not decimals');
  assert.equal(fixed.outlier, undefined, 'once corrected it is in line with the rest');
  assert.equal(best.get('Machine Lateral Raise'), 187, 'the estimate itself is untouched');
});

test('a full stack lands where the two-tier rule says it should', () => {
  // Die Regel, an der die Maschinenanker eingestellt sind, geprüft gegen das Studio, aus dem sie
  // kommt. Sie hat zwei Stufen, und beide Hälften werden geprüft, weil die Teilung der ganze
  // Punkt ist: ein Block an einer Isolationsmaschine ist großzügig im Verhältnis zur Kraft, die
  // er wirklich verlangt, weil dasselbe 135-kg-Gestell für Beinpresse und Beinstrecker herhalten muss.
  const profile = { sex: 'male', bodyweight: 82, age: 24 };

  // Mehrgelenksmaschinen: ein voller Block für etwa zehn Wiederholungen ist Legend.
  const compound = {
    'Machine Chest Press': 135, 'Machine Row': 135, 'Seated Cable Row': 135,
    'Machine Shoulder Press': 105, 'Butterfly': 105, 'Machine Rear Delt Fly': 105,
    'Standing Calf Raise': 187, 'Machine Hip Adduction': 105, 'Machine Crunch': 105,
  };
  for (const [name, stack] of Object.entries(compound)) {
    const rank = rankOf(scoreForMachine(name, e1rm(stack, 10), profile));
    assert.equal(rank.tier.key, 'legend', `${name}: a full stack came out ${rank.tier.key}`);
  }

  // Eingelenkige Maschinen brauchen für denselben Rang etwa 1,6 Blöcke. Eine auszureizen ist ein
  // starker Rang und nicht der veröffentlichte Elite-Standard.
  const isolation = {
    'Leg Extension': 135, 'Seated Leg Curl': 135, 'Machine Lateral Raise': 85,
    'Triceps Pushdown': 85, 'Overhead Rope Triceps Extension': 135, 'Machine Preacher Curl': 85,
  };
  for (const [name, stack] of Object.entries(isolation)) {
    const maxed = rankOf(scoreForMachine(name, e1rm(stack, 10), profile));
    assert.ok(maxed.tierIndex < TIERS.findIndex((t) => t.key === 'legend'),
      `${name}: maxing an isolation stack should not reach Legend, got ${maxed.tier.key}`);
    assert.ok(maxed.tierIndex >= TIERS.findIndex((t) => t.key === 'grandmaster'),
      `${name}: but it is still a hard thing to do, got ${maxed.tier.key}`);
  }
});

test('one lifter\'s machines agree with their own barbell lifts', () => {
  // Die zweite Einstell-Runde, als Test behalten, weil sie die einzige Prüfung ist, dass die
  // Maschinentabelle einen Menschen beschreibt und keine Tabellenkalkulation. Das sind echte
  // Arbeitssätze einer Person. Innerhalb eines Muskels darf eine Maschine nicht mehr als etwa
  // anderthalb Ränge von dem entfernt landen, was diese Person mit einer Stange schafft.
  const profile = { sex: 'male', bodyweight: 82, age: 24 };
  const score = (name, weight, reps) => {
    const est = e1rm(weight, reps);
    return isBenchmark(name) ? scoreFor(name, est, profile) : scoreForMachine(name, est, profile);
  };
  const groups = {
    chest: [score('Smith Machine Incline Bench Press', 110, 8), score('Machine Chest Press', 125, 8),
      score('Butterfly', 90, 9)],
    back: [score('Lat Pulldown', 85, 9), score('Seated Cable Row', 105, 8)],
    shoulders: [score('Machine Shoulder Press', 85, 8), score('Machine Lateral Raise', 80, 7)],
    legs: [score('Back Squat', 120, 6), score('Leg Extension', 135, 7)],
  };
  for (const [group, scores] of Object.entries(groups)) {
    const spread = (Math.max(...scores) - Math.min(...scores)) / BAND;
    assert.ok(spread <= 1.5, `${group}: ${spread.toFixed(1)} ranks apart within one muscle`);
  }
});

test('a Legend curl is not the same weight as a Legend pushdown', () => {
  // Die Regel mit dem Block allein behandelt jede Maschine an einem 85-kg-Block als dieselbe
  // Leistung. Ist sie nicht: derselbe Block hing an Trizepsdrücken und Scottcurls, die Tabelle
  // behauptete also, Legend beim Curl und beim Trizepsdrücken seien beide 134 kg, ein Gewicht,
  // das praktisch niemand curlt.
  const profile = { sex: 'male', bodyweight: 82, age: 24, units: 'kg' };
  const legend = (name) => weightForRatio(boundsFor(name, profile, { machine: true })[7], profile);
  const push = legend('Triceps Pushdown');
  const curl = legend('Machine Preacher Curl');
  assert.ok(curl < push * 0.95, `curl asks ${Math.round(curl)} against a pushdown's ${Math.round(push)}`);
  assert.ok(curl > push * 0.7, 'but not so much less that curling becomes the easy route to a rank');

  // Der Hammergriff liegt zwischen den beiden, genau da, wo die Hände wirklich sind.
  const hammer = legend('Rope Hammer Curl');
  assert.ok(hammer > curl && hammer <= push);
});

test('an unrecognised machine lands in a category that fits the movement', () => {
  // machineCategory hat früher alles Unbekannte zu upperIsolation geschickt, Kreuzheben an der
  // Multipresse wurde also gegen einen Trizeps-Bereich eingestuft. Das ist kein Rundungsfehler,
  // das sind drei Ränge.
  const cases = {
    'Smith Machine Dead Lifts': 'hip',
    'Smith Machine Good Mornings': 'hip',
    'Lying Machine Squat': 'lowerPress',
    'Machine Lunge': 'lowerPress',
    'Leverage Shrug': 'upperPull',
    'Reverse Machine Flyes': 'upperIsolation',
    'Some Unnamed Chest Press': 'upperPress',
    'Leg Press': 'lowerPress',
    'Ab Crunch Machine': 'core',
  };
  for (const [name, expected] of Object.entries(cases)) {
    assert.equal(machineCategory(name), expected, name);
  }
});

test('an unrecognised machine is never an easier route than a recognised one', () => {
  // Die Rückfallbereiche und die Maschinen mit Anker müssen im Gleichschritt bleiben. Waren sie
  // einmal nicht: die Isolationsmaschinen mit Anker wurden strenger und diese Tabelle blieb
  // zurück, die 63 Bewegungen ohne Anker waren also das Weichste in der App, und ein voller
  // Kabelturm beim Handgelenkcurl kam als Radiant heraus.
  const profile = { sex: 'male', bodyweight: 82, age: 24 };
  const legendOf = (name) => weightForRatio(boundsFor(name, profile, { machine: true })[7], profile);

  const pairs = [
    ['upperIsolation', 'Machine Lateral Raise', 'Triceps Pushdown'],
    ['upperPress', 'Machine Chest Press', 'Machine Shoulder Press'],
    ['upperPull', 'Seated Cable Row', 'Machine Row'],
    ['core', 'Machine Crunch'],
  ];
  for (const [category, ...anchored] of pairs) {
    // Ein Name, zu dem nichts passt, in die Kategorie gelenkt, die geprüft wird.
    const unknown = { upperIsolation: 'Zzz Unknown Contraption', upperPress: 'Zzz Unknown Chest Press',
      upperPull: 'Zzz Unknown Row', core: 'Zzz Unknown Crunch' }[category];
    assert.equal(machineCategory(unknown), category, `${unknown} should land in ${category}`);
    const fallback = legendOf(unknown);
    for (const name of anchored) {
      assert.ok(fallback >= legendOf(name) * 0.8,
        `${category}: the fallback asks ${Math.round(fallback)} kg where ${name} asks ${Math.round(legendOf(name))}`);
    }
  }
});

test('a full cable tower is not a top rank on a wrist curl', () => {
  // Unterarme bewegen viel Gewicht über fast keinen Weg, die Zahl am Block ist hier also so
  // unehrlich wie nirgends sonst im Studio.
  const profile = { sex: 'male', bodyweight: 82, age: 24 };
  const maxed = rankOf(scoreForMachine('Cable Wrist Curl', e1rm(85, 12), profile));
  assert.ok(maxed.tierIndex < TIERS.findIndex((t) => t.key === 'legend'),
    `maxing a tower on wrist curls came out ${maxed.tier.key}`);
  assert.equal(canonical('Seated Two-Arm Palms-Up Low-Pulley Wrist Curl'), 'Cable Wrist Curl');
  assert.ok(ANATOMY['Cable Wrist Curl'].forearms, 'and it reaches the forearms on the map');
});

test('an estimate beyond what the stack can produce says so', () => {
  const profile = { sex: 'male', bodyweight: 82, age: 24 };
  const best = new Map([['Machine Lateral Raise', 187]]);
  const rating = buildRating(best, profile, {
    machineNames: new Set(['Machine Lateral Raise']),
    stackMax: { 'Machine Lateral Raise': 85 },
  });
  const lift = rating.lifts[0];
  assert.ok(lift.overStack, '187 kg out of an 85 kg stack is not a thing that happened');
  assert.ok(lift.overStack.times > 1.6);

  // Eine Zahl, die die Maschine wirklich schaffen kann, löst nichts aus.
  const fine = buildRating(new Map([['Machine Lateral Raise', 95]]), profile, {
    machineNames: new Set(['Machine Lateral Raise']),
    stackMax: { 'Machine Lateral Raise': 85 },
  });
  assert.equal(fine.lifts[0].overStack, null);
});

test('too few lifts to compare means no outlier at all', () => {
  const profile = { sex: 'male', bodyweight: 82, age: 24 };
  const rating = buildRating(new Map([['Machine Lateral Raise', 187], ['Back Squat', 100]]), profile,
    { machineNames: new Set(['Machine Lateral Raise']) });
  assert.equal(rating.lifts.filter((l) => l.outlier).length, 0,
    'two lifts cannot tell an outlier from a preference');
});

test('a rank remembers when its best was actually set', () => {
  const exercises = new Map([[BENCH.id, BENCH]]);
  const long = at(2024, 3, 1), recent = at(2026, 7, 1);
  const best = bestOneRepMaxByName([
    session(long, [entry(BENCH.id, [set(140, 5)])]),
    session(recent, [entry(BENCH.id, [set(100, 5)])]),
  ], exercises, { bodyweight: 80 });
  assert.equal(best.achievedAt.get('Barbell Bench Press'), long, 'the record is the old set');

  const rating = buildRating(best, { sex: 'male', bodyweight: 80, age: 25 });
  assert.equal(rating.lifts[0].achievedAt, long,
    'and the date travels with it, so the screen can say how old it is');
});

test('a rep target written as sets times reps is not read as a range', () => {
  // "3x8" sind drei Sätze mit acht. Als Bereich gelesen wird daraus 3 bis 8, die Berechnung
  // hält einen Satz mit drei dann für das Erreichen des unteren Endes und verteilt dafür mehr Gewicht.
  assert.deepEqual(parseReps('3x8'), { low: 8, high: 8 });
  assert.deepEqual(parseReps('4 × 10'), { low: 10, high: 10 });
  assert.deepEqual(parseReps('3x8-12'), { low: 8, high: 12 });
  // Ein echter Bereich ist weiterhin ein Bereich.
  assert.deepEqual(parseReps('8-12'), { low: 8, high: 12 });
  assert.deepEqual(parseReps('12'), { low: 12, high: 12 });
  assert.equal(parseReps('AMRAP'), null);
  assert.equal(parseReps('0-0'), null, 'zero reps is not a target, it is a typo');
});

test('a suggestion never prints reps the weight cannot carry', () => {
  // Nach einer schweren Einzelwiederholung ist die alte Version einen Schritt runtergegangen und
  // hat die Wiederholungen dann in den Bereich hochgedrückt, aus 200 kg einmal wurde "197,5 kg ×
  // 6". Das Gewicht muss sich weit genug bewegen, um den Bereich zu erreichen, und gedruckt
  // werden muss, was die Rechnung vorhersagt.
  const single = [session(at(2026, 7, 1), [entry(BENCH.id, [set(200, 1)])])];
  const rows = exerciseHistory(single, BENCH.id, byId);
  const tip = openingSet(rows, { exercise: BENCH, targetReps: '6-10', units: 'kg', barWeight: 20 });
  assert.equal(tip.change, 'down');
  assert.ok(tip.weight < 200 * 0.9, `${tip.weight} kg is still a single, not a set of six`);
  assert.ok(tip.reps >= 5 && tip.reps <= 10);

  // Vorhergesagte Wiederholungen und vorhergesagtes Gewicht müssen zusammenpassen: Epley auf den
  // Vorschlag muss in dem Bereich landen, auf den er angeblich zielt.
  const implied = tip.weight * (1 + (tip.reps + 1) / 30);
  assert.ok(Math.abs(implied - tip.capacity) / tip.capacity < 0.08,
    `${tip.weight} × ${tip.reps} implies ${implied.toFixed(0)} against a capacity of ${tip.capacity.toFixed(0)}`);
});

test('a manual exercise is never given a number it did not ask for', () => {
  const rows = exerciseHistory(solo([100]).reverse(), BENCH.id, byId);
  assert.equal(openingSet(rows, { exercise: BENCH, rule: 'manual' }), null);
  assert.equal(openingSet([], { exercise: BENCH }), null);
});

/* ===================== geht es noch voran ===================== */

/**
 * n Einheiten einer Übung, eine pro Woche, mit gleicher oder steigender Last.
 *
 * Um `STALL_NOW` geht es. `movers` misst von einem Zeitpunkt rückwärts, und diese Testdaten
 * hängen an einem festen Datum. Mit der echten Uhr als Zeitpunkt rutschten die Einheiten mit
 * der Zeit aus dem Fenster von sechs Wochen, und beide Tests unten fielen Ende August 2026
 * von selbst um, genau der Fehler, vor dem der Kopf dieser Datei warnt. Die Uhr steht fest
 * neben den Daten, mit denen sie übereinstimmen muss.
 */
const STALL_NOW = at(2026, 7, 29);

function series(exercise, { weeks, from, step }) {
  const out = [];
  for (let i = 0; i < weeks; i++) {
    const t = at(2026, 7, 28) - (weeks - 1 - i) * 7 * 86400000;
    out.push(session(t, [entry(exercise.id, [set(from + i * step, 8)])]));
  }
  return out;
}

test('stallReport says nothing without enough lifts to compare', () => {
  const only = series(BENCH, { weeks: 6, from: 80, step: 2.5 });
  assert.equal(stallReport(only, byId, { now: STALL_NOW }), null, 'one lift is not a picture');
});

test('stallReport separates climbing lifts from stalled ones', () => {
  const squat = exercise('ex_squat', 'Back Squat', ['quads']);
  const row = exercise('ex_row', 'Barbell Row', ['lats']);
  const all = new Map([[BENCH.id, BENCH], [squat.id, squat], [row.id, row]]);

  const sessions = [
    ...series(BENCH, { weeks: 6, from: 80, step: 2.5 }),   // steigend
    ...series(squat, { weeks: 6, from: 100, step: 0 }),    // flach
    ...series(row, { weeks: 6, from: 70, step: -1 }),      // fallend
  ];

  const report = stallReport(sessions, all, { now: STALL_NOW });
  assert.equal(report.tracked, 3);
  assert.equal(report.stalled, 2, 'flat and falling both count as not gaining');
  assert.equal(report.falling, 1);
  assert.ok(report.names.includes('Barbell Row'));
  assert.ok(!report.names.includes('Barbell Bench Press'));
});

test('describeStall reports and never prescribes', () => {
  const squat = exercise('ex_squat', 'Back Squat', ['quads']);
  const row = exercise('ex_row', 'Barbell Row', ['lats']);
  const all = new Map([[BENCH.id, BENCH], [squat.id, squat], [row.id, row]]);
  const sessions = [
    ...series(BENCH, { weeks: 6, from: 80, step: 0 }),
    ...series(squat, { weeks: 6, from: 100, step: 0 }),
    ...series(row, { weeks: 6, from: 70, step: 0 }),
  ];

  const report = stallReport(sessions, all, { now: STALL_NOW });

  // Beide Sprachen, weil es in der Regel darum geht, was die App sagen darf, und nicht, in welcher
  // Tabelle der Satz steht. Eine deutsche Übersetzung, in die ein "solltest" gerutscht ist,
  // bricht das Versprechen genauso wie ein englisches "you should".
  const BANNED = {
    en: ['deload', 'should', 'need to', 'take a', 'too much', 'overtrain'],
    de: ['deload', 'solltest', 'musst', 'zu viel', 'übertrain', 'leg eine', 'nimm dir'],
  };

  for (const lang of ['en', 'de']) {
    setLanguage(lang);
    const text = describeStall(report).join(' ').toLowerCase();
    assert.ok(text.includes('3'), `${lang}: the count has to survive translation`);
    for (const word of BANNED[lang]) {
      assert.ok(!text.includes(word), `${lang}: the observation must not say "${word}"`);
    }
  }
  setLanguage('en');
});

test('a week boundary is a calendar week, not seven times 86400000', () => {
  // In Europe/Berlin wird am Sonntag, 29. März 2026, die Uhr vorgestellt, die Woche ab Montag,
  // 23., hat also 167 Stunden. Feste sieben Tage in Millisekunden auf ihren Anfang zu rechnen
  // landet am Montag, 30., um 1 Uhr, und alles, was in dieser ersten Stunde der nächsten Woche
  // eingetragen wird, zählt in dieser.
  //
  // Das ist das dritte Mal, dass diese App über Wochenrechnung in festen Millisekunden stolpert.
  // Die ersten zwei sind erst Monate später aufgefallen, bei einer Zeitumstellung.
  const now = new Date(2026, 3, 10, 12).getTime();        // 10. April 2026
  const mondayAfter = new Date(2026, 2, 30, 0, 30).getTime();  // Mo 30. März, 00:30

  const { weeks } = timeline(
    { bodyweight: [{ id: 'b', date: mondayAfter, weight: 80 }] },
    { weeks: 4, now },
  );

  const dstWeek = weeks.find((w) => new Date(w.week).getDate() === 23
    && new Date(w.week).getMonth() === 2);
  assert.ok(dstWeek, 'the week of 23 March is in the window');
  assert.equal(dstWeek.bodyweight, null,
    'a weigh-in on the Monday belongs to the Monday, not to the week before it');

  const ownWeek = weeks.find((w) => new Date(w.week).getDate() === 30
    && new Date(w.week).getMonth() === 2);
  assert.equal(ownWeek.bodyweight, 80, 'and it does land in its own week');
});

/* ============ was eine Wiederherstellung nicht zerstören darf ============ */

test('the device key store is not in the list a restore wipes', () => {
  // Eine Wiederherstellung leert jeden Store und schreibt die Sicherung hinein. `keys` enthält die
  // Identität des Geräts für die Cloud-Sicherung, und die steht in keiner Sicherung. Sie zu leeren
  // hat aus "aus der Cloud wiederherstellen" ein "dieses Gerät aus der Cloud aussperren" gemacht:
  // es kam als Fremder zurück und konnte den Datenschlüssel nicht mehr auspacken, mit dem es den
  // Download gerade gelesen hatte.
  const wiped = Object.values(STORES).filter((store) => store !== STORES.keys);

  assert.ok(STORES.keys, 'the store exists');
  assert.ok(!wiped.includes(STORES.keys), 'and a restore leaves it alone');
  assert.ok(wiped.includes(STORES.sessions), 'while still clearing the log itself');
  assert.equal(wiped.length, Object.values(STORES).length - 1, 'exactly one exception');
});

/* ============ die zwei Körpergewichte der App ============ */

test('macro targets refuse to answer without a protein band', () => {
  // Erreichbar: der Bedarf kommt aus dem Wiegelog, der Eiweißbereich aus dem Profil, und nur das
  // Profilformular schreibt beides. Wer sich im Fortschritt-Screen wiegt und das Profil nie
  // öffnet, hat ein Paar, das sich widerspricht. Hier ok:true zurückzugeben hat dem Screen einen
  // Eiweißbereich null gegeben, von dem er `.low` lesen sollte, und die Kohlenhydrate haben still
  // den ganzen Anteil vom Eiweiß geschluckt.
  const maintenance = { ok: true, maintenance: 2400 };
  const targets = macroTargets({ units: 'kg', goal: 'hold' }, maintenance);

  assert.equal(targets.ok, false, 'no bodyweight means no protein band means no chain');
  assert.equal(targets.protein, null);
  assert.ok(targets.reason, 'and it says which part is missing');
});

test('macro targets still answer once the bodyweight is there', () => {
  const targets = macroTargets({ units: 'kg', goal: 'hold', bodyweight: 82 },
    { ok: true, maintenance: 2400 });
  assert.equal(targets.ok, true);
  assert.ok(targets.protein.low > 0 && targets.carbs.high > 0);
});

test('latestWeight is the newest weigh-in, whatever order the log is in', () => {
  const log = [
    { id: 'a', date: 1000, weight: 80 },
    { id: 'c', date: 3000, weight: 84 },
    { id: 'b', date: 2000, weight: 82 },
  ];
  assert.equal(latestWeight(log), 84);
  // Ein zurückdatierter Eintrag darf nicht "dein Gewicht jetzt" werden.
  assert.equal(latestWeight([...log, { id: 'old', date: 500, weight: 70 }]), 84);
  assert.equal(latestWeight([]), null);
});

/* ================= Essen neben dem Training ================= */

/** `n` Tage zurück von `at`, als der Tagesschlüssel, unter dem Mahlzeiten gespeichert sind. */
/**
 * Ein fester Sonntag, damit fünf aufeinanderfolgende Tage davor in einer ISO-Woche landen.
 *
 * Diese Tests liefen früher mit Date.now(), sie waren also von Donnerstag bis Sonntag grün und
 * von Montag bis Mittwoch rot: fünf Tage zurück von einem Dienstag legen zwei in eine Woche und
 * drei in die davor, und MIN_LOGGED_DAYS ist vier. Genau der Datumsfehler, den diese Datei
 * abfangen soll, in dieser Datei.
 */
const TIMELINE_NOW = at(2026, 8, 16);

function dayBack(n, at = Date.now()) {
  const d = new Date(at);
  d.setDate(d.getDate() - n);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dayMeal = (day, kcal, protein) => ({
  day, kcal, protein, carbs: 40, fat: 10, fibre: 3, amount: 1, micros: {},
});

test('a week without enough logged days reports no intake, not a zero', () => {
  // Drei Tage in der neuesten Woche, einer weniger als festgelegt. An einem Mittwoch
  // festgemacht, damit das auch dann eine Woche bleibt, wenn die Tests an einem Sonntag oder
  // Montag laufen.
  const now = new Date('2026-08-12T12:00:00').getTime();
  const meals = [0, 1, 2].map((i) => dayMeal(dayBack(i, now), 2000, 150));
  const { weeks } = timeline({ meals }, { weeks: 2, now });
  const last = weeks[weeks.length - 1];

  assert.equal(last.loggedDays, 3, 'the days themselves are still counted');
  assert.equal(last.intake, null, 'three days is below the floor, so there is no average');
  assert.ok(MIN_LOGGED_DAYS > 3, 'this test only means anything while the floor is above three');
});

test('an intake average counts only the days that carry the value', () => {
  // Fünf eingetragene Tage, zwei davon ganz ohne Kalorien. Die als null mitzurechnen würde für
  // eine Woche mit 2000 kcal 1200 kcal melden.
  const meals = [
    dayMeal(dayBack(0, TIMELINE_NOW), 2000, 150),
    dayMeal(dayBack(1, TIMELINE_NOW), 2000, 150),
    dayMeal(dayBack(2, TIMELINE_NOW), 2000, 150),
    dayMeal(dayBack(3, TIMELINE_NOW), 0, 150),
    dayMeal(dayBack(4, TIMELINE_NOW), 0, 150),
  ];
  const { weeks } = timeline({ meals }, { weeks: 3, now: TIMELINE_NOW });
  const withIntake = weeks.filter((w) => w.intake);
  const total = withIntake.reduce((n, w) => n + w.intake.kcal, 0) / withIntake.length;

  assert.ok(withIntake.length >= 1, 'five days clears the floor');
  assert.equal(Math.round(total), 2000, 'the days without calories are unknown, not zero');
});

test('bodyweight is only reported for weeks you actually weighed', () => {
  const now = Date.now();
  const meals = [0, 1, 2, 3, 4].map((i) => dayMeal(dayBack(i), 2200, 160));
  // Absichtlich in einer älteren Woche: ein Wiegen in der neuesten Woche lässt sich in nichts
  // weiterziehen, Testdaten dieser Art würden also genau gegen den Fehler bestehen, für den es
  // diesen Test gibt.
  const bodyweight = [{ id: 'b1', date: now - 16 * 86400000, weight: 82 }];

  const { weeks } = timeline({ meals, bodyweight }, { weeks: 4 });
  const weighed = weeks.filter((w) => w.bodyweight !== null);

  assert.equal(weighed.length, 1, 'one weigh-in shows up in exactly one week, not in every week after it');
  assert.equal(weighed[0].bodyweight, 82);
  assert.equal(weighed[0].weighIns, 1);
  assert.equal(weeks[weeks.length - 1].bodyweight, null,
    'the newest week did not weigh, so it stays empty rather than repeating 82');
});

test('training and eating land in the same week buckets', () => {
  const now = TIMELINE_NOW;
  const meals = [0, 1, 2, 3, 4].map((i) => dayMeal(dayBack(i, now), 2200, 160));
  const sessions = [{
    id: 's1', startedAt: now - 86400000, finishedAt: now - 86400000 + 3600000,
    entries: [{ exerciseId: 'ex', sets: [{ weight: 100, reps: 5, done: true, type: 'working' }] }],
  }];

  const { weeks } = timeline({ sessions, meals }, { weeks: 4, now });
  const trained = weeks.filter((w) => w.sets > 0);
  const ate = weeks.filter((w) => w.intake);

  assert.equal(trained.length, 1);
  assert.ok(ate.length >= 1);
  assert.equal(trained[0].week, ate[ate.length - 1].week,
    'a session and the meals from the same days share one bucket');
});

test('the timeline waits for a second week rather than drawing one point', () => {
  const oneWeek = [0, 1, 2, 3, 4].map((i) => dayMeal(dayBack(i, TIMELINE_NOW), 2200, 160));
  assert.equal(timelineReady(timeline({ meals: oneWeek }, { weeks: 4, now: TIMELINE_NOW })), false);

  const twoWeeks = [...oneWeek, ...[7, 8, 9, 10, 11].map((i) => dayMeal(dayBack(i, TIMELINE_NOW), 2200, 160))];
  assert.equal(timelineReady(timeline({ meals: twoWeeks }, { weeks: 4, now: TIMELINE_NOW })), true);
});

/* ======================= einen Plan teilen ======================= */

test('a plan survives the round trip through a link', async () => {
  const plan = {
    name: 'PPL', perWeek: 1, repTarget: '6-10',
    days: [
      // Wochentag 0 ist Sonntag und darf nicht als "kein Tag gesetzt" gelesen werden.
      { id: 'd1', name: 'Push', weekday: 0, items: [{ exerciseId: BENCH.id, targetSets: 3, targetReps: '6-10' }] },
      { id: 'd2', name: 'Pull', weekday: null, items: [] },
    ],
  };
  const url = await planLink(plan, byId, 'https://example.test/');
  const decoded = await decodeLink(url.split('#/share/')[1]);

  assert.equal(decoded.ok, true);
  assert.equal(decoded.plan.name, 'PPL');
  assert.equal(decoded.plan.days[0].weekday, 0, 'Sunday survived');
  assert.equal(decoded.plan.days[1].weekday, null);
  assert.equal(decoded.plan.days[0].items[0].name, 'Barbell Bench Press');
  assert.equal(decoded.plan.days[0].items[0].sets, 3);
});

test('a damaged link is a message, not a crash', async () => {
  for (const code of ['', 'zzz', 'qnot-base64']) {
    const res = await decodeLink(code);
    assert.equal(res.ok, false);
    assert.ok(res.detail.length > 0);
  }
});

test('import resolves by name and reports what is missing', () => {
  const shared = { days: [{ items: [{ name: 'barbell bench press' }, { name: 'Cable Fly' }] }] };
  const { matched, missing } = resolveAgainstLibrary(shared, [BENCH]);
  assert.equal(matched.length, 1, 'case and spacing must not matter');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].name, 'Cable Fly');
});

/* ===================== was die Karte behaupten darf ===================== */

const PROFILE = { sex: 'male', age: 30, bodyweight: 82, showRatings: true };
const CARD_INPUT = (over = {}) => ({
  sessions: [session(at(2026, 7, 28), [entry(BENCH.id, [set(100, 5)])])],
  exerciseById: byId,
  settings: PROFILE,
  bodyweight: [{ id: 'b', date: at(2026, 7, 1), weight: 82 }],
  plan: null,
  units: 'kg',
  weekStart: startOfWeek(at(2026, 7, 28)),
  mapMode: 'strength',
  ...over,
});

test('the card shows a score when the app would', () => {
  const s = weekSummary(CARD_INPUT());
  assert.ok(s.strength, 'a benchmark lift and a profile is all it needs');
  assert.equal(s.mapMode, 'strength');
  assert.equal(s.strengthMissing, null);
});

test('the card hides the score exactly when the app hides it', () => {
  for (const settings of [
    { ...PROFILE, showRatings: false },
    { ...PROFILE, sex: null },
    { ...PROFILE, bodyweight: null },
  ]) {
    const s = weekSummary(CARD_INPUT({ settings }));
    assert.equal(s.strength, null);
    assert.ok(s.strengthMissing, 'and says which of the reasons it is');
    assert.equal(s.mapMode, 'progress', 'no tier map without a rating behind it');
  }
});

test('a movement logged for the first time is not a personal best', () => {
  const s = weekSummary(CARD_INPUT());
  assert.deepEqual(s.bests, [], 'week one is not a wall of records');
});

test('beating your own best is', () => {
  const s = weekSummary(CARD_INPUT({
    sessions: [
      session(at(2026, 7, 20), [entry(BENCH.id, [set(90, 5)])]),
      session(at(2026, 7, 28), [entry(BENCH.id, [set(100, 5)])]),
    ],
  }));
  assert.equal(s.bests.length, 1);
  assert.equal(s.bests[0].name, 'Barbell Bench Press');
  assert.ok(s.bests[0].to > s.bests[0].from);
});

test('the score delta matches the two numbers a reader can compare', () => {
  // Gerundet gedruckt, die Differenz ist also die der gerundeten Werte. Sonst steht auf einer
  // Karte "29" neben "keine Änderung" und daneben die "28" von letzter Woche.
  const sessions = [
    session(at(2026, 7, 20), [entry(BENCH.id, [set(100, 5)])]),
    session(at(2026, 7, 28), [entry(BENCH.id, [set(130, 5)])]),
  ];
  const thisWeek = weekSummary(CARD_INPUT({ sessions }));
  const lastWeek = weekSummary(CARD_INPUT({ sessions, weekStart: startOfWeek(at(2026, 7, 20)) }));
  assert.equal(
    thisWeek.strength.delta,
    Math.round(thisWeek.strength.score) - Math.round(lastWeek.strength.score)
  );
});

test('the card reports a bodyweight move, because the score is relative to it', () => {
  const s = weekSummary(CARD_INPUT({
    bodyweight: [
      { id: 'a', date: at(2026, 7, 20), weight: 82 },
      { id: 'b', date: at(2026, 7, 30), weight: 84 },
    ],
  }));
  assert.equal(s.bodyweightShift, 2);
});

test('the strength history buckets by calendar week, not by fixed milliseconds', () => {
  // Dieselbe Zeitumstellung wie im Test zur Zeitleiste: die Woche ab Montag, 23. März 2026, hat
  // in Europe/Berlin 167 Stunden. `week + 7 * 86400000` landet also am Montag, 30., um 1 Uhr, und
  // eine Einheit in dieser ersten Stunde der neuen Woche wurde der Woche davor gutgeschrieben.
  const mondayAfter = new Date(2026, 2, 30, 0, 30).getTime();
  const sessions = [session(mondayAfter, [entry(BENCH.id, [set(140, 5)])])];
  const bw = [{ id: 'b', date: new Date(2026, 0, 5).getTime(), weight: 82 }];

  const history = strengthHistory(sessions, bw, PROFILE, byId, 4, new Date(2026, 3, 10, 12).getTime());
  const dstWeek = history.find((h) => new Date(h.week).getMonth() === 2
    && new Date(h.week).getDate() === 23);

  assert.equal(dstWeek, undefined,
    'the week of 23 March saw no lifting, so it gets no score');
  assert.ok(history.some((h) => new Date(h.week).getDate() === 30),
    'the session counts from the week it actually happened in');
});

test('strengthAt is the score as it stood then, not as it stands now', () => {
  const sessions = [
    session(at(2026, 7, 20), [entry(BENCH.id, [set(100, 5)])]),
    session(at(2026, 7, 28), [entry(BENCH.id, [set(140, 5)])]),
  ];
  const bw = [{ id: 'b', date: at(2026, 7, 1), weight: 82 }];
  const before = strengthAt(sessions, bw, PROFILE, byId, at(2026, 7, 26));
  const after = strengthAt(sessions, bw, PROFILE, byId, at(2026, 7, 30));
  assert.ok(after.overall > before.overall);

  // Kumulativ: eine Woche Pause macht gezeigte Stärke nicht rückgängig.
  const later = strengthAt(sessions, bw, PROFILE, byId, at(2026, 9, 1));
  assert.equal(later.overall, after.overall);
});


/* ===================== wo ein Rang in der Bevölkerung liegt ===================== */

test('the ladder reads back to the percentiles its standards were written at', () => {
  // Keine Vorliebe. Diese vier bedeuten, was die veröffentlichten Tabellen meinen: Anfänger ist
  // das 20. Perzentil der Leute, die trainieren und mitschreiben, Fortgeschritten das 50., Weit
  // fortgeschritten das 80., Elite das 95. `ladder()` legt sie auf Gold, Diamond, Grandmaster
  // und Legend, diese vier Ränge müssen also unverändert zurückgelesen werden, sonst beschreibt
  // das Perzentil eine andere Tabelle als die, mit der die App einstuft.
  const at = (step) => percentiles(BAND * step).lifters * 100;
  assert.ok(Math.abs(at(2) - 20) < 0.5, `Gold read back as ${at(2)}`);
  assert.ok(Math.abs(at(4) - 50) < 0.5, `Diamond read back as ${at(4)}`);
  assert.ok(Math.abs(at(6) - 80) < 0.5, `Grandmaster read back as ${at(6)}`);
  assert.ok(Math.abs(at(8) - 95) < 0.5, `Legend read back as ${at(8)}`);
});

test('both population readings climb with the rank and never invert', () => {
  let lastWorld = -1, lastLifters = -1;
  for (let score = 0; score <= 100; score += 0.5) {
    const p = percentiles(score);
    assert.ok(p.world >= lastWorld, `world fell at ${score}`);
    assert.ok(p.lifters >= lastLifters, `lifters fell at ${score}`);
    // Der ganze Sinn der zweiten Zahl: die Welt ist immer freundlicher als der Raum, weil der
    // größte Teil der Welt nicht im Raum ist.
    assert.ok(p.world >= p.lifters, `world below lifters at ${score}`);
    lastWorld = p.world; lastLifters = p.lifters;
  }
  assert.ok(percentiles(100).world < 1, 'nothing is the whole population');
  assert.equal(percentiles(null), null);
});

test('the top of the ladder is still a slice somebody can read', () => {
  // Die vier Ränge über Grandmaster runden alle auf 99 oder 100 Prozent, wer drei ganze Ränge
  // aufsteigt, sähe die Zahl stillstehen. Dort oben muss sich die Scheibe weiterbewegen.
  const legend = topSlice(percentiles(BAND * 8).lifters);
  const radiant = topSlice(percentiles(BAND * 11).lifters);
  assert.equal(legend, 5);
  assert.ok(radiant > 0 && radiant < 0.5, `Radiant came out as top ${radiant}%`);
  assert.ok(radiant < legend);
  // Und die Kurve hängt auf jedem Rang da, wo die Datei es sagt.
  assert.equal(anchorTable().length, 9);
  assert.ok(zForScore(0) < zForScore(BAND));
});

/* ===================== was vor dieser Übung stand ===================== */

test('preceding work is counted as sets that trained the muscle, not as fractions', () => {
  // Der Fehler, den das ersetzt hat: drei Sätze Bankdrücken vor Trizepsdrücken ergaben bei der
  // gewichteten Überschneidung 1,5, und der Screen druckte "2 Sätze für diesen Muskel", obwohl
  // nichts davor den Trizeps als Aufgabe trainiert hatte.
  const bench = exercise('ex_b', 'Barbell Bench Press', ['chest'], ['triceps']);
  const pushdown = exercise('ex_p', 'Triceps Pushdown', ['triceps']);
  const all = new Map([[bench.id, bench], [pushdown.id, pushdown]]);
  const prior = priorWork(
    [entry(bench.id, [set(100, 8), set(100, 8), set(100, 8)]), entry(pushdown.id, [])],
    1, all);

  assert.equal(prior.direct, 0, 'a bench press is not there to train triceps');
  assert.ok(prior.same > 1 && prior.same < 2,
    `the fatigue arithmetic still sees the overlap, at ${prior.same}`);
  assert.equal(prior.total, 3);
  assert.deepEqual(prior.regions, ['triceps'], 'and the screen can name the muscle');
});

test('a movement that leads on the same muscle counts whole sets', () => {
  const bench = exercise('ex_b', 'Barbell Bench Press', ['chest'], ['triceps']);
  const fly = exercise('ex_f', 'Butterfly', ['chest']);
  const all = new Map([[bench.id, bench], [fly.id, fly]]);
  const prior = priorWork(
    [entry(fly.id, [set(50, 12), set(50, 12), set(50, 12)]), entry(bench.id, [])], 1, all);

  assert.equal(prior.direct, 3);
  // Volles Gewicht, nicht die 0,48, die herauskämen, wenn man über jede Region summiert, die
  // Bankdrücken berührt: SAME_REGION ist genau an diesem Fall eingestellt.
  assert.equal(prior.same, 3);
  assert.deepEqual(leadingRegions(bench), ['chest']);
});

/* ===================== die Schätzung unter einer Satzzeile ===================== */

test('a load you typed yourself gets the same answer the suggestion gets', () => {
  const rows = exerciseHistory(
    [session(at(2026, 8, 1), [entry(BENCH.id, [set(100, 8), set(100, 7)])]),
     session(at(2026, 8, 8), [entry(BENCH.id, [set(100, 8), set(100, 7)])]),
     session(at(2026, 8, 15), [entry(BENCH.id, [set(100, 8), set(100, 7)])])],
    BENCH.id, byId, { assumedRir: 0 });

  const today = capacityToday([], rows, { setIndex: 0 });
  assert.ok(today.capacity > 0);
  // Der Kreis, um den sich die ganze Berechnung dreht: drei flache Einheiten mit 100 x 8 müssen
  // 100 x 8 vorhersagen, nicht 100 x 7. Epley vorwärts und rückwärts landet nicht, wo es
  // angefangen hat, und jeder Vorschlag "gleiches Gewicht, eine Wiederholung weniger", den die
  // App je gedruckt hat, kam aus diesem fehlenden Bit.
  assert.equal(predictReps(today.capacity, 100, today.reserve), 8);

  // Schwerer heißt weniger, leichter heißt mehr, und die Reserve läuft andersherum.
  assert.ok(predictReps(today.capacity, 120, today.reserve)
    < predictReps(today.capacity, 100, today.reserve));
  assert.ok(predictReserve(today.capacity, 100, 1)
    > predictReserve(today.capacity, 100, 6));
  assert.equal(predictReps(0, 100, 0), null);
  assert.equal(predictReserve(200, 100, 0), null);
});

test('capacity falls through a session, so a late set is not promised set one', () => {
  const rows = exerciseHistory(
    [session(at(2026, 8, 1), [entry(BENCH.id, [set(100, 8), set(100, 6)])]),
     session(at(2026, 8, 8), [entry(BENCH.id, [set(100, 8), set(100, 6)])]),
     session(at(2026, 8, 15), [entry(BENCH.id, [set(100, 8), set(100, 6)])])],
    BENCH.id, byId, { assumedRir: 0 });

  const first = capacityToday([], rows, { setIndex: 0 });
  const fourth = capacityToday([], rows, { setIndex: 3 });
  assert.ok(fourth.capacity < first.capacity);
  assert.ok(predictReps(fourth.capacity, 100, 0) < predictReps(first.capacity, 100, 0));

  // Ein heute eingetragener Satz wiegt mehr als der Verlauf, aus dem hochgerechnet wurde.
  const live = capacityToday([set(120, 5)], rows, { setIndex: 1 });
  assert.equal(live.live, true);
  assert.ok(live.capacity > first.capacity);
  assert.equal(capacityToday([], [], {}), null, 'and nothing at all says nothing');
});
