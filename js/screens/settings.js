// Settings sheet — units, rest defaults, and backup/restore.

import {
  el, openSheet, closeSheet, confirmSheet, toast, fmtClock, fmtDate,
  numberInput, parseNumber, normaliseOnBlur,
} from '../ui.js';
import * as store from '../store.js';
import * as db from '../db.js';
import { hasProfile } from '../standards.js';
import { DEFAULT_BAR } from '../plates.js';
import { evidenceList } from '../rating-ui.js';
import { t, tn, LANGUAGES, language } from '../i18n.js';

/**
 * Profile — the inputs the strength standards actually need.
 * Height is captured for reference only; no published standard normalises by it,
 * so including it in the maths would be invented precision.
 */
export function profileForm(onSaved = null) {
  const s = store.state.settings;

  const sexSeg = el('div.seg', {}, [
    ['male', t('settings.male')], ['female', t('settings.female')],
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

  const bodyweight = normaliseOnBlur(numberInput({
    decimal: true,
    value: s.bodyweight ?? '', placeholder: t('settings.weightIn', { units: s.units }),
  }));
  const age = el('input', {
    type: 'number', inputmode: 'numeric', step: '1', min: '10', max: '100',
    value: s.age ?? '', placeholder: t('settings.years'),
  });
  const height = el('input', {
    type: 'number', inputmode: 'numeric', step: '1', min: '100', max: '250',
    value: s.height ?? '', placeholder: 'cm',
  });

  async function save() {
    const sex = [...sexSeg.children].find((b) => b.getAttribute('aria-pressed') === 'true');
    if (!sex) { toast(t('settings.pickSex')); return; }
    const bw = parseNumber(bodyweight.value);
    if (bw === null || bw <= 0) { toast(t('settings.needBodyweight')); bodyweight.focus(); return; }

    await store.setSetting('sex', sex.dataset.sex);
    await store.setSetting('bodyweight', bw);
    await store.setSetting('age', age.value ? Number(age.value) : null);
    await store.setSetting('height', height.value ? Number(height.value) : null);
    // Keep the bodyweight chart in step with the profile figure.
    await store.logBodyweight(bw);

    closeSheet();
    toast(t('settings.profileSaved'));
    if (onSaved) onSaved();
  }

  const body = el('div', {}, [
    el('div.small.muted', { style: { marginBottom: '14px' }, text: t('settings.profileIntro') }),
    el('label.field', {}, [el('span', { text: t('settings.sex') }), sexSeg]),
    el('label.field', {}, [el('span', { text: t('settings.bodyweightField', { units: s.units }) }), bodyweight]),
    el('label.field', {}, [el('span', { text: t('settings.age') }), age]),
    el('label.field', {}, [
      el('span', { text: t('settings.heightField') }), height,
      el('div.small.faint', { style: { marginTop: '6px' }, text: t('settings.heightNote') }),
    ]),
    el('button.btn.primary.full', { onclick: save }, [t('settings.saveProfile')]),
  ]);

  openSheet(t('settings.profileTitle'), body);
}

export function renderSettings() {
  const s = store.state.settings;

  // Switching units relabels every stored number rather than converting it —
  // weights are kept as bare figures, so 100 kg becomes "100 lb". That is fine
  // when it is set once at the start and wrong the moment there is history, so
  // the switch says so instead of pretending to convert.
  const units = el('div.seg', {}, ['kg', 'lb'].map((u) =>
    el('button', {
      'aria-pressed': String(s.units === u),
      onclick: async (e) => {
        if (u !== s.units && store.state.sessions.some((x) => x.finishedAt)) {
          const ok = await confirmSheet(
            t('settings.unitSwitchTitle', { unit: u }),
            t('settings.unitSwitchBody', { from: s.units, to: u }),
            { danger: false, confirmLabel: t('settings.useUnit', { unit: u }) }
          );
          if (!ok) return;
        }
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

  const counts = el('div.small.faint', {
    text: [
      tn(store.state.sessions.filter((x) => x.finishedAt).length, 'unit.workout'),
      tn(store.state.exercises.length, 'unit.exercise'),
      tn(store.state.plans.length, 'unit.plan'),
    ].join(' · '),
  });

  // Language. Stored as null when it follows the device, which is what a fresh
  // install should do; picking one here pins it.
  const langSel = el('select', { 'aria-label': t('settings.language') }, [
    el('option', { value: '', selected: !s.language }, [t('settings.languageAuto')]),
    ...LANGUAGES.map((l) =>
      el('option', { value: l.key, selected: s.language === l.key }, [l.label])),
  ]);
  langSel.addEventListener('change', () => {
    store.setSetting('language', langSel.value || null);
    // The store's subscriber applies the language and re-renders the screen
    // behind the sheet; the sheet itself was built in the old one.
    closeSheet();
    renderSettings();
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

  const starToggle = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
  starToggle.checked = s.showStars !== false;
  starToggle.addEventListener('change', () => store.setSetting('showStars', starToggle.checked));

  const defSets = el('input', {
    type: 'number', inputmode: 'numeric', min: '1', max: '20', step: '1',
    value: String(store.defaultSets()),
  });
  defSets.addEventListener('change', () => {
    const n = Math.max(1, Math.min(20, Number(defSets.value) || 2));
    defSets.value = String(n);
    store.setSetting('defaultSets', n);
  });

  const barInput = normaliseOnBlur(numberInput({
    decimal: true,
    value: s.barWeight ?? '',
    placeholder: String(DEFAULT_BAR[s.units] ?? DEFAULT_BAR.kg),
  }));
  barInput.addEventListener('change', () => {
    const n = parseNumber(barInput.value);
    store.setSetting('barWeight', n !== null && n > 0 ? n : null);
  });

  const defReps = el('input', { type: 'text', value: store.defaultReps(), placeholder: t('settings.repsPlaceholder') });
  defReps.addEventListener('change', () => {
    const v = defReps.value.trim() || '6-10';
    defReps.value = v;
    store.setSetting('defaultReps', v);
  });

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
    ? [
        t(s.sex === 'female' ? 'settings.female' : 'settings.male'),
        `${s.bodyweight}${s.units}`,
        s.age ? t('settings.ageShort', { n: s.age }) : null,
        s.height ? `${s.height}cm` : null,
      ].filter(Boolean).join(' · ')
    : t('settings.profileMissing');

  const body = el('div', {}, [
    el('div.section-head', { style: { marginTop: '0' } }, [el('h2', { text: t('settings.profile') })]),
    el('button.list-item', {
      onclick: () => profileForm(),
      'aria-label': t('settings.editProfile'),
    }, [
      el('div.grow', {}, [
        el('div.li-title', { text: t('settings.bodyData') }),
        el('div.li-sub', { text: profileSummary }),
      ]),
      el('span.chev', { text: '›', 'aria-hidden': 'true' }),
    ]),
    el('label.field', { style: { marginTop: '12px' } }, [
      el('div.row', { style: { gap: '10px' } }, [
        ratingToggle,
        el('span.grow', {
          text: t('settings.showRatings'),
          style: { textTransform: 'none', letterSpacing: '0', fontSize: '15px', fontWeight: '500', color: 'var(--text)', marginBottom: '0' },
        }),
      ]),
    ]),

    el('div.section-head', {}, [el('h2', { text: t('settings.appearance') })]),
    el('label.field', {}, [el('span', { text: t('settings.language') }), langSel]),
    el('div.small.faint', { style: { marginTop: '-4px', marginBottom: '14px' }, text: t('settings.languageNote') }),

    el('div.section-head', {}, [el('h2', { text: t('route.train') })]),
    el('label.field', {}, [el('span', { text: t('settings.units') }), units]),

    el('label.field', {}, [
      el('div.row.between', { style: { marginBottom: '6px' } }, [
        el('span', { text: t('settings.defaultRest'), style: { marginBottom: '0' } }),
        restValue,
      ]),
      rest,
    ]),

    checkRow(autoRest, t('settings.autoRest')),
    checkRow(soundToggle, t('settings.chime')),
    checkRow(rirToggle, t('settings.logRir'), t('settings.logRirNote')),

    el('div.section-head', {}, [el('h2', { text: t('settings.newPlanExercises') })]),
    el('div.small.muted', { style: { marginBottom: '10px' }, text: t('settings.newPlanExercisesNote') }),
    el('div.row', { style: { gap: '10px' } }, [
      el('label.field.grow', {}, [el('span', { text: t('train.sets') }), defSets]),
      el('label.field.grow', {}, [el('span', { text: t('train.col.reps') }), defReps]),
    ]),
    el('div.small.faint', { style: { marginTop: '-4px' }, text: t('settings.defaultsNote') }),

    el('div.section-head', {}, [el('h2', { text: t('equipment.barbell') })]),
    el('label.field', {}, [el('span', { text: t('settings.barWeight', { units: s.units }) }), barInput]),
    el('div.small.faint', { style: { marginTop: '-4px' },
      text: t('settings.barWeightNote', { bar: `${DEFAULT_BAR[s.units] ?? DEFAULT_BAR.kg}${s.units}` }) }),

    el('div.section-head', {}, [el('h2', { text: t('settings.whatToShow') })]),
    checkRow(starToggle, t('settings.stars'), t('settings.starsNote')),

    el('div.section-head', {}, [el('h2', { text: t('settings.backup') })]),
    el('div.small.muted', { style: { marginBottom: '10px' }, text: t('settings.backupNote') }),
    storageLine(),
    counts,
    lastExportLine(),
    el('div.stack', { style: { marginTop: '12px' } }, [
      el('button.btn.ghost.full', { onclick: doExport }, [t('settings.exportBackup')]),
      el('button.btn.ghost.full', { onclick: doImport }, [t('settings.restoreBackup')]),
    ]),

    el('div.section-head', {}, [el('h2', { text: t('settings.dangerZone') })]),
    el('button.btn.full.danger', {
      onclick: async () => {
        closeSheet();
        const ok = await confirmSheet(t('settings.eraseTitle'), t('settings.eraseBody'),
          { confirmLabel: t('settings.erase') });
        if (!ok) return;
        await Promise.all(Object.values(db.STORES).map((st) => db.clear(st)));
        await store.load();
        toast(t('settings.erased'));
      },
    }, [t('settings.erase')]),

    el('div.section-head', {}, [el('h2', { text: t('settings.howRatingsWork') })]),
    el('div.small.muted', { style: { marginBottom: '10px' }, text: t('settings.howRatingsWorkNote') }),
    evidenceList(t('settings.sources')),

    el('div.section-head', {}, [el('h2', { text: t('settings.credits') })]),
    el('div.small.faint', { style: { lineHeight: '1.65' } }, [
      t('credits.exerciseData') + ' ',
      el('a', { href: 'https://github.com/yuhonas/free-exercise-db', target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)' } }, ['free-exercise-db']),
      ' ' + t('credits.publicDomainIllustrations') + ' ',
      el('a', { href: 'https://github.com/everkinetic/data', target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)' } }, ['everkinetic']),
      ', ' + t('credits.licensed') + ' ',
      el('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/', target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)' } }, ['CC BY-SA 4.0']),
      '. ' + t('credits.muscleMap') + ' ',
      el('a', { href: 'https://github.com/vulovix/body-muscles', target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)' } }, ['body-muscles']),
      ', ' + t('credits.licensed') + ' ',
      el('a', { href: 'https://www.apache.org/licenses/LICENSE-2.0', target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)' } }, ['Apache-2.0']),
      '. ' + t('credits.modified') + ' ' + t('credits.barcode') + ' ',
      el('a', { href: 'https://world.openfoodfacts.org', target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)' } }, ['Open Food Facts']),
      ', ' + t('credits.licensed') + ' ',
      el('a', { href: 'https://opendatacommons.org/licenses/odbl/1-0/', target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)' } }, ['ODbL']),
      '. ' + t('credits.liveOnly') + ' ' + t('credits.genericFoods') + ' ',
      el('a', { href: 'https://fdc.nal.usda.gov', target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)' } }, ['USDA FoodData Central']),
      '. ' + t('credits.bundledPublicDomain') + ' ' + t('credits.branded') + ' ',
      el('a', { href: 'https://world.openfoodfacts.org', target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)' } }, ['Open Food Facts']),
      ' ' + t('credits.under') + ' ',
      el('a', { href: 'https://opendatacommons.org/licenses/odbl/1-0/', target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)' } }, ['ODbL v1.0']),
      '. ' + t('credits.shareAlike'),
    ]),

    el('div.small.faint', { style: { textAlign: 'center', marginTop: '22px' }, text: 'LiftLog · v2' }),
  ]);

  openSheet(t('common.settings'), body);
}

/**
 * The real storage state, filled in asynchronously.
 *
 * This replaces a blanket warning that was wrong for the way this app is
 * actually used: an installed home-screen web app is exempt from Safari's
 * seven-day eviction and gets a browser-sized quota. Saying "Safari will wipe
 * this" when it will not just teaches you to ignore the warnings that matter.
 */
function storageLine() {
  const node = el('div.small.faint', { style: { marginBottom: '8px' }, text: t('settings.checkingStorage') });
  db.storageStatus().then(({ persisted, usage }) => {
    const size = usage ? t('settings.mbUsed', { mb: (usage / 1048576).toFixed(1) }) : null;
    node.textContent = [
      t(persisted === true ? 'settings.storagePersistent'
        : persisted === false ? 'settings.storageBestEffort'
        : 'settings.storageUnknown'),
      size,
    ].filter(Boolean).join(' · ');
  });
  return node;
}

function lastExportLine() {
  const { last, since } = store.backupStatus();
  return el('div.small.faint', {
    style: { marginTop: '4px' },
    text: last
      ? t('settings.lastBackup', { date: fmtDate(last) })
        + (since ? ` · ${t('settings.workoutsSince', { workouts: tn(since, 'unit.workout') })}` : ` · ${t('settings.upToDate')}`)
      : t('settings.neverBackedUp'),
  });
}

export async function doExport() {
  const data = store.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const a = el('a', { href: url, download: `liftlog-backup-${stamp}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  // Marked optimistically: the browser gives no callback for "the user actually
  // kept the file", and nagging someone who just exported is worse than missing
  // one cancelled download.
  await store.markExported();
  toast(t('settings.backupDownloaded'));
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
        t('settings.replaceTitle'),
        t('settings.replaceBody', { file: file.name }),
        { confirmLabel: t('settings.restore') });
      if (!ok) return;
      await store.importData(payload, { replace: true });
      toast(t('settings.backupRestored'));
    } catch (err) {
      console.error('[liftlog] import failed', err);
      toast(err.message || t('settings.unreadableFile'), 3200);
    }
  });

  input.click();
}
