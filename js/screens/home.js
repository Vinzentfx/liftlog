// Home — overall strength rating, the muscle map, and training-at-a-glance.

import {
  el, fmtNum, fmtWeight, fmtDate, emptyState, listItem,
  openSheet, closeSheet, toast, confirmSheet,
} from '../ui.js';
import * as store from '../store.js';
import {
  bestOneRepMaxByName, isCounted, startOfWeek, weeklyMuscleSets, sessionStats,
} from '../models.js';
import {
  buildRating, hasProfile, TIERS, tierIndex, tierOf, LOW_CONFIDENCE,
} from '../standards.js';
import { t, tn, tRegion, tTier } from '../i18n.js';
import { bodyMap, tierLegend } from '../bodymap.js';
import { barChart, lineChart } from '../charts.js';
import { analyseWeek, compareToPlan, weekVerdict, weekStreak } from '../log-analysis.js';
import { shareWeekSheet } from '../week-share.js';
import { todaysDays, weekdayName } from '../schedule.js';
import { regionProgress, progressFills, describeRegion } from '../region-progress.js';
import { analysePlan } from '../plan-rating.js';
import { THRESHOLDS } from '../evidence.js';
import { navigate } from '../app.js';
import { profileForm, doExport } from './settings.js';

// Which map the user last looked at. Module-level so switching tabs and coming
// back does not silently reset it.
let mapMode = 'strength';

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
                  await store.startSession({ planId: plan.id, dayId: day.id });
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
  const rating = buildRating(best, settings);

  if (rating.overall === null) {
    wrap.append(
      el('div.card', {}, [
        el('div', { style: { fontWeight: '680', marginBottom: '4px' }, text: t('home.rating.none') }),
        el('div.small.muted', { text: t('home.rating.noneBody') }),
      ])
    );
    mapMode = 'progress';
    wrap.append(mapSection(rating));
    wrap.append(machineRecords(best));
    return wrap;
  }

  const idx = tierIndex(rating.overall);
  const tier = tierOf(rating.overall);

  wrap.append(
    el(`div.card.glow.tier-${idx}`, {}, [
      el('div.rating-hero', {}, [
        el('div.rating-val', { text: String(Math.round(rating.overall)) }),
        el('div', { style: { marginTop: '8px' } }, [
          el('span.tier-chip', { text: tTier(tier.key) }),
        ]),
        el('div.rating-sub', {
          text: t('home.rating.overall', { rated: rating.ratedRegions, total: rating.totalRegions }),
        }),
      ]),
    ])
  );

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
              el('div.small.faint', {
                text: lift.next
                  ? t('home.rating.forTier', {
                      weight: fmtWeight(Math.round(lift.next.weight), store.units()),
                      tier: tTier(lift.next.tier.key),
                    })
                  : t('home.rating.topTier'),
              }),
            ]),
            el('div', { style: { textAlign: 'right' } }, [
              el('span.tier-chip', { text: tTier(lift.tier.key) }),
              el('div.small.faint', { style: { marginTop: '4px' },
                text: `e1RM ${fmtWeight(Math.round(lift.oneRepMax), store.units())}` }),
            ]),
          ]),
        ])
      );
    }
  }

  wrap.append(machineRecords(best));

  return wrap;
}

function machineRecords(best) {
  const records = [...best]
    .map(([name, oneRepMax]) => ({ ex: store.state.exercises.find((e) => e.name === name), name, oneRepMax }))
    .filter((row) => row.ex?.equipment === 'Machine')
    .sort((a, b) => b.oneRepMax - a.oneRepMax)
    .slice(0, 5);
  const wrap = el('div');
  if (!records.length) return wrap;
  wrap.append(el('div.section-head', {}, [el('h2', { text: t('home.rating.machineRecords') })]));
  for (const row of records) {
    wrap.append(el('div.card.tight', {}, [
      el('div.row.between', {}, [
        el('div', {}, [
          el('div', { style: { fontWeight: '640' }, text: row.name }),
          el('div.small.faint', { text: t('home.rating.machinePersonal') }),
        ]),
        el('strong.num', { text: `e1RM ${fmtWeight(Math.round(row.oneRepMax), store.units())}` }),
      ]),
    ]));
  }
  return wrap;
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
              el('span.tier-chip', { text: tTier(tierOf(info.score).key) }),
            ]),
          ]),
          el('div.small.muted', { style: { textAlign: 'center' }, text: t('home.region.via', { lift: info.via }) }),
          LOW_CONFIDENCE[info.via]
            ? el('div.small', { style: { marginTop: '10px', color: 'var(--warn)' },
                text: `!  ${LOW_CONFIDENCE[info.via]}` })
            : null,
        ])
      : el('div.small.muted', { text: t('home.region.noBenchmark', { muscle: label }) }),
    el('div.section-head', {}, [el('h2', { text: t('home.region.tierScale') })]),
    el('div', {}, TIERS.map((tier, i) =>
      el(`div.row.between.tier-${i}`, { style: { padding: '7px 0', borderBottom: '1px solid var(--line-soft)' } }, [
        el('span.tier-chip', { text: tTier(tier.key) }),
        el('span.small.faint', { text: `${i * 20}–${(i + 1) * 20}` }),
      ])
    )),
  ]);

  openSheet(label, body);
}
