/**
 * 打开标签的闲置视图（按 lastAccessed）。
 * Dev/Canary 可选 chrome.processes 附带进程内存。
 */

import { isStashableTab } from './urls.js';
import { isRecord, optFiniteNumber } from './unknown.js';

export const DEFAULT_IDLE_MS = 30 * 60 * 1000;

export type UsageRow = {
  tabId: number
  windowId: number
  title: string
  url: string
  discarded: boolean
  active: boolean
  audible: boolean
  pinned: boolean
  lastAccessed: number | null
  idleMs: number | null
  bytes: number | null
  cpu: number | null
  sharedProcess: boolean
  suggestDiscard: boolean
}

export type TabUsageResult = {
  source: 'idle+processes' | 'idle'
  idleMs: number
  rows: UsageRow[]
  suggestedIds: number[]
}

export function formatBytes(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 小于 1e12（约 2001）含 0，不当访问时间。 */
const MIN_ACCESSED_MS = 1e12;

export function tabLastAccessedMs(tab: object | null | undefined): number | null {
  if (!tab) return null;
  const raw = optFiniteNumber((tab as { lastAccessed?: unknown }).lastAccessed);
  if (raw == null || raw < MIN_ACCESSED_MS) return null;
  return raw;
}

export function tabIdleMs(tab: object | null | undefined, now = Date.now()): number | null {
  const at = tabLastAccessedMs(tab);
  if (at == null) return null;
  return Math.max(0, now - at);
}

export function formatIdle(ms: number | null | undefined) {
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

type ProcessInfo = {
  type?: string
  privateMemory?: number
  cpu?: number
  tasks?: Array<{ tabId?: number }>
}

type ProcessesApi = {
  getProcessInfo: (processIds: number[], includeMemory: boolean) => Promise<unknown>
}

type ProcessMemOk = {
  ok: true
  map: Map<number, number>
  cpu: Map<number, number>
  shared: Set<number>
}

type ProcessMemFail = {
  ok: false
  map: Map<number, number>
  cpu: Map<number, number>
  shared: Set<number>
}

type ProcessMemInfo = ProcessMemOk | ProcessMemFail

function isProcessesApi(value: unknown): value is ProcessesApi {
  return isRecord(value) && typeof value.getProcessInfo === 'function'
}

function processesApi(): ProcessesApi | undefined {
  if (typeof chrome === 'undefined') return undefined
  const extra: unknown = Reflect.get(chrome, 'processes')
  return isProcessesApi(extra) ? extra : undefined
}

export function processesApiAvailable() {
  return !!processesApi()
}

/** 稳定版没有 chrome.processes，也不再写进清单（否则扩展页报错）。 */
export async function ensureProcessesPermission() {
  return processesApiAvailable();
}

function emptyMemInfo(): ProcessMemFail {
  return {
    ok: false,
    map: new Map<number, number>(),
    cpu: new Map<number, number>(),
    shared: new Set<number>(),
  }
}

function tabMeta(tab: chrome.tabs.Tab & { id: number }) {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title || tab.url || '无标题',
    url: tab.url || tab.pendingUrl || '',
    discarded: !!tab.discarded,
    active: !!tab.active,
    audible: !!tab.audible,
    pinned: !!tab.pinned,
    lastAccessed: tabLastAccessedMs(tab),
  };
}

/** 可休眠/关闭（排除钉住、有声、当前、已休眠） */
export function isActionableUsageRow(row: UsageRow | undefined) {
  return !!(row && !row.discarded && !row.active && !row.audible && !row.pinned);
}

/** 自动建议休眠 */
export function isDiscardCandidate(row: UsageRow | undefined, idleMs = DEFAULT_IDLE_MS) {
  if (!row || !isActionableUsageRow(row) || row.idleMs == null) return false
  return row.idleMs >= idleMs
}

function parseProcessInfo(value: unknown): ProcessInfo | null {
  if (!isRecord(value)) return null
  const tasksRaw = value.tasks
  const tasks: Array<{ tabId?: number }> = []
  if (Array.isArray(tasksRaw)) {
    for (const task of tasksRaw) {
      if (!isRecord(task)) continue
      tasks.push(typeof task.tabId === 'number' ? { tabId: task.tabId } : {})
    }
  }
  return {
    type: typeof value.type === 'string' ? value.type : undefined,
    privateMemory: typeof value.privateMemory === 'number' ? value.privateMemory : undefined,
    cpu: typeof value.cpu === 'number' ? value.cpu : undefined,
    tasks,
  }
}

async function attachProcessMemory(): Promise<ProcessMemInfo> {
  if (!processesApiAvailable()) return emptyMemInfo();
  try {
    const api = processesApi()
    if (!api) return emptyMemInfo()
    const processes: unknown = await api.getProcessInfo([], true)
    const memByTab = new Map<number, number>()
    const cpuByTab = new Map<number, number>()
    const shared = new Set<number>()
    if (!isRecord(processes)) return emptyMemInfo()
    for (const raw of Object.values(processes)) {
      const p = parseProcessInfo(raw)
      if (!p || p.type !== 'renderer' || p.privateMemory == null) continue;
      const tabIds = (p.tasks || [])
        .map((t) => t.tabId)
        .filter((id): id is number => typeof id === 'number');
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
export async function collectTabUsage(opts: {
  currentWindowOnly?: boolean
  idleMs?: number
  preferProcesses?: boolean
} = {}): Promise<TabUsageResult> {
  const {
    currentWindowOnly = false,
    idleMs = DEFAULT_IDLE_MS,
    preferProcesses = false,
  } = opts;
  const now = Date.now();
  const tabs = await chrome.tabs.query(currentWindowOnly ? { currentWindow: true } : {});
  const candidates = tabs.filter(
    (t): t is chrome.tabs.Tab & { id: number } =>
      typeof t.id === 'number' && (isStashableTab(t) || !!t.discarded),
  )

  const memInfo =
    preferProcesses && processesApiAvailable() ? await attachProcessMemory() : emptyMemInfo();

  const rows = candidates.map((tab) => {
    const base = tabMeta(tab);
    const idleMsVal = tabIdleMs(tab, now);
    const row: UsageRow = {
      ...base,
      idleMs: idleMsVal,
      bytes: memInfo.map.get(tab.id) ?? null,
      cpu: memInfo.cpu.get(tab.id) ?? null,
      sharedProcess: memInfo.shared.has(tab.id),
      suggestDiscard: false,
    }
    row.suggestDiscard = isDiscardCandidate(row, idleMs)
    return row
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

export async function discardTabsByIds(tabIds: number[]) {
  const ids = (tabIds || []).filter((id) => typeof id === 'number');
  let n = 0;
  for (let i = 0; i < ids.length; i += DISCARD_CHUNK) {
    const chunk = ids.slice(i, i + DISCARD_CHUNK);
    const settled = await Promise.allSettled(chunk.map((id) => chrome.tabs.discard(id)));
    n += settled.filter((r) => r.status === 'fulfilled').length;
  }
  return n;
}

export async function closeTabsByIds(tabIds: number[]) {
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
