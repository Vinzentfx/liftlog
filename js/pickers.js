// Exercise picker — shared by the active workout and the routine editor.

import { el, openSheet, closeSheet, toast, listItem } from './ui.js';
import { MUSCLES } from './models.js';
import * as store from './store.js';

// Must cover every value the bundled catalogue uses. It didn't: opening Edit on
// a Kettlebell or Bands exercise fell through to the first option, so pressing
// Save silently retagged it as a barbell movement.
const EQUIPMENT = ['Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight', 'Kettlebell', 'Bands', 'Other'];

/**
 * @param {(exercise) => void} onPick
 * @param {string[]} exclude  exercise ids already in the list
 */
export function pickExercise(onPick, exclude = []) {
  const excluded = new Set(exclude);

  const results = el('div', { style: { minHeight: '160px' } });
  const search = el('input', {
    type: 'text', placeholder: 'Search exercises…',
    autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
  });

  let muscleFilter = 'All';

  const chips = el('div.row', {
    style: {
      gap: '6px', overflowX: 'auto', paddingBottom: '8px',
      marginBottom: '4px', flexWrap: 'nowrap',
    },
  });

  function renderChips() {
    chips.replaceChildren(...['All', ...MUSCLES].map((m) =>
      el('button.btn.sm' + (m === muscleFilter ? '.primary' : '.ghost'), {
        style: { flex: '0 0 auto' },
        onclick: () => { muscleFilter = m; renderChips(); renderResults(); },
      }, [m])
    ));
  }

  function renderResults() {
    const q = search.value.trim().toLowerCase();
    const matches = store.state.exercises.filter((ex) => {
      if (muscleFilter !== 'All' && ex.muscle !== muscleFilter) return false;
      if (!q) return true;
      return ex.name.toLowerCase().includes(q) || ex.equipment.toLowerCase().includes(q);
    });

    results.replaceChildren();

    if (!matches.length) {
      results.append(
        el('div.empty', {}, [
          el('strong', { text: 'No match' }),
          el('div', { text: q ? `Nothing called "${search.value.trim()}"` : 'No exercises in this group' }),
        ])
      );
    }

    // Favourites float to the top of whatever the filters left.
    for (const ex of store.favouriteFirst(matches)) {
      const already = excluded.has(ex.id);
      const row = listItem({
        title: (ex.favourite ? '★ ' : '') + ex.name,
        sub: `${ex.muscle} · ${ex.equipment}${already ? ' · already added' : ''}`,
        chev: '+',
        ariaLabel: `Add ${ex.name}`,
        style: already ? { opacity: '.5' } : {},
        onclick: () => { onPick(ex); closeSheet(); },
      });
      results.append(row);
    }
  }

  search.addEventListener('input', renderResults);

  const createBtn = el('button.btn.ghost.full.sm', {
    onclick: () => newExerciseForm(search.value.trim(), (ex) => { onPick(ex); closeSheet(); }),
  }, ['+ Create new exercise']);

  renderChips();
  renderResults();

  openSheet('Add Exercise', el('div', {}, [
    el('div', { style: { marginBottom: '10px' } }, [search]),
    chips,
    results,
    el('div', { style: { marginTop: '12px' } }, [createBtn]),
  ]));
}

/** Create-exercise form. Also used standalone from the Library screen. */
export function newExerciseForm(prefillName = '', onCreated = null, existing = null) {
  const name = el('input', { type: 'text', value: existing ? existing.name : prefillName, placeholder: 'e.g. Cable Pullover' });
  const muscle = el('select', {}, MUSCLES.map((m) =>
    el('option', { value: m, selected: existing ? existing.muscle === m : m === 'Chest' }, [m])));
  const equipment = el('select', {}, EQUIPMENT.map((eq) =>
    el('option', { value: eq, selected: existing ? existing.equipment === eq : eq === 'Barbell' }, [eq])));

  async function submit() {
    const value = name.value.trim();
    if (!value) { toast('Give it a name'); name.focus(); return; }
    const dupe = store.state.exercises.find(
      (e) => e.name.toLowerCase() === value.toLowerCase() && (!existing || e.id !== existing.id));
    if (dupe) { toast(`"${dupe.name}" already exists`); return; }

    const ex = existing
      ? await store.updateExercise(existing.id, { name: value, muscle: muscle.value, equipment: equipment.value })
      : await store.addExercise({ name: value, muscle: muscle.value, equipment: equipment.value });

    closeSheet();
    toast(existing ? 'Saved' : `Added ${ex.name}`);
    if (onCreated) onCreated(ex);
  }

  const body = el('div', {}, [
    el('label.field', {}, [el('span', { text: 'Name' }), name]),
    el('label.field', {}, [el('span', { text: 'Muscle group' }), muscle]),
    el('label.field', {}, [el('span', { text: 'Equipment' }), equipment]),
    existing && !existing.isCustom
      ? el('div.small.faint', { style: { marginBottom: '12px' },
          text: 'Changing the muscle group replaces this exercise’s body-map regions with the coarse ones for that group.' })
      : null,
    el('button.btn.primary.full', { onclick: submit }, [existing ? 'Save changes' : 'Create exercise']),
  ]);

  openSheet(existing ? 'Edit Exercise' : 'New Exercise', body);
}
