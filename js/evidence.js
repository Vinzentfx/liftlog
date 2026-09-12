// Die Studien, auf denen beide Bewertungen aufbauen, an einer Stelle.
//
// Jede Schwelle aus js/plan-rating.js und js/exercise-rating.js zeigt auf einen
// Eintrag hier, und die Oberfläche kann die Quelle neben der Zahl anzeigen. Genau
// darum geht es in dieser Datei: eine Sternebewertung, die nicht sagen kann, woher
// ihre Grenzen kommen, ist nur eine Meinung in schönerer Schrift.
//
// Zuletzt durchgesehen: Juli 2026.

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
    cite: 'Haugen ME et al. Effect of free-weight vs. machine-based strength training on maximal strength, hypertrophy and jump performance: a systematic review and meta-analysis. BMC Sports Science, Medicine and Rehabilitation, 2023. Confirmed by a 2025 within-subject knee-extensor trial.',
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
    cite: 'Robinson ZP et al. Exploring the Dose-Response Relationship Between Estimated Resistance Training Proximity to Failure, Strength Gain, and Muscle Hypertrophy: A Series of Meta-Regressions. Sports Medicine, 2024.',
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
 * Die Schwellen, aus denen jede Bewertung liest. Jede nennt ihre Quelle, damit
 * sich nichts in der App still von der Studie entfernt, auf die es sich beruft.
 */
export const THRESHOLDS = {
  /** Anteilige Sätze pro Woche und Muskel, bei denen die ACSM-Untergrenze liegt. */
  weeklyFloor: { value: 10, source: 'acsm2026' },
  /** Ab hier ist die Dosis-Wirkungs-Kurve flach genug für volle Punktzahl. */
  weeklyStrong: { value: 20, source: 'pelland2026' },
  /** Darüber hinaus gibt die App nur noch Hinweise und zieht nichts ab. */
  weeklyUncharted: { value: 30, source: 'pelland2026' },
  /** Anteilige Sätze für einen Muskel in einer Einheit, ab denen weitere nichts mehr bringen. */
  sessionPerMuscle: { value: 11, source: 'remmert2025' },
  /** Einheiten pro Woche und Muskel. */
  minFrequency: { value: 2, source: 'acsm2026' },
  /** Ein indirekter Satz (Nebenmuskel) zählt so viel. */
  indirectSetWeight: { value: 0.5, source: 'pelland2026' },
  /** Wiederholungsbereich, der Muskeln aufbaut, wenn der Satz nahe ans Versagen geht. */
  repWindow: { low: 5, high: 30, source: 'acsm2026' },
  /** Verschiedene Übungen pro Muskel, bevor die regionale Abdeckung nicht mehr besser wird. */
  exercisesPerMuscle: { value: 2, source: 'variation2024' },

  /**
   * Wo der letzte Aufwärmsatz liegt, als Anteil vom Arbeitsgewicht.
   *
   * Die alte Rampe endete bei 75 % für drei Wiederholungen. Das nimmt jedes Studio,
   * und keine Studie stützt es. Ribeiro 2020 hat nur leichtes Aufwärmen mit einem
   * schweren und einem steigernden verglichen, und nur leicht war bei beiden Übungen
   * am schlechtesten: der Satz, der die Arbeit macht, ist der nahe an der Last.
   */
  warmupTopShare: { value: 0.80, source: 'ribeiro2020' },

  /**
   * Der Wiederholungsbereich, aus dem ein geschätztes 1RM gebaut werden darf.
   *
   * Die Schätzformeln sind bis etwa zehn Wiederholungen geprüft, danach wird der
   * Fehler größer (SOURCES.ribeiro1rm2024 findet ihn außerdem beim Bizepscurl am
   * größten, also genau bei der leichten Isolationsarbeit, aus der sonst ein
   * Maschinenrang gebaut wird). Zwölf statt zehn ist eine Wiederholung Kulanz,
   * damit normale Hypertrophie-Arbeit mit 8 bis 12 nicht dauerhaft als
   * Hochrechnung markiert ist. Darüber ist es eine Hochrechnung, und die App sagt
   * das, statt jemanden still anhand eines Satzes mit zwanzig einzustufen.
   */
  e1rmWindow: { low: 1, high: 12, source: 'ribeiro1rm2024' },

  /**
   * Aufwärmsätze bei normaler Trainingslast, bevor sie nichts mehr bringen.
   *
   * Einer. Eine Crossover-Studie von 2025 fand um 10RM keinen nennenswerten
   * Unterschied zwischen zwei Sätzen, einem und gar keinem. Die App bietet also den
   * einen an, der sich wenigstens begründen lässt, und stapelt nichts obendrauf.
   */
  warmupSetsModerate: { value: 1, source: 'warmup2025' },
  /**
   * Eiweiß pro Tag in Gramm pro kg Körpergewicht. Bewusst ein Bereich: 1,6 ist der
   * bekannte Knickpunkt, 2,2 das obere Ende seines Konfidenzintervalls, und
   * ehrlich gelesen ist alles dazwischen in Ordnung.
   */
  proteinPerKg: { low: 1.6, high: 2.2, source: 'protein2018' },

  /**
   * Ballaststoffe in Gramm pro Tag. Ein Richtwert für die allgemeine Gesundheit,
   * keine Trainingszahl. Nichts verbindet Ballaststoffe mit Muskelaufbau, und die
   * App sagt das auch dort, wo sie sie anzeigt.
   */
  fibrePerDay: { value: 25, source: 'efsaFibre' },

  /**
   * Trinkwasser in Litern pro Tag, nach Geschlecht. Auch das ist ein Richtwert für
   * gemäßigtes Klima und durchschnittliche Aktivität, und zwar ausdrücklich das
   * gesamte Wasser minus die etwa 20 bis 30 %, die über das Essen kommen. Training,
   * Hitze und Körpergewicht verschieben ihn, deshalb steht er als Bezugslinie da
   * und nie als Note.
   */
  waterLitres: { male: 2.0, female: 1.6, source: 'efsaWater' },

  /** Energie, die einem Kilo Körpergewicht entspricht. */
  kcalPerKg: { value: 7700, source: 'wishnofsky' },

  /**
   * Fett als Anteil der Energie. Die untere Grenze sollte man ernst nehmen:
   * essenzielle Fettsäuren, fettlösliche Vitamine, und darunter leiden die Hormone.
   * Innerhalb des Bereichs unterscheidet sich kein Punkt vom anderen.
   */
  fatShare: { low: 0.20, high: 0.35, source: 'efsaFat' },

  /**
   * Kohlenhydrate als Anteil der Energie, als Plausibilitätsprüfung und nicht als
   * Ziel: in dieser App sind Kohlenhydrate das, was an Energie übrig bleibt, wenn
   * Eiweiß und Fett feststehen.
   */
  carbShare: { low: 0.45, high: 0.60, source: 'efsaFibre' },

  /**
   * Gewichtsänderung pro Woche als Anteil vom Körpergewicht. Übliche Trainingspraxis
   * und kein Studienergebnis, deshalb sagt die Oberfläche das auch.
   */
  weeklyChangePct: { low: 0.0025, high: 0.005, source: null },
};

// Ein Schlüssel, wie alles in dieser Datei, das vorgelesen wird.
export const RATING_DISCLAIMER = 'evidence.disclaimer';
