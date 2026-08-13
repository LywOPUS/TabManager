/**
 * 打开标签的闲置视图（按 lastAccessed）。
 * Dev/Canary 可选 chrome.processes 附带进程内存。
 */

import { isStashableTab } from './urls.js';

export const DEFAULT_IDLE_MS = 30 * 60 * 1000;

export function formatBytes(n) {
  if (n == null || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatIdle(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const m = Math.floor(ms / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

/** 文案用：默认闲置阈值（分钟） */
export function defaultIdleMinutes() {
  return Math.round(DEFAULT_IDLE_MS / 60000);
}

export function processesApiAvailable() {
  return typeof chrome !== 'undefined' && !!chrome.processes?.getProcessInfo;
}

/** 申请 optional processes；失败返回 false（走纯 idle） */
export async function ensureProcessesPermission() {
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) return false;
  try {
    if (await chrome.permissions.contains({ permissions: ['processes'] })) {
      return processesApiAvailable();
    }
    const granted = await chrome.permissions.request({ permissions: ['processes'] });
    return !!granted && processesApiAvailable();
  } catch {
    return false;
  }
}

function emptyMemInfo() {
  return { ok: false, map: new Map(), cpu: new Map(), shared: new Set() };
}

function tabMeta(tab) {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title || tab.url || '无标题',
    url: tab.url || tab.pendingUrl || '',
    discarded: !!tab.discarded,
    active: !!tab.active,
    audible: !!tab.audible,
    pinned: !!tab.pinned,
    lastAccessed: typeof tab.lastAccessed === 'number' ? tab.lastAccessed : null,
  };
}

/** 可休眠/关闭（排除钉住、有声、当前、已休眠） */
export function isActionableUsageRow(row) {
  return !!(row && !row.discarded && !row.active && !row.audible && !row.pinned);
}

/** 自动建议休眠 */
export function isDiscardCandidate(row, idleMs = DEFAULT_IDLE_MS) {
  if (!isActionableUsageRow(row) || row.idleMs == null) return false;
  return row.idleMs >= idleMs;
}

async function attachProcessMemory() {
  if (!processesApiAvailable()) return emptyMemInfo();
  try {
    const processes = await chrome.processes.getProcessInfo([], true);
    const memByTab = new Map();
    const cpuByTab = new Map();
    const shared = new Set();
    for (const p of Object.values(processes || {})) {
      if (!p || p.type !== 'renderer' || p.privateMemory == null) continue;
      const tabIds = (p.tasks || [])
        .map((t) => t.tabId)
        .filter((id) => typeof id === 'number');
      if (!tabIds.length) continue;
      const each = p.privateMemory / tabIds.length;
      for (const id of tabIds) {
        memByTab.set(id, each);
        if (typeof p.cpu === 'number') cpuByTab.set(id, p.cpu);
        if (tabIds.length > 1) shared.add(id);
      }
    }
    return { ok: true, map: memByTab, cpu: cpuByTab, shared };
  } catch {
    return emptyMemInfo();
  }
}

/**
 * @param {{ currentWindowOnly?: boolean, idleMs?: number, preferProcesses?: boolean }} [opts]
 */
export async function collectTabUsage(opts = {}) {
  const {
    currentWindowOnly = false,
    idleMs = DEFAULT_IDLE_MS,
    preferProcesses = false,
  } = opts;
  const now = Date.now();
  const tabs = await chrome.tabs.query(currentWindowOnly ? { currentWindow: true } : {});
  const candidates = tabs.filter((t) => typeof t.id === 'number' && (isStashableTab(t) || t.discarded));

  const memInfo =
    preferProcesses && processesApiAvailable() ? await attachProcessMemory() : emptyMemInfo();

  const rows = candidates.map((tab) => {
    const base = tabMeta(tab);
    const idleMsVal =
      base.lastAccessed != null ? Math.max(0, now - base.lastAccessed) : null;
    const row = {
      ...base,
      idleMs: idleMsVal,
      bytes: memInfo.map.get(tab.id) ?? null,
      cpu: memInfo.cpu.get(tab.id) ?? null,
      sharedProcess: memInfo.shared.has(tab.id),
    };
    row.suggestDiscard = isDiscardCandidate(row, idleMs);
    return row;
  });

  rows.sort((a, b) => {
    if (a.discarded !== b.discarded) return a.discarded ? 1 : -1;
    if (a.suggestDiscard !== b.suggestDiscard) return a.suggestDiscard ? -1 : 1;
    if (memInfo.ok && a.bytes != null && b.bytes != null && a.bytes !== b.bytes) {
      return b.bytes - a.bytes;
    }
    return (b.idleMs || 0) - (a.idleMs || 0);
  });

  return {
    source: memInfo.ok ? 'idle+processes' : 'idle',
    idleMs,
    rows,
    suggestedIds: rows.filter((r) => r.suggestDiscard).map((r) => r.tabId),
  };
}

const DISCARD_CHUNK = 12;

export async function discardTabsByIds(tabIds) {
  const ids = (tabIds || []).filter((id) => typeof id === 'number');
  let n = 0;
  for (let i = 0; i < ids.length; i += DISCARD_CHUNK) {
    const chunk = ids.slice(i, i + DISCARD_CHUNK);
    const settled = await Promise.allSettled(chunk.map((id) => chrome.tabs.discard(id)));
    n += settled.filter((r) => r.status === 'fulfilled').length;
  }
  return n;
}

export async function closeTabsByIds(tabIds) {
  const ids = (tabIds || []).filter((id) => typeof id === 'number');
  if (!ids.length) return 0;
  try {
    await chrome.tabs.remove(ids);
    return ids.length;
  } catch {
    let n = 0;
    for (const id of ids) {
      try {
        await chrome.tabs.remove(id);
        n += 1;
      } catch {
        /* tab 可能已关 */
      }
    }
    return n;
  }
}
