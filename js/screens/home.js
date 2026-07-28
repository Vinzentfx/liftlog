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
import { navigate } from '../app.js';
import { profileForm } from './settings.js';

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

  // ---------- weekly workload ----------
  const buckets = weeklyMuscleSets(done, store.state.exerciseById, 10);
  root.append(el('div.section-head', {}, [el('h2', { text: 'Workload' })]));
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
