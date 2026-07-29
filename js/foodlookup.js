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
    return { ok: false, reason: 'invalid', detail: 'A barcode is 8 to 14 digits — check the number under the stripes.' };
  }
  if (!navigator.onLine) {
    return { ok: false, reason: 'offline', detail: 'No connection. Add the food by hand and it works exactly the same.' };
  }

  let res;
  try {
    res = await fetch(`${ENDPOINT}/${ean}.json?fields=${FIELDS}`, {
      signal,
      headers: { 'X-User-Agent': IDENT },
    });
  } catch (err) {
    return { ok: false, reason: 'network', detail: `Could not reach Open Food Facts (${err.message}).` };
  }

  if (!res.ok) {
    return { ok: false, reason: 'http', detail: `Open Food Facts answered ${res.status}.` };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'parse', detail: 'Open Food Facts sent something unreadable.' };
  }

  if (body.status !== 1 || !body.product) {
    return {
      ok: false, reason: 'notfound',
      detail: 'Not in the database. It is community-maintained, so plenty of products are missing — type it in and you are done.',
    };
  }

  const draft = toDraft(ean, body.product);
  if (!draft.per100.protein && draft.per100.protein !== 0) {
    return {
      ok: false, reason: 'nonutrition',
      detail: `Found "${draft.name}", but nobody has filled in its protein value. Read it off the packet.`,
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
  return {
    protein: round1((per100.protein || 0) * f),
    kcal: Math.round((per100.kcal || 0) * f),
  };
}

const firstBrand = (brands) => (brands ? String(brands).split(',')[0].trim() : null);
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const round1 = (v) => Math.round(v * 10) / 10;
