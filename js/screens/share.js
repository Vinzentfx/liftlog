// The receiving end of a shared plan link.
//
// Shows exactly what the link contains and what importing would change before
// anything is written — including how many exercises would be added to the
// library, because that is a side effect you should see coming rather than
// discover afterwards.

import { el, toast, emptyState, listItem } from '../ui.js';
import * as store from '../store.js';
import { decodeLink, resolveAgainstLibrary } from '../plan-share.js';
import { weekdayShort } from '../schedule.js';
import { navigate } from '../app.js';

export default function renderShare({ param, actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': 'Settings' }, ['⚙']));
  const root = el('div');

  if (!param) {
    root.append(emptyState('Nothing to import', 'Open a plan link someone sent you and it lands here.'));
    return root;
  }

  root.append(el('div.small.faint', { text: 'Decoding…' }));

  decodeLink(param).then((res) => {
    root.replaceChildren();
    if (!res.ok) {
      root.append(emptyState('Could not read this link', res.detail,
        el('button.btn.ghost', { style: { marginTop: '14px' }, onclick: () => navigate('plans') }, ['Go to Plans'])));
      return;
    }
    root.append(...preview(res.plan));
  });

  return root;
}

function preview(shared) {
  const { matched, missing } = resolveAgainstLibrary(shared, store.state.exercises);
  const total = matched.length + shared.days.reduce((n, d) => n + d.items.length, 0) - matched.length;
  const exerciseCount = shared.days.reduce((n, d) => n + d.items.length, 0);
  const setCount = shared.days.reduce(
    (n, d) => n + d.items.reduce((m, i) => m + i.sets, 0), 0) * (shared.perWeek || 1);

  const out = [];

  out.push(
    el('div.card.glow', {}, [
      el('div', { style: { fontSize: '20px', fontWeight: '740', letterSpacing: '-0.02em' }, text: shared.name }),
      el('div.small.faint', { style: { marginTop: '2px' },
        text: `${shared.days.length} ${shared.days.length === 1 ? 'day' : 'days'} · ${exerciseCount} exercises · ${setCount} sets a week${shared.perWeek > 1 ? ` · runs ${shared.perWeek}× a week` : ''}` }),
      el('div.small.muted', { style: { marginTop: '10px' },
        text: 'Someone shared this with you. Nothing has been saved yet.' }),
    ])
  );

  // What the import would do to the library, stated before it happens.
  out.push(el('div.section-head', {}, [el('h2', { text: 'What this changes' })]));
  out.push(
    el('div.card', {}, [
      el('div.small', { style: { color: 'var(--good)' },
        text: `✓  ${matched.length} of ${exerciseCount} exercises already exist in your library` }),
      missing.length
        ? el('div', {}, [
            el('div.small', { style: { marginTop: '8px', color: 'var(--warn)' },
              text: missing.length === 1
                ? '+  1 would be added as a custom exercise'
                : `+  ${missing.length} would be added as custom exercises` }),
            el('div.small.faint', { style: { marginTop: '4px' },
              text: missing.map((m) => `${m.name} (${m.muscle}, ${m.equipment})` ).join(' · ') }),
            el('div.small.faint', { style: { marginTop: '6px' },
              text: 'They get the coarse muscle regions for their group, so they count toward volume and the muscle map straight away. You can refine them in the Library.' }),
          ])
        : el('div.small.faint', { style: { marginTop: '8px' }, text: 'Nothing new to add.' }),
      el('div.small.faint', { style: { marginTop: '10px' },
        text: 'Your own plans, workouts and settings are untouched. The imported plan does not become active — you choose that afterwards.' }),
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
            el('div.small.faint', { text: `${item.sets} × ${item.reps || '—'} · ${item.muscle}` }),
          ]),
        ])
      );
    }
    out.push(card);
  }

  const importBtn = el('button.btn.primary.full', { style: { minHeight: '52px' } }, ['Import this plan']);
  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    const { plan, created } = await store.importSharedPlan(shared);
    toast(created.length ? `Imported · ${created.length} exercises added` : 'Imported', 2600);
    navigate('plans', plan.id);
  });

  out.push(el('div.stack', { style: { marginTop: '20px' } }, [
    importBtn,
    el('button.btn.ghost.full', { onclick: () => navigate('plans') }, ['No thanks']),
  ]));

  void total;
  return out;
}
