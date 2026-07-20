import { isRestorableUrl, isStashableTab } from './urls.js';
import { addSession, defaultSessionName, newId } from './storage.js';

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
    groups: [{ id: newId(), name: '未分组', tabs: stashed }],
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

export async function stashCurrentWindow() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const windowId = active?.windowId;
  const tabs = await collectStashableTabs({ windowId });
  return stashTabs(tabs);
}

export async function stashAllWindows() {
  const tabs = await collectStashableTabs({});
  return stashTabs(tabs);
}
