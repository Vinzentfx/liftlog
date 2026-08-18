// Exercise illustration: two frames (start / end) where everkinetic has art for
// the movement, falling back to the muscle map otherwise.
//
// The source art is black line work on transparency, so it is inverted to white
// in CSS rather than being re-rendered — see .exercise-art img in styles.css.

import { el } from './ui.js';
import { EXERCISE_IMAGES } from './exercise-images.js';
import { normName } from './models.js';
import { muscleHighlight } from './bodymap.js';

const BASE = 'assets/exercises/';

export function hasArt(exercise) {
  return !!(exercise && EXERCISE_IMAGES[normName(exercise.name)]);
}

/**
 * A 44px start-frame for a list row.
 *
 * Every row gets a slot whether or not there is art, because half a list with
 * thumbnails and half without is worse to scan than either. Where the movement
 * has no illustration the slot carries its initial, which still gives the eye
 * something fixed to run down.
 */
export function exerciseThumb(exercise) {
  const slug = exercise && EXERCISE_IMAGES[normName(exercise.name)];
  if (!slug) {
    return el('span.ex-thumb.is-letter', { 'aria-hidden': 'true' },
      [String(exercise?.name || '?').trim().charAt(0).toUpperCase()]);
  }
  const img = el('img', {
    src: `${BASE}${slug}_1.webp`,
    alt: '',
    loading: 'lazy',
    decoding: 'async',
    width: 40, height: 40,
  });
  const wrap = el('span.ex-thumb', { 'aria-hidden': 'true' }, [img]);
  // The images are runtime-cached rather than precached, so a first view while
  // offline has to degrade to the letter instead of a broken frame.
  img.addEventListener('error', () => {
    wrap.classList.add('is-letter');
    wrap.replaceChildren(String(exercise?.name || '?').trim().charAt(0).toUpperCase());
  });
  return wrap;
}

/**
 * @param {object} exercise  library row
 * @param {object} opts      { eager } — eager only for the one on screen
 */
export function exerciseArt(exercise, opts = {}) {
  const slug = exercise && EXERCISE_IMAGES[normName(exercise.name)];

  if (!slug) {
    return muscleHighlight(exercise.primary || [], exercise.secondary || []);
  }

  const frame = (n, label) => {
    const img = el('img', {
      src: `${BASE}${slug}_${n}.webp`,
      alt: `${exercise.name} — ${label} position`,
      // Images live outside the precache; the runtime cache picks them up on
      // first view, so a missed one must not leave a broken box behind.
      loading: opts.eager ? 'eager' : 'lazy',
      decoding: 'async',
      width: 320,
    });
    img.addEventListener('error', () => {
      wrap.replaceWith(muscleHighlight(exercise.primary || [], exercise.secondary || []));
    });
    return el('figure', {}, [img, el('figcaption', { text: label })]);
  };

  const wrap = el('div.exercise-art', {}, [frame(1, 'Start'), frame(2, 'End')]);
  return wrap;
}
