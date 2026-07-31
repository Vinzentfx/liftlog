// Plan blueprints and the exercise picker that fills them.
//
// A blueprint describes a day as muscle *slots* rather than fixed exercise
// names: "Push = 3 chest, 2 front delt, 2 triceps". Every slot is one exercise
// at SETS_PER_EXERCISE sets, which is what makes "more exercises, fewer sets
// each" the default rather than something you have to assemble by hand.
//
// Slot counts are chosen so each muscle lands in the 10-20 weekly set range at
// 2x frequency — see js/plan-rating.js for why those are the targets.

import { rateExercise } from './exercise-rating.js';
import { isBenchmark } from './standards.js';

// Fallbacks, not policy. The user can change both in Settings; these are what a
// blueprint uses when nobody has said otherwise, and the reasoning for the
// numbers is in the slot-count comment above.
export const SETS_PER_EXERCISE = 2;
export const REP_TARGET = '6-10';

export const PLAN_BLUEPRINTS = [
  {
    key: 'pplul',
    name: 'PPL + Upper / Lower',
    blurb: 'blueprint.ppl',
    recommended: true,
    days: [
      { name: 'Push',  slots: [['chest', 3], ['delts-front', 2], ['triceps', 2]] },
      // Rear delts get 2 slots here and 2 on Upper: pressing loads the front
      // head heavily as a secondary, so the rear needs direct work to keep up.
      { name: 'Pull',  slots: [['lats', 3], ['delts-rear', 2], ['biceps', 2], ['abs', 1]] },
      { name: 'Legs',  slots: [['quads', 3], ['hamstrings', 2], ['glutes', 1], ['calves', 2]] },
      { name: 'Upper', slots: [['chest', 2], ['lats', 2], ['delts-rear', 2], ['biceps', 1], ['triceps', 1]] },
      { name: 'Lower', slots: [['quads', 2], ['hamstrings', 2], ['glutes', 2], ['calves', 1], ['abs', 1]] },
    ],
  },
  {
    key: 'ppl',
    name: 'Push / Pull / Legs',
    blurb: 'blueprint.fullSplit',
    perWeek: 2,
    days: [
      // Halved versus a once-weekly plan — this cycle runs twice, so the slot
      // counts here are per session, not per week.
      { name: 'Push', slots: [['chest', 3], ['delts-front', 1], ['triceps', 1]] },
      { name: 'Pull', slots: [['lats', 3], ['delts-rear', 1], ['biceps', 1]] },
      { name: 'Legs', slots: [['quads', 2], ['hamstrings', 2], ['glutes', 1], ['calves', 1], ['abs', 1]] },
    ],
  },
  {
    key: 'ul',
    name: 'Upper / Lower',
    blurb: 'blueprint.upperLower',
    days: [
      { name: 'Upper A', slots: [['chest', 3], ['lats', 3], ['delts-rear', 1], ['biceps', 1], ['triceps', 1]] },
      { name: 'Lower A', slots: [['quads', 3], ['hamstrings', 2], ['glutes', 1], ['calves', 2], ['abs', 1]] },
      { name: 'Upper B', slots: [['lats', 3], ['chest', 2], ['delts-rear', 2], ['biceps', 1], ['triceps', 1]] },
      { name: 'Lower B', slots: [['hamstrings', 3], ['quads', 2], ['glutes', 1], ['calves', 1], ['abs', 2]] },
    ],
  },
  {
    key: 'fullbody',
    name: 'Full Body',
    perWeek: 1,
    blurb: 'blueprint.fullBody',
    days: [
      { name: 'Day A', slots: [['quads', 2], ['chest', 2], ['lats', 2], ['delts-front', 1], ['calves', 1]] },
      { name: 'Day B', slots: [['hamstrings', 2], ['lats', 2], ['delts-rear', 1], ['triceps', 1], ['biceps', 1], ['abs', 1]] },
      { name: 'Day C', slots: [['glutes', 2], ['chest', 2], ['quads', 1], ['delts-rear', 1], ['triceps', 1], ['calves', 1]] },
    ],
  },
];

/**
 * Rank candidates for one muscle slot.
 *
 * Favourites win outright — if the user has starred a movement they will
 * actually do it, which beats any score. After that it's exercise quality, then
 * a nudge toward starting with a compound.
 */
/**
 * Movements the catalogue files under a muscle but which are mobility drills,
 * warm-ups or explosive lifts — fine to log, wrong to auto-prescribe as a
 * hypertrophy set. Caught by name because the source data has no reliable flag
 * for it once the category field is dropped.
 */
export const NOT_FOR_SLOTS = /(circle|balance board|bosu|stretch|warm[- ]?up|foam roll|mobility|\bclean\b|\bsnatch\b|\bjerk\b|\bjump|\bhop\b|plyo|wall sit|breathing|muscle up|\bsprint\b|\bdrill\b|\bchair\b|\bthrow\b|sled|\bdrag\b|\bcuban\b|rotation|isometric|\bneck\b)/i;

/**
 * Best unused movement for a muscle. Exported so the plan doctor fills a gap
 * with exactly the exercise the generator would have picked — a plan that gets
 * repaired by hand and one that gets generated should not disagree.
 */
export function pickForRegion(region, exercises, { used = new Set(), preferCompound = false } = {}) {
  const ranked = rankFor(region, exercises, { used, preferCompound });
  return ranked.length ? ranked[0].ex : null;
}

function rankFor(region, exercises, { used, preferCompound }) {
  const out = [];
  for (const ex of exercises) {
    if (used.has(ex.id)) continue;
    if (!(ex.primary || []).includes(region)) continue;
    if (NOT_FOR_SLOTS.test(ex.name)) continue;

    const rating = rateExercise(ex);
    let score = rating ? rating.stars : 2;
    if (ex.favourite) score += 10;
    // Your own rating outranks the evidence one, and it can veto: a movement
    // you scored 1 or 2 stars is one that hurts, that your gym does not have,
    // or that you simply will not do. The best exercise you skip is worth zero.
    if (ex.myRating) score += (ex.myRating - 3) * 2.5;
    // Benchmark lifts are the movements with published standards and the most
    // coaching material. The bonus has to stay large: the rating scores what a
    // movement *is*, and by that measure "Chair Squat" and "Lunge Sprint" —
    // catalogue oddities tagged Machine — score as well as a hack squat. Only
    // this bonus keeps a generated plan built out of movements that exist in
    // real gyms.
    if (isBenchmark(ex.name)) score += 3;
    // A movement the length-bias rules recognise is a movement the app can
    // reason about — and in practice that set is the staples, not the 900
    // catalogue oddities.
    if (rating && rating.length.classified) score += 1;
    // Obscure one-off variants shouldn't outrank a staple just because the
    // catalogue tagged them compound.
    if (!ex.instructions || ex.instructions.length < 2) score -= 1.5;
    if (preferCompound && ex.mech === 'compound') score += 1.5;
    if (!preferCompound && ex.mech === 'isolation') score += 0.5;
    // A movement with no written steps and no art is a poor thing to hand
    // someone who has never done it.
    if (!(ex.instructions || []).length) score -= 0.5;

    out.push({ ex, score });
  }
  return out.sort((a, b) => b.score - a.score || a.ex.name.localeCompare(b.ex.name));
}

/**
 * Fill a blueprint with real exercises.
 *
 * @param blueprint  a PLAN_BLUEPRINTS entry
 * @param exercises  the full library
 * @param opts       { empty } — true returns the day layout with no exercises
 */
export function buildPlanDays(blueprint, exercises, { empty = false, sets = SETS_PER_EXERCISE, reps = REP_TARGET } = {}) {
  if (empty) {
    return blueprint.days.map((d) => ({
      id: uid(),
      name: d.name,
      items: [],
      // kept so the empty plan can still tell you what it expects
      target: d.slots.map(([region, n]) => ({ region, slots: n })),
    }));
  }

  // Used across the whole plan so the same movement doesn't appear on two days
  // — variety is the point of the slot system.
  const used = new Set();

  return blueprint.days.map((day) => {
    const items = [];
    for (const [region, count] of day.slots) {
      for (let i = 0; i < count; i++) {
        let ranked = rankFor(region, exercises, { used, preferCompound: i === 0 });
        // Some regions have a very small pool (rear delts especially). Rather
        // than silently dropping the slot — which quietly under-trains that
        // muscle — allow a repeat once the unused candidates run out.
        if (!ranked.length) ranked = rankFor(region, exercises, { used: new Set(), preferCompound: false });
        const pick = ranked[0];
        if (!pick) continue;
        used.add(pick.ex.id);
        items.push({
          exerciseId: pick.ex.id,
          targetSets: sets,
          targetReps: reps,
          note: '',
        });
      }
    }
    return { id: uid(), name: day.name, items, target: day.slots.map(([region, n]) => ({ region, slots: n })) };
  });
}

function uid() {
  return `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
