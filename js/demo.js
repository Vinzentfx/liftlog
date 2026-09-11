// Ob dieser Stand die öffentliche Vorschau ist.
//
// Im Repo steht immer false, die App für die Freunde ändert sich also nie, und
// tests/security.test.js schlägt fehl, falls das einmal nicht mehr stimmt. Der
// GitHub-Pages-Workflow (.github/workflows/pages.yml) schreibt vor dem
// Veröffentlichen true in seine eigene Kopie. Sonst setzt es niemand.
//
// Was die Vorschau anders macht, alles in js/app.js:
//   - keine Einladungssperre und kein Installationshinweis, Besucher haben keinen Code
//   - keine Cloud: nichts wird synchronisiert, und die CSP der veröffentlichten Kopie
//     lässt den Supabase-Host gar nicht zu. Ein verirrter Aufruf scheitert also im
//     Browser und erreicht nie das echte Projekt
//   - ein leeres Gerät wird beim ersten Start aus showcase-backup.json gefüllt
//   - keine Offline-Kopie: das veröffentlichte sw.js ist tools/preview-sw.js, weil
//     bootstrap.js einen Worker registriert, bevor irgendein Modul etwas sagen kann,
//     und der echte würde weiter die Beispieldaten der letzten Woche ausliefern
export const DEMO = false;
