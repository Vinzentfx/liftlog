// Per-exercise properties that the catalogue does not record but the research
// cares about: at what muscle length the load actually lands, and whether the
// target muscle is the thing that gives out first.
//
// Neither can be derived from the free-exercise-db fields, so both are curated
// name rules. The rules are deliberately conservative — an exercise that no rule
// recognises comes back as `classified: false` and is scored neutrally rather
// than guessed at. A large share of the 900-odd catalogue entries are obscure
// variants that genuinely have no published answer; pretending otherwise would
// be inventing precision, the same reason height is left out of the strength
// standards.
//
// See js/evidence.js — SOURCES.wolf2025 for the length-bias evidence.

/**
 * Where the exercise loads the target muscle.
 *   long  — meaningful tension while the muscle is stretched (the good case)
 *   mixed — tension spread across the range, or depth-dependent
 *   short — peak resistance lands where the muscle is already shortened
 */
const LONG = 'long', MIXED = 'mixed', SHORT = 'short';

/**
 * First match wins, so order matters: exceptions sit above the general rules.
 * The same movement name can mean opposite things for different muscles — a
 * chest fly stretches the pec, a rear-delt fly does the reverse — so those
 * pairs are separated by name rather than by muscle field, which the imported
 * data fills in too loosely to trust.
 */
const LENGTH_RULES = [
  { re: /decline.{0,32}press|press.{0,32}decline/i,
    bias: SHORT, why: 'science.declinePress' },
  // --- exceptions that have to beat the generic rules further down ---
  // "Reverse Machine Flyes" has to lose to this rule and not to the chest-fly
  // one below, hence the gap allowance rather than a straight "reverse fly".
  { re: /reverse.{0,16}(fly|flye|pec deck)|rear (delt|deltoid)|bent[- ]?over.{0,12}(lateral|rear|fly|flye)/i,
    bias: SHORT, why: 'science.reverseFlyFlye' },
  { re: /(spider|concentration) curl/i,
    bias: SHORT, why: 'science.spiderConcentrationCurl' },
  { re: /drag curl/i, bias: SHORT, why: 'science.dragCurl' },
  { re: /cable.{0,16}(lateral|side) raise|lean[- ]?away|cross[- ]?body (lateral|raise)/i,
    bias: MIXED, why: 'science.cableLateralSide' },

  // --- long: load lands on a stretched muscle ---
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
  // Shoulder pressing has to be taken out before the dumbbell-press rule below.
  // Without this "Arnold Dumbbell Press" reads as a chest movement and the app
  // explains a delt exercise in terms of pectoral stretch — which is how the
  // swap suggestions first exposed the bug.
  { re: /(shoulder|overhead|military|arnold|bradford).{0,12}press/i,
    bias: MIXED, why: 'science.shoulderOverheadMilitary' },
  { re: /press/i, when: (ex) => ex.muscle === 'Shoulders',
    bias: MIXED, why: 'science.press' },
  // Guarded by the muscle field as well as the name: "Seated Dumbbell Press" is
  // a shoulder movement that the name rule alone would happily call a chest one.
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

  // --- short: peak resistance where the muscle is already shortened ---
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

  // --- mixed: tension across the range, or it depends how you do it ---
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
 * Movements where something other than the target muscle decides when the set
 * ends — grip, the lower back, or balance. Those sets buy less growth per unit
 * of fatigue. That is a training-practice argument rather than a study result,
 * and the UI labels it as one.
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
    // `when` narrows a rule that the name alone cannot decide — the same words
    // mean different things on different muscles.
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
  // Supported multi-joint work. Being braced by a machine or a cable stack is
  // exactly what removes balance and torso fatigue from the equation — which is
  // a fatigue argument, not the growth claim the old rating used to make about
  // free weights (SOURCES.haugen2023).
  if (ex?.equipment === 'Machine' || ex?.equipment === 'Cable') {
    return { level: 'target', why: 'science.supported', classified: true };
  }
  return { level: 'mixed', why: 'science.multiJoint', classified: false };
}

/**
 * How much the setup lets the target muscle express effort without balance or
 * implement control ending the set. This is a practical quality, not proof
 * that machines grow more than free weights at matched effort.
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

// Keys, resolved by the caller. See js/strings.js.
export const LENGTH_LABEL = {
  long: 'science.label.long',
  mixed: 'science.label.mixed',
  short: 'science.label.short',
};
