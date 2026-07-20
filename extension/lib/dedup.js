/**
 * 网页去重：只有完全相同的网址（逐字一致）才算重复。
 * 保留扫描顺序中第一份（sessions 新的在前 → 保留最新收纳的那份）。
 */
import { newId } from './storage.js';

export function normalizeUrlForDedup(raw) {
  const s = String(raw || '');
  return /^https?:\/\//i.test(s) ? s : null;
}

/**
 * @returns [{ key, keep: {sessionId, sessionName, tabId, title, url},
 *             items: [{sessionId, sessionName, tabId, title, url}] }]
 */
export function findDuplicates(data) {
  const seen = new Map();
  const dupeGroups = new Map();
  for (const session of data.sessions) {
    for (const g of session.groups) {
      for (const t of g.tabs) {
        const key = normalizeUrlForDedup(t.url);
        if (!key) continue;
        const loc = {
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
        if (!dupeGroups.has(key)) dupeGroups.set(key, { key, keep: prev, items: [] });
        dupeGroups.get(key).items.push(loc);
      }
    }
  }
  return [...dupeGroups.values()];
}

/** 从 data 中删除 dupeGroups 里的重复标签（就地修改），返回删除数 */
export function removeDuplicates(data, dupeGroups) {
  const removeBySession = new Map();
  let count = 0;
  for (const dg of dupeGroups) {
    for (const d of dg.items) {
      count += 1;
      if (!removeBySession.has(d.sessionId)) removeBySession.set(d.sessionId, new Set());
      removeBySession.get(d.sessionId).add(d.tabId);
    }
  }
  for (const session of data.sessions) {
    const ids = removeBySession.get(session.id);
    if (!ids) continue;
    for (const g of session.groups) g.tabs = g.tabs.filter((t) => !ids.has(t.id));
    session.groups = session.groups.filter((g) => g.tabs.length > 0);
    if (!session.groups.length) session.groups = [{ id: newId(), name: '未分组', tabs: [] }];
  }
  return count;
}
