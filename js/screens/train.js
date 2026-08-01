// Train — the active workout, or the launcher when nothing is running.

import {
  el, $, toast, haptic, fmtWeight, fmtDuration, fmtNum, setsSummary,
  openSheet, closeSheet, confirmSheet, emptyState, debounce, listItem,
  numberInput, parseNumber, normaliseOnBlur,
} from '../ui.js';
import * as store from '../store.js';
import * as rest from '../rest.js';
import * as cloud from '../cloud.js';
import { newSet, newEntry, entryStats, sessionStats, lastPerformance, e1rm, isCounted } from '../models.js';
import { pickExercise } from '../pickers.js';
import { todaysDays, weekdayName, weekdayShort } from '../schedule.js';
import { exerciseArt } from '../exercise-art.js';
import { platePlan, describePlates, PLATES } from '../plates.js';
import { warmupSets } from '../warmup.js';
import { navigate, render } from '../app.js';
import { t, tn, tMuscle, tEquipment, locale } from '../i18n.js';

const saveSoon = debounce((session) => store.saveSessionQuiet(session), 350);

export default function renderTrain({ actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': t('common.settings'), title: t('common.settings') }, ['⚙']));
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
      onclick: async () => { await store.startSession({}); toast(t('train.started')); },
    }, [t('train.startEmpty')])
  );

  root.append(el('div.section-head', {}, [
    el('h2', { text: plan ? plan.name : t('home.vsPlan.plan') }),
    el('button.btn.quiet.sm', { onclick: () => navigate('plans') }, [t('train.manage')]),
  ]));

  if (!plan || !plan.days.length) {
    root.append(el('div.card', {}, [
      el('div.muted.small', { text: t('train.noPlan') }),
      el('button.btn.ghost.full.sm', {
        style: { marginTop: '10px' },
        onclick: () => navigate('plans'),
      }, [t('train.choosePlan')]),
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
            ? t('train.restNext', { day: today.next.day.name, weekday: weekdayName(today.next.weekday) })
            : t('train.restNothing'),
        }),
        el('div.small.faint', { style: { marginTop: '6px' }, text: t('train.restAnyway') }),
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
        title: day.name + (isNext ? `  ·  ${t(today.scheduled ? 'train.today' : 'train.upNext')}` : ''),
        sub: [
          tn(names.length, 'unit.exercise'),
          dayLabel,
          last ? t('train.lastTrained', { when: relLabel(last) }) : t('train.neverTrained'),
        ].filter(Boolean).join(' · '),
        ariaLabel: t('train.startDay', { day: day.name }),
        onclick: async () => {
          await store.startSession({ planId: plan.id, dayId: day.id });
          toast(t('train.startedDay', { day: day.name }));
        },
      }));
    }
  }

  if (done.length) {
    const last = done[0];
    const st = sessionStats(last);
    root.append(el('div.section-head', {}, [el('h2', { text: t('train.lastSession') })]));
    root.append(listItem({
      title: last.name,
      sub: `${new Date(last.startedAt).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })} · ${tn(st.sets, 'unit.set')} · ${fmtNum(st.volume)}${store.units()}`,
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
        el('div.small.faint', { text: t('train.startedAt', { time: new Date(session.startedAt).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }) }) }),
      ]),
      el('button.btn.sm.ghost', { onclick: () => renameSession(session) }, [t('train.rename')]),
    ]),
    el('div.stat-grid', {}, [
      el('div.stat', {}, [elapsed, el('span.stat-key', { text: t('train.elapsed') })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(st.sets) }), el('span.stat-key', { text: t('train.sets') })]),
      el('div.stat', {}, [el('span.stat-val', { text: fmtNum(st.volume) }), el('span.stat-key', { text: t('train.volume', { units }) })]),
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
    root.append(emptyState(t('train.noExercises'), t('train.noExercisesHint')));
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
        toast(t('picker.added', { name: ex.name }));
      }, session.entries.map((e) => e.exerciseId)),
    }, [t('train.addExercise')])
  );

  root.append(
    el('div.stack', { style: { marginTop: '22px' } }, [
      el('button.btn.primary.full', {
        style: { minHeight: '54px' },
        onclick: () => finishFlow(session),
      }, [t('train.finish')]),
      el('button.btn.full.danger', { onclick: () => discardFlow(session) }, [t('train.discard')]),
    ])
  );

  return root;
}

function exerciseBlock(session, entry, entryIndex) {
  const ex = store.state.exerciseById.get(entry.exerciseId);
  const units = ex?.units || store.units();
  const name = ex ? ex.name : t('train.unknownExercise');
  const block = el('div.card.exercise-block');

  block.append(
    el('div.exercise-head', {}, [
      el('h3', { text: name }),
      el('button.btn.quiet.sm', {
        'aria-label': t('train.optionsFor', { name }),
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
    const tip = store.state.settings.progressionSuggestions !== false
      ? suggestNext(last, entry.targetReps, ex, units, entry.progressionRule)
      : null;
    if (tip) {
      block.append(
        el('div.suggest', {}, [
          el('b', { text: tip.headline }),
          el('span', { text: `: ${tip.why}` }),
        ])
      );
    }
  } else {
    block.append(el('div.small.faint', { style: { marginBottom: '10px' }, text: t('train.firstTime') }));
  }

  if (store.state.settings.warmupSuggestions !== false) block.append(warmupOffer(session, entry, ex, units));

  if (entry.note) {
    block.append(el('div.small.muted', { style: { marginBottom: '8px' }, text: entry.note }));
  }

  if (ex && ['Machine', 'Cable'].includes(ex.equipment)) {
    const setup = store.state.settings.machineSetups?.[ex.id];
    const summary = setup && [
      setup.seat && `${t('train.machine.seat')}: ${setup.seat}`,
      setup.backrest && `${t('train.machine.backrest')}: ${setup.backrest}`,
      setup.pad && `${t('train.machine.pad')}: ${setup.pad}`,
      setup.note,
    ].filter(Boolean).join(' · ');
    block.append(el('button.btn.ghost.full.sm', {
      style: {
        marginBottom: '10px', textAlign: 'left', justifyContent: 'flex-start',
        whiteSpace: 'normal', lineHeight: '1.35', paddingTop: '8px', paddingBottom: '8px',
      },
      onclick: () => machineSetupSheet(ex),
    }, [summary ? `⚙ ${summary}` : `⚙ ${t('train.machine.saveSetup')}`]));
  }

  const rirOn = store.state.settings.logRir !== false;
  const bodyweightLoad = ['Pull-Up', 'Chin-Up', 'Dip'].includes(ex?.name);
  block.append(el('div.set-labels' + (rirOn ? '.with-rir' : ''), {}, [
    el('span', { text: t('train.col.set') }), el('span', { text: bodyweightLoad ? `+${units}` : units }),
    el('span', { text: t('train.col.reps') }),
    rirOn ? el('span', { text: 'RIR', title: t('train.rirTitle') }) : null,
    el('span', { text: '✓' }),
  ]));

  entry.sets.forEach((set, i) => {
    block.append(setRow(session, entry, set, i, last, ex));
  });

  block.append(
    el('button.btn.ghost.full.sm', {
      style: { marginTop: '8px' },
      onclick: async () => {
        const prev = entry.sets.filter((s) => s.type === 'working').slice(-1)[0] || null;
        await store.updateSession(session.id, () => { entry.sets.push(newSet(prev)); });
      },
    }, [t('train.addSet')])
  );

  return block;
}

function setRow(session, entry, set, index, last, ex) {
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
      title: t('train.toggleWarmup'),
      onclick: async () => {
        await store.updateSession(session.id, () => {
          set.type = set.type === 'warmup' ? 'working' : 'warmup';
        });
      },
    }, [set.type === 'warmup' ? t('train.warmupLetter') : String(workingNo)])
  );

  // `last.sets` holds only the working sets from last time, so it has to be
  // indexed by working-set number, not by row. Indexing by row meant that two
  // warm-up sets shifted every placeholder two sets down the list — set 1 would
  // suggest what you did on set 3.
  const hint = set.type === 'warmup' || !last
    ? null
    : last.sets[workingNo - 1] || last.sets[last.sets.length - 1];

  const weight = normaliseOnBlur(numberInput({
    decimal: true,
    value: set.weight ?? '',
    placeholder: hint ? String(hint.weight) : '–',
    'aria-label': ['Pull-Up', 'Chin-Up', 'Dip'].includes(ex?.name) ? t('train.addedWeight') : t('train.weight'),
  }));
  const reps = normaliseOnBlur(numberInput({
    value: set.reps ?? '',
    placeholder: hint ? String(hint.reps) : '–',
    'aria-label': t('train.col.reps'),
  }), { integer: true });

  // Keystrokes persist quietly — a re-render here would kill the caret.
  weight.addEventListener('input', () => {
    set.weight = parseNumber(weight.value);
    if (['Pull-Up', 'Chin-Up', 'Dip'].includes(ex?.name)) set.loadMode = 'added';
    saveSoon(session);
  });
  reps.addEventListener('input', () => {
    const n = parseNumber(reps.value);
    set.reps = n === null ? null : Math.round(n);
    saveSoon(session);
  });
  [weight, reps].forEach((input) => {
    input.addEventListener('focus', () => input.select());
  });

  // Reps in reserve. Optional by design — the rating never punishes a blank,
  // it just says it cannot judge effort. A required field here would get filled
  // in with noise, which is worse than nothing.
  const rir = normaliseOnBlur(numberInput({
    class: 'rir',
    value: set.rir ?? '',
    placeholder: '–',
    'aria-label': t('train.rirFor', { n: workingNo }),
    title: t('train.rirTitleLong'),
  }), { integer: true });
  rir.addEventListener('input', () => {
    const n = parseNumber(rir.value);
    set.rir = n === null ? null : Math.max(0, Math.min(10, Math.round(n)));
    saveSoon(session);
  });
  rir.addEventListener('focus', () => rir.select());

  const doneBtn = el('button.done-btn', {
    'aria-label': t(set.done ? 'train.untick' : 'train.tick'),
    'aria-pressed': String(!!set.done),
    onclick: () => toggleDone(session, entry, set, weight, reps, hint),
  }, ['✓']);

  const weightCell = ex?.equipment === 'Barbell'
    ? el('div.set-weight-cell', {}, [weight, el('button.set-plates', {
        'aria-label': t('train.menu.whatToLoad'),
        onclick: () => plateSheet(entry, ex, Number(weight.value) || Number(set.weight) || 0),
      }, ['◉'])])
    : weight;
  row.append(weightCell, reps, rirOn ? rir : null, doneBtn);
  return row;
}

/**
 * Offer a warm-up, once, quietly.
 *
 * Only when there is a working weight to ramp towards and no warm-up already
 * logged — the offer disappears the moment it is taken or made unnecessary,
 * rather than sitting there for the rest of the session.
 *
 * The label says "gym practice" because that is exactly what it is: no trial
 * establishes an optimal ramp, and this app does not print numbers whose origin
 * it cannot name. Two sets on a barbell lift, one on everything else.
 */
function warmupOffer(session, entry, ex, units) {
  const wrap = el('div');
  if (entry.sets.some((s) => s.type === 'warmup')) return wrap;

  // What the working sets are aiming at: whatever is already typed in, else
  // what the suggestion is built from.
  const planned = Math.max(0, ...entry.sets
    .filter((s) => s.type === 'working')
    .map((s) => Number(s.weight) || 0));
  const last = planned || (() => {
    const prev = lastPerformance(store.state.sessions, entry.exerciseId, session.id);
    return prev ? prev.stats.topWeight : 0;
  })();

  const sets = warmupSets(ex, last, { units, barWeight: store.barWeight() });
  if (!sets.length) return wrap;

  wrap.append(
    el('button.btn.quiet.sm', {
      style: { padding: '2px 0', marginBottom: '8px', textAlign: 'left' },
      onclick: async () => {
        await store.updateSession(session.id, () => {
          // In front of the working sets, which is where they belong and where
          // the set numbering expects them.
          entry.sets.unshift(...sets.map((s) => ({
            ...newSet(), weight: s.weight, reps: s.reps, type: 'warmup',
          })));
        });
        toast(t('train.warmupAdded', { sets: tn(sets.length, 'unit.warmupSet') }));
      },
    }, [t('train.warmupOffer', { sets: sets.map((w) => `${fmtWeight(w.weight, units)} × ${w.reps}`).join(', ') })])
  );
  wrap.append(el('div.small.faint', { style: { marginTop: '-6px', marginBottom: '8px', fontSize: '11px' },
    text: t('train.warmupCaveat') }));
  return wrap;
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
function suggestNext(last, targetReps, ex, units, rule = 'double') {
  const sets = last.sets;
  if (!sets.length) return null;

  const range = parseReps(targetReps) || { low: 6, high: 10 };
  const reps = sets.map((s) => Number(s.reps) || 0);
  const rirs = sets.map((s) => s.rir).filter((v) => v !== null && v !== undefined);
  const topWeight = Math.max(...sets.map((s) => Number(s.weight) || 0));
  if (!topWeight) return null;

  const step = ex && ex.equipment === 'Dumbbell' ? (units === 'lb' ? 5 : 2) : (units === 'lb' ? 5 : 2.5);
  const next = `${fmtWeight(topWeight + step, units)}`;

  if (rule === 'manual') return null;
  if (rule === 'reps') return {
    headline: t('train.tip.stay', { weight: fmtWeight(topWeight, units) }),
    why: t('train.tip.addReps', { high: range.high }),
  };
  if (rule === 'weight') return {
    headline: t('train.tip.try', { weight: next }),
    why: t('train.tip.weightRule'),
  };

  // Effort first: it overrides the rep count in both directions.
  if (rirs.length && Math.min(...rirs) >= 3) {
    return {
      headline: t('train.tip.try', { weight: next }),
      why: t('train.tip.easy', { rir: Math.min(...rirs) }),
    };
  }
  if (rirs.length && Math.max(...rirs) === 0 && reps.some((r) => r < range.low)) {
    return {
      headline: t('train.tip.stay', { weight: fmtWeight(topWeight, units) }),
      why: t('train.tip.failedLow'),
    };
  }

  if (reps.every((r) => r >= range.high)) {
    return {
      headline: t('train.tip.try', { weight: next }),
      why: t('train.tip.cleared', { high: range.high })
        + (rirs.length ? '' : ` ${t('train.tip.logRir')}`),
    };
  }
  if (reps.some((r) => r < range.low)) {
    return {
      headline: t('train.tip.stay', { weight: fmtWeight(topWeight, units) }),
      why: t('train.tip.buildBack', { low: range.low }),
    };
  }
  return {
    headline: t('train.tip.stay', { weight: fmtWeight(topWeight, units) }),
    why: t('train.tip.addReps', { high: range.high }),
  };
}

function parseReps(spec) {
  if (!spec) return null;
  const nums = String(spec).match(/\d+/g);
  if (!nums || !nums.length) return null;
  const ns = nums.map(Number);
  return { low: Math.min(...ns), high: Math.max(...ns) };
}

/**
 * Tick or untick a set.
 *
 * Every change to the session happens inside the mutate callback, and nothing
 * is celebrated until the write comes back. `store.updateSession` takes its
 * undo snapshot at the moment it is called, so anything changed before the call
 * is a change it cannot roll back — this used to mutate first and pass an empty
 * callback, which quietly made the rollback a no-op on the one action that
 * matters most. Firing the PR toast and the rest timer first had the same
 * shape: a personal best announced for a set that never reached the disk.
 */
async function toggleDone(session, entry, set, weightInput, repsInput, hint) {
  const turningOn = !set.done;
  let fill = null;

  if (turningOn) {
    // Empty fields fall back to the placeholder — repeating last week is the
    // common case and shouldn't need typing.
    const weight = (set.weight === null || set.weight === undefined || weightInput.value === '')
      ? (hint ? hint.weight : null)
      : set.weight;
    const reps = (!set.reps || repsInput.value === '')
      ? (hint ? hint.reps : null)
      : set.reps;

    if (weight === null || weight === undefined) { toast(t('train.needWeight')); weightInput.focus(); return; }
    if (!reps) { toast(t('train.needReps')); repsInput.focus(); return; }
    fill = { weight, reps };
  }

  const saved = await store.updateSession(session.id, () => {
    if (fill) { set.weight = fill.weight; set.reps = fill.reps; }
    set.done = turningOn;
  });
  if (!saved) return;   // rolled back, and the failure has already been reported

  if (fill) { weightInput.value = String(fill.weight); repsInput.value = String(fill.reps); }
  haptic(turningOn ? 12 : 6);

  if (turningOn) {
    const pr = checkPR(session, entry, set);
    if (pr) {
      toast(pr, 2600);
      const ex = store.state.exerciseById.get(entry.exerciseId);
      if (ex && cloud.isSignedIn() && !set.prSharedAt) {
        cloud.publishSocialPr(ex.name, e1rm(set.weight,set.reps), pr).then(() => {
          set.prSharedAt = Date.now();
          store.saveSessionQuiet(session);
        }).catch(() => {});
      }
    }
    if (set.type === 'working' && store.state.settings.autoStartRest) {
      rest.start(store.state.settings.restSeconds, {
        sound: store.state.settings.soundOnRestEnd !== false,
      });
    }
  }
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
  if (w > bestWeight) return t('train.pr.weight', { weight: fmtWeight(w, units) });
  if (e1rm(set.weight, set.reps) > bestE1rm) return t('train.pr.e1rm');
  return null;
}

/**
 * What to hang on the bar for a given total.
 *
 * Opens on the heaviest weight already written into this exercise, because that
 * is nearly always the number you are asking about. It reports the load it can
 * actually reach: the gym has no 0.5 kg discs, so a target it cannot hit says
 * so instead of printing a plate list that adds up to something else.
 */
function plateSheet(entry, ex, initialWeight = null) {
  const units = store.units();
  const bar = store.barWeight();
  const start = initialWeight || Math.max(0, ...entry.sets.map((s) => Number(s.weight) || 0));

  const input = normaliseOnBlur(numberInput({
    decimal: true,
    value: start || '',
    placeholder: t('train.plates.total', { units }),
    'aria-label': t('train.plates.target'),
  }));
  const out = el('div', { style: { marginTop: '4px' } });

  function paint() {
    const plan = platePlan(parseNumber(input.value), bar, units);
    if (!plan) {
      out.replaceChildren(el('div.small.faint', {
        text: t('train.plates.atLeastBar', { bar: fmtWeight(bar, units) }),
      }));
      return;
    }
    out.replaceChildren(
      el('div.card.tight', {}, [
        el('div', { style: { fontSize: '19px', fontWeight: '720' },
          text: plan.barOnly ? t('train.plates.barOnly') : t('train.plates.perSide', { plates: describePlates(plan.perSide) }) }),
        el('div.small.faint', { style: { marginTop: '4px' },
          text: t('train.plates.onBar', { loaded: fmtWeight(plan.loaded, units), bar: fmtWeight(bar, units) }) }),
        plan.exact ? null : el('div.small', { style: { marginTop: '6px', color: 'var(--warn)' },
          text: t(plan.off < 0 ? 'train.plates.under' : 'train.plates.over', { off: fmtWeight(Math.abs(plan.off), units) }) }),
      ])
    );
  }
  input.addEventListener('input', paint);
  paint();

  openSheet(t('train.plates.title', { name: ex.name }), el('div', {}, [
    el('label.field', {}, [el('span', { text: t('train.plates.targetField', { units }) }), input]),
    out,
    el('div.small.faint', { style: { marginTop: '14px' },
      text: t('train.plates.assumes', { bar: fmtWeight(bar, units), plates: PLATES[units].join(', ') }) }),
  ]));
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
  const applyTemporarySwap = async (pick) => {
    await store.updateSession(session.id, () => { entry.exerciseId = pick.id; });
    closeSheet();
    toast(t('train.temporarySwap', { name: pick.name }));
  };
  const temporarySwap = () => pickExercise(applyTemporarySwap, session.entries.map((e) => e.exerciseId));

  const body = el('div.stack', {}, [
    ex ? el('button.btn.ghost.full', {
      onclick: () => { closeSheet(); howToSheet(ex); },
    }, [t('train.menu.howTo')]) : null,
    ex && ['Machine', 'Cable'].includes(ex.equipment) ? el('button.btn.ghost.full', {
      onclick: () => machineSetupSheet(ex),
    }, [t('train.machine.editSetup')]) : null,
    entry.alternativeExerciseId && store.state.exerciseById.has(entry.alternativeExerciseId)
      ? el('button.btn.primary.full', { onclick: () => {
          const alternative = store.state.exerciseById.get(entry.alternativeExerciseId);
          applyTemporarySwap(alternative);
        } }, [t('train.useAlternative', { name: store.state.exerciseById.get(entry.alternativeExerciseId).name })])
      : null,
    el('button.btn.ghost.full', { onclick: () => temporarySwap() }, [t('train.replaceOnce')]),
    // Only for a loaded bar. On a machine "per side" means nothing, and on a
    // dumbbell there is nothing to work out.
    ex && ex.equipment === 'Barbell'
      ? el('button.btn.ghost.full', {
          onclick: () => { closeSheet(); plateSheet(entry, ex); },
        }, [t('train.menu.whatToLoad')])
      : null,
    el('button.btn.ghost.full', { onclick: () => { closeSheet(); noteForm(session, entry); } }, [t('train.menu.note')]),
    el('button.btn.ghost.full', { disabled: index === 0, onclick: () => move(-1) }, [`↑ ${t('train.menu.up')}`]),
    el('button.btn.ghost.full', { disabled: index === session.entries.length - 1, onclick: () => move(1) }, [`↓ ${t('train.menu.down')}`]),
    el('button.btn.full.danger', {
      onclick: async () => {
        closeSheet();
        const ok = await confirmSheet(t('train.menu.removeTitle'),
          t('train.menu.removeBody', { name }), { confirmLabel: t('common.remove') });
        if (!ok) return;
        await store.updateSession(session.id, (s) => { s.entries.splice(index, 1); });
      },
    }, [t('train.menu.removeAction')]),
  ]);
  openSheet(name, body);
}

function machineSetupSheet(ex) {
  const saved = store.state.settings.machineSetups?.[ex.id] || {};
  const field = (key, placeholder) => el('input', { type: 'text', value: saved[key] || '', placeholder });
  const seat = field('seat', t('train.machine.seatPlaceholder'));
  const backrest = field('backrest', t('train.machine.backrestPlaceholder'));
  const pad = field('pad', t('train.machine.padPlaceholder'));
  const note = field('note', t('train.machine.notePlaceholder'));
  openSheet(t('train.machine.title', { name: ex.name }), el('div', {}, [
    el('div.small.muted', { style: { marginBottom: '12px' }, text: t('train.machine.intro') }),
    el('label.field', {}, [el('span', { text: t('train.machine.seat') }), seat]),
    el('label.field', {}, [el('span', { text: t('train.machine.backrest') }), backrest]),
    el('label.field', {}, [el('span', { text: t('train.machine.pad') }), pad]),
    el('label.field', {}, [el('span', { text: t('train.machine.note') }), note]),
    el('button.btn.primary.full', { onclick: async () => {
      const setups = { ...(store.state.settings.machineSetups || {}) };
      const next = { seat: seat.value.trim(), backrest: backrest.value.trim(), pad: pad.value.trim(), note: note.value.trim() };
      if (Object.values(next).some(Boolean)) setups[ex.id] = next;
      else delete setups[ex.id];
      await store.setSetting('machineSetups', setups);
      closeSheet();
      toast(t('train.machine.saved'));
    } }, [t('common.save')]),
    Object.keys(saved).length ? el('button.btn.quiet.full', { onclick: async () => {
      const setups = { ...(store.state.settings.machineSetups || {}) };
      delete setups[ex.id];
      await store.setSetting('machineSetups', setups);
      closeSheet();
      toast(t('train.machine.cleared'));
    } }, [t('train.machine.clear')]) : null,
  ]));
}

/** Demo frames + steps, one tap from the workout rather than cluttering it. */
function howToSheet(ex) {
  const body = el('div', {}, [
    exerciseArt(ex, { eager: true }),
    el('div.small.muted', { style: { marginTop: '10px' },
      text: `${tMuscle(ex.muscle)} · ${tEquipment(ex.equipment)}` }),
    ex.instructions && ex.instructions.length
      ? el('ol', { style: { marginTop: '14px', paddingLeft: '20px', fontSize: '14px', lineHeight: '1.55' } },
          ex.instructions.map((s) => el('li', { text: s, style: { marginBottom: '8px' } })))
      : el('div.small.faint', { style: { marginTop: '12px' }, text: t('train.noSteps') }),
  ]);
  openSheet(ex.name, body);
}

function noteForm(session, entry) {
  const input = el('textarea', { placeholder: t('train.notePlaceholder') });
  input.value = entry.note || '';
  const body = el('div', {}, [
    el('label.field', {}, [el('span', { text: t('train.noteField') }), input]),
    el('button.btn.primary.full', {
      onclick: async () => {
        await store.updateSession(session.id, () => { entry.note = input.value.trim(); });
        closeSheet();
      },
    }, [t('train.saveNote')]),
  ]);
  openSheet(t('train.noteTitle'), body);
}

function renameSession(session) {
  const input = el('input', { type: 'text', value: session.name });
  const body = el('div', {}, [
    el('label.field', {}, [el('span', { text: t('train.workoutName') }), input]),
    el('button.btn.primary.full', {
      onclick: async () => {
        await store.updateSession(session.id, (s) => { s.name = input.value.trim() || t('train.defaultName'); });
        closeSheet();
      },
    }, [t('common.save')]),
  ]);
  openSheet(t('train.renameTitle'), body);
}

/* ============================ finish ============================ */

async function finishFlow(session) {
  const completed = session.entries.reduce((n, e) => n + e.sets.filter(isCounted).length, 0);

  if (!completed) {
    const ok = await confirmSheet(
      t('train.nothingLogged'),
      t('train.nothingLoggedBody'),
      { confirmLabel: t('home.stale.discard') });
    if (ok) { await store.discardSession(session.id); rest.stop(); toast(t('home.stale.discarded')); }
    return;
  }

  const pending = session.entries.reduce(
    (n, e) => n + e.sets.filter((s) => !s.done && (s.weight || s.reps)).length, 0);

  const st = sessionStats(session);
  const body = el('div', {}, [
    el('div.stat-grid', { style: { marginBottom: '14px' } }, [
      el('div.stat', {}, [el('span.stat-val', { text: fmtDuration(st.durationMs) }), el('span.stat-key', { text: t('train.time') })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(completed) }), el('span.stat-key', { text: t('train.sets') })]),
      el('div.stat', {}, [el('span.stat-val', { text: fmtNum(st.volume) }), el('span.stat-key', { text: t('train.volume', { units: store.units() }) })]),
    ]),
    pending
      ? el('div.small.muted', { style: { marginBottom: '12px' },
          text: t('train.pending', { sets: tn(pending, 'unit.set') }) })
      : null,
    el('button.btn.primary.full', {
      onclick: async () => {
        closeSheet();
        await store.finishSession(session.id);
        rest.stop();
        toast(t('train.savedToast'), 2400);
        navigate('calendar', session.id);
      },
    }, [t('train.saveWorkout')]),
    el('button.btn.ghost.full', { style: { marginTop: '10px' }, onclick: closeSheet }, [t('train.keepGoing')]),
  ]);
  openSheet(t('train.finish'), body);
}

async function discardFlow(session) {
  const ok = await confirmSheet(
    t('train.discardTitle'),
    t('train.discardBody'),
    { confirmLabel: t('home.stale.discard') });
  if (!ok) return;
  await store.discardSession(session.id);
  rest.stop();
  toast(t('home.stale.discarded'));
  render();
}

function relLabel(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today - d) / 86400000);
  if (days === 0) return t('train.rel.today');
  if (days === 1) return t('common.yesterday');
  if (days < 7) return t('train.rel.days', { n: days });
  return t('train.rel.weeks', { n: Math.round(days / 7) });
}

export { entryStats };
