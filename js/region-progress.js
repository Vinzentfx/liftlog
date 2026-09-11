// Fortschritt je Muskel, aus den eigenen Zahlen.
//
// Das gibt es wegen einer Frage, die die Stärkebewertung nicht beantworten kann:
// was, wenn man an Maschinen trainiert?
//
// Die Stufen vergleichen mit veröffentlichten Standards, und die gibt es nur für
// etwa siebzehn Langhantel- und Körpergewichtsübungen. Für eine Brustpresse an der
// Maschine gibt es keinen, und es kann auch keinen brauchbaren geben: "100 kg" an
// einem Hersteller sind keine 100 kg am nächsten, weil Hebelarme, Schlittengewicht
// und Anfangswiderstand verschieden sind. Eine Stufe dafür wäre eine Zahl ohne
// Grundlage.
//
// Dieses Modul beantwortet deshalb die andere Hälfte der Frage. "Bin ich stark im
// Vergleich zu anderen" braucht Standards. "Werde ich stärker" nicht, dafür reicht
// man selbst vor einem Monat. Der Vergleich gilt an jedem Gerät, ist also genau das
// richtige Signal für jemanden in einem Maschinenstudio, und jede eingetragene Übung
// zählt mit, nicht nur die siebzehn.

import { entryStats, linearFit } from './models.js';
import { tRegion, t, tn } from './i18n.js';
import { fmtDecimal } from './ui.js';

const WEEK = 7 * 86400000;

/** Mindestzahl an Einheiten mit einer Übung, bevor ihr Anstieg etwas bedeutet. */
const MIN_SESSIONS = 3;

/**
 * Wie nah an null ein Anstieg sein muss, damit er als flach gilt, in Prozent der
 * Startschätzung pro Woche.
 *
 * Eine eigene Festlegung der App, kein Befund: eine veröffentlichte Grenze für
 * "kein Fortschritt mehr" gibt es nicht. Sie steht hier und nicht direkt im Code,
 * weil mehr als ein Screen dieselbe Frage stellt, und zwei Screens, die sich
 * uneinig sind, was flach heißt, sind der Fehler, den dieses Projekt immer wieder baut.
 */
export const FLAT_BAND = 0.3;

/**
 * Verlauf des geschätzten 1RM je Region der Muskelkarte.
 *
 * Gerechnet mit e1RM statt Höchstgewicht, damit mehr Wiederholungen auch als
 * Fortschritt zählen. Das ist hier wichtiger als auf der Stärkekarte, weil man an
 * Maschinen oft über Wiederholungen zwischen den groben Gewichtsstufen vorankommt.
 *
 * `now` beendet das Zeitfenster. Das braucht die Wochenkarte: eine Karte über die
 * letzte Woche darf keine Einheiten sehen, die danach eingetragen wurden, sonst
 * sagt sie beim erneuten Öffnen im nächsten Monat still etwas anderes.
 *
 * @returns {Object<string, {state, pctPerWeek, exercises, sessions, best}>}
 */
export function regionProgress(sessions, exerciseById, { weeks = 12, now = Date.now() } = {}) {
  const since = now - weeks * WEEK;

  // Übungs-ID -> [{t, e1rm}]
  const series = new Map();
  for (const s of sessions) {
    if (!s.finishedAt || s.startedAt < since || s.startedAt > now) continue;
    for (const entry of s.entries || []) {
      const st = entryStats(entry);
      if (!st.sets || !st.e1rm) continue;
      if (!series.has(entry.exerciseId)) series.set(entry.exerciseId, []);
      series.get(entry.exerciseId).push({ t: s.startedAt, y: st.e1rm });
    }
  }

  // Region -> Beiträge
  const acc = {};
  const touch = (region) => (acc[region] = acc[region] || { weighted: 0, weight: 0, exercises: 0, sessions: 0, best: null, thin: 0 });

  for (const [id, raw] of series) {
    const ex = exerciseById.get(id);
    if (!ex) continue;
    const points = raw.sort((a, b) => a.t - b.t);

    // Eine Region gilt als "trainiert", sobald sie einmal eingetragen ist, das soll
    // die Karte zeigen. Ob sie VORANKOMMT, braucht mehr als einen Datenpunkt.
    const regions = [
      ...(ex.primary || []).map((r) => [r, 1]),
      ...(ex.secondary || []).map((r) => [r, 0.5]),
    ];
    if (points.length < MIN_SESSIONS) {
      for (const [r] of regions) { touch(r).thin++; touch(r).sessions += points.length; }
      continue;
    }

    const t0 = points[0].t;
    const fit = linearFit(points.map((p) => [(p.t - t0) / WEEK, p.y]));
    if (!fit) continue;
    const first = points[0].y;
    if (!first) continue;
    const pctPerWeek = (fit.slope / first) * 100;

    for (const [r, w] of regions) {
      const a = touch(r);
      a.weighted += pctPerWeek * w;
      a.weight += w;
      a.exercises++;
      a.sessions += points.length;
      if (!a.best || pctPerWeek > a.best.pctPerWeek) {
        a.best = { name: ex.name, pctPerWeek, from: first, to: points[points.length - 1].y };
      }
    }
  }

  const out = {};
  for (const [region, a] of Object.entries(acc)) {
    if (!a.weight) {
      // Eingetragen, aber nie genug Einheiten mit einer Übung für eine Linie.
      out[region] = { state: 'thin', pctPerWeek: null, exercises: 0, sessions: a.sessions, best: null };
      continue;
    }
    const pct = a.weighted / a.weight;
    out[region] = {
      state: pct > FLAT_BAND ? 'climbing' : pct < -FLAT_BAND ? 'falling' : 'flat',
      pctPerWeek: pct,
      exercises: a.exercises,
      sessions: a.sessions,
      best: a.best,
    };
  }
  return out;
}

/**
 * Die Fortschrittszustände auf Stufen der Farbskala der Muskelkarte legen.
 *
 * Dieselbe Skala hält die Bildsprache einheitlich, aber die Bedeutung ist eine
 * andere, und die Legende sagt das auch: hier geht es um Veränderung, nicht um
 * einen Rang gegen irgendwen. Die drei Stufen sind danach gewählt, wie sie wirken,
 * nicht wo sie auf der Leiter stehen: Grün für steigend, flaches Grau für flach
 * und die dunkelste Stufe für fallend.
 */
export const PROGRESS_TIER = { falling: 0, flat: 1, thin: 1, climbing: 5 };

export function progressFills(byRegion) {
  const out = {};
  for (const [region, p] of Object.entries(byRegion)) {
    const idx = PROGRESS_TIER[p.state];
    if (idx !== undefined) out[region] = idx;
  }
  return out;
}

export const PROGRESS_LABEL = {
  climbing: 'regionProgress.climbing',
  flat: 'regionProgress.flat',
  falling: 'regionProgress.falling',
  thin: 'regionProgress.thin',
};

/** Zusammenfassung einer Region in einer Zeile, in normaler Sprache. */
export function describeRegion(region, p) {
  const name = tRegion(region);
  if (!p) return t('regionProgress.nothing', { muscle: name });
  if (p.state === 'thin') {
    return t('regionProgress.tooThin', { muscle: name, times: tn(p.sessions, 'unit.time') });
  }
  // `-0.0%` käme bei einer flachen Linie ohne das hier heraus, und das sieht aus wie ein Fehler.
  const v = Math.abs(p.pctPerWeek) < 0.05 ? 0 : p.pctPerWeek;
  const rate = t('regionProgress.rate', { pct: `${v > 0 ? '+' : ''}${fmtDecimal(v)}` });
  const via = p.best ? ` ${t('regionProgress.bestMover', { name: p.best.name })}` : '';
  return t('regionProgress.summary', {
    muscle: name,
    state: t(PROGRESS_LABEL[p.state]).toLowerCase(),
    rate,
    exercises: tn(p.exercises, 'unit.exercise'),
  }) + via;
}
