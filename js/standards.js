// Strength standards and the rating engine.
//
// Ratings compare an estimated 1RM against published strength standards,
// normalised by bodyweight, sex and age. Two deliberate limits:
//
//  1. Height is NOT an input. No published standard uses it — it affects
//     leverages but isn't part of any normalisation. Including it would be
//     invented precision.
//  2. Only benchmark lifts are rated. There is no meaningful standard for a
//     cable lateral raise, and machine lifts vary too much between
//     manufacturers to compare. Everything else falls back to personal
//     progress instead of a tier.
//
// The numbers below are an approximate consensus of commonly published
// standards. They are a useful yardstick, not a precise measurement.

export const TIERS = [
  { key: 'beginner',     label: 'Beginner',     short: 'Beg' },
  { key: 'novice',       label: 'Novice',       short: 'Nov' },
  { key: 'intermediate', label: 'Intermediate', short: 'Int' },
  { key: 'advanced',     label: 'Advanced',     short: 'Adv' },
  { key: 'elite',        label: 'Elite',        short: 'Eli' },
];

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
 * Bodyweight multiples marking entry into Novice / Intermediate / Advanced /
 * Elite. Below the first value is Beginner.
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
const BODYWEIGHT_INCLUSIVE = new Set(['Pull-Up', 'Chin-Up', 'Dip']);

/** Which regions a benchmark lift trains, and how strongly (0–1). */
export const CONTRIB = {
  'Barbell Bench Press':      { chest: 1, 'delts-front': 0.55, triceps: 0.55 },
  'Incline Barbell Bench Press': { chest: 0.95, 'delts-front': 0.7, triceps: 0.5 },
  'Close-Grip Bench Press':   { triceps: 1, chest: 0.7, 'delts-front': 0.5 },
  'Back Squat':               { quads: 1, glutes: 0.75, 'lower-back': 0.4, hamstrings: 0.35 },
  'Front Squat':              { quads: 1, glutes: 0.6, abs: 0.45, 'lower-back': 0.35 },
  'Deadlift':                 { 'lower-back': 1, hamstrings: 0.85, glutes: 0.85, traps: 0.55, lats: 0.45, forearms: 0.5 },
  'Sumo Deadlift':            { glutes: 1, quads: 0.7, 'lower-back': 0.8, hamstrings: 0.6, forearms: 0.45 },
  'Romanian Deadlift':        { hamstrings: 1, glutes: 0.8, 'lower-back': 0.6 },
  'Overhead Press':           { 'delts-front': 1, triceps: 0.6, traps: 0.4, abs: 0.3 },
  'Barbell Row':              { lats: 1, traps: 0.65, biceps: 0.55, 'delts-rear': 0.55 },
  'Pendlay Row':              { lats: 1, traps: 0.7, biceps: 0.5, 'delts-rear': 0.55 },
  'Hip Thrust':               { glutes: 1, hamstrings: 0.55 },
  'Lat Pulldown':             { lats: 1, biceps: 0.55, 'delts-rear': 0.35 },
  'Leg Press':                { quads: 1, glutes: 0.6 },
  'Pull-Up':                  { lats: 1, biceps: 0.6, forearms: 0.4, 'delts-rear': 0.3 },
  'Chin-Up':                  { lats: 0.9, biceps: 0.85, forearms: 0.4 },
  'Dip':                      { triceps: 1, chest: 0.8, 'delts-front': 0.5 },
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
  'Chest-Supported T-Bar Row': { lats: 1, traps: 0.7, 'delts-rear': 0.6, biceps: 0.5 },
  'Chest-Supported Row':       { lats: 1, traps: 0.65, 'delts-rear': 0.6, biceps: 0.5 },
  'Close-Grip Seated Row':     { lats: 1, biceps: 0.6, traps: 0.5, 'delts-rear': 0.35 },
  'Machine Row':               { lats: 1, traps: 0.6, biceps: 0.5, 'delts-rear': 0.5 },
  'Seated Cable Row':          { lats: 1, traps: 0.55, biceps: 0.55, 'delts-rear': 0.4 },
  'T-Bar Row':                 { lats: 1, traps: 0.65, biceps: 0.5, 'delts-rear': 0.45, 'lower-back': 0.3 },
  'Machine High Row':          { lats: 1, traps: 0.6, 'delts-rear': 0.5, biceps: 0.45 },
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
  'Machine Preacher Curl':     { biceps: 1, forearms: 0.25 },
  'Preacher Curl Machine':     { biceps: 1, forearms: 0.25 },
  'Rope Hammer Curl':          { biceps: 0.75, forearms: 1 },
  'Machine Triceps Extension': { triceps: 1 },
  'Overhead Rope Triceps Extension': { triceps: 1 },
  'Triceps Pushdown':          { triceps: 1 },
  'Rope Triceps Pushdown':     { triceps: 1 },
  'Machine Dip':               { triceps: 1, chest: 0.75, 'delts-front': 0.45 },

  // --- lower body and core ---
  'Machine Hip Abduction':     { glutes: 1 },
  'Machine Hip Adduction':     { adductors: 1 },
  'Machine Crunch':            { abs: 1, obliques: 0.35 },
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
  'Reverse Nordic Curl':       { quads: 1, abs: 0.25 },
  'Glute-Biased 45-Degree Back Extension': { glutes: 1, hamstrings: 0.7, 'lower-back': 0.3 },
  'Cable Y-Raise':             { 'delts-front': 1, traps: 0.45 },
  'Iso-Lateral Chest Press':   { chest: 1, 'delts-front': 0.55, triceps: 0.55 },
  'Iso-Lateral Incline Chest Press': { chest: 0.95, 'delts-front': 0.7, triceps: 0.5 },
  'Iso-Lateral Shoulder Press': { 'delts-front': 1, triceps: 0.6, traps: 0.35 },
  'Iso-Lateral High Row':      { lats: 1, traps: 0.65, 'delts-rear': 0.55, biceps: 0.45 },
  'Iso-Lateral Low Row':       { lats: 1, biceps: 0.55, traps: 0.5, 'delts-rear': 0.4 },
  'Plate-Loaded Pullover':     { lats: 1, chest: 0.35, triceps: 0.25 },
  'Glute Drive Machine':       { glutes: 1, hamstrings: 0.5 },
  'Standing Hip Abduction Machine': { glutes: 1 },
  'Kneeling Leg Curl Machine': { hamstrings: 1, calves: 0.2 },
  'Seated Dip Machine':        { triceps: 1, chest: 0.75, 'delts-front': 0.4 },
};

/** Anatomy for any curated movement, benchmark or not. */
export const ANATOMY = { ...CONTRIB_EXTRA, ...CONTRIB };

export const BENCHMARKS = Object.keys(CONTRIB);
export const isBenchmark = (name) => Object.hasOwn(CONTRIB, name);

// Provisional machine standards. These broad groups intentionally start
// conservative: the printed stack is not the force at the handle. They are a
// useful first estimate only, and can be blended with same-model community
// percentiles by scoreForMachine as observations accumulate.
const MACHINE_BOUNDS = {
  male: {
    upperPress: [0.40, 0.70, 1.05, 1.40], upperPull: [0.45, 0.75, 1.10, 1.45],
    upperIsolation: [0.15, 0.28, 0.45, 0.65], lowerPress: [1.20, 2.00, 3.00, 4.20],
    lowerIsolation: [0.35, 0.60, 0.90, 1.30], hip: [0.80, 1.40, 2.10, 3.00],
    core: [0.35, 0.60, 0.90, 1.30],
  },
  female: {
    upperPress: [0.25, 0.45, 0.70, 1.00], upperPull: [0.30, 0.50, 0.75, 1.05],
    upperIsolation: [0.10, 0.18, 0.30, 0.45], lowerPress: [0.90, 1.50, 2.30, 3.20],
    lowerIsolation: [0.25, 0.42, 0.65, 0.95], hip: [0.65, 1.10, 1.70, 2.50],
    core: [0.25, 0.42, 0.65, 0.95],
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
  return 'upperIsolation';
}

export function strengthRatio(oneRepMax, profile) {
  const sex = profile.sex === 'female' ? 'female' : 'male';
  const bw = Number(profile.bodyweight);
  if (!bw || bw <= 0 || !oneRepMax) return null;
  const referenceBw = sex === 'female' ? 60 : 80;
  return oneRepMax / (Math.pow(bw, 0.67) * Math.pow(referenceBw, 0.33));
}

function scoreFromBounds(ratio, bounds) {
  let score;
  if (ratio < bounds[0]) score = 20 * ratio / bounds[0];
  else if (ratio < bounds[1]) score = 20 + 20 * (ratio - bounds[0]) / (bounds[1] - bounds[0]);
  else if (ratio < bounds[2]) score = 40 + 20 * (ratio - bounds[1]) / (bounds[2] - bounds[1]);
  else if (ratio < bounds[3]) score = 60 + 20 * (ratio - bounds[2]) / (bounds[3] - bounds[2]);
  else score = 80 + 20 * Math.min(1, (ratio - bounds[3]) / (bounds[3] * 0.3));
  return Math.max(0, Math.min(100, score));
}

export function scoreForMachine(liftName, oneRepMax, profile, community = null) {
  const sex = profile.sex === 'female' ? 'female' : 'male';
  const ratio = strengthRatio(oneRepMax, profile);
  if (ratio === null) return null;
  const seed = MACHINE_BOUNDS[sex][machineCategory(liftName)].map((v) => v * ageFactor(profile.age));
  let bounds = seed;
  const observed = community && [community.q20, community.q40, community.q60, community.q80]
    .map((value) => Number(value) * ageFactor(profile.age));
  if (Number(community?.count) >= 10 && observed?.every((v, i) => v > 0 && (!i || v > observed[i - 1]))) {
    // Seed data never disappears entirely; even a popular model can have a
    // biased user base. At 100 observations the community contributes 80%.
    const blend = Math.min(0.8, 0.15 + (Number(community.count) - 10) / 90 * 0.65);
    bounds = seed.map((v, i) => v * (1 - blend) + observed[i] * blend);
  }
  return scoreFromBounds(ratio, bounds);
}

/**
 * Benchmarks whose standard is shakier than the rest, and why.
 *
 * Leg press is the honest problem case in this table: published standards for
 * it exist and circulate widely, but the load depends entirely on the machine's
 * leverage and sled weight, which vary hugely. Two lifters pressing the same
 * number on different machines are not doing the same work. The tier is kept
 * because leaving quads unrated for a machine trainee is worse, but the caveat
 * travels with it wherever it is shown.
 */
export const LOW_CONFIDENCE = {
  'Leg Press': 'Machine leverage and sled weight vary enormously between manufacturers, so the same number means different things in different gyms. Treat this tier as a rough placement, and trust your own progression on the machine you actually use.',
};

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
 * Continuous 0–100 score. Tier bands are 20 points wide, so the score encodes
 * both the tier and how far through it you are.
 */
export function scoreFor(liftName, oneRepMax, profile) {
  const sex = profile.sex === 'female' ? 'female' : 'male';
  const bw = Number(profile.bodyweight);
  if (!bw || bw <= 0 || !oneRepMax) return null;

  const table = BOUNDS[sex][liftName];
  if (!table) return null;

  // 1RM for bodyweight movements is already the estimated total system load.
  // Allometric scaling avoids the strong bias of dividing linearly by BW.
  const ratio = strengthRatio(oneRepMax, profile);

  // Easier standard for masters / juniors => divide the bar, not the lifter.
  const f = ageFactor(profile.age);
  const b = table.map((v) => v * f);

  let score;
  if (ratio < b[0]) score = 20 * (ratio / b[0]);
  else if (ratio < b[1]) score = 20 + 20 * (ratio - b[0]) / (b[1] - b[0]);
  else if (ratio < b[2]) score = 40 + 20 * (ratio - b[1]) / (b[2] - b[1]);
  else if (ratio < b[3]) score = 60 + 20 * (ratio - b[2]) / (b[3] - b[2]);
  else score = 80 + 20 * Math.min(1, (ratio - b[3]) / (b[3] * 0.3));

  return Math.max(0, Math.min(100, score));
}

export const tierIndex = (score) =>
  score === null || score === undefined ? null : Math.min(4, Math.floor(score / 20));

export const tierOf = (score) => {
  const i = tierIndex(score);
  return i === null ? null : TIERS[i];
};

/** kg still needed on the bar to reach the next tier, or null at Elite. */
export function toNextTier(liftName, score, profile) {
  const i = tierIndex(score);
  if (i === null || i >= 4) return null;
  const sex = profile.sex === 'female' ? 'female' : 'male';
  const table = BOUNDS[sex][liftName];
  if (!table) return null;
  const bw = Number(profile.bodyweight);
  const f = ageFactor(profile.age);
  const needRatio = table[i] * f;
  const referenceBw = sex === 'female' ? 60 : 80;
  let need = needRatio * Math.pow(bw, 0.67) * Math.pow(referenceBw, 0.33);
  if (BODYWEIGHT_INCLUSIVE.has(liftName)) need -= bw;
  return { tier: TIERS[i + 1], weight: need };
}

/**
 * Per-region and overall rating.
 *
 * A region's score is the best (lift score × how strongly that lift trains it)
 * across the benchmark lifts the user actually performs. Taking the max rather
 * than an average means skipping one lift doesn't drag a region down — but a
 * region you never train stays unrated rather than scoring zero.
 *
 * @param bestByLift Map of lift name -> best estimated 1RM
 */
export function buildRating(bestByLift, profile, { machineNames = new Set(), community = {} } = {}) {
  const regions = {};
  const lifts = [];

  for (const [name, orm] of bestByLift) {
    const machine = machineNames.has(name) && !isBenchmark(name);
    if (!isBenchmark(name) && !machine) continue;
    const score = machine ? scoreForMachine(name, orm, profile, community[name]) : scoreFor(name, orm, profile);
    if (score === null) continue;
    const sample = Number(community[name]?.count) || 0;
    lifts.push({ name, oneRepMax: orm, score, tier: tierOf(score), next: machine ? null : toNextTier(name, score, profile),
      machine, provisional: machine && sample < 10, sample });

    for (const [region, weight] of Object.entries(ANATOMY[name] || {})) {
      const confidence = machine ? (sample >= 10 ? Math.min(0.95, 0.7 + sample / 400) : 0.65) : 1;
      const value = score * weight * confidence;
      if (!regions[region] || value > regions[region].score) {
        regions[region] = { score: value, via: name, machine, provisional: machine && sample < 10, sample };
      }
    }
  }

  lifts.sort((a, b) => b.score - a.score);

  const rated = Object.values(regions);
  // Overall is the mean of rated regions — an unrated region isn't a zero,
  // it's an absence of data, and averaging in zeros would be misleading.
  const overall = rated.length
    ? rated.reduce((n, r) => n + r.score, 0) / rated.length
    : null;

  return {
    regions,
    lifts,
    overall,
    overallTier: overall === null ? null : tierOf(overall),
    ratedRegions: rated.length,
    totalRegions: Object.keys(REGIONS).length,
  };
}

export function hasProfile(profile) {
  return !!(profile && Number(profile.bodyweight) > 0 && profile.sex);
}
