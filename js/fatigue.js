// Are things still moving?
//
// This is the app's closest thing to a deload feature, and it deliberately
// stops short of being one. There is no good evidence for a scheduled deload:
// the practice is near-universal in training culture and thin in the
// literature, with no trial establishing when one is due, how long it should
// last, or that taking one beats simply carrying on. Inventing "week 7, drop to
// 60%" would be exactly the invented precision this app refuses everywhere else.
//
// So it reports, and does not prescribe. Every line it produces is a fact about
// the user's own log: how many of their tracked lifts have stopped climbing,
// what their volume has done, and whether the sets have been getting harder.
// What to do about that is a training decision, and it stays with the person
// doing the training.

import { t } from './i18n.js';
import { fmtDecimal } from './ui.js';
import { movers } from './history.js';
import { analyseWeek } from './log-analysis.js';
import { startOfWeek } from './models.js';
import { FLAT_BAND } from './region-progress.js';

const WEEK = 7 * 86400000;

/** How many lifts must have a usable trend before any of this means anything. */
const MIN_TRACKED = 3;

/**
 * @returns null when there is not enough history to say anything, else
 *   { tracked, stalled, falling, names, sets: {recent, earlier},
 *     rir: {recent, earlier, sets} | null, weeks }
 */
export function stallReport(sessions, exerciseById, { weeks = 6, now = Date.now() } = {}) {
  const lifts = movers(sessions, exerciseById, { sinceWeeks: weeks, now })
    // Percent per week, so a 2 kg/week climb on a 40 kg lift is not called the
    // same thing as 2 kg/week on a 140 kg one.
    .map((m) => ({ ...m, pctPerWeek: m.first > 0 ? (m.perWeek / m.first) * 100 : 0 }));

  if (lifts.length < MIN_TRACKED) return null;

  const stalledLifts = lifts.filter((m) => m.pctPerWeek <= FLAT_BAND);
  const falling = lifts.filter((m) => m.pctPerWeek < -FLAT_BAND).length;

  return {
    weeks,
    tracked: lifts.length,
    stalled: stalledLifts.length,
    falling,
    // Worst first — if the list is trimmed, keep the ones that moved least.
    names: stalledLifts.sort((a, b) => a.pctPerWeek - b.pctPerWeek).map((m) => m.ex.name),
    sets: setsTrend(sessions, exerciseById, now),
    rir: rirTrend(sessions, exerciseById, now),
  };
}

/** Working sets in the last three weeks against the three before them. */
function setsTrend(sessions, exerciseById, at = Date.now()) {
  const now = startOfWeek(at);
  const sum = (fromWeeksAgo, toWeeksAgo) => {
    let total = 0;
    for (let i = fromWeeksAgo; i > toWeeksAgo; i--) {
      const start = weekAgo(now, i);
      total += analyseWeek(sessions, exerciseById, start).totalSets;
    }
    return total;
  };
  return { recent: sum(3, 0), earlier: sum(6, 3) };
}

/**
 * Mean reps in reserve, recent against earlier.
 *
 * Only reported when both halves have enough rated sets to compare — a mean over
 * two logged sets is noise, and this whole module exists to avoid presenting
 * noise as a signal.
 */
function rirTrend(sessions, exerciseById, at = Date.now()) {
  const now = startOfWeek(at);
  const gather = (fromWeeksAgo, toWeeksAgo) => {
    let sum = 0, n = 0;
    for (let i = fromWeeksAgo; i > toWeeksAgo; i--) {
      const week = analyseWeek(sessions, exerciseById, weekAgo(now, i));
      if (week.effort.mean !== null) { sum += week.effort.mean * week.effort.logged; n += week.effort.logged; }
    }
    return n ? { mean: sum / n, sets: n } : null;
  };

  const recent = gather(3, 0);
  const earlier = gather(6, 3);
  if (!recent || !earlier || recent.sets < 6 || earlier.sets < 6) return null;
  return { recent: recent.mean, earlier: earlier.mean, sets: recent.sets + earlier.sets };
}

function weekAgo(from, n) {
  const d = new Date(from);
  d.setDate(d.getDate() - n * 7);
  return startOfWeek(d.getTime());
}

/**
 * The report as sentences. Facts only — no recommendation, and no adjective
 * that implies one ("too much", "overreached", "time to").
 */
export function describeStall(report) {
  if (!report) return [];
  const lines = [];

  const { tracked, stalled, falling, names, sets, rir, weeks } = report;
  if (stalled === 0) {
    lines.push(t('fatigue.allClimbing', { tracked, weeks }));
  } else {
    const list = names.slice(0, 3).join(', ')
      + (names.length > 3 ? t('planRating.andMore', { n: names.length - 3 }) : '');
    lines.push(t(falling ? 'fatigue.stalledFalling' : 'fatigue.stalled', {
      stalled, tracked, weeks, falling, list,
    }));
  }

  if (sets.earlier) {
    const change = Math.round(((sets.recent - sets.earlier) / sets.earlier) * 100);
    lines.push(Math.abs(change) < 8
      ? t('fatigue.setsSteady', { recent: sets.recent, earlier: sets.earlier })
      : t(change > 0 ? 'fatigue.setsUp' : 'fatigue.setsDown', {
          pct: Math.abs(change), recent: sets.recent, earlier: sets.earlier,
        }));
  }

  if (rir) {
    const delta = rir.recent - rir.earlier;
    lines.push(Math.abs(delta) < 0.3
      ? t('fatigue.effortSame', { rir: fmtDecimal(rir.recent) })
      : t(delta < 0 ? 'fatigue.effortCloser' : 'fatigue.effortFurther', {
          earlier: fmtDecimal(rir.earlier), recent: fmtDecimal(rir.recent),
        }));
  }

  return lines;
}
