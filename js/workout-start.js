import { el, openSheet, closeSheet, fmtDuration, setsSummary } from './ui.js';
import * as store from './store.js';
import { estimatePlanDuration, lastPerformance } from './models.js';
import { t, tn } from './i18n.js';
import { startWorkout } from './app.js';

/** Start immediately, or show the optional plan-day preview first. */
export async function requestWorkoutStart(options = {}) {
  const plan = options.planId && store.state.plans.find((row) => row.id === options.planId);
  const day = plan && plan.days.find((row) => row.id === options.dayId);
  if (store.state.settings.workoutPreview === false || !day) return startWorkout(options);

  return new Promise((resolve) => {
    let settled = false;
    const dismiss = () => {
      if (settled) return;
      settled = true;
      resolve(null);
    };
    const rows = day.items.map((item) => {
      const exercise = store.state.exerciseById.get(item.exerciseId);
      const last = lastPerformance(store.state.sessions, item.exerciseId);
      return el('div.list-item', {}, [
        el('div.grow', {}, [
          el('div.li-title', { text: exercise?.name || t('train.unknownExercise') }),
          el('div.li-sub', { text: `${item.targetSets || 3} × ${item.targetReps || plan.repTarget || store.defaultReps()}`
            + (last ? ` · ${t('train.previewLast', { sets: setsSummary(last.sets, store.units()) })}` : '') }),
        ]),
      ]);
    });
    const duration = estimatePlanDuration(day.items, store.state.settings.restSeconds);
    openSheet(t('train.previewTitle'), el('div', {}, [
      el('div.card.tight', {}, [
        el('strong', { text: day.name }),
        el('div.small.muted', { style: { marginTop: '4px' }, text: `${tn(day.items.length, 'unit.exercise')} · ${t('train.previewDuration', {
          duration: fmtDuration(duration),
        })}` }),
      ]),
      el('div', { style: { maxHeight: '48vh', overflowY: 'auto' } }, rows),
      el('button.btn.primary.full', { style: { marginTop: '12px' }, onclick: async () => {
        if (settled) return;
        settled = true;
        closeSheet();
        resolve(await startWorkout(options));
      } }, [t('train.previewStart')]),
      el('button.btn.ghost.full', { style: { marginTop: '8px' }, onclick: closeSheet }, [t('common.cancel')]),
    ]), { onClose: dismiss });
  });
}
