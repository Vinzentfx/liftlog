// Strength standards and the rating engine.
//
// Ratings compare an estimated 1RM against published strength standards,
// normalised by bodyweight, sex and age. Two deliberate limits:
//
//  1. Height is NOT an input. No published standard uses it — it affects
//     leverages but isn't part of any normalisation. Including it would be
//     invented precision.
//  2. A movement is only rated when there is something to rate it against:
//     a published standard for the barbell lifts, or a documented ratio to one
//     of them for the machines. Everything else falls back to personal progress
//     instead of a rank.
//
// The numbers below are an approximate consensus of commonly published
// standards. They are a useful yardstick, not a precise measurement.

/**
 * The rank ladder.
 *
 * Nine ranks with three divisions each, so there are 27 steps between the
 * first session and the top of the ladder rather than five. That is the point
 * of the shape: the old five-tier version put Elite at the fourth of four
 * boundaries, which meant a reasonably strong lifter arrived at the top name in
 * the app and then had nowhere left to go for the rest of their training life.
 *
 * The names are deliberately game-like. What they mean is not: every boundary
 * below is anchored to the same published bodyweight multiples the five-tier
 * version used — see LADDER for exactly which rank inherits which anchor.
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
  // Above the published elite standard, where the tables run out and the only
  // honest reference left is competition. These three are extrapolation and are
  // labelled as such in their notes, but the territory is real: a lifter at the
  // elite standard is a strong regional competitor, not the top of the sport.
  { key: 'challenger',  label: 'Challenger',  short: 'Chl' },
  { key: 'immortal',    label: 'Immortal',    short: 'Imm' },
  { key: 'radiant',     label: 'Radiant',     short: 'Rad' },
];

/** Divisions inside a rank, weakest first. Displayed as "Diamond II". */
export const DIVISIONS = ['III', 'II', 'I'];

/** Score width of one rank. Nine ranks across 0–100. */
export const BAND = 100 / TIERS.length;

/** Total steps on the ladder — the denominator of every "step 14 of 27". */
export const RANK_STEPS = TIERS.length * DIVISIONS.length;

/** Body-map regions. Finer than the coarse `muscle` field on an exercise. */
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
 * The four published anchor points per lift, as bodyweight multiples: entry to
 * Novice, Intermediate, Advanced and Elite in the standards these came from.
 * `ladder()` turns them into the nine-rank boundaries the app displays, so the
 * published numbers stay visible and editable in one place.
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

/** Lifts where the load is bodyweight plus any added weight. */
const BODYWEIGHT_INCLUSIVE = new Set([
  'Pull-Up', 'Chin-Up', 'Dip', 'Weighted Pull-Up', 'Weighted Chin-Up', 'Weighted Dip',
]);
const BENCHMARK_BASE = {
  'Weighted Pull-Up': 'Pull-Up', 'Weighted Chin-Up': 'Chin-Up', 'Weighted Dip': 'Dip',
};

/**
 * What the bundled catalogue calls a lift that already has a published standard.
 *
 * free-exercise-db spells a pull-up "Pullups" and splits the dip into a chest
 * and a triceps version, so not one of the three bodyweight benchmarks in
 * BOUNDS appears under the name that table uses. All three produced no rank
 * whatsoever: `isBenchmark` said no, and their equipment ("Bodyweight",
 * "Other") is not rated either, so buildRating skipped them before it ever
 * reached a standard. Somebody doing weighted pull-ups off the bundled library
 * had an unranked back.
 *
 * Deliberately a separate table from ALIAS. ALIAS is forbidden from reaching
 * `isBenchmark`, because a wide-grip pulldown is close enough to borrow a
 * pulldown's ratio and not close enough to inherit its published standard.
 * These are not near variants; they are the same movement under the
 * catalogue's spelling, and saying so has to be its own deliberate list.
 */
export const BENCHMARK_ALIAS = {
  'Pullups': 'Pull-Up',
  'Dips - Chest Version': 'Dip',
  'Dips - Triceps Version': 'Dip',

  // The catalogue and the standards table spell the same movements
  // differently, and where they miss each other the lift ranks nothing at all.
  // "Weighted Pull Ups" is the one that matters most: the published standard is
  // filed under "Weighted Pull-Up", so the hyphen alone was the difference
  // between a ranked lift and an invisible one — and without the alias the
  // training screen also collected it as a plain external load rather than as
  // bodyweight plus a belt.
  'Weighted Pull Ups': 'Weighted Pull-Up',
  'Parallel Bar Dip': 'Dip',
  'Ring Dips': 'Dip',
  'Narrow Parallel Grip Chin-ups': 'Chin-Up',
  // Neutral grip sits between the two, and Chin-Up is the harder standard of
  // the pair, so this is the conservative of the two readings.
  'V-Bar Pullup': 'Chin-Up',
  // Behind the neck is harder than a normal pull-up, never easier, so scoring
  // it against the pull-up standard cannot flatter anybody.
  'Wide-Grip Rear Pull-Up': 'Pull-Up',

  // Deliberately absent, and each for its own reason. "Band Assisted Pull-Up"
  // is assisted, so the number describes the band (see UNRATEABLE). "Bench
  // Dips" and "Weighted Bench Dip" put the feet on the floor and carry a
  // fraction of the load. "Scapular Pull-Up", "One Arm Chin-Up" and "Rocky
  // Pull-Ups/Pulldowns" are different movements, not spellings.
};

/** The benchmark a catalogue name stands for, or the name itself. */
export const benchmarkName = (name) => BENCHMARK_ALIAS[name] || name;

/** Which regions a benchmark lift trains, and how strongly (0–1). */
export const CONTRIB = {
  'Barbell Bench Press':      { chest: 1, 'delts-front': 0.55, triceps: 0.55 },
  'Incline Barbell Bench Press': { chest: 0.95, 'delts-front': 0.7, triceps: 0.5 },
  'Close-Grip Bench Press':   { triceps: 1, chest: 0.7, 'delts-front': 0.5 },
  // The glutes are a prime hip extensor in a squat, which the old 0.75 denied,
  // leaving them unrankable for anybody who squats and does not hip thrust.
  'Back Squat':               { quads: 1, glutes: 0.85, 'lower-back': 0.4, hamstrings: 0.35 },
  'Front Squat':              { quads: 1, glutes: 0.6, abs: 0.45, 'lower-back': 0.35 },
  'Deadlift':                 { 'lower-back': 1, hamstrings: 0.85, glutes: 0.85, traps: 0.55, lats: 0.45, forearms: 0.5 },
  'Sumo Deadlift':            { glutes: 1, quads: 0.7, 'lower-back': 0.8, hamstrings: 0.6, forearms: 0.45 },
  'Romanian Deadlift':        { hamstrings: 1, glutes: 0.8, 'lower-back': 0.6 },
  'Overhead Press':           { 'delts-front': 1, triceps: 0.6, traps: 0.4, abs: 0.3 },
  // In a horizontal row the mid-back is a prime mover, not a bystander. These
  // used to read lats 1.0 against traps 0.65, which described a pulldown: the
  // consequence was that 22 movements touched the trapezius and not one could
  // rank it, so an upper-back exercise left the upper back grey. `traps` here
  // covers the mid and lower trapezius and the rhomboids, which the body map
  // has no separate region for.
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
 * Curated anatomy for movements that have no strength standard.
 *
 * CONTRIB used to do two jobs at once — "which muscles does this train" and
 * "is this a benchmark lift" — which meant the only way to give an exercise
 * proper multi-region anatomy was to invent a standard for it. This table is
 * the first job on its own: machine work gets accurate regions and stays
 * unrated, which is the honest combination.
 *
 * Why machines get no standard: a "100 kg" chest press on one manufacturer's
 * frame is not 100 kg on another. Lever arms differ, plate-loaded and
 * pin-loaded stacks differ, and the starting resistance differs. There is
 * nothing to normalise against, so a tier would be a number with no meaning
 * behind it.
 */
export const CONTRIB_EXTRA = {
  // --- rows and pulls ---
  // Chest-supported work is the most upper-back of the lot: the pad takes the
  // torso out, which is exactly what lets the mid-back do the work.
  'Chest-Supported T-Bar Row': { traps: 1, lats: 0.9, 'delts-rear': 0.8, biceps: 0.5 },
  'Chest-Supported Row':       { traps: 1, lats: 0.9, 'delts-rear': 0.8, biceps: 0.5 },
  'Close-Grip Seated Row':     { lats: 1, traps: 0.9, biceps: 0.6, 'delts-rear': 0.45 },
  'Machine Row':               { lats: 1, traps: 0.95, biceps: 0.5, 'delts-rear': 0.6 },
  'Seated Cable Row':          { lats: 1, traps: 0.95, biceps: 0.55, 'delts-rear': 0.55 },
  'T-Bar Row':                 { lats: 1, traps: 1, biceps: 0.5, 'delts-rear': 0.6, 'lower-back': 0.3 },
  // A high row pulls the elbows out and up, which is a rear-delt movement that
  // happens to be loaded like a row.
  'Machine High Row':          { traps: 1, 'delts-rear': 0.85, lats: 0.9, biceps: 0.45 },
  'Lying T-Bar Row':           { traps: 1, lats: 0.9, 'delts-rear': 0.8, biceps: 0.5 },
  'Machine Pullover':          { lats: 1, chest: 0.4, triceps: 0.3 },
  'Assisted Pull-Up Machine':  { lats: 1, biceps: 0.6, 'delts-rear': 0.3 },

  // --- pressing ---
  'Machine Chest Press':       { chest: 1, 'delts-front': 0.55, triceps: 0.55 },
  'Incline Machine Press':     { chest: 0.95, 'delts-front': 0.7, triceps: 0.5 },
  'Machine Chest Fly':         { chest: 1, 'delts-front': 0.3 },
  'Pec Deck':                  { chest: 1, 'delts-front': 0.25 },
  'Butterfly':                 { chest: 1, 'delts-front': 0.25 },
  'Machine Shoulder Press':    { 'delts-front': 1, triceps: 0.6, traps: 0.35 },
  'Smith Machine Bench Press': { chest: 1, 'delts-front': 0.5, triceps: 0.5 },
  'Smith Machine Incline Bench Press': { chest: 0.95, 'delts-front': 0.7, triceps: 0.5 },
  'Smith Machine Squat':       { quads: 1, glutes: 0.7, 'lower-back': 0.3 },

  // --- arms and delts ---
  'Machine Lateral Raise':     { 'delts-front': 1, traps: 0.3 },
  'Lateral Raise Machine':     { 'delts-front': 1, traps: 0.3 },
  'Machine Rear Delt Fly':     { 'delts-rear': 1, traps: 0.4 },
  'Machine Biceps Curl':       { biceps: 1, forearms: 0.3 },
  // The same movement with a bar in your hands. Curated rather than inferred
  // from the name, like every other row in this table.
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

  // --- lower body and core ---
  'Machine Hip Abduction':     { glutes: 1 },
  'Machine Hip Adduction':     { adductors: 1 },
  'Machine Crunch':            { abs: 1, obliques: 0.35 },
  // Obliques had nothing that could rank them at all: one movement touched them
  // and none drove them. These are the rotation and side-flexion patterns the
  // catalogue actually carries.
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
  // A Y-raise takes the arms up and back. That is the rear delt and the lower
  // trapezius; calling it a front-delt movement was simply wrong.
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

/** Anatomy for any curated movement, benchmark or not. */
export const ANATOMY = { ...CONTRIB_EXTRA, ...CONTRIB };

export const BENCHMARKS = Object.keys(CONTRIB);
export const isBenchmark = (name) => Object.hasOwn(CONTRIB, benchmarkName(name));

/* ===================== machines get a real standard ===================== */

/**
 * What a machine lift is measured against.
 *
 * Recalibrated in August 2026 against the measured full-stack weights of one
 * real gym, which is the only hard data available up here: a stack maximum
 * answers the question a training standard cannot, namely what it *means* to
 * max this particular frame out. The rule used was **Legend ≈ a full stack
 * taken for about ten repetitions**, which is where the one movement with both
 * a published standard and a known stack already sat (a 105 kg pulldown stack
 * against a Legend of 138 kg), so the machines were fitted to agree with it.
 *
 * Two independent checks that the rule is not circular: the chest press was
 * derived from the bench standard long before any stack was measured, and the
 * measured 135 kg stack put it within one percent of where it already was. The
 * pulldown, which has a published standard of its own and never went through
 * this table at all, lands in the same place.
 *
 * A second pass, against one lifter's actual working weights, split the rule in
 * two. Comparing a machine rank with that person's *barbell* rank for the same
 * muscle showed chest agreeing to half a rank and back to a third of one, so
 * those were left exactly as they were. Legs were 2.8 ranks apart — a leg
 * extension outranking the squat of the same person, which is not a thing legs
 * do — and the single-joint arm and shoulder machines sat consistently high.
 *
 * So compound machines keep **Legend ≈ a full stack for ten reps**, and
 * single-joint machines need roughly 1.6 times a full stack instead.
 *
 * A third pass caught what that rule alone cannot see: it treats every machine
 * on an 85 kg stack as the same achievement, and they are not. The same stack
 * carried a triceps pushdown and a preacher curl, so the table ended up
 * claiming that a Legend pushdown and a Legend curl are the same 134 kg —
 * a weight essentially nobody curls and plenty of people push down. The curl
 * factors therefore carry an explicit movement ratio on top of the stack rule:
 * a preacher curl handles roughly 85% of what a pushdown does on a comparable
 * stack, a hammer curl a little more. Confirmed by the lifter it was found
 * through, who maxes the pushdown stack and reaches 88% of the curl one. The
 * structural reason, which is why this is not simply fitted to one person: an
 * isolation stack is generous relative to the force actually produced, because
 * the same 135 kg frame has to serve a leg press and a leg extension. Where the
 * data and that argument disagreed, as on chest, the data won and nothing
 * moved.
 *
 * The consequence is deliberate: on an isolation machine the three ranks above
 * Legend are effectively out of reach, because a commercial stack cannot
 * express national-record strength. That is the honest answer. It is also what
 * fixes the case this was found through, a lateral raise machine handing out
 * the top rank at well under a full stack.
 *
 * The old version rated machines off seven very broad category bands, and both
 * halves of that were wrong at once: the bands were far too soft (Elite on a
 * chest press was 1.40 × bodyweight, a number a great many lifters reach in
 * their second year), and the resulting rank was then discounted to 0.65 on the
 * body map because nobody trusted it. Machine work therefore inflated the rank
 * and contributed almost nothing to the map.
 *
 * This is the honest version of the same idea. A machine has no published
 * standard of its own, but the *ratio* between a machine and the barbell lift it
 * mirrors is stable enough to write down: a seated chest press is a little
 * easier than a bench press, a machine shoulder press a little heavier than a
 * standing overhead press because the seat takes the trunk out of it, a leg
 * extension is roughly half a squat. So the standard is derived — the barbell
 * ladder for that movement, scaled — which makes it as strict as the barbell
 * standard it comes from and lets it count fully.
 *
 * The factors are gym-floor consensus, not measurements, and they cannot be:
 * lever arms and stack ratios differ between manufacturers, which is exactly
 * what `scoreForMachine` blends same-model community data into once there is
 * any. LOW_CONFIDENCE carries that caveat to the screen.
 *
 * @type {Object<string, [string, number]>}  name -> [barbell lift, factor]
 */
const MACHINE_ANCHOR = {
  // --- rows and pulls ---
  // The chest-supported rows carried a 10% premium over a barbell row, on the
  // reasoning that taking the lower back and hips out of the movement lets you
  // pull more. That part is true. What it missed is the other side of the
  // comparison: a barbell row is logged as bar plus plates, and a plate-loaded
  // T-bar is logged as plates alone. The lever's own weight never reaches the
  // number, so the premium was being charged against a load that already
  // understates itself by roughly the same amount. The two cancel, and 1.00 is
  // what is left. The free T-bar row keeps its step below the supported one.
  //
  // This is a calibration against a logging convention, not a claim that the
  // movements are equally hard. Anybody who knows what their frame actually
  // resists at the handles should set a load correction and override it.
  'Chest-Supported T-Bar Row':  ['Barbell Row', 1.00],
  'Chest-Supported Row':        ['Barbell Row', 1.00],
  'Close-Grip Seated Row':      ['Barbell Row', 1.17],
  'Machine Row':                ['Barbell Row', 1.17],
  'Seated Cable Row':           ['Barbell Row', 1.17],
  'T-Bar Row':                  ['Barbell Row', 0.95],
  // Unreachable: ALIAS resolves this name to Chest-Supported T-Bar Row before
  // the anchor is looked up. Kept in step so it cannot mislead a reader.
  'Lying T-Bar Row':            ['Barbell Row', 1.00],
  'Machine High Row':           ['Barbell Row', 1.20],
  'Iso-Lateral High Row':       ['Barbell Row', 1.15],
  'Iso-Lateral Low Row':        ['Barbell Row', 1.15],
  'Machine Pullover':           ['Lat Pulldown', 0.70],
  'Plate-Loaded Pullover':      ['Lat Pulldown', 0.70],
  'Single-Arm Lat Pulldown':    ['Lat Pulldown', 0.50],
  'Lat Pulldown Machine':       ['Lat Pulldown', 1.00],

  // --- pressing ---
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

  // --- arms and delts ---
  'Machine Lateral Raise':      ['Overhead Press', 1.13],
  'Lateral Raise Machine':      ['Overhead Press', 1.13],
  'Cable Y-Raise':              ['Overhead Press', 0.56],
  'Cross-Body Cable Lateral Raise': ['Overhead Press', 0.33],
  'Machine Rear Delt Fly':      ['Barbell Row', 0.91],
  'Machine Biceps Curl':        ['Barbell Row', 0.78],
  // Not a machine. See DERIVED_FREE_WEIGHT: a barbell curl had no way to rank
  // anything, because rateability was decided by equipment and "Barbell" was
  // not on the list. 0.52 puts the elite band at 0.96 of the allometric
  // reference, which is where the published barbell-curl standard sits — a
  // little under bodyweight for a strong lifter. Routing it through the machine
  // curl instead would have given 107 kg, because a cam helps and a bar does
  // not.
  'Barbell Curl':               ['Barbell Row', 0.52],
  'Machine Preacher Curl':      ['Barbell Row', 0.76],
  'Preacher Curl Machine':      ['Barbell Row', 0.76],
  'Rope Hammer Curl':           ['Barbell Row', 0.80],
  // Forearms move a lot of weight through almost no range, so the number on the
  // stack is at its least honest here of anywhere in the gym.
  'Cable Wrist Curl':           ['Barbell Row', 0.90],
  'Bayesian Cable Curl':        ['Barbell Row', 0.19],
  'Machine Triceps Extension':  ['Close-Grip Bench Press', 0.89],
  'Triceps Pushdown':           ['Close-Grip Bench Press', 0.89],
  'Rope Triceps Pushdown':      ['Close-Grip Bench Press', 0.86],
  'Overhead Rope Triceps Extension': ['Close-Grip Bench Press', 1.43],

  // --- lower body and core ---
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
 * The same movement under the name the library actually uses.
 *
 * The curated tables above were written against the seed list; the bundled
 * catalogue calls a lot of the same machines something else ("Ab Crunch
 * Machine" for Machine Crunch, "Leg Extensions" with an s, four different
 * spellings of a triceps pushdown). Without this an exercise gets ranked off
 * the coarse category bands and contributes to no muscle at all, which is how
 * an ab machine ended up invisible on the body map while still producing a
 * rank.
 *
 * Aliasing affects anatomy, the machine anchor and the category — never
 * `isBenchmark`, because a wide-grip pulldown is close enough to borrow the
 * pulldown's ratio and not close enough to inherit its published standard.
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

  // The barbell curl the catalogue never calls a barbell curl. Every one of
  // these is a two-handed bar curl differing only in grip or bench angle, and
  // each was invisible to the rating under its own name.
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
  // Deliberately NOT aliased here: a plain "Preacher Curl" is a bench in some
  // gyms and a stack in others, and MACHINE_ANCHOR already carries the machine
  // one. Guessing which the lifter means is how a rank ends up built on the
  // wrong standard.

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

  // Variants that differ from an anchored name by a letter, a bracket or a word
  // order. Each of these was falling through to the coarse category bands and
  // coming out at Legend on a normal stack.
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

/** The name the curated tables know this movement by. */
export const canonical = (name) => ALIAS[name] || BENCHMARK_ALIAS[name] || name;

/**
 * Movements a load cannot be ranked on at all, whatever the equipment says.
 *
 * An assisted pull-up machine counts *downwards* — the number on the stack is
 * how much of you the machine is carrying, so a higher number is a weaker
 * lifter. Ranking it would invert the entire ladder for anyone who uses it.
 */
const UNRATEABLE = new Set(['Assisted Pull-Up Machine', 'Reverse Nordic Curl']);

/**
 * Fallback bands for a machine with no anchor — a custom exercise, or one of the
 * long tail of the library. Same four published anchor points as a barbell lift
 * (novice / intermediate / advanced / elite entry) so they run through the same
 * ladder.
 *
 * These have to stay in step with MACHINE_ANCHOR, and once did not: when the
 * anchored isolation machines were tightened, this table was left behind, so
 * `upperIsolation` sat at a Legend of 85 kg while every *recognised* isolation
 * machine asked for 110 to 175. The result was that the 63 library movements
 * with no anchor became the easiest route to a rank in the whole app — a full
 * cable tower on a wrist curl came out Radiant. An unrecognised machine must
 * never be an easier route than a recognised one, and there is a test for it.
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
  // Heavy compound patterns, before anything else gets a chance to call them
  // isolation. A Smith machine deadlift landing on the triceps band is not a
  // rounding error, it is three ranks.
  if (/(squat|lunge|split squat|step-up)/.test(n)) return 'lowerPress';
  if (/(deadlift|dead lift|good morning|hang clean|power clean|romanian)/.test(n)) return 'hip';
  if (/(shrug|high pull)/.test(n)) return 'upperPull';

  // Then which half of the body it is. An unrecognised leg machine used to land
  // on the triceps band, which is the wrong direction to be wrong in: it made
  // an unknown lower-body movement far easier to rank than a known one.
  if (/(leg|glute|hamstring|quad|thigh|calf|hip|adduct|abduct)/.test(n)) return 'lowerIsolation';
  if (/(abs|core|oblique|crunch|sit-up|plank)/.test(n)) return 'core';
  if (/(fly|flye|pec|rear delt|lateral raise)/.test(n)) return 'upperIsolation';
  if (/(press|dip)/.test(n)) return 'upperPress';
  return 'upperIsolation';
}

/** Equipment whose loads this engine is willing to rank. */
export const RATED_EQUIPMENT = new Set(['Machine', 'Cable']);

/**
 * Free weights that rank through an anchor rather than a table of their own.
 *
 * Rateability used to be decided entirely by equipment: a benchmark, or a
 * Machine or Cable. The effect was that the *same movement* ranked or did not
 * depending on which implement was in the lifter's hands — "Standing Biceps
 * Cable Curl" gave the biceps a rank, "Wide-Grip Standing Barbell Curl" gave
 * them nothing at all, and 292 barbell and dumbbell movements in the bundled
 * catalogue contributed to no muscle and no score. That is not a calibration
 * judgement, it is a filter drawn around the wrong property.
 *
 * The fix is small on purpose. This is an explicit opt-in list, not the
 * category fallback that unknown machines get: those bands were fitted to pin
 * stacks, and letting every unrecognised barbell movement fall into them would
 * hand out ranks nobody calibrated. A name gets in here only when it has an
 * entry in MACHINE_ANCHOR with the derivation written next to it.
 *
 * Dumbbells stay out, and the reason is the logging convention rather than the
 * lifting: the app records one bell, so the number on screen is half the work,
 * and choosing where to put that factor is the user's call and not this file's.
 */
export const DERIVED_FREE_WEIGHT = new Set(['Barbell Curl']);

/**
 * Can this movement carry a rank at all? The one place that answers it.
 *
 * The rule used to be written out by hand in three places — `buildRating` here,
 * and twice in history.js for the Progress line — and the copies had already
 * drifted: the two in history.js tested equipment directly and so quietly
 * dropped every plate-loaded lift that `ratedMachineNames` had just admitted.
 * Adding free weights to one copy would have split Home and Progress properly
 * in half, with the same barbell curl ranked on one screen and invisible on the
 * other. One function, three callers, no drift.
 *
 * @param name          the lift's catalogue name
 * @param machineNames  the set from `ratedMachineNames`, for this catalogue
 */
export const isRateable = (name, machineNames) => !!name
  && (isBenchmark(name) || machineNames.has(name) || DERIVED_FREE_WEIGHT.has(canonical(name)));

/**
 * Movements that take real plates on a real bar, whatever the catalogue calls
 * their equipment.
 *
 * A chest-supported T-bar row is not a stack machine: it is a barbell with a
 * pad, and the number logged is plates. That matters three times over. The
 * full-stack calibration rule has nothing to say about it, because there is no
 * stack to max. The "count half of it" correction is about a display showing
 * both sides at once, which a plate-loaded bar does not do. And on the body map
 * it should win a tie the way a barbell does, because it is one.
 *
 * It also has to be rankable at all: several of these are tagged `Barbell` in
 * the catalogue, which kept them out of RATED_EQUIPMENT entirely, so a
 * plate-loaded T-bar row produced no rank whatsoever.
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
 * Every exercise name whose load gets a rank without a published standard.
 *
 * Cables used to be excluded outright, which quietly meant a pushdown, a cable
 * row and a Bayesian curl were worth nothing at all — the same stack, the same
 * pin, ranked or unranked depending on which side of the frame the pulley was
 * bolted to.
 */
export function ratedMachineNames(exercises = []) {
  return new Set(exercises
    .filter((ex) => (RATED_EQUIPMENT.has(ex.equipment) || isPlateLoaded(ex.name))
      && !isBenchmark(ex.name) && !UNRATEABLE.has(ex.name))
    .map((ex) => ex.name));
}

/* ===================== the ladder ===================== */

const geo = (a, b) => Math.sqrt(a * b);

/**
 * Multipliers on the published elite standard for the three ranks above it.
 *
 * There is nothing to interpolate up here, so these are the one genuinely
 * extrapolated part of the ladder and they are kept in their own table where
 * that is visible. They are calibrated against competition rather than against
 * a training standard: at 80 kg bodyweight, Radiant is a 248 kg bench, a 331 kg
 * squat and a 375 kg deadlift, which is the neighbourhood of a national record
 * and not a number anybody reaches by accident.
 */
const BEYOND_ELITE = [1.10, 1.22, 1.38];

/**
 * Four published anchors → the eleven boundaries of the twelve-rank ladder.
 *
 * Every published number keeps its meaning; the new ranks are inserted between
 * them rather than replacing them:
 *
 *   Silver      = a little over half the novice standard
 *   Gold        = published Novice
 *   Platinum    = between novice and intermediate
 *   Diamond     = published Intermediate
 *   Master      = between intermediate and advanced
 *   Grandmaster = published Advanced
 *   Elite       = between advanced and elite
 *   Legend      = published Elite
 *   Challenger / Immortal / Radiant = BEYOND_ELITE, above every table
 *
 * Geometric rather than arithmetic midpoints, because strength standards are
 * multiplicative: the gap from 1.25 to 1.75 × bodyweight is a bigger job than
 * the same 0.5 lower down, and the halfway point people actually experience is
 * the ratio, not the difference.
 */
export function ladder(anchors) {
  const [novice, intermediate, advanced, elite] = anchors;
  return [
    novice * 0.55, novice, geo(novice, intermediate), intermediate,
    geo(intermediate, advanced), advanced, geo(advanced, elite), elite,
    ...BEYOND_ELITE.map((factor) => elite * factor),
  ];
}

/** Ranks with no published standard behind them at all. */
export const EXTRAPOLATED_TIERS = new Set(['challenger', 'immortal', 'radiant']);

/**
 * Everything in this file is kilograms, and the app is not.
 *
 * The published standards are bodyweight multiples against a 60 or 80 kg
 * reference, and the allometric exponent means the arithmetic is *not*
 * unit-agnostic: feeding it pounds does not cancel out, it inflates. The same
 * lifter logged in pounds came out a rank and a half stronger than in
 * kilograms, silently, for as long as the setting has existed. So the ratio is
 * computed in kilograms whatever the app is displaying, and anything handed
 * back for a screen is converted return.
 */
const LB_PER_KG = 2.2046226218;
const toKg = (value, units) => (units === 'lb' ? Number(value) / LB_PER_KG : Number(value));
const fromKg = (value, units) => (units === 'lb' ? value * LB_PER_KG : value);

/**
 * Where a load sits on the scale the standards are written against.
 *
 * Two forms, and which one applies is a property of the lift.
 *
 * **Allometric**, for anything with a load you choose. Muscle cross-section
 * scales with mass to about the two-thirds power, so a bigger lifter is
 * expected to move more in absolute terms and less per kilo of themselves. The
 * reference bodyweight is the one the published tables were written at, so a
 * lifter of exactly that weight scores precisely what the table says.
 *
 * **Bodyweight-relative**, for a pull-up, a chin-up or a dip, where the load
 * *is* the lifter. The allometric form counts bodyweight on both sides of the
 * fraction there, and the two do not cancel: with nothing added it reduces to
 * `(bw / reference) ^ 0.33`, a number that depends on nothing but the scale in
 * the bathroom. The result was a rank that went **up** when the lifter gained
 * weight and did exactly as many pull-ups as before — three steps, from Silver
 * I at 70 kg to Gold II at 100 kg, for the same single rep. Every other lift in
 * the app moves the other way, correctly, and so does reality.
 *
 * A plain multiple of bodyweight is also how these particular standards are
 * published ("advanced = 1.55 x bodyweight"), and it agrees with the allometric
 * form exactly at the reference weight, so nothing that was calibrated there
 * moves.
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

/** The inverse of strengthRatio, in whatever unit the app is displaying. */
export function weightForRatio(ratio, profile, { bodyweightRelative = false } = {}) {
  const sex = profile.sex === 'female' ? 'female' : 'male';
  const bw = toKg(profile.bodyweight, profile.units);
  if (!bw || bw <= 0) return null;
  if (bodyweightRelative) return fromKg(ratio * bw, profile.units);
  const referenceBw = sex === 'female' ? 60 : 80;
  return fromKg(ratio * Math.pow(bw, 0.67) * Math.pow(referenceBw, 0.33), profile.units);
}

/** Is this lift's load the lifter's own body? Then see `strengthRatio`. */
const carriesOwnBodyweight = (liftName) => BODYWEIGHT_INCLUSIVE.has(benchmarkName(liftName));

/**
 * Strength peaks roughly 20–35. Older lifters get a proportionally easier
 * standard; under-20s a slightly easier one too.
 */
export function ageFactor(age) {
  const a = Number(age);
  if (!a || a <= 0) return 1;
  if (a < 20) return 0.95;
  if (a <= 35) return 1;
  return Math.max(0.72, 1 - (a - 35) * 0.006);
}

/**
 * Continuous 0–100 score across the eight boundaries.
 *
 * Bands are equal width, so the score encodes both the rank and how far through
 * it you are. Above the last boundary the score climbs to 100 over a further
 * 25% of the top standard, which is what stops Legend from being a wall the
 * moment it is reached.
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

/** scoreFromBounds turned inside out: the ratio a target score asks for. */
function ratioFromScore(score, bounds) {
  const band = 100 / (bounds.length + 1);
  const i = Math.floor(score / band);
  const frac = score / band - i;
  if (i <= 0) return bounds[0] * frac;
  if (i >= bounds.length) return bounds[bounds.length - 1] * (1 + 0.25 * Math.min(1, frac));
  return bounds[i - 1] + (bounds[i] - bounds[i - 1]) * frac;
}

/**
 * The eight boundaries for one lift, age-adjusted, or null when the lift has no
 * standard at all. `machine` decides which table is consulted.
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

  // Same-model community percentiles, blended into the four anchors before the
  // ladder is built from them — the cloud stores four quantiles, which is
  // exactly the shape the published tables come in.
  const observed = community && [community.q20, community.q40, community.q60, community.q80].map(Number);
  if (Number(community?.count) >= 10 && observed?.every((v, i) => v > 0 && (!i || v > observed[i - 1]))) {
    // Seed data never disappears entirely; even a popular model can have a
    // biased user base. At 100 observations the community contributes 80%.
    const blend = Math.min(0.8, 0.15 + (Number(community.count) - 10) / 90 * 0.65);
    seed = seed.map((v, i) => v * (1 - blend) + observed[i] * blend);
  }
  return ladder(seed).map((v) => v * f);
}

/**
 * How much a rank built outside the valid repetition window is trusted.
 *
 * Not zero: a lifter who only ever trains a machine at fifteen reps should get
 * a rank rather than a blank. Not one either, and the number is deliberately
 * the same size as the machine discount it replaced, because the uncertainty is
 * the same kind: a real measurement read through a formula that was not fitted
 * for it.
 */
const EXTRAPOLATED_CONFIDENCE = 0.85;

/** How much a free weight ranked through somebody else's standard is trusted. */
const DERIVED_CONFIDENCE = 0.9;

/** How much a machine's rank is trusted on the shared body map. */
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
 * Benchmarks whose standard is shakier than the rest, and why.
 *
 * Leg press is the honest problem case in this table: published standards for
 * it exist and circulate widely, but the load depends entirely on the machine's
 * leverage and sled weight, which vary hugely. Two lifters pressing the same
 * number on different machines are not doing the same work. The rank is kept
 * because leaving quads unranked for a machine trainee is worse, but the caveat
 * travels with it wherever it is shown.
 */
export const LOW_CONFIDENCE = {
  // A key, not a sentence. This used to hold finished English prose and was
  // rendered straight onto the screen, which made it the one line of the German
  // interface that was not in German — and invisible to the i18n test, which
  // only reads strings.js.
  'Leg Press': 'standards.lowConfidence.legPress',
};

/**
 * The epsilon exists because 100/9 does not divide 100.
 *
 * A lift landing exactly on a published anchor scores exactly `n × BAND`, and
 * without this that division comes back as 5.999999 and prints the rank below
 * the one the standard says. It is not a rounding preference, it is the
 * difference between "you have reached Grandmaster" and "you have not".
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
 * Rank, division, and how far through the division you are.
 *
 * `step` is the absolute position on the 27-step ladder, which is the number to
 * compare across time: it is the one value that goes up by exactly one every
 * time there is something to celebrate.
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
    /** 0–1 through the current division. */
    progress: into * DIVISIONS.length - d,
    step: i * DIVISIONS.length + d + 1,
    steps: RANK_STEPS,
    top: i === TIERS.length - 1 && d === DIVISIONS.length - 1,
  };
}

/** The score at which the next division, and the next rank, begin. */
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
 * The lift that a target score asks for, in kilograms on the bar.
 *
 * For a bodyweight-inclusive movement the standard is written against the whole
 * system, so the answer is what to *add*, which is what a pull-up belt takes.
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

/** kg still needed to reach the next rank, or null at the top. */
export function toNextTier(liftName, score, profile, opts = {}) {
  const next = nextThresholds(score);
  if (!next || next.tier === null) return null;
  const weight = weightForScore(liftName, next.tier, profile, opts);
  return weight === null ? null : { tier: TIERS[tierIndex(score) + 1], weight };
}

/** kg still needed to reach the next division — the small, frequent win. */
export function toNextDivision(liftName, score, profile, opts = {}) {
  const next = nextThresholds(score);
  if (!next || next.division === null) return null;
  const weight = weightForScore(liftName, next.division, profile, opts);
  if (weight === null) return null;
  const rank = rankOf(next.division + 0.0001);
  return { tier: rank.tier, division: rank.division, weight };
}

/**
 * How much a lift has to train a region before that region counts as measured.
 *
 * This exists because of a category error that ran for a long time. A region's
 * score is `lift score × how strongly that lift trains it`, and that second
 * number is a *contribution* weight: how much the squat stimulates hamstrings.
 * It was then being read as a *strength* discount, so somebody whose only
 * hamstring evidence was a squat got hamstrings = 35% of their squat rank, and
 * that fed straight into the average.
 *
 * The effect was severe and one-directional. A real lifter's directly trained
 * regions averaged 53 while the six read only through a secondary contribution
 * came out at 14 to 30, dragging the overall from Grandmaster to Diamond. The
 * app was not telling them their hamstrings were weak. It was telling them it
 * had never looked, in a voice that sounded like a verdict.
 *
 * So the weight now **gates** rather than **scales**. At or above this, the lift
 * is a primary or near-primary driver for that region and the region simply
 * takes the lift's rank, undiscounted: if your incline press is Grandmaster,
 * your chest is Grandmaster, not 95% of Grandmaster. Below it there is no rank
 * at all. The region is reported as touched indirectly, by name, and left grey.
 *
 * That last part is the half it took two goes to get right. Taking these out of
 * the *average* was not enough, because the discounted number was still printed
 * on the map and in the region sheet. A trapezius reading of "Diamond II"
 * computed as `row rank x 0.7` is not a weak trapezius, it is a row.
 */
export const DIRECT_CONTRIBUTION = 0.8;

/**
 * Per-region and overall rating.
 *
 * A region's score is the best (lift score × how strongly that lift trains it)
 * across the lifts the user actually performs. Taking the max rather than an
 * average means skipping one lift doesn't drag a region down — but a region you
 * never train stays unrated rather than scoring zero.
 *
 * Machines now count fully, because they finally have a standard worth counting
 * (see MACHINE_ANCHOR). Free weights still win a tie: where a barbell lift and a
 * machine land a region on the same number, the one measured against a published
 * standard is the one named as the source.
 *
 * @param bestByLift Map of lift name -> best estimated 1RM
 */
/**
 * How far above the rest of somebody's training a lift has to sit before the
 * app says something. Two whole ranks.
 *
 * The case this exists for: a machine that shows the total stack while each arm
 * moves half of it, or a plate-loaded frame logged as the sum of both sides, or
 * a stack marked in pounds typed in as kilograms. All three produce a number
 * that is right for the machine and wrong for the standard, and the symptom is
 * always the same shape — one movement standing several ranks clear of
 * everything else the same person does.
 *
 * It is a question, never a correction. The app does not know which of those
 * three it is, or whether somebody simply has freakish side delts, so it says
 * what it noticed and offers the fix rather than applying one.
 */
const OUTLIER_RANKS = 2;

/** Lifts below this many rated movements cannot have an outlier: too short a list. */
const OUTLIER_MIN_PEERS = 3;

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * @param loadFactors  name -> multiplier applied to the estimate before it is
 *                     ranked. This corrects how a machine *reports* load; the
 *                     log itself is never touched, because what you typed is
 *                     what you did.
 * @param stackMax     name -> the heaviest the stack goes, when the user has
 *                     said. Turns "this looks high" into "this is 1.7 times a
 *                     full stack", which is evidence rather than a hunch.
 * @param regionsByName name -> { region: weight }, from the exercises
 *                     themselves. The fallback for anything the curated
 *                     ANATOMY table has never heard of.
 */
export function buildRating(bestByLift, profile,
  {
    machineNames = new Set(), community = {},
    extrapolated = bestByLift.extrapolated, achievedAt = bestByLift.achievedAt,
    loadFactors = {}, stackMax = {}, regionsByName = {},
  } = {}) {
  const regions = {};
  // Regions no lift drives hard enough to rank, and the best lift that touches
  // them. Deliberately not a score: a number here is what caused the bug this
  // replaced.
  const indirect = {};
  // Every lift that *could* rank each region, so the rating can say whether a
  // rank is corroborated or resting on one movement.
  const support = {};
  const lifts = [];
  const outside = extrapolated instanceof Set ? extrapolated : new Set();
  const dates = achievedAt instanceof Map ? achievedAt : new Map();

  for (const [rawName, rawOrm] of bestByLift) {
    const name = rawName;
    const factor = Number(loadFactors[name]) > 0 ? Number(loadFactors[name]) : 1;
    const orm = rawOrm * factor;
    // Two different questions. `anchored` decides which table the score is read
    // from — anything without a published standard of its own goes through
    // MACHINE_ANCHOR. `machine` is what the lift *is*, and it stays false for a
    // free weight so that a barbell curl wins a tie like the free weight it is
    // and never turns up under "your machine records".
    const derivedFree = !isBenchmark(name) && DERIVED_FREE_WEIGHT.has(canonical(name));
    const machine = machineNames.has(name) && !isBenchmark(name);
    const anchored = machine || derivedFree;
    if (!isRateable(name, machineNames)) continue;
    const score = anchored
      ? scoreForMachine(name, orm, profile, community[name])
      : scoreFor(name, orm, profile);
    if (score === null) continue;
    const sample = Number(community[name]?.count) || 0;
    // `anchored`, not `machine`: this decides which table the *next* target is
    // read off, and it has to be the same table the score came from. Passing
    // `machine` here sent a barbell curl to look for its own published
    // standard, found nothing, and printed "top of the ladder reached" on a
    // Master II lift with six ranks still above it.
    const opts = { machine: anchored, community: community[name] || null };
    lifts.push({
      name, oneRepMax: orm, score, tier: tierOf(score), rank: rankOf(score),
      next: toNextTier(name, score, profile, opts),
      nextDivision: toNextDivision(name, score, profile, opts),
      machine, plateLoaded: isPlateLoaded(name),
      derived: machine && !!MACHINE_ANCHOR[canonical(name)],
      provisional: machine && sample < 10, sample,
      // Built from a set outside the range a 1RM estimate is valid over, because
      // this lift has never been trained inside it. See THRESHOLDS.e1rmWindow.
      extrapolated: outside.has(name),
      // When the best was set. A rank is an all-time record, and a record has a
      // date on it or it is being passed off as something it is not.
      achievedAt: dates.get(name) ?? null,
      corrected: factor !== 1,
      // Beyond what the stack can physically produce, once Epley's slack at one
      // rep is allowed for. Only answerable when the user has said what the
      // stack tops out at.
      overStack: Number(stackMax[name]) > 0 && orm > Number(stackMax[name]) * 1.4
        ? { max: Number(stackMax[name]), times: orm / Number(stackMax[name]) }
        : null,
    });

    // Curated anatomy first, then the regions the exercise itself carries.
    // Without the fallback, 52 machine and cable movements in the bundled
    // catalogue produced a rank and contributed to no muscle at all: they had
    // no curated entry, so the body map never saw them. Those regions come from
    // the library record, not from guessing at the name.
    const anatomy = ANATOMY[canonical(name)] || regionsByName[name] || {};
    for (const [region, weight] of Object.entries(anatomy)) {
      if (weight < DIRECT_CONTRIBUTION) {
        // Touched, not measured. Remembered by name so the map can say which
        // lift reaches it, and given no score at all.
        const seen = indirect[region];
        if (!seen || score > seen.score) indirect[region] = { via: name, score };
        continue;
      }
      // How far this lift can be trusted, which is a separate question from how
      // strong it says the lifter is. It used to be multiplied into the number,
      // and that put the same lift on the screen at two different ranks: a
      // machine chest press trained at fifteen reps read Diamond I on the lift
      // list and Diamond III on the body map, two ranks apart, with nothing on
      // either screen to say why. Uncertainty about a measurement is not
      // evidence of weakness, and a lifter who only has machines was quietly
      // paying a rank for the equipment their gym happens to own.
      //
      // So it does what a confidence belongs doing: it decides how much this
      // region pulls on the overall average, and it rides along on the region so
      // the map can mark it. The rank itself is the rank.
      const confidence = (machine ? machineConfidence(name, community[name])
        // A free weight read off somebody else's standard is a derived number,
        // and it weighs like one. Since the discount now lives in the average
        // rather than in the score, the lifter still sees the rank they earned.
        : derivedFree ? DERIVED_CONFIDENCE : 1)
        * (outside.has(name) ? EXTRAPOLATED_CONFIDENCE : 1);
      const value = score;
      const held = regions[region];
      // Ties go to the published standard: a machine only takes a region off a
      // barbell lift by being strictly better.
      // A plate-loaded bar counts as a free weight for the tie-break, because
      // it is one. Only a stack loses a tie to a published standard.
      const stack = machine && !isPlateLoaded(name);
      // Every qualifying driver is remembered, not only the winner. The rank
      // itself is still the best of them (see below), but how many there are and
      // how far apart they sit is the useful part that a single number hides.
      (support[region] ||= []).push({ name, score: value });
      const better = !held || value > held.score
        || (!stack && held.stack && value >= held.score)
        // A dead-level tie between two lifts of the same kind goes to the one
        // the app is surer of, which is the only remaining thing to separate
        // them now that confidence no longer moves the score.
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

  // Now that every lift has a score, ask which of them does not belong. A lift
  // is only its own outlier: the comparison is against the median of the
  // others, so one very strong movement cannot hide behind itself.
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
  // Overall is the mean of *directly measured* regions. An unrated region isn't
  // a zero, it's an absence of data, and a region seen only through somebody
  // else's lift is much closer to an absence than to a measurement — see
  // DIRECT_CONTRIBUTION. Falls back to everything rated when nothing at all was
  // trained directly, which is a brand-new log rather than a real training
  // history, and a number is better than a blank there.
  // A region that ended up ranked does not also need an "only touched" note.
  for (const region of Object.keys(regions)) delete indirect[region];
  // And the score that picked the best touching lift does not leave this
  // function. It exists to break a tie between two lifts, not to be printed,
  // and a number reachable from the outside is a number that ends up on a
  // screen: that is precisely the bug this whole rule replaced.
  const touched = {};
  for (const [region, seen] of Object.entries(indirect)) touched[region] = { via: seen.via };
  const counted = rated;

  /**
   * A rank is the best demonstration, and this says how well corroborated it is.
   *
   * Deliberately not an average. Averaging the movements that train a muscle
   * punishes having several: somebody who benches heavy and also does two light
   * accessory flies would rank below somebody who only benches, which
   * contradicts both the plan rating (it rewards two movements per muscle) and
   * common sense, because their chest can still bench what it benches. And the
   * single-movement failure mode averaging is meant to guard against is already
   * handled: an outlier that disagrees with everything else gets flagged and
   * offered a correction.
   *
   * So the number stays the best driver, and the spread rides alongside it. On
   * one real log the well-covered regions agreed to within half a rank across
   * three movements each, while quads came out 1.3 ranks apart between a squat
   * and a leg extension. That disagreement is worth saying out loud. Hiding it
   * inside a mean would have turned it into a number that describes neither.
   */
  for (const [region, drivers] of Object.entries(support)) {
    if (!regions[region]) continue;
    const scores = drivers.map((d) => d.score);
    regions[region].drivers = drivers.length;
    regions[region].spread = drivers.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0;
  }
  // Weighted by confidence rather than counted flat. A region measured through
  // a machine nobody has calibrated still says something, and dropping it would
  // leave a machine-only lifter with no overall at all; letting it count as much
  // as a barbell bench against a published table would be pretending the two
  // measurements are equally good. This is the one place the discount belongs.
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
 * Fallback anatomy from the exercises themselves.
 *
 * Primary regions count fully, secondary at half, which is the same fractional
 * convention the plan rating and the weekly volume already use
 * (THRESHOLDS.indirectSetWeight). Only ever consulted for movements the curated
 * table does not cover.
 */
/**
 * Which movements can put a rank on this region.
 *
 * The answer to the fair complaint that a grey muscle is a dead end: it is not,
 * and the app should say what would light it up rather than leaving somebody to
 * guess. Ordered by how strongly each drives the region, so the first suggestion
 * is the most direct one.
 */
export function liftsThatRank(region) {
  return Object.entries(ANATOMY)
    .filter(([, weights]) => (weights[region] || 0) >= DIRECT_CONTRIBUTION)
    .sort((a, b) => (b[1][region] || 0) - (a[1][region] || 0))
    .map(([name]) => name);
}

/**
 * How strongly one named exercise drives a region, 0 when it does not.
 *
 * Resolves through the alias, which is the whole point: a suggestion has to be
 * phrased in the names the user's own library uses, not in the curated ones.
 * "Do a Cable Oblique Twist" is useless advice when their catalogue calls it
 * Cable Russian Twists.
 */
export function drivesRegion(name, region) {
  return (ANATOMY[canonical(name)] || {})[region] || 0;
}

export const canRank = (name, region) => drivesRegion(name, region) >= DIRECT_CONTRIBUTION;

/**
 * How strongly one exercise trains each region, curated where possible.
 *
 * The one place in the app that answers "which muscles, and how much" for an
 * arbitrary exercise. ANATOMY is hand-written and graded from 0 to 1; the
 * catalogue's own primary/secondary lists are coarse (a movement is either a
 * chest exercise or it is not) and are the fallback rather than the answer.
 *
 * The fallback's 1 and 0.5 are the same fractional convention the plan rating
 * and the weekly volume already count with, so nothing invents a third scale
 * for the same idea.
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
