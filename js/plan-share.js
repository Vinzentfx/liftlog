// Einen Plan als Link teilen. Kein Server, kein Konto, und nichts geht irgendwohin,
// wo es nicht bewusst hingeschickt wurde. Der ganze Plan steckt in der URL.
//
// Was das knifflig macht: Übungs-IDs werden pro Installation erzeugt (`uid('ex_')`
// mit Zufallsbytes), auf einem anderen Handy bedeutet eine ID also nichts. Ein
// geteilter Plan enthält deshalb Übungsnamen und genug Zusammenhang, um alles
// nachzubauen, was dem Empfänger fehlt, und der Import löst sie gegen dessen
// eigene Bibliothek auf. Die Namen werden genauso normalisiert wie beim Auffüllen
// der Bibliothek, "Barbell Bench Press" und "barbell bench press" landen also in
// derselben Zeile.
//
// Größe: ein Plan mit fünf Tagen und 39 Übungen sind etwa 2 KB JSON, komprimiert
// rund 700 Byte und als URL knapp 950 Zeichen. Das kommt durch jeden Messenger.

import { normName } from './models.js';
import { t } from './i18n.js';

const VERSION = 1;

/* Kodieren */

/**
 * @param plan  ein gespeicherter Plan
 * @param byId  Map von Übungs-ID auf Übung, um die Namen aufzulösen
 */
export function encodePlan(plan, byId) {
  const payload = {
    v: VERSION,
    n: plan.name,
    w: plan.perWeek || 1,
    r: plan.repTarget || null,
    d: (plan.days || []).map((day) => ({
      n: day.name,
      // null und undefined heißen beide "kein fester Wochentag". Vereinheitlicht,
      // damit der Dekoder die beiden nie unterscheiden muss.
      wd: Number.isInteger(day.weekday) ? day.weekday : null,
      i: (day.items || []).map((item) => {
        const ex = byId.get(item.exerciseId);
        if (!ex) return null;
        return [
          ex.name,
          ex.muscle || 'Other',
          ex.equipment || 'Other',
          Number(item.targetSets) || 3,
          // Das Wiederholungsziel des Plans bei jeder Übung zu wiederholen ist der
          // Großteil der Daten. Weglassen, wenn es übereinstimmt.
          item.targetReps && item.targetReps !== plan.repTarget ? item.targetReps : 0,
        ];
      }).filter(Boolean),
    })),
  };
  return payload;
}

/** Macht aus einem Plan einen Link zum Teilen. Async, weil die Kompression eine Stream-API ist. */
export async function planLink(plan, byId, baseUrl = defaultBase()) {
  const json = JSON.stringify(encodePlan(plan, byId));
  const code = await pack(json);
  return `${baseUrl}#/share/${code}`;
}

function defaultBase() {
  // Vorhandenen Hash und Query abschneiden, damit ein Link, der aus einem Deeplink
  // entsteht, trotzdem eine saubere Adresse ist.
  return `${location.origin}${location.pathname}`;
}

/* Dekodieren */

/**
 * @returns {Promise<{ok:true, plan:object} | {ok:false, detail:string}>}
 * Wirft nie. Ein kaputter Link ist eine Meldung, kein Absturz.
 */
export async function decodeLink(code) {
  if (typeof code !== 'string' || code.length > 100000) {
    return { ok: false, detail: t('shareLink.damaged', { why: ' (too large)' }) };
  }
  let json;
  try {
    json = await unpack(code);
  } catch (err) {
    // Manche Fehler beim Dekodieren kommen mit leerer Meldung. Eine leere Klammer
    // sieht selbst wie ein Fehler aus.
    const why = err && err.message ? ` (${err.message})` : '';
    return { ok: false, detail: t('shareLink.damaged', { why }) };
  }

  let p;
  try {
    p = JSON.parse(json);
  } catch {
    return { ok: false, detail: t('shareLink.noPlan') };
  }

  if (!p || p.v !== VERSION || !Array.isArray(p.d)) {
    return { ok: false, detail: t('shareLink.wrongVersion') };
  }

  return {
    ok: true,
    plan: {
      name: String(p.n || 'Shared plan'),
      perWeek: Number(p.w) || 1,
      repTarget: p.r || null,
      days: p.d.map((day) => ({
        name: String(day.n || 'Day'),
        weekday: Number.isInteger(day.wd) ? day.wd : null,
        items: (day.i || []).map(([name, muscle, equipment, sets, reps]) => ({
          name: String(name),
          muscle: String(muscle || 'Other'),
          equipment: String(equipment || 'Other'),
          sets: Number(sets) || 3,
          reps: reps || p.r || null,
        })),
      })),
    },
  };
}

/**
 * Einen geteilten Plan gegen die Bibliothek des Empfängers abgleichen.
 *
 * Berichtet nur und entscheidet nichts: der Import zeigt genau, wie viele Übungen
 * es schon gibt und wie viele neu angelegt würden. "Das fügt 6 Übungen zu deiner
 * Bibliothek hinzu" will man sehen, bevor man tippt, nicht danach.
 */
export function resolveAgainstLibrary(shared, exercises) {
  const byName = new Map(exercises.map((e) => [normName(e.name), e]));
  const matched = [];
  const missing = new Map();   // je normalisiertem Namen: {name, muscle, equipment}

  for (const day of shared.days) {
    for (const item of day.items) {
      const key = normName(item.name);
      const hit = byName.get(key);
      if (hit) matched.push({ item, ex: hit });
      else if (!missing.has(key)) missing.set(key, item);
    }
  }
  return { matched, missing: [...missing.values()] };
}

/* Packen */

/**
 * Deflate und base64url. CompressionStream ist eine normale Web-API (ab Safari
 * 16.4), das bleibt also ohne Abhängigkeiten. Wo es sie nicht gibt, reist der
 * Inhalt unkomprimiert, das kostet nur einen längeren Link.
 */
async function pack(json) {
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'undefined') return `u${toBase64Url(bytes)}`;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer());
    return `z${toBase64Url(packed)}`;
  } catch {
    return `u${toBase64Url(bytes)}`;
  }
}

async function unpack(code) {
  const mode = code[0];
  const bytes = fromBase64Url(code.slice(1));
  if (mode === 'u') return new TextDecoder().decode(bytes);
  if (mode !== 'z') throw new Error('unknown format');
  if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot read compressed links');
  const reader = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 2 * 1024 * 1024) {
      await reader.cancel();
      throw new Error('too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(out);
}

// base64url: kein +, / oder =, damit der Text im URL-Hash unverändert ankommt.
function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
