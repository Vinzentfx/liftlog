// Plans — multi-day workout templates, from presets or built by hand.

import {
  el, toast, openSheet, closeSheet, confirmSheet, emptyState, listItem, fmtWeight,
  starString, starBadge,
} from '../ui.js';
import * as store from '../store.js';
import { bestOneRepMaxByName } from '../models.js';
import { PLAN_BLUEPRINTS, buildPlanDays } from '../plan-builder.js';
import { analysePlan, WEIGHTS, WEIGHT_WHY } from '../plan-rating.js';
import { THRESHOLDS, RATING_DISCLAIMER } from '../evidence.js';
import { rateExercise } from '../exercise-rating.js';
import { exerciseRatingSheet, evidenceList, swapSheet } from '../rating-ui.js';
import { diagnose } from '../plan-doctor.js';
import { suggestSwaps } from '../swaps.js';
import { WEEK_ORDER, weekdayName, weekdayShort, weekRows, isScheduled, scheduleConflict } from '../schedule.js';
import { planLink } from '../plan-share.js';
import { scoreFor, tierIndex, tierOf, isBenchmark, hasProfile, toNextTier } from '../standards.js';
import { t, tn, tMuscle, tRegion, tTier } from '../i18n.js';
import { pickExercise } from '../pickers.js';
import { navigate } from '../app.js';

export default function renderPlans({ param, actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': t('common.settings') }, ['⚙']));
  if (param) return planView(param);
  return listView();
}

/* ============================ list ============================ */

function listView() {
  const root = el('div');
  const { plans } = store.state;
  const activeId = store.state.settings.activePlanId;

  if (!plans.length) {
    root.append(
      el('div.card.glow', {}, [
        el('div', { style: { fontWeight: '680', marginBottom: '4px' }, text: t('plans.presetTitle') }),
        el('div.small.muted', { text: t('plans.presetBody') }),
      ])
    );
  } else {
    root.append(el('div.section-head', { style: { marginTop: '4px' } }, [el('h2', { text: t('plans.yours') })]));
    for (const p of plans) {
      const dayCount = p.days.length;
      const exCount = p.days.reduce((n, d) => n + d.items.length, 0);
      const a = analysePlan(p, store.state.exerciseById);
      root.append(listItem({
        title: p.name + (p.id === activeId ? '  ★' : ''),
        sub: `${tn(dayCount, 'unit.day')} · ${tn(exCount, 'unit.exercise')}`
          + (p.id === activeId ? ` · ${t('plans.active')}` : ''),
        right: exCount && store.starsShown() ? starBadge(a.stars) : null,
        ariaLabel: exCount && store.starsShown()
          ? t('plans.openRated', { name: p.name, stars: a.stars })
          : t('plans.open', { name: p.name }),
        onclick: () => navigate('plans', p.id),
      }));
    }
  }

  root.append(el('div.section-head', {}, [el('h2', { text: t('plans.templates') })]));
  root.append(el('div.small.faint', { style: { marginBottom: '10px' },
    text: t('plans.templatesNote', { sets: store.defaultSets(), reps: store.defaultReps() })
      + (store.starsShown() ? ` ${t('plans.templatesStars')}` : '') }));

  for (const bp of PLAN_BLUEPRINTS) {
    const slots = bp.days.reduce((n, d) => n + d.slots.reduce((m, [, c]) => m + c, 0), 0);
    const preview = previewBlueprint(bp);
    root.append(
      el('button.list-item' + (bp.recommended ? '.glow' : ''), {
        'aria-label': store.starsShown()
          ? t('plans.createRated', { name: bp.name, stars: preview.stars })
          : t('plans.create', { name: bp.name }),
        onclick: () => blueprintSheet(bp, preview),
      }, [
        el('div.grow', {}, [
          el('div.li-title', { text: bp.name + (bp.recommended ? '  ★' : '') }),
          el('div.li-sub', { text: `${t(bp.blurb)} · ${t('plans.slotSummary', { exercises: slots, sets: slots * store.defaultSets() })}` }),
        ]),
        store.starsShown() ? starBadge(preview.stars) : null,
        el('span.chev', { text: '+', 'aria-hidden': 'true' }),
      ])
    );
  }

  root.append(
    el('button.btn.ghost.full', {
      style: { marginTop: '14px' },
      onclick: async () => {
        const plan = await store.savePlan({ name: t('plans.myPlan'), days: [] });
        navigate('plans', plan.id);
      },
    }, [t('plans.fromScratch')])
  );

  return root;
}

/**
 * What a template scores once it is filled in from the current library. Built
 * and thrown away — the picker is deterministic, so this is the plan the user
 * would actually get.
 */
function previewBlueprint(bp) {
  // Filling four blueprints means ranking the whole library a few dozen times.
  // Cheap enough to do once, not cheap enough to redo on every repaint of the
  // list — and the only inputs that change the answer are the library size and
  // which movements are favourited.
  const sig = `${store.state.exercises.length}:${store.defaultSets()}:${store.defaultReps()}:${store.state.exercises.filter((e) => e.favourite).map((e) => e.id).join(',')}`;
  const hit = previewCache.get(bp.key);
  if (hit && hit.sig === sig) return hit.analysis;

  const days = buildPlanDays(bp, store.state.exercises, { sets: store.defaultSets(), reps: store.defaultReps() });
  const analysis = analysePlan({ days, perWeek: bp.perWeek || 1 }, store.state.exerciseById);
  previewCache.set(bp.key, { sig, analysis });
  return analysis;
}

const previewCache = new Map();

/** Two ways to take a template: filled in, or just the day structure. */
function blueprintSheet(bp, preview = previewBlueprint(bp)) {
  const perDay = bp.days.map((d) => {
    const n = d.slots.reduce((m, [, c]) => m + c, 0);
    return `${d.name}: ${tn(n, 'unit.exercise')}`;
  });

  const body = el('div', {}, [
    el('div.small.muted', { text: t(bp.blurb) }),

    el('div.card.tight.glow', { style: { marginTop: '12px' } }, [
      el('div.row.between', {}, [
        store.starsShown()
          ? starBadge(preview.stars, { size: '19px' })
          : el('span.small.faint', { text: t('plans.planCheck') }),
        el('button.btn.sm.ghost', { onclick: () => breakdownSheet(bp.name, preview) }, [t('plans.details')]),
      ]),
      ...preview.good.slice(0, 1).map((line) =>
        el('div.small', { style: { marginTop: '7px', color: 'var(--good)' }, text: `✓  ${line}` })),
      ...preview.missing.slice(0, 1).map((line) =>
        el('div.small', { style: { marginTop: '7px', color: 'var(--warn)' }, text: `!  ${line}` })),
    ]),

    el('div.card.tight', { style: { marginTop: '12px' } }, [
      el('div.small', { style: { fontWeight: '650', marginBottom: '6px' },
        text: t('plans.blueprintTarget', { reps: store.defaultReps(), sets: store.defaultSets() }) }),
      ...perDay.map((line) => el('div.small.faint', { text: line })),
    ]),

    el('div.section-head', {}, [el('h2', { text: t('plans.howDoYouWantIt') })]),
    el('button.btn.primary.full', {
      onclick: async () => {
        closeSheet();
        const plan = await store.createPlanFromBlueprint(bp, { empty: false });
        toast(t('plans.created', { name: plan.name }));
        navigate('plans', plan.id);
      },
    }, [t('plans.fillIn')]),
    el('div.small.faint', { style: { margin: '6px 0 14px' }, text: t('plans.fillInNote') }),

    el('button.btn.ghost.full', {
      onclick: async () => {
        closeSheet();
        const plan = await store.createPlanFromBlueprint(bp, { empty: true });
        toast(t('plans.emptyCreated'));
        navigate('plans', plan.id);
      },
    }, [t('plans.layoutOnly')]),
    el('div.small.faint', { style: { marginTop: '6px' }, text: t('plans.layoutOnlyNote') }),
  ]);

  openSheet(bp.name, body);
}

/* ============================ plan ============================ */

function planView(planId) {
  const plan = store.state.plans.find((p) => p.id === planId);
  const root = el('div');

  root.append(
    el('button.btn.quiet.sm', {
      style: { marginBottom: '10px', paddingLeft: '0' },
      onclick: () => navigate('plans'),
    }, [`‹ ${t('route.plans')}`])
  );

  if (!plan) {
    root.append(emptyState(t('plans.notFound'), t('library.notFoundHint')));
    return root;
  }

  const isActive = store.state.settings.activePlanId === plan.id;

  root.append(
    el('div.row.between', { style: { marginBottom: '14px' } }, [
      el('div.grow', {}, [
        el('div', { style: { fontSize: '21px', fontWeight: '740', letterSpacing: '-0.025em' }, text: plan.name }),
        el('div.small.faint', { text: t('plans.trainingDays', { n: plan.days.length }) }),
      ]),
      el('div.row', { style: { gap: '6px' } }, [
        plan.days.some((d) => d.items.length)
          ? el('button.btn.sm.ghost', { onclick: () => shareSheet(plan) }, [t('common.share')])
          : null,
        el('button.btn.sm.ghost', { onclick: () => renamePlan(plan) }, [t('train.rename')]),
      ]),
    ])
  );

  if (!isActive) {
    root.append(
      el('button.btn.primary.full', {
        style: { marginBottom: '14px' },
        onclick: async () => { await store.setSetting('activePlanId', plan.id); toast(t('plans.nowActive', { name: plan.name })); },
      }, [t('plans.makeActive')])
    );
  } else {
    root.append(el('div.card.tight.glow', { style: { marginBottom: '14px' } }, [
      el('div.small', { text: `★  ${t('plans.activeNote')}` }),
    ]));
  }

  root.append(qualityCard(plan));
  root.append(weekCard(plan));

  plan.days.forEach((day, i) => root.append(dayCard(plan, day, i)));

  root.append(
    el('button.btn.ghost.full', {
      style: { marginTop: '4px' },
      onclick: async () => {
        plan.days.push({ id: `d_${Date.now().toString(36)}`, name: t('plans.dayN', { n: plan.days.length + 1 }), items: [] });
        await store.savePlan(plan);
      },
    }, [t('plans.addDay')])
  );

  root.append(
    el('button.btn.full.danger', {
      style: { marginTop: '22px' },
      onclick: async () => {
        const ok = await confirmSheet(t('plans.deleteTitle'), t('plans.deleteBody', { name: plan.name }));
        if (!ok) return;
        await store.deletePlan(plan.id);
        toast(t('plans.deleted'));
        navigate('plans');
      },
    }, [t('plans.deletePlan')])
  );

  return root;
}

/** Star rating plus a plain-language breakdown of what works and what doesn't. */
/**
 * The week at a glance, once any day has a weekday assigned.
 *
 * Hidden entirely while nothing is scheduled — an empty seven-row grid is not
 * an invitation, it is clutter. The nudge to schedule lives on the first day's
 * menu instead, where you are already editing.
 */
function weekCard(plan) {
  const wrap = el('div');
  if (!plan.days.length) return wrap;

  if (!isScheduled(plan)) {
    wrap.append(el('div.section-head', {}, [el('h2', { text: t('plans.week') })]));
    wrap.append(el('div.card', {}, [
      el('div.small.muted', { text: t('plans.noWeekdays') }),
      el('div.small.faint', { style: { marginTop: '8px' }, text: t('plans.noWeekdaysHint') }),
    ]));
    return wrap;
  }

  const conflict = scheduleConflict(plan);
  wrap.append(el('div.section-head', {}, [el('h2', { text: t('plans.week') })]));

  const card = el('div.card', {});
  for (const row of weekRows(plan)) {
    card.append(
      el('div.row', {
        style: {
          gap: '10px', alignItems: 'baseline', padding: '7px 0',
          borderBottom: '1px solid var(--line-soft)',
        },
      }, [
        el('span', {
          style: {
            width: '42px', flex: '0 0 42px', fontSize: '12px', fontWeight: '750',
            letterSpacing: '.06em', textTransform: 'uppercase',
            color: row.isToday ? 'var(--accent-hi)' : 'var(--text-faint)',
          },
          text: row.short,
        }),
        row.days.length
          ? el('span.grow', { style: { fontSize: '14.5px', fontWeight: '600' },
              text: row.days.map((d) => `${d.name} · ${d.items.length}`).join('   ') })
          : el('span.grow.small.faint', { text: t('plans.rest') }),
        row.isToday ? el('span.pill.accent', { text: t('common.today') }) : null,
      ])
    );
  }

  if (conflict) {
    card.append(el('div.small', { style: { marginTop: '10px', color: 'var(--warn)' }, text: `! ${conflict.text}` }));
  }
  wrap.append(card);
  return wrap;
}

function qualityCard(plan) {
  const a = analysePlan(plan, store.state.exerciseById);
  const card = el('div.card.glow', { style: { marginBottom: '14px' } });

  card.append(
    el('div.row.between', { style: { marginBottom: '4px' } }, [
      el('div.grow', {}, [
        store.starsShown() ? starBadge(a.stars, { size: '22px' }) : null,
        el('div.small.faint', {
          text: t('plans.qualitySummary', {
            exercises: a.exerciseCount, sets: a.totalSets,
            stretched: Math.round(a.longShare * 100),
          }),
        }),
      ]),
      el('button.btn.sm.ghost', { onclick: () => breakdownSheet(plan.name, a) }, [t('plans.details')]),
    ])
  );

  if (!a.exerciseCount) {
    card.append(el('div.small.muted', { style: { marginTop: '8px' }, text: t('plans.qualityEmpty') }));
    return card;
  }

  for (const line of a.good.slice(0, 2)) {
    card.append(el('div.small', { style: { marginTop: '8px', color: 'var(--good)' }, text: `✓  ${line}` }));
  }
  for (const line of a.missing.slice(0, 2)) {
    card.append(el('div.small', { style: { marginTop: '8px', color: 'var(--warn)' }, text: `!  ${line}` }));
  }
  if (a.good.length + a.missing.length > 4) {
    card.append(el('div.small.faint', { style: { marginTop: '8px' },
      text: t('plans.moreInDetails', { n: a.good.length + a.missing.length - 4 }) }));
  }

  const fixes = diagnose(plan, a, store.state.exercises, store.state.exerciseById, { sets: store.defaultSets() });
  if (fixes.length) {
    card.append(el('button.btn.ghost.full.sm', {
      style: { marginTop: '12px' },
      onclick: () => doctorSheet(plan, fixes),
    }, [t('plans.fixIt', { changes: tn(fixes.length, 'unit.change') })]));
  }

  return card;
}

/**
 * The plan doctor. Each fix applies on its own and saves immediately — batching
 * them behind one "apply all" would make a plan you no longer recognise, and the
 * point is that you see each change land.
 */
function doctorSheet(plan, fixes) {
  const body = el('div');
  body.append(el('div.small.muted', { text: t('plans.doctorIntro') }));

  for (const fix of fixes) {
    const row = el('div.card.tight', { style: { marginTop: '10px' } });
    const applyBtn = el('button.btn.sm.primary', {
      onclick: async () => {
        // Work on the live plan object, then persist through the normal path so
        // the rating, the Train tab and the calendar all see it at once.
        fix.apply(plan);
        await store.savePlan(plan);
        applyBtn.replaceChildren(t('plans.applied'));
        applyBtn.disabled = true;
        row.style.opacity = '.55';
        toast(t('plans.updated'));
      },
    }, [t('plans.apply')]);

    row.append(
      el('div.row.between', { style: { gap: '10px', alignItems: 'flex-start' } }, [
        el('div.grow', {}, [
          el('div', { style: { fontWeight: '640', fontSize: '14px' }, text: fix.title }),
          el('div.small.faint', { style: { marginTop: '2px' }, text: fix.detail }),
        ]),
        applyBtn,
      ])
    );
    body.append(row);
  }

  openSheet(t('plans.fixesTitle', { name: plan.name }), body);
}

// Kept short — .bar-row gives the label an 84px column and ellipsises the rest.
const PART_LABEL = {
  volume: 'plans.part.volume', coverage: 'plans.part.coverage', session: 'plans.part.session',
  selection: 'plans.part.selection', variety: 'plans.part.variety', frequency: 'plans.part.frequency',
};

function breakdownSheet(title, a) {
  const label = tRegion;
  const floor = THRESHOLDS.weeklyFloor.value;
  const uncharted = THRESHOLDS.weeklyUncharted.value;

  const rows = Object.entries(a.volume)
    .filter(([, v]) => v > 0)
    .sort((x, y) => y[1] - x[1]);
  const max = Math.max(...rows.map(([, v]) => v), 1);

  // Weight shown next to each component, because a 40% on something worth a
  // tenth of the score reads very differently from a 40% on volume.
  const part = (key) => el('div', { style: { marginBottom: '10px' } }, [
    el('div.bar-row', { style: { marginBottom: '2px' } }, [
      el('span.name', { text: t(PART_LABEL[key]) }),
      el('div.track', {}, [el('div.fill', { style: { width: `${Math.round(a.parts[key] * 100)}%` } })]),
      el('span.val', { text: `${Math.round(a.parts[key] * 100)}%` }),
    ]),
    el('div.small.faint', { style: { fontSize: '12px' },
      text: t('plans.partWorth', { pct: Math.round(WEIGHTS[key] * 100), why: t(WEIGHT_WHY[key]) }) }),
  ]);

  const body = el('div', {}, [
    store.starsShown()
      ? el('div', { style: { fontSize: '26px', letterSpacing: '.06em', color: 'var(--t4)', textAlign: 'center' },
          text: starString(a.stars) })
      : null,
    el('div.small.muted', { style: { textAlign: 'center', marginBottom: '14px' }, text: t(RATING_DISCLAIMER) }),

    el('div.section-head', {}, [el('h2', { text: t('plans.scoreBreakdown') })]),
    ...Object.keys(PART_LABEL).map(part),

    a.good.length ? el('div.section-head', {}, [el('h2', { text: t('plans.whatWorks') })]) : null,
    ...a.good.map((line) => el('div.small', { style: { marginBottom: '7px', color: 'var(--good)' }, text: `✓  ${line}` })),

    a.missing.length ? el('div.section-head', {}, [el('h2', { text: t('plans.whatToFix') })]) : null,
    ...a.missing.map((line) => el('div.small', { style: { marginBottom: '7px', color: 'var(--warn)' }, text: `!  ${line}` })),

    el('div.section-head', {}, [el('h2', { text: t('plans.weeklySets') })]),
    el('div.small.faint', { style: { marginBottom: '10px' },
      text: t('plans.weeklySetsNote', {
        floor, uncharted, weight: THRESHOLDS.indirectSetWeight.value,
      }) }),
    ...rows.map(([r, v]) => el('div.bar-row', {}, [
      el('span.name', { text: label(r) }),
      el('div.track', {}, [el('div.fill', {
        style: {
          width: `${Math.max(3, (v / max) * 100)}%`,
          background: v < floor ? 'var(--t0)' : 'linear-gradient(90deg, var(--accent), var(--accent-hi))',
        },
      })]),
      el('span.val', { text: String(Math.round(v)) }),
    ])),

    el('div.section-head', {}, [el('h2', { text: t('plans.peakSession') })]),
    el('div.small.faint', { style: { marginBottom: '10px' },
      text: t('plans.peakSessionNote', { n: THRESHOLDS.sessionPerMuscle.value }) }),
    ...Object.entries(a.peakSession)
      .filter(([, v]) => v > 0)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 8)
      .map(([r, v]) => el('div.bar-row', {}, [
        el('span.name', { text: label(r) }),
        el('div.track', {}, [el('div.fill', {
          style: {
            width: `${Math.max(3, (v / Math.max(THRESHOLDS.sessionPerMuscle.value, v)) * 100)}%`,
            background: v > THRESHOLDS.sessionPerMuscle.value ? 'var(--warn)' : 'var(--t0)',
          },
        })]),
        el('span.val', { text: String(Math.round(v)) }),
      ])),

    evidenceList(t('plans.basedOn')),
  ]);

  openSheet(t('plans.ratingTitle', { name: title }), body);
}

function dayCard(plan, day, index) {
  const card = el('div.card');

  card.append(
    el('div.row.between', { style: { marginBottom: '10px' } }, [
      el('div.grow', {}, [
        el('div', { style: { fontWeight: '680', fontSize: '16px' }, text: day.name }),
        el('div.small.faint', { text: tn(day.items.length, 'unit.exercise') }),
      ]),
      el('button.btn.sm.primary', {
        onclick: async () => {
          await store.startSession({ planId: plan.id, dayId: day.id });
          toast(t('train.startedDay', { day: day.name }));
          navigate('train');
        },
      }, [t('home.today.start')]),
      el('button.btn.quiet.sm', {
        'aria-label': t('train.optionsFor', { name: day.name }),
        onclick: () => dayMenu(plan, day, index),
      }, ['···']),
    ])
  );

  if (!day.items.length) {
    card.append(el('div.small.faint', { style: { padding: '6px 0' }, text: t('plans.noExercisesYet') }));
  }

  for (const item of day.items) {
    card.append(exerciseRow(plan, day, item));
  }

  card.append(
    el('button.btn.ghost.full.sm', {
      style: { marginTop: '8px' },
      onclick: () => pickExercise(async (ex) => {
        // Whatever you set in Settings, not a hardcoded 3 x 8-12 that
        // disagreed with what the generator produces.
        day.items.push({
          exerciseId: ex.id,
          targetSets: store.defaultSets(),
          targetReps: plan.repTarget || store.defaultReps(),
          note: '',
        });
        await store.savePlan(plan);
        toast(t('picker.added', { name: ex.name }));
      }, day.items.map((i) => i.exerciseId)),
    }, [t('train.addExercise')])
  );

  return card;
}

/** One exercise row, with its strength tier inline where one exists. */
function exerciseRow(plan, day, item) {
  const ex = store.state.exerciseById.get(item.exerciseId);
  if (!ex) return el('div');

  const settings = store.state.settings;
  let chip = null;

  if (settings.showRatings !== false && hasProfile(settings) && isBenchmark(ex.name)) {
    const best = bestOneRepMaxByName(store.state.sessions, store.state.exerciseById);
    const orm = best.get(ex.name);
    if (orm) {
      const score = scoreFor(ex.name, orm, settings);
      if (score !== null) {
        const idx = tierIndex(score);
        const next = toNextTier(ex.name, score, settings);
        chip = el(`div.tier-${idx}`, { style: { textAlign: 'right' } }, [
          el('span.tier-chip', { text: tTier(tierOf(score).key) }),
          next
            ? el('div.small.faint', { style: { marginTop: '3px' },
                text: `${fmtWeight(Math.round(next.weight), settings.units)} → ${tTier(next.tier.key)}` })
            : null,
        ]);
      }
    }
  }

  const rating = rateExercise(ex);

  return el('div.row.between', {
    style: { padding: '9px 0', borderTop: '1px solid var(--line-soft)', gap: '10px' },
  }, [
    el('div.grow', {}, [
      el('div', { style: { fontWeight: '600', fontSize: '14.5px' }, text: ex.name }),
      el('div.small.faint', { text: `${item.targetSets} × ${item.targetReps || '8-12'} · ${tMuscle(ex.muscle)}` }),
      // Tapping the stars explains them; the row's own ··· menu edits the item.
      store.starsShown()
        ? el('button.btn.quiet.sm', {
            style: { padding: '2px 0', marginTop: '2px' },
            'aria-label': t('plans.whyRated', { name: ex.name, stars: rating.stars }),
            onclick: () => exerciseRatingSheet(ex),
          }, [starBadge(rating.stars, { size: '12px' })])
        : null,
    ]),
    chip,
    el('button.btn.quiet.sm', {
      'aria-label': t('plans.editItem', { name: ex.name }),
      onclick: () => itemMenu(plan, day, item, ex),
    }, ['···']),
  ]);
}

/* ============================ menus ============================ */

function itemMenu(plan, day, item, ex) {
  const sets = el('input', {
    type: 'number', inputmode: 'numeric', min: '1', max: '20', value: item.targetSets,
  });
  const reps = el('input', { type: 'text', value: item.targetReps || '8-12', placeholder: t('plans.repsPlaceholder') });

  const swaps = suggestSwaps(ex, store.state.exercises);

  const body = el('div', {}, [
    el('label.field', {}, [el('span', { text: t('plans.targetSets') }), sets]),
    el('label.field', {}, [el('span', { text: t('plans.targetReps') }), reps]),
    el('button.btn.primary.full', {
      onclick: async () => {
        item.targetSets = Math.max(1, Math.min(20, Number(sets.value) || 3));
        item.targetReps = reps.value.trim() || '8-12';
        await store.savePlan(plan);
        closeSheet();
      },
    }, [t('common.save')]),
    swaps.length
      ? el('button.btn.ghost.full', {
          style: { marginTop: '10px' },
          onclick: () => swapSheet(ex, swaps, async (pick) => {
            item.exerciseId = pick.id;
            await store.savePlan(plan);
            toast(t('plans.swapped', { name: pick.name }));
          }),
        }, [t('plans.swapFor', { n: swaps.length })])
      : null,
    el('button.btn.full.danger', {
      style: { marginTop: '10px' },
      onclick: async () => {
        day.items = day.items.filter((i) => i !== item);
        await store.savePlan(plan);
        closeSheet();
        toast(t('plans.removed'));
      },
    }, [t('plans.removeFromDay')]),
  ]);

  openSheet(ex.name, body);
}

function dayMenu(plan, day, index) {
  const move = async (delta) => {
    const to = index + delta;
    if (to < 0 || to >= plan.days.length) return;
    const [d] = plan.days.splice(index, 1);
    plan.days.splice(to, 0, d);
    await store.savePlan(plan);
    closeSheet();
  };

  const name = el('input', { type: 'text', value: day.name });

  // Scheduling is optional: "Any day" keeps the least-recently-trained
  // suggestion the Train tab has always used, which is the better answer for
  // anyone training on feel rather than on a calendar.
  const weekday = el('select', {}, [
    el('option', { value: '', selected: !Number.isInteger(day.weekday) }, [t('plans.anyDay')]),
    ...WEEK_ORDER.map((n) =>
      el('option', { value: String(n), selected: day.weekday === n }, [weekdayName(n)])),
  ]);

  const body = el('div', {}, [
    el('label.field', {}, [el('span', { text: t('plans.dayName') }), name]),
    el('label.field', {}, [el('span', { text: t('plans.trainedOn') }), weekday]),
    el('div.small.faint', { style: { marginTop: '-8px', marginBottom: '12px' }, text: t('plans.anyDayNote') }),
    el('button.btn.primary.full', {
      onclick: async () => {
        day.name = name.value.trim() || day.name;
        day.weekday = weekday.value === '' ? null : Number(weekday.value);
        await store.savePlan(plan);
        closeSheet();
      },
    }, [t('common.save')]),
    el('div.stack', { style: { marginTop: '12px' } }, [
      el('button.btn.ghost.full', { disabled: index === 0, onclick: () => move(-1) }, [`↑ ${t('train.menu.up')}`]),
      el('button.btn.ghost.full', { disabled: index === plan.days.length - 1, onclick: () => move(1) }, [`↓ ${t('train.menu.down')}`]),
      el('button.btn.full.danger', {
        onclick: async () => {
          closeSheet();
          const ok = await confirmSheet(t('plans.deleteDayTitle'),
            t('plans.deleteDayBody', { day: day.name, plan: plan.name }));
          if (!ok) return;
          plan.days = plan.days.filter((d) => d !== day);
          await store.savePlan(plan);
        },
      }, [t('plans.deleteDay')]),
    ]),
  ]);

  openSheet(day.name, body);
}

/**
 * A plan as a link. No server involved: the whole plan rides inside the URL,
 * so there is nothing to host, nothing to sign up for, and nothing of yours
 * stored anywhere. It also means the link is exactly as private as whoever you
 * send it to.
 */
function shareSheet(plan) {
  const status = el('div.small.faint', { style: { marginTop: '10px' }, text: t('plans.buildingLink') });
  const body = el('div', {}, [
    el('div.small.muted', { text: t('plans.shareIntro') }),
    status,
  ]);
  openSheet(t('plans.shareTitle', { name: plan.name }), body);

  planLink(plan, store.state.exerciseById).then((url) => {
    const exCount = plan.days.reduce((n, d) => n + d.items.length, 0);
    status.replaceChildren();
    status.style.color = 'var(--text-faint)';

    const field = el('input', { type: 'text', value: url, readonly: 'readonly' });
    field.addEventListener('focus', () => field.select());

    body.append(
      el('label.field', { style: { marginTop: '4px' } }, [el('span', { text: t('plans.link') }), field]),
      el('div.small.faint', { style: { marginTop: '-8px', marginBottom: '14px' },
        text: t('plans.linkNote', { exercises: tn(exCount, 'unit.exercise'), chars: url.length }) }),
      el('div.stack', {}, [
        // navigator.share opens the iOS share sheet, which is the fastest path
        // into a chat. Not available everywhere, hence the copy fallback below.
        navigator.share
          ? el('button.btn.primary.full', {
              onclick: () => navigator.share({ title: plan.name, text: t('plans.shareText', { name: plan.name }), url })
                .catch(() => { /* user dismissed the sheet */ }),
            }, [t('plans.send')])
          : null,
        el('button.btn.ghost.full', {
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast(t('plans.linkCopied'));
            } catch {
              field.select();
              toast(t('plans.copyManually'));
            }
          },
        }, [t('plans.copyLink')]),
      ]),
      el('div.small.faint', { style: { marginTop: '14px' }, text: t('plans.shareMatching') })
    );
  }).catch((err) => {
    status.style.color = 'var(--warn)';
    status.textContent = t('plans.linkFailed', { message: err.message });
  });
}

function renamePlan(plan) {
  const input = el('input', { type: 'text', value: plan.name });
  const body = el('div', {}, [
    el('label.field', {}, [el('span', { text: t('plans.planName') }), input]),
    el('button.btn.primary.full', {
      onclick: async () => {
        plan.name = input.value.trim() || plan.name;
        await store.savePlan(plan);
        closeSheet();
      },
    }, [t('common.save')]),
  ]);
  openSheet(t('plans.renameTitle'), body);
}
