/**
 * 建议关闭：从打开的标签里挑出「可以安全关闭」的，用户勾选后批量关闭。
 * 信号 = 启发式（已收纳 / 重复打开 / 已休眠 / 闲置）。
 * 浏览器内小模型是 embedding 聚类，判断不了「重要性」，故本功能不走模型。
 * 在扩展页面上下文（popup / 侧栏）调用。
 */
import { normalizeUrlForDedup } from './dedup.js'
import { getData, type StoreData } from './storage.js'
import { formatIdle, tabIdleMs, tabLastAccessedMs } from './tabUsage.js'
import { isStashableTab } from './urls.js'

/** 闲置多久算「可关」 */
export const CLOSE_IDLE_MS = 60 * 60 * 1000

export type ClosableTab = {
  tabId: number
  windowId: number
  title: string
  url: string
  favIconUrl?: string
  idleMs: number | null
  discarded: boolean
  reasons: string[]
}

export type ClosableTabsResult = {
  rows: ClosableTab[]
  actionableCount: number
}

/** 已收纳会话里的全部网址（去重归一化后） */
function stashedUrlKeys(data: StoreData) {
  const keys = new Set<string>()
  for (const s of data?.sessions || []) {
    for (const g of s.groups || []) {
      for (const t of g.tabs || []) {
        const k = normalizeUrlForDedup(t.url);
        if (k) keys.add(k);
      }
    }
  }
  return keys;
}

/**
 * 收集全部窗口里「可考虑关闭」的标签，附上启发式理由。
 * 永不包含：钉住 / 有声 / 各窗口当前激活标签。
 * 返回 { rows, actionableCount }；rows 含无理由标签（供勾选），按建议强度排序。
 */
export async function collectClosableTabs(opts: { idleMs?: number } = {}): Promise<ClosableTabsResult> {
  const { idleMs: idleThreshold = CLOSE_IDLE_MS } = opts;
  const now = Date.now();
  const [tabs, data] = await Promise.all([chrome.tabs.query({}), getData()]);
  const stashed = stashedUrlKeys(data);

  const actionable = tabs.filter(
    (t): t is chrome.tabs.Tab & { id: number } =>
      typeof t.id === 'number' && isStashableTab(t) && !t.audible && !t.active,
  )

  // 重复打开：同 URL 多份，保留最近访问的一份，其余标记
  const byKey = new Map<string, Array<chrome.tabs.Tab & { id: number }>>()
  for (const t of actionable) {
    const k = normalizeUrlForDedup(t.url || t.pendingUrl);
    if (!k) continue;
    const arr = byKey.get(k) || [];
    arr.push(t);
    byKey.set(k, arr);
  }
  const dupeIds = new Set<number>()
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) => (tabLastAccessedMs(b) || 0) - (tabLastAccessedMs(a) || 0));
    for (const t of sorted.slice(1)) dupeIds.add(t.id)
  }

  const rows = actionable.map((t) => {
    const url = t.url || t.pendingUrl || '';
    const idleMs = tabIdleMs(t, now);
    const reasons: string[] = []
    if (dupeIds.has(t.id)) reasons.push('重复打开')
    const k = normalizeUrlForDedup(url);
    if (k && stashed.has(k)) reasons.push('已收纳');
    if (t.discarded) reasons.push('已休眠');
    else if (idleMs != null && idleMs >= idleThreshold) {
      reasons.push(`闲置 ${formatIdle(idleMs)}`);
    }
    return {
      tabId: t.id,
      windowId: t.windowId,
      title: t.title || url || '无标题',
      url,
      favIconUrl: t.favIconUrl || '',
      idleMs,
      discarded: !!t.discarded,
      reasons,
    };
  });

  rows.sort((a, b) => {
    if (a.reasons.length !== b.reasons.length) return b.reasons.length - a.reasons.length;
    return (b.idleMs || 0) - (a.idleMs || 0);
  });
  return { rows, actionableCount: rows.length };
}
