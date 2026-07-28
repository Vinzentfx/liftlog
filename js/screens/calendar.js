// Calendar — month grid of gym attendance, and the full workout history.
// History lives here rather than in its own tab: tapping a date opens that session.

import {
  el, fmtNum, fmtDuration, fmtDate, relDay, setsSummary,
  confirmSheet, toast, emptyState, listItem,
} from '../ui.js';
import * as store from '../store.js';
import { sessionStats, entryStats, isCounted } from '../models.js';
import { navigate } from '../app.js';

let cursor = null;   // first-of-month being viewed

export default function renderCalendar({ param, actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': 'Settings' }, ['⚙']));
  if (param) return detailView(param);
  return monthView();
}

/* =========================== month =========================== */

function monthView() {
  const root = el('div');
  const done = store.state.sessions.filter((s) => s.finishedAt);

  if (!done.length) {
    return emptyState('No workouts yet', 'Finish a session and it will appear on your calendar.');
  }

  if (!cursor) { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); cursor = d.getTime(); }

  const view = new Date(cursor);
  const year = view.getFullYear();
  const month = view.getMonth();

  // sessions in this month, keyed by day-of-month
  const byDay = new Map();
  for (const s of done) {
    const d = new Date(s.startedAt);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const key = d.getDate();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(s);
  }

  // ---- header ----
  const canGoNext = (() => {
    const now = new Date(); now.setDate(1); now.setHours(0, 0, 0, 0);
    return view.getTime() < now.getTime();
  })();

  root.append(
    el('div.row.between', { style: { marginBottom: '12px' } }, [
      el('button.icon-btn', {
        'aria-label': 'Previous month',
        onclick: () => { const d = new Date(cursor); d.setMonth(d.getMonth() - 1); cursor = d.getTime(); navigate('calendar'); },
      }, ['‹']),
      el('div', { style: { fontWeight: '700', fontSize: '17px' },
        text: view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }),
      el('button.icon-btn', {
        'aria-label': 'Next month',
        disabled: !canGoNext,
        style: canGoNext ? {} : { opacity: '.35', pointerEvents: 'none' },
        onclick: () => { const d = new Date(cursor); d.setMonth(d.getMonth() + 1); cursor = d.getTime(); navigate('calendar'); },
      }, ['›']),
    ])
  );

  // ---- grid ----
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7;             // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const grid = el('div', {
    style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '5px' },
  });

  for (const label of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) {
    grid.append(el('div.small.faint', {
      text: label,
      style: { textAlign: 'center', fontWeight: '700', fontSize: '10.5px', paddingBottom: '4px' },
    }));
  }

  for (let i = 0; i < startPad; i++) grid.append(el('div'));

  for (let day = 1; day <= daysInMonth; day++) {
    const sessions = byDay.get(day) || [];
    const date = new Date(year, month, day);
    const isToday = date.getTime() === today.getTime();
    const trained = sessions.length > 0;

    const cell = el(trained ? 'button' : 'div', {
      'aria-label': trained
        ? `${day} ${view.toLocaleDateString(undefined, { month: 'long' })} — ${sessions.map((s) => s.name).join(', ')}`
        : undefined,
      onclick: trained ? () => navigate('calendar', sessions[0].id) : undefined,
      style: {
        aspectRatio: '1', display: 'grid', placeItems: 'center', position: 'relative',
        borderRadius: '10px', border: '1px solid ' + (isToday ? 'var(--accent)' : 'var(--line-soft)'),
        background: trained
          ? 'linear-gradient(180deg, var(--accent-hi), var(--accent))'
          : 'var(--bg-raised)',
        color: trained ? '#fff' : (isToday ? 'var(--accent-hi)' : 'var(--text-faint)'),
        fontWeight: trained || isToday ? '700' : '500',
        fontSize: '13px',
        boxShadow: trained ? '0 0 14px -5px rgba(59,130,246,.9)' : 'none',
        padding: '0',
      },
    }, [String(day)]);

    if (sessions.length > 1) {
      cell.append(el('span', {
        text: String(sessions.length),
        style: {
          position: 'absolute', top: '2px', right: '4px', fontSize: '9px',
          fontWeight: '700', opacity: '.9',
        },
      }));
    }
    grid.append(cell);
  }

  root.append(el('div.card', {}, [grid]));

  // ---- month summary ----
  const monthSessions = [...byDay.values()].flat();
  const sets = monthSessions.reduce((n, s) => n + sessionStats(s).sets, 0);
  const volume = monthSessions.reduce((n, s) => n + sessionStats(s).volume, 0);
  const plan = store.activePlan();
  const perWeek = plan ? plan.days.length : null;
  const weeksInMonth = daysInMonth / 7;
  const target = perWeek ? Math.round(perWeek * weeksInMonth) : null;

  root.append(
    el('div.stat-grid', {}, [
      el('div.stat', {}, [
        el('span.stat-val', { text: String(monthSessions.length) }),
        el('span.stat-key', { text: target ? `of ~${target} planned` : 'Workouts' }),
      ]),
      el('div.stat', {}, [el('span.stat-val', { text: String(sets) }), el('span.stat-key', { text: 'Sets' })]),
      el('div.stat', {}, [el('span.stat-val', { text: fmtNum(volume) }), el('span.stat-key', { text: `Volume ${store.units()}` })]),
    ])
  );

  if (plan) {
    root.append(el('div.small.faint', { style: { marginTop: '8px', textAlign: 'center' },
      text: `Target is based on ${plan.name} — ${perWeek} ${perWeek === 1 ? 'day' : 'days'} per week.` }));
  }

  // ---- history list ----
  root.append(el('div.section-head', {}, [el('h2', { text: 'All workouts' })]));

  let currentMonth = null;
  for (const s of done) {
    const label = new Date(s.startedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (label !== currentMonth) {
      currentMonth = label;
      root.append(el('div.small.faint', { style: { margin: '14px 0 6px', fontWeight: '700' }, text: label }));
    }
    const st = sessionStats(s);
    root.append(listItem({
      title: s.name,
      sub: `${relDay(s.startedAt)} · ${st.exercises} exercises · ${st.sets} sets · ${fmtNum(st.volume)}${store.units()}`,
      onclick: () => navigate('calendar', s.id),
    }));
  }

  return root;
}

/* =========================== detail =========================== */

function detailView(id) {
  const session = store.state.sessions.find((s) => s.id === id);
  const root = el('div');

  root.append(
    el('button.btn.quiet.sm', {
      style: { marginBottom: '10px', paddingLeft: '0' },
      onclick: () => navigate('calendar'),
    }, ['‹ Calendar'])
  );

  if (!session) {
    root.append(emptyState('Workout not found', 'It may have been deleted.'));
    return root;
  }

  const units = store.units();
  const st = sessionStats(session);

  root.append(
    el('div.card', {}, [
      el('div', { style: { fontSize: '20px', fontWeight: '730', letterSpacing: '-0.02em' }, text: session.name }),
      el('div.small.muted', {
        style: { marginBottom: '12px' },
        text: new Date(session.startedAt).toLocaleDateString(undefined,
          { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      }),
      el('div.stat-grid', {}, [
        el('div.stat', {}, [el('span.stat-val', { text: fmtDuration(st.durationMs) }), el('span.stat-key', { text: 'Duration' })]),
        el('div.stat', {}, [el('span.stat-val', { text: String(st.sets) }), el('span.stat-key', { text: 'Sets' })]),
        el('div.stat', {}, [el('span.stat-val', { text: fmtNum(st.volume) }), el('span.stat-key', { text: `Volume ${units}` })]),
      ]),
    ])
  );

  for (const entry of session.entries) {
    const ex = store.state.exerciseById.get(entry.exerciseId);
    const stats = entryStats(entry);
    const counted = entry.sets.filter(isCounted);

    root.append(
      el('div.card', {}, [
        el('div.row.between', { style: { marginBottom: '6px' } }, [
          el('div', { style: { fontWeight: '650' }, text: ex ? ex.name : 'Unknown exercise' }),
          ex ? el('button.btn.quiet.sm', { onclick: () => navigate('progress', ex.id) }, ['Chart ›']) : null,
        ]),
        el('div.small', { style: { marginBottom: '6px' }, text: setsSummary(counted, units) }),
        el('div.row', { style: { gap: '14px' } }, [
          el('span.small.faint', { text: `${stats.sets} sets` }),
          el('span.small.faint', { text: `${fmtNum(stats.volume)}${units} volume` }),
          stats.e1rm ? el('span.small.faint', { text: `e1RM ${fmtNum(stats.e1rm)}${units}` }) : null,
        ]),
        entry.note ? el('div.small.muted', { style: { marginTop: '8px' }, text: entry.note }) : null,
      ])
    );
  }

  root.append(
    el('button.btn.full.danger', {
      style: { marginTop: '18px' },
      onclick: async () => {
        const ok = await confirmSheet('Delete workout?',
          `${session.name} from ${fmtDate(session.startedAt)} will be permanently deleted.`);
        if (!ok) return;
        await store.discardSession(session.id);
        toast('Workout deleted');
        navigate('calendar');
      },
    }, ['Delete workout'])
  );

  return root;
}
