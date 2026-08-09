// Library — searchable exercise catalogue with muscle-map illustration.

import {
  el, toast, confirmSheet, emptyState, debounce, listItem, starBadge,
} from '../ui.js';
import * as store from '../store.js';
import { MUSCLES } from '../models.js';
import { t, tn, tMuscle, tEquipment, tRegion } from '../i18n.js';
import { exerciseArt, hasArt } from '../exercise-art.js';
import { newExerciseForm } from '../pickers.js';
import { rateExercise } from '../exercise-rating.js';
import { exerciseSearchScore } from '../exercise-search.js';
import { exerciseRatingCard, myRatingRow } from '../rating-ui.js';
import { navigate, render } from '../app.js';

// Rendering 700+ rows is slow and useless — cap it and let search narrow.
const PAGE = 60;

// Keys, not labels: the visible text is looked up at render time so the
// dropdown follows a language switch without the module being reloaded.
const SORTS = {
  muscle: 'library.sort.muscle',
  rating: 'library.sort.rating',
  mine: 'library.sort.mine',
  name: 'library.sort.name',
};

let query = '';
let muscleFilter = 'All';
let equipFilter = 'All';
let sort = 'muscle';
let limit = PAGE;

/** Stars sit on the right of every row so the list is scannable at a glance. */
const starsFor = (ex) => (store.starsShown() ? starBadge(rateExercise(ex).stars) : null);

export default function renderLibrary({ param, actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': t('common.settings') }, ['⚙']));
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
    type: 'text', placeholder: t('library.search', { n: total }), value: query,
    autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
  });

  const chips = el('div.row', {
    style: { gap: '6px', overflowX: 'auto', flexWrap: 'nowrap', paddingBottom: '8px' },
  });
  const equipSel = el('select.filter-select', { 'aria-label': t('library.anyEquipment') }, equipmentOptions().map((eq) =>
    el('option', { value: eq, selected: eq === equipFilter },
      [eq === 'All' ? t('library.anyEquipment') : tEquipment(eq)])));
  const sortable = Object.entries(SORTS).filter(([k]) => k !== 'rating' || store.starsShown());
  if (!store.starsShown() && sort === 'rating') sort = 'muscle';
  const sortSel = el('select.filter-select', { 'aria-label': t('library.sortAria') }, sortable.map(([k, key]) =>
    el('option', { value: k, selected: k === sort }, [t(key)])));
  const list = el('div');
  const footer = el('div');

  function renderChips() {
    chips.replaceChildren(...['All', ...MUSCLES].map((m) =>
      el('button.btn.sm' + (m === muscleFilter ? '.primary' : '.ghost'), {
        style: { flex: '0 0 auto' },
        onclick: () => { muscleFilter = m; limit = PAGE; renderChips(); paint(); },
      }, [m === 'All' ? t('common.all') : tMuscle(m)])
    ));
  }

  function matches() {
    const q = query.trim();
    return store.state.exercises.map((ex) => ({ ex, score: exerciseSearchScore(ex, q) })).filter(({ ex, score }) => {
      if (muscleFilter !== 'All' && ex.muscle !== muscleFilter) return false;
      if (equipFilter !== 'All' && ex.equipment !== equipFilter) return false;
      return score > 0;
    }).sort((a, b) => q ? b.score - a.score : 0).map(({ ex }) => ex);
  }

  function paint() {
    const found = matches();
    list.replaceChildren();
    footer.replaceChildren();

    if (!found.length) {
      list.append(emptyState(t('library.nothingFound'), t('library.nothingFoundHint')));
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
      ariaLabel: store.starsShown()
        ? t('library.openRated', { name: ex.name, stars: rateExercise(ex).stars })
        : t('library.open', { name: ex.name }),
      onclick: () => navigate('library', ex.id),
    });

    if (favs.length && !query.trim()) {
      list.append(el('div.section-head', { style: { marginTop: '4px' } }, [el('h2', { text: `★ ${t('library.favourites')}` })]));
      for (const ex of favs.sort((a, b) => a.name.localeCompare(b.name))) {
        list.append(row(ex, `${tMuscle(ex.muscle)} · ${tEquipment(ex.equipment)}`));
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
        list.append(el('div.section-head', {}, [el('h2', { text: tMuscle(group) })]));
      }
      const uses = store.exerciseUsageCount(ex.id);
      list.append(row(ex, [
        sort === 'muscle' ? tEquipment(ex.equipment) : `${tMuscle(ex.muscle)} · ${tEquipment(ex.equipment)}`,
        ex.myRating ? t('library.myRating', { n: ex.myRating }) : null,
        uses ? tn(uses, 'unit.session') : null,
        ex.isCustom ? t('library.custom') : null,
      ].filter(Boolean).join(' · ')));
    }

    if (found.length > shown.length) {
      footer.append(
        el('div.small.faint', {
          style: { textAlign: 'center', marginBottom: '10px' },
          text: t('common.of', { a: shown.length, b: found.length }),
        }),
        el('button.btn.ghost.full', { onclick: () => { limit += PAGE; paint(); } }, [t('library.showMore')])
      );
    } else if (found.length > PAGE) {
      footer.append(el('div.small.faint', { style: { textAlign: 'center' }, text: tn(found.length, 'unit.exercise') }));
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
    }, [t('library.newExercise')]),
    el('div', { style: { marginBottom: '8px' } }, [search]),
    chips,
    el('div.filter-row', {}, [equipSel, sortSel]),
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
    }, [`‹ ${t('route.library')}`])
  );

  if (!ex) {
    root.append(emptyState(t('library.notFound'), t('library.notFoundHint')));
    return root;
  }

  const uses = store.exerciseUsageCount(ex.id);
  const primary = ex.primary || [];
  const secondary = ex.secondary || [];

  const favBtn = el('button.icon-btn', {
    'aria-label': t(ex.favourite ? 'library.unfavourite' : 'library.favourite', { name: ex.name }),
    'aria-pressed': String(!!ex.favourite),
    style: ex.favourite
      ? { color: 'var(--t4)', borderColor: 'color-mix(in srgb, var(--t4) 45%, transparent)' }
      : {},
    onclick: async () => {
      const now = await store.toggleFavourite(ex.id);
      toast(t(now ? 'library.favourited' : 'library.unfavourited'));
    },
  }, [ex.favourite ? '★' : '☆']);

  root.append(
    el('div.row.between', { style: { marginBottom: '14px', gap: '12px' } }, [
      el('div.grow', {}, [
        el('div', { style: { fontSize: '21px', fontWeight: '740', letterSpacing: '-0.025em' }, text: ex.name }),
        el('div.small.faint', {
          text: `${tMuscle(ex.muscle)} · ${tEquipment(ex.equipment)}`
            + (uses ? ` · ${t('library.sessionsLogged', { sessions: tn(uses, 'unit.session') })}` : ''),
        }),
      ]),
      favBtn,
    ])
  );

  // With stars switched off the evidence card goes too — but your own rating
  // stays, because that is a note to yourself, not a score handed to you.
  if (store.starsShown()) {
    const ratingCard = exerciseRatingCard(ex);
    ratingCard.append(myRatingRow(ex, { onChange: () => render() }));
    root.append(ratingCard);
  } else {
    root.append(el('div.card', {}, [myRatingRow(ex, { onChange: () => render() })]));
  }

  // Illustrated where everkinetic has the movement, muscle map otherwise.
  const illustrated = hasArt(ex);
  if (illustrated || primary.length || secondary.length) {
    root.append(
      el('div.card', {}, [
        exerciseArt(ex, { eager: true }),
        illustrated
          ? null
          : el('div.legend', {}, [
              el('span', {}, [el('b', { style: { background: 'var(--t4)' } }), t('library.primary')]),
              el('span', {}, [el('b', { style: { background: 'var(--t1)' } }), t('library.secondary')]),
            ]),
        el('div.small.muted', {
          style: { marginTop: '8px' },
          text: [
            primary.map(tRegion).join(', '),
            secondary.length ? t('library.also', { muscles: secondary.map(tRegion).join(', ') }) : null,
          ].filter(Boolean).join(' · '),
        }),
      ])
    );
  }

  if (ex.instructions && ex.instructions.length) {
    root.append(el('div.section-head', {}, [el('h2', { text: t('train.menu.howTo') })]));
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
      uses ? el('button.btn.primary.full', { onclick: () => navigate('progress', ex.id) }, [t('library.viewProgress')]) : null,
      el('button.btn.ghost.full', { onclick: () => newExerciseForm('', null, ex) }, [t('common.edit')]),
      el('button.btn.full.danger', {
        onclick: async () => {
          const inPlans = store.planUsageCount(ex.id);
          const planPart = inPlans
            ? ' ' + t('library.deletePlans', { days: tn(inPlans, 'unit.day') })
            : '';
          // Say what actually happens. The sets survive as rows in the session,
          // but every analysis looks the exercise up by id and skips what it
          // cannot find — so the volume, the muscle map, the strength score and
          // the charts all quietly lose that work. "The name will be lost" was
          // true and misleading at the same time.
          const warn = uses
            ? t('library.deleteUsed', { name: ex.name, sessions: tn(uses, 'unit.session') }) + planPart
            : t('library.deleteUnused', { name: ex.name }) + planPart;
          const ok = await confirmSheet(t('library.deleteTitle'), warn);
          if (!ok) return;
          await store.deleteExercise(ex.id);
          toast(t('library.deleted'));
          navigate('library');
        },
      }, [t('common.delete')]),
    ])
  );

  return root;
}
