import { isStashableTab } from './urls.js';
import { suggestGroupsSmart } from './localClassify.js';
import type { ClassifyItem, ClassifyPreview } from './localClassify.js';
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
import type { ExistingGroupMeta, OrganizePreviewIn, PlanTab } from './liveOrganizePlan.js';
import { isRecord } from './unknown.js';

// 组名收尾（X 显示名、套话残词）在 groupLabels.js，经 suggestGroupsSmart 统一走。

export type LivePlan = {
  absorb: Array<{ groupId: number; name: string; tabIds: number[] }>
  create: Array<{ name: string; tabIds: number[] }>
  merge: Array<{ keepGroupId: number; name: string; tabIds: number[] }>
  leftoverCount?: number
}

export type LivePreviewTab = { title: string }

export type LivePreview = {
  groups: Array<{ name: string; action?: string; tabs: LivePreviewTab[]; tabIds?: string[] }>
  ungrouped: LivePreviewTab[]
}

export type LiveApplyOk = { ok: true; created: number; absorbTabs: number; merged: number; failed: Array<{ name: string; error: string }> }
export type LiveApplyFail = { ok: false; created: number; absorbTabs: number; merged: number; failed: Array<{ name: string; error: string }>; reason: string }
export type LiveApplyResult = LiveApplyOk | LiveApplyFail

export type NativeApplyOk = { ok: true; created: number; failed: Array<{ name: string; error: string }> }
export type NativeApplyFail = { ok: false; created: number; failed: Array<{ name: string; error: string }>; reason: string }
export type NativeApplyResult = NativeApplyOk | NativeApplyFail

export type LivePreviewOk = {
  ok: true
  preview: LivePreview
  plan: LivePlan
  windowId: number
  source: string
  error?: string
  count?: number
}

export type LivePreviewFail = {
  ok: false
  reason: string
  windowId?: number
  source?: string
  error?: string
  count?: number
}

export type LivePreviewResult = LivePreviewOk | LivePreviewFail

export type OrganizeApplyFail = {
  ok: false
  reason: string
  preview: LivePreview
  plan: LivePlan
  source: string
  apply: LiveApplyResult
  count?: number
  error?: string
}

export type OrganizeApplyOk = {
  ok: true
  preview: LivePreview
  plan: LivePlan
  source: string
  apply: LiveApplyOk
  count?: number
  topic?: string
}

export type OrganizeResult = LivePreviewFail | OrganizeApplyFail | OrganizeApplyOk

export type MergeOrganizeSummary = {
  targetWindowId: number
  otherWindows: number
  movableTabs: number
  skippedPinned: number
  skippedUrl: number
  currentTabCount: number
}

export type MergeOrganizeResult =
  | {
      ok: false
      reason: string
      error?: string
      summary?: MergeOrganizeSummary
      source?: string
      preview?: ClassifyPreview
      apply?: NativeApplyResult
    }
  | {
      ok: true
      preview: ClassifyPreview
      summary: MergeOrganizeSummary
      source: string
      apply: NativeApplyOk
    }

export type OrganizeTab = {
  id?: number
  tabId?: number
  title?: string
  url?: string
  pendingUrl?: string
  pinned?: boolean
  highlighted?: boolean
  groupId?: number
}

export type TabIdLike = {
  id?: string | number
  tabId?: string | number
}

export type OrganizeProgressFn = (msg: string) => void

export type RelatedSummary =
  | { ok: true; count: number; name: string; source?: string }
  | { ok: false; reason: string; count: number; name: string; error?: string; source?: string }

export type MoveRelatedResult =
  | { ok: false; reason: string; error?: string; source?: string; moved?: number; name?: string; windowId?: number }
  | { ok: true; moved: number; name: string; windowId: number; source: string }

type GroupColor = `${chrome.tabGroups.Color}`
const GROUP_COLORS: GroupColor[] = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
const MOVE_CHUNK = 12;
export const TAB_GROUP_NONE = -1;

type RelatedEarlyFail = {
  ok: false
  reason: 'no_window' | 'no_seed'
}

type RelatedPickOk = {
  fp: string
  ok: true
  count: number
  name: string
  matches: PlanTab[]
  seed: chrome.tabs.Tab
  source?: string
}

type RelatedPickFail = {
  fp: string
  ok: false
  reason: string
  count: number
  name: string
  matches: PlanTab[]
  seed: chrome.tabs.Tab
  error?: string
  source?: string
}

type RelatedPick = RelatedPickOk | RelatedPickFail

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function tabsGroup(options: chrome.tabs.GroupOptions): Promise<number> {
  const result: unknown = await chrome.tabs.group(options);
  if (typeof result !== 'number') throw new Error('tabs.group 未返回 groupId');
  return result;
}

function liveItem(tab: OrganizeTab): ClassifyItem {
  const title = String(tab.title || '').trim();
  const url = tab.url || '';
  // 未加载页常把网址当标题；不要把 http/https 写进组名文本
  const looksUrl = /^https?:\/\//i.test(title);
  return { id: String(tab.id), title: looksUrl ? '' : title, url, tabId: tab.id };
}

export function isNativeUngrouped(tab: { groupId?: number } | null | undefined, none = TAB_GROUP_NONE): boolean {
  if (!tab) return false;
  return tab.groupId === undefined || tab.groupId === none;
}

/** 整理当前窗口：可收纳的标签（含已成组，可重分）。 */
export function tabsForWindowOrganize<T extends OrganizeTab>(tabs: T[] | null | undefined): T[] {
  return (tabs || []).filter((t) => isStashableTab(t));
}

/** 仅未成组、可收纳的标签。 */
export function tabsForCurrentWindowOrganize<T extends OrganizeTab>(tabs: T[] | null | undefined, none = TAB_GROUP_NONE): T[] {
  return tabsForWindowOrganize(tabs).filter((t) => isNativeUngrouped(t, none));
}

/** 标签栏多选（highlighted）且可收纳。 */
export function tabsForSelectedOrganize<T extends OrganizeTab>(tabs: T[] | null | undefined): T[] {
  return tabsForWindowOrganize(tabs).filter((t) => t.highlighted);
}

export function resolveChromeTabId(tab: TabIdLike | null | undefined): number | null {
  if (typeof tab?.tabId === 'number' && Number.isInteger(tab.tabId) && tab.tabId >= 0) {
    return tab.tabId;
  }
  const n = Number(tab?.id);
  if (Number.isInteger(n) && n >= 0) return n;
  return null;
}

export function resolveChromeTabIds(tabs: TabIdLike[] | null | undefined): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const t of tabs || []) {
    const id = resolveChromeTabId(t);
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** 把预览组收成 chrome.tabs.group 可用的数字 id（仍在该窗且可收纳）。 */
export function planNativeGroups(
  windowTabs: OrganizeTab[] | null | undefined,
  preview: OrganizePreviewIn | null | undefined,
): Array<{ name: string; tabIds: number[] }> {
  const byId = new Map<number, OrganizeTab>();
  for (const t of windowTabs || []) {
    if (typeof t.id === 'number') byId.set(t.id, t);
  }
  const planned: Array<{ name: string; tabIds: number[] }> = [];
  for (const g of preview?.groups || []) {
    const tabIds = resolveChromeTabIds(g.tabs).filter((id) => {
      const tab = byId.get(id);
      return !!tab && isStashableTab(tab);
    });
    if (tabIds.length >= 2) planned.push({ name: g.name || '未命名', tabIds });
  }
  return planned;
}

function yieldUi(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getStashableTabsInWindow(windowId: number): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.filter((t) => isStashableTab(t));
}

export async function getUngroupedTabsInWindow(windowId: number): Promise<chrome.tabs.Tab[]> {
  const none = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? TAB_GROUP_NONE;
  return tabsForCurrentWindowOrganize(await chrome.tabs.query({ windowId }), none);
}

export async function previewLiveOrganizeSmart(
  tabs: OrganizeTab[],
  onStatus?: OrganizeProgressFn,
): Promise<{ preview: ClassifyPreview; source: string; error?: string }> {
  const settings = await getSettings();
  const items = tabs.map(liveItem);
  const { preview, source, error } = await suggestGroupsSmart(items, {
    ...classifyOptsFromSettings(settings),
    onStatus,
  });
  return { preview, source, error };
}

/** 校验 tab 仍在目标窗口且可收纳 */
async function aliveTabIdsInWindow(tabIds: number[], windowId: number): Promise<number[]> {
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
  return checks.filter((id): id is number => id != null);
}

/**
 * 先建新组（tabs.group 会移出旧组），可选再拆掉未纳入新组的残留原生组。
 * 整理当前窗口不要拆残留组：已有标签组应保留。
 * 跨窗合并整理才传 ungroupLeftovers。
 */
export async function applyNativeGroups(
  windowId: number,
  preview: OrganizePreviewIn | null | undefined,
  onProgress?: OrganizeProgressFn,
  opts: { ungroupLeftovers?: boolean } = {},
): Promise<NativeApplyResult> {
  const ungroupLeftovers = opts.ungroupLeftovers === true;
  const windowTabs = await chrome.tabs.query({ windowId });
  const planned = planNativeGroups(windowTabs, preview);

  if (!planned.length) {
    return { ok: false, created: 0, failed: [], reason: 'no_valid_groups' };
  }

  let created = 0;
  const failed: Array<{ name: string; error: string }> = [];
  const keepGrouped = new Set<number>();
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
      const [head, ...rest] = tabIds;
      const groupId = await tabsGroup({ tabIds: [head, ...rest], createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, {
        title: g.name,
        color: GROUP_COLORS[colorIdx % GROUP_COLORS.length],
      });
      for (const id of tabIds) keepGrouped.add(id);
      created += 1;
      colorIdx += 1;
    } catch (e) {
      failed.push({ name: g.name, error: errorText(e) });
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
      failed.push({ name: '(拆残留组)', error: errorText(e) });
    }
  }

  if (failed.length) {
    return { ok: false, created, failed, reason: 'partial' };
  }
  return { ok: true, created, failed: [] };
}

/**
 * 当前窗口整理：主题组优先新建，站点桶并入已有组、合并同站重复组。已成组标签可抽走重分。
 */
export async function applyLivePlan(
  windowId: number,
  plan: LivePlan,
  onProgress?: OrganizeProgressFn,
): Promise<LiveApplyResult> {
  if (!planHasWork(plan)) {
    return { ok: false, created: 0, absorbTabs: 0, merged: 0, failed: [], reason: 'no_valid_groups' };
  }

  const failed: Array<{ name: string; error: string }> = [];
  let created = 0;
  let absorbTabs = 0;
  let merged = 0;
  const usedColors = new Set<GroupColor>();
  try {
    const existing = await chrome.tabGroups.query({ windowId });
    for (const g of existing) usedColors.add(g.color);
  } catch {
    /* ignore */
  }
  let colorIdx = 0;
  const nextColor = (): GroupColor => {
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
      if (tabIds.length < 1) continue;
      const [head, ...rest] = tabIds;
      await tabsGroup({ tabIds: [head, ...rest], groupId: m.keepGroupId });
      merged += 1;
    } catch (e) {
      failed.push({ name: m.name, error: errorText(e) });
    }
    await yieldUi(0);
  }

  for (const a of plan.absorb || []) {
    onProgress?.(`并入「${a.name}」`);
    try {
      const tabIds = await aliveTabIdsInWindow(a.tabIds, windowId);
      if (tabIds.length < 1) continue;
      const [head, ...rest] = tabIds;
      await tabsGroup({ tabIds: [head, ...rest], groupId: a.groupId });
      absorbTabs += tabIds.length;
    } catch (e) {
      failed.push({ name: a.name, error: errorText(e) });
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
      const [head, ...rest] = tabIds;
      const groupId = await tabsGroup({ tabIds: [head, ...rest], createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, { title: c.name, color: nextColor() });
      created += 1;
    } catch (e) {
      failed.push({ name: c.name, error: errorText(e) });
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

async function collapseInactiveGroups(windowId: number): Promise<void> {
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

async function loadExistingGroupMeta(
  windowTabs: chrome.tabs.Tab[],
  none = TAB_GROUP_NONE,
): Promise<ExistingGroupMeta[]> {
  const ids: number[] = [
    ...new Set(
      (windowTabs || [])
        .filter((t) => typeof t.groupId === 'number' && !isNativeUngrouped(t, none))
        .map((t) => t.groupId),
    ),
  ];
  const meta: ExistingGroupMeta[] = [];
  for (const groupId of ids) {
    try {
      const raw: unknown = await chrome.tabGroups.get(groupId);
      if (!isRecord(raw)) {
        meta.push({ groupId, title: '', color: 'grey' });
        continue;
      }
      meta.push({
        groupId,
        title: typeof raw.title === 'string' ? raw.title : '',
        color: typeof raw.color === 'string' ? raw.color : 'grey',
      });
    } catch {
      meta.push({ groupId, title: '', color: 'grey' });
    }
  }
  return meta;
}

/** 拆开仍分组、但不在 keepGrouped 内的可收纳标签 */
async function ungroupLeftoverStashable(
  windowId: number,
  keepGrouped: Set<number>,
  onProgress?: OrganizeProgressFn,
): Promise<void> {
  const tabs = await getStashableTabsInWindow(windowId);
  const leftover = tabs
    .filter(
      (t): t is chrome.tabs.Tab & { id: number } =>
        typeof t.id === 'number' &&
        t.groupId !== undefined &&
        t.groupId !== TAB_GROUP_NONE &&
        !keepGrouped.has(t.id),
    )
    .map((t) => t.id);
  if (!leftover.length) return;
  onProgress?.(`拆开残留分组（${leftover.length}）`);
  for (let i = 0; i < leftover.length; i += MOVE_CHUNK) {
    const ids = leftover.slice(i, i + MOVE_CHUNK);
    if (ids.length < 1) continue;
    const [head, ...rest] = ids;
    await chrome.tabs.ungroup([head, ...rest]);
    await yieldUi(0);
  }
}

async function moveTabsInChunks(
  tabIds: number[],
  windowId: number,
  onProgress?: OrganizeProgressFn,
): Promise<void> {
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
export async function getLastFocusedNormalWindowId(): Promise<number | null> {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    return typeof win?.id === 'number' ? win.id : null;
  } catch {
    return null;
  }
}

export async function getWindowOrganizePreview(
  windowId: number,
  onStatus?: OrganizeProgressFn,
): Promise<LivePreviewResult> {
  if (typeof windowId !== 'number') return { ok: false, reason: 'no_window' };
  const none = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? TAB_GROUP_NONE;
  const windowTabs = await chrome.tabs.query({ windowId });
  const existingMeta = await loadExistingGroupMeta(windowTabs, none);
  const stashable = tabsForWindowOrganize(windowTabs);

  let leftoverPreview: OrganizePreviewIn = { groups: [], ungrouped: stashable };
  let source = 'empty';
  let error: string | undefined;
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
export async function getCurrentWindowOrganizePreview(onStatus?: OrganizeProgressFn): Promise<LivePreviewResult> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active) return { ok: false, reason: 'no_window' };
  return getWindowOrganizePreview(active.windowId, onStatus);
}

export async function organizeWindow(windowId: number, onProgress?: OrganizeProgressFn): Promise<OrganizeResult> {
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
export async function organizeCurrentWindow(onProgress?: OrganizeProgressFn): Promise<OrganizeResult> {
  const windowId = await getLastFocusedNormalWindowId();
  if (windowId == null) return { ok: false, reason: 'no_window' };
  return organizeWindow(windowId, onProgress);
}

export async function summarizeHighlightedTabs(): Promise<{ count: number }> {
  const windowId = await getLastFocusedNormalWindowId();
  if (windowId == null) return { count: 0 };
  const selected = tabsForSelectedOrganize(await chrome.tabs.query({ windowId, highlighted: true }));
  return { count: selected.length };
}

export async function getSelectedOrganizePreview(
  windowId: number,
  onStatus?: OrganizeProgressFn,
): Promise<LivePreviewResult> {
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
export async function organizeSelectedTabs(onProgress?: OrganizeProgressFn): Promise<OrganizeResult> {
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

export async function getWindowSeedOrganizePreview(
  windowId: number,
  onStatus?: OrganizeProgressFn,
): Promise<LivePreviewResult> {
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
export async function organizeAroundCurrentPage(onProgress?: OrganizeProgressFn): Promise<OrganizeResult> {
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

export async function organizeByTopic(query: string, onProgress?: OrganizeProgressFn): Promise<OrganizeResult> {
  const q = query.trim();
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

let relatedPickCache: RelatedPick | null = null;

function relatedFingerprint(tabs: Array<{ id?: number }> | null | undefined, seedId: number): string {
  const ids = (tabs || [])
    .map((t) => t.id)
    .filter((id): id is number => typeof id === 'number')
    .sort((a, b) => a - b);
  return `${seedId}:${ids.join(',')}`;
}

async function classifyRelatedPick(onStatus?: OrganizeProgressFn): Promise<RelatedPick | RelatedEarlyFail> {
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
  relatedPickCache = matches.length >= 2
    ? { fp, ok: true, count: matches.length, name, matches, seed, source: r.source }
    : { fp, ok: false, reason: 'no_seed_match', count: matches.length, name, matches, seed, source: r.source };
  return relatedPickCache;
}

export async function relatedToNewWindowSummary(onStatus?: OrganizeProgressFn): Promise<RelatedSummary | null> {
  const pick = await classifyRelatedPick(onStatus);
  if (!('fp' in pick)) {
    if (pick.reason === 'no_window') return null;
    return { ok: false, reason: pick.reason, count: 0, name: '' };
  }
  if (!pick.ok) {
    return {
      ok: false,
      reason: pick.reason,
      count: pick.count,
      name: pick.name,
      error: pick.error,
      source: pick.source,
    };
  }
  return { ok: true, count: pick.count, name: pick.name, source: pick.source };
}

export async function moveRelatedToNewWindow(onProgress?: OrganizeProgressFn): Promise<MoveRelatedResult> {
  const pick = await classifyRelatedPick(onProgress);
  if (!('fp' in pick)) {
    return { ok: false, reason: pick.reason };
  }
  if (!pick.ok) {
    return { ok: false, reason: pick.reason, error: pick.error, source: pick.source };
  }
  const { seed, matches, name } = pick;
  if (!isStashableTab(seed) || typeof seed.id !== 'number') {
    return { ok: false, reason: 'no_seed' };
  }
  relatedPickCache = null;
  onProgress?.(`移到新窗口「${name}」`);
  let created: unknown;
  try {
    created = await chrome.windows.create({ tabId: seed.id, focused: true });
  } catch (e) {
    return { ok: false, reason: 'apply_failed', error: errorText(e) };
  }
  if (!isRecord(created) || typeof created.id !== 'number') return { ok: false, reason: 'no_window' };
  const newWindowId = created.id;

  const others = matches
    .map((t) => t.id)
    .filter((id): id is number => typeof id === 'number' && id !== seed.id);
  const byWin = new Map<number, number[]>();
  for (const id of others) {
    try {
      const t = await chrome.tabs.get(id);
      if (t.windowId === newWindowId || t.pinned || !isStashableTab(t)) continue;
      const bucket = byWin.get(t.windowId) ?? [];
      byWin.set(t.windowId, bucket);
      bucket.push(id);
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
    matches.map((t) => t.id).filter((id): id is number => typeof id === 'number'),
    newWindowId,
  );
  if (alive.length >= 2) {
    try {
      const [head, ...rest] = alive;
      const groupId = await tabsGroup({
        tabIds: [head, ...rest],
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
        error: errorText(e),
      };
    }
  }
  return { ok: true, moved, name, windowId: newWindowId, source: 'seed' };
}

export async function mergeOrganizeSummary(): Promise<MergeOrganizeSummary | null> {
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

export async function mergeAndOrganizeCurrent(
  opts: { onProgress?: OrganizeProgressFn } = {},
): Promise<MergeOrganizeResult> {
  const onProgress = opts.onProgress || (() => {});
  const summary = await mergeOrganizeSummary();
  if (!summary) return { ok: false, reason: 'no_window' };
  const { targetWindowId } = summary;

  onProgress('收集其他窗口标签…');
  const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const toMove: number[] = [];
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
