// Share a plan as a link. No server, no account, no data leaving anywhere it
// wasn't sent deliberately — the whole plan travels inside the URL.
//
// The thing that makes this non-trivial: exercise ids are generated per install
// (`uid('ex_')` with random bytes), so an id means nothing on someone else's
// phone. A shared plan therefore carries exercise *names*, plus enough context
// to recreate anything the recipient is missing, and the import re-resolves
// against their own library. Names are matched with the same normalisation the
// library top-up uses, so "Barbell Bench Press" and "barbell bench press" land
// on the same row.
//
// Size: a five-day plan with 39 exercises is roughly 2 KB of JSON, which
// compresses to about 700 bytes and lands near 950 characters of URL. Well
// inside what messengers pass through intact.

import { normName } from './models.js';

const VERSION = 1;

/* ============================ encode ============================ */

/**
 * @param plan  a stored plan
 * @param byId  Map exerciseId -> exercise, for resolving names
 */
export function encodePlan(plan, byId) {
  const payload = {
    v: VERSION,
    n: plan.name,
    w: plan.perWeek || 1,
    r: plan.repTarget || null,
    d: (plan.days || []).map((day) => ({
      n: day.name,
      // null and undefined both mean "no fixed weekday"; normalise so the
      // decoder never has to distinguish them.
      wd: Number.isInteger(day.weekday) ? day.weekday : null,
      i: (day.items || []).map((item) => {
        const ex = byId.get(item.exerciseId);
        if (!ex) return null;
        return [
          ex.name,
          ex.muscle || 'Other',
          ex.equipment || 'Other',
          Number(item.targetSets) || 3,
          // Repeating the plan's rep target on every item is most of the
          // payload; omit it when it matches.
          item.targetReps && item.targetReps !== plan.repTarget ? item.targetReps : 0,
        ];
      }).filter(Boolean),
    })),
  };
  return payload;
}

/** Plan -> shareable URL. Async because compression is a stream API. */
export async function planLink(plan, byId, baseUrl = defaultBase()) {
  const json = JSON.stringify(encodePlan(plan, byId));
  const code = await pack(json);
  return `${baseUrl}#/share/${code}`;
}

function defaultBase() {
  // Strip any existing hash and query so a link generated from a deep link is
  // still a clean root URL.
  return `${location.origin}${location.pathname}`;
}

/* ============================ decode ============================ */

/**
 * @returns {Promise<{ok:true, plan:object} | {ok:false, detail:string}>}
 * Never throws — a mangled link is a message, not a crash.
 */
export async function decodeLink(code) {
  let json;
  try {
    json = await unpack(code);
  } catch (err) {
    // Some decode failures throw with an empty message; an empty parenthetical
    // reads like a bug of its own.
    const why = err && err.message ? ` (${err.message})` : '';
    return { ok: false, detail: `This link is damaged or incomplete${why}. Messengers sometimes cut long links — ask for it again.` };
  }

  let p;
  try {
    p = JSON.parse(json);
  } catch {
    return { ok: false, detail: 'This link does not contain a plan.' };
  }

  if (!p || p.v !== VERSION || !Array.isArray(p.d)) {
    return { ok: false, detail: 'This link was made by a different version of LiftLog.' };
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
 * Match a shared plan against the recipient's library.
 *
 * Reports rather than decides: the import screen shows exactly how many
 * exercises already exist and how many would be created, because "this will add
 * 6 exercises to your library" is the kind of thing you want to see before you
 * tap, not after.
 */
export function resolveAgainstLibrary(shared, exercises) {
  const byName = new Map(exercises.map((e) => [normName(e.name), e]));
  const matched = [];
  const missing = new Map();   // normalised name -> {name, muscle, equipment}

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

/* ============================ packing ============================ */

/**
 * Deflate + base64url. CompressionStream is a plain web API (Safari 16.4+), so
 * this stays dependency-free; where it is missing the payload travels
 * uncompressed and the only cost is a longer link.
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
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

// base64url: no +, / or = so the string survives a URL hash untouched.
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
