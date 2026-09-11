// Das Sheet, das eine Wochenkarte baut und weitergibt.
//
// Alles passiert auf dem Handy: die Zusammenfassung kommt aus IndexedDB, wird auf
// einen Canvas gezeichnet und als PNG ausgegeben. Es gibt keinen Upload und keinen
// Dienst, der ausfallen kann. Das geht im Flugmodus, und darum geht es bei der App.
//
// Drei Wege nach draußen, weil iOS drei Gewohnheiten hat: das Teilen-Menü (direkt
// in einen Chat), ein Download und langes Drücken auf die Vorschau. Letzteres
// machen die meisten mit einem Bild, das sie sehen.

import { t } from './i18n.js';
import { el, openSheet, toast } from './ui.js';
import * as store from './store.js';
import { startOfWeek } from './models.js';
import { hasProfile } from './standards.js';
import { weekSummary, renderCard, cardBlob } from './week-card.js';

// Wird gemerkt, solange die App offen ist. Wer einmal die letzte Woche teilt, meint
// es beim nächsten Mal meistens auch.
let which = 'this';
let mapMode = null;

const FILE_NAME = (weekStart) => `liftlog-week-${new Date(weekStart).toISOString().slice(0, 10)}.png`;

export function shareWeekSheet() {
  if (mapMode === null) {
    // Die Rangkarte sieht besser aus, bleibt aber dunkel bei jemandem, der nur an
    // Maschinen trainiert. Deshalb mit der Karte öffnen, die auch Farbe hat.
    mapMode = hasProfile(store.state.settings) && store.state.settings.showRatings !== false
      ? 'strength'
      : 'progress';
  }

  let url = null;         // Object-URL der aktuellen Vorschau
  let blob = null;
  let token = 0;          // verhindert, dass ein langsames Rendern nach einem neueren ankommt

  const preview = el('div.card', {
    style: { padding: '10px', display: 'flex', justifyContent: 'center', minHeight: '180px' },
  }, [el('div.small.faint', { text: t('weekShare.drawing') })]);

  const actions = el('div.stack', { style: { marginTop: '14px' } });
  const note = el('div.small.faint', { style: { marginTop: '12px' } });

  const mapSeg = seg([['strength', t('weekShare.strengthMap')], ['progress', t('weekShare.progressMap')]], () => mapMode,
    (v) => { mapMode = v; draw(); }, { marginTop: '8px' });

  const body = el('div', {}, [
    seg([['this', t('home.week.title')], ['last', t('common.lastWeek')]], () => which, (v) => { which = v; draw(); }),
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

    // Ohne Stärkebewertung für diese Woche fällt die Karte auf die Fortschrittskarte
    // zurück. Der Schalter muss sagen, was wirklich auf dem Bild ist, nicht was
    // gewünscht war.
    mapMode = summary.mapMode;
    const strengthPossible = !!summary.strength;
    mapSeg.children[0].disabled = !strengthPossible;
    mapSeg.children[0].title = strengthPossible ? '' : t('weekShare.noStrength');
    for (const [i, b] of [...mapSeg.children].entries()) {
      b.setAttribute('aria-pressed', String(['strength', 'progress'][i] === mapMode));
    }

    try {
      const canvas = await renderCard(summary);
      const next = await cardBlob(canvas);
      if (mine !== token) return;      // ein neueres Rendern war schneller

      if (url) URL.revokeObjectURL(url);
      blob = next;
      url = URL.createObjectURL(blob);
      preview.replaceChildren(el('img', {
        src: url,
        alt: t('weekShare.alt', { label: summary.label }),
        style: { display: 'block', width: '100%', borderRadius: '12px' },
      }));
      buttons(summary, start);
    } catch (err) {
      if (mine !== token) return;
      console.error('[liftlog] week card', err);
      preview.replaceChildren(el('div.small', { style: { color: 'var(--warn)' },
        text: t('weekShare.failed', { message: err.message }) }));
    }
  }

  function buttons(summary, start) {
    const name = FILE_NAME(start);
    const file = fileFrom(blob, name);
    const canShareFile = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));

    // replaceChildren macht aus null einen Textknoten "null", anders als die Kinder
    // von el(). Die optionalen Knöpfe müssen herausgefiltert und nicht übergeben werden.
    actions.replaceChildren(...[
      canShareFile
        ? el('button.btn.primary.full', {
            onclick: () => navigator.share({ files: [fileFrom(blob, name)], title: `LiftLog · ${summary.label}` })
              .catch(() => { /* weggeklickt, oder das Ziel wollte die Datei nicht */ }),
          }, [t('plans.send')])
        : null,
      el('button.btn.ghost.full', {
        onclick: () => {
          const a = el('a', { href: url, download: name });
          document.body.append(a);
          a.click();
          a.remove();
          toast(t('weekShare.saved'));
        },
      }, [t('weekShare.save')]),
      // Bilder in die Zwischenablage gehen ab Safari 13.1 und Chrome 76, aber
      // write() hängt in manchen Versionen an einer Berechtigung. Deshalb bleibt es
      // ein Extra und nicht der Hauptweg.
      navigator.clipboard && window.ClipboardItem
        ? el('button.btn.ghost.full', {
            onclick: async () => {
              try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                toast(t('weekShare.copied'));
              } catch {
                toast(t('weekShare.holdToCopy'));
              }
            },
          }, [t('weekShare.copy')])
        : null,
    ].filter(Boolean));

    note.textContent = canShareFile
      ? t('weekShare.privacyIos')
      : t('weekShare.privacy');
  }

  openSheet(t('weekShare.title'), body, {
    onClose: () => {
      token++;                              // ein laufendes Rendern ins Leere laufen lassen
      if (url) URL.revokeObjectURL(url);
      url = null;
      blob = null;
    },
  });
  draw();
}

/** Das Teilen-Menü will eine File, einen reinen Blob lehnt iOS ab. */
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
