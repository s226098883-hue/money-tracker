// Small hand-made SVG charts: thin columns, hover/tap tooltips, legend, and a table view.

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Rounded data-end on top, square at the baseline. */
function columnPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Clean axis steps such as 0 / 50 / 100 / 150. */
export function niceTicks(max, count = 4) {
  if (!(max > 0)) return { ticks: [0], top: 1 };
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { ticks, top };
}

export function legend(series) {
  const wrap = el('div', 'legend');
  for (const s of series) {
    const item = el('span', 'legend-item');
    const key = el('span', 'legend-key');
    key.style.background = s.color;
    item.append(key, document.createTextNode(s.label));
    wrap.append(item);
  }
  return wrap;
}

/**
 * Grouped column chart.
 * points: [{ tick: 'Mon', title: 'Monday 28 Sep', values: { spent: 12, saved: 0 } }]
 * series: [{ key: 'spent', label: 'Spent', color: 'var(--spent)' }]
 */
export function columnChart(container, { points, series, format, formatAxis, labelEvery = 1, ariaLabel }) {
  container.textContent = '';
  container.classList.add('chart');

  const width = Math.max(260, Math.floor(container.clientWidth || 320));
  const padL = 46;
  const padR = 6;
  const padT = 10;
  const plotH = 170;
  const axisH = 26;
  const height = padT + plotH + axisH;
  const innerW = width - padL - padR;

  const max = Math.max(0, ...points.flatMap((p) => series.map((s) => p.values[s.key] || 0)));
  const { ticks, top } = niceTicks(max);
  const band = innerW / points.length;
  const gap = 2;
  const groupW = Math.min(band * (band < 16 ? 0.84 : 0.7), series.length * 24 + (series.length - 1) * gap);
  const barW = Math.max(2, (groupW - (series.length - 1) * gap) / series.length);
  const yOf = (v) => padT + plotH - (v / top) * plotH;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: 'group',
    'aria-label': ariaLabel || 'Chart',
  });

  // Gridlines + y labels
  for (const t of ticks) {
    const y = yOf(t);
    svg.append(svgEl('line', { x1: padL, x2: width - padR, y1: y, y2: y, class: t === 0 ? 'baseline' : 'grid' }));
    const label = svgEl('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-label' });
    label.textContent = formatAxis(t);
    svg.append(label);
  }

  const hover = svgEl('rect', { x: 0, y: padT, width: band, height: plotH, rx: 6, class: 'hover-band', opacity: 0 });
  svg.append(hover);

  const tip = el('div', 'chart-tip');
  tip.hidden = true;

  const showTip = (i) => {
    const p = points[i];
    hover.setAttribute('x', padL + i * band + 1);
    hover.setAttribute('width', Math.max(0, band - 2));
    hover.setAttribute('opacity', 1);
    tip.textContent = '';
    tip.append(el('div', 'tip-title', p.title));
    for (const s of series) {
      const row = el('div', 'tip-row');
      const key = el('span', 'tip-key');
      key.style.background = s.color;
      row.append(key, el('strong', '', format(p.values[s.key] || 0)), el('span', 'tip-name', s.label));
      tip.append(row);
    }
    tip.hidden = false;
    const scale = container.clientWidth / width || 1;
    const center = (padL + i * band + band / 2) * scale;
    const tipW = tip.offsetWidth;
    const left = Math.min(Math.max(4, center - tipW / 2), container.clientWidth - tipW - 4);
    tip.style.left = `${left}px`;
    tip.style.top = `${padT * scale}px`;
  };
  const hideTip = () => {
    tip.hidden = true;
    hover.setAttribute('opacity', 0);
  };

  points.forEach((p, i) => {
    const x0 = padL + i * band + (band - groupW) / 2;
    series.forEach((s, j) => {
      const v = p.values[s.key] || 0;
      if (v <= 0) return;
      const h = Math.max(2, (v / top) * plotH);
      const x = x0 + j * (barW + gap);
      svg.append(svgEl('path', { d: columnPath(x, padT + plotH - h, barW, h, 4), fill: s.color, class: 'bar' }));
    });

    // Count labels back from the newest column so "today" / "this month" is always labelled.
    if ((points.length - 1 - i) % labelEvery === 0) {
      const t = svgEl('text', { x: padL + i * band + band / 2, y: padT + plotH + 18, 'text-anchor': 'middle', class: 'axis-label' });
      t.textContent = p.tick;
      svg.append(t);
    }

    // Hit target: the whole column band (bigger than the bars), works with mouse, touch and keyboard.
    const hit = svgEl('rect', {
      x: padL + i * band, y: padT, width: band, height: plotH + axisH, fill: 'transparent', tabindex: 0,
      class: 'hit', 'aria-label': `${p.title}: ${series.map((s) => `${s.label} ${format(p.values[s.key] || 0)}`).join(', ')}`,
    });
    hit.addEventListener('pointerenter', () => showTip(i));
    hit.addEventListener('pointerdown', () => showTip(i));
    hit.addEventListener('focus', () => showTip(i));
    hit.addEventListener('blur', hideTip);
    svg.append(hit);
  });

  svg.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hideTip();
  });

  container.append(svg, tip);
}

/** Simple table twin of a chart (every value readable without hovering). */
export function chartTable(container, { columns, rows }) {
  container.textContent = '';
  const table = el('table', 'data-table');
  const thead = el('thead');
  const hr = el('tr');
  columns.forEach((c, i) => {
    const th = el('th', i === 0 ? '' : 'num', c);
    th.scope = 'col';
    hr.append(th);
  });
  thead.append(hr);
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    r.forEach((cell, i) => tr.append(el(i === 0 ? 'th' : 'td', i === 0 ? '' : 'num', cell)));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  container.append(table);
}

/**
 * Horizontal bars for one series (spending by category). Value sits at the bar's tip.
 * items: [{ label, emoji, value }]
 */
export function hBars(container, { items, format, color }) {
  container.textContent = '';
  const max = Math.max(...items.map((i) => i.value), 0);
  const total = items.reduce((s, i) => s + i.value, 0);
  const list = el('div', 'hbars');
  for (const item of items) {
    const row = el('div', 'hbar-row');
    const label = el('div', 'hbar-label');
    label.append(el('span', 'hbar-emoji', item.emoji), el('span', 'hbar-name', item.label));
    const track = el('div', 'hbar-track');
    const fill = el('div', 'hbar-fill');
    // Leave room after the longest bar for its value label.
    fill.style.width = `calc((100% - 92px) * ${max ? item.value / max : 0})`;
    fill.style.background = color;
    const share = total ? (item.value / total) * 100 : 0;
    const pct = share > 0 && share < 1 ? '<1' : String(Math.round(share));
    const value = el('span', 'hbar-value', `${format(item.value)} · ${pct}%`);
    track.append(fill, value);
    row.append(label, track);
    list.append(row);
  }
  container.append(list);
}
