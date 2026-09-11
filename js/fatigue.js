// Geht es noch voran?
//
// Das ist das, was in der App einer Deload-Funktion am nächsten kommt, und es
// hört bewusst davor auf. Für eine eingeplante Deload-Woche gibt es keine guten
// Belege: im Training macht das fast jeder, in der Forschung ist es dünn, und
// keine Studie sagt, wann eine fällig ist, wie lange sie dauern soll oder ob sie
// besser ist als einfach weiterzumachen. "Woche 7, runter auf 60 %" zu erfinden
// wäre genau die ausgedachte Genauigkeit, die die App sonst überall ablehnt.
//
// Es wird also berichtet und nichts vorgeschrieben. Jede Zeile ist eine Tatsache
// aus dem eigenen Log: wie viele der verfolgten Übungen nicht mehr steigen, was
// das Volumen gemacht hat und ob die Sätze schwerer geworden sind. Was man daraus
// macht, ist eine Trainingsentscheidung, und die trifft, wer trainiert.

import { t } from './i18n.js';
import { fmtDecimal } from './ui.js';
import { movers } from './history.js';
import { analyseWeek } from './log-analysis.js';
import { startOfWeek } from './models.js';
import { FLAT_BAND } from './region-progress.js';

const WEEK = 7 * 86400000;

/** Wie viele Übungen einen brauchbaren Verlauf haben müssen, bevor das hier etwas bedeutet. */
const MIN_TRACKED = 3;

/**
 * @returns null, wenn es zu wenig Verlauf gibt, sonst
 *   { tracked, stalled, falling, names, sets: {recent, earlier},
 *     rir: {recent, earlier, sets} | null, weeks }
 */
export function stallReport(sessions, exerciseById, { weeks = 6, now = Date.now() } = {}) {
  const lifts = movers(sessions, exerciseById, { sinceWeeks: weeks, now })
    // Prozent pro Woche, damit +2 kg pro Woche bei 40 kg nicht dasselbe heißt wie
    // +2 kg pro Woche bei 140 kg.
    .map((m) => ({ ...m, pctPerWeek: m.first > 0 ? (m.perWeek / m.first) * 100 : 0 }));

  if (lifts.length < MIN_TRACKED) return null;

  const stalledLifts = lifts.filter((m) => m.pctPerWeek <= FLAT_BAND);
  const falling = lifts.filter((m) => m.pctPerWeek < -FLAT_BAND).length;

  return {
    weeks,
    tracked: lifts.length,
    stalled: stalledLifts.length,
    falling,
    // Die schlechtesten zuerst. Wird die Liste gekürzt, bleiben die, die sich am wenigsten bewegt haben.
    names: stalledLifts.sort((a, b) => a.pctPerWeek - b.pctPerWeek).map((m) => m.ex.name),
    sets: setsTrend(sessions, exerciseById, now),
    rir: rirTrend(sessions, exerciseById, now),
  };
}

/** Arbeitssätze der letzten drei Wochen gegen die drei davor. */
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
 * Durchschnittliche Wiederholungen in Reserve, neuere gegen ältere.
 *
 * Nur, wenn beide Hälften genug bewertete Sätze zum Vergleichen haben. Ein
 * Mittelwert über zwei Sätze ist Rauschen, und dieses Modul gibt es gerade, um
 * Rauschen nicht als Signal zu verkaufen.
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
 * Der Bericht als Sätze. Nur Tatsachen, keine Empfehlung und kein Adjektiv, das
 * eine nahelegt ("zu viel", "übertrieben", "Zeit für").
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
