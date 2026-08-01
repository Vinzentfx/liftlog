// Rest timer. Driven off wall-clock timestamps rather than tick accumulation,
// so it stays correct when iOS throttles timers or the screen sleeps.

import { $, fmtClock, haptic } from './ui.js';
import { t } from './i18n.js';

let endsAt = 0;
let total = 0;
let raf = null;
let onDone = null;
let chimed = false;
let audio = null;

const bar = () => $('#rest-bar');

export function isRunning() { return endsAt > Date.now(); }

let sound = true;

export function start(seconds, { onComplete, sound: withSound = true } = {}) {
  total = Math.max(1, seconds);
  endsAt = Date.now() + total * 1000;
  onDone = onComplete || null;
  sound = withSound;
  chimed = false;
  bar().hidden = false;
  tick();
}

export function stop() {
  endsAt = 0;
  cancelAnimationFrame(raf);
  raf = null;
  bar().hidden = true;
}

export function extend(seconds) {
  if (!endsAt) return;
  endsAt += seconds * 1000;
  total += seconds;
  chimed = false;
  tick();
}

function tick() {
  cancelAnimationFrame(raf);
  const remainingMs = endsAt - Date.now();
  const remaining = remainingMs / 1000;

  $('#rest-remaining').textContent = fmtClock(Math.max(0, remaining));
  const frac = Math.max(0, Math.min(1, remaining / total));
  $('#rest-progress').firstElementChild.style.transform = `scaleX(${frac})`;

  if (remainingMs <= 0) {
    if (!chimed) {
      chimed = true;
      $('#rest-label').textContent = t('rest.done');
      haptic([90, 60, 90]);
      if (sound) chime();
      if (onDone) onDone();
      setTimeout(() => { if (!isRunning()) stop(); }, 4000);
    }
    return;
  }

  $('#rest-label').textContent = t('rest.label');
  raf = requestAnimationFrame(() => setTimeout(tick, 200));
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
}
