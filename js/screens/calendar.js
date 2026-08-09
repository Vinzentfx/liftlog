// Calendar — month grid of gym attendance, and the full workout history.
// History lives here rather than in its own tab: tapping a date opens that session.

import {
  el, fmtNum, fmtWeight, fmtDuration, fmtDate, relDay, setsSummary,
  confirmSheet, toast, emptyState, listItem, debounce,
  numberInput, parseNumber, normaliseOnBlur, undoToast,
} from '../ui.js';
import * as store from '../store.js';
import { sessionStats, entryStats, isCounted, newSet, newEntry, bodyweightLoadMode } from '../models.js';
import { pickExercise } from '../pickers.js';
import { navigate, flushBackup, duplicateWorkout } from '../app.js';
import { t, tn, locale } from '../i18n.js';
import { WEEK_ORDER } from '../schedule.js';

let cursor = null;      // first-of-month being viewed
let editingId = null;   // which session is open for editing, if any

const saveSoon = debounce((session) => store.saveSessionQuiet(session), 350);

export default function renderCalendar({ param, actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': t('common.settings') }, ['⚙']));
  if (param) return detailView(param);
  return monthView();
}

/* =========================== month =========================== */

function monthView() {
  const root = el('div');
  const done = store.state.sessions.filter((s) => s.finishedAt);

  if (!done.length) {
    return emptyState(t('calendar.empty'), t('calendar.emptyHint'));
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
        'aria-label': t('calendar.prevMonth'),
        onclick: () => { const d = new Date(cursor); d.setMonth(d.getMonth() - 1); cursor = d.getTime(); navigate('calendar'); },
      }, ['‹']),
      el('div', { style: { fontWeight: '700', fontSize: '17px' },
        text: view.toLocaleDateString(locale(), { month: 'long', year: 'numeric' }) }),
      el('button.icon-btn', {
        'aria-label': t('calendar.nextMonth'),
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

  for (const weekday of WEEK_ORDER) {
    grid.append(el('div.small.faint', {
      text: t(`weekday.${weekday}.initial`),
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
        ? t('calendar.dayAria', {
            date: date.toLocaleDateString(locale(), { day: 'numeric', month: 'long' }),
            sessions: sessions.map((s) => s.name).join(', '),
          })
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
        el('span.stat-key', { text: target ? t('calendar.ofPlanned', { n: target }) : t('home.stat.workouts') }),
      ]),
      el('div.stat', {}, [el('span.stat-val', { text: String(sets) }), el('span.stat-key', { text: t('train.sets') })]),
      el('div.stat', {}, [el('span.stat-val', { text: fmtNum(volume) }), el('span.stat-key', { text: t('train.volume', { units: store.units() }) })]),
    ])
  );

  if (plan) {
    root.append(el('div.small.faint', { style: { marginTop: '8px', textAlign: 'center' },
      text: t('calendar.targetFrom', { plan: plan.name, days: tn(perWeek, 'unit.day') }) }));
  }

  // ---- history list ----
  root.append(el('div.section-head', {}, [el('h2', { text: t('calendar.allWorkouts') })]));

  let currentMonth = null;
  for (const s of done) {
    const label = new Date(s.startedAt).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
    if (label !== currentMonth) {
      currentMonth = label;
      root.append(el('div.small.faint', { style: { margin: '14px 0 6px', fontWeight: '700' }, text: label }));
    }
    const st = sessionStats(s);
    root.append(listItem({
      title: s.name,
      sub: `${relDay(s.startedAt)} · ${tn(st.exercises, 'unit.exercise')} · ${tn(st.sets, 'unit.set')} · ${fmtNum(st.volume)}${store.units()}`,
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
    }, [`‹ ${t('route.calendar')}`])
  );

  if (!session) {
    root.append(emptyState(t('calendar.notFound'), t('library.notFoundHint')));
    return root;
  }

  const units = store.units();
  const st = sessionStats(session);
  const editing = editingId === session.id;

  root.append(
    el('div.card', {}, [
      el('div.row.between', { style: { gap: '10px' } }, [
        el('div.grow', {}, [
          el('div', { style: { fontSize: '20px', fontWeight: '730', letterSpacing: '-0.02em' }, text: session.name }),
          el('div.small.muted', {
            text: new Date(session.startedAt).toLocaleDateString(locale(),
              { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
          }),
        ]),
        el('button.btn.sm' + (editing ? '.primary' : '.ghost'), {
          onclick: () => {
            editingId = editing ? null : session.id;
            navigate('calendar', session.id);
          },
        }, [t(editing ? 'common.done' : 'common.edit')]),
      ]),
      el('div.stat-grid', { style: { marginTop: '12px' } }, [
        el('div.stat', {}, [el('span.stat-val', { text: fmtDuration(st.durationMs) }), el('span.stat-key', { text: t('calendar.duration') })]),
        store.state.settings.plannedDuration !== false && session.plannedDurationMs
          ? el('div.stat', {}, [el('span.stat-val', { text: fmtDuration(session.plannedDurationMs) }),
              el('span.stat-key', { text: t('calendar.plannedDuration') })]) : null,
        store.state.settings.plannedDuration !== false && session.plannedDurationMs
          ? el('div.stat', {}, [el('span.stat-val', { text: `${st.durationMs >= session.plannedDurationMs ? '+' : '−'}${fmtDuration(Math.abs(st.durationMs-session.plannedDurationMs))}` }),
              el('span.stat-key', { text: t('calendar.durationDifference') })]) : null,
        el('div.stat', {}, [el('span.stat-val', { text: String(st.sets) }), el('span.stat-key', { text: t('train.sets') })]),
        el('div.stat', {}, [el('span.stat-val', { text: fmtNum(st.volume) }), el('span.stat-key', { text: t('train.volume', { units }) })]),
      ]),
    ])
  );

  if (editing) {
    root.append(editHeader(session));
    for (const entry of session.entries) root.append(editEntry(session, entry, units));
    root.append(
      el('button.btn.ghost.full', {
        style: { marginTop: '4px' },
        onclick: () => pickExercise(async (ex) => {
          await store.updateSession(session.id, (s) => {
            s.entries.push(newEntry(ex.id, [{ ...newSet(), done: true }]));
          });
          toast(t('picker.added', { name: ex.name }));
        }, session.entries.map((e) => e.exerciseId)),
      }, [t('train.addExercise')])
    );
  } else {
    for (const entry of session.entries) root.append(readEntry(entry, units));
    root.append(el('button.btn.primary.full', { style: { marginTop: '10px' }, onclick: async () => {
      const duplicated = await duplicateWorkout(session);
      if (!duplicated) { toast(t('calendar.activeWorkout')); navigate('train'); return; }
      toast(t('calendar.duplicated')); navigate('train');
    } }, [t('calendar.duplicateWorkout')]));
  }

  root.append(
    el('button.btn.full.danger', {
      style: { marginTop: '18px' },
      onclick: async () => {
        const ok = await confirmSheet(t('calendar.deleteTitle'),
          t('calendar.deleteBody', { name: session.name, date: fmtDate(session.startedAt) }));
        if (!ok) return;
        const snapshot = JSON.parse(JSON.stringify(session));
        await store.discardSession(session.id);
        flushBackup();
        editingId = null;
        undoToast(t('calendar.deleted'), async () => {
          await store.restoreSession(snapshot);
          flushBackup();
          navigate('calendar', snapshot.id);
        });
        navigate('calendar');
      },
    }, [t('calendar.deleteWorkout')])
  );

  return root;
}

function readEntry(entry, units) {
  const ex = store.state.exerciseById.get(entry.exerciseId);
  const stats = entryStats(entry);
  const counted = entry.sets.filter(isCounted);

  return el('div.card', {}, [
    el('div.row.between', { style: { marginBottom: '6px' } }, [
      el('div', { style: { fontWeight: '650' }, text: ex ? ex.name : t('train.unknownExercise') }),
      ex ? el('button.btn.quiet.sm', { onclick: () => navigate('progress', ex.id) }, [`${t('calendar.chart')} ›`]) : null,
    ]),
    el('div.small', { style: { marginBottom: '6px' }, text: entry.movementMode === 'unilateral'
      ? counted.map((set) => `${t('train.leftShort')} ${fmtNum(set.leftWeight)}×${set.leftReps} · ${t('train.rightShort')} ${fmtNum(set.rightWeight)}×${set.rightReps}`).join(', ')
      : setsSummary(counted, units) }),
    el('div.row', { style: { gap: '14px' } }, [
      el('span.small.faint', { text: tn(stats.sets, 'unit.set') }),
      el('span.small.faint', { text: t('calendar.volumeOf', { volume: `${fmtNum(stats.volume)}${units}` }) }),
      stats.e1rm ? el('span.small.faint', { text: `e1RM ${fmtNum(stats.e1rm)}${units}` }) : null,
    ]),
    entry.note ? el('div.small.muted', { style: { marginTop: '8px' }, text: entry.note }) : null,
  ]);
}

/* ============================ editing ============================ */

/**
 * Correcting a workout after the fact.
 *
 * This existed as "delete the whole thing" for far too long. A mistyped rep
 * count is not a reason to throw away a session, and leaving it in is worse
 * than it looks: 120 reps instead of 12 mints an estimated 1RM that is never
 * beaten again, lifts the strength score permanently and bends twelve weeks of
 * slope. Everything the app says is derived from this log, so the log has to be
 * correctable.
 *
 * Keystrokes save quietly, exactly as they do in a live workout — re-rendering
 * on every character would destroy the caret. Structural edits go through
 * store.updateSession, which re-renders and can roll back.
 */
function editHeader(session) {
  const name = el('input', { type: 'text', value: session.name });
  name.addEventListener('input', () => {
    session.name = name.value.trim() || t('train.defaultName');
    saveSoon(session);
  });

  const date = el('input', {
    type: 'date',
    value: toDateValue(session.startedAt),
    max: toDateValue(Date.now()),
  });
  date.addEventListener('change', async () => {
    const moved = movedToDate(session.startedAt, date.value);
    if (moved === null) { date.value = toDateValue(session.startedAt); return; }
    const shift = moved - session.startedAt;
    const ok = await store.updateSession(session.id, (s) => {
      s.startedAt = moved;
      // Keep the duration rather than the end time; a session moved to another
      // day did not suddenly last three days.
      if (s.finishedAt) s.finishedAt += shift;
    });
    if (ok) toast(t('calendar.dateCorrected'));
    else date.value = toDateValue(session.startedAt);
  });

  return el('div.card', {}, [
    el('label.field', {}, [el('span', { text: t('train.workoutName') }), name]),
    el('label.field', { style: { marginBottom: '0' } }, [
      el('span', { text: t('calendar.date') }), date,
      el('div.small.faint', { style: { marginTop: '6px' }, text: t('calendar.moveNote') }),
    ]),
  ]);
}

function editEntry(session, entry, units) {
  const ex = store.state.exerciseById.get(entry.exerciseId);
  const loadMode = bodyweightLoadMode(ex);
  const block = el('div.card.exercise-block');

  block.append(
    el('div.exercise-head', {}, [
      el('h3', { text: ex ? ex.name : t('train.unknownExercise') }),
      el('button.btn.quiet.sm', {
        'aria-label': t('calendar.removeAria', { name: ex ? ex.name : t('train.unknownExercise') }),
        onclick: async () => {
          const ok = await confirmSheet(t('train.menu.removeTitle'),
            t('calendar.removeBody', {
              name: ex ? ex.name : t('train.unknownExercise'),
              sets: tn(entry.sets.length, 'unit.set'),
            }),
            { confirmLabel: t('common.remove') });
          if (!ok) return;
          const snapshot = JSON.parse(JSON.stringify(entry));
          const index = session.entries.indexOf(entry);
          await store.updateSession(session.id, (s) => {
            s.entries = s.entries.filter((e) => e !== entry);
          });
          undoToast(t('train.exerciseRemoved', { name: ex ? ex.name : t('train.unknownExercise') }),
            () => store.updateSession(session.id, (s) => s.entries.splice(index, 0, snapshot)));
        },
      }, [t('common.remove')]),
    ])
  );

  block.append(el('div.set-labels.with-rir', {}, [
    el('span', { text: t('train.col.set') }), el('span', { text: loadMode === 'bodyweight'
      ? t('train.bodyweightShort') : loadMode === 'added' ? `+${units}` : units }),
    el('span', { text: t('train.col.reps') }), el('span', { text: 'RIR' }), el('span', { text: '' }),
  ]));

  entry.sets.forEach((set, i) => block.append(editRow(session, entry, set, i, ex)));

  block.append(
    el('button.btn.ghost.full.sm', {
      style: { marginTop: '8px' },
      onclick: async () => {
        const prev = entry.sets.filter((s) => s.type === 'working').slice(-1)[0] || null;
        await store.updateSession(session.id, () => {
          const added = { ...newSet(prev), done: true };
          if (loadMode === 'bodyweight') {
            const used = Number(store.state.settings.bodyweight) || 0;
            added.weight = used; added.systemWeight = used;
            added.bodyweightUsed = used; added.loadMode = 'bodyweight';
          }
          entry.sets.push(added);
        });
      },
    }, [t('train.addSet')])
  );

  return block;
}

function editRow(session, entry, set, index, ex) {
  if (entry.movementMode === 'unilateral') return editUnilateralRow(session, entry, set, index);
  const workingNo = entry.sets.slice(0, index + 1).filter((s) => s.type === 'working').length;
  const loadMode = bodyweightLoadMode(ex);
  const row = el('div.set-row.with-rir' + (set.type === 'warmup' ? '.warmup' : ''));

  row.append(
    el('button.set-no', {
      style: { background: 'none', border: 0 },
      title: t('train.toggleWarmup'),
      onclick: async () => {
        await store.updateSession(session.id, () => {
          set.type = set.type === 'warmup' ? 'working' : 'warmup';
        });
      },
    }, [set.type === 'warmup' ? t('train.warmupLetter') : String(workingNo)])
  );

  const weight = normaliseOnBlur(numberInput({
    decimal: true, value: set.weight ?? '', placeholder: '–', 'aria-label': t('train.weight'),
  }));
  const reps = normaliseOnBlur(numberInput({
    value: set.reps ?? '', placeholder: '–', 'aria-label': t('train.col.reps'),
  }), { integer: true });
  const rir = normaliseOnBlur(numberInput({
    class: 'rir', value: set.rir ?? '', placeholder: '–', 'aria-label': t('train.rirTitle'),
  }), { integer: true });

  weight.addEventListener('input', () => {
    set.weight = parseNumber(weight.value);
    if (loadMode === 'added') {
      const used = Number(set.bodyweightUsed) || Number(store.state.settings.bodyweight) || 0;
      set.loadMode = 'added'; set.bodyweightUsed = used;
      set.systemWeight = used + (Number(set.weight) || 0);
    } else set.systemWeight = Number(set.weight) || 0;
    saveSoon(session);
  });
  reps.addEventListener('input', () => {
    const n = parseNumber(reps.value);
    set.reps = n === null ? null : Math.round(n);
    saveSoon(session);
  });
  rir.addEventListener('input', () => {
    const n = parseNumber(rir.value);
    set.rir = n === null ? null : Math.max(0, Math.min(10, Math.round(n)));
    saveSoon(session);
  });
  [weight, reps, rir].forEach((input) => input.addEventListener('focus', () => input.select()));

  row.append(loadMode === 'bodyweight'
    ? el('div.bodyweight-load', { text: fmtWeight(set.systemWeight || set.weight, store.units()) })
    : weight, reps, rir);
  row.append(
    el('button.done-btn', {
      'aria-label': t('calendar.deleteSet', { n: workingNo }),
      title: t('calendar.deleteSetTitle'),
      style: { color: 'var(--danger)' },
      onclick: async () => {
        const snapshot = JSON.parse(JSON.stringify(set));
        await store.updateSession(session.id, (s) => {
          entry.sets.splice(index, 1);
          // An exercise with no sets left is not a record of anything, and it
          // would still be counted as an exercise performed.
          if (!entry.sets.length) s.entries = s.entries.filter((e) => e !== entry);
        });
        undoToast(t('train.setRemoved'), () => store.updateSession(session.id, (s) => {
          if (!s.entries.includes(entry)) s.entries.push(entry);
          entry.sets.splice(index, 0, snapshot);
        }));
      },
    }, ['✕'])
  );

  return row;
}

function editUnilateralRow(session, entry, set, index) {
  const row = el('div.unilateral-set' + (set.type === 'warmup' ? '.warmup' : ''));
  const field = (key, label, decimal = false) => {
    const input = normaliseOnBlur(numberInput({ decimal, value: set[key] ?? '', placeholder: '–', 'aria-label': label }),
      decimal ? {} : { integer: true });
    input.addEventListener('input', () => {
      const value = parseNumber(input.value);
      set[key] = value === null ? null : (decimal ? value : Math.round(value));
      const weights = [set.leftWeight, set.rightWeight].map(Number).filter(Number.isFinite);
      const reps = [set.leftReps, set.rightReps].map(Number).filter(Number.isFinite);
      set.weight = weights.length ? Math.min(...weights) : null;
      set.reps = reps.length ? Math.min(...reps) : null;
      saveSoon(session);
    });
    input.addEventListener('focus', () => input.select());
    return input;
  };
  const side = (name, prefix) => el('div.unilateral-side', {}, [
    el('b', { text: name }), field(`${prefix}Weight`, t('train.sideWeight', { side: name }), true),
    field(`${prefix}Reps`, t('train.sideReps', { side: name })),
  ]);
  row.append(el('button.set-no', { onclick: async () => {
    await store.updateSession(session.id, () => { set.type = set.type === 'warmup' ? 'working' : 'warmup'; });
  } }, [String(index + 1)]), el('div.unilateral-sides', {}, [
    side(t('train.leftShort'), 'left'), side(t('train.rightShort'), 'right'),
  ]), el('button.done-btn', { style: { color: 'var(--danger)' }, onclick: async () => {
    const snapshot = JSON.parse(JSON.stringify(set));
    await store.updateSession(session.id, () => entry.sets.splice(index, 1));
    undoToast(t('train.setRemoved'), () => store.updateSession(session.id, () => entry.sets.splice(index, 0, snapshot)));
  } }, ['✕']));
  return row;
}

const toDateValue = (ts) => {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Same clock time, different day. Returns null if the field is unusable. */
function movedToDate(startedAt, value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [y, m, d] = value.split('-').map(Number);
  const from = new Date(startedAt);
  const next = new Date(y, m - 1, d, from.getHours(), from.getMinutes(), from.getSeconds());
  const ts = next.getTime();
  return Number.isFinite(ts) && ts <= Date.now() ? ts : null;
}
