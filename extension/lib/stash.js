import { isRestorableUrl, isStashableTab } from './urls.js';
import { addSession, defaultSessionName, newId } from './storage.js';
import { READ_LATER_NAME, UNGROUPED_NAME } from './groupNames.js';

function tabToStashed(tab) {
  return {
    id: newId(),
    title: tab.title || tab.url || '无标题',
    url: tab.url || tab.pendingUrl,
    favIconUrl: tab.favIconUrl || undefined,
  };
}

export function buildSessionFromTabs(tabs, name) {
  const stashed = tabs.map(tabToStashed);
  return {
    id: newId(),
    name: name || defaultSessionName(),
    createdAt: Date.now(),
    groups: [
      { id: newId(), name: READ_LATER_NAME, tabs: [] },
      { id: newId(), name: UNGROUPED_NAME, tabs: stashed },
    ],
  };
}

export async function collectStashableTabs(query) {
  const tabs = await chrome.tabs.query(query);
  return tabs.filter(isStashableTab);
}

/** 先写 storage 再关标签；本批内逐字重复的网址跳过（不查历史，同一网址可多次收纳）；file: 等无法恢复的网址跳过 */
export async function stashTabs(tabs, sessionName) {
  if (!tabs.length) return { ok: false, reason: 'empty' };
  const seen = new Set();
  const keep = [];
  let skipped = 0;
  let skippedUnrestorable = 0;
  for (const tab of tabs) {
    const url = tab.url || tab.pendingUrl;
    if (url && !isRestorableUrl(url)) {
      skippedUnrestorable += 1;
      continue;
    }
    if (url && seen.has(url)) {
      skipped += 1;
      continue;
    }
    if (url) seen.add(url);
    keep.push(tab);
  }
  if (!keep.length) {
    return { ok: false, reason: skippedUnrestorable && !skipped ? 'all_unrestorable' : 'all_dupe', skipped, skippedUnrestorable };
  }
  const session = buildSessionFromTabs(keep, sessionName);
  await addSession(session);
  await chrome.tabs.remove(keep.map((t) => t.id));
  return { ok: true, session, count: keep.length, skipped, skippedUnrestorable };
}

/**
 * 默认留下当前页，避免整窗被收空、弹窗被关掉。
 * @param {chrome.tabs.QueryInfo} query
 * @param {{ keepActive?: boolean }} [opts]
 */
async function stashQuery(query, { keepActive = true } = {}) {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabs = await collectStashableTabs(query);
  if (keepActive && active?.id != null) {
    const selected = tabs.filter((t) => t.id !== active.id);
    if (!selected.length) {
      return { ok: false, reason: tabs.length ? 'only_active' : 'empty' };
    }
    const r = await stashTabs(selected);
    if (r.ok) r.keptActive = true;
    return r;
  }
  return stashTabs(tabs);
}

export async function stashCurrentWindow(opts) {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return stashQuery({ windowId: active?.windowId }, opts);
}

export async function stashAllWindows(opts) {
  return stashQuery({}, opts);
}
