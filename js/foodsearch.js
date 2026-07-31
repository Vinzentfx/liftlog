// Searching the bundled generic-food library.
//
// This exists because Open Food Facts cannot be searched by name from a
// browser. Its free-text service (search.openfoodfacts.org) sends no
// access-control-allow-origin header, so the request never leaves; its
// api/v2/search accepts a `search_terms` parameter and then ignores it,
// answering with the whole database in arbitrary order — a search box wired to
// that would look like it worked and return nonsense. Both were checked against
// the barcode endpoint, which does send the header and does still work.
//
// So generic foods ship with the app, from USDA FoodData Central, which is
// public domain and can therefore be redistributed — unlike OFF's ODbL data,
// where a bundled dump would be a derived database with share-alike duties.
// The happy side effect is that search works in flight mode.
//
// Branded products stay on the barcode path. This library is the raw
// ingredients a meal is built from.

import { FOOD_LIBRARY } from './food-library.js';
import { BRAND_LIBRARY } from './brand-library.js';
import { NUTRIENTS, CORE_KEYS } from './nutrition.js';

/**
 * Both libraries at once, generic first.
 *
 * Generic entries lead because they are measured — USDA analysed the food —
 * while a branded row is whatever a contributor typed off a packet. When both
 * could answer "chicken", the measured one should be the first offer.
 *
 * Every result carries `kind`, and the UI keeps them visibly apart. A number's
 * provenance is part of the number here.
 */
export function searchFoods(query, { limit = 25 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];

  const words = q.split(/\s+/);
  const rank = (haystack) => {
    const h = haystack.toLowerCase();
    if (!words.every((w) => h.includes(w))) return null;
    return h.startsWith(q) ? 0 : h.indexOf(words[0]) + 1;
  };

  const out = [];
  for (const food of FOOD_LIBRARY) {
    const score = rank(food.name);
    if (score !== null) out.push({ kind: 'generic', score, entry: food, name: food.name });
  }
  for (const product of BRAND_LIBRARY) {
    // Brand counts as searchable text: "milka" should find its products even
    // when the brand is not repeated in the product name.
    const score = rank(`${product.name} ${product.brand || ''}`);
    // + 100 keeps generics ahead of brands at equal quality of match.
    if (score !== null) out.push({ kind: 'brand', score: score + 100, entry: product, name: product.name });
  }

  return out
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Generic library only — kept for callers that want the measured rows. */
export function searchLibrary(query, limit = 25) {
  return searchFoods(query, { limit })
    .filter((r) => r.kind === 'generic')
    .map((r) => r.entry);
}

/**
 * A library entry scaled to a portion, in the shape store.addFood expects.
 *
 * Everything the source has is carried across, core values flat and the rest
 * under `micros`. Anything the source lacks stays absent rather than becoming
 * zero — a food with no vitamin D figure has unknown vitamin D.
 */
export function toFoodFields(entry, grams) {
  const factor = (Number(grams) || 0) / 100;
  const fields = {
    name: entry.name,
    portion: `${Math.round(grams)} g`,
    portionGrams: Math.round(grams),
    source: 'library',
    micros: {},
    // Kept so the portion can be re-scaled later without re-deriving it, the
    // same way the barcode path keeps its per-100 g basis.
    per100: { ...entry.per100 },
    fdcId: entry.fdcId,
  };

  for (const n of NUTRIENTS) {
    const per100 = entry.per100[n.key];
    if (per100 === undefined || per100 === null) continue;
    const value = n.key === 'kcal'
      ? Math.round(per100 * factor)
      : Math.round(per100 * factor * 10) / 10;
    if (CORE_KEYS.includes(n.key)) fields[n.key] = value;
    else fields.micros[n.key] = value;
  }

  // Protein is the one field the rest of the app assumes exists.
  if (fields.protein === undefined) fields.protein = 0;
  return fields;
}

/** How many of the library's nutrients this entry actually carries. */
export function coverage(entry) {
  const known = NUTRIENTS.filter((n) => entry.per100[n.key] !== undefined && entry.per100[n.key] !== null);
  return { known: known.length, total: NUTRIENTS.length };
}

export const LIBRARY_SIZE = FOOD_LIBRARY.length;
export const BRAND_SIZE = BRAND_LIBRARY.length;
export const TOTAL_SIZE = LIBRARY_SIZE + BRAND_SIZE;

export const LIBRARY_ATTRIBUTION = 'attribution.usda';

export const BRAND_ATTRIBUTION = 'attribution.off';
