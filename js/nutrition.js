// Daily targets and totals.
//
// Scope note, because this is the part that usually metastasises. Protein and
// calories are the two that carry a claim: protein is the one intake variable
// with a defensible hypertrophy number attached, and calories decide whether
// you gain or lose. Carbs, fat, fibre and water were added later and are held
// to a different standard — they are *recorded*, and the app makes no training
// claim about any of them. Fibre and water show a reference line with a source
// and a caveat; carbs and fat are only ever shown as the split of a day's
// energy, never as a target, because no macro ratio has an evidence base worth
// printing.
//
// Still no micronutrients, and still no "you should eat X".
//
// Everything past protein is optional throughout. A protein-only log is a
// complete log here — it answers the question the training data can actually be
// compared against, and a day with no carbs recorded says so rather than
// pretending the number is zero.

import { THRESHOLDS } from './evidence.js';
import { dayKey, linearFit } from './models.js';

/**
 * Daily protein target as a range, from bodyweight.
 *
 * A range rather than a number on purpose: 1.6 g/kg is the headline breakpoint,
 * its own confidence interval reaches 2.2, and later work argues the breakpoint
 * may not exist at all (SOURCES.protein2018). Printing a single number would be
 * inventing a precision the literature does not have.
 */
export function proteinTarget(settings) {
  const bw = Number(settings?.bodyweight) || 0;
  if (!bw) return null;
  // The standards are kg-based; a pound-entering user still has a kg bodyweight
  // underneath, so convert rather than silently scoring against the wrong unit.
  const kg = settings.units === 'lb' ? bw * 0.45359237 : bw;
  const { low, high } = THRESHOLDS.proteinPerKg;
  return {
    low: Math.round(kg * low),
    high: Math.round(kg * high),
    perKg: { low, high },
  };
}

/**
 * Everything the app can hold about a food, in the order it reads on a label.
 *
 * `core` values live directly on a food or meal record because every screen
 * touches them; the rest live in a `micros` object, so adding a nutrient never
 * widens the record schema. Units come from USDA FoodData Central rather than
 * being assumed here — milligrams and micrograms are easy to confuse and both
 * get printed next to a number.
 */
export const NUTRIENTS = [
  { key: 'kcal',        label: 'Energy',             unit: 'kcal', core: true },
  { key: 'protein',     label: 'Protein',            unit: 'g',    core: true },
  { key: 'carbs',       label: 'Carbohydrate',       unit: 'g',    core: true },
  { key: 'sugars',      label: 'of which sugars',    unit: 'g',    sub: true },
  { key: 'fibre',       label: 'Fibre',              unit: 'g',    core: true },
  { key: 'fat',         label: 'Fat',                unit: 'g',    core: true },
  { key: 'satFat',      label: 'of which saturates', unit: 'g',    sub: true },
  { key: 'sodium',      label: 'Sodium',             unit: 'mg' },
  { key: 'cholesterol', label: 'Cholesterol',        unit: 'mg' },
  { key: 'potassium',   label: 'Potassium',          unit: 'mg' },
  { key: 'calcium',     label: 'Calcium',            unit: 'mg' },
  { key: 'magnesium',   label: 'Magnesium',          unit: 'mg' },
  { key: 'iron',        label: 'Iron',               unit: 'mg' },
  { key: 'zinc',        label: 'Zinc',               unit: 'mg' },
  { key: 'vitaminC',    label: 'Vitamin C',          unit: 'mg' },
  { key: 'vitaminD',    label: 'Vitamin D',          unit: 'µg' },
  { key: 'vitaminB12',  label: 'Vitamin B12',        unit: 'µg' },
];

export const CORE_KEYS = NUTRIENTS.filter((n) => n.core).map((n) => n.key);

/** One nutrient off a food or meal, wherever it is stored. null means unknown. */
export function nutrientOf(record, key) {
  if (!record) return null;
  const value = CORE_KEYS.includes(key) ? record[key] : (record.micros || {})[key];
  return value === undefined || value === '' ? null : value;
}

/**
 * Totals for one day's meals.
 *
 * Protein and calories are always present. Carbs, fat and fibre are not: a food
 * typed off a label that only lists protein, or added before those fields
 * existed, has null there — and null is not zero. Summing it as zero would make
 * a day look lower in carbs the more incompletely it was logged, which is the
 * exact opposite of useful. So each of those carries a count of how many items
 * had nothing to contribute, and the UI can say "of 6 items, 2 have no carbs
 * recorded" instead of printing a total that quietly means less than it looks.
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

  // Same rule, applied to everything: a total plus a count of the items that had
  // nothing to contribute, so "12 mg iron" can never quietly mean "12 mg from
  // the two items that happened to know, out of nine".
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
 * The day's calories split by where they came from, for the macro bar.
 *
 * Atwater factors: 4 kcal/g for protein and carbohydrate, 9 for fat. Returns
 * null when too much is unrecorded to draw an honest split — a bar with a third
 * of the day missing is a picture of the logging, not of the eating.
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
    // What the macros add up to, which is not always what the label said.
    fromMacros: Math.round(sum),
  };
}

/**
 * Fibre and water references. Neither is a training number, and both say so.
 */
export function fibreTarget() {
  return THRESHOLDS.fibrePerDay.value;
}

export function waterTarget(settings) {
  const ml = THRESHOLDS.waterLitres[settings?.sex === 'female' ? 'female' : 'male'] * 1000;
  return Math.round(ml);
}

/** Where a day's protein sits against the target band. */
export function proteinVerdict(protein, target) {
  if (!target) return { state: 'unknown', text: 'Add your bodyweight to get a protein target' };
  // "128 g short of 128" is technically true and reads like a bug.
  if (!protein) return { state: 'under', text: `Target ${target.low}–${target.high} g` };
  if (protein >= target.low && protein <= target.high) {
    return { state: 'hit', text: `In range (${target.low}–${target.high} g)` };
  }
  if (protein > target.high) {
    // Not a warning. Above the band is not a mistake — the band's upper edge is
    // where the evidence stops, not where harm starts.
    return { state: 'over', text: `Above the ${target.high} g band — no evidence that is a problem` };
  }
  return { state: 'under', text: `${target.low - protein} g short of ${target.low}` };
}

/**
 * Protein hit rate over a window of days, and the average.
 *
 * Days with nothing logged are excluded rather than counted as zero — an
 * unlogged day is missing data, not a day you ate no protein, and averaging in
 * zeroes would make a week of good eating with two forgotten days look like a
 * failure.
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

export function proteinSummary(history, target) {
  const logged = history.filter((d) => d.logged);
  if (!logged.length) return { logged: 0, days: history.length, mean: null, hitRate: null };
  const mean = logged.reduce((n, d) => n + d.protein, 0) / logged.length;
  const hit = target ? logged.filter((d) => d.protein >= target.low).length : 0;
  return {
    logged: logged.length,
    days: history.length,
    mean: Math.round(mean),
    hitRate: target ? hit / logged.length : null,
  };
}

/**
 * Bodyweight direction over a window, as %/week — the number that actually says
 * whether you are in a surplus or a deficit.
 *
 * Reported as a rate rather than a total because that is how it is judged:
 * roughly 0.25–0.5% of bodyweight per week is the usual range for gaining or
 * losing without carrying more fat or losing more muscle than you meant to.
 * That range is training-practice convention, not a meta-analysis, and the UI
 * says so.
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
 * Maintenance calories, measured rather than predicted.
 *
 * Every app that shows this number computes it from a formula — Mifflin-St Jeor
 * and an activity multiplier picked off a dropdown. That is a population
 * average dressed up as a personal figure, and the activity multiplier is a
 * guess about your own life that you are asked to make before you have any data.
 *
 * This does it the other way round, from two things actually measured: what you
 * logged, and what the scale did. If intake averaged 2,600 kcal while you gained
 * 0.2 kg a week, maintenance was about 2,380. The arithmetic is simple; the
 * honesty is in refusing to run it on thin data, so it returns null unless the
 * window is genuinely logged and the scale genuinely moved across it.
 *
 * What it cannot correct for: under-logging, which is systematic and large in
 * every validation study going. If you log 80% of what you eat, this reads 20%
 * low — and it will still be a better guide than a formula, because it is at
 * least anchored to your own weight.
 */
export function maintenanceEstimate(meals, bodyweightLog, { days = 28, endTs = Date.now() } = {}) {
  const history = proteinHistory(meals, days, endTs);
  const withCalories = history.filter((d) => d.logged && d.kcal > 0);

  // Two separate bars: enough days to average, and enough of the window to
  // trust that average as "what you eat" rather than "what you remembered".
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

  // Fitted rather than first-to-last: two weigh-ins can differ by a kilo of
  // water and gut content, and a line through all of them is far less jumpy.
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

/** Plain-language read on the weight trend, given what the user is trying to do. */
export function trendVerdict(trend) {
  if (!trend) return { state: 'unknown', text: 'Log your bodyweight twice to see a direction' };
  const pct = trend.pctPerWeek;
  const rate = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% a week`;

  if (Math.abs(pct) < 0.1) return { state: 'flat', text: `Holding steady (${rate})` };
  if (pct > 0) {
    return pct <= 0.5
      ? { state: 'gain', text: `Gaining at ${rate} — the usual range for adding size` }
      : { state: 'fast', text: `Gaining at ${rate} — faster than most people want to add` };
  }
  return pct >= -0.5
    ? { state: 'cut', text: `Losing at ${rate} — the usual range for keeping muscle` }
    : { state: 'fast', text: `Losing at ${rate} — fast enough to cost you strength` };
}
