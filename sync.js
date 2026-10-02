// GitHub sync: keeps a copy of your data in a private repository in your own GitHub account.
// Every change is merged with that copy, so data added on any device (or after the browser
// forgot everything) comes back, and nothing is overwritten by an older copy.
import { SCHEMA, canonical, mergeStates, normalise } from './store.js';

const CONFIG_KEY = 'moneytrack.sync';
const API = 'https://api.github.com';
export const DEFAULT_REPO = 'money-tracker-data';
export const DATA_PATH = 'moneytrack-data.json';

/** The GitHub user that owns this site (s226098883-hue.github.io → s226098883-hue). */
export function siteOwner() {
  const h = location.hostname;
  return h.endsWith('.github.io') ? h.slice(0, -'.github.io'.length) : '';
}

/** Link to GitHub's "new access key" page with the name, expiry and permission already filled in. */
export function newKeyURL(owner = siteOwner()) {
  const params = new URLSearchParams({
    name: 'MoneyTrack sync',
    description: 'Lets the MoneyTrack app save your data to your private money-tracker-data repository.',
    expires_in: '366',
    contents: 'write',
  });
  if (owner) params.set('target_name', owner);
  return `https://github.com/settings/personal-access-tokens/new?${params}`;
}

export function loadConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (c && c.token && c.owner && c.repo) return c;
  } catch {
    /* ignore */
  }
  return null;
}

function saveConfig(c) {
  try {
    if (c) localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* ignore */
  }
}

/** Accepts "repo", "owner/repo" or a full github.com link. */
export function parseRepo(text, fallbackOwner = siteOwner()) {
  const clean = String(text || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length === 1 && fallbackOwner) return { owner: fallbackOwner, repo: parts[0] };
  if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
  return null;
}

class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'offline' | 'auth' | 'access' | 'missing' | 'public' | 'newer' | 'conflict' | 'other'
  }
}

// ---------- Text <-> base64 (works with emoji and any language) ----------

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function deviceName() {
  const ua = navigator.userAgent;
  const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  let name = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Macintosh/.test(ua) ? (navigator.maxTouchPoints > 1 ? 'iPad' : 'Mac') : /Windows/.test(ua) ? 'Windows' : 'a browser';
  if (standalone) name += ' (Home Screen app)';
  return name;
}

// ---------- GitHub API ----------

async function gh(cfg, method, path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${cfg.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SyncError('offline', "Can't reach GitHub right now. Your changes are saved on this device and will upload when you're back online.");
  }
  if (res.status === 401) {
    throw new SyncError('auth', 'GitHub did not accept the access key. It may have expired or been deleted — make a new key and connect again.');
  }
  if (res.status === 403 || res.status === 429) {
    if (res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429) {
      throw new SyncError('offline', 'GitHub asked us to slow down. Sync will try again in a few minutes.');
    }
    if (method !== 'GET') {
      throw new SyncError('access', `The key can read but can't save. Give it “Contents: Read and write” access to ${cfg.repo}.`);
    }
    throw new SyncError('access', `The key isn't allowed to open ${cfg.owner}/${cfg.repo}. When you make the key, choose this repository under “Only select repositories”.`);
  }
  if (res.status >= 500) throw new SyncError('offline', 'GitHub is having trouble right now. Sync will try again soon.');
  return res;
}

async function checkRepo(cfg) {
  const res = await gh(cfg, 'GET', `/repos/${cfg.owner}/${cfg.repo}`);
  if (res.status === 404) {
    throw new SyncError('missing', `Can't find ${cfg.owner}/${cfg.repo}, or the key wasn't given access to it.`);
  }
  if (!res.ok) throw new SyncError('other', `GitHub said “${res.status}” when opening the repository.`);
  const info = await res.json();
  if (info.private === false) {
    throw new SyncError('public', `${cfg.owner}/${cfg.repo} is public, so anyone could see your money data. Use a private repository.`);
  }
  return info;
}

async function getRemote(cfg) {
  const res = await gh(cfg, 'GET', `/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`);
  if (res.status === 404) {
    await checkRepo(cfg); // tells "repository missing" apart from "file not created yet"
    return { data: null, sha: null };
  }
  if (!res.ok) throw new SyncError('other', `GitHub said “${res.status}” when reading your data.`);
  const file = await res.json();
  let text;
  if (file.content && file.encoding === 'base64') {
    text = fromBase64(file.content);
  } else {
    // Files over 1 MB come without content — fetch them as a blob instead.
    const blobRes = await gh(cfg, 'GET', `/repos/${cfg.owner}/${cfg.repo}/git/blobs/${file.sha}`);
    if (!blobRes.ok) throw new SyncError('other', `GitHub said “${blobRes.status}” when reading your data.`);
    text = fromBase64((await blobRes.json()).content);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SyncError('other', `${cfg.path} on GitHub isn't valid MoneyTrack data, so sync paused to protect it.`);
  }
  if (Number(data.schema) > SCHEMA) {
    throw new SyncError('newer', 'Your data was saved by a newer version of MoneyTrack. Close and reopen the app to update it.');
  }
  return { data, sha: file.sha };
}

async function putRemote(cfg, text, sha) {
  const res = await gh(cfg, 'PUT', `/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`, {
    message: `MoneyTrack update from ${deviceName()}`,
    content: toBase64(text),
    ...(sha ? { sha } : {}),
  });
  if (res.status === 409 || res.status === 422) throw new SyncError('conflict', 'Someone else saved at the same time.');
  if (res.status === 404) throw new SyncError('missing', `Can't find ${cfg.owner}/${cfg.repo}, or the key wasn't given access to it.`);
  if (!res.ok) throw new SyncError('other', `GitHub said “${res.status}” when saving your data.`);
  const out = await res.json();
  return out.content && out.content.sha;
}

// ---------- Sync engine ----------

/**
 * getState(): the app's current data
 * applyState(next): replace the app's data with the merged copy (and save + redraw)
 * onStatus(status): called whenever the status line should change
 */
export function createSync({ getState, applyState, onStatus }) {
  let cfg = loadConfig();
  let running = null;
  let again = false;
  let timer = null;
  let status = cfg
    ? { kind: cfg.lastError ? cfg.lastError.kind : 'ok', message: cfg.lastError ? cfg.lastError.message : '', lastSyncAt: cfg.lastSyncAt || 0 }
    : { kind: 'off', message: '', lastSyncAt: 0 };

  const setStatus = (next) => {
    status = { ...status, ...next };
    onStatus(status);
  };

  async function syncOnce(conf) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const remote = await getRemote(conf);
      // Merge with whatever is on screen right now (the user may have changed something while we waited).
      const merged = mergeStates(getState(), remote.data);
      const mergedText = JSON.stringify(canonical(merged), null, 1);
      const localText = JSON.stringify(canonical(getState()), null, 1);
      if (mergedText !== localText) applyState(merged);
      const remoteText = remote.data ? JSON.stringify(canonical(normalise(remote.data)), null, 1) : null;
      if (remoteText === mergedText) return;
      try {
        await putRemote(conf, `${mergedText}\n`, remote.sha);
        return;
      } catch (err) {
        if (err.kind !== 'conflict') throw err;
        await new Promise((r) => setTimeout(r, 400 + attempt * 600)); // someone else saved — read again and merge
      }
    }
    throw new SyncError('offline', 'GitHub was busy saving another change. Sync will try again soon.');
  }

  async function run() {
    if (!cfg) return;
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      setStatus({ kind: 'syncing', message: '' });
      try {
        do {
          again = false;
          await syncOnce(cfg);
        } while (again);
        cfg.lastSyncAt = Date.now();
        cfg.lastError = null;
        saveConfig(cfg);
        setStatus({ kind: 'ok', message: '', lastSyncAt: cfg.lastSyncAt });
      } catch (err) {
        const kind = err.kind || 'other';
        const message = err.message || 'Sync stopped.';
        if (cfg) {
          cfg.lastError = kind === 'offline' ? null : { kind, message };
          saveConfig(cfg);
        }
        setStatus({ kind, message });
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    get config() { return cfg; },
    get status() { return status; },
    isOn: () => Boolean(cfg),

    /** Sync a moment after a change (several quick changes become one upload). */
    soon(delay = 1200) {
      if (!cfg) return;
      clearTimeout(timer);
      timer = setTimeout(() => { timer = null; run(); }, delay);
    },
    now() {
      clearTimeout(timer);
      timer = null;
      return run();
    },
    hasPending: () => Boolean(timer),

    /** Checks the key and repository, then does the first sync. Throws a friendly error if something's wrong. */
    async connect({ token, owner, repo }) {
      const test = { token: token.trim(), owner, repo, path: DATA_PATH };
      await checkRepo(test);
      await syncOnce(test); // proves the key can read and save before we keep it
      cfg = { ...test, connectedAt: Date.now(), lastSyncAt: Date.now(), lastError: null };
      saveConfig(cfg);
      setStatus({ kind: 'ok', message: '', lastSyncAt: cfg.lastSyncAt });
    },

    disconnect() {
      clearTimeout(timer);
      timer = null;
      cfg = null;
      saveConfig(null);
      setStatus({ kind: 'off', message: '', lastSyncAt: 0 });
    },
  };
}
