// Eigenschaften einer Übung, die der Katalog nicht kennt, die Forschung aber schon:
// bei welcher Muskellänge die Last wirklich ankommt, und ob der Zielmuskel als
// Erstes aufgibt.
//
// Aus den Feldern von free-exercise-db lässt sich beides nicht ableiten, also sind
// es gepflegte Namensregeln. Die sind bewusst vorsichtig: eine Übung, die keine
// Regel erkennt, kommt als `classified: false` zurück und wird neutral bewertet
// statt geraten. Ein großer Teil der rund 900 Einträge im Katalog sind seltene
// Varianten, zu denen es wirklich keine veröffentlichte Antwort gibt. So zu tun,
// als gäbe es eine, wäre ausgedachte Genauigkeit, aus demselben Grund fehlt die
// Körpergröße in den Kraftstandards.
//
// Die Belege zur Muskellänge stehen in js/evidence.js unter SOURCES.wolf2025.

/**
 * Wo die Übung den Zielmuskel belastet.
 *   long   deutliche Spannung, während der Muskel gedehnt ist (der gute Fall)
 *   mixed  Spannung über den ganzen Weg verteilt, oder abhängig von der Tiefe
 *   short  der größte Widerstand kommt, wenn der Muskel schon verkürzt ist
 */
const LONG = 'long', MIXED = 'mixed', SHORT = 'short';

/**
 * Die erste passende Regel gewinnt, die Reihenfolge ist also wichtig: Ausnahmen
 * stehen über den allgemeinen Regeln. Derselbe Name kann bei verschiedenen Muskeln
 * das Gegenteil bedeuten (Flys dehnen die Brust, Reverse Flys für die hintere
 * Schulter machen das Umgekehrte). Solche Paare werden deshalb über den Namen
 * getrennt und nicht über das Muskelfeld, das die importierten Daten zu locker füllen.
 */
const LENGTH_RULES = [
  { re: /decline.{0,32}press|press.{0,32}decline/i,
    bias: SHORT, why: 'science.declinePress' },
  // Ausnahmen, die vor den allgemeinen Regeln weiter unten greifen müssen
  // "Reverse Machine Flyes" muss an dieser Regel hängen bleiben und nicht an der für
  // Brust-Flys weiter unten, deshalb die erlaubte Lücke statt eines festen "reverse fly".
  { re: /reverse.{0,16}(fly|flye|pec deck)|rear (delt|deltoid)|bent[- ]?over.{0,12}(lateral|rear|fly|flye)/i,
    bias: SHORT, why: 'science.reverseFlyFlye' },
  { re: /(spider|concentration) curl/i,
    bias: SHORT, why: 'science.spiderConcentrationCurl' },
  { re: /drag curl/i, bias: SHORT, why: 'science.dragCurl' },
  { re: /cable.{0,16}(lateral|side) raise|lean[- ]?away|cross[- ]?body (lateral|raise)/i,
    bias: MIXED, why: 'science.cableLateralSide' },

  // long: die Last kommt auf den gedehnten Muskel
  { re: /pullover/i, bias: LONG, why: 'science.pullover' },
  { re: /incline.{0,16}curl|bayesian/i,
    bias: LONG, why: 'science.inclineCurlBayesian' },
  { re: /preacher|scott curl/i,
    bias: LONG, why: 'science.preacherScottCurl' },
  { re: /bent[- ]?over.{0,26}tricep/i,
    bias: SHORT, why: 'science.bentOverTricep' },
  { re: /skull ?crusher|nose breaker|french press|overhead.{0,16}(tricep|extension)|(lying|incline|seated|decline).{0,16}tricep/i,
    bias: LONG, why: 'science.skullCrusherNose' },
  { re: /romanian deadlift|\brdl\b|stiff[- ]?leg|straight[- ]?leg deadlift|good morning|nordic|glute[- ]?ham|pull[- ]?through/i,
    bias: LONG, why: 'science.romanianDeadliftBrdl' },
  { re: /glute[- ]?biased.{0,20}back extension/i,
    bias: LONG, why: 'science.gluteBiasedBackExtensionLength' },
  { re: /seated leg curl/i,
    bias: LONG, why: 'science.seatedLegCurl' },
  { re: /pec deck|chest fly|cable (cross|fly|flye)|dumbbell (fly|flye)|\bflyes?\b|butterfly|iron cross|cross[- ]?over/i,
    bias: LONG, why: 'science.pecDeckChest' },
  { re: /\bdips?\b/i, bias: LONG, why: 'science.bdips' },
  // Schulterdrücken muss vor der Kurzhantel-Drück-Regel darunter raus. Ohne das
  // gilt "Arnold Dumbbell Press" als Brustübung, und die App erklärt eine
  // Schulterübung mit der Dehnung der Brust. So ist der Fehler über die
  // Tauschvorschläge überhaupt aufgefallen.
  { re: /(shoulder|overhead|military|arnold|bradford).{0,12}press/i,
    bias: MIXED, why: 'science.shoulderOverheadMilitary' },
  { re: /press/i, when: (ex) => ex.muscle === 'Shoulders',
    bias: MIXED, why: 'science.press' },
  // Zusätzlich über das Muskelfeld abgesichert: "Seated Dumbbell Press" ist eine
  // Schulterübung, die die Namensregel allein gern zur Brustübung machen würde.
  { re: /(dumbbell|db) (bench |incline |decline )?press/i, when: (ex) => ex.muscle === 'Chest',
    bias: LONG, why: 'science.dumbbellDbBench' },
  { re: /hack squat|sissy squat|pendulum squat|(bulgarian|split) squat|\blunge/i,
    bias: LONG, why: 'science.hackSquatSissy' },
  { re: /\bsquats?\b/i,
    bias: LONG, why: 'science.bsquats' },
  { re: /pull[- ]?up|chin[- ]?up|pull[- ]?down/i,
    bias: LONG, why: 'science.pullUpChin' },
  { re: /calf (raise|press)|calves press|donkey|toe press/i,
    bias: LONG, why: 'science.calfRaisePress' },
  { re: /hanging (leg|knee)|ab wheel|ab roller|roll[- ]?out|dragon flag/i,
    bias: LONG, why: 'science.hangingLegKnee' },
  { re: /deadlift/i,
    bias: LONG, why: 'science.deadlift' },

  // short: der größte Widerstand kommt, wenn der Muskel schon verkürzt ist
  { re: /hip thrust|glute bridge|kick[- ]?back|glute machine|bridg(e|ing)|hip (extension|lift) with band/i,
    bias: SHORT, why: 'science.hipThrustGlute' },
  { re: /rack pull/i,
    bias: SHORT, why: 'science.rackPull' },
  { re: /(board|floor|pin) press/i,
    bias: SHORT, why: 'science.boardFloorPin' },
  { re: /front (dumbbell |cable |barbell |plate )?raise/i,
    bias: SHORT, why: 'science.frontDumbbellCable' },
  { re: /shrug/i, bias: SHORT, why: 'science.shrug' },
  { re: /push[- ]?down|press[- ]?down/i,
    bias: SHORT, why: 'science.pushDownPress' },
  { re: /crunch|sit[- ]?up|ab machine/i, bias: SHORT, why: 'science.crunchSitUp' },
  { re: /upright row/i, bias: SHORT, why: 'science.uprightRow' },
  { re: /face pull/i, bias: SHORT, why: 'science.facePull' },
  { re: /(lateral|side) raise/i,
    bias: SHORT, why: 'science.lateralSideRaise' },

  // mixed: Spannung über den ganzen Weg, oder es hängt von der Ausführung ab
  { re: /leg extension/i,
    bias: MIXED, why: 'science.legExtension' },
  { re: /leg press/i, bias: MIXED, why: 'science.legPress' },
  { re: /leg curl/i, bias: MIXED, why: 'science.legCurl' },
  { re: /\brows?\b|rowing/i, bias: MIXED, why: 'science.browsRowing' },
  { re: /(bench|chest) press|push[- ]?up/i, bias: MIXED, why: 'science.benchChestPress' },
  { re: /(shoulder|overhead|military|arnold) press/i, bias: MIXED, why: 'science.shoulderOverheadMilitary2' },
  { re: /(tricep|triceps) (extension|press)/i, bias: MIXED, why: 'science.tricepTricepsExtension' },
  { re: /hyper[- ]?extension|back extension/i, bias: MIXED, why: 'science.hyperExtensionBack' },
  { re: /curl/i, bias: MIXED, why: 'science.curl' },
];

/**
 * Bewegungen, bei denen etwas anderes als der Zielmuskel entscheidet, wann der Satz
 * endet: Griff, unterer Rücken oder Gleichgewicht. Solche Sätze bringen pro Ermüdung
 * weniger Wachstum. Das ist ein Argument aus der Trainingspraxis und kein
 * Studienergebnis, und die Oberfläche kennzeichnet es auch so.
 */
const LIMITER_RULES = [
  { re: /bodyweight (fly|flye)|stability ball|swiss ball|bosu|suspension|trx|ring (fly|push)/i,
    level: 'other', why: 'science.unstableLimiter' },
  { re: /glute[- ]?biased.{0,20}back extension/i,
    level: 'target', why: 'science.gluteBiasedBackExtension' },
  { re: /deadlift|rack pull|snatch[- ]?grip|farmer|shrug/i,
    level: 'other', why: 'science.deadliftRackPull' },
  { re: /chest[- ]?supported.{0,24}(row|t[- ]?bar)|(row|t[- ]?bar).{0,24}chest[- ]?supported/i,
    level: 'target', why: 'science.chestSupportedRow' },
  { re: /(bent[- ]?over|pendlay|barbell) row|t[- ]?bar/i,
    level: 'other', why: 'science.bentOverPendlay' },
  { re: /good morning|back extension|hyper[- ]?extension/i,
    level: 'other', why: 'science.goodMorningBack' },
  { re: /(back|front|zercher|overhead) squat|^squat|clean|snatch|jerk|thruster/i,
    level: 'mixed', why: 'science.backFrontZercher' },
  { re: /(military|standing.{0,12}overhead|barbell shoulder) press/i,
    level: 'mixed', why: 'science.militaryStandingOverhead' },
  { re: /pull[- ]?up|chin[- ]?up/i,
    level: 'mixed', why: 'science.pullUpChin2' },
  { re: /(dumbbell|db|one[- ]?arm|single[- ]?arm).{0,12}row/i,
    level: 'mixed', why: 'science.dumbbellDbOne' },
];

/** @returns {{bias:'long'|'mixed'|'short', why:string, classified:boolean}} */
export function lengthBias(ex) {
  const name = ex?.name || '';
  for (const rule of LENGTH_RULES) {
    if (!rule.re.test(name)) continue;
    // `when` grenzt eine Regel ein, die der Name allein nicht entscheiden kann.
    // Dieselben Wörter bedeuten bei verschiedenen Muskeln etwas anderes.
    if (rule.when && !rule.when(ex || {})) continue;
    return { bias: rule.bias, why: rule.why, classified: true };
  }
  return {
    bias: MIXED,
    why: 'science.notClassified',
    classified: false,
  };
}

/** @returns {{level:'target'|'mixed'|'other', why:string, classified:boolean}} */
export function limiter(ex) {
  const name = ex?.name || '';
  for (const rule of LIMITER_RULES) {
    if (rule.re.test(name)) return { level: rule.level, why: rule.why, classified: true };
  }
  if (ex?.mech === 'isolation') {
    return { level: 'target', why: 'science.singleJoint', classified: true };
  }
  // Gestützte Mehrgelenksübungen. Von einer Maschine oder einem Kabelzug gehalten zu
  // werden nimmt genau das Gleichgewicht und die Rumpfermüdung aus der Rechnung.
  // Das ist ein Argument über Ermüdung und nicht die Behauptung zum Wachstum, die die
  // alte Bewertung über freie Gewichte aufgestellt hat (SOURCES.haugen2023).
  if (ex?.equipment === 'Machine' || ex?.equipment === 'Cable') {
    return { level: 'target', why: 'science.supported', classified: true };
  }
  return { level: 'mixed', why: 'science.multiJoint', classified: false };
}

/**
 * Wie gut der Aufbau den Zielmuskel sich anstrengen lässt, ohne dass Gleichgewicht
 * oder die Kontrolle über das Gerät den Satz beenden. Eine praktische Eigenschaft,
 * kein Beweis, dass Maschinen bei gleicher Anstrengung mehr aufbauen als freie Gewichte.
 */
const STABILITY_RULES = [
  { re: /bodyweight (fly|flye)|ring (fly|push)|suspension|trx|swiss ball|bosu|stability ball|exercise ball/i,
    level: 'unstable', points: 0, why: 'science.stabilityUnstable' },
  { re: /one[- ]?arm.{0,24}(fly|flye)|renegade row|overhead squat|single[- ]?leg.{0,18}(deadlift|rdl)/i,
    level: 'demanding', points: 0.5, why: 'science.stabilityDemanding' },
  { re: /chest[- ]?supported|machine|pec deck|butterfly|smith|seated leg|lying leg|leg (press|extension|curl)/i,
    level: 'supported', points: 1.5, why: 'science.stabilitySupported' },
  { re: /(lying|seated|incline|decline|bench).{0,24}(fly|flye|curl|extension|press)|cable (fly|flye|cross)/i,
    level: 'stable', points: 1.25, why: 'science.stabilityStable' },
  { re: /glute[- ]?biased.{0,20}back extension/i,
    level: 'stable', points: 1.25, why: 'science.stabilityStable' },
  { re: /(bent[- ]?over|pendlay|barbell) row|good morning|standing.{0,18}(press|raise)|walking lunge/i,
    level: 'demanding', points: 0.75, why: 'science.stabilityDemanding' },
];

export function stability(ex) {
  const name = ex?.name || '';
  for (const rule of STABILITY_RULES) {
    if (rule.re.test(name)) return { level: rule.level, points: rule.points, why: rule.why, classified: true };
  }
  if (ex?.equipment === 'Machine') {
    return { level: 'supported', points: 1.5, why: 'science.stabilitySupported', classified: true };
  }
  if (ex?.equipment === 'Cable') {
    return { level: 'stable', points: 1.25, why: 'science.stabilityStable', classified: true };
  }
  return { level: 'normal', points: 1, why: 'science.stabilityNormal', classified: false };
}

// Schlüssel, der Aufrufer löst sie auf. Siehe js/strings.js.
export const LENGTH_LABEL = {
  long: 'science.label.long',
  mixed: 'science.label.mixed',
  short: 'science.label.short',
};
