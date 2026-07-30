// Nutrition — today's log, your own food list, and the protein target.
//
// Still built around a list you write yourself: 95% of what anyone eats is the
// same thirty things, and typing those in once beats fighting a catalogue of
// three million products forever. The barcode lookup fills the same fields
// rather than replacing that idea.
//
// Protein and calories carry the claims; carbs, fat, fibre and water are
// recorded and shown without one. Anything not filled in stays *unknown* rather
// than becoming zero, which is why the energy split can refuse to draw itself.

import {
  el, toast, openSheet, closeSheet, confirmSheet, emptyState, listItem, fmtNum, fmtWeight, fmtDate,
  numberInput, parseNumber, normaliseOnBlur, plural,
} from '../ui.js';
import * as store from '../store.js';
import { dayKey, MEAL_SLOTS, slotFor } from '../models.js';
import {
  proteinTarget, dayTotals, proteinVerdict, proteinHistory,
  weightTrend, trendVerdict, energySplit, fibreTarget, waterTarget, maintenanceEstimate,
  NUTRIENTS, macroTargets, GOALS,
} from '../nutrition.js';
import {
  searchFoods, toFoodFields, coverage, TOTAL_SIZE,
  LIBRARY_ATTRIBUTION, BRAND_ATTRIBUTION,
} from '../foodsearch.js';
import { THRESHOLDS, SOURCES } from '../evidence.js';
import { lookupBarcode, scaleToPortion, ATTRIBUTION } from '../foodlookup.js';
import { barChart } from '../charts.js';
import { navigate } from '../app.js';

let viewDay = null;      // null = today; set by the date stepper
let trendMetric = 'protein';   // which metric the 14-day chart shows

/** The target band for a metric, or null where there is none to compare against. */
function bandFor(key, targets) {
  if (!targets || !targets.ok) return null;
  if (key === 'kcal') return { low: targets.kcal, high: targets.kcal };
  return targets[key] || null;
}

export default function renderNutrition({ actions }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': 'Settings' }, ['⚙']));

  const root = el('div');
  const day = viewDay || dayKey();
  const isToday = day === dayKey();
  const meals = store.mealsOn(day);
  const totals = dayTotals(meals);
  const target = proteinTarget(store.state.settings);

  root.append(dayHeader(day, isToday));
  root.append(targetCard(totals, target));
  root.append(targetsSection(totals));
  root.append(macroCard(totals));
  root.append(waterCard(day));
  root.append(mealList(meals, day));
  root.append(savedMeals(day));
  root.append(quickAdd(day));
  root.append(trendSection());

  return root;
}

/* ======================= targets ======================= */

/**
 * What to aim for, and how much of it is left today.
 *
 * The order matters and is stated on the card, because it is the whole reason
 * these numbers are allowed to exist: energy sets the direction, protein has
 * its own band, fat has a floor, and carbohydrate is the remainder. Nothing
 * here is a ratio — the carb figure is arithmetic on the user's own calorie
 * target, which is itself measured rather than predicted.
 */
function targetsSection(totals) {
  const wrap = el('div');
  const maintenance = maintenanceEstimate(store.state.meals, store.state.bodyweight);
  const targets = macroTargets(store.state.settings, maintenance);

  wrap.append(el('div.section-head', {}, [
    el('h2', { text: 'Targets' }),
    el('button.btn.quiet.sm', { onclick: () => targetsSheet(targets) }, ['How these are set']),
  ]));

  if (!targets.ok) {
    wrap.append(el('div.card', {}, [
      el('div.small.muted', {
        text: targets.protein
          ? `Protein is ${targets.protein.low}–${targets.protein.high} g, straight from your bodyweight. Calories, carbs and fat all hang off your maintenance figure, and that needs a few weeks of logging before it means anything — the Maintenance card below says what is still missing.`
          : 'Add your bodyweight in Settings and the protein band appears. Everything else waits on the maintenance estimate further down.',
      }),
    ]));
    return wrap;
  }

  wrap.append(goalPicker(targets));

  const rows = [
    ['Calories', `${fmtNum(targets.kcal)} kcal`, totals.kcal, targets.kcal, targets.kcal, 'var(--text)'],
    ['Protein', `${targets.protein.low}–${targets.protein.high} g`, totals.protein, targets.protein.low, targets.protein.high, 'var(--accent-hi)'],
    ['Carbs', `${targets.carbs.low}–${targets.carbs.high} g`, totals.carbs, targets.carbs.low, targets.carbs.high, '#22D3EE'],
    ['Fat', `${targets.fat.low}–${targets.fat.high} g`, totals.fat, targets.fat.low, targets.fat.high, '#C084FC'],
  ];

  const card = el('div.card', {});
  for (const [label, band, eaten, low, high, colour] of rows) {
    const pct = high > 0 ? Math.min(1, eaten / high) : 0;
    const inRange = eaten >= low && eaten <= high * 1.05;
    card.append(
      el('div', { style: { marginBottom: '12px' } }, [
        el('div.row.between', { style: { alignItems: 'baseline' } }, [
          el('span', { style: { fontSize: '13.5px', fontWeight: '640' }, text: label }),
          el('span.small', {
            style: { color: inRange ? 'var(--good)' : 'var(--text-dim)' },
            text: `${fmtNum(eaten)} of ${band}`,
          }),
        ]),
        el('div.track-thin', {}, [
          el('i', { style: { width: `${Math.max(2, pct * 100)}%`, background: colour } }),
        ]),
      ])
    );
  }

  card.append(el('div.small.faint', { style: { marginTop: '-4px' },
    text: 'Carbs are the energy left after protein and fat, not a target of their own. Inside the fat range nothing distinguishes one point from another — hit the floor and spend the rest wherever you like.' }));

  wrap.append(card);
  return wrap;
}

function goalPicker(targets) {
  const seg = el('div.seg', { style: { marginBottom: '10px' } }, GOALS.map((g) =>
    el('button', {
      'aria-pressed': String(targets.goal === g.key),
      onclick: async (e) => {
        [...e.target.parentElement.children].forEach((b, i) =>
          b.setAttribute('aria-pressed', String(GOALS[i].key === g.key)));
        await store.setSetting('goal', g.key);
      },
    }, [g.label])
  ));

  const goal = GOALS.find((g) => g.key === targets.goal);
  return el('div', {}, [
    seg,
    el('div.small.faint', { style: { marginBottom: '10px' },
      text: targets.offset === 0
        ? `Holding at ${fmtNum(targets.maintenance)} kcal, your measured maintenance — ${goal.blurb}.`
        : `${targets.offset > 0 ? '+' : ''}${fmtNum(targets.offset)} kcal on your measured maintenance of ${fmtNum(targets.maintenance)} — about ${Math.abs(targets.kgPerWeek)} kg a week, ${goal.blurb}.` }),
  ]);
}

function targetsSheet(targets) {
  const fat = SOURCES.efsaFat;
  const protein = SOURCES.protein2018;

  openSheet('How the targets are set', el('div', {}, [
    el('div.small.muted', {
      text: 'In the order that actually decides them. There is no evidence-based macro ratio — "40/30/30" is folklore with a decimal point — but there is an evidence-based order, and this is it.',
    }),

    el('div.section-head', {}, [el('h2', { text: '1 · Calories' })]),
    el('div.small.muted', {
      text: targets.ok
        ? `Your measured maintenance, ${fmtNum(targets.maintenance)} kcal, plus or minus the pace you picked. The pace — a quarter to a half percent of bodyweight a week — is training-practice convention rather than a trial result, and slow enough that a gain stays mostly muscle and a cut mostly does not cost any.`
        : 'Your measured maintenance, plus or minus the pace you pick. It is derived from your own logging and your own scale, not from a formula.',
    }),

    el('div.section-head', {}, [el('h2', { text: '2 · Protein' })]),
    el('div.small.muted', { text: protein.says }),

    el('div.section-head', {}, [el('h2', { text: '3 · Fat' })]),
    el('div.small.muted', { text: fat.says }),
    el('a', {
      href: fat.url, target: '_blank', rel: 'noopener',
      style: { color: 'var(--accent-hi)', fontWeight: '620', fontSize: '14px' },
      text: `${fat.short} ↗`,
    }),

    el('div.section-head', {}, [el('h2', { text: '4 · Carbohydrate' })]),
    el('div.small.muted', {
      text: 'Whatever energy is left. Not a target in its own right, and deliberately not given one — no carbohydrate intake has been shown to build more muscle than another once calories and protein are equal. The range you see is simply what fits between the fat floor and the fat ceiling.',
    }),

    el('div.section-head', {}, [el('h2', { text: 'What this cannot do' })]),
    el('div.small.muted', {
      text: 'It inherits every weakness of the maintenance estimate, under-logging first among them. Treat the calorie figure as a starting point and let the scale correct it over a few weeks — that feedback loop is worth more than any calculator.',
    }),
  ]));
}

/* ======================= macros ======================= */

/**
 * Where the day's energy came from.
 *
 * Shown as a split, never as a target. No macro ratio has an evidence base
 * worth printing — protein has one, and past that "40/30/30" is folklore with a
 * decimal point. So this reports what was eaten and says nothing about what
 * should have been.
 */
function macroCard(totals) {
  const wrap = el('div');
  if (!totals.items) return wrap;

  const split = energySplit(totals);
  const card = el('div.card', {});

  card.append(el('div.row.between', {}, [
    el('div.small', { style: { fontWeight: '650' }, text: 'Where the energy came from' }),
    split ? el('span.small.faint', { text: `${fmtNum(split.fromMacros)} kcal` }) : null,
  ]));

  if (!split) {
    // The honest failure: with carbs or fat unrecorded on some items, any bar
    // drawn here would be a picture of the logging rather than the eating.
    const gaps = [];
    if (totals.missing.carbs) gaps.push(`${totals.missing.carbs} without carbs`);
    if (totals.missing.fat) gaps.push(`${totals.missing.fat} without fat`);
    card.append(el('div.small.muted', { style: { marginTop: '8px' },
      text: gaps.length
        ? `No split yet — of ${plural(totals.items, 'item')} logged, ${gaps.join(' and ')}. Fill those in on the food and this fills in with them.`
        : 'No split yet — nothing logged carries carbohydrate or fat values.' }));
    return wrap.append(card), wrap;
  }

  card.append(
    el('div.macro-bar', {}, [
      el('i.p', { style: { width: `${split.share.protein * 100}%` } }),
      el('i.c', { style: { width: `${split.share.carbs * 100}%` } }),
      el('i.f', { style: { width: `${split.share.fat * 100}%` } }),
    ]),
    el('div.macro-key', {}, [
      macroKey('var(--accent-hi)', 'Protein', totals.protein, split.share.protein),
      macroKey('#22D3EE', 'Carbs', totals.carbs, split.share.carbs),
      macroKey('#C084FC', 'Fat', totals.fat, split.share.fat),
    ])
  );

  if (totals.fibre || !totals.missing.fibre) {
    const target = fibreTarget();
    card.append(el('div.small.faint', { style: { marginTop: '10px' },
      text: `${totals.fibre} g fibre${totals.missing.fibre ? ` (${totals.missing.fibre} item${totals.missing.fibre === 1 ? '' : 's'} without a value)` : ''} · ${target} g is the general-health reference, not a training number.` }));
  }

  wrap.append(card);
  return wrap;
}

function macroKey(colour, label, grams, share) {
  return el('div', {}, [
    el('b', { style: { background: colour } }),
    el('span.v', { text: `${grams} g` }),
    el('span.k', { text: `${label} · ${Math.round(share * 100)}%` }),
  ]);
}

/* ======================= water ======================= */

/**
 * Water as glasses, because nobody thinks in millilitres.
 *
 * The reference line is an adequate intake, not a goal to beat: requirements
 * move with heat, training and bodyweight, and thirst covers the difference for
 * most people. So the row fills up and then stops mattering — there is no
 * "over" state and nothing turns red.
 */
function waterCard(day) {
  const GLASS = 250;
  const ml = store.waterOn(day);
  const target = waterTarget(store.state.settings);
  const glasses = Math.round(ml / GLASS);
  const targetGlasses = Math.round(target / GLASS);

  const card = el('div.card', {}, [
    el('div.row.between', { style: { alignItems: 'baseline' } }, [
      el('div', {}, [
        el('span', { style: { fontSize: '20px', fontWeight: '740' }, text: `${(ml / 1000).toFixed(1)} L` }),
        el('span.small.faint', { text: `  of about ${(target / 1000).toFixed(1)} L` }),
      ]),
      el('div.row', { style: { gap: '6px' } }, [
        el('button.btn.quiet.sm', { 'aria-label': 'Remove a glass', onclick: () => store.addWater(-GLASS, day) }, ['−']),
        el('button.btn.ghost.sm', { onclick: () => store.addWater(GLASS, day) }, ['+ Glass']),
      ]),
    ]),
    el('div.glass-row', {},
      Array.from({ length: Math.max(targetGlasses, glasses) }, (_, i) =>
        el(`div.glass${i < glasses ? '.full' : ''}`, { 'aria-hidden': 'true' }))),
    el('div.small.faint', { style: { marginTop: '10px' },
      text: 'A glass is 250 ml. The line is an adequate intake for an average day, not a target to beat — heat, training and your size all move it, and thirst covers most of the difference.' }),
  ]);

  return el('div', {}, [
    el('div.section-head', {}, [el('h2', { text: 'Water' })]),
    card,
  ]);
}

/* ======================= day navigation ======================= */

function dayHeader(day, isToday) {
  const step = (delta) => {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() + delta);
    const next = dayKey(d.getTime());
    // No logging into the future — an empty tomorrow is not information.
    if (next > dayKey()) return;
    viewDay = next === dayKey() ? null : next;
    navigate('nutrition');
  };

  return el('div.row.between', { style: { marginBottom: '14px' } }, [
    el('button.icon-btn', { 'aria-label': 'Previous day', onclick: () => step(-1) }, ['‹']),
    el('div', { style: { textAlign: 'center' } }, [
      el('div', { style: { fontWeight: '700', fontSize: '17px' },
        text: isToday ? 'Today' : fmtDate(new Date(`${day}T12:00:00`).getTime(), { weekday: 'short' }) }),
      el('div.small.faint', { text: day }),
    ]),
    el('button.icon-btn', {
      'aria-label': 'Next day',
      style: isToday ? { opacity: '.3' } : {},
      onclick: () => step(1),
    }, ['›']),
  ]);
}

/* ======================= target ======================= */

/**
 * The day at a glance: energy first, then the three macros under it.
 *
 * Calories lead because that is the number that decides which direction you are
 * going. Protein keeps its band underneath, because it is the only one of the
 * three with a target worth showing — carbs and fat are reported, not judged.
 */
function targetCard(totals, target) {
  const verdict = proteinVerdict(totals.protein, target);
  const tone = { hit: 'var(--good)', over: 'var(--text-dim)', under: 'var(--warn)', unknown: 'var(--text-faint)' }[verdict.state];
  const maintenance = maintenanceEstimate(store.state.meals, store.state.bodyweight);

  const card = el('div.card.glow', {}, [
    el('div', { style: { fontSize: '40px', fontWeight: '760', letterSpacing: '-0.035em', lineHeight: '1' },
      text: fmtNum(totals.kcal) }),
    el('div.small.faint', { style: { marginTop: '3px' },
      text: maintenance.ok
        ? `kcal today · maintenance is around ${fmtNum(maintenance.maintenance)}`
        : 'kcal today' }),

    el('div.row', { style: { gap: '8px', marginTop: '14px' } }, [
      macroPill('Protein', totals.protein, 'var(--accent-hi)'),
      macroPill('Carbs', totals.carbs, '#22D3EE', totals.missing.carbs),
      macroPill('Fat', totals.fat, '#C084FC', totals.missing.fat),
    ]),
  ]);

  if (target) {
    // The bar fills to the bottom of the band; the band itself is what matters,
    // so the top edge is marked rather than treated as a finish line.
    const pct = Math.min(1, totals.protein / target.low);
    card.append(
      el('div.track-thin', { style: { marginTop: '12px' } }, [
        el('i', {
          style: {
            width: `${Math.max(2, pct * 100)}%`,
            background: verdict.state === 'under'
              ? 'linear-gradient(90deg, var(--accent), var(--accent-hi))'
              : 'linear-gradient(90deg, var(--good), #6EE7B7)',
          },
        }),
      ])
    );
  }

  card.append(el('div.small', { style: { marginTop: '10px', color: tone }, text: verdict.text }));

  card.append(
    el('div.row', { style: { gap: '4px', marginTop: '2px' } }, [
      el('button.btn.quiet.sm', { style: { padding: '4px 0' }, onclick: targetSheet }, ['Where the target comes from']),
      el('button.btn.quiet.sm', { style: { padding: '4px 0', marginLeft: 'auto' },
        onclick: () => detailSheet(totals) }, ['More ›']),
    ])
  );

  return card;
}

function macroPill(label, grams, colour, missing = 0) {
  return el('div.grow', {
    style: {
      background: 'var(--bg-sunken)', borderRadius: 'var(--r-sm)',
      padding: '9px 10px', borderTop: `2px solid ${colour}`,
    },
  }, [
    el('div', { style: { fontSize: '17px', fontWeight: '720' }, text: `${grams} g` }),
    el('div.small.faint', { style: { fontSize: '10.5px' },
      text: missing ? `${label} · ${missing} unknown` : label }),
  ]);
}

/**
 * Everything the day's log actually knows.
 *
 * Micronutrients are here rather than on the main screen because their coverage
 * is thin and uneven: they come from the bundled USDA library and from whatever
 * a barcode record happened to carry, so a day is nearly always part-known. Each
 * row therefore says how many of the day's items had no value, and a row where
 * nothing did says so instead of printing a confident zero.
 */
function detailSheet(totals) {
  const rows = NUTRIENTS.map((n) => {
    const cell = totals.all[n.key];
    return el('div.row.between', {
      style: {
        padding: '9px 0', borderBottom: '1px solid var(--line-soft)',
        paddingLeft: n.sub ? '14px' : '0',
      },
    }, [
      el('span.grow', {
        style: { fontSize: n.sub ? '13px' : '14px', color: n.sub ? 'var(--text-dim)' : 'var(--text)' },
        text: n.label,
      }),
      cell.known
        ? el('div', { style: { textAlign: 'right' } }, [
            el('div', { style: { fontWeight: '680', fontSize: '14px' },
              text: `${fmtNum(cell.value, cell.value < 10 && n.unit !== 'kcal' ? 1 : 0)} ${n.unit}` }),
            cell.missing
              ? el('div.small.faint', { style: { fontSize: '10.5px' },
                  text: `${cell.missing} of ${totals.items} unknown` })
              : null,
          ])
        : el('span.small.faint', { text: 'not recorded' }),
    ]);
  });

  openSheet('Everything logged today', el('div', {}, [
    el('div.small.muted', { style: { marginBottom: '10px' },
      text: `${plural(totals.items, 'item')} logged. A value counts only the items that carry it — anything else is listed as unknown rather than added in as zero.` }),
    ...rows,
    el('div.section-head', {}, [el('h2', { text: 'Where the numbers come from' })]),
    el('div.small.muted', { text: LIBRARY_ATTRIBUTION }),
    el('div.small.faint', { style: { marginTop: '8px' },
      text: 'Foods you typed in yourself only carry what you entered, and a barcode record only carries what the manufacturer submitted — which for micronutrients is usually nothing. That is why most of this list stays empty until you build meals from the library.' }),
  ]));
}

function targetSheet() {
  const target = proteinTarget(store.state.settings);
  const { low, high } = THRESHOLDS.proteinPerKg;
  const s = SOURCES.protein2018;

  openSheet('Protein target', el('div', {}, [
    target
      ? el('div.card.tight', {}, [
          el('div', { style: { fontSize: '20px', fontWeight: '720' }, text: `${target.low}–${target.high} g per day` }),
          el('div.small.faint', { text: `${low}–${high} g per kg of bodyweight` }),
        ])
      : el('div.small.muted', { text: 'Add your bodyweight in Settings and this becomes a number.' }),

    el('div.section-head', {}, [el('h2', { text: 'Why a range' })]),
    el('div.small.muted', { text: s.says }),

    el('div.section-head', {}, [el('h2', { text: 'What this does not track' })]),
    el('div.small.muted', {
      text: 'Only protein and calories. No micronutrients, no macro splits, no meal timing. Protein is the intake variable with a defensible number attached for muscle growth, and calories decide whether you gain or lose — the rest would be numbers for their own sake. Timing in particular: total daily intake matters far more than when you eat it, and the "anabolic window" is largely debunked.',
    }),

    el('div.section-head', {}, [el('h2', { text: 'Source' })]),
    el('a', {
      href: s.url, target: '_blank', rel: 'noopener',
      style: { color: 'var(--accent-hi)', fontWeight: '620', fontSize: '14px' },
      text: `${s.short} ↗`,
    }),
    el('div.small.faint', { style: { marginTop: '2px' }, text: s.note }),
  ]));
}

/* ======================= today's meals ======================= */

const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };

function mealList(meals, day) {
  const wrap = el('div');

  const yesterday = previousDay(day);
  const canRepeat = store.mealsOn(yesterday).length > 0;

  wrap.append(el('div.section-head', {}, [
    el('h2', { text: 'Logged' }),
    // Most days repeat most of the day before. One tap beats fifteen.
    canRepeat && !meals.length
      ? el('button.btn.quiet.sm', {
          onclick: async () => {
            const n = await store.copyDay(yesterday, day);
            toast(`Copied ${plural(n, 'item')} from yesterday`);
          },
        }, ['Repeat yesterday'])
      : null,
  ]));

  if (!meals.length) {
    wrap.append(el('div.card', {}, [
      el('div.small.muted', {
        text: canRepeat
          ? 'Nothing logged for this day yet. Repeat yesterday above, pick from your list below, or add something new.'
          : 'Nothing logged for this day yet. Pick something from your list below, or add a new food.',
      }),
    ]));
    return wrap;
  }

  // Grouped by time of day purely so a long list reads as a day rather than a
  // heap. Nothing in the app scores meal timing — see slotFor in models.js.
  for (const slot of MEAL_SLOTS) {
    const inSlot = meals.filter((m) => (m.slot || slotFor(m.at)) === slot);
    if (!inSlot.length) continue;

    const slotProtein = Math.round(inSlot.reduce((n, m) => n + (Number(m.protein) || 0), 0));
    const slotKcal = Math.round(inSlot.reduce((n, m) => n + (Number(m.kcal) || 0), 0));

    wrap.append(el('div.slot-head', {}, [
      el('span', { text: SLOT_LABEL[slot] }),
      el('div.row', { style: { gap: '10px', alignItems: 'baseline' } }, [
        el('span', { text: `${slotProtein} g${slotKcal ? ` · ${fmtNum(slotKcal)} kcal` : ''}` }),
        // The cheapest place to create a saved meal is the moment you have just
        // logged one — no separate builder screen to go and find.
        inSlot.length > 1
          ? el('button.btn.quiet.sm', {
              style: { padding: '0 4px', minHeight: '22px', fontSize: '11px' },
              onclick: () => saveMealSheet(inSlot, slot),
            }, ['Save'])
          : null,
      ]),
    ]));

    for (const m of inSlot) wrap.append(mealRow(m));
  }

  return wrap;
}

function mealRow(m) {
  const detail = [m.portion];
  if (m.kcal) detail.push(`${Math.round(m.kcal)} kcal`);
  if (m.carbs !== null && m.carbs !== undefined) detail.push(`${Math.round(m.carbs)} C`);
  if (m.fat !== null && m.fat !== undefined) detail.push(`${Math.round(m.fat)} F`);

  return el('div.meal-row', {}, [
    el('button.grow', {
      style: { background: 'none', border: 0, textAlign: 'left', padding: '0' },
      'aria-label': `Edit ${m.name}`,
      onclick: () => mealSheet(m),
    }, [
      el('div', { style: { fontWeight: '600', fontSize: '14.5px' },
        text: m.amount === 1 ? m.name : `${m.amount}× ${m.name}` }),
      el('div.small.faint', { text: detail.join(' · ') }),
    ]),
    el('div', { style: { fontWeight: '680', fontSize: '15px', whiteSpace: 'nowrap' },
      text: `${Math.round(m.protein)} g` }),
    el('button.btn.quiet.sm', {
      'aria-label': `Remove ${m.name}`,
      onclick: async () => { await store.deleteMeal(m.id); toast('Removed'); },
    }, ['×']),
  ]);
}

/** Change how much of something you had, or which part of the day it belongs to. */
function mealSheet(m) {
  const amount = normaliseOnBlur(numberInput({ decimal: true, value: m.amount }));

  const slots = el('div.seg', {}, MEAL_SLOTS.map((slot) =>
    el('button', {
      'aria-pressed': String((m.slot || slotFor(m.at)) === slot),
      onclick: async (e) => {
        [...e.target.parentElement.children].forEach((b, i) =>
          b.setAttribute('aria-pressed', String(MEAL_SLOTS[i] === slot)));
        await store.updateMeal(m.id, { slot });
      },
    }, [SLOT_LABEL[slot]])
  ));

  openSheet(m.name, el('div', {}, [
    el('div.small.faint', { style: { marginBottom: '14px' },
      text: `${m.portion} · ${Math.round(m.protein)} g protein${m.kcal ? ` · ${Math.round(m.kcal)} kcal` : ''} as logged` }),
    el('label.field', {}, [el('span', { text: 'Portions' }), amount]),
    el('button.btn.primary.full', {
      onclick: async () => {
        const n = parseNumber(amount.value);
        if (n === null || n <= 0) { toast('How many portions?'); amount.focus(); return; }
        await store.updateMeal(m.id, { amount: n });
        closeSheet();
        toast('Updated');
      },
    }, ['Save portions']),
    el('div.section-head', {}, [el('h2', { text: 'Part of the day' })]),
    slots,
    el('div.small.faint', { style: { marginTop: '8px' },
      text: 'Grouping only. Total intake over the day is what matters — nothing here scores when you ate.' }),
  ]));
}

/**
 * Turn what is already logged into a reusable meal.
 *
 * Offered from the slot header because that is the moment it costs nothing: you
 * have just built the thing, and naming it is one field. A separate builder
 * screen would be a place nobody goes.
 *
 * Only the items that still resolve to a food can be saved — a portion logged
 * from a food since deleted carries its own snapshot in history, but there is
 * nothing left to re-log it from.
 */
function saveMealSheet(meals, slot) {
  const resolvable = meals.filter((m) => store.state.foods.some((f) => f.id === m.foodId));
  const orphans = meals.length - resolvable.length;

  const name = el('input', {
    type: 'text',
    placeholder: 'e.g. Usual breakfast',
    value: meals.map((m) => m.name).slice(0, 2).join(' + '),
  });

  openSheet('Save as a meal', el('div', {}, [
    el('div.small.muted', { style: { marginBottom: '14px' },
      text: `${plural(resolvable.length, 'item')} from this ${SLOT_LABEL[slot].toLowerCase().replace(/s$/, '')}. Saved meals store the foods, not the numbers — correct a food later and this follows.` }),
    el('label.field', {}, [el('span', { text: 'Name' }), name]),
    ...resolvable.map((m) => el('div.small.faint', { style: { marginBottom: '4px' },
      text: `${m.amount === 1 ? '' : `${m.amount}× `}${m.name} · ${m.portion}` })),
    orphans
      ? el('div.small', { style: { color: 'var(--warn)', marginTop: '10px' },
          text: `${plural(orphans, 'item')} cannot be saved — the food behind it was deleted. It stays in this day's history either way.` })
      : null,
    el('button.btn.primary.full', {
      style: { marginTop: '14px' },
      onclick: async () => {
        if (!resolvable.length) { toast('Nothing here can be saved'); return; }
        const saved = await store.saveTemplate({
          name: name.value,
          slot,
          items: resolvable.map((m) => ({ foodId: m.foodId, amount: m.amount })),
        });
        closeSheet();
        toast(`Saved “${saved.name}”`);
      },
    }, ['Save this meal']),
  ]));
}

/** Saved meals, one tap each. */
function savedMeals(day) {
  const wrap = el('div');
  const templates = store.state.templates;
  if (!templates.length) return wrap;

  wrap.append(el('div.section-head', {}, [
    el('h2', { text: 'Saved meals' }),
    el('span.small.faint', { text: plural(templates.length, 'meal') }),
  ]));

  for (const t of templates.slice(0, 8)) {
    // Totals are computed from the foods now, not from when it was saved — the
    // whole point of storing references rather than values.
    const items = t.items
      .map((i) => ({ food: store.state.foods.find((f) => f.id === i.foodId), amount: i.amount }))
      .filter((x) => x.food);
    const kcal = Math.round(items.reduce((n, x) => n + (x.food.kcal || 0) * x.amount, 0));
    const protein = Math.round(items.reduce((n, x) => n + (x.food.protein || 0) * x.amount, 0));
    const gone = t.items.length - items.length;

    wrap.append(listItem({
      title: t.name,
      sub: items.length
        ? `${plural(items.length, 'item')} · ${protein} g protein${kcal ? ` · ${kcal} kcal` : ''}${gone ? ` · ${gone} missing` : ''}`
        : 'Every food in this meal has been deleted',
      right: el('span.small.faint', { text: '+' }),
      chev: '',
      ariaLabel: `Log ${t.name}`,
      onclick: async () => {
        if (!items.length) { toast('Nothing left to log'); return; }
        const res = await store.logTemplate(t.id, { day });
        toast(res.missing
          ? `${res.name}: ${plural(res.logged, 'item')} logged, ${res.missing} missing`
          : `${res.name} logged`);
      },
    }));
  }

  wrap.append(
    el('button.btn.ghost.full.sm', { style: { marginTop: '8px' }, onclick: manageMealsSheet },
      ['Edit saved meals'])
  );
  return wrap;
}

function manageMealsSheet() {
  const body = el('div', {}, [
    el('div.small.muted', { style: { marginBottom: '12px' },
      text: 'Saved meals hold food references, so editing a food updates every meal that uses it. Deleting one here never touches anything already logged.' }),
    ...store.state.templates.map((t) =>
      el('div.row.between', { style: { padding: '10px 0', borderBottom: '1px solid var(--line-soft)' } }, [
        el('div.grow', {}, [
          el('div', { style: { fontWeight: '620' }, text: t.name }),
          el('div.small.faint', { text: `${plural(t.items.length, 'item')}${t.uses ? ` · logged ${plural(t.uses, 'time')}` : ''}` }),
        ]),
        el('button.btn.quiet.sm', {
          'aria-label': `Delete ${t.name}`,
          onclick: async () => {
            const ok = await confirmSheet('Delete saved meal?',
              `“${t.name}” will be removed. Days you already logged it on keep their entries.`,
              { confirmLabel: 'Delete' });
            if (!ok) return;
            await store.deleteTemplate(t.id);
            toast('Deleted');
          },
        }, ['×']),
      ])
    ),
  ]);
  openSheet('Saved meals', body);
}

function previousDay(day) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return dayKey(d.getTime());
}

/* ======================= the food list ======================= */

function quickAdd(day) {
  const wrap = el('div');
  const foods = store.state.foods;

  wrap.append(el('div.section-head', {}, [
    el('h2', { text: 'My foods' }),
    el('div.row', { style: { gap: '4px' } }, [
      el('button.btn.quiet.sm', { onclick: () => barcodeSheet(day) }, ['Barcode']),
      el('button.btn.quiet.sm', { onclick: () => foodForm(null, day) }, ['+ New']),
    ]),
  ]));

  if (!foods.length) {
    wrap.append(emptyState(
      'Your list is empty',
      'Add the things you actually eat — protein and calories per portion. Thirty entries covers almost everyone, and after that logging is one tap.',
      el('div.stack', { style: { marginTop: '14px' } }, [
        el('button.btn.primary', { onclick: () => foodForm(null, day) }, ['Add your first food']),
        el('button.btn.ghost', { onclick: () => barcodeSheet(day) }, ['Look up a barcode']),
      ])
    ));
    return wrap;
  }

  const search = el('input', {
    type: 'text', placeholder: `Search your list and ${TOTAL_SIZE} foods…`,
    autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
  });
  const list = el('div');

  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const found = q ? foods.filter((f) => f.name.toLowerCase().includes(q)) : foods.slice(0, 12);
    list.replaceChildren();

    for (const f of found) {
      list.append(listItem({
        title: f.name,
        sub: `${f.portion} · ${Math.round(f.protein)} g protein${f.kcal ? ` · ${Math.round(f.kcal)} kcal` : ''}`,
        right: el('span.small.faint', { text: '+' }),
        chev: '',
        ariaLabel: `Log ${f.name}`,
        onclick: async () => { await store.logMeal(f.id, { day }); toast(`${f.name} logged`); },
      }));
    }

    // Then the bundled libraries, kept visibly apart. Generic entries were
    // measured in a lab; branded ones were typed off a packet by a stranger.
    // Both are useful and they are not the same kind of number.
    const hits = q ? searchFoods(q) : [];
    for (const kind of ['generic', 'brand']) {
      const group = hits.filter((h) => h.kind === kind);
      if (!group.length) continue;

      list.append(el('div.slot-head', {}, [
        el('span', { text: kind === 'generic' ? 'Generic foods · measured' : 'Branded · as labelled' }),
        el('span', { text: plural(group.length, 'match', 'matches') }),
      ]));

      for (const hit of group) {
        const p = hit.entry.per100;
        const title = hit.entry.brand ? `${hit.entry.name} · ${hit.entry.brand}` : hit.entry.name;
        list.append(listItem({
          title,
          sub: `per 100 g · ${Math.round(p.protein)} g protein · ${Math.round(p.kcal)} kcal`,
          right: el('span.small.faint', { text: '+' }),
          chev: '',
          ariaLabel: `Add ${hit.entry.name}`,
          onclick: () => libraryPortionSheet(hit.entry, day, hit.kind),
        }));
      }
    }

    if (!found.length && !hits.length) {
      list.append(el('div.small.faint', { style: { padding: '10px 0' },
        text: q
          ? `Nothing in your list or the ${TOTAL_SIZE} bundled foods matches. Add it as a new food, or scan its barcode.`
          : 'Nothing matches. Add it as a new food.' }));
    } else if (!q && foods.length > 12) {
      list.append(el('div.small.faint', { style: { textAlign: 'center' }, text: `Search to reach the other ${foods.length - 12}, plus ${TOTAL_SIZE} bundled foods` }));
    }
  };

  search.addEventListener('input', paint);
  paint();

  wrap.append(
    el('div', { style: { marginBottom: '8px' } }, [search]),
    list,
    el('div.small.faint', { style: { marginTop: '10px' },
      text: 'Tap to log one portion. The list sorts by how often you eat something, so your staples stay on top.' }),
    el('button.btn.ghost.full.sm', { style: { marginTop: '8px' }, onclick: manageSheet }, ['Edit my foods'])
  );
  return wrap;
}

/**
 * Pick a portion for a library food, then it joins your list.
 *
 * The library stores per 100 g because that is how the source reports it and
 * the only figure that is unambiguous. How much of it you eat is the one thing
 * no database knows, so it is asked here — the same decision the barcode path
 * makes, in the same place.
 */
function libraryPortionSheet(entry, day, kind = 'generic') {
  const grams = normaliseOnBlur(numberInput({ value: String(entry.serving || 100), 'aria-label': 'Grams' }), { integer: true });
  const preview = el('div.small.faint', { style: { marginTop: '-6px', marginBottom: '14px' } });
  const cov = coverage(entry);

  const paint = () => {
    const g = parseNumber(grams.value) || 0;
    const f = toFoodFields(entry, g);
    preview.textContent = g > 0
      ? `${f.kcal ?? 0} kcal · ${f.protein ?? 0} g protein · ${f.carbs ?? 0} g carbs · ${f.fat ?? 0} g fat`
      : 'Enter a weight in grams.';
  };
  grams.addEventListener('input', paint);
  paint();

  const add = async (alsoLog) => {
    const g = parseNumber(grams.value);
    if (g === null || g <= 0) { toast('How many grams?'); grams.focus(); return; }
    const fields = toFoodFields(entry, g);
    if (kind === 'brand') {
      // Keep the barcode: a later scan of the same packet then answers from
      // your own list instead of the network.
      fields.source = 'brand-library';
      fields.barcode = entry.code || null;
      if (entry.brand) fields.name = `${entry.name} · ${entry.brand}`;
    }
    const food = await store.addFood(fields);
    closeSheet();
    if (alsoLog) {
      await store.logMeal(food.id, { day });
      toast(`${food.name} added and logged`);
    } else {
      toast(`${food.name} added to your list`);
    }
  };

  openSheet(entry.name, el('div', {}, [
    el('label.field', {}, [el('span', { text: 'How much do you eat? (g)' }), grams]),
    preview,
    el('div.stack', {}, [
      el('button.btn.primary.full', { onclick: () => add(true) }, ['Add and log it']),
      el('button.btn.ghost.full', { onclick: () => add(false) }, ['Just add to my list']),
    ]),
    el('div.section-head', {}, [el('h2', { text: 'Source' })]),
    el('div.small.muted', {
      text: kind === 'generic'
        ? `USDA FoodData Central: “${entry.usda}”. ${cov.known} of ${cov.total} nutrients recorded.`
        : `Open Food Facts, barcode ${entry.code}. ${cov.known} of ${cov.total} nutrients recorded — branded entries rarely carry micronutrients.`,
    }),
    el('div.small.faint', { style: { marginTop: '8px' },
      text: kind === 'generic' ? LIBRARY_ATTRIBUTION : BRAND_ATTRIBUTION }),
  ]));
}

/**
 * @param draft  an Open Food Facts result, which carries per-100 g values and
 *               therefore needs a grams field the manual path does not.
 */
function foodForm(existing = null, day = dayKey(), draft = null) {
  const name = el('input', {
    type: 'text', placeholder: 'e.g. Magerquark',
    value: existing ? existing.name : draft ? draft.name : '',
  });
  const portion = el('input', {
    type: 'text', placeholder: 'e.g. 250 g, 1 Scoop, 1 Riegel',
    value: existing ? existing.portion : draft ? `${draft.suggestedGrams} g` : '',
  });
  const protein = normaliseOnBlur(numberInput({ decimal: true, value: existing ? existing.protein : '' }));
  const kcal = el('input', { type: 'number', inputmode: 'numeric', step: '1', min: '0', value: existing ? existing.kcal : '' });
  // Blank means unknown, not zero — see newFood. Leaving these empty is a
  // perfectly complete entry; it just keeps the day's split honest about it.
  const optional = (key) => normaliseOnBlur(numberInput({
    decimal: true,
    value: existing && existing[key] !== null && existing[key] !== undefined ? existing[key] : '',
    placeholder: 'optional',
  }));
  const carbs = optional('carbs');
  const fat = optional('fat');
  const fibre = optional('fibre');

  // Only the barcode path gets this: the database stores per 100 g, and how
  // much of that you actually eat is the one thing it cannot know. Putting the
  // decision here — rather than trusting a manufacturer "serving" — is also the
  // honest place for it.
  let grams = null;
  if (draft) {
    grams = el('input', {
      type: 'number', inputmode: 'numeric', step: '1', min: '1',
      value: String(draft.suggestedGrams),
    });
    const sync = () => {
      const scaled = scaleToPortion(draft.per100, grams.value);
      protein.value = String(scaled.protein);
      kcal.value = String(scaled.kcal);
      carbs.value = scaled.carbs === null ? '' : String(scaled.carbs);
      fat.value = scaled.fat === null ? '' : String(scaled.fat);
      fibre.value = scaled.fibre === null ? '' : String(scaled.fibre);
      if (/^\d+\s*g$/.test(portion.value.trim()) || !portion.value.trim()) {
        portion.value = `${grams.value} g`;
      }
    };
    grams.addEventListener('input', sync);
    sync();
  }

  async function submit(alsoLog) {
    const value = name.value.trim();
    if (!value) { toast('Give it a name'); name.focus(); return; }
    if (parseNumber(protein.value) === null) { toast('Protein per portion is the one number this needs'); protein.focus(); return; }

    const fields = {
      name: value,
      portion: portion.value.trim() || '1 Portion',
      protein: parseNumber(protein.value) ?? 0,
      kcal: Number(kcal.value) || 0,
      carbs: parseNumber(carbs.value),
      fat: parseNumber(fat.value),
      fibre: parseNumber(fibre.value),
    };
    if (draft) {
      // Keep the barcode so a re-lookup answers from your own list, and the
      // per-100 g basis so the portion can be re-scaled later without asking
      // the network again.
      fields.barcode = draft.code;
      fields.per100 = draft.per100;
      fields.portionGrams = Number(grams.value) || null;
      fields.source = 'barcode';
    }

    const food = existing
      ? await store.updateFood(existing.id, fields)
      : await store.addFood(fields);

    closeSheet();
    if (alsoLog && !existing) {
      await store.logMeal(food.id, { day });
      toast(`${food.name} added and logged`);
    } else {
      toast(existing ? 'Saved' : `${food.name} added`);
    }
  }

  openSheet(existing ? 'Edit food' : draft ? 'From barcode' : 'New food', el('div', {}, [
    draft
      ? el('div.card.tight', { style: { marginBottom: '14px' } }, [
          el('div.small', { style: { fontWeight: '650' }, text: 'Found in Open Food Facts' }),
          el('div.small.faint', { style: { marginTop: '2px' },
            text: `Per 100 g: ${draft.per100.protein ?? '?'} g protein${draft.per100.kcal ? `, ${Math.round(draft.per100.kcal)} kcal` : ''}${draft.quantity ? ` · Packung ${draft.quantity}` : ''}` }),
          el('div.small.faint', { style: { marginTop: '4px' },
            text: 'Community data — worth a glance at the packet before you trust it.' }),
        ])
      : null,

    el('label.field', {}, [el('span', { text: 'Name' }), name]),

    grams
      ? el('div', {}, [
          el('label.field', {}, [el('span', { text: 'How much do you eat? (g)' }), grams]),
          el('div.small.faint', { style: { marginTop: '-8px', marginBottom: '12px' },
            text: draft.servingLabel
              ? `The packet calls ${draft.servingLabel} a serving. Use what you actually eat — the numbers below follow along.`
              : 'No serving size on record, so this starts at 100 g. The numbers below follow along.' }),
        ])
      : null,

    el('label.field', {}, [el('span', { text: 'Portion' }), portion]),
    el('div.small.faint', { style: { marginTop: '-8px', marginBottom: '12px' },
      text: 'Whatever unit you actually eat it in — a weight, a scoop, a bar. The numbers below are per one of those.' }),
    el('label.field', {}, [el('span', { text: 'Protein (g)' }), protein]),
    el('label.field', {}, [el('span', { text: 'Calories (optional)' }), kcal]),
    el('div.row', { style: { gap: '10px' } }, [
      el('label.field.grow', {}, [el('span', { text: 'Carbs (g)' }), carbs]),
      el('label.field.grow', {}, [el('span', { text: 'Fat (g)' }), fat]),
      el('label.field.grow', {}, [el('span', { text: 'Fibre (g)' }), fibre]),
    ]),
    el('div.small.faint', { style: { marginTop: '-6px', marginBottom: '14px' },
      text: 'Leave these blank if the label does not say. Blank means unknown — the day\'s energy split waits for them rather than counting them as zero.' }),
    el('div.small.faint', { style: { marginTop: '-8px', marginBottom: '14px' },
      text: 'Calories are optional. A protein-only log still answers the question your training data can be compared against.' }),

    existing
      ? el('button.btn.primary.full', { onclick: () => submit(false) }, ['Save'])
      : el('div.stack', {}, [
          el('button.btn.primary.full', { onclick: () => submit(true) }, ['Add and log it now']),
          el('button.btn.ghost.full', { onclick: () => submit(false) }, ['Just add to my list']),
        ]),
  ]));
}

/* ======================= barcode ======================= */

/**
 * Type the number under the stripes. No camera: no browser on iOS implements
 * BarcodeDetector, and a WebAssembly scanner would cost the app its "no
 * dependencies, no build step" property for something you do once per product.
 */
function barcodeSheet(day) {
  const input = el('input', {
    type: 'text', inputmode: 'numeric', autocomplete: 'off',
    placeholder: 'z. B. 4008400202037',
  });
  const status = el('div.small.faint', { style: { marginTop: '10px' } });
  const go = el('button.btn.primary.full', { style: { marginTop: '12px' } }, ['Look it up']);

  async function run() {
    const code = input.value.trim();
    if (!code) { input.focus(); return; }

    // Your own list wins over the network — a product you already added is
    // already correct for the portion you actually eat.
    const known = store.state.foods.find((f) => f.barcode && f.barcode === code.replace(/\D/g, ''));
    if (known) {
      closeSheet();
      await store.logMeal(known.id, { day });
      toast(`${known.name} logged`);
      return;
    }

    go.disabled = true;
    status.style.color = 'var(--text-faint)';
    status.textContent = 'Asking Open Food Facts…';

    const res = await lookupBarcode(code);
    go.disabled = false;

    if (!res.ok) {
      status.style.color = res.reason === 'notfound' ? 'var(--text-dim)' : 'var(--warn)';
      status.textContent = res.detail;
      // A hit with no protein value still saves you typing the name.
      if (res.draft) {
        closeSheet();
        foodForm(null, day, res.draft);
      }
      return;
    }

    closeSheet();
    foodForm(null, day, res.draft);
  }

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  go.addEventListener('click', run);

  openSheet('Barcode', el('div', {}, [
    el('div.small.muted', {
      text: 'Type the number printed under the barcode. Once per product — after that it is in your list and works offline forever.',
    }),
    el('label.field', { style: { marginTop: '12px' } }, [el('span', { text: 'Barcode (EAN)' }), input]),
    go,
    status,
    el('div.small.faint', { style: { marginTop: '16px' } }, [
      'Data from ',
      el('a', { href: ATTRIBUTION.url, target: '_blank', rel: 'noopener', style: { color: 'var(--accent-hi)' } }, [ATTRIBUTION.name]),
      `, licensed ${ATTRIBUTION.licence}. It is community-maintained, so coverage is patchy and the numbers are only as good as whoever typed them in — check them against the packet.`,
    ]),
  ]));
  setTimeout(() => input.focus(), 60);
}

function manageSheet() {
  const body = el('div');
  const paint = () => {
    body.replaceChildren();
    if (!store.state.foods.length) {
      body.append(el('div.small.muted', { text: 'Nothing in your list yet.' }));
      return;
    }
    body.append(el('div.small.muted', { style: { marginBottom: '10px' },
      text: 'Deleting a food removes it from this list only — days you already logged keep their entries and their numbers.' }));

    for (const f of store.state.foods) {
      body.append(
        el('div.row.between', {
          style: { padding: '9px 0', borderBottom: '1px solid var(--line-soft)', gap: '10px' },
        }, [
          el('div.grow', {}, [
            el('div', { style: { fontWeight: '600', fontSize: '14.5px' }, text: f.name }),
            el('div.small.faint', { text: `${f.portion} · ${Math.round(f.protein)} g${f.kcal ? ` · ${Math.round(f.kcal)} kcal` : ''} · ${f.uses || 0}×` }),
          ]),
          el('button.btn.sm.ghost', { onclick: () => { closeSheet(); foodForm(f); } }, ['Edit']),
          el('button.btn.quiet.sm', {
            'aria-label': `Delete ${f.name}`,
            onclick: async () => {
              const ok = await confirmSheet('Delete food?', `${f.name} will be removed from your list. Logged days keep their entries.`);
              if (!ok) return;
              await store.deleteFood(f.id);
              paint();
              toast('Deleted');
            },
          }, ['×']),
        ])
      );
    }
  };
  paint();
  openSheet('My foods', body);
}

/* ======================= trends ======================= */

/**
 * The last fourteen days, per metric.
 *
 * Protein was the only one charted here for a long time, because it was the
 * only one with a target. Now that calories, carbs and fat have one too — see
 * macroTargets — they get the same treatment, against the same band, with the
 * same rule underneath: **a day nobody logged is blank, not zero.** Averaging
 * in zeroes would make a fortnight of decent eating with two forgotten days
 * look like failure, which is the fastest way to make someone stop logging.
 */
function trendSection() {
  const wrap = el('div');
  const units = store.units();
  const history = proteinHistory(store.state.meals, 14);
  const logged = history.filter((d) => d.logged);
  const targets = macroTargets(store.state.settings, maintenanceEstimate(store.state.meals, store.state.bodyweight));

  wrap.append(el('div.section-head', {}, [el('h2', { text: 'Last 14 days' })]));

  if (!logged.length) {
    wrap.append(el('div.card', {}, [
      el('div.small.muted', { text: 'Log a few days and the pattern shows up here — plus how it lines up with your bodyweight and your lifts.' }),
    ]));
    return wrap;
  }

  const METRICS = [
    { key: 'protein', label: 'Protein', unit: 'g' },
    { key: 'kcal', label: 'Calories', unit: 'kcal' },
    { key: 'carbs', label: 'Carbs', unit: 'g' },
    { key: 'fat', label: 'Fat', unit: 'g' },
  ];

  const host = el('div.card', {});
  const paint = () => {
    const m = METRICS.find((x) => x.key === trendMetric) || METRICS[0];
    const band = bandFor(m.key, targets);

    // Only days that carry this metric count. Carbs and fat are optional per
    // food, so a day can be logged and still have nothing to say about them.
    const withValue = logged.filter((d) => !(d.missing && d.missing[m.key]) || d[m.key] > 0);
    const mean = withValue.length
      ? Math.round(withValue.reduce((n, d) => n + d[m.key], 0) / withValue.length)
      : null;
    const inBand = band && withValue.filter((d) => d[m.key] >= band.low && d[m.key] <= band.high).length;

    host.replaceChildren(
      barChart(
        history.map((d) => ({
          label: d.day,
          short: d.day.slice(8),
          value: d[m.key],
          tip: d.logged ? `${fmtNum(d[m.key])} ${m.unit}` : 'not logged',
          dim: !d.logged,
        })),
        {
          caption: band
            ? `Daily ${m.label.toLowerCase()} against your ${fmtNum(band.low)}${band.low === band.high ? '' : `–${fmtNum(band.high)}`} ${m.unit} target. Days you did not log are blank, not zero.`
            : `Daily ${m.label.toLowerCase()}. Days you did not log are blank, not zero.`,
          height: 150, everyNthLabel: 2,
        }
      ),
      el('div.small.faint', { style: { marginTop: '10px' },
        text: mean === null
          ? `Nothing logged carries ${m.label.toLowerCase()} yet.`
          : band
            ? `${fmtNum(mean)} ${m.unit} average across ${plural(withValue.length, 'day')} — ${inBand} of them inside the target.`
            : `${fmtNum(mean)} ${m.unit} average across ${plural(withValue.length, 'day')}.` })
    );
  };

  const seg = el('div.seg', { style: { marginBottom: '10px' } }, METRICS.map((m) =>
    el('button', {
      'aria-pressed': String(trendMetric === m.key),
      onclick: (e) => {
        trendMetric = m.key;
        [...e.target.parentElement.children].forEach((b, i) =>
          b.setAttribute('aria-pressed', String(METRICS[i].key === m.key)));
        paint();
      },
    }, [m.label])
  ));

  paint();
  wrap.append(seg, host);

  // The point of the whole module: intake next to what it produced.
  const trend = weightTrend(store.state.bodyweight, 4);
  const tv = trendVerdict(trend);
  wrap.append(el('div.section-head', {}, [
    el('h2', { text: 'Bodyweight direction' }),
    el('button.btn.quiet.sm', { onclick: () => navigate('progress') }, ['Charts ›']),
  ]));
  wrap.append(
    el('div.card', {}, [
      el('div', {
        style: {
          fontWeight: '650', fontSize: '14px',
          color: tv.state === 'fast' ? 'var(--warn)' : tv.state === 'unknown' ? 'var(--text-faint)' : 'var(--good)',
        },
        text: tv.text,
      }),
      trend
        ? el('div.small.faint', { style: { marginTop: '3px' },
            text: `${fmtWeight(trend.from.weight, units)} → ${fmtWeight(trend.to.weight, units)} over ${trend.spanWeeks} weeks` })
        : null,
      el('div.small.muted', { style: { marginTop: '10px' },
        text: 'Roughly 0.25–0.5% of bodyweight a week is the usual range in either direction. That is training practice rather than a meta-analysis — unlike the protein band above, nobody has run the trial.' }),
    ])
  );

  wrap.append(maintenanceSection());
  return wrap;
}

/**
 * Maintenance calories from what actually happened.
 *
 * Deliberately not Mifflin-St Jeor with an activity multiplier: that is a
 * population average wearing your name, and the multiplier asks you to guess
 * the very thing you opened the app to find out. This subtracts the energy your
 * weight change accounts for from the energy you logged, which needs no guess
 * about you at all — only enough data, which is the part it refuses to fake.
 */
function maintenanceSection() {
  const wrap = el('div');
  const est = maintenanceEstimate(store.state.meals, store.state.bodyweight);

  wrap.append(el('div.section-head', {}, [el('h2', { text: 'Maintenance calories' })]));

  if (!est.ok) {
    const why = {
      days: `Needs at least ${est.needed} days with calories logged in the last ${est.days} — there ${est.logged === 1 ? 'is' : 'are'} ${est.logged}. Calories are optional in this app, so this is the one feature that asks for them.`,
      weight: 'Needs at least two bodyweight entries in the window. One weigh-in cannot show a direction.',
      span: `Your weigh-ins only span ${plural(est.spanDays, 'day')}. Below about two weeks the scale is mostly water and gut content, and the answer would be noise with a decimal point.`,
    }[est.reason];

    wrap.append(el('div.card', {}, [
      el('div.small.muted', { text: why }),
      el('div.small.faint', { style: { marginTop: '8px' },
        text: 'Worth the wait: this is measured from your own intake and your own scale, not predicted from a formula about people your size.' }),
    ]));
    return wrap;
  }

  const direction = est.kgPerWeek > 0.05 ? 'gaining' : est.kgPerWeek < -0.05 ? 'losing' : 'holding';
  wrap.append(
    el('div.card.glow', {}, [
      el('div', { style: { fontSize: '30px', fontWeight: '750', letterSpacing: '-0.03em', lineHeight: '1' },
        text: `${fmtNum(est.maintenance)} kcal` }),
      el('div.small.faint', { style: { marginTop: '3px' }, text: 'a day, to hold your weight' }),
      el('div.small.muted', { style: { marginTop: '10px' },
        text: `You averaged ${fmtNum(est.meanIntake)} kcal across ${plural(est.loggedDays, 'logged day')} while ${direction}${direction === 'holding' ? '' : ` ${Math.abs(est.kgPerWeek)} kg a week`}.` }),
      el('button.btn.quiet.sm', { style: { padding: '4px 0', marginTop: '2px' }, onclick: maintenanceSheet },
        ['How this is worked out']),
    ])
  );
  return wrap;
}

function maintenanceSheet() {
  const s = SOURCES.wishnofsky;
  openSheet('Maintenance calories', el('div', {}, [
    el('div.small.muted', {
      text: 'Two measured things, no formula: what you logged, and what the scale did. If you averaged 2,600 kcal while gaining 0.2 kg a week, then about 220 kcal a day went into that gain, and maintenance was near 2,380.',
    }),

    el('div.section-head', {}, [el('h2', { text: 'Why not the usual calculator' })]),
    el('div.small.muted', {
      text: 'Mifflin-St Jeor and its cousins predict a population average from height, weight, age and sex, then multiply by an activity level you have to guess. The guess is the biggest term in the equation and it is the one thing you have no way to know. Your own scale already contains the answer.',
    }),

    el('div.section-head', {}, [el('h2', { text: 'What it cannot fix' })]),
    el('div.small.muted', {
      text: 'Under-logging. Every validation study finds people record less than they eat, often by 20% or more, and this estimate inherits that error in full — if you log four fifths of your intake, it reads a fifth low. It is still anchored to your own weight, which is more than a formula can say. Treat it as a starting point to adjust from, not a number to defend.',
    }),

    el('div.section-head', {}, [el('h2', { text: 'The one constant' })]),
    el('div.small.muted', { text: s.says }),
    el('a', {
      href: s.url, target: '_blank', rel: 'noopener',
      style: { color: 'var(--accent-hi)', fontWeight: '620', fontSize: '14px' },
      text: `${s.short} ↗`,
    }),
  ]));
}
