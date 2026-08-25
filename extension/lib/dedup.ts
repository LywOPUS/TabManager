/**
 * 网页去重：
 * - 已收纳会话：删掉重复 StashedTab，优先保留主题组中的一份
 * - 打开的标签：关闭重复 tab，优先保留当前激活 / 最近访问的一份
 *
 * 网址归一：忽略尾斜杠、www.、主机名大小写；保留 hash / query / 非默认端口
 *（hash 路由与锚点页不当重复）。
 */
import { newId, type Group, type Session, type StoreData } from './storage.js';
import {
  ensureFixedGroups,
  isReadLaterName,
  isUngroupedName,
  pruneEmptyKeepFixed,
} from './groupNames.js';
import { tabLastAccessedMs } from './tabUsage.js';
import { isStashableTab } from './urls.js';

export type StashDupeLoc = { sessionId: string; sessionName: string; tabId: string; title: string; url: string }
export type StashDupeGroup = { key: string; keep: StashDupeLoc; items: StashDupeLoc[] }
export type OpenDupeLoc = { tabId: number; windowId: number; title: string; url: string; active: boolean }
export type OpenDupeGroup = { key: string; keep: OpenDupeLoc; items: OpenDupeLoc[] }

type OpenTabOpts = { currentWindowOnly?: boolean }

export function normalizeUrlForDedup(raw: string | undefined) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // 用 host（含非默认端口），避免 localhost:8080 与 :9090 被误合并
    let host = (u.host || u.hostname).replace(/\.$/, '').toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    let path = u.pathname || '/';
    if (path.length > 1) path = path.replace(/\/+$/, '');
    return `${u.protocol}//${host}${path}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

/** 同会话内扫描顺序：主题 → 未分组 → 稍后阅读（首次出现为 keep） */
function groupsForDedupKeep(groups: Group[] | undefined) {
  const readLater: Group[] = [];
  const ungrouped: Group[] = [];
  const rest: Group[] = [];
  for (const g of groups || []) {
    if (isReadLaterName(g.name)) readLater.push(g);
    else if (isUngroupedName(g.name)) ungrouped.push(g);
    else rest.push(g);
  }
  return [...rest, ...ungrouped, ...readLater];
}

/**
 * 保留规则：会话按数组顺序（通常 newest-first）；同会话优先保留主题组中的副本。
 */
export function findDuplicates(data: Pick<StoreData, 'sessions'> | { sessions?: Session[] }): StashDupeGroup[] {
  const seen = new Map<string, StashDupeLoc>();
  const dupeGroups = new Map<string, StashDupeGroup>();
  const sessions = [...(data.sessions || [])];
  for (const session of sessions) {
    for (const g of groupsForDedupKeep(session.groups || [])) {
      for (const t of g.tabs || []) {
        const key = normalizeUrlForDedup(t.url);
        if (!key) continue;
        const loc: StashDupeLoc = {
          sessionId: session.id,
          sessionName: session.name,
          tabId: t.id,
          title: t.title,
          url: t.url,
        };
        const prev = seen.get(key);
        if (!prev) {
          seen.set(key, loc);
          continue;
        }
        let group = dupeGroups.get(key);
        if (!group) {
          group = { key, keep: prev, items: [] };
          dupeGroups.set(key, group);
        }
        group.items.push(loc);
      }
    }
  }
  return [...dupeGroups.values()];
}

/** 从 data 中删除 dupeGroups 里的重复标签（就地修改），返回删除数 */
export function removeDuplicates(data: Pick<StoreData, 'sessions'>, dupeGroups: StashDupeGroup[]) {
  const removeBySession = new Map<string, Set<string>>();
  let count = 0;
  for (const dg of dupeGroups) {
    for (const d of dg.items) {
      count += 1;
      let ids = removeBySession.get(d.sessionId);
      if (!ids) {
        ids = new Set<string>();
        removeBySession.set(d.sessionId, ids);
      }
      ids.add(d.tabId);
    }
  }
  for (const session of data.sessions) {
    const ids = removeBySession.get(session.id);
    if (!ids) continue;
    for (const g of session.groups) g.tabs = g.tabs.filter((t) => !ids.has(t.id));
    pruneEmptyKeepFixed(session);
    ensureFixedGroups(session, { newId });
  }
  return count;
}

function hasTabId(tab: chrome.tabs.Tab): tab is chrome.tabs.Tab & { id: number } {
  return typeof tab.id === 'number';
}

/**
 * 打开标签中的重复（默认全部窗口）。
 */
export async function findOpenTabDuplicates(opts: OpenTabOpts = {}): Promise<OpenDupeGroup[]> {
  const { currentWindowOnly = false } = opts;
  const tabs = await chrome.tabs.query(currentWindowOnly ? { currentWindow: true } : {});
  const byKey = new Map<string, chrome.tabs.Tab[]>();
  for (const tab of tabs) {
    if (!isStashableTab(tab) || !hasTabId(tab)) continue;
    const key = normalizeUrlForDedup(tab.url || tab.pendingUrl);
    if (!key) continue;
    let list = byKey.get(key);
    if (!list) {
      list = [];
      byKey.set(key, list);
    }
    list.push(tab);
  }

  const groups: OpenDupeGroup[] = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    list.sort(compareOpenTabsForKeep);
    const keepTab = list[0];
    if (!keepTab || !hasTabId(keepTab)) continue;
    const keep = openTabLoc(keepTab);
    const items = list.slice(1).filter(hasTabId).map(openTabLoc);
    groups.push({ key, keep, items });
  }
  groups.sort((a, b) => b.items.length - a.items.length || a.keep.title.localeCompare(b.keep.title, 'zh'));
  return groups;
}

function openTabLoc(tab: chrome.tabs.Tab & { id: number }): OpenDupeLoc {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title || tab.url || '无标题',
    url: tab.url || tab.pendingUrl || '',
    active: !!tab.active,
  };
}

/** 保留优先级：当前激活 > 最近访问 > 更靠左的标签 */
function compareOpenTabsForKeep(a: chrome.tabs.Tab, b: chrome.tabs.Tab) {
  if (a.active !== b.active) return a.active ? -1 : 1;
  const la = tabLastAccessedMs(a) || 0;
  const lb = tabLastAccessedMs(b) || 0;
  if (la !== lb) return lb - la;
  return (a.index ?? 0) - (b.index ?? 0);
}

/** 关闭打开标签的重复份，返回关闭数量 */
export async function closeOpenTabDuplicates(dupeGroups: OpenDupeGroup[] | undefined) {
  const ids: number[] = [];
  for (const g of dupeGroups || []) {
    for (const d of g.items || []) {
      if (typeof d.tabId === 'number') ids.push(d.tabId);
    }
  }
  if (!ids.length) return 0;
  // 分批：一次 remove 过多可能失败
  const CHUNK = 20;
  let closed = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    try {
      await chrome.tabs.remove(chunk);
      closed += chunk.length;
    } catch (e) {
      console.warn('closeOpenTabDuplicates partial', e);
      for (const id of chunk) {
        try {
          await chrome.tabs.remove(id);
          closed += 1;
        } catch {
          /* tab 可能已关 */
        }
      }
    }
  }
  return closed;
}
