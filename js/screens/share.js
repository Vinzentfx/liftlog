// The receiving end of a shared plan link.
//
// Shows exactly what the link contains and what importing would change before
// anything is written — including how many exercises would be added to the
// library, because that is a side effect you should see coming rather than
// discover afterwards.

import { el, toast, emptyState } from '../ui.js';
import * as store from '../store.js';
import { decodeLink, resolveAgainstLibrary } from '../plan-share.js';
import { weekdayShort } from '../schedule.js';
import { navigate } from '../app.js';
import { t, tn, tMuscle, tEquipment } from '../i18n.js';

export default function renderShare({ param, actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': t('common.settings') }, ['⚙']));
  const root = el('div');

  if (!param) {
    root.append(emptyState(t('share.nothing'), t('share.nothingHint')));
    return root;
  }

  root.append(el('div.small.faint', { text: t('share.decoding') }));

  decodeLink(param).then((res) => {
    root.replaceChildren();
    if (!res.ok) {
      root.append(emptyState(t('share.unreadable'), res.detail,
        el('button.btn.ghost', { style: { marginTop: '14px' }, onclick: () => navigate('plans') }, [t('share.goToPlans')])));
      return;
    }
    root.append(...preview(res.plan));
  });

  return root;
}

function preview(shared) {
  const { matched, missing } = resolveAgainstLibrary(shared, store.state.exercises);
  const exerciseCount = shared.days.reduce((n, d) => n + d.items.length, 0);
  const setCount = shared.days.reduce(
    (n, d) => n + d.items.reduce((m, i) => m + i.sets, 0), 0) * (shared.perWeek || 1);

  const out = [];

  out.push(
    el('div.card.glow', {}, [
      el('div', { style: { fontSize: '20px', fontWeight: '740', letterSpacing: '-0.02em' }, text: shared.name }),
      el('div.small.faint', { style: { marginTop: '2px' },
        text: `${tn(shared.days.length, 'unit.day')} · ${tn(exerciseCount, 'unit.exercise')} · ${t('share.setsAWeek', { n: setCount })}`
          + (shared.perWeek > 1 ? ` · ${t('share.runsTimes', { n: shared.perWeek })}` : '') }),
      el('div.small.muted', { style: { marginTop: '10px' }, text: t('share.notSavedYet') }),
    ])
  );

  // What the import would do to the library, stated before it happens.
  out.push(el('div.section-head', {}, [el('h2', { text: t('share.whatChanges') })]));
  out.push(
    el('div.card', {}, [
      el('div.small', { style: { color: 'var(--good)' },
        text: `✓  ${t('share.alreadyHave', { have: matched.length, total: exerciseCount })}` }),
      missing.length
        ? el('div', {}, [
            el('div.small', { style: { marginTop: '8px', color: 'var(--warn)' },
              text: `+  ${t('share.wouldAdd', { exercises: tn(missing.length, 'unit.exercise') })}` }),
            el('div.small.faint', { style: { marginTop: '4px' },
              text: missing.map((m) => `${m.name} (${tMuscle(m.muscle)}, ${tEquipment(m.equipment)})`).join(' · ') }),
            el('div.small.faint', { style: { marginTop: '6px' }, text: t('share.coarseRegions') }),
          ])
        : el('div.small.faint', { style: { marginTop: '8px' }, text: t('share.nothingNew') }),
      el('div.small.faint', { style: { marginTop: '10px' }, text: t('share.untouched') }),
    ])
  );

  // The plan itself.
  for (const day of shared.days) {
    out.push(el('div.section-head', {}, [
      el('h2', { text: day.name + (Number.isInteger(day.weekday) ? ` · ${weekdayShort(day.weekday)}` : '') }),
    ]));
    const card = el('div.card', {});
    for (const item of day.items) {
      card.append(
        el('div.row.between', {
          style: { padding: '7px 0', borderBottom: '1px solid var(--line-soft)', gap: '10px' },
        }, [
          el('div.grow', {}, [
            el('div', { style: { fontWeight: '600', fontSize: '14.5px' }, text: item.name }),
            el('div.small.faint', { text: `${item.sets} × ${item.reps || t('common.empty')} · ${tMuscle(item.muscle)}` }),
          ]),
        ])
      );
    }
    out.push(card);
  }

  const importBtn = el('button.btn.primary.full', { style: { minHeight: '52px' } }, [t('share.import')]);
  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    const { plan, created } = await store.importSharedPlan(shared);
    toast(created.length
      ? t('share.importedWith', { exercises: tn(created.length, 'unit.exercise') })
      : t('share.imported'), 2600);
    navigate('plans', plan.id);
  });

  out.push(el('div.stack', { style: { marginTop: '20px' } }, [
    importBtn,
    el('button.btn.ghost.full', { onclick: () => navigate('plans') }, [t('share.noThanks')]),
  ]));

  return out;
}
