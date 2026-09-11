// Kraftstandards und die Berechnung der Wertung.
//
// Die Wertung vergleicht ein geschätztes 1RM mit veröffentlichten Kraftstandards,
// bezogen auf Körpergewicht, Geschlecht und Alter. Zwei bewusste Grenzen:
//
//  1. Die Körpergröße ist KEINE Eingabe. Kein veröffentlichter Standard benutzt sie, sie
//     beeinflusst die Hebel, ist aber in keiner Normierung enthalten. Sie aufzunehmen wäre
//     ausgedachte Genauigkeit.
//  2. Eine Bewegung wird nur bewertet, wenn es etwas gibt, woran man sie messen kann: einen
//     veröffentlichten Standard für die Langhantelübungen oder ein festgehaltenes Verhältnis
//     zu einer davon für die Maschinen. Alles andere bekommt statt eines Rangs den
//     persönlichen Fortschritt.
//
// Die Zahlen unten sind ein ungefährer Konsens aus häufig veröffentlichten Standards. Ein
// brauchbarer Maßstab, keine genaue Messung.

/**
 * Die Rangleiter.
 *
 * Neun Ränge mit je drei Divisionen, zwischen der ersten Einheit und der Spitze liegen
 * also 27 Stufen statt fünf. Genau darum geht es bei der Form: die alte Version mit fünf
 * Stufen hatte Elite an der vierten von vier Grenzen. Ein ordentlich starker Mensch kam
 * also beim obersten Namen der App an und hatte für den Rest seines Trainingslebens
 * nichts mehr vor sich.
 *
 * Die Namen sind bewusst wie aus einem Spiel. Was sie bedeuten, ist es nicht: jede Grenze
 * unten hängt an denselben veröffentlichten Vielfachen des Körpergewichts wie die alte
 * Version mit fünf Stufen, welcher Rang welchen Anker erbt, steht in LADDER.
 */
export const TIERS = [
  { key: 'bronze',      label: 'Bronze',      short: 'Brz' },
  { key: 'silver',      label: 'Silver',      short: 'Slv' },
  { key: 'gold',        label: 'Gold',        short: 'Gld' },
  { key: 'platinum',    label: 'Platinum',    short: 'Plt' },
  { key: 'diamond',     label: 'Diamond',     short: 'Dia' },
  { key: 'master',      label: 'Master',      short: 'Mst' },
  { key: 'grandmaster', label: 'Grandmaster', short: 'GM' },
  { key: 'elite',       label: 'Elite',       short: 'Eli' },
  { key: 'legend',      label: 'Legend',      short: 'Lgd' },
  // Über dem veröffentlichten Elite-Standard, wo die Tabellen aufhören und der einzige
  // ehrliche Bezug der Wettkampf ist. Diese drei sind hochgerechnet und in ihren Hinweisen
  // auch so gekennzeichnet, aber das Gebiet ist echt: wer auf Elite-Standard ist, ist ein
  // starker regionaler Wettkämpfer und nicht die Spitze des Sports.
  { key: 'challenger',  label: 'Challenger',  short: 'Chl' },
  { key: 'immortal',    label: 'Immortal',    short: 'Imm' },
  { key: 'radiant',     label: 'Radiant',     short: 'Rad' },
];

/** Divisionen innerhalb eines Rangs, die schwächste zuerst. Angezeigt als "Diamond II". */
export const DIVISIONS = ['III', 'II', 'I'];

/** Breite eines Rangs in Punkten. Neun Ränge über 0 bis 100. */
export const BAND = 100 / TIERS.length;

/** Stufen auf der Leiter insgesamt, der Nenner jedes "Stufe 14 von 27". */
export const RANK_STEPS = TIERS.length * DIVISIONS.length;

/** Regionen der Muskelkarte. Feiner als das grobe Feld `muscle` an einer Übung. */
export const REGIONS = {
  chest:       'Chest',
  'delts-front': 'Front Delts',
  'delts-rear':  'Rear Delts',
  traps:       'Traps',
  lats:        'Lats',
  biceps:      'Biceps',
  triceps:     'Triceps',
  forearms:    'Forearms',
  abs:         'Abs',
  obliques:    'Obliques',
  'lower-back': 'Lower Back',
  glutes:      'Glutes',
  quads:       'Quads',
  hamstrings:  'Hamstrings',
  calves:      'Calves',
  adductors:   'Adductors',
};

/**
 * Die vier veröffentlichten Ankerpunkte je Übung als Vielfache des Körpergewichts:
 * Einstieg zu Anfänger, Fortgeschritten, Weit fortgeschritten und Elite in den Standards,
 * aus denen sie stammen. `ladder()` macht daraus die Grenzen der neun Ränge, die die App
 * zeigt, die veröffentlichten Zahlen bleiben also an einer Stelle sichtbar und änderbar.
 */
const BOUNDS = {
  male: {
    'Barbell Bench Press':      [0.75, 1.25, 1.75, 2.25],
    'Incline Barbell Bench Press': [0.60, 1.00, 1.45, 1.90],
    'Close-Grip Bench Press':   [0.60, 1.00, 1.45, 1.85],
    'Back Squat':               [1.00, 1.50, 2.25, 3.00],
    'Front Squat':              [0.80, 1.20, 1.80, 2.40],
    'Deadlift':                 [1.25, 1.90, 2.65, 3.40],
    'Sumo Deadlift':            [1.25, 1.90, 2.65, 3.40],
    'Romanian Deadlift':        [1.00, 1.50, 2.10, 2.75],
    'Overhead Press':           [0.50, 0.75, 1.05, 1.35],
    'Barbell Row':              [0.70, 1.05, 1.45, 1.85],
    'Pendlay Row':              [0.70, 1.05, 1.45, 1.85],
    'Hip Thrust':               [1.25, 2.00, 2.75, 3.60],
    'Lat Pulldown':             [0.70, 1.00, 1.35, 1.70],
    'Leg Press':                [2.00, 3.00, 4.25, 5.50],
    'Pull-Up':                  [1.00, 1.25, 1.55, 1.95],
    'Chin-Up':                  [1.00, 1.28, 1.60, 2.00],
    'Dip':                      [1.00, 1.30, 1.65, 2.10],
  },
  female: {
    'Barbell Bench Press':      [0.45, 0.75, 1.05, 1.40],
    'Incline Barbell Bench Press': [0.35, 0.60, 0.85, 1.15],
    'Close-Grip Bench Press':   [0.35, 0.60, 0.85, 1.15],
    'Back Squat':               [0.70, 1.15, 1.65, 2.25],
    'Front Squat':              [0.55, 0.90, 1.30, 1.80],
    'Deadlift':                 [0.90, 1.40, 2.00, 2.60],
    'Sumo Deadlift':            [0.90, 1.40, 2.00, 2.60],
    'Romanian Deadlift':        [0.70, 1.10, 1.55, 2.05],
    'Overhead Press':           [0.30, 0.48, 0.68, 0.90],
    'Barbell Row':              [0.45, 0.70, 1.00, 1.30],
    'Pendlay Row':              [0.45, 0.70, 1.00, 1.30],
    'Hip Thrust':               [1.00, 1.65, 2.35, 3.10],
    'Lat Pulldown':             [0.50, 0.75, 1.05, 1.35],
    'Leg Press':                [1.50, 2.30, 3.30, 4.30],
    'Pull-Up':                  [0.85, 1.05, 1.30, 1.65],
    'Chin-Up':                  [0.85, 1.08, 1.34, 1.70],
    'Dip':                      [0.85, 1.10, 1.40, 1.80],
  },
};

/** Übungen, bei denen die Last Körpergewicht plus Zusatzgewicht ist. */
const BODYWEIGHT_INCLUSIVE = new Set([
  'Pull-Up', 'Chin-Up', 'Dip', 'Weighted Pull-Up', 'Weighted Chin-Up', 'Weighted Dip',
]);
const BENCHMARK_BASE = {
  'Weighted Pull-Up': 'Pull-Up', 'Weighted Chin-Up': 'Chin-Up', 'Weighted Dip': 'Dip',
};

/**
 * Wie der mitgelieferte Katalog eine Übung nennt, die schon einen veröffentlichten Standard hat.
 *
 * free-exercise-db schreibt den Klimmzug "Pullups" und teilt den Dip in eine Brust- und
 * eine Trizepsversion, keine der drei Körpergewichts-Referenzen in BOUNDS steht also unter
 * dem Namen, den die Tabelle benutzt. Alle drei ergaben überhaupt keinen Rang:
 * `isBenchmark` sagte nein, und ihr Gerät ("Bodyweight", "Other") wird auch nicht bewertet,
 * buildRating hat sie also übersprungen, bevor es je bei einem Standard ankam. Wer aus der
 * mitgelieferten Bibliothek Klimmzüge mit Zusatzgewicht gemacht hat, hatte einen Rücken
 * ohne Rang.
 *
 * Absichtlich eine eigene Tabelle neben ALIAS. ALIAS darf `isBenchmark` nie erreichen,
 * weil ein Latzug im weiten Griff nah genug ist, um sich das Verhältnis eines Latzugs zu
 * leihen, aber nicht nah genug, um seinen veröffentlichten Standard zu erben. Das hier sind
 * keine nahen Varianten, sondern dieselbe Bewegung in der Schreibweise des Katalogs, und
 * das zu sagen muss eine eigene, bewusste Liste sein.
 */
export const BENCHMARK_ALIAS = {
  'Pullups': 'Pull-Up',
  'Dips - Chest Version': 'Dip',
  'Dips - Triceps Version': 'Dip',

  // Katalog und Standardtabelle schreiben dieselben Bewegungen verschieden, und wo sie sich
  // verfehlen, bekommt die Übung gar keinen Rang. "Weighted Pull Ups" ist die wichtigste:
  // der veröffentlichte Standard steht unter "Weighted Pull-Up", allein der Bindestrich hat
  // also zwischen einer eingestuften und einer unsichtbaren Übung entschieden. Ohne den
  // Alias hat der Trainieren-Screen sie außerdem als normale Last abgefragt statt als
  // Körpergewicht plus Gürtel.
  'Weighted Pull Ups': 'Weighted Pull-Up',
  'Parallel Bar Dip': 'Dip',
  'Ring Dips': 'Dip',
  'Narrow Parallel Grip Chin-ups': 'Chin-Up',
  // Der neutrale Griff liegt zwischen den beiden, und Chin-Up ist der härtere Standard des
  // Paars. Das ist also die vorsichtigere der beiden Lesarten.
  'V-Bar Pullup': 'Chin-Up',
  // Hinter dem Nacken ist schwerer als ein normaler Klimmzug, nie leichter. Gegen den
  // Klimmzug-Standard gemessen kann das also niemandem schmeicheln.
  'Wide-Grip Rear Pull-Up': 'Pull-Up',

  // Absichtlich nicht dabei, jede aus eigenem Grund. "Band Assisted Pull-Up" ist
  // unterstützt, die Zahl beschreibt also das Band (siehe UNRATEABLE). "Bench Dips" und
  // "Weighted Bench Dip" stellen die Füße auf den Boden und tragen nur einen Teil der Last.
  // "Scapular Pull-Up", "One Arm Chin-Up" und "Rocky Pull-Ups/Pulldowns" sind andere
  // Bewegungen und keine andere Schreibweise.
};

/** Die Referenzübung, für die ein Katalogname steht, oder der Name selbst. */
export const benchmarkName = (name) => BENCHMARK_ALIAS[name] || name;

/** Welche Regionen eine Referenzübung trainiert, und wie stark (0 bis 1). */
export const CONTRIB = {
  'Barbell Bench Press':      { chest: 1, 'delts-front': 0.55, triceps: 0.55 },
  'Incline Barbell Bench Press': { chest: 0.95, 'delts-front': 0.7, triceps: 0.5 },
  'Close-Grip Bench Press':   { triceps: 1, chest: 0.7, 'delts-front': 0.5 },
  // Das Gesäß ist bei der Kniebeuge ein Hauptstrecker der Hüfte, und die alten 0,75 haben
  // das bestritten. Wer Kniebeugen, aber keine Hip Thrusts macht, konnte das Gesäß also nie einstufen.
  'Back Squat':               { quads: 1, glutes: 0.85, 'lower-back': 0.4, hamstrings: 0.35 },
  'Front Squat':              { quads: 1, glutes: 0.6, abs: 0.45, 'lower-back': 0.35 },
  'Deadlift':                 { 'lower-back': 1, hamstrings: 0.85, glutes: 0.85, traps: 0.55, lats: 0.45, forearms: 0.5 },
  'Sumo Deadlift':            { glutes: 1, quads: 0.7, 'lower-back': 0.8, hamstrings: 0.6, forearms: 0.45 },
  'Romanian Deadlift':        { hamstrings: 1, glutes: 0.8, 'lower-back': 0.6 },
  'Overhead Press':           { 'delts-front': 1, triceps: 0.6, traps: 0.4, abs: 0.3 },
  // Beim waagerechten Rudern ist der mittlere Rücken ein Hauptbeweger und kein Zuschauer.
  // Hier stand früher Latissimus 1,0 gegen Trapez 0,65, und das beschreibt einen Latzug:
  // die Folge war, dass 22 Bewegungen den Trapez berührt haben und keine ihn einstufen
  // konnte, eine Übung für den oberen Rücken ließ den oberen Rücken grau. `traps` umfasst
  // hier den mittleren und unteren Trapez und die Rautenmuskeln, für die die Muskelkarte
  // keine eigene Region hat.
  'Barbell Row':              { lats: 1, traps: 1, biceps: 0.55, 'delts-rear': 0.7 },
  'Pendlay Row':              { lats: 1, traps: 1, biceps: 0.5, 'delts-rear': 0.7 },
  'Hip Thrust':               { glutes: 1, hamstrings: 0.55 },
  'Lat Pulldown':             { lats: 1, biceps: 0.55, 'delts-rear': 0.35 },
  'Leg Press':                { quads: 1, glutes: 0.6 },
  'Pull-Up':                  { lats: 1, biceps: 0.6, forearms: 0.4, 'delts-rear': 0.3 },
  'Chin-Up':                  { lats: 0.9, biceps: 0.85, forearms: 0.4 },
  'Dip':                      { triceps: 1, chest: 0.8, 'delts-front': 0.5 },
  'Weighted Pull-Up':         { lats: 1, biceps: 0.6, forearms: 0.4, 'delts-rear': 0.3 },
  'Weighted Chin-Up':         { lats: 0.9, biceps: 0.85, forearms: 0.4 },
  'Weighted Dip':             { triceps: 1, chest: 0.8, 'delts-front': 0.5 },
};

/**
 * Gepflegte Anatomie für Bewegungen ohne Kraftstandard.
 *
 * CONTRIB hat früher zwei Aufgaben auf einmal gehabt, "welche Muskeln trainiert das" und
 * "ist das eine Referenzübung". Der einzige Weg, einer Übung eine ordentliche Anatomie über
 * mehrere Regionen zu geben, war also, ihr einen Standard zu erfinden. Diese Tabelle ist die
 * erste Aufgabe für sich: Maschinenarbeit bekommt genaue Regionen und bleibt unbewertet,
 * und das ist die ehrliche Kombination.
 *
 * Warum Maschinen keinen Standard bekommen: "100 kg" an der Brustpresse eines Herstellers
 * sind nicht 100 kg am Gerät eines anderen. Hebelarme unterscheiden sich, Scheiben- und
 * Steckgewicht unterscheiden sich, der Anfangswiderstand unterscheidet sich. Es gibt nichts,
 * worauf man normieren könnte, eine Stufe wäre also eine Zahl ohne Bedeutung dahinter.
 */
export const CONTRIB_EXTRA = {
  // --- Rudern und Ziehen ---
  // Mit Bruststütze trifft es am meisten den oberen Rücken: das Polster nimmt den Rumpf raus,
  // und genau das lässt den mittleren Rücken die Arbeit machen.
  'Chest-Supported T-Bar Row': { traps: 1, lats: 0.9, 'delts-rear': 0.8, biceps: 0.5 },
  'Chest-Supported Row':       { traps: 1, lats: 0.9, 'delts-rear': 0.8, biceps: 0.5 },
  'Close-Grip Seated Row':     { lats: 1, traps: 0.9, biceps: 0.6, 'delts-rear': 0.45 },
  'Machine Row':               { lats: 1, traps: 0.95, biceps: 0.5, 'delts-rear': 0.6 },
  'Seated Cable Row':          { lats: 1, traps: 0.95, biceps: 0.55, 'delts-rear': 0.55 },
  'T-Bar Row':                 { lats: 1, traps: 1, biceps: 0.5, 'delts-rear': 0.6, 'lower-back': 0.3 },
  // Hohes Rudern zieht die Ellbogen nach außen und oben, das ist eine Übung für die hintere
  // Schulter, die zufällig wie Rudern beladen wird.
  'Machine High Row':          { traps: 1, 'delts-rear': 0.85, lats: 0.9, biceps: 0.45 },
  'Lying T-Bar Row':           { traps: 1, lats: 0.9, 'delts-rear': 0.8, biceps: 0.5 },
  'Machine Pullover':          { lats: 1, chest: 0.4, triceps: 0.3 },
  'Assisted Pull-Up Machine':  { lats: 1, biceps: 0.6, 'delts-rear': 0.3 },

  // --- Drücken ---
  'Machine Chest Press':       { chest: 1, 'delts-front': 0.55, triceps: 0.55 },
  'Incline Machine Press':     { chest: 0.95, 'delts-front': 0.7, triceps: 0.5 },
  'Machine Chest Fly':         { chest: 1, 'delts-front': 0.3 },
  'Pec Deck':                  { chest: 1, 'delts-front': 0.25 },
  'Butterfly':                 { chest: 1, 'delts-front': 0.25 },
  'Machine Shoulder Press':    { 'delts-front': 1, triceps: 0.6, traps: 0.35 },
  'Smith Machine Bench Press': { chest: 1, 'delts-front': 0.5, triceps: 0.5 },
  'Smith Machine Incline Bench Press': { chest: 0.95, 'delts-front': 0.7, triceps: 0.5 },
  'Smith Machine Squat':       { quads: 1, glutes: 0.7, 'lower-back': 0.3 },

  // --- Arme und Schultern ---
  'Machine Lateral Raise':     { 'delts-front': 1, traps: 0.3 },
  'Lateral Raise Machine':     { 'delts-front': 1, traps: 0.3 },
  'Machine Rear Delt Fly':     { 'delts-rear': 1, traps: 0.4 },
  'Machine Biceps Curl':       { biceps: 1, forearms: 0.3 },
  // Dieselbe Bewegung mit einer Stange in den Händen. Gepflegt und nicht aus dem Namen
  // abgeleitet, wie jede andere Zeile in dieser Tabelle.
  'Barbell Curl':              { biceps: 1, forearms: 0.35 },
  'Machine Preacher Curl':     { biceps: 1, forearms: 0.25 },
  'Preacher Curl Machine':     { biceps: 1, forearms: 0.25 },
  'Rope Hammer Curl':          { biceps: 0.75, forearms: 1 },
  'Cable Wrist Curl':          { forearms: 1 },
  'Machine Triceps Extension': { triceps: 1 },
  'Overhead Rope Triceps Extension': { triceps: 1 },
  'Triceps Pushdown':          { triceps: 1 },
  'Rope Triceps Pushdown':     { triceps: 1 },
  'Machine Dip':               { triceps: 1, chest: 0.75, 'delts-front': 0.45 },

  // --- Unterkörper und Rumpf ---
  'Machine Hip Abduction':     { glutes: 1 },
  'Machine Hip Adduction':     { adductors: 1 },
  'Machine Crunch':            { abs: 1, obliques: 0.35 },
  // Für die seitlichen Bauchmuskeln gab es gar nichts, was sie einstufen konnte: eine
  // Bewegung hat sie berührt, keine angetrieben. Das hier sind die Muster für Drehung und
  // Seitneigung, die der Katalog tatsächlich hat.
  'Cable Oblique Twist':       { obliques: 1, abs: 0.8 },
  'Cable Side Bend':           { obliques: 1, abs: 0.6 },
  'Machine Back Extension':    { 'lower-back': 1, glutes: 0.6, hamstrings: 0.5 },
  'Pendulum Squat':            { quads: 1, glutes: 0.65 },
  'Hack Squat':                { quads: 1, glutes: 0.65 },
  'Leg Extension':             { quads: 1 },
  'Lying Leg Curl':            { hamstrings: 1, calves: 0.2 },
  'Seated Leg Curl':           { hamstrings: 1, calves: 0.15 },
  'Standing Calf Raise':       { calves: 1 },
  'Seated Calf Raise':         { calves: 1 },
  'Belt Squat':                { quads: 1, glutes: 0.65 },
  'Smith Machine Romanian Deadlift': { hamstrings: 1, glutes: 0.8, 'lower-back': 0.35 },
  'Bayesian Cable Curl':       { biceps: 1, forearms: 0.2 },
  'Cross-Body Cable Lateral Raise': { 'delts-front': 1, traps: 0.25 },
  'Single-Arm Lat Pulldown':   { lats: 1, biceps: 0.5, 'delts-rear': 0.25 },
  'Lat Pulldown Machine':      { lats: 1, biceps: 0.55, 'delts-rear': 0.35 },
  'Reverse Nordic Curl':       { quads: 1, abs: 0.25 },
  'Glute-Biased 45-Degree Back Extension': { glutes: 1, hamstrings: 0.7, 'lower-back': 0.3 },
  // Y-Heben führt die Arme nach oben und hinten. Das ist hintere Schulter und unterer
  // Trapez, es als Übung für die vordere Schulter zu führen war einfach falsch.
  'Cable Y-Raise':             { 'delts-rear': 1, traps: 0.85, 'delts-front': 0.5 },
  'Iso-Lateral Chest Press':   { chest: 1, 'delts-front': 0.55, triceps: 0.55 },
  'Iso-Lateral Incline Chest Press': { chest: 0.95, 'delts-front': 0.7, triceps: 0.5 },
  'Iso-Lateral Shoulder Press': { 'delts-front': 1, triceps: 0.6, traps: 0.35 },
  'Iso-Lateral High Row':      { traps: 1, lats: 0.9, 'delts-rear': 0.85, biceps: 0.45 },
  'Iso-Lateral Low Row':       { lats: 1, traps: 0.9, biceps: 0.55, 'delts-rear': 0.5 },
  'Plate-Loaded Pullover':     { lats: 1, chest: 0.35, triceps: 0.25 },
  'Glute Drive Machine':       { glutes: 1, hamstrings: 0.5 },
  'Standing Hip Abduction Machine': { glutes: 1 },
  'Kneeling Leg Curl Machine': { hamstrings: 1, calves: 0.2 },
  'Single-Leg Extension':      { quads: 1 },
  'Machine Shrug':             { traps: 1, forearms: 0.35 },
  'Smith Machine Deadlift':    { 'lower-back': 1, hamstrings: 0.85, glutes: 0.8, traps: 0.5, forearms: 0.45 },
  'Smith Machine Good Morning': { hamstrings: 1, 'lower-back': 0.9, glutes: 0.7 },
  'Seated Dip Machine':        { triceps: 1, chest: 0.75, 'delts-front': 0.4 },
};

/** Anatomie für jede gepflegte Bewegung, ob Referenz oder nicht. */
export const ANATOMY = { ...CONTRIB_EXTRA, ...CONTRIB };

export const BENCHMARKS = Object.keys(CONTRIB);
export const isBenchmark = (name) => Object.hasOwn(CONTRIB, benchmarkName(name));

/* ===================== Maschinen bekommen einen echten Standard ===================== */

/**
 * Woran eine Übung an der Maschine gemessen wird.
 *
 * Im August 2026 neu eingestellt, an den gemessenen vollen Gewichtsblöcken eines echten
 * Studios, weil das die einzigen harten Daten dafür sind: das Maximum eines Blocks
 * beantwortet die Frage, die ein Trainingsstandard nicht beantworten kann, nämlich was es
 * HEISST, genau dieses Gerät auszureizen. Die Regel war LEGEND ≈ VOLLER BLOCK FÜR ETWA ZEHN
 * WIEDERHOLUNGEN, denn genau dort lag schon die eine Bewegung mit veröffentlichtem Standard
 * und bekanntem Block (ein Latzug-Block mit 105 kg gegen ein Legend von 138 kg). Die
 * Maschinen wurden also so eingestellt, dass sie dazu passen.
 *
 * Zwei unabhängige Prüfungen, dass die Regel nicht im Kreis läuft: die Brustpresse wurde
 * lange vor jeder Messung aus dem Bankdrück-Standard abgeleitet, und der gemessene Block
 * mit 135 kg lag nur ein Prozent daneben. Der Latzug, der einen eigenen veröffentlichten
 * Standard hat und nie durch diese Tabelle ging, landet an derselben Stelle.
 *
 * Eine zweite Runde an den echten Arbeitsgewichten eines Menschen hat die Regel geteilt.
 * Der Maschinenrang im Vergleich zum LANGHANTEL-Rang derselben Person für denselben Muskel
 * lag bei der Brust einen halben Rang auseinander und beim Rücken ein Drittel, die blieben
 * also genau so. Die Beine lagen 2,8 Ränge auseinander (ein Beinstrecker über der Kniebeuge
 * derselben Person, und das machen Beine nicht), und die eingelenkigen Maschinen für Arme
 * und Schultern lagen durchgehend zu hoch.
 *
 * Mehrgelenksmaschinen behalten also LEGEND ≈ VOLLER BLOCK FÜR ZEHN WIEDERHOLUNGEN,
 * eingelenkige brauchen stattdessen etwa das 1,6-Fache eines vollen Blocks.
 *
 * Eine dritte Runde hat erwischt, was diese Regel allein nicht sieht: sie behandelt jede
 * Maschine mit einem 85-kg-Block als dieselbe Leistung, und das stimmt nicht. Derselbe Block
 * hing an Trizepsdrücken und Scottcurls, die Tabelle behauptete also, ein Legend beim
 * Trizepsdrücken und beim Curl seien dieselben 134 kg, ein Gewicht, das praktisch niemand
 * curlt und viele drücken. Die Faktoren für Curls tragen deshalb zusätzlich ein Verhältnis
 * der Bewegung: ein Scottcurl schafft an einem vergleichbaren Block etwa 85 % von dem, was
 * Trizepsdrücken schafft, ein Hammercurl etwas mehr. Bestätigt von der Person, an der es
 * aufgefallen ist: sie reizt den Block beim Trizepsdrücken aus und schafft 88 % am Curl.
 * Der Grund im Aufbau, und deshalb ist das nicht einfach an eine Person angepasst: ein
 * Block an einer Isolationsmaschine ist großzügig im Verhältnis zur wirklich erzeugten
 * Kraft, weil dasselbe Gestell mit 135 kg für Beinpresse und Beinstrecker herhalten muss.
 * Wo sich Daten und dieses Argument widersprachen, wie bei der Brust, gewannen die Daten,
 * und nichts wurde verschoben.
 *
 * Die Folge ist gewollt: an einer Isolationsmaschine sind die drei Ränge über Legend
 * praktisch nicht erreichbar, weil ein normaler Block keine Kraft auf Landesrekord-Niveau
 * ausdrücken kann. Das ist die ehrliche Antwort. Und genau das repariert den Fall, an dem
 * es aufgefallen ist: eine Seitheben-Maschine, die den obersten Rang weit unter einem vollen
 * Block verteilt hat.
 *
 * Die alte Version hat Maschinen nach sieben sehr groben Kategorien bewertet, und beide
 * Hälften davon waren gleichzeitig falsch: die Kategorien waren viel zu weich (Elite an der
 * Brustpresse war das 1,40-Fache des Körpergewichts, das schaffen sehr viele im zweiten
 * Jahr), und der Rang wurde auf der Muskelkarte dann auf 0,65 abgewertet, weil ihm keiner
 * getraut hat. Maschinenarbeit hat den Rang also aufgebläht und zur Karte fast nichts beigetragen.
 *
 * Das hier ist die ehrliche Fassung derselben Idee. Eine Maschine hat keinen eigenen
 * veröffentlichten Standard, aber das VERHÄLTNIS zwischen einer Maschine und der
 * Langhantelübung, der sie entspricht, ist stabil genug, um es aufzuschreiben: eine
 * Brustpresse im Sitzen ist etwas leichter als Bankdrücken, eine Schulterpresse an der
 * Maschine etwas schwerer als stehendes Überkopfdrücken, weil der Sitz den Rumpf rausnimmt,
 * ein Beinstrecker ist etwa eine halbe Kniebeuge. Der Standard wird also abgeleitet (die
 * Langhantel-Leiter für diese Bewegung, skaliert), dadurch ist er so streng wie der
 * Langhantel-Standard, aus dem er kommt, und darf voll zählen.
 *
 * Die Faktoren sind Konsens aus dem Studio und keine Messungen, und das geht auch nicht
 * anders: Hebelarme und Übersetzungen der Blöcke unterscheiden sich zwischen Herstellern,
 * und genau dort mischt `scoreForMachine` Daten der Gemeinschaft zum selben Modell ein,
 * sobald es welche gibt. LOW_CONFIDENCE bringt diesen Hinweis auf den Screen.
 *
 * @type {Object<string, [string, number]>}  Name -> [Langhantelübung, Faktor]
 */
const MACHINE_ANCHOR = {
  // --- Rudern und Ziehen ---
  // Das Rudern mit Bruststütze hatte einen Aufschlag von 10 % auf das Langhantelrudern, mit
  // der Begründung, dass man mehr zieht, wenn unterer Rücken und Hüfte raus sind. Das stimmt
  // auch. Übersehen wurde die andere Seite des Vergleichs: Langhantelrudern wird als Stange
  // plus Scheiben eingetragen, eine T-Bar mit Scheiben nur als Scheiben. Das Eigengewicht
  // des Hebels kommt nie in der Zahl an, der Aufschlag galt also einer Last, die sich selbst
  // schon um etwa denselben Betrag zu niedrig angibt. Beides hebt sich auf, übrig bleibt 1,00.
  // Die freie T-Bar behält ihren Abstand unter der gestützten.
  //
  // Das ist eine Einstellung gegen eine Art einzutragen, keine Behauptung, dass beide
  // Bewegungen gleich schwer sind. Wer weiß, was sein Gerät an den Griffen wirklich an
  // Widerstand hat, sollte eine Lastkorrektur setzen und das überschreiben.
  'Chest-Supported T-Bar Row':  ['Barbell Row', 1.00],
  'Chest-Supported Row':        ['Barbell Row', 1.00],
  'Close-Grip Seated Row':      ['Barbell Row', 1.17],
  'Machine Row':                ['Barbell Row', 1.17],
  'Seated Cable Row':           ['Barbell Row', 1.17],
  'T-Bar Row':                  ['Barbell Row', 0.95],
  // Nicht erreichbar: ALIAS löst diesen Namen zu Chest-Supported T-Bar Row auf, bevor der
  // Anker nachgeschlagen wird. Wird trotzdem mitgezogen, damit es niemanden in die Irre führt.
  'Lying T-Bar Row':            ['Barbell Row', 1.00],
  'Machine High Row':           ['Barbell Row', 1.20],
  'Iso-Lateral High Row':       ['Barbell Row', 1.15],
  'Iso-Lateral Low Row':        ['Barbell Row', 1.15],
  'Machine Pullover':           ['Lat Pulldown', 0.70],
  'Plate-Loaded Pullover':      ['Lat Pulldown', 0.70],
  'Single-Arm Lat Pulldown':    ['Lat Pulldown', 0.50],
  'Lat Pulldown Machine':       ['Lat Pulldown', 1.00],

  // --- Drücken ---
  'Machine Chest Press':        ['Barbell Bench Press', 0.96],
  'Iso-Lateral Chest Press':    ['Barbell Bench Press', 0.96],
  'Smith Machine Bench Press':  ['Barbell Bench Press', 1.00],
  'Incline Machine Press':      ['Incline Barbell Bench Press', 0.95],
  'Iso-Lateral Incline Chest Press': ['Incline Barbell Bench Press', 0.95],
  'Smith Machine Incline Bench Press': ['Incline Barbell Bench Press', 1.00],
  'Machine Chest Fly':          ['Barbell Bench Press', 0.75],
  'Pec Deck':                   ['Barbell Bench Press', 0.75],
  'Butterfly':                  ['Barbell Bench Press', 0.75],
  'Machine Shoulder Press':     ['Overhead Press', 1.24],
  'Iso-Lateral Shoulder Press': ['Overhead Press', 1.24],
  'Machine Dip':                ['Close-Grip Bench Press', 0.90],
  'Seated Dip Machine':         ['Close-Grip Bench Press', 0.90],

  // --- Arme und Schultern ---
  'Machine Lateral Raise':      ['Overhead Press', 1.13],
  'Lateral Raise Machine':      ['Overhead Press', 1.13],
  'Cable Y-Raise':              ['Overhead Press', 0.56],
  'Cross-Body Cable Lateral Raise': ['Overhead Press', 0.33],
  'Machine Rear Delt Fly':      ['Barbell Row', 0.91],
  'Machine Biceps Curl':        ['Barbell Row', 0.78],
  // Keine Maschine. Siehe DERIVED_FREE_WEIGHT: ein Langhantelcurl konnte nichts einstufen,
  // weil die Bewertbarkeit am Gerät hing und "Barbell" nicht auf der Liste stand. 0,52 legt
  // das Elite-Band beim 0,96-Fachen der allometrischen Referenz, dort steht der
  // veröffentlichte Standard für den Langhantelcurl, knapp unter dem Körpergewicht bei
  // jemandem, der stark ist. Über den Maschinencurl hätte das 107 kg ergeben, weil ein
  // Exzenter hilft und eine Stange nicht.
  'Barbell Curl':               ['Barbell Row', 0.52],
  'Machine Preacher Curl':      ['Barbell Row', 0.76],
  'Preacher Curl Machine':      ['Barbell Row', 0.76],
  'Rope Hammer Curl':           ['Barbell Row', 0.80],
  // Unterarme bewegen viel Gewicht über fast keinen Weg, die Zahl am Block ist hier also so
  // unehrlich wie nirgends sonst im Studio.
  'Cable Wrist Curl':           ['Barbell Row', 0.90],
  'Bayesian Cable Curl':        ['Barbell Row', 0.19],
  'Machine Triceps Extension':  ['Close-Grip Bench Press', 0.89],
  'Triceps Pushdown':           ['Close-Grip Bench Press', 0.89],
  'Rope Triceps Pushdown':      ['Close-Grip Bench Press', 0.86],
  'Overhead Rope Triceps Extension': ['Close-Grip Bench Press', 1.43],

  // --- Unterkörper und Rumpf ---
  'Hack Squat':                 ['Back Squat', 1.15],
  'Pendulum Squat':             ['Back Squat', 0.95],
  'Belt Squat':                 ['Back Squat', 0.95],
  'Smith Machine Squat':        ['Back Squat', 1.00],
  'Leg Extension':              ['Back Squat', 0.90],
  'Lying Leg Curl':             ['Romanian Deadlift', 0.92],
  'Seated Leg Curl':            ['Romanian Deadlift', 0.95],
  'Kneeling Leg Curl Machine':  ['Romanian Deadlift', 0.45],
  'Single-Leg Extension':       ['Back Squat', 0.45],
  'Machine Shrug':              ['Deadlift', 0.85],
  'Smith Machine Deadlift':     ['Deadlift', 1.00],
  'Smith Machine Good Morning': ['Romanian Deadlift', 0.75],
  'Standing Calf Raise':        ['Back Squat', 1.00],
  'Seated Calf Raise':          ['Back Squat', 0.65],
  'Smith Machine Romanian Deadlift': ['Romanian Deadlift', 1.00],
  'Glute-Biased 45-Degree Back Extension': ['Romanian Deadlift', 0.40],
  'Machine Back Extension':     ['Back Squat', 0.50],
  'Machine Crunch':             ['Back Squat', 0.56],
  'Cable Oblique Twist':        ['Back Squat', 0.40],
  'Cable Side Bend':            ['Back Squat', 0.45],
  'Glute Drive Machine':        ['Hip Thrust', 1.00],
  'Machine Hip Abduction':      ['Hip Thrust', 0.47],
  'Machine Hip Adduction':      ['Hip Thrust', 0.47],
  'Standing Hip Abduction Machine': ['Hip Thrust', 0.20],
};

/**
 * Dieselbe Bewegung unter dem Namen, den die Bibliothek wirklich benutzt.
 *
 * Die gepflegten Tabellen oben wurden gegen die Startliste geschrieben, der mitgelieferte
 * Katalog nennt viele derselben Maschinen anders ("Ab Crunch Machine" für Machine Crunch,
 * "Leg Extensions" mit s, vier Schreibweisen für Trizepsdrücken am Kabel). Ohne das hier
 * wird eine Übung über die groben Kategorien eingestuft und trägt zu keinem Muskel bei. So
 * war eine Bauchmaschine auf der Muskelkarte unsichtbar und hat trotzdem einen Rang erzeugt.
 *
 * Der Alias wirkt auf Anatomie, Maschinenanker und Kategorie, nie auf `isBenchmark`, weil
 * ein Latzug im weiten Griff nah genug ist, um sich das Verhältnis des Latzugs zu leihen,
 * aber nicht nah genug, um seinen veröffentlichten Standard zu erben.
 */
const ALIAS = {
  'Ab Crunch Machine': 'Machine Crunch',
  'Cable Reverse Crunch': 'Machine Crunch',
  'Cable Seated Crunch': 'Machine Crunch',
  'Rope Crunch': 'Machine Crunch',
  'Standing Rope Crunch': 'Machine Crunch',
  'Kneeling Cable Crunch With Alternating Oblique Twists': 'Cable Oblique Twist',
  'Cable Russian Twists': 'Cable Oblique Twist',
  'One-Arm High-Pulley Cable Side Bends': 'Cable Side Bend',
  'Bosu Ball Cable Crunch With Side Bends': 'Cable Side Bend',

  'Leg Extensions': 'Leg Extension',
  'Single-Leg Leg Extension': 'Single-Leg Extension',
  'Lying Leg Curls': 'Lying Leg Curl',
  'Standing Leg Curl': 'Kneeling Leg Curl Machine',

  'Standing Calf Raises': 'Standing Calf Raise',
  'Calf Press': 'Standing Calf Raise',
  'Calf Press On The Leg Press Machine': 'Standing Calf Raise',
  'Smith Machine Calf Raise': 'Standing Calf Raise',
  'Smith Machine Reverse Calf Raises': 'Seated Calf Raise',

  'Triceps Pushdown - Rope Attachment': 'Rope Triceps Pushdown',
  'Triceps Pushdown - V-Bar Attachment': 'Triceps Pushdown',
  'Triceps Pushdown with Cable': 'Triceps Pushdown',
  'Reverse Grip Triceps Pushdown': 'Triceps Pushdown',
  'Triceps Overhead Extension with Rope': 'Overhead Rope Triceps Extension',

  'Machine Preacher Curls': 'Machine Preacher Curl',
  'Cable Preacher Curl': 'Machine Preacher Curl',
  'Cable Hammer Curls - Rope Attachment': 'Rope Hammer Curl',
  'Seated Two-Arm Palms-Up Low-Pulley Wrist Curl': 'Cable Wrist Curl',
  'Cable Wrist Curl ': 'Cable Wrist Curl',

  // Der Langhantelcurl, den der Katalog nie Langhantelcurl nennt. Jeder davon ist ein
  // beidhändiger Curl mit Stange, der sich nur im Griff oder Bankwinkel unterscheidet, und
  // jeder war unter seinem eigenen Namen für die Bewertung unsichtbar.
  'Wide-Grip Standing Barbell Curl': 'Barbell Curl',
  'Close-Grip Standing Barbell Curl': 'Barbell Curl',
  'EZ-Bar Curl': 'Barbell Curl',
  'Close-Grip EZ Bar Curl': 'Barbell Curl',
  'Close-Grip EZ-Bar Curl': 'Barbell Curl',
  'Drag Curl': 'Barbell Curl',
  'Spider Curl': 'Barbell Curl',
  'Barbell Curls Lying Against An Incline': 'Barbell Curl',
  'Lying High Bench Barbell Curl': 'Barbell Curl',
  'Seated Close-Grip Concentration Barbell Curl': 'Barbell Curl',
  // Hier absichtlich KEIN Alias: ein einfaches "Preacher Curl" ist in manchen Studios eine
  // Bank und in anderen ein Block, und MACHINE_ANCHOR hat den an der Maschine schon. Zu raten,
  // was gemeint ist, ist genau der Weg, auf dem ein Rang auf dem falschen Standard landet.

  'Cable Seated Lateral Raise': 'Machine Lateral Raise',
  'Cable Rear Delt Fly': 'Machine Rear Delt Fly',
  'Smith Machine Rear Deltoid Row': 'Machine Rear Delt Fly',

  'Seated Shoulder Press Machine': 'Machine Shoulder Press',
  'Leverage Shoulder Press': 'Machine Shoulder Press',
  'Cable Shoulder Press': 'Machine Shoulder Press',
  'Seated Cable Shoulder Press': 'Machine Shoulder Press',
  'Alternating Cable Shoulder Press': 'Machine Shoulder Press',
  'Smith Machine Overhead Shoulder Press': 'Machine Shoulder Press',

  'Leverage Chest Press': 'Machine Chest Press',
  'Leverage Decline Chest Press': 'Machine Chest Press',
  'Leverage Incline Chest Press': 'Incline Machine Press',
  'Cable Chest Press': 'Machine Chest Press',
  'Standing Cable Chest Press': 'Machine Chest Press',
  'Incline Cable Chest Press': 'Incline Machine Press',

  'Hip Adduction': 'Machine Hip Adduction',
  'Cable Hip Adduction': 'Machine Hip Adduction',

  'Wide-Grip Lat Pulldown': 'Lat Pulldown Machine',
  'Close-Grip Front Lat Pulldown': 'Lat Pulldown Machine',
  'Full Range-Of-Motion Lat Pulldown': 'Lat Pulldown Machine',
  'V-Bar Pulldown': 'Lat Pulldown Machine',
  'Underhand Cable Pulldowns': 'Lat Pulldown Machine',
  'Wide-Grip Pulldown Behind The Neck': 'Lat Pulldown Machine',
  'One Arm Lat Pulldown': 'Single-Arm Lat Pulldown',
  'Straight-Arm Pulldown': 'Machine Pullover',
  'Lying T-Bar Row': 'Chest-Supported T-Bar Row',
  'Chest-Supported T-Bar Rows': 'Chest-Supported T-Bar Row',
  'Chest Supported T-Bar Row': 'Chest-Supported T-Bar Row',
  'Chest Supported T-Bar Rows': 'Chest-Supported T-Bar Row',
  'T-Bar Row with Handle': 'T-Bar Row',
  'T-Bar Rows': 'T-Bar Row',
  'Dumbbell Incline Row': 'Chest-Supported Row',

  // Varianten, die sich von einem Namen mit Anker durch einen Buchstaben, eine Klammer oder
  // die Wortstellung unterscheiden. Jede davon ist durch die groben Kategorien gefallen und
  // kam an einem normalen Block als Legend heraus.
  'Butterfly Machine': 'Butterfly',
  'Machine Bicep Curl': 'Machine Biceps Curl',
  'Machine Shoulder (Military) Press': 'Machine Shoulder Press',
  'Dip Machine': 'Machine Dip',
  'Reverse Machine Flyes': 'Machine Rear Delt Fly',
  'Decline Smith Press': 'Smith Machine Bench Press',
  'Smith Machine Decline Press': 'Smith Machine Bench Press',
  'Leverage Shrug': 'Machine Shrug',
  'Smith Machine Shoulder Shrugs': 'Machine Shrug',
  'Smith Machine Behind the Back Shrug': 'Machine Shrug',
  'Leverage Deadlift': 'Smith Machine Deadlift',
  'Smith Machine Dead Lifts': 'Smith Machine Deadlift',
  'Smith Machine Good Mornings': 'Smith Machine Good Morning',
  'Reverse Hyperextension': 'Glute-Biased 45-Degree Back Extension',
  'Smith Machine Pistol Squat': 'Single-Leg Extension',
  'Lying Machine Squat': 'Smith Machine Squat',
  'Lying Squat': 'Smith Machine Squat',
  'Chair Squat': 'Smith Machine Squat',
  'Rope Straight-Arm Pulldown': 'Machine Pullover',
  'Cable Incline Pushdown': 'Machine Pullover',
};

/** Der Name, unter dem die gepflegten Tabellen diese Bewegung kennen. */
export const canonical = (name) => ALIAS[name] || BENCHMARK_ALIAS[name] || name;

/**
 * Bewegungen, bei denen sich eine Last überhaupt nicht einstufen lässt, egal was das Gerät sagt.
 *
 * Eine Maschine für unterstützte Klimmzüge zählt RÜCKWÄRTS: die Zahl am Block ist, wie
 * viel von einem die Maschine trägt, eine höhere Zahl heißt also schwächer. Das einzustufen
 * würde für alle, die sie benutzen, die ganze Leiter umdrehen.
 */
const UNRATEABLE = new Set(['Assisted Pull-Up Machine', 'Reverse Nordic Curl']);

/**
 * Rückfallbereiche für eine Maschine ohne Anker, also eine eigene Übung oder eine aus dem
 * langen Ende der Bibliothek. Dieselben vier veröffentlichten Ankerpunkte wie bei einer
 * Langhantelübung (Einstieg Anfänger, Fortgeschritten, Weit fortgeschritten, Elite), damit
 * sie durch dieselbe Leiter laufen.
 *
 * Die müssen mit MACHINE_ANCHOR im Gleichschritt bleiben und waren es einmal nicht: als die
 * Isolationsmaschinen mit Anker strenger wurden, blieb diese Tabelle zurück. `upperIsolation`
 * lag bei einem Legend von 85 kg, während jede ERKANNTE Isolationsmaschine 110 bis 175
 * verlangte. Die 63 Bewegungen in der Bibliothek ohne Anker wurden so zum leichtesten Weg zu
 * einem Rang in der ganzen App, ein voller Kabelturm beim Handgelenkcurl kam als Radiant
 * heraus. Eine unerkannte Maschine darf nie ein leichterer Weg sein als eine erkannte, und
 * dafür gibt es einen Test.
 */
const MACHINE_BOUNDS = {
  male: {
    upperPress: [0.60, 1.05, 1.60, 2.15], upperPull: [0.68, 1.14, 1.65, 2.16],
    upperIsolation: [0.48, 0.80, 1.19, 1.67], lowerPress: [2.00, 3.20, 4.50, 6.00],
    lowerIsolation: [0.73, 1.23, 1.81, 2.46], hip: [1.25, 2.00, 2.75, 3.60],
    core: [0.50, 0.84, 1.23, 1.68],
  },
  female: {
    upperPress: [0.39, 0.68, 1.05, 1.43], upperPull: [0.45, 0.77, 1.14, 1.50],
    upperIsolation: [0.32, 0.54, 0.83, 1.15], lowerPress: [1.50, 2.45, 3.45, 4.60],
    lowerIsolation: [0.51, 0.87, 1.28, 1.74], hip: [1.00, 1.65, 2.35, 3.10],
    core: [0.36, 0.59, 0.87, 1.19],
  },
};

export function machineCategory(name) {
  const n = String(name || '').toLowerCase();
  if (/(leg press|hack squat|pendulum|belt squat|smith machine squat)/.test(n)) return 'lowerPress';
  if (/(hip thrust|glute drive)/.test(n)) return 'hip';
  if (/(leg extension|leg curl|calf|hip abduction|hip adduction)/.test(n)) return 'lowerIsolation';
  if (/(crunch|back extension)/.test(n)) return 'core';
  if (/(row|pulldown|pull-up|pullover)/.test(n)) return 'upperPull';
  if (/(chest press|bench press|incline press|shoulder press|machine dip|seated dip)/.test(n)) return 'upperPress';
  // Schwere Mehrgelenksmuster zuerst, bevor irgendetwas anderes sie Isolation nennen kann.
  // Kreuzheben an der Multipresse, das im Trizeps-Bereich landet, ist kein Rundungsfehler,
  // das sind drei Ränge.
  if (/(squat|lunge|split squat|step-up)/.test(n)) return 'lowerPress';
  if (/(deadlift|dead lift|good morning|hang clean|power clean|romanian)/.test(n)) return 'hip';
  if (/(shrug|high pull)/.test(n)) return 'upperPull';

  // Dann, welche Körperhälfte. Eine unerkannte Beinmaschine ist früher im Trizeps-Bereich
  // gelandet, und das ist die falsche Richtung für einen Fehler: eine unbekannte Übung für den
  // Unterkörper war damit viel leichter einzustufen als eine bekannte.
  if (/(leg|glute|hamstring|quad|thigh|calf|hip|adduct|abduct)/.test(n)) return 'lowerIsolation';
  if (/(abs|core|oblique|crunch|sit-up|plank)/.test(n)) return 'core';
  if (/(fly|flye|pec|rear delt|lateral raise)/.test(n)) return 'upperIsolation';
  if (/(press|dip)/.test(n)) return 'upperPress';
  return 'upperIsolation';
}

/** Geräte, deren Lasten diese Berechnung einzustufen bereit ist. */
export const RATED_EQUIPMENT = new Set(['Machine', 'Cable']);

/**
 * Freie Gewichte, die über einen Anker eingestuft werden statt über eine eigene Tabelle.
 *
 * Ob etwas bewertbar ist, hing früher nur am Gerät: eine Referenzübung oder Maschine oder
 * Kabel. Die Folge war, dass DIESELBE BEWEGUNG einen Rang bekam oder nicht, je nachdem,
 * was man in der Hand hielt. "Standing Biceps Cable Curl" gab dem Bizeps einen Rang,
 * "Wide-Grip Standing Barbell Curl" gar nichts, und 292 Übungen mit Lang- und Kurzhantel im
 * Katalog trugen zu keinem Muskel und keiner Wertung bei. Das ist keine Frage der
 * Einstellung, das ist ein Filter um die falsche Eigenschaft.
 *
 * Die Reparatur ist mit Absicht klein. Das ist eine ausdrückliche Liste zum Eintragen und
 * nicht der Kategorie-Rückfall, den unbekannte Maschinen bekommen: diese Bereiche sind an
 * Steckgewichten eingestellt, und jede unerkannte Langhantelübung da hineinfallen zu lassen
 * würde Ränge verteilen, die niemand eingestellt hat. Ein Name kommt nur hier hinein, wenn er
 * einen Eintrag in MACHINE_ANCHOR mit der Herleitung daneben hat.
 *
 * Kurzhanteln bleiben draußen, und der Grund ist die Art einzutragen und nicht das Heben: die
 * App speichert eine Hantel, die Zahl auf dem Screen ist also die halbe Arbeit, und wo man
 * diesen Faktor ansetzt, entscheidet der Nutzer und nicht diese Datei.
 */
export const DERIVED_FREE_WEIGHT = new Set(['Barbell Curl']);

/**
 * Kann diese Bewegung überhaupt einen Rang tragen? Die eine Stelle, die das beantwortet.
 *
 * Die Regel stand früher an drei Stellen von Hand ausgeschrieben, `buildRating` hier und
 * zweimal in history.js für die Linie im Fortschritt, und die Kopien waren schon
 * auseinandergelaufen: die zwei in history.js haben direkt das Gerät geprüft und damit still
 * jede Übung mit Scheiben fallen lassen, die `ratedMachineNames` gerade zugelassen hatte.
 * Freie Gewichte in nur eine Kopie aufzunehmen hätte Home und Fortschritt richtig
 * auseinandergerissen, derselbe Langhantelcurl auf einem Screen eingestuft und auf dem
 * anderen unsichtbar. Eine Funktion, drei Aufrufer, kein Auseinanderlaufen.
 *
 * @param name          der Katalogname der Übung
 * @param machineNames  das Set aus `ratedMachineNames` für diesen Katalog
 */
export const isRateable = (name, machineNames) => !!name
  && (isBenchmark(name) || machineNames.has(name) || DERIVED_FREE_WEIGHT.has(canonical(name)));

/**
 * Bewegungen mit echten Scheiben an einer echten Stange, egal welches Gerät der Katalog nennt.
 *
 * Ein T-Bar-Rudern mit Bruststütze ist keine Maschine mit Block, sondern eine Langhantel mit
 * Polster, und eingetragen werden Scheiben. Das zählt dreimal. Die Regel mit dem vollen
 * Block sagt dazu nichts, weil es keinen Block gibt, den man ausreizen könnte. Die Korrektur
 * "die Hälfte zählen" betrifft eine Anzeige, die beide Seiten auf einmal zeigt, und das tut
 * eine Stange mit Scheiben nicht. Und auf der Muskelkarte soll sie einen Gleichstand
 * gewinnen wie eine Langhantel, weil sie eine ist.
 *
 * Einstufbar muss sie auch überhaupt sein: mehrere davon sind im Katalog als `Barbell`
 * markiert und fielen damit ganz aus RATED_EQUIPMENT, ein T-Bar-Rudern mit Scheiben
 * erzeugte also gar keinen Rang.
 */
export const PLATE_LOADED = new Set([
  'T-Bar Row', 'Chest-Supported T-Bar Row', 'Chest-Supported Row', 'Lying T-Bar Row',
  'T-Bar Row with Handle', 'Plate-Loaded Pullover', 'Leverage Deadlift',
  'Iso-Lateral Chest Press', 'Iso-Lateral Incline Chest Press', 'Iso-Lateral Shoulder Press',
  'Iso-Lateral High Row', 'Iso-Lateral Low Row',
  'Hack Squat', 'Pendulum Squat', 'Belt Squat', 'Smith Machine Squat',
  'Smith Machine Bench Press', 'Smith Machine Incline Bench Press',
  'Smith Machine Romanian Deadlift', 'Smith Machine Deadlift', 'Smith Machine Good Morning',
]);

export const isPlateLoaded = (name) => PLATE_LOADED.has(canonical(name)) || PLATE_LOADED.has(name);

/**
 * Jeder Übungsname, dessen Last ohne veröffentlichten Standard einen Rang bekommt.
 *
 * Kabel waren früher ganz ausgeschlossen. Still hieß das, dass Trizepsdrücken, Kabelrudern
 * und ein Bayesian Curl gar nichts wert waren: derselbe Block, derselbe Stift, eingestuft
 * oder nicht, je nachdem, auf welcher Seite des Gestells die Rolle angeschraubt war.
 */
export function ratedMachineNames(exercises = []) {
  return new Set(exercises
    .filter((ex) => (RATED_EQUIPMENT.has(ex.equipment) || isPlateLoaded(ex.name))
      && !isBenchmark(ex.name) && !UNRATEABLE.has(ex.name))
    .map((ex) => ex.name));
}

/* ===================== die Leiter ===================== */

const geo = (a, b) => Math.sqrt(a * b);

/**
 * Faktoren auf den veröffentlichten Elite-Standard für die drei Ränge darüber.
 *
 * Hier oben gibt es nichts zu interpolieren, das ist also der eine wirklich hochgerechnete
 * Teil der Leiter, und er steht in einer eigenen Tabelle, wo man das sieht. Eingestellt
 * gegen Wettkämpfe und nicht gegen einen Trainingsstandard: bei 80 kg Körpergewicht ist
 * Radiant 248 kg Bankdrücken, 331 kg Kniebeuge und 375 kg Kreuzheben, also in der Nähe eines
 * Landesrekords und keine Zahl, die jemand zufällig erreicht.
 */
const BEYOND_ELITE = [1.10, 1.22, 1.38];

/**
 * Vier veröffentlichte Anker -> die elf Grenzen der Leiter mit zwölf Rängen.
 *
 * Jede veröffentlichte Zahl behält ihre Bedeutung, die neuen Ränge werden dazwischen
 * geschoben und ersetzen sie nicht:
 *
 *   Silver      = etwas mehr als die Hälfte des Anfängerstandards
 *   Gold        = veröffentlicht: Anfänger
 *   Platinum    = zwischen Anfänger und Fortgeschritten
 *   Diamond     = veröffentlicht: Fortgeschritten
 *   Master      = zwischen Fortgeschritten und Weit fortgeschritten
 *   Grandmaster = veröffentlicht: Weit fortgeschritten
 *   Elite       = zwischen Weit fortgeschritten und Elite
 *   Legend      = veröffentlicht: Elite
 *   Challenger / Immortal / Radiant = BEYOND_ELITE, über jeder Tabelle
 *
 * Geometrische statt arithmetische Mitten, weil Kraftstandards multiplikativ sind: der
 * Schritt vom 1,25- zum 1,75-Fachen des Körpergewichts ist mehr Arbeit als dieselben 0,5
 * weiter unten, und die Hälfte, die man wirklich erlebt, ist das Verhältnis, nicht die Differenz.
 */
export function ladder(anchors) {
  const [novice, intermediate, advanced, elite] = anchors;
  return [
    novice * 0.55, novice, geo(novice, intermediate), intermediate,
    geo(intermediate, advanced), advanced, geo(advanced, elite), elite,
    ...BEYOND_ELITE.map((factor) => elite * factor),
  ];
}

/** Ränge, hinter denen gar kein veröffentlichter Standard steht. */
export const EXTRAPOLATED_TIERS = new Set(['challenger', 'immortal', 'radiant']);

/**
 * Alles in dieser Datei ist in Kilo, die App aber nicht.
 *
 * Die veröffentlichten Standards sind Vielfache des Körpergewichts gegen eine Referenz von
 * 60 oder 80 kg, und durch den allometrischen Exponenten ist die Rechnung NICHT
 * einheitenfrei: Pfund hineinzugeben hebt sich nicht auf, es bläht auf. Derselbe Mensch
 * kam in Pfund eingetragen anderthalb Ränge stärker heraus als in Kilo, still, solange es
 * die Einstellung gibt. Das Verhältnis wird also immer in Kilo gerechnet, egal was die App
 * anzeigt, und was an einen Screen zurückgeht, wird umgerechnet.
 */
const LB_PER_KG = 2.2046226218;
const toKg = (value, units) => (units === 'lb' ? Number(value) / LB_PER_KG : Number(value));
const fromKg = (value, units) => (units === 'lb' ? value * LB_PER_KG : value);

/**
 * Wo eine Last auf der Skala liegt, gegen die die Standards geschrieben sind.
 *
 * Zwei Formen, und welche gilt, ist eine Eigenschaft der Übung.
 *
 * ALLOMETRISCH, für alles mit einer Last, die man wählt. Der Muskelquerschnitt wächst mit
 * etwa der Masse hoch zwei Drittel, von jemand Schwererem erwartet man also absolut mehr
 * und pro Kilo eigenem Gewicht weniger. Das Referenzgewicht ist das, bei dem die
 * veröffentlichten Tabellen geschrieben wurden, wer genau so viel wiegt, bekommt also
 * genau das, was die Tabelle sagt.
 *
 * RELATIV ZUM KÖRPERGEWICHT, für Klimmzüge, Chin-Ups und Dips, wo die Last der Mensch IST.
 * Die allometrische Form zählt dort das Körpergewicht auf beiden Seiten des Bruchs, und die
 * heben sich nicht auf: ohne Zusatzgewicht bleibt `(bw / reference) ^ 0.33`, eine Zahl, die
 * von nichts abhängt als der Waage im Bad. Das Ergebnis war ein Rang, der STIEG, wenn man
 * zugenommen hat und genauso viele Klimmzüge schaffte wie vorher: drei Stufen, von Silver I
 * bei 70 kg zu Gold II bei 100 kg, für dieselbe einzelne Wiederholung. Jede andere Übung in
 * der App bewegt sich andersherum, zu Recht, und die Wirklichkeit auch.
 *
 * Ein einfaches Vielfaches des Körpergewichts ist auch die Form, in der genau diese
 * Standards veröffentlicht werden ("weit fortgeschritten = 1,55 x Körpergewicht"), und am
 * Referenzgewicht stimmt es genau mit der allometrischen Form überein. Nichts, was dort
 * eingestellt wurde, bewegt sich.
 */
export function strengthRatio(oneRepMax, profile, { bodyweightRelative = false } = {}) {
  const sex = profile.sex === 'female' ? 'female' : 'male';
  const bw = toKg(profile.bodyweight, profile.units);
  const load = toKg(oneRepMax, profile.units);
  if (!bw || bw <= 0 || !load) return null;
  if (bodyweightRelative) return load / bw;
  const referenceBw = sex === 'female' ? 60 : 80;
  return load / (Math.pow(bw, 0.67) * Math.pow(referenceBw, 0.33));
}

/** Die Umkehrung von strengthRatio, in der Einheit, die die App gerade zeigt. */
export function weightForRatio(ratio, profile, { bodyweightRelative = false } = {}) {
  const sex = profile.sex === 'female' ? 'female' : 'male';
  const bw = toKg(profile.bodyweight, profile.units);
  if (!bw || bw <= 0) return null;
  if (bodyweightRelative) return fromKg(ratio * bw, profile.units);
  const referenceBw = sex === 'female' ? 60 : 80;
  return fromKg(ratio * Math.pow(bw, 0.67) * Math.pow(referenceBw, 0.33), profile.units);
}

/** Ist die Last dieser Übung der eigene Körper? Dann siehe `strengthRatio`. */
const carriesOwnBodyweight = (liftName) => BODYWEIGHT_INCLUSIVE.has(benchmarkName(liftName));

/**
 * Die Kraft ist etwa zwischen 20 und 35 am höchsten. Ältere bekommen einen entsprechend
 * leichteren Standard, unter 20-Jährige einen etwas leichteren.
 */
export function ageFactor(age) {
  const a = Number(age);
  if (!a || a <= 0) return 1;
  if (a < 20) return 0.95;
  if (a <= 35) return 1;
  return Math.max(0.72, 1 - (a - 35) * 0.006);
}

/**
 * Durchgehende Wertung von 0 bis 100 über die acht Grenzen.
 *
 * Die Bereiche sind gleich breit, die Wertung sagt also den Rang und wie weit man darin
 * ist. Über der letzten Grenze steigt die Wertung über weitere 25 % des obersten Standards
 * bis 100, dadurch ist Legend keine Wand, sobald man es erreicht hat.
 */
function scoreFromBounds(ratio, bounds) {
  const band = 100 / (bounds.length + 1);
  if (ratio < bounds[0]) return Math.max(0, band * (ratio / bounds[0]));
  for (let i = 1; i < bounds.length; i++) {
    if (ratio < bounds[i]) return band * (i + (ratio - bounds[i - 1]) / (bounds[i] - bounds[i - 1]));
  }
  const top = bounds[bounds.length - 1];
  return Math.min(100, band * bounds.length + band * Math.min(1, (ratio - top) / (top * 0.25)));
}

/** scoreFromBounds umgedreht: das Verhältnis, das eine Zielwertung verlangt. */
function ratioFromScore(score, bounds) {
  const band = 100 / (bounds.length + 1);
  const i = Math.floor(score / band);
  const frac = score / band - i;
  if (i <= 0) return bounds[0] * frac;
  if (i >= bounds.length) return bounds[bounds.length - 1] * (1 + 0.25 * Math.min(1, frac));
  return bounds[i - 1] + (bounds[i] - bounds[i - 1]) * frac;
}

/**
 * Die acht Grenzen für eine Übung, ans Alter angepasst, oder null, wenn die Übung gar keinen
 * Standard hat. `machine` entscheidet, welche Tabelle gefragt wird.
 */
export function boundsFor(liftName, profile, { machine = false, community = null } = {}) {
  const sex = profile.sex === 'female' ? 'female' : 'male';
  const f = ageFactor(profile.age);

  if (!machine) {
    const base = benchmarkName(liftName);
    const table = BOUNDS[sex][BENCHMARK_BASE[base] || base];
    return table ? ladder(table).map((v) => v * f) : null;
  }

  if (UNRATEABLE.has(canonical(liftName))) return null;

  const anchor = MACHINE_ANCHOR[canonical(liftName)];
  let seed;
  if (anchor && BOUNDS[sex][anchor[0]]) seed = BOUNDS[sex][anchor[0]].map((v) => v * anchor[1]);
  else seed = MACHINE_BOUNDS[sex][machineCategory(canonical(liftName))];

  // Perzentile der Gemeinschaft zum selben Modell, in die vier Anker gemischt, bevor daraus
  // die Leiter gebaut wird. Die Cloud speichert vier Quantile, und genau in dieser Form
  // kommen die veröffentlichten Tabellen.
  const observed = community && [community.q20, community.q40, community.q60, community.q80].map(Number);
  if (Number(community?.count) >= 10 && observed?.every((v, i) => v > 0 && (!i || v > observed[i - 1]))) {
    // Die Startdaten verschwinden nie ganz, auch ein beliebtes Modell kann eine schiefe
    // Nutzerschaft haben. Bei 100 Beobachtungen trägt die Gemeinschaft 80 % bei.
    const blend = Math.min(0.8, 0.15 + (Number(community.count) - 10) / 90 * 0.65);
    seed = seed.map((v, i) => v * (1 - blend) + observed[i] * blend);
  }
  return ladder(seed).map((v) => v * f);
}

/**
 * Wie sehr einem Rang getraut wird, der außerhalb des gültigen Wiederholungsbereichs
 * gebaut wurde.
 *
 * Nicht null: wer eine Maschine immer nur mit fünfzehn Wiederholungen trainiert, soll einen
 * Rang bekommen und kein leeres Feld. Aber auch nicht eins, und die Zahl ist absichtlich so
 * groß wie der Maschinenabschlag, den sie ersetzt hat, weil die Unsicherheit dieselbe Art
 * ist: eine echte Messung, gelesen durch eine Formel, die dafür nicht gemacht ist.
 */
const EXTRAPOLATED_CONFIDENCE = 0.85;

/** Wie sehr einem freien Gewicht getraut wird, das über den Standard von etwas anderem eingestuft ist. */
const DERIVED_CONFIDENCE = 0.9;

/** Wie sehr dem Rang einer Maschine auf der gemeinsamen Muskelkarte getraut wird. */
export function machineConfidence(liftName, community = null) {
  if (Number(community?.count) >= 10) return 1;
  return MACHINE_ANCHOR[canonical(liftName)] ? 1 : 0.9;
}

export function scoreForMachine(liftName, oneRepMax, profile, community = null) {
  const ratio = strengthRatio(oneRepMax, profile);
  if (ratio === null) return null;
  const bounds = boundsFor(liftName, profile, { machine: true, community });
  return bounds ? scoreFromBounds(ratio, bounds) : null;
}

export function scoreFor(liftName, oneRepMax, profile) {
  const ratio = strengthRatio(oneRepMax, profile,
    { bodyweightRelative: carriesOwnBodyweight(liftName) });
  if (ratio === null) return null;
  const bounds = boundsFor(liftName, profile, { machine: false });
  return bounds ? scoreFromBounds(ratio, bounds) : null;
}

/**
 * Referenzübungen, deren Standard wackliger ist als der Rest, und warum.
 *
 * Die Beinpresse ist hier das ehrliche Problem: Standards dafür gibt es und sie sind weit
 * verbreitet, aber die Last hängt komplett an Hebel und Schlittengewicht der Maschine, und
 * die sind sehr verschieden. Zwei Leute, die an verschiedenen Maschinen dieselbe Zahl
 * drücken, leisten nicht dieselbe Arbeit. Der Rang bleibt, weil ein Quadrizeps ohne Rang
 * für jemanden an Maschinen schlimmer ist, aber der Hinweis geht überall mit, wo er steht.
 */
export const LOW_CONFIDENCE = {
  // Ein Schlüssel, kein Satz. Hier stand früher fertiger englischer Text, der direkt auf den
  // Screen kam. Damit war das die eine Zeile der deutschen Oberfläche, die nicht Deutsch war,
  // und der i18n-Test hat sie nicht gesehen, weil er nur strings.js liest.
  'Leg Press': 'standards.lowConfidence.legPress',
};

/**
 * Das Epsilon gibt es, weil 100/9 nicht glatt aufgeht.
 *
 * Eine Übung genau auf einem veröffentlichten Anker ergibt genau `n × BAND`, und ohne das
 * kommt die Division als 5,999999 zurück und druckt den Rang darunter. Das ist keine
 * Rundungsvorliebe, sondern der Unterschied zwischen "du hast Grandmaster erreicht" und "hast du nicht".
 */
const EPS = 1e-9;

export const tierIndex = (score) =>
  score === null || score === undefined
    ? null
    : Math.max(0, Math.min(TIERS.length - 1, Math.floor(score / BAND + EPS)));

export const tierOf = (score) => {
  const i = tierIndex(score);
  return i === null ? null : TIERS[i];
};

/**
 * Rang, Division und wie weit man in der Division ist.
 *
 * `step` ist die absolute Position auf der Leiter mit 27 Stufen, das ist die Zahl zum
 * Vergleichen über die Zeit: der eine Wert, der jedes Mal genau um eins steigt, wenn es
 * etwas zu feiern gibt.
 */
export function rankOf(score) {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  const i = tierIndex(score);
  const into = Math.max(0, Math.min(0.999999, (score - i * BAND) / BAND));
  const d = Math.min(DIVISIONS.length - 1, Math.floor(into * DIVISIONS.length + EPS));
  return {
    tier: TIERS[i],
    tierIndex: i,
    division: DIVISIONS[d],
    divisionIndex: d,
    /** 0 bis 1, wie weit in der aktuellen Division. */
    progress: into * DIVISIONS.length - d,
    step: i * DIVISIONS.length + d + 1,
    steps: RANK_STEPS,
    top: i === TIERS.length - 1 && d === DIVISIONS.length - 1,
  };
}

/** Die Wertung, bei der die nächste Division und der nächste Rang anfangen. */
export function nextThresholds(score) {
  const rank = rankOf(score);
  if (!rank) return null;
  const divisionScore = (rank.tierIndex * DIVISIONS.length + rank.divisionIndex + 1) * (BAND / DIVISIONS.length);
  const tierScore = (rank.tierIndex + 1) * BAND;
  return {
    division: rank.top ? null : divisionScore,
    tier: rank.tierIndex >= TIERS.length - 1 ? null : tierScore,
  };
}

/**
 * Die Last, die eine Zielwertung verlangt, in Kilo auf der Stange.
 *
 * Bei einer Bewegung mit Körpergewicht ist der Standard gegen das ganze System geschrieben,
 * die Antwort ist also, was man DRAUFLEGEN muss, und das nimmt ein Klimmzuggürtel.
 */
export function weightForScore(liftName, targetScore, profile, { machine = false, community = null } = {}) {
  const bounds = boundsFor(liftName, profile, { machine, community });
  if (!bounds) return null;
  const relative = carriesOwnBodyweight(liftName);
  let need = weightForRatio(ratioFromScore(targetScore, bounds), profile,
    { bodyweightRelative: relative });
  if (need === null) return null;
  if (relative) need -= Number(profile.bodyweight);
  return need;
}

/** Wie viele kg noch bis zum nächsten Rang fehlen, oder null ganz oben. */
export function toNextTier(liftName, score, profile, opts = {}) {
  const next = nextThresholds(score);
  if (!next || next.tier === null) return null;
  const weight = weightForScore(liftName, next.tier, profile, opts);
  return weight === null ? null : { tier: TIERS[tierIndex(score) + 1], weight };
}

/** Wie viele kg noch bis zur nächsten Division fehlen, der kleine, häufige Erfolg. */
export function toNextDivision(liftName, score, profile, opts = {}) {
  const next = nextThresholds(score);
  if (!next || next.division === null) return null;
  const weight = weightForScore(liftName, next.division, profile, opts);
  if (weight === null) return null;
  const rank = rankOf(next.division + 0.0001);
  return { tier: rank.tier, division: rank.division, weight };
}

/**
 * Wie stark eine Übung eine Region trainieren muss, bevor die Region als gemessen gilt.
 *
 * Das gibt es wegen eines Denkfehlers, der lange drin war. Die Wertung einer Region ist
 * `Wertung der Übung × wie stark die Übung sie trainiert`, und diese zweite Zahl ist ein
 * BEITRAGS-Gewicht: wie stark die Kniebeuge die Beinbeuger reizt. Gelesen wurde sie aber
 * als Abschlag auf die STÄRKE. Wer als einzigen Beleg für die Beinbeuger eine Kniebeuge
 * hatte, bekam Beinbeuger = 35 % seines Kniebeuge-Rangs, und das ging direkt in den Durchschnitt.
 *
 * Die Wirkung war heftig und ging nur in eine Richtung. Bei einem echten Log lagen die
 * direkt trainierten Regionen im Schnitt bei 53, die sechs, die nur über einen Nebenbeitrag
 * gelesen wurden, bei 14 bis 30, und die Gesamtwertung fiel von Grandmaster auf Diamond. Die
 * App hat nicht gesagt, dass die Beinbeuger schwach sind. Sie hat gesagt, dass sie nie
 * hingeschaut hat, nur in einem Ton, der wie ein Urteil klang.
 *
 * Das Gewicht ist deshalb jetzt eine SCHWELLE und kein FAKTOR. Ab diesem Wert treibt die
 * Übung die Region hauptsächlich oder fast hauptsächlich an, und die Region bekommt einfach
 * den Rang der Übung, ohne Abschlag: ist das Schrägbankdrücken Grandmaster, ist die Brust
 * Grandmaster und nicht 95 % davon. Darunter gibt es gar keinen Rang. Die Region wird als
 * indirekt berührt gemeldet, mit Namen, und bleibt grau.
 *
 * Dieser letzte Teil hat zwei Anläufe gebraucht. Die Regionen aus dem DURCHSCHNITT zu
 * nehmen reichte nicht, weil die abgeschlagene Zahl weiter auf der Karte und im Sheet der
 * Region stand. Ein Trapez mit "Diamond II", gerechnet als `Rang beim Rudern x 0,7`, ist kein
 * schwacher Trapez, sondern Rudern.
 */
export const DIRECT_CONTRIBUTION = 0.8;

/**
 * Wertung je Region und insgesamt.
 *
 * Die Wertung einer Region ist das Beste aus (Wertung der Übung × wie stark die Übung sie
 * trainiert) über die Übungen, die man wirklich macht. Das Maximum statt eines
 * Durchschnitts heißt, dass eine ausgelassene Übung eine Region nicht runterzieht, eine
 * Region, die man nie trainiert, bleibt aber unbewertet, statt null zu bekommen.
 *
 * Maschinen zählen jetzt voll, weil sie endlich einen Standard haben, der sich zu zählen
 * lohnt (siehe MACHINE_ANCHOR). Freie Gewichte gewinnen trotzdem einen Gleichstand: bringen
 * eine Langhantelübung und eine Maschine eine Region auf dieselbe Zahl, wird die Übung als
 * Quelle genannt, die gegen einen veröffentlichten Standard gemessen ist.
 *
 * @param bestByLift Map Übungsname -> bestes geschätztes 1RM
 */
/**
 * Wie weit eine Übung über dem Rest des eigenen Trainings liegen muss, bevor die App etwas
 * sagt. Zwei ganze Ränge.
 *
 * Der Fall, für den es das gibt: eine Maschine, die den ganzen Block anzeigt, während jeder
 * Arm die Hälfte bewegt, ein Gestell mit Scheiben, das als Summe beider Seiten eingetragen
 * ist, oder ein Block in Pfund, der als Kilo eingetippt wird. Alle drei ergeben eine Zahl,
 * die für die Maschine stimmt und für den Standard falsch ist, und das Anzeichen hat immer
 * dieselbe Form: eine Bewegung steht mehrere Ränge über allem anderen, was dieselbe Person macht.
 *
 * Es ist eine Frage und nie eine Korrektur. Die App weiß nicht, welcher der drei Fälle es
 * ist oder ob jemand einfach unfassbare Schultern hat. Sie sagt also, was ihr aufgefallen
 * ist, und bietet die Lösung an, statt sie anzuwenden.
 */
const OUTLIER_RANKS = 2;

/** Bei weniger bewerteten Übungen als hier kann es keinen Ausreißer geben, die Liste ist zu kurz. */
const OUTLIER_MIN_PEERS = 3;

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * @param loadFactors  Name -> Faktor, mit dem die Schätzung vor dem Einstufen multipliziert
 *                     wird. Das korrigiert, wie eine Maschine Last ANZEIGT. Das Log selbst
 *                     wird nie angefasst, denn was eingetippt wurde, wurde gemacht.
 * @param stackMax     Name -> das Höchste, was der Block hergibt, wenn der Nutzer es gesagt
 *                     hat. Macht aus "das sieht hoch aus" ein "das ist das 1,7-Fache eines
 *                     vollen Blocks", und das ist ein Beleg statt eines Bauchgefühls.
 * @param regionsByName Name -> { Region: Gewicht }, aus den Übungen selbst. Der Rückfall
 *                     für alles, was die gepflegte Tabelle ANATOMY nie gehört hat.
 */
export function buildRating(bestByLift, profile,
  {
    machineNames = new Set(), community = {},
    extrapolated = bestByLift.extrapolated, achievedAt = bestByLift.achievedAt,
    loadFactors = {}, stackMax = {}, regionsByName = {},
  } = {}) {
  const regions = {};
  // Regionen, die keine Übung stark genug antreibt, um sie einzustufen, und die beste Übung,
  // die sie berührt. Absichtlich keine Wertung: eine Zahl hier war die Ursache des Fehlers,
  // den das ersetzt hat.
  const indirect = {};
  // Jede Übung, die eine Region einstufen KÖNNTE, damit die Wertung sagen kann, ob ein Rang
  // abgesichert ist oder an einer Bewegung hängt.
  const support = {};
  const lifts = [];
  const outside = extrapolated instanceof Set ? extrapolated : new Set();
  const dates = achievedAt instanceof Map ? achievedAt : new Map();

  for (const [rawName, rawOrm] of bestByLift) {
    const name = rawName;
    const factor = Number(loadFactors[name]) > 0 ? Number(loadFactors[name]) : 1;
    const orm = rawOrm * factor;
    // Zwei verschiedene Fragen. `anchored` entscheidet, aus welcher Tabelle die Wertung gelesen
    // wird, alles ohne eigenen veröffentlichten Standard geht über MACHINE_ANCHOR. `machine`
    // sagt, was die Übung IST, und bleibt bei einem freien Gewicht false, damit ein
    // Langhantelcurl einen Gleichstand gewinnt wie das freie Gewicht, das er ist, und nie unter
    // "deine Maschinenrekorde" auftaucht.
    const derivedFree = !isBenchmark(name) && DERIVED_FREE_WEIGHT.has(canonical(name));
    const machine = machineNames.has(name) && !isBenchmark(name);
    const anchored = machine || derivedFree;
    if (!isRateable(name, machineNames)) continue;
    const score = anchored
      ? scoreForMachine(name, orm, profile, community[name])
      : scoreFor(name, orm, profile);
    if (score === null) continue;
    const sample = Number(community[name]?.count) || 0;
    // `anchored`, nicht `machine`: das entscheidet, aus welcher Tabelle das NÄCHSTE Ziel
    // gelesen wird, und das muss dieselbe sein, aus der die Wertung kam. Mit `machine` hat ein
    // Langhantelcurl nach seinem eigenen veröffentlichten Standard gesucht, nichts gefunden
    // und bei einer Übung auf Master II mit noch sechs Rängen darüber "oberstes Ende der
    // Leiter erreicht" gedruckt.
    const opts = { machine: anchored, community: community[name] || null };
    lifts.push({
      name, oneRepMax: orm, score, tier: tierOf(score), rank: rankOf(score),
      next: toNextTier(name, score, profile, opts),
      nextDivision: toNextDivision(name, score, profile, opts),
      machine, plateLoaded: isPlateLoaded(name),
      derived: machine && !!MACHINE_ANCHOR[canonical(name)],
      provisional: machine && sample < 10, sample,
      // Aus einem Satz außerhalb des Bereichs gebaut, in dem eine 1RM-Schätzung gilt, weil
      // diese Übung nie darin trainiert wurde. Siehe THRESHOLDS.e1rmWindow.
      extrapolated: outside.has(name),
      // Wann der Bestwert gemacht wurde. Ein Rang ist ein Rekord aller Zeiten, und ein Rekord
      // hat ein Datum, sonst wird er als etwas ausgegeben, was er nicht ist.
      achievedAt: dates.get(name) ?? null,
      corrected: factor !== 1,
      // Mehr als der Block körperlich hergeben kann, nachdem der Spielraum von Epley bei
      // einer Wiederholung abgezogen ist. Nur beantwortbar, wenn der Nutzer gesagt hat, wo der
      // Block aufhört.
      overStack: Number(stackMax[name]) > 0 && orm > Number(stackMax[name]) * 1.4
        ? { max: Number(stackMax[name]), times: orm / Number(stackMax[name]) }
        : null,
    });

    // Erst die gepflegte Anatomie, dann die Regionen, die die Übung selbst mitbringt. Ohne
    // den Rückfall haben 52 Maschinen- und Kabelübungen im mitgelieferten Katalog einen Rang
    // erzeugt und zu keinem Muskel beigetragen: sie hatten keinen gepflegten Eintrag, die
    // Muskelkarte hat sie also nie gesehen. Diese Regionen kommen aus dem Eintrag in der
    // Bibliothek, nicht aus Raterei am Namen.
    const anatomy = ANATOMY[canonical(name)] || regionsByName[name] || {};
    for (const [region, weight] of Object.entries(anatomy)) {
      if (weight < DIRECT_CONTRIBUTION) {
        // Berührt, nicht gemessen. Nach Namen gemerkt, damit die Karte sagen kann, welche
        // Übung sie erreicht, und ohne jede Wertung.
        const seen = indirect[region];
        if (!seen || score > seen.score) indirect[region] = { via: name, score };
        continue;
      }
      // Wie weit man dieser Übung trauen kann, und das ist eine andere Frage als wie stark sie
      // einen macht. Früher wurde das in die Zahl hineinmultipliziert, und dann stand dieselbe
      // Übung mit zwei verschiedenen Rängen auf dem Screen: eine Brustpresse, mit fünfzehn
      // Wiederholungen trainiert, war in der Liste Diamond I und auf der Muskelkarte Diamond
      // III, zwei Ränge auseinander, und nirgends stand warum. Unsicherheit über eine Messung
      // ist kein Beleg für Schwäche, und wer nur Maschinen hat, hat still einen Rang für die
      // Geräte bezahlt, die sein Studio zufällig hat.
      //
      // Es macht also, was eine Sicherheit machen sollte: es entscheidet, wie stark diese
      // Region am Gesamtdurchschnitt zieht, und fährt an der Region mit, damit die Karte sie
      // markieren kann. Der Rang selbst ist der Rang.
      const confidence = (machine ? machineConfidence(name, community[name])
        // Ein freies Gewicht, das über den Standard von etwas anderem gelesen wird, ist eine
        // abgeleitete Zahl und wiegt auch so. Weil der Abschlag jetzt im Durchschnitt steckt und
        // nicht in der Wertung, sieht man trotzdem den Rang, den man verdient hat.
        : derivedFree ? DERIVED_CONFIDENCE : 1)
        * (outside.has(name) ? EXTRAPOLATED_CONFIDENCE : 1);
      const value = score;
      const held = regions[region];
      // Gleichstände gehen an den veröffentlichten Standard: eine Maschine nimmt einer
      // Langhantelübung eine Region nur ab, wenn sie wirklich besser ist.
      // Eine Stange mit Scheiben zählt beim Gleichstand als freies Gewicht, weil sie eins
      // ist. Nur ein Block verliert einen Gleichstand gegen einen veröffentlichten Standard.
      const stack = machine && !isPlateLoaded(name);
      // Jeder passende Treiber wird gemerkt, nicht nur der Sieger. Der Rang selbst ist
      // weiterhin der beste davon (siehe unten), aber wie viele es sind und wie weit sie
      // auseinanderliegen, ist der nützliche Teil, den eine einzelne Zahl versteckt.
      (support[region] ||= []).push({ name, score: value });
      const better = !held || value > held.score
        || (!stack && held.stack && value >= held.score)
        // Ein exakter Gleichstand zwischen zwei Übungen derselben Art geht an die, bei der
        // sich die App sicherer ist. Das ist das Einzige, was sie noch trennt, seit die
        // Sicherheit die Wertung nicht mehr bewegt.
        || (value === held.score && confidence > held.confidence);
      if (better) {
        regions[region] = { score: value, via: name, machine, stack, confidence,
          provisional: machine && sample < 10, sample,
          extrapolated: outside.has(name),
        };
      }
    }
  }

  lifts.sort((a, b) => b.score - a.score);

  // Jetzt, wo jede Übung eine Wertung hat, fragen, welche nicht dazupasst. Eine Übung ist nur
  // ihr eigener Ausreißer: verglichen wird mit dem Median der anderen, damit sich eine sehr
  // starke Bewegung nicht hinter sich selbst verstecken kann.
  for (const lift of lifts) {
    const peers = lifts.filter((other) => other !== lift).map((other) => other.score);
    if (peers.length < OUTLIER_MIN_PEERS) continue;
    const middle = median(peers);
    const gap = lift.score - middle;
    if (gap >= OUTLIER_RANKS * BAND) {
      lift.outlier = { gap, ranks: gap / BAND, median: middle };
    }
  }

  const rated = Object.values(regions);
  // Insgesamt ist der Mittelwert der DIREKT gemessenen Regionen. Eine unbewertete Region ist
  // keine Null, sondern fehlende Information, und eine Region, die man nur durch die Übung
  // von etwas anderem sieht, ist viel näher an fehlender Information als an einer Messung,
  // siehe DIRECT_CONTRIBUTION. Wurde gar nichts direkt trainiert, fällt es auf alles
  // Bewertete zurück. Das ist dann ein ganz neues Log und kein echter Trainingsverlauf, und
  // eine Zahl ist dort besser als ein leeres Feld.
  // Eine Region, die eingestuft ist, braucht nicht noch einen Hinweis "nur berührt".
  for (const region of Object.keys(regions)) delete indirect[region];
  // Und die Wertung, mit der die beste berührende Übung gewählt wurde, verlässt diese
  // Funktion nicht. Sie ist da, um einen Gleichstand zwischen zwei Übungen zu brechen, nicht
  // um gedruckt zu werden, und eine Zahl, an die man von außen kommt, landet irgendwann auf
  // einem Screen. Genau das war der Fehler, den diese ganze Regel ersetzt hat.
  const touched = {};
  for (const [region, seen] of Object.entries(indirect)) touched[region] = { via: seen.via };
  const counted = rated;

  /**
   * Ein Rang ist die beste gezeigte Leistung, und das hier sagt, wie gut er abgesichert ist.
   *
   * Absichtlich kein Durchschnitt. Die Bewegungen zu mitteln, die einen Muskel trainieren,
   * bestraft es, mehrere zu haben: wer schwer drückt und dazu zwei leichte Flys als
   * Zusatzübung macht, läge unter jemandem, der nur drückt. Das widerspricht der
   * Planbewertung (die belohnt zwei Bewegungen pro Muskel) und dem gesunden Verstand, denn die
   * Brust drückt ja immer noch, was sie drückt. Und der Fall mit nur einer Bewegung, gegen den
   * ein Durchschnitt schützen soll, ist schon abgedeckt: ein Ausreißer, der allem anderen
   * widerspricht, wird markiert, und es wird eine Korrektur angeboten.
   *
   * Die Zahl bleibt also der beste Treiber, und die Streuung fährt nebenher. In einem echten
   * Log waren die gut abgedeckten Regionen über je drei Bewegungen auf einen halben Rang
   * einig, der Quadrizeps lag zwischen Kniebeuge und Beinstrecker 1,3 Ränge auseinander. Das
   * lohnt sich laut zu sagen. In einem Mittelwert versteckt wäre daraus eine Zahl geworden,
   * die keins von beidem beschreibt.
   */
  for (const [region, drivers] of Object.entries(support)) {
    if (!regions[region]) continue;
    const scores = drivers.map((d) => d.score);
    regions[region].drivers = drivers.length;
    regions[region].spread = drivers.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0;
  }
  // Nach Sicherheit gewichtet statt einfach gezählt. Eine Region, gemessen über eine
  // Maschine, die niemand eingestellt hat, sagt trotzdem etwas, und sie wegzulassen ließe
  // jemanden nur mit Maschinen ganz ohne Gesamtwertung. Sie so viel zählen zu lassen wie
  // Bankdrücken gegen eine veröffentlichte Tabelle hieße, so zu tun, als wären beide
  // Messungen gleich gut. Das hier ist die eine Stelle, an die der Abschlag gehört.
  const totalWeight = counted.reduce((n, r) => n + (r.confidence ?? 1), 0);
  const overall = totalWeight
    ? counted.reduce((n, r) => n + r.score * (r.confidence ?? 1), 0) / totalWeight
    : null;

  return {
    regions,
    lifts,
    overall,
    overallTier: overall === null ? null : tierOf(overall),
    overallRank: overall === null ? null : rankOf(overall),
    indirect: touched,
    ratedRegions: counted.length,
    indirectRegions: Object.keys(touched).length,
    totalRegions: Object.keys(REGIONS).length,
  };
}

/**
 * Rückfall-Anatomie aus den Übungen selbst.
 *
 * Hauptregionen zählen voll, Nebenregionen halb, dieselbe anteilige Zählweise wie bei der
 * Planbewertung und beim Wochenvolumen (THRESHOLDS.indirectSetWeight). Wird nur für
 * Bewegungen gefragt, die die gepflegte Tabelle nicht abdeckt.
 */
/**
 * Welche Bewegungen dieser Region einen Rang geben können.
 *
 * Die Antwort auf die berechtigte Beschwerde, dass ein grauer Muskel eine Sackgasse ist:
 * ist er nicht, und die App soll sagen, was ihn einfärben würde, statt jemanden raten zu
 * lassen. Sortiert danach, wie stark jede die Region antreibt, der erste Vorschlag ist also
 * der direkteste.
 */
export function liftsThatRank(region) {
  return Object.entries(ANATOMY)
    .filter(([, weights]) => (weights[region] || 0) >= DIRECT_CONTRIBUTION)
    .sort((a, b) => (b[1][region] || 0) - (a[1][region] || 0))
    .map(([name]) => name);
}

/**
 * Wie stark eine benannte Übung eine Region antreibt, 0, wenn gar nicht.
 *
 * Löst über den Alias auf, und genau darum geht es: ein Vorschlag muss in den Namen
 * formuliert sein, die die eigene Bibliothek benutzt, nicht in den gepflegten. "Mach einen
 * Cable Oblique Twist" ist nutzlos, wenn der eigene Katalog das Cable Russian Twists nennt.
 */
export function drivesRegion(name, region) {
  return (ANATOMY[canonical(name)] || {})[region] || 0;
}

export const canRank = (name, region) => drivesRegion(name, region) >= DIRECT_CONTRIBUTION;

/**
 * Wie stark eine Übung jede Region trainiert, wo möglich gepflegt.
 *
 * Die eine Stelle in der App, die für eine beliebige Übung "welche Muskeln und wie viel"
 * beantwortet. ANATOMY ist von Hand geschrieben und von 0 bis 1 abgestuft, die eigenen
 * Haupt- und Nebenlisten des Katalogs sind grob (eine Bewegung ist eine Brustübung oder
 * nicht) und sind der Rückfall, nicht die Antwort.
 *
 * Die 1 und 0,5 des Rückfalls sind dieselbe anteilige Zählweise wie bei Planbewertung und
 * Wochenvolumen, es erfindet also niemand eine dritte Skala für dieselbe Idee.
 */
export function anatomyOf(exercise) {
  if (!exercise) return {};
  const curated = ANATOMY[canonical(exercise.name)];
  if (curated) return curated;
  const out = {};
  for (const region of exercise.primary || []) out[region] = 1;
  for (const region of exercise.secondary || []) if (!out[region]) out[region] = 0.5;
  return out;
}

export function regionsFromExercises(exercises = []) {
  const out = {};
  for (const ex of exercises) {
    if (!ex?.name || ANATOMY[canonical(ex.name)]) continue;
    const regions = {};
    for (const region of ex.primary || []) regions[region] = 1;
    for (const region of ex.secondary || []) if (!regions[region]) regions[region] = 0.5;
    if (Object.keys(regions).length) out[ex.name] = regions;
  }
  return out;
}

export function hasProfile(profile) {
  return !!(profile && Number(profile.bodyweight) > 0 && profile.sex);
}
