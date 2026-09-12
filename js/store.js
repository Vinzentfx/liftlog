// Die eine Quelle für alles. Screens lesen `state` und rufen Aktionen auf, die Aktionen
// speichern in IndexedDB und geben den Abonnenten Bescheid.

import * as idb from './db.js';
import {
  DEFAULT_SETTINGS, seedExercises, newSession, newEntry, newSet,
  newFood, newMeal, newTemplate, dayKey, latestWeight,
  LIBRARY_VERSION, DATA_VERSION, normName, regionsForMuscle,
  estimatePlanDuration,
} from './models.js';
import { buildPlanDays, SETS_PER_EXERCISE, REP_TARGET } from './plan-builder.js';
import { DEFAULT_BAR } from './plates.js';
import { t } from './i18n.js';

/**
 * Jedes Schreiben geht durch diese Hülle, damit ein fehlgeschlagenes nie still bleibt.
 *
 * Der Fall, für den es sie gibt: eine Aktion ändert zuerst `state` und speichert danach,
 * dadurch bleibt die Oberfläche sofort. Scheitert das Schreiben dann (Kontingent voll,
 * Herkunft gelöscht, privates Surfen), zeigt der Screen einen Satz als eingetragen, der
 * nie auf der Platte ankam, und beim nächsten Start ist er weg. Stiller Datenverlust, der
 * wie Erfolg aussieht, ist das Schlimmste, was ein Trainingslog tun kann. Der Fehler
 * landet deshalb in `state.storageError`, jeder Abonnent bekommt Bescheid, und der
 * Fehler geht trotzdem weiter an den Aufrufer.
 *
 * Lesen läuft unverändert durch. Ein fehlgeschlagenes Lesen fällt schon als Screen auf,
 * der nicht lädt.
 */
const db = {
  ...idb,
  put: (store, value) => guard(() => idb.put(store, value)),
  putMany: (store, values) => guard(() => idb.putMany(store, values)),
  remove: (store, key) => guard(() => idb.remove(store, key)),
  clear: (store) => guard(() => idb.clear(store)),
};

async function guard(run) {
  try {
    const out = await run();
    // Ein Schreiben, das klappt, löscht die Warnung. Wer Platz geschaffen hat, muss nicht
    // weiter von einer vollen Platte hören.
    if (state.storageError) { state.storageError = null; emit(); }
    return out;
  } catch (err) {
    console.error('[liftlog] write failed', err);
    state.storageError = {
      at: Date.now(),
      // Safari meldet ein volles Kontingent je nach Version unter zwei verschiedenen
      // Namen. Beide heißen "etwas löschen oder exportieren".
      quota: !!err && (err.name === 'QuotaExceededError' || err.code === 22),
      message: (err && err.message) || String(err),
    };
    emit();
    throw err;
  }
}

export const state = {
  ready: false,
  exercises: [],
  plans: [],
  sessions: [],       // die neuesten zuerst, die laufende gehört dazu
  bodyweight: [],     // die neuesten zuerst
  foods: [],          // die eigene Lebensmittelliste
  water: [],          // eine Zeile pro Tag: { day, ml }
  templates: [],      // gespeicherte Mahlzeiten: ein Name und eine Liste von Lebensmitteln
  meals: [],          // die neuesten zuerst
  settings: { ...DEFAULT_SETTINGS },
  // je Schlüssel: wann er auf diesem Gerät zuletzt geändert wurde. Nur das Zusammenführen
  // bei der Synchronisation liest das, alles andere will die einfachen Werte oben.
  settingsUpdatedAt: {},
  exerciseById: new Map(),
  // Setzt `guard`, wenn ein Schreiben scheitert, das nächste erfolgreiche löscht es.
  storageError: null,
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn()); }

function reindex() {
  state.exerciseById = new Map(state.exercises.map((e) => [e.id, e]));
  state.exercises.sort((a, b) => a.name.localeCompare(b.name));
  state.sessions.sort((a, b) => b.startedAt - a.startedAt);
  state.bodyweight.sort((a, b) => b.date - a.date);
  state.meals.sort((a, b) => b.at - a.at);
  // Das meistgegessene zuerst: die Liste, aus der man auswählt, soll die Klassiker oben
  // haben, denn 95 % von dem, was jemand isst, sind dieselben 30 Dinge.
  state.foods.sort((a, b) => (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name));
  state.templates.sort((a, b) => (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name));
}

export async function load() {
  const [exercises, plans, sessions, bodyweight, foods, meals, water, templates, settingsRows] = await Promise.all([
    db.getAll(db.STORES.exercises),
    db.getAll(db.STORES.plans),
    db.recentSessions(0),
    db.getAll(db.STORES.bodyweight),
    db.getAll(db.STORES.foods),
    db.getAll(db.STORES.meals),
    db.getAll(db.STORES.water),
    db.getAll(db.STORES.templates),
    db.getAll(db.STORES.settings),
  ]);

  state.exercises = exercises;
  state.plans = plans;
  state.sessions = sessions;
  state.bodyweight = bodyweight;
  state.foods = foods;
  state.meals = meals;
  state.water = water;
  state.templates = templates;
  state.settings = { ...DEFAULT_SETTINGS };
  // Wann jede Einstellung zuletzt geändert wurde, damit das Zusammenführen eine frische
  // lokale Änderung von einer alten der Gegenseite unterscheiden kann. Neben den Werten und
  // nicht darin: jeder Screen liest state.settings als einfaches Objekt mit Werten.
  state.settingsUpdatedAt = {};
  for (const row of settingsRows) {
    state.settings[row.key] = row.value;
    if (row.updatedAt) state.settingsUpdatedAt[row.key] = row.updatedAt;
  }

  if (!state.exercises.length) {
    state.exercises = seedExercises(db.uid);
    await db.putMany(db.STORES.exercises, state.exercises);
    await db.put(db.STORES.settings, { key: 'libraryVersion', value: LIBRARY_VERSION });
    state.settings.libraryVersion = LIBRARY_VERSION;
  } else if ((state.settings.libraryVersion || 1) < LIBRARY_VERSION) {
    // Vorhandene Installation: mit Katalogeinträgen auffüllen, die sie noch nicht hat. Über
    // den Namen abgeglichen, damit nichts angefasst wird, was der Nutzer bearbeitet oder benutzt hat.
    const have = new Set(state.exercises.map((e) => normName(e.name)));
    const added = seedExercises(db.uid).filter((e) => !have.has(normName(e.name)));
    if (added.length) {
      state.exercises.push(...added);
      await db.putMany(db.STORES.exercises, added);
    }
    // Die Regionen der Muskelkarte bei den ursprünglich gepflegten Zeilen nachtragen.
    const missing = state.exercises.filter((e) => !e.primary);
    if (missing.length) {
      const byName = new Map(seedExercises(db.uid).map((e) => [normName(e.name), e]));
      for (const e of missing) {
        const match = byName.get(normName(e.name));
        e.primary = match ? match.primary : [];
        e.secondary = match ? match.secondary : [];
        e.instructions = e.instructions || (match ? match.instructions : []);
      }
      await db.putMany(db.STORES.exercises, missing);
    }
    await db.put(db.STORES.settings, { key: 'libraryVersion', value: LIBRARY_VERSION });
    state.settings.libraryVersion = LIBRARY_VERSION;
    console.info(`[liftlog] library topped up: +${added.length} exercises`);
  }

  await migrate();

  reindex();
  markWorkoutOpen();
  state.ready = true;
  emit();
}

/**
 * Einmalige Reparaturen an gespeicherten Einträgen.
 *
 * v2: Übungen ohne Regionen auf der Muskelkarte. Alles, was der Nutzer selbst angelegt
 * hat, wurde ganz ohne `primary`/`secondary` gespeichert, und das Auffüllen aus dem
 * Katalog hat nur Zeilen repariert, die es über den Namen gefunden hat. Eine eigene
 * Übung passt zu nichts und blieb mit einem leeren Array stehen. Die Folge war still und
 * vollständig: keine Farbe auf der Muskelkarte, kein Volumen in der Planbewertung und
 * null Muskeln in der Übungsbewertung. Beim Anlegen ist das inzwischen behoben, das hier
 * repariert, was schon gespeichert ist.
 *
 * v3: Katalogdaten reparieren. Bodyweight Flyes benutzen rollende SZ-Stangen als Griffe
 * und wurden fälschlich als Langhantelübung gefiltert und bewertet, außerdem standen
 * importierte Überschriften aus den Anleitungen als wörtliches HTML da. Die
 * Hüftadduktion bekommt ihre richtige Zielregion statt einer leeren Muskelkarte.
 */
async function migrate() {
  const from = Number(state.settings.dataVersion) || 1;
  if (from >= DATA_VERSION) return;

  if (from < 2) {
    const seedByName = new Map(seedExercises(db.uid).map((e) => [normName(e.name), e]));
    const repaired = [];

    for (const ex of state.exercises) {
      if ((ex.primary || []).length) continue;
      // Katalogeinträge bekommen ihre gepflegten Regionen zurück, alles andere fällt auf die
      // grobe Zuordnung über die Muskelgruppe. Die ist ungenau, aber der Unterschied zwischen
      // mitzählen und gar nicht mitzählen.
      const match = seedByName.get(normName(ex.name));
      const primary = match && match.primary.length ? match.primary : regionsForMuscle(ex.muscle);
      if (!primary.length) continue;      // "Other" hat wirklich keine Region

      ex.primary = primary;
      ex.secondary = match ? match.secondary : [];
      repaired.push(ex);
    }

    if (repaired.length) {
      await db.putMany(db.STORES.exercises, repaired);
      console.info(`[liftlog] migration v2: regions restored on ${repaired.length} exercises`);
    }
  }

  if (from < 3) {
    const seedByName = new Map(seedExercises(db.uid).map((e) => [normName(e.name), e]));
    const repaired = [];
    for (const ex of state.exercises) {
      const match = seedByName.get(normName(ex.name));
      if (!match || ex.isCustom) continue;
      let changed = false;
      if (/bodyweight (fly|flye)/i.test(ex.name) && ex.equipment !== 'Bodyweight') {
        ex.equipment = 'Bodyweight';
        changed = true;
      }
      if (ex.name === 'Machine Hip Adduction' && !(ex.primary || []).includes('adductors')) {
        ex.primary = match.primary;
        ex.secondary = match.secondary;
        changed = true;
      }
      if ((ex.instructions || []).some((step) => /<[^>]+>/.test(step))) {
        ex.instructions = match.instructions;
        changed = true;
      }
      if (changed) repaired.push(ex);
    }
    if (repaired.length) await db.putMany(db.STORES.exercises, repaired);
  }

  state.settings.dataVersion = DATA_VERSION;
  await db.put(db.STORES.settings, { key: 'dataVersion', value: DATA_VERSION });
}

export function activeSession() {
  return state.sessions.find((s) => !s.finishedAt) || null;
}

const INSTALLATION_KEY = 'liftlog.installationId';
export function installationId() {
  try {
    let id = localStorage.getItem(INSTALLATION_KEY);
    if (!id) { id = db.uid('install_'); localStorage.setItem(INSTALLATION_KEY, id); }
    return id;
  } catch {
    return 'installation-unavailable';
  }
}

const WORKOUT_OPEN_KEY = 'liftlog.workoutOpen';

/**
 * "Ein Training ist offen" außerhalb des Modulbaums bekannt machen.
 *
 * Gelesen wird das von `js/bootstrap.js`. Das entscheidet, ob ein Update des Service
 * Workers die Seite neu laden darf, und importiert absichtlich nichts, damit es auch
 * läuft, wenn der Modulbaum nur halb im Cache ist. localStorage ist der einzige Kanal,
 * den beide Enden erreichen, und der Wert ist die Startzeit der Einheit, damit ein Leser
 * ein echtes Training von einem unterscheiden kann, das nie beendet wurde.
 *
 * Aufgerufen an den vier Stellen, an denen sich die Antwort ändern kann, nicht aus `emit`:
 * das ist ein synchrones Schreiben, und `emit` feuert bei jedem eingetragenen Satz.
 */
function markWorkoutOpen() {
  const open = activeSession();
  try {
    if (open) localStorage.setItem(WORKOUT_OPEN_KEY, String(open.startedAt));
    else localStorage.removeItem(WORKOUT_OPEN_KEY);
  } catch { /* privater Modus: Updates laden genauso neu wie früher */ }
}

/**
 * Wie lange ein Training offen ist, über den Punkt hinaus, an dem das noch glaubhaft ist.
 *
 * Nichts beendet eine Einheit von selbst, und `startSession` gibt die offene zurück, statt
 * eine zweite anzufangen. Während eines Trainings ist das richtig, drei Tage später falsch,
 * dann heißt es still, dass man nichts anfangen kann und die Uhr 72 h zeigt. Zwölf Stunden
 * sind keine Trainingsregel, nur länger als jede Einheit, die wirklich jemand macht.
 */
export const STALE_SESSION_HOURS = 12;

export function staleSession() {
  const open = activeSession();
  if (!open) return null;
  const hours = (Date.now() - open.startedAt) / 3600000;
  return hours >= STALE_SESSION_HOURS ? { session: open, hours } : null;
}

export const units = () => state.settings.units;

/** Womit eine neu hinzugefügte Übung im Plan anfängt. Erst die Einstellungen, danach der Standard der App. */
export const defaultSets = () => {
  const n = Number(state.settings.defaultSets);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : SETS_PER_EXERCISE;
};
export const defaultReps = () =>
  (state.settings.defaultReps || '').trim() || REP_TARGET;

/** Die Qualitätssterne werden getrennt von den Stärkestufen ausgeblendet, das sind verschiedene Dinge. */
export const starsShown = () => state.settings.showStars !== false;

/** Die Stange, von der die Scheibenrechnung ausgeht, sonst der Standard für die Einheit. */
export const barWeight = () => {
  const set = Number(state.settings.barWeight);
  return set > 0 ? set : DEFAULT_BAR[units()] ?? DEFAULT_BAR.kg;
};

/**
 * Der kleinste Schritt, den diese Maschine wirklich kann, falls der Nutzer ihn angegeben hat.
 *
 * Pro Übung im Sheet zur Maschineneinstellung gespeichert, weil das eine Tatsache über
 * ein Gerät in einem Studio ist und keine Vorliebe: ein Block in Fünferschritten kann
 * keine 102,5 liefern, und jeder Gewichtsvorschlag in der App ist ein Vielfaches von
 * etwas. Gibt null zurück, wenn nichts eingestellt ist, dann nimmt der Aufrufer den
 * Standard für das Gerät.
 */
export const machineStep = (exercise) => {
  const step = Number(state.settings.machineSetups?.[exercise?.id]?.step);
  return step > 0 ? step : null;
};

// Einstellungen

export async function setSetting(key, value) {
  const updatedAt = Date.now();
  state.settings[key] = value;
  state.settingsUpdatedAt[key] = updatedAt;
  await db.put(db.STORES.settings, { key, value, updatedAt });
  emit();
}

// Übungen

export async function addExercise({ name, muscle, equipment }) {
  const ex = {
    id: db.uid('ex_'),
    name: name.trim(), muscle, equipment: equipment || 'Other',
    // Ohne das ist eine eigene Übung für alles Wichtige unsichtbar: sie färbt keinen Muskel
    // auf der Karte, bringt kein Volumen in die Planbewertung und gilt als Bewegung, die
    // nichts trainiert.
    primary: regionsForMuscle(muscle),
    secondary: [],
    instructions: [],
    mech: null,
    isCustom: true, createdAt: Date.now(),
  };
  state.exercises.push(ex);
  await db.put(db.STORES.exercises, ex);
  reindex(); emit();
  return ex;
}

export async function toggleFavourite(id) {
  const ex = state.exerciseById.get(id);
  if (!ex) return null;
  ex.favourite = !ex.favourite;
  await db.put(db.STORES.exercises, ex);
  emit();
  return ex.favourite;
}

/** Favoriten zuerst, danach die Reihenfolge des Aufrufers. */
export function favouriteFirst(list) {
  return [...list].sort((a, b) => (b.favourite ? 1 : 0) - (a.favourite ? 1 : 0));
}

export async function updateExercise(id, patch) {
  const ex = state.exerciseById.get(id);
  if (!ex) return null;
  // Wer eine Übung in eine andere Muskelgruppe verschiebt, muss ihre Regionen auf der Karte
  // mitnehmen, sonst antworten Karte und jede Volumenzählung weiter für die alte. Nur bei
  // einer echten Änderung: die gepflegten Einträge haben von Hand geschriebene Regionen
  // aus CONTRIB, die viel besser sind als die grobe Zuordnung.
  const movedGroup = patch.muscle && patch.muscle !== ex.muscle;
  Object.assign(ex, patch);
  if (movedGroup) {
    ex.primary = regionsForMuscle(ex.muscle);
    ex.secondary = [];
  }
  await db.put(db.STORES.exercises, ex);
  reindex(); emit();
  return ex;
}

/** Eigene Bewertung 1 bis 5, oder 0 zum Löschen. Getrennt von der Bewertung aus den Studien. */
export async function setMyRating(id, value) {
  const ex = state.exerciseById.get(id);
  if (!ex) return null;
  ex.myRating = value > 0 ? Math.max(1, Math.min(5, Math.round(value))) : null;
  await db.put(db.STORES.exercises, ex);
  emit();
  return ex.myRating;
}

export function exerciseUsageCount(id) {
  return state.sessions.reduce(
    (n, s) => n + (s.entries.some((e) => e.exerciseId === id) ? 1 : 0), 0);
}

export async function deleteExercise(id) {
  const removed = state.exercises.find((e) => e.id === id);
  state.exercises = state.exercises.filter((e) => e.id !== id);
  await db.remove(db.STORES.exercises, id);
  if (removed) await recordDeletion('exercises', id, removed.updatedAt || removed.createdAt);
  // Und aus den Plänen. Das fehlte: der Dialog zum Löschen hat es versprochen, der
  // Plan-Screen zeigte eine leere Zeile, wo die Übung gewesen war, und die Planbewertung
  // hat still einen Platz mitgezählt, der nichts trainiert.
  for (const p of state.plans) {
    let touched = false;
    for (const day of p.days || []) {
      const before = day.items.length;
      day.items = day.items.filter((i) => i.exerciseId !== id);
      if (day.items.length !== before) touched = true;
    }
    if (touched) { p.updatedAt = Date.now(); await db.put(db.STORES.plans, p); }
  }
  reindex(); emit();
}

/** In wie vielen Plantagen eine Übung vorkommt, für eine ehrliche Warnung beim Löschen. */
export function planUsageCount(id) {
  return state.plans.reduce((n, p) =>
    n + (p.days || []).filter((d) => d.items.some((i) => i.exerciseId === id)).length, 0);
}

// Pläne

export function activePlan() {
  const id = state.settings.activePlanId;
  return (id && state.plans.find((p) => p.id === id)) || null;
}

/**
 * Einen Plan aus einer Vorlage bauen.
 * @param opts { empty }, bei true bleibt der Aufbau der Tage, aber ohne Übungen,
 *   die trägt man selbst ein.
 */
export async function createPlanFromBlueprint(blueprint, { empty = false } = {}) {
  const days = buildPlanDays(blueprint, state.exercises, {
    empty,
    sets: defaultSets(),
    reps: defaultReps(),
  });

  const plan = {
    id: db.uid('p_'),
    name: blueprint.name,
    presetKey: blueprint.key || null,
    repTarget: defaultReps(),
    // wie oft der ganze Zyklus pro Woche läuft, die Bewertung rechnet damit
    perWeek: blueprint.perWeek || 1,
    days,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  state.plans.push(plan);
  await db.put(db.STORES.plans, plan);
  await setSetting('activePlanId', plan.id);
  return plan;
}

export async function savePlan(plan) {
  const existing = state.plans.find((p) => p.id === plan.id);
  const persisted = plan.id ? await db.get(db.STORES.plans, plan.id) : null;
  const rec = {
    id: plan.id || db.uid('p_'),
    name: (plan.name || 'Plan').trim(),
    presetKey: plan.presetKey ?? (existing ? existing.presetKey : null),
    repTarget: plan.repTarget ?? (existing ? existing.repTarget : defaultReps()),
    perWeek: plan.perWeek ?? (existing ? existing.perWeek : 1),
    days: plan.days || [],
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now(),
  };
  if (existing) Object.assign(existing, rec);
  else state.plans.push(rec);
  await db.put(db.STORES.plans, rec);
  if (persisted && JSON.stringify(persisted.days) !== JSON.stringify(rec.days)) {
    const versions = { ...(state.settings.planVersions || {}) };
    const rows = [...(versions[rec.id] || []), {
      savedAt: Date.now(), name: persisted.name, days: persisted.days,
      repTarget: persisted.repTarget, perWeek: persisted.perWeek,
    }].slice(-10);
    versions[rec.id] = rows;
    state.settings.planVersions = versions;
    await db.put(db.STORES.settings, { key: 'planVersions', value: versions });
  }
  if (!state.settings.activePlanId) await setSetting('activePlanId', rec.id);
  else emit();
  return rec;
}

/**
 * Einen Plan anlegen, der über einen Link zum Teilen gekommen ist.
 *
 * Übungen werden über den normalisierten Namen mit der vorhandenen Bibliothek
 * abgeglichen, was fehlt, wird als eigene Übung angelegt, mit Regionen aus seiner
 * Muskelgruppe. So hinterlässt ein geteilter Plan nie stille Lücken in der Muskelkarte
 * oder in der Volumenzählung, wie es eine Übung ohne Regionen täte.
 *
 * @returns {{plan:object, created:string[]}}
 */
export async function importSharedPlan(shared) {
  const byName = new Map(state.exercises.map((e) => [normName(e.name), e]));
  const created = [];

  // Ein Durchgang legt alles Fehlende an, damit die Zuordnung der Tage unten davon
  // ausgehen kann, dass jeder Name gefunden wird.
  for (const day of shared.days) {
    for (const item of day.items) {
      const key = normName(item.name);
      if (byName.has(key)) continue;
      const ex = await addExercise({
        name: item.name,
        muscle: item.muscle,
        equipment: item.equipment,
      });
      byName.set(key, ex);
      created.push(ex.name);
    }
  }

  const plan = {
    id: db.uid('p_'),
    name: shared.name,
    presetKey: null,
    repTarget: shared.repTarget || defaultReps(),
    perWeek: shared.perWeek || 1,
    days: shared.days.map((day) => ({
      id: db.uid('d_'),
      name: day.name,
      weekday: Number.isInteger(day.weekday) ? day.weekday : null,
      items: day.items.map((item) => ({
        exerciseId: byName.get(normName(item.name)).id,
        targetSets: item.sets,
        targetReps: item.reps || shared.repTarget || defaultReps(),
        note: '',
      })),
      target: [],
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  state.plans.push(plan);
  await db.put(db.STORES.plans, plan);
  // Absichtlich nicht aktiv geschaltet: den Plan von jemandem zu importieren ist Stöbern,
  // keine Entscheidung. Der Plan-Screen bietet den Wechsel an.
  emit();
  return { plan, created };
}

export async function deletePlan(id) {
  const removed = state.plans.find((p) => p.id === id);
  state.plans = state.plans.filter((p) => p.id !== id);
  await db.remove(db.STORES.plans, id);
  if (removed) await recordDeletion('plans', id, removed.updatedAt || removed.createdAt);
  if (state.settings.activePlanId === id) {
    await setSetting('activePlanId', state.plans.length ? state.plans[0].id : null);
  } else {
    emit();
  }
}

// Einheiten

async function persistSession(session) {
  session.updatedAt = Date.now();
  await db.put(db.STORES.sessions, session);
  emit();
}

export async function startSession({ planId = null, dayId = null, name } = {}) {
  const existing = activeSession();
  if (existing) return existing;

  // Eine Einheit entsteht entweder aus einem Plantag oder startet leer.
  let items = null;
  let label = null;

  if (planId && dayId) {
    const plan = state.plans.find((p) => p.id === planId);
    const day = plan && plan.days.find((d) => d.id === dayId);
    if (day) { items = day.items; label = `${day.name}`; }
  }

  const entries = (items || []).map((item) => {
    const sets = [];
    const target = Math.max(1, Number(item.targetSets) || 3);
    for (let i = 0; i < target; i++) sets.push(newSet());
    // targetReps kommt mit dem Eintrag mit, damit der Screen zum Eintragen sagen kann, ob
    // der Bereich geschafft ist. Ohne das hat der Vorschlag zur Progression nichts zum
    // Vergleichen.
    return {
      ...newEntry(item.exerciseId, sets),
      note: item.note || '',
      targetReps: item.targetReps || null,
      progressionRule: item.progressionRule || 'double',
      alternativeExerciseId: item.alternativeExerciseId || null,
    };
  });

  const session = newSession(db.uid, {
    planId,
    dayId,
    // Beim Anlegen übersetzt, danach sind es Daten wie jeder andere Name, den der Nutzer
    // hätte tippen können. Ein späterer Sprachwechsel schreibt die Vergangenheit nicht um.
    name: name || label || t('train.quickWorkout'),
    entries,
    plannedDurationMs: items ? estimatePlanDuration(items, state.settings.restSeconds) : null,
  });
  session.originDevice = installationId();
  state.sessions.unshift(session);
  await persistSession(session);
  markWorkoutOpen();
  return session;
}

export async function duplicateSession(source) {
  if (activeSession() || !source) return activeSession();
  const entries = (source.entries || []).map((entry) => ({
    ...newEntry(entry.exerciseId, (entry.sets || []).map((set) => ({ ...newSet(set), type: set.type || 'working' }))),
    note: entry.note || '', movementMode: entry.movementMode || 'bilateral',
    targetReps: entry.targetReps || null, progressionRule: entry.progressionRule || 'double',
    alternativeExerciseId: entry.alternativeExerciseId || null,
  }));
  const session = newSession(db.uid, { name: source.name, entries, plannedDurationMs: source.plannedDurationMs || null });
  session.originDevice = installationId();
  state.sessions.unshift(session);
  await persistSession(session); markWorkoutOpen();
  return session;
}

export async function pauseSession(id) {
  return updateSession(id, (session) => {
    if (!session.finishedAt && !session.pausedAt) session.pausedAt = Date.now();
  });
}

export async function resumeSession(id) {
  return updateSession(id, (session) => {
    if (!session.pausedAt) return;
    session.pausedMs = (Number(session.pausedMs) || 0) + Math.max(0, Date.now() - session.pausedAt);
    session.pausedAt = null;
  });
}

/**
 * Die laufende Einheit ändern und speichern, oder keine Spur des Versuchs hinterlassen.
 *
 * Das ist der eine Weg, auf dem man sich Optimismus nicht leisten kann: er läuft bei
 * jedem abgeschlossenen Satz, mitten im Training, und ein Satz, der eingetragen aussieht,
 * aber nie geschrieben wurde, ist schlimmer als einer, der sichtbar gescheitert ist. Man
 * merkt es erst Wochen später und kann ihn nicht mehr rekonstruieren. Die Einheit wird
 * also zuerst kopiert und zurückgelegt, wenn das Schreiben scheitert, dann stimmen
 * Bildschirm und Platte wieder überein. Die Kopie geht absichtlich über JSON: diese
 * Einträge sind per Definition einfache Daten (sie stehen auch so in der
 * Sicherungsdatei), die Kopie ist also exakt und braucht kein structuredClone.
 *
 * Die Abmachung, damit das funktioniert: `mutate` muss jede Änderung enthalten. Ein
 * Aufrufer, der die Einheit vorher ändert und das hier dann mit leerem Callback aufruft,
 * bekommt eine Kopie der schon geänderten Einheit, und das Zurückrollen macht still nichts.
 */
export async function updateSession(id, mutate) {
  const index = state.sessions.findIndex((x) => x.id === id);
  if (index === -1) return null;

  const before = JSON.parse(JSON.stringify(state.sessions[index]));
  const s = state.sessions[index];
  mutate(s);
  try {
    await persistSession(s);
  } catch {
    // guard() hat den Fehler schon festgehalten und Bescheid gegeben. Das hier macht nur die
    // optimistische Änderung rückgängig, damit die Oberfläche nicht mehr behauptet, der Satz sei gespeichert.
    state.sessions[index] = before;
    emit();
    return null;
  }
  return s;
}

/**
 * Speichern ohne den Abonnenten Bescheid zu geben. Für Änderungen bei jedem Tastendruck,
 * ein Neuzeichnen mitten im Tippen würde das Feld und den Cursor zerstören.
 */
export async function saveSessionQuiet(session) {
  session.updatedAt = Date.now();
  await db.put(db.STORES.sessions, session);
}

export async function finishSession(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return null;
  // Leere Sätze und Übungen weglassen, damit der Verlauf sauber bleibt.
  s.entries = s.entries
    .map((e) => ({ ...e, sets: e.sets.filter((st) => st.done && Number(st.reps) > 0) }))
    .filter((e) => e.sets.length > 0);
  const now = Date.now();
  if (s.pausedAt) {
    s.pausedMs = (Number(s.pausedMs) || 0) + Math.max(0, now - s.pausedAt);
    s.pausedAt = null;
  }
  s.finishedAt = now;
  await persistSession(s);
  markWorkoutOpen();
  return s;
}

export async function discardSession(id) {
  const removed = state.sessions.find((s) => s.id === id);
  state.sessions = state.sessions.filter((s) => s.id !== id);
  await db.remove(db.STORES.sessions, id);
  if (removed) await recordDeletion('sessions', id, removed.updatedAt || Date.now());
  markWorkoutOpen();
  emit();
}

export async function restoreSession(session) {
  const restored = JSON.parse(JSON.stringify(session));
  restored.updatedAt = Date.now();
  state.sessions = state.sessions.filter((row) => row.id !== restored.id);
  state.sessions.push(restored);
  const deletions = (state.settings.syncDeletions || [])
    .filter((row) => !(row.collection === 'sessions' && row.id === restored.id));
  await db.put(db.STORES.settings, { key: 'syncDeletions', value: deletions });
  state.settings.syncDeletions = deletions;
  await db.put(db.STORES.sessions, restored);
  reindex(); markWorkoutOpen(); emit();
  return restored;
}

async function recordDeletion(collection, id, rowUpdatedAt = 0) {
  const previous = Number(rowUpdatedAt);
  const deletions = [...(state.settings.syncDeletions || [])
    .filter((row) => !(row.collection === collection && row.id === id)), {
      collection, id, deletedAt: Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0),
    }];
  state.settings.syncDeletions = deletions;
  await db.put(db.STORES.settings, { key: 'syncDeletions', value: deletions });
}

// Ernährung

export async function addFood(fields) {
  const food = newFood(db.uid, fields);
  state.foods.push(food);
  await db.put(db.STORES.foods, food);
  reindex(); emit();
  return food;
}

export async function updateFood(id, patch) {
  const food = state.foods.find((f) => f.id === id);
  if (!food) return null;
  Object.assign(food, patch);
  food.updatedAt = Date.now();
  await db.put(db.STORES.foods, food);
  reindex(); emit();
  return food;
}

export async function deleteFood(id) {
  const removed = state.foods.find((f) => f.id === id);
  state.foods = state.foods.filter((f) => f.id !== id);
  await db.remove(db.STORES.foods, id);
  if (removed) await recordDeletion('foods', id, removed.updatedAt || removed.createdAt);
  // Eingetragene Mahlzeiten bleiben absichtlich stehen. Sie haben ihre eigene Kopie von
  // Name und Zahlen (siehe newMeal). Ein Lebensmittel zu löschen ändert also die eigene
  // Liste, nie den Verlauf, dieselbe Regel wie in der Übungsbibliothek bei eingetragenen Einheiten.
  emit();
}

/** Eine Portion eintragen. Die Werte werden kopiert, damit eine Änderung am Lebensmittel nie die Vergangenheit umschreibt. */
export async function logMeal(foodId, { amount = 1, day = dayKey(), at = Date.now(), slot = null } = {}) {
  const food = state.foods.find((f) => f.id === foodId);
  if (!food) return null;

  const meal = newMeal(db.uid, food, { amount, day, at, slot });
  state.meals.unshift(meal);
  food.uses = (food.uses || 0) + 1;
  food.updatedAt = Date.now();

  await Promise.all([
    db.put(db.STORES.meals, meal),
    db.put(db.STORES.foods, food),
  ]);
  reindex(); emit();
  return meal;
}

export async function deleteMeal(id) {
  const removed = state.meals.find((m) => m.id === id);
  state.meals = state.meals.filter((m) => m.id !== id);
  await db.remove(db.STORES.meals, id);
  if (removed) await recordDeletion('meals', id, removed.updatedAt || removed.at);
  emit();
}

/** Eine eingetragene Portion in eine andere Tageszeit schieben oder ändern, wie viel es war. */
export async function updateMeal(id, patch) {
  const meal = state.meals.find((m) => m.id === id);
  if (!meal) return null;

  if (patch.amount !== undefined) {
    // Aus den Werten pro Portion neu rechnen und nicht aus den aktuellen Summen, damit
    // mehrere Änderungen nicht auseinanderdriften.
    const factor = (Number(patch.amount) || 1) / (meal.amount || 1);
    for (const key of ['protein', 'kcal', 'carbs', 'fat', 'fibre']) {
      if (meal[key] !== null && meal[key] !== undefined) {
        meal[key] = Math.round(meal[key] * factor * 10) / 10;
      }
    }
    for (const [key, value] of Object.entries(meal.micros || {})) {
      if (value !== null && value !== undefined) {
        meal.micros[key] = Math.round(value * factor * 10) / 10;
      }
    }
    meal.amount = Number(patch.amount) || 1;
  }
  if (patch.slot !== undefined) meal.slot = patch.slot;
  meal.updatedAt = Date.now();

  await db.put(db.STORES.meals, meal);
  emit();
  return meal;
}

/**
 * Jede Portion von einem Tag auf einen anderen kopieren.
 *
 * Die Mahlzeiten werden so kopiert, wie sie eingetragen wurden, und nicht neu aus der
 * Lebensmittelliste abgeleitet. Ein wiederholter Tag soll der Tag sein, der wirklich
 * gegessen wurde, auch wenn man das Lebensmittel inzwischen geändert hat. Gibt zurück,
 * wie viele kopiert wurden.
 */
export async function copyDay(fromDay, toDay = dayKey()) {
  const source = mealsOn(fromDay);
  if (!source.length) return 0;

  const copies = source.map((m) => ({
    ...m,
    id: db.uid('m_'),
    day: toDay,
    // Gleiche Tageszeit, neues Datum, damit Reihenfolge und Tageszeiten erhalten bleiben.
    at: shiftToDay(m.at, toDay),
    updatedAt: Date.now(),
  }));

  state.meals.unshift(...copies);
  await db.putMany(db.STORES.meals, copies);
  reindex(); emit();
  return copies.length;
}

function shiftToDay(at, day) {
  const from = new Date(at);
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, from.getHours(), from.getMinutes()).getTime();
}

// gespeicherte Mahlzeiten

/**
 * Eine Kombination von Lebensmitteln unter einem Namen speichern.
 *
 * Speichert Lebensmittel-IDS und keine Werte, anders als eine eingetragene Mahlzeit. Die
 * ist Verlauf und darf sich nie bewegen, eine gespeicherte Mahlzeit ist ein Rezept.
 * Korrigiert man das Eiweiß beim Quark, soll das beim nächsten Frühstück daraus mitkommen.
 */
export async function saveTemplate({ name, items, slot = null, id = null }) {
  const existing = id && state.templates.find((t) => t.id === id);
  const rec = existing
    ? { ...existing, name: String(name).trim() || existing.name, items, slot, updatedAt: Date.now() }
    : newTemplate(db.uid, { name, items, slot });

  if (existing) Object.assign(existing, rec);
  else state.templates.push(rec);

  await db.put(db.STORES.templates, rec);
  reindex(); emit();
  return rec;
}

export async function deleteTemplate(id) {
  const removed = state.templates.find((t) => t.id === id);
  state.templates = state.templates.filter((t) => t.id !== id);
  await db.remove(db.STORES.templates, id);
  if (removed) await recordDeletion('templates', id, removed.updatedAt || removed.createdAt);
  emit();
}

/**
 * Jedes Lebensmittel einer gespeicherten Mahlzeit eintragen.
 *
 * Ein Lebensmittel, das seit dem Speichern gelöscht wurde, wird übersprungen und gezählt,
 * statt leer eingetragen zu werden. Dieselbe Regel wie überall in der App bei Verweisen,
 * die ins Leere zeigen. Der Aufrufer kann das dann sagen.
 */
export async function logTemplate(id, { day = dayKey(), slot = null } = {}) {
  const template = state.templates.find((t) => t.id === id);
  if (!template) return null;

  let logged = 0, missing = 0;
  for (const item of template.items) {
    const meal = await logMeal(item.foodId, { day, amount: item.amount, slot: slot || template.slot });
    if (meal) logged++;
    else missing++;
  }

  template.uses = (template.uses || 0) + 1;
  template.updatedAt = Date.now();
  await db.put(db.STORES.templates, template);
  reindex(); emit();
  return { logged, missing, name: template.name };
}

// Wasser

/** Milliliter an einem Tag, 0, wenn nichts eingetragen ist. */
export function waterOn(day = dayKey()) {
  const row = state.water.find((w) => w.day === day);
  return row ? row.ml : 0;
}

/** Milliliter hinzufügen (oder abziehen). Geht nie unter null. */
export async function addWater(ml, day = dayKey()) {
  const next = Math.max(0, waterOn(day) + (Number(ml) || 0));
  const row = { day, ml: next, updatedAt: Date.now() };
  const existing = state.water.find((w) => w.day === day);
  if (existing) Object.assign(existing, row);
  else state.water.push(row);

  if (next === 0) {
    await db.remove(db.STORES.water, day);
    if (existing) await recordDeletion('water', day, existing.updatedAt);
    state.water = state.water.filter((item) => item.day !== day);
  }
  else await db.put(db.STORES.water, row);
  emit();
  return next;
}

export function mealsOn(day = dayKey()) {
  return state.meals.filter((m) => m.day === day).sort((a, b) => a.at - b.at);
}

// Körpergewicht

export async function logBodyweight(weight, date = Date.now()) {
  const day = new Date(date); day.setHours(12, 0, 0, 0);
  const existing = state.bodyweight.find(
    (b) => new Date(b.date).toDateString() === day.toDateString());
  const rec = existing
    ? { ...existing, weight: Number(weight) }
    : { id: db.uid('bw_'), date: day.getTime(), weight: Number(weight) };
  if (existing) Object.assign(existing, rec);
  else state.bodyweight.push(rec);
  await db.put(db.STORES.bodyweight, rec);

  // Das Gewicht im Profil im Gleichschritt mit dem Log halten.
  //
  // Die App hat zwei Körpergewichte und hat sie früher an genau einer Stelle
  // abgeglichen, im Profilformular. Alles, was am Körpergewicht hängt, liest das aus dem
  // Profil: die Stärkewertung auf Home, die Stärkestufe jeder Übung, der Eiweißbereich
  // und darüber die Ziele für Kalorien und Kohlenhydrate. Der wöchentliche Stärkeverlauf
  // und die Schätzung des Bedarfs lesen das Log. Wer sich im Fortschritt-Screen gewogen
  // hat, hat also die eine Zahl bewegt und die andere nicht, und beide waren still
  // uneins, solange man die Einstellungen nicht geöffnet hat.
  //
  // Nur der neueste Eintrag zählt, weil sich `date` ändern lässt: das Wiegen vom letzten
  // Dienstag zu korrigieren darf nicht "dein Gewicht jetzt" werden.
  const latest = latestWeight(state.bodyweight);
  if (latest !== null && latest !== Number(state.settings.bodyweight)) {
    await setSetting('bodyweight', latest);
  }

  reindex(); emit();
  return rec;
}

export async function deleteBodyweight(id) {
  const removed = state.bodyweight.find((b) => b.id === id);
  state.bodyweight = state.bodyweight.filter((b) => b.id !== id);
  await db.remove(db.STORES.bodyweight, id);
  if (removed) await recordDeletion('bodyweight', id, removed.updatedAt || removed.date);
  emit();
}

// Sicherung

/**
 * Ob es Zeit ist, an eine Sicherung zu erinnern, und warum.
 *
 * Den Export gab es schon immer, was gefehlt hat, war die Erinnerung. In einer
 * installierten Web-App auf dem Homescreen sind die Daten vor dem automatischen Löschen
 * ziemlich sicher. Nicht sicher sind sie davor, dass man die App löscht, das Handy
 * verliert oder eine Wiederherstellung schiefgeht, und bei nichts davon gibt es vorher eine Warnung.
 */
export const BACKUP_AFTER_WORKOUTS = 10;
export const BACKUP_AFTER_DAYS = 28;

export function backupStatus() {
  const last = Number(state.settings.lastExportAt) || 0;
  const finished = state.sessions.filter((s) => s.finishedAt);
  if (!finished.length) return { due: false, since: 0, days: 0, last };

  const since = finished.filter((s) => s.finishedAt > last).length;
  const days = last ? Math.floor((Date.now() - last) / 86400000) : null;

  if (!last) {
    return { due: finished.length >= 3, since, days, last, reason: 'never' };
  }
  if (since >= BACKUP_AFTER_WORKOUTS) return { due: true, since, days, last, reason: 'workouts' };
  if (days >= BACKUP_AFTER_DAYS && since > 0) return { due: true, since, days, last, reason: 'time' };
  return { due: false, since, days, last };
}

export async function markExported() {
  await setSetting('lastExportAt', Date.now());
}

export function exportData() {
  return {
    format: 'liftlog-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    settingsUpdatedAt: state.settingsUpdatedAt,
    exercises: state.exercises,
    plans: state.plans,
    sessions: state.sessions,
    bodyweight: state.bodyweight,
    foods: state.foods,
    meals: state.meals,
    water: state.water,
    templates: state.templates,
    deletions: state.settings.syncDeletions || [],
  };
}

export async function importData(payload, { replace = true } = {}) {
  if (!payload || payload.format !== 'liftlog-backup') {
    throw new Error('Not a LiftLog backup file.');
  }
  // Die ganze Datei prüfen, bevor irgendetwas gelöscht wird. Eine Wiederherstellung leert
  // jeden Store und schreibt dann. Eine Datei, die die Formatprüfung besteht, aber einen
  // abgeschnittenen oder falsch getypten Inhalt hat, hat einem früher weder die Sicherung
  // noch den alten Stand gelassen. Billig zu prüfen, unmöglich rückgängig zu machen.
  const lists = ['exercises', 'plans', 'sessions', 'bodyweight', 'foods', 'meals', 'water', 'templates', 'deletions'];
  for (const key of lists) {
    if (payload[key] !== undefined && !Array.isArray(payload[key])) {
      throw new Error(`This backup is damaged: "${key}" is not a list.`);
    }
  }
  if (payload.settings !== undefined && (typeof payload.settings !== 'object' || payload.settings === null)) {
    throw new Error('This backup is damaged: its settings are unreadable.');
  }
  if (payload.settingsUpdatedAt !== undefined
      && (typeof payload.settingsUpdatedAt !== 'object' || payload.settingsUpdatedAt === null
          || Array.isArray(payload.settingsUpdatedAt))) {
    throw new Error('This backup is damaged: its settings are unreadable.');
  }
  if (!lists.some((key) => (payload[key] || []).length)) {
    throw new Error('This backup is empty: nothing would be restored.');
  }

  // IndexedDB würde einen fehlenden Schlüssel erst ablehnen, wenn das alte Log schon
  // angefasst ist. Deshalb erst jeden Eintrag prüfen und kaputte oder böswillige Dateien begrenzen.
  const keyFor = {
    exercises: 'id', plans: 'id', sessions: 'id', bodyweight: 'id',
    foods: 'id', meals: 'id', water: 'day', templates: 'id', deletions: 'id',
  };
  const totalRows = lists.reduce((sum, key) => sum + (payload[key] || []).length, 0);
  if (totalRows > 100000) throw new Error('This backup contains too many records.');
  for (const key of lists) {
    for (const [index, row] of (payload[key] || []).entries()) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`This backup is damaged: "${key}" item ${index + 1} is invalid.`);
      }
      const recordKey = row[keyFor[key]];
      if ((typeof recordKey !== 'string' && typeof recordKey !== 'number') || String(recordKey).length > 256) {
        throw new Error(`This backup is damaged: "${key}" item ${index + 1} has no valid key.`);
      }
      if (key === 'deletions') {
        const allowed = ['exercises', 'plans', 'sessions', 'bodyweight', 'foods', 'meals', 'water', 'templates'];
        if (!allowed.includes(row.collection) || !Number.isFinite(Number(row.deletedAt))) {
          throw new Error(`This backup is damaged: deletion ${index + 1} is invalid.`);
        }
      }
    }
  }
  const settings = { ...(payload.settings || {}) };
  if (payload.deletions !== undefined) settings.syncDeletions = payload.deletions;
  if (Object.keys(settings).length > 500) throw new Error('This backup contains too many settings.');
  for (const key of Object.keys(settings)) {
    if (!key || key.length > 128) throw new Error('This backup contains an invalid setting name.');
  }

  // Die Zeitpunkte je Schlüssel durch die Wiederherstellung mitnehmen, sonst hielte das
  // erste Zusammenführen danach jede Einstellung für undatiert und fiele auf "Gegenseite gewinnt" zurück.
  const times = payload.settingsUpdatedAt || {};
  const settingRows = Object.entries(settings).map(([key, value]) =>
    (times[key] ? { key, value, updatedAt: times[key] } : { key, value }));
  if (replace) {
    // Alles außer den eigenen Kryptoschlüsseln dieses Geräts.
    //
    // `keys` enthält die Identität des Geräts für die Cloud-Sicherung: sein Schlüsselpaar
    // und die ID, unter der der Server es kennt. Das sind Eigenschaften des Handys, nicht
    // des Logs, und keine Sicherung enthält sie. Sie hier zu löschen hieß, dass eine
    // Wiederherstellung aus der Cloud genau das zerstört hat, was den Download gerade
    // entschlüsselt hatte: das Gerät kam als Fremder zurück, konnte seinen eigenen
    // Datenschlüssel nicht mehr auspacken und musste neu freigegeben oder wiederhergestellt werden.
    await db.replaceBackupData({
      [db.STORES.exercises]: payload.exercises || [],
      [db.STORES.plans]: payload.plans || [],
      [db.STORES.sessions]: payload.sessions || [],
      [db.STORES.bodyweight]: payload.bodyweight || [],
      [db.STORES.foods]: payload.foods || [],
      [db.STORES.meals]: payload.meals || [],
      [db.STORES.water]: payload.water || [],
      [db.STORES.templates]: payload.templates || [],
      [db.STORES.settings]: settingRows,
    });
    await load();
    return;
  }
  // `plans` fehlte bis jetzt auf beiden Seiten: exportData hat es nie geschrieben und
  // importData nie gelesen, eine Wiederherstellung hat also still jeden Trainingsplan
  // verloren. Ältere Sicherungsdateien haben einfach keinen `plans`-Schlüssel und landen
  // beim leeren Array.
  await Promise.all([
    db.putMany(db.STORES.exercises, payload.exercises || []),
    db.putMany(db.STORES.plans, payload.plans || []),
    db.putMany(db.STORES.sessions, payload.sessions || []),
    db.putMany(db.STORES.bodyweight, payload.bodyweight || []),
    db.putMany(db.STORES.foods, payload.foods || []),
    db.putMany(db.STORES.meals, payload.meals || []),
    db.putMany(db.STORES.water, payload.water || []),
    db.putMany(db.STORES.templates, payload.templates || []),
    db.putMany(db.STORES.settings, settingRows),
  ]);
  await load();
}
