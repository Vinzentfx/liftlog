// Shared rendering for the two star ratings, so the Library and the Plans tab
// explain a score the same way — and so every rating in the app is one tap from
// the papers it came from.

import { el, openSheet, closeSheet, toast, starString, starBadge } from './ui.js';
import * as store from './store.js';
import { rateExercise } from './exercise-rating.js';
import { LENGTH_LABEL } from './exercise-science.js';
import { RATING_DISCLAIMER, SOURCE_LIST } from './evidence.js';
import { suggestSwaps, targetLabel } from './swaps.js';

/** Coloured chip for where an exercise loads the muscle. */
export function lengthChip(length) {
  const tone = { long: 'var(--good)', mixed: 'var(--text-dim)', short: 'var(--warn)' }[length.bias];
  return el('span.pill', {
    style: { color: tone, borderColor: `color-mix(in srgb, ${tone} 40%, transparent)` },
    text: length.classified ? LENGTH_LABEL[length.bias] : 'Length not classified',
  });
}

/** The rating block on an exercise detail page. */
export function exerciseRatingCard(ex) {
  const r = rateExercise(ex);
  if (!r) return null;

  const card = el('div.card.glow', {}, [
    el('div.row.between', { style: { gap: '12px' } }, [
      el('div.grow', {}, [
        starBadge(r.stars, { size: '22px' }),
        el('div.small.faint', { style: { marginTop: '2px' }, text: 'Rated for muscle growth' }),
      ]),
      el('button.btn.sm.ghost', { onclick: () => exerciseRatingSheet(ex) }, ['Why']),
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
    }, [`${swaps.length} better ${swaps.length === 1 ? 'option' : 'options'} for the same muscle`]));
  }
  return card;
}

/* ===================== personal rating ===================== */

/**
 * Your own 1–5, kept deliberately separate from the evidence score.
 *
 * They answer different questions — "is this movement good" versus "is it good
 * *for me*", which covers the shoulder that complains, the machine your gym
 * does not own, and the exercise you can never feel in the right place. Averaged
 * into one number they would just cancel each other out, so the app shows two.
 */
export function myRatingRow(ex, { onChange } = {}) {
  const row = el('div.myrating');
  const label = el('div.small.faint', { style: { marginBottom: '4px' }, text: 'My rating — how well it works for you' });

  const stars = el('div.row', { style: { gap: '2px' } });
  const paint = () => {
    stars.replaceChildren(...[1, 2, 3, 4, 5].map((n) =>
      el('button.mystar' + (ex.myRating >= n ? '.on' : ''), {
        'aria-label': `Rate ${n} out of 5`,
        'aria-pressed': String(ex.myRating >= n),
        onclick: async () => {
          // Tapping the star you already sit on clears it — otherwise there is
          // no way back to "no opinion" once you have tapped once.
          const next = ex.myRating === n ? 0 : n;
          await store.setMyRating(ex.id, next);
          paint();
          toast(next ? `Rated ${next}/5` : 'Rating cleared');
          if (onChange) onChange();
        },
      }, [ex.myRating >= n ? '★' : '☆'])
    ));
    if (ex.myRating) {
      stars.append(el('span.small.faint', { style: { marginLeft: '8px', alignSelf: 'center' },
        text: 'steers the plan generator' }));
    }
  };
  paint();

  row.append(label, stars);
  return row;
}

/* ===================== swaps ===================== */

export function swapSheet(ex, swaps = suggestSwaps(ex, store.state.exercises), onPick = null) {
  const body = el('div', {}, [
    el('div.small.muted', {
      text: `Alternatives that train ${targetLabel(ex) || 'the same muscle'} and score better. Same sets, same time — only the position the load lands in changes.`,
    }),
    ...swaps.map((s) => el('button.list-item', {
      style: { marginTop: '10px' },
      'aria-label': `Swap to ${s.ex.name}`,
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
    el('div.small.faint', { style: { marginTop: '14px' },
      text: 'Nothing here says your current pick is bad. Swapping exercises constantly costs more than it buys — change one thing and give it a few weeks.' }),
  ]);
  openSheet(`Instead of ${ex.name}`, body);
}

/** Full breakdown: every criterion, its points, and the source behind it. */
export function exerciseRatingSheet(ex) {
  const r = rateExercise(ex);
  if (!r) return;

  const rows = r.criteria.map((c) => el('div', { style: { marginBottom: '12px' } }, [
    el('div.row.between', { style: { alignItems: 'baseline' } }, [
      el('span', { style: { fontWeight: '620', fontSize: '14px' }, text: c.label }),
      el('span.small', {
        style: { fontWeight: '680', color: c.points >= c.max * 0.75 ? 'var(--good)' : c.points <= c.max * 0.25 ? 'var(--warn)' : 'var(--text-dim)' },
        text: `${trim(c.points)} / ${trim(c.max)}`,
      }),
    ]),
    el('div.track-thin', {}, [
      el('i', { style: { width: `${Math.round((c.points / c.max) * 100)}%` } }),
    ]),
    el('div.small.faint', { style: { marginTop: '4px' }, text: c.detail }),
    c.source
      ? el('a.small', {
          href: c.source.url, target: '_blank', rel: 'noopener',
          style: { color: 'var(--accent-hi)', fontSize: '12px' },
          text: `Source: ${c.source.short} ↗`,
        })
      : el('div.small.faint', { style: { fontSize: '12px' }, text: 'Training practice, not a study result' }),
  ]));

  openSheet(`${ex.name} — rating`, el('div', {}, [
    el('div', { style: { textAlign: 'center', fontSize: '28px', letterSpacing: '.06em', color: 'var(--t4)' },
      text: starString(r.stars) }),
    el('div.small.faint', { style: { textAlign: 'center', marginBottom: '4px' },
      text: `${trim(r.score)} points — stars are spread across the ${trim(r.band[0])}–${trim(r.band[1])} band real movements land in, not the ${trim(r.max)} available on paper` }),
    el('div.small.muted', { style: { textAlign: 'center', marginBottom: '16px' }, text: RATING_DISCLAIMER }),

    el('div.section-head', {}, [el('h2', { text: 'How it scored' })]),
    ...rows,

    r.caveats.length ? el('div.section-head', {}, [el('h2', { text: 'Worth knowing' })]) : null,
    ...r.caveats.map((t) => el('div.small', { style: { marginBottom: '7px', color: 'var(--warn)' }, text: `!  ${t}` })),

    el('div.section-head', {}, [el('h2', { text: 'What this is not' })]),
    el('div.small.muted', {
      text: 'Not a ranking anyone has measured. No study compares 900 exercises head to head, and the EMG numbers usually quoted for this predict growth badly. Every point above comes from a property of the movement, not from a trial of it. A four-star exercise you enjoy beats a five-star one you skip.',
    }),

    evidenceList(),
  ]));
}

/** The full source list, used by the rating sheets and by Settings. */
export function evidenceList(title = 'Evidence') {
  return el('div', {}, [
    el('div.section-head', {}, [el('h2', { text: title })]),
    ...SOURCE_LIST.map((s) => el('div', { style: { marginBottom: '14px' } }, [
      el('a', {
        href: s.url, target: '_blank', rel: 'noopener',
        style: { color: 'var(--accent-hi)', fontWeight: '620', fontSize: '14px' },
        text: `${s.short} ↗`,
      }),
      el('div.small.faint', { style: { marginTop: '2px' }, text: s.note }),
      el('div.small.muted', { style: { marginTop: '4px' }, text: s.says }),
    ])),
    el('div.small.faint', { style: { marginTop: '4px' }, text: 'Evidence last reviewed July 2026.' }),
  ]);
}

const trim = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
