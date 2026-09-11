// Barcode-Abfrage bei Open Food Facts.
//
// Das einzige in dieser App, das Netz braucht, und bewusst hier abgetrennt, damit
// die Grenze klar ist: alles andere, also Eintragen, Ziele und die ganze
// Trainingsseite, funktioniert im Flugmodus. Klappt eine Abfrage nicht, tippt man
// die Zahlen eben ein, das hätte man sonst auch getan.
//
// Kein Barcode-SCANNEN: kein Browser unter iOS hat BarcodeDetector, und die
// WebAssembly-Alternativen würden "keine Abhängigkeiten, kein Build-Schritt"
// brechen. Man tippt die 13 Ziffern unter den Strichen einmal pro neuem Produkt
// ein und nie wieder. Der Code wird am Lebensmittel gespeichert, eine erneute
// Abfrage antwortet also aus der eigenen Liste, ohne ins Netz zu gehen.
//
// Lizenz: die Datenbank von Open Food Facts steht unter ODbL (Struktur) und DbCL
// (Inhalt). Die Live-API abzufragen und zu speichern, was man selbst nachgeschlagen
// hat, ist keine Weitergabe einer Datenbank, und genau diesen Fall erlauben die
// Bedingungen ausdrücklich ("1 API call = 1 real scan by a user"). Sie gesammelt ins
// Repo zu laden wäre eine abgeleitete Datenbank mit Share-Alike-Pflichten. Die
// Quellenangabe steht so oder so unter Einstellungen, Credits.

import { t } from './i18n.js';

const ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product';

// Nur die Felder, die wir brauchen. Ein vollständiger Produkteintrag ist riesig
// und besteht größtenteils aus Bildern und Herkunftsangaben.
const FIELDS = [
  'product_name', 'product_name_de', 'brands', 'quantity',
  'serving_size', 'serving_quantity', 'nutriments',
].join(',');

/**
 * Open Food Facts möchte, dass sich Aufrufer mit einem User-Agent melden. Diesen
 * Header darf eine Seite im Browser nicht setzen (er steht auf der Verbotsliste
 * der Fetch-Spezifikation), deshalb nimmt die API auch `X-User-Agent`, und das
 * kann eine Web-App wirklich schicken. Kein geduldeter Umweg: der Header steht in
 * ihrer CORS-Freigabe.
 */
const IDENT = 'LiftLog/1.0 (personal workout tracker; https://github.com/Vinzentfx/liftlog)';

export const ATTRIBUTION = {
  name: 'Open Food Facts',
  url: 'https://world.openfoodfacts.org',
  licence: 'Open Database License (ODbL)',
  licenceUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
};

/** Eine GTIN hat 8, 12, 13 oder 14 Ziffern und endet mit einer Prüfziffer. */
export function normaliseBarcode(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  let sum = 0;
  for (let i = digits.length - 2, position = 0; i >= 0; i--, position++) {
    sum += Number(digits[i]) * (position % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1)) ? digits : null;
}

/** Offensichtlich kaputte Einträge aus der Community ablehnen, ohne so zu tun, als würden Etiketten geprüft. */
export function nutritionLooksPlausible(per100) {
  const values = ['protein', 'carbs', 'fat', 'fibre'].map((key) => per100?.[key]).filter((v) => v != null);
  if (values.some((v) => !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 100)) return false;
  const kcal = Number(per100?.kcal);
  if (!Number.isFinite(kcal) || kcal < 0 || kcal > 950) return false;
  const estimated = 4 * (Number(per100?.protein) || 0) + 4 * (Number(per100?.carbs) || 0)
    + 9 * (Number(per100?.fat) || 0) + 2 * (Number(per100?.fibre) || 0);
  return Math.abs(kcal - estimated) <= Math.max(120, estimated * 0.45);
}

/**
 * @returns {Promise<{ok:true, draft:object} | {ok:false, reason:string, detail:string}>}
 *
 * Wirft nie. Eine Abfrage ist nur eine Erleichterung, und der Rückfall ist immer
 * derselbe (eintippen). Jeder Fehler ist also eine Meldung und keine Exception.
 */
export async function lookupBarcode(code, { signal } = {}) {
  const ean = normaliseBarcode(code);
  if (!ean) {
    return { ok: false, reason: 'invalid', detail: t('lookup.invalid') };
  }
  if (!navigator.onLine) {
    return { ok: false, reason: 'offline', detail: t('lookup.offline') };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let res;
  try {
    res = await fetch(`${ENDPOINT}/${ean}.json?fields=${FIELDS}`, {
      signal: controller.signal,
      headers: { 'X-User-Agent': IDENT },
    });
  } catch (err) {
    return { ok: false, reason: 'network', detail: t('lookup.network', { message: err.message }) };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
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
  if (!nutritionLooksPlausible(draft.per100)) {
    return { ok: false, reason: 'nonutrition', detail: t('lookup.noNutrition', { name: draft.name }), draft };
  }
  return { ok: true, draft };
}

/**
 * Einen Produkteintrag auf die Felder bringen, die diese App speichert.
 *
 * Pro 100 g ist das Einzige, worauf man sich verlassen kann: das hat jeder
 * Eintrag, während `serving_size` bei den meisten fehlt und sonst das ist, was der
 * Hersteller gerade Portion nennen wollte. Die App behält also die Werte pro 100 g
 * und fragt DICH, wie viel du isst. Da gehört die Entscheidung auch hin, denn nur
 * du weißt, was auf dem Teller gelandet ist.
 */
function toDraft(code, p) {
  const n = p.nutriments || {};
  const label = (p.product_name_de || p.product_name || '').trim();
  const brand = firstBrand(p.brands);
  // Viele Einträge wiederholen die Marke als Produktname ("Nutella" von "Nutella"),
  // sie immer anzuhängen ergibt "Nutella · Nutella".
  const name = brand && !label.toLowerCase().includes(brand.toLowerCase())
    ? `${label} · ${brand}`.trim()
    : label;

  return {
    code,
    name: name || `Artikel ${code}`,
    brand,
    quantity: p.quantity || null,          // Packungsgröße, z. B. "500 g"
    per100: {
      protein: num(n.proteins_100g),
      kcal: num(n['energy-kcal_100g']),
      // null, wo der Eintrag nichts hat, nie 0. Ein Produkt ohne Angabe zu
      // Ballaststoffen hat unbekannte Ballaststoffe, und die Summen hängen an diesem
      // Unterschied.
      carbs: num(n.carbohydrates_100g),
      fat: num(n.fat_100g),
      fibre: num(n.fiber_100g),
    },
    // Eine Portion vom Hersteller, falls es eine gibt, sonst 100 g. Eine runde Zahl
    // ist besser als geraten, und im nächsten Feld überschreibt man sie ohnehin.
    suggestedGrams: num(p.serving_quantity) || 100,
    servingLabel: p.serving_size || null,
    source: 'barcode',
  };
}

/** Werte pro 100 g auf eine Portion rechnen. */
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
