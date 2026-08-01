// Keep service-worker recovery independent from app.js. A partially cached
// module graph cannot register its own repair because it never executes.
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((registration) => registration.update()).catch(() => {});
}
