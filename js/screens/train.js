// Train — the active workout, or the launcher when nothing is running.

import {
  el, $, toast, haptic, fmtWeight, fmtDuration, fmtNum, fmtVolume, setsSummary,
  openSheet, closeSheet, confirmSheet, emptyState, debounce, listItem,
  numberInput, parseNumber, normaliseOnBlur, undoToast,
} from '../ui.js';
import * as store from '../store.js';
import * as rest from '../rest.js';
import * as cloud from '../cloud.js';
import {
  newSet, newEntry, entryStats, sessionStats, lastPerformance, e1rm, isCounted,
  bodyweightLoadMode, effectiveSetWeight,
} from '../models.js';
import { pickExercise } from '../pickers.js';
import { todaysDays, weekdayName, weekdayShort } from '../schedule.js';
import { exerciseArt } from '../exercise-art.js';
import { platePlan, describePlates, PLATES } from '../plates.js';
import { warmupSets } from '../warmup.js';
import {
  exerciseHistory, priorWork, openingSet, nextSet, pooledOrderCost, loadStep as defaultStep,
} from '../progression.js';
import { alreadyWarm } from '../warmup.js';
import { isPlateLoaded } from '../standards.js';
import { navigate, render, flushBackup, startWorkout } from '../app.js';
import { requestWorkoutStart } from '../workout-start.js';
import { t, tn, tMuscle, tEquipment, locale } from '../i18n.js';
import { SOURCES } from '../evidence.js';

const saveSoon = debounce((session) => store.saveSessionQuiet(session), 350);
const openHistories = new Set();
// Which exercises are showing the reasoning behind their suggestion. Closed by
// default: in the gym the number is the answer, and the three-line explanation
// of how it was reached pushed the first input field off the screen.
const openReasons = new Set();

export default function renderTrain({ actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': t('common.settings'), title: t('common.settings') }, ['⚙']));
  const session = store.activeSession();
  if (session?.originDevice && session.originDevice !== store.installationId()) {
    return remoteWorkoutView(session);
  }
  return session ? activeView(session) : launcherView();
}

function remoteWorkoutView(session) {
  return el('div.card.glow', {}, [
    el('div', { style: { fontSize: '18px', fontWeight: '730' }, text: t('train.remoteActiveTitle') }),
    el('div.small.muted', { style: { marginTop: '7px' }, text: t('train.remoteActiveBody', { name: session.name }) }),
    el('button.btn.primary.full', { style: { marginTop: '16px' }, onclick: () => flushBackup() }, [t('train.remoteRefresh')]),
    el('button.btn.ghost.full', { style: { marginTop: '8px' }, onclick: async () => {
      await store.updateSession(session.id, (row) => { row.originDevice = store.installationId(); });
      flushBackup();
    } }, [t('train.remoteTakeOver')]),
    el('div.small.faint', { style: { marginTop: '10px' }, text: t('train.remoteTakeOverNote') }),
  ]);
}

/* ============================ launcher ============================ */

function launcherView() {
  const done = store.state.sessions.filter((s) => s.finishedAt);
  const plan = store.activePlan();
  const root = el('div');

  root.append(
    el('button.btn.primary.full', {
      style: { minHeight: '56px', fontSize: '16px', marginBottom: '18px' },
      onclick: async () => { await startWorkout({}); toast(t('train.started')); },
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
          const started = await requestWorkoutStart({ planId: plan.id, dayId: day.id });
          if (!started) return;
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
      sub: `${new Date(last.startedAt).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })} · ${tn(st.sets, 'unit.set')} · ${fmtVolume(st.volume, store.units())}`,
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
      // Renaming is on the name, not on a second button beside it. Two German
      // words ("Pausieren", "Umbenennen") took most of a 375px row, which left
      // the title wrapping over two lines and the start time over two more.
      el('button.session-name', {
        onclick: () => renameSession(session),
        'aria-label': `${session.name}, ${t('train.rename')}`,
      }, [
        el('div.row', { style: { gap: '6px', alignItems: 'baseline' } }, [
          el('span.session-name-text', { text: session.name }),
          el('span.session-name-pencil', { text: '✎', 'aria-hidden': 'true' }),
        ]),
        el('div.small.faint', { text: t('train.startedAt', { time: new Date(session.startedAt).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }) }) }),
      ]),
      el('button.btn.sm.ghost', { style: { flex: 'none' }, onclick: async () => {
        if (session.pausedAt) await store.resumeSession(session.id);
        else { await store.pauseSession(session.id); rest.stop(); }
      } }, [t(session.pausedAt ? 'train.resume' : 'train.pause')]),
    ]),
    el('div.stat-grid', {}, [
      el('div.stat', {}, [elapsed, el('span.stat-key', { text: t('train.elapsed') })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(st.sets) }), el('span.stat-key', { text: t('train.sets') })]),
      el('div.stat', {}, [el('span.stat-val', { text: fmtNum(st.volume) }), el('span.stat-key', { text: t('train.volume', { units }) })]),
    ]),
  ]);
  root.append(header);
  if (session.pausedAt) root.append(el('div.pause-banner', {}, [
    el('b', { text: t('train.paused') }), el('span', { text: t('train.pausedBody') }),
  ]));

  // Tick the elapsed clock without re-rendering the whole screen.
  const clockTimer = setInterval(() => {
    if (!document.body.contains(elapsed)) { clearInterval(clockTimer); return; }
    elapsed.textContent = fmtDuration(sessionStats(session).durationMs);
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

  // Everything the advice is built from: the whole log for this exercise, each
  // session corrected for where in that session it happened, plus where in
  // *this* session we are standing right now.
  // What a blank RIR is worth. Zero while the column is on and the user simply
  // left it empty would be a guess about that one set; the setting is a
  // standing answer, and it is the only place the app is allowed to fill one in.
  const assumedRir = Number(store.state.settings.assumedRir) || 0;
  const rows = exerciseHistory(store.state.sessions, entry.exerciseId, store.state.exerciseById, {
    excludeSessionId: session.id,
    assumedRir,
    // Pooled across the whole log, so an exercise that has only ever been
    // trained from one position still gets a measured cost rather than a prior.
    fallbackCost: pooledOrderCost(store.state.sessions, store.state.exerciseById, { assumedRir }),
  });
  const prior = priorWork(session.entries, entryIndex, store.state.exerciseById);
  const doneToday = entry.sets.filter(isCounted);
  const suggesting = store.state.settings.progressionSuggestions !== false;

  // Once a set is on the board today, the live advice is the better number and
  // the opening one is history. Two suggestions disagreeing on the same screen
  // is worse than one, so only ever one of these is non-null.
  const step = store.machineStep(ex);
  const opening = suggesting && !doneToday.length
    ? openingSet(rows, {
        exercise: ex, targetReps: entry.targetReps, rule: entry.progressionRule,
        units, barWeight: store.barWeight(), prior, step, assumedRir,
      })
    : null;

  // The live number. One completed set today outweighs four sessions of
  // history, so from the moment set one is ticked off the advice comes from
  // today's own effort, this lifter's own set-to-set drop-off, and the rep
  // range.
  const live = suggesting && doneToday.length
    ? nextSet(doneToday, rows, {
        exercise: ex, targetReps: entry.targetReps, units, barWeight: store.barWeight(), step, assumedRir,
      })
    : null;

  // The single most useful line on the screen: what you did last time.
  const last = lastPerformance(store.state.sessions, entry.exerciseId, session.id);
  if (last) {
    block.append(
      el('div.last-time', {}, [
        el('span', { text: `${relLabel(last.session.startedAt)}: ` }),
        el('b', { text: setsSummary(last.sets, units) }),
        lastRirLabel(last.sets),
        orderLabel(rows, prior, session, entryIndex),
      ])
    );
    const tip = opening;
    if (tip) {
      // A bodyweight movement has no weight to name, so the same engine answer
      // is read out as a rep target instead of a load.
      const headline = (bodyweightLoadMode(ex) === 'bodyweight'
        ? t('train.tip.bodyweight', { reps: tip.reps })
        : t(`train.tip.${tip.change}`, { weight: fmtWeight(tip.weight, units), reps: tip.reps }))
        + (entry.movementMode === 'unilateral' ? ` ${t('train.perSide')}` : '');
      block.append(reasonedSuggestion(entry.exerciseId, headline, describeReasons(tip.reasons, units)));
    }
    if (store.state.settings.setHistory !== false) {
      const history = store.state.sessions.filter((row) => row.finishedAt && row.id !== session.id)
        .map((row) => ({ session: row, entry: row.entries.find((item) => item.exerciseId === entry.exerciseId) }))
        .filter((row) => row.entry?.sets.some(isCounted))
        .sort((a, b) => b.session.startedAt - a.session.startedAt).slice(0, 3);
      const expanded = openHistories.has(entry.exerciseId);
      block.append(el('button.btn.quiet.sm', { style: { padding: '3px 0', marginBottom: expanded ? '4px' : '8px' },
        'aria-expanded': String(expanded), onclick: () => {
          if (expanded) openHistories.delete(entry.exerciseId); else openHistories.add(entry.exerciseId);
          render();
        } }, [t(expanded ? 'train.hideSetHistory' : 'train.showSetHistory')]));
      if (expanded) block.append(el('div.set-history', {}, history.map((row) => el('div.row.between.small', {}, [
        el('span.faint', { text: new Date(row.session.startedAt).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' }) }),
        el('b', { text: setsSummary(row.entry.sets.filter(isCounted), units) }),
      ]))));
    }
  } else {
    block.append(el('div.small.faint', { style: { marginBottom: '10px' }, text: t('train.firstTime') }));
  }

  if (store.state.settings.warmupSuggestions !== false) {
    block.append(warmupOffer(session, entry, ex, units, {
      targetReps: entry.targetReps, warmedRegions: prior.warmedRegions, step,
    }));
  }

  if (entry.note) {
    block.append(el('div.small.muted', { style: { marginBottom: '8px' }, text: entry.note }));
  }

  if (ex && ['Machine', 'Cable'].includes(ex.equipment)) {
    const setup = store.state.settings.machineSetups?.[ex.id];
    const summary = setup && [
      setup.seat && `${t('train.machine.seat')}: ${setup.seat}`,
      setup.backrest && `${t('train.machine.backrest')}: ${setup.backrest}`,
      setup.pad && `${t('train.machine.pad')}: ${setup.pad}`,
      setup.step > 0 && t('train.machine.stepSummary', { step: fmtWeight(setup.step, units) }),
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
  const loadMode = bodyweightLoadMode(ex);
  block.append(el('div.set-labels' + (rirOn ? '.with-rir' : ''), {}, [
    el('span', { text: t('train.col.set') }), el('span', { text: loadMode === 'bodyweight'
      ? t('train.bodyweightShort') : loadMode === 'added' ? `+${units}` : units }),
    el('span', { text: t('train.col.reps') }),
    rirOn ? el('span', { text: 'RIR', title: t('train.rirTitle') }) : null,
    el('span', { text: '✓' }),
  ]));

  // Whichever advice is current becomes the empty field's meaning: the number
  // the screen just recommended has to be the number that gets logged when the
  // set is ticked without typing, or the suggestion is decoration.
  const pendingIndex = entry.sets.findIndex((s) => s.type === 'working' && !s.done);
  const usable = bodyweightLoadMode(ex) !== 'bodyweight' && (live || opening);
  // Logged one side at a time means the number on screen is one side's load.
  // Two words, and without them the suggestion reads as double the weight.
  const perSide = entry.movementMode === 'unilateral';

  entry.sets.forEach((set, i) => {
    const forThis = usable && i === pendingIndex ? usable : null;
    // The line only accompanies the live advice. The opening suggestion has
    // already said its piece in full at the top of the block.
    if (forThis && live) block.append(nextSetLine(live, units, perSide));
    block.append(setRow(session, entry, set, i, last, ex, forThis));
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

function setRow(session, entry, set, index, last, ex, advice = null) {
  if (entry.movementMode === 'unilateral') {
    return unilateralSetRow(session, entry, set, index, last, ex, advice);
  }
  const workingNo = entry.sets.slice(0, index + 1).filter((s) => s.type === 'working').length;
  const rirOn = store.state.settings.logRir !== false;
  const loadMode = bodyweightLoadMode(ex);
  const row = el('div.set-row'
    + (rirOn ? '.with-rir' : '')
    + (set.done ? '.done' : '')
    + (set.type === 'warmup' ? '.warmup' : ''));

  // The set number opens the quick menu: duplicate, warm-up and delete without
  // hunting through the exercise-level menu.
  row.append(
    el('button.set-no', {
      style: { background: 'none', border: 0 },
      title: t('train.setMenu'),
      onclick: () => setMenu(session, entry, set, index),
    }, [set.type === 'warmup' ? t('train.warmupLetter') : String(workingNo)])
  );

  // `last.sets` holds only the working sets from last time, so it has to be
  // indexed by working-set number, not by row. Indexing by row meant that two
  // warm-up sets shifted every placeholder two sets down the list — set 1 would
  // suggest what you did on set 3.
  // What an empty field means when it is ticked. The live advice wins where
  // there is one: after a completed set it is a better answer than last week,
  // and it has to be the same number the line above the row just printed or
  // ticking would quietly log something else.
  const hint = set.type === 'warmup' || !last
    ? (advice ? { weight: advice.weight, reps: advice.reps } : null)
    : advice || last.sets[workingNo - 1] || last.sets[last.sets.length - 1];

  const weight = normaliseOnBlur(numberInput({
    decimal: true,
    value: set.weight ?? '',
    placeholder: hint ? String(hint.weight) : '–',
    'aria-label': loadMode === 'added' ? t('train.addedWeight') : t('train.weight'),
  }));
  const reps = normaliseOnBlur(numberInput({
    value: set.reps ?? '',
    placeholder: hint ? String(hint.reps) : '–',
    'aria-label': t('train.col.reps'),
  }), { integer: true });

  // Keystrokes persist quietly — a re-render here would kill the caret.
  weight.addEventListener('input', () => {
    set.weight = parseNumber(weight.value);
    if (loadMode === 'added') {
      set.loadMode = 'added';
      set.systemWeight = Number(store.state.settings.bodyweight) + (Number(set.weight) || 0);
    } else {
      set.loadMode = 'external';
      set.systemWeight = Number(set.weight) || 0;
    }
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
    onclick: () => toggleDone(session, entry, set, weight, reps, hint, ex),
  }, ['✓']);

  const weightCell = loadMode === 'bodyweight'
    ? el('div.bodyweight-load', { text: store.state.settings.bodyweight
      ? fmtWeight(store.state.settings.bodyweight, store.units()) : t('train.bodyweightMissingShort') })
    : ex?.equipment === 'Barbell'
    ? el('div.set-weight-cell', {}, [weight, el('button.set-plates', {
        'aria-label': t('train.menu.whatToLoad'),
        onclick: () => plateSheet(entry, ex, Number(weight.value) || Number(set.weight) || 0),
      }, ['◉'])])
    : weight;
  row.append(weightCell, reps, rirOn ? rir : null, doneBtn);
  return row;
}

function unilateralSetRow(session, entry, set, index, last, ex, advice = null) {
  const workingNo = entry.sets.slice(0, index + 1).filter((row) => row.type === 'working').length;
  const row = el('div.unilateral-set' + (set.done ? '.done' : '')
    + (set.type === 'warmup' ? '.warmup' : ''));
  const hint = set.type === 'warmup' || !last
    ? (advice ? { weight: advice.weight, reps: advice.reps } : null)
    : advice || last.sets[workingNo - 1] || last.sets[last.sets.length - 1];
  const makeSide = (side, short) => {
    const weightKey = `${side}Weight`, repsKey = `${side}Reps`;
    const weight = normaliseOnBlur(numberInput({ decimal: true, value: set[weightKey] ?? '',
      placeholder: hint ? String(hint.weight) : '–', 'aria-label': t('train.sideWeight', { side: short }) }));
    const reps = normaliseOnBlur(numberInput({ value: set[repsKey] ?? '',
      placeholder: hint ? String(hint.reps) : '–', 'aria-label': t('train.sideReps', { side: short }) }), { integer: true });
    weight.addEventListener('input', () => { set[weightKey] = parseNumber(weight.value); saveSoon(session); });
    reps.addEventListener('input', () => {
      const value = parseNumber(reps.value); set[repsKey] = value === null ? null : Math.round(value); saveSoon(session);
    });
    [weight, reps].forEach((input) => input.addEventListener('focus', () => input.select()));
    return { node: el('div.unilateral-side', {}, [el('b', { text: short }), weight, reps]), weight, reps };
  };
  const left = makeSide('left', t('train.leftShort'));
  const right = makeSide('right', t('train.rightShort'));
  const done = el('button.done-btn', { 'aria-label': t(set.done ? 'train.untick' : 'train.tick'),
    'aria-pressed': String(!!set.done), onclick: async () => {
      if (!set.done) {
        const values = [left.weight, left.reps, right.weight, right.reps];
        if (values.some((input) => input.value === '')) { toast(t('train.needBothSides')); return; }
        const weights = [parseNumber(left.weight.value), parseNumber(right.weight.value)];
        const reps = [parseNumber(left.reps.value), parseNumber(right.reps.value)];
        if (weights.some((value) => value === null) || reps.some((value) => !value)) {
          toast(t('train.needBothSides')); return;
        }
        set.leftWeight = weights[0]; set.rightWeight = weights[1];
        set.leftReps = Math.round(reps[0]); set.rightReps = Math.round(reps[1]);
        // The conservative side feeds PRs and strength standards; volume uses
        // both sides in models.setVolume.
        set.weight = Math.min(...weights);
        set.reps = Math.min(set.leftReps, set.rightReps);
      }
      await toggleDone(session, entry, set,
        { value: String(set.weight ?? ''), focus() {} },
        { value: String(set.reps ?? ''), focus() {} }, hint);
    } }, ['✓']);
  row.append(el('button.set-no', { onclick: () => setMenu(session, entry, set, index),
    title: t('train.setMenu') }, [set.type === 'warmup' ? t('train.warmupLetter') : String(workingNo)]),
  el('div.unilateral-sides', {}, [left.node, right.node]), done);
  return row;
}

function setMenu(session, entry, set, index) {
  const duplicate = async () => {
    await store.updateSession(session.id, () => {
      const copy = newSet(set);
      copy.type = set.type;
      entry.sets.splice(index + 1, 0, copy);
    });
    closeSheet();
  };
  const remove = async () => {
    const snapshot = JSON.parse(JSON.stringify(set));
    await store.updateSession(session.id, () => entry.sets.splice(index, 1));
    closeSheet();
    undoToast(t('train.setRemoved'), () => store.updateSession(session.id, () => entry.sets.splice(index, 0, snapshot)));
  };
  openSheet(t('train.setMenuTitle', { n: index + 1 }), el('div.stack', {}, [
    el('button.btn.ghost.full', { onclick: duplicate }, [t('train.duplicateSet')]),
    el('button.btn.ghost.full', { onclick: async () => {
      await store.updateSession(session.id, () => { set.type = set.type === 'warmup' ? 'working' : 'warmup'; });
      closeSheet();
    } }, [t(set.type === 'warmup' ? 'train.makeWorking' : 'train.makeWarmup')]),
    el('button.btn.danger.full', { onclick: remove }, [t('train.removeSet')]),
  ]));
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
function warmupOffer(session, entry, ex, units, context = {}) {
  const wrap = el('div');
  if (ex?.equipment === 'Bodyweight') return wrap;
  if (entry.sets.some((s) => s.type === 'warmup')) return wrap;
  // A warm-up you are offered after the first working set is already logged is
  // an offer to warm up for work you have finished. The offer belongs to the
  // moment before the exercise starts and nowhere else.
  if (entry.sets.some(isCounted)) return wrap;

  // What the working sets are aiming at: whatever is already typed in, else
  // what the suggestion is built from.
  const planned = Math.max(0, ...entry.sets
    .filter((s) => s.type === 'working')
    .map((s) => Number(s.weight) || 0));
  const last = planned || (() => {
    const prev = lastPerformance(store.state.sessions, entry.exerciseId, session.id);
    return prev ? prev.stats.topWeight : 0;
  })();

  const sets = warmupSets(ex, last, {
    units, barWeight: store.barWeight(), step: context.step,
    targetReps: context.targetReps, warmedRegions: context.warmedRegions,
  });
  // Nothing to offer is now a real answer rather than a gap: a muscle already
  // trained this session does not need a second introduction, and the 2025
  // crossover found no cost to skipping. Say so instead of falling silent.
  if (!sets.length) {
    return alreadyWarm(ex, context.warmedRegions)
      ? el('div.small.faint', { style: { marginBottom: '8px' }, text: t('train.warmupNotNeeded') })
      : wrap;
  }

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
  // The caveat is a whole sentence about what the trials found. It belongs to
  // the sheet it opens, not above the first input field of a working set.
  wrap.append(el('button.small.faint', {
    style: { marginTop: '-6px', marginBottom: '8px', fontSize: '11px', background: 'none',
      border: 0, padding: 0, textAlign: 'left', color: 'var(--text-faint)' },
    onclick: () => warmupEvidenceSheet(),
  }, [`${t('train.warmupWhy')}  ›`]));
  return wrap;
}

/**
 * The suggestion, with its reasoning one tap away.
 *
 * The verdict is three words and the reasoning is three lines, and both used to
 * be printed together above the set rows. Collapsed, the whole exercise card
 * fits on a phone screen with the first weight field visible.
 */
function reasonedSuggestion(exerciseId, headline, reason) {
  const open = openReasons.has(exerciseId);
  return el('button.suggest', {
    'aria-expanded': String(open),
    onclick: () => {
      if (open) openReasons.delete(exerciseId); else openReasons.add(exerciseId);
      render();
    },
  }, [
    el('span.row.between', { style: { gap: '8px' } }, [
      el('b', { text: headline }),
      el('span.suggest-why', { text: open ? '⌄' : `${t('train.whyThis')} ›` }),
    ]),
    open ? el('span.suggest-reason', { text: reason }) : null,
  ]);
}

/* ======================= effort and progression ======================= */

/** "· 1–2 RIR" tail on the last-time line, when it was recorded. */
function lastRirLabel(sets) {
  const vals = sets.map((s) => s.rir).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return el('span.small.faint', { text: `  ·  ${lo === hi ? lo : `${lo}–${hi}`} RIR` });
}

/** "Set 2: 100 kg × ~7" — the live suggestion, sitting on the set it is about. */
function nextSetLine(advice, units, perSide = false) {
  return el('div.suggest.next-set', {}, [
    el('b', { text: t('train.next.headline', {
      n: advice.setNumber, weight: fmtWeight(advice.weight, units), reps: advice.reps,
    }) + (perSide ? ` ${t('train.perSide')}` : '') }),
    el('span', { text: `: ${t(`train.next.${advice.reason.key}`, advice.reason.params)}` }),
    el('div.small.faint', { style: { marginTop: '2px' }, text: t(
      advice.decayMeasured ? 'train.next.decayYours' : 'train.next.decayTypical',
      { pct: advice.decayPct }
    ) }),
  ]);
}

/**
 * The reasons behind a suggestion, in the order they matter.
 *
 * Two at most. The engine can produce four, and a paragraph under a number is
 * a paragraph nobody reads on a gym floor between sets.
 */
function describeReasons(reasons, units) {
  return reasons.slice(0, 2).map((r) => t(`train.why.${r.key}`, {
    ...r.params,
    weight: r.params.weight === undefined ? undefined : fmtWeight(round1(r.params.weight), units),
  })).join(' ');
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * "2 sets of chest work before this one" on the last-time line.
 *
 * The whole reason the correction exists is that it is invisible otherwise: the
 * lifter sees 100 × 8 last week and 95 × 8 today and reads a regression, when
 * what actually changed is that the bench was not free and the butterfly went
 * first. Naming it is half the value of measuring it.
 */
function orderLabel(rows, prior, session, entryIndex) {
  if (!rows.length) return null;
  const before = rows[rows.length - 1].prior.same;
  const now = prior.same;
  if (Math.abs(now - before) < 1) return null;
  return el('span.small', {
    style: { color: 'var(--warn)', display: 'block', marginTop: '2px' },
    text: t(now > before ? 'train.order.laterNow' : 'train.order.earlierNow', {
      now: fmtNum(round1(now)), before: fmtNum(round1(before)),
    }),
  });
}

/** Where the warm-up numbers come from, and where they stop. */
function warmupEvidenceSheet() {
  const sources = [SOURCES.ribeiro2020, SOURCES.warmup2025];
  openSheet(t('train.warmupEvidenceTitle'), el('div', {}, [
    // The one-line version, which used to sit above the set rows on the workout
    // screen. It is the answer to the question this sheet is opened by.
    el('div', { style: { fontWeight: '650', marginBottom: '8px' }, text: t('train.warmupCaveat') }),
    el('div.small.muted', { text: t('train.warmupEvidenceBody') }),
    ...sources.map((source) => el('div', { style: { marginTop: '14px' } }, [
      el('a', {
        href: source.url, target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)', fontWeight: '620', fontSize: '14px' },
        text: `${t(source.short)} ↗`,
      }),
      el('div.small.faint', { style: { marginTop: '2px' }, text: t(source.note) }),
      el('div.small.muted', { style: { marginTop: '4px' }, text: t(source.says) }),
    ])),
    el('div.small.faint', { style: { marginTop: '16px' }, text: t('train.warmupEvidenceLimit') }),
  ]));
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
async function toggleDone(session, entry, set, weightInput, repsInput, hint, ex = null) {
  const turningOn = !set.done;
  let fill = null;

  if (turningOn) {
    const loadMode = bodyweightLoadMode(ex);
    const bodyweight = Number(store.state.settings.bodyweight);
    if (loadMode !== 'external' && (!bodyweight || bodyweight <= 0)) {
      toast(t('train.bodyweightMissing')); return;
    }
    // Empty fields fall back to the placeholder — repeating last week is the
    // common case and shouldn't need typing.
    const weight = loadMode === 'bodyweight' ? bodyweight
      : (set.weight === null || set.weight === undefined || weightInput.value === '')
        ? (hint ? hint.weight : null)
        : set.weight;
    const reps = (!set.reps || repsInput.value === '')
      ? (hint ? hint.reps : null)
      : set.reps;

    if (weight === null || weight === undefined) { toast(t('train.needWeight')); weightInput.focus(); return; }
    if (!reps) { toast(t('train.needReps')); repsInput.focus(); return; }
    fill = {
      weight, reps, loadMode,
      systemWeight: loadMode === 'added' ? bodyweight + Number(weight) : Number(weight),
      bodyweightUsed: loadMode === 'external' ? null : bodyweight,
    };
  }

  const saved = await store.updateSession(session.id, () => {
    if (fill) {
      set.weight = fill.weight; set.reps = fill.reps;
      set.loadMode = fill.loadMode; set.systemWeight = fill.systemWeight;
      set.bodyweightUsed = fill.bodyweightUsed;
    }
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
        cloud.publishSocialPr(ex.name, e1rm(effectiveSetWeight(set),set.reps), pr).then(() => {
          set.prSharedAt = Date.now();
          store.saveSessionQuiet(session);
        }).catch(() => {});
      }
    }
    if (set.type === 'working' && store.state.settings.autoStartRest) {
      rest.start(store.state.settings.restSeconds, {
        sound: store.state.settings.soundOnRestEnd !== false,
        // This call is inside the tap that ticked the set off, which is the
        // only place iOS lets playback begin. Starting the keeper anywhere
        // later would be refused.
        background: store.state.settings.restBackgroundAudio !== false,
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
      bestE1rm = Math.max(bestE1rm, e1rm(effectiveSetWeight(prev), prev.reps));
      bestWeight = Math.max(bestWeight, effectiveSetWeight(prev));
    }
  }
  if (!bestE1rm) return null;   // nothing to beat yet

  const w = effectiveSetWeight(set);
  if (w > bestWeight) return t('train.pr.weight', { weight: fmtWeight(w, units) });
  if (e1rm(w, set.reps) > bestE1rm) return t('train.pr.e1rm');
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
    el('button.btn.ghost.full', { onclick: async () => {
      const unilateral = entry.movementMode !== 'unilateral';
      await store.updateSession(session.id, () => {
        entry.movementMode = unilateral ? 'unilateral' : 'bilateral';
        for (const set of entry.sets) {
          if (unilateral) {
            set.leftWeight ??= set.weight; set.rightWeight ??= set.weight;
            set.leftReps ??= set.reps; set.rightReps ??= set.reps;
          } else if (set.leftReps !== null || set.rightReps !== null) {
            const weights = [set.leftWeight, set.rightWeight].map(Number).filter(Number.isFinite);
            const reps = [set.leftReps, set.rightReps].map(Number).filter(Number.isFinite);
            set.weight = weights.length ? Math.min(...weights) : set.weight;
            set.reps = reps.length ? Math.min(...reps) : set.reps;
            set.leftWeight = set.leftReps = set.rightWeight = set.rightReps = null;
          }
        }
      });
      closeSheet();
      toast(t(unilateral ? 'train.unilateralOn' : 'train.bilateralOn'));
    } }, [t(entry.movementMode === 'unilateral' ? 'train.useBilateral' : 'train.useUnilateral')]),
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
        const snapshot = JSON.parse(JSON.stringify(entry));
        await store.updateSession(session.id, (s) => { s.entries.splice(index, 1); });
        undoToast(t('train.exerciseRemoved', { name }), () => store.updateSession(session.id,
          (s) => s.entries.splice(index, 0, snapshot)));
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
  // The one number on this sheet, and the reason it is here: every weight
  // suggestion the app makes moves in increments, and it used to assume 2.5 kg
  // everywhere. A stack that goes up in fives cannot be asked for 102.5, so
  // half the suggestions were weights the machine does not have.
  const stepInput = normaliseOnBlur(numberInput({
    decimal: true,
    value: saved.step ?? '',
    placeholder: String(defaultStep(ex, store.units())),
    'aria-label': t('train.machine.step'),
  }));
  // The stack maximum belongs here too, not only behind an outlier warning:
  // somebody who knows their gym should be able to write it down before the app
  // has anything to complain about.
  const stackInput = normaliseOnBlur(numberInput({
    decimal: true, value: saved.stackMax ?? '', placeholder: t('home.rating.stackPlaceholder'),
    'aria-label': t('home.rating.stackMax', { units: store.units() }),
  }));

  openSheet(t('train.machine.title', { name: ex.name }), el('div', {}, [
    el('div.small.muted', { style: { marginBottom: '12px' }, text: t('train.machine.intro') }),
    el('label.field', {}, [el('span', { text: t('train.machine.seat') }), seat]),
    el('label.field', {}, [el('span', { text: t('train.machine.backrest') }), backrest]),
    el('label.field', {}, [el('span', { text: t('train.machine.pad') }), pad]),
    el('label.field', {}, [el('span', { text: t('train.machine.note') }), note]),
    el('label.field', {}, [el('span', { text: t('train.machine.stepLabel', { units: store.units() }) }), stepInput]),
    el('div.small.faint', { style: { marginTop: '-6px', marginBottom: '12px' }, text: t('train.machine.stepNote') }),
    isPlateLoaded(ex.name) ? null : el('label.field', {}, [
      el('span', { text: t('home.rating.stackMax', { units: store.units() }) }), stackInput,
      el('small', { text: t('home.rating.stackMaxNote') }),
    ]),
    el('button.btn.primary.full', { onclick: async () => {
      const setups = { ...(store.state.settings.machineSetups || {}) };
      const step = parseNumber(stepInput.value);
      // Spread what is already there. This sheet does not own the whole record:
      // the load correction on Home writes loadFactor and stackMax into the same
      // object, and rebuilding it from these four fields silently threw them
      // away the next time somebody adjusted their seat height.
      const stackMax = parseNumber(stackInput.value);
      const next = { ...saved,
        seat: seat.value.trim(), backrest: backrest.value.trim(), pad: pad.value.trim(), note: note.value.trim(),
        step: step > 0 ? step : null, stackMax: stackMax > 0 ? stackMax : null };
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
        // The one moment worth not waiting for the routine interval: the phone
        // is very often put away right here and not opened again for days.
        flushBackup();
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
  flushBackup();
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
