// Home — overall strength rating, the muscle map, and training-at-a-glance.

import {
  el, fmtNum, fmtWeight, fmtDate, fmtDuration, emptyState, listItem,
  openSheet, closeSheet, toast, confirmSheet,
} from '../ui.js';
import * as store from '../store.js';
import * as cloud from '../cloud.js';
import {
  bestOneRepMaxByName, isCounted, startOfWeek, weeklyMuscleSets, sessionStats,
} from '../models.js';
import {
  buildRating, hasProfile, TIERS, DIVISIONS, RANK_STEPS, BAND, tierIndex, rankOf,
  LOW_CONFIDENCE, strengthRatio, ageFactor, ratedMachineNames, RATED_EQUIPMENT, isBenchmark,
} from '../standards.js';
import { strengthAt } from '../history.js';
import { rankBadge, celebrateRankUp } from '../rank-art.js';
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

// Which map the user last looked at. Module-level so switching tabs and coming
// back does not silently reset it.
let mapMode = 'strength';
let machineCommunity = {};
let machineSyncSignature = null;
let machineSyncing = false;

// Where each rank sits among everyone who logs the same thing. Keyed the way
// the server keys it: 'overall', 'lift:<name>', 'region:<id>'.
let rankPercentiles = {};
let rankSyncSignature = null;
let rankSyncing = false;

/** Drop the cached distribution when the opt-in is withdrawn mid-session. */
export function resetRankComparison() {
  rankPercentiles = {};
  rankSyncSignature = null;
}

export default function renderHome({ actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': t('common.settings') }, ['⚙']));

  const root = el('div');
  const done = store.state.sessions.filter((s) => s.finishedAt);
  const s = store.state.settings;

  // ---------- storage failure ----------
  // Above everything else, including a workout in progress: if writes are
  // failing, nothing else on this screen can be trusted to survive the night.
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

  // ---------- active workout nudge ----------
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
  // A workout nobody closed is not "in progress" — and until it is dealt with,
  // starting a new one silently reopens this one instead.
  if (stale) root.append(staleCard(stale));

  if (s.regenerationEnabled) root.append(regenerationCard());

  // ---------- backup nudge ----------
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

  // ---------- rating ----------
  if (s.showRatings) {
    root.append(ratingSection(done, s));
  }

  // ---------- this week ----------
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

  // ---------- what's on today ----------
  root.append(todayCard(done));

  // ---------- done vs planned ----------
  root.append(weekVsPlan(done));

  // ---------- weekly workload ----------
  const buckets = weeklyMuscleSets(done, store.state.exerciseById, 10);
  root.append(el('div.section-head', {}, [
    el('h2', { text: t('home.workload.title') }),
    // The Progress tab has no slot on the tab bar, so every section that hints
    // at a trend needs to offer the way in.
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

  // ---------- bodyweight ----------
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

  // ---------- recent ----------
  root.append(el('div.section-head', {}, [
    el('h2', { text: t('home.recent.title') }),
    el('button.btn.quiet.sm', { onclick: () => navigate('calendar') }, [`${t('route.calendar')} ›`]),
  ]));
  for (const x of done.slice(0, 3)) {
    const st = sessionStats(x);
    root.append(listItem({
      title: x.name,
      sub: `${fmtDate(x.startedAt)} · ${tn(st.sets, 'unit.set')} · ${fmtNum(st.volume)}${store.units()}`,
      onclick: () => navigate('calendar', x.id),
    }));
  }

  // ---------- the two screens without a tab ----------
  // Five tabs is the ceiling a thumb can aim at, and Food earned one by being a
  // several-times-a-day screen. Calendar and Progress are both weekly reads, so
  // they live here instead — but they have to be *visible*, not a link buried in
  // a section head, which is how the calendar went missing the moment it lost
  // its slot.
  root.append(
    el('div.stat-grid.two', { style: { marginTop: '18px' } }, [
      wayIn(t('route.calendar'), t('home.wayIn.calendar'), () => navigate('calendar')),
      wayIn(t('route.progress'), t('home.wayIn.progress'), () => navigate('progress')),
      wayIn(t('route.library'), t('home.wayIn.library'), () => navigate('library')),
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
  return el('div', {}, [
    el('div.section-head', {}, [el('h2', { text: t('home.month.title', {
      month: now.toLocaleDateString(locale(), { month: 'long' }),
    }) })]),
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
  const today = new Date().toISOString().slice(0, 10);
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
      const date = new Date().toISOString().slice(0, 10);
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

function wayIn(title, sub, onclick) {
  return el('button.stat', {
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
 * A workout left open.
 *
 * Offers the two honest ways out and says what happens to the sets either way.
 * Finishing keeps only what was ticked — the same rule as finishing normally —
 * so a session with nothing ticked is worth nothing and says so.
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

/* ==================== today ==================== */

/**
 * What the plan says to do today.
 *
 * Only appears once weekdays are assigned — without a schedule "today" has no
 * answer, and the Train tab's least-recently-trained suggestion is already the
 * right one. Nothing here is shown while a workout is in progress; the resume
 * card above already covers that.
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

/* ==================== this week vs the plan ==================== */

/**
 * The number the plan rating promises, measured against what you actually did.
 * Same fractional counting on both sides — see js/log-analysis.js for why that
 * had to be said out loud.
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

  // Green means "on pace for how far into the plan you are", not "finished".
  // Grading a Tuesday against a whole week would paint everything red until
  // Sunday and stop meaning anything.
  const pace = Math.max(0.15, verdict.pace);
  for (const r of rows) {
    const pct = Math.min(1, r.target > 0 ? r.ratio : 1);
    // A muscle the plan never asked for has no pace to be on. Its ratio is
    // reported as 1, which used to paint it the same green as a target you
    // actually hit — full marks for work nobody was measuring.
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

  // Effort coverage. Stated as a share rather than an average, because a mean
  // RIR over sets you never rated would be a made-up number.
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

const trimNum = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/* ======================= nutrition ======================= */

/* ======================= rating ======================= */

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
  const rating = buildRating(best, settings, { machineNames, community: machineCommunity });
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

  const hero = el(`div.card.glow.tier-${idx}`, {}, [
    el('div.rating-hero', {}, [
      el('div.rank-hero-badge', {}, [rankBadge(idx, { size: 76, glow: true })]),
      el('div.rating-val', { text: String(Math.round(rating.overall)) }),
      el('div', { style: { marginTop: '8px' } }, [rankChip(rank)]),
      el('div.rating-sub', {
        text: t('home.rating.overall', { rated: rating.ratedRegions, total: rating.totalRegions }),
      }),
    ]),
    // Two bars, because they answer two different questions: the ladder says
    // where this sits among all 27 steps, the division track says how close the
    // next one is. The second is the one that moves week to week.
    ladderBar(rank),
    el('div.row.between.small.faint', { style: { marginTop: '8px' } }, [
      el('span', { text: t('home.rating.step', { step: rank.step, steps: rank.steps }) }),
      el('span', { text: rank.top ? t('home.rating.ladderTop') : t('home.rating.toNextStep', {
        points: (nextStepScore(rating.overall) - rating.overall).toFixed(1),
        rank: rankName(rankOf(nextStepScore(rating.overall) + 0.0001)),
      }) }),
    ]),
    el('div.division-track', {}, [el('i', { style: { width: `${Math.round(rank.progress * 100)}%` } })]),
    el('div.small.muted', { style: { marginTop: '10px' }, text: t(`tier.${rank.tier.key}.note`) }),
    percentileBar('overall'),
  ]);

  // The live moment, kept apart from the eight-week summary below it: this one
  // fires once, for a step that was actually just crossed.
  announceRankUp(rank);

  const change = recentRankChange(rating.overall);
  if (change) {
    hero.append(el(`div.rank-up${change.up ? '' : '.down'}`, {}, [
      el('span', { text: change.up ? '▲' : '▼', 'aria-hidden': 'true' }),
      el('div', {}, [
        el('div', { text: t(change.up ? 'home.rating.rankUp' : 'home.rating.rankDown', {
          from: rankName(change.from), to: rankName(change.to),
          weeks: tn(change.weeks, 'unit.week'),
        }) }),
        change.up ? null : el('div.small.faint', { style: { marginTop: '2px' },
          text: t('home.rating.rankDownWhy') }),
      ]),
    ]));
  }

  wrap.append(hero);

  // body map
  wrap.append(mapSection(rating));

  // strongest / weakest lifts
  if (rating.lifts.length) {
    const shown = rating.lifts.slice(0, 5);
    wrap.append(el('div.section-head', {}, [el('h2', { text: t('home.rating.yourLifts') })]));
    for (const lift of shown) {
      const li = tierIndex(lift.score);
      wrap.append(
        el(`div.card.tight.tier-${li}`, {}, [
          el('div.row.between', {}, [
            el('div.grow', {}, [
              el('div', { style: { fontWeight: '640' }, text: lift.name }),
              // The next *division* is the number worth printing: at 27 steps
              // the next rank can be forty kilos away, and a target nobody can
              // picture reaching is not a target.
              el('div.small.faint', {
                text: lift.nextDivision
                  ? t('home.rating.forTier', {
                      weight: fmtWeight(Math.round(lift.nextDivision.weight), store.units()),
                      tier: rankName({ tier: lift.nextDivision.tier, division: lift.nextDivision.division }),
                    })
                  : t('home.rating.topTier'),
              }),
              el('div.division-track', { style: { maxWidth: '150px' } },
                [el('i', { style: { width: `${Math.round(lift.rank.progress * 100)}%` } })]),
            ]),
            el('div', { style: { textAlign: 'right' } }, [
              rankChip(lift.rank),
              el('div.small.faint', { style: { marginTop: '4px' },
                text: `e1RM ${fmtWeight(Math.round(lift.oneRepMax), store.units())}` }),
              lift.extrapolated
                ? el('div.small', { style: { marginTop: '2px', color: 'var(--warn)' },
                    text: t('home.rating.extrapolatedShort') })
                : null,
              percentileLine(`lift:${lift.name}`),
              staleBestLabel(lift),
            ]),
            el('button.btn.quiet.sm', {
              onclick: () => strengthDetailSheet(lift, settings),
              'aria-label': t('home.rating.explainLift', { name: lift.name }),
            }, [t('plans.details')]),
          ]),
        ])
      );
    }
  }

  wrap.append(machineRecords(rating.lifts));

  return wrap;
}

/**
 * Fire the celebration once, for a step that was genuinely just gained.
 *
 * The rating is rebuilt from the whole log on every render, so there is no
 * event to hang this on; the stored step is the event. Three rules keep it
 * from becoming noise:
 *
 *   * A device that has never stored a step gets nothing. Otherwise every
 *     existing user is congratulated the first time they open the new version,
 *     for something they did months ago.
 *   * A drop stores silently. Being told you went down is what the banner is
 *     for, and it says it in a quieter voice than a full-screen overlay.
 *   * More than one step at once still fires once, and names where you came
 *     from, because "you gained three steps" is the better sentence anyway.
 */
function announceRankUp(rank) {
  const seen = store.state.settings.lastSeenRankStep;
  // Explicitly against null, not through Number(): Number(null) is 0, which is
  // finite, so a device that has never recorded a step read as "was on step 0"
  // and every existing user was congratulated on first launch for work they did
  // months ago.
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
 * How old a personal best has to be before the app admits it is history.
 *
 * Six months. The rank is an all-time record by design and stays one, because
 * taking away something that was earned is worse than showing it late. But a
 * number from three years ago printed as "your strength" is its own kind of
 * lie, so past this the record keeps its rank and gains a date.
 */
const STALE_BEST_DAYS = 182;

const round1 = (n) => Math.round(n * 10) / 10;

const bestAgeDays = (lift) =>
  lift.achievedAt ? Math.floor((Date.now() - lift.achievedAt) / 86400000) : null;

/** The short tail on a lift row: "best from 14 months ago". */
function staleBestLabel(lift) {
  const days = bestAgeDays(lift);
  if (days === null || days < STALE_BEST_DAYS) return null;
  return el('div.small.faint', { style: { marginTop: '2px' },
    text: t('home.rating.bestAge', { when: relMonths(days) }) });
}

/** The same fact with the reasoning, on the detail sheet. */
function staleBestNote(lift) {
  const days = bestAgeDays(lift);
  if (days === null || days < STALE_BEST_DAYS) return null;
  return el('div.small', { style: { marginTop: '10px', color: 'var(--text-dim)' },
    text: t('home.rating.bestAgeNote', { when: relMonths(days) }) });
}

const relMonths = (days) => tn(Math.max(1, Math.round(days / 30.44)), 'unit.month');

/* ===================== the rank ladder on screen ===================== */

/** "Diamond II" as one chip, coloured by rank. */
function rankChip(rank, { badge = true } = {}) {
  if (!rank) return null;
  return el(`span.tier-chip.tier-${rank.tierIndex}${badge ? '.with-badge' : ''}`, {}, [
    badge ? rankBadge(rank.tierIndex, { size: 17 }) : null,
    tTier(rank.tier.key),
    el('span.div-mark', { text: rank.division }),
  ]);
}

/** The same thing as plain text, for lines that already have a chip on them. */
function rankName(rank) {
  return rank ? `${tTier(rank.tier.key)} ${rank.division}` : '';
}

/**
 * The whole ladder as 27 notches, with the current step lit.
 *
 * Worth the space precisely because it is not a percentage: it shows how much
 * is behind you and how much is still there, which a single number cannot.
 */
function ladderBar(rank) {
  const bar = el('div.ladder', { 'aria-hidden': 'true' });
  for (let i = 0; i < RANK_STEPS; i++) {
    const cls = i + 1 === rank.step ? '.now' : i + 1 < rank.step ? '.on' : '';
    bar.append(el(`i${cls}`, { class: `tier-${Math.floor(i / DIVISIONS.length)}` }));
  }
  return bar;
}

/** The score at which the next division starts. */
function nextStepScore(score) {
  const step = Math.floor(score / (BAND / DIVISIONS.length)) + 1;
  return Math.min(100, step * (BAND / DIVISIONS.length));
}

/**
 * A step gained or lost in the last eight weeks, or null.
 *
 * Deliberately backward-looking rather than a live celebration: the rating is
 * rebuilt from the whole log on every render, so "you just ranked up" would fire
 * again every time the screen redrew. Comparing against where the ladder stood
 * eight weeks ago says the same thing once, calmly, and keeps saying it for as
 * long as it is true.
 *
 * It reports a drop as well as a climb, and this is the part worth being
 * careful about. A ladder that only ever announces good news is a scoreboard
 * nobody believes — but a demotion is usually bodyweight moving, or eight weeks
 * of illness, not a verdict on the lifter. So it is stated flatly, in the same
 * words, without a colour that reads as a telling-off.
 */
function recentRankChange(currentScore) {
  const weeks = 8;
  const then = strengthAt(store.state.sessions, store.state.bodyweight, store.state.settings,
    store.state.exerciseById, Date.now() - weeks * 7 * 86400000);
  if (!then || then.overall === null) return null;
  const from = rankOf(then.overall), to = rankOf(currentScore);
  if (!from || !to || to.step === from.step) return null;
  return { from, to, weeks, up: to.step > from.step, steps: Math.abs(to.step - from.step) };
}

function machineRecords(lifts) {
  const records = lifts.filter((lift) => lift.machine)
    .map((lift) => ({ ...lift, ex: store.state.exercises.find((e) => e.name === lift.name) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const wrap = el('div');
  if (!records.length) return wrap;
  wrap.append(el('div.section-head', {}, [el('h2', { text: t('home.rating.machineRecords') })]));
  for (const row of records) {
    const profile = store.state.settings.machineProfiles?.[row.ex.id];
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
          el('button.btn.quiet.sm', {
            onclick: () => machineProfileSheet(row.ex),
            'aria-label': profile?.model
              ? t('home.rating.machineDetails')
              : t('home.rating.machineDetailsMissing'),
            style: profile?.model ? {} : { color: 'var(--warn)', fontWeight: '750' },
          }, [`${t('plans.details')}${profile?.model ? '' : '  !'}`]),
        ]),
      ]),
    ]));
  }
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
 * Contribute the current ranks and pick up the distribution around them.
 *
 * What leaves the device is a list of 0-100 scores against fixed keys. No
 * weight, no repetition count, no exercise you invented, no identity: a score
 * has already been divided by bodyweight and adjusted for sex and age, so it
 * says far less about a person than "142.5 kg" would. Nothing is sent at all
 * without `shareRankComparison`, and `forgetRankScores` takes it all back.
 *
 * Same shape as refreshMachineStandards, including the signature guard, because
 * this runs inside a render that can fire on any keystroke elsewhere in the app.
 */
async function refreshRankPercentiles(rating, settings) {
  if (rankSyncing || !settings.shareRankComparison || !cloud.isSignedIn() || !navigator.onLine) return;
  if (rating.overall === null) return;

  const entries = [{ key: 'overall', score: round1(rating.overall) }];
  // Only benchmark lifts by name. A custom exercise called "Chest Day Finisher"
  // would be a population of one, and its name would be the identifying part.
  for (const lift of rating.lifts) {
    if (!isBenchmark(lift.name) || lift.extrapolated) continue;
    entries.push({ key: `lift:${lift.name}`, score: round1(lift.score) });
  }
  for (const [region, info] of Object.entries(rating.regions)) {
    entries.push({ key: `region:${region}`, score: round1(info.score) });
  }
  // The server takes 40 in one call; regions plus the benchmark lifts fit, but
  // the cap is enforced here too rather than discovered as an exception.
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
    // An older server without patch 016 must not be asked again on every
    // render. A reload after installing it starts a fresh attempt.
    rankSyncSignature = signature;
  } finally { rankSyncing = false; }
}

/** "62% of the people who log this are below you", or null. */
function percentileLine(key) {
  const stats = rankPercentiles[key];
  if (!stats || !Number.isFinite(Number(stats.below))) return null;
  return el('div.small.faint', { style: { marginTop: '2px' },
    text: t('home.rank.below', { pct: Math.round(Number(stats.below)), n: Number(stats.count) }) });
}

/**
 * The same fact with a bar under it, for the two places that have the room.
 *
 * A bar rather than a bigger number because the point is *where in a spread*,
 * and a spread is a shape. The marker is a position, not a score: nothing here
 * is ordered against a named person, and there is nobody to be above.
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
    // An older server without patch 013 must not be hammered on every render.
    // A reload after installing the patch starts a fresh attempt.
    machineSyncSignature = signature;
  } finally { machineSyncing = false; }
}

/**
 * The muscle map, two ways.
 *
 * "Strength" is the tier map: how you compare against published standards. It
 * only lights the regions a benchmark lift trains, and it always will — there
 * are about seventeen lifts with standards worth having, and no honest way to
 * add a machine chest press to that list.
 *
 * "Progress" answers the other half: are you getting stronger, measured against
 * yourself. That needs no standard, so every exercise you log counts — which is
 * the map that actually reflects a machine-based session. Two scales, never
 * mixed, each with its own legend.
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
      host.replaceChildren(
        bodyMap(rating.regions, { onSelect: (region) => regionSheet(region, rating) }),
        tierLegend(),
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
          el('div.rating-hero', { style: { paddingBottom: '10px' } }, [
            el('div.rating-val', { style: { fontSize: '40px' }, text: String(Math.round(info.score)) }),
            el('div', { style: { marginTop: '8px' } }, [
              rankChip(rankOf(info.score)),
            ]),
          ]),
          el('div.small.muted', { style: { textAlign: 'center' }, text: t('home.region.via', { lift: info.via }) }),
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
      : el('div.small.muted', { text: t('home.region.noBenchmark', { muscle: label }) }),
    el('div.section-head', {}, [el('h2', { text: t('home.region.tierScale') })]),
    el('div', {}, TIERS.map((tier, i) =>
      el(`div.row.between.tier-${i}`, { style: { padding: '7px 0', borderBottom: '1px solid var(--line-soft)' } }, [
        el('span.tier-chip', { text: tTier(tier.key) }),
        el('span.small.faint', { text: `${Math.round(i * BAND)}–${Math.round((i + 1) * BAND)}` }),
      ])
    )),
  ]);

  openSheet(label, body);
}
