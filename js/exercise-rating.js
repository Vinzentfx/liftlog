// Exercise quality rating.
//
// IMPORTANT — what this is and is not.
//
// There is no authoritative dataset ranking exercises for hypertrophy. EMG
// studies are widely used for this and are a poor proxy for growth. So this is
// NOT a research result: it is a transparent scoring of properties that are
// actually recorded in the data, with every point shown to the user.
//
// A movement scores well here when it loads a lot of muscle through a long range
// with room to progress. That is a defensible heuristic, not a measurement, and
// the UI labels it as such.

import { isBenchmark } from './standards.js';

/** Free weights demand stabilisation and allow finer loading than fixed paths. */
const EQUIPMENT_POINTS = {
  Barbell: 2,
  Dumbbell: 2,
  Bodyweight: 1.5,
  Cable: 1.5,
  Kettlebell: 1.5,
  Machine: 1,
  Bands: 0.5,
  Other: 0.5,
};

/**
 * @returns {{stars:number, score:number, reasons:string[], caveats:string[]}}
 *   stars is 1–5 in half steps.
 */
export function rateExercise(ex) {
  if (!ex) return null;

  const reasons = [];
  const caveats = [];
  let score = 0;

  // --- compound vs isolation (max 2) ---
  const regions = (ex.primary || []).length + (ex.secondary || []).length;
  if (ex.mech === 'compound' || regions >= 4) {
    score += 2;
    reasons.push('Compound movement — loads several muscles at once');
  } else if (regions >= 2) {
    score += 1;
    reasons.push('Works more than one muscle group');
  } else {
    reasons.push('Isolation movement — one muscle group');
    caveats.push('Isolation work is a supplement, not the base of a plan');
  }

  // --- equipment (max 2) ---
  const eqPoints = EQUIPMENT_POINTS[ex.equipment] ?? 1;
  score += eqPoints;
  if (eqPoints >= 2) reasons.push('Free weight — you control the path and can load precisely');
  else if (eqPoints >= 1.5) reasons.push('Constant tension / scalable load');
  else if (ex.equipment === 'Machine') {
    reasons.push('Machine — stable and easy to learn');
    caveats.push('Loads differ between machine brands, so numbers travel badly');
  } else {
    caveats.push('Band tension is hard to quantify, so progress is hard to track');
  }

  // --- measurable progression (max 1) ---
  if (isBenchmark(ex.name)) {
    score += 1;
    reasons.push('Has published strength standards — your rating can be scored on it');
  }

  // --- muscle breadth (max 1) ---
  if (regions >= 5) {
    score += 1;
    reasons.push(`Trains ${regions} muscle regions`);
  } else if (regions >= 3) {
    score += 0.5;
  }

  // --- coaching material (max 0.5) ---
  if ((ex.instructions || []).length >= 3) score += 0.5;
  else caveats.push('No written technique steps for this one');

  // 0–6.5 raw -> 1–5 stars, rounded to the nearest half
  const stars = Math.max(1, Math.min(5, Math.round((1 + (score / 6.5) * 4) * 2) / 2));
  return { stars, score, reasons, caveats };
}

/** '★★★★☆' style string, halves shown as ½. */
export function starString(stars) {
  const full = Math.floor(stars);
  const half = stars - full >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
}
