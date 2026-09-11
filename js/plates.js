// Was auf die Stange muss.
//
// Reine Rechnerei, aber genau die, auf die zwischen zwei Sätzen mit dem Handy in
// der Hand keiner Lust hat: eine Langhantel wird symmetrisch beladen, gesucht ist
// also die halbe Last minus die halbe Stange, ausgedrückt in Scheiben, die es im
// Studio wirklich gibt.
//
// Geht das Ziel nicht genau auf, wird das auch so gesagt. Die meisten Studios
// haben nichts unter 1,25 kg, 101 kg lassen sich also nicht stecken. "101 kg" mit
// einer Scheibenliste anzuzeigen, die 100 ergibt, wäre eine kleine tägliche Lüge.

/**
 * Übliche Scheibensätze. Keine Erkenntnis, einfach das, was im Ständer liegt.
 * Hat ein Studio andere Scheiben, fällt das auf, weil die Antwort jede einzelne
 * nennt. Eine fehlende Größe wird also nicht stillschweigend angenommen.
 */
export const PLATES = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
};

/** Olympia-Stangen. Die Einstellung hat Vorrang, das hier ist nur der Startwert. */
export const DEFAULT_BAR = { kg: 20, lb: 45 };

/**
 * @returns {{perSide: number[], loaded: number, off: number, exact: boolean,
 *            barOnly: boolean} | null}
 *   `off` hat ein Vorzeichen: wie weit die steckbare Last vom Wunsch abweicht.
 *   null, wenn das Ziel unter der Stange liegt, dann gibt es nichts zu sagen.
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
    // Etwas Spielraum: 0,1 kg Rundungsrest ist keine Scheibe.
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

/** "2 × 20, 1 × 5", so wie man es laut sagen würde. */
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
