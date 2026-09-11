// Wo ein Rang in der Bevölkerung liegt, geschätzt und nicht gemessen.
//
// Ein Perzentil hatte die App schon, und das ist ein echtes: `shareRankScores`
// fragt den Server, wie viele andere LiftLog-Nutzer unter einem liegen. Die meiste
// Zeit gibt es das aber für die meisten nicht, denn dafür braucht man ein Konto,
// eine Verbindung, eine Zustimmung und genug andere, die dieselbe Übung eingetragen
// haben. Der Rang stand also allein auf dem Bildschirm, und ein Rang allein
// beantwortet nicht die Frage, die man eigentlich hat.
//
// Die Frage ist "ist das gut", und ohne Antwort führt die Leiter sogar in die Irre.
// Legend ist der neunte von zwölf Rängen, Legend II wirkt also wie Mittelfeld,
// obwohl es das oberste Prozent erwachsener Männer ist. Wer eine Schrägbank drückt,
// die in seinem Studio praktisch niemand schafft, bekam eine Zahl, die aussah wie
// eine Drei. Diese Datei behebt das, und zwar bewusst als Modell und nicht als
// Messung, was auch überall steht, wo die Zahl angezeigt wird.
//
// Heraus kommen zwei Zahlen, und die behaupten nicht dasselbe:
//
//   `lifters` ist fast nur Rechnen. Die vier veröffentlichten Ankerpunkte, aus denen
//   die Leiter gebaut ist, sind selbst Perzentile über Leute, die trainieren und
//   mitschreiben: Anfänger ist das 20., Fortgeschritten das 50., Weit
//   fortgeschritten das 80., Elite das 95. Eine Wertung zurück in ein Perzentil zu
//   verwandeln heißt, die Tabelle in der Richtung zu lesen, in der sie geschrieben ist.
//
//   `world` legt einen Modellierungsschritt drauf und mischt die große Mehrheit der
//   Erwachsenen dazu, die nie eine Langhantel anfassen. Dieser Schritt ist eine
//   Annahme, die Zahlen dahinter stehen unten mit Begründung, und deshalb heißt es
//   auf jedem Screen Schätzung.

import { BAND, DIVISIONS } from './standards.js';

/**
 * Wertung auf der Leiter gegen z auf einer Standardnormalverteilung der Trainierenden.
 *
 * Jede Zeile ist ein veröffentlichter Ankerpunkt mit dem Perzentil, das ihm die
 * Standards zuordnen, aus denen er stammt. Die Spalte mit der Wertung ist nicht
 * gewählt, sie ergibt sich aus `ladder()`: Anfänger am Einstieg zu Gold,
 * Fortgeschritten bei Diamond, Weit fortgeschritten bei Grandmaster, Elite bei Legend.
 *
 * Das Auffällige, und der Grund, warum diese Datei kurz sein kann: die vier Punkte
 * liegen in z fast genau auf einer Geraden. Gold bis Diamond sind 0,842 z über
 * 16,67 Punkte, Diamond bis Grandmaster 0,842 über 16,67, Grandmaster bis Legend
 * 0,803 über 16,67. Die Rangleiter ist also schon eine lineare Normalskala, ohne
 * dass sie so geplant war, und das spricht dafür, dass die geometrische
 * Interpolation in `ladder()` die richtige Form hat.
 *
 * Über Legend knickt sie von der Geraden ab, und zwar zu Recht: BEYOND_ELITE ist an
 * Wettkämpfen kalibriert, und die letzten drei Ränge sind viel dünnere Scheiben der
 * Bevölkerung, als eine gerade Verlängerung sie machen würde.
 */
const ANCHORS = [
  // [Wertung, Anteil der Trainierenden darunter]
  [100 / 12 * 1,  0.05],    // Silver       etwas mehr als die Hälfte des Anfängerstandards
  [100 / 12 * 2,  0.20],    // Gold         veröffentlicht: Anfänger
  [100 / 12 * 4,  0.50],    // Diamond      veröffentlicht: Fortgeschritten
  [100 / 12 * 6,  0.80],    // Grandmaster  veröffentlicht: Weit fortgeschritten
  [100 / 12 * 8,  0.95],    // Legend       veröffentlicht: Elite
  [100 / 12 * 9,  0.99],    // Challenger   hochgerechnet, siehe BEYOND_ELITE
  [100 / 12 * 10, 0.998],   // Immortal
  [100 / 12 * 11, 0.9995],  // Radiant
  [100,           0.9999],  // das obere Ende der Skala
];

/**
 * Der Anteil der Erwachsenen, die oft genug mit Widerstand trainieren, dass die
 * Standardtabelle sie überhaupt beschreibt.
 *
 * Selbst angegeben "erfüllt die Empfehlung zum Muskeltraining" liegt in nationalen
 * Umfragen bei etwa 30 %, und Selbstauskunft über Sport ist nur in eine Richtung
 * großzügig. Regelmäßiges Training mit Langhantel oder Maschine, also das, worüber
 * die Standards geschrieben sind, ist deutlich seltener. Ein Fünftel ist die
 * vorsichtige Lesart, und vorsichtig heißt hier, dass das Welt-Perzentil NIEDRIGER
 * herauskommt. Das ist die richtige Richtung für eine Zahl, die schmeichelt.
 */
const TRAINING_SHARE = 0.20;

/**
 * Wo die Untrainierten auf derselben Skala liegen, als Mittelwert und Streuung in z.
 *
 * -1,45 legt den Median der Untrainierten bei etwa dem halben Körpergewicht auf
 * der Bank. Das ist die Mitte dessen, was meist für erwachsene Männer ohne
 * Training angegeben wird. Auf dieser Leiter liegt das zwischen Bronze und Silver,
 * unter dem veröffentlichten Anfängerstandard, und genau darum geht es: der
 * Anfängerstandard beschreibt jemanden, der schon angefangen hat.
 *
 * 0,50 ist der ehrliche Teil der Unsicherheit. Zu schmal, und die Kurve bekommt eine
 * Klippe, an der eine Division im Rang das Welt-Perzentil um dreißig Punkte
 * verschiebt. Zu breit, und jeder fünfte Untrainierte würde angeblich mehr drücken
 * als der Anfängerstandard. Bei 0,50 ist es etwa jeder neunte, und das ist ungefähr
 * der Anteil der Erwachsenen, die durch Arbeit oder Sport stark sind, ohne je zu heben.
 *
 * Diese beiden sind die einzigen ausgedachten Zahlen in der Datei, und sie wirken
 * nur auf `world`. `lifters` berührt sie nie.
 */
const UNTRAINED_MEAN_Z = -1.45;
const UNTRAINED_SD_Z = 0.50;

/**
 * Die Verteilungsfunktion der Normalverteilung nach Abramowitz und Stegun 7.1.26.
 *
 * Genau auf etwa 1,5e-7, vier Größenordnungen besser als alles, was hier angezeigt
 * wird, und fünfzehn Zeilen statt einer Abhängigkeit.
 */
function phi(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** Die Umkehrung, um die Anker-Perzentile beim Laden einmal in z umzurechnen. */
function probit(p) {
  // Rationale Näherung nach Acklam. Wird nur für die neun Konstanten oben aufgerufen,
  // die Geschwindigkeit ist also egal und die Lesbarkeit nicht.
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) return -probit(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Die Ankertabelle in z, einmal gebaut. */
const CURVE = ANCHORS.map(([score, share]) => [score, probit(share)]);

/**
 * Eine Wertung auf der Leiter als z-Wert in der Verteilung der Trainierenden.
 *
 * Linear zwischen den Ankern und unter dem ersten linear verlängert statt
 * abgeschnitten: eine Wertung von null ist ein echter Platz auf der Leiter, auf dem
 * die erste Einheit von jemandem landen kann. Alles unter Silver auf dieselbe Zahl
 * festzunageln würde den ganzen unteren Teil der App dasselbe sagen lassen.
 */
export function zForScore(score) {
  // `Number(null)` ist 0, und 0 ist ein echter Platz auf der Leiter. Ohne die erste
  // Prüfung käme eine unbewertete Übung als Bronze III zurück, stärker als zwei
  // Prozent der Männer, und das wäre eine Aussage über jemanden, den die App nie
  // gemessen hat.
  if (score === null || score === undefined || score === '') return null;
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  if (s <= CURVE[0][0]) {
    const [x0, z0] = CURVE[0], [x1, z1] = CURVE[1];
    return z0 + (s - x0) * (z1 - z0) / (x1 - x0);
  }
  for (let i = 1; i < CURVE.length; i++) {
    if (s <= CURVE[i][0]) {
      const [x0, z0] = CURVE[i - 1], [x1, z1] = CURVE[i];
      return z0 + (s - x0) * (z1 - z0) / (x1 - x0);
    }
  }
  return CURVE[CURVE.length - 1][1];
}

/**
 * Beide Lesarten einer Wertung als Anteile zwischen 0 und 1, oder null.
 *
 * @returns { lifters, world } oder null, wenn es keine Wertung zum Lesen gibt
 */
export function percentiles(score) {
  const z = zForScore(score);
  if (z === null) return null;
  const lifters = phi(z);
  const untrained = phi((z - UNTRAINED_MEAN_Z) / UNTRAINED_SD_Z);
  return {
    lifters,
    world: TRAINING_SHARE * lifters + (1 - TRAINING_SHARE) * untrained,
  };
}

/**
 * Wie viele Nachkommastellen ein Anteil verdient. Das ist keine Geschmacksfrage.
 *
 * Die spannende Hälfte der Skala steckt in den letzten zwei Prozent: Legend,
 * Challenger, Immortal und Radiant runden alle auf 99 % oder 100 %, und wer drei
 * ganze Ränge aufsteigt, sähe die Zahl nicht wackeln. Je näher an der Decke, desto
 * mehr Stellen, und über 99,95 hört man ehrlicherweise auf, ein Perzentil zu
 * behaupten, und nennt stattdessen die Scheibe.
 */
export function shareDigits(fraction) {
  const pct = fraction * 100;
  if (pct >= 99.9) return 2;
  if (pct >= 99) return 1;
  return 0;
}

/**
 * "Top 3 %", dieselbe Tatsache vom anderen Ende, für die Zahl unter Trainierenden.
 *
 * Gerundet auf etwas, das man laut sagen würde. Niemand sagt "Top 37,2 %", und eine
 * Zahl in der oberen Hälfte liest sich als "obere Hälfte" besser als mit Komma.
 */
export function topSlice(fraction) {
  const rest = (1 - fraction) * 100;
  if (rest >= 10) return Math.round(rest / 5) * 5;
  if (rest >= 1) return Math.round(rest);
  if (rest >= 0.1) return Math.round(rest * 10) / 10;
  return Math.max(0.01, Math.round(rest * 100) / 100);
}

/**
 * Die Stufe auf der Leiter, für die ein Perzentil steht, damit sich beide nie widersprechen.
 *
 * Nur von den Tests benutzt: sie passen auf, dass niemand ANCHORS ändert und still
 * verschiebt, was ein Rang wert ist, ohne zu merken, welcher Rang sich bewegt hat.
 */
export function anchorTable() {
  return CURVE.map(([score, z]) => ({
    score,
    step: Math.round(score / (BAND / DIVISIONS.length)),
    z,
    ...percentiles(score),
  }));
}
