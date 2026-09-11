// Der Service Worker der öffentlichen Vorschau. Der Workflow veröffentlicht ihn
// als sw.js anstelle des echten, warum die Vorschau keine Offline-Kopie hat, steht
// in js/demo.js.
//
// Unter dieser Adresse lief bis zum Umzug zu Cloudflare die echte App. Ein Browser,
// der damals da war, hat also noch diesen Worker und liefert dessen gecachten Stand
// aus: die App mit Einladungssperre, leer, von Juli. Dieser Worker soll das beenden
// und danach nicht mehr im Weg sein.
//
// install   Sofort übernehmen, statt zu warten, bis jeder alte Tab zu ist.
// activate  Jeden Cache löschen, dann die Seiten, die der alte Worker bedient hat,
//           auf den aktuellen Stand schicken. Der ist älter als bootstrap.js und
//           lädt nicht von selbst neu, ohne das liefe er, bis jemand von Hand neu lädt.
//
// Zwei Dinge macht er bewusst nicht. Er ruft nie clients.claim() auf: ein erster
// Besuch bleibt ohne Worker, matchAll() unten sieht ihn also nicht, und nichts lädt
// eine Seite neu, die schon aktuell ist. Und er hat keinen fetch-Handler, jede
// Anfrage geht ins Netz, als gäbe es keinen Worker.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    const pages = await self.clients.matchAll({ type: 'window' });
    await Promise.all(pages.map((page) => page.navigate(page.url).catch(() => {})));
  })());
});
