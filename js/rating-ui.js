// Gemeinsame Darstellung der beiden Sternebewertungen, damit Bibliothek und Pläne
// eine Wertung gleich erklären und jede Bewertung in der App einen Tipp von den
// Studien entfernt ist, aus denen sie kommt.

import { el, openSheet, closeSheet, toast, starString, starBadge } from './ui.js';
import * as store from './store.js';
import { rateExercise } from './exercise-rating.js';
import { LENGTH_LABEL } from './exercise-science.js';
import { RATING_DISCLAIMER, SOURCE_LIST } from './evidence.js';
import { suggestSwaps, targetLabel } from './swaps.js';
import { t, tn } from './i18n.js';

/** Farbiger Chip dafür, wo eine Übung den Muskel belastet. */
export function lengthChip(length) {
  const tone = { long: 'var(--good)', mixed: 'var(--text-dim)', short: 'var(--warn)' }[length.bias];
  return el('span.pill', {
    style: { color: tone, borderColor: `color-mix(in srgb, ${tone} 40%, transparent)` },
    text: t(length.classified ? LENGTH_LABEL[length.bias] : 'rating.notClassified'),
  });
}

/** Der Bewertungsblock auf der Detailseite einer Übung. */
export function exerciseRatingCard(ex) {
  const r = rateExercise(ex);
  if (!r) return null;

  const card = el('div.card.glow', {}, [
    el('div.row.between', { style: { gap: '12px' } }, [
      el('div.grow', {}, [
        starBadge(r.stars, { size: '22px' }),
        el('div.small.faint', { style: { marginTop: '2px' }, text: t('rating.forGrowth') }),
      ]),
      el('button.btn.sm.ghost', { onclick: () => exerciseRatingSheet(ex) }, [t('rating.why')]),
    ]),
    el('div', { style: { marginTop: '10px' } }, [lengthChip(r.length)]),
  ]);

  for (const line of r.reasons.slice(0, 2)) {
    card.append(el('div.small', { style: { marginTop: '8px', color: 'var(--good)' }, text: `✓  ${line}` }));
  }
  for (const line of r.caveats.slice(0, 2)) {
    card.append(el('div.small', { style: { marginTop: '8px', color: 'var(--warn)' }, text: `!  ${line}` }));
  }

  const swaps = suggestSwaps(ex, store.state.exercises);
  if (swaps.length) {
    card.append(el('button.btn.ghost.full.sm', {
      style: { marginTop: '12px' },
      onclick: () => swapSheet(ex, swaps),
    }, [t('rating.betterOptions', { options: tn(swaps.length, 'unit.option') })]));
  }
  return card;
}

/* eigene Bewertung */

/**
 * Die eigene 1 bis 5, bewusst getrennt von der Wertung aus den Studien.
 *
 * Die beiden beantworten verschiedene Fragen, "ist die Übung gut" gegen "ist sie
 * gut für mich". Zu Letzterem gehören die Schulter, die sich meldet, die Maschine,
 * die das eigene Studio nicht hat, und die Übung, die man nie an der richtigen
 * Stelle spürt. Zu einer Zahl gemittelt würden sie sich nur gegenseitig aufheben,
 * deshalb zeigt die App zwei.
 */
export function myRatingRow(ex, { onChange } = {}) {
  const row = el('div.myrating');
  const label = el('div.small.faint', { style: { marginBottom: '4px' }, text: t('rating.myRating') });

  const stars = el('div.row', { style: { gap: '2px' } });
  const paint = () => {
    stars.replaceChildren(...[1, 2, 3, 4, 5].map((n) =>
      el('button.mystar' + (ex.myRating >= n ? '.on' : ''), {
        'aria-label': t('rating.rateN', { n }),
        'aria-pressed': String(ex.myRating >= n),
        onclick: async () => {
          // Wer auf den Stern tippt, bei dem er schon steht, löscht die Bewertung.
          // Sonst gäbe es nach dem ersten Tipp keinen Weg zurück zu "keine Meinung".
          const next = ex.myRating === n ? 0 : n;
          await store.setMyRating(ex.id, next);
          paint();
          toast(next ? t('rating.rated', { n: next }) : t('rating.cleared'));
          if (onChange) onChange();
        },
      }, [ex.myRating >= n ? '★' : '☆'])
    ));
    if (ex.myRating) {
      stars.append(el('span.small.faint', { style: { marginLeft: '8px', alignSelf: 'center' },
        text: t('rating.steersGenerator') }));
    }
  };
  paint();

  row.append(label, stars);
  return row;
}

/* Alternativen */

export function swapSheet(ex, swaps = suggestSwaps(ex, store.state.exercises), onPick = null) {
  const body = el('div', {}, [
    el('div.small.muted', {
      text: t('rating.swapIntro', { muscle: targetLabel(ex) || t('rating.sameMuscle') }),
    }),
    ...swaps.map((s) => el('button.list-item', {
      style: { marginTop: '10px' },
      'aria-label': t('rating.swapTo', { name: s.ex.name }),
      onclick: () => {
        if (onPick) { onPick(s.ex); closeSheet(); }
        else { closeSheet(); location.hash = `#/library/${s.ex.id}`; }
      },
    }, [
      el('div.grow', {}, [
        el('div.li-title', { text: s.ex.name }),
        el('div.li-sub', { text: s.reason }),
      ]),
      starBadge(s.stars),
      el('span.chev', { text: onPick ? '⇄' : '›', 'aria-hidden': 'true' }),
    ])),
    el('div.small.faint', { style: { marginTop: '14px' }, text: t('rating.swapCaveat') }),
  ]);
  openSheet(t('rating.insteadOf', { name: ex.name }), body);
}

/** Die ganze Aufschlüsselung: jedes Kriterium, seine Punkte und die Quelle dahinter. */
export function exerciseRatingSheet(ex) {
  const r = rateExercise(ex);
  if (!r) return;

  const rows = r.criteria.map((c) => el('div', { style: { marginBottom: '12px' } }, [
    el('div.row.between', { style: { alignItems: 'baseline' } }, [
      el('span', { style: { fontWeight: '620', fontSize: '14px' }, text: t(c.label) }),
      el('span.small', {
        style: { fontWeight: '680', color: c.points >= c.max * 0.75 ? 'var(--good)' : c.points <= c.max * 0.25 ? 'var(--warn)' : 'var(--text-dim)' },
        text: `${trim(c.points)} / ${trim(c.max)}`,
      }),
    ]),
    el('div.track-thin', {}, [
      el('i', { style: { width: `${Math.round((c.points / c.max) * 100)}%` } }),
    ]),
    el('div.small.faint', { style: { marginTop: '4px' }, text: t(c.detail, c.detailParams) }),
    c.source
      ? el('a.small', {
          href: c.source.url, target: '_blank', rel: 'noopener',
          style: { color: 'var(--accent-hi)', fontSize: '12px' },
          text: `${t('common.source', { source: t(c.source.short) })} ↗`,
        })
      : el('div.small.faint', { style: { fontSize: '12px' }, text: t('rating.practiceNotStudy') }),
  ]));

  openSheet(t('plans.ratingTitle', { name: ex.name }), el('div', {}, [
    el('div', { style: { textAlign: 'center', fontSize: '28px', letterSpacing: '.06em', color: 'var(--t4)' },
      text: starString(r.stars) }),
    el('div.small.faint', { style: { textAlign: 'center', marginBottom: '4px' },
      text: t('rating.pointsBand', {
        score: trim(r.score), low: trim(r.band[0]), high: trim(r.band[1]), max: trim(r.max),
      }) }),
    el('div.small.muted', { style: { textAlign: 'center', marginBottom: '16px' }, text: t(RATING_DISCLAIMER) }),

    el('div.section-head', {}, [el('h2', { text: t('rating.howItScored') })]),
    ...rows,

    r.caveats.length ? el('div.section-head', {}, [el('h2', { text: t('rating.worthKnowing') })]) : null,
    ...r.caveats.map((line) => el('div.small', { style: { marginBottom: '7px', color: 'var(--warn)' }, text: `!  ${line}` })),

    el('div.section-head', {}, [el('h2', { text: t('rating.whatThisIsNot') })]),
    el('div.small.muted', { text: t('rating.whatThisIsNotBody') }),

    evidenceList(),
  ]));
}

/** Die vollständige Quellenliste, für die Bewertungs-Sheets und die Einstellungen. */
export function evidenceList(title = null) {
  return el('div', {}, [
    el('div.section-head', {}, [el('h2', { text: title || t('rating.evidence') })]),
    ...SOURCE_LIST.map((s) => el('div', { style: { marginBottom: '14px' } }, [
      el('a', {
        href: s.url, target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)', fontWeight: '620', fontSize: '14px' },
        text: `${t(s.short)} ↗`,
      }),
      el('div.small.faint', { style: { marginTop: '2px' }, text: t(s.note) }),
      el('div.small.muted', { style: { marginTop: '4px' }, text: t(s.says) }),
    ])),
    el('div.small.faint', { style: { marginTop: '4px' }, text: t('rating.lastReviewed') }),
  ]);
}

const trim = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
