// Fortschritt: Überblick übers Training und die Ansicht einer einzelnen Übung.

import {
  el, fmtNum, fmtDecimal, fmtVolume, fmtWeight, fmtDate, relDay, emptyState,
  openSheet, closeSheet, toast, confirmSheet, listItem,
  numberInput, parseNumber, normaliseOnBlur,
} from '../ui.js';
import * as store from '../store.js';
import {
  exerciseSeries, weeklyMuscleSets, personalRecords, entryStats,
  isCounted, startOfWeek, MUSCLES, dayKey,
} from '../models.js';
import { lineChart, barChart, hBars, heatmap } from '../charts.js';
import { strengthHistory, tonnageHistory, movers } from '../history.js';
import { weekStreak } from '../log-analysis.js';
import { stallReport, describeStall } from '../fatigue.js';
import { shareWeekSheet } from '../week-share.js';
import { TIERS, DIVISIONS, BAND, tierIndex, tierOf, rankOf, hasProfile } from '../standards.js';
import { exerciseHistory, pooledOrderCost } from '../progression.js';

/**
 * Die Lastkorrekturen je Maschine, in der Form, die buildRating will. Aus Home kopiert
 * statt importiert: Screens gegenseitig zu importieren hat in dieser App schon einmal
 * dazu geführt, dass zwei sich gegenseitig geladen haben.
 */
function machineCorrections(settings, exerciseById) {
  const loadFactors = {}, stackMax = {};
  for (const [id, setup] of Object.entries(settings.machineSetups || {})) {
    const ex = exerciseById.get(id);
    if (!ex) continue;
    if (Number(setup.loadFactor) > 0 && Number(setup.loadFactor) !== 1) loadFactors[ex.name] = Number(setup.loadFactor);
    if (Number(setup.stackMax) > 0) stackMax[ex.name] = Number(setup.stackMax);
  }
  return { loadFactors, stackMax };
}
import { pickExercise } from '../pickers.js';
import { profileForm } from './settings.js';
import { navigate } from '../app.js';
import { timeline, timelineReady, MIN_LOGGED_DAYS } from '../timeline.js';
import { t, tn, tMuscle, tEquipment, tTier } from '../i18n.js';

let metric = 'e1rm';      // Diagramm je Übung, bleibt über das Neuzeichnen hinweg
let workMetric = 'sets';  // Diagramm der Wochenbelastung

export default function renderProgress({ param, actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': t('common.settings') }, ['⚙']));
  return param ? exerciseView(param) : overview();
}

/* Überblick */

function overview() {
  const units = store.units();
  const done = store.state.sessions.filter((s) => s.finishedAt);
  const root = el('div');

  if (!done.length) {
    return emptyState(t('progress.empty'), t('progress.emptyHint'));
  }

  // Kennzahlen oben
  const weekStart = startOfWeek(Date.now());
  const thisWeek = done.filter((s) => s.startedAt >= weekStart);
  const weekSets = thisWeek.reduce((n, s) => n + s.entries.reduce((m, e) => m + e.sets.filter(isCounted).length, 0), 0);

  // Die Tonnage insgesamt ist keine Trainingsgröße, sie sagt nie, was als Nächstes
  // kommt. Sie steht hier, weil man ihr gern beim Steigen zusieht, und genau das
  // bringt Leute dazu, die App auch im vierten Monat noch zu öffnen.
  const lifetime = done.reduce((n, s) =>
    n + s.entries.reduce((m, e) => m + entryStats(e).volume, 0), 0);

  root.append(
    el('div.stat-grid.two', {}, [
      el('div.stat', {}, [el('span.stat-val', { text: String(thisWeek.length) }), el('span.stat-key', { text: t('home.week.title') })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(weekSets) }), el('span.stat-key', { text: t('train.sets') })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(weekStreak(done)) }), el('span.stat-key', { text: t('home.stat.streak') })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(done.length) }), el('span.stat-key', { text: t('home.stat.workouts') })]),
    ])
  );
  root.append(
    el('div.card.tight', { style: { marginTop: '10px', textAlign: 'center' } }, [
      el('div', { style: { fontSize: '22px', fontWeight: '740', letterSpacing: '-0.02em' },
        text: fmtVolume(lifetime, units) }),
      el('div.small.faint', { text: t('progress.movedAllTime') }),
    ])
  );
  root.append(
    el('button.btn.ghost.full', { style: { marginTop: '10px' }, onclick: () => shareWeekSheet() },
      [t('progress.shareWeek')])
  );

  // Einstieg zu den einzelnen Übungen (das, was man eigentlich will)
  root.append(el('div.section-head', {}, [el('h2', { text: t('progress.exerciseProgress') })]));
  root.append(
    el('button.btn.primary.full', {
      onclick: () => pickExercise((ex) => navigate('progress', ex.id)),
    }, [t('progress.pickExercise')])
  );

  const frequent = mostTrained(done, 5);
  if (frequent.length) {
    root.append(el('div', { style: { marginTop: '10px' } }, frequent.map(({ ex, count }) =>
      listItem({
        title: ex.name,
        sub: tn(count, 'unit.session'),
        ariaLabel: t('progress.chartAria', { name: ex.name }),
        onclick: () => navigate('progress', ex.id),
      })
    )));
  }

  // Stärke über die Zeit
  root.append(strengthSection(done));

  // was sich bewegt
  root.append(moversSection(done, units));

  // geht es überhaupt noch voran
  root.append(stallSection(done));

  // Essen und Training auf einer Achse
  root.append(timelineSection(units));

  // Arbeit pro Woche
  const buckets = weeklyMuscleSets(done, store.state.exerciseById, 10);
  root.append(el('div.section-head', {}, [el('h2', { text: t('progress.weeklyWorkload') })]));
  root.append(workloadSection(done, units));

  // Verteilung auf die Muskeln in den letzten 4 Wochen
  const recent = buckets.slice(-4);
  const byMuscle = {};
  for (const b of recent) {
    for (const [m, n] of Object.entries(b.byMuscle)) byMuscle[m] = (byMuscle[m] || 0) + n;
  }
  const muscleRows = MUSCLES
    .map((m) => ({ label: tMuscle(m), value: byMuscle[m] || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  if (muscleRows.length) {
    root.append(el('div.section-head', {}, [el('h2', { text: t('progress.muscleSplit') })]));
    root.append(
      el('div.card', {}, [
        el('figcaption', { style: { fontSize: '12.5px', color: 'var(--text-dim)', marginBottom: '10px' },
          text: t('progress.muscleSplitCaption') }),
        hBars(muscleRows),
      ])
    );
  }

  // Regelmäßigkeit
  root.append(el('div.section-head', {}, [el('h2', { text: t('progress.consistency') })]));
  const dayMap = new Map();
  for (const s of done) {
    // Ortszeit, passend zu den Zellschlüsseln, die die Heatmap aus Mitternacht in Ortszeit baut.
    const key = dayKey(s.startedAt);
    const n = s.entries.reduce((m, e) => m + e.sets.filter(isCounted).length, 0);
    dayMap.set(key, (dayMap.get(key) || 0) + n);
  }
  root.append(
    el('div.card', {}, [
      heatmap([...dayMap].map(([key, value]) => ({ key, value })), 18),
      el('div.legend', {}, [
        el('span', {}, [el('b', { style: { background: 'var(--line-soft)' } }), t('plans.rest')]),
        el('span', {}, [el('b', { style: { background: 'color-mix(in srgb, var(--accent) 38%, var(--line-soft))' } }), t('progress.heat18')]),
        el('span', {}, [el('b', { style: { background: 'color-mix(in srgb, var(--accent) 70%, var(--line-soft))' } }), '9-16']),
        el('span', {}, [el('b', { style: { background: 'var(--accent)' } }), '17+']),
      ]),
    ])
  );

  // Körpergewicht
  root.append(el('div.section-head', {}, [
    el('h2', { text: t('home.bodyweight.title') }),
    el('button.btn.quiet.sm', { onclick: bodyweightForm }, [t('progress.logShort')]),
  ]));

  const bw = [...store.state.bodyweight].sort((a, b) => a.date - b.date);
  if (bw.length >= 2) {
    const delta = bw[bw.length - 1].weight - bw[0].weight;
    root.append(
      el('div.card', {}, [
        lineChart(
          bw.map((b) => ({ x: b.date, y: b.weight, tip: fmtWeight(b.weight, units) })),
          {
            caption: t('home.bodyweight.caption', {
              now: fmtWeight(bw[bw.length - 1].weight, units),
              delta: `${delta >= 0 ? '+' : ''}${fmtWeight(delta, units)}`,
              since: fmtDate(bw[0].date),
            }),
            format: (v) => fmtNum(v, 0), showTrend: true, height: 170,
          }
        ),
      ])
    );
  } else {
    root.append(el('div.card', {}, [
      el('div.small.muted', {
        text: bw.length
          ? t('progress.oneBodyweight', { weight: fmtWeight(bw[0].weight, units) })
          : t('progress.noBodyweight'),
      }),
      el('button.btn.ghost.full.sm', { style: { marginTop: '10px' }, onclick: bodyweightForm }, [t('progress.logBodyweight')]),
    ]));
  }

  return root;
}

/**
 * Was statt eines Diagramms mit einem einzigen Punkt kommt.
 *
 * Ein Diagramm mit einem Punkt sieht aus wie etwas Fertiges, das zufällig leer ist,
 * und verschenkt die eine Zahl, die es gibt. Also bekommt die Zahl den Platz, und was
 * fehlt, wird gesagt statt gezeichnet: ein Verlauf braucht eine zweite Einheit, das ist
 * eine Tatsache über die Daten und kein Versagen des Screens.
 *
 * Null Punkte ist ein anderer Satz. Das heißt nicht "nichts eingetragen", die Liste
 * darunter ist voll. Es heißt, dass diese eine Größe jedes Mal null ergeben hat, und
 * genau das macht eine Körpergewichtsübung mit Volumen und geschätztem 1RM.
 */
function thinChart(points, m, units) {
  if (!points.length) {
    return el('div.card', {}, [
      el('div.small.muted', { text: t('progress.allZero', { metric: m.noun }) }),
    ]);
  }

  const only = points[0];
  return el('div.card', {}, [
    el('div', { style: { fontSize: '32px', fontWeight: '760', letterSpacing: '-0.03em', lineHeight: '1.1' },
      text: only.tip }),
    el('div.small.faint', { style: { marginTop: '2px' }, text: `${m.noun} · ${relDay(only.x)}` }),
    el('div.small.muted', { style: { marginTop: '12px' }, text: t('progress.onePoint') }),
  ]);
}

/**
 * Jede Notiz, die je zu dieser Übung geschrieben wurde, die neuesten zuerst.
 *
 * Die Notizen gab es schon immer, eine pro Übung und Einheit, man konnte sie nur nirgends
 * nachlesen. "Was hatte ich mir beim Kreuzheben überlegt?" hatte keine Antwort, obwohl
 * die Daten im Log standen. Billiger geht eine Funktion nicht: kein neuer Speicher, kein
 * neues Schreiben, nur das, was schon festgehalten ist, eingesammelt.
 */
function noteHistory(exerciseId) {
  const wrap = el('div');

  const notes = [];
  for (const s of store.state.sessions) {
    if (!s.finishedAt) continue;
    const entry = (s.entries || []).find((e) => e.exerciseId === exerciseId);
    const text = entry && (entry.note || '').trim();
    if (text) notes.push({ text, at: s.startedAt, sessionId: s.id });
  }
  if (!notes.length) return wrap;

  notes.sort((a, b) => b.at - a.at);

  wrap.append(el('div.section-head', {}, [
    el('h2', { text: t('progress.notes') }),
    el('span.small.faint', { text: tn(notes.length, 'unit.note') }),
  ]));

  for (const n of notes.slice(0, 12)) {
    wrap.append(
      el('button.card.tight', {
        style: { display: 'block', width: '100%', textAlign: 'left' },
        'aria-label': t('progress.noteFrom', { when: relDay(n.at) }),
        onclick: () => navigate('calendar', n.sessionId),
      }, [
        el('div.small.faint', { text: relDay(n.at) }),
        el('div.small', { style: { marginTop: '2px', color: 'var(--text)' }, text: n.text }),
      ])
    );
  }

  if (notes.length > 12) {
    wrap.append(el('div.small.faint', { style: { textAlign: 'center' },
      text: t('progress.olderNotes', { notes: tn(notes.length - 12, 'unit.note') }) }));
  }
  return wrap;
}

/* Stärke über die Zeit */

/**
 * Die Gesamtstärke, wie sie jede Woche stand, nicht wie sie heute steht.
 *
 * Das ist das Diagramm, das der App gefehlt hat: jede andere Zahl hier misst geleistete
 * Arbeit, also den Einsatz. Diese misst, was dabei herausgekommen ist.
 */
function strengthSection(done) {
  const wrap = el('div');
  const settings = store.state.settings;
  if (settings.showRatings === false) return wrap;

  wrap.append(el('div.section-head', {}, [el('h2', { text: t('progress.strengthOverTime') })]));

  if (!hasProfile(settings)) {
    wrap.append(el('div.card', {}, [
      el('div.small.muted', { text: t('progress.needProfile') }),
      el('button.btn.ghost.full.sm', { style: { marginTop: '10px' }, onclick: () => profileForm() }, [t('home.rating.addDetails')]),
    ]));
    return wrap;
  }

  const history = strengthHistory(
    store.state.sessions, store.state.bodyweight, settings, store.state.exerciseById, 20,
    Date.now(), machineCorrections(settings, store.state.exerciseById));

  if (history.length < 2) {
    wrap.append(el('div.card', {}, [
      el('div.small.muted', { text: t('progress.needBenchmark') }),
    ]));
    return wrap;
  }

  const first = history[0], last = history[history.length - 1];
  const delta = last.score - first.score;
  const weeks = Math.max(1, Math.round((last.week - first.week) / (7 * 86400000)));

  wrap.append(
    el('div.card', {}, [
      lineChart(
        history.map((h) => ({
          x: h.week,
          y: h.score,
          tip: `${tTier(h.tier.key)} ${rankOf(h.score).division}`,
        })),
        {
          caption: t('progress.strengthCaption', { lifts: tn(last.lifts, 'unit.lift') }),
          // Rangnamen an der Achse, nicht 0 bis 100. Aus der Zahl wird die Linie gezeichnet,
          // gezeigt wird sie niemandem mehr: "Diamant" und "Meister" sagen, was 44 und 56
          // nie gesagt haben.
          format: (v) => tTier(tierOf(v).key, { short: true }),
          showTrend: true,
          height: 190,
        }
      ),
      el('div.row.between', { style: { marginTop: '10px', alignItems: 'center' } }, [
        el(`div.tier-${tierIndex(last.score)}`, {}, [
          el('span.tier-chip', {}, [
            tTier(last.tier.key),
            el('span.div-mark', { text: rankOf(last.score).division }),
          ]),
        ]),
        el('div.small', {
          style: { color: delta >= 0 ? 'var(--good)' : 'var(--text-dim)', fontWeight: '650' },
          text: t('progress.pointsOver', {
            delta: `${delta >= 0 ? '+' : ''}${Math.round(delta)}`,
            weeks: tn(weeks, 'unit.week'),
          }),
        }),
      ]),
      // Die Grenzen der Stufen sind das, wovon man seinen Abstand wissen will, und sie
      // von einer unbeschrifteten y-Achse abzulesen ist Raterei. Eine Stufe ist
      // 100/TIERS.length Punkte breit, siehe BAND und tierIndex() in standards.js. Nicht
      // jede Stufe: zwölf davon als "Chl 75 · Imm 83 · Rad 92" liest niemand. Die beiden
      // Enden und die, auf die es ankommt, also die nächste.
      //
      // Die Anzahl wird übergeben und steht nicht fest im Satz. Da stand "neun Ränge",
      // solange es zwölf gibt, weil die Leiter gewachsen ist und der Text nicht. Der
      // Kommentar darüber war schon auf zwölf korrigiert, die Zeile darunter sagte noch neun.
      el('div.small.faint', { style: { marginTop: '6px' },
        text: t('progress.tierBands', {
          ranks: TIERS.length,
          divisions: DIVISIONS.length,
          bands: `${tTier(TIERS[0].key)} 0 … ${tTier(TIERS[TIERS.length - 1].key)} ${Math.round((TIERS.length - 1) * BAND)}`,
        }) + ` ${nextTierNote(last.score)}` }),
    ])
  );

  return wrap;
}

/**
 * Wie weit es bis zur nächsten Stufe ist, in den Einheiten, in denen das Diagramm gezeichnet ist.
 *
 * Die nächste Division, nicht der nächste Rang: auf einer Leiter mit 27 Stufen kann der
 * Rang darüber zehn Punkte entfernt sein, und so ein Abstand fühlt sich nicht nach
 * "fast da" an.
 */
function nextTierNote(score) {
  const rank = rankOf(score);
  if (!rank || rank.top) return t('progress.topBand');
  const step = BAND / DIVISIONS.length;
  const next = Math.min(100, (Math.floor(score / step) + 1) * step);
  const target = rankOf(next + 0.0001);
  return t('progress.pointsTo', {
    points: fmtDecimal(next - score),
    tier: `${tTier(target.tier.key)} ${target.division}`,
  });
}

/* was sich bewegt */

/** Welche Übungen steigen und welche sich seit Monaten nicht bewegt haben. */
/**
 * Näher kommt die App nicht an "mach mal eine leichtere Woche", also nicht besonders
 * nah. Sie sagt, was das eigene Log zeigt, und hört dort auf.
 *
 * Deload-Wochen macht in der Praxis fast jeder, in der Literatur sind sie dünn belegt:
 * keine Studie sagt, wann eine fällig ist, wie lange sie dauern soll oder dass sie
 * besser ist als weiterzumachen. Eine Regel hier wäre ausgedachte Genauigkeit, die
 * Karte zeigt also Tatsachen und sagt laut, dass die Entscheidung bei einem selbst liegt.
 */
function stallSection(done) {
  const wrap = el('div');
  if (store.state.settings.plateauHints === false) return wrap;
  const report = stallReport(done, store.state.exerciseById);
  if (!report) return wrap;

  const lines = describeStall(report);
  const worthAttention = report.stalled >= Math.ceil(report.tracked / 2);

  wrap.append(el('div.section-head', {}, [el('h2', { text: t('progress.stillMoving') })]));
  wrap.append(
    el('div.card', {}, [
      el('div', {
        style: {
          fontWeight: '650', fontSize: '14px',
          color: worthAttention ? 'var(--warn)' : 'var(--good)',
        },
        text: t(worthAttention ? 'progress.stallWorse' : 'progress.stallBetter'),
      }),
      ...lines.map((line) => el('div.small.muted', { style: { marginTop: '8px' }, text: line })),
      el('div.small.faint', { style: { marginTop: '12px' }, text: t('progress.stallCaveat') }),
    ])
  );
  return wrap;
}

function moversSection(done, units) {
  const wrap = el('div');
  const rows = movers(done, store.state.exerciseById, { minSessions: 3, sinceWeeks: 12 });
  if (!rows.length) return wrap;

  const climbing = rows.filter((r) => r.perWeek > 0.05).slice(0, 5);
  const stalled = rows.filter((r) => r.perWeek <= 0.05).slice(-4).reverse();

  wrap.append(el('div.section-head', {}, [el('h2', { text: t('progress.whatIsMoving') })]));

  const card = el('div.card', {});
  const line = (r, tone) => el('button.row.between', {
    style: {
      width: '100%', background: 'none', border: 0, textAlign: 'left',
      padding: '9px 0', borderTop: '1px solid var(--line-soft)', gap: '10px',
    },
    'aria-label': t('progress.chartAria', { name: r.ex.name }),
    onclick: () => navigate('progress', r.ex.id),
  }, [
    el('div.grow', {}, [
      el('div', { style: { fontWeight: '600', fontSize: '14.5px' }, text: r.ex.name }),
      el('div.small.faint', {
        text: t('progress.moverLine', {
          from: fmtWeight(Math.round(r.first), units),
          to: fmtWeight(Math.round(r.last), units),
          sessions: tn(r.sessions, 'unit.session'),
        }),
      }),
    ]),
    el('div', { style: { textAlign: 'right', color: tone, fontWeight: '680', fontSize: '14px' } }, [
      `${r.perWeek >= 0 ? '+' : ''}${fmtDecimal(r.perWeek)}`,
      el('div.small.faint', { style: { fontWeight: '500' }, text: t('progress.perWeekUnits', { units }) }),
    ]),
  ]);

  if (climbing.length) {
    card.append(el('div.small', { style: { fontWeight: '650', color: 'var(--good)' }, text: t('home.map.up') }));
    climbing.forEach((r) => card.append(line(r, 'var(--good)')));
  }
  if (stalled.length) {
    card.append(el('div.small', {
      style: { fontWeight: '650', color: 'var(--text-dim)', marginTop: climbing.length ? '14px' : '0' },
      text: t('progress.flatOrFalling'),
    }));
    stalled.forEach((r) => card.append(line(r, 'var(--text-dim)')));
  }
  card.append(el('div.small.faint', { style: { marginTop: '12px' }, text: t('progress.moversNote') }));

  wrap.append(card);
  return wrap;
}

/* Essen neben dem Training */

/**
 * Die zwei Hälften der App in denselben Wochen.
 *
 * Drei Diagramme statt einem mit drei Reihen: sie messen Verschiedenes in verschiedenen
 * Einheiten, und eine gemeinsame y-Achse würde entweder die Gewichtslinie zu einer
 * geraden Kante plattdrücken oder die Kalorienbalken oben hinausschießen. Eine
 * Zeitleiste wird es durch die x-Achse. Deshalb bekommen alle drei dieselben Ränder und
 * nur das unterste trägt die Daten.
 *
 * Das Essen sind Balken, weil eine Woche ohne Einträge leer aussehen muss. Das
 * Körpergewicht ist eine Linie, weil Wiegen Zeitpunkte sind und die App sie überall
 * sonst schon so liest.
 *
 * Was die Karte verweigert, ist ein Warum. Drei Linien, die sich zusammen bewegen,
 * beweisen nicht, dass die eine die andere bewegt hat, und mit einer Person ohne
 * Vergleich kann das keine Version dieses Screens. Also beschreibt sie, und der Hinweis
 * unten sagt klar, dass die Deutung bei einem selbst liegt.
 */
function timelineSection(units) {
  const wrap = el('div');
  const data = timeline({
    sessions: store.state.sessions,
    meals: store.state.meals,
    bodyweight: store.state.bodyweight,
  }, { weeks: 12 });

  if (!timelineReady(data)) {
    // Gibt es nichts zu zeigen, einmal leise sagen, was fehlt.
    if (!store.state.meals.length) return wrap;
    wrap.append(el('div.section-head', {}, [el('h2', { text: t('timeline.title') })]));
    wrap.append(el('div.card', {}, [
      el('div.small.muted', {
        text: t('timeline.notYet', {
          weeks: tn(data.coverage.withIntake, 'unit.week'), min: MIN_LOGGED_DAYS,
        }),
      }),
    ]));
    return wrap;
  }

  const rows = data.weeks;
  const label = (w) => t('home.workload.weekOf', { date: fmtDate(w.week) });
  const shortLabel = (w, i) => (i === rows.length - 1 ? t('home.workload.now') : fmtDate(w.week));

  // Dieselben Ränder für jedes Diagramm im Stapel, siehe charts.js.
  const AXIS = { padL: 34, padR: 10 };

  const kcalBars = rows.map((w, i) => ({
    label: label(w),
    short: shortLabel(w, i),
    value: w.intake && w.intake.kcal ? w.intake.kcal : 0,
    tip: w.intake && w.intake.kcal
      ? t('timeline.kcalTip', { kcal: fmtNum(w.intake.kcal), days: w.intake.days })
      : t('timeline.thinWeek', { days: w.loggedDays }),
    dim: !w.intake,
  }));

  const weightPoints = rows
    .filter((w) => w.bodyweight !== null)
    .map((w) => ({
      x: w.week, y: w.bodyweight,
      tip: t('timeline.weightTip', {
        weight: fmtWeight(w.bodyweight, units), n: w.weighIns,
      }),
    }));

  const setBars = rows.map((w, i) => ({
    label: label(w),
    short: shortLabel(w, i),
    value: w.sets,
    tip: tn(w.sets, 'unit.set'),
    dim: i === rows.length - 1,
  }));

  wrap.append(el('div.section-head', {}, [el('h2', { text: t('timeline.title') })]));
  wrap.append(
    el('div.card', {}, [
      // Die Beschriftung ist das eigene Label des Diagramms und sein Name für Screenreader,
      // darüber steht also keine zweite Überschrift. Mit einer hat jede Zeile ihren Titel
      // doppelt gezeigt.
      barChart(kcalBars, {
        ...AXIS, xLabels: false, height: 120, everyNthLabel: 3,
        format: (v) => (v >= 1000 ? `${fmtDecimal(v / 1000)}k` : String(Math.round(v))),
        caption: t('timeline.rowKcal'),
      }),

      weightPoints.length >= 2
        ? lineChart(weightPoints, {
            ...AXIS, xLabels: false, height: 120, showArea: false,
            format: (v) => fmtNum(v, 0), caption: t('timeline.rowWeight'),
          })
        : el('div.small.faint', { style: { padding: '14px 0' }, text: t('timeline.noWeighIns') }),

      barChart(setBars, {
        ...AXIS, height: 120, everyNthLabel: 3, caption: t('timeline.rowSets'),
      }),

      el('div.small.muted', { style: { marginTop: '12px' },
        text: t('timeline.coverage', {
          weeks: tn(data.coverage.withIntake, 'unit.week'),
          total: data.coverage.total,
          min: MIN_LOGGED_DAYS,
        }) }),
      el('div.small.faint', { style: { marginTop: '8px' }, text: t('timeline.noCausation') }),
    ])
  );
  return wrap;
}

/* Belastung */

/**
 * Dieselben Wochen, auf drei Arten. Sätze sind das, worauf die Planbewertung schaut,
 * Tonnage beantwortet "wie viel habe ich bewegt", und Wiederholungen ändern sich
 * zuerst, wenn man innerhalb eines Wiederholungsbereichs vorankommt.
 */
function workloadSection(done, units) {
  const host = el('div');
  // Die Tonnage wird schnell fünfstellig, und der Rand der y-Achse ist 30 px breit.
  // Deshalb das kurze Achsenformat statt einer Zahl mit Tausendertrennung.
  const compact = (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${fmtDecimal(v / 1000)}k` : String(Math.round(v)));

  const WORK = {
    sets:    { label: t('train.sets'), pick: (b) => b.sets, fmt: (v) => tn(v, 'unit.set'), axis: (v) => String(Math.round(v)),
               caption: t('progress.work.setsCaption') },
    tonnage: { label: t('plans.part.volume'), pick: (b) => b.tonnage, fmt: (v) => `${fmtNum(v, 0)}${units}`, axis: compact,
               caption: t('progress.work.tonnageCaption', { units }) },
    reps:    { label: t('train.col.reps'), pick: (b) => b.reps, fmt: (v) => tn(v, 'unit.rep'), axis: compact,
               caption: t('progress.work.repsCaption') },
  };

  const chart = el('div');
  const seg = el('div.seg', { style: { marginBottom: '12px' } },
    Object.entries(WORK).map(([key, m]) =>
      el('button', {
        'aria-pressed': String(workMetric === key),
        onclick: (e) => {
          workMetric = key;
          [...e.target.parentElement.children].forEach((b, i) =>
            b.setAttribute('aria-pressed', String(Object.keys(WORK)[i] === key)));
          paint();
        },
      }, [m.label])
    )
  );

  function paint() {
    const m = WORK[workMetric];
    const buckets = tonnageHistory(done, 12);
    chart.replaceChildren(
      el('div.card', {}, [
        barChart(
          buckets.map((b, i) => ({
            label: t('home.workload.weekOf', { date: fmtDate(b.week) }),
            short: i === buckets.length - 1 ? t('home.workload.now') : fmtDate(b.week),
            value: Math.round(m.pick(b)),
            tip: m.fmt(Math.round(m.pick(b))),
            dim: i === buckets.length - 1,
          })),
          { caption: `${m.caption} ${t('progress.lastBar')}`, height: 160, everyNthLabel: 3, format: m.axis }
        ),
      ])
    );
  }

  paint();
  host.append(seg, chart);
  return host;
}

/* einzelne Übung */

function exerciseView(exerciseId) {
  const units = store.units();
  const ex = store.state.exerciseById.get(exerciseId);
  const root = el('div');

  root.append(
    el('button.btn.quiet.sm', {
      style: { marginBottom: '10px', paddingLeft: '0' },
      onclick: () => navigate('progress'),
    }, [`‹ ${t('route.progress')}`])
  );

  if (!ex) {
    root.append(emptyState(t('library.notFound'), t('library.notFoundHint')));
    return root;
  }

  const series = exerciseSeries(store.state.sessions, exerciseId);

  // Dieselben Einheiten ohne den Effekt der Reihenfolge. Eine Übung, die in einer
  // Einheit von Platz eins auf Platz fünf rückt, verliert ein paar Prozent aus Gründen,
  // die nichts mit Schwächerwerden zu tun haben, und auf einem Diagramm über zwölf Wochen
  // sieht das wie ein Plateau aus. Was korrigiert wird und wie stark, steht in js/progression.js.
  const assumedRir = Number(store.state.settings.assumedRir) || 0;
  const corrected = exerciseHistory(store.state.sessions, exerciseId, store.state.exerciseById, {
    limit: 500,
    assumedRir,
    fallbackCost: pooledOrderCost(store.state.sessions, store.state.exerciseById, { assumedRir }),
  });
  const freshById = new Map(corrected.map((row) => [row.sessionId, row]));

  root.append(
    el('div', { style: { marginBottom: '14px' } }, [
      el('div', { style: { fontSize: '21px', fontWeight: '710', letterSpacing: '-0.02em' }, text: ex.name }),
      el('div.small.faint', { text: `${tMuscle(ex.muscle)} · ${tEquipment(ex.equipment)} · ${tn(series.length, 'unit.session')}` }),
    ])
  );

  if (!series.length) {
    root.append(emptyState(t('progress.noLiftData'), t('progress.noLiftDataHint')));
    return root;
  }

  // Rekorde
  const prs = personalRecords(store.state.sessions, exerciseId);
  root.append(
    el('div.stat-grid.compact', { style: { marginBottom: '4px' } }, [
      prs.e1rm ? el('div.stat', {}, [
        el('span.stat-val', { text: fmtWeight(Math.round(prs.e1rm.value), units) }),
        el('span.stat-key', { text: t('progress.bestE1rm') }),
      ]) : null,
      prs.weight ? el('div.stat', {}, [
        el('span.stat-val', { text: fmtWeight(prs.weight.value, units) }),
        el('span.stat-key', { text: t('progress.topWeight') }),
      ]) : null,
      prs.reps ? el('div.stat', {}, [
        el('span.stat-val', { text: String(prs.reps.value) }),
        el('span.stat-key', { text: t('progress.mostReps') }),
      ]) : null,
    ].filter(Boolean))
  );

  // Umschalter für die Größe
  const METRICS = {
    e1rm:   { label: t('progress.metric.e1rm'), noun: t('progress.metric.e1rmNoun'), pick: (p) => p.e1rm,
              caption: t('progress.metric.e1rmCaption') },
    fresh:  { label: t('progress.metric.fresh'), noun: t('progress.metric.freshNoun'),
              pick: (p) => freshById.get(p.sessionId)?.freshE1rm || 0,
              caption: t(corrected.orderCost?.measured
                ? 'progress.metric.freshCaptionMeasured' : 'progress.metric.freshCaption') },
    top:    { label: t('progress.metric.top'), noun: t('progress.metric.topNoun'), pick: (p) => p.topWeight,
              caption: t('progress.metric.topCaption') },
    volume: { label: t('plans.part.volume'), noun: t('progress.metric.volumeNoun'), pick: (p) => p.volume,
              caption: t('progress.metric.volumeCaption') },
  };

  const chartHost = el('div');

  const seg = el('div.seg', { style: { marginBottom: '14px' } },
    Object.entries(METRICS).map(([key, m]) =>
      el('button', {
        'aria-pressed': String(metric === key),
        onclick: (e) => {
          metric = key;
          [...e.target.parentElement.children].forEach((b, i) =>
            b.setAttribute('aria-pressed', String(Object.keys(METRICS)[i] === key)));
          paintChart();
          paintTail();
        },
      }, [m.label])
    )
  );

  function paintChart() {
    const m = METRICS[metric];
    const points = series.map((p) => ({
      x: p.t, y: m.pick(p),
      tip: `${fmtNum(m.pick(p), metric === 'volume' ? 0 : 1)}${units}`,
    })).filter((p) => p.y > 0);

    if (points.length < 2) {
      chartHost.replaceChildren(thinChart(points, m, units));
      return;
    }

    chartHost.replaceChildren(
      el('div.card', {}, [
        lineChart(points, {
          caption: m.caption,
          format: (v) => fmtNum(v, 0),
          showTrend: true,
          height: 200,
        }),
      ])
    );
  }

  // Verlauf in Worten, Klartext ist besser, als den Nutzer eine Steigung erraten zu lassen.
  // Mit dem Diagramm neu gezeichnet statt einmal gebaut: der Text nennt die Größe, um die
  // es geht, und nach dem Umschalten stand früher noch der alte Name unter der neuen Linie.
  const tailHost = el('div');

  function paintTail() {
    tailHost.replaceChildren();
    if (series.length < 3) return;
    const first = series[0], last = series[series.length - 1];
    const m = METRICS[metric];
    const a = m.pick(first), b = m.pick(last);
    if (!(a > 0)) return;
    const pct = ((b - a) / a) * 100;
    const weeks = Math.max(1, Math.round((last.t - first.t) / (7 * 86400000)));
    tailHost.append(
      el('div.card.tight', {}, [
        el('div.small', {}, [
          el('b', { text: `${pct >= 0 ? '+' : ''}${fmtDecimal(pct)}% `, class: pct >= 0 ? 'mono-accent' : '' }),
          t('progress.trendTail', { weeks: tn(weeks, 'unit.week'), metric: m.noun }),
        ]),
      ])
    );
  }

  paintChart();
  paintTail();
  root.append(seg, chartHost, tailHost);

  root.append(noteHistory(exerciseId));

  // Tabelle der Einheiten (die barrierefreie Alternative zum Diagramm)
  root.append(el('div.section-head', {}, [el('h2', { text: t('progress.everySession') })]));
  for (const p of [...series].reverse()) {
    root.append(listItem({
      title: relDay(p.t),
      sub: `${tn(p.sets, 'unit.set')} · ${t('progress.topOf', { weight: fmtWeight(p.topWeight, units) })} · ${fmtVolume(p.volume, units)} · e1RM ${fmtNum(p.e1rm)}`,
      onclick: () => navigate('calendar', p.sessionId),
    }));
  }

  return root;
}

/* Helfer */

function mostTrained(sessions, limit) {
  const counts = new Map();
  for (const s of sessions) {
    for (const e of s.entries) {
      if (!e.sets.some(isCounted)) continue;
      counts.set(e.exerciseId, (counts.get(e.exerciseId) || 0) + 1);
    }
  }
  return [...counts]
    .map(([id, count]) => ({ ex: store.state.exerciseById.get(id), count }))
    .filter((r) => r.ex)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function bodyweightForm() {
  const units = store.units();
  const latest = store.state.bodyweight[0];
  const input = normaliseOnBlur(numberInput({
    decimal: true,
    value: latest ? String(latest.weight) : '',
    placeholder: t('settings.weightIn', { units }),
  }));
  const date = el('input', { type: 'date', value: dayKey() });

  const history = el('div', {}, store.state.bodyweight.slice(0, 8).map((b) =>
    el('div.row.between', { style: { padding: '7px 0', borderBottom: '1px solid var(--line-soft)' } }, [
      el('span.small', { text: fmtDate(b.date, { year: 'numeric' }) }),
      el('div.row', { style: { gap: '10px' } }, [
        el('span.small', { style: { fontWeight: '650' }, text: fmtWeight(b.weight, units) }),
        el('button.btn.quiet.sm', {
          'aria-label': t('progress.deleteEntry'),
          onclick: async () => {
            const ok = await confirmSheet(t('progress.deleteEntry'),
              t('progress.deleteEntryBody', { weight: fmtWeight(b.weight, units), date: fmtDate(b.date) }));
            if (ok) { await store.deleteBodyweight(b.id); toast(t('progress.deleted')); }
          },
        }, ['×']),
      ]),
    ])
  ));

  const body = el('div', {}, [
    el('label.field', {}, [el('span', { text: t('progress.weightField', { units }) }), input]),
    el('label.field', {}, [el('span', { text: t('calendar.date') }), date]),
    el('button.btn.primary.full', {
      onclick: async () => {
        const v = parseNumber(input.value);
        if (!v || v <= 0) { toast(t('progress.enterWeight')); input.focus(); return; }
        await store.logBodyweight(v, new Date(`${date.value}T12:00:00`).getTime());
        closeSheet();
        toast(t('progress.logged'));
      },
    }, [t('common.save')]),
    store.state.bodyweight.length
      ? el('div', {}, [el('div.section-head', {}, [el('h2', { text: t('home.recent.title') })]), history])
      : null,
  ]);

  openSheet(t('progress.logBodyweight'), body);
}

export { entryStats };
