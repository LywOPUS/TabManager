import { isRestorableUrl } from './urls.js';
import { isUngroupedName } from './groupNames.js';

const CREATE_CHUNK = 6;
const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];

function yieldUi(ms = 16) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 分批打开 URL，避免一次激活上百标签卡死。
 * @returns {Promise<number[]>} 新建 tabId 列表
 */
export async function createTabsBatched(urls, { onProgress } = {}) {
  const tabIds = [];
  const list = urls.filter(isRestorableUrl);
  const total = list.length;
  for (let i = 0; i < list.length; i += CREATE_CHUNK) {
    const chunk = list.slice(i, i + CREATE_CHUNK);
    onProgress?.(`打开标签 ${Math.min(i + chunk.length, total)}/${total}`);
    const created = await Promise.all(
      chunk.map((url) => chrome.tabs.create({ url, active: false })),
    );
    for (const t of created) tabIds.push(t.id);
    await yieldUi(CREATE_CHUNK > 4 ? 24 : 0);
  }
  return tabIds;
}

/** 恢复一个 Session Group：打开标签并打成原生标签组（≥2 时） */
export async function restoreGroup(group, { onProgress, colorIndex = 0 } = {}) {
  const urls = (group.tabs || []).map((t) => t.url);
  const tabIds = await createTabsBatched(urls, { onProgress });
  if (tabIds.length >= 2) {
    onProgress?.(`创建标签组：${group.name}`);
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: isUngroupedName(group.name) ? '' : group.name,
      color: GROUP_COLORS[colorIndex % GROUP_COLORS.length],
      collapsed: false,
    });
  }
  return tabIds.length;
}

/** 按会话内分组依次恢复（分批 + 可选进度） */
export async function restoreSessionGroups(session, { onProgress } = {}) {
  let n = 0;
  let colorIdx = 0;
  const groups = session.groups || [];
  for (let gi = 0; gi < groups.length; gi += 1) {
    const g = groups[gi];
    onProgress?.(`分组 ${gi + 1}/${groups.length}：${g.name}`);
    n += await restoreGroup(g, {
      colorIndex: colorIdx,
      onProgress: (msg) => onProgress?.(`[${g.name}] ${msg}`),
    });
    if ((g.tabs || []).filter((t) => isRestorableUrl(t.url)).length >= 2) colorIdx += 1;
    await yieldUi(32);
  }
  return n;
}
