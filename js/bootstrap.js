// Die Reparatur des Service Workers bleibt unabhängig von app.js. Ein halb
// gecachter Modulbaum kann sich nicht selbst reparieren, weil er nie läuft.
//
// Deshalb importiert diese Datei auch nichts. Mit dem Rest der App redet sie über
// einen einzigen localStorage-Schlüssel, den js/store.js schreibt.

// Wie lange ein Training offen bleiben darf, bevor ein Update nicht mehr darauf
// wartet. Dieselben zwölf Stunden, ab denen die App ein Training als alt ansieht:
// danach läuft da kein Training mehr, es hat nur keiner beendet.
const STALE_WORKOUT_MS = 12 * 60 * 60 * 1000;

/** true, solange gerade wirklich ein Training eingetragen wird. */
function workoutOpen() {
  try {
    const startedAt = Number(localStorage.getItem('liftlog.workoutOpen')) || 0;
    return startedAt > 0 && Date.now() - startedAt < STALE_WORKOUT_MS;
  } catch {
    return false;
  }
}

if ('serviceWorker' in navigator) {
  let reloading = false;

  /**
   * Ein neuer Worker hat übernommen, die Seite läuft also gegen einen Cache, aus
   * dem sie nicht geladen wurde. Neu laden behebt das, aber nicht zu jedem
   * Zeitpunkt: die App wird mitten im Satz im Studio benutzt, und früher hat ein
   * Deploy die Seite einfach unter dem weggezogen, der gerade trainiert hat. Die
   * Sätze liegen so oder so sicher in IndexedDB, der Pausentimer, ein halb
   * eingetipptes Gewicht und die Stelle auf dem Bildschirm aber nicht.
   *
   * Deshalb wartet das Neuladen, bis das Training vorbei ist, und bis dahin läuft
   * der alte Code weiter. Das ist derselbe Code, der die ganze Zeit schon lief.
   */
  const reloadWhenIdle = () => {
    if (!workoutOpen()) {
      location.reload();
      return;
    }
    setTimeout(reloadWhenIdle, 5000);
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    reloadWhenIdle();
  });
  navigator.serviceWorker.register('./sw.js').then((registration) => registration.update()).catch(() => {});
}
