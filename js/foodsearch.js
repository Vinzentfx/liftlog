// Suche in der mitgelieferten Bibliothek allgemeiner Lebensmittel.
//
// Die gibt es, weil sich Open Food Facts vom Browser aus nicht nach Namen
// durchsuchen lässt. Die Freitextsuche (search.openfoodfacts.org) schickt keinen
// access-control-allow-origin-Header, die Anfrage geht also nie raus. api/v2/search
// nimmt einen `search_terms`-Parameter an und ignoriert ihn dann, zurück kommt die
// ganze Datenbank in beliebiger Reihenfolge. Ein Suchfeld daran sähe aus, als
// würde es funktionieren, und liefert Unsinn. Beides wurde gegen den Barcode-
// Endpunkt geprüft, der den Header schickt und weiterhin funktioniert.
//
// Allgemeine Lebensmittel kommen deshalb mit der App mit, aus USDA FoodData
// Central. Das ist gemeinfrei und darf weitergegeben werden, anders als die
// ODbL-Daten von OFF, bei denen ein mitgelieferter Auszug eine abgeleitete
// Datenbank mit Share-Alike-Pflichten wäre. Nebenbei funktioniert die Suche so
// auch im Flugmodus.
//
// Markenprodukte bleiben beim Barcode. Diese Bibliothek sind die Grundzutaten,
// aus denen eine Mahlzeit besteht.

import { FOOD_LIBRARY } from './food-library.js';
import { BRAND_LIBRARY } from './brand-library.js';
import { NUTRIENTS, CORE_KEYS } from './nutrition.js';
import { nutritionLooksPlausible } from './foodlookup.js';

const GERMAN_ALIASES = new Map([
  ['hähnchen', 'chicken'], ['huhn', 'chicken'], ['hackfleisch', 'beef mince'],
  ['magerquark', 'cottage cheese'], ['quark', 'cottage cheese'], ['joghurt', 'yoghurt'],
  ['haferflocken', 'oats'], ['reis', 'rice'], ['nudeln', 'pasta'], ['vollkornnudeln', 'pasta wholemeal'],
  ['kartoffel', 'potato'], ['süßkartoffel', 'sweet potato'], ['erdnussbutter', 'peanut butter'],
  ['erdbeeren', 'strawberries'], ['blaubeeren', 'blueberries'], ['himbeeren', 'raspberries'],
  ['apfel', 'apple'], ['banane', 'banana'], ['gurke', 'cucumber'], ['paprika', 'bell pepper'],
  ['zwiebel', 'onion'], ['knoblauch', 'garlic'], ['käse', 'cheese'], ['milch', 'milk'],
]);

/**
 * Beide Bibliotheken auf einmal, allgemeine zuerst.
 *
 * Allgemeine Einträge stehen vorne, weil sie gemessen sind (USDA hat das
 * Lebensmittel analysiert), während eine Markenzeile das ist, was jemand von
 * einer Packung abgetippt hat. Können beide "Hähnchen" beantworten, soll das
 * Gemessene zuerst kommen.
 *
 * Jedes Ergebnis hat ein `kind`, und die Oberfläche hält beide sichtbar
 * auseinander. Woher eine Zahl kommt, gehört hier zur Zahl dazu.
 */
export function searchFoods(query, { limit = 25 } = {}) {
  const original = String(query || '').trim().toLowerCase();
  const translated = GERMAN_ALIASES.get(original);
  if (original.length < 2) return [];

  const variants = [...new Set([original, translated].filter(Boolean))];
  const rank = (haystack) => {
    const h = haystack.toLowerCase();
    let best = null;
    for (const variant of variants) {
      const words = variant.split(/\s+/);
      if (!words.every((word) => h.includes(word))) continue;
      const score = h.startsWith(variant) ? 0 : h.indexOf(words[0]) + 1;
      best = best === null ? score : Math.min(best, score);
    }
    return best;
  };

  const out = [];
  for (const food of FOOD_LIBRARY) {
    const score = rank(food.name);
    if (score !== null) out.push({ kind: 'generic', score, entry: food, name: food.name });
  }
  for (const product of BRAND_LIBRARY) {
    // Die Marke zählt als durchsuchbarer Text: "milka" soll die Produkte auch
    // finden, wenn die Marke nicht noch einmal im Produktnamen steht.
    const score = rank(`${product.name} ${product.brand || ''}`);
    // + 100 hält allgemeine Einträge bei gleich guter Übereinstimmung vor den Marken.
    if (score !== null && nutritionLooksPlausible(product.per100)) {
      out.push({ kind: 'brand', score: score + 100, entry: product, name: product.name });
    }
  }

  return out
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Nur die allgemeine Bibliothek, für Aufrufer, die die gemessenen Zeilen wollen. */
export function searchLibrary(query, limit = 25) {
  return searchFoods(query, { limit })
    .filter((r) => r.kind === 'generic')
    .map((r) => r.entry);
}

/**
 * Ein Eintrag aus der Bibliothek, auf eine Portion gerechnet, in der Form, die
 * store.addFood erwartet.
 *
 * Alles, was die Quelle hat, wird übernommen: Grundwerte flach, der Rest unter
 * `micros`. Was die Quelle nicht hat, bleibt weg und wird nicht zu null. Ein
 * Lebensmittel ohne Angabe zu Vitamin D hat unbekanntes Vitamin D.
 */
export function toFoodFields(entry, grams) {
  const factor = (Number(grams) || 0) / 100;
  const fields = {
    name: entry.name,
    portion: `${Math.round(grams)} g`,
    portionGrams: Math.round(grams),
    source: 'library',
    micros: {},
    // Bleibt erhalten, damit die Portion später neu gerechnet werden kann, genau
    // wie der Barcode-Weg seine Basis pro 100 g behält.
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

  // Eiweiß ist das einzige Feld, von dem der Rest der App annimmt, dass es existiert.
  if (fields.protein === undefined) fields.protein = 0;
  return fields;
}

/** Wie viele der Nährwerte aus der Bibliothek dieser Eintrag wirklich hat. */
export function coverage(entry) {
  const known = NUTRIENTS.filter((n) => entry.per100[n.key] !== undefined && entry.per100[n.key] !== null);
  return { known: known.length, total: NUTRIENTS.length };
}

export const LIBRARY_SIZE = FOOD_LIBRARY.length;
export const BRAND_SIZE = BRAND_LIBRARY.length;
export const TOTAL_SIZE = LIBRARY_SIZE + BRAND_SIZE;

export const LIBRARY_ATTRIBUTION = 'attribution.usda';

export const BRAND_ATTRIBUTION = 'attribution.off';
