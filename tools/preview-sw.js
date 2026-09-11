// The service worker of the public preview. The workflow publishes it as sw.js
// in place of the real one; see js/demo.js for why the preview has no offline
// copy.
//
// This address served the real app until the move to Cloudflare, so a browser
// that visited back then still runs that worker and serves its cached build: the
// gated app, empty, from July. The job here is to end that and then get out of
// the way.
//
// install   Take over at once instead of waiting for every old tab to close.
// activate  Delete every cache, then send the pages the old worker was serving
//           to the current build. That build predates bootstrap.js and has no
//           reload of its own, so without this it keeps running until someone
//           reloads by hand.
//
// Two things it deliberately does not do. It never calls clients.claim(): a
// first visit stays uncontrolled, so matchAll() below cannot see it and nothing
// reloads a page that is already current. And it has no fetch handler, so every
// request goes to the network as if no worker existed.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    const pages = await self.clients.matchAll({ type: 'window' });
    await Promise.all(pages.map((page) => page.navigate(page.url).catch(() => {})));
  })());
});
