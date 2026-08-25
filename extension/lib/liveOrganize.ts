import { isStashableTab } from './urls.js';
import { suggestGroupsSmart } from './localClassify.js';
import { classifyOptsFromSettings, getSettings } from './settings.js';
import {
  pickSeedGroupFromPreview,
  pickTopicGroupFromPreview,
  planHasWork,
  planLiveOrganize,
  planMatchedOrganize,
  planSelectedOrganize,
  previewFromPlan,
  tabsForPreviewGroup,
} from './liveOrganizePlan.js';

// 组名收尾（X 显示名、套话残词）在 groupLabels.js，经 suggestGroupsSmart 统一走。

const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
const MOVE_CHUNK = 12;
export const TAB_GROUP_NONE = -1;

function liveItem(tab) {
  const title = String(tab.title || '').trim();
  const url = tab.url || '';
  // 未加载页常把网址当标题；不要把 http/https 写进组名文本
  const looksUrl = /^https?:\/\//i.test(title);
  return { id: String(tab.id), title: looksUrl ? '' : title, url, tabId: tab.id };
}

export function isNativeUngrouped(tab, none = TAB_GROUP_NONE) {
  if (!tab) return false;
  return tab.groupId === undefined || tab.groupId === none;
}

/** 整理当前窗口：可收纳的标签（含已成组，可重分）。 */
export function tabsForWindowOrganize(tabs) {
  return (tabs || []).filter((t) => isStashableTab(t));
}

/** 仅未成组、可收纳的标签。 */
export function tabsForCurrentWindowOrganize(tabs, none = TAB_GROUP_NONE) {
  return tabsForWindowOrganize(tabs).filter((t) => isNativeUngrouped(t, none));
}

/** 标签栏多选（highlighted）且可收纳。 */
export function tabsForSelectedOrganize(tabs) {
  return tabsForWindowOrganize(tabs).filter((t) => t.highlighted);
}

export function resolveChromeTabId(tab) {
  if (typeof tab?.tabId === 'number' && Number.isInteger(tab.tabId) && tab.tabId >= 0) {
    return tab.tabId;
  }
  const n = Number(tab?.id);
  if (Number.isInteger(n) && n >= 0) return n;
  return null;
}

export function resolveChromeTabIds(tabs) {
  const ids = [];
  const seen = new Set();
  for (const t of tabs || []) {
    const id = resolveChromeTabId(t);
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** 把预览组收成 chrome.tabs.group 可用的数字 id（仍在该窗且可收纳）。 */
export function planNativeGroups(windowTabs, preview) {
  const byId = new Map();
  for (const t of windowTabs || []) {
    if (typeof t.id === 'number') byId.set(t.id, t);
  }
  const planned = [];
  for (const g of preview?.groups || []) {
    const tabIds = resolveChromeTabIds(g.tabs).filter((id) => {
      const tab = byId.get(id);
      return !!tab && isStashableTab(tab);
    });
    if (tabIds.length >= 2) planned.push({ name: g.name || '未命名', tabIds });
  }
  return planned;
}

function yieldUi(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getStashableTabsInWindow(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.filter((t) => isStashableTab(t));
}

export async function getUngroupedTabsInWindow(windowId) {
  const none = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? TAB_GROUP_NONE;
  return tabsForCurrentWindowOrganize(await chrome.tabs.query({ windowId }), none);
}

export async function previewLiveOrganizeSmart(tabs, onStatus) {
  const settings = await getSettings();
  const items = tabs.map(liveItem);
  const { preview, source, error } = await suggestGroupsSmart(items, {
    ...classifyOptsFromSettings(settings),
    onStatus,
  });
  return { preview, source, error };
}

/** 校验 tab 仍在目标窗口且可收纳 */
async function aliveTabIdsInWindow(tabIds, windowId) {
  const checks = await Promise.all(
    tabIds.map(async (id) => {
      try {
        const t = await chrome.tabs.get(id);
        return t.windowId === windowId && isStashableTab(t) ? id : null;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((id) => id != null);
}

/**
 * 先建新组（tabs.group 会移出旧组），可选再拆掉未纳入新组的残留原生组。
 * 整理当前窗口不要拆残留组：已有标签组应保留。
 * 跨窗合并整理才传 ungroupLeftovers。
 * @returns {Promise<{ ok: boolean, created: number, failed: Array<{ name: string, error: string }>, reason?: string }>}
 */
export async function applyNativeGroups(windowId, preview, onProgress, opts = {}) {
  const ungroupLeftovers = opts.ungroupLeftovers === true;
  const windowTabs = await chrome.tabs.query({ windowId });
  const planned = planNativeGroups(windowTabs, preview);

  if (!planned.length) {
    return { ok: false, created: 0, failed: [], reason: 'no_valid_groups' };
  }

  let created = 0;
  const failed = [];
  const keepGrouped = new Set();
  let colorIdx = 0;
  const total = planned.length;

  for (let i = 0; i < planned.length; i += 1) {
    const g = planned[i];
    onProgress?.(`创建标签组 ${i + 1}/${total}：${g.name}`);
    try {
      const tabIds = await aliveTabIdsInWindow(g.tabIds, windowId);
      if (tabIds.length < 2) {
        failed.push({ name: g.name, error: '可用标签不足 2 个' });
        continue;
      }
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, {
        title: g.name,
        color: GROUP_COLORS[colorIdx % GROUP_COLORS.length],
      });
      for (const id of tabIds) keepGrouped.add(id);
      created += 1;
      colorIdx += 1;
    } catch (e) {
      failed.push({ name: g.name, error: String(e?.message || e) });
    }
    await yieldUi(0);
  }

  // 全部失败时不拆旧组，避免「全散组 + all_failed」
  if (!created) {
    return { ok: false, created: 0, failed, reason: 'all_failed' };
  }

  if (ungroupLeftovers) {
    try {
      await ungroupLeftoverStashable(windowId, keepGrouped, onProgress);
    } catch (e) {
      failed.push({ name: '(拆残留组)', error: String(e?.message || e) });
    }
  }

  if (failed.length) {
    return { ok: false, created, failed, reason: 'partial' };
  }
  return { ok: true, created, failed: [] };
}

/**
 * 当前窗口整理：主题组优先新建，站点桶并入已有组、合并同站重复组。已成组标签可抽走重分。
 * @returns {Promise<{ ok: boolean, created: number, absorbTabs: number, merged: number, failed: Array, reason?: string }>}
 */
export async function applyLivePlan(windowId, plan, onProgress) {
  if (!planHasWork(plan)) {
    return { ok: false, created: 0, absorbTabs: 0, merged: 0, failed: [], reason: 'no_valid_groups' };
  }

  const failed = [];
  let created = 0;
  let absorbTabs = 0;
  let merged = 0;
  const usedColors = new Set();
  try {
    const existing = await chrome.tabGroups.query({ windowId });
    for (const g of existing) usedColors.add(g.color);
  } catch {
    /* ignore */
  }
  let colorIdx = 0;
  const nextColor = () => {
    for (let i = 0; i < GROUP_COLORS.length; i += 1) {
      const c = GROUP_COLORS[(colorIdx + i) % GROUP_COLORS.length];
      if (!usedColors.has(c)) {
        colorIdx = colorIdx + i + 1;
        usedColors.add(c);
        return c;
      }
    }
    const c = GROUP_COLORS[colorIdx % GROUP_COLORS.length];
    colorIdx += 1;
    return c;
  };

  for (const m of plan.merge || []) {
    onProgress?.(`合并标签组「${m.name}」`);
    try {
      const tabIds = await aliveTabIdsInWindow(m.tabIds, windowId);
      if (!tabIds.length) continue;
      await chrome.tabs.group({ tabIds, groupId: m.keepGroupId });
      merged += 1;
    } catch (e) {
      failed.push({ name: m.name, error: String(e?.message || e) });
    }
    await yieldUi(0);
  }

  for (const a of plan.absorb || []) {
    onProgress?.(`并入「${a.name}」`);
    try {
      const tabIds = await aliveTabIdsInWindow(a.tabIds, windowId);
      if (!tabIds.length) continue;
      await chrome.tabs.group({ tabIds, groupId: a.groupId });
      absorbTabs += tabIds.length;
    } catch (e) {
      failed.push({ name: a.name, error: String(e?.message || e) });
    }
    await yieldUi(0);
  }

  for (const c of plan.create || []) {
    onProgress?.(`创建标签组：${c.name}`);
    try {
      const tabIds = await aliveTabIdsInWindow(c.tabIds, windowId);
      if (tabIds.length < 2) {
        failed.push({ name: c.name, error: '可用标签不足 2 个' });
        continue;
      }
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, { title: c.name, color: nextColor() });
      created += 1;
    } catch (e) {
      failed.push({ name: c.name, error: String(e?.message || e) });
    }
    await yieldUi(0);
  }

  if (!created && !absorbTabs && !merged) {
    return { ok: false, created: 0, absorbTabs: 0, merged: 0, failed, reason: 'all_failed' };
  }

  try {
    await collapseInactiveGroups(windowId);
  } catch {
    /* 折叠失败不影响成组 */
  }

  if (failed.length) {
    return { ok: false, created, absorbTabs, merged, failed, reason: 'partial' };
  }
  return { ok: true, created, absorbTabs, merged, failed: [] };
}

async function collapseInactiveGroups(windowId) {
  const [active] = await chrome.tabs.query({ active: true, windowId });
  const groups = await chrome.tabGroups.query({ windowId });
  if (groups.length < 2) return;
  const keep = active && typeof active.groupId === 'number' && active.groupId !== TAB_GROUP_NONE
    ? active.groupId
    : null;
  for (const g of groups) {
    const collapsed = keep == null ? true : g.id !== keep;
    if (g.collapsed === collapsed) continue;
    try {
      await chrome.tabGroups.update(g.id, { collapsed });
    } catch {
      /* 有的环境不允许折叠当前组 */
    }
  }
}

async function loadExistingGroupMeta(windowTabs, none = TAB_GROUP_NONE) {
  const ids = [
    ...new Set(
      (windowTabs || [])
        .filter((t) => typeof t.groupId === 'number' && !isNativeUngrouped(t, none))
        .map((t) => t.groupId),
    ),
  ];
  const meta = [];
  for (const groupId of ids) {
    try {
      const g = await chrome.tabGroups.get(groupId);
      meta.push({ groupId, title: g.title || '', color: g.color });
    } catch {
      meta.push({ groupId, title: '', color: 'grey' });
    }
  }
  return meta;
}

/** 拆开仍分组、但不在 keepGrouped 内的可收纳标签 */
async function ungroupLeftoverStashable(windowId, keepGrouped, onProgress) {
  const tabs = await getStashableTabsInWindow(windowId);
  const leftover = tabs
    .filter(
      (t) =>
        t.groupId !== undefined &&
        t.groupId !== TAB_GROUP_NONE &&
        !keepGrouped.has(t.id),
    )
    .map((t) => t.id);
  if (!leftover.length) return;
  onProgress?.(`拆开残留分组（${leftover.length}）`);
  for (let i = 0; i < leftover.length; i += MOVE_CHUNK) {
    await chrome.tabs.ungroup(leftover.slice(i, i + MOVE_CHUNK));
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

/** 普通浏览器窗口（排除扩展弹窗）。弹窗/右键整理必须用这个，不能用 popup 自己的 currentWindow。 */
export async function getLastFocusedNormalWindowId() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    return typeof win?.id === 'number' ? win.id : null;
  } catch {
    return null;
  }
}

export async function getWindowOrganizePreview(windowId, onStatus) {
  if (typeof windowId !== 'number') return { ok: false, reason: 'no_window' };
  const none = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? TAB_GROUP_NONE;
  const windowTabs = await chrome.tabs.query({ windowId });
  const existingMeta = await loadExistingGroupMeta(windowTabs, none);
  const stashable = tabsForWindowOrganize(windowTabs);

  let leftoverPreview = { groups: [], ungrouped: stashable };
  let source = 'empty';
  let error;
  if (stashable.length >= 2) {
    const r = await previewLiveOrganizeSmart(stashable, onStatus);
    leftoverPreview = r.preview;
    source = r.source;
    error = r.error;
    if (error && !leftoverPreview?.groups?.length) {
      return { ok: false, reason: 'classify_failed', windowId, source, error };
    }
  }

  const plan = planLiveOrganize(windowTabs, existingMeta, leftoverPreview, none);
  if (!planHasWork(plan)) {
    return {
      ok: false,
      reason: stashable.length >= 2 ? 'no_groups' : 'too_few',
      windowId,
      source,
      error,
    };
  }
  return {
    ok: true,
    preview: previewFromPlan(plan, windowTabs),
    plan,
    windowId,
    source,
    error,
  };
}

/** 管理页：整理「当前这个管理页所在的窗口」 */
export async function getCurrentWindowOrganizePreview(onStatus) {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active) return { ok: false, reason: 'no_window' };
  return getWindowOrganizePreview(active.windowId, onStatus);
}

export async function organizeWindow(windowId, onProgress) {
  const r = await getWindowOrganizePreview(windowId, onProgress);
  if (!r.ok) return r;
  const applied = await applyLivePlan(windowId, r.plan, onProgress);
  if (!applied.ok) {
    return {
      ok: false,
      reason: applied.reason || 'apply_failed',
      preview: r.preview,
      plan: r.plan,
      source: r.source,
      apply: applied,
    };
  }
  return { ok: true, preview: r.preview, plan: r.plan, source: r.source, apply: applied };
}

/** 弹窗 / 右键：立刻整理最近聚焦的普通窗口（含已成组，可重分） */
export async function organizeCurrentWindow(onProgress) {
  const windowId = await getLastFocusedNormalWindowId();
  if (windowId == null) return { ok: false, reason: 'no_window' };
  return organizeWindow(windowId, onProgress);
}

export async function summarizeHighlightedTabs() {
  const windowId = await getLastFocusedNormalWindowId();
  if (windowId == null) return { count: 0 };
  const selected = tabsForSelectedOrganize(await chrome.tabs.query({ windowId, highlighted: true }));
  return { count: selected.length };
}

export async function getSelectedOrganizePreview(windowId, onStatus) {
  if (typeof windowId !== 'number') return { ok: false, reason: 'no_window' };
  const none = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? TAB_GROUP_NONE;
  const windowTabs = await chrome.tabs.query({ windowId });
  const existingMeta = await loadExistingGroupMeta(windowTabs, none);
  const selected = tabsForSelectedOrganize(windowTabs);
  if (selected.length < 2) {
    return { ok: false, reason: 'no_selection', windowId, count: selected.length };
  }

  const r = await previewLiveOrganizeSmart(selected, onStatus);
  if (r.error && !r.preview?.groups?.length) {
    return { ok: false, reason: 'classify_failed', windowId, source: r.source, error: r.error };
  }

  const plan = planSelectedOrganize(windowTabs, existingMeta, r.preview, none);
  if (!planHasWork(plan)) {
    return { ok: false, reason: 'no_groups', windowId, source: r.source, error: r.error, count: selected.length };
  }
  return {
    ok: true,
    preview: previewFromPlan(plan, windowTabs),
    plan,
    windowId,
    source: r.source,
    error: r.error,
    count: selected.length,
  };
}

/** 弹窗 / 右键：只整理标签栏多选的标签，不碰其余页 */
export async function organizeSelectedTabs(onProgress) {
  const windowId = await getLastFocusedNormalWindowId();
  if (windowId == null) return { ok: false, reason: 'no_window' };
  onProgress?.('整理选中标签');
  const r = await getSelectedOrganizePreview(windowId, onProgress);
  if (!r.ok) return r;
  const applied = await applyLivePlan(windowId, r.plan, onProgress);
  if (!applied.ok) {
    return {
      ok: false,
      reason: applied.reason || 'apply_failed',
      preview: r.preview,
      plan: r.plan,
      source: r.source,
      count: r.count,
      apply: applied,
    };
  }
  return { ok: true, preview: r.preview, plan: r.plan, source: r.source, count: r.count, apply: applied };
}

export async function getWindowSeedOrganizePreview(windowId, onStatus) {
  if (typeof windowId !== 'number') return { ok: false, reason: 'no_window' };
  const none = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? TAB_GROUP_NONE;
  const windowTabs = await chrome.tabs.query({ windowId });
  const existingMeta = await loadExistingGroupMeta(windowTabs, none);
  const [seedTab] = await chrome.tabs.query({ windowId, active: true });
  if (!isStashableTab(seedTab)) {
    return { ok: false, reason: 'no_seed', windowId };
  }
  const stashable = tabsForWindowOrganize(windowTabs);
  if (stashable.length < 2) {
    return { ok: false, reason: 'no_seed_match', windowId };
  }
  const r = await previewLiveOrganizeSmart(stashable, onStatus);
  if (r.error && !r.preview?.groups?.length) {
    return { ok: false, reason: 'classify_failed', windowId, source: r.source, error: r.error };
  }
  const group = pickSeedGroupFromPreview(r.preview, seedTab);
  const matches = tabsForPreviewGroup(windowTabs, group);
  const plan = planMatchedOrganize(windowTabs, existingMeta, none, matches, group?.name);
  if (!planHasWork(plan)) {
    return { ok: false, reason: 'no_seed_match', windowId, source: r.source };
  }
  return {
    ok: true,
    preview: previewFromPlan(plan, windowTabs),
    plan,
    windowId,
    source: r.source,
  };
}

/** 弹窗 / 右键：把同作者或同主题收到当前页这边（可从已有组抽走），不整理其余标签 */
export async function organizeAroundCurrentPage(onProgress) {
  const windowId = await getLastFocusedNormalWindowId();
  if (windowId == null) return { ok: false, reason: 'no_window' };
  onProgress?.('按当前页归组');
  const r = await getWindowSeedOrganizePreview(windowId, onProgress);
  if (!r.ok) return r;
  const applied = await applyLivePlan(windowId, r.plan, onProgress);
  if (!applied.ok) {
    return {
      ok: false,
      reason: applied.reason || 'apply_failed',
      preview: r.preview,
      plan: r.plan,
      source: r.source,
      apply: applied,
    };
  }
  return { ok: true, preview: r.preview, plan: r.plan, source: r.source, apply: applied };
}

export async function organizeByTopic(query, onProgress) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, reason: 'no_topic' };
  const windowId = await getLastFocusedNormalWindowId();
  if (windowId == null) return { ok: false, reason: 'no_window' };
  onProgress?.(`按「${q.slice(0, 24)}」归组`);
  const none = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? TAB_GROUP_NONE;
  const windowTabs = await chrome.tabs.query({ windowId });
  const existingMeta = await loadExistingGroupMeta(windowTabs, none);
  const stashable = tabsForWindowOrganize(windowTabs);
  if (stashable.length < 2) return { ok: false, reason: 'no_topic_match', windowId };
  const r = await previewLiveOrganizeSmart(stashable, onProgress);
  if (r.error && !r.preview?.groups?.length) {
    return { ok: false, reason: 'classify_failed', windowId, source: r.source, error: r.error };
  }
  const group = pickTopicGroupFromPreview(r.preview, q);
  const matches = tabsForPreviewGroup(windowTabs, group);
  const plan = planMatchedOrganize(windowTabs, existingMeta, none, matches, group?.name || q);
  if (!planHasWork(plan)) return { ok: false, reason: 'no_topic_match', windowId, source: r.source };
  const preview = previewFromPlan(plan, windowTabs);
  const applied = await applyLivePlan(windowId, plan, onProgress);
  if (!applied.ok) {
    return {
      ok: false,
      reason: applied.reason || 'apply_failed',
      preview,
      plan,
      source: r.source,
      apply: applied,
    };
  }
  return { ok: true, preview, plan, source: r.source, apply: applied, topic: q };
}

let relatedPickCache = null;

function relatedFingerprint(tabs, seedId) {
  const ids = (tabs || [])
    .map((t) => t.id)
    .filter((id) => typeof id === 'number')
    .sort((a, b) => a - b);
  return `${seedId}:${ids.join(',')}`;
}

async function classifyRelatedPick(onStatus) {
  const windowId = await getLastFocusedNormalWindowId();
  if (windowId == null) return { ok: false, reason: 'no_window' };
  const [seed] = await chrome.tabs.query({ windowId, active: true });
  if (!isStashableTab(seed) || typeof seed.id !== 'number') {
    return { ok: false, reason: 'no_seed' };
  }
  const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const allTabs = allWindows.flatMap((w) => w.tabs || []);
  const stashable = tabsForWindowOrganize(allTabs);
  const fp = relatedFingerprint(stashable, seed.id);
  if (relatedPickCache?.fp === fp) return relatedPickCache;

  if (stashable.length < 2) {
    relatedPickCache = { fp, ok: false, reason: 'no_seed_match', count: 0, name: '', matches: [], seed };
    return relatedPickCache;
  }
  const r = await previewLiveOrganizeSmart(stashable, onStatus);
  if (r.error && !r.preview?.groups?.length) {
    relatedPickCache = {
      fp,
      ok: false,
      reason: 'classify_failed',
      error: r.error,
      source: r.source,
      count: 0,
      name: '',
      matches: [],
      seed,
    };
    return relatedPickCache;
  }
  const group = pickSeedGroupFromPreview(r.preview, seed);
  const matches = tabsForPreviewGroup(allTabs, group);
  const name = group?.name || '';
  relatedPickCache = {
    fp,
    ok: matches.length >= 2,
    reason: matches.length >= 2 ? undefined : 'no_seed_match',
    source: r.source,
    count: matches.length,
    name,
    matches,
    seed,
  };
  return relatedPickCache;
}

export async function relatedToNewWindowSummary(onStatus) {
  const pick = await classifyRelatedPick(onStatus);
  if (pick.reason === 'no_window') return null;
  return {
    count: pick.count || 0,
    name: pick.name || '',
    reason: pick.reason,
    error: pick.error,
    source: pick.source,
  };
}

export async function moveRelatedToNewWindow(onProgress) {
  const pick = await classifyRelatedPick(onProgress);
  if (!pick.ok) {
    return { ok: false, reason: pick.reason || 'no_seed_match', error: pick.error, source: pick.source };
  }
  const { seed, matches, name } = pick;
  if (!isStashableTab(seed) || typeof seed.id !== 'number') {
    return { ok: false, reason: 'no_seed' };
  }
  relatedPickCache = null;
  onProgress?.(`移到新窗口「${name}」`);
  let win;
  try {
    win = await chrome.windows.create({ tabId: seed.id, focused: true });
  } catch (e) {
    return { ok: false, reason: 'apply_failed', error: String(e?.message || e) };
  }
  const newWindowId = win?.id;
  if (typeof newWindowId !== 'number') return { ok: false, reason: 'no_window' };

  const others = matches
    .map((t) => t.id)
    .filter((id) => typeof id === 'number' && id !== seed.id);
  const byWin = new Map();
  for (const id of others) {
    try {
      const t = await chrome.tabs.get(id);
      if (t.windowId === newWindowId || t.pinned || !isStashableTab(t)) continue;
      if (!byWin.has(t.windowId)) byWin.set(t.windowId, []);
      byWin.get(t.windowId).push(id);
    } catch {
      /* 标签已关 */
    }
  }
  let moved = 1;
  for (const ids of byWin.values()) {
    for (let i = 0; i < ids.length; i += MOVE_CHUNK) {
      const chunk = ids.slice(i, i + MOVE_CHUNK);
      onProgress?.(`移动标签 ${moved + chunk.length}/${matches.length}`);
      try {
        await chrome.tabs.move(chunk, { windowId: newWindowId, index: -1 });
        moved += chunk.length;
      } catch {
        /* 单批失败则跳过 */
      }
      await yieldUi(16);
    }
  }

  const alive = await aliveTabIdsInWindow(
    matches.map((t) => t.id).filter((id) => typeof id === 'number'),
    newWindowId,
  );
  if (alive.length >= 2) {
    try {
      const groupId = await chrome.tabs.group({
        tabIds: alive,
        createProperties: { windowId: newWindowId },
      });
      await chrome.tabGroups.update(groupId, { title: name, color: 'cyan' });
    } catch (e) {
      return {
        ok: false,
        reason: 'partial',
        moved,
        name,
        windowId: newWindowId,
        error: String(e?.message || e),
      };
    }
  }
  return { ok: true, moved, name, windowId: newWindowId, source: 'seed' };
}

export async function mergeOrganizeSummary() {
  const windowId = await getLastFocusedNormalWindowId();
  if (windowId == null) return null;
  const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  let otherWindows = 0;
  let movableTabs = 0;
  let skippedPinned = 0;
  let skippedUrl = 0;
  for (const w of allWindows) {
    if (w.id === windowId) continue;
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
  const currentTabs = await getStashableTabsInWindow(windowId);
  return {
    targetWindowId: windowId,
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
  const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const toMove = [];
  for (const w of allWindows) {
    if (w.id === targetWindowId) continue;
    for (const tab of w.tabs || []) {
      if (!isStashableTab(tab) || typeof tab.id !== 'number') continue;
      toMove.push(tab.id);
    }
  }

  await moveTabsInChunks(toMove, targetWindowId, onProgress);

  const tabs = await getStashableTabsInWindow(targetWindowId);
  if (tabs.length < 2) return { ok: false, reason: 'too_few', summary };

  onProgress('生成分组建议…');
  const { preview, source, error } = await previewLiveOrganizeSmart(tabs, onProgress);
  if (error && !preview?.groups?.length) {
    return { ok: false, reason: 'classify_failed', error, summary, source };
  }
  if (!preview.groups.length) return { ok: false, reason: 'no_groups', summary, source };

  const applied = await applyNativeGroups(targetWindowId, preview, onProgress, {
    ungroupLeftovers: true,
  });
  if (!applied.ok) {
    onProgress(applied.reason === 'partial' ? '部分分组未完成' : '分组失败');
    return { ok: false, reason: applied.reason || 'apply_failed', preview, summary, source, apply: applied };
  }
  onProgress('完成');
  return { ok: true, preview, summary, source, apply: applied };
}
