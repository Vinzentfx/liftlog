// Nutrition — today's log, your own food list, and the protein target.
//
// Deliberately small. Three numbers (protein, calories, bodyweight) and a list
// you build yourself. No food database, no barcode, no network: 95% of what
// anyone eats is the same thirty things, and typing those thirty in once is
// less work than fighting a catalogue of three million products forever.
//
// Every food entry is source-agnostic — name, portion, protein, calories — so a
// barcode lookup or a photo draft can fill the same fields later without any of
// this changing.

import {
  el, toast, openSheet, closeSheet, confirmSheet, emptyState, listItem, fmtNum, fmtWeight, fmtDate,
} from '../ui.js';
import * as store from '../store.js';
import { dayKey } from '../models.js';
import {
  proteinTarget, dayTotals, proteinVerdict, proteinHistory, proteinSummary,
  weightTrend, trendVerdict,
} from '../nutrition.js';
import { THRESHOLDS, SOURCES } from '../evidence.js';
import { barChart } from '../charts.js';
import { navigate } from '../app.js';

let viewDay = null;   // null = today; set by the date stepper

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
  root.append(mealList(meals, day));
  root.append(quickAdd(day));
  root.append(trendSection());

  return root;
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

function targetCard(totals, target) {
  const verdict = proteinVerdict(totals.protein, target);
  const tone = { hit: 'var(--good)', over: 'var(--text-dim)', under: 'var(--warn)', unknown: 'var(--text-faint)' }[verdict.state];

  const card = el('div.card.glow', {}, [
    el('div.row.between', { style: { alignItems: 'flex-end' } }, [
      el('div', {}, [
        el('div', { style: { fontSize: '30px', fontWeight: '750', letterSpacing: '-0.03em', lineHeight: '1' },
          text: `${totals.protein} g` }),
        el('div.small.faint', { style: { marginTop: '3px' }, text: 'protein today' }),
      ]),
      totals.kcal
        ? el('div', { style: { textAlign: 'right' } }, [
            el('div', { style: { fontSize: '19px', fontWeight: '680' }, text: fmtNum(totals.kcal) }),
            el('div.small.faint', { text: 'kcal' }),
          ])
        : null,
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

  card.append(el('div.small', { style: { marginTop: '8px', color: tone }, text: verdict.text }));

  card.append(
    el('button.btn.quiet.sm', {
      style: { padding: '4px 0', marginTop: '2px' },
      onclick: targetSheet,
    }, ['Where does this target come from?'])
  );

  return card;
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

function mealList(meals, day) {
  const wrap = el('div');
  wrap.append(el('div.section-head', {}, [el('h2', { text: 'Logged' })]));

  if (!meals.length) {
    wrap.append(el('div.card', {}, [
      el('div.small.muted', { text: 'Nothing logged for this day yet. Pick something from your list below, or add a new food.' }),
    ]));
    return wrap;
  }

  for (const m of meals) {
    wrap.append(
      el('div.row.between', {
        style: { padding: '10px 0', borderBottom: '1px solid var(--line-soft)', gap: '10px' },
      }, [
        el('div.grow', {}, [
          el('div', { style: { fontWeight: '600', fontSize: '14.5px' },
            text: m.amount === 1 ? m.name : `${m.amount}× ${m.name}` }),
          el('div.small.faint', { text: `${m.portion}${m.kcal ? ` · ${Math.round(m.kcal)} kcal` : ''}` }),
        ]),
        el('div', { style: { fontWeight: '680', fontSize: '15px', whiteSpace: 'nowrap' },
          text: `${Math.round(m.protein)} g` }),
        el('button.btn.quiet.sm', {
          'aria-label': `Remove ${m.name}`,
          onclick: async () => { await store.deleteMeal(m.id); toast('Removed'); },
        }, ['×']),
      ])
    );
  }
  void day;
  return wrap;
}

/* ======================= the food list ======================= */

function quickAdd(day) {
  const wrap = el('div');
  const foods = store.state.foods;

  wrap.append(el('div.section-head', {}, [
    el('h2', { text: 'My foods' }),
    el('button.btn.quiet.sm', { onclick: () => foodForm(null, day) }, ['+ New']),
  ]));

  if (!foods.length) {
    wrap.append(emptyState(
      'Your list is empty',
      'Add the things you actually eat — protein and calories per portion. Thirty entries covers almost everyone, and after that logging is one tap.',
      el('button.btn.primary', { style: { marginTop: '14px' }, onclick: () => foodForm(null, day) }, ['Add your first food'])
    ));
    return wrap;
  }

  const search = el('input', {
    type: 'text', placeholder: `Search ${foods.length} foods…`,
    autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
  });
  const list = el('div');

  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const found = q ? foods.filter((f) => f.name.toLowerCase().includes(q)) : foods.slice(0, 12);
    list.replaceChildren();

    if (!found.length) {
      list.append(el('div.small.faint', { style: { padding: '10px 0' }, text: 'Nothing matches. Add it as a new food.' }));
      return;
    }
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
    if (!q && foods.length > 12) {
      list.append(el('div.small.faint', { style: { textAlign: 'center' }, text: `Search to reach the other ${foods.length - 12}` }));
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

function foodForm(existing = null, day = dayKey()) {
  const name = el('input', { type: 'text', value: existing ? existing.name : '', placeholder: 'e.g. Magerquark 250 g' });
  const portion = el('input', { type: 'text', value: existing ? existing.portion : '', placeholder: 'e.g. 250 g, 1 Scoop, 1 Riegel' });
  const protein = el('input', { type: 'number', inputmode: 'decimal', step: '0.1', min: '0', value: existing ? existing.protein : '' });
  const kcal = el('input', { type: 'number', inputmode: 'numeric', step: '1', min: '0', value: existing ? existing.kcal : '' });

  async function submit(alsoLog) {
    const value = name.value.trim();
    if (!value) { toast('Give it a name'); name.focus(); return; }
    if (!protein.value) { toast('Protein per portion is the one number this needs'); protein.focus(); return; }

    const fields = {
      name: value,
      portion: portion.value.trim() || '1 Portion',
      protein: Number(protein.value),
      kcal: Number(kcal.value) || 0,
    };

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

  openSheet(existing ? 'Edit food' : 'New food', el('div', {}, [
    el('label.field', {}, [el('span', { text: 'Name' }), name]),
    el('label.field', {}, [el('span', { text: 'Portion' }), portion]),
    el('div.small.faint', { style: { marginTop: '-8px', marginBottom: '12px' },
      text: 'Whatever unit you actually eat it in — a weight, a scoop, a bar. The numbers below are per one of those.' }),
    el('label.field', {}, [el('span', { text: 'Protein (g)' }), protein]),
    el('label.field', {}, [el('span', { text: 'Calories (optional)' }), kcal]),
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

function trendSection() {
  const wrap = el('div');
  const units = store.units();
  const target = proteinTarget(store.state.settings);
  const history = proteinHistory(store.state.meals, 14);
  const summary = proteinSummary(history, target);

  wrap.append(el('div.section-head', {}, [el('h2', { text: 'Last 14 days' })]));

  if (!summary.logged) {
    wrap.append(el('div.card', {}, [
      el('div.small.muted', { text: 'Log a few days and the pattern shows up here — plus how it lines up with your bodyweight and your lifts.' }),
    ]));
    return wrap;
  }

  wrap.append(
    el('div.card', {}, [
      barChart(
        history.map((d) => ({
          label: d.day,
          short: d.day.slice(8),
          value: d.protein,
          tip: d.logged ? `${d.protein} g` : 'not logged',
          dim: !d.logged,
        })),
        {
          caption: target
            ? `Daily protein against your ${target.low} g floor. Days you did not log are blank, not zero.`
            : 'Daily protein. Add your bodyweight to get a target line.',
          height: 150, everyNthLabel: 2,
        }
      ),
      el('div.small.faint', { style: { marginTop: '10px' },
        text: summary.hitRate !== null
          ? `${summary.mean} g average across ${summary.logged} logged ${summary.logged === 1 ? 'day' : 'days'} — ${Math.round(summary.hitRate * 100)}% cleared ${target.low} g.`
          : `${summary.mean} g average across ${summary.logged} logged ${summary.logged === 1 ? 'day' : 'days'}.` }),
    ])
  );

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

  return wrap;
}
