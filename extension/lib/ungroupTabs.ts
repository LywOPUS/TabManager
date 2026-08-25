/**
 * 解散全部窗口中的原生标签组（不关标签、不碰 Session）。
 * 独立小模块，避免弹窗打进 liveOrganize / 分类栈。
 */

const CHUNK = 12;
const TAB_GROUP_NONE = -1;

function tabGroupNone() {
  return chrome.tabGroups?.TAB_GROUP_ID_NONE ?? TAB_GROUP_NONE;
}

function groupedOpenTabs(tabs: chrome.tabs.Tab[]) {
  const none = tabGroupNone();
  return (tabs || []).filter(
    (t) => typeof t.id === 'number' && typeof t.groupId === 'number' && t.groupId !== none,
  );
}

function yieldUi(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ungroupChunk(ids: number[]) {
  if (!ids.length) return 0
  const [head, ...rest] = ids
  try {
    await chrome.tabs.ungroup([head, ...rest])
    return ids.length;
  } catch {
    let n = 0;
    for (const id of ids) {
      try {
        await chrome.tabs.ungroup([id]);
        n += 1;
      } catch {
        /* 已解散或标签已关 */
      }
    }
    return n;
  }
}

/** 全部窗口里仍在原生标签组中的标签 */
export async function summarizeOpenTabGroups() {
  const grouped = groupedOpenTabs(await chrome.tabs.query({}));
  return {
    tabCount: grouped.length,
    groupCount: new Set(grouped.map((t) => t.groupId)).size,
    windowCount: new Set(grouped.map((t) => t.windowId)).size,
  };
}

/**
 * @returns {Promise<{ ok: boolean, tabCount: number, groupCount: number, windowCount: number }>}
 */
export async function ungroupAllWindows(onProgress?: (text: string) => void) {
  const grouped = groupedOpenTabs(await chrome.tabs.query({}));
  const groupCount = new Set(grouped.map((t) => t.groupId)).size;
  const windowCount = new Set(grouped.map((t) => t.windowId)).size;
  if (!grouped.length) {
    return { ok: true, tabCount: 0, groupCount: 0, windowCount: 0 };
  }
  const byWindow = new Map();
  for (const t of grouped) {
    if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
    byWindow.get(t.windowId).push(t.id);
  }
  let tabCount = 0;
  let wi = 0;
  for (const ids of byWindow.values()) {
    wi += 1;
    onProgress?.(`解散标签组 ${wi}/${byWindow.size}`);
    for (let i = 0; i < ids.length; i += CHUNK) {
      tabCount += await ungroupChunk(ids.slice(i, i + CHUNK));
      await yieldUi(0);
    }
  }
  return { ok: true, tabCount, groupCount, windowCount };
}
