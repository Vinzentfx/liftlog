// Plans — multi-day workout templates, from presets or built by hand.

import {
  el, toast, openSheet, closeSheet, confirmSheet, emptyState, listItem, fmtWeight,
} from '../ui.js';
import * as store from '../store.js';
import { bestOneRepMaxByName } from '../models.js';
import { PLAN_BLUEPRINTS, SETS_PER_EXERCISE, REP_TARGET } from '../plan-builder.js';
import { analysePlan, starString } from '../plan-rating.js';
import { REGIONS } from '../standards.js';
import { scoreFor, tierIndex, tierOf, isBenchmark, hasProfile, toNextTier } from '../standards.js';
import { pickExercise } from '../pickers.js';
import { navigate } from '../app.js';

export default function renderPlans({ param, actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': 'Settings' }, ['⚙']));
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
        el('div', { style: { fontWeight: '680', marginBottom: '4px' }, text: 'Start from a preset' }),
        el('div.small.muted', { text: 'Pick a proven split — you can rename days and swap exercises afterwards.' }),
      ])
    );
  } else {
    root.append(el('div.section-head', { style: { marginTop: '4px' } }, [el('h2', { text: 'Your plans' })]));
    for (const p of plans) {
      const dayCount = p.days.length;
      const exCount = p.days.reduce((n, d) => n + d.items.length, 0);
      root.append(listItem({
        title: p.name + (p.id === activeId ? '  ★' : ''),
        sub: `${dayCount} ${dayCount === 1 ? 'day' : 'days'} · ${exCount} exercises${p.id === activeId ? ' · active' : ''}`,
        ariaLabel: `Open ${p.name}`,
        onclick: () => navigate('plans', p.id),
      }));
    }
  }

  root.append(el('div.section-head', {}, [el('h2', { text: 'Templates' })]));
  root.append(el('div.small.faint', { style: { marginBottom: '10px' },
    text: `Every exercise gets ${SETS_PER_EXERCISE} sets at ${REP_TARGET} reps — more movements, fewer sets each.` }));

  for (const bp of PLAN_BLUEPRINTS) {
    const slots = bp.days.reduce((n, d) => n + d.slots.reduce((m, [, c]) => m + c, 0), 0);
    root.append(
      el('button.list-item' + (bp.recommended ? '.glow' : ''), {
        'aria-label': `Create ${bp.name}`,
        onclick: () => blueprintSheet(bp),
      }, [
        el('div.grow', {}, [
          el('div.li-title', { text: bp.name + (bp.recommended ? '  ★' : '') }),
          el('div.li-sub', { text: `${bp.blurb} · ${slots} exercises, ${slots * SETS_PER_EXERCISE} sets/week` }),
        ]),
        el('span.chev', { text: '+', 'aria-hidden': 'true' }),
      ])
    );
  }

  root.append(
    el('button.btn.ghost.full', {
      style: { marginTop: '14px' },
      onclick: async () => {
        const plan = await store.savePlan({ name: 'My Plan', days: [] });
        navigate('plans', plan.id);
      },
    }, ['+ Build one from scratch'])
  );

  return root;
}

/** Two ways to take a template: filled in, or just the day structure. */
function blueprintSheet(bp) {
  const perDay = bp.days.map((d) => {
    const n = d.slots.reduce((m, [, c]) => m + c, 0);
    return `${d.name} — ${n} exercises`;
  });

  const body = el('div', {}, [
    el('div.small.muted', { text: bp.blurb }),
    el('div.card.tight', { style: { marginTop: '12px' } }, [
      el('div.small', { style: { fontWeight: '650', marginBottom: '6px' },
        text: `Target: ${REP_TARGET} reps · ${SETS_PER_EXERCISE} sets per exercise` }),
      ...perDay.map((t) => el('div.small.faint', { text: t })),
    ]),

    el('div.section-head', {}, [el('h2', { text: 'How do you want it?' })]),
    el('button.btn.primary.full', {
      onclick: async () => {
        closeSheet();
        const plan = await store.createPlanFromBlueprint(bp, { empty: false });
        toast(`${plan.name} created`);
        navigate('plans', plan.id);
      },
    }, ['Fill it in for me']),
    el('div.small.faint', { style: { margin: '6px 0 14px' },
      text: 'Picks exercises for each muscle slot — favourites first, then the best-rated movement for that muscle.' }),

    el('button.btn.ghost.full', {
      onclick: async () => {
        closeSheet();
        const plan = await store.createPlanFromBlueprint(bp, { empty: true });
        toast('Empty plan created');
        navigate('plans', plan.id);
      },
    }, ['Just the layout — I pick my own']),
    el('div.small.faint', { style: { marginTop: '6px' },
      text: 'Creates the days with the muscle targets shown, but no exercises. You add them yourself.' }),
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
    }, ['‹ Plans'])
  );

  if (!plan) {
    root.append(emptyState('Plan not found', 'It may have been deleted.'));
    return root;
  }

  const isActive = store.state.settings.activePlanId === plan.id;

  root.append(
    el('div.row.between', { style: { marginBottom: '14px' } }, [
      el('div.grow', {}, [
        el('div', { style: { fontSize: '21px', fontWeight: '740', letterSpacing: '-0.025em' }, text: plan.name }),
        el('div.small.faint', { text: `${plan.days.length} training days` }),
      ]),
      el('button.btn.sm.ghost', { onclick: () => renamePlan(plan) }, ['Rename']),
    ])
  );

  if (!isActive) {
    root.append(
      el('button.btn.primary.full', {
        style: { marginBottom: '14px' },
        onclick: async () => { await store.setSetting('activePlanId', plan.id); toast(`${plan.name} is now active`); },
      }, ['Make this my active plan'])
    );
  } else {
    root.append(el('div.card.tight.glow', { style: { marginBottom: '14px' } }, [
      el('div.small', { text: '★  Active plan — its days show up on the Train tab and drive your calendar.' }),
    ]));
  }

  root.append(qualityCard(plan));

  plan.days.forEach((day, i) => root.append(dayCard(plan, day, i)));

  root.append(
    el('button.btn.ghost.full', {
      style: { marginTop: '4px' },
      onclick: async () => {
        plan.days.push({ id: `d_${Date.now().toString(36)}`, name: `Day ${plan.days.length + 1}`, items: [] });
        await store.savePlan(plan);
      },
    }, ['+ Add a day'])
  );

  root.append(
    el('button.btn.full.danger', {
      style: { marginTop: '22px' },
      onclick: async () => {
        const ok = await confirmSheet('Delete plan?', `${plan.name} will be removed. Logged workouts are not affected.`);
        if (!ok) return;
        await store.deletePlan(plan.id);
        toast('Plan deleted');
        navigate('plans');
      },
    }, ['Delete plan'])
  );

  return root;
}

/** Star rating plus a plain-language breakdown of what works and what doesn't. */
function qualityCard(plan) {
  const a = analysePlan(plan, store.state.exerciseById);
  const card = el('div.card.glow', { style: { marginBottom: '14px' } });

  card.append(
    el('div.row.between', { style: { marginBottom: '4px' } }, [
      el('div.grow', {}, [
        el('div', { style: { fontSize: '22px', letterSpacing: '.06em', color: 'var(--t4)' },
          text: starString(a.stars) }),
        el('div.small.faint', {
          text: `${a.exerciseCount} exercises · ${a.totalSets} sets a week · max ${a.maxSetsPerExercise} sets per exercise`,
        }),
      ]),
      el('button.btn.sm.ghost', { onclick: () => breakdownSheet(plan, a) }, ['Details']),
    ])
  );

  if (!a.exerciseCount) {
    card.append(el('div.small.muted', { style: { marginTop: '8px' },
      text: 'Add exercises and this rates the plan on frequency, volume and coverage.' }));
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
      text: `+${a.good.length + a.missing.length - 4} more in Details` }));
  }

  return card;
}

function breakdownSheet(plan, a) {
  const label = (r) => REGIONS[r] || r;
  const rows = Object.entries(a.volume)
    .filter(([, v]) => v > 0)
    .sort((x, y) => y[1] - x[1]);
  const max = Math.max(...rows.map(([, v]) => v), 1);

  const part = (name, value) => el('div.bar-row', {}, [
    el('span.name', { text: name }),
    el('div.track', {}, [el('div.fill', { style: { width: `${Math.round(value * 100)}%` } })]),
    el('span.val', { text: `${Math.round(value * 100)}%` }),
  ]);

  const body = el('div', {}, [
    el('div', { style: { fontSize: '26px', letterSpacing: '.06em', color: 'var(--t4)', textAlign: 'center' },
      text: starString(a.stars) }),
    el('div.small.faint', { style: { textAlign: 'center', marginBottom: '14px' },
      text: 'Scored for muscle growth. These thresholds are a reasonable consensus, not settled science.' }),

    el('div.section-head', {}, [el('h2', { text: 'Score breakdown' })]),
    part('Frequency', a.parts.frequency),
    part('Volume', a.parts.volume),
    part('Spread', a.parts.spread),
    part('Coverage', a.parts.coverage),
    part('Recovery', a.parts.recovery),

    a.good.length ? el('div.section-head', {}, [el('h2', { text: 'What works' })]) : null,
    ...a.good.map((t) => el('div.small', { style: { marginBottom: '7px', color: 'var(--good)' }, text: `✓  ${t}` })),

    a.missing.length ? el('div.section-head', {}, [el('h2', { text: 'What to fix' })]) : null,
    ...a.missing.map((t) => el('div.small', { style: { marginBottom: '7px', color: 'var(--warn)' }, text: `!  ${t}` })),

    el('div.section-head', {}, [el('h2', { text: 'Weekly sets per muscle' })]),
    el('div.small.faint', { style: { marginBottom: '10px' },
      text: 'Target 10–20. Secondary muscles count as half a set.' }),
    ...rows.map(([r, v]) => el('div.bar-row', {}, [
      el('span.name', { text: label(r) }),
      el('div.track', {}, [el('div.fill', {
        style: {
          width: `${Math.max(3, (v / max) * 100)}%`,
          background: v < 10 ? 'var(--t0)' : v > 26 ? 'var(--danger)' : 'linear-gradient(90deg, var(--accent), var(--accent-hi))',
        },
      })]),
      el('span.val', { text: String(Math.round(v)) }),
    ])),
  ]);

  openSheet(`${plan.name} — rating`, body);
}

function dayCard(plan, day, index) {
  const card = el('div.card');

  card.append(
    el('div.row.between', { style: { marginBottom: '10px' } }, [
      el('div.grow', {}, [
        el('div', { style: { fontWeight: '680', fontSize: '16px' }, text: day.name }),
        el('div.small.faint', { text: `${day.items.length} exercises` }),
      ]),
      el('button.btn.sm.primary', {
        onclick: async () => {
          await store.startSession({ planId: plan.id, dayId: day.id });
          toast(`Started ${day.name}`);
          navigate('train');
        },
      }, ['Start']),
      el('button.btn.quiet.sm', {
        'aria-label': `Options for ${day.name}`,
        onclick: () => dayMenu(plan, day, index),
      }, ['···']),
    ])
  );

  if (!day.items.length) {
    card.append(el('div.small.faint', { style: { padding: '6px 0' }, text: 'No exercises yet.' }));
  }

  for (const item of day.items) {
    card.append(exerciseRow(plan, day, item));
  }

  card.append(
    el('button.btn.ghost.full.sm', {
      style: { marginTop: '8px' },
      onclick: () => pickExercise(async (ex) => {
        day.items.push({ exerciseId: ex.id, targetSets: 3, targetReps: '8-12', note: '' });
        await store.savePlan(plan);
        toast(`Added ${ex.name}`);
      }, day.items.map((i) => i.exerciseId)),
    }, ['+ Add exercise'])
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
          el('span.tier-chip', { text: tierOf(score).label }),
          next
            ? el('div.small.faint', { style: { marginTop: '3px' },
                text: `${fmtWeight(Math.round(next.weight), settings.units)} → ${next.tier.label}` })
            : null,
        ]);
      }
    }
  }

  return el('div.row.between', {
    style: { padding: '9px 0', borderTop: '1px solid var(--line-soft)', gap: '10px' },
  }, [
    el('div.grow', {}, [
      el('div', { style: { fontWeight: '600', fontSize: '14.5px' }, text: ex.name }),
      el('div.small.faint', { text: `${item.targetSets} × ${item.targetReps || '8-12'} · ${ex.muscle}` }),
    ]),
    chip,
    el('button.btn.quiet.sm', {
      'aria-label': `Edit ${ex.name}`,
      onclick: () => itemMenu(plan, day, item, ex),
    }, ['···']),
  ]);
}

/* ============================ menus ============================ */

function itemMenu(plan, day, item, ex) {
  const sets = el('input', {
    type: 'number', inputmode: 'numeric', min: '1', max: '20', value: item.targetSets,
  });
  const reps = el('input', { type: 'text', value: item.targetReps || '8-12', placeholder: 'e.g. 8-12' });

  const body = el('div', {}, [
    el('label.field', {}, [el('span', { text: 'Target sets' }), sets]),
    el('label.field', {}, [el('span', { text: 'Target reps' }), reps]),
    el('button.btn.primary.full', {
      onclick: async () => {
        item.targetSets = Math.max(1, Math.min(20, Number(sets.value) || 3));
        item.targetReps = reps.value.trim() || '8-12';
        await store.savePlan(plan);
        closeSheet();
      },
    }, ['Save']),
    el('button.btn.full.danger', {
      style: { marginTop: '10px' },
      onclick: async () => {
        day.items = day.items.filter((i) => i !== item);
        await store.savePlan(plan);
        closeSheet();
        toast('Removed');
      },
    }, ['Remove from day']),
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

  const body = el('div', {}, [
    el('label.field', {}, [el('span', { text: 'Day name' }), name]),
    el('button.btn.primary.full', {
      onclick: async () => {
        day.name = name.value.trim() || day.name;
        await store.savePlan(plan);
        closeSheet();
      },
    }, ['Save name']),
    el('div.stack', { style: { marginTop: '12px' } }, [
      el('button.btn.ghost.full', { disabled: index === 0, onclick: () => move(-1) }, ['↑ Move up']),
      el('button.btn.ghost.full', { disabled: index === plan.days.length - 1, onclick: () => move(1) }, ['↓ Move down']),
      el('button.btn.full.danger', {
        onclick: async () => {
          closeSheet();
          const ok = await confirmSheet('Delete day?', `${day.name} and its exercises will be removed from ${plan.name}.`);
          if (!ok) return;
          plan.days = plan.days.filter((d) => d !== day);
          await store.savePlan(plan);
        },
      }, ['Delete day']),
    ]),
  ]);

  openSheet(day.name, body);
}

function renamePlan(plan) {
  const input = el('input', { type: 'text', value: plan.name });
  const body = el('div', {}, [
    el('label.field', {}, [el('span', { text: 'Plan name' }), input]),
    el('button.btn.primary.full', {
      onclick: async () => {
        plan.name = input.value.trim() || plan.name;
        await store.savePlan(plan);
        closeSheet();
      },
    }, ['Save']),
  ]);
  openSheet('Rename plan', body);
}
