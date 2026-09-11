# LiftLog

Ein Trainingstagebuch fürs Fitnessstudio, das man auf dem iPhone wie eine App
auf den Homescreen legt. Kein Abo, keine Werbung, und die Daten bleiben auf
dem Handy.

**Ausprobieren:** <https://vinzentfx.github.io/liftlog/> (eine Vorschau mit
einem halben Jahr Beispieldaten, ohne Anmeldung. Am besten auf dem Handy
öffnen.)

## Warum

Ich wollte eine Trainings-App, die ohne Konto und Abo auskommt und auch im
Studio ohne Empfang funktioniert. Ende Juli 2026 habe ich angefangen, sie
selbst zu bauen. Mich hat dabei auch interessiert, was an den üblichen Zahlen
wie "geschätztes Maximalgewicht" oder "Stärkestufe" eigentlich dran ist.
Inzwischen benutzen sie ein paar Freunde mit Einladungscode.

## Was drin ist

- Training eintragen, Satz für Satz, mit den Zahlen vom letzten Mal schon
  vorausgefüllt, Pausentimer und Scheibenrechner für die Langhantel
- Trainingspläne (Push/Pull/Legs, Ganzkörper und andere) mit Wochentagen
- eine Muskelkarte von vorne und hinten, jede Region nach Stärke eingefärbt,
  dazu Ränge von Bronze bis Radiant
- über 700 Übungen mit Anleitung und den Muskeln, die sie treffen
- ein Ernährungsteil mit über 700 mitgelieferten Lebensmitteln und Barcode-Scan
- Kalender, Verlauf, Körpergewicht und eine Wochenkarte als Bild zum Teilen
- auf Deutsch und Englisch

## Wie es funktioniert

Die App ist reines JavaScript ohne Framework, ohne Build-Schritt und ohne
fremde Bibliotheken im Browser. Gespeichert wird in IndexedDB direkt im
Browser, ein Service Worker hält alles offline verfügbar, und die Diagramme
sind selbst gezeichnetes SVG. Im Studio geht also alles auch im Flugmodus.

Die Stärkeränge rechnen das Maximalgewicht aus den eingetragenen Sätzen hoch
und vergleichen es mit veröffentlichten Kraftstandards, bezogen aufs
Körpergewicht. Welche Studien hinter den Bewertungen stehen, steht in der App
selbst. Eine Regel war mir dabei wichtig: die App beschreibt, was passiert
ist, sagt aber nie "du solltest". Ein Test prüft das in beiden Sprachen.

Wer will, kann eine Cloud-Sicherung über Supabase einschalten. Die Daten
werden vorher auf dem Handy verschlüsselt, der Server sieht nur Chiffretext
und hat keinen Schlüssel. Käme die Datenbank weg, wären nur E-Mail-Adressen
zu sehen.

Getestet wird mit dem eingebauten Testrunner von Node (266 Tests) und mit
Playwright im Browser, beides läuft bei jedem Push über GitHub Actions.

```bash
npm install
npm test
python3 tools/devserver.py   # dann http://localhost:5173
```

## Ehrlich gesagt

Nicht jede Zeile Code habe ich selbst geschrieben, ein großer Teil ist mit
einem KI-Assistenten entstanden. Was die App können soll, wie sie sich beim
Training anfühlt und welche Zahl stimmt und welche nicht, musste ich trotzdem
selbst herausfinden und immer wieder im echten Training ausprobieren.

## Quellen

Muskelkarte aus [body-muscles](https://github.com/vulovix/body-muscles)
(Apache-2.0), Übungsbilder von [everkinetic](https://github.com/everkinetic/data)
(CC BY-SA 4.0), Übungsdaten aus
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) (gemeinfrei),
Lebensmittel aus USDA FoodData Central (gemeinfrei) und
[Open Food Facts](https://openfoodfacts.org) (ODbL). Details in [NOTICE](NOTICE).
