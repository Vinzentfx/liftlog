// Barcode lookup against Open Food Facts.
//
// The only part of this app that needs the network, and it is deliberately
// isolated here so the boundary is obvious: everything else — logging, targets,
// the whole training side — works with the phone in flight mode. A failed
// lookup falls back to typing the numbers in, which is what you would have done
// anyway.
//
// No barcode *scanning*: no browser on iOS implements BarcodeDetector, and the
// WebAssembly alternatives would break "no dependencies, no build step". You
// type the 13 digits printed under the stripes once per new product, and never
// again — the code is stored on the food, so a re-lookup answers from your own
// list without touching the network.
//
// Licence: the Open Food Facts database is ODbL (structure) and DbCL (content).
// Querying the live API and caching what you personally looked up is not
// redistributing a database, which is the case their terms explicitly support —
// "1 API call = 1 real scan by a user". Bulk-downloading it into the repo would
// be a derived database and would carry share-alike obligations. Attribution
// sits in Settings → Credits either way.

import { t } from './i18n.js';

const ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product';

// Only the fields we use — a full product record is enormous and most of it is
// images and provenance metadata.
const FIELDS = [
  'product_name', 'product_name_de', 'brands', 'quantity',
  'serving_size', 'serving_quantity', 'nutriments',
].join(',');

/**
 * Open Food Facts asks callers to identify themselves with a User-Agent. A
 * browser will not let a page set that header — it is on the Fetch spec's
 * forbidden list — so their API also accepts `X-User-Agent`, which is what a
 * web app can actually send. Not a workaround they merely tolerate: it is in
 * their CORS allow-list.
 */
const IDENT = 'LiftLog/1.0 (personal workout tracker; https://github.com/Vinzentfx/liftlog)';

export const ATTRIBUTION = {
  name: 'Open Food Facts',
  url: 'https://world.openfoodfacts.org',
  licence: 'Open Database License (ODbL)',
  licenceUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
};

/** A barcode is 8–14 digits. Strip anything the user's keyboard added. */
export function normaliseBarcode(input) {
  const digits = String(input || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

/**
 * @returns {Promise<{ok:true, draft:object} | {ok:false, reason:string, detail:string}>}
 *
 * Never throws. A lookup is a convenience, and the caller's fallback is always
 * the same — type it in — so every failure mode is a message, not an exception.
 */
export async function lookupBarcode(code, { signal } = {}) {
  const ean = normaliseBarcode(code);
  if (!ean) {
    return { ok: false, reason: 'invalid', detail: t('lookup.invalid') };
  }
  if (!navigator.onLine) {
    return { ok: false, reason: 'offline', detail: t('lookup.offline') };
  }

  let res;
  try {
    res = await fetch(`${ENDPOINT}/${ean}.json?fields=${FIELDS}`, {
      signal,
      headers: { 'X-User-Agent': IDENT },
    });
  } catch (err) {
    return { ok: false, reason: 'network', detail: t('lookup.network', { message: err.message }) };
  }

  if (!res.ok) {
    return { ok: false, reason: 'http', detail: t('lookup.http', { status: res.status }) };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'parse', detail: t('lookup.parse') };
  }

  if (body.status !== 1 || !body.product) {
    return {
      ok: false, reason: 'notfound',
      detail: t('lookup.notFound'),
    };
  }

  const draft = toDraft(ean, body.product);
  if (!draft.per100.protein && draft.per100.protein !== 0) {
    return {
      ok: false, reason: 'nonutrition',
      detail: t('lookup.noNutrition', { name: draft.name }),
      draft,
    };
  }
  return { ok: true, draft };
}

/**
 * Normalise a product record into the fields this app stores.
 *
 * Per-100 g is the only reliable ground truth: every entry has it, while
 * `serving_size` is missing on most products and, when present, is whatever the
 * manufacturer felt like calling a serving. So the app keeps the per-100 g
 * numbers and asks *you* how much you eat — which is also the honest place to
 * put that decision, since only you know what landed on the plate.
 */
function toDraft(code, p) {
  const n = p.nutriments || {};
  const label = (p.product_name_de || p.product_name || '').trim();
  const brand = firstBrand(p.brands);
  // Plenty of records repeat the brand as the product name ("Nutella" by
  // "Nutella"), so appending it unconditionally produces "Nutella · Nutella".
  const name = brand && !label.toLowerCase().includes(brand.toLowerCase())
    ? `${label} · ${brand}`.trim()
    : label;

  return {
    code,
    name: name || `Artikel ${code}`,
    brand,
    quantity: p.quantity || null,          // package size, e.g. "500 g"
    per100: {
      protein: num(n.proteins_100g),
      kcal: num(n['energy-kcal_100g']),
      // Null where the record has nothing, never 0 — a product that does not
      // list its fibre has unknown fibre, and the totals depend on the
      // difference.
      carbs: num(n.carbohydrates_100g),
      fat: num(n.fat_100g),
      fibre: num(n.fiber_100g),
    },
    // A manufacturer serving if there is one, otherwise 100 g — a round number
    // beats a guess, and the user overrides it in the next field anyway.
    suggestedGrams: num(p.serving_quantity) || 100,
    servingLabel: p.serving_size || null,
    source: 'barcode',
  };
}

/** Scale per-100 g values to a portion. */
export function scaleToPortion(per100, grams) {
  const f = (Number(grams) || 0) / 100;
  const scale = (v) => (v === null || v === undefined ? null : round1(v * f));
  return {
    protein: round1((per100.protein || 0) * f),
    kcal: Math.round((per100.kcal || 0) * f),
    carbs: scale(per100.carbs),
    fat: scale(per100.fat),
    fibre: scale(per100.fibre),
  };
}

const firstBrand = (brands) => (brands ? String(brands).split(',')[0].trim() : null);
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const round1 = (v) => Math.round(v * 10) / 10;
