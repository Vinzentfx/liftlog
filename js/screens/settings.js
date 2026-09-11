// Einstellungen: Einheiten, Pausen und Sichern/Wiederherstellen.

import {
  el, openSheet, closeSheet, confirmSheet, toast, fmtClock, fmtDate, fmtDecimal,
  numberInput, parseNumber, normaliseOnBlur,
} from '../ui.js';
import * as store from '../store.js';
import * as db from '../db.js';
import { hasProfile } from '../standards.js';
import { DEFAULT_BAR } from '../plates.js';
import { dayKey } from '../models.js';
import { evidenceList } from '../rating-ui.js';
import { t, tn, LANGUAGES } from '../i18n.js';
import { cloudSection } from './account.js';
import * as sync from '../sync.js';
import * as cloud from '../cloud.js';
import * as push from '../push.js';
import { loadGymLocation, saveGymLocation, clearGymLocation, gymMapPicker } from '../gym-location.js';

const THEMES = [
  { key: 'ocean', label: 'settings.themeOcean', colours: ['#60A5FA', '#0A0E1A', '#17243A'] },
  { key: 'violet', label: 'settings.themeViolet', colours: ['#A78BFA', '#100D1D', '#261E40'] },
  { key: 'emerald', label: 'settings.themeEmerald', colours: ['#34D399', '#071713', '#17352C'] },
  { key: 'sunset', label: 'settings.themeSunset', colours: ['#FB7185', '#1B0D16', '#3A1D2C'] },
];

/**
 * Profil: die Angaben, die die Kraftstandards wirklich brauchen.
 * Die Körpergröße wird nur zur Info erfasst. Kein veröffentlichter Standard rechnet
 * mit ihr, sie in die Rechnung zu nehmen wäre also ausgedachte Genauigkeit.
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
    // Das Diagramm fürs Körpergewicht im Gleichschritt mit dem Profil halten.
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

  // Beim Wechsel der Einheit wird jede gespeicherte Zahl umbeschriftet und nicht
  // umgerechnet. Gewichte stehen als nackte Zahlen, aus 100 kg wird also "100 lb".
  // Einmal am Anfang eingestellt ist das in Ordnung, sobald es Verlauf gibt, ist es
  // falsch. Deshalb sagt der Schalter das, statt so zu tun, als würde er umrechnen.
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

  // Sprache. Gespeichert als null, solange sie dem Gerät folgt, so soll es bei einer
  // frischen Installation sein. Wer hier eine auswählt, legt sie fest.
  const languageChoices = el('div.language-grid', {
    role: 'group', 'aria-label': t('settings.language'),
  }, [
    { key: null, label: t('settings.languageAuto') },
    ...LANGUAGES.map((l) => ({ key: l.key, label: l.label })),
  ].map((option) => {
    const selected = (s.language || null) === option.key;
    return el('button.language-choice', {
      type: 'button', 'aria-pressed': String(selected),
      onclick: async () => {
        await store.setSetting('language', option.key);
        // Das offene Sheet sofort in der neu gewählten Sprache neu aufbauen.
        closeSheet();
        renderSettings();
      },
    }, [
      el('span.language-dot', { 'aria-hidden': 'true' }, [selected ? '✓' : '']),
      el('span', { text: option.label }),
    ]);
  }));

  const themeChoices = el('div.theme-grid', {
    role: 'group', 'aria-label': t('settings.colourStyle'),
  }, THEMES.map((theme) => {
    const selected = (s.theme || 'ocean') === theme.key;
    return el('button.theme-choice', {
      type: 'button', 'aria-pressed': String(selected),
      onclick: async (event) => {
        // currentTarget wird geleert, sobald das Ereignis durch ist, und das kann
        // passieren, während unten auf IndexedDB gewartet wird. Also das Element selbst behalten.
        const clicked = event.currentTarget;
        await store.setSetting('theme', theme.key);
        for (const choice of clicked.parentElement.children) {
          const active = choice === clicked;
          choice.setAttribute('aria-pressed', String(active));
          choice.querySelector('.theme-check').textContent = active ? '✓' : '';
        }
      },
    }, [
      el('span.theme-preview', {
        'aria-hidden': 'true',
        style: {
          '--preview-accent': theme.colours[0],
          '--preview-bg': theme.colours[1],
          '--preview-surface': theme.colours[2],
        },
      }),
      el('span', { text: t(theme.label) }),
      el('span.theme-check', { 'aria-hidden': 'true', text: selected ? '✓' : '' }),
    ]);
  }));

  const ratingToggle = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
  ratingToggle.checked = hasProfile(s) && s.showRatings !== false;
  ratingToggle.disabled = !hasProfile(s);
  ratingToggle.addEventListener('change', () => store.setSetting('showRatings', ratingToggle.checked));

  // Der anonyme Vergleich der Ränge. Aus, solange man ihn nicht einschaltet, und beim
  // Ausschalten werden alle bisherigen Beiträge in derselben Aktion zurückgezogen,
  // nicht nur keine neuen mehr geschickt. Das ist der Unterschied zwischen "nicht
  // mehr mitmachen" und "nie mitgemacht haben".
  const rankShareToggle = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
  rankShareToggle.checked = s.shareRankComparison === true;
  rankShareToggle.addEventListener('change', async () => {
    const on = rankShareToggle.checked;
    await store.setSetting('shareRankComparison', on);
    const home = await import('./home.js');
    home.resetRankComparison();
    if (!on && cloud.isSignedIn()) {
      try { await cloud.forgetRankScores(); toast(t('settings.rankShareWithdrawn')); }
      catch { toast(t('settings.rankShareWithdrawFailed')); }
    }
  });

  const rirToggle = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
  rirToggle.checked = s.logRir !== false;
  rirToggle.addEventListener('change', () => store.setSetting('logRir', rirToggle.checked));

  // Was ein Satz ohne RIR für die Progression wert ist. Am meisten zählt das für alle,
  // die die Spalte ganz ausgeschaltet haben: bei ihnen ist jeder Satz leer, und leer
  // als "bis zum Versagen" zu lesen hat jeden Vorschlag zu leicht gemacht, solange es
  // die App gibt.
  const assumedRir = normaliseOnBlur(numberInput({
    value: s.assumedRir ?? 1,
    placeholder: '1',
    'aria-label': t('settings.assumedRir'),
  }), { integer: true });
  assumedRir.addEventListener('change', () => {
    const value = parseNumber(assumedRir.value);
    store.setSetting('assumedRir', value === null ? 0 : Math.max(0, Math.min(4, Math.round(value))));
  });

  const soundToggle = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
  soundToggle.checked = s.soundOnRestEnd !== false;
  soundToggle.addEventListener('change', () => store.setSetting('soundOnRestEnd', soundToggle.checked));

  const bgAudioToggle = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
  bgAudioToggle.checked = s.restBackgroundAudio !== false;
  bgAudioToggle.addEventListener('change', () =>
    store.setSetting('restBackgroundAudio', bgAudioToggle.checked));

  const starToggle = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
  starToggle.checked = s.showStars !== false;
  starToggle.addEventListener('change', () => store.setSetting('showStars', starToggle.checked));

  const preferenceToggle = (key) => {
    const input = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
    input.checked = s[key] !== false;
    input.addEventListener('change', () => store.setSetting(key, input.checked));
    return input;
  };
  // Einschalten statt Ausschalten: `preferenceToggle` liest einen fehlenden Wert als an,
  // und dieser Schalter ändert, was die App empfiehlt. Also muss man ihn selbst wollen.
  const optInToggle = (key) => {
    const input = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
    input.checked = s[key] === true;
    input.addEventListener('change', () => store.setSetting(key, input.checked));
    return input;
  };
  const progressionToggle = preferenceToggle('progressionSuggestions');
  const strictRangeToggle = optInToggle('strictRepRange');
  const warmupToggle = preferenceToggle('warmupSuggestions');
  const plateauToggle = preferenceToggle('plateauHints');
  const outlierToggle = preferenceToggle('outlierHints');
  const deloadToggle = preferenceToggle('deloadHints');
  const techniqueToggle = preferenceToggle('techniqueHints');
  const durationToggle = preferenceToggle('plannedDuration');
  const previewToggle = preferenceToggle('workoutPreview');
  const setHistoryToggle = preferenceToggle('setHistory');
  const regenerationToggle = el('input', { type: 'checkbox', checked: !!s.regenerationEnabled,
    style: { width: 'auto', minHeight: 'auto' } });
  regenerationToggle.addEventListener('change', () => store.setSetting('regenerationEnabled', regenerationToggle.checked));

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

  const checkRow = (input, label, hint) => el('label.setting-toggle', {}, [
    el('span.setting-toggle-copy', {}, [
      el('strong', { text: label }),
      hint ? el('small', { text: hint }) : null,
    ]),
    el('span.switch-control', {}, [input, el('span.switch-track', { 'aria-hidden': 'true' })]),
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
    el('div.settings-toggle-list', {}, [checkRow(ratingToggle, t('settings.showRatings'))]),

    el('div.section-head', {}, [el('h2', { text: t('settings.appearance') })]),
    el('div', {}, [
      el('div.field-caption', { text: t('settings.colourStyle') }),
      themeChoices,
    ]),
    el('div', {}, [
      el('div.field-caption', { text: t('settings.language') }),
      languageChoices,
    ]),
    el('div.small.faint', { style: { marginTop: '-4px', marginBottom: '14px' }, text: t('settings.languageNote') }),

    el('div.section-head', {}, [el('h2', { text: t('route.train') })]),
    el('button.list-item', {
      onclick: () => { closeSheet(); location.hash = '#/library'; },
      'aria-label': t('settings.openLibrary'),
    }, [
      el('div.grow', {}, [
        el('div.li-title', { text: t('route.library') }),
        el('div.li-sub', { text: t('settings.libraryHint', { n: store.state.exercises.length }) }),
      ]),
      el('span.chev', { text: '›', 'aria-hidden': 'true' }),
    ]),
    el('label.field', {}, [el('span', { text: t('settings.units') }), units]),

    el('label.field', {}, [
      el('div.row.between', { style: { marginBottom: '6px' } }, [
        el('span', { text: t('settings.defaultRest'), style: { marginBottom: '0' } }),
        restValue,
      ]),
      rest,
    ]),

    el('div.settings-toggle-list', {}, [
      checkRow(autoRest, t('settings.autoRest')),
      checkRow(soundToggle, t('settings.chime')),
      checkRow(bgAudioToggle, t('settings.restBackgroundAudio'), t('settings.restBackgroundAudioNote')),
      checkRow(rirToggle, t('settings.logRir'), t('settings.logRirNote')),
      el('label.field', { style: { marginTop: '4px' } }, [
        el('span', { text: t('settings.assumedRir') }), assumedRir,
        el('small', { text: t('settings.assumedRirNote') }),
      ]),
      checkRow(progressionToggle, t('settings.progressionSuggestions'), t('settings.progressionSuggestionsNote')),
      checkRow(strictRangeToggle, t('settings.strictRepRange'), t('settings.strictRepRangeNote')),
      checkRow(warmupToggle, t('settings.warmupSuggestions'), t('settings.warmupSuggestionsNote')),
      checkRow(plateauToggle, t('settings.plateauHints')),
      checkRow(outlierToggle, t('settings.outlierHints'), t('settings.outlierHintsNote')),
      checkRow(deloadToggle, t('settings.deloadHints'), t('settings.deloadHintsNote')),
      checkRow(techniqueToggle, t('settings.techniqueHints'), t('settings.techniqueHintsNote')),
      checkRow(durationToggle, t('settings.plannedDuration')),
      checkRow(previewToggle, t('settings.workoutPreview'), t('settings.workoutPreviewNote')),
      checkRow(setHistoryToggle, t('settings.setHistory'), t('settings.setHistoryNote')),
      checkRow(regenerationToggle, t('settings.regeneration'), t('settings.regenerationNote')),
    ]),

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
    el('div.settings-toggle-list', {}, [
      checkRow(starToggle, t('settings.stars'), t('settings.starsNote')),
      checkRow(rankShareToggle, t('settings.rankShare'), t('settings.rankShareNote')),
    ]),

    notificationSection(s),

    gymLocationSection(),

    cloudSection(),

    el('div.section-head', {}, [el('h2', { text: t('settings.health.title') })]),
    el('div.card.tight', {}, [
      el('div.small.muted', { text: t('settings.health.nativeRequired') }),
      el('button.btn.ghost.full.sm', { style: { marginTop: '10px' }, onclick: exportHealthData },
        [t('settings.health.export')]),
    ]),

    el('div.section-head', {}, [el('h2', { text: t('settings.backup') })]),
    el('div.small.muted', { style: { marginBottom: '10px' }, text: t('settings.backupNote') }),
    viewportLine(),
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
        // Hier gehen auch die Geräteschlüssel mit: "alles löschen" heißt alles, auch
        // die Identität in der Cloud. Mit ihnen abzumelden hält beide Seiten im
        // Gleichschritt, statt eine Sitzung übrig zu lassen, die auf ein Konto zeigt,
        // das dieses Gerät nicht mehr entschlüsseln kann.
        await Promise.all(Object.values(db.STORES).map((st) => db.clear(st)));
        await sync.signOutEverywhere({ forgetDevice: true }).catch(() => {});
        await store.load();
        location.reload();
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

    el('div.row', { style: { justifyContent: 'center', gap: '14px', marginTop: '22px' } }, [
      el('a.small', { href: './privacy.html', target: '_blank', rel: 'noopener' }, [t('legal.privacy')]),
      el('a.small', { href: './legal.html', target: '_blank', rel: 'noopener' }, [t('legal.terms')]),
    ]),

    el('div.small.faint', { style: { textAlign: 'center', marginTop: '22px' }, text: 'LiftLog · v2' }),
  ]);

  openSheet(t('common.settings'), body);
}

function gymLocationSection() {
  const saved = loadGymLocation();
  const enabled = el('input', { type: 'checkbox', checked: !!saved?.enabled, disabled: !saved,
    'aria-label': t('gym.autoTitle'),
    style: { width: 'auto', minHeight: 'auto' } });
  enabled.addEventListener('change', () => saveGymLocation({ enabled: enabled.checked }));
  const radiusValue = el('span.small.muted', { text: t('gym.radiusValue', { n: saved?.radius || 120 }) });
  const radius = el('input', { type: 'range', min: '50', max: '500', step: '10', value: String(saved?.radius || 120),
    disabled: !saved, style: { width: '100%', minHeight: 'auto', padding: '0', background: 'transparent', border: '0' } });
  radius.addEventListener('input', () => { radiusValue.textContent = t('gym.radiusValue', { n: radius.value }); });
  radius.addEventListener('change', () => saveGymLocation({ radius: Number(radius.value) }));
  const pick = () => gymMapPicker((point) => {
    saveGymLocation({ ...point, radius: Number(radius.value), enabled: true });
    // Die Auswahl schließt sich nach diesem Callback selbst. Die Einstellungen im
    // nächsten Task neu öffnen, sonst schließt closeSheet das frisch gebaute Sheet sofort.
    setTimeout(renderSettings, 0);
  });

  return el('div', {}, [
    el('div.section-head', {}, [el('h2', { text: t('gym.settingsTitle') })]),
    el('div.card', {}, [
      el('div.row.between', { style: { gap: '14px' } }, [
        el('div.grow', {}, [
          el('strong', { text: t('gym.autoTitle') }),
          el('div.small.muted', { style: { marginTop: '4px' }, text: t(saved ? 'gym.savedBody' : 'gym.notSetBody') }),
        ]),
        el('span.switch-control', {}, [enabled, el('span.switch-track', { 'aria-hidden': 'true' })]),
      ]),
      el('div.row.between', { style: { marginTop: '15px', marginBottom: '6px' } }, [
        el('span.small', { text: t('gym.radius') }), radiusValue,
      ]),
      radius,
      el('button.btn.ghost.full', { style: { marginTop: '12px' }, onclick: pick }, [
        t(saved ? 'gym.changePoint' : 'gym.choosePoint'),
      ]),
      saved ? el('button.btn.quiet.full.sm', { style: { marginTop: '4px' }, onclick: async () => {
        clearGymLocation(); toast(t('gym.removed')); closeSheet(); renderSettings();
      } }, [t('gym.removePoint')]) : null,
      el('div.small.faint', { style: { marginTop: '9px' }, text: t('gym.localOnly') }),
    ]),
  ]);
}

function notificationSection(settings) {
  const enabled = !!settings.notificationsEnabled;
  const creatineEnabled = enabled && !!settings.creatineReminderEnabled;
  const time = el('input', { type: 'time', value: settings.creatineReminderTime || '19:00' });
  const creatine = el('input', { type: 'checkbox', checked: creatineEnabled,
    style: { width: 'auto', minHeight: 'auto' } });

  const save = async (nextCreatine = creatine.checked) => {
    if (!cloud.isSignedIn()) { toast(t('settings.notificationsNeedAccount')); return false; }
    try {
      if (!enabled || push.permission() !== 'granted') await push.enable();
      await cloud.saveNotificationPreferences({ allEnabled: true, creatineEnabled: nextCreatine,
        creatineTime: time.value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin' });
      await store.setSetting('notificationsEnabled', true);
      await store.setSetting('creatineReminderEnabled', nextCreatine);
      await store.setSetting('creatineReminderTime', time.value);
      toast(t('settings.notificationsSaved'));
      return true;
    } catch (err) {
      toast(t(err?.code === 'PUSH_DENIED' ? 'users.notificationsDenied' : 'settings.notificationsFailed'));
      return false;
    }
  };

  creatine.addEventListener('change', async () => {
    if (!await save(creatine.checked)) creatine.checked = !creatine.checked;
    else { closeSheet(); renderSettings(); }
  });
  time.addEventListener('change', () => save(creatine.checked));

  return el('div', {}, [
    el('div.section-head', {}, [el('h2', { text: t('settings.notifications') })]),
    el('div.card', {}, [
      el('div.row.between', {}, [
        el('div.grow', {}, [el('strong', { text: t('settings.creatineTitle') }),
          el('div.small.muted', { style: { marginTop: '4px' }, text: t('settings.creatineBody') })]),
        el('span.switch-control', {}, [creatine, el('span.switch-track', { 'aria-hidden': 'true' })]),
      ]),
      el('label.field', { style: { marginTop: '12px' } }, [
        el('span', { text: t('settings.creatineTime') }), time,
      ]),
      creatineEnabled ? el('div.row', {}, [
        el('button.btn.primary.grow', { onclick: async () => {
          try { await cloud.answerCreatineReminder('taken'); await store.setSetting('creatineLastTakenDay', dayKey()); toast(t('settings.creatineTaken')); }
          catch { toast(t('settings.notificationsFailed')); }
        } }, [t('settings.alreadyTaken')]),
        el('button.btn.ghost.grow', { onclick: async () => {
          try { await cloud.answerCreatineReminder('snooze'); toast(t('settings.creatineSnoozed')); }
          catch { toast(t('settings.notificationsFailed')); }
        } }, [t('settings.notTaken')]),
      ]) : null,
    ]),
    enabled ? el('button.btn.full.danger', { style: { marginTop: '10px' }, onclick: async () => {
      try {
        await cloud.saveNotificationPreferences({ allEnabled: false, creatineEnabled: false,
          creatineTime: time.value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin' });
        await push.disable();
        await store.setSetting('notificationsEnabled', false);
        await store.setSetting('creatineReminderEnabled', false);
        toast(t('settings.allNotificationsOff')); closeSheet(); renderSettings();
      } catch { toast(t('settings.notificationsFailed')); }
    } }, [t('settings.disableAllNotifications')]) : null,
  ]);
}

/**
 * Der echte Zustand des Speichers, wird nachträglich eingefüllt.
 *
 * Ersetzt eine pauschale Warnung, die für die Art, wie die App tatsächlich benutzt
 * wird, falsch war: eine installierte Web-App auf dem Homescreen ist von Safaris
 * Sieben-Tage-Löschung ausgenommen und bekommt ein Kontingent wie ein Browser.
 * "Safari löscht das" zu sagen, wenn es das nicht tut, bringt einem nur bei, auch
 * die Warnungen zu übergehen, auf die es ankommt.
 */
/**
 * Vorübergehendes Messwerkzeug, keine Funktion. Wieder raus, sobald die Lücke über
 * der Tab-Leiste unter iOS geklärt ist.
 *
 * Zeichnet gar nichts, solange das Fenster der App nicht vom Bildschirm abweicht.
 * Genau das lässt sich vom Laptop aus nicht messen, und daran hängt der Unterschied
 * zwischen "die Leiste reserviert zu viel Platz" und "das Layout ist kürzer als das
 * Handy". Eine Diagnose, die unsichtbar bleibt, wenn alles passt, lohnt sich. Eine,
 * die immer zu sehen ist, stört.
 */
function viewportLine() {
  const inner = Math.round(window.innerHeight);
  const client = Math.round(document.documentElement.clientHeight);
  const app = Math.round(document.getElementById('app')?.getBoundingClientRect().height || 0);
  const probe = el('div', { style: { position: 'fixed', top: '-9999px', height: '100dvh' } });
  document.body.append(probe);
  const dvh = Math.round(probe.getBoundingClientRect().height);
  probe.remove();
  const inset = getComputedStyle(document.documentElement)
    .getPropertyValue('--safe-b').trim();

  // Stimmt alles überein, gibt es keine Lücke zu erklären, also nichts sagen.
  if (Math.abs(app - inner) <= 1 && Math.abs(dvh - inner) <= 1) return null;

  return el('div.small', {
    style: { marginBottom: '8px', color: 'var(--warn)' },
    text: `Diagnose: Bildschirm ${inner}, dvh ${dvh}, App ${app}, Rand unten ${inset || '0px'}`,
  });
}

function storageLine() {
  const node = el('div.small.faint', { style: { marginBottom: '8px' }, text: t('settings.checkingStorage') });
  db.storageStatus().then(({ persisted, usage }) => {
    const size = usage ? t('settings.mbUsed', { mb: fmtDecimal(usage / 1048576) }) : null;
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
  // Vorsichtshalber schon als erledigt markiert: der Browser meldet nicht, ob die
  // Datei wirklich behalten wurde, und jemanden zu nerven, der gerade exportiert hat,
  // ist schlimmer, als einen abgebrochenen Download zu übersehen.
  await store.markExported();
  toast(t('settings.backupDownloaded'));
}

function exportHealthData() {
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['workout_id', 'started_at', 'finished_at', 'workout', 'exercise', 'set_type',
    'weight', 'repetitions', 'rir', 'unit']];
  for (const session of store.state.sessions.filter((row) => row.finishedAt)) {
    for (const entry of session.entries || []) {
      const exercise = store.state.exerciseById.get(entry.exerciseId);
      for (const set of entry.sets || []) {
        if (!set.done) continue;
        rows.push([
          session.id, new Date(session.startedAt).toISOString(), new Date(session.finishedAt).toISOString(),
          session.name, exercise?.name || '', set.type || 'working', set.systemWeight ?? set.weight ?? '',
          set.reps ?? '', set.rir ?? '', store.units(),
        ]);
      }
    }
  }
  const blob = new Blob([rows.map((row) => row.map(quote).join(',')).join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `liftlog-health-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(t('settings.health.exported'));
}

function doImport() {
  const input = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  document.body.append(input);

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error(t('settings.backupTooLarge'));
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
