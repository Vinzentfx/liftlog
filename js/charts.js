// Selbstgebaute SVG-Diagramme. Keine Bibliothek, also nichts zu laden und nichts, was
// offline kaputtgeht. Gezeichnet wird in der gemessenen Pixelbreite (statt einer
// skalierten viewBox), damit die Achsenbeschriftung ihre Größe behält und nicht mit der Karte gestreckt wird.

import { el } from './ui.js';
import { t, tn, locale } from './i18n.js';
import { dayKey } from './models.js';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    node.setAttribute(k, String(v));
  }
  return node;
}

/** Bei geänderter Breite neu zeichnen, Diagramme werden gemessen und nicht skaliert. */
/**
 * Die IDs der Verläufe müssen im Dokument eindeutig sein, und ein Screen kann vier
 * Diagramme haben. Ein Zähler reicht und hält das Markup lesbar.
 */
let gradSeq = 0;

/** Von oben beleuchtete senkrechte Füllung, dieselbe Farbskala wie bei den Balken. */
function barGradient() {
  const id = `bar-grad-${++gradSeq}`;
  const defs = svgEl('defs');
  const grad = svgEl('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.append(
    svgEl('stop', { offset: '0', class: 'bar-stop-top' }),
    svgEl('stop', { offset: '1', class: 'bar-stop-bottom' }),
  );
  defs.append(grad);
  return { defs, fill: `url(#${id})` };
}

function responsive(build, height) {
  const wrap = el('div.figure');
  const host = el('div', { style: { position: 'relative' } });
  wrap.append(host);

  let lastWidth = 0;
  const paint = () => {
    const w = Math.max(220, Math.floor(wrap.clientWidth || 320));
    if (w === lastWidth) return;
    lastWidth = w;
    host.replaceChildren(build(w, height));
  };

  // Sofort zeichnen, damit es das Diagramm immer im DOM gibt, auch wenn die Seite im
  // Hintergrund ist und requestAnimationFrame nie feuert. Der Observer unten
  // korrigiert die Breite, sobald der Knoten wirklich gelayoutet ist.
  paint();
  requestAnimationFrame(paint);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(paint);
    ro.observe(wrap);
  } else {
    window.addEventListener('resize', paint);
  }
  return wrap;
}

function niceTicks(min, max, count = 4) {
  if (min === max) return [min];
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks.length ? ticks : [min, max];
}

/**
 * Liniendiagramm mit einer Reihe über die Zeit.
 * Die Zuordnung hängt hier nie an der Farbe, es gibt eine Reihe, benannt in der Beschriftung.
 *
 * @param {{x:number,y:number}[]} points  x ist ein Zeitstempel
 * @param {object} opts  { height, format, xFormat, showTrend, showArea, caption }
 */
export function lineChart(points, opts = {}) {
  const {
    height = 190, format = (v) => String(Math.round(v)),
    xFormat = (ts) => new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }),
    showTrend = false, showArea = true, caption = null,
    // Nur ein Stapel von Diagrammen, der behauptet, eine gemeinsame Zeitachse zu
    // haben, braucht das: er muss jedem Diagramm dieselben Ränder geben, sonst liegen
    // die x-Achsen um die paar Pixel daneben, in denen sich die beiden Komponenten
    // zufällig unterscheiden, und die Behauptung stimmt nicht. Alles andere nimmt die Standardwerte.
    padL = 34, padR = 10, xLabels = true,
  } = opts;

  const data = [...points].filter((p) => Number.isFinite(p.y)).sort((a, b) => a.x - b.x);

  const wrap = responsive((W, H) => {
    const padT = 12, padB = xLabels ? 22 : 8;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const svg = svgEl('svg', {
      class: 'chart', width: W, height: H,
      viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': caption || t('chart.line'),
    });

    if (data.length < 2) {
      // Node.append gibt undefined zurück, anders als appendChild. Eine Eigenschaft
      // davon zu lesen hat also geworfen, und statt des Platzhalters, für den der
      // Zweig geschrieben wurde, ist der ganze Screen abgestürzt. Aufrufer sollten
      // meistens etwas Nützlicheres sagen als eine leere Fläche, das hier ist der
      // Rückfall für die, die es nicht tun.
      const label = svgEl('text', {
        x: W / 2, y: H / 2, class: 'axis', 'text-anchor': 'middle',
      });
      label.textContent = t(data.length ? 'chart.onePoint' : 'chart.noData');
      svg.append(label);
      return svg;
    }

    const xs = data.map((p) => p.x), ys = data.map((p) => p.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    // Eine Größenachse nie ohne Luft mitten in der Höhe anfangen lassen, 8 % Rand.
    const padY = (yMax - yMin) * 0.12 || Math.max(1, yMax * 0.05);
    yMin = Math.max(0, yMin - padY); yMax = yMax + padY;

    const sx = (x) => padL + (xMax === xMin ? plotW / 2 : ((x - xMin) / (xMax - xMin)) * plotW);
    const sy = (y) => padT + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;

    // --- dezentes Raster und y-Beschriftung ---
    for (const tick of niceTicks(yMin, yMax, 4)) {
      const y = sy(tick);
      svg.append(svgEl('line', { class: 'grid', x1: padL, x2: W - padR, y1: y, y2: y }));
      const label = svgEl('text', { class: 'axis', x: padL - 6, y: y + 3.5, 'text-anchor': 'end' });
      label.textContent = format(tick);
      svg.append(label);
    }

    // --- x-Beschriftung: nur erste und letzte, dann können sie sich nicht überlappen ---
    if (xLabels) [[data[0], 'start'], [data[data.length - 1], 'end']].forEach(([p, anchor]) => {
      const label = svgEl('text', {
        class: 'axis', x: anchor === 'start' ? padL : W - padR,
        y: H - 6, 'text-anchor': anchor,
      });
      label.textContent = xFormat(p.x);
      svg.append(label);
    });

    const path = data.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');

    if (showArea) {
      svg.append(svgEl('path', {
        class: 'area',
        d: `${path}L${sx(data[data.length - 1].x).toFixed(1)},${(padT + plotH).toFixed(1)}L${sx(data[0].x).toFixed(1)},${(padT + plotH).toFixed(1)}Z`,
      }));
    }

    if (showTrend && data.length >= 3) {
      const n = data.length;
      let sxs = 0, sys = 0, sxy = 0, sxx = 0;
      data.forEach((p) => { sxs += p.x; sys += p.y; sxy += p.x * p.y; sxx += p.x * p.x; });
      const denom = n * sxx - sxs * sxs;
      if (denom) {
        const slope = (n * sxy - sxs * sys) / denom;
        const intercept = (sys - slope * sxs) / n;
        const y1 = slope * xMin + intercept, y2 = slope * xMax + intercept;
        const clamp = (v) => Math.max(padT, Math.min(padT + plotH, sy(v)));
        svg.append(svgEl('line', {
          class: 'trend', x1: sx(xMin), y1: clamp(y1), x2: sx(xMax), y2: clamp(y2),
        }));
      }
    }

    svg.append(svgEl('path', { class: 'line', d: path }));

    // Punkte nur, wenn sie Platz haben (laut Vorgabe mindestens 8 px Abstand).
    if (plotW / data.length >= 8) {
      data.forEach((p) => svg.append(svgEl('circle', { class: 'dot', cx: sx(p.x), cy: sy(p.y), r: 3.5 })));
    }

    // --- Fadenkreuz und Tooltip ---
    const cross = svgEl('line', { class: 'cross', y1: padT, y2: padT + plotH, x1: 0, x2: 0, opacity: 0 });
    const focus = svgEl('circle', { class: 'dot', r: 5, cx: 0, cy: 0, opacity: 0 });
    svg.append(cross, focus);

    const tip = el('div.chart-tip', { hidden: true });
    const hit = svgEl('rect', { class: 'hit', x: 0, y: 0, width: W, height: H });
    svg.append(hit);

    const show = (clientX, rect) => {
      const px = clientX - rect.left;
      let nearest = data[0], best = Infinity;
      for (const p of data) {
        const d = Math.abs(sx(p.x) - px);
        if (d < best) { best = d; nearest = p; }
      }
      const cx = sx(nearest.x), cy = sy(nearest.y);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('opacity', 1);
      focus.setAttribute('cx', cx); focus.setAttribute('cy', cy); focus.setAttribute('opacity', 1);
      tip.hidden = false;
      tip.replaceChildren(
        document.createTextNode(nearest.tip || format(nearest.y)),
        el('small', { text: xFormat(nearest.x) })
      );
      // Den Tooltip innerhalb der Karte halten.
      tip.style.left = `${Math.max(38, Math.min(W - 38, cx))}px`;
      tip.style.top = `${cy}px`;
    };

    const hide = () => {
      cross.setAttribute('opacity', 0);
      focus.setAttribute('opacity', 0);
      tip.hidden = true;
    };

    svg.addEventListener('pointermove', (e) => show(e.clientX, svg.getBoundingClientRect()));
    svg.addEventListener('pointerdown', (e) => show(e.clientX, svg.getBoundingClientRect()));
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('pointercancel', hide);

    const frag = document.createDocumentFragment();
    frag.append(svg, tip);
    return frag;
  }, height);

  if (caption) wrap.prepend(el('figcaption', { text: caption }));
  return wrap;
}

/**
 * Säulendiagramm. Die Säulen stehen auf der Grundlinie, oben 4 px abgerundet, und
 * zwischen Nachbarn liegen 2 px Abstand.
 *
 * @param {{label:string,value:number,dim?:boolean}[]} bars
 */
export function barChart(bars, opts = {}) {
  const {
    height = 170, format = (v) => String(Math.round(v)), caption = null, everyNthLabel = 1,
    padL = 30, padR = 8, xLabels = true,
  } = opts;

  const wrap = responsive((W, H) => {
    const padT = 12, padB = xLabels ? 22 : 8;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const svg = svgEl('svg', {
      class: 'chart', width: W, height: H, viewBox: `0 0 ${W} ${H}`,
      role: 'img', 'aria-label': caption || t('chart.bar'),
    });

    if (!bars.length) {
      const note = svgEl('text', { x: W / 2, y: H / 2, class: 'axis', 'text-anchor': 'middle' });
      note.textContent = t('chart.noData');
      svg.append(note);
      return svg;
    }

    const maxV = Math.max(...bars.map((b) => b.value), 1);
    const ticks = niceTicks(0, maxV, 3);
    const top = Math.max(...ticks, maxV);
    const sy = (v) => padT + plotH - (v / top) * plotH;

    for (const tick of ticks) {
      const y = sy(tick);
      svg.append(svgEl('line', { class: 'grid', x1: padL, x2: W - padR, y1: y, y2: y }));
      const label = svgEl('text', { class: 'axis', x: padL - 6, y: y + 3.5, 'text-anchor': 'end' });
      label.textContent = format(tick);
      svg.append(label);
    }

    const slot = plotW / bars.length;
    const gap = 2;                                    // Abstand zwischen den Säulen
    const bw = Math.max(4, Math.min(22, slot - gap - 2));
    const r = Math.min(4, bw / 2);

    const tip = el('div.chart-tip', { hidden: true });
    const grad = barGradient();
    svg.append(grad.defs);

    bars.forEach((b, i) => {
      const x = padL + i * slot + (slot - bw) / 2;
      const y = sy(b.value);
      const h = Math.max(b.value > 0 ? 2 : 0, padT + plotH - y);

      if (h > 0) {
        // Oben rund, unten gerade, die Säule steht fest auf der Grundlinie.
        const d = `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + bw - r},${y} Q${x + bw},${y} ${x + bw},${y + r} L${x + bw},${y + h} Z`;
        const bar = svgEl('path', { class: `bar${b.dim ? ' dim' : ''}`, d, fill: grad.fill });
        svg.append(bar);
      }

      // Um die letzte Säule geht es in der Beschriftung ("das ist die aktuelle Woche"),
      // und sie ist der einzige Wert, den man ohne Tippen lesen sollte.
      if (i === bars.length - 1 && b.value > 0) {
        const value = svgEl('text', {
          class: 'bar-value', x: x + bw / 2, y: Math.max(padT - 1, y - 5), 'text-anchor': 'middle',
        });
        value.textContent = format(b.value);
        svg.append(value);
      }

      const hit = svgEl('rect', {
        class: 'hit', x: padL + i * slot, y: padT, width: slot, height: plotH,
      });
      const show = () => {
        tip.hidden = false;
        tip.replaceChildren(
          document.createTextNode(b.tip || format(b.value)),
          el('small', { text: b.label })
        );
        tip.style.left = `${Math.max(38, Math.min(W - 38, x + bw / 2))}px`;
        tip.style.top = `${y}px`;
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerdown', show);
      svg.append(hit);

      if (xLabels && (i % everyNthLabel === 0 || i === bars.length - 1)) {
        const label = svgEl('text', {
          class: 'axis', x: x + bw / 2, y: H - 6, 'text-anchor': 'middle',
        });
        label.textContent = b.short || b.label;
        svg.append(label);
      }
    });

    svg.addEventListener('pointerleave', () => { tip.hidden = true; });

    const frag = document.createDocumentFragment();
    frag.append(svg, tip);
    return frag;
  }, height);

  if (caption) wrap.prepend(el('figcaption', { text: caption }));
  return wrap;
}

/**
 * Waagerechte Balken für Größen. Die Zuordnung kommt aus der Zeilenbeschriftung,
 * eine einzige Farbe ist hier also richtig, eine Farbpalette braucht es nicht.
 */
export function hBars(rows, opts = {}) {
  const { format = (v) => String(Math.round(v)) } = opts;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return el('div', {}, rows.map((r) =>
    el('div.bar-row', {}, [
      el('span.name', { text: r.label, title: r.label }),
      el('div.track', {}, [
        el('div.fill', { style: { width: `${Math.max(2, (r.value / max) * 100)}%` } }),
      ]),
      el('span.val', { text: format(r.value) }),
    ])
  ));
}

/** Kalender-Heatmap in einer Farbe, von hell nach dunkel, nie ein Regenbogen. */
export function heatmap(days, weeks = 18) {
  const byDay = new Map(days.map((d) => [d.key, d.value]));
  const cells = [];

  const end = new Date(); end.setHours(0, 0, 0, 0);
  // Zurück zum letzten Sonntag, damit die Spalten ganze Wochen sind.
  end.setDate(end.getDate() + (6 - ((end.getDay() + 6) % 7)));
  const start = new Date(end);
  start.setDate(start.getDate() - weeks * 7 + 1);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    // dayKey, nicht toISOString. `d` ist Mitternacht in Ortszeit, und östlich von UTC
    // ist Mitternacht in Ortszeit in UTC noch gestern. Jede Zelle hatte also einen Tag
    // zu früh als Schlüssel, während der Tooltip das richtige Datum zeigte. Die Farben
    // landeten einen Tag rechts neben den Trainings, von denen sie kamen.
    const key = dayKey(d.getTime());
    const v = byDay.get(key) || 0;
    const level = v === 0 ? 0 : v <= 8 ? 1 : v <= 16 ? 2 : 3;
    cells.push(el('i', {
      dataset: { v: String(level) },
      title: `${d.toLocaleDateString(locale())}: ${v ? tn(v, 'unit.set') : t('chart.restDay')}`,
    }));
  }

  return el('div.heatmap', {}, cells);
}
