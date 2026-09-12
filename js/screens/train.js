// Trainieren: das laufende Training, oder der Startbildschirm, wenn keins läuft.

import {
  el, $, toast, haptic, fmtWeight, fmtDuration, fmtNum, fmtDecimal, fmtVolume, setsSummary,
  openSheet, closeSheet, confirmSheet, emptyState, debounce, listItem,
  numberInput, parseNumber, normaliseOnBlur, undoToast,
} from '../ui.js';
import * as store from '../store.js';
import * as rest from '../rest.js';
import * as cloud from '../cloud.js';
import {
  newSet, newEntry, entryStats, sessionStats, lastPerformance, e1rm, isCounted,
  bodyweightLoadMode, effectiveSetWeight, withinE1rmWindow,
} from '../models.js';
import { pickExercise } from '../pickers.js';
import { todaysDays, weekdayName, weekdayShort } from '../schedule.js';
import { exerciseArt } from '../exercise-art.js';
import { platePlan, describePlates, PLATES } from '../plates.js';
import { warmupSets } from '../warmup.js';
import {
  exerciseHistory, priorWork, openingSet, nextSet, pooledOrderCost, loadStep as defaultStep,
  capacityToday, predictReps, predictReserve,
} from '../progression.js';
import { alreadyWarm } from '../warmup.js';
import { isPlateLoaded } from '../standards.js';
import { navigate, render, flushBackup, startWorkout } from '../app.js';
import { requestWorkoutStart } from '../workout-start.js';
import { t, tn, tMuscle, tRegion, tEquipment, locale } from '../i18n.js';
import { SOURCES } from '../evidence.js';

const saveSoon = debounce((session) => store.saveSessionQuiet(session), 350);
const openHistories = new Set();
// Bei welchen Übungen gerade die Begründung zum Vorschlag aufgeklappt ist. Standardmäßig
// zu: im Studio ist die Zahl die Antwort, und die dreizeilige Erklärung, wie sie
// zustande kam, hat das erste Eingabefeld aus dem Bildschirm geschoben.
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

/* Startbildschirm */

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

    // Mit Wochentagen heißt "als Nächstes", was heute dran ist. Ohne bleibt es, was es
    // immer war: das, was am längsten nicht trainiert wurde.
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

/* laufendes Training */

function activeView(session) {
  const units = store.units();
  const root = el('div');
  const st = sessionStats(session);

  // Kopf mit Übersicht
  const elapsed = el('span.stat-val', { text: fmtDuration(st.durationMs) });
  const header = el('div.card', {}, [
    el('div.row.between', { style: { marginBottom: '12px' } }, [
      // Umbenannt wird über den Namen und nicht über einen zweiten Knopf daneben. Zwei
      // deutsche Wörter ("Pausieren", "Umbenennen") haben den Großteil einer 375-px-Zeile
      // belegt, der Titel brach auf zwei Zeilen um und die Startzeit auf zwei weitere.
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
    // Kompakt, weil das der eine Screen ist, auf dem es nicht um den Kopf geht. In voller
    // Größe haben diese drei Kacheln 190 px von einem 812-px-Handy genommen und das erste
    // Gewichtsfeld unter den Rand geschoben. Der Screen, den man zum Eintragen öffnet, zeigte
    // also zuerst eine Zusammenfassung des Satzes, den man noch nicht eingetragen hatte.
    // Dieselben Zahlen, halbe Höhe, und "Volumen kg" bricht nicht mehr um, während "Dauer"
    // und "Sätze" auf einer Zeile bleiben.
    el('div.stat-grid.compact', {}, [
      el('div.stat', {}, [elapsed, el('span.stat-key', { text: t('train.elapsed') })]),
      el('div.stat', {}, [el('span.stat-val', { text: String(st.sets) }), el('span.stat-key', { text: t('train.sets') })]),
      el('div.stat', {}, [el('span.stat-val', { text: fmtNum(st.volume) }), el('span.stat-key', { text: t('train.volume', { units }) })]),
    ]),
  ]);
  root.append(header);
  if (session.pausedAt) root.append(el('div.pause-banner', {}, [
    el('b', { text: t('train.paused') }), el('span', { text: t('train.pausedBody') }),
  ]));

  // Die Uhr weiterlaufen lassen, ohne den ganzen Screen neu zu zeichnen.
  const clockTimer = setInterval(() => {
    if (!document.body.contains(elapsed)) { clearInterval(clockTimer); return; }
    elapsed.textContent = fmtDuration(sessionStats(session).durationMs);
  }, 30000);

  // Übungen
  if (!session.entries.length) {
    root.append(emptyState(t('train.noExercises'), t('train.noExercisesHint')));
  }
  session.entries.forEach((entry, index) => {
    root.append(exerciseBlock(session, entry, index));
  });

  // Aktionen
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

  // Alles, woraus der Rat gebaut ist: das ganze Log zu dieser Übung, jede Einheit korrigiert
  // um die Stelle, an der es in der Einheit passiert ist, und dazu die Stelle in dieser
  // Einheit, an der wir gerade stehen.
  // Was ein leeres RIR wert ist. Null, während die Spalte an ist und der Nutzer sie nur
  // leer gelassen hat, wäre eine Vermutung über genau diesen Satz. Die Einstellung ist eine
  // feste Antwort, und nur dort darf die App eine einsetzen.
  const assumedRir = Number(store.state.settings.assumedRir) || 0;
  const rows = exerciseHistory(store.state.sessions, entry.exerciseId, store.state.exerciseById, {
    excludeSessionId: session.id,
    assumedRir,
    // Über das ganze Log gebündelt, damit auch eine Übung, die immer nur von einer Position
    // aus trainiert wurde, gemessene Kosten bekommt statt einer Annahme.
    fallbackCost: pooledOrderCost(store.state.sessions, store.state.exerciseById, { assumedRir }),
  });
  // `live`, weil diese Einheit ein Plan ist, der gerade umgesetzt wird, und keine
  // Aufzeichnung eines vergangenen: Arbeit über dieser Karte zählt, und Arbeit darunter, die
  // schon abgehakt ist, auch. Siehe `priorWork`.
  const prior = priorWork(session.entries, entryIndex, store.state.exerciseById, { live: true });
  const doneToday = entry.sets.filter(isCounted);
  const suggesting = store.state.settings.progressionSuggestions !== false;

  // Sobald heute ein Satz auf dem Brett steht, ist der Live-Rat die bessere Zahl und der
  // vom Anfang Geschichte. Zwei Vorschläge, die sich auf demselben Screen widersprechen,
  // sind schlimmer als einer, deshalb ist immer nur einer davon nicht null.
  const step = store.machineStep(ex);
  const keepInRange = store.state.settings.strictRepRange === true;
  const opening = suggesting && !doneToday.length
    ? openingSet(rows, {
        exercise: ex, targetReps: entry.targetReps, rule: entry.progressionRule,
        units, barWeight: store.barWeight(), prior, step, assumedRir, keepInRange,
      })
    : null;

  // Die Live-Zahl. Ein abgeschlossener Satz von heute wiegt mehr als vier Einheiten
  // Verlauf. Ab dem Moment, in dem Satz eins abgehakt ist, kommt der Rat also aus der
  // heutigen Anstrengung, dem eigenen Nachlassen von Satz zu Satz und dem Wiederholungsbereich.
  const live = suggesting && doneToday.length
    ? nextSet(doneToday, rows, {
        exercise: ex, targetReps: entry.targetReps, units, barWeight: store.barWeight(), step,
        assumedRir, keepInRange,
      })
    : null;

  // Die nützlichste Zeile auf dem Screen: was man letztes Mal gemacht hat.
  //
  // Sie ist auch der Weg zu den drei Einheiten davor. Früher war das eine flache Fläche mit
  // einem eigenen Knopf "die letzten 3 Trainings zeigen" darunter, noch ein Knopf über die
  // ganze Breite in einem Stapel von sieben zwischen dem Namen der Übung und ihrem ersten
  // Eingabefeld. Die Fläche ist das Naheliegende zum Antippen, wenn man mehr davon will,
  // also ist sie der Knopf.
  const last = lastPerformance(store.state.sessions, entry.exerciseId, session.id);
  const historyOn = store.state.settings.setHistory !== false;
  if (last) {
    const expanded = historyOn && openHistories.has(entry.exerciseId);
    const lastLine = el(historyOn ? 'button.last-time' : 'div.last-time', historyOn ? {
      'aria-expanded': String(expanded),
      'aria-label': t(expanded ? 'train.hideSetHistory' : 'train.showSetHistory'),
      onclick: () => {
        if (expanded) openHistories.delete(entry.exerciseId); else openHistories.add(entry.exerciseId);
        render();
      },
    } : {}, [
      el('span.last-time-main', {}, [
        el('span', { text: `${relLabel(last.session.startedAt)}: ` }),
        el('b', { text: setsSummary(last.sets, units) }),
        lastRirLabel(last.sets),
      ]),
      historyOn ? el('span.disclose-caret', { text: expanded ? '⌄' : '›', 'aria-hidden': 'true' }) : null,
      orderLabel(rows, prior, session, entryIndex),
    ]);
    block.append(lastLine);

    if (expanded) {
      const history = store.state.sessions.filter((row) => row.finishedAt && row.id !== session.id)
        .map((row) => ({ session: row, entry: row.entries.find((item) => item.exerciseId === entry.exerciseId) }))
        .filter((row) => row.entry?.sets.some(isCounted))
        .sort((a, b) => b.session.startedAt - a.session.startedAt).slice(0, 3);
      block.append(el('div.set-history', {}, history.map((row) => el('div.row.between.small', {}, [
        el('span.faint', { text: new Date(row.session.startedAt).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' }) }),
        el('b', { text: setsSummary(row.entry.sets.filter(isCounted), units) }),
      ]))));
    }

    const tip = opening;
    if (tip) {
      // Eine Körpergewichtsübung hat kein Gewicht, das man nennen könnte, dieselbe Antwort
      // der Berechnung wird also als Wiederholungsziel vorgelesen statt als Last.
      const headline = (bodyweightLoadMode(ex) === 'bodyweight'
        ? t('train.tip.bodyweight', { reps: tip.reps })
        : t(`train.tip.${tip.change}`, { weight: fmtWeight(tip.weight, units), reps: tip.reps }))
        + (entry.movementMode === 'unilateral' ? ` ${t('train.perSide')}` : '');
      block.append(reasonedSuggestion(entry.exerciseId, headline, describeReasons(tip.reasons, units)));
    }
  } else {
    // Kein Verlauf zum Vergleichen, aber die Arbeit vor dieser Übung ist trotzdem der
    // Grund, warum die Zahlen heute so aussehen.
    block.append(el('div.small.faint', { style: { marginBottom: '10px' } }, [
      el('span', { text: t('train.firstTime') }),
      orderLabel(rows, prior, session, entryIndex),
    ]));
  }

  if (store.state.settings.warmupSuggestions !== false) {
    block.append(warmupOffer(session, entry, ex, units, {
      targetReps: entry.targetReps, warmedRegions: prior.warmedRegions, step,
    }));
  }

  if (entry.note) {
    block.append(el('div.small.muted', { style: { marginBottom: '8px' }, text: entry.note }));
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

  // Welcher Rat gerade gilt, der wird zur Bedeutung des leeren Felds: die Zahl, die der
  // Screen gerade empfohlen hat, muss die Zahl sein, die eingetragen wird, wenn man ohne
  // Tippen abhakt, sonst ist der Vorschlag nur Deko.
  const pendingIndex = entry.sets.findIndex((s) => s.type === 'working' && !s.done);
  const usable = bodyweightLoadMode(ex) !== 'bodyweight' && (live || opening);
  // Was heute drin ist, für jede Last, die man eintippen will, nicht nur für die, die die
  // App gewählt hat. Nach Position des Satzes gelesen, weil die Leistung über eine Einheit
  // nachlässt und eine Vorhersage für Satz eins bei Satz vier eine Wiederholung daneben
  // liegt. null, wenn es keinen Verlauf gibt und noch nichts eingetragen ist, und das ist
  // die ehrliche Antwort beim allerersten Auftauchen einer Übung.
  const estimator = (workingIndex) => capacityToday(doneToday, rows,
    { prior, setIndex: workingIndex, assumedRir });
  // Seite für Seite eingetragen heißt, die Zahl auf dem Screen ist die Last einer Seite.
  // Zwei Wörter, und ohne sie liest sich der Vorschlag wie das doppelte Gewicht.
  const perSide = entry.movementMode === 'unilateral';

  entry.sets.forEach((set, i) => {
    const forThis = usable && i === pendingIndex ? usable : null;
    // Die Zeile gehört nur zum Live-Rat. Der Vorschlag vom Anfang hat oben im Block schon
    // alles gesagt.
    if (forThis && live) block.append(nextSetLine(live, units, perSide));
    block.append(setRow(session, entry, set, i, last, ex, forThis, estimator));
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

  // Unter den Sätzen, nicht darüber. Sitzhöhe und Schritt am Gewichtsblock notiert man
  // einmal und liest sie Monate später nach. Früher war das ein Knopf über die ganze Breite
  // in einem Stapel von sieben zwischen dem Namen der Übung und dem ersten Feld, in das man
  // tippen muss, also das falsche Ende der Karte für eine Einstellung, die sich etwa einmal
  // im Jahr ändert.
  //
  // Abgesichert, weil `append` die vom DOM ist und null als Wort druckt.
  const machineLine = machineSetupLine(ex, units);
  if (machineLine) block.append(machineLine);

  return block;
}

/** Gespeicherter Sitz, Lehne und Gewichtsschritt einer Maschine, oder das Angebot, sie zu speichern. */
function machineSetupLine(ex, units) {
  if (!ex || !['Machine', 'Cable'].includes(ex.equipment)) return null;
  const setup = store.state.settings.machineSetups?.[ex.id];
  const summary = setup && [
    setup.seat && `${t('train.machine.seat')}: ${setup.seat}`,
    setup.backrest && `${t('train.machine.backrest')}: ${setup.backrest}`,
    setup.pad && `${t('train.machine.pad')}: ${setup.pad}`,
    setup.step > 0 && t('train.machine.stepSummary', { step: fmtWeight(setup.step, units) }),
    setup.note,
  ].filter(Boolean).join(' · ');
  return el('button.machine-line', {
    'aria-label': t('train.machine.editSetup'),
    onclick: () => machineSetupSheet(ex),
  }, [
    el('span', { text: '⚙', 'aria-hidden': 'true' }),
    el('span.grow', { text: summary || t('train.machine.saveSetup') }),
  ]);
}

function setRow(session, entry, set, index, last, ex, advice = null, estimator = null) {
  if (entry.movementMode === 'unilateral') {
    return unilateralSetRow(session, entry, set, index, last, ex, advice, estimator);
  }
  const workingNo = entry.sets.slice(0, index + 1).filter((s) => s.type === 'working').length;
  const rirOn = store.state.settings.logRir !== false;
  const loadMode = bodyweightLoadMode(ex);
  // Die Zeile, die als Nächstes dran ist, bekommt eine eigene Markierung. Bei vier Sätzen
  // sind die Zeilen gleiche graue Kästen, und nach einem Pausentimer wurde "bei welchem bin
  // ich" durch Häkchenzählen beantwortet.
  const upNext = !set.done && set.type === 'working'
    && entry.sets.findIndex((row) => row.type === 'working' && !row.done) === index;
  const row = el('div.set-row'
    + (rirOn ? '.with-rir' : '')
    + (set.done ? '.done' : '')
    + (upNext ? '.up-next' : '')
    + (set.type === 'warmup' ? '.warmup' : ''));

  // Die Satznummer öffnet das Schnellmenü: verdoppeln, Aufwärmsatz und löschen, ohne im
  // Menü der Übung suchen zu müssen.
  row.append(
    el('button.set-no', {
      style: { background: 'none', border: 0 },
      title: t('train.setMenu'),
      onclick: () => setMenu(session, entry, set, index),
    }, [set.type === 'warmup' ? t('train.warmupLetter') : String(workingNo)])
  );

  // `last.sets` enthält nur die Arbeitssätze vom letzten Mal, der Index muss also die
  // Nummer des Arbeitssatzes sein, nicht die Zeile. Mit der Zeile als Index haben zwei
  // Aufwärmsätze jeden Platzhalter um zwei Sätze nach unten verschoben, Satz 1 schlug vor,
  // was man bei Satz 3 gemacht hatte.
  // Was ein leeres Feld beim Abhaken bedeutet. Der Live-Rat gewinnt, wo es einen gibt: nach
  // einem abgeschlossenen Satz ist er die bessere Antwort als letzte Woche, und er muss
  // dieselbe Zahl sein, die die Zeile darüber gerade gedruckt hat, sonst würde das Abhaken
  // still etwas anderes eintragen.
  const hint = set.type === 'warmup' || !last
    ? (advice ? { weight: advice.weight, reps: advice.reps } : null)
    : advice || last.sets[workingNo - 1] || last.sets[last.sets.length - 1];

  const weight = normaliseOnBlur(numberInput({
    decimal: true,
    value: set.weight ?? '',
    placeholder: hint ? String(hint.weight) : '',
    'aria-label': loadMode === 'added' ? t('train.addedWeight') : t('train.weight'),
  }));
  const reps = normaliseOnBlur(numberInput({
    value: set.reps ?? '',
    placeholder: hint ? String(hint.reps) : '',
    'aria-label': t('train.col.reps'),
  }), { integer: true });

  // Tastendrücke speichern still, ein Neuzeichnen würde hier den Cursor zerstören.
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

  // Wiederholungen in Reserve. Mit Absicht freiwillig, die Bewertung bestraft ein leeres
  // Feld nie, sie sagt nur, dass sie die Anstrengung nicht beurteilen kann. Ein Pflichtfeld
  // würde mit Rauschen gefüllt, und das ist schlimmer als nichts.
  const rir = normaliseOnBlur(numberInput({
    class: 'rir',
    value: set.rir ?? '',
    placeholder: '',
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

  // Was die eigene Zahl wert ist. Früher hat die App das für genau eine Last beantwortet,
  // die, die sie selbst gewählt hatte, und wurde still, sobald jemand sie überschrieben
  // hat. Also genau dann, wenn man etwas entscheidet und eine zweite Meinung gebrauchen könnte.
  const estimate = el('div.set-estimate', { 'aria-live': 'polite' });
  const paintEstimate = () => repaintEstimate(estimate, {
    estimator, workingNo, set, loadMode,
    weight: parseNumber(weight.value), reps: parseNumber(reps.value),
    perSide: entry.movementMode === 'unilateral',
  });
  weight.addEventListener('input', paintEstimate);
  reps.addEventListener('input', paintEstimate);
  rir.addEventListener('input', paintEstimate);
  paintEstimate();

  row.append(weightCell, reps, rirOn ? rir : null, doneBtn, estimate);
  return row;
}

/**
 * Die Schätzung unter einer Satzzeile, bei jedem Tastendruck neu gezeichnet.
 *
 * Zwei verschiedene Fragen, und welche gestellt wird, hängt davon ab, was schon in der
 * Zeile steht:
 *
 *  * Ein Gewicht und keine Wiederholungen. "Wie viele gehen damit." Das hat der Vorschlag
 *    schon immer für seine eigene Last beantwortet, jetzt geht es für jede.
 *  * Ein Gewicht und Wiederholungen. Die Frage nach den Wiederholungen hat man selbst
 *    beantwortet, sie noch einmal zu beantworten hieße, dass die App mit einer gerade
 *    getippten Zahl streitet. Offen ist, wie nah man damit an der Grenze ist, also geht
 *    es um die Reserve.
 *
 * Still bei einem abgehakten Satz (das ist eine Aufzeichnung, keine Entscheidung), bei
 * einem Aufwärmsatz (der soll ja nicht ans Maximum gehen) und immer dann, wenn es nichts
 * gibt, woraus man vorhersagen könnte. Still ist hier eine gültige Antwort: eine Schätzung
 * ohne Verlauf dahinter ist schlimmer als gar keine Zeile.
 */
function repaintEstimate(node, { estimator, workingNo, set, loadMode, weight, reps, perSide }) {
  node.textContent = '';
  node.hidden = true;
  if (!estimator || set.done || set.type === 'warmup') return;
  if (loadMode === 'bodyweight' || !weight || weight <= 0) return;

  const today = estimator(Math.max(0, workingNo - 1));
  if (!today?.capacity) return;

  // Seite für Seite eingetragen enthält die Zeile die Last einer Seite, die Standards und
  // der Verlauf beziehen sich aber auf die ganze Bewegung. Verdoppeln wäre an einer
  // Maschine schlimmer als falsch, eine einseitige Zeile sagt also einfach nichts.
  if (perSide) return;

  // Bei Klimmzügen oder Dips mit Zusatzgewicht ist die Last der Mensch plus Gürtel, und
  // daraus ist der Verlauf gebaut. Die Schätzung muss also dieselbe Frage stellen, die das
  // Log beantwortet.
  const load = loadMode === 'added'
    ? (Number(store.state.settings.bodyweight) || 0) + weight
    : weight;
  if (!load) return;

  if (reps > 0) {
    const left = predictReserve(today.capacity, load, reps);
    if (left === null || !Number.isFinite(left)) return;
    // Unter null heißt die ehrliche Lesart nicht "minus eine im Tank", sondern dass der Satz
    // über dem liegt, was heute gut aussieht.
    node.textContent = left < -0.5
      ? t('train.estimate.beyond')
      : t('train.estimate.reserve', { rir: fmtDecimal(Math.max(0, left)) });
  } else {
    const can = predictReps(today.capacity, load, today.reserve);
    if (!can) return;
    node.textContent = t('train.estimate.reps', { reps: can });
  }
  node.hidden = false;
}

function unilateralSetRow(session, entry, set, index, last, ex, advice = null) {
  // Hier absichtlich keine Schätzung, siehe repaintEstimate. Die Zeile hat die Last einer
  // Seite, und jede Zahl der Berechnung bezieht sich auf die ganze Bewegung.
  const workingNo = entry.sets.slice(0, index + 1).filter((row) => row.type === 'working').length;
  const row = el('div.unilateral-set' + (set.done ? '.done' : '')
    + (set.type === 'warmup' ? '.warmup' : ''));
  const hint = set.type === 'warmup' || !last
    ? (advice ? { weight: advice.weight, reps: advice.reps } : null)
    : advice || last.sets[workingNo - 1] || last.sets[last.sets.length - 1];
  const makeSide = (side, short) => {
    const weightKey = `${side}Weight`, repsKey = `${side}Reps`;
    const weight = normaliseOnBlur(numberInput({ decimal: true, value: set[weightKey] ?? '',
      placeholder: hint ? String(hint.weight) : '', 'aria-label': t('train.sideWeight', { side: short }) }));
    const reps = normaliseOnBlur(numberInput({ value: set[repsKey] ?? '',
      placeholder: hint ? String(hint.reps) : '', 'aria-label': t('train.sideReps', { side: short }) }), { integer: true });
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
        // Die vorsichtige Seite geht in Rekorde und Kraftstandards, das Volumen nimmt in
        // models.setVolume beide Seiten.
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
 * Einmal leise ein Aufwärmen anbieten.
 *
 * Nur, wenn es ein Arbeitsgewicht gibt, auf das man hinaufgehen kann, und noch kein
 * Aufwärmsatz eingetragen ist. Das Angebot verschwindet, sobald es angenommen oder
 * überflüssig wird, statt für den Rest der Einheit herumzustehen.
 *
 * Die Beschriftung sagt "Praxis im Studio", weil es genau das ist: keine Studie legt eine
 * beste Rampe fest, und diese App druckt keine Zahlen, deren Herkunft sie nicht nennen
 * kann. Zwei Sätze bei einer Langhantelübung, einer bei allem anderen.
 */
function warmupOffer(session, entry, ex, units, context = {}) {
  // Ein Raster mit zwei Spalten, siehe `.warmup-offer` und den Hinweis zur Einschränkung unten.
  const wrap = el('div.warmup-offer');
  if (ex?.equipment === 'Bodyweight') return wrap;
  if (entry.sets.some((s) => s.type === 'warmup')) return wrap;
  // Ein Aufwärmen, das einem angeboten wird, nachdem der erste Arbeitssatz schon
  // eingetragen ist, ist ein Aufwärmen für Arbeit, die schon erledigt ist. Das Angebot
  // gehört zum Moment vor der Übung und nirgendwo sonst hin.
  if (entry.sets.some(isCounted)) return wrap;

  // Worauf die Arbeitssätze zielen: was schon eingetippt ist, sonst das, woraus der
  // Vorschlag gebaut ist.
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
  // Nichts anzubieten ist jetzt eine echte Antwort und keine Lücke: ein Muskel, der in dieser
  // Einheit schon trainiert wurde, braucht keine zweite Einführung, und die Crossover-Studie
  // von 2025 fand keinen Nachteil, wenn man es weglässt. Das sagen, statt still zu werden.
  if (!sets.length) {
    return alreadyWarm(ex, context.warmedRegions)
      ? el('div.small.faint', { style: { marginBottom: '8px' }, text: t('train.warmupNotNeeded') })
      : wrap;
  }

  // Zwei Knöpfe in einer Zeile statt in zwei, und die Zeile ist ein Raster, damit sie sich
  // nicht überlappen können. Die Version davor hat sie gestapelt, weil beide
  // inline-flex-`.btn`s waren, die auf einem 375-px-Handy nebeneinander passten, und dann
  // hat ein negativer Rand die 44-px-Trefferfläche der Einschränkung seitlich über die des
  // Angebots gezogen und Tipps für "diese Sätze hinzufügen" abgefangen. Ein Raster mit
  // fester zweiter Spalte hat diese Freiheit nicht: jeder Knopf hat seinen eigenen Kasten,
  // und die Einschränkung behält ein volles Quadrat von 44 px zum Antippen.
  //
  // Die Einschränkung selbst ist ein ganzer Satz darüber, was die Studien gefunden haben,
  // und gehört deshalb weiter in das Sheet, das sie öffnet, und nicht über einen Arbeitssatz.
  wrap.append(
    el('button.warmup-add', {
      onclick: async () => {
        await store.updateSession(session.id, () => {
          // Vor die Arbeitssätze, da gehören sie hin, und dort erwartet sie auch die
          // Nummerierung der Sätze.
          entry.sets.unshift(...sets.map((s) => ({
            ...newSet(), weight: s.weight, reps: s.reps, type: 'warmup',
          })));
        });
        toast(t('train.warmupAdded', { sets: tn(sets.length, 'unit.warmupSet') }));
      },
    }, [t('train.warmupOffer', { sets: sets.map((w) => `${fmtWeight(w.weight, units)} × ${w.reps}`).join(', ') })]),
    el('button.warmup-why', {
      'aria-label': t('train.warmupWhy'), title: t('train.warmupWhy'),
      onclick: () => warmupEvidenceSheet(),
    }, ['ⓘ'])
  );
  return wrap;
}

/**
 * Der Vorschlag, mit der Begründung einen Tipp entfernt.
 *
 * Das Urteil sind drei Wörter und die Begründung drei Zeilen, und früher standen beide
 * zusammen über den Satzzeilen. Zugeklappt passt die ganze Übungskarte mit dem ersten
 * Gewichtsfeld auf einen Handybildschirm.
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

/* Anstrengung und Progression */

/** Das Anhängsel "· 1-2 RIR" an der Zeile vom letzten Mal, wenn es festgehalten wurde. */
function lastRirLabel(sets) {
  const vals = sets.map((s) => s.rir).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return el('span.small.faint', { text: `  ·  ${lo === hi ? lo : `${lo}-${hi}`} RIR` });
}

/** "Satz 2: 100 kg × ~7", der Live-Vorschlag, direkt an dem Satz, um den es geht. */
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
 * Die Gründe hinter einem Vorschlag, in der Reihenfolge, in der sie zählen.
 *
 * Höchstens drei, und nur, weil sie hinter einem Tipp liegen. Das Urteil sind drei Wörter
 * in der zugeklappten Zeile, das hier klappt darunter auf, wenn jemand das Warum wissen
 * will, und das ist eine andere Frage mit einem anderen Platzbudget. Zwei waren richtig,
 * solange das direkt über den Satzzeilen stand.
 *
 * Jede Last in den Parametern wird hier formatiert und nicht in der Berechnung, die
 * rechnet mit Zahlen und weiß nichts von der Einheit, die der Screen zeigt.
 */
const REASON_LOADS = ['weight', 'from', 'perWeek'];

function describeReasons(reasons, units) {
  return reasons.slice(0, 3).map((r) => {
    const params = { ...r.params };
    for (const field of REASON_LOADS) {
      if (params[field] !== undefined) params[field] = fmtWeight(round1(params[field]), units);
    }
    return t(`train.why.${r.key}`, params);
  }).join(' ');
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * "6 Sätze Brust vor dieser Übung" an der Zeile vom letzten Mal.
 *
 * Die Korrektur gibt es nur, weil man sie sonst nicht sieht: man sieht letzte Woche
 * 100 × 8 und heute 95 × 8 und liest einen Rückschritt, obwohl sich nur geändert hat,
 * dass die Bank besetzt war und der Butterfly zuerst kam. Es zu benennen ist die Hälfte
 * dessen, was das Messen wert ist.
 *
 * Es muss richtig benannt werden, und das war es lange nicht. Gedruckt wurde
 * `prior.same`, die gewichtete Überschneidung, auf eine ganze Zahl gerundet: drei Sätze
 * Bankdrücken vor Trizepsdrücken am Kabel ergaben 1,5, und der Screen sagte "2 Sätze für
 * diesen Muskel davor", obwohl nichts davor den Trizeps als Aufgabe trainiert hatte. Eine
 * Zahl, die man mit einem Blick auf den eigenen Screen widerlegen kann, zerstört die
 * Glaubwürdigkeit jeder anderen Zahl darauf.
 *
 * Gedruckt wird deshalb `prior.direct`: ganze Sätze aus Übungen, die denselben Muskel als
 * Hauptmuskel haben. Der gewichtete Wert rechnet weiter mit, dort gehören Brüche hin, aber
 * er landet nie auf der Seite. Und der Muskel wird genannt, damit man sich "diesen Muskel"
 * nicht erst zusammenreimen muss.
 *
 * Hat sich die direkte Zahl nicht geändert, die Übung aber deutlich ihren Platz, sagt die
 * Zeile das trotzdem, weil die allgemeine Ermüdung nach einer Stunde Training echt ist und
 * OTHER_REGION genau die berechnet. Sie tut nur nicht mehr so, als wäre die Arbeit für
 * diesen Muskel gewesen.
 */
function orderLabel(rows, prior, session, entryIndex) {
  const muscle = prior.regions.length ? tRegion(prior.regions[0]) : null;
  if (!muscle) return null;

  // Beim ersten Mal gibt es nichts zu vergleichen, aber "6 Sätze Brust kommen vorher" ist
  // für sich schon eine Aussage wert: das ist der Grund, warum der Vorschlag heute so ist,
  // wie er ist.
  if (!rows.length) {
    return prior.direct >= 2
      ? el('span.small', { style: { color: 'var(--text-dim)', display: 'block', marginTop: '2px' },
          text: t('train.order.firstTime', { now: prior.direct, muscle }) })
      : null;
  }

  const was = rows[rows.length - 1].prior;
  const movedDirect = Math.abs(prior.direct - (was.direct ?? 0)) >= 1;
  // Zwei Schritte "alles andere" vor einer Übung ohne Arbeit für denselben Muskel sind eine
  // Zeile wert. Ein Satz mehr oder weniger ist Rauschen.
  const movedOverall = Math.abs(prior.total - (was.total ?? 0)) >= 3;
  if (!movedDirect && !movedOverall) return null;

  // Bernstein für den Fall, der einen etwas kostet, und nichts Lauteres als der Rest der
  // Zeile für den Fall, der es zurückgibt. Früher waren beide in der Warnfarbe gemalt. Eine
  // Übung, die in der Einheit früher kam, also frischer als letzte Woche und damit eine gute
  // Nachricht, war auf dem Screen genauso eingefärbt wie ein Problem.
  const later = movedDirect
    ? prior.direct > (was.direct ?? 0)
    : prior.total > (was.total ?? 0);
  const key = movedDirect
    ? (later ? 'train.order.laterNow' : 'train.order.earlierNow')
    : (later ? 'train.order.laterOther' : 'train.order.earlierOther');

  return el('span.small', {
    style: { color: later ? 'var(--warn)' : 'var(--text-dim)', display: 'block', marginTop: '2px' },
    text: t(key, {
      muscle,
      now: movedDirect ? prior.direct : Math.round(prior.total),
      before: movedDirect ? (was.direct ?? 0) : Math.round(was.total ?? 0),
    }),
  });
}

/** Woher die Zahlen fürs Aufwärmen kommen und wo sie aufhören. */
function warmupEvidenceSheet() {
  const sources = [SOURCES.ribeiro2020, SOURCES.warmup2025];
  openSheet(t('train.warmupEvidenceTitle'), el('div', {}, [
    // Die Kurzfassung, die früher im Training über den Satzzeilen stand. Sie beantwortet die
    // Frage, mit der man dieses Sheet öffnet.
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
 * Einen Satz abhaken oder das Häkchen wegnehmen.
 *
 * Jede Änderung an der Einheit passiert im mutate-Callback, und nichts wird gefeiert,
 * bevor das Schreiben zurückkommt. `store.updateSession` macht seine Kopie zum
 * Rückgängigmachen in dem Moment, in dem es aufgerufen wird. Alles, was vorher geändert
 * wurde, kann es nicht zurückrollen. Früher wurde hier zuerst geändert und dann ein leerer
 * Callback übergeben, das Zurückrollen tat also still nichts, und das bei der wichtigsten
 * Aktion überhaupt. Den Rekord-Toast und den Pausentimer zuerst zu starten hatte dieselbe
 * Form: ein Rekord, gefeiert für einen Satz, der nie auf der Platte ankam.
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
    // Leere Felder fallen auf den Platzhalter zurück. Die letzte Woche zu wiederholen ist der
    // Normalfall und soll kein Tippen brauchen.
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
  if (!saved) return;   // zurückgerollt, und der Fehler ist schon gemeldet

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
        // Dieser Aufruf steckt in dem Tipp, der den Satz abgehakt hat, und nur dort lässt
        // iOS eine Wiedergabe beginnen. Den Wachhalter später zu starten würde abgelehnt.
        background: store.state.settings.restBackgroundAudio !== false,
      });
    }
  }
}

/** Gibt eine Meldung zurück, wenn dieser Satz gerade einen gespeicherten Bestwert geschlagen hat. */
/**
 * Hat dieser Satz gerade etwas geschlagen?
 *
 * Die Schätzung wird mit Gleichem verglichen. Epley steigt mit den Wiederholungen ohne
 * Grenze, ein Satz mit fünfundzwanzig ergibt also eine größere Zahl als ein schweres
 * Triple, egal was man wirklich kann: 90 kg x 25 ergibt 165 und "schlägt" echte
 * 100 kg x 12, und die App hat für einen Back-off-Satz einen Rekord gefeiert. Der Rang
 * lässt sich außerhalb von THRESHOLDS.e1rmWindow nicht mehr bauen, seit es das Fenster
 * gibt. Das hier ist dieselbe Regel, sie war nur nie beim Toast angekommen.
 *
 * Zwei Töpfe statt eines Filters, damit jemand, der immer mit fünfzehn Wiederholungen
 * trainiert, trotzdem Rekorde hat. Die gelten dann gegen die eigenen Sätze mit vielen
 * Wiederholungen und nicht gegen eine Formel, die an einer Stelle läuft, für die sie nie
 * gedacht war.
 */
function checkPR(session, entry, set) {
  const units = store.units();
  const best = { in: 0, out: 0 };
  let bestWeight = 0;
  for (const s of store.state.sessions) {
    if (!s.finishedAt || s.id === session.id) continue;
    const e = s.entries.find((x) => x.exerciseId === entry.exerciseId);
    if (!e) continue;
    for (const prev of e.sets.filter(isCounted)) {
      const pool = withinE1rmWindow(prev) ? 'in' : 'out';
      best[pool] = Math.max(best[pool], e1rm(effectiveSetWeight(prev), prev.reps));
      bestWeight = Math.max(bestWeight, effectiveSetWeight(prev));
    }
  }
  if (!best.in && !best.out) return null;   // noch nichts zu schlagen

  const w = effectiveSetWeight(set);
  // Ein schwereres Gewicht ist ein schwereres Gewicht, egal bei wie vielen Wiederholungen,
  // diese Seite braucht also kein Fenster.
  if (w > bestWeight) return t('train.pr.weight', { weight: fmtWeight(w, units) });
  const pool = withinE1rmWindow(set) ? 'in' : 'out';
  if (best[pool] && e1rm(w, set.reps) > best[pool]) return t('train.pr.e1rm');
  return null;
}

/**
 * Was für ein Gesamtgewicht auf die Stange muss.
 *
 * Öffnet mit dem schwersten Gewicht, das bei dieser Übung schon eingetragen ist, weil das
 * fast immer die Zahl ist, nach der man fragt. Es sagt, welche Last es wirklich erreicht:
 * das Studio hat keine 0,5-kg-Scheiben, ein Ziel, das nicht geht, sagt das also, statt
 * eine Scheibenliste zu drucken, die etwas anderes ergibt.
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

/* Menüs */

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
    // Nur bei einer beladenen Stange. An einer Maschine heißt "pro Seite" nichts, und bei
    // einer Kurzhantel gibt es nichts auszurechnen.
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
  // Die eine Zahl auf diesem Sheet und der Grund, warum es sie gibt: jeder Gewichtsvorschlag
  // der App bewegt sich in Schritten, und früher wurden überall 2,5 kg angenommen. Ein
  // Block in Fünferschritten kann keine 102,5 liefern, die Hälfte der Vorschläge waren also
  // Gewichte, die die Maschine nicht hat.
  const stepInput = normaliseOnBlur(numberInput({
    decimal: true,
    value: saved.step ?? '',
    placeholder: String(defaultStep(ex, store.units())),
    'aria-label': t('train.machine.step'),
  }));
  // Das Maximum des Gewichtsblocks gehört auch hierher und nicht nur hinter eine Warnung zu
  // Ausreißern: wer sein Studio kennt, soll es aufschreiben können, bevor die App etwas zu
  // beanstanden hat.
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
      // Das Vorhandene übernehmen. Dieses Sheet besitzt nicht den ganzen Eintrag: die
      // Lastkorrektur auf Home schreibt loadFactor und stackMax in dasselbe Objekt, und es aus
      // diesen vier Feldern neu zu bauen hat beides still weggeworfen, sobald jemand das
      // nächste Mal seine Sitzhöhe verstellt hat.
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

/** Bilder und Anleitung, einen Tipp vom Training entfernt, statt es vollzustellen. */
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

/* Abschluss */

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
    el('div.stat-grid.compact', { style: { marginBottom: '14px' } }, [
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
        // Der eine Moment, in dem sich Warten auf den normalen Takt nicht lohnt: genau hier wird
        // das Handy sehr oft weggelegt und tagelang nicht mehr geöffnet.
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
