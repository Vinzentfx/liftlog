// Helfer zum Zeichnen auf dem Canvas.
//
// Alles, was die App anzeigt, ist HTML und SVG, ein Bild zum Teilen ist keins
// von beiden. Ohne Abhängigkeiten kann man einen DOM-Knoten nicht fotografieren:
// html2canvas wäre eine Abhängigkeit, und der übliche Trick, HTML in ein
// <svg><foreignObject> zu packen und zu rastern, funktioniert in WebKit gar nicht.
// Und WebKit ist der einzige Browser, in dem die App auf dem Handy läuft, für das
// sie gebaut ist. Die Karte wird also mit diesen Grundformen GEZEICHNET.
//
// Das Einzige, was sich nicht von Hand zeichnen lässt, ist die Muskelkarte. Deren
// Formen sind aber schon Vektoren, also liest `loadPaths` dieselben zwei SVG-Dateien,
// die die App direkt anzeigt, und macht daraus Path2D-Objekte, die der Canvas
// füllen kann. Kein Rastern, keine Data-URLs, keine WebKit-Eigenheiten, und die
// Farbe jeder Region lässt sich frei setzen.

const FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif';

export const font = (size, weight = 400) => `${weight} ${size}px ${FAMILY}`;

/* ============================ Formen ============================ */

/** ctx.roundRect gibt es erst ab Safari 16, so läuft die Karte auch auf älteren Handys. */
export function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function fillRound(ctx, x, y, w, h, r, fill) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function strokeRound(ctx, x, y, w, h, r, stroke, width = 1) {
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

/* ============================= Text ============================= */

/**
 * @param o {size, weight, color, align, baseline, track, max}
 *   `track` ist der Buchstabenabstand in px, Zeichen für Zeichen gezeichnet.
 *   ctx.letterSpacing ist zu neu, um sich darauf zu verlassen, und die
 *   Großbuchstaben-Schlüssel brauchen es, damit sie richtig aussehen.
 *   `max` kürzt mit Auslassungspunkten, statt über die Karte hinauszulaufen.
 * @returns die tatsächlich gezeichnete Breite
 */
export function drawText(ctx, str, x, y, o = {}) {
  const {
    size = 14, weight = 400, color = '#EAF0FA',
    align = 'left', baseline = 'alphabetic', track = 0, max = null,
  } = o;

  ctx.font = font(size, weight);
  ctx.textBaseline = baseline;
  ctx.fillStyle = color;

  let s = String(str);
  if (max !== null) s = fitText(ctx, s, max, track);

  const w = widthOf(ctx, s, track);
  const startX = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;

  if (!track) {
    ctx.textAlign = 'left';
    ctx.fillText(s, startX, y);
    return w;
  }

  ctx.textAlign = 'left';
  let cx = startX;
  for (const ch of s) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + track;
  }
  return w;
}

export function widthOf(ctx, str, track = 0) {
  const base = ctx.measureText(str).width;
  return track ? base + track * Math.max(0, [...String(str)].length - 1) : base;
}

/** Messen ohne zu zeichnen. Setzt nebenbei ctx.font, wie drawText. */
export function textWidth(ctx, str, { size = 14, weight = 400, track = 0 } = {}) {
  ctx.font = font(size, weight);
  return widthOf(ctx, String(str), track);
}

function fitText(ctx, str, max, track) {
  if (widthOf(ctx, str, track) <= max) return str;
  let s = str;
  while (s.length > 1 && widthOf(ctx, `${s}…`, track) > max) s = s.slice(0, -1);
  return `${s}…`;
}

/** Einfacher Zeilenumbruch nach Wörtern. Gibt die Zeilen zurück, wohin sie kommen, entscheidet der Aufrufer. */
export function wrapLines(ctx, str, max, { size = 13, weight = 400 } = {}) {
  ctx.font = font(size, weight);
  const words = String(str).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/* =========================== SVG-Pfade =========================== */

const artCache = new Map();

/**
 * Ein SVG aus einfachen <path>-Elementen in Path2D-Objekte einlesen.
 *
 * Bewusst eng: versteht die beiden Dateien der Muskelkarte und sonst nichts. Die
 * erzeugt tools/build_bodymap.py, und sie sind garantiert reine Pfade mit viewBox,
 * ohne Transformationen, ohne relevante Gruppen, ohne Verläufe. Ein allgemeiner
 * SVG-Renderer wäre eine Bibliothek, und die nimmt diese App nicht.
 */
export async function loadPaths(url) {
  if (artCache.has(url)) return artCache.get(url);

  const job = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) throw new Error(`${url} has no <svg>`);

    // Der Ursprung zählt: body-back.svg hat "37 0 35 93", nicht "0 0 …". Wer nur
    // Breite und Höhe liest, zeichnet die Pfade an ihren rohen Koordinaten und
    // schiebt die ganze Figur eine viewBox-Breite nach rechts. Direkt eingebundenes
    // SVG versteckt das, weil der Browser den Ursprung anwendet, ein Canvas nicht.
    const [minX, minY, vw, vh] = (svg.getAttribute('viewBox') || '0 0 100 100')
      .split(/[\s,]+/).map(Number);

    const paths = [];
    for (const node of doc.querySelectorAll('path')) {
      const d = node.getAttribute('d');
      if (!d) continue;
      paths.push({
        path: new Path2D(d),
        region: node.getAttribute('data-region'),
        muscle: (node.getAttribute('class') || '').includes('muscle'),
      });
    }
    return { x: minX, y: minY, width: vw, height: vh, box: contentBox(svg), paths };
  })();

  artCache.set(url, job);
  // Ein fehlgeschlagenes Laden darf den Cache nicht vergiften, der nächste Versuch soll es neu probieren.
  job.catch(() => artCache.delete(url));
  return job;
}

/**
 * Wo die Zeichnung innerhalb der viewBox wirklich liegt, in Nutzereinheiten.
 *
 * Die Figur füllt ihre viewBox nicht aus: sie ist etwa 31,5 Einheiten breit in
 * einem Kasten von 35 und liegt am linken Rand. In der App fällt das nicht auf,
 * jede Karte hat ihre eigene Spalte. Auf einer Karte zum Teilen ist die Figur aber
 * eine eigene Grafik unter einer zentrierten Überschrift, und der leere Rand wirkt,
 * als wäre die Zeichnung verrutscht.
 *
 * Gemessen mit getBBox statt über die Pfaddaten. Dafür muss der Knoten eingehängt
 * und gerendert sein: `left: -9999px` geht, `display: none` nicht. Läuft einmal je
 * Datei, hinter demselben Cache wie das Laden. Gibt null zurück, wenn der Browser
 * sich weigert, dann nimmt der Aufrufer einfach die viewBox.
 */
function contentBox(svgNode) {
  if (typeof document === 'undefined') return null;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;width:300px;pointer-events:none';
  const svg = svgNode.cloneNode(true);
  host.append(svg);
  document.body.append(host);
  try {
    const b = svg.getBBox();
    return b.width > 0 ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
  } catch {
    return null;
  } finally {
    host.remove();
  }
}

/**
 * Geladene Pfade in einen Kasten mit vorgegebener Breite zeichnen, mit festem Seitenverhältnis.
 *
 * @param fillFor  Region -> Farbe, oder null für unbeleuchtet
 * @returns die Höhe, die die Zeichnung gebraucht hat
 */
export function drawPaths(ctx, art, x, y, width, opts = {}) {
  const {
    fillFor = () => null,
    baseFill = '#17223A',
    baseStroke = '#223049',
    unlitFill = '#17223A',
    glow = 0,
  } = opts;

  const scale = width / art.width;
  // Auf die Zeichnung zentriert, nicht auf den Kasten, in dem sie exportiert wurde.
  // Nur waagerecht: mit der Höhe der viewBox hat der Aufrufer den Platz reserviert,
  // und senkrecht füllt die Figur ihn sowieso. Beide Ansichten behalten denselben
  // Maßstab, das Paar passt also weiter zusammen, jede wird nur in die Mitte ihrer Spalte geschoben.
  const dx = art.box ? (art.x + art.width / 2) - (art.box.x + art.box.width / 2) : 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.translate(-art.x + dx, -art.y);   // der Ursprung der viewBox, genau wie SVG ihn anwendet
  // Strichbreiten stehen in der Quelle in Nutzereinheiten (die viewBox ist 35 x 93),
  // sie skalieren mit der Transformation also genau wie im eingebundenen SVG.
  ctx.lineWidth = 0.12;
  ctx.lineJoin = 'round';

  for (const p of art.paths) {
    if (!p.muscle) {
      ctx.fillStyle = baseFill;
      ctx.fill(p.path);
      ctx.strokeStyle = baseStroke;
      ctx.stroke(p.path);
    }
  }

  for (const p of art.paths) {
    if (!p.muscle) continue;
    const fill = fillFor(p.region);
    // Die Unschärfe des Schattens ist unabhängig von der Transformation in
    // Gerätepixeln, deshalb setzt der Aufrufer sie in Ausgabeeinheiten und sie wird nicht aus `scale` abgeleitet.
    ctx.shadowBlur = fill && glow ? glow : 0;
    ctx.shadowColor = fill || 'transparent';
    ctx.fillStyle = fill || unlitFill;
    ctx.fill(p.path);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(10, 14, 26, .8)';
    ctx.stroke(p.path);
  }

  ctx.restore();
  return art.height * scale;
}
