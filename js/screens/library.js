// Library — searchable exercise catalogue with muscle-map illustration.

import {
  el, toast, confirmSheet, emptyState, debounce, listItem, starBadge,
} from '../ui.js';
import * as store from '../store.js';
import { MUSCLES } from '../models.js';
import { REGIONS } from '../standards.js';
import { exerciseArt, hasArt } from '../exercise-art.js';
import { newExerciseForm } from '../pickers.js';
import { rateExercise } from '../exercise-rating.js';
import { exerciseRatingCard, myRatingRow } from '../rating-ui.js';
import { navigate, render } from '../app.js';

// Rendering 700+ rows is slow and useless — cap it and let search narrow.
const PAGE = 60;

const SORTS = {
  muscle: 'By muscle',
  rating: 'Best rated first',
  mine: 'My rating first',
  name: 'A–Z',
};

let query = '';
let muscleFilter = 'All';
let equipFilter = 'All';
let sort = 'muscle';
let limit = PAGE;

/** Stars sit on the right of every row so the list is scannable at a glance. */
const starsFor = (ex) => starBadge(rateExercise(ex).stars);

export default function renderLibrary({ param, actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': 'Settings' }, ['⚙']));
  return param ? detailView(param) : listView();
}

function equipmentOptions() {
  const set = new Set(store.state.exercises.map((e) => e.equipment).filter(Boolean));
  return ['All', ...[...set].sort((a, b) => a.localeCompare(b))];
}

function listView() {
  const pane = el('div');
  const total = store.state.exercises.length;

  const search = el('input', {
    type: 'text', placeholder: `Search ${total} exercises…`, value: query,
    autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
  });

  const chips = el('div.row', {
    style: { gap: '6px', overflowX: 'auto', flexWrap: 'nowrap', paddingBottom: '8px' },
  });
  const equipSel = el('select', {}, equipmentOptions().map((eq) =>
    el('option', { value: eq, selected: eq === equipFilter }, [eq === 'All' ? 'Any equipment' : eq])));
  const sortSel = el('select', { 'aria-label': 'Sort exercises' }, Object.entries(SORTS).map(([k, label]) =>
    el('option', { value: k, selected: k === sort }, [label])));
  const list = el('div');
  const footer = el('div');

  function renderChips() {
    chips.replaceChildren(...['All', ...MUSCLES].map((m) =>
      el('button.btn.sm' + (m === muscleFilter ? '.primary' : '.ghost'), {
        style: { flex: '0 0 auto' },
        onclick: () => { muscleFilter = m; limit = PAGE; renderChips(); paint(); },
      }, [m])
    ));
  }

  function matches() {
    const q = query.trim().toLowerCase();
    return store.state.exercises.filter((ex) => {
      if (muscleFilter !== 'All' && ex.muscle !== muscleFilter) return false;
      if (equipFilter !== 'All' && ex.equipment !== equipFilter) return false;
      if (!q) return true;
      return ex.name.toLowerCase().includes(q)
        || ex.muscle.toLowerCase().includes(q)
        || (ex.equipment || '').toLowerCase().includes(q);
    });
  }

  function paint() {
    const found = matches();
    list.replaceChildren();
    footer.replaceChildren();

    if (!found.length) {
      list.append(emptyState('Nothing found', 'Try a different search or clear the filters.'));
      return;
    }

    // Favourites get their own block at the very top, ungrouped, so they're
    // reachable without scrolling past whichever muscle sorts first.
    const favs = found.filter((e) => e.favourite);
    const rest = found.filter((e) => !e.favourite);

    const row = (ex, sub) => listItem({
      title: (ex.favourite ? '★ ' : '') + ex.name,
      sub,
      right: starsFor(ex),
      ariaLabel: `Open ${ex.name} — ${rateExercise(ex).stars} of 5 stars`,
      onclick: () => navigate('library', ex.id),
    });

    if (favs.length && !query.trim()) {
      list.append(el('div.section-head', { style: { marginTop: '4px' } }, [el('h2', { text: '★ Favourites' })]));
      for (const ex of favs.sort((a, b) => a.name.localeCompare(b.name))) {
        list.append(row(ex, `${ex.muscle} · ${ex.equipment}`));
      }
    }

    const pool = (favs.length && !query.trim()) ? rest : found;
    const ordered = [...pool].sort(comparators[sort]);
    const shown = ordered.slice(0, limit);

    // Muscle headings only make sense while the list is grouped by muscle.
    let group = null;
    for (const ex of shown) {
      if (sort === 'muscle' && ex.muscle !== group) {
        group = ex.muscle;
        list.append(el('div.section-head', {}, [el('h2', { text: group })]));
      }
      const uses = store.exerciseUsageCount(ex.id);
      list.append(row(ex, [
        sort === 'muscle' ? ex.equipment : `${ex.muscle} · ${ex.equipment}`,
        ex.myRating ? `mine ${ex.myRating}/5` : null,
        uses ? `${uses} ${uses === 1 ? 'session' : 'sessions'}` : null,
        ex.isCustom ? 'custom' : null,
      ].filter(Boolean).join(' · ')));
    }

    if (found.length > shown.length) {
      footer.append(
        el('div.small.faint', {
          style: { textAlign: 'center', marginBottom: '10px' },
          text: `Showing ${shown.length} of ${found.length}`,
        }),
        el('button.btn.ghost.full', { onclick: () => { limit += PAGE; paint(); } }, ['Show more'])
      );
    } else if (found.length > PAGE) {
      footer.append(el('div.small.faint', { style: { textAlign: 'center' }, text: `${found.length} exercises` }));
    }
  }

  search.addEventListener('input', debounce(() => { query = search.value; limit = PAGE; paint(); }, 130));
  equipSel.addEventListener('change', () => { equipFilter = equipSel.value; limit = PAGE; paint(); });
  sortSel.addEventListener('change', () => { sort = sortSel.value; limit = PAGE; paint(); });

  renderChips();
  paint();

  pane.append(
    el('button.btn.primary.full', {
      style: { marginBottom: '14px' },
      onclick: () => newExerciseForm('', null),
    }, ['+ New exercise']),
    el('div', { style: { marginBottom: '8px' } }, [search]),
    chips,
    el('div.row', { style: { gap: '8px', marginBottom: '12px' } }, [equipSel, sortSel]),
    list,
    footer
  );
  return pane;
}

const comparators = {
  muscle: (a, b) => MUSCLES.indexOf(a.muscle) - MUSCLES.indexOf(b.muscle) || a.name.localeCompare(b.name),
  rating: (a, b) => rateExercise(b).stars - rateExercise(a).stars || a.name.localeCompare(b.name),
  // Unrated exercises sink rather than sorting as zero — "no opinion" is not
  // the same statement as "bad".
  mine: (a, b) => (b.myRating || 0) - (a.myRating || 0)
    || rateExercise(b).stars - rateExercise(a).stars
    || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name),
};

/* =========================== detail =========================== */

function detailView(id) {
  const ex = store.state.exerciseById.get(id);
  const root = el('div');

  root.append(
    el('button.btn.quiet.sm', {
      style: { marginBottom: '10px', paddingLeft: '0' },
      onclick: () => navigate('library'),
    }, ['‹ Library'])
  );

  if (!ex) {
    root.append(emptyState('Exercise not found', 'It may have been deleted.'));
    return root;
  }

  const uses = store.exerciseUsageCount(ex.id);
  const primary = ex.primary || [];
  const secondary = ex.secondary || [];

  const favBtn = el('button.icon-btn', {
    'aria-label': ex.favourite ? `Remove ${ex.name} from favourites` : `Add ${ex.name} to favourites`,
    'aria-pressed': String(!!ex.favourite),
    style: ex.favourite
      ? { color: 'var(--t4)', borderColor: 'color-mix(in srgb, var(--t4) 45%, transparent)' }
      : {},
    onclick: async () => {
      const now = await store.toggleFavourite(ex.id);
      toast(now ? 'Added to favourites' : 'Removed from favourites');
    },
  }, [ex.favourite ? '★' : '☆']);

  root.append(
    el('div.row.between', { style: { marginBottom: '14px', gap: '12px' } }, [
      el('div.grow', {}, [
        el('div', { style: { fontSize: '21px', fontWeight: '740', letterSpacing: '-0.025em' }, text: ex.name }),
        el('div.small.faint', {
          text: `${ex.muscle} · ${ex.equipment}${uses ? ` · ${uses} ${uses === 1 ? 'session' : 'sessions'} logged` : ''}`,
        }),
      ]),
      favBtn,
    ])
  );

  const ratingCard = exerciseRatingCard(ex);
  ratingCard.append(myRatingRow(ex, { onChange: () => render() }));
  root.append(ratingCard);

  // Illustrated where everkinetic has the movement, muscle map otherwise.
  const illustrated = hasArt(ex);
  if (illustrated || primary.length || secondary.length) {
    root.append(
      el('div.card', {}, [
        exerciseArt(ex, { eager: true }),
        illustrated
          ? null
          : el('div.legend', {}, [
              el('span', {}, [el('b', { style: { background: 'var(--t4)' } }), 'Primary']),
              el('span', {}, [el('b', { style: { background: 'var(--t1)' } }), 'Secondary']),
            ]),
        el('div.small.muted', {
          style: { marginTop: '8px' },
          text: [
            primary.map((r) => REGIONS[r] || r).join(', '),
            secondary.length ? `also ${secondary.map((r) => REGIONS[r] || r).join(', ')}` : null,
          ].filter(Boolean).join(' — '),
        }),
      ])
    );
  }

  if (ex.instructions && ex.instructions.length) {
    root.append(el('div.section-head', {}, [el('h2', { text: 'How to do it' })]));
    root.append(
      el('div.card', {}, [
        el('ol', {
          style: { margin: '0', paddingLeft: '20px', fontSize: '14px', lineHeight: '1.55' },
        }, ex.instructions.map((step) => el('li', { text: step, style: { marginBottom: '8px' } }))),
      ])
    );
  }

  root.append(
    el('div.stack', { style: { marginTop: '18px' } }, [
      uses ? el('button.btn.primary.full', { onclick: () => navigate('progress', ex.id) }, ['View progress']) : null,
      el('button.btn.ghost.full', { onclick: () => newExerciseForm('', null, ex) }, ['Edit']),
      el('button.btn.full.danger', {
        onclick: async () => {
          const inPlans = store.planUsageCount(ex.id);
          const planPart = inPlans
            ? ` It will also be removed from ${inPlans} plan ${inPlans === 1 ? 'day' : 'days'}.`
            : '';
          const warn = uses
            ? `${ex.name} appears in ${uses} logged ${uses === 1 ? 'session' : 'sessions'}. Those sessions keep their sets, but the exercise name will be lost from them.${planPart}`
            : `${ex.name} will be removed from your library.${planPart}`;
          const ok = await confirmSheet('Delete exercise?', warn);
          if (!ok) return;
          await store.deleteExercise(ex.id);
          toast('Exercise deleted');
          navigate('library');
        },
      }, ['Delete']),
    ])
  );

  return root;
}
