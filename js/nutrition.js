// Daily targets and totals.
//
// Scope note, because this is the part that usually metastasises: this module
// knows about protein and calories and nothing else. No micronutrients, no
// macro splits, no "you should eat X". Protein is the one intake variable with
// a defensible hypertrophy number attached; calories decide whether you gain or
// lose. Everything else a food tracker usually shows would be numbers for their
// own sake.
//
// Calories are optional throughout. A protein-only log is a complete log here —
// it answers the question the training data can actually be compared against.

import { THRESHOLDS } from './evidence.js';
import { dayKey, startOfWeek } from './models.js';

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

/** Totals for one day's meals. */
export function dayTotals(meals) {
  let protein = 0, kcal = 0;
  for (const m of meals) {
    protein += Number(m.protein) || 0;
    kcal += Number(m.kcal) || 0;
  }
  return { protein: Math.round(protein), kcal: Math.round(kcal), items: meals.length };
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

/** Meals for one week, for the Home comparison. */
export function weekMeals(meals, weekStart = startOfWeek(Date.now())) {
  const end = weekStart + 7 * 86400000;
  return meals.filter((m) => m.at >= weekStart && m.at < end);
}
