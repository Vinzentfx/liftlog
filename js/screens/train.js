// Train — the active workout, or the launcher when nothing is running.

import {
  el, $, toast, haptic, fmtWeight, fmtDuration, fmtNum, setsSummary,
  openSheet, closeSheet, confirmSheet, emptyState, debounce, listItem,
} from '../ui.js';
import * as store from '../store.js';
import * as rest from '../rest.js';
import { newSet, newEntry, entryStats, sessionStats, lastPerformance, e1rm, isCounted } from '../models.js';
import { pickExercise } from '../pickers.js';
import { todaysDays, weekdayName, weekdayShort } from '../schedule.js';
import { exerciseArt } from '../exercise-art.js';
import { navigate, render } from '../app.js';

const saveSoon = debounce((session) => store.saveSessionQuiet(session), 350);

export default function renderTrain({ actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': 'Settings', title: 'Settings' }, ['⚙']));
  const session = store.activeSession();
  return session ? activeView(session) : launcherView();
}

/* ============================ launcher ============================ */

function launcherView() {
  const done = store.state.sessions.filter((s) => s.finishedAt);
  const plan = store.activePlan();
  const root = el('div');

  root.append(
    el('button.btn.primary.full', {
      style: { minHeight: '56px', fontSize: '16px', marginBottom: '18px' },
      onclick: async () => { await store.startSession({}); toast('Workout started'); },
    }, ['Start empty workout'])
  );

  root.append(el('div.section-head', {}, [
    el('h2', { text: plan ? plan.name : 'Plan' }),
    el('button.btn.quiet.sm', { onclick: () => navigate('plans') }, ['Manage']),
  ]));

  if (!plan || !plan.days.length) {
    root.append(el('div.card', {}, [
      el('div.muted.small', {
        text: 'Set up a plan — pick a preset like Push/Pull/Legs and its days show up here ready to start.',
      }),
      el('button.btn.ghost.full.sm', {
        style: { marginTop: '10px' },
        onclick: () => navigate('plans'),
      }, ['Choose a plan']),
    ]));
  } else {
    const lastByDay = new Map();
    for (const s of done) {
      if (s.dayId && !lastByDay.has(s.dayId)) lastByDay.set(s.dayId, s.startedAt);
    }

    // With weekdays assigned, "up next" means what is on today. Without them it
    // stays what it always was: whatever has gone longest untrained.
    const today = todaysDays(plan, done);
    const highlighted = new Set(today.days.map((d) => d.id));

    if (today.scheduled && !today.days.length) {
      root.append(el('div.card', {}, [
        el('div.small.muted', {
          text: today.next
            ? `Rest day. Next up is ${today.next.day.name} on ${weekdayName(today.next.weekday)}.`
            : 'Rest day — nothing scheduled.',
        }),
        el('div.small.faint', { style: { marginTop: '6px' }, text: 'Starting any day below still works.' }),
      ]));
    }

    for (const day of plan.days) {
      const names = day.items
        .map((i) => store.state.exerciseById.get(i.exerciseId))
        .filter(Boolean).map((e) => e.name);
      const last = lastByDay.get(day.id);
      const isNext = highlighted.has(day.id);
      const dayLabel = Number.isInteger(day.weekday) ? weekdayShort(day.weekday) : null;

      root.append(listItem({
        title: day.name + (isNext ? (today.scheduled ? '  ·  today' : '  ·  up next') : ''),
        sub: [
          `${names.length} exercises`,
          dayLabel,
          last ? `last ${relLabel(last)}` : 'never trained',
        ].filter(Boolean).join(' · '),
        ariaLabel: `Start ${day.name}`,
        onclick: async () => {
          await store.startSession({ planId: plan.id, dayId: day.id });
          toast(`Started ${day.name}`);
        },
      }));
    }
  }

  if (done.length) {
    const last = done[0];
    const st = sessionStats(last);
    root.append(el('div.section-head', {}, [el('h2', { text: 'Last session' })]));
    root.append(listItem({
      title: last.name,
      sub: `${new Date(last.startedAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${st.sets} sets · ${fmtNum(st.volume)}${store.units()}`,
      onclick: () => navigate('calendar', last.id),
    }));
  }

  return root;
}

/* ========================= active workout ========================= */

function activeView(session) {
  const units = store.units();
  const root = el('div');
  const st = sessionStats(session);

  // --- summary header ---
  const elapsed = el('span.stat-val', { text: fmtDuration(st.durationMs) });
  const header = el('div.card', {}, [
    el('div.row.between', { style: { marginBottom: '12px' } }, [
      el('div.grow', {}, [
        el('div', { style: { fontWeight: '680', fontSize: '17px' }, text: session.name }),
        el('div.small.faint', { text: `Started ${new Date(session.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` }),
      ]),
      el('button.btn.sm.ghost', { onclick: () => renameSession(session) }, ['Rename']),
    ]),
    el('div.stat-grid', {}, [
      el('div.stat', {}, [elapsed, el('span.stat-key', { text: 'Elapsed' })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(st.sets) }), el('span.stat-key', { text: 'Sets' })]),
      el('div.stat', {}, [el('span.stat-val', { text: fmtNum(st.volume) }), el('span.stat-key', { text: `Volume ${units}` })]),
    ]),
  ]);
  root.append(header);

  // Tick the elapsed clock without re-rendering the whole screen.
  const clockTimer = setInterval(() => {
    if (!document.body.contains(elapsed)) { clearInterval(clockTimer); return; }
    elapsed.textContent = fmtDuration(Date.now() - session.startedAt);
  }, 30000);

  // --- exercises ---
  if (!session.entries.length) {
    root.append(emptyState('No exercises yet', 'Add your first one to start logging.'));
  }
  session.entries.forEach((entry, index) => {
    root.append(exerciseBlock(session, entry, index));
  });

  // --- actions ---
  root.append(
    el('button.btn.ghost.full', {
      style: { marginTop: '4px' },
      onclick: () => pickExercise(async (ex) => {
        await store.updateSession(session.id, (s) => {
          s.entries.push(newEntry(ex.id, [newSet()]));
        });
        toast(`Added ${ex.name}`);
      }, session.entries.map((e) => e.exerciseId)),
    }, ['+ Add exercise'])
  );

  root.append(
    el('div.stack', { style: { marginTop: '22px' } }, [
      el('button.btn.primary.full', {
        style: { minHeight: '54px' },
        onclick: () => finishFlow(session),
      }, ['Finish workout']),
      el('button.btn.full.danger', { onclick: () => discardFlow(session) }, ['Discard workout']),
    ])
  );

  return root;
}

function exerciseBlock(session, entry, entryIndex) {
  const units = store.units();
  const ex = store.state.exerciseById.get(entry.exerciseId);
  const name = ex ? ex.name : 'Unknown exercise';
  const block = el('div.card.exercise-block');

  block.append(
    el('div.exercise-head', {}, [
      el('h3', { text: name }),
      el('button.btn.quiet.sm', {
        'aria-label': `Options for ${name}`,
        onclick: () => exerciseMenu(session, entry, entryIndex, name),
      }, ['···']),
    ])
  );

  // The single most useful line on the screen: what you did last time.
  const last = lastPerformance(store.state.sessions, entry.exerciseId, session.id);
  if (last) {
    block.append(
      el('div.last-time', {}, [
        el('span', { text: `${relLabel(last.session.startedAt)}: ` }),
        el('b', { text: setsSummary(last.sets, units) }),
        lastRirLabel(last.sets),
      ])
    );
    const tip = suggestNext(last, entry.targetReps, ex, units);
    if (tip) {
      block.append(
        el('div.suggest', {}, [
          el('b', { text: tip.headline }),
          el('span', { text: ` — ${tip.why}` }),
        ])
      );
    }
  } else {
    block.append(el('div.small.faint', { style: { marginBottom: '10px' }, text: 'First time logging this one.' }));
  }

  if (entry.note) {
    block.append(el('div.small.muted', { style: { marginBottom: '8px' }, text: entry.note }));
  }

  const rirOn = store.state.settings.logRir !== false;
  block.append(el('div.set-labels' + (rirOn ? '.with-rir' : ''), {}, [
    el('span', { text: 'Set' }), el('span', { text: units }),
    el('span', { text: 'Reps' }),
    rirOn ? el('span', { text: 'RIR', title: 'Reps in reserve' }) : null,
    el('span', { text: '✓' }),
  ]));

  entry.sets.forEach((set, i) => {
    block.append(setRow(session, entry, set, i, last));
  });

  block.append(
    el('button.btn.ghost.full.sm', {
      style: { marginTop: '8px' },
      onclick: async () => {
        const prev = entry.sets.filter((s) => s.type === 'working').slice(-1)[0] || null;
        await store.updateSession(session.id, () => { entry.sets.push(newSet(prev)); });
      },
    }, ['+ Add set'])
  );

  return block;
}

function setRow(session, entry, set, index, last) {
  const workingNo = entry.sets.slice(0, index + 1).filter((s) => s.type === 'working').length;
  const rirOn = store.state.settings.logRir !== false;
  const row = el('div.set-row'
    + (rirOn ? '.with-rir' : '')
    + (set.done ? '.done' : '')
    + (set.type === 'warmup' ? '.warmup' : ''));

  // Tap the number to flip a set between warmup and working.
  row.append(
    el('button.set-no', {
      style: { background: 'none', border: 0 },
      title: 'Tap to toggle warmup',
      onclick: async () => {
        await store.updateSession(session.id, () => {
          set.type = set.type === 'warmup' ? 'working' : 'warmup';
        });
      },
    }, [set.type === 'warmup' ? 'W' : String(workingNo)])
  );

  // `last.sets` holds only the working sets from last time, so it has to be
  // indexed by working-set number, not by row. Indexing by row meant that two
  // warm-up sets shifted every placeholder two sets down the list — set 1 would
  // suggest what you did on set 3.
  const hint = set.type === 'warmup' || !last
    ? null
    : last.sets[workingNo - 1] || last.sets[last.sets.length - 1];

  const weight = el('input', {
    type: 'number', inputmode: 'decimal', step: '0.5', min: '0',
    value: set.weight ?? '',
    placeholder: hint ? String(hint.weight) : '—',
    'aria-label': 'Weight',
  });
  const reps = el('input', {
    type: 'number', inputmode: 'numeric', step: '1', min: '0',
    value: set.reps ?? '',
    placeholder: hint ? String(hint.reps) : '—',
    'aria-label': 'Reps',
  });

  // Keystrokes persist quietly — a re-render here would kill the caret.
  weight.addEventListener('input', () => {
    set.weight = weight.value === '' ? null : Number(weight.value);
    saveSoon(session);
  });
  reps.addEventListener('input', () => {
    set.reps = reps.value === '' ? null : Number(reps.value);
    saveSoon(session);
  });
  [weight, reps].forEach((input) => {
    input.addEventListener('focus', () => input.select());
  });

  // Reps in reserve. Optional by design — the rating never punishes a blank,
  // it just says it cannot judge effort. A required field here would get filled
  // in with noise, which is worse than nothing.
  const rir = el('input.rir', {
    type: 'number', inputmode: 'numeric', step: '1', min: '0', max: '10',
    value: set.rir ?? '',
    placeholder: '–',
    'aria-label': `Reps in reserve for set ${workingNo}`,
    title: 'Reps in reserve — how many more you could have done',
  });
  rir.addEventListener('input', () => {
    set.rir = rir.value === '' ? null : Math.max(0, Math.min(10, Number(rir.value)));
    saveSoon(session);
  });
  rir.addEventListener('focus', () => rir.select());

  const doneBtn = el('button.done-btn', {
    'aria-label': set.done ? 'Mark set not done' : 'Mark set done',
    'aria-pressed': String(!!set.done),
    onclick: () => toggleDone(session, entry, set, weight, reps, hint),
  }, ['✓']);

  row.append(weight, reps, rirOn ? rir : null, doneBtn);
  return row;
}

/* ======================= effort and progression ======================= */

/** "· 1–2 RIR" tail on the last-time line, when it was recorded. */
function lastRirLabel(sets) {
  const vals = sets.map((s) => s.rir).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return el('span.small.faint', { text: `  ·  ${lo === hi ? lo : `${lo}–${hi}`} RIR` });
}

/**
 * Double progression: clear the top of the rep range on every set, then add
 * weight. Not a research finding — it is the standard way to make "train close
 * to failure" into a decision you can take on the gym floor. Where RIR was
 * logged it is used, because a set finished with 4 in reserve did not earn a
 * weight jump no matter how many reps it was.
 */
function suggestNext(last, targetReps, ex, units) {
  const sets = last.sets;
  if (!sets.length) return null;

  const range = parseReps(targetReps) || { low: 6, high: 10 };
  const reps = sets.map((s) => Number(s.reps) || 0);
  const rirs = sets.map((s) => s.rir).filter((v) => v !== null && v !== undefined);
  const topWeight = Math.max(...sets.map((s) => Number(s.weight) || 0));
  if (!topWeight) return null;

  const step = ex && ex.equipment === 'Dumbbell' ? (units === 'lb' ? 5 : 2) : (units === 'lb' ? 5 : 2.5);
  const next = `${fmtWeight(topWeight + step, units)}`;

  // Effort first: it overrides the rep count in both directions.
  if (rirs.length && Math.min(...rirs) >= 3) {
    return {
      headline: `Try ${next}`,
      why: `you finished with ${Math.min(...rirs)}+ reps in reserve — that set was too easy to grow much`,
    };
  }
  if (rirs.length && Math.max(...rirs) === 0 && reps.some((r) => r < range.low)) {
    return {
      headline: `Stay at ${fmtWeight(topWeight, units)}`,
      why: 'you hit failure below the rep range — the weight is ahead of you',
    };
  }

  if (reps.every((r) => r >= range.high)) {
    return {
      headline: `Try ${next}`,
      why: `every set cleared ${range.high} reps${rirs.length ? '' : ' — log RIR and this gets sharper'}`,
    };
  }
  if (reps.some((r) => r < range.low)) {
    return {
      headline: `Stay at ${fmtWeight(topWeight, units)}`,
      why: `build back to ${range.low}+ reps on every set first`,
    };
  }
  return {
    headline: `Stay at ${fmtWeight(topWeight, units)}`,
    why: `add reps until all sets reach ${range.high}`,
  };
}

function parseReps(spec) {
  if (!spec) return null;
  const nums = String(spec).match(/\d+/g);
  if (!nums || !nums.length) return null;
  const ns = nums.map(Number);
  return { low: Math.min(...ns), high: Math.max(...ns) };
}

async function toggleDone(session, entry, set, weightInput, repsInput, hint) {
  if (!set.done) {
    // Empty fields fall back to the placeholder — repeating last week is the
    // common case and shouldn't need typing.
    if (set.weight === null || set.weight === undefined || weightInput.value === '') {
      const v = hint ? hint.weight : null;
      if (v === null) { toast('Enter a weight first'); weightInput.focus(); return; }
      set.weight = v; weightInput.value = String(v);
    }
    if (!set.reps || repsInput.value === '') {
      const v = hint ? hint.reps : null;
      if (!v) { toast('Enter reps first'); repsInput.focus(); return; }
      set.reps = v; repsInput.value = String(v);
    }
  }

  set.done = !set.done;
  haptic(set.done ? 12 : 6);

  if (set.done) {
    const pr = checkPR(session, entry, set);
    if (pr) toast(pr, 2600);
    if (set.type === 'working' && store.state.settings.autoStartRest) {
      rest.start(store.state.settings.restSeconds, {
        sound: store.state.settings.soundOnRestEnd !== false,
      });
    }
  }

  await store.updateSession(session.id, () => {});
}

/** Returns a message if this set just beat a stored best. */
function checkPR(session, entry, set) {
  const units = store.units();
  let bestE1rm = 0, bestWeight = 0;
  for (const s of store.state.sessions) {
    if (!s.finishedAt || s.id === session.id) continue;
    const e = s.entries.find((x) => x.exerciseId === entry.exerciseId);
    if (!e) continue;
    for (const prev of e.sets.filter(isCounted)) {
      bestE1rm = Math.max(bestE1rm, e1rm(prev.weight, prev.reps));
      bestWeight = Math.max(bestWeight, Number(prev.weight) || 0);
    }
  }
  if (!bestE1rm) return null;   // nothing to beat yet

  const w = Number(set.weight) || 0;
  if (w > bestWeight) return `🏆 Weight PR — ${fmtWeight(w, units)}`;
  if (e1rm(set.weight, set.reps) > bestE1rm) return `🏆 Estimated 1RM PR`;
  return null;
}

/* ============================ menus ============================ */

function exerciseMenu(session, entry, index, name) {
  const move = async (delta) => {
    const to = index + delta;
    if (to < 0 || to >= session.entries.length) return;
    await store.updateSession(session.id, (s) => {
      const [item] = s.entries.splice(index, 1);
      s.entries.splice(to, 0, item);
    });
    closeSheet();
  };

  const ex = store.state.exerciseById.get(entry.exerciseId);

  const body = el('div.stack', {}, [
    ex ? el('button.btn.ghost.full', {
      onclick: () => { closeSheet(); howToSheet(ex); },
    }, ['How to do it']) : null,
    el('button.btn.ghost.full', { onclick: () => { closeSheet(); noteForm(session, entry); } }, ['Add a note']),
    el('button.btn.ghost.full', { disabled: index === 0, onclick: () => move(-1) }, ['↑ Move up']),
    el('button.btn.ghost.full', { disabled: index === session.entries.length - 1, onclick: () => move(1) }, ['↓ Move down']),
    el('button.btn.full.danger', {
      onclick: async () => {
        closeSheet();
        const ok = await confirmSheet('Remove exercise?', `${name} and its sets will be removed from this workout.`, { confirmLabel: 'Remove' });
        if (!ok) return;
        await store.updateSession(session.id, (s) => { s.entries.splice(index, 1); });
      },
    }, ['Remove from workout']),
  ]);
  openSheet(name, body);
}

/** Demo frames + steps, one tap from the workout rather than cluttering it. */
function howToSheet(ex) {
  const body = el('div', {}, [
    exerciseArt(ex, { eager: true }),
    el('div.small.muted', { style: { marginTop: '10px' },
      text: `${ex.muscle} · ${ex.equipment}` }),
    ex.instructions && ex.instructions.length
      ? el('ol', { style: { marginTop: '14px', paddingLeft: '20px', fontSize: '14px', lineHeight: '1.55' } },
          ex.instructions.map((s) => el('li', { text: s, style: { marginBottom: '8px' } })))
      : el('div.small.faint', { style: { marginTop: '12px' }, text: 'No written steps for this one.' }),
  ]);
  openSheet(ex.name, body);
}

function noteForm(session, entry) {
  const input = el('textarea', { placeholder: 'e.g. felt heavy, last set to failure' });
  input.value = entry.note || '';
  const body = el('div', {}, [
    el('label.field', {}, [el('span', { text: 'Note' }), input]),
    el('button.btn.primary.full', {
      onclick: async () => {
        await store.updateSession(session.id, () => { entry.note = input.value.trim(); });
        closeSheet();
      },
    }, ['Save note']),
  ]);
  openSheet('Exercise note', body);
}

function renameSession(session) {
  const input = el('input', { type: 'text', value: session.name });
  const body = el('div', {}, [
    el('label.field', {}, [el('span', { text: 'Workout name' }), input]),
    el('button.btn.primary.full', {
      onclick: async () => {
        await store.updateSession(session.id, (s) => { s.name = input.value.trim() || 'Workout'; });
        closeSheet();
      },
    }, ['Save']),
  ]);
  openSheet('Rename workout', body);
}

/* ============================ finish ============================ */

async function finishFlow(session) {
  const completed = session.entries.reduce((n, e) => n + e.sets.filter(isCounted).length, 0);

  if (!completed) {
    const ok = await confirmSheet(
      'Nothing logged',
      'No completed sets in this workout. Discard it instead?',
      { confirmLabel: 'Discard' });
    if (ok) { await store.discardSession(session.id); rest.stop(); toast('Discarded'); }
    return;
  }

  const pending = session.entries.reduce(
    (n, e) => n + e.sets.filter((s) => !s.done && (s.weight || s.reps)).length, 0);

  const st = sessionStats(session);
  const body = el('div', {}, [
    el('div.stat-grid', { style: { marginBottom: '14px' } }, [
      el('div.stat', {}, [el('span.stat-val', { text: fmtDuration(st.durationMs) }), el('span.stat-key', { text: 'Time' })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(completed) }), el('span.stat-key', { text: 'Sets' })]),
      el('div.stat', {}, [el('span.stat-val', { text: fmtNum(st.volume) }), el('span.stat-key', { text: `Volume ${store.units()}` })]),
    ]),
    pending
      ? el('div.small.muted', { style: { marginBottom: '12px' },
          text: `${pending} unfinished ${pending === 1 ? 'set has' : 'sets have'} numbers but no ✓ — they won't be saved.` })
      : null,
    el('button.btn.primary.full', {
      onclick: async () => {
        closeSheet();
        await store.finishSession(session.id);
        rest.stop();
        toast('Workout saved 💪', 2400);
        navigate('calendar', session.id);
      },
    }, ['Save workout']),
    el('button.btn.ghost.full', { style: { marginTop: '10px' }, onclick: closeSheet }, ['Keep going']),
  ]);
  openSheet('Finish workout', body);
}

async function discardFlow(session) {
  const ok = await confirmSheet(
    'Discard workout?',
    'Everything logged in this session will be permanently deleted.',
    { confirmLabel: 'Discard' });
  if (!ok) return;
  await store.discardSession(session.id);
  rest.stop();
  toast('Discarded');
  render();
}

function relLabel(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today - d) / 86400000);
  if (days === 0) return 'Earlier today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

export { entryStats };
