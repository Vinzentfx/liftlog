// Offline shell. Bump CACHE when shipping changes so clients pick them up.
const CACHE = 'liftlog-v148';

/**
 * The bulk data tables, in their own cache with their own version.
 *
 * Installing used to refetch all 75 shell files with `cache: 'reload'`, which
 * is 2.1 MB, and 840 KB of that is the exercise catalogue, the food and brand
 * tables and the image index. Between them those files have changed four times
 * in the life of the repo, and a one-line CSS fix was costing every phone the
 * whole download again.
 *
 * They keep the same all-or-nothing guarantee, just against their own version:
 * a shell bump leaves this cache alone, and only what is genuinely missing is
 * fetched. Bump DATA_CACHE when one of these files actually changes, which is
 * almost never. strings.js is deliberately NOT here: 53 commits and counting.
 */
const DATA_CACHE = 'liftlog-data-v1';

const DATA = [
  './js/exercise-library.js',
  './js/exercise-extra.js',
  './js/exercise-images.js',
  './js/brand-library.js',
  './js/food-library.js',
];

// assets/exercises/*.webp are deliberately NOT precached — ~270 exercises x2
// frames would bloat the install and most are never opened. The runtime
// cache-first handler picks each one up the first time it's viewed.
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
    // Never activate a cache containing only half a deployment. Cloudflare
    // and GitHub may expose files seconds apart; a failed install is retried,
    // while an incomplete cache would leave the whole PWA unable to boot.
    // Both addAll calls keep that property: either everything lands or the
    // install throws and is retried.
    const shell = await caches.open(CACHE);
    await shell.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })));

    // Survives a shell bump, so this is usually a no-op after the first
    // install. Anything already held is left exactly as it is.
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

  // Navigations: try network so updates land, fall back to the cached shell offline.
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

  // Assets: cache-first, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      // A refreshed data file belongs in the data cache, or the next shell
      // bump would wipe it and the saving with it.
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
        // Offline with nothing cached: answer with a real Response, never
        // undefined — respondWith(undefined) throws and kills the request.
        .catch(() => cached || new Response('', { status: 504, statusText: 'Offline' }));
      return cached || network;
    })
  );
});
