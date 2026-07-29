// Settings sheet — units, rest defaults, and backup/restore.

import { el, openSheet, closeSheet, confirmSheet, toast, fmtClock } from '../ui.js';
import * as store from '../store.js';
import * as db from '../db.js';
import { hasProfile } from '../standards.js';
import { evidenceList } from '../rating-ui.js';

/**
 * Profile — the inputs the strength standards actually need.
 * Height is captured for reference only; no published standard normalises by it,
 * so including it in the maths would be invented precision.
 */
export function profileForm(onSaved = null) {
  const s = store.state.settings;

  const sexSeg = el('div.seg', {}, [
    ['male', 'Male'], ['female', 'Female'],
  ].map(([value, label]) =>
    el('button', {
      'aria-pressed': String(s.sex === value),
      dataset: { sex: value },
      onclick: (e) => {
        [...e.target.parentElement.children].forEach((b) =>
          b.setAttribute('aria-pressed', String(b.dataset.sex === value)));
      },
    }, [label])
  ));

  const bodyweight = el('input', {
    type: 'number', inputmode: 'decimal', step: '0.1', min: '20',
    value: s.bodyweight ?? '', placeholder: `Weight in ${s.units}`,
  });
  const age = el('input', {
    type: 'number', inputmode: 'numeric', step: '1', min: '10', max: '100',
    value: s.age ?? '', placeholder: 'Years',
  });
  const height = el('input', {
    type: 'number', inputmode: 'numeric', step: '1', min: '100', max: '250',
    value: s.height ?? '', placeholder: 'cm',
  });

  async function save() {
    const sex = [...sexSeg.children].find((b) => b.getAttribute('aria-pressed') === 'true');
    if (!sex) { toast('Pick male or female'); return; }
    const bw = Number(bodyweight.value);
    if (!bw || bw <= 0) { toast('Enter your bodyweight'); bodyweight.focus(); return; }

    await store.setSetting('sex', sex.dataset.sex);
    await store.setSetting('bodyweight', bw);
    await store.setSetting('age', age.value ? Number(age.value) : null);
    await store.setSetting('height', height.value ? Number(height.value) : null);
    // Keep the bodyweight chart in step with the profile figure.
    await store.logBodyweight(bw);

    closeSheet();
    toast('Profile saved');
    if (onSaved) onSaved();
  }

  const body = el('div', {}, [
    el('div.small.muted', { style: { marginBottom: '14px' },
      text: 'Strength standards are relative to bodyweight, sex and age. Without them a rating is meaningless.' }),
    el('label.field', {}, [el('span', { text: 'Sex' }), sexSeg]),
    el('label.field', {}, [el('span', { text: `Bodyweight (${s.units})` }), bodyweight]),
    el('label.field', {}, [el('span', { text: 'Age' }), age]),
    el('label.field', {}, [
      el('span', { text: 'Height (cm) — optional' }), height,
      el('div.small.faint', { style: { marginTop: '6px' },
        text: 'Recorded for reference only. Height affects leverages but no strength standard uses it, so it does not change your rating.' }),
    ]),
    el('button.btn.primary.full', { onclick: save }, ['Save profile']),
  ]);

  openSheet('Your profile', body);
}

export function renderSettings() {
  const s = store.state.settings;

  const units = el('div.seg', {}, ['kg', 'lb'].map((u) =>
    el('button', {
      'aria-pressed': String(s.units === u),
      onclick: async (e) => {
        await store.setSetting('units', u);
        [...e.target.parentElement.children].forEach((b) =>
          b.setAttribute('aria-pressed', String(b.textContent === u)));
      },
    }, [u])
  ));

  const restValue = el('span.small.muted', { text: fmtClock(s.restSeconds) });
  const rest = el('input', {
    type: 'range', min: '30', max: '300', step: '15', value: String(s.restSeconds),
    style: { width: '100%', minHeight: 'auto', padding: '0', background: 'transparent', border: '0' },
  });
  rest.addEventListener('input', () => { restValue.textContent = fmtClock(Number(rest.value)); });
  rest.addEventListener('change', () => store.setSetting('restSeconds', Number(rest.value)));

  const autoRest = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
  autoRest.checked = !!s.autoStartRest;
  autoRest.addEventListener('change', () => store.setSetting('autoStartRest', autoRest.checked));

  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const counts = el('div.small.faint', {
    text: [
      plural(store.state.sessions.filter((x) => x.finishedAt).length, 'workout'),
      plural(store.state.exercises.length, 'exercise', 'exercises'),
      plural(store.state.routines.length, 'routine'),
    ].join(' · '),
  });

  const ratingToggle = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
  ratingToggle.checked = s.showRatings !== false;
  ratingToggle.addEventListener('change', () => store.setSetting('showRatings', ratingToggle.checked));

  const rirToggle = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
  rirToggle.checked = s.logRir !== false;
  rirToggle.addEventListener('change', () => store.setSetting('logRir', rirToggle.checked));

  const soundToggle = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
  soundToggle.checked = s.soundOnRestEnd !== false;
  soundToggle.addEventListener('change', () => store.setSetting('soundOnRestEnd', soundToggle.checked));

  const checkRow = (input, label, hint) => el('label.field', {}, [
    el('div.row', { style: { gap: '10px' } }, [
      input,
      el('span.grow', {
        text: label,
        style: { textTransform: 'none', letterSpacing: '0', fontSize: '15px', fontWeight: '500', color: 'var(--text)', marginBottom: '0' },
      }),
    ]),
    hint ? el('div.small.faint', { style: { marginTop: '4px' }, text: hint }) : null,
  ]);

  const profileSummary = hasProfile(s)
    ? `${s.sex === 'female' ? 'Female' : 'Male'} · ${s.bodyweight}${s.units}${s.age ? ` · ${s.age}y` : ''}${s.height ? ` · ${s.height}cm` : ''}`
    : 'Not set — ratings are disabled until you add it';

  const body = el('div', {}, [
    el('div.section-head', { style: { marginTop: '0' } }, [el('h2', { text: 'Profile' })]),
    el('button.list-item', {
      onclick: () => profileForm(),
      'aria-label': 'Edit profile',
    }, [
      el('div.grow', {}, [
        el('div.li-title', { text: 'Body data' }),
        el('div.li-sub', { text: profileSummary }),
      ]),
      el('span.chev', { text: '›', 'aria-hidden': 'true' }),
    ]),
    el('label.field', { style: { marginTop: '12px' } }, [
      el('div.row', { style: { gap: '10px' } }, [
        ratingToggle,
        el('span.grow', {
          text: 'Show strength ratings',
          style: { textTransform: 'none', letterSpacing: '0', fontSize: '15px', fontWeight: '500', color: 'var(--text)', marginBottom: '0' },
        }),
      ]),
    ]),

    el('div.section-head', {}, [el('h2', { text: 'Training' })]),
    el('label.field', {}, [el('span', { text: 'Units' }), units]),

    el('label.field', {}, [
      el('div.row.between', { style: { marginBottom: '6px' } }, [
        el('span', { text: 'Default rest', style: { marginBottom: '0' } }),
        restValue,
      ]),
      rest,
    ]),

    checkRow(autoRest, 'Start rest timer automatically'),
    checkRow(soundToggle, 'Chime when rest ends'),
    checkRow(rirToggle, 'Log reps in reserve',
      'Adds an RIR column to every set. Optional per set — how close to failure a set was drives growth more than which rep range it lands in, so it is worth recording, but a blank is treated as "unknown", never as "easy".'),

    el('div.section-head', {}, [el('h2', { text: 'Backup' })]),
    el('div.small.muted', { style: { marginBottom: '10px' },
      text: 'Your data lives only on this device. Export regularly — clearing Safari data or deleting the app will wipe it.' }),
    counts,
    el('div.stack', { style: { marginTop: '12px' } }, [
      el('button.btn.ghost.full', { onclick: doExport }, ['Export backup (.json)']),
      el('button.btn.ghost.full', { onclick: doImport }, ['Restore from backup']),
    ]),

    el('div.section-head', {}, [el('h2', { text: 'Danger zone' })]),
    el('button.btn.full.danger', {
      onclick: async () => {
        closeSheet();
        const ok = await confirmSheet('Erase everything?',
          'All workouts, routines, custom exercises and bodyweight entries will be permanently deleted. Export a backup first if you might want them back.',
          { confirmLabel: 'Erase all data' });
        if (!ok) return;
        await Promise.all(Object.values(db.STORES).map((st) => db.clear(st)));
        await store.load();
        toast('All data erased');
      },
    }, ['Erase all data']),

    el('div.section-head', {}, [el('h2', { text: 'How ratings work' })]),
    el('div.small.muted', { style: { marginBottom: '10px' },
      text: 'Plans and exercises are starred against the resistance-training literature, reviewed July 2026. Every star in the app opens a breakdown showing which paper each point came from.' }),
    evidenceList('Sources'),

    el('div.section-head', {}, [el('h2', { text: 'Credits' })]),
    el('div.small.faint', { style: { lineHeight: '1.65' } }, [
      'Exercise data from ',
      el('a', { href: 'https://github.com/yuhonas/free-exercise-db', target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)' } }, ['free-exercise-db']),
      ' (public domain). Exercise illustrations from ',
      el('a', { href: 'https://github.com/everkinetic/data', target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)' } }, ['everkinetic']),
      ', licensed ',
      el('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/', target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)' } }, ['CC BY-SA 4.0']),
      '. Muscle map artwork from ',
      el('a', { href: 'https://github.com/vulovix/body-muscles', target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)' } }, ['body-muscles']),
      ', licensed ',
      el('a', { href: 'https://www.apache.org/licenses/LICENSE-2.0', target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)' } }, ['Apache-2.0']),
      '. Both were modified; see NOTICE in the repository.',
    ]),

    el('div.small.faint', { style: { textAlign: 'center', marginTop: '22px' }, text: 'LiftLog · v2' }),
  ]);

  openSheet('Settings', body);
}

function doExport() {
  const data = store.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const a = el('a', { href: url, download: `liftlog-backup-${stamp}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup downloaded');
}

function doImport() {
  const input = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  document.body.append(input);

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      closeSheet();
      const ok = await confirmSheet(
        'Replace all data?',
        `Restoring "${file.name}" will replace everything currently on this device.`,
        { confirmLabel: 'Restore' });
      if (!ok) return;
      await store.importData(payload, { replace: true });
      toast('Backup restored');
    } catch (err) {
      console.error('[liftlog] import failed', err);
      toast(err.message || 'Could not read that file', 3200);
    }
  });

  input.click();
}
