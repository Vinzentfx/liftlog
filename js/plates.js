// What to hang on the bar.
//
// Pure arithmetic, but the kind nobody wants to do between sets with a phone in
// one hand: a barbell is loaded symmetrically, so the interesting number is half
// the load minus half the bar, expressed in the discs a gym actually owns.
//
// It answers honestly when it cannot hit the number exactly. Most gyms have
// nothing below 1.25 kg, so a 101 kg target is not loadable and saying "101 kg"
// with a plate list that adds to 100 would be a small lie told daily.

/**
 * Standard commercial sets. Not a finding, just what is on the rack — a gym
 * with different discs is handled by the fact that the answer names every one
 * of them, so a missing size is obvious rather than silently assumed.
 */
export const PLATES = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
};

/** Olympic bars. The setting overrides it; this is only the starting value. */
export const DEFAULT_BAR = { kg: 20, lb: 45 };

/**
 * @returns {{perSide: number[], loaded: number, off: number, exact: boolean,
 *            barOnly: boolean} | null}
 *   `off` is signed: how far the loadable total lands from what was asked for.
 *   null when the target is below the bar — there is nothing to say about it.
 */
export function platePlan(target, barWeight, units = 'kg') {
  const total = Number(target);
  const bar = Number(barWeight);
  if (!Number.isFinite(total) || !Number.isFinite(bar) || bar < 0) return null;
  if (total < bar) return null;

  const sizes = PLATES[units] || PLATES.kg;
  let perSide = (total - bar) / 2;
  const chosen = [];

  for (const plate of sizes) {
    // A hair of tolerance: 0.1 kg of floating-point residue is not a plate.
    while (perSide + 1e-9 >= plate) {
      chosen.push(plate);
      perSide -= plate;
    }
  }

  const loaded = bar + chosen.reduce((n, p) => n + p, 0) * 2;
  return {
    perSide: chosen,
    loaded: Math.round(loaded * 100) / 100,
    off: Math.round((loaded - total) * 100) / 100,
    exact: Math.abs(loaded - total) < 1e-9,
    barOnly: chosen.length === 0,
  };
}

/** "2 × 20, 1 × 5" — how you would say it out loud. */
export function describePlates(perSide) {
  if (!perSide.length) return 'just the bar';
  const counts = [];
  for (const p of perSide) {
    const last = counts[counts.length - 1];
    if (last && last.plate === p) last.n++;
    else counts.push({ plate: p, n: 1 });
  }
  return counts.map(({ plate, n }) => `${n} × ${plate}`).join(', ');
}
