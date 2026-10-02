// Data, saving, and small helpers. Everything is stored in this browser (localStorage).

export const STORAGE_KEY = 'moneytrack.v1';
export const APP_VERSION = '1.0.0';

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

function defaultSettings() {
  return { currency: 'AUD', remindDays: 7, theme: 'system' };
}

function emptyState() {
  return { version: 1, entries: [], debts: [], settings: defaultSettings() };
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Cleans up anything loaded from storage or a backup file so the app never crashes on odd data. */
export function normalise(data) {
  const base = emptyState();
  if (!data || typeof data !== 'object') return base;
  const entries = (Array.isArray(data.entries) ? data.entries : [])
    .filter((e) => e && (e.kind === 'spent' || e.kind === 'saved') && isISODate(e.date))
    .map((e) => ({
      id: String(e.id || uid()),
      kind: e.kind,
      amount: round2(Math.abs(num(e.amount))),
      date: e.date,
      category: CAT[e.category] ? e.category : 'other',
      note: String(e.note || '').slice(0, 120),
      createdAt: num(e.createdAt) || Date.now(),
    }))
    .filter((e) => e.amount > 0);

  const debts = (Array.isArray(data.debts) ? data.debts : [])
    .filter((d) => d && typeof d.name === 'string')
    .map((d) => ({
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
        .filter((p) => p && isISODate(p.date))
        .map((p) => ({
          id: String(p.id || uid()),
          amount: round2(Math.abs(num(p.amount))),
          date: p.date,
          note: String(p.note || '').slice(0, 120),
        }))
        .filter((p) => p.amount > 0),
      createdAt: num(d.createdAt) || Date.now(),
    }));

  const s = data.settings && typeof data.settings === 'object' ? data.settings : {};
  const settings = {
    currency: CURRENCIES.includes(s.currency) || /^[A-Z]{3}$/.test(s.currency || '') ? s.currency : base.settings.currency,
    remindDays: [1, 3, 7, 14, 30].includes(Number(s.remindDays)) ? Number(s.remindDays) : 7,
    theme: ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system',
  };
  return { version: 1, entries, debts, settings };
}

export let storageWorks = true;

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalise(JSON.parse(raw)) : emptyState();
  } catch (err) {
    console.warn('Could not load saved data', err);
    storageWorks = false;
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

// ---------- Sample data (Settings → "Try with sample data") ----------

export function sampleState(currency) {
  const t = todayISO();
  const e = (daysAgo, kind, amount, category, note = '') => ({
    id: uid(), kind, amount, date: addDays(t, -daysAgo), category, note, createdAt: Date.now() - daysAgo * 86400000,
  });
  const entries = [
    e(0, 'spent', 14.5, 'food', 'Lunch'),
    e(0, 'saved', 20, 'other'),
    e(1, 'spent', 62.3, 'groceries'),
    e(1, 'spent', 4.6, 'transport', 'Myki top-up'),
    e(2, 'spent', 18, 'fun', 'Movie'),
    e(2, 'saved', 50, 'other', 'Emergency fund'),
    e(3, 'spent', 9.9, 'food', 'Coffee + snack'),
    e(4, 'spent', 120, 'bills', 'Phone + internet'),
    e(5, 'spent', 35, 'shopping'),
    e(5, 'saved', 25, 'other'),
    e(6, 'spent', 22, 'food', 'Dinner with friends'),
    e(9, 'spent', 450, 'rent', 'Rent'),
    e(12, 'saved', 100, 'other', 'Pay day savings'),
    e(16, 'spent', 75, 'study', 'Textbook'),
    e(24, 'spent', 48, 'health'),
    e(33, 'spent', 450, 'rent', 'Rent'),
    e(35, 'saved', 150, 'other'),
    e(40, 'spent', 210, 'groceries'),
    e(62, 'spent', 380, 'travel', 'Weekend trip'),
    e(64, 'saved', 120, 'other'),
    e(95, 'spent', 160, 'gifts'),
    e(97, 'saved', 200, 'other'),
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
  return { version: 1, entries, debts, settings: { ...defaultSettings(), currency } };
}
