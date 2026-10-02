// MoneyTrack — main app: screens, forms and actions.
import {
  STORAGE_KEY, APP_VERSION, CATEGORIES, CAT, SAVED_EMOJI, CURRENCIES,
  loadState, saveState, normalise, askForPersistentStorage, sampleState, storageWorks,
  uid, esc, sanitizeAmount, parseAmount,
  todayISO, fromISO, addDays, daysBetween, monthOf, addMonths,
  paidOf, remainingOf, progressOf, nextDue, dueInfo,
} from './store.js';
import { columnChart, chartTable, legend, hBars } from './charts.js';

let state = loadState();

const ui = {
  activityFilter: 'all',
  activitySearch: '',
  debtDirection: 'iOwe',
  insightsRange: '7d',
  tableView: { trend: false, cats: false },
  showSettled: false,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ICON = {
  plus: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
  chevron: '<svg class="ic chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  alert: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17.5v.01"/></svg>',
  calendar: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  check: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  trash: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/></svg>',
};

// ---------- Money & date formatting ----------

const fmtCache = new Map();
function nf(name, opts) {
  const key = `${state.settings.currency}|${name}`;
  if (!fmtCache.has(key)) {
    let f;
    try {
      f = new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency, ...opts });
    } catch {
      f = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'AUD', ...opts });
    }
    fmtCache.set(key, f);
  }
  return fmtCache.get(key);
}
const money = (v) => nf('full', {}).format(v);
const moneyRound = (v) => nf('round', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
const moneyCompact = (v) => nf('compact', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
function currencySymbol() {
  const part = nf('full', {}).formatToParts(0).find((p) => p.type === 'currency');
  return part ? part.value : '$';
}

const fmtDate = (iso, opts) => fromISO(iso).toLocaleDateString(undefined, opts);
const shortDate = (iso) => fmtDate(iso, { day: 'numeric', month: 'short' });
const longDate = (iso) => fmtDate(iso, { day: 'numeric', month: 'short', year: 'numeric' });
function dayTitle(iso) {
  const t = todayISO();
  if (iso === t) return 'Today';
  if (iso === addDays(t, -1)) return 'Yesterday';
  return fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });
}
const monthName = (ym, style = 'short') => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1)
  .toLocaleDateString(undefined, style === 'long' ? { month: 'long', year: 'numeric' } : { month: 'short' });

const sumKind = (list, kind) => list.reduce((s, e) => (e.kind === kind ? s + e.amount : s), 0);
const findDebt = (id) => state.debts.find((d) => d.id === id);
const debtEmoji = (d) => (d.kind === 'loan' ? '🏦' : '👤');
const directionColor = (dir) => (dir === 'iOwe' ? 'var(--owe)' : 'var(--owed)');

function sortedEntries() {
  return [...state.entries].sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
}

function openDebts() {
  return state.debts.filter((d) => !d.settled);
}

/** Open debts that are overdue or due within the "warn me ahead" window. */
function upcomingDebts() {
  return openDebts()
    .map((d) => ({ d, info: dueInfo(d) }))
    .filter((x) => x.info && x.info.days <= state.settings.remindDays)
    .sort((a, b) => a.info.days - b.info.days)
    .map((x) => x.d);
}

function urgentDebts() {
  return openDebts().filter((d) => {
    const info = dueInfo(d);
    return info && info.days <= 1;
  });
}

// ---------- Save + re-render ----------

function commit(message) {
  const ok = saveState(state);
  render();
  if (!ok) toast("Couldn't save — this browser is blocking storage");
  else if (message) toast(message);
  askForPersistentStorage();
}

let toastTimer;
function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function applyTheme() {
  const theme = state.settings.theme;
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
}

async function updateBadges() {
  const count = urgentDebts().length;
  const badge = $('#debtsBadge');
  badge.textContent = String(count);
  badge.hidden = count === 0;
  badge.setAttribute('aria-label', `${count} due or overdue`);
  if ('setAppBadge' in navigator) {
    try {
      if (count) await navigator.setAppBadge(count);
      else await navigator.clearAppBadge();
    } catch {
      /* needs notification permission on iPhone — fine without it */
    }
  }
}

// ---------- Router ----------

const TABS = ['today', 'activity', 'debts', 'insights', 'settings'];
const currentTab = () => {
  const h = location.hash.replace('#', '');
  return TABS.includes(h) ? h : 'today';
};

function render() {
  const tab = currentTab();
  $$('.tabbar a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const view = $('#view');
  if (tab === 'today') renderToday(view);
  else if (tab === 'activity') renderActivity(view);
  else if (tab === 'debts') renderDebts(view);
  else if (tab === 'insights') renderInsights(view);
  else renderSettings(view);
  updateBadges();
  // A sheet that is open shows live data (e.g. a debt's balance) — refresh it too.
  if (sheet.open && sheetStack.length) showTopSheet();
}

function setHeader(title, eyebrow = '', actionHTML = '') {
  $('#title').textContent = title;
  const eb = $('#eyebrow');
  eb.textContent = eyebrow;
  eb.hidden = !eyebrow;
  $('#headerAction').innerHTML = actionHTML;
  document.title = title === 'Today' ? 'MoneyTrack' : `${title} · MoneyTrack`;
}

const addButton = (action, label) =>
  `<button class="icon-btn primary" data-action="${action}" aria-label="${esc(label)}">${ICON.plus}</button>`;

// ---------- Shared bits of markup ----------

function tile(label, amount, color = '', big = false) {
  return `<div class="tile${big ? ' big' : ''}">
    <div class="tile-label">${color ? `<span class="dot" style="background:${color}"></span>` : ''}${esc(label)}</div>
    <div class="tile-value">${esc(money(amount))}</div>
  </div>`;
}

function cardHead(title, actionLabel = '', action = '', arg = '') {
  return `<div class="card-head"><h2>${esc(title)}</h2>${
    actionLabel ? `<button class="link-btn" data-action="${action}" data-arg="${esc(arg)}">${esc(actionLabel)}</button>` : ''
  }</div>`;
}

function seg(name, options, current, label) {
  return `<div class="seg" role="group" aria-label="${esc(label)}">${options
    .map(([value, text]) => `<button type="button" data-action="seg" data-name="${name}" data-value="${value}" aria-pressed="${value === current}">${esc(text)}</button>`)
    .join('')}</div>`;
}

/** Segmented control used inside forms (handled locally, not by the global click handler). */
function formSeg(name, options, current, label) {
  return `<div class="seg" role="group" aria-label="${esc(label)}" data-seg="${name}">${options
    .map(([value, text]) => `<button type="button" data-value="${value}" aria-pressed="${value === current}">${esc(text)}</button>`)
    .join('')}</div>`;
}

function dueLabel(info) {
  if (!info) return '';
  const icon = info.level === 'overdue' ? ICON.alert : ICON.calendar;
  return `<span class="due ${info.level}">${icon}${esc(info.text)}</span>`;
}

function entryRow(e, showDate = false) {
  const cat = CAT[e.category] || CAT.other;
  const emoji = e.kind === 'spent' ? cat.emoji : SAVED_EMOJI;
  const title = e.note || (e.kind === 'spent' ? cat.name : 'Savings');
  const parts = [];
  if (e.note) parts.push(e.kind === 'spent' ? cat.name : 'Savings');
  if (showDate) parts.push(dayTitle(e.date));
  const sub = parts.join(' · ');
  return `<button class="row" data-action="edit-entry" data-id="${esc(e.id)}">
    <span class="emoji-badge ${e.kind}" aria-hidden="true">${emoji}</span>
    <span class="row-main"><span class="row-title">${esc(title)}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</span>
    <span class="row-amount">${e.kind === 'spent' ? '−' : '+'}${esc(money(e.amount))}</span>
  </button>`;
}

function debtRow(d) {
  const info = dueInfo(d);
  const color = directionColor(d.direction);
  const status = d.settled
    ? `<span class="row-sub">Settled${d.settledDate ? ` ${esc(shortDate(d.settledDate))}` : ''}</span>`
    : info ? dueLabel(info) : `<span class="row-sub">${d.kind === 'loan' ? 'Loan' : 'No due date'}</span>`;
  return `<button class="row" data-action="open-debt" data-id="${esc(d.id)}">
    <span class="emoji-badge ${d.direction}" aria-hidden="true">${debtEmoji(d)}</span>
    <span class="row-main">
      <span class="row-title">${esc(d.name)}</span>
      ${status}
      <span class="meter" style="--c:${color}" role="progressbar" aria-label="Paid back" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progressOf(d) * 100)}"><span style="width:${(progressOf(d) * 100).toFixed(1)}%"></span></span>
    </span>
    <span class="row-end"><span class="row-amount">${esc(money(remainingOf(d)))}</span><span class="row-sub">of ${esc(money(d.amount))}</span></span>
  </button>`;
}

function debtMiniRow(d) {
  return `<button class="row" data-action="open-debt" data-id="${esc(d.id)}">
    <span class="emoji-badge ${d.direction}" aria-hidden="true">${debtEmoji(d)}</span>
    <span class="row-main"><span class="row-title">${esc(d.name)}</span>${dueLabel(dueInfo(d))}</span>
    <span class="row-end"><span class="row-amount">${esc(money(remainingOf(d)))}</span><span class="row-sub">${d.direction === 'iOwe' ? 'to pay' : 'to get back'}</span></span>
  </button>`;
}

function storageNotice() {
  if (storageWorks) return '';
  return `<div class="notice" role="alert"><strong>This browser isn't saving your data.</strong> Private browsing or blocked website data can cause this. Open MoneyTrack in a normal Safari or Chrome window.</div>`;
}

// ---------- Today ----------

function renderToday(view) {
  const t = todayISO();
  const month = monthOf(t);
  const todays = state.entries.filter((e) => e.date === t);
  const monthly = state.entries.filter((e) => monthOf(e.date) === month && e.date <= t);
  const open = openDebts();
  const iOwe = open.filter((d) => d.direction === 'iOwe').reduce((s, d) => s + remainingOf(d), 0);
  const owed = open.filter((d) => d.direction === 'owedToMe').reduce((s, d) => s + remainingOf(d), 0);
  const upcoming = upcomingDebts();
  const urgent = urgentDebts();
  const recent = sortedEntries().slice(0, 5);
  const dayOfMonth = new Date().getDate();

  setHeader('Today', fmtDate(t, { weekday: 'long', day: 'numeric', month: 'long' }), addButton('add-menu', 'Add'));

  let banner = '';
  if (urgent.length) {
    const names = urgent.slice(0, 3).map((d) => `${d.name}: ${dueInfo(d).text.toLowerCase()}`).join(' · ');
    banner = `<button class="alert-banner" data-action="goto" data-arg="debts">
      <span class="lead">${ICON.alert}</span>
      <span class="grow"><strong>${urgent.length === 1 ? '1 payment needs attention' : `${urgent.length} payments need attention`}</strong><small>${esc(names)}</small></span>
      ${ICON.chevron}
    </button>`;
  }

  view.innerHTML = `
    ${storageNotice()}
    ${banner}
    <section class="card" aria-label="Today">
      <div class="tiles">
        ${tile('Spent today', sumKind(todays, 'spent'), 'var(--spent)', true)}
        ${tile('Saved today', sumKind(todays, 'saved'), 'var(--saved)', true)}
      </div>
      <div class="btn-row">
        <button class="btn btn-spent" data-action="add-entry" data-kind="spent">${ICON.minus}Spent</button>
        <button class="btn btn-saved" data-action="add-entry" data-kind="saved">${ICON.plus}Saved</button>
      </div>
    </section>

    <section class="card">
      ${cardHead('This month', 'Insights', 'goto', 'insights')}
      <div class="tiles">
        ${tile('Spent', sumKind(monthly, 'spent'), 'var(--spent)')}
        ${tile('Saved', sumKind(monthly, 'saved'), 'var(--saved)')}
      </div>
      <hr>
      <div class="tiles">
        ${tile('Avg spend / day', sumKind(monthly, 'spent') / dayOfMonth)}
        ${tile('Saved all-time', sumKind(state.entries, 'saved'))}
      </div>
    </section>

    <section class="card">
      ${cardHead('Debts & loans', 'Open', 'goto', 'debts')}
      <div class="tiles">
        ${tile('I owe', iOwe, 'var(--owe)')}
        ${tile('Owed to me', owed, 'var(--owed)')}
      </div>
      ${open.length ? '' : '<p class="muted small" style="margin-top:12px">Nothing open. Tap + to add a loan, money you borrowed, or money you lent.</p>'}
    </section>

    ${upcoming.length ? `<section class="card">${cardHead('Coming up')}<div class="rows">${upcoming.slice(0, 5).map(debtMiniRow).join('')}</div></section>` : ''}

    <section class="card">
      ${cardHead('Recent', recent.length ? 'See all' : '', 'goto', 'activity')}
      ${recent.length
        ? `<div class="rows">${recent.map((e) => entryRow(e, e.date !== t)).join('')}</div>`
        : '<p class="muted small">Nothing logged yet. Tap <b>Spent</b> or <b>Saved</b> above to add your first entry.</p>'}
    </section>`;
}

// ---------- Activity ----------

function renderActivity(view) {
  setHeader('Activity', '', addButton('add-menu', 'Add'));
  view.innerHTML = `
    <div class="toolbar">
      <input type="search" class="search" id="activitySearch" placeholder="Search notes or categories" aria-label="Search entries" value="${esc(ui.activitySearch)}" autocomplete="off">
      ${seg('activityFilter', [['all', 'All'], ['spent', 'Spent'], ['saved', 'Saved']], ui.activityFilter, 'Show')}
    </div>
    <div id="activityList" class="toolbar" style="gap:16px"></div>`;
  renderActivityList();
}

function renderActivityList() {
  const host = $('#activityList');
  if (!host) return;
  const q = ui.activitySearch.trim().toLowerCase();
  const list = sortedEntries().filter((e) => {
    if (ui.activityFilter !== 'all' && e.kind !== ui.activityFilter) return false;
    if (!q) return true;
    const cat = e.kind === 'spent' ? (CAT[e.category] || CAT.other).name : 'Savings';
    return e.note.toLowerCase().includes(q) || cat.toLowerCase().includes(q);
  });

  if (!list.length) {
    host.innerHTML = q || ui.activityFilter !== 'all'
      ? `<div class="empty"><span class="big-emoji">🔍</span><strong>No matches</strong>Try a different search or filter.</div>`
      : `<div class="empty"><span class="big-emoji">🧾</span><strong>No entries yet</strong>Log what you spend and save, and it shows up here.</div>`;
    return;
  }

  const groups = [];
  for (const e of list) {
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) last.items.push(e);
    else groups.push({ date: e.date, items: [e] });
  }
  host.innerHTML = groups.map((g) => {
    const spent = sumKind(g.items, 'spent');
    const saved = sumKind(g.items, 'saved');
    const totals = [spent ? `−${money(spent)}` : '', saved ? `+${money(saved)}` : ''].filter(Boolean).join('  ');
    return `<section class="list-group">
      <div class="group-head"><h2>${esc(dayTitle(g.date))}</h2><span>${esc(totals)}</span></div>
      <div class="card rows">${g.items.map((e) => entryRow(e)).join('')}</div>
    </section>`;
  }).join('');
}

// ---------- Debts ----------

function renderDebts(view) {
  setHeader('Debts', '', addButton('add-debt', 'Add debt or loan'));
  const dir = ui.debtDirection;
  const mine = state.debts.filter((d) => d.direction === dir);
  const open = mine.filter((d) => !d.settled).sort((a, b) => {
    const na = nextDue(a);
    const nb = nextDue(b);
    if (na && nb) return na < nb ? -1 : na > nb ? 1 : 0;
    if (na) return -1;
    if (nb) return 1;
    return a.name.localeCompare(b.name);
  });
  const settled = mine.filter((d) => d.settled).sort((a, b) => (b.settledDate || '').localeCompare(a.settledDate || ''));
  const total = open.reduce((s, d) => s + remainingOf(d), 0);

  const emptyText = dir === 'iOwe'
    ? "You don't owe anyone right now. Add a loan or money you borrowed."
    : 'Nobody owes you right now. Add money you lent someone.';

  view.innerHTML = `
    ${seg('debtDirection', [['iOwe', 'I owe'], ['owedToMe', 'Owed to me']], dir, 'Which debts')}
    <section class="card">
      <div class="tile-label"><span class="dot" style="background:${directionColor(dir)}"></span>${dir === 'iOwe' ? 'You owe in total' : 'Owed to you in total'}</div>
      <div class="hero-value">${esc(money(total))}</div>
      <div class="muted small">${open.length} open · ${settled.length} settled</div>
    </section>
    ${open.length
      ? `<div class="card rows">${open.map(debtRow).join('')}</div>`
      : `<section class="card"><p class="muted" style="margin-bottom:12px">${emptyText}</p><button class="btn btn-secondary" data-action="add-debt">${ICON.plus}${dir === 'iOwe' ? 'Add debt or loan' : 'Add money owed to me'}</button></section>`}
    ${settled.length
      ? `<details class="settled" id="settledList" ${ui.showSettled ? 'open' : ''}><summary>Settled (${settled.length})</summary><div class="card rows">${settled.map(debtRow).join('')}</div></details>`
      : ''}`;
}

// ---------- Insights ----------

function insightsData() {
  const t = todayISO();
  const range = ui.insightsRange;
  if (range === '6m') {
    const thisMonth = monthOf(t);
    const months = [];
    for (let i = 5; i >= 0; i -= 1) months.push(addMonths(thisMonth, -i));
    const first = `${months[0]}-01`;
    const entries = state.entries.filter((e) => e.date >= first && e.date <= t);
    const points = months.map((m) => {
      const list = entries.filter((e) => monthOf(e.date) === m);
      return { tick: monthName(m), title: monthName(m, 'long'), values: { spent: sumKind(list, 'spent'), saved: sumKind(list, 'saved') } };
    });
    return { entries, points, days: daysBetween(first, t) + 1, labelEvery: 1, unit: 'Month' };
  }
  const n = range === '30d' ? 30 : 7;
  const start = addDays(t, -(n - 1));
  const entries = state.entries.filter((e) => e.date >= start && e.date <= t);
  const points = [];
  for (let i = 0; i < n; i += 1) {
    const d = addDays(start, i);
    const list = entries.filter((e) => e.date === d);
    points.push({
      tick: n === 7 ? fmtDate(d, { weekday: 'short' }) : String(fromISO(d).getDate()),
      title: fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }),
      values: { spent: sumKind(list, 'spent'), saved: sumKind(list, 'saved') },
    });
  }
  return { entries, points, days: n, labelEvery: n === 7 ? 1 : 5, unit: 'Day' };
}

function renderInsights(view) {
  setHeader('Insights');
  const data = insightsData();
  const spent = sumKind(data.entries, 'spent');
  const saved = sumKind(data.entries, 'saved');
  const series = [
    { key: 'spent', label: 'Spent', color: 'var(--spent)' },
    { key: 'saved', label: 'Saved', color: 'var(--saved)' },
  ];

  const byCat = new Map();
  for (const e of data.entries) {
    if (e.kind !== 'spent') continue;
    byCat.set(e.category, (byCat.get(e.category) || 0) + e.amount);
  }
  const cats = [...byCat.entries()]
    .map(([id, value]) => ({ label: (CAT[id] || CAT.other).name, emoji: (CAT[id] || CAT.other).emoji, value }))
    .sort((a, b) => b.value - a.value);

  const toggle = (key) => `<button class="link-btn" data-action="toggle-table" data-arg="${key}">${ui.tableView[key] ? 'Show chart' : 'Show table'}</button>`;

  view.innerHTML = `
    <div class="filter-row">${seg('insightsRange', [['7d', '7 days'], ['30d', '30 days'], ['6m', '6 months']], ui.insightsRange, 'Time range')}</div>
    <section class="card">
      <div class="tiles three">
        ${tile('Spent', spent, 'var(--spent)')}
        ${tile('Saved', saved, 'var(--saved)')}
        ${tile('Avg / day', spent / data.days)}
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Spent vs saved</h2>${toggle('trend')}</div>
      <div id="trendChart"></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Where your money went</h2>${cats.length ? toggle('cats') : ''}</div>
      <div id="catChart"></div>
    </section>`;

  // Spent vs saved
  const trend = $('#trendChart');
  if (!spent && !saved) {
    trend.innerHTML = '<p class="empty-chart">Nothing logged in this period yet.</p>';
  } else if (ui.tableView.trend) {
    chartTable(trend, {
      columns: [data.unit, 'Spent', 'Saved'],
      rows: data.points.map((p) => [p.title, money(p.values.spent), money(p.values.saved)]),
    });
  } else {
    trend.before(legend(series));
    columnChart(trend, {
      points: data.points,
      series,
      format: money,
      formatAxis: (v) => (v >= 1000 ? moneyCompact(v) : Number.isInteger(v) ? moneyRound(v) : money(v)),
      labelEvery: data.labelEvery,
      ariaLabel: `Spent and saved per ${data.unit.toLowerCase()}. Tap a column for its amounts, or use Show table.`,
    });
  }

  // Categories
  const catHost = $('#catChart');
  if (!cats.length) {
    catHost.innerHTML = '<p class="empty-chart">No spending in this period yet.</p>';
  } else if (ui.tableView.cats) {
    chartTable(catHost, {
      columns: ['Category', 'Spent', 'Share'],
      rows: cats.map((c) => [`${c.emoji} ${c.label}`, money(c.value), `${Math.round((c.value / spent) * 100)}%`]),
    });
  } else {
    hBars(catHost, { items: cats, format: moneyRound, color: 'var(--spent)' });
  }
}

// ---------- Settings ----------

function renderSettings(view) {
  setHeader('Settings');
  const s = state.settings;
  const currencies = CURRENCIES.includes(s.currency) ? CURRENCIES : [s.currency, ...CURRENCIES];
  const currencyName = (code) => {
    try {
      return new Intl.DisplayNames(undefined, { type: 'currency' }).of(code);
    } catch {
      return code;
    }
  };
  const isEmpty = !state.entries.length && !state.debts.length;
  const canBadge = 'setAppBadge' in navigator && 'Notification' in window;
  let badgeRow = '';
  if (canBadge) {
    badgeRow = Notification.permission === 'granted'
      ? '<div class="field"><span>Count on app icon</span><span class="kv-value">On</span></div>'
      : Notification.permission === 'denied'
        ? '<div class="field"><span>Count on app icon</span><span class="kv-value">Blocked in phone settings</span></div>'
        : '<button class="list-btn" data-action="enable-badge">Show due count on the app icon</button>';
  }

  view.innerHTML = `
    ${storageNotice()}
    <section>
      <h2 class="group-title">General</h2>
      <div class="card form-list">
        <label class="field"><span>Currency</span>
          <select data-setting="currency">${currencies.map((c) => `<option value="${c}" ${c === s.currency ? 'selected' : ''}>${esc(c)} — ${esc(currencyName(c))}</option>`).join('')}</select>
        </label>
        <label class="field"><span>Appearance</span>
          <select data-setting="theme">
            <option value="system" ${s.theme === 'system' ? 'selected' : ''}>Automatic</option>
            <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option>
          </select>
        </label>
      </div>
    </section>

    <section>
      <h2 class="group-title">Due-date alerts</h2>
      <div class="card form-list">
        <label class="field"><span>Warn me ahead</span>
          <select data-setting="remindDays">
            ${[1, 3, 7, 14, 30].map((n) => `<option value="${n}" ${n === s.remindDays ? 'selected' : ''}>${n === 1 ? '1 day' : `${n} days`}</option>`).join('')}
          </select>
        </label>
        ${badgeRow}
      </div>
      <p class="footnote">Payments that are due soon or overdue show on the Today screen and on the Debts tab. For a phone alert even when MoneyTrack is closed, open a debt and tap <b>Add to Calendar</b> — your calendar reminds you at 9 am the day before and on the day.</p>
    </section>

    <section>
      <h2 class="group-title">Your data</h2>
      <div class="card form-list">
        <button class="list-btn" data-action="export-backup">Save a backup file</button>
        <label class="list-btn" for="importFile">Restore from a backup file</label>
        <input type="file" id="importFile" class="visually-hidden" accept="application/json,.json">
        <button class="list-btn" data-action="export-csv">Export to a spreadsheet (CSV)</button>
        ${isEmpty ? '<button class="list-btn" data-action="load-sample">Try it with sample data</button>' : ''}
        <button class="list-btn danger" data-action="erase">Erase all data</button>
      </div>
      <p class="footnote">Your money data is saved only on this device, in this browser. It is never uploaded — not even to GitHub. Save a backup now and then, and use it to move your data to another phone or computer.</p>
    </section>

    <section>
      <h2 class="group-title">Use it like an app</h2>
      <div class="card">
        <ol class="steps">
          <li>Open this page in <b>Safari</b> on your iPhone.</li>
          <li>Tap the <b>Share</b> button (square with an arrow).</li>
          <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
        </ol>
      </div>
    </section>
    <p class="footnote center">MoneyTrack ${APP_VERSION}</p>`;
}

// ---------- Sheets (pop-up forms) ----------

const sheet = $('#sheet');
let sheetStack = [];

function openSheet(builder) {
  sheetStack.push(builder);
  showTopSheet(true);
}

function showTopSheet(isNew = false) {
  const builder = sheetStack[sheetStack.length - 1];
  if (!builder) return;
  const scroller = $('.sheet-body', sheet);
  const keepScroll = !isNew && scroller ? scroller.scrollTop : 0;
  sheet.innerHTML = '';
  builder(sheet);
  if (!sheet.open) {
    sheet.showModal();
    document.documentElement.classList.add('sheet-open');
  }
  const body = $('.sheet-body', sheet);
  if (body) body.scrollTop = keepScroll;
  if (isNew) {
    const auto = $('[autofocus]', sheet);
    if (auto) auto.focus();
  }
}

function closeSheet() {
  sheetStack.pop();
  if (sheetStack.length) showTopSheet();
  else if (sheet.open) sheet.close();
}

function closeAllSheets() {
  sheetStack = [];
  if (sheet.open) sheet.close();
}

sheet.addEventListener('close', () => {
  sheetStack = [];
  sheet.innerHTML = '';
  document.documentElement.classList.remove('sheet-open');
});
sheet.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeSheet();
});
sheet.addEventListener('click', (e) => {
  if (e.target === sheet) closeSheet(); // tap on the dimmed background (larger screens)
});

function sheetHead(title, { save = '', cancel = 'Cancel', right = '' } = {}) {
  const end = save
    ? `<button type="submit" form="${save}" class="link-btn strong">Save</button>`
    : right || '<span></span>';
  return `<header class="sheet-head">
    <button type="button" class="link-btn" data-action="sheet-close">${esc(cancel)}</button>
    <h2 id="sheetTitle">${esc(title)}</h2>
    ${end}
  </header>`;
}

function amountField(value, autofocus) {
  return `<div class="amount-field">
      <span class="amount-cur" aria-hidden="true">${esc(currencySymbol())}</span>
      <input id="amt" name="amount" inputmode="decimal" enterkeyhint="done" placeholder="0" aria-label="Amount" autocomplete="off" value="${esc(value)}" ${autofocus ? 'autofocus' : ''}>
    </div>
    <p class="field-error" id="amtError" hidden></p>`;
}

function bindAmount(root) {
  const input = $('#amt', root);
  input.addEventListener('input', () => {
    const clean = sanitizeAmount(input.value);
    if (clean !== input.value) input.value = clean;
    $('#amtError', root).hidden = true;
  });
}

function showError(root, id, message) {
  const el = $(`#${id}`, root);
  el.textContent = message;
  el.hidden = false;
}

function bindFormSeg(root, name, onChange) {
  const group = $(`[data-seg="${name}"]`, root);
  if (!group) return;
  $$('button', group).forEach((b) => b.addEventListener('click', () => {
    $$('button', group).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    onChange(b.dataset.value);
  }));
}

// Add menu
function addMenuSheet() {
  openSheet((root) => {
    root.innerHTML = `${sheetHead('Add', { cancel: 'Close' })}
      <div class="sheet-body">
        <div class="choice-list">
          <button class="choice" data-action="add-entry" data-kind="spent" data-replace="1"><span class="emoji-badge spent" aria-hidden="true">💸</span><span><b>Spending</b><small>Money you spent</small></span></button>
          <button class="choice" data-action="add-entry" data-kind="saved" data-replace="1"><span class="emoji-badge saved" aria-hidden="true">💰</span><span><b>Saving</b><small>Money you put aside</small></span></button>
          <button class="choice" data-action="add-debt" data-replace="1"><span class="emoji-badge iOwe" aria-hidden="true">🤝</span><span><b>Debt or loan</b><small>Money you owe, or money someone owes you</small></span></button>
        </div>
      </div>`;
  });
}

// Spending / saving entry
function entrySheet(kind = 'spent', id = null) {
  const existing = id ? state.entries.find((e) => e.id === id) : null;
  const f = {
    kind: existing ? existing.kind : kind,
    category: existing && existing.kind === 'spent' ? existing.category : 'food',
    amount: existing ? String(existing.amount) : '',
    date: existing ? existing.date : todayISO(),
    note: existing ? existing.note : '',
  };
  const titleFor = () => (existing ? 'Edit entry' : f.kind === 'spent' ? 'New spending' : 'New saving');
  const notePlaceholder = () => (f.kind === 'spent' ? 'What was it for?' : 'e.g. Emergency fund');

  openSheet((root) => {
    root.innerHTML = `
      ${sheetHead(titleFor(), { save: 'entryForm' })}
      <form id="entryForm" class="sheet-body" novalidate autocomplete="off">
        ${formSeg('kind', [['spent', 'Spent'], ['saved', 'Saved']], f.kind, 'Type')}
        ${amountField(f.amount, !existing)}
        <section class="cat-section" ${f.kind === 'saved' ? 'hidden' : ''}>
          <h3 class="group-title">Category</h3>
          <div class="cat-grid">
            ${CATEGORIES.map((c) => `<button type="button" class="cat" data-cat="${c.id}" aria-pressed="${c.id === f.category}"><span class="cat-emoji" aria-hidden="true">${c.emoji}</span><span class="cat-name">${esc(c.name)}</span></button>`).join('')}
          </div>
        </section>
        <div class="card form-list">
          <label class="field"><span>Date</span><input type="date" name="date" value="${esc(f.date)}" required></label>
          <label class="field"><span>Note</span><input type="text" name="note" maxlength="80" value="${esc(f.note)}" placeholder="${esc(notePlaceholder())}"></label>
        </div>
        ${existing ? `<button type="button" class="btn btn-danger-outline" data-action="delete-entry" data-id="${esc(existing.id)}">${ICON.trash}Delete entry</button>` : ''}
      </form>`;

    const form = $('#entryForm', root);
    bindAmount(root);
    // Keep typed values if the sheet is redrawn.
    form.addEventListener('input', () => {
      f.amount = $('#amt', root).value;
      f.date = form.date.value || f.date;
      f.note = form.note.value;
    });
    bindFormSeg(root, 'kind', (value) => {
      f.kind = value;
      $('.cat-section', root).hidden = value === 'saved';
      $('#sheetTitle', root).textContent = titleFor();
      form.note.placeholder = notePlaceholder();
    });
    $$('.cat', root).forEach((b) => b.addEventListener('click', () => {
      f.category = b.dataset.cat;
      $$('.cat', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const amount = parseAmount($('#amt', root).value);
      if (!amount) {
        showError(root, 'amtError', 'Enter an amount above zero.');
        $('#amt', root).focus();
        return;
      }
      const record = {
        kind: f.kind,
        amount,
        date: form.date.value || todayISO(),
        category: f.kind === 'spent' ? f.category : 'other',
        note: form.note.value.trim().slice(0, 80),
      };
      if (existing) Object.assign(existing, record);
      else state.entries.push({ id: uid(), createdAt: Date.now(), ...record });
      closeSheet();
      commit(existing ? 'Entry updated' : `${f.kind === 'spent' ? 'Spent' : 'Saved'} ${money(amount)} — saved`);
    });
  });
}

// Debt / loan form
function debtSheet(id = null, direction = ui.debtDirection) {
  const existing = id ? findDebt(id) : null;
  const f = {
    direction: existing ? existing.direction : direction,
    kind: existing ? existing.kind : 'person',
    name: existing ? existing.name : '',
    amount: existing ? String(existing.amount) : '',
    startDate: existing ? existing.startDate : todayISO(),
    hasDue: existing ? Boolean(existing.dueDate) : false,
    dueDate: existing && existing.dueDate ? existing.dueDate : addDays(todayISO(), 7),
    monthly: existing ? existing.monthly : false,
    note: existing ? existing.note : '',
  };

  const labels = () => {
    const owedToMe = f.direction === 'owedToMe';
    const loan = !owedToMe && f.kind === 'loan';
    return {
      name: owedToMe ? 'Who owes you?' : loan ? 'Loan name' : 'Who do you owe?',
      namePh: loan ? 'e.g. Car loan' : 'Name',
      start: owedToMe ? 'Lent on' : loan ? 'Started on' : 'Borrowed on',
      amount: loan ? 'Loan amount' : 'Amount',
    };
  };

  openSheet((root) => {
    const l = labels();
    root.innerHTML = `
      ${sheetHead(existing ? 'Edit' : 'New debt or loan', { save: 'debtForm' })}
      <form id="debtForm" class="sheet-body" novalidate autocomplete="off">
        ${formSeg('direction', [['iOwe', 'I owe'], ['owedToMe', 'Owed to me']], f.direction, 'Direction')}
        <div class="kind-wrap" ${f.direction === 'owedToMe' ? 'hidden' : ''}>
          ${formSeg('kind', [['person', '👤 A person'], ['loan', '🏦 A loan / bank']], f.kind, 'Type')}
        </div>
        <div class="card form-list">
          <label class="field"><span id="nameLabel">${esc(l.name)}</span><input type="text" name="name" maxlength="60" value="${esc(f.name)}" placeholder="${esc(l.namePh)}" ${existing ? '' : 'autofocus'}></label>
        </div>
        <p class="field-error" id="nameError" hidden></p>
        <h3 class="group-title" id="amountLabel" style="margin-bottom:-8px">${esc(l.amount)}</h3>
        ${amountField(f.amount, false)}
        <div class="card form-list">
          <label class="field"><span id="startLabel">${esc(l.start)}</span><input type="date" name="startDate" value="${esc(f.startDate)}"></label>
          <label class="field"><span>Has a due date</span><input type="checkbox" role="switch" name="hasDue" ${f.hasDue ? 'checked' : ''}></label>
          <label class="field due-only" ${f.hasDue ? '' : 'hidden'}><span>Due date</span><input type="date" name="dueDate" value="${esc(f.dueDate)}"></label>
          <label class="field due-only" ${f.hasDue ? '' : 'hidden'}><span>Repeats every month</span><input type="checkbox" role="switch" name="monthly" ${f.monthly ? 'checked' : ''}></label>
          <label class="field"><span>Note</span><input type="text" name="note" maxlength="120" value="${esc(f.note)}" placeholder="Optional"></label>
        </div>
      </form>`;

    const form = $('#debtForm', root);
    bindAmount(root);
    const relabel = () => {
      const nl = labels();
      $('#nameLabel', root).textContent = nl.name;
      form.name.placeholder = nl.namePh;
      $('#startLabel', root).textContent = nl.start;
      $('#amountLabel', root).textContent = nl.amount;
      $('.kind-wrap', root).hidden = f.direction === 'owedToMe';
    };
    form.addEventListener('input', () => {
      f.name = form.name.value;
      f.amount = $('#amt', root).value;
      f.startDate = form.startDate.value || f.startDate;
      f.dueDate = form.dueDate.value || f.dueDate;
      f.note = form.note.value;
      $('#nameError', root).hidden = true;
    });
    form.hasDue.addEventListener('change', () => {
      f.hasDue = form.hasDue.checked;
      $$('.due-only', root).forEach((x) => { x.hidden = !f.hasDue; });
    });
    form.monthly.addEventListener('change', () => { f.monthly = form.monthly.checked; });
    bindFormSeg(root, 'direction', (v) => { f.direction = v; relabel(); });
    bindFormSeg(root, 'kind', (v) => { f.kind = v; relabel(); });

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = form.name.value.trim();
      const amount = parseAmount($('#amt', root).value);
      if (!name) {
        showError(root, 'nameError', 'Add a name so you know who this is.');
        form.name.focus();
        return;
      }
      if (!amount) {
        showError(root, 'amtError', 'Enter an amount above zero.');
        $('#amt', root).focus();
        return;
      }
      const hasDue = form.hasDue.checked && Boolean(form.dueDate.value);
      const record = {
        name: name.slice(0, 60),
        direction: f.direction,
        kind: f.direction === 'owedToMe' ? 'person' : f.kind,
        amount,
        startDate: form.startDate.value || todayISO(),
        dueDate: hasDue ? form.dueDate.value : null,
        monthly: hasDue && form.monthly.checked,
        note: form.note.value.trim().slice(0, 120),
      };
      if (existing) {
        Object.assign(existing, record);
        if (existing.settled && remainingOf(existing) > 0) {
          existing.settled = false;
          existing.settledDate = null;
        }
      } else {
        state.debts.push({ id: uid(), createdAt: Date.now(), settled: false, settledDate: null, payments: [], ...record });
        ui.debtDirection = record.direction;
      }
      closeSheet();
      commit(existing ? 'Changes saved' : `${record.name} added`);
    });
  });
}

// Debt details
function debtDetailSheet(id) {
  openSheet((root) => {
    const d = findDebt(id);
    if (!d) {
      root.innerHTML = `${sheetHead('Not found', { cancel: 'Close' })}<div class="sheet-body"><p class="muted">This item was deleted.</p></div>`;
      return;
    }
    const info = dueInfo(d);
    const color = directionColor(d.direction);
    const payments = [...d.payments].sort((a, b) => (a.date < b.date ? 1 : -1));
    const label = d.settled ? 'Settled' : d.direction === 'iOwe' ? 'You still owe' : 'Still owed to you';
    const typeText = d.direction === 'owedToMe' ? 'Someone owes me' : d.kind === 'loan' ? 'Loan I am paying off' : 'I owe a person';
    const kv = (k, v) => `<div class="field"><span>${esc(k)}</span><span class="kv-value">${esc(v)}</span></div>`;

    root.innerHTML = `
      ${sheetHead(d.name, { cancel: 'Done', right: `<button type="button" class="link-btn" data-action="edit-debt" data-id="${esc(d.id)}">Edit</button>` })}
      <div class="sheet-body">
        <section class="card">
          <div class="tile-label"><span class="dot" style="background:${color}"></span>${esc(label)}</div>
          <div class="hero-value">${esc(money(remainingOf(d)))}</div>
          <span class="meter big" style="--c:${color}" role="progressbar" aria-label="Paid back" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progressOf(d) * 100)}"><span style="width:${(progressOf(d) * 100).toFixed(1)}%"></span></span>
          <div class="split small muted"><span>${d.direction === 'iOwe' ? 'Paid' : 'Received'} ${esc(money(paidOf(d)))}</span><span>Total ${esc(money(d.amount))}</span></div>
          ${info ? `<div style="margin-top:10px">${dueLabel(info)}</div>` : ''}
        </section>

        <div class="btn-stack">
          ${d.settled ? '' : `<button class="btn btn-primary" data-action="add-payment" data-id="${esc(d.id)}">${ICON.plus}${d.direction === 'iOwe' ? 'Record a payment' : 'Record money received'}</button>`}
          ${d.dueDate && !d.settled ? `<button class="btn btn-secondary" data-action="calendar" data-id="${esc(d.id)}">${ICON.calendar}Add to Calendar</button>` : ''}
          <button class="btn btn-secondary" data-action="${d.settled ? 'reopen' : 'settle'}" data-id="${esc(d.id)}">${ICON.check}${d.settled ? 'Reopen' : 'Mark as fully paid'}</button>
        </div>

        <section>
          <h3 class="group-title">Details</h3>
          <div class="card form-list">
            ${kv('Type', typeText)}
            ${kv(d.direction === 'owedToMe' ? 'Lent on' : 'Started', longDate(d.startDate))}
            ${d.dueDate ? kv(d.monthly ? 'Next due' : 'Due', longDate(nextDue(d) || d.dueDate)) : ''}
            ${d.monthly ? kv('Repeats', 'Every month') : ''}
            ${d.note ? kv('Note', d.note) : ''}
          </div>
        </section>

        <section>
          <h3 class="group-title">${d.direction === 'iOwe' ? 'Payments' : 'Money received'}</h3>
          ${payments.length
            ? `<div class="card rows">${payments.map((p) => `<div class="row static">
                <span class="row-main"><span class="row-title">${esc(money(p.amount))}</span><span class="row-sub">${esc(longDate(p.date))}${p.note ? ` · ${esc(p.note)}` : ''}</span></span>
                <button type="button" class="icon-btn subtle" data-action="delete-payment" data-id="${esc(d.id)}" data-pid="${esc(p.id)}" aria-label="Delete this payment">${ICON.trash}</button>
              </div>`).join('')}</div>`
            : '<p class="muted small" style="padding:0 4px">Nothing recorded yet.</p>'}
        </section>

        <button type="button" class="btn btn-danger-outline" data-action="delete-debt" data-id="${esc(d.id)}">${ICON.trash}Delete</button>
      </div>`;
  });
}

// Payment form
function paymentSheet(id) {
  const f = { amount: '', date: todayISO(), note: '' };
  openSheet((root) => {
    const d = findDebt(id);
    if (!d) { root.innerHTML = ''; return; }
    const rem = remainingOf(d);
    const question = d.direction === 'owedToMe'
      ? `How much did ${d.name} give back?`
      : d.kind === 'loan' ? `How much did you pay toward ${d.name}?` : `How much did you pay ${d.name}?`;
    root.innerHTML = `
      ${sheetHead(d.direction === 'iOwe' ? 'Record payment' : 'Money received', { save: 'payForm' })}
      <form id="payForm" class="sheet-body" novalidate autocomplete="off">
        <p class="muted small" style="padding:0 4px">${esc(question)} Remaining: <b>${esc(money(rem))}</b></p>
        ${amountField(f.amount, true)}
        ${rem > 0 ? `<button type="button" class="chip" id="fillFull">Full amount · ${esc(money(rem))}</button>` : ''}
        <div class="card form-list">
          <label class="field"><span>Date</span><input type="date" name="date" value="${esc(f.date)}"></label>
          <label class="field"><span>Note</span><input type="text" name="note" maxlength="80" value="${esc(f.note)}" placeholder="Optional"></label>
        </div>
      </form>`;
    const form = $('#payForm', root);
    bindAmount(root);
    form.addEventListener('input', () => {
      f.amount = $('#amt', root).value;
      f.date = form.date.value || f.date;
      f.note = form.note.value;
    });
    const full = $('#fillFull', root);
    if (full) full.addEventListener('click', () => {
      $('#amt', root).value = String(rem);
      f.amount = String(rem);
      $('#amtError', root).hidden = true;
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const amount = parseAmount($('#amt', root).value);
      if (!amount) {
        showError(root, 'amtError', 'Enter an amount above zero.');
        return;
      }
      d.payments.push({ id: uid(), amount, date: form.date.value || todayISO(), note: form.note.value.trim().slice(0, 80) });
      let message = `${money(amount)} recorded`;
      if (remainingOf(d) <= 0) {
        d.settled = true;
        d.settledDate = todayISO();
        message = `${d.name} is fully paid 🎉`;
      }
      closeSheet();
      commit(message);
    });
  });
}

// ---------- Files: backup, CSV, calendar ----------

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function shareOrDownload(filename, content, type) {
  const blob = new Blob([content], { type });
  if (isIOS() && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportBackup() {
  const data = JSON.stringify({ app: 'MoneyTrack', exportedAt: new Date().toISOString(), ...state }, null, 2);
  shareOrDownload(`moneytrack-backup-${todayISO()}.json`, data, 'application/json');
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCSV() {
  const rows = [['Date', 'Type', 'Category', 'Amount', 'Currency', 'Note']];
  for (const e of sortedEntries()) {
    rows.push([e.date, e.kind === 'spent' ? 'Spent' : 'Saved', e.kind === 'spent' ? (CAT[e.category] || CAT.other).name : 'Savings', e.amount.toFixed(2), state.settings.currency, e.note]);
  }
  rows.push([]);
  rows.push(['Debts & loans']);
  rows.push(['Name', 'Direction', 'Type', 'Total', 'Paid', 'Remaining', 'Due date', 'Monthly', 'Settled', 'Note']);
  for (const d of state.debts) {
    rows.push([
      d.name, d.direction === 'iOwe' ? 'I owe' : 'Owed to me', d.kind === 'loan' ? 'Loan' : 'Person',
      d.amount.toFixed(2), paidOf(d).toFixed(2), remainingOf(d).toFixed(2), d.dueDate || '', d.monthly ? 'Yes' : 'No', d.settled ? 'Yes' : 'No', d.note,
    ]);
  }
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  shareOrDownload(`moneytrack-${todayISO()}.csv`, `\uFEFF${csv}`, 'text/csv');
}

async function importBackup(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || (!Array.isArray(parsed.entries) && !Array.isArray(parsed.debts))) throw new Error('not a backup');
    const data = normalise(parsed);
    const ok = confirm(`Replace everything on this device with this backup?\n\n${data.entries.length} entries and ${data.debts.length} debts will be restored.`);
    if (!ok) return;
    state = data;
    fmtCache.clear();
    applyTheme();
    commit('Backup restored');
  } catch {
    toast("That file isn't a MoneyTrack backup");
  }
}

function icsText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function addToCalendar(d) {
  const start = d.monthly ? nextDue(d) : d.dueDate;
  if (!start) return;
  const ymd = (iso) => iso.replace(/-/g, '');
  const amount = money(remainingOf(d));
  const summary = d.direction === 'owedToMe'
    ? `${d.name} owes you ${amount}`
    : d.kind === 'loan' ? `${d.name} repayment due` : `Pay back ${d.name} (${amount})`;
  const description = `${summary}. From MoneyTrack.${d.note ? ` Note: ${d.note}` : ''}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = Number(start.slice(8, 10));
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MoneyTrack//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${d.id}@moneytrack`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(start)}`,
    `DTEND;VALUE=DATE:${ymd(addDays(start, 1))}`,
    `SUMMARY:${icsText(summary)}`,
    `DESCRIPTION:${icsText(description)}`,
    ...(d.monthly ? [day >= 29 ? 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1' : 'RRULE:FREQ=MONTHLY'] : []),
    // All-day event: -15h = 9 am the day before; +9h = 9 am on the day.
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(summary)}`, 'TRIGGER:-PT15H', 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(summary)}`, 'TRIGGER:PT9H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  const ics = lines.join('\r\n');
  const filename = `${d.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'payment'}-due.ics`;
  if (isIOS()) {
    // Safari on iPhone opens calendar files with an "Add to Calendar" screen.
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else {
    shareOrDownload(filename, ics, 'text/calendar');
  }
}

// ---------- Actions ----------

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  const { action, id, kind, arg } = btn.dataset;
  switch (action) {
    case 'goto':
      location.hash = arg;
      break;
    case 'seg':
      ui[btn.dataset.name] = btn.dataset.value;
      render();
      break;
    case 'toggle-table':
      ui.tableView[arg] = !ui.tableView[arg];
      render();
      break;
    case 'add-menu':
      addMenuSheet();
      break;
    case 'add-entry':
      if (btn.dataset.replace) sheetStack.pop();
      entrySheet(kind || 'spent');
      break;
    case 'edit-entry':
      entrySheet(undefined, id);
      break;
    case 'delete-entry':
      if (confirm('Delete this entry?')) {
        state.entries = state.entries.filter((e) => e.id !== id);
        closeSheet();
        commit('Entry deleted');
      }
      break;
    case 'add-debt':
      if (btn.dataset.replace) sheetStack.pop();
      debtSheet(null, ui.debtDirection);
      break;
    case 'open-debt':
      debtDetailSheet(id);
      break;
    case 'edit-debt':
      debtSheet(id);
      break;
    case 'add-payment':
      paymentSheet(id);
      break;
    case 'settle': {
      const d = findDebt(id);
      if (!d) break;
      const rem = remainingOf(d);
      if (rem > 0 && !confirm(`Mark as fully paid?\n\nThis records the remaining ${money(rem)} as paid today.`)) break;
      if (rem > 0) d.payments.push({ id: uid(), amount: rem, date: todayISO(), note: 'Settled in full' });
      d.settled = true;
      d.settledDate = todayISO();
      commit(`${d.name} marked as paid`);
      break;
    }
    case 'reopen': {
      const d = findDebt(id);
      if (!d) break;
      d.settled = false;
      d.settledDate = null;
      commit('Reopened');
      break;
    }
    case 'delete-payment': {
      const d = findDebt(id);
      if (!d || !confirm('Delete this payment?')) break;
      d.payments = d.payments.filter((p) => p.id !== btn.dataset.pid);
      if (d.settled && remainingOf(d) > 0) {
        d.settled = false;
        d.settledDate = null;
      }
      commit('Payment deleted');
      break;
    }
    case 'delete-debt': {
      const d = findDebt(id);
      if (!d || !confirm(`Delete ${d.name}?\n\nIts payment history is deleted too.`)) break;
      state.debts = state.debts.filter((x) => x.id !== id);
      closeAllSheets();
      commit('Deleted');
      break;
    }
    case 'calendar': {
      const d = findDebt(id);
      if (d) addToCalendar(d);
      break;
    }
    case 'sheet-close':
      closeSheet();
      break;
    case 'export-backup':
      exportBackup();
      break;
    case 'export-csv':
      exportCSV();
      break;
    case 'load-sample':
      state = sampleState(state.settings.currency);
      commit('Sample data added — erase it any time in Settings');
      break;
    case 'erase':
      if (confirm('Erase all your entries and debts on this device?\n\nThis cannot be undone. Save a backup first if you might need it.')) {
        state = { ...state, entries: [], debts: [] };
        commit('All data erased');
      }
      break;
    case 'enable-badge':
      if ('Notification' in window) {
        Notification.requestPermission().then(() => render());
      }
      break;
    default:
      break;
  }
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'activitySearch') {
    ui.activitySearch = ev.target.value;
    renderActivityList();
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset && t.dataset.setting) {
    const key = t.dataset.setting;
    state.settings[key] = key === 'remindDays' ? Number(t.value) : t.value;
    if (key === 'currency') fmtCache.clear();
    if (key === 'theme') applyTheme();
    commit('Saved');
  } else if (t.id === 'importFile' && t.files && t.files[0]) {
    importBackup(t.files[0]);
    t.value = '';
  }
});

// <details> "toggle" doesn't bubble, so listen in the capture phase.
document.addEventListener('toggle', (ev) => {
  if (ev.target.id === 'settledList') ui.showSettled = ev.target.open;
}, true);

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});

// Another tab (e.g. on the Mac) changed the data — pick it up.
window.addEventListener('storage', (ev) => {
  if (ev.key === STORAGE_KEY) {
    state = loadState();
    fmtCache.clear();
    applyTheme();
    render();
  }
});

// Coming back to the app (maybe on a new day) — refresh dates and alerts.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') render();
});

let lastWidth = window.innerWidth;
let resizeTimer;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastWidth) return;
  lastWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (currentTab() === 'insights') render();
  }, 150);
});

// Tap outside a chart hides its tooltip (touch screens).
document.addEventListener('pointerdown', (ev) => {
  if (!ev.target.closest('.chart')) {
    $$('.chart-tip').forEach((t) => { t.hidden = true; });
    $$('.hover-band').forEach((b) => b.setAttribute('opacity', 0));
  }
});

// ---------- Start ----------

applyTheme();
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline mode unavailable', err));
  });
}
