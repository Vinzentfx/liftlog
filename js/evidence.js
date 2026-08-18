// The research the two rating systems are built on, in one place.
//
// Every threshold used by js/plan-rating.js and js/exercise-rating.js points at
// an entry here, and the UI can show the source next to the number. That is the
// whole point of the file: a star rating that can't say where its cut-offs came
// from is just an opinion with a nicer font.
//
// Last reviewed: July 2026.

export const SOURCES = {
  acsm2026: {
    key: 'acsm2026',
    short: 'evidence.acsm2026.short',
    cite: 'American College of Sports Medicine. Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews. Medicine & Science in Sports & Exercise, 2026.',
    note: 'evidence.acsm2026.note',
    url: 'https://acsm.org/resistance-training-guidelines-update-2026/',
    says: 'evidence.acsm2026.says',
  },
  pelland2026: {
    key: 'pelland2026',
    short: 'evidence.pelland2026.short',
    cite: 'Pelland JC et al. The Resistance Training Dose Response: Meta-Regressions Exploring the Effects of Weekly Volume and Frequency on Muscle Hypertrophy and Strength Gains. Sports Medicine, 2026.',
    note: 'evidence.pelland2026.note',
    url: 'https://pubmed.ncbi.nlm.nih.gov/41343037/',
    says: 'evidence.pelland2026.says',
  },
  remmert2025: {
    key: 'remmert2025',
    short: 'evidence.remmert2025.short',
    cite: 'Remmert JF et al. Is There Too Much of a Good Thing? Meta-Regressions of the Effect of Per-Session Volume on Hypertrophy and Strength. SportRxiv preprint, 2025.',
    note: 'evidence.remmert2025.note',
    url: 'https://sportrxiv.org/index.php/server/preprint/view/537',
    says: 'evidence.remmert2025.says',
  },
  wolf2025: {
    key: 'wolf2025',
    short: 'evidence.wolf2025.short',
    cite: 'Wolf M et al. Partial vs full range of motion resistance training: a systematic review and meta-analysis (2023), plus the 2025 multi-site replication in trained lifters and Kassiano et al. on regional, length-dependent growth.',
    note: 'evidence.wolf2025.note',
    url: 'https://peerj.com/articles/18904/',
    says: 'evidence.wolf2025.says',
  },
  haugen2023: {
    key: 'haugen2023',
    short: 'evidence.haugen2023.short',
    cite: 'Haugen ME et al. Effect of free-weight vs. machine-based strength training on maximal strength, hypertrophy and jump performance — a systematic review and meta-analysis. BMC Sports Science, Medicine and Rehabilitation, 2023. Confirmed by a 2025 within-subject knee-extensor trial.',
    note: 'evidence.haugen2023.note',
    url: 'https://link.springer.com/article/10.1186/s13102-023-00713-4',
    says: 'evidence.haugen2023.says',
  },
  anderson2004: {
    key: 'anderson2004',
    short: 'evidence.anderson2004.short',
    cite: 'Anderson KG, Behm DG. Maintenance of EMG activity and loss of force output with instability. Journal of Strength and Conditioning Research, 2004.',
    note: 'evidence.anderson2004.note',
    url: 'https://pubmed.ncbi.nlm.nih.gov/15320684/',
    says: 'evidence.anderson2004.says',
  },
  robinson2024: {
    key: 'robinson2024',
    short: 'evidence.robinson2024.short',
    cite: 'Robinson ZP et al. Exploring the Dose–Response Relationship Between Estimated Resistance Training Proximity to Failure, Strength Gain, and Muscle Hypertrophy: A Series of Meta-Regressions. Sports Medicine, 2024.',
    note: 'evidence.robinson2024.note',
    url: 'https://sportrxiv.org/index.php/server/preprint/view/295',
    says: 'evidence.robinson2024.says',
  },
  protein2018: {
    key: 'protein2018',
    short: 'evidence.protein2018.short',
    cite: 'Morton RW et al. A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. British Journal of Sports Medicine, 2018. Read alongside the later re-analyses that question the breakpoint.',
    note: 'evidence.protein2018.note',
    url: 'https://pubmed.ncbi.nlm.nih.gov/28698222/',
    says: 'evidence.protein2018.says',
  },
  wishnofsky: {
    key: 'wishnofsky',
    short: 'evidence.wishnofsky.short',
    cite: 'Wishnofsky M. Caloric equivalents of gained or lost weight. American Journal of Clinical Nutrition, 1958. See Hall KD et al., Lancet 2011, for why the linear version overpredicts.',
    note: 'evidence.wishnofsky.note',
    url: 'https://pubmed.ncbi.nlm.nih.gov/13594881/',
    says: 'evidence.wishnofsky.says',
  },
  efsaFat: {
    key: 'efsaFat',
    short: 'evidence.efsaFat.short',
    cite: 'EFSA Panel on Dietetic Products, Nutrition and Allergies. Scientific Opinion on Dietary Reference Values for fats. EFSA Journal, 2010. Alongside Thomas DT, Erdman KA, Burke LM. Position of the Academy of Nutrition and Dietetics, Dietitians of Canada, and ACSM: Nutrition and Athletic Performance, 2016.',
    note: 'evidence.efsaFat.note',
    url: 'https://www.efsa.europa.eu/en/efsajournal/pub/1461',
    says: 'evidence.efsaFat.says',
  },
  efsaFibre: {
    key: 'efsaFibre',
    short: 'evidence.efsaFibre.short',
    cite: 'EFSA Panel on Dietetic Products, Nutrition and Allergies. Scientific Opinion on Dietary Reference Values for carbohydrates and dietary fibre. EFSA Journal, 2010.',
    note: 'evidence.efsaFibre.note',
    url: 'https://www.efsa.europa.eu/en/efsajournal/pub/1462',
    says: 'evidence.efsaFibre.says',
  },
  efsaWater: {
    key: 'efsaWater',
    short: 'evidence.efsaWater.short',
    cite: 'EFSA Panel on Dietetic Products, Nutrition and Allergies. Scientific Opinion on Dietary Reference Values for water. EFSA Journal, 2010.',
    note: 'evidence.efsaWater.note',
    url: 'https://www.efsa.europa.eu/en/efsajournal/pub/1459',
    says: 'evidence.efsaWater.says',
  },
  ribeiro2020: {
    key: 'ribeiro2020',
    short: 'evidence.ribeiro2020.short',
    cite: 'Ribeiro B, Pereira A, Neves PP, et al. The Role of Specific Warm-up during Bench Press and Squat Exercises: A Novel Approach. International Journal of Environmental Research and Public Health, 2020. Forty resistance-trained men, squat and bench at 80% of maximal dynamic strength.',
    note: 'evidence.ribeiro2020.note',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7558980/',
    says: 'evidence.ribeiro2020.says',
  },
  warmup2025: {
    key: 'warmup2025',
    short: 'evidence.warmup2025.short',
    cite: 'Warming up to improved performance? Effects of different specific warm-up protocols on neuromuscular performance in trained individuals. Crossover trial in 29 trained lifters comparing no specific warm-up, one set at 75%, and two sets at 55% then 75%.',
    note: 'evidence.warmup2025.note',
    url: 'https://sportrxiv.org/index.php/server/preprint/view/559',
    says: 'evidence.warmup2025.says',
  },
  ribeiro1rm2024: {
    key: 'ribeiro1rm2024',
    short: 'evidence.ribeiro1rm2024.short',
    cite: 'Ribeiro AS, da Silva JA, Nascimento M, Martinho D, dos Santos L, de Salles B, Mayhew J, Cyrino ES. Accuracy of 1RM Prediction Equations Before and After Resistance Training in Three Different Lifts. International Journal of Strength and Conditioning, 4(1), 2024. 119 participants, bench press, squat and arm curl.',
    note: 'evidence.ribeiro1rm2024.note',
    url: 'https://journal.iusca.org/index.php/Journal/article/view/327',
    says: 'evidence.ribeiro1rm2024.says',
  },
  oneRepMax2026: {
    key: 'oneRepMax2026',
    short: 'evidence.oneRepMax2026.short',
    cite: 'A Weight-Dependent 1RM Prediction Equation Optimized on 303,494 Near-Failure Sets Across 388 Exercises. Preprint, 2026. 14,966 users of a consumer training app.',
    note: 'evidence.oneRepMax2026.note',
    url: 'https://arxiv.org/abs/2603.17495',
    says: 'evidence.oneRepMax2026.says',
  },
  variation2024: {
    key: 'variation2024',
    short: 'evidence.variation2024.short',
    cite: 'Zabaleta-Korta A et al. The role of exercise selection in regional muscle hypertrophy: a randomized controlled trial (2021), and Muscle Hypertrophy and Strength Adaptations to Systematically Varying Resistance Exercises. Research Quarterly for Exercise and Sport, 2024.',
    note: 'evidence.variation2024.note',
    url: 'https://pubmed.ncbi.nlm.nih.gov/34743671/',
    says: 'evidence.variation2024.says',
  },
};

export const SOURCE_LIST = Object.values(SOURCES);

/**
 * Thresholds every rating reads from. Each one names the source it came from so
 * nothing in the app can quietly drift away from the paper it claims to follow.
 */
export const THRESHOLDS = {
  /** Weekly fractional sets per muscle where the ACSM floor sits. */
  weeklyFloor: { value: 10, source: 'acsm2026' },
  /** Where the weekly dose-response has flattened enough to score full marks. */
  weeklyStrong: { value: 20, source: 'pelland2026' },
  /** Beyond this the app stops guiding — it advises, it does not deduct. */
  weeklyUncharted: { value: 30, source: 'pelland2026' },
  /** Fractional sets for one muscle in one session past which extra sets stop paying. */
  sessionPerMuscle: { value: 11, source: 'remmert2025' },
  /** Sessions per week per muscle. */
  minFrequency: { value: 2, source: 'acsm2026' },
  /** An indirect (secondary-muscle) set counts as this many sets. */
  indirectSetWeight: { value: 0.5, source: 'pelland2026' },
  /** Rep window that builds muscle when the set is taken close to failure. */
  repWindow: { low: 5, high: 30, source: 'acsm2026' },
  /** Different movements per muscle before regional coverage stops improving. */
  exercisesPerMuscle: { value: 2, source: 'variation2024' },

  /**
   * Where the last warm-up set sits, as a share of the working weight.
   *
   * The old ramp topped out at 75% for three reps, which is the number every
   * gym uses and no trial supports. Ribeiro 2020 compared a light-only warm-up
   * against a heavy one and a progressive one, and the light-only version came
   * last on both lifts: the set that does the work is the one near the load.
   */
  warmupTopShare: { value: 0.80, source: 'ribeiro2020' },

  /**
   * The repetition range an estimated 1RM may be built from.
   *
   * Prediction equations are validated to about ten repetitions and their error
   * grows past it (SOURCES.ribeiro1rm2024 also finds the error is worst on the
   * arm curl, which is to say on exactly the light isolation work a machine
   * rank is otherwise built from). Twelve rather than ten is one repetition of
   * grace, so ordinary 8–12 hypertrophy work is not permanently flagged as
   * extrapolation; past that it *is* extrapolation and the app says so instead
   * of quietly ranking somebody on a set of twenty.
   */
  e1rmWindow: { low: 1, high: 12, source: 'ribeiro1rm2024' },

  /**
   * Warm-up sets at a normal training load, before it stops buying anything.
   *
   * One. A 2025 crossover found no meaningful difference between two sets, one
   * set and none at all around 10RM — so the app offers the one that is at
   * least defensible and never stacks more on top.
   */
  warmupSetsModerate: { value: 1, source: 'warmup2025' },
  /**
   * Daily protein, grams per kg of bodyweight. Deliberately a band: 1.6 is the
   * headline breakpoint, 2.2 is the top of its own confidence interval, and the
   * honest reading is that anywhere inside is fine.
   */
  proteinPerKg: { low: 1.6, high: 2.2, source: 'protein2018' },

  /**
   * Dietary fibre, grams per day. A general-health adequate intake, not a
   * training number — nothing links fibre to hypertrophy, and the app says so
   * where it shows it.
   */
  fibrePerDay: { value: 25, source: 'efsaFibre' },

  /**
   * Drinking water, litres per day, by sex. Also an adequate intake for a
   * temperate climate at average activity, and explicitly *total* water minus
   * the ~20–30% that arrives in food. Training, heat and bodyweight all move it,
   * which is why it is shown as a reference line and never as a score.
   */
  waterLitres: { male: 2.0, female: 1.6, source: 'efsaWater' },

  /** Energy equivalent of a kilogram of bodyweight change. */
  kcalPerKg: { value: 7700, source: 'wishnofsky' },

  /**
   * Fat as a share of energy. The lower edge is a floor worth respecting —
   * essential fatty acids, fat-soluble vitamins, and a hormonal cost below it.
   * Inside the range, nothing distinguishes one point from another.
   */
  fatShare: { low: 0.20, high: 0.35, source: 'efsaFat' },

  /**
   * Carbohydrate as a share of energy, for a sanity check rather than a target:
   * in this app carbs are whatever energy is left once protein and fat are set.
   */
  carbShare: { low: 0.45, high: 0.60, source: 'efsaFibre' },

  /**
   * Weight change per week, as a share of bodyweight. Training-practice
   * convention rather than a trial result, which is why the UI says so.
   */
  weeklyChangePct: { low: 0.0025, high: 0.005, source: null },
};

// A key, like everything else in this file that gets read out loud.
export const RATING_DISCLAIMER = 'evidence.disclaimer';
