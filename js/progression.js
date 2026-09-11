// Was als Nächstes auf die Stange kommt, und warum.
//
// Die alte Version steckte in einer Funktion auf dem Trainieren-Screen und stellte eine
// einzige Frage: haben letztes Mal alle Sätze das obere Ende des Wiederholungsbereichs
// geschafft? Diese Regel ist in beide Richtungen gleichzeitig falsch. Sie verweigert mehr
// Gewicht, weil Satz vier auf sieben Wiederholungen gefallen ist, und genau das SOLL Satz
// vier tun. Und sie weiß nicht, ob die letzte Einheit die erste Übung des Tages war oder
// die fünfte. Zwei Leute mit gleichem Log, einer hat frisch gedrückt und einer nach neun
// Sätzen Brust, bekamen denselben Rat.
//
// Was stattdessen hier steht:
//
//  1. Last mit Anstrengung verrechnet. Ein Satz ist wert, was er sagt, plus das, was in
//     Reserve blieb. Fehlt das RIR, zählt der Satz wie er ist. Das nimmt der Rest der App
//     auch an, und es irrt nach unten.
//
//  2. Eine Korrektur der Ermüdung dafür, wo in der Einheit die Arbeit passiert ist, damit
//     sich jede vergangene Einheit auf derselben Grundlage vergleichen lässt. Siehe `readiness`.
//
//  3. Ein Verlauf über mehrere Einheiten statt eines Urteils über die letzte. Drei
//     Einheiten sind die Untergrenze, darunter gibt es nur die letzte.
//
//  4. Der erste Arbeitssatz entscheidet. Spätere Sätze fallen aus Gründen ab, die nichts
//     damit zu tun haben, ob das Gewicht passte. Sie fließen also in den Rat INNERHALB
//     einer Einheit ein und nie in den zwischen Einheiten.
//
// Zwei Konstanten unten sind Annahmen und keine Befunde und auch so markiert. Beide werden
// durch die eigenen Zahlen ersetzt, sobald es genug davon gibt, und genau darum geht es:
// die Annahme muss nur so lange stimmen, bis man sie nicht mehr braucht.

import { e1rm, isCounted, effectiveSetWeight, linearFit, bodyweightLoadMode } from './models.js';
import { platePlan } from './plates.js';
import { anatomyOf, DIRECT_CONTRIBUTION } from './standards.js';

/* ===================== Anstrengung ===================== */

/**
 * Was ein Satz über die Maximalkraft sagt, mit dem gezählt, was in Reserve blieb.
 *
 * Ein Satz mit 8 bei 3 RIR ist ein Satz mit 11, der früher aufgehört hat, und ihn als 8
 * zu behandeln ist der Grund, warum die alte Regel Leute ständig bei einem Gewicht
 * gelassen hat, von dem sie weit weg waren. Ohne RIR zählt der Satz so, wie er dasteht.
 * Das machen auch Rekordprüfung, Diagramme und Stärkeränge, und es schätzt eher zu
 * niedrig als zu hoch, nichts darauf Gebautes schlägt also je zu viel Gewicht vor.
 */
export function effortE1rm(set, assumedRir = 0) {
  const weight = effectiveSetWeight(set);
  const reps = Number(set.reps) || 0;
  if (!weight || !reps) return 0;
  return e1rm(weight, reps + reserveOf(set, assumedRir));
}

/** Wurde die Anstrengung wirklich festgehalten, oder hängt die Schätzung an der Annahme? */
const hasEffort = (set) => set.rir !== null && set.rir !== undefined;

/**
 * Wiederholungen in Reserve, eingetragen oder angenommen.
 *
 * Die Annahme ist auf 4 gedeckelt, egal was die Einstellung sagt: darüber ist die Zahl
 * nicht mehr "so trainiere ich", sondern ein Hebel, um der App schwerere Gewichte zu
 * entlocken, und dafür ist sie nicht da.
 */
const reserveOf = (set, assumedRir = 0) =>
  hasEffort(set) ? Math.max(0, Number(set.rir)) : Math.max(0, Math.min(4, Number(assumedRir) || 0));

/* ===================== wo in der Einheit ===================== */

/**
 * Die Ermüdung durch einen schon gemachten Satz, pro Satz, bevor diese Übung anfängt.
 *
 * Annahmen, keine Befunde. Vorermüdung kostet eine folgende Grundübung nach drei
 * Isolationssätzen etwa 5 %, daher kommt SAME_REGION. OTHER sind die viel kleineren
 * allgemeinen Kosten dafür, schon eine Weile im Studio zu sein. Beide werden in
 * `observedOrderCost` durch die eigenen Zahlen ersetzt, sobald das Log genug Streuung hat,
 * um es zu messen.
 */
const SAME_REGION = 0.015;
const OTHER_REGION = 0.003;

/** Egal wie lang die Einheit, es gibt eine Untergrenze für das, was noch übrig ist. */
const MAX_FATIGUE = 0.15;

/**
 * Wie viel vom selben Muskel sich zwei Übungen teilen, 0 bis 1.
 *
 * Die alte Version hat die Haupt- und Nebenlisten des Katalogs direkt gelesen und dabei
 * zwei Dinge gleichzeitig falsch gemacht. Sie hat einen Treffer gegen `primary.size`
 * gezählt, eine Übung, die der Katalog unter drei Muskeln führt, kam also von keinem
 * einzelnen über ein Drittel hinaus. Und sie hat nie in ANATOMY geschaut, die von Hand
 * bewertete Tabelle, die die Bewertung seit einem Jahr benutzt. Der REST der App wusste
 * also, dass eine Rudermaschine mit Bruststütze 1,0 Trapez ist, diese Funktion nicht.
 *
 * Der Ersatz stellt die Frage, um die es der Korrektur wirklich geht: von den Muskeln, die
 * diese Übung ANFÜHRT, wie viel wurde schon gearbeitet. Gemittelt nur über die führenden
 * Regionen, gewichtet danach, wie stark die frühere Bewegung jede davon antreibt.
 *
 *     Anteil = Σ w_diese(r) · w_frühere(r) / Σ w_diese(r),  über die r, die diese anführt
 *
 * Nur führende Regionen, und das trägt Last, es ist keine Ordnungsliebe. Über JEDE Region zu
 * summieren, die eine Übung berührt, bringt die eigene vordere Schulter und den Trizeps
 * vom Bankdrücken in den Nenner, ein Butterfly vor dem Bankdrücken käme dann auf 0,48
 * statt 1. Das ist vielleicht die wahrere Aussage über die gesamte Muskelarbeit, hier aber
 * die falsche Zahl: SAME_REGION ist genau an diesem Fall bei vollem Gewicht kalibriert,
 * und den Eingang zu halbieren, während die Kosten gleich bleiben, würde eine gemessene
 * Korrektur still halbieren.
 *
 * Ein Butterfly vor dem Bankdrücken ergibt also weiter 1. Trizepsdrücken am Kabel davor
 * ergibt 0, zu Recht: das Bankdrücken ist nicht zum Trizepstraining da. Und Bankdrücken
 * vor Trizepsdrücken ergibt jetzt 0,55 statt früher 0,5, weil das Trizepsdrücken sehr wohl
 * für den Trizeps da ist und ANATOMY sagt, wie viel davon das Bankdrücken leistet, wo der
 * Katalog nur "Nebenmuskel" sagen konnte.
 */
function overlap(exercise, earlier) {
  const mine = anatomyOf(exercise);
  const theirs = anatomyOf(earlier);
  let total = 0, shared = 0;
  for (const [region, weight] of Object.entries(mine)) {
    if (weight < DIRECT_CONTRIBUTION) continue;
    total += weight;
    shared += weight * (theirs[region] || 0);
  }
  return total ? Math.min(1, shared / total) : 0;
}

/**
 * Setzt diese frühere Übung den SCHWERPUNKT auf das, wofür diese hier da ist?
 *
 * Eine andere Frage als `overlap`, und getrennt ist sie wegen der Zeile, die der
 * Trainieren-Screen druckt. "Sätze für diesen Muskel davor" muss eine Zahl von Sätzen sein,
 * auf die man zeigen kann, und eine gewichtete Überschneidung ist das nicht: drei Sätze
 * Bankdrücken vor Trizepsdrücken ergaben 1,5, gedruckt als "2", und die ehrliche Antwort
 * war, dass nichts davor den Trizeps als Aufgabe trainiert hatte. Eine Zahl, die man mit
 * einem Blick auf den eigenen Screen widerlegen kann, ist schlimmer als keine.
 *
 * Das hier ist also bewusst ja oder nein und bewusst streng: die frühere Bewegung muss eine
 * der Regionen, die diese anführt, mit denselben 0,8 antreiben, ab denen die Bewertung
 * einer Übung überhaupt zutraut, einen Muskel einzustufen.
 */
function prioritisesSame(exercise, earlier) {
  const theirs = anatomyOf(earlier);
  return leadingRegions(exercise).some((region) => (theirs[region] || 0) >= DIRECT_CONTRIBUTION);
}

/** Die Regionen, die eine Übung wirklich anführt, die stärkste zuerst. */
export function leadingRegions(exercise) {
  return Object.entries(anatomyOf(exercise))
    .filter(([, weight]) => weight >= DIRECT_CONTRIBUTION)
    .sort((a, b) => b[1] - a[1])
    .map(([region]) => region);
}

/** Ein Satz, der für heute auf dem Brett steht, aber nicht abgehakt ist. */
const isPlanned = (set) => set.type === 'working' && !set.done;

/**
 * Die Arbeit zwischen dem Anfang einer Einheit und einer ihrer Übungen.
 *
 * Zwei Fragen, nicht eine, und welche gestellt wird, hängt davon ab, ob die Einheit vorbei ist.
 *
 * EINE ABGESCHLOSSENE EINHEIT ist eine Aufzeichnung. Die einzige Arbeit vor einer Übung
 * ist die, die darüber abgehakt wurde, und die Position ist die einzige Auskunft über die
 * Reihenfolge, die es gibt, Sätze haben keinen Zeitstempel. Das ist der Standard, und
 * `exerciseHistory` und `pooledOrderCost` wollen genau das.
 *
 * EINE LAUFENDE EINHEIT ist ein Plan, der gerade umgesetzt wird, und die ehrliche Frage ist,
 * WAS PASSIERT SEIN WIRD, WENN DIESE ÜBUNG ANFÄNGT. Zwei Dinge macht die Regel nach Position
 * dort falsch:
 *
 *  - Arbeit über dieser Übung, die noch nicht gemacht ist, zählte als nichts. Man öffnet
 *    einen Push-Tag, und das Bankdrücken, drittes auf der Liste hinter sechs Sätzen Flys,
 *    bekam einen Rat, als wäre es das Erste am Morgen. Macht man die Flys, fiel derselbe
 *    Vorschlag still um eine Wiederholung. Eine Übung, zwei Zahlen in einer Einheit, und
 *    die zuerst gezeigte war die falsche. In der Reihenfolge, die man selbst festgelegt
 *    hat, kommt diese Arbeit, also zählt `live` sie.
 *  - Arbeit AUSSER der Reihe zählte auch als nichts. Zur letzten Übung springen, sie machen,
 *    dann zur ersten zurück, und die erste bekam einen Rat, als wäre man frisch, obwohl
 *    schon drei Sätze hinter einem lagen. Abgehakt ist abgehakt, also zählt `live` es,
 *    egal wo es auf der Liste steht.
 *
 * Eine Übung nach oben oder unten zu schieben ändert ihren Rat also sofort, und darum geht
 * es: die Anordnung auf dem Screen ist das, was man vorhat, und die Berechnung nimmt einen
 * beim Wort.
 *
 * `planned` kommt getrennt zurück, damit der Vorschlag laut sagen kann, wie viel der
 * Ermüdung, die er zählt, noch gar nicht passiert ist. Einer Zahl, die man sich nicht
 * erklären kann, traut man bald nicht mehr.
 *
 * `same` und `direct` zählen zwei verschiedene Dinge und sind nicht austauschbar. `same`
 * ist die gewichtete Überschneidung, damit rechnet die Ermüdung, denn ein halber Satz
 * geteilter Arbeit ist wirklich ein halber Satz. `direct` zählt ganze Sätze aus Bewegungen,
 * die denselben Muskel anführen, und nur das taugt, um als Zahl von Sätzen gedruckt zu
 * werden. Siehe `prioritisesSame`.
 *
 * @param entries   die Einträge der Einheit, in der Reihenfolge, in der sie gemacht werden
 * @param index     um welchen Eintrag es geht
 * @param byId      Map Übungs-ID -> Übung
 * @param live      true für die laufende Einheit, false für eine Aufzeichnung
 * @returns { same, other, direct, total, warmedRegions, planned, regions }
 */
export function priorWork(entries, index, byId, { live = false } = {}) {
  const list = entries || [];
  const exercise = byId.get(list[index]?.exerciseId);
  let same = 0, other = 0, direct = 0, planned = 0;
  const warmedRegions = new Set();

  for (let i = 0; i < list.length; i++) {
    if (i === index) continue;
    const earlier = byId.get(list[i].exerciseId);
    const sets = list[i].sets || [];
    const done = sets.filter(isCounted).length;
    // Warm zu sein ist eine Tatsache über den Körper, nicht über eine Liste. Eine Übung
    // darüber, die noch keiner angefangen hat, hat nichts aufgewärmt, beim Angebot zum
    // Aufwärmen zählt also nur Arbeit, die wirklich gemacht wurde.
    if (done) for (const region of earlier?.primary || []) warmedRegions.add(region);

    const ahead = live && i < index ? sets.filter(isPlanned).length : 0;
    const counted = live ? done + ahead : (i < index ? done : 0);
    if (!counted) continue;
    planned += ahead;
    const share = overlap(exercise, earlier);
    same += counted * share;
    other += counted * (1 - share);
    if (prioritisesSame(exercise, earlier)) direct += counted;
  }
  return {
    same, other, direct, total: same + other, warmedRegions, planned,
    // Was "dieser Muskel" für diese Übung heißt, damit der Screen das Wort sagen kann,
    // statt auf etwas zu zeigen, das der Leser erraten muss.
    regions: leadingRegions(exercise),
  };
}

/**
 * Der Anteil der frischen Kraft, der an dieser Stelle noch da ist.
 *
 * 1,0 für die erste Übung des Tages. Das Beispiel, für das es das gibt: letzte Woche
 * Bankdrücken als Erstes mit 100 × 8, diese Woche Bankdrücken nach drei Sätzen Butterfly.
 * Derselbe Mensch, dieselbe Kraft, und ohne diese Korrektur würde die App die zweite Woche
 * als Rückschritt lesen und sagen, man solle zurückgehen.
 */
export function readiness({ same = 0, other = 0 } = {}, cost = null) {
  const perSame = cost?.same ?? SAME_REGION;
  const perOther = cost?.other ?? OTHER_REGION;
  return 1 - Math.min(MAX_FATIGUE, same * perSame + other * perOther);
}

/**
 * Die Kosten der Reihenfolge, gemessen aus dem eigenen Log, oder null.
 *
 * Die Einheiten in die mit wenig vorheriger Arbeit am selben Muskel und die mit viel
 * teilen und vergleichen, was dabei gehoben wurde. Nur beantwortet, wenn die beiden Gruppen
 * wirklich verschiedene Einheiten sind, mindestens zwei pro Gruppe und ein echter Abstand
 * dazwischen. Darunter passt man eine Linie an Rauschen an, und die Annahme ist die bessere Antwort.
 */
export function observedOrderCost(rows) {
  const usable = rows.filter((r) => r.rawE1rm > 0);
  if (usable.length < 6) return null;
  const loads = usable.map((r) => r.prior.same);
  const spread = Math.max(...loads) - Math.min(...loads);
  if (spread < 3) return null;

  const mid = (Math.max(...loads) + Math.min(...loads)) / 2;
  const light = usable.filter((r) => r.prior.same <= mid);
  const heavy = usable.filter((r) => r.prior.same > mid);
  if (light.length < 2 || heavy.length < 2) return null;

  const mean = (list, pick) => list.reduce((n, r) => n + pick(r), 0) / list.length;
  const lightMean = mean(light, (r) => r.rawE1rm);
  const heavyMean = mean(heavy, (r) => r.rawE1rm);
  const gap = mean(heavy, (r) => r.prior.same) - mean(light, (r) => r.prior.same);
  if (!lightMean || gap <= 0) return null;

  const perSet = (1 - heavyMean / lightMean) / gap;
  // Halb eigene Zahl, halb Annahme. Eine einzelne Einheit mit Pech soll das ein bisschen
  // bewegen und nie umdrehen: eine negative Messung heißt "keine Kosten gefunden", nicht
  // "müde trainieren macht stärker".
  const blended = (Math.max(0, perSet) + SAME_REGION) / 2;
  return { same: Math.min(0.04, blended), other: OTHER_REGION, measured: true };
}

/**
 * Dieselbe Messung, über jede Übung im Log gebündelt.
 *
 * `observedOrderCost` kann erst antworten, wenn EINE Übung von genug verschiedenen
 * Positionen aus trainiert wurde, und das ist für die meisten Monate entfernt und für
 * manche nie: steht Bankdrücken immer zuerst und Flys immer an vierter Stelle, bekommt
 * diese Übung nie die Streuung, die sie braucht, egal wie lang das Log wird.
 *
 * Bündeln repariert die Rechnung, nicht das Training. Die Schätzungen jeder Übung werden
 * zuerst durch den eigenen Mittelwert dieser Übung geteilt, eine Kniebeuge mit 140 kg und
 * ein Seitheben mit 20 kg tragen also dieselbe FORM bei, statt dass die Kniebeuge das
 * Seitheben übertönt. Die Teilung in leicht und schwer läuft dann über alles zugleich.
 * Das antwortet viel früher und wird nur benutzt, wo die eigene Messung der Übung es nicht kann.
 *
 * Zwischengespeichert, weil der Trainieren-Screen einmal pro Übungsblock fragt und das hier
 * durchs ganze Log läuft. Der Schlüssel ist absichtlich billig und absichtlich vorsichtig:
 * eine neue abgeschlossene Einheit ändert ihn, und sonst muss das nichts.
 */
let pooledCache = { key: null, value: null };

export function pooledOrderCost(sessions, byId, { minExercises = 3, minRows = 12, assumedRir = 0 } = {}) {
  const finished = (sessions || []).filter((s) => s.finishedAt);
  const key = `${finished.length}:${assumedRir}:${Math.max(0, ...finished.map((s) => s.startedAt || 0))}`;
  if (pooledCache.key === key) return pooledCache.value;

  const byExercise = new Map();
  for (const session of finished) {
    (session.entries || []).forEach((entry, index) => {
      const sets = (entry.sets || []).filter(isCounted);
      if (!sets.length) return;
      const best = Math.max(...sets.map((set) => effortE1rm(set, assumedRir)));
      if (!best) return;
      const list = byExercise.get(entry.exerciseId) || [];
      list.push({ same: priorWork(session.entries, index, byId).same, value: best });
      byExercise.set(entry.exerciseId, list);
    });
  }

  const pooled = [];
  let exercises = 0;
  for (const list of byExercise.values()) {
    if (list.length < 3) continue;      // ein oder zwei Einheiten sagen nichts über die Reihenfolge
    const mean = list.reduce((n, r) => n + r.value, 0) / list.length;
    if (!mean) continue;
    exercises++;
    for (const row of list) pooled.push({ prior: { same: row.same }, rawE1rm: row.value / mean });
  }

  const value = exercises >= minExercises && pooled.length >= minRows
    ? observedOrderCost(pooled)
    : null;
  pooledCache = { key, value };
  return value;
}

/* ===================== das Log, vergleichbar gemacht ===================== */

/**
 * Jede vergangene Einheit einer Übung, auf eine gemeinsame Grundlage korrigiert.
 *
 * `freshE1rm` ist die Zahl, die Einheiten vergleichbar macht: was dieselbe Arbeit wert
 * gewesen wäre, wenn sie als Erstes in der Einheit gemacht worden wäre. Daran wird der
 * Verlauf angepasst, und daraus wird das Ziel für heute hochgerechnet.
 *
 * Das zurückgegebene Array hat eine Eigenschaft `orderCost`: die gemessenen Kosten der
 * vorherigen Arbeit, das gebündelte `fallbackCost`, wenn diese Übung selbst keine Messung
 * hergibt, oder null, wenn beides fehlt. Es hängt am Array, statt jeden Aufrufer zu zwingen,
 * ein Paar `{ rows, orderCost }` auszupacken, für einen Wert, den nur zwei davon lesen.
 */
export function exerciseHistory(sessions, exerciseId, byId,
  { excludeSessionId = null, limit = 8, fallbackCost = null, assumedRir = 0 } = {}) {
  const rows = [];
  for (const session of sessions) {
    if (!session.finishedAt || session.id === excludeSessionId) continue;
    const index = (session.entries || []).findIndex((e) => e.exerciseId === exerciseId);
    if (index < 0) continue;
    const entry = session.entries[index];
    const sets = (entry.sets || []).filter(isCounted);
    if (!sets.length) continue;

    const prior = priorWork(session.entries, index, byId);
    const best = Math.max(...sets.map((set) => effortE1rm(set, assumedRir)));
    rows.push({
      at: session.startedAt,
      sessionId: session.id,
      position: index,
      sets,
      firstSet: sets[0],
      // Das Gewicht, mit dem die Übung ANGEFANGEN hat. Daraus muss ein Rat für den ersten
      // Satz gebaut werden. Das ist nicht dasselbe wie der schwerste Satz: viele steigern über
      // ihre Arbeitssätze, und die Wiederholungen von Satz eins gegen die Last von Satz drei zu
      // messen hat einen Rat ergeben, der jede Einheit um zwei Schritte daneben lag.
      openingWeight: effectiveSetWeight(sets[0]),
      topWeight: Math.max(...sets.map(effectiveSetWeight)),
      prior,
      rawE1rm: best,
      effortLogged: sets.some(hasEffort),
      assumedRir,
    });
    if (rows.length >= limit) break;
  }

  // Rein kommt das Neueste zuerst, raus das Älteste zuerst: alles darunter liest es als Reihe.
  rows.reverse();
  // Zuerst die eigene Messung dieser Übung, die gebündelte, wenn die nicht antworten kann,
  // und die Annahme, wenn keins von beiden geht.
  const cost = observedOrderCost(rows) || fallbackCost;
  for (const row of rows) {
    row.readiness = readiness(row.prior, cost);
    row.freshE1rm = row.rawE1rm / row.readiness;
  }
  rows.orderCost = cost;
  return rows;
}

/**
 * Frische Kraft, auf heute hochgerechnet.
 *
 * Drei Einheiten, bevor eine Linie gezogen wird, und die Linie ist gedeckelt: zwei Wochen
 * Glück sollen nicht zu einem Gewicht hochgerechnet werden, das niemand heben kann. Ohne
 * genug Punkte steht die letzte Einheit für sich, und genau das ist sie auch.
 */
export function projectFresh(rows, now = Date.now()) {
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  if (rows.length < 3) return { value: last.freshE1rm, slope: null, sessions: rows.length };

  const recent = rows.slice(-6);
  const base = recent[0].at;
  const fit = linearFit(recent.map((r) => [(r.at - base) / (7 * 86400000), r.freshE1rm]));
  if (!fit) return { value: last.freshE1rm, slope: null, sessions: rows.length };

  const weeksSince = Math.min(3, (now - last.at) / (7 * 86400000));
  const projected = last.freshE1rm + fit.slope * weeksSince;
  return {
    // Nie mehr als 5 % über dem, was wirklich gemacht wurde, egal was die Gerade sagt.
    value: Math.max(last.freshE1rm * 0.9, Math.min(last.freshE1rm * 1.05, projected)),
    slope: fit.slope,
    sessions: rows.length,
  };
}

/**
 * Wie viel ein Satz die folgenden kostet, gemessen an diesem Menschen.
 *
 * Jede vergangene Einheit mit zwei oder mehr eingetragenen Sätzen sagt etwas darüber, und
 * das ist eine der wenigen Sachen im Training, die wirklich persönlich sind: manche
 * verlieren zwei Wiederholungen pro Satz, manche keine. Der Rückfall ist eine Annahme und
 * gilt nur, bis es drei Einheiten gibt.
 */
export function setDecay(rows, assumedRir = 0) {
  const samples = [];
  for (const row of rows) {
    const first = effortE1rm(row.sets[0], assumedRir);
    if (!first) continue;
    row.sets.slice(1).forEach((set, i) => {
      const value = effortE1rm(set, assumedRir);
      if (value) samples.push((1 - value / first) / (i + 1));
    });
  }
  // Drei Prozent, nicht vier. Vier kamen aus keiner bestimmten Quelle und haben mehr als eine
  // Wiederholung pro Satz gekostet: sechs für den zweiten Satz einer Einheit vorhergesagt,
  // die mit acht angefangen hat, obwohl praktisch jedes echte Log 8-7-6 geht. Drei bildet
  // diese Form nach und muss nur halten, bis es zwei Einheiten mit mehreren Sätzen gibt,
  // danach ersetzt sie der eigene Median.
  if (samples.length < 3) return { value: 0.03, measured: false };
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  return { value: Math.max(0.005, Math.min(0.12, median)), measured: true };
}

/* ===================== Runden ===================== */

export function parseReps(spec) {
  if (!spec) return null;
  // "3x8" sind drei Sätze mit acht, kein Bereich von drei bis acht. So geschrieben hat es
  // das Ziel früher auf 3-8 erweitert, die Berechnung jagte acht Wiederholungen als OBERES
  // Ende eines Bereichs, dessen unteres Ende drei war, und empfahl mehr Gewicht nach einem
  // Satz mit drei.
  const text = String(spec).replace(/^\s*\d+\s*[x×*]\s*/i, '');
  const nums = text.match(/\d+/g);
  if (!nums || !nums.length) return null;
  const ns = nums.map(Number).filter((n) => n > 0);
  if (!ns.length) return null;
  return { low: Math.min(...ns), high: Math.max(...ns) };
}

/**
 * Die kleinste Änderung, die sich an diesem Gerät lohnt.
 *
 * `override` ist der Gewichtsschritt pro Maschine aus dem Sheet zur Einstellung, und er
 * gewinnt, wo es ihn gibt: der Standard fürs Gerät ist eine Vermutung über ein Gestell,
 * das niemand angeschaut hat, der Override ist jemand, der es angeschaut hat.
 *
 * Fünf Kilo, nicht 2,5. Ein Steckgewicht geht fast überall in Fünfern hoch, und an der
 * Stange sind fünf Kilo eine 2,5er-Scheibe pro Seite, also der Sprung, den man wirklich
 * macht. 2,5 zu verlangen ergab eine Reihe von Vorschlägen im Abstand einer halben
 * Scheibe, die es an der Maschine nicht gab oder die zu klein waren, um dafür umzustecken.
 * Pfund standen schon bei 5 und bleiben dort. Kurzhanteln behalten in beiden Einheiten ihren
 * kleinen Schritt: fünf mehr in einer Hand sind kein Schritt, sondern eine andere Hantel.
 */
export function loadStep(exercise, units, override = null) {
  if (Number(override) > 0) return Number(override);
  if (exercise?.equipment === 'Dumbbell') return units === 'lb' ? 5 : 2;
  return 5;
}

/**
 * Ein Gewicht, das sich wirklich zusammenstellen lässt.
 *
 * An der Langhantel heißt das echte Scheiben, ein Vorschlag von 101 kg ist ein Vorschlag,
 * eine 0,5-kg-Scheibe suchen zu gehen. Überall sonst ist es der nächste Schritt, und an
 * einem Steckgewicht ist das das einzige Gewicht, das es überhaupt gibt.
 */
export function roundLoad(weight, exercise, { units = 'kg', barWeight = 20, step = null } = {}) {
  // Ein Klimmzug wiegt, was der Mensch wiegt. Es gibt keinen Schritt, auf dem man landen
  // könnte, und einen Körper mit 82 kg auf fünf zu runden hat daraus 80 gemacht.
  if (bodyweightLoadMode(exercise) === 'bodyweight') return weight;
  const increment = loadStep(exercise, units, step);
  if (exercise?.equipment !== 'Barbell' || Number(step) > 0) {
    return Math.round(weight / increment) * increment;
  }
  const plan = platePlan(weight, barWeight, units);
  if (!plan) return barWeight;
  return plan.loaded;
}

/**
 * Wie viele Wiederholungen eine Last bei einer Leistung hergibt, mit `reserve` im Tank.
 *
 * Das Epsilon ist keine Rundungsvorliebe. Epley vorwärts und dann rückwärts landet nicht
 * dort, wo es angefangen hat: 135 x 8 kommt aus `e1rm` als 170.99999999999997, und ein
 * nacktes floor macht aus den acht wirklich gemachten Wiederholungen sieben. Jeder
 * Vorschlag "gleiches Gewicht, eine Wiederholung weniger", den diese App je gedruckt hat,
 * kam aus diesem fehlenden Bit, und die Hälfte der Rückschritte auch, weil eine hier
 * verlorene Wiederholung dort eine unter dem Bereich ist.
 */
const repsAt = (capacity, weight, reserve) => {
  if (!capacity || !weight) return 0;
  // Runden, nicht abschneiden. Epley löst etwa eine Wiederholung pro 3,3 % Last auf, floor
  // wirft also im Schnitt eine halbe Wiederholung weg, und zwar immer in dieselbe Richtung.
  // Eine Vorhersage, die jedes Mal nach unten verzerrt ist, ist genau das, was eine App so
  // wirken lässt, als rede sie einem das eigene Training aus. Jede Entscheidung, die auf
  // dieser Zahl aufbaut, hat ihren eigenen Puffer (BACK_OFF_MARGIN), die halbe Wiederholung
  // Vorsicht hat also nirgends, wo sie benutzt wurde, etwas getragen.
  return Math.round(30 * (capacity / weight - 1) - reserve);
};

/** Die Last, die mit `reserve` übrig auf einem Wiederholungsziel landet. */
const loadFor = (capacity, reps, reserve) => capacity / (1 + (reps + reserve) / 30);

/**
 * Die Reserve, mit der die eigenen ersten Sätze gemacht werden.
 *
 * Diese Zahl macht eine Vorhersage mit dem Log vergleichbar, aus dem sie gebaut ist, und
 * sie falsch zu haben hat genau die Beschwerde erzeugt, mit der dieser Umbau angefangen
 * hat. `rawE1rm` liest einen vergangenen Satz als `reps + reserve`. Mit einer ANDEREN
 * Reserve vorherzusagen beantwortet also eine andere Frage als die, die der Verlauf
 * gestellt hat. Mit fest einer Wiederholung in Reserve, wie früher, las die Berechnung
 * 135 x 8 und antwortete "135 x 7". Rechnerisch stimmig, und von jedem, der es sah, als
 * Aufforderung gelesen, schwächer zu werden.
 *
 * Eingetragene Reserven gewinnen. Wo die Spalte leer ist, gilt die feste Annahme aus den
 * Einstellungen, derselbe Wert, mit dem der Verlauf gelesen wurde, der Kreis schließt sich also genau.
 */
function openingReserve(rows, assumedRir = 0) {
  const logged = rows.map((r) => r.firstSet).filter(hasEffort).map((s) => Math.max(0, Number(s.rir)));
  if (!logged.length) return Math.max(0, Math.min(4, Number(assumedRir) || 0));
  logged.sort((a, b) => a - b);
  return logged[Math.floor(logged.length / 2)];
}

/**
 * Wie weit unter dem unteren Ende des Bereichs eine Last landen muss, bevor sie runtergeht.
 *
 * Zwei Wiederholungen, und dass es nicht null sind, ist Hysterese. Korrekturen der
 * Ermüdung, der Spielraum bei Epley und eine gerundete Scheibe bewegen die Schätzung alle
 * um etwa eine Wiederholung. Eine Schwelle genau auf der Grenze des Bereichs springt also
 * wegen Rauschen zwischen "halten" und "zurück". Genau so wurde aus 135 x 8 "zurück auf
 * 130 x 7": drei Sätze Flys vorher kosteten 4,5 %, die Schätzung rutschte um einen
 * Bruchteil einer Wiederholung über die Linie, und der Vorschlag hat deshalb das Gewicht geändert.
 *
 * Ein Schritt zurück ist ein echtes Ereignis. Er sollte einen echten Grund brauchen.
 */
const BACK_OFF_MARGIN = 2;


/* ===================== was heute drin ist ===================== */

/**
 * Wie viele Wiederholungen eine Last gerade hergibt, oder null, wenn sich nichts sagen lässt.
 *
 * Das konnte die Berechnung schon immer: es ist derselbe Aufruf, der aus einem
 * vorgeschlagenen Gewicht "x 7" macht. Er war nur von außen nicht erreichbar, die Zahl
 * stand also nur neben einem Gewicht, das die App gewählt hatte. Eigenes Gewicht
 * eingetippt, und der Screen wurde still, genau in dem Moment, in dem man etwas
 * entscheidet und eine zweite Meinung gebrauchen könnte.
 */
export const predictReps = (capacity, weight, reserve = 0) =>
  (!capacity || !weight ? null : Math.max(0, repsAt(capacity, weight, reserve)));

/**
 * Die andere Richtung: Wiederholungen eingetippt, Anstrengung folgt daraus.
 *
 * Absichtlich NICHT dieselbe Frage. Steht eine Wiederholungszahl in der Zeile, hat man "wie
 * viele gehen" selbst beantwortet, offen ist, wie nah man damit an der Grenze ist. Dort mit
 * einer Vorhersage von Wiederholungen zu antworten hieße, dass die App mit einer gerade
 * getippten Zahl streitet.
 */
export const predictReserve = (capacity, weight, reps) =>
  (!capacity || !weight || !reps ? null : 30 * (capacity / weight - 1) - reps);

/**
 * Die frische Leistung heute und die Reserve, mit der sie angegeben ist.
 *
 * Ein Leser für beide Hälften der Einheit, weil die beiden sich uneins sind, woher die
 * Zahl kommt, und der Screen darf das nicht sein.
 *
 * NOCH NICHTS EINGETRAGEN: die Hochrechnung aus vergangenen Einheiten, abgezogen die
 * Arbeit vor dieser Übung. Genau darauf baut `openingSet`, deshalb bewegt sich das hier
 * auch, wenn man eine Übung in der Liste nach oben schiebt.
 *
 * HEUTE SCHON ETWAS EINGETRAGEN: die eigenen Sätze von heute, auf frisch zurückgerechnet.
 * Ein abgeschlossener Satz sagt mehr über heute als vier Einheiten Verlauf, und ab da
 * trägt der Verlauf nur noch das Nachlassen von Satz zu Satz bei.
 *
 * `setIndex` sagt, für welchen Arbeitssatz die Antwort ist, ab null gezählt, weil die
 * Leistung über eine Einheit nachlässt und eine Vorhersage für Satz eins bei Satz vier
 * eine Wiederholung oder mehr daneben liegt.
 *
 * @returns { capacity, reserve, live } oder null
 */
export function capacityToday(doneSets, rows, {
  prior = null, setIndex = null, assumedRir = 0, now = Date.now(),
} = {}) {
  const done = (doneSets || []).filter(isCounted);
  const list = rows || [];
  const reserve = openingReserve(list, assumedRir);
  const decay = setDecay(list, assumedRir);
  const left = (i) => Math.max(0.6, 1 - decay.value * i);
  const at = setIndex === null ? done.length : Math.max(0, setIndex);

  if (done.length) {
    const fresh = Math.max(...done.map((set, i) => effortE1rm(set, assumedRir) / left(i)));
    if (!fresh) return null;
    return { capacity: fresh * left(at), reserve, live: true };
  }

  if (!list.length) return null;
  const projected = projectFresh(list, now);
  if (!projected?.value) return null;
  const fresh = projected.value * readiness(prior || { same: 0, other: 0 }, list.orderCost);
  return { capacity: fresh * left(at), reserve, live: false };
}

/* ===================== zwischen den Einheiten ===================== */

/**
 * Womit man heute anfängt.
 *
 * @param rows      Ergebnis von exerciseHistory, das Älteste zuerst
 * @param options   { exercise, targetReps, rule, units, barWeight, prior, now }
 * @returns { weight, reps, change, reasons, confidence } oder null
 */
export function openingSet(rows, {
  exercise = null, targetReps = null, rule = 'double', units = 'kg', barWeight = 20,
  prior = null, now = Date.now(), step: stackStep = null, assumedRir = 0,
  keepInRange = false,
} = {}) {
  if (!rows.length) return null;
  const range = parseReps(targetReps) || { low: 6, high: 10 };
  const last = rows[rows.length - 1];
  const step = loadStep(exercise, units, stackStep);
  if (!last.openingWeight) return null;
  if (rule === 'manual') return null;

  const projected = projectFresh(rows, now);
  const today = readiness(prior || { same: 0, other: 0 }, rows.orderCost);
  const capacity = projected.value * today;

  // Vorhergesagt wird bei der Anstrengung, mit der man wirklich trainiert, damit "gleiches
  // Gewicht, gleicher Tag" die Wiederholungen vorhersagt, die wirklich eingetragen wurden,
  // und nicht eine weniger. Siehe `openingReserve`.
  const reserve = openingReserve(rows, assumedRir);
  const predict = (load) => repsAt(capacity, load, reserve);

  const reasons = [];
  const firstReps = Number(last.firstSet.reps) || 0;
  const firstReserve = reserveOf(last.firstSet, assumedRir);
  const reserveLogged = hasEffort(last.firstSet);

  // Die Regel, um die gebeten wurde: es reicht, wenn der ERSTE Arbeitssatz das Ziel schafft.
  // Dass Satz drei und vier nachlassen, ist Ermüdung und kein Urteil über das Gewicht, und
  // den Fortschritt an ihnen festzuhalten ist der Grund, warum früher monatelang dieselbe
  // Zahl empfohlen wurde.
  //
  // "Schaffen" zählt mit, was in Reserve blieb. Sieben Wiederholungen mit drei im Tank sind
  // ein Satz mit zehn, der früher aufgehört hat, und wer früher aufhört, braucht nicht
  // dasselbe Gewicht, sondern ein anderes.
  const firstCapable = firstReps + firstReserve;
  const clearedTarget = firstCapable >= range.high;
  const falling = projected.slope !== null && projected.slope < -0.5;

  // Eine Bewegung, deren Last der eigene Körper ist, hat keine Gewichtssteigerung zu bieten,
  // und so zu tun, als ob, ergab den schlechtesten Vorschlag der App: zehn Klimmzüge bei
  // einem Ziel von 6-10 wurden mit "Ziel 6" beantwortet. Die Berechnung war in den Zweig
  // `up` gegangen, hatte dem KÖRPERGEWICHT einen Schritt draufgelegt und ehrlich die
  // Wiederholungen gemeldet, die ein Körper mit 90 kg schaffen würde. Die eine Einheit, die
  // den Bereich geschafft hat, sollte also vier Wiederholungen weniger machen.
  //
  // Niemand legt sich absichtlich acht Kilo zu. Bei diesen Übungen ist das obere Ende des
  // Bereichs ein Meilenstein und keine Wand: geschafft, und das Ziel steigt einfach weiter.
  // Die Begründung verweist auf die Variante mit Zusatzgewicht, für alle, die lieber einen
  // Gürtel umschnallen, als weiter Wiederholungen anzuhängen.
  const ownBodyweight = bodyweightLoadMode(exercise) === 'bodyweight';

  // Reihenfolge. Vor allem anderen gemeldet, weil man das auf dem eigenen Screen sehen kann
  // und es sonst als Rückschritt lesen würde.
  const orderShift = today - last.readiness;
  if (Math.abs(orderShift) >= 0.01) {
    // Wie viel von dem, was gezählt wird, noch gar nicht passiert ist. Wer ein Ziel eine
    // Wiederholung unter letzter Woche sieht, soll erfahren, dass der Grund sechs Sätze
    // sind, die noch unabgehakt über dieser Karte stehen, und dass sich die Antwort ändert,
    // wenn man die Übung nach oben schiebt.
    const ahead = Math.round(prior?.planned || 0);
    reasons.push({
      key: orderShift < 0 ? (ahead > 0 ? 'laterPlanned' : 'later') : 'earlier',
      params: {
        pct: Math.abs(Math.round(orderShift * 100)),
        weight: Math.abs(last.openingWeight * orderShift),
        sets: ahead,
      },
    });
  }
  const fresherOrEqual = orderShift >= -0.005;

  /**
   * Was man bei einem Gewicht verlangt, das bleibt, wo es ist.
   *
   * Doppelte Progression, ausgeschrieben: die Last bleibt, und das Wiederholungsziel steigt
   * um eins, bis das obere Ende des Bereichs erreicht ist. Dieses "+1" ist der ganze
   * Mechanismus, und die alte Version hatte ihn nicht. Sie druckte eine rohe Schätzung des
   * Modells, und die ist bei gleichem Gewicht per Konstruktion DIE ZAHL VOM LETZTEN MAL.
   * Der Screen sagte also "halten" und verlangte dann genau das, was schon gemacht war,
   * oder weniger. Nichts davon sagt einem, was eine gute Einheit wäre.
   *
   * Drei Dinge begrenzen die Forderung. Sie geht nie über das obere Ende des Bereichs,
   * dort steigt stattdessen das Gewicht. Sie legt keine Wiederholung drauf, solange der
   * Verlauf rückwärts geht, denn auf dem Weg nach unten mehr zu verlangen kostet einen
   * Vorschlag seine Glaubwürdigkeit. Und wenn heute messbar weniger frisch ist als die
   * Einheit, mit der verglichen wird, fängt das WIEDERHOLUNGSZIEL das auf und nicht das
   * Gewicht: drei Sätze Flys vorher kosten etwa eine Wiederholung, und das zu sagen ist
   * viel nützlicher, als still 5 kg von der Stange zu nehmen.
   */
  const holdAsk = () => {
    const stretch = falling ? firstReps : Math.min(range.high, firstReps + 1);
    const model = predict(last.openingWeight);
    return fresherOrEqual
      ? Math.max(stretch, Math.min(range.high, model))
      : Math.max(1, Math.min(stretch, model));
  };

  let weight, reps, change;
  const holdLoad = roundLoad(last.openingWeight, exercise, { units, barWeight, step: stackStep });
  // Wo die Last liegen müsste, damit heute das untere Ende des Bereichs erreichbar ist. Wird
  // nur gefragt, wenn etwas gesagt hat, dass die aktuelle Last es nicht ist.
  const wantedForRange = loadFor(capacity, range.low, reserve);
  const predictedHere = predict(last.openingWeight);
  const shortOfRange = predictedHere < range.low;
  // Ein Schritt zurück braucht eine Last, die den Bereich um einen Puffer verfehlt und nicht
  // um einen Rundungsfehler, oder einen Verlauf, der rückwärts geht, und einen Bereich, der
  // wirklich außer Reichweite ist. So oder so muss er auch wirklich eine leichtere Stange
  // bringen, siehe unten.
  //
  // `keepInRange` heißt, dass man lieber den Wiederholungsbereich eingehalten sieht als die
  // Last gehalten: dann fällt der Puffer weg, und jede Lücke bewegt das Gewicht. Das ist eine
  // echte Vorliebe und keine bessere Antwort. Den Puffer gibt es, weil eine Wiederholung
  // Spielraum im Rauschen der Schätzung liegt, und ohne ihn jagt der Vorschlag dieses
  // Rauschen rauf und runter. Genau deshalb standardmäßig aus.
  const tooHeavy = keepInRange
    ? shortOfRange
    : predictedHere <= range.low - BACK_OFF_MARGIN || (falling && shortOfRange);

  /** Eine Last, gerundet und dann nach unten geschoben, falls das Runden den Bereich verloren hat. */
  const landInRange = (want) => {
    const rounded = roundLoad(want, exercise, { units, barWeight, step: stackStep });
    if (!keepInRange || repsAt(capacity, rounded, reserve) >= range.low) return rounded;
    // roundLoad rundet zum nächsten Wert und kann also über die Last hinaus AUFrunden, die
    // der Bereich braucht. Unter einer Einstellung, deren ganzes Versprechen der Bereich
    // ist, muss das einen Schritt zurück, statt still um eine Wiederholung zu verfehlen.
    return roundLoad(rounded - step, exercise, { units, barWeight, step: stackStep });
  };

  if (rule === 'reps') {
    // Progression über Wiederholungen hält die Last per Definition. Die alte Version hat sie
    // mit der Ermüdung von heute skaliert, also eine Gewichtsänderung unter genau der Regel,
    // die es gibt, um keine Gewichtsänderungen zu machen.
    weight = holdLoad;
    reps = holdAsk();
    change = 'hold';
    reasons.push({ key: 'repRule', params: { high: range.high } });
  } else if (ownBodyweight) {
    weight = last.openingWeight;
    reps = clearedTarget
      // Über dem oberen Ende des Bereichs, wo der Bereich nicht mehr gilt: eine mehr als
      // wirklich gemacht, und keine Decke.
      ? Math.max(range.high, firstReps + (falling || !fresherOrEqual ? 0 : 1))
      : holdAsk();
    if (!fresherOrEqual) reps = Math.min(reps, Math.max(1, predict(last.openingWeight)));
    change = 'hold';
    reasons.unshift(clearedTarget
      ? { key: 'bodyweightClimb', params: { reps: firstReps, ask: reps, high: range.high } }
      : { key: 'buildReps', params: { reps: firstReps, ask: reps, high: range.high } });
  } else if (rule === 'weight' || (clearedTarget && !falling)) {
    // Hoch. Nach beiden Seiten begrenzt: mindestens ein Schritt, damit der Vorschlag wirklich
    // eine Änderung ist, höchstens drei, damit eine einzige sehr gute Einheit das Gewicht
    // nicht irgendwohin schleudert, wo man nie war. Und nie mehr als ein Zehntel der Last,
    // weil drei Schritte bei einer 2-kg-Kurzhantel ein Sprung von 60 % auf eine 10-kg-Hantel
    // sind und von 8 % auf eine 75-kg-Stange.
    const ceiling = Math.min(last.openingWeight + step * 3, last.openingWeight * 1.1);
    weight = roundLoad(
      Math.max(last.openingWeight + step, Math.min(Math.max(ceiling, last.openingWeight + step), wantedForRange)),
      exercise, { units, barWeight, step: stackStep }
    );
    if (weight <= last.openingWeight) {
      weight = roundLoad(last.openingWeight + step, exercise, { units, barWeight, step: stackStep });
    }
    // Ehrlich, nicht hoffnungsvoll. Eine schwerere Stange bringt weniger Wiederholungen, das
    // macht sie schwerer. Die Antwort in den Bereich hochzudrücken hat "60 kg x 10 -> 65 kg
    // x 10" gedruckt, also zwei Einheiten Fortschritt in einer Zeile behauptet. Was sie darf,
    // ist bis zum unteren Ende des Bereichs zu fallen und nicht weiter, dafür ist der Schritt bemessen.
    reps = Math.min(range.high, Math.max(1, predict(weight)));
    change = 'up';
    reasons.unshift(rule === 'weight'
      ? { key: 'weightRule', params: {} }
      : firstReps >= range.high
        ? { key: 'clearedFirstSet', params: { reps: firstReps, high: range.high, from: last.openingWeight } }
        : {
            // Sagen, was es war. Eine Gewichtssteigerung, die auf einer Annahme beruht, die der
            // Nutzer nie gemacht hat, soll sich auch so ankündigen.
            key: reserveLogged ? 'easyFirstSet' : 'assumedFirstSet',
            params: { reps: firstReps, rir: firstReserve, capable: firstCapable },
          });
  } else {
    const backOff = tooHeavy
      ? landInRange(Math.max(step, Math.min(last.openingWeight - step, wantedForRange)))
      : holdLoad;
    if (tooHeavy && backOff < holdLoad) {
      weight = backOff;
      reps = Math.min(range.high, Math.max(1, predict(weight)));
      change = 'down';
      reasons.unshift({
        key: falling ? 'trendDown' : 'tooHeavyToday',
        params: { low: range.low, from: last.openingWeight, reps: predictedHere },
      });
    } else {
      // Halten. Welches der drei Dinge gerade passiert, bekommt einen eigenen Satz, denn
      // "bleib bei 135" nach einer guten, einer müden und einer stagnierenden Einheit sind drei
      // verschiedene Ratschläge, die zufällig dieselbe Zahl haben.
      weight = holdLoad;
      reps = holdAsk();
      change = 'hold';
      reasons.unshift(!fresherOrEqual
        ? { key: 'holdTired', params: { reps: firstReps, ask: reps, from: last.openingWeight } }
        // "Eine Wiederholung mehr" ist der Fall der doppelten Progression und nur der. Wo die
        // Hochrechnung oder ein frischerer Platz in der Einheit mehr als eine Wiederholung
        // Luft zeigt, ist die Forderung größer, und "eine mehr" zu sagen ist schlicht falsch:
        // da stand "letztes Mal 12, eine mehr: 15".
        : reps > firstReps + 1
          ? { key: 'stretchReps', params: { reps: firstReps, ask: reps, high: range.high } }
          : reps > firstReps
            ? { key: 'buildReps', params: { reps: firstReps, ask: reps, high: range.high } }
            : { key: 'matchReps', params: { reps: firstReps, high: range.high } });
    }
  }

  // Eine letzte Absicherung, keine Regel. Jeder Zweig oben meldet schon, was er vorhersagt,
  // das hier fängt nur eine Wiederholungszahl ab, die als null gedruckt würde. Die Decke des
  // Bereichs fällt bei einer Körpergewichtsübung weg, dem einen Fall, in dem über das obere
  // Ende hinaus zu gehen die ganze Progression ist.
  reps = Math.max(1, ownBodyweight ? reps : Math.min(range.high, reps));

  // Die Verlaufslinie, wenn sie überhaupt etwas sagt. Eine Steigung über ein halbes Kilo
  // pro Woche in eine Richtung ist eine Richtung, alles darunter ist eine flache Linie mit
  // Rauschen. Früher hieß hier auch eine FALLENDE "flach", weil es nur die zwei Schlüssel
  // hoch und nicht-hoch gab.
  if (projected.slope !== null && Math.abs(projected.slope) >= 0.5) {
    reasons.push({
      key: projected.slope > 0 ? 'trendUp' : 'trendSlipping',
      // Eine Zahl, kein fertiger Text: die Berechnung weiß nicht, ob der Screen Kilo oder
      // Pfund zeigt, und "steigt 1.8 pro Woche" ohne Einheit war das Problem des Lesers.
      params: { perWeek: Math.abs(projected.slope), sessions: projected.sessions },
    });
  } else if (projected.sessions >= 3) {
    reasons.push({ key: 'trendFlat', params: { sessions: projected.sessions } });
  }
  if (!rows.some((r) => r.effortLogged)) reasons.push({ key: 'noRir', params: { rir: assumedRir } });

  return {
    weight, reps, change, reasons,
    range,
    capacity,
    fromWeight: last.openingWeight,
    sessions: rows.length,
    orderAware: Math.abs(orderShift) >= 0.01,
  };
}

/* ===================== innerhalb einer Einheit ===================== */

/**
 * Was man für den nächsten Satz auflegt, je nachdem, wie die davor heute liefen.
 *
 * Das ist die Zahl, die die alte App nie hatte. Sie wusste, was man letzte Woche gemacht
 * hat, und sagte nichts mehr, sobald die Einheit anfing, genau dann, wenn die Information
 * am besten ist: ein abgeschlossener Satz heute sagt mehr über heute als vier Einheiten Verlauf.
 *
 * @param doneSets  die heute schon abgeschlossenen Arbeitssätze, in Reihenfolge
 * @param rows      Ergebnis von exerciseHistory, für das eigene Nachlassen von Satz zu Satz
 */
export function nextSet(doneSets, rows, {
  exercise = null, targetReps = null, units = 'kg', barWeight = 20, step: stackStep = null,
  assumedRir = 0, keepInRange = false,
} = {}) {
  const done = (doneSets || []).filter(isCounted);
  if (!done.length) return null;
  const range = parseReps(targetReps) || { low: 6, high: 10 };
  const step = loadStep(exercise, units, stackStep);

  const decay = setDecay(rows || [], assumedRir);
  const lastWeight = effectiveSetWeight(done[done.length - 1]);
  if (!lastWeight) return null;

  // Der Anteil der frischen Kraft, der für den Satz an Position `i` noch da ist, null ist
  // der erste. Mit Untergrenze, sonst würde eine lange genug Einheit rechnerisch bei null landen.
  const left = (i) => Math.max(0.6, 1 - decay.value * i);

  // Die Leistung von heute, aus JEDEM schon gemachten Satz auf frisch zurückgerechnet und
  // nicht nur aus dem ersten. Nur Satz eins zu lesen nimmt an, dass Satz eins der schwerste
  // war. Das stimmt, wenn die Sätze fallen, und ist falsch, sobald jemand steigert: mit 60 x
  // 10 anfangen und dann 100 auflegen hat die Berechnung früher den Rest der Einheit von den
  // 60 aus schätzen lassen.
  const capacityFresh = Math.max(...done.map((set, i) => effortE1rm(set, assumedRir) / left(i)));
  if (!capacityFresh) return null;
  const capacity = capacityFresh * left(done.length);

  // Vorhergesagt bei der Anstrengung, bei der dieser Mensch wirklich aufhört, aus demselben
  // Grund wie beim Rat zwischen den Einheiten: wer bei jedem Satz 2 RIR einträgt, will nicht
  // die Zahl hören, die ihn ans Versagen bringen würde.
  const reserve = openingReserve(rows || [], assumedRir);

  const holdReps = repsAt(capacity, lastWeight, reserve);
  const recent = done[done.length - 1];
  // Dieselbe Lesart wie zwischen den Einheiten: Wiederholungen plus Reserve ist das, was der
  // Satz wirklich wert war. Zwei über dem oberen Ende heißt, das Gewicht ist leicht, und der
  // nächste Satz soll das nicht wiederholen. Beurteilt am gerade fertigen Satz und nicht nur
  // am ersten: ein dritter Satz mit noch zwei im Tank ist ein STÄRKERES Signal als ein
  // erster, und die alte Version konnte nur auf Satz eins reagieren.
  const blewPast = Number(recent.reps) + reserveOf(recent, assumedRir) >= range.high + 2;

  // Das Gewicht, mit dem der nächste Satz am unteren Ende des Bereichs landen würde.
  const wanted = loadFor(capacity, range.low, reserve);

  // Dass die Wiederholungen von Satz zu Satz nachlassen, machen Sätze nun mal. Standardmäßig
  // muss ein Schritt nach unten also etwas Echtes bringen, zwei Schritte wert, bevor die
  // Stange angefasst wird.
  //
  // Mit `keepInRange` sagt man das Gegenteil: lieber soll der Bereich halten und die Last
  // sich bewegen. Dann reicht jede Lücke, solange ein Schritt sie wirklich schließt. Dafür
  // ist die Einstellung da, und der Fall, für den es sie gibt, ist der vierte Satz einer
  // schweren Übung, bei dem das Gewicht zu halten ehrlich zwei Wiederholungen vorhersagt, oder eine.
  const dropsFar = wanted <= lastWeight - step * 2;
  // Nicht "ist der Bereich mehr als einen Schritt entfernt", sondern "würde ein Schritt ihn
  // schließen". Die erste Frage verweigert den Schritt, sobald die Last, die der Bereich
  // braucht, knapp über einem Schritt nach unten liegt (130,7 gegen eine 130, die den
  // Bereich wunderbar erreicht), und genau das ist der Satz, für den die Einstellung da ist.
  const oneStepDown = Math.max(step, lastWeight - step);
  const dropsAtAll = holdReps < range.low
    && oneStepDown < lastWeight
    && repsAt(capacity, oneStepDown, reserve) > holdReps;

  /** Eine Last, gerundet und nach unten geschoben, falls das Runden den Bereich verloren hat. */
  const landInRange = (want) => {
    const rounded = roundLoad(Math.max(step, want), exercise, { units, barWeight, step: stackStep });
    if (!keepInRange || repsAt(capacity, rounded, reserve) >= range.low) return rounded;
    return roundLoad(Math.max(step, rounded - step), exercise, { units, barWeight, step: stackStep });
  };

  let weight = lastWeight, change = 'hold', key = holdReps >= range.low ? 'holdWeight' : 'holdFade';
  if (blewPast) {
    weight = roundLoad(lastWeight + step, exercise, { units, barWeight, step: stackStep });
    change = 'up';
    key = 'setTooLight';
  } else if (keepInRange ? dropsAtAll : dropsFar) {
    // Das Leichtere von dem, was der Bereich verlangt, und einem Schritt nach unten. So ist
    // der Schritt nie kleiner als ein Schritt und nie größer als nötig.
    weight = landInRange(keepInRange ? Math.min(wanted, oneStepDown) : wanted);
    change = 'down';
    key = 'dropToRange';
  }

  // Gemeldet wie vorhergesagt, nicht wie erhofft: ein späterer Satz, der unter dem Bereich
  // landet, ist eine Information, und ihn in den Bereich hochzurunden wäre eine Lüge, damit
  // eine Zahl ordentlich aussieht. Die Decke gibt es nur, damit ein sehr leichter Satz keine
  // Wiederholungszahl druckt, die niemand machen wird.
  const reps = Math.min(range.high, Math.max(1, repsAt(capacity, weight, reserve)));
  return {
    setNumber: done.length + 1,
    weight,
    reps,
    change,
    reason: { key, params: { low: range.low, high: range.high, reps } },
    decayPct: Math.round(decay.value * 100),
    decayMeasured: decay.measured,
    range,
  };
}
