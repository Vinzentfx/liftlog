// Hand-rolled SVG charts. No library, so nothing to fetch and nothing to break
// offline. Charts render at measured pixel width (rather than a scaled viewBox)
// so axis text stays at its intended size instead of stretching with the card.

import { el } from './ui.js';
import { t, tn, locale } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    node.setAttribute(k, String(v));
  }
  return node;
}

/** Re-render on width change; charts are measured, not scaled. */
/**
 * Gradient ids have to be unique per document, and a screen can hold four
 * charts. A counter is enough and keeps the markup readable.
 */
let gradSeq = 0;

/** Top-lit vertical fill, the same accent ramp the meter bars use. */
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

  // Paint synchronously so a chart always exists in the DOM, even when the page
  // is backgrounded and requestAnimationFrame never fires. The observer below
  // corrects the width once the node is laid out for real.
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
 * Single-series line chart over time.
 * Identity never rides on colour here — one series, named by the caption.
 *
 * @param {{x:number,y:number}[]} points  x is a timestamp
 * @param {object} opts  { height, format, xFormat, showTrend, showArea, caption }
 */
export function lineChart(points, opts = {}) {
  const {
    height = 190, format = (v) => String(Math.round(v)),
    xFormat = (ts) => new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }),
    showTrend = false, showArea = true, caption = null,
    // Only a stack of charts that claims to share one timeline needs these: it
    // has to pass the same gutters to every chart in the stack, or the x-axes
    // are off by the few pixels the two components happen to differ by, and the
    // claim is false. Everything else takes the defaults.
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
      // Node.append returns undefined — unlike appendChild — so reading a
      // property off it threw, and this whole branch crashed the screen instead
      // of drawing the placeholder it was written to draw. Callers should
      // generally say something more useful than an empty plot area; this is
      // the fallback for the ones that don't.
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
    // Never start a magnitude axis mid-air without headroom; pad by 8%.
    const padY = (yMax - yMin) * 0.12 || Math.max(1, yMax * 0.05);
    yMin = Math.max(0, yMin - padY); yMax = yMax + padY;

    const sx = (x) => padL + (xMax === xMin ? plotW / 2 : ((x - xMin) / (xMax - xMin)) * plotW);
    const sy = (y) => padT + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;

    // --- recessive grid + y labels ---
    for (const tick of niceTicks(yMin, yMax, 4)) {
      const y = sy(tick);
      svg.append(svgEl('line', { class: 'grid', x1: padL, x2: W - padR, y1: y, y2: y }));
      const label = svgEl('text', { class: 'axis', x: padL - 6, y: y + 3.5, 'text-anchor': 'end' });
      label.textContent = format(tick);
      svg.append(label);
    }

    // --- x labels: first and last only, so they can't collide ---
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

    // Markers only when they can breathe (>= 8px apart per the mark spec).
    if (plotW / data.length >= 8) {
      data.forEach((p) => svg.append(svgEl('circle', { class: 'dot', cx: sx(p.x), cy: sy(p.y), r: 3.5 })));
    }

    // --- crosshair + tooltip ---
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
      // Keep the tip inside the card.
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
 * Vertical bar chart. Bars are anchored to the baseline with 4px rounded tops
 * and a 2px surface gap between neighbours.
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
    const gap = 2;                                    // surface gap between bars
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
        // Rounded top, square bottom — the bar stays anchored to the baseline.
        const d = `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + bw - r},${y} Q${x + bw},${y} ${x + bw},${y + r} L${x + bw},${y + h} Z`;
        const bar = svgEl('path', { class: `bar${b.dim ? ' dim' : ''}`, d, fill: grad.fill });
        svg.append(bar);
      }

      // The last bar is the one the caption is talking about ("this is the
      // current week"), and it is the only value worth reading without a tap.
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
 * Horizontal magnitude bars. Identity comes from the row label, so a single
 * hue is correct here — no categorical palette needed.
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

/** Sequential single-hue calendar heatmap — light→dark, never a rainbow. */
export function heatmap(days, weeks = 18) {
  const byDay = new Map(days.map((d) => [d.key, d.value]));
  const cells = [];

  const end = new Date(); end.setHours(0, 0, 0, 0);
  // Wind back to the most recent Sunday so columns are whole weeks.
  end.setDate(end.getDate() + (6 - ((end.getDay() + 6) % 7)));
  const start = new Date(end);
  start.setDate(start.getDate() - weeks * 7 + 1);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const v = byDay.get(key) || 0;
    const level = v === 0 ? 0 : v <= 8 ? 1 : v <= 16 ? 2 : 3;
    cells.push(el('i', {
      dataset: { v: String(level) },
      title: `${d.toLocaleDateString(locale())}: ${v ? tn(v, 'unit.set') : t('chart.restDay')}`,
    }));
  }

  return el('div.heatmap', {}, cells);
}
