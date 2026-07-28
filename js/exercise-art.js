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
