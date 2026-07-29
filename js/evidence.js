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
    short: 'ACSM 2026 Position Stand',
    cite: 'American College of Sports Medicine. Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews. Medicine & Science in Sports & Exercise, 2026.',
    note: '137 systematic reviews, >30,000 participants. First update since 2009.',
    url: 'https://acsm.org/resistance-training-guidelines-update-2026/',
    says: 'Hypertrophy: ~10+ sets per muscle group per week. Loads anywhere from 30–100% 1RM work, as long as the set is taken close to failure. Train every major muscle group at least twice a week. Training all the way to momentary failure is not required.',
  },
  pelland2026: {
    key: 'pelland2026',
    short: 'Pelland et al. 2026 — volume & frequency',
    cite: 'Pelland JC et al. The Resistance Training Dose Response: Meta-Regressions Exploring the Effects of Weekly Volume and Frequency on Muscle Hypertrophy and Strength Gains. Sports Medicine, 2026.',
    note: '67 studies, 2,058 participants, 220 hypertrophy effects.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/41343037/',
    says: 'Growth keeps increasing with weekly sets, with diminishing returns and no plateau inside the range studied — there is no evidence for a set count where more volume starts to hurt growth. Frequency on its own has a negligible effect on hypertrophy once weekly volume is held equal (it does help strength). Counting an indirect set as half a set predicted the results better than counting it fully or not at all.',
  },
  remmert2025: {
    key: 'remmert2025',
    short: 'Remmert et al. 2025 — sets per session',
    cite: 'Remmert JF et al. Is There Too Much of a Good Thing? Meta-Regressions of the Effect of Per-Session Volume on Hypertrophy and Strength. SportRxiv preprint, 2025.',
    note: 'Bayesian meta-regression over 67 resistance-training studies.',
    url: 'https://sportrxiv.org/index.php/server/preprint/view/537',
    says: 'Every extra set in a session still adds something, but the returns fall away sharply. The point past which extra sets stop producing a detectable advantage is about 11 fractional sets per muscle per session (about 2 for strength). Very high per-session volumes are thinly studied.',
  },
  wolf2025: {
    key: 'wolf2025',
    short: 'Wolf et al. / long-length training',
    cite: 'Wolf M et al. Partial vs full range of motion resistance training: a systematic review and meta-analysis (2023), plus the 2025 multi-site replication in trained lifters and Kassiano et al. on regional, length-dependent growth.',
    note: 'The strongest exercise-selection finding of the last few years.',
    url: 'https://peerj.com/articles/18904/',
    says: 'What matters is the muscle length the load is applied at, more than range of motion as such. Training at long muscle lengths beats training at short ones for growth; lengthened partials come out at least equal to full range. In trained lifters the gap narrows, so treat it as a tie-breaker between exercises, not a law.',
  },
  haugen2023: {
    key: 'haugen2023',
    short: 'Haugen et al. 2023 — machines vs free weights',
    cite: 'Haugen ME et al. Effect of free-weight vs. machine-based strength training on maximal strength, hypertrophy and jump performance — a systematic review and meta-analysis. BMC Sports Science, Medicine and Rehabilitation, 2023. Confirmed by a 2025 within-subject knee-extensor trial.',
    note: '13 studies; hypertrophy outcomes from 5 of them.',
    url: 'https://link.springer.com/article/10.1186/s13102-023-00713-4',
    says: 'At equal volume and effort, machines and free weights build the same amount of muscle. Equipment is a question of loading convenience and comfort, not of growth.',
  },
  robinson2024: {
    key: 'robinson2024',
    short: 'Robinson et al. 2024 — proximity to failure',
    cite: 'Robinson ZP et al. Exploring the Dose–Response Relationship Between Estimated Resistance Training Proximity to Failure, Strength Gain, and Muscle Hypertrophy: A Series of Meta-Regressions. Sports Medicine, 2024.',
    note: '55 hypertrophy and 67 strength studies.',
    url: 'https://sportrxiv.org/index.php/server/preprint/view/295',
    says: 'The closer a set is taken to failure, the more it grows the muscle — a gradient, not a switch. Strength barely cares. So how hard the set is matters more than which rep range it lands in.',
  },
  variation2024: {
    key: 'variation2024',
    short: 'Exercise variation & regional growth',
    cite: 'Zabaleta-Korta A et al. The role of exercise selection in regional muscle hypertrophy: a randomized controlled trial (2021), and Muscle Hypertrophy and Strength Adaptations to Systematically Varying Resistance Exercises. Research Quarterly for Exercise and Sport, 2024.',
    note: 'Also: three elbow-flexion variations beat one for proximal and mid-biceps growth.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/34743671/',
    says: 'Muscles do not grow evenly — different exercises grow different regions. A couple of movements per muscle covers more of it than one, but the variation has to be systematic; swapping exercises at random costs you more than it buys.',
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
};

export const RATING_DISCLAIMER =
  'Ratings are a reading of the current literature, not a measurement. The numbers below are '
  + 'group averages from studies on other people; where the evidence is thin the app says so '
  + 'rather than inventing a number.';
