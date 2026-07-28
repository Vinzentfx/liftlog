// Progress — training overview, plus a per-exercise drill-down.

import {
  el, fmtNum, fmtWeight, fmtDate, relDay, emptyState,
  openSheet, closeSheet, toast, confirmSheet, listItem,
} from '../ui.js';
import * as store from '../store.js';
import {
  exerciseSeries, weeklyMuscleSets, personalRecords, entryStats,
  isCounted, startOfWeek, MUSCLES,
} from '../models.js';
import { lineChart, barChart, hBars, heatmap } from '../charts.js';
import { pickExercise } from '../pickers.js';
import { navigate } from '../app.js';

let metric = 'e1rm';   // remembered across renders within a session

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

  root.append(
    el('div.stat-grid.two', {}, [
      el('div.stat', {}, [el('span.stat-val', { text: String(thisWeek.length) }), el('span.stat-key', { text: 'This week' })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(weekSets) }), el('span.stat-key', { text: 'Sets' })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(streak(done)) }), el('span.stat-key', { text: 'Week streak' })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(done.length) }), el('span.stat-key', { text: 'All time' })]),
    ])
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
        sub: `${count} sessions`,
        ariaLabel: `Chart ${ex.name}`,
        onclick: () => navigate('progress', ex.id),
      })
    )));
  }

  // --- weekly volume of work ---
  const buckets = weeklyMuscleSets(done, store.state.exerciseById, 10);
  root.append(el('div.section-head', {}, [el('h2', { text: 'Weekly workload' })]));
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
        { caption: 'Working sets per week — the last bar is the week in progress.', height: 160, everyNthLabel: 3 }
      ),
    ])
  );

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
      el('div.small.faint', { text: `${ex.muscle} · ${ex.equipment} · ${series.length} sessions` }),
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
      sub: `${p.sets} sets · top ${fmtWeight(p.topWeight, units)} · ${fmtNum(p.volume)}${units} · e1RM ${fmtNum(p.e1rm)}`,
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

/** Consecutive weeks (ending this week or last) with at least one workout. */
function streak(sessions) {
  if (!sessions.length) return 0;
  const weeks = new Set(sessions.map((s) => startOfWeek(s.startedAt)));
  const WEEK = 7 * 86400000;
  let cursor = startOfWeek(Date.now());
  if (!weeks.has(cursor)) cursor -= WEEK;      // grace for early in the week
  let n = 0;
  while (weeks.has(cursor)) { n++; cursor -= WEEK; }
  return n;
}

function bodyweightForm() {
  const units = store.units();
  const latest = store.state.bodyweight[0];
  const input = el('input', {
    type: 'number', inputmode: 'decimal', step: '0.1', min: '0',
    value: latest ? String(latest.weight) : '',
    placeholder: `Weight in ${units}`,
  });
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
        const v = Number(input.value);
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
