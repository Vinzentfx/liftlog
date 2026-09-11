// Bilder zu den Übungen: zwei Phasen (Start und Ende), wo everkinetic Zeichnungen
// für die Bewegung hat, sonst die Muskelkarte.
//
// Die Vorlagen sind schwarze Linien auf transparentem Grund. Sie werden per CSS
// auf Weiß invertiert statt neu gerendert, siehe .exercise-art img in styles.css.

import { el } from './ui.js';
import { EXERCISE_IMAGES } from './exercise-images.js';
import { normName } from './models.js';
import { muscleHighlight } from './bodymap.js';

const BASE = 'assets/exercises/';

export function hasArt(exercise) {
  return !!(exercise && EXERCISE_IMAGES[normName(exercise.name)]);
}

/**
 * Startbild in 44 px für eine Listenzeile.
 *
 * Jede Zeile bekommt einen Platz, egal ob es ein Bild gibt. Eine Liste, in der
 * die Hälfte Vorschaubilder hat und die andere nicht, liest sich schlechter als
 * beides. Ohne Zeichnung steht dort der Anfangsbuchstabe, dann hat das Auge
 * trotzdem etwas Festes, an dem es entlanglaufen kann.
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
  // Die Bilder werden erst beim Ansehen gecacht, nicht vorab. Wer offline zum
  // ersten Mal draufschaut, bekommt deshalb den Buchstaben statt eines kaputten Rahmens.
  img.addEventListener('error', () => {
    wrap.classList.add('is-letter');
    wrap.replaceChildren(String(exercise?.name || '?').trim().charAt(0).toUpperCase());
  });
  return wrap;
}

/**
 * @param {object} exercise  Zeile aus der Bibliothek
 * @param {object} opts      { eager }, eager nur für die eine, die gerade zu sehen ist
 */
export function exerciseArt(exercise, opts = {}) {
  const slug = exercise && EXERCISE_IMAGES[normName(exercise.name)];

  if (!slug) {
    return muscleHighlight(exercise.primary || [], exercise.secondary || []);
  }

  const frame = (n, label) => {
    const img = el('img', {
      src: `${BASE}${slug}_${n}.webp`,
      alt: `${exercise.name}, ${label} position`,
      // Die Bilder liegen außerhalb des Vorab-Caches und kommen beim ersten Ansehen
      // dazu. Fehlt eins, darf kein kaputter Kasten stehen bleiben.
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
