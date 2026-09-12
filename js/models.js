// Datenmodell, mitgelieferte Bibliothek und die Rechnerei für abgeleitete Werte.

import { THRESHOLDS } from './evidence.js';
import { LIBRARY as LIBRARY_MAIN } from './exercise-library.js';
import { LIBRARY_EXTRA } from './exercise-extra.js';
import { CONTRIB, ANATOMY, benchmarkName } from './standards.js';

// Katalog von free-exercise-db plus die Übungen aus everkinetic, die wegen ihrer Bilder übernommen wurden
const LIBRARY = [...LIBRARY_MAIN, ...LIBRARY_EXTRA];

export const MUSCLES = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Other',
];

/**
 * Das neueste Wiegen in einem Log, egal in welcher Reihenfolge es gespeichert ist.
 *
 * Aus dem Store herausgezogen, damit es testbar ist: der Store hält `bodyweight` mit dem
 * neuesten zuerst, aber `logBodyweight` nimmt ein Datum an, eine nachträgliche Korrektur
 * kommt also nach Einträgen, die neuer sind als sie. "Das zuletzt geschriebene" ist nicht
 * dasselbe wie "dein Gewicht jetzt", und an diesem Unterschied hängt eine Stärkewertung.
 */
export function latestWeight(log = []) {
  let best = null;
  for (const b of log) {
    const w = Number(b?.weight);
    if (!Number.isFinite(w) || w <= 0) continue;
    if (!best || b.date > best.date) best = { date: b.date, weight: w };
  }
  return best ? best.weight : null;
}

export const DEFAULT_SETTINGS = {
  // Sprache der Oberfläche. null folgt dem Gerät, so soll es eine frische Installation
  // auf einem deutschen Handy halten, ohne dass man fragen muss.
  language: null,         // 'de' | 'en' | null
  theme: 'ocean',         // 'ocean' | 'violet' | 'emerald' | 'sunset'
  units: 'kg',            // 'kg' | 'lb'
  restSeconds: 180,
  autoStartRest: true,
  soundOnRestEnd: true,
  // Während einer Pause eine Audio-Sitzung offen halten, damit der Ton auch kommt, wenn
  // das Handy schon bei einer anderen App ist. Kostet Akku und belegt die
  // Mediensteuerung, deshalb eigener Schalter, getrennt vom Ton selbst.
  restBackgroundAudio: true,
  progressionSuggestions: true,
  // Aus, weil es eine ehrliche Antwort gegen eine andere tauscht und keinen Fehler
  // behebt: an, wird der Wiederholungsbereich eingehalten und die Last bewegt sich
  // dafür, aus, bleibt die Last über das normale Nachlassen von Satz zu Satz gleich.
  // Siehe `keepInRange`.
  strictRepRange: false,
  warmupSuggestions: true,
  plateauHints: true,
  deloadHints: true,
  techniqueHints: true,
  plannedDuration: true,
  regenerationEnabled: false,
  showRatings: true,      // Stärkestufen können demotivieren, also lassen sie sich ausblenden
  showStars: true,        // Qualitätssterne für Übungen und Pläne, getrennt von den Stufen
  logRir: true,           // Spalte für Wiederholungen in Reserve in der Satzzeile
  // Was ein leeres RIR für die Progression bedeutet. Nicht null: leer hieß immer
  // "unbekannt", und es still als "bis zum Versagen" zu lesen hat jeden Vorschlag für
  // alle, die kein RIR eintragen (oder die Spalte ganz aus haben), systematisch zu leicht
  // gemacht. Es ist eine Annahme, die Progression sagt, wenn sie sich darauf stützt, und
  // sonst liest das niemand in der App: Rekorde, Ränge und Diagramme bleiben bei dem,
  // was wirklich aufgeschrieben wurde.
  assumedRir: 1,
  // Rangwerte zur anonymen Verteilung beisteuern und sehen, wo man darin steht.
  // Standardmäßig aus: das ist die einzige Einstellung, die etwas übers Training an einen
  // Server schickt, der nicht die eigene verschlüsselte Sicherung ist, auch wenn das nur
  // eine Zahl von 0 bis 100 relativ zum Körpergewicht ist, ohne Gewicht, ohne
  // Wiederholungen und ohne Identität.
  // Der Hinweis "diese Übung passt nicht dazu" an einem Rang. Standardmäßig an, weil eine
  // Maschine, die mehrere Ränge über allem anderen liegt, fast immer ein Zählfehler ist,
  // und es still herauszufinden kostet jemanden monatelang einen falschen Rang. Aus ist für
  // alle, die schon nachgesehen haben, die Zahl für richtig halten und nicht wieder gefragt
  // werden wollen.
  outlierHints: true,
  shareRankComparison: false,
  // Die letzte Rangstufe, die dieses Gerät gefeiert hat. Die Wertung wird bei jedem
  // Zeichnen aus dem ganzen Log neu gebaut, es gibt also kein Ereignis, an dem man eine
  // Feier aufhängen könnte, und das hier ist das Ereignis: eine gespeicherte Zahl, die die
  // berechnete genau einmal überholen kann. null heißt "nie festgehalten", und das ist
  // absichtlich nicht dasselbe wie null Punkte, siehe announceRankUp.
  lastSeenRankStep: null,
  // Womit eine neue Übung im Plan anfängt. 2 x 6-10 ist der Standard der App, aus Gründen,
  // die in plan-builder.js stehen, aber es ist eine Vorliebe und kein Befund. Wer 3 x 8-12
  // macht, soll das nicht jedes Mal neu eintippen müssen.
  defaultSets: 2,
  defaultReps: '6-10',
  // Was die leere Stange wiegt, für die Scheibenrechnung. null heißt "die normale
  // Olympia-Stange für die aktuelle Einheit". Eine Einstellung und keine Konstante, weil
  // Trainingsstangen, Frauenstangen und Safety-Squat-Stangen alle verschieden sind.
  barWeight: null,
  // Worauf das Kalorienziel zielt. Nur drei Antworten, weil die Rate dazu eine übliche
  // Festlegung ist (0,25 bis 0,5 % Körpergewicht pro Woche) und niemand sie feiner getestet hat.
  goal: 'hold',           // 'lose' | 'hold' | 'gain'
  // Cloud-Sicherung. Aus, bis jemand sie einschaltet und dem Text zustimmt. Die Zustimmung
  // selbst wird auf dem Server festgehalten und nicht hier, das ist also nur der lokale
  // Schalter. `state.enabled` in sync.js braucht beides.
  cloudEnabled: false,
  cloudLastSyncAt: null,
  cloudLastFingerprint: null,
  notificationsEnabled: false,
  creatineReminderEnabled: false,
  creatineReminderTime: '19:00',
  creatineLastTakenDay: null,
  // Profil. Geschlecht und Körpergewicht bestimmen die Kraftstandards. Die Größe wird nur
  // zur Info festgehalten und absichtlich in keiner Wertung benutzt (kein veröffentlichter
  // Standard rechnet mit der Größe).
  sex: null,              // 'male' | 'female' | null
  age: null,
  height: null,           // cm
  activePlanId: null,
};

/** Name | Muskel | Gerät */
const SEED = [
  ['Barbell Bench Press', 'Chest', 'Barbell'],
  ['Incline Barbell Bench Press', 'Chest', 'Barbell'],
  ['Dumbbell Bench Press', 'Chest', 'Dumbbell'],
  ['Incline Dumbbell Press', 'Chest', 'Dumbbell'],
  ['Cable Fly', 'Chest', 'Cable'],
  ['Pec Deck', 'Chest', 'Machine'],
  ['Butterfly', 'Chest', 'Machine'],
  ['Push-Up', 'Chest', 'Bodyweight'],
  ['Dip', 'Chest', 'Bodyweight'],
  ['Weighted Push-Up', 'Chest', 'Bodyweight'],
  ['Weighted Dip', 'Chest', 'Bodyweight'],

  ['Deadlift', 'Back', 'Barbell'],
  ['Barbell Row', 'Back', 'Barbell'],
  ['Pendlay Row', 'Back', 'Barbell'],
  ['Dumbbell Row', 'Back', 'Dumbbell'],
  ['Pull-Up', 'Back', 'Bodyweight'],
  ['Chin-Up', 'Back', 'Bodyweight'],
  ['Weighted Pull-Up', 'Back', 'Bodyweight'],
  ['Weighted Chin-Up', 'Back', 'Bodyweight'],
  ['Lat Pulldown', 'Back', 'Cable'],
  ['Seated Cable Row', 'Back', 'Cable'],
  ['T-Bar Row', 'Back', 'Machine'],
  ['Face Pull', 'Back', 'Cable'],
  ['Rack Pull', 'Back', 'Barbell'],

  ['Overhead Press', 'Shoulders', 'Barbell'],
  ['Seated Dumbbell Press', 'Shoulders', 'Dumbbell'],
  ['Arnold Press', 'Shoulders', 'Dumbbell'],
  ['Lateral Raise', 'Shoulders', 'Dumbbell'],
  ['Cable Lateral Raise', 'Shoulders', 'Cable'],
  ['Rear Delt Fly', 'Shoulders', 'Dumbbell'],
  ['Upright Row', 'Shoulders', 'Barbell'],

  ['Barbell Curl', 'Biceps', 'Barbell'],
  ['Dumbbell Curl', 'Biceps', 'Dumbbell'],
  ['Hammer Curl', 'Biceps', 'Dumbbell'],
  ['Incline Dumbbell Curl', 'Biceps', 'Dumbbell'],
  ['Preacher Curl', 'Biceps', 'Machine'],
  ['Cable Curl', 'Biceps', 'Cable'],

  ['Close-Grip Bench Press', 'Triceps', 'Barbell'],
  ['Skull Crusher', 'Triceps', 'Barbell'],
  ['Triceps Pushdown', 'Triceps', 'Cable'],
  ['Overhead Cable Extension', 'Triceps', 'Cable'],
  ['Dumbbell Kickback', 'Triceps', 'Dumbbell'],

  ['Back Squat', 'Quads', 'Barbell'],
  ['Front Squat', 'Quads', 'Barbell'],
  ['Hack Squat', 'Quads', 'Machine'],
  ['Leg Press', 'Quads', 'Machine'],
  ['Bulgarian Split Squat', 'Quads', 'Dumbbell'],
  ['Walking Lunge', 'Quads', 'Dumbbell'],
  ['Leg Extension', 'Quads', 'Machine'],

  ['Romanian Deadlift', 'Hamstrings', 'Barbell'],
  ['Stiff-Leg Deadlift', 'Hamstrings', 'Barbell'],
  ['Lying Leg Curl', 'Hamstrings', 'Machine'],
  ['Seated Leg Curl', 'Hamstrings', 'Machine'],
  ['Good Morning', 'Hamstrings', 'Barbell'],
  ['Nordic Curl', 'Hamstrings', 'Bodyweight'],

  ['Hip Thrust', 'Glutes', 'Barbell'],
  ['Glute Bridge', 'Glutes', 'Barbell'],
  ['Cable Kickback', 'Glutes', 'Cable'],
  ['Sumo Deadlift', 'Glutes', 'Barbell'],

  ['Standing Calf Raise', 'Calves', 'Machine'],
  ['Seated Calf Raise', 'Calves', 'Machine'],

  ['Plank', 'Core', 'Bodyweight'],
  ['Hanging Leg Raise', 'Core', 'Bodyweight'],
  ['Cable Crunch', 'Core', 'Cable'],
  ['Ab Wheel Rollout', 'Core', 'Bodyweight'],
  ['Russian Twist', 'Core', 'Dumbbell'],

  // Arbeit an Maschinen. Der importierte Katalog hat viel Langhantel, Kurzhantel und Kabel
  // und wenig Maschinen, 72 von 850 Einträgen. Wer in einem Studio mit Maschinen trainiert,
  // tippt also seine eigenen. Diese hier haben von Hand geschriebene Anatomie aus
  // CONTRIB_EXTRA und absichtlich keinen Kraftstandard.
  ['Machine Chest Press', 'Chest', 'Machine'],
  ['Incline Machine Press', 'Chest', 'Machine'],
  ['Machine Chest Fly', 'Chest', 'Machine'],
  ['Smith Machine Bench Press', 'Chest', 'Machine'],
  ['Machine Dip', 'Triceps', 'Machine'],

  ['Chest-Supported T-Bar Row', 'Back', 'Machine'],
  ['Chest-Supported Row', 'Back', 'Machine'],
  ['Close-Grip Seated Row', 'Back', 'Machine'],
  ['Machine Row', 'Back', 'Machine'],
  ['Machine High Row', 'Back', 'Machine'],
  ['Machine Pullover', 'Back', 'Machine'],
  ['Assisted Pull-Up Machine', 'Back', 'Machine'],

  ['Machine Shoulder Press', 'Shoulders', 'Machine'],
  ['Machine Lateral Raise', 'Shoulders', 'Machine'],
  ['Lateral Raise Machine', 'Shoulders', 'Machine'],
  ['Machine Rear Delt Fly', 'Shoulders', 'Machine'],

  ['Machine Biceps Curl', 'Biceps', 'Machine'],
  ['Machine Preacher Curl', 'Biceps', 'Machine'],
  ['Preacher Curl Machine', 'Biceps', 'Machine'],
  ['Rope Hammer Curl', 'Biceps', 'Cable'],
  ['Machine Triceps Extension', 'Triceps', 'Machine'],
  ['Overhead Rope Triceps Extension', 'Triceps', 'Cable'],
  ['Rope Triceps Pushdown', 'Triceps', 'Cable'],

  ['Smith Machine Squat', 'Quads', 'Machine'],
  ['Machine Hip Abduction', 'Glutes', 'Machine'],
  ['Machine Hip Adduction', 'Quads', 'Machine'],
  ['Machine Back Extension', 'Hamstrings', 'Machine'],
  ['Machine Crunch', 'Core', 'Machine'],

  // Übliche Übungen aus modernen Studios, die in beiden importierten Katalogen fehlen. Sie
  // füllen echte Lücken beim Planen und sind keine fast gleichen Griffvarianten.
  ['Pendulum Squat', 'Quads', 'Machine'],
  ['Belt Squat', 'Quads', 'Machine'],
  ['Smith Machine Romanian Deadlift', 'Hamstrings', 'Machine'],
  ['Smith Machine Incline Bench Press', 'Chest', 'Machine'],
  ['Bayesian Cable Curl', 'Biceps', 'Cable'],
  ['Cross-Body Cable Lateral Raise', 'Shoulders', 'Cable'],
  ['Single-Arm Lat Pulldown', 'Back', 'Cable'],
  ['Reverse Nordic Curl', 'Quads', 'Bodyweight'],
  ['Glute-Biased 45-Degree Back Extension', 'Glutes', 'Other'],
  ['Cable Y-Raise', 'Shoulders', 'Cable'],
  ['Iso-Lateral Chest Press', 'Chest', 'Machine'],
  ['Iso-Lateral Incline Chest Press', 'Chest', 'Machine'],
  ['Iso-Lateral Shoulder Press', 'Shoulders', 'Machine'],
  ['Iso-Lateral High Row', 'Back', 'Machine'],
  ['Iso-Lateral Low Row', 'Back', 'Machine'],
  ['Plate-Loaded Pullover', 'Back', 'Machine'],
  ['Glute Drive Machine', 'Glutes', 'Machine'],
  ['Standing Hip Abduction Machine', 'Glutes', 'Machine'],
  ['Kneeling Leg Curl Machine', 'Hamstrings', 'Machine'],
  ['Seated Dip Machine', 'Triceps', 'Machine'],
];

/** Regionen der Muskelkarte je grober Muskelgruppe, für die gepflegten Einträge. */
const COARSE_REGIONS = {
  Chest: ['chest'], Back: ['lats'], Shoulders: ['delts-front'],
  Biceps: ['biceps'], Triceps: ['triceps'], Quads: ['quads'],
  Hamstrings: ['hamstrings'], Glutes: ['glutes'], Calves: ['calves'],
  Core: ['abs'], Other: [],
};

/**
 * Regionen für eine Übung, die der Nutzer selbst eingetippt hat. Grob, aber erst eine
 * grobe Antwort macht eine eigene Übung überhaupt sichtbar: ohne Regionen trägt sie
 * nichts zur Muskelkarte bei, nichts zum Volumen eines Plans und gilt in der
 * Übungsbewertung als Bewegung ohne Muskeln.
 */
export function regionsForMuscle(muscle) {
  return [...(COARSE_REGIONS[muscle] || [])];
}

/** Wird erhöht, sobald sich der mitgelieferte Katalog ändert, damit bestehende Installationen auffüllen. */
export const LIBRARY_VERSION = 11;

/**
 * Wird für einmalige Reparaturen an gespeicherten Einträgen erhöht, unabhängig vom
 * Katalog. Absichtlich getrennt von LIBRARY_VERSION: eine Datenreparatur muss auch dann
 * laufen, wenn sich die Übungsliste nicht geändert hat, und die Katalogversion zu
 * erhöhen, um eine Migration auszulösen, würde das Auffüllen umsonst noch einmal laufen lassen.
 */
export const DATA_VERSION = 3;

/**
 * Erst die gepflegte Liste, weil die Kraftstandards genau an diesen Namen hängen und sie
 * deshalb maßgeblich bleiben, dann alles aus dem importierten Katalog, dessen Name es
 * noch nicht gibt.
 */
const STOPWORDS = new Set(['with', 'the', 'a', 'on', 'and', 'to', 'of', 'for']);

function tokenSet(name) {
  const out = new Set();
  for (let w of String(name).toLowerCase().split(/[^a-z0-9]+/)) {
    if (!w || STOPWORDS.has(w)) continue;
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    out.add(w);
  }
  return out;
}

/**
 * Vom ähnlichsten Katalogeintrag nur die Beschreibung leihen, mit strenger Schwelle.
 *
 * Anatomie wird absichtlich nie geliehen. Ein unscharfer Namensvergleich reicht, um Text
 * zu leihen, aber nicht, um Muskeln zuzuordnen. Eine frühe Version hat daraus
 * "Deadlift trifft Latissimus" und "Barbell Row trifft vordere Schulter" abgeleitet, und das hätte
 * die Muskelkarte still verfälscht. Regionen kommen aus CONTRIB (von Hand, pro Übung)
 * oder der groben Zuordnung, nie aus einer Vermutung.
 */
function borrowInstructions(name) {
  if (MANUAL_INSTRUCTIONS[name]) return MANUAL_INSTRUCTIONS[name];
  const want = tokenSet(name);
  if (!want.size) return [];
  let best = null, score = 0;
  for (const item of LIBRARY) {
    if (!item.i || !item.i.length) continue;
    const have = tokenSet(item.n);
    let inter = 0;
    for (const t of want) if (have.has(t)) inter++;
    if (!inter) continue;
    const j = inter / (want.size + have.size - inter);
    if (j > score) { score = j; best = item; }
  }
  return score >= 0.7 && best ? best.i : [];
}

const MANUAL_INSTRUCTIONS = {
  'Pendulum Squat': ['Set the shoulder pads so you can reach a deep knee bend without your heels lifting.', 'Keep your back against the pad and lower under control until your knees are deeply flexed.', 'Drive through the platform and stop just short of relaxing at lockout.'],
  'Belt Squat': ['Fasten the belt securely and stand centred on the platform.', 'Sit down between your hips while keeping your whole foot planted.', 'Stand by extending knees and hips without using the handles to pull yourself up.'],
  'Smith Machine Romanian Deadlift': ['Set the bar around mid-thigh and stand close enough that it tracks over your mid-foot.', 'Push your hips back with soft knees while keeping the bar close to your legs.', 'Stop when the hamstrings are fully stretched without rounding, then extend the hips to stand.'],
  'Bayesian Cable Curl': ['Set a cable near the floor and stand one step in front of it with the working arm behind your torso.', 'Keep the upper arm behind you and curl without letting the shoulder move forward.', 'Lower fully under control until the biceps is lengthened.'],
  'Cross-Body Cable Lateral Raise': ['Take the cable in the hand furthest from the low pulley so it crosses in front of your body.', 'Lead with the elbow and raise the arm out to the side without shrugging.', 'Lower across the body under control to keep tension in the lengthened position.'],
  'Single-Arm Lat Pulldown': ['Kneel or sit beside a high pulley and brace your torso.', 'Start with the shoulder blade elevated and the arm reaching overhead.', 'Drive the elbow toward your hip, pause, then allow a full controlled reach at the top.'],
  'Reverse Nordic Curl': ['Kneel on padding with hips fully extended and the torso in line with the thighs.', 'Lean the whole body backward from the knees without bending at the hips.', 'Use the quadriceps to reverse the movement before losing control.'],
  'Glute-Biased 45-Degree Back Extension': ['Set the pad below the hip crease and anchor your feet.', 'Round slightly through the upper back and lower by flexing at the hips.', 'Drive the hips into the pad and stop when the glutes are contracted, without hyperextending the lower back.'],
  'Cable Y-Raise': ['Set two low cables and take the opposite handle in each hand.', 'With soft elbows, raise the arms up and out into a Y without shrugging.', 'Lower slowly until the arms cross lightly in front of the body.'],
  'Iso-Lateral Chest Press': ['Adjust the seat so the handles start around mid-chest.', 'Keep your shoulder blades against the pad and press both arms without shrugging.', 'Lower under control to the deepest comfortable stretch.'],
  'Iso-Lateral Incline Chest Press': ['Adjust the seat so the handles begin below the collarbone.', 'Keep your upper back against the pad and press up and inward.', 'Lower slowly without letting the shoulders roll forward.'],
  'Iso-Lateral Shoulder Press': ['Set the seat so the handles begin around shoulder height.', 'Brace against the back pad and press overhead without shrugging early.', 'Lower until the shoulders reach a comfortable deep position.'],
  'Iso-Lateral High Row': ['Set the chest pad so your arms can reach fully forward.', 'Drive the elbows down and back while keeping the chest supported.', 'Return under control until the shoulder blades can move forward.'],
  'Iso-Lateral Low Row': ['Set the chest support and take the handles with fully reached arms.', 'Pull the elbows toward the hips without lifting the chest from the pad.', 'Pause briefly and return to a full controlled reach.'],
  'Plate-Loaded Pullover': ['Adjust the seat so the upper arms contact the pads securely.', 'Begin overhead with a controlled lat stretch.', 'Drive the elbows down in an arc and return slowly without lifting the hips.'],
  'Glute Drive Machine': ['Place the belt or pad securely across the hips and plant the whole foot.', 'Lower the hips under control while keeping the ribs down.', 'Drive through the feet and finish with the glutes without overextending the back.'],
  'Standing Hip Abduction Machine': ['Set the pad against the outside of the working thigh and hold the frame lightly.', 'Move the leg outward without leaning or rotating the pelvis.', 'Return slowly until the glute is lengthened.'],
  'Kneeling Leg Curl Machine': ['Align the working knee with the machine pivot and secure the ankle pad.', 'Curl the heel toward the glute without lifting the hip from the support.', 'Lower fully under control.'],
  'Seated Dip Machine': ['Adjust the seat so the handles start beside the lower chest.', 'Keep the torso against the pad and press the handles down by extending the elbows.', 'Return under control without letting the shoulders roll forward.'],
};

/**
 * Regionen für eine gepflegte Übung: erst die von Hand geschriebene Anatomietabelle,
 * danach die grobe Zuordnung.
 *
 * ANATOMY deckt die Referenzübungen und die gepflegten Maschinenübungen ab. Genaue
 * Regionen zu haben und einen Kraftstandard zu haben sind zwei getrennte Fragen, und das
 * hier beantwortet nur die erste. Warum Maschinen das eine bekommen und nicht das andere,
 * steht in standards.js.
 */
function regionsFor(name, muscle) {
  const contrib = ANATOMY[name];
  if (contrib) {
    const entries = Object.entries(contrib).sort((a, b) => b[1] - a[1]);
    return {
      primary: entries.filter(([, w]) => w >= 0.9).map(([r]) => r),
      secondary: entries.filter(([, w]) => w < 0.9).map(([r]) => r),
    };
  }
  return { primary: COARSE_REGIONS[muscle] || [], secondary: [] };
}

export function seedExercises(uid) {
  const out = SEED.map(([name, muscle, equipment]) => {
    const { primary, secondary } = regionsFor(name, muscle);
    return {
      id: uid('ex_'),
      name, muscle, equipment,
      primary, secondary,
      instructions: borrowInstructions(name),
      // Gepflegte Übungen haben selbst keine Angabe zur Mechanik. Ohne das hier landen die
      // Referenzübungen im Plan-Generator hinter seltenen importierten Varianten, und so hat
      // ein Plan einmal "Bodyweight Flyes" statt Bankdrücken empfohlen. Referenzübungen
      // gelten deshalb immer als Grundübung, die gepflegten Maschinenübungen bekommen die
      // ehrliche Regel über die Anzahl der Regionen.
      mech: CONTRIB[name] ? 'compound' : (primary.length + secondary.length >= 3 ? 'compound' : 'isolation'),
      level: null,
      isCustom: false,
      createdAt: Date.now(),
    };
  });

  const taken = new Set(out.map((e) => normName(e.name)));
  for (const item of LIBRARY) {
    const key = normName(item.n);
    if (taken.has(key)) continue;
    taken.add(key);
    const refined = refineRegions(item.n, item.p || [], item.s || []);
    out.push({
      id: uid('ex_'),
      name: item.n,
      muscle: item.m,
      equipment: /bodyweight (fly|flye)/i.test(item.n) ? 'Bodyweight' : item.e,
      primary: refined.primary,
      secondary: refined.secondary,
      instructions: cleanInstructions(item.i || []),
      mech: item.mech || null,
      level: item.lvl || null,
      isCustom: false,
      createdAt: Date.now(),
    });
  }
  return out;
}

function cleanInstructions(steps) {
  return steps
    .map((step) => String(step).replace(/<[^>]*>/g, '').replace(/\u00a0/g, ' ').trim())
    .filter(Boolean)
    .filter((step) => !/^(steps?|tip)$/i.test(step));
}

export function normName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * free-exercise-db legt jede Schulterübung in denselben Topf "shoulders", Reverse Flys und
 * Face Pulls kommen also als vordere Schulter an. So gelassen gäbe es im ganzen Katalog
 * nur zwei Übungen für die hintere Schulter, der Plan-Generator verhungert, und die
 * Muskelkarte stimmt nicht.
 *
 * Über den Namen abzugleichen ist grob, aber die Namen sind hier ungewöhnlich eindeutig:
 * "Rear Delt Fly", "Reverse Machine Flyes", "Face Pull".
 */
const REAR_DELT = /(rear[- ]?delt|reverse (machine )?(fly|flye)|rear (lateral|fly)|face pull|bent[- ]?over (lateral|reverse))/i;

export function refineRegions(name, primary = [], secondary = []) {
  if (!REAR_DELT.test(name)) return { primary, secondary };
  const p = ['delts-rear', ...primary.filter((r) => r !== 'delts-front' && r !== 'delts-rear')];
  const s = secondary.filter((r) => r !== 'delts-rear');
  return { primary: p, secondary: s };
}

// Fabriken

export function newSession(uid, {
  name = 'Workout', planId = null, dayId = null, entries = [], plannedDurationMs = null,
} = {}) {
  const now = Date.now();
  return {
    id: uid('s_'),
    planId,
    dayId,
    name,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    pausedAt: null,
    pausedMs: 0,
    notes: '',
    entries,
    plannedDurationMs,
  };
}

export function newEntry(exerciseId, sets = []) {
  return { exerciseId, sets, note: '', movementMode: 'bilateral' };
}

/**
 * Ein Eintrag in der eigenen Lebensmittelliste.
 *
 * Bewusst unabhängig von der Quelle: Name, Portion, Eiweiß, Kalorien. Von Hand getippt,
 * aus einer Barcode-Abfrage gefüllt oder per Foto vorgeschlagen, am Ende ist es derselbe
 * Datensatz, und woher die Zahlen kommen, schränkt nie ein, was die App damit machen kann.
 * `source` wird aus Ehrlichkeit festgehalten, nicht für die Logik.
 */
export function newFood(uid, {
  name, portion, portionGrams, protein, kcal,
  carbs = null, fat = null, fibre = null, micros = null,
  source = 'manual', barcode = null, per100 = null, fdcId = null,
}) {
  return {
    id: uid('f_'),
    name: String(name).trim(),
    portion: (portion || '1 Portion').trim(),   // lesbare Angabe: "100 g", "1 Scoop"
    portionGrams: Number(portionGrams) || null, // freiwillig, zum späteren Umrechnen
    protein: Math.max(0, Number(protein) || 0),
    kcal: Math.max(0, Number(kcal) || 0),
    // Kohlenhydrate, Fett und Ballaststoffe dürfen null sein, und null ist nicht 0 g. Ein
    // Lebensmittel von vor diesen Feldern oder von einem Etikett, auf dem nur Eiweiß steht,
    // hat hier wirklich keinen Wert. Es als 0 g zu zählen würde jeden Tag, an dem es
    // vorkommt, still zu niedrig zeigen. Stattdessen tragen die Summen die Lücke mit.
    carbs: optionalGrams(carbs),
    fat: optionalGrams(fat),
    fibre: optionalGrams(fibre),
    // Alles jenseits der fünf Grundwerte, damit ein neuer Nährstoff den Datensatz nie
    // breiter macht. Innen gilt dieselbe Regel: ein fehlender Schlüssel ist unbekannt, nicht null.
    micros: micros && typeof micros === 'object' ? { ...micros } : {},
    fdcId,
    source,                                     // 'manual' | 'barcode' | 'photo'
    // Bleibt erhalten, damit eine zweite Abfrage desselben Produkts aus dieser Liste
    // antwortet statt aus dem Netz, und damit sich die Portion später neu rechnen lässt,
    // ohne Open Food Facts noch einmal zu fragen.
    barcode,
    per100,
    uses: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Tageszeiten für Mahlzeiten. Nur zum Ordnen, nichts in der App bewertet den Zeitpunkt. */
export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Eine wirklich gegessene Portion. Die Werte werden kopiert, nicht verwiesen, siehe store.js. */
export function newMeal(uid, food, { amount = 1, day = dayKey(), at = Date.now(), slot = null } = {}) {
  const n = Number(amount) || 1;
  const scale = (v) => (v === null || v === undefined ? null : Math.round(v * n * 10) / 10);
  return {
    id: uid('m_'),
    day,                       // 'YYYY-MM-DD', Ortszeit
    at,
    slot: MEAL_SLOTS.includes(slot) ? slot : slotFor(at),
    foodId: food.id,
    name: food.name,
    portion: food.portion,
    amount: n,
    protein: food.protein * n,
    kcal: food.kcal * n,
    carbs: scale(food.carbs ?? null),
    fat: scale(food.fat ?? null),
    fibre: scale(food.fibre ?? null),
    micros: Object.fromEntries(
      Object.entries(food.micros || {}).map(([k, v]) => [k, scale(v)])
    ),
    updatedAt: Date.now(),
  };
}

/**
 * Eine Tageszeit nach der Uhr als Standard, damit Eintragen ein Tipp bleibt.
 *
 * Die Grenzen sind eine Festlegung darüber, wann Leute essen, mehr nicht. Die App
 * bewertet nie, wann gegessen wird, weil die Tagesmenge viel mehr zählt als die
 * Verteilung und das "anabole Fenster" weitgehend widerlegt ist. Es ist nur eine Art,
 * eine Liste zu gruppieren, und jeder Eintrag lässt sich von Hand verschieben.
 */
export function slotFor(ts = Date.now()) {
  const h = new Date(ts).getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

const optionalGrams = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : null;
};

/**
 * Eine gespeicherte Mahlzeit: ein Name und die Lebensmittel, aus denen sie besteht.
 *
 * Die Einträge verweisen über die ID auf Lebensmittel und kopieren keine Werte, anders
 * als eine eingetragene Mahlzeit. Das ist gewollt: eine eingetragene Mahlzeit ist Verlauf
 * und darf sich nie ändern, eine Vorlage ist ein Rezept, und korrigiert man das Eiweiß
 * beim Quark, soll das beim nächsten eingetragenen Frühstück mitkommen.
 */
export function newTemplate(uid, { name, items = [], slot = null }) {
  return {
    id: uid('t_'),
    name: String(name).trim() || 'Saved meal',
    slot: MEAL_SLOTS.includes(slot) ? slot : null,
    items: items
      .filter((i) => i && i.foodId)
      .map((i) => ({ foodId: i.foodId, amount: Number(i.amount) || 1 })),
    uses: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Kalendertag in Ortszeit als 'YYYY-MM-DD'. Ortszeit, nicht UTC, ein Snack um 23 Uhr gehört zu heute. */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function newSet(prev = null) {
  return {
    weight: prev ? prev.weight : null,
    reps: prev ? prev.reps : null,
    // Wiederholungen in Reserve. Absichtlich nicht vom vorigen Satz übernommen: Gewicht und
    // Wiederholungen sind ein Plan, den man wiederholt, die Anstrengung ist eine
    // Beobachtung hinterher, und sie vorauszufüllen würde daraus einen Standardwert machen,
    // den keiner korrigiert.
    rir: null,
    type: 'working',   // 'working' | 'warmup'
    done: false,
    // Nur gefüllt, wenn die Übung Seite für Seite eingetragen wird. `weight` und `reps`
    // bleiben die schwächere Seite, damit jede bestehende Kraftrechnung vorsichtig bleibt
    // und alte Sicherungen lesbar bleiben.
    leftWeight: prev?.leftWeight ?? null,
    leftReps: prev?.leftReps ?? null,
    rightWeight: prev?.rightWeight ?? null,
    rightReps: prev?.rightReps ?? null,
  };
}

// Rechnerei

const E1RM_WINDOW = THRESHOLDS.e1rmWindow;

/** Geschätztes 1RM nach Epley. Eine einzelne Wiederholung ist einfach das Gewicht selbst. */
export function e1rm(weight, reps) {
  const w = Number(weight), r = Number(reps);
  if (!w || !r || r < 1) return 0;
  if (r === 1) return w;
  return w * (1 + r / 30);
}

export function isCounted(set) {
  return set.done && set.type === 'working' && Number(set.reps) > 0;
}

const WEIGHTED_BODYWEIGHT = new Set([
  'Weighted Pull-Up', 'Weighted Chin-Up', 'Weighted Dip', 'Weighted Push-Up',
]);

/** Wie der Trainieren-Screen die Last für eine Bewegung abfragen soll. */
export function bodyweightLoadMode(exercise) {
  // Das Gerätefeld im Katalog stimmt dabei nicht immer: "Dips - Chest Version" steht unter
  // "Other". Die Bewertung behandelt die Übung schon als Körpergewicht plus Zusatzgewicht,
  // und der Screen muss die Last genauso abfragen, sonst sind sich beide uneins, was ein Satz bedeutet hat.
  const canonical = benchmarkName(exercise?.name);
  const bodyweightLift = exercise?.equipment === 'Bodyweight'
    || BODYWEIGHT_STRENGTH_LIFTS.has(canonical);
  if (!bodyweightLift) return 'external';
  // Auf beiden Seiten die gleiche Form des Namens. Diese Zeile hat früher den rohen Namen aus
  // dem Katalog geprüft, während die darüber den umbenannten geprüft hat. Eine Bewegung, die
  // über einen anderen Namen durch die erste Prüfung kam, fiel bei der zweiten raus:
  // "Weighted Pull Ups" wurde als Körpergewichtsübung erkannt und dann nach dem ganzen
  // Körpergewicht gefragt statt nach der Scheibe am Gürtel.
  return WEIGHTED_BODYWEIGHT.has(canonical) ? 'added' : 'bodyweight';
}

/** Die gesamte bewegte Last, pro Satz gespeichert, damit spätere Änderungen am Körpergewicht die Vergangenheit nicht umschreiben. */
export function effectiveSetWeight(set) {
  return Number(set?.systemWeight ?? set?.weight) || 0;
}

export function setVolume(set) {
  if (set.leftReps != null || set.rightReps != null) {
    return (Number(set.leftWeight) || 0) * (Number(set.leftReps) || 0)
      + (Number(set.rightWeight) || 0) * (Number(set.rightReps) || 0);
  }
  return effectiveSetWeight(set) * (Number(set.reps) || 0);
}

export function entryStats(entry) {
  const counted = entry.sets.filter(isCounted);
  let volume = 0, topWeight = 0, best = 0, reps = 0;
  for (const s of counted) {
    const load = effectiveSetWeight(s);
    volume += setVolume(s);
    topWeight = Math.max(topWeight, load);
    best = Math.max(best, e1rm(load, s.reps));
    reps += Number(s.reps) || 0;
  }
  return { sets: counted.length, volume, topWeight, e1rm: best, reps };
}

export function sessionStats(session) {
  let volume = 0, sets = 0, reps = 0;
  for (const e of session.entries) {
    const st = entryStats(e);
    volume += st.volume; sets += st.sets; reps += st.reps;
  }
  const end = session.finishedAt || session.pausedAt || Date.now();
  const durationMs = Math.max(0, end - session.startedAt - (Number(session.pausedMs) || 0));
  return { volume, sets, reps, durationMs, exercises: session.entries.length };
}

/** Geschätzte Dauer eines Plans: Arbeit, Pausen zwischen den Sätzen und Übungswechsel. */
export function estimatePlanDuration(items, restSeconds = 180) {
  const rows = (items || []).filter(Boolean);
  const sets = rows.reduce((sum, item) => sum + Math.max(1, Number(item.targetSets) || 3), 0);
  if (!sets) return 0;
  const betweenSets = Math.max(0, sets - rows.length);
  const changes = Math.max(0, rows.length - 1);
  return (sets * 45 + betweenSets * Number(restSeconds || 180) + changes * 90) * 1000;
}

/**
 * Die letzte abgeschlossene Einheit mit echter Arbeit für diese Übung. Daraus kommt die
 * Zeile "letztes Mal", die wichtigste Zahl auf dem Screen zum Eintragen.
 */
export function lastPerformance(sessions, exerciseId, excludeSessionId = null) {
  for (const s of sessions) {
    if (!s.finishedAt) continue;
    if (s.id === excludeSessionId) continue;
    const entry = s.entries.find((e) => e.exerciseId === exerciseId);
    if (!entry) continue;
    const counted = entry.sets.filter(isCounted);
    if (!counted.length) continue;
    return { session: s, entry, sets: counted, stats: entryStats(entry) };
  }
  return null;
}

/** Ein Punkt pro Einheit für eine Übung, die ältesten zuerst. */
export function exerciseSeries(sessions, exerciseId) {
  const pts = [];
  for (const s of sessions) {
    if (!s.finishedAt) continue;
    const entry = s.entries.find((e) => e.exerciseId === exerciseId);
    if (!entry) continue;
    const st = entryStats(entry);
    if (!st.sets) continue;
    pts.push({ t: s.startedAt, sessionId: s.id, ...st });
  }
  return pts.sort((a, b) => a.t - b.t);
}

export function startOfWeek(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;   // Montag = 0
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

/**
 * Arbeitssätze je Muskelgruppe, nach ISO-Woche gruppiert.
 * Die Sätze pro Woche sind die Größe, die den Reiz für den Muskelaufbau wirklich abbildet.
 */
export function weeklyMuscleSets(sessions, exerciseById, weeks = 8) {
  const buckets = [];
  // In Kalendertagen zurückgezählt statt 7 x 86400000 abzuziehen: über eine
  // Zeitumstellung liegt eine Woche mit festen Millisekunden eine Stunde neben Mitternacht,
  // der Schlüssel passt nicht mehr zu startOfWeek() unten, und eine ganze Trainingswoche
  // verschwindet still aus dem Diagramm. Zweimal im Jahr, genau oft genug, um zu
  // verwirren, und selten genug, dass es nie gemeldet wird.
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(startOfWeek(Date.now()));
    d.setDate(d.getDate() - i * 7);
    buckets.push({ week: startOfWeek(d.getTime()), byMuscle: {}, total: 0 });
  }
  const index = new Map(buckets.map((b) => [b.week, b]));

  for (const s of sessions) {
    if (!s.finishedAt) continue;
    const wk = startOfWeek(s.startedAt);
    const bucket = index.get(wk);
    if (!bucket) continue;
    for (const e of s.entries) {
      const ex = exerciseById.get(e.exerciseId);
      const muscle = ex ? ex.muscle : 'Other';
      const n = e.sets.filter(isCounted).length;
      if (!n) continue;
      bucket.byMuscle[muscle] = (bucket.byMuscle[muscle] || 0) + n;
      bucket.total += n;
    }
  }
  return buckets;
}

/** Bestes e1RM, Höchstgewicht und Wiederholungen je Übung, aller Zeiten. */
export function personalRecords(sessions, exerciseId) {
  let bestE1rm = null, bestWeight = null, bestReps = null, bestVolume = null;
  for (const s of sessions) {
    if (!s.finishedAt) continue;
    const entry = s.entries.find((e) => e.exerciseId === exerciseId);
    if (!entry) continue;
    const st = entryStats(entry);
    if (!st.sets) continue;
    if (!bestVolume || st.volume > bestVolume.value) bestVolume = { value: st.volume, at: s.startedAt };
    for (const set of entry.sets.filter(isCounted)) {
      const w = effectiveSetWeight(set), r = Number(set.reps) || 0;
      const est = e1rm(w, r);
      if (!bestE1rm || est > bestE1rm.value) bestE1rm = { value: est, at: s.startedAt, weight: w, reps: r };
      if (!bestWeight || w > bestWeight.value) bestWeight = { value: w, at: s.startedAt, reps: r };
      if (!bestReps || r > bestReps.value) bestReps = { value: r, at: s.startedAt, weight: w };
    }
  }
  return { e1rm: bestE1rm, weight: bestWeight, reps: bestReps, volume: bestVolume };
}

/**
 * Das beste geschätzte 1RM je Übung aller Zeiten, nach Übungsname (die Tabellen der
 * Kraftstandards hängen am Namen, nicht an der ID).
 * @returns {Map<string, number>}
 */
const BODYWEIGHT_STRENGTH_LIFTS = new Set([
  'Pull-Up', 'Chin-Up', 'Dip', 'Weighted Pull-Up', 'Weighted Chin-Up', 'Weighted Dip',
]);

/**
 * Liegt dieser Satz in dem Bereich, aus dem ein geschätztes 1RM gebaut werden darf?
 *
 * Siehe THRESHOLDS.e1rmWindow. Kurz gesagt: die Schätzformeln sind bis etwa zehn
 * Wiederholungen geprüft, und ein Satz mit zwanzig ist eine Hochrechnung, egal welche
 * Formel man darauf anwendet. Den Quadrizeps von jemandem anhand von zwanzig
 * Beinstreckern einzustufen ist genau das, was das hier verhindern soll.
 */
export function withinE1rmWindow(set) {
  const reps = Number(set?.reps) || 0;
  return reps >= E1RM_WINDOW.low && reps <= E1RM_WINDOW.high;
}

/**
 * Bestes geschätztes 1RM je Übungsname, bevorzugt aus Sätzen, für die die Schätzung gilt.
 *
 * Ein Satz außerhalb des Bereichs wird nur benutzt, wenn die Übung sonst nichts hat. Einen
 * Rang ganz zu verlieren, weil jemand eine Maschine mit fünfzehn Wiederholungen trainiert,
 * wäre schlimmer als eine ehrliche Schätzung mit Hinweis. Die Namen, die den Rückfall
 * gebraucht haben, stehen in der Eigenschaft `extrapolated` der Rückgabe, damit die
 * Bewertung den Hinweis bis auf den Screen tragen kann, statt ihn zu verlieren.
 */
export function bestOneRepMaxByName(sessions, exerciseById, profile = null) {
  const best = new Map();
  const outside = new Map();
  // Wann jeder Bestwert wirklich gemacht wurde.
  //
  // Der Rang ist ein Rekord aller Zeiten und bleibt einer: ihn wegzunehmen, weil er alt
  // ist, würde etwas löschen, das man sich verdient hat. Einen Rekord von vor drei Jahren
  // "deine Stärke" zu nennen stimmt aber auch nicht. Das Datum kommt deshalb in der
  // Eigenschaft `achievedAt` mit, und der Screen kann sagen, wie alt er ist. Als
  // Eigenschaft und nicht als anderer Rückgabetyp, weil vier Aufrufer und die Wochenkarte
  // das als einfache Map von Zahlen lesen.
  const achievedAt = new Map();
  const bodyweight = Number(profile?.bodyweight);
  for (const s of sessions) {
    if (!s.finishedAt) continue;
    for (const entry of s.entries) {
      const ex = exerciseById.get(entry.exerciseId);
      if (!ex) continue;
      for (const set of entry.sets.filter(isCounted)) {
        const target = withinE1rmWindow(set) ? best : outside;
        let est;
        if (BODYWEIGHT_STRENGTH_LIFTS.has(benchmarkName(ex.name)) && bodyweight > 0) {
          const added = Number(set.weight) || 0;
          // Bevor es loadMode gab, war das Feld zweideutig: manche haben das ganze
          // Körpergewicht eingetragen, andere nur das Zusatzgewicht. Ein positiver alter Wert
          // darf nicht still doppelt gezählt werden und eine falsche Elite-Wertung ergeben.
          if (set.loadMode === 'bodyweight') est = e1rm(set.systemWeight || set.weight || bodyweight, set.reps);
          else {
            if (added > 0 && set.loadMode !== 'added') continue;
            est = e1rm(set.systemWeight || bodyweight + added, set.reps);
          }
        } else {
          est = e1rm(set.weight, set.reps);
        }
        if (est > (target.get(ex.name) || 0)) {
          target.set(ex.name, est);
          if (target === best) achievedAt.set(ex.name, s.startedAt);
        }
      }
    }
  }
  const extrapolated = new Set();
  for (const [name, est] of outside) {
    if (best.has(name)) continue;
    best.set(name, est);
    extrapolated.add(name);
  }
  best.extrapolated = extrapolated;
  best.achievedAt = achievedAt;
  return best;
}

/** Kleinste-Quadrate-Gerade über [x, y]-Paare, ergibt { slope, intercept } oder null. */
export function linearFit(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const [x, y] of points) { sx += x; sy += y; sxy += x * y; sxx += x * x; }
  const denom = n * sxx - sx * sx;
  if (!denom) return null;
  const slope = (n * sxy - sx * sy) / denom;
  return { slope, intercept: (sy - slope * sx) / n };
}
