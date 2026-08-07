// Keep service-worker recovery independent from app.js. A partially cached
// module graph cannot register its own repair because it never executes.
//
// Which is also why this file imports nothing. It talks to the rest of the app
// through one localStorage key, written by js/store.js.

// How long a session may stay open before an update stops waiting for it. Same
// twelve hours the app uses to call a session stale: past that it is not a
// workout in progress, it is one nobody closed.
const STALE_WORKOUT_MS = 12 * 60 * 60 * 1000;

/** True while a workout is actually being logged right now. */
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
   * A new worker has taken over, so this page is now running against a cache it
   * was not loaded from. Reloading fixes that, but not at any moment: the app
   * exists to be used mid-set, in a gym, and a deployment used to yank the page
   * out from under whoever happened to be training. The sets are safe in
   * IndexedDB either way; the rest timer, a half-typed weight and your place on
   * the screen are not.
   *
   * So the reload waits for the workout to end, and the app keeps running the
   * old code until then. That is the same code it has been running all along.
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
