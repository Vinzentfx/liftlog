// Offline shell. Bump CACHE when shipping changes so clients pick them up.
const CACHE = 'liftlog-v40';

// assets/exercises/*.webp are deliberately NOT precached — ~270 exercises x2
// frames would bloat the install and most are never opened. The runtime
// cache-first handler picks each one up the first time it's viewed.
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/models.js',
  './js/store.js',
  './js/ui.js',
  './js/charts.js',
  './js/rest.js',
  './js/pickers.js',
  './js/plan-builder.js',
  './js/plan-rating.js',
  './js/exercise-library.js',
  './js/exercise-extra.js',
  './js/exercise-rating.js',
  './js/exercise-science.js',
  './js/evidence.js',
  './js/rating-ui.js',
  './js/log-analysis.js',
  './js/plan-doctor.js',
  './js/swaps.js',
  './js/history.js',
  './js/nutrition.js',
  './js/foodlookup.js',
  './js/schedule.js',
  './js/region-progress.js',
  './js/plan-share.js',
  './js/plates.js',
  './js/food-library.js',
  './js/foodsearch.js',
  './js/fatigue.js',
  './js/canvas-kit.js',
  './js/week-card.js',
  './js/week-share.js',
  './js/exercise-images.js',
  './js/exercise-art.js',
  './js/standards.js',
  './js/bodymap.js',
  './js/screens/home.js',
  './js/screens/train.js',
  './js/screens/plans.js',
  './js/screens/library.js',
  './js/screens/calendar.js',
  './js/screens/progress.js',
  './js/screens/settings.js',
  './js/screens/nutrition.js',
  './js/screens/share.js',
  './assets/body-front.svg',
  './assets/body-back.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll is all-or-nothing; add individually so one 404 can't break install,
      // but log misses — a silently unprecached module breaks the app offline.
      //
      // `cache: 'reload'` is load-bearing: a plain cache.add() may satisfy itself
      // from the browser's HTTP cache, which happily pins a stale build into the
      // precache and serves it long after a deploy.
      .then((cache) => Promise.all(SHELL.map((url) =>
        cache.add(new Request(url, { cache: 'reload' }))
          .catch((err) => console.warn('[sw] precache miss', url, err)))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Navigations: try network so updates land, fall back to the cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || Response.error()))
    );
    return;
  }

  // Assets: cache-first, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        // Offline with nothing cached: answer with a real Response, never
        // undefined — respondWith(undefined) throws and kills the request.
        .catch(() => cached || new Response('', { status: 504, statusText: 'Offline' }));
      return cached || network;
    })
  );
});
