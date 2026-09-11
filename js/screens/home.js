// Home: Gesamtwertung, Muskelkarte und das Training auf einen Blick.

import {
  el, add, fmtNum, fmtDecimal, fmtVolume, fmtWeight, fmtDate, fmtDuration, emptyState, listItem,
  openSheet, closeSheet, toast, confirmSheet,
  numberInput, parseNumber, normaliseOnBlur,
} from '../ui.js';
import * as store from '../store.js';
import * as cloud from '../cloud.js';
import {
  bestOneRepMaxByName, isCounted, startOfWeek, weeklyMuscleSets, sessionStats, dayKey,
} from '../models.js';
import {
  buildRating, hasProfile, TIERS, DIVISIONS, BAND, tierIndex, rankOf,
  LOW_CONFIDENCE, strengthRatio, ageFactor, ratedMachineNames, RATED_EQUIPMENT, isBenchmark,
  regionsFromExercises, canRank, drivesRegion,
} from '../standards.js';
import { strengthAt } from '../history.js';
import { rankBadge, celebrateRankUp, populationNote } from '../rank-art.js';
import { t, tn, tRegion, tTier, locale } from '../i18n.js';
import { bodyMap, tierLegend } from '../bodymap.js';
import { barChart, lineChart } from '../charts.js';
import { analyseWeek, compareToPlan, weekVerdict, weekStreak } from '../log-analysis.js';
import { shareWeekSheet } from '../week-share.js';
import { todaysDays, weekdayName } from '../schedule.js';
import { regionProgress, progressFills, describeRegion } from '../region-progress.js';
import { analysePlan } from '../plan-rating.js';
import { THRESHOLDS } from '../evidence.js';
import { navigate } from '../app.js';
import { requestWorkoutStart } from '../workout-start.js';
import { profileForm, doExport } from './settings.js';

// Welche Karte zuletzt angeschaut wurde. Auf Modulebene, damit ein Tabwechsel mit
// Rückkehr sie nicht still zurücksetzt.
let mapMode = 'strength';

/**
 * Wie viele Übungen jede der beiden Rekordlisten zeigt, bevor sie aufgeklappt wird.
 *
 * Fünf sind eine Vorschau, keine Grenze: wer zwanzig Bewegungen trainiert, konnte die
 * anderen fünfzehn von hier aus gar nicht sehen. Der aufgeklappte Zustand liegt aus
 * demselben Grund wie `mapMode` auf Modulebene: ein eingetragener Satz zeichnet Home neu,
 * und die Liste jedes Mal unter dem Finger zuzuklappen wäre schlimmer, als sie nie aufzuklappen.
 */
const RECORD_PREVIEW = 5;
let showAllLifts = false;
let showAllMachines = false;

/**
 * Der Knopf unter einer gekürzten Rekordliste, oder nichts, wenn alles passt.
 *
 * @param total  wie viele es gibt
 * @param open   ob die Liste gerade aufgeklappt ist
 * @param toggle bekommt den neuen Zustand
 */
function showAllToggle(total, open, toggle) {
  if (total <= RECORD_PREVIEW) return null;
  return el('button.btn.quiet.full.sm', {
    style: { marginTop: '2px' },
    'aria-expanded': String(open),
    // navigate statt render: dieses Modul importiert das Erste, und auf der Route, auf der
    // man schon ist, zeichnet navigate an Ort und Stelle neu und behält die Scrollposition.
    onclick: () => { toggle(!open); navigate('home'); },
  }, [open ? t('home.rating.showTop', { n: RECORD_PREVIEW }) : t('home.rating.showAll', { n: total })]);
}
let machineCommunity = {};
let machineSyncSignature = null;
let machineSyncing = false;

// Wo jeder Rang unter allen liegt, die dasselbe eintragen. Die Schlüssel sind wie auf
// dem Server: 'overall', 'lift:<name>', 'region:<id>'.
let rankPercentiles = {};
let rankSyncSignature = null;
let rankSyncing = false;

/** Die zwischengespeicherte Verteilung wegwerfen, wenn die Zustimmung mitten in der Sitzung zurückgezogen wird. */
export function resetRankComparison() {
  rankPercentiles = {};
  rankSyncSignature = null;
}

export default function renderHome({ actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': t('common.settings') }, ['⚙']));

  const root = el('div');
  const done = store.state.sessions.filter((s) => s.finishedAt);
  const s = store.state.settings;

  // ---------- Speicherfehler ----------
  // Über allem anderen, auch über einem laufenden Training: wenn das Schreiben scheitert,
  // kann man sich bei nichts anderem auf diesem Screen darauf verlassen, dass es die Nacht übersteht.
  if (store.state.storageError) {
    const problem = store.state.storageError;
    root.append(
      el('div.card', { style: { borderColor: 'color-mix(in srgb, var(--danger) 45%, transparent)' } }, [
        el('div', { style: { fontWeight: '680', color: 'var(--danger)' }, text: t('home.write.title') }),
        el('div.small.muted', { style: { marginTop: '2px' },
          text: problem.quota
            ? t('home.write.quota')
            : t('home.write.failed', { message: problem.message }) }),
        el('button.btn.sm.ghost', { style: { marginTop: '10px' }, onclick: () => doExport() }, [t('home.write.export')]),
      ])
    );
  }

  // ---------- Hinweis auf laufendes Training ----------
  const active = store.activeSession();
  const stale = store.staleSession();
  if (active && !stale) {
    root.append(
      el('div.card.glow', {}, [
        el('div.row.between', {}, [
          el('div.grow', {}, [
            el('div', { style: { fontWeight: '680' }, text: t('home.active.title') }),
            el('div.small.muted', { text: active.name }),
          ]),
          el('button.btn.primary.sm', { onclick: () => navigate('train') }, [t('home.active.resume')]),
        ]),
      ])
    );
  }
  // Ein Training, das nie beendet wurde, "läuft" nicht. Und solange man sich nicht darum
  // kümmert, öffnet ein neues Training still dieses hier wieder.
  if (stale) root.append(staleCard(stale));

  if (s.regenerationEnabled) root.append(regenerationCard());

  // ---------- Hinweis zur Sicherung ----------
  const backup = store.backupStatus();
  if (backup.due) {
    root.append(
      el('div.card', { style: { borderColor: 'color-mix(in srgb, var(--warn) 32%, transparent)' } }, [
        el('div.row.between', { style: { gap: '12px' } }, [
          el('div.grow', {}, [
            el('div', { style: { fontWeight: '680', color: 'var(--warn)' }, text: t('home.backup.title') }),
            el('div.small.muted', {
              text: backup.reason === 'never'
                ? t('home.backup.never', { n: done.length })
                : backup.reason === 'workouts'
                  ? t('home.backup.sinceWorkouts', { n: backup.since })
                  : t('home.backup.sinceDays', { n: backup.days }),
            }),
          ]),
          el('button.btn.sm.ghost', { onclick: () => doExport() }, [t('common.export')]),
        ]),
      ])
    );
  }

  if (!done.length) {
    root.append(emptyState(
      t('home.empty.title'),
      t('home.empty.body'),
      el('button.btn.primary', { style: { marginTop: '14px' }, onclick: () => navigate('train') }, [t('home.empty.action')])
    ));
    return root;
  }

  // ---------- was heute dran ist ----------
  // Zuerst, weil es das Einzige auf diesem Screen ist, wofür man die App im Studio öffnet.
  // Früher stand es an vierter Stelle, etwa vier Bildschirme weiter unten, hinter der
  // Rangkarte, der Muskelkarte und zwei Tabellen mit Rekorden.
  root.append(todayCard(done));

  // ---------- Wertung ----------
  if (s.showRatings) {
    root.append(ratingSection(done, s));
  }

  // ---------- diese Woche ----------
  const weekStart = startOfWeek(Date.now());
  const thisWeek = done.filter((x) => x.startedAt >= weekStart);
  const weekSets = thisWeek.reduce(
    (n, x) => n + x.entries.reduce((m, e) => m + e.sets.filter(isCounted).length, 0), 0);

  root.append(el('div.section-head', {}, [
    el('h2', { text: t('home.week.title') }),
    el('button.btn.quiet.sm', { onclick: () => shareWeekSheet() }, [`${t('common.share')} ›`]),
  ]));
  root.append(
    el('div.stat-grid.two', {}, [
      el('div.stat', {}, [el('span.stat-val', { text: String(thisWeek.length) }), el('span.stat-key', { text: t('home.stat.workouts') })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(weekSets) }), el('span.stat-key', { text: t('home.stat.workingSets') })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(weekStreak(done)) }), el('span.stat-key', { text: t('home.stat.streak') })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(done.length) }), el('span.stat-key', { text: t('home.stat.allTime') })]),
    ])
  );

  root.append(monthlyReportCard(done));

  // ---------- gemacht gegen geplant ----------
  root.append(weekVsPlan(done));

  // ---------- Belastung pro Woche ----------
  const buckets = weeklyMuscleSets(done, store.state.exerciseById, 10);
  root.append(el('div.section-head', {}, [
    el('h2', { text: t('home.workload.title') }),
    // Der Fortschritt-Tab hat keinen Platz in der Tab-Leiste, also muss jeder Abschnitt, der
    // einen Verlauf andeutet, den Weg dorthin anbieten.
    el('button.btn.quiet.sm', { onclick: () => navigate('progress') }, [`${t('home.link.charts')} ›`]),
  ]));
  root.append(
    el('div.card', {}, [
      barChart(
        buckets.map((b, i) => ({
          label: t('home.workload.weekOf', { date: fmtDate(b.week) }),
          short: i === buckets.length - 1 ? t('home.workload.now') : fmtDate(b.week),
          value: b.total,
          tip: t('home.workload.tip', { n: b.total }),
          dim: i === buckets.length - 1,
        })),
        { caption: t('home.workload.caption'), height: 155, everyNthLabel: 3 }
      ),
    ])
  );

  // ---------- Körpergewicht ----------
  const bw = [...store.state.bodyweight].sort((a, b) => a.date - b.date);
  if (bw.length >= 2) {
    const delta = bw[bw.length - 1].weight - bw[0].weight;
    root.append(el('div.section-head', {}, [
      el('h2', { text: t('home.bodyweight.title') }),
      el('button.btn.quiet.sm', { onclick: () => navigate('progress') }, [`${t('common.more')} ›`]),
    ]));
    root.append(
      el('div.card', {}, [
        lineChart(
          bw.map((b) => ({ x: b.date, y: b.weight, tip: fmtWeight(b.weight, store.units()) })),
          {
            caption: t('home.bodyweight.caption', {
              now: fmtWeight(bw[bw.length - 1].weight, store.units()),
              delta: `${delta >= 0 ? '+' : ''}${fmtWeight(delta, store.units())}`,
              since: fmtDate(bw[0].date),
            }),
            format: (v) => fmtNum(v, 0), showTrend: true, height: 160,
          }
        ),
      ])
    );
  }

  // ---------- zuletzt ----------
  root.append(el('div.section-head', {}, [
    el('h2', { text: t('home.recent.title') }),
    el('button.btn.quiet.sm', { onclick: () => navigate('calendar') }, [`${t('route.calendar')} ›`]),
  ]));
  for (const x of done.slice(0, 3)) {
    const st = sessionStats(x);
    root.append(listItem({
      title: x.name,
      sub: `${fmtDate(x.startedAt)} · ${tn(st.sets, 'unit.set')} · ${fmtVolume(st.volume, store.units())}`,
      onclick: () => navigate('calendar', x.id),
    }));
  }

  // ---------- die zwei Screens ohne Tab ----------
  // Fünf Tabs sind das Maximum, das ein Daumen treffen kann, und Essen hat sich einen
  // verdient, weil man es mehrmals am Tag öffnet. Kalender und Fortschritt schaut man
  // wöchentlich an, sie wohnen deshalb hier. Aber sie müssen SICHTBAR sein und kein Link in
  // einer Abschnittsüberschrift, genau so ist der Kalender verloren gegangen, sobald er
  // seinen Platz verlor.
  root.append(
    el('div.stat-grid.two', { style: { marginTop: '18px' } }, [
      wayIn(t('route.calendar'), t('home.wayIn.calendar'), () => navigate('calendar')),
      wayIn(t('route.progress'), t('home.wayIn.progress'), () => navigate('progress')),
      // Drei in zwei Spalten lässt eine Kachel mit halber Breite allein. Die übrige geht
      // deshalb über die ganze Breite, das liest sich auch eher wie eine Reihe als wie eine Lücke.
      wayIn(t('route.library'), t('home.wayIn.library'), () => navigate('library'), 'span'),
    ])
  );

  return root;
}

function monthlyReportCard(done) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const sessions = done.filter((session) => session.startedAt >= start);
  const totals = sessions.reduce((sum, session) => {
    const stats = sessionStats(session);
    sum.sets += stats.sets; sum.volume += stats.volume; sum.duration += stats.durationMs;
    return sum;
  }, { sets: 0, volume: 0, duration: 0 });
  const previousBest = new Map(); let prs = 0;
  for (const session of [...done].sort((a, b) => a.startedAt - b.startedAt)) {
    for (const entry of session.entries || []) {
      const best = Math.max(0, ...(entry.sets || []).filter(isCounted)
        .map((set) => (Number(set.systemWeight ?? set.weight) || 0) * (1 + Number(set.reps) / 30)));
      if (best > (previousBest.get(entry.exerciseId) || 0) && previousBest.has(entry.exerciseId)
        && session.startedAt >= start) prs++;
      if (best > (previousBest.get(entry.exerciseId) || 0)) previousBest.set(entry.exerciseId, best);
    }
  }
  const month = now.toLocaleDateString(locale(), { month: 'long' });
  const head = el('div.section-head', {}, [el('h2', { text: t('home.month.title', { month }) })]);
  // Vier Kacheln mit null sagen dasselbe wie ein Satz und brauchen fünfmal so viel Platz.
  // Früh im Monat oder nach einer Pause standen dort früher acht Nullen hintereinander,
  // und die Woche darüber sagte es auch noch.
  if (!sessions.length) {
    return el('div', {}, [head, el('div.small.faint', { text: t('home.month.empty', { month }) })]);
  }

  return el('div', {}, [
    head,
    el('div.stat-grid.two', {}, [
      el('div.stat', {}, [el('span.stat-val', { text: String(sessions.length) }), el('span.stat-key', { text: t('home.stat.workouts') })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(totals.sets) }), el('span.stat-key', { text: t('home.stat.workingSets') })]),
      el('div.stat', {}, [el('span.stat-val', { text: fmtNum(totals.volume) }), el('span.stat-key', { text: t('home.month.volume') })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(prs) }), el('span.stat-key', { text: t('home.month.prs') })]),
    ]),
    totals.duration ? el('div.small.faint', { style: { marginTop: '7px', textAlign: 'center' },
      text: t('home.month.time', { duration: fmtDuration(totals.duration) }) }) : null,
  ]);
}

function regenerationCard() {
  // dayKey, nicht toISOString: der Rest der App stempelt Tage in Ortszeit, und ein
  // ISO-Stempel steht an einem Sommermorgen in MESZ bis 2 Uhr noch auf gestern. Ein Eintrag
  // spät in der Nacht landete also am falschen Tag.
  const today = dayKey();
  const log = store.state.settings.regenerationLog || [];
  const saved = log.find((x) => x.date === today);
  return el('div.card', {}, [
    el('div.row.between', {}, [
      el('div', {}, [
        el('div', { style: { fontWeight: '680' }, text: t('home.regeneration.title') }),
        el('div.small.muted', { text: saved ? t('home.regeneration.done') : t('home.regeneration.body') }),
      ]),
      el('button.btn.sm.ghost', { onclick: () => regenerationSheet(saved) }, [saved ? t('common.edit') : t('home.regeneration.check')]),
    ]),
  ]);
}

function regenerationSheet(saved = {}) {
  const number = (value, min, max, step = 1) => el('input', {
    type: 'number', inputmode: 'decimal', min: String(min), max: String(max), step: String(step), value: value ?? '',
  });
  const sleep = number(saved.sleep, 0, 16, 0.5);
  const quality = number(saved.quality, 1, 5);
  const soreness = number(saved.soreness, 1, 5);
  const motivation = number(saved.motivation, 1, 5);
  const stress = number(saved.stress, 1, 5);
  const fatigue = number(saved.fatigue, 1, 5);
  const row = (label, input, hint) => el('label.field', {}, [el('span', { text: label }), input,
    hint ? el('div.small.faint', { text: hint }) : null]);
  openSheet(t('home.regeneration.title'), el('div', {}, [
    el('div.small.muted', { style: { marginBottom: '12px' }, text: t('home.regeneration.disclaimer') }),
    row(t('home.regeneration.sleep'), sleep),
    row(t('home.regeneration.quality'), quality, t('home.regeneration.scale')),
    row(t('home.regeneration.soreness'), soreness, t('home.regeneration.scale')),
    row(t('home.regeneration.motivation'), motivation, t('home.regeneration.scale')),
    row(t('home.regeneration.stress'), stress, t('home.regeneration.scale')),
    row(t('home.regeneration.fatigue'), fatigue, t('home.regeneration.scale')),
    el('button.btn.primary.full', { onclick: async () => {
      const date = dayKey();
      const next = (store.state.settings.regenerationLog || []).filter((x) => x.date !== date);
      next.push({ date, sleep: Number(sleep.value) || null, quality: Number(quality.value) || null,
        soreness: Number(soreness.value) || null, motivation: Number(motivation.value) || null,
        stress: Number(stress.value) || null, fatigue: Number(fatigue.value) || null });
      await store.setSetting('regenerationLog', next.slice(-120));
      closeSheet();
      toast(t('home.regeneration.saved'));
    } }, [t('common.save')]),
  ]));
}

function wayIn(title, sub, onclick, span = null) {
  return el(span ? 'button.stat.span-all' : 'button.stat', {
    onclick,
    'aria-label': `${title}, ${sub}`,
    style: { textAlign: 'left', cursor: 'pointer' },
  }, [
    el('div.row.between', { style: { alignItems: 'baseline' } }, [
      el('span', { style: { fontWeight: '700', fontSize: '15px' }, text: title }),
      el('span.chev', { text: '›', 'aria-hidden': 'true', style: { color: 'var(--text-faint)' } }),
    ]),
    el('div.small.faint', { style: { marginTop: '2px' }, text: sub }),
  ]);
}

/**
 * Ein offen gelassenes Training.
 *
 * Bietet die zwei ehrlichen Auswege an und sagt, was so oder so mit den Sätzen passiert.
 * Beenden behält nur, was abgehakt ist, dieselbe Regel wie beim normalen Beenden. Eine
 * Einheit ohne abgehakte Sätze ist also nichts wert und sagt das auch.
 */
function staleCard({ session, hours }) {
  const logged = session.entries.reduce((n, e) => n + e.sets.filter(isCounted).length, 0);
  const since = hours >= 48
    ? t('home.stale.daysAgo', { n: Math.round(hours / 24) })
    : t('home.stale.hoursAgo', { n: Math.round(hours) });

  return el('div.card', { style: { borderColor: 'color-mix(in srgb, var(--warn) 40%, transparent)' } }, [
    el('div', { style: { fontWeight: '680', color: 'var(--warn)' }, text: t('home.stale.title') }),
    el('div.small.muted', { style: { marginTop: '2px' },
      text: t('home.stale.body', { name: session.name, since }) }),
    el('div.stack', { style: { marginTop: '12px' } }, [
      logged
        ? el('button.btn.primary.full.sm', {
            onclick: async () => {
              await store.finishSession(session.id);
              toast(t('home.stale.finished', { sets: tn(logged, 'unit.set') }));
            },
          }, [t('home.stale.finish', { sets: tn(logged, 'unit.set') })])
        : null,
      el('button.btn.ghost.full.sm', { onclick: () => navigate('train') }, [t('home.stale.open')]),
      el('button.btn.ghost.full.sm', {
        onclick: async () => {
          const ok = await confirmSheet(t('home.stale.discardTitle'),
            logged
              ? t('home.stale.discardBody', { sets: tn(logged, 'unit.set') })
              : t('home.stale.discardEmpty'),
            { confirmLabel: t('home.stale.discard') });
          if (!ok) return;
          await store.discardSession(session.id);
          toast(t('home.stale.discarded'));
        },
      }, [t('home.stale.discardIt')]),
    ]),
  ]);
}

/* ==================== heute ==================== */

/**
 * Was laut Plan heute dran ist.
 *
 * Erscheint erst, wenn Wochentage vergeben sind. Ohne Wochenplan hat "heute" keine Antwort,
 * und der Vorschlag des Trainieren-Tabs (was am längsten her ist) ist dann schon der
 * richtige. Während eines laufenden Trainings steht hier nichts, das deckt die Karte zum
 * Fortsetzen oben ab.
 */
function todayCard(done) {
  const wrap = el('div');
  const plan = store.activePlan();
  if (!plan || !plan.days.length || store.activeSession()) return wrap;

  const today = todaysDays(plan, done);
  if (!today.scheduled) return wrap;

  const trainedToday = done.some((s) => s.dayId
    && today.days.some((d) => d.id === s.dayId)
    && new Date(s.startedAt).toDateString() === new Date().toDateString());

  wrap.append(el('div.section-head', {}, [el('h2', { text: t('common.today') })]));

  if (!today.days.length) {
    wrap.append(el('div.card', {}, [
      el('div', { style: { fontWeight: '680' }, text: t('home.today.rest') }),
      el('div.small.muted', { style: { marginTop: '2px' },
        text: today.next
          ? t('home.today.next', { day: today.next.day.name, weekday: weekdayName(today.next.weekday) })
          : t('home.today.nothing') }),
    ]));
    return wrap;
  }

  for (const day of today.days) {
    wrap.append(
      el('div.card' + (trainedToday ? '' : '.glow'), {}, [
        el('div.row.between', { style: { gap: '12px' } }, [
          el('div.grow', {}, [
            el('div', { style: { fontWeight: '700', fontSize: '17px' }, text: day.name }),
            el('div.small.muted', {
              text: trainedToday
                ? t('home.today.done')
                : tn(day.items.length, 'unit.exercise'),
            }),
          ]),
          trainedToday
            ? el('span.pill.pr', { text: '✓' })
            : el('button.btn.primary.sm', {
                onclick: async () => {
                  const started = await requestWorkoutStart({ planId: plan.id, dayId: day.id });
                  if (!started) return;
                  navigate('train');
                },
              }, [t('home.today.start')]),
        ]),
      ])
    );
  }
  return wrap;
}

/* ==================== diese Woche gegen den Plan ==================== */

/**
 * Die Zahl, die die Planbewertung verspricht, gemessen an dem, was wirklich gemacht wurde.
 * Auf beiden Seiten dieselbe anteilige Zählung, warum das extra gesagt werden musste,
 * steht in js/log-analysis.js.
 */
function weekVsPlan(done) {
  const byId = store.state.exerciseById;
  const week = analyseWeek(store.state.sessions, byId);
  const plan = store.activePlan();
  const planned = plan && plan.days.some((d) => d.items.length)
    ? analysePlan(plan, byId)
    : null;

  const rows = compareToPlan(week, planned).slice(0, 8);
  const verdict = weekVerdict(week, rows, planned ? plan.days.length * (plan.perWeek || 1) : 0);
  const floor = THRESHOLDS.weeklyFloor.value;

  const wrap = el('div');
  wrap.append(el('div.section-head', {}, [
    el('h2', { text: t('home.vsPlan.title') }),
    plan ? el('button.btn.quiet.sm', { onclick: () => navigate('plans', plan.id) }, [t('home.vsPlan.plan')]) : null,
  ]));

  const card = el('div.card', {}, [
    el('div', {
      style: {
        fontWeight: '650', fontSize: '14px',
        color: verdict.tone === 'good' ? 'var(--good)' : verdict.tone === 'warn' ? 'var(--warn)' : 'var(--text-faint)',
      },
      text: verdict.headline,
    }),
    el('div.small.faint', { style: { marginTop: '2px' },
      text: planned
        ? t('home.vsPlan.target', { plan: plan.name, weight: THRESHOLDS.indirectSetWeight.value })
        : t('home.vsPlan.noPlan', { floor }) }),
  ]);

  if (!rows.length) {
    card.append(el('div.small.muted', { style: { marginTop: '10px' },
      text: t('home.vsPlan.nothing') }));
  }

  // Grün heißt "im Soll für die Stelle im Plan, an der man ist", nicht "fertig". Einen
  // Dienstag an der ganzen Woche zu messen würde bis Sonntag alles rot malen, und dann
  // bedeutet es nichts mehr.
  const pace = Math.max(0.15, verdict.pace);
  for (const r of rows) {
    const pct = Math.min(1, r.target > 0 ? r.ratio : 1);
    // Ein Muskel, den der Plan nie verlangt hat, hat kein Soll. Sein Verhältnis wird als 1
    // gemeldet, und das hat ihn früher im selben Grün gemalt wie ein wirklich getroffenes
    // Ziel. Volle Punktzahl für Arbeit, die niemand gemessen hat.
    const tone = r.target === 0
      ? 'var(--t0)'
      : r.ratio >= pace * 0.9
        ? 'linear-gradient(90deg, var(--good), #6EE7B7)'
        : r.ratio >= pace * 0.7
          ? 'linear-gradient(90deg, var(--accent), var(--accent-hi))'
          : 'var(--t0)';
    card.append(el('div.bar-row', { style: { marginTop: '8px' } }, [
      el('span.name', { text: tRegion(r.region) }),
      el('div.track', {}, [el('div.fill', { style: { width: `${Math.max(3, pct * 100)}%`, background: tone } })]),
      el('span.val', { text: r.target > 0 ? `${trimNum(r.done)}/${trimNum(r.target)}` : String(trimNum(r.done)) }),
    ]));
  }

  if (rows.some((r) => r.target === 0)) {
    card.append(el('div.small.faint', { style: { marginTop: '10px' },
      text: t('home.vsPlan.grey') }));
  }

  // Abdeckung der Anstrengung. Als Anteil und nicht als Durchschnitt, weil ein mittleres
  // RIR über Sätze, die man nie bewertet hat, eine ausgedachte Zahl wäre.
  if (week.totalSets) {
    card.append(el('div.small.faint', { style: { marginTop: '12px' },
      text: (week.effort.logged
        ? t('home.vsPlan.rir', {
            logged: week.effort.logged, total: week.totalSets,
            hard: Math.round(week.effort.hardShare * 100),
          })
        : t('home.vsPlan.noRir'))
        + ' ' + t('home.vsPlan.stretched', { pct: Math.round(week.longShare * 100) }) }));
  }

  wrap.append(card);
  return wrap;
}

const trimNum = (n) => (Number.isInteger(n) ? String(n) : fmtDecimal(n));

/* ======================= Ernährung ======================= */

/* ======================= Wertung ======================= */

function ratingSection(done, settings) {
  const wrap = el('div');

  if (!hasProfile(settings)) {
    wrap.append(
      el('div.card.glow', {}, [
        el('div', { style: { fontWeight: '680', marginBottom: '4px' }, text: t('home.rating.unlock') }),
        el('div.small.muted', { text: t('home.rating.unlockBody') }),
        el('button.btn.primary.full', { style: { marginTop: '12px' }, onclick: profileForm }, [t('home.rating.addDetails')]),
      ])
    );
    return wrap;
  }

  const best = bestOneRepMaxByName(store.state.sessions, store.state.exerciseById, store.state.settings);
  const machineNames = ratedMachineNames(store.state.exercises);
  const rating = buildRating(best, settings, {
    machineNames, community: machineCommunity, ...machineCorrections(),
    regionsByName: regionsFromExercises(store.state.exercises),
  });
  refreshMachineStandards(best, settings).catch(() => {});
  refreshRankPercentiles(rating, settings).catch(() => {});

  if (rating.overall === null) {
    wrap.append(
      el('div.card', {}, [
        el('div', { style: { fontWeight: '680', marginBottom: '4px' }, text: t('home.rating.none') }),
        el('div.small.muted', { text: t('home.rating.noneBody') }),
      ])
    );
    mapMode = 'progress';
    wrap.append(mapSection(rating));
    wrap.append(machineRecords(rating.lifts));
    return wrap;
  }

  const rank = rating.overallRank;
  const idx = rank.tierIndex;

  // Hier steht keine Zahl von 0 bis 100 mehr. Sie las sich wie ein Prozentwert, und ein
  // Prozentwert, der erst bei "über einem nationalen Rekord in jeder Muskelgruppe" voll ist,
  // hat eine obere Hälfte, die niemand je sieht. Ein ordentlicher Grandmaster fühlte sich
  // damit wie eine Fünf an. Der Rang sagt dasselbe mit einem Namen, und die Leiste darunter
  // sagt genau, wie weit man darin ist. Die Zahl gibt es weiterhin, und sie sortiert die
  // Rangliste, sie ist nur nicht mehr das, was jemandem entgegengerufen wird, der die App
  // öffnet, um sich übers Training zu freuen.
  const hero = el(`div.card.glow.tier-${idx}`, {}, [
    el('div.rating-hero', {}, [
      el('div.rank-hero-badge', {}, [rankBadge(idx, { size: 96, glow: true })]),
      // Eine Zeile, nicht zwei. Die Division allein in einer Zeile war eine einsame römische
      // Zahl unter einer Überschrift und sah aus wie ein verirrtes Zeichen, nicht wie ein Teil
      // des Namens, zu dem sie gehört.
      el('div.rank-hero-name', {}, [
        el('span', { text: tTier(rank.tier.key) }),
        el('span.rank-hero-division', { text: rank.division }),
      ]),
      el('div.rating-sub', {
        text: t('home.rating.overall', { rated: rating.ratedRegions, total: rating.totalRegions }),
      }),
    ]),
    // Was der Rang WERT ist, das sagt die Leiter allein nicht, und deshalb kommt es als
    // Zweites und nicht als Siebtes. Legend ist der neunte von zwölf Namen und wirkt für
    // alle, denen niemand gesagt hat, dass die drei darüber schon Wettkampfgebiet sind, wie
    // Mittelfeld. Siehe js/percentile.js.
    populationNote(rating.overall, settings.sex),
    rankTrack(rank, rating.overall),
    el('div.small.muted', { style: { marginTop: '12px' }, text: t(`tier.${rank.tier.key}.note`) }),
    percentileBar('overall'),
  ]);

  // Der Moment live, getrennt von der Zusammenfassung über acht Wochen darunter: der hier
  // kommt einmal, für eine Stufe, die gerade wirklich überschritten wurde.
  announceRankUp(rank);

  const change = recentRankChange(rating.overall, rating.ratedRegions);
  if (change) {
    hero.append(el(`div.rank-up${change.up ? '' : '.down'}`, {}, [
      el('span', { text: change.up ? '▲' : '▼', 'aria-hidden': 'true' }),
      el('div', {}, [
        el('div', { text: t(change.up ? 'home.rating.rankUp' : 'home.rating.rankDown', {
          from: rankName(change.from), to: rankName(change.to),
          weeks: tn(change.weeks, 'unit.week'),
        }) }),
        change.up ? null : el('div.small.faint', { style: { marginTop: '2px' },
          text: t(change.measuredMore ? 'home.rating.rankDownWider' : 'home.rating.rankDownWhy',
            { was: change.wasRegions, now: change.regions }) }),
      ]),
    ]));
  }

  wrap.append(hero);

  // Muskelkarte
  wrap.append(mapSection(rating));

  // stärkste und schwächste Übungen
  if (rating.lifts.length) {
    const shown = showAllLifts ? rating.lifts : rating.lifts.slice(0, RECORD_PREVIEW);
    wrap.append(el('div.section-head', {}, [el('h2', { text: t('home.rating.yourLifts') })]));
    for (const lift of shown) {
      const li = tierIndex(lift.score);
      wrap.append(
        // Übereinander, nicht in einer Zeile. Drei Spalten mussten sich 375 Pixel mit einem
        // Abzeichen und einem Wort wie GROSSMEISTER teilen, der Übungsname kam mit zwei Wörtern
        // pro Zeile heraus und das Ziel über drei Zeilen gebrochen. Der Name bekommt die
        // ganze Breite, alles andere steht darunter.
        el(`div.card.tight.tier-${li}`, {}, [
          el('div.row.between', { style: { gap: '10px', alignItems: 'flex-start' } }, [
            el('div.grow', { style: { fontWeight: '640', minWidth: '0' }, text: lift.name }),
            el('button.btn.quiet.sm', {
              style: { flex: 'none', marginTop: '-2px' },
              onclick: () => strengthDetailSheet(lift, settings),
              'aria-label': t('home.rating.explainLift', { name: lift.name }),
            }, [t('plans.details')]),
          ]),
          // Der Chip bekommt eine eigene Zeile. GROSSMEISTER II mit Abzeichen belegt 320 der
          // 343 verfügbaren Pixel, alles in derselben Zeile wird darübergedruckt.
          el('div', { style: { marginTop: '7px' } }, [rankChip(lift.rank)]),
          // Die nächste DIVISION ist die Zahl, die sich zu drucken lohnt: bei 36 Stufen kann der
          // nächste Rang vierzig Kilo entfernt sein, und ein Ziel, das man sich nicht vorstellen
          // kann, ist keins.
          el('div.row.between', { style: { gap: '10px', marginTop: '7px' } }, [
            el('span.small.faint', {
              text: lift.nextDivision
                ? t('home.rating.forTier', {
                    weight: fmtWeight(Math.round(lift.nextDivision.weight), store.units()),
                    tier: rankName({ tier: lift.nextDivision.tier, division: lift.nextDivision.division }),
                  })
                : t('home.rating.topTier'),
            }),
            el('span.small.faint', { style: { flex: 'none' },
              text: `e1RM ${fmtWeight(Math.round(lift.oneRepMax), store.units())}` }),
          ]),
          el('div.division-track', {},
            [el('i', { style: { width: `${Math.round(lift.rank.progress * 100)}%` } })]),
          outlierNotice(lift, settings),
          lift.extrapolated
            ? el('div.small', { style: { marginTop: '6px', color: 'var(--warn)' },
                text: t('home.rating.extrapolatedShort') })
            : null,
          populationNote(lift.score, settings.sex, { compact: true }),
          percentileLine(`lift:${lift.name}`),
          staleBestLabel(lift),
        ])
      );
    }
    add(wrap, showAllToggle(rating.lifts.length, showAllLifts, (v) => { showAllLifts = v; }));
  }

  wrap.append(machineRecords(rating.lifts));

  return wrap;
}

/**
 * Die Feier einmal auslösen, für eine Stufe, die wirklich gerade gewonnen wurde.
 *
 * Die Wertung wird bei jedem Zeichnen aus dem ganzen Log neu gebaut, es gibt also kein
 * Ereignis, an dem man das aufhängen könnte, die gespeicherte Stufe ist das Ereignis. Drei
 * Regeln verhindern, dass daraus Lärm wird:
 *
 *   * Ein Gerät, das noch nie eine Stufe gespeichert hat, bekommt nichts. Sonst würde jeder
 *     bestehende Nutzer beim ersten Öffnen der neuen Version beglückwünscht, für etwas,
 *     das Monate her ist.
 *   * Ein Abstieg wird still gespeichert. Das sagt das Banner, und zwar leiser als ein
 *     Overlay über den ganzen Bildschirm.
 *   * Mehrere Stufen auf einmal lösen trotzdem nur einmal aus und nennen, woher man kam,
 *     "drei Stufen aufgestiegen" ist ohnehin der bessere Satz.
 */
function announceRankUp(rank) {
  const seen = store.state.settings.lastSeenRankStep;
  // Ausdrücklich gegen null geprüft und nicht über Number(): Number(null) ist 0, und das ist
  // endlich. Ein Gerät, das nie eine Stufe gespeichert hatte, galt also als "war auf Stufe 0",
  // und jeder bestehende Nutzer wurde beim ersten Start für Arbeit von vor Monaten beglückwünscht.
  if (seen === null || seen === undefined || !Number.isFinite(Number(seen))) {
    store.setSetting('lastSeenRankStep', rank.step);
    return;
  }
  const from = Number(seen);
  if (rank.step <= from) {
    if (rank.step < from) store.setSetting('lastSeenRankStep', rank.step);
    return;
  }
  store.setSetting('lastSeenRankStep', rank.step);
  celebrateRankUp(rank, {
    title: `${tTier(rank.tier.key)} ${rank.division}`,
    subtitle: t(rank.step - from > 1 ? 'home.rating.rankUpNowMany' : 'home.rating.rankUpNow', {
      steps: rank.step - from, step: rank.step, steps_total: rank.steps,
    }),
    dismiss: t('common.close'),
  });
}

/**
 * Wie alt ein Bestwert sein muss, bevor die App zugibt, dass er Geschichte ist.
 *
 * Sechs Monate. Der Rang ist mit Absicht ein Rekord aller Zeiten und bleibt einer, weil
 * es schlimmer ist, etwas Verdientes wegzunehmen, als es spät zu zeigen. Aber eine Zahl
 * von vor drei Jahren als "deine Stärke" zu drucken ist auch eine Art Lüge. Danach behält
 * der Rekord also seinen Rang und bekommt ein Datum dazu.
 */
const STALE_BEST_DAYS = 182;

const round1 = (n) => Math.round(n * 10) / 10;

const bestAgeDays = (lift) =>
  lift.achievedAt ? Math.floor((Date.now() - lift.achievedAt) / 86400000) : null;

/** Das kurze Anhängsel an einer Übungszeile: "Bestwert von vor 14 Monaten". */
function staleBestLabel(lift) {
  const days = bestAgeDays(lift);
  if (days === null || days < STALE_BEST_DAYS) return null;
  return el('div.small.faint', { style: { marginTop: '2px' },
    text: t('home.rating.bestAge', { when: relMonths(days) }) });
}

/** Dieselbe Tatsache mit Begründung, im Detail-Sheet. */
function staleBestNote(lift) {
  const days = bestAgeDays(lift);
  if (days === null || days < STALE_BEST_DAYS) return null;
  return el('div.small', { style: { marginTop: '10px', color: 'var(--text-dim)' },
    text: t('home.rating.bestAgeNote', { when: relMonths(days) }) });
}

const relMonths = (days) => tn(Math.max(1, Math.round(days / 30.44)), 'unit.month');

/**
 * Die Korrekturen je Maschine, so geschlüsselt, wie die Wertung sie will.
 *
 * Pro Übungs-ID in der Maschineneinstellung gespeichert und nach Namen ausgelesen, weil
 * die Tabellen der Standards am Namen hängen. Nichts hier fasst einen eingetragenen Satz
 * an: es beschreibt, wie eine Maschine Last ANZEIGT, nicht was gehoben wurde.
 */
function machineCorrections() {
  const setups = store.state.settings.machineSetups || {};
  const loadFactors = {}, stackMax = {};
  for (const [id, setup] of Object.entries(setups)) {
    const ex = store.state.exerciseById.get(id);
    if (!ex) continue;
    if (Number(setup.loadFactor) > 0 && Number(setup.loadFactor) !== 1) loadFactors[ex.name] = Number(setup.loadFactor);
    if (Number(setup.stackMax) > 0) stackMax[ex.name] = Number(setup.stackMax);
  }
  return { loadFactors, stackMax };
}

/**
 * Wie gut ein Rang abgesichert ist.
 *
 * Der Rang ist die beste gezeigte Leistung und bleibt das. Hier steht deshalb ehrlich, was
 * man sonst raten müsste: ob drei Bewegungen sich einig sind oder eine allein ihn trägt,
 * und ob die Bewegungen, die sich einig sein sollten, es auch sind.
 */
function supportLine(info) {
  const drivers = Number(info.drivers) || 1;
  if (drivers < 2) {
    return el('div.small.faint', { style: { marginTop: '6px', textAlign: 'center' },
      text: t('home.region.oneDriver') });
  }
  const ranks = (Number(info.spread) || 0) / BAND;
  return el('div.small.faint', { style: { marginTop: '6px', textAlign: 'center' },
    text: ranks >= 1
      ? t('home.region.driversDisagree', { n: drivers, ranks: fmtDecimal(ranks) })
      : t('home.region.driversAgree', { n: drivers }) });
}

/**
 * "Jede davon würde ihn einstufen", nur mit Bewegungen, die es in dieser Bibliothek gibt.
 *
 * Gegen die eigenen Übungen gefiltert und nicht gegen die ganze gepflegte Tabelle: eine
 * Maschine zu nennen, die das eigene Studio nicht hat, ist schlimmer, als nichts zu nennen.
 */
function unlockList(region) {
  const names = store.state.exercises
    .filter((ex) => canRank(ex.name, region))
    // Der stärkste Treiber zuerst, dann der kürzeste Name. Der Katalog ist voll von Einträgen
    // wie "Bosu Ball Cable Crunch With Side Bends", und mit so einem angefangen klingt eine
    // gute Idee lächerlich.
    .sort((a, b) => drivesRegion(b.name, region) - drivesRegion(a.name, region)
      || a.name.length - b.name.length)
    .map((ex) => ex.name)
    .slice(0, 4);
  if (!names.length) return null;
  return el('div', { style: { marginTop: '14px' } }, [
    el('div.small.faint', { text: t('home.region.unlock') }),
    ...names.map((name) => el('div.small', { style: { marginTop: '4px', fontWeight: '620' }, text: `·  ${name}` })),
  ]);
}

/** Die Zeile "diese passt nicht dazu", mit der Lösung gleich dabei. */
function outlierNotice(lift, settings) {
  if (settings.outlierHints === false) return null;
  // Nur Maschinen und Kabel. Jede Ursache, die das Sheet erklärt, betrifft, wie eine
  // Maschine Last anzeigt, und "die Hälfte zählen" bei Kniebeugen mit der Langhantel oder
  // Klimmzügen anzubieten hieße, das Log falsch zu machen.
  if (!lift.machine) return null;
  if (!lift.outlier && !lift.overStack) return null;
  const ex = store.state.exercises.find((e) => e.name === lift.name);
  if (!ex) return null;

  const line = lift.overStack
    ? t('home.rating.overStack', {
        times: fmtDecimal(lift.overStack.times),
        max: fmtWeight(lift.overStack.max, store.units()),
      })
    : t('home.rating.outlier', { ranks: Math.floor(lift.outlier.ranks) });

  return el('div.outlier', {}, [
    el('div.small', { text: `!  ${line}` }),
    el('button.btn.quiet.sm', { style: { padding: '4px 0', marginTop: '2px' },
      onclick: () => loadCorrectionSheet(ex, lift) }, [t('home.rating.outlierFix')]),
  ]);
}

/**
 * Der App sagen, was die Zahl an dieser Maschine bedeutet.
 *
 * Absichtlich eine Korrektur der ANZEIGE, nicht des Logs. Einen eingetragenen Satz zu
 * halbieren würde umschreiben, was jemand wirklich gemacht hat, und der eigene Verlauf
 * würde der eigenen Erinnerung widersprechen. Die Deutung zu halbieren ändert nur den
 * Vergleich mit einem Standard, und genau der war falsch.
 */
function loadCorrectionSheet(ex, lift) {
  const setup = store.state.settings.machineSetups?.[ex.id] || {};
  const stack = normaliseOnBlur(numberInput({
    decimal: true, value: setup.stackMax ?? '', placeholder: t('home.rating.stackPlaceholder'),
    'aria-label': t('home.rating.stackMax'),
  }));
  const factorInput = normaliseOnBlur(numberInput({
    decimal: true, value: setup.loadFactor ?? '', placeholder: '1',
    'aria-label': t('home.rating.loadFactor'),
  }));

  const save = async (factor) => {
    const setups = { ...(store.state.settings.machineSetups || {}) };
    const next = { ...(setups[ex.id] || {}) };
    const chosen = factor ?? parseNumber(factorInput.value);
    next.loadFactor = Number(chosen) > 0 && Number(chosen) !== 1 ? Number(chosen) : null;
    const max = parseNumber(stack.value);
    next.stackMax = Number(max) > 0 ? Number(max) : null;
    if (Object.values(next).some(Boolean)) setups[ex.id] = next;
    else delete setups[ex.id];
    await store.setSetting('machineSetups', setups);
    closeSheet();
    toast(t('home.rating.outlierSaved'));
  };

  openSheet(ex.name, el('div', {}, [
    el('div.small.muted', { text: t('home.rating.outlierBody') }),
    el('div.card.tight', { style: { marginTop: '12px' } }, [
      el('div.row.between.small', {}, [
        el('span', { text: t('home.rating.outlierCurrent') }),
        el('strong.num', { text: `e1RM ${fmtWeight(Math.round(lift.oneRepMax), store.units())}` }),
      ]),
      el('div.row.between.small', { style: { marginTop: '6px' } }, [
        el('span', { text: t('home.rating.outlierRank') }),
        el('strong', { text: rankName(lift.rank) }),
      ]),
    ]),
    el('button.btn.primary.full', { style: { marginTop: '14px' }, onclick: () => save(0.5) },
      [t('home.rating.outlierHalve')]),
    el('div.small.faint', { style: { marginTop: '6px' }, text: t('home.rating.outlierHalveNote') }),

    // Kein Feld für den Block bei einer Stange mit Scheiben, da gibt es keinen Block mit Maximum.
    lift.plateLoaded ? null : el('label.field', { style: { marginTop: '16px' } }, [
      el('span', { text: t('home.rating.stackMax', { units: store.units() }) }), stack,
      el('small', { text: t('home.rating.stackMaxNote') }),
    ]),
    el('label.field', {}, [
      el('span', { text: t('home.rating.loadFactor') }), factorInput,
      el('small', { text: t('home.rating.loadFactorNote') }),
    ]),
    el('button.btn.ghost.full', { onclick: () => save(null) }, [t('common.save')]),
    setup.loadFactor || setup.stackMax
      ? el('button.btn.quiet.full', { style: { marginTop: '6px' }, onclick: async () => {
          const setups = { ...(store.state.settings.machineSetups || {}) };
          if (setups[ex.id]) { setups[ex.id] = { ...setups[ex.id], loadFactor: null, stackMax: null }; }
          if (!Object.values(setups[ex.id] || {}).some(Boolean)) delete setups[ex.id];
          await store.setSetting('machineSetups', setups);
          closeSheet();
          toast(t('home.rating.outlierCleared'));
        } }, [t('home.rating.outlierClear')])
      : null,
  ]));
}

/* ===================== die Rangleiter auf dem Screen ===================== */

/** "Diamond II" als ein Chip, in der Farbe des Rangs. */
function rankChip(rank, { badge = true } = {}) {
  if (!rank) return null;
  return el(`span.tier-chip.tier-${rank.tierIndex}${badge ? '.with-badge' : ''}`, {}, [
    badge ? rankBadge(rank.tierIndex, { size: 17 }) : null,
    tTier(rank.tier.key),
    el('span.div-mark', { text: rank.division }),
  ]);
}

/** Dasselbe als einfacher Text, für Zeilen, die schon einen Chip haben. */
function rankName(rank) {
  return rank ? `${tTier(rank.tier.key)} ${rank.division}` : '';
}

/**
 * Wo man steht, was als Nächstes kommt und wie weit es ist.
 *
 * Das hat einen Streifen mit einer Kerbe pro Stufe ersetzt. Bei neun Rängen waren das 27
 * Kerben und schon dünn, bei zwölf wären es 36 Splitter mit drei Pixeln Breite, eine
 * Textur und keine Skala. Ein Abschnitt pro RANG ist lesbar, und die teilweise Füllung des
 * aktuellen Abschnitts zeigt die Division, durch den Wegfall des feineren Streifens geht
 * also nichts verloren.
 *
 * Die Abzeichen machen daraus eine Leiter und keinen Fortschrittsbalken: das, das man hat,
 * und das, auf das man hinarbeitet, nebeneinander.
 */
function rankTrack(rank, score) {
  const nextRank = rank.tierIndex < TIERS.length - 1 ? rank.tierIndex + 1 : null;
  const nextStep = nextStepScore(score);
  const target = rankOf(nextStep + 0.0001);

  const bar = el('div.rank-rail', { 'aria-hidden': 'true' });
  for (let i = 0; i < TIERS.length; i++) {
    const fill = i < rank.tierIndex ? 1 : i === rank.tierIndex ? divisionFill(rank) : 0;
    bar.append(el(`div.rank-rail-seg.tier-${i}${i === rank.tierIndex ? '.now' : ''}`, {},
      [el('i', { style: { width: `${Math.round(fill * 100)}%` } })]));
  }

  return el('div.rank-track', {}, [
    el('div.rank-track-head', {}, [
      el(`div.rank-track-now.tier-${rank.tierIndex}`, {}, [
        el('div', {}, [
          el('div.rank-track-step', {
            text: t('home.rating.stepOnly', { step: rank.step, steps: rank.steps }),
          }),
        ]),
      ]),
      // Kein "als Nächstes:". Das hat zwei umgebrochene Zeilen gekostet und nichts gesagt, was
      // Pfeil und Position nicht schon sagen.
      rank.top ? null : el(`div.rank-track-next.tier-${target.tierIndex}`, {}, [
        el('span.rank-track-arrow', { text: '→', 'aria-hidden': 'true' }),
        rankBadge(nextRank === null ? rank.tierIndex : target.tierIndex, { size: 26 }),
        el('span.rank-track-goal-name', { text: rankName(target) }),
      ]),
    ]),
    bar,
    // Wie weit man in der aktuellen Stufe ist, in Prozent. Früher stand hier der rohe Abstand
    // auf der Skala von 0 bis 100 ("1.0 bis Grandmaster I"), also genau die Zahl, die die
    // Karte darüber absichtlich nicht mehr zeigt, jetzt sogar ohne die Skala, die sie lesbar
    // gemacht hätte. Ein Punkt von hundert ist der Großteil einer Division, und nichts auf dem
    // Screen hat das gesagt.
    el('div.small.faint', { style: { marginTop: '7px', textAlign: 'right' },
      text: rank.top ? t('home.rating.ladderTop') : t('home.rating.toNextStep', {
        pct: Math.max(1, Math.min(99, Math.round(rank.progress * 100))), rank: rankName(target),
      }) }),
  ]);
}

/** Wie viel vom Abschnitt des aktuellen Rangs eingefärbt ist: die Division. */
function divisionFill(rank) {
  return (rank.divisionIndex + rank.progress) / DIVISIONS.length;
}

/** Die Wertung, bei der die nächste Division anfängt. */
function nextStepScore(score) {
  const step = Math.floor(score / (BAND / DIVISIONS.length)) + 1;
  return Math.min(100, step * (BAND / DIVISIONS.length));
}

/**
 * Eine Stufe, die in den letzten acht Wochen gewonnen oder verloren wurde, oder null.
 *
 * Mit Absicht ein Blick zurück und keine Feier live: die Wertung wird bei jedem Zeichnen
 * aus dem ganzen Log neu gebaut, "du bist gerade aufgestiegen" käme also bei jedem
 * Neuzeichnen wieder. Mit dem Stand von vor acht Wochen zu vergleichen sagt dasselbe
 * einmal, ruhig, und sagt es weiter, solange es stimmt.
 *
 * Es meldet auch einen Abstieg, und da muss man vorsichtig sein. Eine Leiter, die nur gute
 * Nachrichten verkündet, ist eine Anzeigetafel, der niemand glaubt. Ein Abstieg ist aber
 * meistens ein verändertes Körpergewicht oder acht Wochen Krankheit und kein Urteil über
 * jemanden. Er wird also nüchtern gesagt, mit denselben Worten und ohne eine Farbe, die
 * wie eine Rüge wirkt.
 */
function recentRankChange(currentScore, ratedNow = null) {
  const weeks = 8;
  const then = strengthAt(store.state.sessions, store.state.bodyweight, store.state.settings,
    store.state.exerciseById, Date.now() - weeks * 7 * 86400000, machineCorrections());
  if (!then || then.overall === null) return null;
  const from = rankOf(then.overall), to = rankOf(currentScore);
  if (!from || !to || to.step === from.step) return null;
  // Ob der Durchschnitt jetzt über mehr Muskelgruppen gebildet wird als vorher.
  //
  // Das ist die ehrliche Antwort auf eine völlig berechtigte Beschwerde: man trägt zum ersten
  // Mal Schulterdrücken ein, stellt fest, dass die vordere Schulter zwei Ränge hinter allem
  // anderen liegt, und die Gesamtwertung fällt. Die App scheint einen fürs Messen bestraft zu
  // haben. Hat sie nicht. Die Zahl ist gefallen, weil sie genauer geworden ist, und falsch war
  // nur, dass der Screen als einzige Erklärung das Körpergewicht angeboten und einen die
  // andere hat selbst schließen lassen.
  const measuredMore = ratedNow !== null && then.ratedRegions !== undefined
    && ratedNow > then.ratedRegions;
  return { from, to, weeks, up: to.step > from.step, steps: Math.abs(to.step - from.step),
    measuredMore, regions: ratedNow, wasRegions: then.ratedRegions };
}

function machineRecords(lifts) {
  // Die Übung hinter dem Namen kann fehlen: der Rang übersteht eine Umbenennung oder eine
  // gelöschte eigene Übung, und diese Liste wird über den Namen abgeglichen, nicht über die
  // ID. Bevor sich die Liste aufklappen ließ, kam man da schwer hin, bei über zwanzig
  // Maschinen nicht mehr, und ein undefined `ex` hier reißt den ganzen Home-Screen mit.
  const all = lifts.filter((lift) => lift.machine)
    .map((lift) => ({ ...lift, ex: store.state.exercises.find((e) => e.name === lift.name) }))
    .sort((a, b) => b.score - a.score);
  const records = showAllMachines ? all : all.slice(0, RECORD_PREVIEW);
  const wrap = el('div');
  if (!all.length) return wrap;
  wrap.append(el('div.section-head', {}, [el('h2', { text: t('home.rating.machineRecords') })]));
  for (const row of records) {
    const profile = row.ex ? store.state.settings.machineProfiles?.[row.ex.id] : null;
    wrap.append(el('div.card.tight', {}, [
      el('div.row.between', {}, [
        el('div', {}, [
          el('div', { style: { fontWeight: '640' }, text: row.name }),
          el('div.small.faint', { text: t(row.provisional ? 'home.rating.machineEstimated' : 'home.rating.machineCommunity', { n: row.sample }) }),
          profile?.label ? el('div.small', { text: profile.label }) : null,
        ]),
        el('div', { style: { textAlign: 'right' } }, [
          rankChip(row.rank),
          el('div.small.faint', { text: `e1RM ${fmtWeight(Math.round(row.oneRepMax), store.units())}` }),
          row.ex ? el('button.btn.quiet.sm', {
            onclick: () => machineProfileSheet(row.ex),
            'aria-label': profile?.model
              ? t('home.rating.machineDetails')
              : t('home.rating.machineDetailsMissing'),
            style: profile?.model ? {} : { color: 'var(--warn)', fontWeight: '750' },
          }, [`${t('plans.details')}${profile?.model ? '' : '  !'}`]) : null,
        ]),
      ]),
    ]));
  }
  add(wrap, showAllToggle(all.length, showAllMachines, (v) => { showAllMachines = v; }));
  return wrap;
}

function strengthDetailSheet(lift, profile) {
  const absolute = fmtWeight(Math.round(lift.oneRepMax), store.units());
  const bodyweight = fmtWeight(Number(profile.bodyweight), store.units());
  const body = el('div', {}, [
    el('div.card.glow', {}, [
      el('div.row.between', {}, [el('span', { text: t('home.rating.absolute') }), el('strong.num', { text: absolute })]),
      el('div.row.between', { style: { marginTop: '8px' } }, [el('span', { text: t('home.rating.relative') }), el('strong.num', { text: String(Math.round(lift.score)) })]),
      el('div.row.between', { style: { marginTop: '8px' } }, [el('span', { text: t('home.bodyweight.title') }), el('strong.num', { text: bodyweight })]),
    ]),
    el('div.small.muted', { style: { marginTop: '12px' }, text: t('home.rating.calculationNote') }),
    staleBestNote(lift),
    lift.extrapolated
      ? el('div.small', { style: { marginTop: '10px', color: 'var(--warn)' },
          text: `!  ${t('home.rating.extrapolated', { reps: THRESHOLDS.e1rmWindow.high })}` })
      : null,
    el('div.small.faint', { style: { marginTop: '8px' }, text: t('home.rating.heightNote') }),
  ]);
  openSheet(lift.name, body);
}

function machineProfileSheet(ex) {
  const current = store.state.settings.machineProfiles?.[ex.id] || {};
  const oldModel = `${current.model || ''} ${current.label || ''}`.toLowerCase();
  const selectedBrand = oldModel.includes('hammer') ? 'hammer-strength' : 'gym80';
  const model = el('select', {}, [
    el('option', { value: 'gym80', selected: selectedBrand === 'gym80' }, ['Gym80']),
    el('option', { value: 'hammer-strength', selected: selectedBrand === 'hammer-strength' }, ['Hammer Strength']),
  ]);
  const share = el('input', { type: 'checkbox', checked: !!current.shareComparison });
  openSheet(ex.name, el('div', {}, [
    el('div.small.muted', { style: { marginBottom: '12px' }, text: t('home.rating.machineProfileNote') }),
    el('div.card.tight', { style: { marginBottom: '12px' } }, [
      el('div.small.faint', { text: t('home.rating.machineGym') }),
      el('strong', { text: 'Ai Fitness' }),
    ]),
    el('label.field', {}, [el('span', { text: t('home.rating.machineModel') }), model]),
    el('label.check', {}, [share, el('span', {}, [el('strong', { text: t('home.rating.machineShare') }),
      el('small', { text: t('home.rating.machineShareNote') })])]),
    el('button.btn.primary.full', { onclick: async () => {
      const profiles = { ...(store.state.settings.machineProfiles || {}) };
      const modelName = model.value;
      const willShare = share.checked;
      profiles[ex.id] = { model: modelName, shareComparison: willShare };
      await store.setSetting('machineProfiles', profiles);
      machineSyncSignature = null;
      if (!willShare && cloud.isSignedIn()) await cloud.removeMachineRecord(ex.name).catch(() => {});
      closeSheet();
      toast(t('home.rating.machineSaved'));
    } }, [t('common.save')]),
  ]));
}

/**
 * Die aktuellen Ränge beisteuern und die Verteilung drumherum abholen.
 *
 * Was das Gerät verlässt, ist eine Liste von Werten zwischen 0 und 100 zu festen
 * Schlüsseln. Kein Gewicht, keine Wiederholungen, keine selbst erfundene Übung, keine
 * Identität: eine Wertung ist schon durchs Körpergewicht geteilt und nach Geschlecht und
 * Alter angepasst, sie sagt also viel weniger über eine Person als "142,5 kg". Ohne
 * `shareRankComparison` geht gar nichts raus, und `forgetRankScores` nimmt alles zurück.
 *
 * Dieselbe Form wie refreshMachineStandards, samt Schutz über die Signatur, weil das in
 * einem Zeichnen läuft, das bei jedem Tastendruck irgendwo in der App kommen kann.
 */
async function refreshRankPercentiles(rating, settings) {
  if (rankSyncing || !settings.shareRankComparison || !cloud.isSignedIn() || !navigator.onLine) return;
  if (rating.overall === null) return;

  const entries = [{ key: 'overall', score: round1(rating.overall) }];
  // Nur Referenzübungen über den Namen. Eine eigene Übung namens "Chest Day Finisher" wäre
  // eine Gruppe aus einer Person, und ihr Name wäre genau das, woran man sie erkennt.
  for (const lift of rating.lifts) {
    if (!isBenchmark(lift.name) || lift.extrapolated) continue;
    entries.push({ key: `lift:${lift.name}`, score: round1(lift.score) });
  }
  for (const [region, info] of Object.entries(rating.regions)) {
    entries.push({ key: `region:${region}`, score: round1(info.score) });
  }
  // Der Server nimmt 40 pro Aufruf. Regionen plus Referenzübungen passen, aber die Grenze
  // wird auch hier eingehalten und nicht erst als Exception entdeckt.
  const payload = entries.slice(0, 40);

  const signature = JSON.stringify(payload);
  if (signature === rankSyncSignature) return;
  rankSyncing = true;
  try {
    const result = await cloud.shareRankScores(payload);
    rankPercentiles = result && typeof result === 'object' ? result : {};
    rankSyncSignature = signature;
    if (location.hash.replace(/^#\/?/, '').split('/')[0] === 'home') (await import('../app.js')).render();
  } catch {
    // Ein älterer Server ohne Patch 016 darf nicht bei jedem Zeichnen neu gefragt werden.
    // Ein Neuladen nach dem Einspielen startet einen frischen Versuch.
    rankSyncSignature = signature;
  } finally { rankSyncing = false; }
}

/** "62 % der Leute, die das eintragen, liegen unter dir", oder null. */
function percentileLine(key) {
  const stats = rankPercentiles[key];
  if (!stats || !Number.isFinite(Number(stats.below))) return null;
  return el('div.small.faint', { style: { marginTop: '2px' },
    text: t('home.rank.below', { pct: Math.round(Number(stats.below)), n: Number(stats.count) }) });
}

/**
 * Dieselbe Tatsache mit einem Balken darunter, für die zwei Stellen, die Platz dafür haben.
 *
 * Ein Balken statt einer größeren Zahl, weil es um die Lage IN EINER VERTEILUNG geht, und
 * eine Verteilung ist eine Form. Die Markierung ist eine Position, keine Wertung: nichts
 * hier wird gegen eine benannte Person geordnet, und es gibt niemanden, über dem man steht.
 */
function percentileBar(key) {
  const stats = rankPercentiles[key];
  if (!stats || !Number.isFinite(Number(stats.below))) return null;
  const pct = Math.max(0, Math.min(100, Math.round(Number(stats.below))));
  return el('div', { style: { marginTop: '12px' } }, [
    el('div.percentile', { 'aria-hidden': 'true' }, [
      el('i', { style: { width: `${pct}%` } }),
      el('b', { style: { left: `${pct}%` } }),
    ]),
    el('div.small.faint', { style: { marginTop: '6px' },
      text: t('home.rank.below', { pct, n: Number(stats.count) }) }),
  ]);
}

async function refreshMachineStandards(best, settings) {
  if (machineSyncing || !cloud.isSignedIn() || !navigator.onLine) return;
  const candidates = store.state.exercises.flatMap((ex) => {
    const profile = settings.machineProfiles?.[ex.id];
    const oneRepMax = best.get(ex.name);
    return RATED_EQUIPMENT.has(ex.equipment) && profile?.shareComparison && profile.model && oneRepMax
      ? [{ ex, profile, oneRepMax }] : [];
  });
  const signature = JSON.stringify(candidates.map(({ ex, profile, oneRepMax }) => [ex.name, profile.model, oneRepMax]));
  if (signature === machineSyncSignature) return;
  machineSyncing = true;
  try {
    const next = { ...machineCommunity };
    for (const { ex, profile, oneRepMax } of candidates) {
      const normalized = profile.model.trim().toLowerCase().replace(/\s+/g, ' ');
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
      const hash = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const ratio = strengthRatio(oneRepMax, settings) / ageFactor(settings.age);
      const result = await cloud.shareMachineRecord(hash, ex.name, ratio, settings.sex);
      if (result) next[ex.name] = result;
    }
    machineCommunity = next;
    machineSyncSignature = signature;
    if (location.hash.replace(/^#\/?/, '').split('/')[0] === 'home') (await import('../app.js')).render();
  } catch {
    // Ein älterer Server ohne Patch 013 darf nicht bei jedem Zeichnen bombardiert werden. Ein
    // Neuladen nach dem Einspielen startet einen frischen Versuch.
    machineSyncSignature = signature;
  } finally { machineSyncing = false; }
}

/**
 * Die Muskelkarte, auf zwei Arten.
 *
 * "Stärke" ist die Stufenkarte: wie man im Vergleich zu veröffentlichten Standards steht.
 * Sie färbt nur Regionen, die eine Referenzübung trainiert, und das wird auch so bleiben.
 * Es gibt etwa siebzehn Übungen mit Standards, die sich lohnen, und keinen ehrlichen Weg,
 * eine Brustpresse an der Maschine auf diese Liste zu setzen.
 *
 * "Fortschritt" beantwortet die andere Hälfte: wird man stärker, gemessen an sich selbst.
 * Dafür braucht es keinen Standard, jede eingetragene Übung zählt, und das ist die Karte,
 * die eine Einheit an Maschinen wirklich abbildet. Zwei Skalen, nie gemischt, jede mit
 * eigener Legende.
 */
function mapSection(rating) {
  const wrap = el('div');
  const host = el('div');
  const done = store.state.sessions.filter((s) => s.finishedAt);

  const seg = el('div.seg', { style: { marginBottom: '12px' } },
    [['strength', t('home.map.strength')], ['progress', t('home.map.progress')]].map(([key, label]) =>
      el('button', {
        'aria-pressed': String(mapMode === key),
        onclick: (e) => {
          mapMode = key;
          [...e.target.parentElement.children].forEach((b, i) =>
            b.setAttribute('aria-pressed', String(['strength', 'progress'][i] === key)));
          paint();
        },
      }, [label])
    )
  );

  function paint() {
    if (mapMode === 'strength') {
      // Eingestufte Regionen in ihrer Rangfarbe, trainierte, aber nicht eingestufte in einem
      // gedämpften Grau. Eine indirekt trainierte Region in einer Rangfarbe zu malen hat aus
      // "du hast gerudert" ein "dein Trapez ist Diamond" gemacht.
      const fills = { ...rating.regions };
      // Sichtbar grau, nicht unsichtbar: es geht darum, dass die App diesen Muskel erreicht,
      // ihn aber nicht messen kann, und das ist etwas anderes als ihn nie zu treffen.
      for (const region of Object.keys(rating.indirect)) fills[region] = 'var(--text-faint)';
      host.replaceChildren(
        bodyMap(fills, { onSelect: (region) => regionSheet(region, rating) }),
        tierLegend(),
        rating.indirectRegions
          ? el('div.small.faint', { style: { marginTop: '8px' },
              text: t('home.map.indirectNote', { n: rating.indirectRegions }) })
          : null,
        el('div.small.faint', { style: { marginTop: '8px' }, text: t('home.map.strengthNote') })
      );
      return;
    }

    const prog = regionProgress(done, store.state.exerciseById, { weeks: 12 });
    const lit = Object.keys(prog).length;
    host.replaceChildren(
      bodyMap(progressFills(prog), { onSelect: (region) => progressSheet(region, prog[region]) }),
      el('div.legend', {}, [
        el('span', {}, [el('b', { style: { background: 'var(--t4)' } }), t('home.map.up')]),
        el('span', {}, [el('b', { style: { background: 'var(--t1)' } }), t('home.map.flat')]),
        el('span', {}, [el('b', { style: { background: 'var(--t0)' } }), t('home.map.down')]),
      ]),
      el('div.small.faint', { style: { marginTop: '8px' },
        text: t(lit ? 'home.map.progressNote' : 'home.map.progressEmpty') })
    );
  }

  paint();
  wrap.append(el('div.section-head', {}, [el('h2', { text: t('home.map.title') })]), seg, el('div.card', {}, [host]));
  return wrap;
}

function progressSheet(region, p) {
  openSheet(tRegion(region), el('div', {}, [
    el('div.small.muted', { text: describeRegion(region, p) }),
    p && p.best
      ? el('div.card.tight', { style: { marginTop: '12px' } }, [
          el('div.small', { style: { fontWeight: '650' }, text: p.best.name }),
          el('div.small.faint', { style: { marginTop: '2px' },
            text: t('home.map.e1rmRange', {
              from: fmtWeight(Math.round(p.best.from), store.units()),
              to: fmtWeight(Math.round(p.best.to), store.units()),
            }) }),
        ])
      : null,
    el('div.section-head', {}, [el('h2', { text: t('home.map.whatThisIs') })]),
    el('div.small.muted', { text: t('home.map.whatThisIsBody') }),
    el('div.small.faint', { style: { marginTop: '8px' }, text: t('home.map.flatIsFine') }),
  ]));
}

function regionSheet(region, rating) {
  const label = tRegion(region);
  const info = rating.regions[region];

  const body = el('div', {}, [
    info
      ? el(`div.tier-${tierIndex(info.score)}`, {}, [
          // Der Rang, nicht die Zahl. Aus demselben Grund wie auf Home: eine Wertung von
          // hundert, deren oberes Ende niemand erreicht, liest sich wie eine Note von hundert.
          el('div.rating-hero', { style: { paddingBottom: '10px' } }, [
            el('div.rank-hero-badge', {}, [rankBadge(tierIndex(info.score), { size: 58, glow: true })]),
            el('div.rank-hero-name', { style: { fontSize: '24px' } }, [
              el('span', { text: tTier(rankOf(info.score).tier.key) }),
              el('span.rank-hero-division', { text: rankOf(info.score).division }),
            ]),
          ]),
          el('div.small.muted', { style: { textAlign: 'center' }, text: t('home.region.via', { lift: info.via }) }),
          supportLine(info),
          populationNote(info.score, store.state.settings.sex),
          percentileBar(`region:${region}`),
          info.machine ? el('div.small.faint', { style: { marginTop: '8px', textAlign: 'center' },
            text: t(info.provisional ? 'home.region.machineEstimated' : 'home.region.machineCommunity', { n: info.sample }) }) : null,
          info.extrapolated ? el('div.small', { style: { marginTop: '8px', textAlign: 'center', color: 'var(--warn)' },
            text: t('home.rating.extrapolated', { reps: THRESHOLDS.e1rmWindow.high }) }) : null,
          LOW_CONFIDENCE[info.via]
            ? el('div.small', { style: { marginTop: '10px', color: 'var(--warn)' },
                text: `!  ${t(LOW_CONFIDENCE[info.via])}` })
            : null,
        ])
      : el('div', {}, [
          el('div.small.muted', {
            text: rating.indirect[region]
              ? t('home.region.indirect', { muscle: label, lift: rating.indirect[region].via })
              : t('home.region.noBenchmark', { muscle: label }),
          }),
          rating.indirect[region]
            ? el('div.small.faint', { style: { marginTop: '8px' }, text: t('home.region.indirectWhy') })
            : null,
          // Ein grauer Muskel ist keine Sackgasse, und die App soll niemanden raten lassen,
          // welche Bewegung ihn freischaltet.
          unlockList(region),
        ]),
    el('div.section-head', {}, [el('h2', { text: t('home.region.tierScale') })]),
    // Hier standen früher die Punktbereiche. Seit die Wertung nirgends mehr gezeigt wird,
    // bezogen sie sich auf eine Zahl, die niemand sieht. Die Leiter zeigt stattdessen, wo
    // dieser Muskel auf ihr steht.
    el('div', {}, TIERS.map((tier, i) => {
      const here = info && tierIndex(info.score) === i;
      return el(`div.row.between.tier-${i}`, {
        style: { padding: '7px 0', borderBottom: '1px solid var(--line-soft)', opacity: here ? '1' : '.55' },
      }, [
        // .with-badge versteckt den Punkt des Chips, sonst hat die Zeile einen Punkt und ein
        // Schild und liest sich wie zwei Markierungen für eine Sache.
        el('span.tier-chip.with-badge', {}, [rankBadge(i, { size: 15 }), tTier(tier.key)]),
        here ? el('span.small', { style: { color: 'var(--tier)', fontWeight: '700' },
          text: t('home.region.youAreHere') }) : null,
      ]);
    })),
  ]);

  openSheet(label, body);
}
