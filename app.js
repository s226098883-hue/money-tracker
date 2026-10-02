// MoneyTrack — main app: screens, forms and actions.
import {
  STORAGE_KEY, APP_VERSION, SAVED_EMOJI, CURRENCIES,
  loadState, saveState, normalise, askForPersistentStorage, sampleState, storageWorks,
  emptyState, snapshot, stampChanges,
  uid, esc, round2, sanitizeAmount, parseAmount,
  todayISO, fromISO, addDays, daysBetween, monthOf, addMonths, weekStart,
  paidOf, remainingOf, progressOf, nextDue, dueInfo,
} from './store.js';
import { columnChart, chartTable } from './charts.js';
import { createSync, newKeyURL, parseRepo, siteOwner, DEFAULT_REPO } from './sync.js';

let state = loadState();
// What was last saved — used to work out exactly what changed (for GitHub sync).
let lastSnapshot = snapshot(state);

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
  cloud: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10.5a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.4 9.1 4.5 4.5 0 0 0 7 18z"/></svg>',
  cloudOff: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10.5a4 4 0 0 0 1.6-.33M20.9 14.5a4 4 0 0 0-2.8-4.46A6 6 0 0 0 9 5.6M6.4 9.1A4.5 4.5 0 0 0 7 18"/><path d="m3 3 18 18"/></svg>',
  sync: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/></svg>',
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

const findGoal = (id) => (id ? state.goals.find((g) => g.id === id) || null : null);
/** The goal new savings count toward automatically (the one you chose). */
const defaultGoal = () => findGoal(state.settings.defaultGoalId);
const goalName = (g) => (g && g.name) || 'Savings goal';
/** Default goal first, then the others by the date you want to reach them. */
function goalsInOrder() {
  const def = state.settings.defaultGoalId;
  return [...state.goals].sort((a, b) => (a.id === def ? -1 : b.id === def ? 1 : a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

/** Everything a goal's progress bar needs. */
function goalProgress(g) {
  if (!g) return null;
  const t = todayISO();
  const saved = round2(g.alreadySaved + sumSaved(savings().filter((e) => e.goalId === g.id)));
  const remaining = Math.max(0, round2(g.target - saved));
  const pct = g.target > 0 ? Math.min(1, saved / g.target) : 0;
  const daysLeft = daysBetween(t, g.dueDate);
  // Per week = money still needed ÷ weeks left (today counts). It changes every time you save and as the days pass.
  const daysToSave = Math.max(0, daysLeft + 1);
  const weeksLeft = daysToSave / 7;
  const perWeek = daysToSave >= 7 ? remaining / weeksLeft : remaining;
  const totalDays = Math.max(1, daysBetween(g.startDate, g.dueDate));
  const elapsed = Math.min(totalDays, Math.max(0, daysBetween(g.startDate, t)));
  const expected = g.target * (elapsed / totalDays);
  const reached = remaining <= 0;
  let status;
  if (reached) status = { level: 'good', icon: ICON.check, text: 'Goal reached — well done!' };
  else if (daysLeft < 0) status = { level: 'overdue', icon: ICON.alert, text: `Target date passed ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago` };
  else if (saved + 0.005 >= expected) status = { level: 'good', icon: ICON.check, text: 'On track' };
  else status = { level: 'behind', icon: ICON.clock, text: `Behind plan by ${money(expected - saved)}` };
  let when;
  if (reached) when = longDate(g.dueDate);
  else if (daysLeft > 1) when = `${daysLeft} days left`;
  else if (daysLeft === 1) when = '1 day left';
  else if (daysLeft === 0) when = 'Due today';
  else when = 'Date passed';
  return { g, saved, remaining, pct, daysLeft, daysToSave, weeksLeft, perWeek, reached, status, when };
}

/** "13 weeks", "12.4 weeks", "1 week". */
function weeksText(w) {
  const r = Math.round(w * 10) / 10;
  const n = Number.isInteger(r) ? String(r) : r.toFixed(1);
  return `${n} week${r === 1 ? '' : 's'}`;
}

/**
 * This week's savings target (Monday to Sunday).
 * Following a goal, it's worked out on Monday: money still needed then ÷ weeks left then — so it stays
 * the same all week, and saving extra this week lowers next week's target.
 */
function weekPlan() {
  const wt = state.settings.weeklyTarget || { mode: 'goal', amount: 0 };
  if (wt.mode === 'off') return null;
  const t = todayISO();
  const wk = weekStart(t);
  const we = addDays(wk, 6);
  const dayIndex = daysBetween(wk, t); // Monday = 0
  const daysLeft = 7 - dayIndex; // including today
  let target;
  let saved;
  let goal = null;
  let basis = null;
  if (wt.mode === 'fixed') {
    if (!(wt.amount > 0)) return { empty: true, mode: 'fixed' };
    target = wt.amount;
    saved = savedBetween(wk, we);
  } else {
    goal = goalsInOrder()[0] || null;
    if (!goal) return { empty: true, mode: 'goal' };
    const linked = savings().filter((e) => e.goalId === goal.id);
    const before = round2(goal.alreadySaved + sumSaved(linked.filter((e) => e.date < wk)));
    const remStart = Math.max(0, round2(goal.target - before));
    const daysFromMonday = daysBetween(wk, goal.dueDate) + 1;
    target = daysFromMonday <= 7 ? remStart : round2((remStart * 7) / daysFromMonday);
    saved = sumSaved(linked.filter((e) => e.date >= wk && e.date <= we));
    basis = { remStart, weeks: Math.max(0, daysFromMonday) / 7, goalDone: remStart <= 0 };
  }
  const remaining = Math.max(0, round2(target - saved));
  const pct = target > 0 ? Math.min(1, saved / target) : 1;
  const reached = remaining <= 0;
  const perDay = remaining / daysLeft;
  const expected = (target * dayIndex) / 7; // what you'd have saved by the start of today at an even pace
  let status;
  if (basis && basis.goalDone) status = { level: 'good', icon: ICON.check, text: `${goalName(goal)} is already reached — nothing needed` };
  else if (reached) status = { level: 'good', icon: ICON.check, text: saved > target ? `Week target beaten by ${money(saved - target)} 🎉` : 'Week target reached — well done!' };
  else if (saved + 0.005 >= expected) status = { level: 'good', icon: ICON.check, text: 'On track this week' };
  else status = { level: 'behind', icon: ICON.clock, text: `Behind this week by ${money(expected - saved)}` };
  return { mode: wt.mode, wk, we, dayIndex, daysLeft, target, saved, remaining, pct, reached, perDay, status, goal, basis };
}


// ---------- Save + re-render ----------

function commit(message) {
  stampChanges(lastSnapshot, state);
  const ok = saveState(state);
  lastSnapshot = snapshot(state);
  render();
  if (!ok) toast("Couldn't save — this browser is blocking storage");
  else if (message) toast(message);
  askForPersistentStorage();
  sync.soon();
}

/** Data merged from GitHub (or another tab) replaces what's on screen. */
let renderWhenSheetCloses = false;
function applyState(next) {
  const before = state.settings;
  state = next;
  saveState(state);
  lastSnapshot = snapshot(state);
  if (before.currency !== state.settings.currency) fmtCache.clear();
  if (before.theme !== state.settings.theme) applyTheme();
  // Don't redraw under an open form (it would lose the cursor); redraw when it closes.
  if (sheet.open) renderWhenSheetCloses = true;
  else render();
}

// ---------- GitHub sync ----------

const SYNC_PROBLEMS = ['auth', 'access', 'missing', 'public', 'newer', 'other'];
let shownSyncKind = null;

const sync = createSync({
  getState: () => state,
  applyState,
  onStatus: (st) => {
    const shownBefore = shownSyncKind;
    updateSyncBits();
    // Problems change the layout (a banner on Today, a key field in Settings) — redraw for those.
    const problem = (k) => SYNC_PROBLEMS.includes(k) || k === 'off';
    const tab = currentTab();
    const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches('input, select, textarea');
    if (problem(st.kind) !== problem(shownBefore) && (tab === 'today' || tab === 'settings') && !sheet.open && !typing) render();
  },
});

function timeAgo(ms) {
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Short status text, e.g. "Saved to GitHub · just now". */
function syncStatusHTML() {
  const st = sync.status;
  if (!sync.isOn()) return `${ICON.cloudOff}<span>Not backed up to GitHub yet</span>`;
  if (st.kind === 'syncing') return `${ICON.sync}<span>Saving to GitHub…</span>`;
  if (st.kind === 'ok') return `${ICON.check}<span>Saved to GitHub${st.lastSyncAt ? ` · ${esc(timeAgo(st.lastSyncAt))}` : ''}</span>`;
  if (st.kind === 'offline') return `${ICON.cloudOff}<span>Offline — saved on this device, will upload later</span>`;
  return `${ICON.alert}<span>Sync stopped — tap to fix</span>`;
}

function syncStatusClass() {
  const k = sync.status.kind;
  if (!sync.isOn()) return 'off';
  if (k === 'ok') return 'ok';
  if (k === 'syncing') return 'busy';
  if (k === 'offline') return 'offline';
  return 'problem';
}

function updateSyncBits() {
  shownSyncKind = sync.isOn() ? sync.status.kind : 'off';
  $$('[data-sync-status]').forEach((el) => {
    el.innerHTML = syncStatusHTML();
    el.className = `sync-line ${syncStatusClass()}`;
  });
  const detail = $('#syncDetail');
  if (detail) detail.textContent = syncDetailText();
}

function syncDetailText() {
  const st = sync.status;
  if (st.kind === 'syncing') return 'Saving…';
  if (st.kind === 'ok') return st.lastSyncAt ? `Saved ${timeAgo(st.lastSyncAt)}` : 'On';
  if (st.kind === 'offline') return 'Waiting for internet';
  return 'Stopped';
}

const syncLater = { until: 0 };
try { syncLater.until = Number(localStorage.getItem('moneytrack.syncLater')) || 0; } catch { /* ignore */ }

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
  updateSyncBits();
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
  const g = findGoal(e.goalId);
  const sub = [showDate ? dayTitle(e.date) : '', g ? `🎯 ${goalName(g)}` : ''].filter(Boolean).join(' · ');
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

function goalBar(p, key, label) {
  const width = `${(p.pct * 100).toFixed(1)}%`;
  const from = lastBarWidth.get(key) || '0%';
  return `<div class="goal-bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.pct * 100)}">
      <span data-fill="${width}" data-key="${esc(key)}" style="width:${from}"></span>
    </div>`;
}

function goalsPanel() {
  if (!state.goals.length) {
    return `<section class="card goal-card">
      <div class="goal-empty">
        <span class="emoji-badge saved" aria-hidden="true">🎯</span>
        <span><strong>Set a savings goal</strong><small>Choose a target and a date, then watch the bar fill up as you save. You can have more than one.</small></span>
      </div>
      <button class="btn btn-saved" data-action="new-goal">${ICON.plus}Set a goal</button>
    </section>
    ${weeklyPanel()}`;
  }
  const [main, ...others] = goalsInOrder();
  const p = goalProgress(main);
  const isAuto = main.id === state.settings.defaultGoalId;
  const big = `<section class="card goal-card" aria-label="Savings goal: ${esc(goalName(main))}">
    <div class="card-head"><h2>🎯 ${esc(goalName(main))}</h2><button class="link-btn" data-action="edit-goal" data-id="${esc(main.id)}">Edit</button></div>
    ${isAuto ? `<p class="auto-chip">${ICON.check}New savings go here</p>` : ''}
    <div class="goal-amounts"><span class="goal-saved">${esc(money(p.saved))}</span><span class="muted">saved of ${esc(money(main.target))}</span></div>
    <div class="goal-progress">
      ${goalBar(p, `goal-${main.id}`, 'Goal progress')}
      <span class="goal-pct">${Math.floor(p.pct * 100)}%</span>
    </div>
    <div class="goal-facts">
      ${p.reached ? textTile('Target', money(main.target)) : textTile('Still needed', money(p.remaining))}
      ${textTile(`By ${shortDate(main.dueDate)}`, p.when)}
      ${p.reached || p.daysLeft < 0 ? '' : textTile('Per week', money(p.perWeek))}
    </div>
    ${p.reached || p.daysLeft < 0 ? '' : `<p class="goal-math">${p.daysToSave >= 7
    ? `${esc(money(p.remaining))} still needed ÷ ${esc(weeksText(p.weeksLeft))} left — updates every time you save`
    : `${esc(money(p.remaining))} still needed in the last ${p.daysToSave} day${p.daysToSave === 1 ? '' : 's'}`}</p>`}
    <p class="goal-status ${p.status.level}">${p.status.icon}${esc(p.status.text)}</p>
    ${others.length ? '' : `<button class="link-btn add-goal-link" data-action="new-goal">${ICON.plus}Add another goal</button>`}
  </section>`;
  if (!others.length) return `${big}${weeklyPanel()}`;
  return `${big}
    ${weeklyPanel()}
    <section class="card" aria-label="Other goals">
      ${cardHead('Other goals', '+ New goal', 'new-goal')}
      <div class="rows">${others.map(goalMiniRow).join('')}</div>
    </section>`;
}

/** 2nd panel: this week's target, laid out like the goal card. */
function weeklyPanel() {
  const w = weekPlan();
  if (!w) return '';
  if (w.empty) {
    return `<section class="card goal-card" aria-label="Weekly target">
      <div class="goal-empty">
        <span class="emoji-badge owedToMe" aria-hidden="true">📅</span>
        <span><strong>Set a weekly target</strong><small>${w.mode === 'goal'
    ? 'Set a savings goal above and your weekly target is worked out for you — or choose your own amount.'
    : 'Choose how much you want to save each week.'}</small></span>
      </div>
      <button class="btn btn-secondary" data-action="edit-week-target">${ICON.calendar}Set weekly target</button>
    </section>`;
  }
  const range = `${fmtDate(w.wk, { weekday: 'short', day: 'numeric', month: 'short' })} – ${fmtDate(w.we, { weekday: 'short', day: 'numeric', month: 'short' })}`;
  const daysText = w.daysLeft === 1 ? 'Today only' : `${w.daysLeft} days`;
  let source;
  if (w.mode === 'fixed') source = 'Your fixed weekly target · counts every saving this week';
  else if (w.basis.goalDone) source = `Follows ${goalName(w.goal)}`;
  else if (w.basis.weeks > 1) source = `From ${goalName(w.goal)}: ${money(w.basis.remStart)} still needed on Monday ÷ ${weeksText(w.basis.weeks)} left`;
  else source = `From ${goalName(w.goal)}: the last ${money(w.basis.remStart)} is due this week`;
  return `<section class="card goal-card week-card" aria-label="This week's target">
    <div class="card-head"><h2>📅 This week's target</h2><button class="link-btn" data-action="edit-week-target">Edit</button></div>
    <p class="auto-chip week-chip">${ICON.calendar}${esc(range)}</p>
    <div class="goal-amounts"><span class="goal-saved">${esc(money(w.saved))}</span><span class="muted">saved of ${esc(money(w.target))}</span></div>
    <div class="goal-progress">
      ${goalBar(w, `week-${w.wk}`, "This week's progress")}
      <span class="goal-pct">${Math.floor(w.pct * 100)}%</span>
    </div>
    <div class="goal-facts">
      ${w.reached ? textTile('Target', money(w.target)) : textTile('Still needed', money(w.remaining))}
      ${w.reached ? '' : textTile('Per day', money(w.perDay))}
      ${textTile('Days left', daysText)}
    </div>
    <p class="goal-math">${esc(source)}</p>
    <p class="goal-status ${w.status.level}">${w.status.icon}${esc(w.status.text)}</p>
  </section>`;
}

/** Last panel: a line to keep going (Thirukkural 619). */
function quoteCard() {
  return `<section class="card quote-card" aria-label="Thirukkural 619">
    <p class="quote-text" lang="ta">தெய்வத்தான் ஆகா தெனினும் முயற்சிதன்<br>மெய்வருத்தக் கூலி தரும்</p>
    <p class="quote-source" lang="ta">— திருக்குறள் 619</p>
  </section>`;
}

function goalMiniRow(g) {
  const p = goalProgress(g);
  return `<button class="row goal-row" data-action="edit-goal" data-id="${esc(g.id)}">
    <span class="row-main">
      <span class="goal-row-top"><span class="row-title">${esc(goalName(g))}</span><span class="row-amount">${Math.floor(p.pct * 100)}%</span></span>
      ${goalBar(p, `goal-${g.id}`, `${goalName(g)} progress`)}
      <span class="row-sub">${esc(money(p.saved))} of ${esc(money(g.target))} · ${esc(p.reached ? 'Reached' : p.when)}</span>
    </span>
  </button>`;
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
  const weekSaved = savedBetween(wk, t);
  const daysSoFar = daysBetween(wk, t) + 1;
  const monthSaved = savedBetween(`${monthOf(t)}-01`, t);
  const open = openDebts().sort(byDueDate);
  const iOweList = open.filter((d) => d.direction === 'iOwe');
  const owedList = open.filter((d) => d.direction === 'owedToMe');
  const iOwe = iOweList.reduce((s, d) => s + remainingOf(d), 0);
  const owed = owedList.reduce((s, d) => s + remainingOf(d), 0);
  const upcoming = upcomingDebts();

  // The + button adds a saving straight away.
  setHeader('Today', fmtDate(t, { weekday: 'long', day: 'numeric', month: 'long' }), addButton('add-entry', 'Add saving'));

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

  const isEmpty = !all.length && !state.debts.length && !state.goals.length;
  let syncCard = '';
  if (!sync.isOn() && (isEmpty || Date.now() > syncLater.until)) {
    syncCard = `<section class="card sync-card">
      <div class="goal-empty">
        <span class="emoji-badge owedToMe" aria-hidden="true">☁️</span>
        <span>${isEmpty
    ? '<strong>Lost your data?</strong><small>If you turned on GitHub sync before, connect this device to bring everything back.</small>'
    : '<strong>Keep your data safe</strong><small>Save a copy to your private GitHub, so nothing is lost when the browser forgets it — and it matches on your iPhone and Mac.</small>'}</span>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" data-action="goto" data-arg="settings">Turn on sync</button>
        ${isEmpty ? '' : '<button class="btn btn-secondary" data-action="sync-later">Later</button>'}
      </div>
    </section>`;
  } else if (sync.isOn() && SYNC_PROBLEMS.includes(sync.status.kind)) {
    syncCard = `<button class="alert-banner" data-action="goto" data-arg="settings">
      <span class="lead">${ICON.alert}</span>
      <span class="grow"><strong>GitHub sync stopped</strong><small>${esc(sync.status.message)}</small></span>
      ${ICON.chevron}
    </button>`;
  }

  view.innerHTML = `
    ${storageNotice()}
    ${syncCard}
    ${goalsPanel()}
    ${banner}

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
      ${all.length ? '' : '<p class="muted small" style="margin-top:12px">Nothing saved yet. Tap <b>+</b> at the top to log your first saving.</p>'}
    </section>

    <section class="card">
      ${cardHead('Debts & loans', 'Open', 'goto', 'debts')}
      <div class="tiles">
        ${tile('I owe', iOwe, 'var(--owe)')}
        ${tile('Owed to me', owed, 'var(--owed)')}
      </div>
      ${open.length
        ? `${debtGroup('I need to pay', iOweList)}${debtGroup('Owes me', owedList)}`
        : '<p class="muted small" style="margin-top:12px">Nothing open right now.</p>'}
      <button class="btn btn-secondary" style="margin-top:14px" data-action="add-debt">${ICON.plus}Add debt or loan</button>
    </section>

    ${quoteCard()}
    ${sync.isOn() ? '<button class="sync-line" data-sync-status data-action="goto" data-arg="settings"></button>' : ''}`;

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

function syncSection() {
  const owner = siteOwner();
  const cfg = sync.config;
  const st = sync.status;
  const repoText = cfg ? `${cfg.owner}/${cfg.repo}` : owner ? `${owner}/${DEFAULT_REPO}` : DEFAULT_REPO;
  const needsKey = !cfg || ['auth', 'access', 'missing', 'public'].includes(st.kind);

  const keyForm = `
      <form id="syncForm" class="sync-form" novalidate>
        <div class="card form-list">
          <label class="field${cfg ? ' visually-hidden' : ''}"><span>Repository</span><input type="text" name="repo" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(repoText)}" ${cfg ? 'tabindex="-1" aria-hidden="true"' : ''}></label>
          <label class="field"><span>Access key</span><input type="password" name="token" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Paste it here"></label>
        </div>
        <p class="field-error" id="syncError" hidden></p>
        <button class="btn btn-primary" type="submit" id="syncConnect">${ICON.cloud}${cfg ? 'Save new key' : 'Connect'}</button>
      </form>`;

  if (!cfg) {
    return `<section id="sync">
      <h2 class="group-title">GitHub sync</h2>
      <div class="card sync-intro">
        <p>Save your data to a private file in your own GitHub account. It's never lost — even if this browser forgets everything or you delete the Home Screen icon — and it stays the same on your iPhone and Mac.</p>
        <ol class="steps">
          <li><a class="text-link" href="${esc(newKeyURL(owner))}" target="_blank" rel="noopener">Make an access key on GitHub</a>. Under <b>Repository access</b>, pick <b>Only select repositories</b> → <b>${esc(DEFAULT_REPO)}</b>. Then tap <b>Generate token</b> and copy the key.</li>
          <li>Paste the key below and tap <b>Connect</b>.</li>
        </ol>
      </div>
      ${keyForm}
      <p class="footnote">The key only opens that one private repository and stays on this device. Keep a copy in your Passwords app or Notes — you'll paste it once on each device or browser you use.</p>
    </section>`;
  }

  const problem = SYNC_PROBLEMS.includes(st.kind);
  return `<section id="sync">
    <h2 class="group-title">GitHub sync</h2>
    <div class="card form-list">
      <div class="field"><span>Status</span><span class="kv-value ${problem ? 'bad' : ''}" id="syncDetail">${esc(syncDetailText())}</span></div>
      <div class="field"><span>Repository</span><a class="kv-value text-link" href="https://github.com/${esc(cfg.owner)}/${esc(cfg.repo)}/commits" target="_blank" rel="noopener">${esc(`${cfg.owner}/${cfg.repo}`)}</a></div>
      <button class="list-btn" data-action="sync-now">Sync now</button>
      <button class="list-btn danger" data-action="sync-off">Turn off sync on this device</button>
    </div>
    ${problem ? `<p class="sync-problem" role="alert">${ICON.alert}<span>${esc(st.message)}</span></p>` : ''}
    ${problem && needsKey ? `<p class="footnote" style="margin-bottom:8px"><a class="text-link" href="${esc(newKeyURL(cfg.owner))}" target="_blank" rel="noopener">Make a new access key</a> (pick <b>Only select repositories</b> → <b>${esc(cfg.repo)}</b>), then paste it here.</p>${keyForm}` : ''}
    <p class="footnote">Every change is saved to GitHub a few seconds after you make it. GitHub also keeps every earlier version, so you can always go back.</p>
  </section>`;
}

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
  const isEmpty = !savings().length && !state.debts.length && !state.goals.length;
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
    ${syncSection()}
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
      <h2 class="group-title">Savings goals</h2>
      <div class="card form-list">
        ${goalsInOrder().map((g) => `<button class="list-btn goal-list-btn" data-action="edit-goal" data-id="${esc(g.id)}"><span>${esc(goalName(g))}</span>${g.id === s.defaultGoalId ? '<span class="tag">New savings go here</span>' : `<span class="kv-value">${esc(money(g.target))}</span>`}</button>`).join('')}
        <button class="list-btn" data-action="new-goal">${state.goals.length ? 'Add another goal' : 'Set a savings goal'}</button>
        <button class="list-btn goal-list-btn" data-action="edit-week-target"><span>Weekly target</span><span class="kv-value">${esc(
    s.weeklyTarget.mode === 'off' ? 'Off'
      : s.weeklyTarget.mode === 'fixed' ? `${money(s.weeklyTarget.amount)} a week`
        : 'Follows your goal')}</span></button>
      </div>
      ${state.goals.length > 1 ? '<p class="footnote">To change which goal new savings go to, open a goal and turn on <b>New savings go here</b>.</p>' : ''}
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
        ${isEmpty && !sync.isOn() ? '<button class="list-btn" data-action="load-sample">Try it with sample data</button>' : ''}
        <button class="list-btn danger" data-action="erase">Erase all data</button>
      </div>
      <p class="footnote">${sync.isOn()
    ? 'Your data is saved in this browser and in your private GitHub repository. A backup file is an extra copy you can keep anywhere.'
    : 'Right now your data is saved only in this browser. Turn on GitHub sync above so it can never be lost, or save a backup file now and then.'}</p>
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
  if (renderWhenSheetCloses) {
    renderWhenSheetCloses = false;
    render();
  }
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

// Saving entry
function entrySheet(id = null) {
  const existing = id ? state.entries.find((e) => e.id === id) : null;
  const f = {
    amount: existing ? String(existing.amount) : '',
    date: existing ? existing.date : todayISO(),
    note: existing ? existing.note : '',
    // New savings count toward the goal you chose; an edited saving keeps its own goal.
    goalId: existing ? (findGoal(existing.goalId) ? existing.goalId : '') : (defaultGoal() ? defaultGoal().id : ''),
  };

  const goalHint = () => {
    const p = goalProgress(findGoal(f.goalId));
    if (!p) return state.goals.length ? "This saving won't count toward a goal." : '';
    return p.reached
      ? `Counts toward <b>${esc(goalName(p.g))}</b> — already reached 🎉`
      : `Counts toward <b>${esc(goalName(p.g))}</b> — ${esc(money(p.remaining))} to go.`;
  };

  openSheet((root) => {
    const goalField = state.goals.length
      ? `<label class="field"><span>Goal</span>
          <select name="goalId">
            ${goalsInOrder().map((g) => `<option value="${esc(g.id)}" ${g.id === f.goalId ? 'selected' : ''}>${esc(goalName(g))}</option>`).join('')}
            <option value="" ${f.goalId ? '' : 'selected'}>No goal</option>
          </select>
        </label>`
      : '';
    root.innerHTML = `
      ${sheetHead(existing ? 'Edit saving' : 'New saving', { save: 'entryForm' })}
      <form id="entryForm" class="sheet-body" novalidate autocomplete="off">
        ${amountField(f.amount, !existing)}
        <div class="card form-list">
          ${goalField}
          <label class="field"><span>Date</span><input type="date" name="date" value="${esc(f.date)}" required></label>
          <label class="field"><span>Note</span><input type="text" name="note" maxlength="80" value="${esc(f.note)}" placeholder="e.g. Pay day"></label>
        </div>
        <p class="footnote" id="goalHint">${goalHint()}</p>
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
    if (form.goalId) {
      form.goalId.addEventListener('change', () => {
        f.goalId = form.goalId.value;
        $('#goalHint', root).innerHTML = goalHint();
      });
    }
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const amount = parseAmount($('#amt', root).value);
      if (!amount) {
        showError(root, 'amtError', 'Enter an amount above zero.');
        $('#amt', root).focus();
        return;
      }
      const goal = findGoal(form.goalId ? form.goalId.value : '');
      const before = goalProgress(goal);
      const record = {
        kind: 'saved',
        amount,
        date: form.date.value || todayISO(),
        category: 'other',
        note: form.note.value.trim().slice(0, 80),
        goalId: goal ? goal.id : null,
      };
      // Look the saving up again: sync may have refreshed the data while this form was open.
      const current = existing && state.entries.find((e) => e.id === existing.id);
      if (current) Object.assign(current, record);
      else if (existing) state.entries.push({ ...existing, ...record });
      else state.entries.push({ id: uid(), createdAt: Date.now(), ...record });
      const after = goalProgress(goal);
      closeSheet();
      if (before && after && !before.reached && after.reached) commit(`${goalName(goal)} reached — well done! 🎉`);
      else if (existing) commit('Saving updated');
      else commit(goal ? `Saved ${money(amount)} toward ${goalName(goal)}` : `Saved ${money(amount)}`);
    });
  });
}

// Savings goal (new or edit)
function goalSheet(id = null) {
  const g = findGoal(id);
  const isDefault = g ? g.id === state.settings.defaultGoalId : !defaultGoal();
  const f = {
    name: g ? g.name : '',
    target: g ? String(g.target) : '',
    dueDate: g ? g.dueDate : addDays(todayISO(), 90),
    startDate: g ? g.startDate : todayISO(),
    already: g && g.alreadySaved ? String(g.alreadySaved) : '',
    auto: isDefault,
  };
  openSheet((root) => {
    const p = goalProgress(g);
    root.innerHTML = `
      ${sheetHead(g ? 'Edit goal' : 'New savings goal', { save: 'goalForm' })}
      <form id="goalForm" class="sheet-body" novalidate autocomplete="off">
        <div class="card form-list">
          <label class="field"><span>Goal name</span><input type="text" name="name" maxlength="60" value="${esc(f.name)}" placeholder="e.g. New laptop" ${g ? '' : 'autofocus'}></label>
        </div>
        <h3 class="group-title" style="margin-bottom:-8px">Target amount</h3>
        ${amountField(f.target, false)}
        <div class="card form-list">
          <label class="field"><span>Reach it by</span><input type="date" name="dueDate" value="${esc(f.dueDate)}"></label>
          <label class="field"><span>Start date</span><input type="date" name="startDate" value="${esc(f.startDate)}"></label>
          <label class="field"><span>Already saved</span><input type="text" name="already" inputmode="decimal" maxlength="12" value="${esc(f.already)}" placeholder="0"></label>
          <label class="field"><span>New savings go here</span><input type="checkbox" role="switch" name="auto" ${f.auto ? 'checked' : ''}></label>
        </div>
        <p class="footnote">With <b>New savings go here</b> on, every saving you add counts toward this goal automatically. Only one goal can have it — you can still pick another goal when you add a saving. “Already saved” is money you had put aside before you started.</p>
        ${p ? `<p class="footnote"><b>${esc(money(p.saved))}</b> saved so far — ${esc(money(g.alreadySaved))} already saved + ${esc(money(round2(p.saved - g.alreadySaved)))} from savings linked to this goal.</p>` : ''}
        <p class="field-error" id="goalError" hidden></p>
        ${g ? `<button type="button" class="btn btn-danger-outline" data-action="delete-goal" data-id="${esc(g.id)}">${ICON.trash}Delete goal</button>` : ''}
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
    form.auto.addEventListener('change', () => { f.auto = form.auto.checked; });
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
        showError(root, 'goalError', 'The “reach it by” date needs to be after the start date.');
        return;
      }
      const record = {
        name: form.name.value.trim().slice(0, 60),
        target,
        dueDate,
        startDate,
        alreadySaved: parseAmount(form.already.value) || 0,
      };
      let goal = g && findGoal(g.id);
      if (goal) Object.assign(goal, record);
      else {
        goal = { ...(g || {}), id: (g && g.id) || `goal-${uid()}`, createdAt: (g && g.createdAt) || Date.now(), ...record };
        state.goals.push(goal);
      }
      if (form.auto.checked) state.settings.defaultGoalId = goal.id;
      else if (state.settings.defaultGoalId === goal.id) state.settings.defaultGoalId = null;
      closeSheet();
      commit(g ? 'Goal updated' : form.auto.checked && state.goals.length > 1 ? `${goalName(goal)} added — new savings go here` : 'Goal set — good luck!');
    });
  });
}

// Weekly target
function weekTargetSheet() {
  const wt = state.settings.weeklyTarget || { mode: 'goal', amount: 0 };
  const f = { mode: wt.mode, amount: wt.amount ? String(wt.amount) : '' };
  openSheet((root) => {
    const main = goalsInOrder()[0] || null;
    const plan = main ? weekPlanFor('goal') : null;
    root.innerHTML = `
      ${sheetHead('Weekly target', { save: 'weekForm' })}
      <form id="weekForm" class="sheet-body" novalidate autocomplete="off">
        ${formSeg('mode', [['goal', 'Follow my goal'], ['fixed', 'My own amount'], ['off', 'Off']], f.mode, 'Weekly target')}
        <div class="mode-goal" ${f.mode === 'goal' ? '' : 'hidden'}>
          ${main
    ? `<div class="card"><p>This week: <b>${esc(money(plan.target))}</b> for <b>${esc(goalName(main))}</b>.</p>
              <p class="muted small" style="margin-top:6px">It's the money still needed for your goal on Monday, shared over the weeks left. It's worked out again every Monday — save extra one week and the next weeks need less. Savings linked to ${esc(goalName(main))} count toward it.</p></div>`
    : `<div class="card"><p class="muted">You don't have a savings goal yet. Set one and your weekly target is worked out for you.</p>
              <button type="button" class="btn btn-secondary" style="margin-top:12px" data-action="new-goal">${ICON.plus}Set a goal</button></div>`}
        </div>
        <div class="mode-fixed" ${f.mode === 'fixed' ? '' : 'hidden'}>
          <h3 class="group-title" style="margin-bottom:8px">Save each week</h3>
          ${amountField(f.amount, false)}
          <p class="footnote">Every saving you add from Monday to Sunday counts toward it.</p>
        </div>
        <div class="mode-off" ${f.mode === 'off' ? '' : 'hidden'}>
          <p class="footnote">The weekly panel is hidden from Today. Turn it back on here any time.</p>
        </div>
      </form>`;
    const form = $('#weekForm', root);
    bindAmount(root);
    form.addEventListener('input', () => { f.amount = $('#amt', root).value; });
    bindFormSeg(root, 'mode', (v) => {
      f.mode = v;
      $('.mode-goal', root).hidden = v !== 'goal';
      $('.mode-fixed', root).hidden = v !== 'fixed';
      $('.mode-off', root).hidden = v !== 'off';
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      let amount = state.settings.weeklyTarget ? state.settings.weeklyTarget.amount : 0;
      if (f.mode === 'fixed') {
        amount = parseAmount($('#amt', root).value);
        if (!amount) {
          showError(root, 'amtError', 'Enter how much you want to save each week.');
          $('#amt', root).focus();
          return;
        }
      }
      state.settings.weeklyTarget = { mode: f.mode, amount: amount || 0 };
      closeSheet();
      commit(f.mode === 'off' ? 'Weekly panel hidden' : 'Weekly target saved');
    });
  });
}

/** Works out the weekly plan for a given mode (used to preview it in the form). */
function weekPlanFor(mode) {
  const saved = state.settings.weeklyTarget;
  state.settings.weeklyTarget = { ...(saved || {}), mode };
  try {
    return weekPlan();
  } finally {
    state.settings.weeklyTarget = saved;
  }
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
      const current = existing && (findDebt(existing.id) || (state.debts.push({ ...existing }), findDebt(existing.id)));
      if (current) {
        Object.assign(current, record);
        if (current.settled && remainingOf(current) > 0) {
          current.settled = false;
          current.settledDate = null;
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
  const rows = [['Savings'], ['Date', 'Amount', 'Currency', 'Goal', 'Note']];
  for (const e of sortedSavings()) rows.push([e.date, e.amount.toFixed(2), state.settings.currency, findGoal(e.goalId) ? goalName(findGoal(e.goalId)) : '', e.note]);
  if (state.goals.length) {
    rows.push([]);
    rows.push(['Savings goals']);
    rows.push(['Name', 'Target', 'Saved so far', 'Still needed', 'Reach it by', 'New savings go here']);
    for (const g of goalsInOrder()) {
      const p = goalProgress(g);
      rows.push([goalName(g), g.target.toFixed(2), p.saved.toFixed(2), p.remaining.toFixed(2), g.dueDate, g.id === state.settings.defaultGoalId ? 'Yes' : '']);
    }
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
    const where = sync.isOn() ? 'on this device and in GitHub sync' : 'on this device';
    const ok = confirm(`Replace everything ${where} with this backup?\n\n${savedCount} savings and ${data.debts.length} debts will be restored.`);
    if (!ok) return;
    const tombs = { ...state.deleted };
    for (const [id, at] of Object.entries(data.deleted || {})) tombs[id] = Math.max(tombs[id] || 0, at);
    state = { ...data, deleted: tombs };
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
    case 'new-goal':
      if (sheet.open) closeAllSheets();
      goalSheet();
      break;
    case 'edit-week-target':
      weekTargetSheet();
      break;
    case 'edit-goal':
      goalSheet(id);
      break;
    case 'delete-goal': {
      const g = findGoal(id);
      if (!g || !confirm(`Delete the goal “${goalName(g)}”?\n\nYour savings stay — they just won't count toward a goal any more.`)) break;
      state.goals = state.goals.filter((x) => x.id !== id);
      lastBarWidth.delete(`goal-${id}`);
      let message = 'Goal deleted';
      if (state.settings.defaultGoalId === id) {
        // Keep auto-linking working: the next goal (soonest date) takes over.
        const next = [...state.goals].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
        state.settings.defaultGoalId = next ? next.id : null;
        if (next) message = `Goal deleted — new savings now go to ${goalName(next)}`;
      }
      closeSheet();
      commit(message);
      break;
    }
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
      state = { ...sampleState(state.settings.currency), deleted: state.deleted };
      lastBarWidth.clear();
      commit('Sample data added — erase it any time in Settings');
      break;
    case 'erase':
      if (confirm(sync.isOn()
        ? 'Erase all your savings, debts and goals?\n\nThis also erases them on your other devices that use GitHub sync. Older copies stay in your GitHub history.'
        : 'Erase all your savings, debts and goals on this device?\n\nThis cannot be undone. Save a backup first if you might need it.')) {
        state = { ...state, entries: [], debts: [], goals: [], settings: { ...state.settings, defaultGoalId: null } };
        lastBarWidth.clear();
        commit('All data erased');
      }
      break;
    case 'sync-now':
      sync.now().then(() => {
        if (sync.status.kind === 'ok') toast('Synced with GitHub');
      });
      break;
    case 'sync-off':
      if (confirm('Turn off GitHub sync on this device?\n\nYour data stays here and in GitHub. Other devices keep syncing.')) {
        sync.disconnect();
        render();
        toast('Sync turned off on this device');
      }
      break;
    case 'sync-later':
      syncLater.until = Date.now() + 3 * 86400000;
      try { localStorage.setItem('moneytrack.syncLater', String(syncLater.until)); } catch { /* ignore */ }
      render();
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

// Connect to GitHub (Settings → GitHub sync).
document.addEventListener('submit', async (ev) => {
  if (ev.target.id !== 'syncForm') return;
  ev.preventDefault();
  const form = ev.target;
  const err = $('#syncError');
  const button = $('#syncConnect');
  const fail = (message) => {
    err.textContent = message;
    err.hidden = false;
  };
  err.hidden = true;
  const token = form.token.value.trim();
  const where = parseRepo(form.repo.value);
  if (!where) return fail('Type the repository as owner/name, e.g. your-name/money-tracker-data.');
  if (!token) return fail('Paste your access key first.');
  if (/\s/.test(token) || token.length < 20) return fail("That doesn't look like a GitHub key. It's one long line starting with github_pat_.");
  button.disabled = true;
  button.textContent = 'Connecting…';
  try {
    // Sample data is only for trying the app out — never upload it.
    const real = {
      ...state,
      entries: state.entries.filter((e) => !e.sample),
      debts: state.debts.filter((d) => !d.sample),
      goals: state.goals.filter((g) => !g.sample),
    };
    if (real.entries.length !== state.entries.length || real.debts.length !== state.debts.length || real.goals.length !== state.goals.length) {
      const settings = { ...state.settings };
      if (!real.goals.some((g) => g.id === settings.defaultGoalId)) settings.defaultGoalId = null;
      state = { ...emptyState(), ...real, deleted: state.deleted, settings };
      saveState(state);
      lastSnapshot = snapshot(state);
    }
    await sync.connect({ token, owner: where.owner, repo: where.repo });
    form.token.value = '';
    render();
    toast('GitHub sync is on');
  } catch (e) {
    fail(e && e.message ? e.message : 'Could not connect. Check the key and try again.');
    button.disabled = false;
    button.innerHTML = `${ICON.cloud}${sync.isOn() ? 'Save new key' : 'Connect'}`;
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
    lastSnapshot = snapshot(state);
    fmtCache.clear();
    applyTheme();
    render();
  }
});

// Coming back to the app (maybe on a new day) — refresh dates and alerts, and fetch changes from other devices.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    render();
    sync.now();
  } else if (sync.hasPending()) {
    sync.now(); // leaving the app — upload the last change right away
  }
});
window.addEventListener('online', () => sync.now());
window.addEventListener('pagehide', () => { if (sync.hasPending()) sync.now(); });
setInterval(() => {
  if (document.visibilityState === 'visible' && sync.isOn()) sync.now();
}, 120000);
setInterval(updateSyncBits, 30000); // keeps "2 min ago" fresh

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
sync.now();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline mode unavailable', err));
  });
}
