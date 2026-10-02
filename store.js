// Data, saving, and small helpers. Everything is stored in this browser (localStorage).

export const STORAGE_KEY = 'moneytrack.v1';
export const APP_VERSION = '1.2.0';

export const CATEGORIES = [
  { id: 'food', name: 'Food & Drink', emoji: '🍔' },
  { id: 'groceries', name: 'Groceries', emoji: '🛒' },
  { id: 'transport', name: 'Transport', emoji: '🚗' },
  { id: 'shopping', name: 'Shopping', emoji: '🛍️' },
  { id: 'bills', name: 'Bills', emoji: '💡' },
  { id: 'rent', name: 'Rent', emoji: '🏠' },
  { id: 'fun', name: 'Fun', emoji: '🎮' },
  { id: 'health', name: 'Health', emoji: '💊' },
  { id: 'study', name: 'Study', emoji: '📚' },
  { id: 'travel', name: 'Travel', emoji: '✈️' },
  { id: 'gifts', name: 'Gifts', emoji: '🎁' },
  { id: 'other', name: 'Other', emoji: '📦' },
];
export const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
export const SAVED_EMOJI = '💰';

export const CURRENCIES = [
  'AUD', 'USD', 'EUR', 'GBP', 'NZD', 'CAD', 'INR', 'LKR', 'NPR', 'PKR', 'BDT', 'SGD',
  'MYR', 'IDR', 'PHP', 'THB', 'VND', 'CNY', 'HKD', 'JPY', 'KRW', 'AED', 'SAR', 'ZAR',
];

// ---------- State ----------
// IMPORTANT: never rename STORAGE_KEY. Changing it would make every phone "forget" its data after an update.

/** Version of the data format. Newer versions only ever add fields, so older data always loads. */
export const SCHEMA = 2;

// Settings sync one by one: each remembers when it was last changed (stamps), so changing the theme on one
// device never undoes a goal choice made on another — and a brand-new device's defaults never win.
const SETTING_KEYS = ['currency', 'remindDays', 'theme', 'defaultGoalId'];

function defaultSettings() {
  // defaultGoalId: the goal that new savings count toward automatically (null = none).
  return { currency: 'AUD', remindDays: 7, theme: 'system', defaultGoalId: null, stamps: {} };
}

export function emptyState() {
  return {
    version: 1, schema: SCHEMA, entries: [], debts: [], goals: [], deleted: {}, settings: defaultSettings(),
  };
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Cleans up anything loaded from storage, a backup file or GitHub so the app never crashes on odd data.
 * It keeps any extra fields it doesn't know about, so data saved by a newer version is never lost.
 */
export function normalise(data) {
  const base = emptyState();
  if (!isObj(data)) return base;
  const entries = (Array.isArray(data.entries) ? data.entries : [])
    .filter((e) => isObj(e) && typeof e.kind === 'string' && isISODate(e.date))
    .map((e) => ({
      ...e,
      id: String(e.id || uid()),
      kind: e.kind,
      amount: round2(Math.abs(num(e.amount))),
      date: e.date,
      category: CAT[e.category] ? e.category : 'other',
      note: String(e.note || '').slice(0, 120),
      createdAt: num(e.createdAt) || Date.now(),
      updatedAt: num(e.updatedAt) || num(e.createdAt) || 0,
    }))
    .filter((e) => e.amount > 0);

  const debts = (Array.isArray(data.debts) ? data.debts : [])
    .filter((d) => isObj(d) && typeof d.name === 'string')
    .map((d) => ({
      ...d,
      id: String(d.id || uid()),
      name: d.name.slice(0, 60),
      direction: d.direction === 'owedToMe' ? 'owedToMe' : 'iOwe',
      kind: d.kind === 'loan' ? 'loan' : 'person',
      amount: round2(Math.abs(num(d.amount))),
      startDate: isISODate(d.startDate) ? d.startDate : todayISO(),
      dueDate: isISODate(d.dueDate) ? d.dueDate : null,
      monthly: Boolean(d.monthly) && isISODate(d.dueDate),
      note: String(d.note || '').slice(0, 300),
      settled: Boolean(d.settled),
      settledDate: isISODate(d.settledDate) ? d.settledDate : null,
      payments: (Array.isArray(d.payments) ? d.payments : [])
        .filter((p) => isObj(p) && isISODate(p.date))
        .map((p) => ({
          ...p,
          id: String(p.id || uid()),
          amount: round2(Math.abs(num(p.amount))),
          date: p.date,
          note: String(p.note || '').slice(0, 120),
          updatedAt: num(p.updatedAt),
        }))
        .filter((p) => p.amount > 0),
      createdAt: num(d.createdAt) || Date.now(),
      updatedAt: num(d.updatedAt) || num(d.createdAt) || 0,
    }));

  const cleanGoal = (g) => ({
    ...g,
    id: String(g.id || `goal-${num(g.createdAt) || uid()}`),
    name: String(g.name || '').slice(0, 60),
    target: round2(Math.abs(num(g.target))),
    dueDate: g.dueDate,
    startDate: isISODate(g.startDate) ? g.startDate : todayISO(),
    alreadySaved: round2(Math.abs(num(g.alreadySaved))),
    createdAt: num(g.createdAt) || Date.now(),
    updatedAt: num(g.updatedAt) || num(g.createdAt) || 0,
  });
  const validGoal = (g) => isObj(g) && num(g.target) > 0 && isISODate(g.dueDate);
  let goals = (Array.isArray(data.goals) ? data.goals : []).filter(validGoal).map(cleanGoal);

  const s = isObj(data.settings) ? data.settings : {};
  let defaultGoalId = typeof s.defaultGoalId === 'string' ? s.defaultGoalId : null;

  // Older versions had one goal that counted every saving from its start date.
  // Turn it into the first goal of the list and link those savings to it, so its progress stays the same.
  if (!Array.isArray(data.goals) && validGoal(data.goal)) {
    const old = cleanGoal({ ...data.goal, updatedAt: num(data.goalUpdatedAt) || num(data.goal.createdAt) });
    goals = [old];
    if (!('defaultGoalId' in s)) defaultGoalId = old.id;
    for (const e of entries) {
      if (e.kind === 'saved' && e.goalId === undefined && e.date >= old.startDate) e.goalId = old.id;
    }
  }
  for (const e of entries) {
    if (e.kind === 'saved') e.goalId = typeof e.goalId === 'string' && e.goalId ? e.goalId : null;
  }

  const deleted = {};
  if (isObj(data.deleted)) {
    for (const [id, at] of Object.entries(data.deleted)) if (num(at) > 0) deleted[id] = num(at);
  }

  // Settings saved by an older version (no stamps) were chosen by you, so they count as "set" (time 1).
  const legacy = isObj(data.settings) && !isObj(s.stamps);
  const stamps = {};
  for (const k of SETTING_KEYS) stamps[k] = num(isObj(s.stamps) ? s.stamps[k] : 0) || (legacy ? 1 : 0);
  const settings = {
    ...s,
    defaultGoalId,
    currency: CURRENCIES.includes(s.currency) || /^[A-Z]{3}$/.test(s.currency || '') ? s.currency : base.settings.currency,
    remindDays: [1, 3, 7, 14, 30].includes(Number(s.remindDays)) ? Number(s.remindDays) : 7,
    theme: ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system',
    stamps,
  };
  delete settings.updatedAt;
  const out = {
    ...data,
    version: 1,
    schema: Math.max(SCHEMA, num(data.schema)),
    entries,
    debts,
    goals,
    deleted,
    settings,
  };
  delete out.goal;
  delete out.goalUpdatedAt;
  return out;
}

export let storageWorks = true;

export function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.warn('Could not load saved data', err);
    storageWorks = false;
    return emptyState();
  }
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw);
    const data = normalise(parsed);
    if (!parsed || !parsed.schema) {
      // First time this version opens data from an older version: keep an untouched copy of the old data,
      // then save it in the new format.
      try {
        if (!localStorage.getItem(`${STORAGE_KEY}.before-upgrade`)) localStorage.setItem(`${STORAGE_KEY}.before-upgrade`, raw);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch { /* storage full — the data still loads */ }
    }
    return data;
  } catch (err) {
    // Unreadable data is set aside (never thrown away) before anything new is saved.
    console.warn('Saved data could not be read — kept a copy', err);
    try { localStorage.setItem(`${STORAGE_KEY}.unreadable-${Date.now()}`, raw); } catch { /* ignore */ }
    return emptyState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageWorks = true;
    return true;
  } catch (err) {
    console.warn('Could not save data', err);
    storageWorks = false;
    return false;
  }
}

// ---------- Change tracking + merging (for GitHub sync) ----------
// Every saving, debt and payment remembers when it last changed (updatedAt). Deleting something leaves a
// small note in `deleted` ({ id: time }), so a delete on one device also reaches the others.

export const snapshot = (state) => JSON.parse(JSON.stringify(state));

const withoutStamps = (value) => JSON.stringify(value, (k, v) => (k === 'updatedAt' ? undefined : v));

/** Compares the state before and after a change and stamps whatever is new, edited or deleted. */
export function stampChanges(prev, next, now = Date.now()) {
  const deleted = { ...(next.deleted || {}) };
  const keep = (item, before) => {
    const tomb = deleted[item.id];
    if (!before || withoutStamps(before) !== withoutStamps(item) || (tomb && tomb >= (item.updatedAt || 0))) item.updatedAt = now;
    delete deleted[item.id];
  };

  const prevEntries = new Map((prev.entries || []).map((e) => [e.id, e]));
  const nextEntryIds = new Set();
  for (const e of next.entries) {
    nextEntryIds.add(e.id);
    keep(e, prevEntries.get(e.id));
  }
  for (const id of prevEntries.keys()) if (!nextEntryIds.has(id)) deleted[id] = now;

  const prevDebts = new Map((prev.debts || []).map((d) => [d.id, d]));
  const nextDebtIds = new Set();
  for (const d of next.debts) {
    nextDebtIds.add(d.id);
    const before = prevDebts.get(d.id);
    const prevPays = new Map(((before && before.payments) || []).map((p) => [p.id, p]));
    const nextPayIds = new Set();
    for (const p of d.payments) {
      nextPayIds.add(p.id);
      keep(p, prevPays.get(p.id));
    }
    for (const id of prevPays.keys()) if (!nextPayIds.has(id)) deleted[id] = now;
    keep(d, before);
  }
  for (const [id, d] of prevDebts) {
    if (!nextDebtIds.has(id)) {
      deleted[id] = now;
      for (const p of d.payments || []) deleted[p.id] = now;
    }
  }

  const prevGoals = new Map((prev.goals || []).map((g) => [g.id, g]));
  const nextGoalIds = new Set();
  for (const g of next.goals || []) {
    nextGoalIds.add(g.id);
    keep(g, prevGoals.get(g.id));
  }
  for (const id of prevGoals.keys()) if (!nextGoalIds.has(id)) deleted[id] = now;
  const ps = prev.settings || {};
  const ns = next.settings;
  ns.stamps = { ...(ns.stamps || {}) };
  for (const k of SETTING_KEYS) {
    if (JSON.stringify(ps[k] ?? null) !== JSON.stringify(ns[k] ?? null)) ns.stamps[k] = now;
  }
  next.deleted = deleted;
  return next;
}

/** The newer of two copies of the same item (ties are broken the same way on every device). */
function newer(a, b) {
  const ua = a.updatedAt || 0;
  const ub = b.updatedAt || 0;
  if (ua !== ub) return ua > ub ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

function unionById(listA, listB, combine = newer) {
  const map = new Map();
  for (const x of listA || []) map.set(x.id, x);
  for (const y of listB || []) {
    const x = map.get(y.id);
    map.set(y.id, x ? combine(x, y) : y);
  }
  return [...map.values()];
}

/**
 * Combines this device's data with the copy on GitHub. Nothing is lost: everything added anywhere is kept,
 * the newest edit of each item wins, and deletes are applied everywhere.
 */
export function mergeStates(local, remote) {
  if (!remote) return normalise(local);
  const a = normalise(local);
  const b = normalise(remote);
  const deleted = { ...b.deleted };
  for (const [id, at] of Object.entries(a.deleted)) deleted[id] = Math.max(deleted[id] || 0, at);
  const alive = (x) => !(deleted[x.id] && deleted[x.id] >= (x.updatedAt || 0));

  const entries = unionById(a.entries, b.entries).filter(alive);
  const debts = unionById(a.debts, b.debts, (x, y) => ({
    ...newer(x, y),
    payments: unionById(x.payments, y.payments).filter(alive),
  })).filter(alive);

  const goals = unionById(a.goals, b.goals).filter(alive);
  const settings = { ...b.settings, ...a.settings, stamps: {} };
  for (const k of SETTING_KEYS) {
    const ta = a.settings.stamps[k] || 0;
    const tb = b.settings.stamps[k] || 0;
    const va = a.settings[k] ?? null;
    const vb = b.settings[k] ?? null;
    let useB = tb > ta;
    if (ta === tb) useB = va === null ? vb !== null : vb !== null && JSON.stringify(vb) > JSON.stringify(va);
    settings[k] = useB ? vb : va;
    settings.stamps[k] = Math.max(ta, tb);
  }

  return normalise({
    ...b,
    ...a,
    schema: Math.max(a.schema, b.schema),
    entries,
    debts,
    goals,
    deleted,
    settings,
  });
}

/** The data in a fixed order, so two copies with the same content always look identical. */
export function canonical(state) {
  const s = normalise(state);
  const byId = (x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  const { version, ...rest } = s;
  return {
    ...rest,
    app: 'MoneyTrack',
    entries: [...s.entries].sort(byId),
    debts: s.debts.map((d) => ({ ...d, payments: [...d.payments].sort(byId) })).sort(byId),
    goals: [...s.goals].sort(byId),
    deleted: Object.fromEntries(Object.entries(s.deleted).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))),
  };
}

/** Asks the browser not to clear this site's data when space runs low. */
export async function askForPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    }
  } catch {
    /* not supported — fine */
  }
}

// ---------- Small helpers ----------

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export const round2 = (n) => Math.round(n * 100) / 100;

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Amount typing: digits and one decimal point, max two decimals.
export function sanitizeAmount(text) {
  let out = '';
  let seenSep = false;
  let decimals = 0;
  for (const ch of String(text)) {
    if (ch >= '0' && ch <= '9') {
      if (seenSep) {
        if (decimals >= 2) continue;
        decimals += 1;
      }
      out += ch;
    } else if ((ch === '.' || ch === ',') && !seenSep) {
      seenSep = true;
      if (!out) out = '0';
      out += '.';
    }
  }
  return out.slice(0, 12);
}

export function parseAmount(text) {
  const n = Number(String(text).trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

// ---------- Dates (stored as local YYYY-MM-DD strings) ----------

const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const todayISO = () => toISO(new Date());
export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
export const daysBetween = (fromIso, toIso) => Math.round((fromISO(toIso) - fromISO(fromIso)) / 86400000);
export const monthOf = (iso) => iso.slice(0, 7);
/** Monday of the week that contains `iso`. */
export function weekStart(iso) {
  const d = fromISO(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISO(d);
}
export function addMonths(ym, n) {
  let y = Number(ym.slice(0, 4));
  let m = Number(ym.slice(5, 7)) + n;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${pad(m)}`;
}

/** Next monthly due days on/after `fromIso`, keeping the anchor's day (31st → last day in short months). */
export function monthlyOccurrences(anchorIso, fromIso, count) {
  const start = anchorIso > fromIso ? anchorIso : fromIso;
  const day = Number(anchorIso.slice(8, 10));
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const out = [];
  for (let i = 0; i < count + 24 && out.length < count; i += 1) {
    const daysInMonth = new Date(y, m, 0).getDate();
    const iso = `${y}-${pad(m)}-${pad(Math.min(day, daysInMonth))}`;
    if (iso >= start) out.push(iso);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// ---------- Debt maths ----------

export const paidOf = (d) => round2(d.payments.reduce((s, p) => s + p.amount, 0));
export const remainingOf = (d) => Math.max(0, round2(d.amount - paidOf(d)));
export const progressOf = (d) => (d.amount > 0 ? Math.min(1, paidOf(d) / d.amount) : 0);

export function nextDue(debt, fromIso = todayISO()) {
  if (!debt.dueDate) return null;
  if (!debt.monthly) return debt.dueDate;
  return monthlyOccurrences(debt.dueDate, fromIso, 1)[0] || null;
}

/** Due status for an open debt, or null when it has no due date / is settled. */
export function dueInfo(debt) {
  if (debt.settled) return null;
  const next = nextDue(debt);
  if (!next) return null;
  const days = daysBetween(todayISO(), next);
  let text;
  if (days < 0) text = `Overdue by ${-days} day${days === -1 ? '' : 's'}`;
  else if (days === 0) text = 'Due today';
  else if (days === 1) text = 'Due tomorrow';
  else if (days <= 14) text = `Due in ${days} days`;
  else text = `Due ${fromISO(next).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  if (debt.monthly) text += ' · monthly';
  return { next, days, text, level: days < 0 ? 'overdue' : days <= 1 ? 'soon' : 'later' };
}

// ---------- Sample data (Settings → "Try it with sample data") ----------

export function sampleState(currency) {
  const t = todayISO();
  const laptop = `goal-sample-laptop-${uid()}`;
  const trip = `goal-sample-trip-${uid()}`;
  let n = 0;
  const saved = (daysAgo, amount, note = '') => ({
    id: uid(), kind: 'saved', amount, date: addDays(t, -daysAgo), category: 'other', note, createdAt: Date.now() - daysAgo * 86400000,
    goalId: daysAgo > 60 ? null : (n += 1) % 3 === 0 ? trip : laptop, sample: true,
  });
  const entries = [
    saved(0, 20), saved(1, 15, 'Coffee money I skipped'), saved(2, 50, 'Emergency fund'), saved(4, 25),
    saved(6, 40), saved(8, 30), saved(9, 100, 'Pay day'), saved(12, 20), saved(15, 35), saved(19, 60),
    saved(23, 100, 'Pay day'), saved(27, 25), saved(33, 45), saved(37, 100, 'Pay day'), saved(44, 30),
    saved(51, 100, 'Pay day'), saved(58, 20), saved(65, 100, 'Pay day'), saved(72, 40), saved(79, 100, 'Pay day'),
    saved(90, 55), saved(100, 100, 'Pay day'), saved(115, 70), saved(128, 100, 'Pay day'), saved(142, 35),
    saved(156, 100, 'Pay day'), saved(170, 50),
  ];
  const debts = [
    {
      id: uid(), name: 'Car loan', direction: 'iOwe', kind: 'loan', amount: 6000, startDate: addDays(t, -200),
      dueDate: addDays(t, 4), monthly: true, note: 'Monthly repayment', settled: false, settledDate: null,
      payments: [
        { id: uid(), amount: 400, date: addDays(t, -57), note: '' },
        { id: uid(), amount: 400, date: addDays(t, -26), note: '' },
      ],
      createdAt: Date.now(),
    },
    {
      id: uid(), name: 'Alex', direction: 'iOwe', kind: 'person', amount: 80, startDate: addDays(t, -10),
      dueDate: addDays(t, -1), monthly: false, note: 'Concert tickets', settled: false, settledDate: null,
      payments: [{ id: uid(), amount: 30, date: addDays(t, -3), note: '' }], createdAt: Date.now(),
    },
    {
      id: uid(), name: 'Priya', direction: 'owedToMe', kind: 'person', amount: 45, startDate: addDays(t, -6),
      dueDate: addDays(t, 2), monthly: false, note: 'Uber + dinner', settled: false, settledDate: null,
      payments: [], createdAt: Date.now(),
    },
    {
      id: uid(), name: 'Sam', direction: 'owedToMe', kind: 'person', amount: 120, startDate: addDays(t, -30),
      dueDate: null, monthly: false, note: '', settled: false, settledDate: null,
      payments: [{ id: uid(), amount: 40, date: addDays(t, -8), note: 'Bank transfer' }], createdAt: Date.now(),
    },
  ];
  for (const d of debts) d.sample = true;
  const goals = [
    { id: laptop, name: 'New laptop', target: 2000, dueDate: addDays(t, 90), startDate: addDays(t, -60), alreadySaved: 200, createdAt: Date.now(), sample: true },
    { id: trip, name: 'Holiday', target: 1200, dueDate: addDays(t, 150), startDate: addDays(t, -60), alreadySaved: 0, createdAt: Date.now() + 1, sample: true },
  ];
  return { ...emptyState(), entries, debts, goals, settings: { ...defaultSettings(), currency, defaultGoalId: laptop } };
}
