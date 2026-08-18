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
  numberInput, parseNumber, normaliseOnBlur,
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
import { t, tn } from '../i18n.js';

let viewDay = null;      // null = today; set by the date stepper
let trendMetric = 'protein';   // which metric the 14-day chart shows

/** The target band for a metric, or null where there is none to compare against. */
function bandFor(key, targets) {
  if (!targets || !targets.ok) return null;
  if (key === 'kcal') return { low: targets.kcal, high: targets.kcal };
  return targets[key] || null;
}

export default function renderNutrition({ actions, fresh }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': t('common.settings') }, ['⚙']));

  // Stepping back a day survives a re-render, which is what the stepper needs,
  // but not a trip to another tab. Coming back to Food and finding it still on
  // last Tuesday is how a lunch ends up logged five days late, and the only
  // sign would have been the date under the heading.
  if (fresh) viewDay = null;

  const root = el('div');
  const day = viewDay || dayKey();
  const isToday = day === dayKey();
  const meals = store.mealsOn(day);
  const totals = dayTotals(meals);
  const target = proteinTarget(store.state.settings);

  root.append(dayHeader(day, isToday));
  // Today's calories and macros answer the first question on this screen.
  // Search follows immediately afterwards, before water, meals and trends.
  root.append(targetCard(totals, target));
  root.append(targetsSection(totals));
  root.append(macroCard(totals));
  root.append(quickAdd(day));
  root.append(waterCard(day));
  root.append(mealList(meals, day));
  root.append(savedMeals(day));
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
    el('h2', { text: t('food.targets') }),
    el('button.btn.quiet.sm', { onclick: () => targetsSheet(targets) }, [t('food.howSet')]),
  ]));

  if (!targets.ok) {
    wrap.append(el('div.card', {}, [
      el('div.small.muted', {
        text: targets.protein
          ? t('food.proteinOnly', { low: targets.protein.low, high: targets.protein.high })
          : t('food.noBodyweight'),
      }),
    ]));
    return wrap;
  }

  wrap.append(goalPicker(targets));

  const rows = [
    [t('food.calories'), `${fmtNum(targets.kcal)} kcal`, totals.kcal, targets.kcal, targets.kcal, 'var(--text)'],
    [t('food.protein'), `${targets.protein.low}–${targets.protein.high} g`, totals.protein, targets.protein.low, targets.protein.high, 'var(--accent-hi)'],
    [t('food.carbs'), `${targets.carbs.low}–${targets.carbs.high} g`, totals.carbs, targets.carbs.low, targets.carbs.high, '#22D3EE'],
    [t('food.fat'), `${targets.fat.low}–${targets.fat.high} g`, totals.fat, targets.fat.low, targets.fat.high, '#C084FC'],
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
            text: t('common.of', { a: fmtNum(eaten), b: band }),
          }),
        ]),
        el('div.track-thin', {}, [
          el('i', { style: { width: `${Math.max(2, pct * 100)}%`, background: colour } }),
        ]),
      ])
    );
  }

  card.append(el('div.small.faint', { style: { marginTop: '-4px' }, text: t('food.carbsAreRest') }));

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
    }, [t(g.label)])
  ));

  const goal = GOALS.find((g) => g.key === targets.goal);
  return el('div', {}, [
    seg,
    el('div.small.faint', { style: { marginBottom: '10px' },
      text: targets.offset === 0
        ? t('food.goalHold', { kcal: fmtNum(targets.maintenance), blurb: t(goal.blurb) })
        : t('food.goalOffset', {
            offset: `${targets.offset > 0 ? '+' : ''}${fmtNum(targets.offset)}`,
            maintenance: fmtNum(targets.maintenance),
            kg: Math.abs(targets.kgPerWeek),
            blurb: t(goal.blurb),
          }) }),
  ]);
}

function targetsSheet(targets) {
  const fat = SOURCES.efsaFat;
  const protein = SOURCES.protein2018;

  openSheet(t('food.howSetTitle'), el('div', {}, [
    el('div.small.muted', { text: t('food.orderIntro') }),

    el('div.section-head', {}, [el('h2', { text: t('food.step1') })]),
    el('div.small.muted', {
      text: targets.ok
        ? t('food.step1Body', { kcal: fmtNum(targets.maintenance) })
        : t('food.step1BodyNoData'),
    }),

    el('div.section-head', {}, [el('h2', { text: t('food.step2') })]),
    el('div.small.muted', { text: t(protein.says) }),

    el('div.section-head', {}, [el('h2', { text: t('food.step3') })]),
    el('div.small.muted', { text: t(fat.says) }),
    el('a', {
      href: fat.url, target: '_blank', rel: 'noopener',
      style: { color: 'var(--accent-hi)', fontWeight: '620', fontSize: '14px' },
      text: `${fat.short} ↗`,
    }),

    el('div.section-head', {}, [el('h2', { text: t('food.step4') })]),
    el('div.small.muted', { text: t('food.step4Body') }),

    el('div.section-head', {}, [el('h2', { text: t('food.cannotDo') })]),
    el('div.small.muted', { text: t('food.cannotDoBody') }),
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
    el('div.small', { style: { fontWeight: '650' }, text: t('food.energyFrom') }),
    split ? el('span.small.faint', { text: `${fmtNum(split.fromMacros)} kcal` }) : null,
  ]));

  if (!split) {
    // The honest failure: with carbs or fat unrecorded on some items, any bar
    // drawn here would be a picture of the logging rather than the eating.
    const gaps = [];
    if (totals.missing.carbs) gaps.push(t('food.withoutCarbs', { n: totals.missing.carbs }));
    if (totals.missing.fat) gaps.push(t('food.withoutFat', { n: totals.missing.fat }));
    card.append(el('div.small.muted', { style: { marginTop: '8px' },
      text: gaps.length
        ? t('food.noSplitGaps', { items: tn(totals.items, 'unit.item'), gaps: gaps.join(t('food.and')) })
        : t('food.noSplitAtAll') }));
    return wrap.append(card), wrap;
  }

  card.append(
    el('div.macro-bar', {}, [
      el('i.p', { style: { width: `${split.share.protein * 100}%` } }),
      el('i.c', { style: { width: `${split.share.carbs * 100}%` } }),
      el('i.f', { style: { width: `${split.share.fat * 100}%` } }),
    ]),
    el('div.macro-key', {}, [
      macroKey('var(--accent-hi)', t('food.protein'), totals.protein, split.share.protein),
      macroKey('#22D3EE', t('food.carbs'), totals.carbs, split.share.carbs),
      macroKey('#C084FC', t('food.fat'), totals.fat, split.share.fat),
    ])
  );

  if (totals.fibre || !totals.missing.fibre) {
    const target = fibreTarget();
    card.append(el('div.small.faint', { style: { marginTop: '10px' },
      text: t('food.fibreLine', { grams: totals.fibre, target })
        + (totals.missing.fibre ? ` ${t('food.fibreMissing', { items: tn(totals.missing.fibre, 'unit.item') })}` : '') }));
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
        el('span.small.faint', { text: `  ${t('food.ofAbout', { litres: (target / 1000).toFixed(1) })}` }),
      ]),
      el('div.row', { style: { gap: '6px' } }, [
        el('button.btn.quiet.sm', { 'aria-label': t('food.removeGlass'), onclick: () => store.addWater(-GLASS, day) }, ['−']),
        el('button.btn.ghost.sm', { onclick: () => store.addWater(GLASS, day) }, [t('food.addGlass')]),
      ]),
    ]),
    el('div.glass-row', {},
      Array.from({ length: Math.max(targetGlasses, glasses) }, (_, i) =>
        el(`div.glass${i < glasses ? '.full' : ''}`, { 'aria-hidden': 'true' }))),
    el('div.small.faint', { style: { marginTop: '10px' }, text: t('food.waterNote') }),
  ]);

  return el('div', {}, [
    el('div.section-head', {}, [el('h2', { text: t('food.water') })]),
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

  const noon = new Date(`${day}T12:00:00`).getTime();
  return el('div.row.between', { style: { marginBottom: '14px' } }, [
    el('button.icon-btn', { 'aria-label': t('food.prevDay'), onclick: () => step(-1) }, ['‹']),
    el('div', { style: { textAlign: 'center' } }, [
      el('div', { style: { fontWeight: '700', fontSize: '17px' },
        text: isToday ? t('common.today') : fmtDate(noon, { weekday: 'short' }) }),
      // The day key is how the app stores a date, not how anyone reads one.
      el('div.small.faint', { text: fmtDate(noon, { weekday: 'short', year: 'numeric' }) }),
    ]),
    // Tomorrow cannot be logged, so the button says so to everything that asks,
    // not only to a pair of eyes: dimmed alone still takes focus and a tap.
    el('button.icon-btn', {
      'aria-label': t('food.nextDay'),
      disabled: isToday || null,
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
        ? t('food.kcalTodayWith', { maintenance: fmtNum(maintenance.maintenance) })
        : t('food.kcalToday') }),

    el('div.row', { style: { gap: '8px', marginTop: '14px' } }, [
      macroPill(t('food.protein'), totals.protein, 'var(--accent-hi)'),
      macroPill(t('food.carbs'), totals.carbs, '#22D3EE', totals.missing.carbs),
      macroPill(t('food.fat'), totals.fat, '#C084FC', totals.missing.fat),
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
      el('button.btn.quiet.sm', { style: { padding: '4px 0' }, onclick: targetSheet }, [t('food.whereTarget')]),
      el('button.btn.quiet.sm', { style: { padding: '4px 0', marginLeft: 'auto' },
        onclick: () => detailSheet(totals) }, [`${t('common.more')} ›`]),
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
      text: missing ? t('food.pillUnknown', { label, n: missing }) : label }),
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
        text: t(n.label),
      }),
      cell.known
        ? el('div', { style: { textAlign: 'right' } }, [
            el('div', { style: { fontWeight: '680', fontSize: '14px' },
              text: `${fmtNum(cell.value, cell.value < 10 && n.unit !== 'kcal' ? 1 : 0)} ${n.unit}` }),
            cell.missing
              ? el('div.small.faint', { style: { fontSize: '10.5px' },
                  text: t('common.unknownOf', { n: cell.missing, total: totals.items }) })
              : null,
          ])
        : el('span.small.faint', { text: t('common.notRecorded') }),
    ]);
  });

  openSheet(t('food.everythingToday'), el('div', {}, [
    el('div.small.muted', { style: { marginBottom: '10px' },
      text: t('food.everythingIntro', { items: tn(totals.items, 'unit.item') }) }),
    ...rows,
    el('div.section-head', {}, [el('h2', { text: t('food.whereNumbers') })]),
    el('div.small.muted', { text: t(LIBRARY_ATTRIBUTION) }),
    el('div.small.faint', { style: { marginTop: '8px' }, text: t('food.microGaps') }),
  ]));
}

function targetSheet() {
  const target = proteinTarget(store.state.settings);
  const { low, high } = THRESHOLDS.proteinPerKg;
  const s = SOURCES.protein2018;

  openSheet(t('food.proteinTarget'), el('div', {}, [
    target
      ? el('div.card.tight', {}, [
          el('div', { style: { fontSize: '20px', fontWeight: '720' }, text: t('food.gPerDay', { low: target.low, high: target.high }) }),
          el('div.small.faint', { text: t('food.gPerKg', { low, high }) }),
        ])
      : el('div.small.muted', { text: t('food.addBodyweight') }),

    el('div.section-head', {}, [el('h2', { text: t('food.whyRange') })]),
    el('div.small.muted', { text: t(s.says) }),

    el('div.section-head', {}, [el('h2', { text: t('food.notTracked') })]),
    el('div.small.muted', { text: t('food.notTrackedBody') }),

    el('div.section-head', {}, [el('h2', { text: t('settings.sources') })]),
    el('a', {
      href: s.url, target: '_blank', rel: 'noopener',
      style: { color: 'var(--accent-hi)', fontWeight: '620', fontSize: '14px' },
      text: `${s.short} ↗`,
    }),
    el('div.small.faint', { style: { marginTop: '2px' }, text: t(s.note) }),
  ]));
}

/* ======================= today's meals ======================= */

const SLOT_KEY = {
  breakfast: 'food.slot.breakfast', lunch: 'food.slot.lunch',
  dinner: 'food.slot.dinner', snack: 'food.slot.snack',
};
const slotLabel = (slot) => t(SLOT_KEY[slot]);

function mealList(meals, day) {
  const wrap = el('div');

  const yesterday = previousDay(day);
  const canRepeat = store.mealsOn(yesterday).length > 0;

  wrap.append(el('div.section-head', {}, [
    el('h2', { text: t('food.logged') }),
    // Most days repeat most of the day before. One tap beats fifteen.
    canRepeat && !meals.length
      ? el('button.btn.quiet.sm', {
          onclick: async () => {
            const n = await store.copyDay(yesterday, day);
            toast(t('food.copiedFromYesterday', { items: tn(n, 'unit.item') }));
          },
        }, [t('food.repeatYesterday')])
      : null,
  ]));

  if (!meals.length) {
    wrap.append(el('div.card', {}, [
      el('div.small.muted', {
        text: t(canRepeat ? 'food.emptyDayRepeat' : 'food.emptyDay'),
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
      el('span', { text: slotLabel(slot) }),
      el('div.row', { style: { gap: '10px', alignItems: 'baseline' } }, [
        el('span', { text: `${slotProtein} g${slotKcal ? ` · ${fmtNum(slotKcal)} kcal` : ''}` }),
        // The cheapest place to create a saved meal is the moment you have just
        // logged one — no separate builder screen to go and find.
        inSlot.length > 1
          ? el('button.btn.quiet.sm', {
              style: { padding: '0 4px', minHeight: '22px', fontSize: '11px' },
              onclick: () => saveMealSheet(inSlot, slot),
            }, [t('common.save')])
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
      'aria-label': t('food.editMeal', { name: m.name }),
      onclick: () => mealSheet(m),
    }, [
      el('div', { style: { fontWeight: '600', fontSize: '14.5px' },
        text: m.amount === 1 ? m.name : `${m.amount}× ${m.name}` }),
      el('div.small.faint', { text: detail.join(' · ') }),
    ]),
    el('div', { style: { fontWeight: '680', fontSize: '15px', whiteSpace: 'nowrap' },
      text: `${Math.round(m.protein)} g` }),
    el('button.btn.quiet.sm', {
      'aria-label': t('food.removeMeal', { name: m.name }),
      onclick: async () => { await store.deleteMeal(m.id); toast(t('plans.removed')); },
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
    }, [slotLabel(slot)])
  ));

  openSheet(m.name, el('div', {}, [
    el('div.small.faint', { style: { marginBottom: '14px' },
      text: t('food.asLogged', {
        portion: m.portion,
        protein: Math.round(m.protein),
      }) + (m.kcal ? ` · ${Math.round(m.kcal)} kcal` : '') }),
    el('label.field', {}, [el('span', { text: t('food.portions') }), amount]),
    el('button.btn.primary.full', {
      onclick: async () => {
        const n = parseNumber(amount.value);
        if (n === null || n <= 0) { toast(t('food.howManyPortions')); amount.focus(); return; }
        await store.updateMeal(m.id, { amount: n });
        closeSheet();
        toast(t('food.updated'));
      },
    }, [t('food.savePortions')]),
    el('div.section-head', {}, [el('h2', { text: t('food.partOfDay') })]),
    slots,
    el('div.small.faint', { style: { marginTop: '8px' }, text: t('food.groupingOnly') }),
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
    placeholder: t('food.mealNamePlaceholder'),
    value: meals.map((m) => m.name).slice(0, 2).join(' + '),
  });

  openSheet(t('food.saveAsMeal'), el('div', {}, [
    el('div.small.muted', { style: { marginBottom: '14px' },
      text: t('food.saveMealIntro', { items: tn(resolvable.length, 'unit.item'), slot: slotLabel(slot) }) }),
    el('label.field', {}, [el('span', { text: t('picker.field.name') }), name]),
    ...resolvable.map((m) => el('div.small.faint', { style: { marginBottom: '4px' },
      text: `${m.amount === 1 ? '' : `${m.amount}× `}${m.name} · ${m.portion}` })),
    orphans
      ? el('div.small', { style: { color: 'var(--warn)', marginTop: '10px' },
          text: t('food.orphans', { items: tn(orphans, 'unit.item') }) })
      : null,
    el('button.btn.primary.full', {
      style: { marginTop: '14px' },
      onclick: async () => {
        if (!resolvable.length) { toast(t('food.nothingSaveable')); return; }
        const saved = await store.saveTemplate({
          name: name.value,
          slot,
          items: resolvable.map((m) => ({ foodId: m.foodId, amount: m.amount })),
        });
        closeSheet();
        toast(t('food.mealSaved', { name: saved.name }));
      },
    }, [t('food.saveThisMeal')]),
  ]));
}

/** Saved meals, one tap each. */
function savedMeals(day) {
  const wrap = el('div');
  const templates = store.state.templates;
  if (!templates.length) return wrap;

  wrap.append(el('div.section-head', {}, [
    el('h2', { text: t('food.savedMeals') }),
    el('span.small.faint', { text: tn(templates.length, 'unit.meal') }),
  ]));

  for (const tpl of templates.slice(0, 8)) {
    // Totals are computed from the foods now, not from when it was saved — the
    // whole point of storing references rather than values.
    const items = tpl.items
      .map((i) => ({ food: store.state.foods.find((f) => f.id === i.foodId), amount: i.amount }))
      .filter((x) => x.food);
    const kcal = Math.round(items.reduce((n, x) => n + (x.food.kcal || 0) * x.amount, 0));
    const protein = Math.round(items.reduce((n, x) => n + (x.food.protein || 0) * x.amount, 0));
    const gone = tpl.items.length - items.length;

    wrap.append(listItem({
      title: tpl.name,
      sub: items.length
        ? `${tn(items.length, 'unit.item')} · ${t('food.gProtein', { n: protein })}`
          + (kcal ? ` · ${kcal} kcal` : '')
          + (gone ? ` · ${t('food.nMissing', { n: gone })}` : '')
        : t('food.allFoodsDeleted'),
      right: el('span.small.faint', { text: '+' }),
      chev: '',
      ariaLabel: t('food.logNamed', { name: tpl.name }),
      onclick: async () => {
        if (!items.length) { toast(t('food.nothingLeftToLog')); return; }
        const res = await store.logTemplate(tpl.id, { day });
        toast(res.missing
          ? t('food.loggedPartly', { name: res.name, items: tn(res.logged, 'unit.item'), missing: res.missing })
          : t('food.loggedNamed', { name: res.name }));
      },
    }));
  }

  wrap.append(
    el('button.btn.ghost.full.sm', { style: { marginTop: '8px' }, onclick: manageMealsSheet },
      [t('food.editSavedMeals')])
  );
  return wrap;
}

function manageMealsSheet() {
  const body = el('div', {}, [
    el('div.small.muted', { style: { marginBottom: '12px' }, text: t('food.manageMealsIntro') }),
    ...store.state.templates.map((tpl) =>
      el('div.row.between', { style: { padding: '10px 0', borderBottom: '1px solid var(--line-soft)' } }, [
        el('div.grow', {}, [
          el('div', { style: { fontWeight: '620' }, text: tpl.name }),
          el('div.small.faint', { text: tn(tpl.items.length, 'unit.item')
            + (tpl.uses ? ` · ${t('food.loggedTimes', { times: tn(tpl.uses, 'unit.time') })}` : '') }),
        ]),
        el('button.btn.quiet.sm', {
          'aria-label': t('food.deleteNamed', { name: tpl.name }),
          onclick: async () => {
            const ok = await confirmSheet(t('food.deleteMealTitle'),
              t('food.deleteMealBody', { name: tpl.name }),
              { confirmLabel: t('common.delete') });
            if (!ok) return;
            await store.deleteTemplate(tpl.id);
            toast(t('progress.deleted'));
          },
        }, ['×']),
      ])
    ),
  ]);
  openSheet(t('food.savedMeals'), body);
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
    el('h2', { text: t('food.searchTitle') }),
    el('div.row', { style: { gap: '4px' } }, [
      el('button.btn.quiet.sm', { onclick: () => barcodeSheet(day) }, [t('food.barcode')]),
      el('button.btn.quiet.sm', { onclick: () => foodForm(null, day) }, [t('food.new')]),
    ]),
  ]));

  if (!foods.length) {
    wrap.append(el('div.card.tight', { style: { marginBottom: '10px' } }, [
      el('strong', { text: t('food.listEmpty') }),
      el('div.small.muted', { style: { marginTop: '3px' }, text: t('food.listEmptyHint') }),
    ]));
  }

  const search = el('input', {
    type: 'text', placeholder: t('food.searchPlaceholder', { n: TOTAL_SIZE }),
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
        sub: `${f.portion} · ${t('food.gProtein', { n: Math.round(f.protein) })}`
          + (f.kcal ? ` · ${Math.round(f.kcal)} kcal` : ''),
        right: el('span.small.faint', { text: '+' }),
        chev: '',
        ariaLabel: t('food.logNamed', { name: f.name }),
        onclick: async () => { await store.logMeal(f.id, { day }); toast(t('food.loggedNamed', { name: f.name })); },
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
        el('span', { text: t(kind === 'generic' ? 'food.genericHeading' : 'food.brandHeading') }),
        el('span', { text: tn(group.length, 'unit.match') }),
      ]));

      for (const hit of group) {
        const p = hit.entry.per100;
        const title = hit.entry.brand ? `${hit.entry.name} · ${hit.entry.brand}` : hit.entry.name;
        list.append(listItem({
          title,
          sub: `${t('food.per100')} · ${t('food.gProtein', { n: Math.round(p.protein) })} · ${Math.round(p.kcal)} kcal`,
          right: el('span.small.faint', { text: '+' }),
          chev: '',
          ariaLabel: t('picker.addNamed', { name: hit.entry.name }),
          onclick: () => libraryPortionSheet(hit.entry, day, hit.kind),
        }));
      }
    }

    if (!found.length && !hits.length) {
      list.append(el('div.small.faint', { style: { padding: '10px 0' },
        text: q
          ? t('food.noMatchBundled', { n: TOTAL_SIZE })
          : t('food.noMatch') }));
    } else if (!q && foods.length > 12) {
      list.append(el('div.small.faint', { style: { textAlign: 'center' },
        text: t('food.searchForMore', { rest: foods.length - 12, bundled: TOTAL_SIZE }) }));
    }
  };

  search.addEventListener('input', paint);
  paint();

  wrap.append(
    el('div', { style: { marginBottom: '8px' } }, [search]),
    list,
    el('div.small.faint', { style: { marginTop: '10px' }, text: t('food.tapToLog') })
  );
  if (foods.length) {
    wrap.append(el('button.btn.ghost.full.sm', { style: { marginTop: '8px' }, onclick: manageSheet }, [t('food.editMyFoods')]));
  }
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
  const grams = normaliseOnBlur(numberInput({ value: String(entry.serving || 100), 'aria-label': t('food.grams') }), { integer: true });
  const preview = el('div.small.faint', { style: { marginTop: '-6px', marginBottom: '14px' } });
  const cov = coverage(entry);

  const paint = () => {
    const g = parseNumber(grams.value) || 0;
    const f = toFoodFields(entry, g);
    preview.textContent = g > 0
      ? `${f.kcal ?? 0} kcal · ${t('food.gProtein', { n: f.protein ?? 0 })} · ${t('food.gCarbs', { n: f.carbs ?? 0 })} · ${t('food.gFat', { n: f.fat ?? 0 })}`
      : t('food.enterGrams');
  };
  grams.addEventListener('input', paint);
  paint();

  const add = async (alsoLog) => {
    const g = parseNumber(grams.value);
    if (g === null || g <= 0) { toast(t('food.howManyGrams')); grams.focus(); return; }
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
      toast(t('food.addedAndLogged', { name: food.name }));
    } else {
      toast(t('food.addedToList', { name: food.name }));
    }
  };

  openSheet(entry.name, el('div', {}, [
    el('label.field', {}, [el('span', { text: t('food.howMuch') }), grams]),
    preview,
    el('div.stack', {}, [
      el('button.btn.primary.full', { onclick: () => add(true) }, [t('food.addAndLog')]),
      el('button.btn.ghost.full', { onclick: () => add(false) }, [t('food.justAdd')]),
    ]),
    el('div.section-head', {}, [el('h2', { text: t('settings.sources') })]),
    el('div.small.muted', {
      text: kind === 'generic'
        ? t('food.sourceUsda', { name: entry.usda, known: cov.known, total: cov.total })
        : t('food.sourceOff', { code: entry.code, known: cov.known, total: cov.total }),
    }),
    el('div.small.faint', { style: { marginTop: '8px' },
      text: t(kind === 'generic' ? LIBRARY_ATTRIBUTION : BRAND_ATTRIBUTION) }),
  ]));
}

/**
 * @param draft  an Open Food Facts result, which carries per-100 g values and
 *               therefore needs a grams field the manual path does not.
 */
function foodForm(existing = null, day = dayKey(), draft = null) {
  const name = el('input', {
    type: 'text', placeholder: t('food.namePlaceholder'),
    value: existing ? existing.name : draft ? draft.name : '',
  });
  const portion = el('input', {
    type: 'text', placeholder: t('food.portionPlaceholder'),
    value: existing ? existing.portion : draft ? `${draft.suggestedGrams} g` : '',
  });
  const protein = normaliseOnBlur(numberInput({ decimal: true, value: existing ? existing.protein : '' }));
  const kcal = el('input', { type: 'number', inputmode: 'numeric', step: '1', min: '0', value: existing ? existing.kcal : '' });
  // Blank means unknown, not zero — see newFood. Leaving these empty is a
  // perfectly complete entry; it just keeps the day's split honest about it.
  const optional = (key) => normaliseOnBlur(numberInput({
    decimal: true,
    value: existing && existing[key] !== null && existing[key] !== undefined ? existing[key] : '',
    placeholder: t('food.optional'),
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
    if (!value) { toast(t('picker.needName')); name.focus(); return; }
    if (parseNumber(protein.value) === null) { toast(t('food.needProtein')); protein.focus(); return; }

    const fields = {
      name: value,
      portion: portion.value.trim() || t('food.defaultPortion'),
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
      toast(t('food.addedAndLogged', { name: food.name }));
    } else {
      toast(existing ? t('common.saved') : t('picker.added', { name: food.name }));
    }
  }

  openSheet(t(existing ? 'food.editFood' : draft ? 'food.fromBarcode' : 'food.newFood'), el('div', {}, [
    draft
      ? el('div.card.tight', { style: { marginBottom: '14px' } }, [
          el('div.small', { style: { fontWeight: '650' }, text: t('food.foundInOff') }),
          el('div.small.faint', { style: { marginTop: '2px' },
            text: t('food.per100Line', { protein: draft.per100.protein ?? '?' })
              + (draft.per100.kcal ? `, ${Math.round(draft.per100.kcal)} kcal` : '')
              + (draft.quantity ? ` · ${t('food.pack', { quantity: draft.quantity })}` : '') }),
          el('div.small.faint', { style: { marginTop: '4px' }, text: t('food.communityData') }),
        ])
      : null,

    el('label.field', {}, [el('span', { text: t('picker.field.name') }), name]),

    grams
      ? el('div', {}, [
          el('label.field', {}, [el('span', { text: t('food.howMuch') }), grams]),
          el('div.small.faint', { style: { marginTop: '-8px', marginBottom: '12px' },
            text: draft.servingLabel
              ? t('food.packetServing', { serving: draft.servingLabel })
              : t('food.noServing') }),
        ])
      : null,

    el('label.field', {}, [el('span', { text: t('food.portion') }), portion]),
    el('div.small.faint', { style: { marginTop: '-8px', marginBottom: '12px' }, text: t('food.portionNote') }),
    el('label.field', {}, [el('span', { text: t('food.proteinField') }), protein]),
    el('label.field', {}, [el('span', { text: t('food.caloriesField') }), kcal]),
    el('div.row', { style: { gap: '10px' } }, [
      el('label.field.grow', {}, [el('span', { text: t('food.carbsField') }), carbs]),
      el('label.field.grow', {}, [el('span', { text: t('food.fatField') }), fat]),
      el('label.field.grow', {}, [el('span', { text: t('food.fibreField') }), fibre]),
    ]),
    el('div.small.faint', { style: { marginTop: '-6px', marginBottom: '14px' }, text: t('food.blankMeansUnknown') }),
    el('div.small.faint', { style: { marginTop: '-8px', marginBottom: '14px' }, text: t('food.caloriesOptional') }),

    existing
      ? el('button.btn.primary.full', { onclick: () => submit(false) }, [t('common.save')])
      : el('div.stack', {}, [
          el('button.btn.primary.full', { onclick: () => submit(true) }, [t('food.addAndLogNow')]),
          el('button.btn.ghost.full', { onclick: () => submit(false) }, [t('food.justAdd')]),
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
    placeholder: t('food.barcodePlaceholder'),
  });
  const status = el('div.small.faint', { style: { marginTop: '10px' } });
  const go = el('button.btn.primary.full', { style: { marginTop: '12px' } }, [t('food.lookItUp')]);

  async function run() {
    if (go.disabled) return;
    const code = input.value.trim();
    if (!code) { input.focus(); return; }

    // Your own list wins over the network — a product you already added is
    // already correct for the portion you actually eat.
    const known = store.state.foods.find((f) => f.barcode && f.barcode === code.replace(/\D/g, ''));
    if (known) {
      closeSheet();
      await store.logMeal(known.id, { day });
      toast(t('food.loggedNamed', { name: known.name }));
      return;
    }

    go.disabled = true;
    status.style.color = 'var(--text-faint)';
    status.textContent = t('food.askingOff');

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

  openSheet(t('food.barcode'), el('div', {}, [
    el('div.small.muted', { text: t('food.barcodeIntro') }),
    el('label.field', { style: { marginTop: '12px' } }, [el('span', { text: t('food.barcodeField') }), input]),
    go,
    status,
    el('div.small.faint', { style: { marginTop: '16px' } }, [
      t('food.dataFrom') + ' ',
      el('a', { href: ATTRIBUTION.url, target: '_blank', rel: 'noopener', style: { color: 'var(--accent-hi)' } }, [ATTRIBUTION.name]),
      ', ' + t('credits.licensed') + ` ${ATTRIBUTION.licence}. ` + t('food.offCaveat'),
    ]),
  ]));
  setTimeout(() => input.focus(), 60);
}

function manageSheet() {
  const body = el('div');
  const paint = () => {
    body.replaceChildren();
    if (!store.state.foods.length) {
      body.append(el('div.small.muted', { text: t('food.listEmptyShort') }));
      return;
    }
    body.append(el('div.small.muted', { style: { marginBottom: '10px' }, text: t('food.deleteFoodNote') }));

    for (const f of store.state.foods) {
      body.append(
        el('div.row.between', {
          style: { padding: '9px 0', borderBottom: '1px solid var(--line-soft)', gap: '10px' },
        }, [
          el('div.grow', {}, [
            el('div', { style: { fontWeight: '600', fontSize: '14.5px' }, text: f.name }),
            el('div.small.faint', { text: `${f.portion} · ${Math.round(f.protein)} g`
              + (f.kcal ? ` · ${Math.round(f.kcal)} kcal` : '') + ` · ${f.uses || 0}×` }),
          ]),
          el('button.btn.sm.ghost', { onclick: () => { closeSheet(); foodForm(f); } }, [t('common.edit')]),
          el('button.btn.quiet.sm', {
            'aria-label': t('food.deleteNamed', { name: f.name }),
            onclick: async () => {
              const ok = await confirmSheet(t('food.deleteFoodTitle'), t('food.deleteFoodBody', { name: f.name }));
              if (!ok) return;
              await store.deleteFood(f.id);
              paint();
              toast(t('progress.deleted'));
            },
          }, ['×']),
        ])
      );
    }
  };
  paint();
  openSheet(t('food.myFoods'), body);
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

  wrap.append(el('div.section-head', {}, [el('h2', { text: t('food.last14') })]));

  if (!logged.length) {
    wrap.append(el('div.card', {}, [
      el('div.small.muted', { text: t('food.last14Empty') }),
    ]));
    return wrap;
  }

  const METRICS = [
    { key: 'protein', label: t('food.protein'), unit: 'g' },
    { key: 'kcal', label: t('food.calories'), unit: 'kcal' },
    { key: 'carbs', label: t('food.carbs'), unit: 'g' },
    { key: 'fat', label: t('food.fat'), unit: 'g' },
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
          tip: d.logged ? `${fmtNum(d[m.key])} ${m.unit}` : t('food.notLogged'),
          dim: !d.logged,
        })),
        {
          caption: (band
            ? t('food.dailyAgainst', {
                metric: m.label,
                target: `${fmtNum(band.low)}${band.low === band.high ? '' : `–${fmtNum(band.high)}`} ${m.unit}`,
              })
            : t('food.daily', { metric: m.label }))
            + ' ' + t('food.blankNotZero'),
          height: 150, everyNthLabel: 2,
        }
      ),
      el('div.small.faint', { style: { marginTop: '10px' },
        text: mean === null
          ? t('food.noneCarry', { metric: m.label })
          : t('food.averageAcross', { mean: `${fmtNum(mean)} ${m.unit}`, days: tn(withValue.length, 'unit.day') })
            + (band ? ` ${t('food.insideTarget', { n: inBand })}` : '') })
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
    el('h2', { text: t('food.bodyweightDirection') }),
    el('button.btn.quiet.sm', { onclick: () => navigate('progress') }, [`${t('home.link.charts')} ›`]),
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
            text: t('food.trendSpan', {
              from: fmtWeight(trend.from.weight, units),
              to: fmtWeight(trend.to.weight, units),
              weeks: tn(trend.spanWeeks, 'unit.week'),
            }) })
        : null,
      el('div.small.muted', { style: { marginTop: '10px' }, text: t('food.paceNote') }),
    ])
  );

  wrap.append(maintenanceSection());

  // The way in to the shared timeline. It lives on Progress because that is
  // where the training half already is, and a second copy of the same three
  // charts here would be two screens to keep in step.
  wrap.append(
    el('button.btn.ghost.full.sm', {
      style: { marginTop: '14px' },
      onclick: () => navigate('progress'),
    }, [`${t('timeline.wayIn')} ›`])
  );
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

  wrap.append(el('div.section-head', {}, [el('h2', { text: t('food.maintenance') })]));

  if (!est.ok) {
    const why = {
      days: t('food.needDays', { needed: est.needed, window: est.days, logged: est.logged }),
      weight: t('food.needWeighins'),
      span: t('food.needSpan', { days: tn(est.spanDays, 'unit.day') }),
    }[est.reason];

    wrap.append(el('div.card', {}, [
      el('div.small.muted', { text: why }),
      el('div.small.faint', { style: { marginTop: '8px' }, text: t('food.worthTheWait') }),
    ]));
    return wrap;
  }

  const direction = est.kgPerWeek > 0.05 ? 'gaining' : est.kgPerWeek < -0.05 ? 'losing' : 'holding';
  wrap.append(
    el('div.card.glow', {}, [
      el('div', { style: { fontSize: '30px', fontWeight: '750', letterSpacing: '-0.03em', lineHeight: '1' },
        text: `${fmtNum(est.maintenance)} kcal` }),
      el('div.small.faint', { style: { marginTop: '3px' }, text: t('food.aDayToHold') }),
      el('div.small.muted', { style: { marginTop: '10px' },
        text: direction === 'holding'
          ? t('food.averagedHolding', { kcal: fmtNum(est.meanIntake), days: tn(est.loggedDays, 'unit.loggedDay') })
          : t(direction === 'gaining' ? 'food.averagedGaining' : 'food.averagedLosing', {
              kcal: fmtNum(est.meanIntake),
              days: tn(est.loggedDays, 'unit.loggedDay'),
              kg: Math.abs(est.kgPerWeek),
            }) }),
      el('button.btn.quiet.sm', { style: { padding: '4px 0', marginTop: '2px' }, onclick: maintenanceSheet },
        [t('food.howWorkedOut')]),
    ])
  );
  return wrap;
}

function maintenanceSheet() {
  const s = SOURCES.wishnofsky;
  openSheet(t('food.maintenance'), el('div', {}, [
    el('div.small.muted', { text: t('food.maintIntro') }),

    el('div.section-head', {}, [el('h2', { text: t('food.whyNotCalculator') })]),
    el('div.small.muted', { text: t('food.whyNotCalculatorBody') }),

    el('div.section-head', {}, [el('h2', { text: t('food.cannotFix') })]),
    el('div.small.muted', { text: t('food.cannotFixBody') }),

    el('div.section-head', {}, [el('h2', { text: t('food.oneConstant') })]),
    el('div.small.muted', { text: t(s.says) }),
    el('a', {
      href: s.url, target: '_blank', rel: 'noopener',
      style: { color: 'var(--accent-hi)', fontWeight: '620', fontSize: '14px' },
      text: `${s.short} ↗`,
    }),
  ]));
}
