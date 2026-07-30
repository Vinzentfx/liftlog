// Progress — training overview, plus a per-exercise drill-down.

import {
  el, fmtNum, fmtWeight, fmtDate, relDay, emptyState,
  openSheet, closeSheet, toast, confirmSheet, listItem,
  numberInput, parseNumber, normaliseOnBlur, plural,
} from '../ui.js';
import * as store from '../store.js';
import {
  exerciseSeries, weeklyMuscleSets, personalRecords, entryStats,
  isCounted, startOfWeek, MUSCLES,
} from '../models.js';
import { lineChart, barChart, hBars, heatmap } from '../charts.js';
import { strengthHistory, tonnageHistory, movers } from '../history.js';
import { weekStreak } from '../log-analysis.js';
import { stallReport, describeStall } from '../fatigue.js';
import { shareWeekSheet } from '../week-share.js';
import { TIERS, tierIndex, hasProfile } from '../standards.js';
import { pickExercise } from '../pickers.js';
import { profileForm } from './settings.js';
import { navigate } from '../app.js';

let metric = 'e1rm';      // per-exercise chart, remembered across renders
let workMetric = 'sets';  // weekly workload chart

export default function renderProgress({ param, actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': 'Settings' }, ['⚙']));
  return param ? exerciseView(param) : overview();
}

/* =========================== overview =========================== */

function overview() {
  const units = store.units();
  const done = store.state.sessions.filter((s) => s.finishedAt);
  const root = el('div');

  if (!done.length) {
    return emptyState('Nothing to chart yet', 'Log a couple of workouts and your progress shows up here.');
  }

  // --- headline numbers ---
  const weekStart = startOfWeek(Date.now());
  const thisWeek = done.filter((s) => s.startedAt >= weekStart);
  const weekSets = thisWeek.reduce((n, s) => n + s.entries.reduce((m, e) => m + e.sets.filter(isCounted).length, 0), 0);

  // Lifetime tonnage is not a training metric — it never tells you what to do
  // next. It is here because watching it climb is the thing that keeps people
  // opening the app in month four.
  const lifetime = done.reduce((n, s) =>
    n + s.entries.reduce((m, e) => m + entryStats(e).volume, 0), 0);

  root.append(
    el('div.stat-grid.two', {}, [
      el('div.stat', {}, [el('span.stat-val', { text: String(thisWeek.length) }), el('span.stat-key', { text: 'This week' })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(weekSets) }), el('span.stat-key', { text: 'Sets' })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(weekStreak(done)) }), el('span.stat-key', { text: 'Week streak' })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(done.length) }), el('span.stat-key', { text: 'Workouts' })]),
    ])
  );
  root.append(
    el('div.card.tight', { style: { marginTop: '10px', textAlign: 'center' } }, [
      el('div', { style: { fontSize: '22px', fontWeight: '740', letterSpacing: '-0.02em' },
        text: `${fmtNum(Math.round(lifetime))} ${units}` }),
      el('div.small.faint', { text: 'moved all time' }),
    ])
  );
  root.append(
    el('button.btn.ghost.full', { style: { marginTop: '10px' }, onclick: () => shareWeekSheet() },
      ['Share this week as an image'])
  );

  // --- per-exercise entry point (the thing people actually want) ---
  root.append(el('div.section-head', {}, [el('h2', { text: 'Exercise progress' })]));
  root.append(
    el('button.btn.primary.full', {
      onclick: () => pickExercise((ex) => navigate('progress', ex.id)),
    }, ['Pick an exercise to chart'])
  );

  const frequent = mostTrained(done, 5);
  if (frequent.length) {
    root.append(el('div', { style: { marginTop: '10px' } }, frequent.map(({ ex, count }) =>
      listItem({
        title: ex.name,
        sub: plural(count, 'session'),
        ariaLabel: `Chart ${ex.name}`,
        onclick: () => navigate('progress', ex.id),
      })
    )));
  }

  // --- strength over time ---
  root.append(strengthSection(done));

  // --- what's moving ---
  root.append(moversSection(done, units));

  // --- is it still moving at all ---
  root.append(stallSection(done));

  // --- weekly volume of work ---
  const buckets = weeklyMuscleSets(done, store.state.exerciseById, 10);
  root.append(el('div.section-head', {}, [el('h2', { text: 'Weekly workload' })]));
  root.append(workloadSection(done, units));

  // --- muscle split over the last 4 weeks ---
  const recent = buckets.slice(-4);
  const byMuscle = {};
  for (const b of recent) {
    for (const [m, n] of Object.entries(b.byMuscle)) byMuscle[m] = (byMuscle[m] || 0) + n;
  }
  const muscleRows = MUSCLES
    .map((m) => ({ label: m, value: byMuscle[m] || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  if (muscleRows.length) {
    root.append(el('div.section-head', {}, [el('h2', { text: 'Muscle split · last 4 weeks' })]));
    root.append(
      el('div.card', {}, [
        el('figcaption', { style: { fontSize: '12.5px', color: 'var(--text-dim)', marginBottom: '10px' },
          text: 'Total working sets per muscle group.' }),
        hBars(muscleRows),
      ])
    );
  }

  // --- consistency ---
  root.append(el('div.section-head', {}, [el('h2', { text: 'Consistency' })]));
  const dayMap = new Map();
  for (const s of done) {
    const key = new Date(s.startedAt).toISOString().slice(0, 10);
    const n = s.entries.reduce((m, e) => m + e.sets.filter(isCounted).length, 0);
    dayMap.set(key, (dayMap.get(key) || 0) + n);
  }
  root.append(
    el('div.card', {}, [
      heatmap([...dayMap].map(([key, value]) => ({ key, value })), 18),
      el('div.legend', {}, [
        el('span', {}, [el('b', { style: { background: 'var(--line-soft)' } }), 'Rest']),
        el('span', {}, [el('b', { style: { background: 'color-mix(in srgb, var(--accent) 38%, var(--line-soft))' } }), '1–8 sets']),
        el('span', {}, [el('b', { style: { background: 'color-mix(in srgb, var(--accent) 70%, var(--line-soft))' } }), '9–16']),
        el('span', {}, [el('b', { style: { background: 'var(--accent)' } }), '17+']),
      ]),
    ])
  );

  // --- bodyweight ---
  root.append(el('div.section-head', {}, [
    el('h2', { text: 'Bodyweight' }),
    el('button.btn.quiet.sm', { onclick: bodyweightForm }, ['+ Log']),
  ]));

  const bw = [...store.state.bodyweight].sort((a, b) => a.date - b.date);
  if (bw.length >= 2) {
    const delta = bw[bw.length - 1].weight - bw[0].weight;
    root.append(
      el('div.card', {}, [
        lineChart(
          bw.map((b) => ({ x: b.date, y: b.weight, tip: fmtWeight(b.weight, units) })),
          {
            caption: `${fmtWeight(bw[bw.length - 1].weight, units)} now · ${delta >= 0 ? '+' : ''}${fmtWeight(delta, units)} since ${fmtDate(bw[0].date)}`,
            format: (v) => fmtNum(v, 0), showTrend: true, height: 170,
          }
        ),
      ])
    );
  } else {
    root.append(el('div.card', {}, [
      el('div.small.muted', {
        text: bw.length
          ? `One entry so far (${fmtWeight(bw[0].weight, units)}). Log another to see a trend.`
          : 'Log your bodyweight to see it plotted against your lifts.',
      }),
      el('button.btn.ghost.full.sm', { style: { marginTop: '10px' }, onclick: bodyweightForm }, ['Log bodyweight']),
    ]));
  }

  return root;
}

/**
 * What to show instead of a chart with one dot on it.
 *
 * A single-point plot looks like a finished thing that happens to be empty, and
 * it wastes the one number there actually is. So the number gets the space, and
 * the missing part is stated rather than drawn: a trend needs a second session,
 * and that is a fact about the data, not a failure of the screen.
 *
 * Zero points is a different sentence. It does not mean "nothing logged" — the
 * session list below will be full — it means this particular metric came out at
 * zero every time, which is what a bodyweight movement does to volume and to an
 * estimated 1RM.
 */
function thinChart(points, m, units) {
  if (!points.length) {
    return el('div.card', {}, [
      el('div.small.muted', {
        text: `Nothing to plot for ${m.noun}: every session so far comes out at zero. That is what a bodyweight movement does — with no load there is no volume and no estimated one-rep max. Log an added weight, or switch the metric above.`,
      }),
    ]);
  }

  const only = points[0];
  return el('div.card', {}, [
    el('div', { style: { fontSize: '32px', fontWeight: '760', letterSpacing: '-0.03em', lineHeight: '1.1' },
      text: only.tip }),
    el('div.small.faint', { style: { marginTop: '2px' }, text: `${m.noun} · ${relDay(only.x)}` }),
    el('div.small.muted', { style: { marginTop: '12px' },
      text: 'One session logged. A second one turns this into a trend — the chart, the percentage and the twelve-week slope all need at least two points to mean anything.' }),
  ]);
}

/* ===================== strength over time ===================== */

/**
 * The overall strength score as it stood each week, not as it stands today.
 *
 * This is the chart the app was missing: every other number here measures work
 * done, which is an input. This one measures what came out of it.
 */
function strengthSection(done) {
  const wrap = el('div');
  const settings = store.state.settings;
  if (settings.showRatings === false) return wrap;

  wrap.append(el('div.section-head', {}, [el('h2', { text: 'Strength over time' })]));

  if (!hasProfile(settings)) {
    wrap.append(el('div.card', {}, [
      el('div.small.muted', {
        text: 'Strength is scored relative to bodyweight, sex and age. Add those and this becomes a line you can watch.',
      }),
      el('button.btn.ghost.full.sm', { style: { marginTop: '10px' }, onclick: () => profileForm() }, ['Add my details']),
    ]));
    return wrap;
  }

  const history = strengthHistory(
    store.state.sessions, store.state.bodyweight, settings, store.state.exerciseById, 20);

  if (history.length < 2) {
    wrap.append(el('div.card', {}, [
      el('div.small.muted', {
        text: 'Log a benchmark lift — squat, bench, deadlift, overhead press, row — across a few weeks and your score gets plotted here.',
      }),
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
          tip: `${Math.round(h.score)} · ${h.tier.label}`,
        })),
        {
          caption: `Overall score across ${last.lifts} rated ${last.lifts === 1 ? 'lift' : 'lifts'}. Each week uses the best you had shown by then, scored against your bodyweight at the time — so a dip usually means the scale moved, not that you got weaker.`,
          // A few months of training spans only a handful of points, and
          // rounding those to whole numbers prints "30, 30, 31" up the axis.
          format: axisFormat(history.map((h) => h.score)),
          showTrend: true,
          height: 190,
        }
      ),
      el('div.row.between', { style: { marginTop: '10px', alignItems: 'center' } }, [
        el(`div.tier-${tierIndex(last.score)}`, {}, [
          el('span.tier-chip', { text: last.tier.label }),
        ]),
        el('div.small', {
          style: { color: delta >= 0 ? 'var(--good)' : 'var(--text-dim)', fontWeight: '650' },
          text: `${delta >= 0 ? '+' : ''}${Math.round(delta)} points over ${weeks} week${weeks === 1 ? '' : 's'}`,
        }),
      ]),
      // The tier thresholds are the thing people actually want to know their
      // distance from, and reading them off an unlabelled y-axis is guesswork.
      // Bands are 20 points wide — see tierIndex() in standards.js.
      el('div.small.faint', { style: { marginTop: '6px' },
        text: `Tier bands are 20 points wide: ${TIERS.map((t, i) => `${t.short} ${i * 20}`).join(' · ')}. ${nextTierNote(last.score)}` }),
    ])
  );

  return wrap;
}

/** Enough decimals that consecutive axis ticks never print the same label. */
function axisFormat(values) {
  const span = Math.max(...values) - Math.min(...values);
  const decimals = span >= 8 ? 0 : span >= 2 ? 1 : 2;
  return (v) => v.toFixed(decimals);
}

/** How far to the next tier, in the units the chart is drawn in. */
function nextTierNote(score) {
  const i = tierIndex(score);
  if (i >= TIERS.length - 1) return 'You are in the top band.';
  const gap = (i + 1) * 20 - score;
  return `${gap.toFixed(1)} points to ${TIERS[i + 1].label}.`;
}

/* ===================== movers ===================== */

/** Which lifts are climbing, and which have not moved in months. */
/**
 * The closest this app comes to telling you to take a lighter week — which is
 * to say, not very close. It states what your own log shows and stops there.
 *
 * Deloads are near-universal in practice and thinly evidenced in the
 * literature: no trial establishes when one is due, how long it should last, or
 * that taking one beats carrying on. A rule here would be invented precision,
 * so the card carries facts and says out loud that the decision is yours.
 */
function stallSection(done) {
  const wrap = el('div');
  const report = stallReport(done, store.state.exerciseById);
  if (!report) return wrap;

  const lines = describeStall(report);
  const worthAttention = report.stalled >= Math.ceil(report.tracked / 2);

  wrap.append(el('div.section-head', {}, [el('h2', { text: 'Still moving?' })]));
  wrap.append(
    el('div.card', {}, [
      el('div', {
        style: {
          fontWeight: '650', fontSize: '14px',
          color: worthAttention ? 'var(--warn)' : 'var(--good)',
        },
        text: worthAttention
          ? 'Most of your lifts have stopped gaining'
          : 'Most of your lifts are still gaining',
      }),
      ...lines.map((text) => el('div.small.muted', { style: { marginTop: '8px' }, text })),
      el('div.small.faint', { style: { marginTop: '12px' },
        text: 'These are observations, not instructions. There is no good evidence for a scheduled deload — no trial says when one is due or that taking one beats carrying on — so the app will not tell you to take one. A stall can equally mean the weight jumps are too big, sleep, or a run of bad sessions.' }),
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

  wrap.append(el('div.section-head', {}, [el('h2', { text: 'What is moving · 12 weeks' })]));

  const card = el('div.card', {});
  const line = (r, tone) => el('button.row.between', {
    style: {
      width: '100%', background: 'none', border: 0, textAlign: 'left',
      padding: '9px 0', borderTop: '1px solid var(--line-soft)', gap: '10px',
    },
    'aria-label': `Chart ${r.ex.name}`,
    onclick: () => navigate('progress', r.ex.id),
  }, [
    el('div.grow', {}, [
      el('div', { style: { fontWeight: '600', fontSize: '14.5px' }, text: r.ex.name }),
      el('div.small.faint', {
        text: `${fmtWeight(Math.round(r.first), units)} → ${fmtWeight(Math.round(r.last), units)} est. 1RM · ${plural(r.sessions, 'session')}`,
      }),
    ]),
    el('div', { style: { textAlign: 'right', color: tone, fontWeight: '680', fontSize: '14px' } }, [
      `${r.perWeek >= 0 ? '+' : ''}${r.perWeek.toFixed(1)}`,
      el('div.small.faint', { style: { fontWeight: '500' }, text: `${units}/week` }),
    ]),
  ]);

  if (climbing.length) {
    card.append(el('div.small', { style: { fontWeight: '650', color: 'var(--good)' }, text: 'Going up' }));
    climbing.forEach((r) => card.append(line(r, 'var(--good)')));
  }
  if (stalled.length) {
    card.append(el('div.small', {
      style: { fontWeight: '650', color: 'var(--text-dim)', marginTop: climbing.length ? '14px' : '0' },
      text: 'Flat or falling',
    }));
    stalled.forEach((r) => card.append(line(r, 'var(--text-dim)')));
  }
  card.append(el('div.small.faint', { style: { marginTop: '12px' },
    text: 'Slope of estimated 1RM per week, so adding reps counts as progress too. A flat lift is not a failure — but it is the first place to look.' }));

  wrap.append(card);
  return wrap;
}

/* ===================== workload ===================== */

/**
 * The same weeks, three ways. Sets is the metric the plan rating cares about,
 * tonnage is the one that answers "how much did I move", and reps is what
 * changes first when you are progressing inside a rep range.
 */
function workloadSection(done, units) {
  const host = el('div');
  // Tonnage runs into five digits fast, and the y-axis gutter is 30px — hence
  // the compact axis format rather than a thousands-separated number.
  const compact = (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

  const WORK = {
    sets:    { label: 'Sets',    pick: (b) => b.sets,    fmt: (v) => `${v} sets`, axis: (v) => String(Math.round(v)),
               caption: 'Working sets per week. This is the metric weekly volume is judged on.' },
    tonnage: { label: 'Volume',  pick: (b) => b.tonnage, fmt: (v) => `${fmtNum(v, 0)}${units}`, axis: compact,
               caption: `Total weight moved per week — weight x reps across every working set, in ${units}.` },
    reps:    { label: 'Reps',    pick: (b) => b.reps,    fmt: (v) => `${v} reps`, axis: compact,
               caption: 'Total working reps per week.' },
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
            label: `Week of ${fmtDate(b.week)}`,
            short: i === buckets.length - 1 ? 'Now' : fmtDate(b.week),
            value: Math.round(m.pick(b)),
            tip: m.fmt(Math.round(m.pick(b))),
            dim: i === buckets.length - 1,
          })),
          { caption: `${m.caption} The last bar is the week in progress.`, height: 160, everyNthLabel: 3, format: m.axis }
        ),
      ])
    );
  }

  paint();
  host.append(seg, chart);
  return host;
}

/* ======================= exercise drill-down ======================= */

function exerciseView(exerciseId) {
  const units = store.units();
  const ex = store.state.exerciseById.get(exerciseId);
  const root = el('div');

  root.append(
    el('button.btn.quiet.sm', {
      style: { marginBottom: '10px', paddingLeft: '0' },
      onclick: () => navigate('progress'),
    }, ['‹ Progress'])
  );

  if (!ex) {
    root.append(emptyState('Exercise not found', 'It may have been deleted.'));
    return root;
  }

  const series = exerciseSeries(store.state.sessions, exerciseId);

  root.append(
    el('div', { style: { marginBottom: '14px' } }, [
      el('div', { style: { fontSize: '21px', fontWeight: '710', letterSpacing: '-0.02em' }, text: ex.name }),
      el('div.small.faint', { text: `${ex.muscle} · ${ex.equipment} · ${plural(series.length, 'session')}` }),
    ])
  );

  if (!series.length) {
    root.append(emptyState('No data for this lift yet', 'Log it in a workout and the chart fills in.'));
    return root;
  }

  // --- PRs ---
  const prs = personalRecords(store.state.sessions, exerciseId);
  root.append(
    el('div.stat-grid', { style: { marginBottom: '4px' } }, [
      prs.e1rm ? el('div.stat', {}, [
        el('span.stat-val', { text: fmtWeight(Math.round(prs.e1rm.value), units) }),
        el('span.stat-key', { text: 'Best e1RM' }),
      ]) : null,
      prs.weight ? el('div.stat', {}, [
        el('span.stat-val', { text: fmtWeight(prs.weight.value, units) }),
        el('span.stat-key', { text: 'Top weight' }),
      ]) : null,
      prs.reps ? el('div.stat', {}, [
        el('span.stat-val', { text: String(prs.reps.value) }),
        el('span.stat-key', { text: 'Most reps' }),
      ]) : null,
    ].filter(Boolean))
  );

  // --- metric switch ---
  const METRICS = {
    e1rm:   { label: 'Est. 1RM', noun: 'estimated 1RM', pick: (p) => p.e1rm,      caption: 'Estimated one-rep max (Epley). The cleanest single progress signal — it folds weight and reps together.' },
    top:    { label: 'Top set',  noun: 'top set',       pick: (p) => p.topWeight, caption: 'Heaviest working set in each session.' },
    volume: { label: 'Volume',   noun: 'session volume', pick: (p) => p.volume,   caption: 'Weight × reps across all working sets in the session.' },
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

  paintChart();
  root.append(seg, chartHost);

  // Trend readout — plain language beats making the user squint at a slope.
  if (series.length >= 3) {
    const first = series[0], last = series[series.length - 1];
    const m = METRICS[metric];
    const a = m.pick(first), b = m.pick(last);
    if (a > 0) {
      const pct = ((b - a) / a) * 100;
      const weeks = Math.max(1, Math.round((last.t - first.t) / (7 * 86400000)));
      root.append(
        el('div.card.tight', {}, [
          el('div.small', {}, [
            el('b', { text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% `, class: pct >= 0 ? 'mono-accent' : '' }),
            `over ${weeks} week${weeks === 1 ? '' : 's'} on ${m.noun}.`,
          ]),
        ])
      );
    }
  }

  // --- session table (the accessible alternative to reading the chart) ---
  root.append(el('div.section-head', {}, [el('h2', { text: 'Every session' })]));
  for (const p of [...series].reverse()) {
    root.append(listItem({
      title: relDay(p.t),
      sub: `${plural(p.sets, 'set')} · top ${fmtWeight(p.topWeight, units)} · ${fmtNum(p.volume)}${units} · e1RM ${fmtNum(p.e1rm)}`,
      onclick: () => navigate('calendar', p.sessionId),
    }));
  }

  return root;
}

/* ============================ helpers ============================ */

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
    placeholder: `Weight in ${units}`,
  }));
  const date = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });

  const history = el('div', {}, store.state.bodyweight.slice(0, 8).map((b) =>
    el('div.row.between', { style: { padding: '7px 0', borderBottom: '1px solid var(--line-soft)' } }, [
      el('span.small', { text: fmtDate(b.date, { year: 'numeric' }) }),
      el('div.row', { style: { gap: '10px' } }, [
        el('span.small', { style: { fontWeight: '650' }, text: fmtWeight(b.weight, units) }),
        el('button.btn.quiet.sm', {
          'aria-label': 'Delete entry',
          onclick: async () => {
            const ok = await confirmSheet('Delete entry?', `${fmtWeight(b.weight, units)} on ${fmtDate(b.date)}.`);
            if (ok) { await store.deleteBodyweight(b.id); toast('Deleted'); }
          },
        }, ['×']),
      ]),
    ])
  ));

  const body = el('div', {}, [
    el('label.field', {}, [el('span', { text: `Weight (${units})` }), input]),
    el('label.field', {}, [el('span', { text: 'Date' }), date]),
    el('button.btn.primary.full', {
      onclick: async () => {
        const v = parseNumber(input.value);
        if (!v || v <= 0) { toast('Enter a weight'); input.focus(); return; }
        await store.logBodyweight(v, new Date(`${date.value}T12:00:00`).getTime());
        closeSheet();
        toast('Logged');
      },
    }, ['Save']),
    store.state.bodyweight.length
      ? el('div', {}, [el('div.section-head', {}, [el('h2', { text: 'Recent' })]), history])
      : null,
  ]);

  openSheet('Log bodyweight', body);
}

export { entryStats };
