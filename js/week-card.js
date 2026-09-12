// Die Wochenkarte: eine Trainingswoche als PNG, das man in einen Gruppenchat schicken kann.
//
// Zwei Regeln bestimmen, was darauf steht. Sie zeigt nur, was die App ohnehin schon
// berechnet hat. Für die Karte wird keine Zahl erfunden, und was die Daten nicht
// hergeben, steht in Worten da statt als Zahl. Und sie ist ein Bild, kein Link: nichts
// wird hochgeladen, nichts geholt, es gibt kein Konto. Das Bild entsteht auf dem Handy
// und geht an das Teilen-Menü.
//
// Das Bild wird gezeichnet und nicht abfotografiert, warum, steht in js/canvas-kit.js.

import { fmtNum, fmtWeight, fmtDate } from './ui.js';
import { startOfWeek, isCounted, e1rm, entryStats } from './models.js';
import { TIERS, tierIndex, tierOf, rankOf, hasProfile } from './standards.js';
import { t, tRegion, tTier } from './i18n.js';
import { strengthAt, bodyweightAt } from './history.js';
import { analyseWeek, compareToPlan, weekVerdict, weekStreak } from './log-analysis.js';
import { analysePlan } from './plan-rating.js';
import { regionProgress, progressFills, PROGRESS_LABEL, PROGRESS_TIER } from './region-progress.js';
import {
  fillRound, strokeRound, drawText, textWidth, wrapLines, loadPaths, drawPaths,
} from './canvas-kit.js';

/** Logische Breite. Die Bitmap ist das mal `scale`. */
export const CARD_W = 540;

const PAD = 26;
const INNER = CARD_W - PAD * 2;

// Die Farben der App, aufgelöst. Canvas kennt keine Kaskade, deshalb stehen sie hier
// absichtlich doppelt. Mit :root in css/styles.css im Gleichschritt halten.
const C = {
  bg: '#0A0E1A',
  raised: '#121A2B',
  float: '#162034',
  sunken: '#070A12',
  line: '#223049',
  lineSoft: '#17223A',
  text: '#EAF0FA',
  dim: '#93A3BE',
  faint: '#5E6E8C',
  accent: '#3B82F6',
  accentHi: '#60A5FA',
  good: '#34D399',
  warn: '#FBBF24',
  // Neun Ränge, passend zu --t0..--t8 in css/styles.css. Der Canvas kann keine
  // CSS-Variablen lesen, die Skala steht also doppelt und muss mitgezogen werden.
  tier: ['#8A6A4A', '#9AA7B8', '#D9A93B', '#3B82F6', '#22D3EE',
    '#34D399', '#A855F7', '#F472B6', '#FFB020', '#DC2626', '#D946EF', '#F1F5F9'],
};

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const BODY_ART = ['assets/body-front.svg', 'assets/body-back.svg'];

/* Daten */

const nextWeek = (weekStart) => {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 7);
  return startOfWeek(d.getTime());
};

/**
 * Alles, was eine Karte zeigt, zusammengestellt aus denselben Funktionen wie die Screens.
 *
 * @param mapMode 'strength' (Stufen gegen veröffentlichte Standards) oder 'progress'
 *                (eigener e1RM-Verlauf). Nie gemischt, das sind zwei Skalen.
 */
export function weekSummary({
  sessions, exerciseById, settings, bodyweight, plan, units,
  weekStart = startOfWeek(Date.now()), mapMode = 'strength',
}) {
  const weekEnd = nextWeek(weekStart) - 1;
  const finished = sessions.filter((s) => s.finishedAt);
  const inWeek = finished.filter((s) => startOfWeek(s.startedAt) === weekStart);

  let tonnage = 0;
  for (const s of inWeek) {
    for (const entry of s.entries || []) tonnage += entryStats(entry).volume;
  }

  const week = analyseWeek(sessions, exerciseById, weekStart);
  const planned = plan && plan.days.some((d) => d.items.length)
    ? analysePlan(plan, exerciseById)
    : null;
  const rows = compareToPlan(week, planned);
  const verdict = weekVerdict(week, rows, planned ? plan.days.length * (plan.perWeek || 1) : 0);

  // Die Wertung an beiden Enden der Woche, jeweils mit dem Körpergewicht dieses
  // Moments. Die Wertung hängt am Körpergewicht, alles andere schreibt die Vergangenheit um.
  const endRating = strengthAt(sessions, bodyweight, settings, exerciseById, weekEnd);
  const startRating = strengthAt(sessions, bodyweight, settings, exerciseById, weekStart - 1);
  // Die Karte zeigt nie eine Wertung, die die App selbst verstecken würde. Eine
  // Entscheidung, für Kopf und Karte. Eine Karte mit Stufenkarte, aber ohne Wertung
  // darüber, würde genau das zeigen, was die Einstellung ausgeschaltet hat.
  const rating = settings.showRatings === false ? null : endRating;
  const sorted = [...(bodyweight || [])].sort((a, b) => a.date - b.date);
  const bwStart = bodyweightAt(sorted, weekStart - 1);
  const bwEnd = bodyweightAt(sorted, weekEnd);

  return {
    weekStart,
    weekEnd,
    label: weekLabel(weekStart, weekEnd),
    units,
    workouts: inWeek.length,
    sets: week.totalSets,
    tonnage,
    streak: weekStreak(finished, weekStart),
    strength: !rating
      ? null
      : {
          score: rating.overall,
          tier: tierOf(rating.overall),
          division: rankOf(rating.overall).division,
          step: rankOf(rating.overall).step,
          steps: rankOf(rating.overall).steps,
          rated: rating.ratedRegions,
          total: rating.totalRegions,
          // Differenz der gerundeten Werte, nicht die gerundete Differenz. Die Karte
          // zeigt ganze Zahlen, und eine Woche von 28,5 auf 29,4 darf keine 29 neben
          // "keine Änderung" zeigen, wenn die Karte der Vorwoche eine 28 hatte.
          delta: startRating
            ? Math.round(rating.overall) - Math.round(startRating.overall)
            : null,
        },
    strengthMissing: strengthReason(settings, endRating),
    bodyweightShift: bwStart !== null && bwEnd !== null && Math.abs(bwEnd - bwStart) >= 0.5
      ? bwEnd - bwStart
      : null,
    bests: newBests(finished, exerciseById, weekStart, weekEnd).slice(0, 3),
    verdict,
    rows: rows.filter((r) => r.done > 0 || r.target > 0).slice(0, 6),
    planName: planned ? plan.name : null,
    ...muscleMap(mapMode, { finished, exerciseById, rating, weekEnd }),
  };
}

function strengthReason(settings, rating) {
  if (settings.showRatings === false) return t('weekCard.ratingsOff');
  if (!hasProfile(settings)) return t('weekCard.needProfile');
  if (!rating) return t('weekCard.noBenchmark');
  return null;
}

function weekLabel(weekStart, weekEnd) {
  const sameYear = new Date(weekStart).getFullYear() === new Date().getFullYear();
  const from = fmtDate(weekStart);
  const to = fmtDate(weekEnd, sameYear ? {} : { year: 'numeric' });
  return `${from} - ${to}`;
}

/**
 * Übungen, die in der Woche ihren eigenen bisherigen Bestwert geschlagen haben.
 *
 * Eine Übung, die zum ersten Mal eingetragen wird, ist kein persönlicher Rekord,
 * sondern der erste Datenpunkt. Ohne diese Regel ist die erste Woche jedes Programms
 * eine Wand aus Rekorden, und der ganze Abschnitt wäre wertlos.
 */
function newBests(finished, exerciseById, weekStart, weekEnd) {
  const before = new Map();   // je Übungs-ID: bestes e1RM vor dieser Woche
  const during = new Map();   // je Übungs-ID: bester Satz dieser Woche

  for (const s of finished) {
    if (s.startedAt > weekEnd) continue;    // spätere Einheiten gehören nicht zu dieser Woche
    const inWeek = s.startedAt >= weekStart;
    for (const entry of s.entries || []) {
      for (const set of (entry.sets || []).filter(isCounted)) {
        const est = e1rm(set.weight, set.reps);
        if (!est) continue;
        if (inWeek) {
          const cur = during.get(entry.exerciseId);
          if (!cur || est > cur.e1rm) {
            during.set(entry.exerciseId, { e1rm: est, weight: Number(set.weight), reps: Number(set.reps) });
          }
        } else if (est > (before.get(entry.exerciseId) || 0)) {
          before.set(entry.exerciseId, est);
        }
      }
    }
  }

  const out = [];
  for (const [id, best] of during) {
    const prev = before.get(id);
    const ex = exerciseById.get(id);
    if (!ex || !prev) continue;
    // Ein Hauch über dem alten Bestwert ist Rundung und kein Rekord.
    if (best.e1rm <= prev * 1.005) continue;
    out.push({
      name: ex.name,
      weight: best.weight,
      reps: best.reps,
      from: prev,
      to: best.e1rm,
      pct: ((best.e1rm - prev) / prev) * 100,
    });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

/**
 * Die beiden Karten, jede mit eigener Legende und eigenem Satz.
 *
 * Sie beantworten verschiedene Fragen. "Wie stehe ich im Vergleich" braucht
 * veröffentlichte Standards und kann deshalb nur etwa siebzehn Übungen einfärben.
 * "Werde ich stärker" braucht nur die eigene Vergangenheit und zählt jede Übung, auch
 * an Maschinen.
 *
 * Ohne Wertung lohnt sich keine Stufenkarte. Ein grauer Körper unter einer Legende
 * von Bronze bis Legend sagt nichts, und bei ausgeschalteter Wertung würde sie genau
 * das zurückbringen, was versteckt werden sollte. Dann kommt die Karte, die nur mit
 * den eigenen Zahlen arbeitet.
 */
function muscleMap(mapMode, { finished, exerciseById, rating, weekEnd }) {
  if (mapMode === 'progress' || !rating) {
    const prog = regionProgress(finished, exerciseById, { weeks: 12, now: weekEnd });
    const fills = progressFills(prog);
    const colours = {};
    for (const [region, idx] of Object.entries(fills)) colours[region] = C.tier[idx];
    return {
      // Was gezeichnet wurde, und das ist nicht immer das, was gewünscht war.
      mapMode: 'progress',
      mapFills: colours,
      mapLegend: [
        { colour: C.tier[PROGRESS_TIER.climbing], label: t(PROGRESS_LABEL.climbing) },
        { colour: C.tier[PROGRESS_TIER.flat], label: t('home.map.flat') },
        { colour: C.tier[PROGRESS_TIER.falling], label: t(PROGRESS_LABEL.falling) },
      ],
      mapTitle: t('home.map.progress'),
      mapNote: t(Object.keys(colours).length ? 'weekCard.progressNote' : 'home.map.progressEmpty'),
    };
  }

  const colours = {};
  for (const [region, info] of Object.entries(rating.regions)) {
    colours[region] = C.tier[tierIndex(info.score)];
  }
  // Trainierte, aber unbewertete Regionen bekommen die Linienfarbe der Panels, wie auf
  // dem Bildschirm. Eine Rangfarbe würde hier etwas sagen, was die Wertung nicht sagt.
  for (const region of Object.keys(rating.indirect || {})) colours[region] ||= C.faint;
  return {
    mapMode: 'strength',
    mapFills: colours,
    // Zwei Einträge, nicht zwölf. Die Karte hat 540 Pixel, und ein Dutzend abgekürzter
    // Rangnamen ist eine Wand aus Stummeln. Die beiden Enden zu nennen sagt das Eine,
    // was man von einer geordneten Skala braucht: in welche Richtung sie läuft.
    mapLegend: [
      { colour: C.tier[0], label: tTier(TIERS[0].key) },
      { colour: C.tier[TIERS.length - 1], label: tTier(TIERS[TIERS.length - 1].key), ramp: true },
    ],
    mapTitle: t('home.map.strength'),
    mapNote: t('weekCard.strengthNote'),
  };
}

/* Zeichnen */

/** @returns {Promise<HTMLCanvasElement>} */
export async function renderCard(summary, { scale = 2 } = {}) {
  const art = await Promise.all(BODY_ART.map(loadPaths));

  // Die Höhe ergibt sich aus dem Inhalt. Die Karte wird also einmal gegen einen
  // Wegwerf-Context gelayoutet, um sie zu finden, und dann richtig gezeichnet. Beide
  // Durchläufe nutzen denselben Code, ein gemessenes Layout, das vom gezeichneten
  // abweicht, ist ein Fehler, der nur wartet.
  const scratch = document.createElement('canvas').getContext('2d');
  const height = Math.ceil(paint(scratch, summary, art, { measure: true }));

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  paint(ctx, summary, art, { height });
  return canvas;
}

export function cardBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('the image could not be encoded'))),
      'image/png'
    );
  });
}

/**
 * Zeichnet die ganze Karte. @returns die benutzte Höhe.
 *
 * `measure` lässt die zwei Dinge weg, deren Größe man ohne Zeichnen kennt: der
 * Hintergrund braucht die endgültige Höhe, und die der Muskelkarte ist reine Rechnung
 * mit der viewBox. Alles andere läuft in beiden Durchläufen, weil ein Layout, das
 * anders gemessen als gezeichnet wird, abdriftet.
 */
function paint(ctx, d, art, { measure = false, height = 0 } = {}) {
  if (!measure) background(ctx, height);

  let y = 32;
  y = header(ctx, d, y);
  y = hero(ctx, d, y + 16);
  y = stats(ctx, d, y + 12);
  y = map(ctx, d, art, y + 20, measure);
  if (d.bests.length) y = bests(ctx, d, y + 20);
  y = volume(ctx, d, y + 20);
  y = footer(ctx, d, y + 22);
  return y + 26;
}

function background(ctx, height) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, CARD_W, height);

  // Dieselben zwei Farbschleier wie im Hintergrund der App, auf die Karte zugeschnitten.
  const blue = ctx.createRadialGradient(CARD_W * 0.5, -60, 0, CARD_W * 0.5, -60, CARD_W * 1.35);
  blue.addColorStop(0, 'rgba(59, 130, 246, .18)');
  blue.addColorStop(1, 'rgba(59, 130, 246, 0)');
  ctx.fillStyle = blue;
  ctx.fillRect(0, 0, CARD_W, height);

  const violet = ctx.createRadialGradient(CARD_W * 1.05, 40, 0, CARD_W * 1.05, 40, CARD_W * 0.95);
  violet.addColorStop(0, 'rgba(168, 85, 247, .12)');
  violet.addColorStop(1, 'rgba(168, 85, 247, 0)');
  ctx.fillStyle = violet;
  ctx.fillRect(0, 0, CARD_W, height);
}

function header(ctx, d, y) {
  drawText(ctx, 'LIFTLOG', PAD, y, {
    size: 13, weight: 800, track: 2.6, color: C.accentHi, baseline: 'top',
  });
  drawText(ctx, d.label, CARD_W - PAD, y + 1, {
    size: 12.5, weight: 600, color: C.faint, align: 'right', baseline: 'top',
  });
  return y + 17;
}

/* Kopf */

function hero(ctx, d, y) {
  const h = 128;
  const accent = d.strength ? C.tier[tierIndex(d.strength.score)] : C.accent;

  panel(ctx, PAD, y, INNER, h, { glow: accent });

  const x = PAD + 22;
  if (d.strength) {
    // Auch hier ist der Rang die Überschrift. Eine geteilte Karte mit "41" lädt genau
    // zu dem Vergleich ein, den die Leiter ersetzen soll.
    const big = tTier(d.strength.tier.key);
    drawText(ctx, big, x, y + 22, { size: 40, weight: 800, color: accent, baseline: 'top', max: INNER - 130 });
    const w = Math.min(textWidth(ctx, big, { size: 40, weight: 800 }), INNER - 130);
    chip(ctx, x + w + 14, y + 40, `${d.strength.division}  ·  ${d.strength.step}/${d.strength.steps}`, accent);

    drawText(ctx, t('home.rating.overall', { rated: d.strength.rated, total: d.strength.total }),
      x, y + 86, { size: 12.5, weight: 500, color: C.dim, baseline: 'top', max: INNER - 44 });

    if (d.strength.delta !== null) deltaBadge(ctx, d.strength.delta, y);
    if (d.bodyweightShift !== null) {
      drawText(ctx,
        t('weekCard.bodyweightShift', {
          delta: `${d.bodyweightShift > 0 ? '+' : ''}${fmtWeight(round1(d.bodyweightShift), d.units)}`,
        }),
        x, y + 104, { size: 11, weight: 500, color: C.faint, baseline: 'top', max: INNER - 44 });
    }
  } else {
    const big = String(d.workouts);
    drawText(ctx, big, x, y + 20, { size: 56, weight: 780, color: C.text, baseline: 'top' });
    const w = textWidth(ctx, big, { size: 56, weight: 780 });
    drawText(ctx, t(d.workouts === 1 ? 'weekCard.workoutOne' : 'weekCard.workoutOther'), x + w + 14, y + 60,
      { size: 15, weight: 640, color: C.dim, baseline: 'top' });
    for (const [i, line] of wrapLines(ctx, d.strengthMissing || '', INNER - 44, { size: 11.5 }).slice(0, 2).entries()) {
      drawText(ctx, line, x, y + 86 + i * 15, { size: 11.5, weight: 500, color: C.faint, baseline: 'top' });
    }
  }
  return y + h;
}

function deltaBadge(ctx, v, y) {
  const colour = v > 0 ? C.good : v < 0 ? C.dim : C.faint;
  drawText(ctx, v === 0 ? t('weekCard.noChange') : `${v > 0 ? '+' : ''}${v}`, CARD_W - PAD - 22, y + 30, {
    size: v === 0 ? 15 : 26, weight: 740, color: colour, align: 'right', baseline: 'top',
  });
  // Nicht "gegenüber letzter Woche": auf einer Karte über die letzte Woche wird mit der
  // Woche davor verglichen.
  drawText(ctx, t('weekCard.overTheWeek'), CARD_W - PAD - 22, y + (v === 0 ? 50 : 62), {
    size: 11, weight: 600, color: C.faint, align: 'right', baseline: 'top',
  });
}

/* Kennzahlen */

function stats(ctx, d, y) {
  const gap = 8;
  const w = (INNER - gap * 3) / 4;
  const h = 62;
  const tiles = [
    [String(d.workouts), t('home.stat.workouts')],
    [String(d.sets), t('home.stat.workingSets')],
    [d.tonnage ? `${fmtNum(Math.round(d.tonnage))}${d.units}` : t('common.empty'), t('weekCard.moved')],
    // Ein eigener Schlüssel statt dem von Home: die Kachel ist 12 Zeichen breit, und
    // das deutsche Wort für "week streak" passt da nicht hinein.
    [String(d.streak), t('weekCard.streak')],
  ];

  tiles.forEach(([value, key], i) => {
    const x = PAD + i * (w + gap);
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, C.float);
    grad.addColorStop(1, C.raised);
    fillRound(ctx, x, y, w, h, 14, grad);
    strokeRound(ctx, x, y, w, h, 14, C.lineSoft);
    drawText(ctx, value, x + w / 2, y + 14, {
      size: 21, weight: 760, color: C.text, align: 'center', baseline: 'top', max: w - 10,
    });
    drawText(ctx, key.toUpperCase(), x + w / 2, y + 42, {
      size: 9.5, weight: 750, track: 0.7, color: C.faint, align: 'center', baseline: 'top', max: w - 6,
    });
  });
  return y + h;
}

/* Muskelkarte */

function map(ctx, d, art, y, measure = false) {
  const top = sectionHead(ctx, t('home.map.title'), y, d.mapTitle);

  const noteLines = wrapLines(ctx, d.mapNote, INNER - 32, { size: 11.5 });
  const legendRows = layoutLegend(ctx, d.mapLegend, INNER - 32);
  const figureW = 124;
  const figureH = (art[0].height / art[0].width) * figureW;
  const legendH = d.mapLegend.some((item) => item.ramp) ? 32 : legendRows.length * 17;
  const h = 16 + figureH + 16 + 14 + legendH + 6 + noteLines.length * 15 + 14;

  panel(ctx, PAD, top, INNER, h);

  const gap = 30;
  const startX = PAD + (INNER - (figureW * 2 + gap)) / 2;
  const fillFor = (region) => d.mapFills[region] || null;
  art.forEach((piece, i) => {
    if (!measure) drawPaths(ctx, piece, startX + i * (figureW + gap), top + 16, figureW, { fillFor, glow: 5 });
    drawText(ctx, t(i === 0 ? 'bodymap.front' : 'bodymap.back').toUpperCase(),
      startX + figureW / 2 + i * (figureW + gap), top + 16 + figureH + 6, {
      size: 9.5, weight: 750, track: 0.8, color: C.faint, align: 'center', baseline: 'top',
    });
  });

  let ly = top + 16 + figureH + 16 + 14;
  if (d.mapLegend.some((item) => item.ramp)) {
    // Die Stärkekarte ist eine geordnete Skala und wird auch so gezeichnet: die ganze
    // Skala als Balken mit beiden Enden beschriftet. Zwölf abgekürzte Rangnamen über
    // 540 Pixel waren eine Wand aus Stummeln.
    const rampW = INNER - 32;
    const cell = rampW / C.tier.length;
    C.tier.forEach((colour, i) => {
      fillRound(ctx, PAD + 16 + i * cell, ly + 2, cell - 2, 8, 2, colour);
    });
    ly += 15;
    drawText(ctx, d.mapLegend[0].label, PAD + 16, ly,
      { size: 11.5, weight: 640, color: d.mapLegend[0].colour, baseline: 'top' });
    drawText(ctx, d.mapLegend[d.mapLegend.length - 1].label, PAD + 16 + rampW, ly, {
      size: 11.5, weight: 640, color: d.mapLegend[d.mapLegend.length - 1].colour,
      align: 'right', baseline: 'top',
    });
    ly += 17;
  } else {
    for (const row of legendRows) {
      let lx = PAD + 16;
      for (const item of row) {
        fillRound(ctx, lx, ly + 3, 9, 9, 2, item.colour);
        drawText(ctx, item.label, lx + 14, ly, { size: 11.5, weight: 500, color: C.dim, baseline: 'top' });
        lx += item.width + 20;
      }
      ly += 17;
    }
  }

  ly += 6;
  for (const line of noteLines) {
    drawText(ctx, line, PAD + 16, ly, { size: 11.5, weight: 500, color: C.faint, baseline: 'top' });
    ly += 15;
  }
  return top + h;
}

function layoutLegend(ctx, items, max) {
  const rows = [[]];
  let width = 0;
  for (const item of items) {
    const w = 14 + textWidth(ctx, item.label, { size: 11.5, weight: 500 });
    if (width && width + w > max) { rows.push([]); width = 0; }
    rows[rows.length - 1].push({ ...item, width: w });
    width += w + 20;
  }
  return rows;
}

/* neue Bestwerte */

function bests(ctx, d, y) {
  const top = sectionHead(ctx, t('weekCard.newBests'), y, t('progress.metric.e1rmNoun'));
  const rowH = 42;
  const h = 12 + d.bests.length * rowH + 4;
  panel(ctx, PAD, top, INNER, h);

  d.bests.forEach((b, i) => {
    const ry = top + 12 + i * rowH;
    drawText(ctx, b.name, PAD + 16, ry, {
      size: 13.5, weight: 640, color: C.text, baseline: 'top', max: INNER - 110,
    });
    drawText(ctx, `+${b.pct.toFixed(1)}%`, CARD_W - PAD - 16, ry, {
      size: 13.5, weight: 700, color: C.good, align: 'right', baseline: 'top',
    });
    drawText(ctx,
      `${fmtWeight(b.weight, d.units)} × ${b.reps}  ·  ${fmtWeight(Math.round(b.from), d.units)} → ${fmtWeight(Math.round(b.to), d.units)}`,
      PAD + 16, ry + 18, { size: 11.5, weight: 500, color: C.faint, baseline: 'top', max: INNER - 40 });
  });
  return top + h;
}

/* Volumen gegen Plan */

function volume(ctx, d, y) {
  const top = sectionHead(ctx, t('plans.part.volume'), y,
    d.planName ? t('weekCard.vsPlan', { plan: d.planName }) : t('weekCard.noPlan'));

  const headLines = wrapLines(ctx, d.verdict.headline, INNER - 32, { size: 13, weight: 650 });
  const untargeted = d.rows.some((r) => r.target === 0);
  const footNote = untargeted
    ? wrapLines(ctx, 'Grey: trained this week but not in the plan, so there is no target to measure it against.', INNER - 32, { size: 11 })
    : [];
  const rowH = 20;
  const empty = !d.rows.length;
  const h = 14 + headLines.length * 17 + 8 + (empty ? 18 : d.rows.length * rowH)
    + (footNote.length ? 6 + footNote.length * 14 : 0) + 12;
  panel(ctx, PAD, top, INNER, h);

  const tone = d.verdict.tone === 'good' ? C.good : d.verdict.tone === 'warn' ? C.warn : C.faint;
  let ry = top + 14;
  for (const line of headLines) {
    drawText(ctx, line, PAD + 16, ry, { size: 13, weight: 650, color: tone, baseline: 'top' });
    ry += 17;
  }
  ry += 8;

  if (empty) {
    drawText(ctx, t('weekCard.nothingThisWeek'), PAD + 16, ry, {
      size: 12, weight: 500, color: C.faint, baseline: 'top',
    });
    return top + h;
  }

  // Grün heißt "im Soll für die Stelle der Woche, an der man ist", nicht "fertig". Dieselbe
  // Regel wie auf Home, damit die Karte keine Woche schönredet, die die App als Rückstand sieht.
  const pace = Math.max(0.15, d.verdict.pace);
  const nameW = 86;
  const valW = 46;
  const trackX = PAD + 16 + nameW + 10;
  const trackW = INNER - 32 - nameW - valW - 20;

  for (const r of d.rows) {
    drawText(ctx, tRegion(r.region), PAD + 16, ry + 1, {
      size: 12, weight: 500, color: C.dim, baseline: 'top', max: nameW,
    });

    fillRound(ctx, trackX, ry + 4, trackW, 9, 4.5, C.sunken);
    const pct = Math.min(1, r.target > 0 ? r.ratio : 1);
    const w = Math.max(4, pct * trackW);
    // Ohne Ziel gibt es kein Soll, der Balken bleibt also neutral, statt zu behaupten,
    // ein Muskel, den der Plan nie verlangt hat, sei "getroffen".
    const good = r.target > 0 && r.ratio >= pace * 0.9;
    const okay = r.target > 0 && r.ratio >= pace * 0.7;
    let fill;
    if (good) {
      fill = ctx.createLinearGradient(trackX, 0, trackX + w, 0);
      fill.addColorStop(0, C.good); fill.addColorStop(1, '#6EE7B7');
    } else if (okay) {
      fill = ctx.createLinearGradient(trackX, 0, trackX + w, 0);
      fill.addColorStop(0, C.accent); fill.addColorStop(1, C.accentHi);
    } else {
      // Keine Rangfarbe: der Balken heißt "im Rückstand oder ohne Ziel", und das untere
      // Ende der Leiter dafür zu leihen würde sich wie eine Bronze-Wertung lesen.
      fill = C.faint;
    }
    fillRound(ctx, trackX, ry + 4, w, 9, 4.5, fill);

    drawText(ctx, r.target > 0 ? `${trim(r.done)}/${trim(r.target)}` : trim(r.done),
      CARD_W - PAD - 16, ry + 1, {
        size: 12, weight: 650, color: C.text, align: 'right', baseline: 'top',
      });
    ry += rowH;
  }

  ry += 6;
  for (const line of footNote) {
    drawText(ctx, line, PAD + 16, ry, { size: 11, weight: 500, color: C.faint, baseline: 'top' });
    ry += 14;
  }
  return top + h;
}

/* Fußzeile */

function footer(ctx, d, y) {
  ctx.strokeStyle = C.lineSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(CARD_W - PAD, y);
  ctx.stroke();

  drawText(ctx, t('weekCard.madeWith'), PAD, y + 12, {
    size: 11.5, weight: 650, color: C.faint, baseline: 'top',
  });
  drawText(ctx, appUrl(), CARD_W - PAD, y + 12, {
    size: 11.5, weight: 500, color: C.faint, align: 'right', baseline: 'top', max: INNER - 130,
  });
  return y + 27;
}

function appUrl() {
  try {
    return `${location.host}${location.pathname}`.replace(/\/$/, '');
  } catch {
    return '';
  }
}

/* Kleinteile */

function panel(ctx, x, y, w, h, { glow = null } = {}) {
  const grad = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  grad.addColorStop(0, C.float);
  grad.addColorStop(1, C.raised);
  if (glow) {
    ctx.save();
    ctx.shadowColor = rgba(glow, 0.35);
    ctx.shadowBlur = 26;
    fillRound(ctx, x, y, w, h, 20, grad);
    ctx.restore();
  } else {
    fillRound(ctx, x, y, w, h, 20, grad);
  }
  strokeRound(ctx, x, y, w, h, 20, glow ? rgba(glow, 0.45) : C.line);
}

function chip(ctx, x, y, label, colour) {
  const w = textWidth(ctx, label, { size: 12.5, weight: 700 }) + 22;
  const h = 26;
  fillRound(ctx, x, y, w, h, 13, rgba(colour, 0.18));
  strokeRound(ctx, x, y, w, h, 13, rgba(colour, 0.55));
  drawText(ctx, label, x + w / 2, y + h / 2, {
    size: 12.5, weight: 700, color: colour, align: 'center', baseline: 'middle',
  });
  return w;
}

function sectionHead(ctx, label, y, right = null) {
  drawText(ctx, label.toUpperCase(), PAD + 2, y, {
    size: 10.5, weight: 780, track: 1.2, color: C.faint, baseline: 'top',
  });
  if (right) {
    drawText(ctx, right, CARD_W - PAD - 2, y, {
      size: 11, weight: 600, color: C.faint, align: 'right', baseline: 'top', max: INNER - 150,
    });
  }
  return y + 20;
}

const trim = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const round1 = (n) => Math.round(n * 10) / 10;
