// Daily targets and totals.
//
// Scope note, because this is the part that usually metastasises. Protein and
// calories are the two that carry a claim of their own: protein has a
// defensible hypertrophy number, and calories decide whether you gain or lose.
//
// Carbs and fat do get targets now (macroTargets below), and it is worth being
// precise about why that is not a contradiction. There is no evidence-based
// macro *ratio* — "40/30/30" is folklore with a decimal point, and this file
// will not print one. What there is, is an evidence-based *order*: calories,
// then protein, then a fat floor, then carbohydrate as the remainder. Those
// numbers are arithmetic on the user's own measured calorie figure, not a rule
// about proportions, and the UI says so.
//
// Fibre and water show a reference line with a source and a caveat, and are
// never scored against training. Still no micronutrient targets, and still no
// "you should eat X" that cannot name where X came from.
//
// Everything past protein is optional throughout. A protein-only log is a
// complete log here — it answers the question the training data can actually be
// compared against, and a day with no carbs recorded says so rather than
// pretending the number is zero.

import { THRESHOLDS } from './evidence.js';
import { t } from './i18n.js';
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
  if (!target) return { state: 'unknown', text: t('verdict.noTarget') };
  // "128 g short of 128" is technically true and reads like a bug.
  if (!protein) return { state: 'under', text: t('verdict.target', { low: target.low, high: target.high }) };
  if (protein >= target.low && protein <= target.high) {
    return { state: 'hit', text: t('verdict.inRange', { low: target.low, high: target.high }) };
  }
  if (protein > target.high) {
    // Not a warning. Above the band is not a mistake — the band's upper edge is
    // where the evidence stops, not where harm starts.
    return { state: 'over', text: t('verdict.above', { high: target.high }) };
  }
  return { state: 'under', text: t('verdict.short', { gap: target.low - protein, low: target.low }) };
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

/**
 * Daily targets for everything, derived in the order that actually decides them.
 *
 * There is no evidence-based macro *ratio*. "40/30/30" is folklore with a
 * decimal point, and an app that hands one out is inventing precision. But
 * there is an evidence-based *order*, and it is the one any competent coach
 * uses:
 *
 *   1. Energy decides the direction — gaining, holding or losing.
 *   2. Protein has its own band, from bodyweight, independent of the rest.
 *   3. Fat has a floor worth respecting: below about 20% of energy you are
 *      cutting into essential fatty acids and fat-soluble vitamins.
 *   4. Carbohydrate is what is left. Not a target in its own right — the
 *      remainder, which is exactly what it is in practice.
 *
 * So the carb and fat numbers here are arithmetic on the user's own calorie
 * target, not a ratio pulled out of the air. Inside the fat range nothing
 * distinguishes one point from another, and the UI says that rather than
 * pretending the midpoint is special.
 *
 * Returns null when the calorie target cannot be known — which is most of the
 * chain, because it rests on the measured maintenance estimate.
 */
export function macroTargets(settings, maintenance) {
  const protein = proteinTarget(settings);
  if (!maintenance || !maintenance.ok) {
    return { ok: false, reason: 'maintenance', protein };
  }
  // The chain is calories, then protein, then a fat floor, then carbs as the
  // remainder. Without a protein band there is no remainder to take, and the
  // carb figure would quietly hand protein's whole share to carbohydrate. The
  // two can disagree because maintenance comes from the weigh-in log and the
  // band comes from the profile setting; only the profile form writes both.
  if (!protein) {
    return { ok: false, reason: 'bodyweight', protein: null };
  }

  const bw = Number(settings?.bodyweight) || 0;
  const kg = settings?.units === 'lb' ? bw * 0.45359237 : bw;
  const goal = ['gain', 'lose'].includes(settings?.goal) ? settings.goal : 'hold';

  // The rate is a share of bodyweight per week, converted to a daily energy
  // offset through the same 7,700 kcal/kg the maintenance estimate uses.
  const { low, high } = THRESHOLDS.weeklyChangePct;
  const rate = goal === 'hold' ? 0 : (low + high) / 2;
  const perDay = (kg * rate * THRESHOLDS.kcalPerKg.value) / 7;
  const kcal = Math.round(maintenance.maintenance + (goal === 'gain' ? perDay : goal === 'lose' ? -perDay : 0));

  const fat = {
    low: Math.round((kcal * THRESHOLDS.fatShare.low) / 9),
    high: Math.round((kcal * THRESHOLDS.fatShare.high) / 9),
  };

  // Carbs are the remainder, so the range runs the other way: most carbs when
  // fat sits at its floor. Protein's midpoint is used, because a range on both
  // sides would produce a carb window too wide to act on.
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

/** Plain-language read on the weight trend, given what the user is trying to do. */
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
