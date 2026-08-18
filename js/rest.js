// Rest timer. Driven off wall-clock timestamps rather than tick accumulation,
// so it stays correct when iOS throttles timers or the screen sleeps.
//
// The deadline also survives the page going away entirely, which on a phone is
// the normal case rather than the exception: iOS discards a backgrounded PWA
// whenever it wants the memory, and a service-worker update reloads it outright.
// Both used to lose the timer, in the middle of the one minute it exists for.
// Only the deadline is kept, in localStorage, because that is all it takes to
// rebuild the bar from a wall clock.

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
 * How late the chime may be and still be worth making.
 *
 * A page that was hidden or discarded runs no timers at all, so `tick` can
 * arrive minutes after the deadline. Announcing a rest that ended four minutes
 * ago is noise about something the screen is already saying, and it is the same
 * judgement `restore()` makes about a reload.
 */
const ANNOUNCE_GRACE_MS = 30 * 1000;

const bar = () => $('#rest-bar');

/**
 * Show or hide the bar, and tell the layout it is there.
 *
 * The bar floats over the bottom of the screen, so without the class the last
 * control on any screen sits underneath it: on the workout screen that is
 * "end workout", which was unreachable for the whole of every rest.
 */
function showBar(visible) {
  bar().hidden = !visible;
  document.body.classList.toggle('resting', visible);
}

export function isRunning() { return endsAt > Date.now(); }

/**
 * Keep the deadline where a fresh page can find it.
 *
 * Not IndexedDB: this has to be readable synchronously during `init()`, before
 * the first frame, or the bar flashes in a moment after the screen has drawn.
 * It is also not app data, so it has no business in a backup.
 */
function persist() {
  try {
    if (endsAt > Date.now()) {
      localStorage.setItem(STATE_KEY, JSON.stringify({ endsAt, total, sound }));
    } else {
      localStorage.removeItem(STATE_KEY);
    }
  } catch { /* private mode: the timer still works for as long as the page lives */ }
}

/**
 * Pick a running timer back up after a reload.
 *
 * A timer that ran out while the app was away is dropped rather than completed.
 * Chiming for a rest that ended twenty minutes ago is noise, and the set it
 * belonged to is long over.
 */
function restore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch { saved = null; }
  const deadline = Number(saved?.endsAt) || 0;
  if (deadline <= Date.now()) {
    try { localStorage.removeItem(STATE_KEY); } catch { /* nothing to clear */ }
    return;
  }
  endsAt = deadline;
  // Guard the divisor in `tick`: a damaged or truncated record must not turn
  // the progress bar into a NaN transform.
  total = Math.max(1, Number(saved.total) || Math.ceil((deadline - Date.now()) / 1000));
  sound = saved.sound !== false;
  // Deliberately not resumed. Playback can only begin inside a user gesture and
  // a page that has just loaded itself has none, so this rest finishes without
  // the keep-alive and the next one gets it back. Claiming otherwise here would
  // only mean a keeper that never actually plays.
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
  // Holding an audio session open buys exactly one thing: a sound from a
  // backgrounded app. With the chime switched off there is nothing to buy, so
  // the battery is not spent.
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
      // The deadline has passed, so a reload from here on should not bring the
      // bar back. `stop()` four seconds later would do it too, but only if this
      // page survives that long.
      persist();
      $('#rest-label').textContent = t('rest.done');
      // Only announce a deadline that has just passed. See ANNOUNCE_GRACE_MS.
      if (remainingMs > -ANNOUNCE_GRACE_MS) {
        haptic([90, 60, 90]);
        // The keeper first: if it is running we may be in the background,
        // where the AudioContext is suspended and `chime()` is silence.
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
  // setTimeout, not requestAnimationFrame: rAF does not run at all while the
  // page is hidden, so the countdown froze wherever it happened to be and never
  // reached its own deadline. It finished when you next looked at the screen,
  // which is the one moment you did not need telling. A timer is not an
  // animation and has no business waiting for a frame.
  timer = setTimeout(tick, 200);
}

/* ===================== keeping the page alive on iOS ===================== */

// iOS suspends a backgrounded web view: no timers, no audio, nothing. A page
// that is *playing media*, however, keeps running, because that is how a web
// radio works. So while a rest is counting down, a silent loop plays, and the
// page stays alive long enough to reach its own deadline and say so.
//
// The price, stated here because it is real and the setting exists for it:
// it holds an audio session open, which costs battery, and it takes over the
// phone's media controls for the duration. It is also a side effect rather
// than a feature Apple offers, so an iOS release could end it without warning.
// The rest of the timer does not depend on any of it.
//
// It only runs while a rest is actually running, never for the whole session,
// which keeps the cost to the ninety seconds it is buying.

let keeper = null;
let keepAlive = false;
let silence = null;
let chimeTrack = null;

/**
 * Build a WAV as a data URI, so there is still no audio asset to cache.
 *
 * `sample(i, rate)` returns -1..1 per frame.
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
 * Not digital silence: a 40 Hz tone at roughly -80 dBFS.
 *
 * A phone speaker cannot reproduce 40 Hz at any volume, let alone this quiet,
 * so it is inaudible. It is a tone rather than zeroes because a track of pure
 * zeroes is the thing a platform is most likely to decide is not playback.
 * And the quiet lives in the samples rather than in `.volume`, because iOS
 * ignores volume on a media element and a muted one does not hold the session.
 */
const silentTrack = () => (silence ||= wav(2, (i, rate) => Math.sin(2 * Math.PI * 40 * i / rate) * 0.0001));

/** The same two notes `chime()` synthesises, as a file the media element can play. */
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
 * Must be called from inside a user gesture, which `start()` is: the tap that
 * ticked off the set. iOS will not begin playback anywhere else, and an element
 * that never played during a gesture cannot be played later either.
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
  try { keeper.pause(); keeper.removeAttribute('src'); keeper.load(); } catch { /* already gone */ }
  keeper = null;
}

/**
 * Chime through the element that is already playing.
 *
 * In the background the AudioContext is suspended and `chime()` produces
 * nothing, but this element holds a live media session, so swapping its source
 * is a sound that actually comes out. Returns whether it took the job.
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

/** Synthesised so there's no audio file to cache. */
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
  } catch { /* audio unavailable — the haptic already fired */ }
}

// iOS and other mobile browsers only allow audio after a user gesture. Creating
// and resuming the context when the user first touches the app keeps it usable
// minutes later when the timer itself finishes without a gesture.
function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio ||= new Ctx();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch { /* sound remains optional */ }
}

export function init() {
  document.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  $('#rest-dismiss').addEventListener('click', stop);
  $('#rest-add').addEventListener('click', () => extend(30));
  // Recompute immediately on wake — a throttled tick may be seconds stale.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && endsAt) tick();
  });
  restore();
}
