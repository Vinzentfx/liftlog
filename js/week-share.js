// The sheet that builds and hands over a week card.
//
// Everything here happens on the phone: the summary is read out of IndexedDB,
// drawn onto a canvas and turned into a PNG. There is no upload step and no
// service to be down — this works in flight mode, which is the point of the app.
//
// Three ways out, because iOS has three habits: the share sheet (straight into a
// chat), a download, and a long press on the preview, which is what most people
// actually do with an image they can see.

import { el, openSheet, toast } from './ui.js';
import * as store from './store.js';
import { startOfWeek } from './models.js';
import { hasProfile } from './standards.js';
import { weekSummary, renderCard, cardBlob } from './week-card.js';

// Remembered while the app is open — someone who shares last week once usually
// means it the next time too.
let which = 'this';
let mapMode = null;

const FILE_NAME = (weekStart) => `liftlog-week-${new Date(weekStart).toISOString().slice(0, 10)}.png`;

export function shareWeekSheet() {
  if (mapMode === null) {
    // The tier map is the better-looking one, but it stays dark for someone who
    // only trains on machines. Open on the map that will actually have colour.
    mapMode = hasProfile(store.state.settings) && store.state.settings.showRatings !== false
      ? 'strength'
      : 'progress';
  }

  let url = null;         // object URL of the current preview
  let blob = null;
  let token = 0;          // guards against a slow render landing after a newer one

  const preview = el('div.card', {
    style: { padding: '10px', display: 'flex', justifyContent: 'center', minHeight: '180px' },
  }, [el('div.small.faint', { text: 'Drawing your week…' })]);

  const actions = el('div.stack', { style: { marginTop: '14px' } });
  const note = el('div.small.faint', { style: { marginTop: '12px' } });

  const mapSeg = seg([['strength', 'Strength map'], ['progress', 'Progress map']], () => mapMode,
    (v) => { mapMode = v; draw(); }, { marginTop: '8px' });

  const body = el('div', {}, [
    seg([['this', 'This week'], ['last', 'Last week']], () => which, (v) => { which = v; draw(); }),
    mapSeg,
    el('div', { style: { marginTop: '12px' } }, [preview]),
    actions,
    note,
  ]);

  function weekStart() {
    const now = startOfWeek(Date.now());
    if (which === 'this') return now;
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return startOfWeek(d.getTime());
  }

  async function draw() {
    const mine = ++token;
    actions.replaceChildren();
    note.textContent = '';

    const start = weekStart();
    const summary = weekSummary({
      sessions: store.state.sessions,
      exerciseById: store.state.exerciseById,
      settings: store.state.settings,
      bodyweight: store.state.bodyweight,
      plan: store.activePlan(),
      units: store.units(),
      weekStart: start,
      mapMode,
    });

    // The card falls back to the progress map when there is no strength rating
    // behind that week — the toggle has to say what is actually on the picture,
    // not what was asked for.
    mapMode = summary.mapMode;
    const strengthPossible = !!summary.strength;
    mapSeg.children[0].disabled = !strengthPossible;
    mapSeg.children[0].title = strengthPossible ? '' : 'No strength rating for this week';
    for (const [i, b] of [...mapSeg.children].entries()) {
      b.setAttribute('aria-pressed', String(['strength', 'progress'][i] === mapMode));
    }

    try {
      const canvas = await renderCard(summary);
      const next = await cardBlob(canvas);
      if (mine !== token) return;      // a newer render already won

      if (url) URL.revokeObjectURL(url);
      blob = next;
      url = URL.createObjectURL(blob);
      preview.replaceChildren(el('img', {
        src: url,
        alt: `Week card for ${summary.label}`,
        style: { display: 'block', width: '100%', borderRadius: '12px' },
      }));
      buttons(summary, start);
    } catch (err) {
      if (mine !== token) return;
      console.error('[liftlog] week card', err);
      preview.replaceChildren(el('div.small', { style: { color: 'var(--warn)' },
        text: `Could not draw the card: ${err.message}` }));
    }
  }

  function buttons(summary, start) {
    const name = FILE_NAME(start);
    const file = fileFrom(blob, name);
    const canShareFile = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));

    // replaceChildren stringifies null into a literal "null" text node, unlike
    // el()'s children — the optional buttons have to be filtered out, not passed.
    actions.replaceChildren(...[
      canShareFile
        ? el('button.btn.primary.full', {
            onclick: () => navigator.share({ files: [fileFrom(blob, name)], title: `LiftLog · ${summary.label}` })
              .catch(() => { /* dismissed, or the target refused the file */ }),
          }, ['Send…'])
        : null,
      el('button.btn.ghost.full', {
        onclick: () => {
          const a = el('a', { href: url, download: name });
          document.body.append(a);
          a.click();
          a.remove();
          toast('Image saved');
        },
      }, ['Save image']),
      // Clipboard images are Safari 13.1+ and Chrome 76+, but write() is behind
      // a permission in some builds, so this stays an extra rather than the
      // main path.
      navigator.clipboard && window.ClipboardItem
        ? el('button.btn.ghost.full', {
            onclick: async () => {
              try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                toast('Image copied');
              } catch {
                toast('Press and hold the picture to copy it');
              }
            },
          }, ['Copy image'])
        : null,
    ].filter(Boolean));

    note.textContent = canShareFile
      ? 'Nothing leaves your phone until you send it — the card is drawn here, offline. Press and hold the picture to save it straight to Photos.'
      : 'Nothing leaves your phone until you send it — the card is drawn here, offline. Press and hold the picture to save or copy it.';
  }

  openSheet('Share your week', body, {
    onClose: () => {
      token++;                              // orphan any render still in flight
      if (url) URL.revokeObjectURL(url);
      url = null;
      blob = null;
    },
  });
  draw();
}

/** A File is what the share sheet wants; a Blob alone is refused on iOS. */
function fileFrom(blob, name) {
  if (!blob || typeof File !== 'function') return null;
  try {
    return new File([blob], name, { type: 'image/png' });
  } catch {
    return null;
  }
}

function seg(options, current, onPick, style = {}) {
  const node = el('div.seg', { style });
  for (const [key, label] of options) {
    node.append(el('button', {
      'aria-pressed': String(current() === key),
      onclick: () => {
        if (current() === key) return;
        onPick(key);
        for (const [i, b] of [...node.children].entries()) {
          b.setAttribute('aria-pressed', String(options[i][0] === key));
        }
      },
    }, [label]));
  }
  return node;
}
