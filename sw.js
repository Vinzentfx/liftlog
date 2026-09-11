// Offline-Hülle. CACHE hochzählen, wenn sich etwas ändert, damit die Geräte es mitbekommen.
const CACHE = 'liftlog-v150';

/**
 * Die großen Datentabellen, in einem eigenen Cache mit eigener Version.
 *
 * Die Installation hat früher alle 75 Dateien mit `cache: 'reload'` neu geholt, das
 * sind 2,1 MB, davon 840 KB Übungskatalog, Lebensmittel- und Markentabellen und der
 * Bildindex. Diese Dateien haben sich im ganzen Leben des Repos viermal geändert,
 * und ein einzeiliger CSS-Fix hat jedes Handy trotzdem den ganzen Download gekostet.
 *
 * Sie behalten dieselbe Alles-oder-nichts-Garantie, nur gegen ihre eigene Version:
 * ein neuer Stand der Hülle lässt diesen Cache in Ruhe, geholt wird nur, was
 * wirklich fehlt. DATA_CACHE hochzählen, wenn sich eine dieser Dateien wirklich
 * ändert, also fast nie. strings.js steht absichtlich NICHT hier: 53 Commits und es
 * werden mehr.
 */
const DATA_CACHE = 'liftlog-data-v1';

const DATA = [
  './js/exercise-library.js',
  './js/exercise-extra.js',
  './js/exercise-images.js',
  './js/brand-library.js',
  './js/food-library.js',
];

// assets/exercises/*.webp werden absichtlich NICHT vorab gecacht. Etwa 270 Übungen
// mal 2 Bilder würden die Installation aufblähen, und die meisten öffnet nie jemand.
// Der Handler für den Laufzeit-Cache holt jedes Bild beim ersten Ansehen.
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './privacy.html',
  './legal.html',
  './css/styles.css',
  './js/bootstrap.js',
  './js/app.js',
  './js/i18n.js',
  './js/crypto.js',
  './js/cloud.js',
  './js/cloud-config.js',
  './js/demo.js',
  './js/push.js',
  './js/sync.js',
  './js/strings.js',
  './js/db.js',
  './js/models.js',
  './js/store.js',
  './js/ui.js',
  './js/charts.js',
  './js/rest.js',
  './js/pickers.js',
  './js/exercise-search.js',
  './js/plan-builder.js',
  './js/plan-rating.js',
  './js/exercise-rating.js',
  './js/exercise-science.js',
  './js/evidence.js',
  './js/rating-ui.js',
  './js/log-analysis.js',
  './js/plan-doctor.js',
  './js/swaps.js',
  './js/history.js',
  './js/timeline.js',
  './js/nutrition.js',
  './js/foodlookup.js',
  './js/schedule.js',
  './js/region-progress.js',
  './js/plan-share.js',
  './js/plates.js',
  './js/warmup.js',
  './js/progression.js',
  './js/workout-start.js',
  './js/gym-location.js',
  './js/foodsearch.js',
  './js/fatigue.js',
  './js/canvas-kit.js',
  './js/week-card.js',
  './js/week-share.js',
  './js/exercise-art.js',
  './js/standards.js',
  './js/bodymap.js',
  './js/rank-art.js',
  './js/screens/home.js',
  './js/screens/train.js',
  './js/screens/plans.js',
  './js/screens/library.js',
  './js/screens/calendar.js',
  './js/screens/progress.js',
  './js/screens/settings.js',
  './js/screens/account.js',
  './js/screens/gate.js',
  './js/screens/nutrition.js',
  './js/screens/share.js',
  './js/screens/users.js',
  './assets/body-front.svg',
  './assets/body-back.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'LiftLog', {
    body: data.body || '', icon: './icons/icon-192.png', badge: './icons/icon-192.png',
    tag: data.tag || 'liftlog-training-invite', data: { url: data.url || './#/users' },
    actions: data.actions || [],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let url = event.notification.data?.url || './#/users';
  if (event.action === 'taken') url = './?creatine=taken#/home';
  if (event.action === 'snooze') url = './?creatine=snooze#/home';
  const target = new URL(url, self.location.href).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const open = windows[0];
    if (open) return open.focus().then(() => open.navigate(target));
    return clients.openWindow(target);
  }));
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Nie einen Cache aktivieren, in dem nur ein halber Deploy steckt. Cloudflare und
    // GitHub stellen Dateien manchmal Sekunden versetzt bereit. Eine gescheiterte
    // Installation wird wiederholt, ein unvollständiger Cache dagegen ließe die ganze
    // PWA nicht mehr starten. Beide addAll-Aufrufe halten das ein: entweder kommt
    // alles an, oder die Installation wirft und wird wiederholt.
    const shell = await caches.open(CACHE);
    await shell.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })));

    // Übersteht einen neuen Stand der Hülle, nach der ersten Installation passiert
    // hier also meistens nichts. Was schon da ist, bleibt genau so.
    const data = await caches.open(DATA_CACHE);
    const held = await Promise.all(DATA.map((url) => data.match(url)));
    const missing = DATA.filter((url, i) => !held[i]);
    if (missing.length) {
      await data.addAll(missing.map((url) => new Request(url, { cache: 'reload' })));
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k !== CACHE && k !== DATA_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Seitenaufrufe: erst das Netz versuchen, damit Updates ankommen, offline die gecachte Hülle.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const type = res.headers.get('content-type') || '';
          const path = new URL(res.url).pathname;
          if (res.ok && type.includes('text/html') && (path.endsWith('/') || path.endsWith('/index.html'))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || Response.error()))
    );
    return;
  }

  // Dateien: zuerst aus dem Cache, im Hintergrund auffrischen.
  event.respondWith(
    caches.match(request).then((cached) => {
      // Eine aufgefrischte Datendatei gehört in den Daten-Cache, sonst würde der
      // nächste neue Stand der Hülle sie löschen und die Ersparnis gleich mit.
      const path = new URL(request.url).pathname;
      const target = DATA.some((url) => path.endsWith(url.slice(1))) ? DATA_CACHE : CACHE;
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(target).then((c) => c.put(request, copy));
          }
          return res;
        })
        // Offline und nichts im Cache: mit einer echten Response antworten, nie mit
        // undefined. respondWith(undefined) wirft und beendet die Anfrage.
        .catch(() => cached || new Response('', { status: 504, statusText: 'Offline' }));
      return cached || network;
    })
  );
});
