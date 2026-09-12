// Tagesziele und Summen.
//
// Ein Wort zum Umfang, weil gerade dieser Teil gern ausufert. Eiweiß und Kalorien sind
// die beiden, die eine eigene Aussage tragen: für Eiweiß gibt es eine vertretbare Zahl
// zum Muskelaufbau, und die Kalorien entscheiden, ob man zu- oder abnimmt.
//
// Kohlenhydrate und Fett bekommen inzwischen auch Ziele (macroTargets unten), und es
// lohnt sich, genau zu sagen, warum das kein Widerspruch ist. Es gibt kein belegtes
// Verhältnis der Makros, "40/30/30" ist Folklore mit Komma, und diese Datei gibt keins
// aus. Was es gibt, ist eine belegte Reihenfolge: Kalorien, dann Eiweiß, dann eine
// Untergrenze für Fett, dann Kohlenhydrate als Rest. Diese Zahlen sind Rechnerei auf
// der eigenen gemessenen Kalorienzahl und keine Regel über Anteile, und die Oberfläche
// sagt das auch.
//
// Ballaststoffe und Wasser zeigen eine Bezugslinie mit Quelle und Einschränkung und
// werden nie gegen das Training bewertet. Weiterhin keine Ziele für Mikronährstoffe
// und kein "du solltest X essen", bei dem nicht klar ist, woher X kommt.
//
// Alles nach dem Eiweiß ist überall freiwillig. Ein Log nur mit Eiweiß ist hier ein
// vollständiges Log: es beantwortet die Frage, mit der sich die Trainingsdaten wirklich
// vergleichen lassen, und ein Tag ohne Kohlenhydrate sagt das, statt so zu tun, als
// wäre die Zahl null.

import { THRESHOLDS } from './evidence.js';
import { t } from './i18n.js';
import { dayKey, linearFit } from './models.js';

/**
 * Tagesziel für Eiweiß als Bereich, aus dem Körpergewicht.
 *
 * Mit Absicht ein Bereich und keine Zahl: 1,6 g/kg ist der bekannte Knickpunkt, sein
 * eigenes Konfidenzintervall reicht bis 2,2, und neuere Arbeiten zweifeln, ob es den
 * Knickpunkt überhaupt gibt (SOURCES.protein2018). Eine einzelne Zahl zu drucken wäre
 * eine Genauigkeit, die die Literatur nicht hat.
 */
export function proteinTarget(settings) {
  const bw = Number(settings?.bodyweight) || 0;
  if (!bw) return null;
  // Die Standards rechnen in kg. Wer in Pfund einträgt, hat darunter trotzdem ein
  // Körpergewicht in kg, also umrechnen statt still mit der falschen Einheit zu werten.
  const kg = settings.units === 'lb' ? bw * 0.45359237 : bw;
  const { low, high } = THRESHOLDS.proteinPerKg;
  return {
    low: Math.round(kg * low),
    high: Math.round(kg * high),
    perKg: { low, high },
  };
}

/**
 * Alles, was die App über ein Lebensmittel festhalten kann, in der Reihenfolge wie auf
 * einem Etikett.
 *
 * Die `core`-Werte stehen direkt am Datensatz eines Lebensmittels oder einer Mahlzeit,
 * weil jeder Screen sie braucht. Der Rest steht in einem `micros`-Objekt, ein neuer
 * Nährstoff macht das Schema also nicht breiter. Die Einheiten kommen aus USDA FoodData
 * Central und werden hier nicht angenommen. Milligramm und Mikrogramm verwechselt man
 * leicht, und beide stehen neben einer Zahl.
 */
export const NUTRIENTS = [
  { key: 'kcal',        label: 'nutrient.kcal',             unit: 'kcal', core: true },
  { key: 'protein',     label: 'nutrient.protein',            unit: 'g',    core: true },
  { key: 'carbs',       label: 'nutrient.carbs',       unit: 'g',    core: true },
  { key: 'sugars',      label: 'nutrient.sugars',    unit: 'g',    sub: true },
  { key: 'fibre',       label: 'nutrient.fibre',              unit: 'g',    core: true },
  { key: 'fat',         label: 'nutrient.fat',                unit: 'g',    core: true },
  { key: 'satFat',      label: 'nutrient.satFat', unit: 'g',    sub: true },
  { key: 'sodium',      label: 'nutrient.sodium',             unit: 'mg' },
  { key: 'cholesterol', label: 'nutrient.cholesterol',        unit: 'mg' },
  { key: 'potassium',   label: 'nutrient.potassium',          unit: 'mg' },
  { key: 'calcium',     label: 'nutrient.calcium',            unit: 'mg' },
  { key: 'magnesium',   label: 'nutrient.magnesium',          unit: 'mg' },
  { key: 'iron',        label: 'nutrient.iron',               unit: 'mg' },
  { key: 'zinc',        label: 'nutrient.zinc',               unit: 'mg' },
  { key: 'vitaminC',    label: 'nutrient.vitaminC',          unit: 'mg' },
  { key: 'vitaminD',    label: 'nutrient.vitaminD',          unit: 'µg' },
  { key: 'vitaminB12',  label: 'nutrient.vitaminB12',        unit: 'µg' },
];

export const CORE_KEYS = NUTRIENTS.filter((n) => n.core).map((n) => n.key);

/** Ein Nährstoff eines Lebensmittels oder einer Mahlzeit, wo auch immer er steht. null heißt unbekannt. */
export function nutrientOf(record, key) {
  if (!record) return null;
  const value = CORE_KEYS.includes(key) ? record[key] : (record.micros || {})[key];
  return value === undefined || value === '' ? null : value;
}

/**
 * Summen für die Mahlzeiten eines Tages.
 *
 * Eiweiß und Kalorien sind immer da, Kohlenhydrate, Fett und Ballaststoffe nicht: ein
 * Lebensmittel von einem Etikett, auf dem nur Eiweiß steht, oder eins von vor diesen
 * Feldern hat dort null, und null ist nicht null Gramm. Es als null zu summieren würde
 * einen Tag umso ärmer an Kohlenhydraten aussehen lassen, je unvollständiger er
 * eingetragen ist, also genau das Gegenteil von nützlich. Jeder dieser Werte trägt
 * deshalb mit, wie viele Einträge nichts beitragen konnten, und die Oberfläche kann
 * "bei 2 von 6 Einträgen fehlen die Kohlenhydrate" sagen, statt eine Summe zu drucken,
 * die still weniger bedeutet, als sie aussieht.
 */
export function dayTotals(meals) {
  const out = {
    protein: 0, kcal: 0,
    carbs: 0, fat: 0, fibre: 0,
    missing: { carbs: 0, fat: 0, fibre: 0 },
    items: meals.length,
  };

  for (const m of meals) {
    out.protein += Number(m.protein) || 0;
    out.kcal += Number(m.kcal) || 0;
    for (const key of ['carbs', 'fat', 'fibre']) {
      const v = m[key];
      if (v === null || v === undefined) out.missing[key]++;
      else out[key] += Number(v) || 0;
    }
  }

  out.protein = Math.round(out.protein);
  out.kcal = Math.round(out.kcal);
  for (const key of ['carbs', 'fat', 'fibre']) out[key] = Math.round(out[key]);

  // Dieselbe Regel für alles: eine Summe plus die Zahl der Einträge ohne Beitrag, damit
  // "12 mg Eisen" nie still "12 mg aus den zwei Einträgen, die es wussten, von neun" heißt.
  out.all = {};
  for (const n of NUTRIENTS) {
    let sum = 0, missing = 0, known = 0;
    for (const m of meals) {
      const v = nutrientOf(m, n.key);
      if (v === null) missing++;
      else { sum += Number(v) || 0; known++; }
    }
    out.all[n.key] = {
      value: Math.round(sum * 10) / 10,
      missing,
      known,
      complete: meals.length > 0 && missing === 0,
    };
  }
  return out;
}

/**
 * Die Kalorien des Tages nach Herkunft aufgeteilt, für den Makro-Balken.
 *
 * Atwater-Faktoren: 4 kcal/g für Eiweiß und Kohlenhydrate, 9 für Fett. Gibt null
 * zurück, wenn zu viel fehlt, um ehrlich aufzuteilen. Ein Balken, dem ein Drittel des
 * Tages fehlt, ist ein Bild vom Eintragen und nicht vom Essen.
 */
export function energySplit(totals) {
  if (!totals.items) return null;
  if (totals.missing.carbs || totals.missing.fat) return null;

  const parts = {
    protein: totals.protein * 4,
    carbs: totals.carbs * 4,
    fat: totals.fat * 9,
  };
  const sum = parts.protein + parts.carbs + parts.fat;
  if (!sum) return null;

  return {
    kcal: parts,
    share: {
      protein: parts.protein / sum,
      carbs: parts.carbs / sum,
      fat: parts.fat / sum,
    },
    // Was die Makros ergeben, und das ist nicht immer, was auf dem Etikett stand.
    fromMacros: Math.round(sum),
  };
}

/**
 * Bezugswerte für Ballaststoffe und Wasser. Beides ist keine Trainingszahl, und beides sagt das auch.
 */
export function fibreTarget() {
  return THRESHOLDS.fibrePerDay.value;
}

export function waterTarget(settings) {
  const ml = THRESHOLDS.waterLitres[settings?.sex === 'female' ? 'female' : 'male'] * 1000;
  return Math.round(ml);
}

/** Wo das Eiweiß eines Tages im Zielbereich liegt. */
export function proteinVerdict(protein, target) {
  if (!target) return { state: 'unknown', text: t('verdict.noTarget') };
  // "128 g von 128 fehlen" stimmt zwar, sieht aber aus wie ein Fehler.
  if (!protein) return { state: 'under', text: t('verdict.target', { low: target.low, high: target.high }) };
  if (protein >= target.low && protein <= target.high) {
    return { state: 'hit', text: t('verdict.inRange', { low: target.low, high: target.high }) };
  }
  if (protein > target.high) {
    // Keine Warnung. Über dem Bereich ist kein Fehler, die obere Kante ist da, wo die
    // Belege aufhören, nicht wo Schaden anfängt.
    return { state: 'over', text: t('verdict.above', { high: target.high }) };
  }
  return { state: 'under', text: t('verdict.short', { gap: target.low - protein, low: target.low }) };
}

/**
 * Wie oft das Eiweiß über eine Reihe von Tagen getroffen wurde, und der Durchschnitt.
 *
 * Tage ohne Einträge fallen raus, statt als null zu zählen. Ein nicht eingetragener Tag
 * ist fehlende Information und kein Tag ohne Eiweiß, und Nullen mitzurechnen würde eine
 * gute Woche mit zwei vergessenen Tagen wie ein Scheitern aussehen lassen.
 */
export function proteinHistory(meals, days = 14, endTs = Date.now()) {
  const byDay = new Map();
  for (const m of meals) {
    if (!byDay.has(m.day)) byDay.set(m.day, []);
    byDay.get(m.day).push(m);
  }

  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endTs);
    d.setDate(d.getDate() - i);
    const key = dayKey(d.getTime());
    const dayMeals = byDay.get(key) || [];
    out.push({
      day: key,
      ts: d.getTime(),
      logged: dayMeals.length > 0,
      ...dayTotals(dayMeals),
    });
  }
  return out;
}


/**
 * Richtung des Körpergewichts über einen Zeitraum, in % pro Woche. Diese Zahl sagt
 * wirklich, ob man im Überschuss oder im Defizit ist.
 *
 * Als Rate und nicht als Summe, weil man es so beurteilt: etwa 0,25 bis 0,5 %
 * Körpergewicht pro Woche ist der übliche Bereich, um zu- oder abzunehmen, ohne mehr
 * Fett anzusetzen oder mehr Muskeln zu verlieren als gewollt. Der Bereich ist übliche
 * Trainingspraxis und keine Metaanalyse, und die Oberfläche sagt das.
 */
export function weightTrend(bodyweightLog, weeks = 4) {
  const since = Date.now() - weeks * 7 * 86400000;
  const points = (bodyweightLog || [])
    .filter((b) => b.date >= since)
    .sort((a, b) => a.date - b.date);
  if (points.length < 2) return null;

  const first = points[0], last = points[points.length - 1];
  const spanWeeks = Math.max(0.5, (last.date - first.date) / (7 * 86400000));
  const delta = last.weight - first.weight;

  return {
    delta,
    spanWeeks: Math.round(spanWeeks * 10) / 10,
    perWeek: delta / spanWeeks,
    pctPerWeek: first.weight ? (delta / spanWeeks / first.weight) * 100 : 0,
    from: first, to: last,
  };
}

/**
 * Wartungskalorien, gemessen statt vorhergesagt.
 *
 * Jede App, die diese Zahl zeigt, rechnet sie mit einer Formel aus: Mifflin-St Jeor und
 * ein Aktivitätsfaktor aus einer Liste. Das ist ein Bevölkerungsdurchschnitt, der sich
 * als persönliche Zahl verkleidet, und der Aktivitätsfaktor ist eine Schätzung über das
 * eigene Leben, die man abgeben soll, bevor es irgendwelche Daten gibt.
 *
 * Hier läuft es andersherum, aus zwei Dingen, die wirklich gemessen wurden: was man
 * eingetragen hat und was die Waage gemacht hat. Lag das Essen im Schnitt bei 2.600 kcal
 * und man hat 0,2 kg pro Woche zugenommen, lag der Bedarf bei etwa 2.380. Die Rechnung
 * ist einfach, die Ehrlichkeit steckt darin, sie bei dünnen Daten nicht zu machen. Sie
 * gibt null zurück, solange der Zeitraum nicht wirklich eingetragen ist und sich die
 * Waage darin nicht wirklich bewegt hat.
 *
 * Was sie nicht ausgleichen kann: zu wenig Eingetragenes, und das ist in jeder
 * Validierungsstudie systematisch und groß. Wer 80 % von dem einträgt, was er isst,
 * bekommt hier 20 % zu wenig. Besser als eine Formel ist es trotzdem, weil es
 * wenigstens am eigenen Gewicht hängt.
 */
export function maintenanceEstimate(meals, bodyweightLog, { days = 28, endTs = Date.now() } = {}) {
  const history = proteinHistory(meals, days, endTs);
  const withCalories = history.filter((d) => d.logged && d.kcal > 0);

  // Zwei getrennte Hürden: genug Tage für einen Durchschnitt, und genug vom Zeitraum,
  // damit man dem Durchschnitt als "was du isst" traut und nicht als "woran du gedacht hast".
  const MIN_DAYS = 14;
  const MIN_SHARE = 0.6;
  if (withCalories.length < MIN_DAYS || withCalories.length / days < MIN_SHARE) {
    return { ok: false, reason: 'days', logged: withCalories.length, needed: MIN_DAYS, days };
  }

  const since = endTs - days * 86400000;
  const points = (bodyweightLog || [])
    .filter((b) => b.date >= since && b.date <= endTs)
    .sort((a, b) => a.date - b.date);
  if (points.length < 2) return { ok: false, reason: 'weight', logged: points.length };

  const spanDays = (points[points.length - 1].date - points[0].date) / 86400000;
  if (spanDays < MIN_DAYS) return { ok: false, reason: 'span', spanDays: Math.round(spanDays) };

  // Eine Gerade durch alle statt erster gegen letzter Wert: zwei Wiegungen können sich
  // um ein Kilo Wasser und Darminhalt unterscheiden, eine Linie durch alle springt viel weniger.
  const fit = linearFit(points.map((b) => [(b.date - points[0].date) / 86400000, b.weight]));
  if (!fit) return { ok: false, reason: 'weight', logged: points.length };

  const kgPerDay = fit.slope;
  const meanIntake = withCalories.reduce((n, d) => n + d.kcal, 0) / withCalories.length;
  const fromWeight = kgPerDay * THRESHOLDS.kcalPerKg.value;

  return {
    ok: true,
    maintenance: Math.round(meanIntake - fromWeight),
    meanIntake: Math.round(meanIntake),
    kgPerWeek: Math.round(kgPerDay * 7 * 100) / 100,
    loggedDays: withCalories.length,
    windowDays: days,
    spanDays: Math.round(spanDays),
  };
}

/**
 * Tagesziele für alles, abgeleitet in der Reihenfolge, die sie wirklich bestimmt.
 *
 * Ein belegtes Verhältnis der Makros gibt es nicht. "40/30/30" ist Folklore mit Komma,
 * und eine App, die so etwas ausgibt, erfindet Genauigkeit. Eine belegte Reihenfolge
 * gibt es aber, und die nimmt jeder vernünftige Trainer:
 *
 *   1. Die Energie bestimmt die Richtung: zunehmen, halten oder abnehmen.
 *   2. Eiweiß hat seinen eigenen Bereich, aus dem Körpergewicht, unabhängig vom Rest.
 *   3. Für Fett gibt es eine Untergrenze, die man ernst nehmen sollte: unter etwa 20 %
 *      der Energie geht es an essenzielle Fettsäuren und fettlösliche Vitamine.
 *   4. Kohlenhydrate sind der Rest. Kein eigenes Ziel, sondern das, was übrig bleibt,
 *      und genau das sind sie in der Praxis auch.
 *
 * Die Zahlen für Kohlenhydrate und Fett sind hier also Rechnerei auf dem eigenen
 * Kalorienziel und kein Verhältnis aus der Luft. Innerhalb des Fettbereichs
 * unterscheidet sich kein Punkt vom anderen, und die Oberfläche sagt das, statt die
 * Mitte besonders wirken zu lassen.
 *
 * Gibt null zurück, wenn sich das Kalorienziel nicht bestimmen lässt. Das betrifft
 * den größten Teil der Kette, weil sie auf der gemessenen Schätzung des Bedarfs aufbaut.
 */
export function macroTargets(settings, maintenance) {
  const protein = proteinTarget(settings);
  if (!maintenance || !maintenance.ok) {
    return { ok: false, reason: 'maintenance', protein };
  }
  // Die Kette ist Kalorien, dann Eiweiß, dann die Untergrenze für Fett, dann
  // Kohlenhydrate als Rest. Ohne Eiweißbereich gibt es keinen Rest, und die Zahl für
  // Kohlenhydrate würde still den ganzen Anteil vom Eiweiß übernehmen. Beides kann
  // auseinanderlaufen, weil der Bedarf aus dem Wiegelog und der Bereich aus dem Profil
  // kommt. Nur das Profilformular schreibt beides.
  if (!protein) {
    return { ok: false, reason: 'bodyweight', protein: null };
  }

  const bw = Number(settings?.bodyweight) || 0;
  const kg = settings?.units === 'lb' ? bw * 0.45359237 : bw;
  const goal = ['gain', 'lose'].includes(settings?.goal) ? settings.goal : 'hold';

  // Die Rate ist ein Anteil vom Körpergewicht pro Woche und wird über dieselben
  // 7.700 kcal/kg, die die Schätzung des Bedarfs nimmt, in einen Tagesabstand umgerechnet.
  const { low, high } = THRESHOLDS.weeklyChangePct;
  const rate = goal === 'hold' ? 0 : (low + high) / 2;
  const perDay = (kg * rate * THRESHOLDS.kcalPerKg.value) / 7;
  const kcal = Math.round(maintenance.maintenance + (goal === 'gain' ? perDay : goal === 'lose' ? -perDay : 0));

  const fat = {
    low: Math.round((kcal * THRESHOLDS.fatShare.low) / 9),
    high: Math.round((kcal * THRESHOLDS.fatShare.high) / 9),
  };

  // Kohlenhydrate sind der Rest, der Bereich läuft also andersherum: die meisten
  // Kohlenhydrate, wenn das Fett an der Untergrenze liegt. Beim Eiweiß wird die Mitte
  // genommen, weil ein Bereich auf beiden Seiten ein Fenster ergäbe, mit dem man nichts anfangen kann.
  const proteinKcal = protein ? ((protein.low + protein.high) / 2) * 4 : 0;
  const carbs = {
    low: Math.max(0, Math.round((kcal - proteinKcal - fat.high * 9) / 4)),
    high: Math.max(0, Math.round((kcal - proteinKcal - fat.low * 9) / 4)),
  };

  return {
    ok: true,
    goal,
    kcal,
    maintenance: maintenance.maintenance,
    offset: kcal - maintenance.maintenance,
    kgPerWeek: goal === 'hold' ? 0 : Math.round(kg * rate * (goal === 'lose' ? -1 : 1) * 100) / 100,
    protein,
    fat,
    carbs,
  };
}

export const GOALS = [
  { key: 'lose', label: 'goal.lose', blurb: 'goal.loseBlurb' },
  { key: 'hold', label: 'goal.hold', blurb: 'goal.holdBlurb' },
  { key: 'gain', label: 'goal.gain', blurb: 'goal.gainBlurb' },
];

/** Die Gewichtsentwicklung in Worten, gemessen an dem, was man vorhat. */
export function trendVerdict(trend) {
  if (!trend) return { state: 'unknown', text: t('verdict.noTrend') };
  const pct = trend.pctPerWeek;
  const rate = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% a week`;

  if (Math.abs(pct) < 0.1) return { state: 'flat', text: t('verdict.steady', { rate }) };
  if (pct > 0) {
    return pct <= 0.5
      ? { state: 'gain', text: t('verdict.gainOk', { rate }) }
      : { state: 'fast', text: t('verdict.gainFast', { rate }) };
  }
  return pct >= -0.5
    ? { state: 'cut', text: t('verdict.loseOk', { rate }) }
    : { state: 'fast', text: t('verdict.loseFast', { rate }) };
}
