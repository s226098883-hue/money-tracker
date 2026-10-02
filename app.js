// MoneyTrack — main app: screens, forms and actions.
import {
  STORAGE_KEY, APP_VERSION, SAVED_EMOJI, CURRENCIES,
  loadState, saveState, normalise, askForPersistentStorage, sampleState, storageWorks,
  uid, esc, round2, sanitizeAmount, parseAmount,
  todayISO, fromISO, addDays, daysBetween, monthOf, addMonths, weekStart,
  paidOf, remainingOf, progressOf, nextDue, dueInfo,
} from './store.js';
import { columnChart, chartTable } from './charts.js';

let state = loadState();

const ui = {
  search: '',
  debtDirection: 'iOwe',
  insightsRange: '7d',
  tableView: { daily: false, weekly: false, monthly: false },
  showSettled: false,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ICON = {
  plus: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  chevron: '<svg class="ic chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  alert: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17.5v.01"/></svg>',
  calendar: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  check: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  clock: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  trash: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/></svg>',
};

// ---------- Money & date formatting ----------

const fmtCache = new Map();
function nf(name, opts) {
  const key = `${state.settings.currency}|${name}`;
  if (!fmtCache.has(key)) {
    const base = { style: 'currency', currency: state.settings.currency, ...opts };
    let f;
    try {
      // "narrowSymbol" shows $ instead of A$ for Australian dollars.
      f = new Intl.NumberFormat(undefined, { ...base, currencyDisplay: 'narrowSymbol' });
    } catch {
      try {
        f = new Intl.NumberFormat(undefined, base);
      } catch {
        f = new Intl.NumberFormat(undefined, { ...base, currency: 'AUD' });
      }
    }
    fmtCache.set(key, f);
  }
  return fmtCache.get(key);
}
const money = (v) => nf('full', {}).format(v);
const moneyRound = (v) => nf('round', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
const moneyCompact = (v) => nf('compact', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const formatAxis = (v) => (v >= 1000 ? moneyCompact(v) : Number.isInteger(v) ? moneyRound(v) : money(v));
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

// ---------- Data helpers ----------

/** Only savings are tracked now (older spending entries stay in the data but are not shown). */
const savings = () => state.entries.filter((e) => e.kind === 'saved');
const sumSaved = (list) => round2(list.reduce((s, e) => s + e.amount, 0));
const savedBetween = (from, to) => sumSaved(savings().filter((e) => e.date >= from && e.date <= to));
const findDebt = (id) => state.debts.find((d) => d.id === id);
const debtEmoji = (d) => (d.kind === 'loan' ? '🏦' : '👤');
const directionColor = (dir) => (dir === 'iOwe' ? 'var(--owe)' : 'var(--owed)');

function sortedSavings() {
  return savings().sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
}

function openDebts() {
  return state.debts.filter((d) => !d.settled);
}

function byDueDate(a, b) {
  const na = nextDue(a);
  const nb = nextDue(b);
  if (na && nb) return na < nb ? -1 : na > nb ? 1 : 0;
  if (na) return -1;
  if (nb) return 1;
  return a.name.localeCompare(b.name);
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

/** Everything the savings-goal panel needs. */
function goalProgress() {
  const g = state.goal;
  if (!g) return null;
  const t = todayISO();
  const saved = round2(g.alreadySaved + sumSaved(savings().filter((e) => e.date >= g.startDate)));
  const remaining = Math.max(0, round2(g.target - saved));
  const pct = g.target > 0 ? Math.min(1, saved / g.target) : 0;
  const daysLeft = daysBetween(t, g.dueDate);
  const weeksLeft = Math.max(1, Math.ceil((daysLeft + 1) / 7));
  const perWeek = remaining / weeksLeft;
  const totalDays = Math.max(1, daysBetween(g.startDate, g.dueDate));
  const elapsed = Math.min(totalDays, Math.max(0, daysBetween(g.startDate, t)));
  const expected = g.target * (elapsed / totalDays);
  const reached = remaining <= 0;
  let status;
  if (reached) status = { level: 'good', icon: ICON.check, text: 'Goal reached — well done!' };
  else if (daysLeft < 0) status = { level: 'overdue', icon: ICON.alert, text: `Target date passed ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago` };
  else if (saved + 0.005 >= expected) status = { level: 'good', icon: ICON.check, text: 'On track' };
  else status = { level: 'behind', icon: ICON.clock, text: `Behind plan by ${money(expected - saved)}` };
  return { g, saved, remaining, pct, daysLeft, perWeek, reached, status };
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

// ---------- Navigation (with a Back button) ----------

const TABS = ['today', 'savings', 'debts', 'insights', 'settings'];
const TAB_NAMES = { today: 'Today', savings: 'Savings', debts: 'Debts', insights: 'Insights', settings: 'Settings' };
const currentTab = () => {
  const h = location.hash.replace('#', '');
  if (h === 'activity') return 'savings';
  return TABS.includes(h) ? h : 'today';
};

function navigate(tab) {
  if (!TABS.includes(tab) || tab === currentTab()) return;
  const depth = (history.state && history.state.depth) || 0;
  history.pushState({ depth: depth + 1, from: currentTab() }, '', `#${tab}`);
  render();
  window.scrollTo(0, 0);
}

function goBack() {
  if (history.state && history.state.depth > 0) history.back();
  else navigate('today');
}

function backButton() {
  if (currentTab() === 'today') return '';
  const st = history.state;
  const label = st && st.depth > 0 ? TAB_NAMES[st.from] || 'Back' : 'Today';
  return `<button type="button" class="back-btn" data-action="back">${ICON.back}<span>${esc(label)}</span></button>`;
}

function render() {
  const tab = currentTab();
  $$('.tabbar a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const view = $('#view');
  if (tab === 'today') renderToday(view);
  else if (tab === 'savings') renderSavings(view);
  else if (tab === 'debts') renderDebts(view);
  else if (tab === 'insights') renderInsights(view);
  else renderSettings(view);
  $('#backSlot').innerHTML = backButton();
  updateBadges();
  animateBars();
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
  return textTile(label, money(amount), color, big);
}

function textTile(label, value, color = '', big = false) {
  return `<div class="tile${big ? ' big' : ''}">
    <div class="tile-label">${color ? `<span class="dot" style="background:${color}"></span>` : ''}${esc(label)}</div>
    <div class="tile-value">${esc(value)}</div>
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
  const title = e.note || 'Savings';
  const sub = showDate ? dayTitle(e.date) : '';
  return `<button class="row" data-action="edit-entry" data-id="${esc(e.id)}">
    <span class="emoji-badge saved" aria-hidden="true">${SAVED_EMOJI}</span>
    <span class="row-main"><span class="row-title">${esc(title)}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</span>
    <span class="row-amount">+${esc(money(e.amount))}</span>
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
  const info = dueInfo(d);
  return `<button class="row" data-action="open-debt" data-id="${esc(d.id)}">
    <span class="emoji-badge ${d.direction}" aria-hidden="true">${debtEmoji(d)}</span>
    <span class="row-main"><span class="row-title">${esc(d.name)}</span>${info ? dueLabel(info) : '<span class="row-sub">No due date</span>'}</span>
    <span class="row-end"><span class="row-amount">${esc(money(remainingOf(d)))}</span><span class="row-sub">${d.direction === 'iOwe' ? 'to pay' : 'to get back'}</span></span>
  </button>`;
}

function storageNotice() {
  if (storageWorks) return '';
  return `<div class="notice" role="alert"><strong>This browser isn't saving your data.</strong> Private browsing or blocked website data can cause this. Open MoneyTrack in a normal Safari or Chrome window.</div>`;
}

// Progress bars grow from where they were to the new value (the "loading" feel).
const lastBarWidth = new Map();
function animateBars() {
  const bars = $$('[data-fill]');
  if (!bars.length) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const el of bars) {
      el.style.width = el.dataset.fill;
      lastBarWidth.set(el.dataset.key, el.dataset.fill);
    }
  }));
}

function goalCard() {
  const p = goalProgress();
  if (!p) {
    return `<section class="card goal-card">
      <div class="goal-empty">
        <span class="emoji-badge saved" aria-hidden="true">🎯</span>
        <span><strong>Set a savings goal</strong><small>Choose a target and a date, then watch the bar fill up as you save.</small></span>
      </div>
      <button class="btn btn-saved" data-action="edit-goal">${ICON.plus}Set a goal</button>
    </section>`;
  }
  const { g, saved, remaining, pct, daysLeft, perWeek, reached, status } = p;
  const pctText = `${Math.floor(pct * 100)}%`;
  const width = `${(pct * 100).toFixed(1)}%`;
  const start = lastBarWidth.get('goal') || '0%';
  let when;
  if (reached) when = longDate(g.dueDate);
  else if (daysLeft > 1) when = `${daysLeft} days left`;
  else if (daysLeft === 1) when = '1 day left';
  else if (daysLeft === 0) when = 'Due today';
  else when = 'Date passed';
  return `<section class="card goal-card" aria-label="Savings goal">
    <div class="card-head"><h2>🎯 ${esc(g.name || 'Savings goal')}</h2><button class="link-btn" data-action="edit-goal">Edit</button></div>
    <div class="goal-amounts"><span class="goal-saved">${esc(money(saved))}</span><span class="muted">saved of ${esc(money(g.target))}</span></div>
    <div class="goal-progress">
      <div class="goal-bar" role="progressbar" aria-label="Goal progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct * 100)}">
        <span data-fill="${width}" data-key="goal" style="width:${start}"></span>
      </div>
      <span class="goal-pct">${pctText}</span>
    </div>
    <div class="goal-facts">
      ${reached ? textTile('Target', money(g.target)) : textTile('Still needed', money(remaining))}
      ${textTile(`By ${shortDate(g.dueDate)}`, when)}
      ${reached || daysLeft < 0 ? '' : textTile('Per week', money(perWeek))}
    </div>
    <p class="goal-status ${status.level}">${status.icon}${esc(status.text)}</p>
  </section>`;
}

function debtGroup(title, list) {
  if (!list.length) return '';
  const shown = list.slice(0, 5);
  const more = list.length - shown.length;
  return `<h3 class="mini-title">${esc(title)}</h3>
    <div class="rows">${shown.map(debtMiniRow).join('')}</div>
    ${more > 0 ? `<button class="link-btn" data-action="goto" data-arg="debts">See ${more} more</button>` : ''}`;
}

// ---------- Today ----------

function renderToday(view) {
  const t = todayISO();
  const wk = weekStart(t);
  const all = savings();
  const todaySaved = savedBetween(t, t);
  const weekSaved = savedBetween(wk, t);
  const daysSoFar = daysBetween(wk, t) + 1;
  const monthSaved = savedBetween(`${monthOf(t)}-01`, t);
  const open = openDebts().sort(byDueDate);
  const iOweList = open.filter((d) => d.direction === 'iOwe');
  const owedList = open.filter((d) => d.direction === 'owedToMe');
  const iOwe = iOweList.reduce((s, d) => s + remainingOf(d), 0);
  const owed = owedList.reduce((s, d) => s + remainingOf(d), 0);
  const upcoming = upcomingDebts();
  const recent = sortedSavings().slice(0, 5);

  setHeader('Today', fmtDate(t, { weekday: 'long', day: 'numeric', month: 'long' }), addButton('add-menu', 'Add'));

  let banner = '';
  if (upcoming.length) {
    const overdue = upcoming.filter((d) => dueInfo(d).days < 0).length;
    const names = upcoming.slice(0, 3).map((d) => `${d.name}: ${dueInfo(d).text.toLowerCase()}`).join(' · ');
    const title = overdue
      ? `${upcoming.length === 1 ? '1 payment needs' : `${upcoming.length} payments need`} attention`
      : `${upcoming.length === 1 ? '1 payment' : `${upcoming.length} payments`} due soon`;
    banner = `<button class="alert-banner${overdue ? '' : ' soon'}" data-action="goto" data-arg="debts">
      <span class="lead">${ICON.alert}</span>
      <span class="grow"><strong>${esc(title)}</strong><small>${esc(names)}</small></span>
      ${ICON.chevron}
    </button>`;
  }

  view.innerHTML = `
    ${storageNotice()}
    ${goalCard()}
    ${banner}
    <section class="card" aria-label="Today">
      <div class="tiles">
        ${tile('Saved today', todaySaved, 'var(--saved)', true)}
        ${tile('Saved all-time', sumSaved(all), '', true)}
      </div>
      <div class="btn-row">
        <button class="btn btn-saved" data-action="add-entry">${ICON.plus}Add saving</button>
        <button class="btn btn-secondary" data-action="add-debt">${ICON.plus}Debt / loan</button>
      </div>
    </section>

    <section class="card">
      ${cardHead(`This week · ${shortDate(wk)} – ${shortDate(addDays(wk, 6))}`, 'Insights', 'goto', 'insights')}
      <div class="tiles">
        ${tile('Saved this week', weekSaved, 'var(--saved)')}
        ${tile('Average a day', weekSaved / daysSoFar)}
      </div>
      <div id="weekChart" class="week-chart"></div>
      <hr>
      <div class="tiles">
        ${tile('Saved this month', monthSaved)}
        ${textTile('Days saved', `${new Set(all.filter((e) => e.date >= wk && e.date <= t).map((e) => e.date)).size} of ${daysSoFar}`)}
      </div>
    </section>

    <section class="card">
      ${cardHead('Debts & loans', 'Open', 'goto', 'debts')}
      <div class="tiles">
        ${tile('I owe', iOwe, 'var(--owe)')}
        ${tile('Owed to me', owed, 'var(--owed)')}
      </div>
      ${open.length
        ? `${debtGroup('I need to pay', iOweList)}${debtGroup('Owes me', owedList)}`
        : '<p class="muted small" style="margin-top:12px">Nothing open. Tap + to add a loan, money you borrowed, or money you lent.</p>'}
    </section>

    <section class="card">
      ${cardHead('Recent savings', recent.length ? 'See all' : '', 'goto', 'savings')}
      ${recent.length
        ? `<div class="rows">${recent.map((e) => entryRow(e, true)).join('')}</div>`
        : '<p class="muted small">Nothing saved yet. Tap <b>Add saving</b> above to log your first one.</p>'}
    </section>`;

  // Mon–Sun mini chart for this week.
  const points = [];
  for (let i = 0; i < 7; i += 1) {
    const d = addDays(wk, i);
    points.push({
      tick: fmtDate(d, { weekday: 'narrow' }),
      title: fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short' }) + (d > t ? ' (coming up)' : ''),
      values: { saved: d > t ? 0 : savedBetween(d, d) },
    });
  }
  columnChart($('#weekChart'), {
    points,
    series: [{ key: 'saved', label: 'Saved', color: 'var(--saved)' }],
    format: money,
    formatAxis,
    plotHeight: 90,
    ariaLabel: 'Saved each day this week. Tap a day for its amount.',
  });
}

// ---------- Savings list ----------

function renderSavings(view) {
  setHeader('Savings', '', addButton('add-entry', 'Add saving'));
  view.innerHTML = `
    <div class="toolbar">
      <input type="search" class="search" id="savingsSearch" placeholder="Search notes" aria-label="Search savings" value="${esc(ui.search)}" autocomplete="off">
    </div>
    <div id="savingsList" class="toolbar" style="gap:16px"></div>`;
  renderSavingsList();
}

function renderSavingsList() {
  const host = $('#savingsList');
  if (!host) return;
  const q = ui.search.trim().toLowerCase();
  const list = sortedSavings().filter((e) => !q || (e.note || 'savings').toLowerCase().includes(q));

  if (!list.length) {
    host.innerHTML = q
      ? '<div class="empty"><span class="big-emoji">🔍</span><strong>No matches</strong>Try a different search.</div>'
      : '<div class="empty"><span class="big-emoji">💰</span><strong>No savings yet</strong>Every amount you put aside shows up here.</div>';
    return;
  }

  const groups = [];
  for (const e of list) {
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) last.items.push(e);
    else groups.push({ date: e.date, items: [e] });
  }
  host.innerHTML = groups.map((g) => `<section class="list-group">
      <div class="group-head"><h2>${esc(dayTitle(g.date))}</h2><span>+${esc(money(sumSaved(g.items)))}</span></div>
      <div class="card rows">${g.items.map((e) => entryRow(e)).join('')}</div>
    </section>`).join('');
}

// ---------- Debts ----------

function renderDebts(view) {
  setHeader('Debts', '', addButton('add-debt', 'Add debt or loan'));
  const dir = ui.debtDirection;
  const mine = state.debts.filter((d) => d.direction === dir);
  const open = mine.filter((d) => !d.settled).sort(byDueDate);
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

function drawSavedChart(hostId, key, points, unit, labelEvery, ariaLabel) {
  const host = $(`#${hostId}`);
  if (!points.some((p) => p.values.saved > 0)) {
    host.innerHTML = '<p class="empty-chart">No savings logged in this period yet.</p>';
    return;
  }
  if (ui.tableView[key]) {
    chartTable(host, { columns: [unit, 'Saved'], rows: points.map((p) => [p.title, money(p.values.saved)]) });
    return;
  }
  columnChart(host, {
    points,
    series: [{ key: 'saved', label: 'Saved', color: 'var(--saved)' }],
    format: money,
    formatAxis,
    labelEvery,
    ariaLabel,
  });
}

function renderInsights(view) {
  setHeader('Insights');
  const t = todayISO();
  const n = ui.insightsRange === '30d' ? 30 : 7;
  const start = addDays(t, -(n - 1));
  const period = savings().filter((e) => e.date >= start && e.date <= t);
  const total = sumSaved(period);
  const daysWith = new Set(period.map((e) => e.date)).size;

  const daily = [];
  for (let i = 0; i < n; i += 1) {
    const d = addDays(start, i);
    daily.push({
      tick: n === 7 ? fmtDate(d, { weekday: 'short' }) : String(fromISO(d).getDate()),
      title: fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }),
      values: { saved: savedBetween(d, d) },
    });
  }

  // Last 6 months, week by week (26 weeks, Monday to Sunday).
  const thisWeek = weekStart(t);
  const weekly = [];
  for (let i = 25; i >= 0; i -= 1) {
    const ws = addDays(thisWeek, -7 * i);
    const we = addDays(ws, 6);
    weekly.push({
      tick: shortDate(ws),
      title: `Week of ${shortDate(ws)} – ${shortDate(we)}`,
      values: { saved: savedBetween(ws, we < t ? we : t) },
    });
  }
  const weeklyTotal = weekly.reduce((s, p) => s + p.values.saved, 0);

  // Last 6 months, month by month.
  const thisMonth = monthOf(t);
  const monthly = [];
  for (let i = 5; i >= 0; i -= 1) {
    const m = addMonths(thisMonth, -i);
    monthly.push({ tick: monthName(m), title: monthName(m, 'long'), values: { saved: savedBetween(`${m}-01`, `${m}-31`) } });
  }
  const monthlyTotal = monthly.reduce((s, p) => s + p.values.saved, 0);

  const toggle = (key, has) => (has
    ? `<button class="link-btn" data-action="toggle-table" data-arg="${key}">${ui.tableView[key] ? 'Show chart' : 'Show table'}</button>`
    : '');

  view.innerHTML = `
    <div class="filter-row">${seg('insightsRange', [['7d', '7 days'], ['30d', '30 days']], ui.insightsRange, 'Time range')}</div>
    <section class="card">
      <div class="tiles three">
        ${tile('Saved', total, 'var(--saved)')}
        ${tile('Avg / day', total / n)}
        ${textTile('Days saved', `${daysWith} of ${n}`)}
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Saved each day</h2>${toggle('daily', total > 0)}</div>
      <div id="dailyChart"></div>
    </section>

    <h2 class="section-title">Last 6 months</h2>
    <section class="card">
      <div class="card-head"><h2>Weekly savings</h2>${toggle('weekly', weeklyTotal > 0)}</div>
      <p class="chart-sub">${esc(money(weeklyTotal))} over 26 weeks · about ${esc(money(weeklyTotal / 26))} a week</p>
      <div id="weeklyChart"></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Monthly savings</h2>${toggle('monthly', monthlyTotal > 0)}</div>
      <p class="chart-sub">${esc(money(monthlyTotal))} over 6 months · about ${esc(money(monthlyTotal / 6))} a month</p>
      <div id="monthlyChart"></div>
    </section>`;

  drawSavedChart('dailyChart', 'daily', daily, 'Day', n === 7 ? 1 : 5, 'Saved each day. Tap a column for its amount, or use Show table.');
  drawSavedChart('weeklyChart', 'weekly', weekly, 'Week', 4, 'Saved each week for the last 26 weeks. Tap a column for its amount, or use Show table.');
  drawSavedChart('monthlyChart', 'monthly', monthly, 'Month', 1, 'Saved each month for the last 6 months. Tap a column for its amount, or use Show table.');
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
  const isEmpty = !savings().length && !state.debts.length && !state.goal;
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
        <button class="list-btn" data-action="edit-goal">${state.goal ? 'Edit savings goal' : 'Set a savings goal'}</button>
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
      <p class="footnote">Payments that are due soon or overdue show at the top of the Today screen and on the Debts tab. For a phone alert even when MoneyTrack is closed, open a debt and tap <b>Add to Calendar</b> — your calendar reminds you at 9 am the day before and on the day.</p>
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

function bindAmount(root, selector = '#amt') {
  const input = $(selector, root);
  input.addEventListener('input', () => {
    const clean = sanitizeAmount(input.value);
    if (clean !== input.value) input.value = clean;
    const err = $('#amtError', root);
    if (err) err.hidden = true;
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
          <button class="choice" data-action="add-entry" data-replace="1"><span class="emoji-badge saved" aria-hidden="true">💰</span><span><b>Saving</b><small>Money you put aside</small></span></button>
          <button class="choice" data-action="add-debt" data-replace="1"><span class="emoji-badge iOwe" aria-hidden="true">🤝</span><span><b>Debt or loan</b><small>Money you owe, or money someone owes you</small></span></button>
          <button class="choice" data-action="edit-goal" data-replace="1"><span class="emoji-badge owedToMe" aria-hidden="true">🎯</span><span><b>Savings goal</b><small>${state.goal ? 'Change your target or date' : 'Set a target and a date to reach it'}</small></span></button>
        </div>
      </div>`;
  });
}

// Saving entry
function entrySheet(id = null) {
  const existing = id ? state.entries.find((e) => e.id === id) : null;
  const f = {
    amount: existing ? String(existing.amount) : '',
    date: existing ? existing.date : todayISO(),
    note: existing ? existing.note : '',
  };

  openSheet((root) => {
    const p = goalProgress();
    const goalHint = p && !p.reached
      ? `<p class="footnote">Savings dated from ${esc(shortDate(p.g.startDate))} count toward <b>${esc(p.g.name || 'your goal')}</b> — ${esc(money(p.remaining))} to go.</p>`
      : '';
    root.innerHTML = `
      ${sheetHead(existing ? 'Edit saving' : 'New saving', { save: 'entryForm' })}
      <form id="entryForm" class="sheet-body" novalidate autocomplete="off">
        ${amountField(f.amount, !existing)}
        <div class="card form-list">
          <label class="field"><span>Date</span><input type="date" name="date" value="${esc(f.date)}" required></label>
          <label class="field"><span>Note</span><input type="text" name="note" maxlength="80" value="${esc(f.note)}" placeholder="e.g. Emergency fund"></label>
        </div>
        ${goalHint}
        ${existing ? `<button type="button" class="btn btn-danger-outline" data-action="delete-entry" data-id="${esc(existing.id)}">${ICON.trash}Delete saving</button>` : ''}
      </form>`;

    const form = $('#entryForm', root);
    bindAmount(root);
    // Keep typed values if the sheet is redrawn.
    form.addEventListener('input', () => {
      f.amount = $('#amt', root).value;
      f.date = form.date.value || f.date;
      f.note = form.note.value;
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const amount = parseAmount($('#amt', root).value);
      if (!amount) {
        showError(root, 'amtError', 'Enter an amount above zero.');
        $('#amt', root).focus();
        return;
      }
      const before = goalProgress();
      const record = {
        kind: 'saved',
        amount,
        date: form.date.value || todayISO(),
        category: 'other',
        note: form.note.value.trim().slice(0, 80),
      };
      if (existing) Object.assign(existing, record);
      else state.entries.push({ id: uid(), createdAt: Date.now(), ...record });
      const after = goalProgress();
      closeSheet();
      if (before && after && !before.reached && after.reached) commit('Goal reached — well done! 🎉');
      else commit(existing ? 'Saving updated' : `Saved ${money(amount)}`);
    });
  });
}

// Savings goal
function goalSheet() {
  const g = state.goal;
  const f = {
    name: g ? g.name : '',
    target: g ? String(g.target) : '',
    dueDate: g ? g.dueDate : addDays(todayISO(), 90),
    startDate: g ? g.startDate : todayISO(),
    already: g && g.alreadySaved ? String(g.alreadySaved) : '',
  };
  openSheet((root) => {
    root.innerHTML = `
      ${sheetHead(g ? 'Edit goal' : 'New savings goal', { save: 'goalForm' })}
      <form id="goalForm" class="sheet-body" novalidate autocomplete="off">
        <div class="card form-list">
          <label class="field"><span>Goal name</span><input type="text" name="name" maxlength="60" value="${esc(f.name)}" placeholder="e.g. New laptop"></label>
        </div>
        <h3 class="group-title" style="margin-bottom:-8px">Target amount</h3>
        ${amountField(f.target, !g)}
        <div class="card form-list">
          <label class="field"><span>Reach it by</span><input type="date" name="dueDate" value="${esc(f.dueDate)}"></label>
          <label class="field"><span>Count savings from</span><input type="date" name="startDate" value="${esc(f.startDate)}"></label>
          <label class="field"><span>Already saved</span><input type="text" name="already" inputmode="decimal" maxlength="12" value="${esc(f.already)}" placeholder="0"></label>
        </div>
        <p class="footnote">Every saving you log from the “count savings from” date adds to this goal. Use “Already saved” for money you had put aside before that.</p>
        <p class="field-error" id="goalError" hidden></p>
        ${g ? `<button type="button" class="btn btn-danger-outline" data-action="delete-goal">${ICON.trash}Remove goal</button>` : ''}
      </form>`;

    const form = $('#goalForm', root);
    bindAmount(root);
    bindAmount(root, 'input[name="already"]');
    form.addEventListener('input', () => {
      f.name = form.name.value;
      f.target = $('#amt', root).value;
      f.dueDate = form.dueDate.value || f.dueDate;
      f.startDate = form.startDate.value || f.startDate;
      f.already = form.already.value;
      $('#goalError', root).hidden = true;
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const target = parseAmount($('#amt', root).value);
      if (!target) {
        showError(root, 'amtError', 'Enter how much you want to save.');
        $('#amt', root).focus();
        return;
      }
      const dueDate = form.dueDate.value;
      const startDate = form.startDate.value || todayISO();
      if (!dueDate) {
        showError(root, 'goalError', 'Choose the date you want to reach your goal by.');
        return;
      }
      if (dueDate <= startDate) {
        showError(root, 'goalError', 'The target date needs to be after the “count savings from” date.');
        return;
      }
      state.goal = {
        name: form.name.value.trim().slice(0, 60),
        target,
        dueDate,
        startDate,
        alreadySaved: parseAmount(form.already.value) || 0,
        createdAt: g ? g.createdAt : Date.now(),
      };
      lastBarWidth.delete('goal');
      closeSheet();
      commit(g ? 'Goal updated' : 'Goal set — good luck!');
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
  const rows = [['Savings'], ['Date', 'Amount', 'Currency', 'Note']];
  for (const e of sortedSavings()) rows.push([e.date, e.amount.toFixed(2), state.settings.currency, e.note]);
  if (state.goal) {
    const p = goalProgress();
    rows.push([]);
    rows.push(['Savings goal']);
    rows.push(['Name', 'Target', 'Saved so far', 'Still needed', 'Reach it by']);
    rows.push([state.goal.name, state.goal.target.toFixed(2), p.saved.toFixed(2), p.remaining.toFixed(2), state.goal.dueDate]);
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
    const savedCount = data.entries.filter((e) => e.kind === 'saved').length;
    const ok = confirm(`Replace everything on this device with this backup?\n\n${savedCount} savings and ${data.debts.length} debts will be restored.`);
    if (!ok) return;
    state = data;
    fmtCache.clear();
    lastBarWidth.clear();
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
  const tabLink = ev.target.closest('.tabbar a[data-tab]');
  if (tabLink) {
    ev.preventDefault();
    navigate(tabLink.dataset.tab);
    return;
  }
  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  const { action, id, arg } = btn.dataset;
  switch (action) {
    case 'goto':
      closeAllSheets();
      navigate(arg);
      break;
    case 'back':
      goBack();
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
      entrySheet();
      break;
    case 'edit-entry':
      entrySheet(id);
      break;
    case 'delete-entry':
      if (confirm('Delete this saving?')) {
        state.entries = state.entries.filter((e) => e.id !== id);
        closeSheet();
        commit('Saving deleted');
      }
      break;
    case 'edit-goal':
      if (btn.dataset.replace) sheetStack.pop();
      goalSheet();
      break;
    case 'delete-goal':
      if (confirm('Remove your savings goal?\n\nYour savings stay — only the goal is removed.')) {
        state.goal = null;
        lastBarWidth.delete('goal');
        closeSheet();
        commit('Goal removed');
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
      lastBarWidth.clear();
      commit('Sample data added — erase it any time in Settings');
      break;
    case 'erase':
      if (confirm('Erase all your savings, debts and your goal on this device?\n\nThis cannot be undone. Save a backup first if you might need it.')) {
        state = { ...state, entries: [], debts: [], goal: null };
        lastBarWidth.clear();
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
  if (ev.target.id === 'savingsSearch') {
    ui.search = ev.target.value;
    renderSavingsList();
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

// Back/forward (the app's Back button, the browser, or a swipe).
window.addEventListener('popstate', () => {
  closeAllSheets();
  render();
  window.scrollTo(0, 0);
});
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
    if (currentTab() === 'insights' || currentTab() === 'today') render();
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

if (location.hash === '#activity') history.replaceState(history.state, '', '#savings');
applyTheme();
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline mode unavailable', err));
  });
}
