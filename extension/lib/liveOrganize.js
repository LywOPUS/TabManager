import { isStashableTab } from './urls.js';
import { suggestGroups } from './groupHeuristics.js';
import { suggestGroupsSmart } from './localClassify.js';
import { getSettings } from './settings.js';

const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
const MOVE_CHUNK = 12;

function liveItem(tab) {
  return { id: String(tab.id), title: tab.title || tab.url, url: tab.url, tabId: tab.id };
}

function yieldUi(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getUngroupedTabsInWindow(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.filter((t) => isStashableTab(t) && (t.groupId === undefined || t.groupId === -1));
}

export async function getStashableTabsInWindow(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.filter((t) => isStashableTab(t));
}

export function previewLiveOrganize(tabs) {
  const items = tabs.map(liveItem);
  return suggestGroups(items);
}

export async function previewLiveOrganizeSmart(tabs, onStatus) {
  const settings = await getSettings();
  const items = tabs.map(liveItem);
  const { preview, source, error } = await suggestGroupsSmart(items, {
    classifyMode: settings.classifyMode,
    browserModelId: settings.browserModelId,
    preferWebGPU: settings.preferWebGPU,
    baseUrl: settings.localModel.baseUrl,
    model: settings.localModel.model,
    onStatus,
  });
  return { preview, source, error };
}

export async function applyNativeGroups(windowId, preview, onProgress) {
  let colorIdx = 0;
  let i = 0;
  const total = preview.groups.length;
  for (const g of preview.groups) {
    const tabIds = g.tabs.map((t) => t.tabId).filter(Boolean);
    if (tabIds.length < 2) continue;
    i += 1;
    onProgress?.(`创建标签组 ${i}/${total}：${g.name}`);
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    await chrome.tabGroups.update(groupId, {
      title: g.name,
      color: GROUP_COLORS[colorIdx % GROUP_COLORS.length],
    });
    colorIdx += 1;
    await yieldUi(0);
  }
}

async function moveTabsInChunks(tabIds, windowId, onProgress) {
  if (!tabIds.length) return;
  const total = tabIds.length;
  for (let i = 0; i < tabIds.length; i += MOVE_CHUNK) {
    const chunk = tabIds.slice(i, i + MOVE_CHUNK);
    onProgress?.(`合并标签 ${Math.min(i + chunk.length, total)}/${total}`);
    await chrome.tabs.move(chunk, { windowId, index: -1 });
    await yieldUi(16);
  }
}

async function ungroupStashableInWindow(windowId, onProgress) {
  const tabs = await getStashableTabsInWindow(windowId);
  const grouped = tabs.filter((t) => t.groupId !== undefined && t.groupId !== -1).map((t) => t.id);
  if (!grouped.length) return;
  onProgress?.(`拆开原有分组（${grouped.length}）`);
  for (let i = 0; i < grouped.length; i += MOVE_CHUNK) {
    await chrome.tabs.ungroup(grouped.slice(i, i + MOVE_CHUNK));
    await yieldUi(0);
  }
}

export async function getCurrentWindowOrganizePreview(onStatus) {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active) return { ok: false, reason: 'no_window' };
  const tabs = await getUngroupedTabsInWindow(active.windowId);
  if (tabs.length < 2) return { ok: false, reason: 'too_few', windowId: active.windowId };
  const { preview, source, error } = await previewLiveOrganizeSmart(tabs, onStatus);
  if (!preview.groups.length) return { ok: false, reason: 'no_groups', windowId: active.windowId, source, error };
  return { ok: true, preview, windowId: active.windowId, source, error };
}

export async function organizeCurrentWindow() {
  const r = await getCurrentWindowOrganizePreview();
  if (!r.ok) return r;
  await applyNativeGroups(r.windowId, r.preview);
  return { ok: true, preview: r.preview, source: r.source };
}

export async function mergeOrganizeSummary() {
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!current) return null;
  const allWindows = await chrome.windows.getAll({ populate: true });
  let otherWindows = 0;
  let movableTabs = 0;
  let skippedPinned = 0;
  let skippedUrl = 0;
  for (const w of allWindows) {
    if (w.id === current.windowId) continue;
    otherWindows += 1;
    for (const tab of w.tabs || []) {
      if (tab.pinned) {
        skippedPinned += 1;
        continue;
      }
      if (!isStashableTab(tab)) {
        skippedUrl += 1;
        continue;
      }
      movableTabs += 1;
    }
  }
  const currentTabs = await getStashableTabsInWindow(current.windowId);
  return {
    targetWindowId: current.windowId,
    otherWindows,
    movableTabs,
    skippedPinned,
    skippedUrl,
    currentTabCount: currentTabs.length + movableTabs,
  };
}

/**
 * @param {{ onProgress?: (msg: string) => void }} [opts]
 */
export async function mergeAndOrganizeCurrent(opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const summary = await mergeOrganizeSummary();
  if (!summary) return { ok: false, reason: 'no_window' };
  const { targetWindowId } = summary;

  onProgress('收集其他窗口标签…');
  const allTabs = await chrome.tabs.query({});
  const toMove = [];
  for (const tab of allTabs) {
    if (tab.windowId === targetWindowId) continue;
    if (!isStashableTab(tab)) continue;
    toMove.push(tab.id);
  }

  await moveTabsInChunks(toMove, targetWindowId, onProgress);
  await ungroupStashableInWindow(targetWindowId, onProgress);

  const tabs = await getStashableTabsInWindow(targetWindowId);
  if (tabs.length < 2) return { ok: false, reason: 'too_few', summary };

  onProgress('生成分组建议…');
  const { preview, source } = await previewLiveOrganizeSmart(tabs, onProgress);
  if (!preview.groups.length) return { ok: false, reason: 'no_groups', summary, source };

  await applyNativeGroups(targetWindowId, preview, onProgress);
  onProgress('完成');
  return { ok: true, preview, summary, source };
}
