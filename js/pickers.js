// Exercise picker — shared by the active workout, the plan editor and the library.

import { el, openSheet, closeSheet, toast, listItem } from './ui.js';
import { t, tMuscle, tEquipment } from './i18n.js';
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
    type: 'text', placeholder: t('picker.search'),
    autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
  });

  // The filter holds the stored English value; only the chip is translated.
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
      }, [m === 'All' ? t('common.all') : tMuscle(m)])
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
          el('strong', { text: t('picker.noMatch') }),
          el('div', {
            text: q ? t('picker.nothingCalled', { query: search.value.trim() })
                    : t('picker.emptyGroup'),
          }),
        ])
      );
    }

    // Favourites float to the top of whatever the filters left.
    for (const ex of store.favouriteFirst(matches)) {
      const already = excluded.has(ex.id);
      const row = listItem({
        title: (ex.favourite ? '★ ' : '') + ex.name,
        sub: `${tMuscle(ex.muscle)} · ${tEquipment(ex.equipment)}`
          + (already ? ` · ${t('picker.alreadyAdded')}` : ''),
        chev: '+',
        ariaLabel: t('picker.addNamed', { name: ex.name }),
        style: already ? { opacity: '.5' } : {},
        onclick: () => { onPick(ex); closeSheet(); },
      });
      results.append(row);
    }
  }

  search.addEventListener('input', renderResults);

  const createBtn = el('button.btn.ghost.full.sm', {
    onclick: () => newExerciseForm(search.value.trim(), (ex) => { onPick(ex); closeSheet(); }),
  }, [t('picker.create')]);

  renderChips();
  renderResults();

  openSheet(t('picker.title'), el('div', {}, [
    el('div', { style: { marginBottom: '10px' } }, [search]),
    chips,
    results,
    el('div', { style: { marginTop: '12px' } }, [createBtn]),
  ]));
}

/** Create-exercise form. Also used standalone from the Library screen. */
export function newExerciseForm(prefillName = '', onCreated = null, existing = null) {
  const name = el('input', { type: 'text', value: existing ? existing.name : prefillName, placeholder: t('picker.namePlaceholder') });
  // `value` stays the English catalogue term; only the visible label is translated.
  const muscle = el('select', {}, MUSCLES.map((m) =>
    el('option', { value: m, selected: existing ? existing.muscle === m : m === 'Chest' }, [tMuscle(m)])));
  const equipment = el('select', {}, EQUIPMENT.map((eq) =>
    el('option', { value: eq, selected: existing ? existing.equipment === eq : eq === 'Barbell' }, [tEquipment(eq)])));
  const units = el('select', {}, [
    ['', t('picker.unitsDefault')], ['kg', 'kg'], ['lb', 'lb'],
  ].map(([value, label]) => el('option', { value, selected: (existing?.units || '') === value }, [label])));

  async function submit() {
    const value = name.value.trim();
    if (!value) { toast(t('picker.needName')); name.focus(); return; }
    const dupe = store.state.exercises.find(
      (e) => e.name.toLowerCase() === value.toLowerCase() && (!existing || e.id !== existing.id));
    if (dupe) { toast(t('picker.duplicate', { name: dupe.name })); return; }

    const ex = existing
      ? await store.updateExercise(existing.id, { name: value, muscle: muscle.value, equipment: equipment.value, units: units.value || null })
      : await store.addExercise({ name: value, muscle: muscle.value, equipment: equipment.value, units: units.value || null });

    closeSheet();
    toast(existing ? t('common.saved') : t('picker.added', { name: ex.name }));
    if (onCreated) onCreated(ex);
  }

  const body = el('div', {}, [
    el('label.field', {}, [el('span', { text: t('picker.field.name') }), name]),
    el('label.field', {}, [el('span', { text: t('picker.field.muscle') }), muscle]),
    el('label.field', {}, [el('span', { text: t('picker.field.equipment') }), equipment]),
    el('label.field', {}, [el('span', { text: t('picker.field.units') }), units]),
    existing && !existing.isCustom
      ? el('div.small.faint', { style: { marginBottom: '12px' }, text: t('picker.regionsWarning') })
      : null,
    el('button.btn.primary.full', { onclick: submit },
      [existing ? t('picker.saveChanges') : t('picker.createExercise')]),
  ]);

  openSheet(t(existing ? 'picker.edit.title' : 'picker.new.title'), body);
}
