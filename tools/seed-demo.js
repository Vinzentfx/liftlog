/**
 * Erzeugt Beispieldaten: 14 Wochen mit einem Dreier-Split, steigenden Gewichten und
 * einem absichtlichen Plateau um Woche 8, damit die Diagramme etwas zeigen.
 *
 * So geht's: LiftLog öffnen, die Browser-Konsole öffnen, die ganze Datei einfügen,
 * Enter. Wieder weg damit: Einstellungen (⚙), Alle Daten löschen.
 *
 * Ein Werkzeug zum Entwickeln und Vorführen, die App lädt es nicht.
 */
(async () => {
  const db = await import('/js/db.js');
  const store = await import('/js/store.js');

  await db.clear(db.STORES.sessions);
  await db.clear(db.STORES.bodyweight);

  const exs = await db.getAll(db.STORES.exercises);
  const byName = (n) => {
    const e = exs.find((x) => x.name === n);
    if (!e) throw new Error('missing exercise: ' + n);
    return e.id;
  };

  const DAYS = [
    { name: 'Push Day', items: [['Barbell Bench Press', 60, 2.5], ['Overhead Press', 35, 1.25], ['Triceps Pushdown', 25, 1.25]] },
    { name: 'Pull Day', items: [['Deadlift', 90, 5], ['Barbell Row', 55, 2.5], ['Barbell Curl', 25, 1.25]] },
    { name: 'Leg Day',  items: [['Back Squat', 75, 2.5], ['Romanian Deadlift', 60, 2.5], ['Leg Press', 120, 5]] },
  ];

  const WEEKS = 14;
  const now = Date.now();
  const sessions = [];
  let n = 0;

  for (let w = WEEKS - 1; w >= 0; w--) {
    for (let d = 0; d < 3; d++) {
      const day = DAYS[d];
      const start = now - (w * 7 + (4 - d * 2)) * 86400000 - 3 * 3600000;
      const weeksIn = WEEKS - 1 - w;

      const entries = day.items.map(([name, base, inc]) => {
        // gleichmäßig mehr, nach Woche 8 ein Plateau
        const progress = weeksIn > 8 ? 8 + (weeksIn - 8) * 0.35 : weeksIn;
        const weight = Math.round((base + progress * inc) * 2) / 2;
        const sets = [];
        for (let s = 0; s < 3; s++) {
          sets.push({
            weight,
            reps: Math.max(4, 9 - s + (Math.random() < 0.3 ? -1 : 0)),
            type: 'working',
            done: true,
          });
        }
        return { exerciseId: byName(name), sets, note: '' };
      });

      sessions.push({
        id: 's_demo_' + (n++),
        routineId: null,
        name: day.name,
        startedAt: start,
        finishedAt: start + (55 + Math.floor(Math.random() * 25)) * 60000,
        notes: '',
        entries,
      });
    }
  }
  await db.putMany(db.STORES.sessions, sessions);

  const bw = [];
  for (let i = WEEKS * 7; i >= 0; i -= 4) {
    bw.push({
      id: 'bw_demo_' + i,
      date: now - i * 86400000,
      weight: Math.round((78 + (WEEKS * 7 - i) * 0.018 + (Math.random() - 0.5) * 0.9) * 10) / 10,
    });
  }
  await db.putMany(db.STORES.bodyweight, bw);

  // Den `routines`-Store gibt es seit DB v4 nicht mehr (siehe js/db.js). Früher ist
  // das hier an `db.STORES.routines` gleich undefined gescheitert, und der Seeder kam
  // nie beim Neuladen unten an. Pläne haben die Routinen ersetzt, einen Beispielplan
  // gibt es absichtlich nicht, plan-builder.js erzeugt einen besseren als jede Vorlage.

  await store.load();
  console.log(`Seeded ${sessions.length} workouts and ${bw.length} bodyweight entries.`);
})();
