// Pausentimer. Läuft über Uhrzeit-Zeitstempel statt über aufaddierte Ticks, damit er
// auch stimmt, wenn iOS Timer drosselt oder der Bildschirm schläft.
//
// Das Ende übersteht sogar, dass die Seite ganz weg ist, und auf dem Handy ist das der
// Normalfall: iOS wirft eine PWA im Hintergrund weg, wann immer es Speicher braucht,
// und ein Update des Service Workers lädt sie einfach neu. Beides hat den Timer
// früher verloren, mitten in der einen Minute, für die es ihn gibt. Gespeichert wird
// nur das Ende, im localStorage, mehr braucht es nicht, um die Leiste aus der Uhrzeit
// wieder aufzubauen.

import { $, fmtClock, haptic } from './ui.js';
import { t } from './i18n.js';

let endsAt = 0;
let total = 0;
let timer = null;
let onDone = null;
let chimed = false;
let audio = null;
let sound = true;

const STATE_KEY = 'liftlog.rest';

/**
 * Wie spät der Ton noch kommen darf, damit er sich lohnt.
 *
 * Eine versteckte oder weggeworfene Seite hat keine laufenden Timer, `tick` kann also
 * Minuten nach dem Ende kommen. Eine Pause anzusagen, die vor vier Minuten vorbei war,
 * ist Lärm über etwas, das der Bildschirm schon sagt, und dieselbe Abwägung trifft
 * `restore()` beim Neuladen.
 */
const ANNOUNCE_GRACE_MS = 30 * 1000;

const bar = () => $('#rest-bar');

/**
 * Die Leiste zeigen oder verstecken und dem Layout sagen, dass sie da ist.
 *
 * Die Leiste schwebt über dem unteren Rand. Ohne die Klasse liegt der letzte Knopf
 * jedes Screens darunter. Beim Training ist das "Training beenden", und der war
 * während jeder Pause nicht zu erreichen.
 */
function showBar(visible) {
  bar().hidden = !visible;
  document.body.classList.toggle('resting', visible);
}

export function isRunning() { return endsAt > Date.now(); }

/**
 * Das Ende dort ablegen, wo eine frische Seite es findet.
 *
 * Nicht IndexedDB: das muss in `init()` synchron lesbar sein, vor dem ersten Bild,
 * sonst blitzt die Leiste erst einen Moment nach dem Screen auf. Es sind auch keine
 * App-Daten und gehören nicht in eine Sicherung.
 */
function persist() {
  try {
    if (endsAt > Date.now()) {
      localStorage.setItem(STATE_KEY, JSON.stringify({ endsAt, total, sound }));
    } else {
      localStorage.removeItem(STATE_KEY);
    }
  } catch { /* privater Modus: der Timer geht trotzdem, solange die Seite lebt */ }
}

/**
 * Einen laufenden Timer nach dem Neuladen wieder aufnehmen.
 *
 * Ein Timer, der abgelaufen ist, während die App weg war, wird verworfen statt
 * abgeschlossen. Für eine Pause zu klingeln, die vor zwanzig Minuten zu Ende war,
 * ist Lärm, und der Satz dazu ist längst vorbei.
 */
function restore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch { saved = null; }
  const deadline = Number(saved?.endsAt) || 0;
  if (deadline <= Date.now()) {
    try { localStorage.removeItem(STATE_KEY); } catch { /* nichts zu löschen */ }
    return;
  }
  endsAt = deadline;
  // Den Teiler in `tick` absichern: ein beschädigter oder abgeschnittener Eintrag darf
  // aus dem Fortschrittsbalken keine NaN-Transformation machen.
  total = Math.max(1, Number(saved.total) || Math.ceil((deadline - Date.now()) / 1000));
  sound = saved.sound !== false;
  // Absichtlich nicht fortgesetzt. Abspielen darf nur innerhalb einer Nutzeraktion
  // beginnen, und eine Seite, die sich gerade selbst geladen hat, hat keine. Diese Pause
  // läuft also ohne das Wachhalten zu Ende, und die nächste bekommt es wieder. Hier
  // etwas anderes zu behaupten hieße nur, einen Wachhalter zu haben, der nie spielt.
  keepAlive = false;
  chimed = false;
  onDone = null;
  showBar(true);
  tick();
}

export function start(seconds, { onComplete, sound: withSound = true, background = false } = {}) {
  total = Math.max(1, seconds);
  endsAt = Date.now() + total * 1000;
  onDone = onComplete || null;
  sound = withSound;
  // Eine offene Audio-Sitzung bringt genau eine Sache: einen Ton aus einer App im
  // Hintergrund. Ist der Ton ausgeschaltet, bringt sie nichts, also wird auch kein Akku
  // dafür verbraucht.
  keepAlive = background && withSound;
  chimed = false;
  showBar(true);
  persist();
  startKeeper();
  tick();
}

export function stop() {
  endsAt = 0;
  clearTimeout(timer);
  timer = null;
  showBar(false);
  stopKeeper();
  persist();
}

export function extend(seconds) {
  if (!endsAt) return;
  endsAt += seconds * 1000;
  total += seconds;
  chimed = false;
  persist();
  tick();
}

function tick() {
  clearTimeout(timer);
  const remainingMs = endsAt - Date.now();
  const remaining = remainingMs / 1000;

  $('#rest-remaining').textContent = fmtClock(Math.max(0, remaining));
  const frac = Math.max(0, Math.min(1, remaining / total));
  $('#rest-progress').firstElementChild.style.transform = `scaleX(${frac})`;

  if (remainingMs <= 0) {
    if (!chimed) {
      chimed = true;
      // Das Ende ist vorbei, ein Neuladen ab hier soll die Leiste nicht zurückbringen.
      // `stop()` vier Sekunden später würde das auch erledigen, aber nur, wenn die Seite
      // so lange überlebt.
      persist();
      $('#rest-label').textContent = t('rest.done');
      // Nur ein Ende ansagen, das gerade erst vorbei ist. Siehe ANNOUNCE_GRACE_MS.
      if (remainingMs > -ANNOUNCE_GRACE_MS) {
        haptic([90, 60, 90]);
        // Zuerst der Wachhalter: läuft er, sind wir vielleicht im Hintergrund, dort ist
        // der AudioContext angehalten und `chime()` bleibt stumm.
        if (sound && !keeperChime()) chime();
      } else {
        stopKeeper();
      }
      if (onDone) onDone();
      setTimeout(() => { if (!isRunning()) stop(); }, 4000);
    }
    return;
  }

  $('#rest-label').textContent = t('rest.label');
  // setTimeout, nicht requestAnimationFrame: rAF läuft bei einer versteckten Seite gar
  // nicht, der Countdown blieb also stehen, wo er gerade war, und erreichte sein Ende
  // nie. Fertig wurde er, wenn man das nächste Mal auf den Bildschirm geschaut hat, also
  // genau in dem Moment, in dem man es nicht mehr gesagt bekommen musste. Ein Timer ist
  // keine Animation und hat nichts damit zu tun, auf ein Bild zu warten.
  timer = setTimeout(tick, 200);
}

/* die Seite unter iOS wachhalten */

// iOS hält eine Web-Ansicht im Hintergrund an: keine Timer, kein Ton, nichts. Eine
// Seite, die Medien abspielt, läuft aber weiter, so funktioniert Webradio. Während eine
// Pause läuft, spielt deshalb eine stille Schleife, und die Seite bleibt lange genug
// wach, um ihr eigenes Ende zu erreichen und es zu sagen.
//
// Der Preis, hier genannt, weil er echt ist und es die Einstellung dafür gibt: die
// Audio-Sitzung kostet Akku, und so lange gehören die Mediensteuerungen des Handys
// der App. Außerdem ist das ein Nebeneffekt und keine Funktion, die Apple anbietet,
// ein iOS-Update könnte es ohne Vorwarnung beenden. Der Rest des Timers hängt an
// nichts davon.
//
// Läuft nur, solange wirklich eine Pause läuft, nie das ganze Training. So bleiben die
// Kosten bei den neunzig Sekunden, um die es geht.

let keeper = null;
let keepAlive = false;
let silence = null;
let chimeTrack = null;

/**
 * Ein WAV als Data-URI bauen, dann gibt es weiterhin keine Audiodatei zum Cachen.
 *
 * `sample(i, rate)` liefert -1..1 pro Abtastwert.
 */
function wav(seconds, sample, rate = 8000) {
  const frames = Math.round(rate * seconds);
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const ascii = (at, text) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample(i, rate))) * 32767, true);
  }
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/**
 * Keine digitale Stille, sondern ein 40-Hz-Ton bei etwa -80 dBFS.
 *
 * Ein Handylautsprecher kann 40 Hz bei keiner Lautstärke wiedergeben, schon gar nicht
 * so leise, man hört also nichts. Ein Ton statt Nullen, weil eine Spur aus reinen
 * Nullen genau das ist, was eine Plattform am ehesten nicht als Wiedergabe zählt. Und
 * die Stille steckt in den Werten und nicht in `.volume`, weil iOS die Lautstärke
 * eines Medienelements ignoriert und ein stummgeschaltetes die Sitzung nicht hält.
 */
const silentTrack = () => (silence ||= wav(2, (i, rate) => Math.sin(2 * Math.PI * 40 * i / rate) * 0.0001));

/** Dieselben zwei Töne, die `chime()` erzeugt, als Datei, die das Medienelement abspielen kann. */
const chimeFile = () => (chimeTrack ||= wav(0.42, (i, rate) => {
  const at = i / rate;
  let value = 0;
  for (const [offset, hz] of [[0, 660], [0.18, 880]]) {
    const into = at - offset;
    if (into < 0 || into > 0.2) continue;
    value += Math.sin(2 * Math.PI * hz * into) * 0.5 * Math.exp(-into * 18);
  }
  return value;
}));

/**
 * Muss innerhalb einer Nutzeraktion aufgerufen werden, und `start()` ist eine: der
 * Tipp, der den Satz abhakt. Woanders beginnt iOS keine Wiedergabe, und ein Element,
 * das nie während einer Aktion gespielt hat, lässt sich auch später nicht abspielen.
 */
function startKeeper() {
  if (!keepAlive || keeper) return;
  try {
    keeper = new Audio(silentTrack());
    keeper.loop = true;
    keeper.setAttribute('playsinline', '');
    keeper.play().catch(() => { keeper = null; });
  } catch { keeper = null; }
}

function stopKeeper() {
  if (!keeper) return;
  try { keeper.pause(); keeper.removeAttribute('src'); keeper.load(); } catch { /* schon weg */ }
  keeper = null;
}

/**
 * Über das Element klingeln, das schon spielt.
 *
 * Im Hintergrund ist der AudioContext angehalten und `chime()` erzeugt nichts, dieses
 * Element hält aber eine laufende Mediensitzung. Seine Quelle zu tauschen ist also ein
 * Ton, der wirklich herauskommt. Gibt zurück, ob es die Aufgabe übernommen hat.
 */
function keeperChime() {
  if (!keeper) return false;
  try {
    keeper.loop = false;
    keeper.src = chimeFile();
    keeper.play().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** Synthetisch erzeugt, damit es keine Audiodatei zum Cachen gibt. */
function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = audio || new Ctx();
    audio = ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    [0, 0.18].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 0 ? 660 : 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.2);
    });
  } catch { /* kein Ton möglich, die Vibration kam schon */ }
}

// iOS und andere mobile Browser erlauben Ton erst nach einer Nutzeraktion. Den Context
// beim ersten Berühren der App anzulegen und fortzusetzen hält ihn nutzbar, wenn der
// Timer Minuten später ohne Aktion fertig wird.
function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio ||= new Ctx();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch { /* Ton bleibt freiwillig */ }
}

export function init() {
  document.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  $('#rest-dismiss').addEventListener('click', stop);
  $('#rest-add').addEventListener('click', () => extend(30));
  // Beim Aufwachen sofort neu rechnen, ein gedrosselter Tick kann Sekunden alt sein.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && endsAt) tick();
  });
  restore();
}
