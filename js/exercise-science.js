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
  // --- exceptions that have to beat the generic rules further down ---
  // "Reverse Machine Flyes" has to lose to this rule and not to the chest-fly
  // one below, hence the gap allowance rather than a straight "reverse fly".
  { re: /reverse.{0,16}(fly|flye|pec deck)|rear (delt|deltoid)|bent[- ]?over.{0,12}(lateral|rear|fly|flye)/i,
    bias: SHORT, why: 'Peak resistance lands with the rear delt already contracted' },
  { re: /(spider|concentration) curl/i,
    bias: SHORT, why: 'Shoulder flexed, so the biceps never reaches a long length under load' },
  { re: /drag curl/i, bias: SHORT, why: 'The elbow travels back, shortening the biceps as you lift' },
  { re: /cable.{0,16}(lateral|side) raise|lean[- ]?away|cross[- ]?body (lateral|raise)/i,
    bias: MIXED, why: 'A cable from behind the body keeps tension on where the delt is longer' },

  // --- long: load lands on a stretched muscle ---
  { re: /pullover/i, bias: LONG, why: 'Loads the muscle overhead, at its longest' },
  { re: /incline.{0,16}curl|bayesian/i,
    bias: LONG, why: 'Arm behind the body puts the biceps under load at full stretch' },
  { re: /preacher|scott curl/i,
    bias: LONG, why: 'Hardest at the bottom, where the biceps is stretched' },
  { re: /bent[- ]?over.{0,26}tricep/i,
    bias: SHORT, why: 'A kickback finishes where the triceps is already short' },
  { re: /skull ?crusher|nose breaker|french press|overhead.{0,16}(tricep|extension)|(lying|incline|seated|decline).{0,16}tricep/i,
    bias: LONG, why: 'Elbow overhead or behind you — the long head of the triceps is loaded stretched' },
  { re: /romanian deadlift|\brdl\b|stiff[- ]?leg|straight[- ]?leg deadlift|good morning|nordic|glute[- ]?ham|pull[- ]?through/i,
    bias: LONG, why: 'A hip hinge loads the hamstrings at full length at the bottom' },
  { re: /seated leg curl/i,
    bias: LONG, why: 'Hips flexed, so the hamstrings work from a longer position than a lying curl' },
  { re: /pec deck|chest fly|cable (cross|fly|flye)|dumbbell (fly|flye)|\bflyes?\b|butterfly|iron cross|cross[- ]?over/i,
    bias: LONG, why: 'A fly stretches the working muscle under load at the bottom' },
  { re: /\bdips?\b/i, bias: LONG, why: 'The deep bottom position loads the muscle stretched' },
  // Shoulder pressing has to be taken out before the dumbbell-press rule below.
  // Without this "Arnold Dumbbell Press" reads as a chest movement and the app
  // explains a delt exercise in terms of pectoral stretch — which is how the
  // swap suggestions first exposed the bug.
  { re: /(shoulder|overhead|military|arnold|bradford).{0,12}press/i,
    bias: MIXED, why: 'Delts work through the middle of the range' },
  { re: /press/i, when: (ex) => ex.muscle === 'Shoulders',
    bias: MIXED, why: 'Delts work through the middle of the range' },
  // Guarded by the muscle field as well as the name: "Seated Dumbbell Press" is
  // a shoulder movement that the name rule alone would happily call a chest one.
  { re: /(dumbbell|db) (bench |incline |decline )?press/i, when: (ex) => ex.muscle === 'Chest',
    bias: LONG, why: 'Dumbbells let the chest reach a longer stretch than a bar allows' },
  { re: /hack squat|sissy squat|pendulum squat|(bulgarian|split) squat|\blunge/i,
    bias: LONG, why: 'Deep knee and hip flexion — the quads are loaded at length' },
  { re: /\bsquats?\b/i,
    bias: LONG, why: 'Loaded through deep knee and hip flexion — provided you actually go deep' },
  { re: /pull[- ]?up|chin[- ]?up|pull[- ]?down/i,
    bias: LONG, why: 'The lats start fully lengthened overhead' },
  { re: /calf (raise|press)|calves press|donkey|toe press/i,
    bias: LONG, why: 'The bottom of a calf raise is the stretched position — do not cut it short' },
  { re: /hanging (leg|knee)|ab wheel|ab roller|roll[- ]?out|dragon flag/i,
    bias: LONG, why: 'Loads the abs lengthened rather than crunched' },
  { re: /deadlift/i,
    bias: LONG, why: 'Hamstrings and glutes are loaded long off the floor' },

  // --- short: peak resistance where the muscle is already shortened ---
  { re: /hip thrust|glute bridge|kick[- ]?back|glute machine|bridg(e|ing)|hip (extension|lift) with band/i,
    bias: SHORT, why: 'Hardest at lockout, where the glutes are fully contracted' },
  { re: /rack pull/i,
    bias: SHORT, why: 'Starts above the knee, so the hamstrings never reach full length' },
  { re: /(board|floor|pin) press/i,
    bias: SHORT, why: 'Cuts the bottom of the press off on purpose — the chest never stretches' },
  { re: /front (dumbbell |cable |barbell |plate )?raise/i,
    bias: SHORT, why: 'Front delt peaks where it is already contracted' },
  { re: /shrug/i, bias: SHORT, why: 'Traps are already short where the load peaks' },
  { re: /push[- ]?down|press[- ]?down/i,
    bias: SHORT, why: 'Elbow pinned at your side — the triceps long head never gets stretched' },
  { re: /crunch|sit[- ]?up|ab machine/i, bias: SHORT, why: 'Abs are loaded in the shortened position' },
  { re: /upright row/i, bias: SHORT, why: 'Delts peak where they are already contracted' },
  { re: /face pull/i, bias: SHORT, why: 'Resistance peaks with the rear delts contracted' },
  { re: /(lateral|side) raise/i,
    bias: SHORT, why: 'A free-weight lateral raise is hardest at the top, where the delt is short' },

  // --- mixed: tension across the range, or it depends how you do it ---
  { re: /leg extension/i,
    bias: MIXED, why: 'Resistance peaks near lockout, but the vasti still work at depth' },
  { re: /leg press/i, bias: MIXED, why: 'Depends entirely on how deep you go' },
  { re: /leg curl/i, bias: MIXED, why: 'Hips extended, so less hamstring stretch than a seated curl' },
  { re: /\brows?\b|rowing/i, bias: MIXED, why: 'Rowing works the back through the middle of its range' },
  { re: /(bench|chest) press|push[- ]?up/i, bias: MIXED, why: 'A bar or the floor stops the stretch early' },
  { re: /(shoulder|overhead|military|arnold) press/i, bias: MIXED, why: 'Delts work through the middle of the range' },
  { re: /(tricep|triceps) (extension|press)/i, bias: MIXED, why: 'Depends on where the elbow sits — check yours' },
  { re: /hyper[- ]?extension|back extension/i, bias: MIXED, why: 'Erectors work through the middle of the range' },
  { re: /curl/i, bias: MIXED, why: 'Loads the muscle through the middle of its range' },
];

/**
 * Movements where something other than the target muscle decides when the set
 * ends — grip, the lower back, or balance. Those sets buy less growth per unit
 * of fatigue. That is a training-practice argument rather than a study result,
 * and the UI labels it as one.
 */
const LIMITER_RULES = [
  { re: /deadlift|rack pull|snatch[- ]?grip|farmer|shrug/i,
    level: 'other', why: 'Grip and lower back usually quit before the target muscle does' },
  { re: /(bent[- ]?over|pendlay|barbell) row|t[- ]?bar/i,
    level: 'other', why: 'Holding the torso over costs more than the lats spend' },
  { re: /good morning|back extension|hyper[- ]?extension/i,
    level: 'other', why: 'Lower-back fatigue is the limit here, not the hamstrings' },
  { re: /(back|front|zercher|overhead) squat|^squat|clean|snatch|jerk|thruster/i,
    level: 'mixed', why: 'Systemic and lower-back fatigue add to what the legs cost' },
  { re: /(military|standing.{0,12}overhead|barbell shoulder) press/i,
    level: 'mixed', why: 'Core and balance take a share of the effort' },
  { re: /pull[- ]?up|chin[- ]?up/i,
    level: 'mixed', why: 'Grip can end the set, and adding load needs a belt or a machine' },
  { re: /(dumbbell|db|one[- ]?arm|single[- ]?arm).{0,12}row/i,
    level: 'mixed', why: 'Grip fades before the lats on higher-rep sets' },
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
    why: 'Not classified — no published read on where this one loads the muscle',
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
    return { level: 'target', why: 'Single joint — the muscle you are training is what fails', classified: true };
  }
  // Supported multi-joint work. Being braced by a machine or a cable stack is
  // exactly what removes balance and torso fatigue from the equation — which is
  // a fatigue argument, not the growth claim the old rating used to make about
  // free weights (SOURCES.haugen2023).
  if (ex?.equipment === 'Machine' || ex?.equipment === 'Cable') {
    return { level: 'target', why: 'Supported, so the target muscle is what runs out', classified: true };
  }
  return { level: 'mixed', why: 'Multi-joint, but nothing obvious gives out before the target', classified: false };
}

export const LENGTH_LABEL = {
  long: 'Loaded at long muscle length',
  mixed: 'Loaded through the middle of the range',
  short: 'Loaded at short muscle length',
};
