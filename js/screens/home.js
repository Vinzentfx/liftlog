// Home — overall strength rating, the muscle map, and training-at-a-glance.

import {
  el, fmtNum, fmtWeight, fmtDate, emptyState, listItem,
  openSheet, closeSheet, toast,
} from '../ui.js';
import * as store from '../store.js';
import {
  bestOneRepMaxByName, isCounted, startOfWeek, weeklyMuscleSets, sessionStats,
} from '../models.js';
import {
  buildRating, hasProfile, REGIONS, TIERS, tierIndex, tierOf,
} from '../standards.js';
import { bodyMap, tierLegend } from '../bodymap.js';
import { barChart, lineChart } from '../charts.js';
import { analyseWeek, compareToPlan, weekVerdict } from '../log-analysis.js';
import { proteinTarget, dayTotals, proteinVerdict, weightTrend, trendVerdict } from '../nutrition.js';
import { todaysDays, weekdayName } from '../schedule.js';
import { analysePlan } from '../plan-rating.js';
import { THRESHOLDS } from '../evidence.js';
import { navigate } from '../app.js';
import { profileForm, doExport } from './settings.js';

export default function renderHome({ actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': 'Settings' }, ['⚙']));

  const root = el('div');
  const done = store.state.sessions.filter((s) => s.finishedAt);
  const s = store.state.settings;

  // ---------- active workout nudge ----------
  const active = store.activeSession();
  if (active) {
    root.append(
      el('div.card.glow', {}, [
        el('div.row.between', {}, [
          el('div.grow', {}, [
            el('div', { style: { fontWeight: '680' }, text: 'Workout in progress' }),
            el('div.small.muted', { text: active.name }),
          ]),
          el('button.btn.primary.sm', { onclick: () => navigate('train') }, ['Resume']),
        ]),
      ])
    );
  }

  // ---------- backup nudge ----------
  const backup = store.backupStatus();
  if (backup.due) {
    root.append(
      el('div.card', { style: { borderColor: 'color-mix(in srgb, var(--warn) 32%, transparent)' } }, [
        el('div.row.between', { style: { gap: '12px' } }, [
          el('div.grow', {}, [
            el('div', { style: { fontWeight: '680', color: 'var(--warn)' }, text: 'Back up your training' }),
            el('div.small.muted', {
              text: backup.reason === 'never'
                ? `${done.length} workouts logged and no backup yet. The file goes to your Downloads — put it in iCloud Drive and it survives this phone.`
                : backup.reason === 'workouts'
                  ? `${backup.since} workouts since your last backup.`
                  : `${backup.days} days since your last backup.`,
            }),
          ]),
          el('button.btn.sm.ghost', { onclick: () => doExport() }, ['Export']),
        ]),
      ])
    );
  }

  if (!done.length) {
    root.append(emptyState(
      'Nothing logged yet',
      'Finish your first workout and your rating and muscle map appear here.',
      el('button.btn.primary', { style: { marginTop: '14px' }, onclick: () => navigate('train') }, ['Start a workout'])
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

  root.append(el('div.section-head', {}, [el('h2', { text: 'This week' })]));
  root.append(
    el('div.stat-grid.two', {}, [
      el('div.stat', {}, [el('span.stat-val', { text: String(thisWeek.length) }), el('span.stat-key', { text: 'Workouts' })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(weekSets) }), el('span.stat-key', { text: 'Working sets' })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(streak(done)) }), el('span.stat-key', { text: 'Week streak' })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(done.length) }), el('span.stat-key', { text: 'All time' })]),
    ])
  );

  // ---------- what's on today ----------
  root.append(todayCard(done));

  // ---------- done vs planned ----------
  root.append(weekVsPlan(done));

  // ---------- nutrition ----------
  if (s.showNutrition !== false) root.append(nutritionCard());

  // ---------- weekly workload ----------
  const buckets = weeklyMuscleSets(done, store.state.exerciseById, 10);
  root.append(el('div.section-head', {}, [
    el('h2', { text: 'Workload' }),
    // The Progress tab has no slot on the tab bar, so every section that hints
    // at a trend needs to offer the way in.
    el('button.btn.quiet.sm', { onclick: () => navigate('progress') }, ['Charts ›']),
  ]));
  root.append(
    el('div.card', {}, [
      barChart(
        buckets.map((b, i) => ({
          label: `Week of ${fmtDate(b.week)}`,
          short: i === buckets.length - 1 ? 'Now' : fmtDate(b.week),
          value: b.total,
          tip: `${b.total} working sets`,
          dim: i === buckets.length - 1,
        })),
        { caption: 'Working sets per week — the last bar is the week in progress.', height: 155, everyNthLabel: 3 }
      ),
    ])
  );

  // ---------- bodyweight ----------
  const bw = [...store.state.bodyweight].sort((a, b) => a.date - b.date);
  if (bw.length >= 2) {
    const delta = bw[bw.length - 1].weight - bw[0].weight;
    root.append(el('div.section-head', {}, [
      el('h2', { text: 'Bodyweight' }),
      el('button.btn.quiet.sm', { onclick: () => navigate('progress') }, ['More ›']),
    ]));
    root.append(
      el('div.card', {}, [
        lineChart(
          bw.map((b) => ({ x: b.date, y: b.weight, tip: fmtWeight(b.weight, store.units()) })),
          {
            caption: `${fmtWeight(bw[bw.length - 1].weight, store.units())} now · ${delta >= 0 ? '+' : ''}${fmtWeight(delta, store.units())} since ${fmtDate(bw[0].date)}`,
            format: (v) => fmtNum(v, 0), showTrend: true, height: 160,
          }
        ),
      ])
    );
  }

  // ---------- recent ----------
  root.append(el('div.section-head', {}, [
    el('h2', { text: 'Recent' }),
    el('button.btn.quiet.sm', { onclick: () => navigate('calendar') }, ['All ›']),
  ]));
  for (const x of done.slice(0, 3)) {
    const st = sessionStats(x);
    root.append(listItem({
      title: x.name,
      sub: `${fmtDate(x.startedAt)} · ${st.sets} sets · ${fmtNum(st.volume)}${store.units()}`,
      onclick: () => navigate('calendar', x.id),
    }));
  }

  return root;
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

  wrap.append(el('div.section-head', {}, [el('h2', { text: 'Today' })]));

  if (!today.days.length) {
    wrap.append(el('div.card', {}, [
      el('div', { style: { fontWeight: '680' }, text: 'Rest day' }),
      el('div.small.muted', { style: { marginTop: '2px' },
        text: today.next
          ? `${today.next.day.name} is next, on ${weekdayName(today.next.weekday)}.`
          : 'Nothing scheduled.' }),
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
                ? 'Done today.'
                : `${day.items.length} ${day.items.length === 1 ? 'exercise' : 'exercises'}`,
            }),
          ]),
          trainedToday
            ? el('span.pill.pr', { text: '✓' })
            : el('button.btn.primary.sm', {
                onclick: async () => {
                  await store.startSession({ planId: plan.id, dayId: day.id });
                  navigate('train');
                },
              }, ['Start']),
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
    el('h2', { text: 'This week vs. plan' }),
    plan ? el('button.btn.quiet.sm', { onclick: () => navigate('plans', plan.id) }, ['Plan']) : null,
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
        ? `Target is what ${plan.name} prescribes. Secondary muscles count as ${THRESHOLDS.indirectSetWeight.value} of a set.`
        : `No active plan, so the target is the ${floor}-set weekly floor.` }),
  ]);

  if (!rows.length) {
    card.append(el('div.small.muted', { style: { marginTop: '10px' },
      text: 'Nothing logged yet this week.' }));
  }

  // Green means "on pace for how far into the plan you are", not "finished".
  // Grading a Tuesday against a whole week would paint everything red until
  // Sunday and stop meaning anything.
  const pace = Math.max(0.15, verdict.pace);
  for (const r of rows) {
    const pct = Math.min(1, r.target > 0 ? r.ratio : 1);
    card.append(el('div.bar-row', { style: { marginTop: '8px' } }, [
      el('span.name', { text: REGIONS[r.region] || r.region }),
      el('div.track', {}, [el('div.fill', {
        style: {
          width: `${Math.max(3, pct * 100)}%`,
          background: r.ratio >= pace * 0.9
            ? 'linear-gradient(90deg, var(--good), #6EE7B7)'
            : r.ratio >= pace * 0.7
              ? 'linear-gradient(90deg, var(--accent), var(--accent-hi))'
              : 'var(--t0)',
        },
      })]),
      el('span.val', { text: r.target > 0 ? `${trimNum(r.done)}/${trimNum(r.target)}` : String(trimNum(r.done)) }),
    ]));
  }

  // Effort coverage. Stated as a share rather than an average, because a mean
  // RIR over sets you never rated would be a made-up number.
  if (week.totalSets) {
    card.append(el('div.small.faint', { style: { marginTop: '12px' },
      text: week.effort.logged
        ? `${week.effort.logged} of ${week.totalSets} sets have an RIR — ${Math.round(week.effort.hardShare * 100)}% of those were 0–2 in reserve. ${Math.round(week.longShare * 100)}% of sets loaded a muscle stretched.`
        : `No RIR logged this week, so nothing here can tell you how hard the sets were. ${Math.round(week.longShare * 100)}% of sets loaded a muscle stretched.` }));
  }

  wrap.append(card);
  return wrap;
}

const trimNum = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/* ======================= nutrition ======================= */

/**
 * Today's protein and where bodyweight is heading — the two nutrition numbers
 * that mean anything next to training data. Everything else lives on its own
 * screen; this is the glance.
 */
function nutritionCard() {
  const wrap = el('div');
  const target = proteinTarget(store.state.settings);
  const meals = store.mealsOn();
  const totals = dayTotals(meals);
  const verdict = proteinVerdict(totals.protein, target);
  const trend = weightTrend(store.state.bodyweight, 4);

  wrap.append(el('div.section-head', {}, [
    el('h2', { text: 'Nutrition' }),
    el('button.btn.quiet.sm', { onclick: () => navigate('nutrition') }, ['Log ›']),
  ]));

  const card = el('div.card', {}, [
    el('div.row.between', { style: { alignItems: 'flex-end' } }, [
      el('div', {}, [
        el('div', { style: { fontSize: '24px', fontWeight: '740', letterSpacing: '-0.02em', lineHeight: '1' },
          text: `${totals.protein} g` }),
        el('div.small.faint', { style: { marginTop: '2px' },
          text: target ? `protein today · target ${target.low}–${target.high} g` : 'protein today' }),
      ]),
      totals.kcal
        ? el('div', { style: { textAlign: 'right' } }, [
            el('div', { style: { fontSize: '16px', fontWeight: '650' }, text: fmtNum(totals.kcal) }),
            el('div.small.faint', { text: 'kcal' }),
          ])
        : null,
    ]),
  ]);

  if (!meals.length) {
    card.append(el('div.small.muted', { style: { marginTop: '8px' },
      text: store.state.foods.length
        ? 'Nothing logged today.'
        : 'Build a short list of what you actually eat and logging becomes one tap.' }));
  } else {
    const tone = { hit: 'var(--good)', over: 'var(--text-dim)', under: 'var(--warn)', unknown: 'var(--text-faint)' }[verdict.state];
    card.append(el('div.small', { style: { marginTop: '8px', color: tone }, text: verdict.text }));
  }

  if (trend) {
    card.append(el('div.small.faint', { style: { marginTop: '6px' },
      text: `${trendVerdict(trend).text} over ${trend.spanWeeks} weeks` }));
  }

  wrap.append(card);
  return wrap;
}

/* ======================= rating ======================= */

function ratingSection(done, settings) {
  const wrap = el('div');

  if (!hasProfile(settings)) {
    wrap.append(
      el('div.card.glow', {}, [
        el('div', { style: { fontWeight: '680', marginBottom: '4px' }, text: 'Unlock your strength rating' }),
        el('div.small.muted', {
          text: 'Strength standards are relative to bodyweight, sex and age — add those and every lift gets rated from Beginner to Elite.',
        }),
        el('button.btn.primary.full', { style: { marginTop: '12px' }, onclick: profileForm }, ['Add my details']),
      ])
    );
    return wrap;
  }

  const best = bestOneRepMaxByName(store.state.sessions, store.state.exerciseById);
  const rating = buildRating(best, settings);

  if (rating.overall === null) {
    wrap.append(
      el('div.card', {}, [
        el('div', { style: { fontWeight: '680', marginBottom: '4px' }, text: 'No rated lifts yet' }),
        el('div.small.muted', {
          text: 'Ratings come from benchmark barbell lifts — bench, squat, deadlift, overhead press, rows, pull-ups. Log one of those and your map fills in.',
        }),
      ])
    );
    return wrap;
  }

  const idx = tierIndex(rating.overall);
  const tier = tierOf(rating.overall);

  wrap.append(
    el(`div.card.glow.tier-${idx}`, {}, [
      el('div.rating-hero', {}, [
        el('div.rating-val', { text: String(Math.round(rating.overall)) }),
        el('div', { style: { marginTop: '8px' } }, [
          el('span.tier-chip', { text: tier.label }),
        ]),
        el('div.rating-sub', {
          text: `Overall strength · ${rating.ratedRegions} of ${rating.totalRegions} muscle groups rated`,
        }),
      ]),
    ])
  );

  // body map
  wrap.append(el('div.section-head', {}, [el('h2', { text: 'Muscle map' })]));
  wrap.append(
    el('div.card', {}, [
      bodyMap(rating.regions, {
        onSelect: (region) => regionSheet(region, rating),
      }),
      tierLegend(),
      el('div.small.faint', { style: { marginTop: '8px' },
        text: 'Tap a muscle for detail. Unlit means no benchmark lift trains it yet.' }),
    ])
  );

  // strongest / weakest lifts
  if (rating.lifts.length) {
    const shown = rating.lifts.slice(0, 5);
    wrap.append(el('div.section-head', {}, [el('h2', { text: 'Your lifts' })]));
    for (const lift of shown) {
      const li = tierIndex(lift.score);
      wrap.append(
        el(`div.card.tight.tier-${li}`, {}, [
          el('div.row.between', {}, [
            el('div.grow', {}, [
              el('div', { style: { fontWeight: '640' }, text: lift.name }),
              el('div.small.faint', {
                text: lift.next
                  ? `${fmtWeight(Math.round(lift.next.weight), store.units())} for ${lift.next.tier.label}`
                  : 'Top tier reached',
              }),
            ]),
            el('div', { style: { textAlign: 'right' } }, [
              el('span.tier-chip', { text: lift.tier.label }),
              el('div.small.faint', { style: { marginTop: '4px' },
                text: `e1RM ${fmtWeight(Math.round(lift.oneRepMax), store.units())}` }),
            ]),
          ]),
        ])
      );
    }
  }

  return wrap;
}

function regionSheet(region, rating) {
  const label = REGIONS[region] || region;
  const info = rating.regions[region];

  const body = el('div', {}, [
    info
      ? el(`div.tier-${tierIndex(info.score)}`, {}, [
          el('div.rating-hero', { style: { paddingBottom: '10px' } }, [
            el('div.rating-val', { style: { fontSize: '40px' }, text: String(Math.round(info.score)) }),
            el('div', { style: { marginTop: '8px' } }, [
              el('span.tier-chip', { text: tierOf(info.score).label }),
            ]),
          ]),
          el('div.small.muted', { style: { textAlign: 'center' }, text: `Rated from your ${info.via}.` }),
        ])
      : el('div.small.muted', {
          text: `No benchmark lift in your history trains ${label} yet. Ratings come from the big barbell lifts — add one that hits this muscle and it will fill in.`,
        }),
    el('div.section-head', {}, [el('h2', { text: 'Tier scale' })]),
    el('div', {}, TIERS.map((t, i) =>
      el(`div.row.between.tier-${i}`, { style: { padding: '7px 0', borderBottom: '1px solid var(--line-soft)' } }, [
        el('span.tier-chip', { text: t.label }),
        el('span.small.faint', { text: `${i * 20}–${(i + 1) * 20}` }),
      ])
    )),
  ]);

  openSheet(label, body);
}

/** Consecutive weeks, ending this week or last, with at least one workout. */
function streak(sessions) {
  const weeks = new Set(sessions.map((s) => startOfWeek(s.startedAt)));
  const WEEK = 7 * 86400000;
  let cursor = startOfWeek(Date.now());
  if (!weeks.has(cursor)) cursor -= WEEK;
  let n = 0;
  while (weeks.has(cursor)) { n++; cursor -= WEEK; }
  return n;
}
