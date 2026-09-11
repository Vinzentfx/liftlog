// Macht aus den Beschwerden der Planbewertung Änderungen, die man direkt übernehmen kann.
//
// Die Bewertung kennt das Problem schon genau: "Bauch 6 Sätze", "Quadrizeps 14 in
// einer Einheit", "das wird verkürzt belastet". Den Nutzer das zurückübersetzen zu
// lassen, welchen Tag er öffnen und welche Übung er hinzufügen muss, ist Arbeit,
// die die App selbst erledigen kann.
//
// Jede Korrektur ist eine kleine, umkehrbare Änderung an einem Tag. Nichts hier
// baut einen Plan um: keine Korrektur entfernt einen Trainingstag, ändert die
// Aufteilung oder fasst ungefragt eine Übung an, die man bewusst gewählt hat.

import { tRegion, t } from './i18n.js';
import { THRESHOLDS } from './evidence.js';
import { rateExercise } from './exercise-rating.js';
import { pickForRegion, SETS_PER_EXERCISE, REP_TARGET } from './plan-builder.js';
import { suggestSwaps } from './swaps.js';

const FLOOR = THRESHOLDS.weeklyFloor.value;
const PER_SESSION = THRESHOLDS.sessionPerMuscle.value;

const name = tRegion;

/**
 * @param plan      der Plan, der bearbeitet wird (wird hier nicht verändert)
 * @param analysis  ein Ergebnis von analysePlan() dafür
 * @param exercises die ganze Bibliothek
 * @returns [{ id, title, detail, severity, apply(plan) }]
 */
export function diagnose(plan, analysis, exercises, byId, { sets = SETS_PER_EXERCISE } = {}) {
  const fixes = [];
  const used = new Set();
  for (const d of plan.days || []) for (const i of d.items) used.add(i.exerciseId);

  // ---- 1. Muskeln, die gar nichts bekommen ----
  for (const region of analysis.untrained) {
    const pick = pickForRegion(region, exercises, { used, preferCompound: true });
    if (!pick) continue;
    used.add(pick.id);
    const day = lightestDay(plan, byId, region, pick);
    if (!day) continue;
    fixes.push({
      id: `cover-${region}`,
      severity: 3,
      title: t('planDoctor.coverTitle', { muscle: name(region), day: day.name }),
      detail: t('planDoctor.coverDetail', { exercise: pick.name, sets, muscle: name(region) }),
      apply: (p) => addItem(p, day.id, pick.id, sets),
    });
  }

  // ---- 2. Muskeln unter der Wochenuntergrenze ----
  const under = analysis.trained
    .filter((r) => analysis.volume[r] < FLOOR)
    .sort((a, b) => analysis.volume[a] - analysis.volume[b]);
  for (const region of under.slice(0, 4)) {
    const pick = pickForRegion(region, exercises, { used, preferCompound: false });
    if (!pick) continue;
    used.add(pick.id);
    const day = lightestDay(plan, byId, region, pick);
    if (!day) continue;
    const gap = Math.ceil(FLOOR - analysis.volume[region]);
    fixes.push({
      id: `volume-${region}`,
      severity: 2,
      title: t('planDoctor.volumeTitle', { muscle: name(region), day: day.name }),
      detail: t('planDoctor.volumeDetail', { exercise: pick.name, sets, muscle: name(region), gap, floor: FLOOR }),
      apply: (p) => addItem(p, day.id, pick.id, sets),
    });
  }

  // ---- 3. ein Muskel in eine einzige Einheit gequetscht ----
  for (const region of analysis.trained) {
    const peak = analysis.peakSession[region] || 0;
    if (peak <= PER_SESSION) continue;
    const move = findMove(plan, byId, region);
    if (!move) continue;
    fixes.push({
      id: `session-${region}`,
      severity: 2,
      title: t('planDoctor.moveTitle', { exercise: move.exName, day: move.toDay.name }),
      detail: t('planDoctor.moveDetail', {
        muscle: name(region), sets: Math.round(peak), day: move.fromDay.name, perSession: PER_SESSION,
      }),
      apply: (p) => moveItem(p, move.fromDay.id, move.toDay.id, move.exerciseId),
    });
  }

  // ---- 4. Übungen, die in der verkürzten Position belasten ----
  for (const day of plan.days || []) {
    for (const item of day.items) {
      const ex = byId.get(item.exerciseId);
      if (!ex) continue;
      const r = rateExercise(ex);
      if (!r || r.length.bias !== 'short') continue;
      const better = suggestSwaps(ex, exercises, 1)[0];
      if (!better || used.has(better.ex.id)) continue;
      fixes.push({
        id: `swap-${item.exerciseId}`,
        severity: 1,
        title: t('planDoctor.swapTitle', { from: ex.name, to: better.ex.name }),
        detail: `${t(r.length.why)}. ${better.reason}.`,
        apply: (p) => replaceItem(p, day.id, item.exerciseId, better.ex.id),
      });
    }
  }

  // ---- 5. ein Muskel hängt an einer einzigen Übung ----
  for (const region of analysis.trained) {
    if ((analysis.exercisesPer[region] || 0) !== 1) continue;
    if (analysis.volume[region] < 8) continue;
    const pick = pickForRegion(region, exercises, { used, preferCompound: false });
    if (!pick) continue;
    used.add(pick.id);
    const day = lightestDay(plan, byId, region, pick);
    if (!day) continue;
    fixes.push({
      id: `variety-${region}`,
      severity: 1,
      title: t('planDoctor.varietyTitle', { muscle: name(region) }),
      detail: t('planDoctor.varietyDetail', { exercise: pick.name, day: day.name, muscle: name(region) }),
      apply: (p) => addItem(p, day.id, pick.id, sets),
    });
  }

  return fixes.sort((a, b) => b.severity - a.severity).slice(0, 8);
}

/* ---------------- Änderungen ---------------- */

function addItem(plan, dayId, exerciseId, sets = SETS_PER_EXERCISE) {
  const day = plan.days.find((d) => d.id === dayId);
  if (!day) return;
  day.items.push({
    exerciseId,
    targetSets: sets,
    targetReps: plan.repTarget || REP_TARGET,
    note: '',
  });
}

function replaceItem(plan, dayId, oldId, newId) {
  const day = plan.days.find((d) => d.id === dayId);
  const item = day && day.items.find((i) => i.exerciseId === oldId);
  if (item) item.exerciseId = newId;
}

function moveItem(plan, fromId, toId, exerciseId) {
  const from = plan.days.find((d) => d.id === fromId);
  const to = plan.days.find((d) => d.id === toId);
  if (!from || !to) return;
  const idx = from.items.findIndex((i) => i.exerciseId === exerciseId);
  if (idx < 0) return;
  const [item] = from.items.splice(idx, 1);
  to.items.push(item);
}

/* ---------------- Helfer ---------------- */

/**
 * Wohin eine zusätzliche Übung für einen Muskel gehört.
 *
 * Die Reihenfolge ist wichtiger, als sie aussieht. Nur nach "welcher Tag ist am
 * leersten" zu sortieren, legt Kniebeugen auf den Pull-Tag, rein rechnerisch der
 * leichteste, aber offensichtlich falsch. Deshalb gewinnt zuerst der Aufbau des
 * Plans selbst: ein erzeugter Tag trägt die Muskelplätze, aus denen er entstanden
 * ist, und damit sagt der Plan, wo der Muskel hingehört. Erst danach zählt die
 * Belastung und ganz zum Schluss die Größe.
 */
function lightestDay(plan, byId, region, pick = null) {
  const days = (plan.days || []).filter((d) => d.items);
  if (!days.length) return null;

  // Alles, was die neue Übung trifft. So kann auch ein Plan von Hand ohne
  // Platzvorgaben einen Beintag von einem Pull-Tag unterscheiden: Kniebeugen
  // belasten auch Gesäß und Beinbeuger, und der Tag, der die schon trainiert, ist
  // der richtige.
  const kin = new Set([...(pick?.primary || []), ...(pick?.secondary || [])]);

  const scored = days.map((d) => ({
    d,
    // 2 = die Vorlage hat den Muskel auf diesen Tag gelegt, 1 = etwas an diesem Tag
    // trainiert ihn, 0 = kein Zusammenhang.
    fit: (d.target || []).some((t) => t.region === region) ? 2
      : regionLoad(d, byId, region) > 0 ? 1 : 0,
    kinship: [...kin].filter((r) => regionLoad(d, byId, r) > 0).length,
    load: regionLoad(d, byId, region),
    size: d.items.length,
  }));

  return scored
    .sort((a, b) => b.fit - a.fit || b.kinship - a.kinship || a.load - b.load || a.size - b.size)
    .map((x) => x.d)[0];
}

function regionLoad(day, byId, region) {
  let n = 0;
  for (const item of day.items) {
    const ex = byId.get(item.exerciseId);
    if (!ex) continue;
    const sets = Number(item.targetSets) || 0;
    if ((ex.primary || []).includes(region)) n += sets;
    else if ((ex.secondary || []).includes(region)) n += sets * THRESHOLDS.indirectSetWeight.value;
  }
  return n;
}

/** Der schwerste Tag für einen Muskel und der leichteste, der eine Übung davon übernehmen kann. */
function findMove(plan, byId, region) {
  const scored = (plan.days || []).map((d) => ({ d, load: regionLoad(d, byId, region) }));
  const from = [...scored].sort((a, b) => b.load - a.load)[0];
  const to = [...scored].sort((a, b) => a.load - b.load)[0];
  if (!from || !to || from.d.id === to.d.id) return null;

  // Verschoben wird eine Übung, deren HAUPTaufgabe dieser Muskel ist. Eine
  // Grundübung, die ihn nur nebenbei trifft, würde die falsche Last mitnehmen.
  const item = from.d.items.find((i) => {
    const ex = byId.get(i.exerciseId);
    return ex && (ex.primary || []).includes(region);
  });
  if (!item) return null;
  const ex = byId.get(item.exerciseId);

  return { fromDay: from.d, toDay: to.d, exerciseId: item.exerciseId, exName: ex.name };
}
