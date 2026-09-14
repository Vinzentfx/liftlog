# LiftLog

Ein Trainingstagebuch fürs Fitnessstudio, das man auf dem iPhone wie eine App
auf den Homescreen legt. Kein Abo, keine Werbung, und die Daten bleiben auf
dem Handy.

**Ausprobieren:** <https://vinzentfx.github.io/liftlog/> (eine Vorschau mit
einem halben Jahr Beispieldaten, ohne Anmeldung. Am besten auf dem Handy
öffnen.)

## Warum

Ich gehe schon länger trainieren, hatte meine Gewichte und Wiederholungen aber
nur in der Notizen App auf dem Handy aufgeschrieben. Also wollte ich mir eine
richtige App herunterladen, aber alle, die ich gefunden habe, kosteten Geld.
Deshalb wollte ich einfach selbst etwas bauen, für mich und für Freunde, zum
Vergleichen und aus Spaß. Angefangen habe ich Ende Juli 2026, und inzwischen
benutzen es ein paar Freunde mit Einladungscode.

## Was drin ist

* Training eintragen, Satz für Satz, mit den Zahlen vom letzten Mal schon
  vorausgefüllt, dazu Pausentimer und Scheibenrechner für die Langhantel
* Trainingspläne (Push/Pull/Legs, Ganzkörper und andere) mit Wochentagen
* eine Muskelkarte von vorne und hinten, jede Region nach Stärke eingefärbt,
  dazu Ränge von Bronze bis Radiant
* über 700 Übungen mit Anleitung und den Muskeln, die sie treffen
* ein Ernährungsteil mit über 700 mitgelieferten Lebensmitteln und
  Barcodescanner
* Kalender, Verlauf, Körpergewicht und eine Wochenkarte als Bild zum Teilen
* auf Deutsch und Englisch

## Wie es funktioniert

Die App ist reines JavaScript ohne Framework und ohne fremde Bibliotheken, der
Code läuft so, wie er im Repo liegt, direkt im Browser. Gespeichert wird in
IndexedDB auf dem Gerät, ein Service Worker hält alles offline verfügbar, und
die Diagramme sind selbst gezeichnetes SVG. Im Studio geht also alles auch im
Flugmodus.

Die Stärkeränge rechnen das Maximalgewicht aus den eingetragenen Sätzen hoch
und vergleichen es mit veröffentlichten Kraftstandards, bezogen aufs
Körpergewicht. Welche Studien hinter den Bewertungen stehen, zeigt die App
selbst an. Eine Regel war mir dabei wichtig: die App beschreibt, was passiert
ist, sagt aber nie "du solltest". Ein Test prüft das in beiden Sprachen.

Wer will, kann eine Sicherung in der Cloud über Supabase einschalten. Die
Daten werden vorher auf dem Handy verschlüsselt, der Server sieht nur
verschlüsselten Text und hat keinen Schlüssel dafür. Käme die Datenbank weg,
wären nur Mailadressen zu sehen.

Getestet wird mit dem eingebauten Testrunner von Node (266 Tests) und mit
Playwright im Browser, beides läuft bei jedem Push über GitHub Actions.

```bash
npm install
npm test
python3 tools/devserver.py   # dann http://localhost:5173
```

## Sonstiges

Nicht jede Zeile Code habe ich selbst geschrieben. 
Was die App können soll, wie Sachen umgesetzt werden, wie sie sich beim Training
anfühlt und welche Zahl stimmt und welche nicht, musste ich trotzdem selbst
herausfinden und immer wieder im echten Training ausprobieren.

## Quellen

Die Muskelkarte stammt aus [diesem Projekt](https://github.com/vulovix/body-muscles)
(Apache License 2.0), die Übungsbilder von [everkinetic](https://github.com/everkinetic/data)
(Creative Commons Namensnennung, Weitergabe unter gleichen Bedingungen 4.0), die
Übungsdaten aus [dieser Sammlung](https://github.com/yuhonas/free-exercise-db)
(gemeinfrei) und die Lebensmittel aus USDA FoodData Central (gemeinfrei) und
[Open Food Facts](https://openfoodfacts.org) (ODbL). Genaueres steht in [NOTICE](NOTICE).
