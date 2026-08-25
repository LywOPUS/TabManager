/**
 * 当前窗口整理计划：按分类模型预览建组或并入同名已有组，合并同名重复原生组。
 * 已成组标签也可以被抽走重分。不按站点规则收散标签。
 */
import { isStashableTab } from './urls.js';
import { groupQualifier, isJunkGroupName, isTemplateSite, majoritySite, pathOwner, siteLabel, siteOfTab } from './groupLabels.js';
import type { LivePlan, LivePreview } from './liveOrganize.js';

const TAB_GROUP_NONE = -1;

export type PlanTab = {
  id?: number
  tabId?: number
  title?: string
  url?: string
  pendingUrl?: string
  pinned?: boolean
  highlighted?: boolean
  groupId?: number
}

export type ExistingGroupMeta = {
  groupId: number
  title?: string
  color?: string
}

export type PreviewTab = {
  id?: string | number
  tabId?: string | number
  title?: string
  url?: string
}

export type PreviewGroup = {
  name?: string
  tabs?: PreviewTab[]
  tabIds?: Array<string | number | undefined>
}

export type OrganizePreviewIn = {
  groups?: PreviewGroup[]
  ungrouped?: unknown[]
}

type DecoratedGroup = {
  groupId: number
  title: string
  color?: string
  tabs: PlanTab[]
  site: string
}

type AbsorbRec = {
  groupId: number
  name: string
  tabIds: number[]
}

function isNativeUngrouped(tab: PlanTab | null | undefined, none = TAB_GROUP_NONE): boolean {
  if (!tab) return false;
  return tab.groupId === undefined || tab.groupId === none;
}

function ungroupedStashable(tabs: PlanTab[] | null | undefined, none = TAB_GROUP_NONE): PlanTab[] {
  return (tabs || []).filter((t) => isStashableTab(t) && isNativeUngrouped(t, none));
}

function chromeTabId(tab: PreviewTab | PlanTab | null | undefined): number | null {
  if (typeof tab?.tabId === 'number' && Number.isInteger(tab.tabId) && tab.tabId >= 0) return tab.tabId;
  const n = Number(tab?.id);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function chromeTabIds(tabs: Array<PreviewTab | PlanTab> | null | undefined): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const t of tabs || []) {
    const id = chromeTabId(t);
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function decorateExistingGroups(
  windowTabs: PlanTab[] | null | undefined,
  existingMeta: ExistingGroupMeta[] = [],
  none = TAB_GROUP_NONE,
): DecoratedGroup[] {
  const tabsByG = new Map<number, PlanTab[]>();
  for (const t of windowTabs || []) {
    if (!isStashableTab(t) || isNativeUngrouped(t, none)) continue;
    if (typeof t.groupId !== 'number') continue;
    const bucket = tabsByG.get(t.groupId) ?? [];
    tabsByG.set(t.groupId, bucket);
    bucket.push(t);
  }
  const metaById = new Map((existingMeta || []).map((m) => [m.groupId, m]));
  const out: DecoratedGroup[] = [];
  for (const [groupId, tabs] of tabsByG) {
    const meta = metaById.get(groupId);
    out.push({
      groupId,
      title: String(meta?.title || '').trim(),
      color: meta?.color,
      tabs,
      site: majoritySite(tabs, 0.5),
    });
  }
  return out;
}

function largest(groups: DecoratedGroup[]): DecoratedGroup {
  const sorted = [...groups].sort((a, b) => b.tabs.length - a.tabs.length || a.groupId - b.groupId);
  const first = sorted[0];
  if (!first) throw new Error('largest: empty');
  return first;
}

function normName(s: unknown): string {
  return String(s || '').trim().toLowerCase();
}

export function matchExistingGroup(
  tab: PlanTab,
  existing: DecoratedGroup[] | null | undefined,
): DecoratedGroup | null {
  const site = siteOfTab(tab);
  const label = site ? siteLabel(site) : '';
  const owner = String(pathOwner(tab) || '').toLowerCase();

  if (owner && isTemplateSite(site)) {
    const byOwner = (existing || []).filter((g) => groupQualifier(g) === owner);
    if (byOwner.length) return largest(byOwner);
  }

  const bySite = (existing || []).filter((g) => g.site && site && g.site === site);
  if (isTemplateSite(site)) {
    const bare = bySite.filter((g) => {
      const t = String(g.title || '').trim();
      return !t || t.toLowerCase() === String(label).toLowerCase();
    });
    if (bare.length) return largest(bare);
  } else if (bySite.length) {
    return largest(bySite);
  }

  const want = new Set(
    [label, site].filter(Boolean).map((s) => String(s).toLowerCase()),
  );
  const byTitle = (existing || []).filter((g) => {
    const t = String(g.title || '').trim().toLowerCase();
    return t && want.has(t);
  });
  if (byTitle.length) return largest(byTitle);
  return null;
}

function existingClusterKey(g: DecoratedGroup): string {
  const title = String(g.title || '').trim();
  if (title && !isJunkGroupName(title)) return `title:${title.toLowerCase()}`;
  return `id:${g.groupId}`;
}

export function planHasWork(plan: LivePlan | null | undefined): boolean {
  return !!(plan?.absorb?.length || plan?.create?.length || plan?.merge?.length);
}

/** 未成组、且对不上已有标签组的标签（站点对得上的会并入，不代表不参与主题分类） */
export function leftoversForClassify(
  windowTabs: PlanTab[] | null | undefined,
  existingMeta: ExistingGroupMeta[] | null | undefined,
  none = TAB_GROUP_NONE,
): PlanTab[] {
  const existing = decorateExistingGroups(windowTabs, existingMeta || [], none);
  return ungroupedStashable(windowTabs, none).filter((t) => !matchExistingGroup(t, existing));
}

function stashableTabs(tabs: PlanTab[] | null | undefined): PlanTab[] {
  return (tabs || []).filter((t) => isStashableTab(t));
}

function tabGroupOf(tabs: PlanTab[] | null | undefined, none = TAB_GROUP_NONE): Map<number, number> {
  const map = new Map<number, number>();
  for (const t of tabs || []) {
    const id = chromeTabId(t);
    if (id == null || typeof t.groupId !== 'number' || t.groupId === none) continue;
    map.set(id, t.groupId);
  }
  return map;
}

function makeAbsorbInto(
  absorbMap: Map<number, AbsorbRec>,
  claimed: Set<number>,
  groupOf: Map<number, number> = new Map(),
) {
  return (hit: DecoratedGroup | null | undefined, tabIds: number[] | null | undefined, name?: string) => {
    if (!hit || !tabIds?.length) return;
    let rec = absorbMap.get(hit.groupId);
    if (!rec) {
      rec = {
        groupId: hit.groupId,
        name: hit.title || name || siteLabel(hit.site) || '标签组',
        tabIds: [],
      };
      absorbMap.set(hit.groupId, rec);
    }
    for (const id of tabIds) {
      if (claimed.has(id)) continue;
      if (groupOf.get(id) === hit.groupId) {
        claimed.add(id);
        continue;
      }
      rec.tabIds.push(id);
      claimed.add(id);
    }
  };
}

function previewGroupIds(group: PreviewGroup | null | undefined): Set<string> {
  const ids = new Set<string>();
  for (const id of group?.tabIds || []) ids.add(String(id));
  for (const t of group?.tabs || []) {
    if (t?.id != null) ids.add(String(t.id));
    if (typeof t?.tabId === 'number') ids.add(String(t.tabId));
  }
  return ids;
}

export function previewGroupHasTab(group: PreviewGroup | null | undefined, tab: PlanTab | PreviewTab | null | undefined): boolean {
  const ids = previewGroupIds(group);
  const id = chromeTabId(tab);
  if (id != null && ids.has(String(id))) return true;
  return tab?.id != null && ids.has(String(tab.id));
}

/** 分类预览里包含种子页、且至少 2 条的那一组 */
export function pickSeedGroupFromPreview(
  preview: OrganizePreviewIn | null | undefined,
  seed: PlanTab | PreviewTab | null | undefined,
): PreviewGroup | null {
  const groups = (preview?.groups || []).filter((g) => (g.tabs?.length || g.tabIds?.length || 0) >= 2);
  return groups.find((g) => previewGroupHasTab(g, seed)) || null;
}

/** 分类预览里组名对得上用户主题的那一组（先精确，再包含） */
export function pickTopicGroupFromPreview(
  preview: OrganizePreviewIn | null | undefined,
  query: unknown,
): PreviewGroup | null {
  const q = normName(query).replace(/\s+/g, '');
  if (!q) return null;
  const groups = (preview?.groups || []).filter((g) => (g.tabs?.length || g.tabIds?.length || 0) >= 2);
  const scored: Array<{ g: PreviewGroup; rank: number }> = [];
  for (const g of groups) {
    const n = normName(g.name).replace(/\s+/g, '');
    if (!n) continue;
    if (n === q) scored.push({ g, rank: 0 });
    else if (n.includes(q) || q.includes(n)) scored.push({ g, rank: 1 });
  }
  scored.sort((a, b) => a.rank - b.rank || (b.g.tabs?.length || 0) - (a.g.tabs?.length || 0));
  return scored[0]?.g || null;
}

export function tabsForPreviewGroup(
  tabs: PlanTab[] | null | undefined,
  group: PreviewGroup | null | undefined,
): PlanTab[] {
  const ids = previewGroupIds(group);
  return stashableTabs(tabs).filter((t) => {
    const id = chromeTabId(t);
    return (id != null && ids.has(String(id))) || (t?.id != null && ids.has(String(t.id)));
  });
}

/**
 * 只把模型选出的标签收成一组（可从已有组抽走），不动其余标签。
 */
export function planMatchedOrganize(
  windowTabs: PlanTab[] | null | undefined,
  existingMeta: ExistingGroupMeta[] | null | undefined,
  none = TAB_GROUP_NONE,
  matches: PlanTab[] = [],
  name = '',
): LivePlan {
  const title = String(name || '').trim() || '分组';
  const existing = decorateExistingGroups(windowTabs, existingMeta || [], none);
  const groupOf = tabGroupOf(windowTabs, none);
  const absorbMap = new Map<number, AbsorbRec>();
  const claimed = new Set<number>();
  const absorbInto = makeAbsorbInto(absorbMap, claimed, groupOf);
  const create: LivePlan['create'] = [];
  const picked = stashableTabs(matches);
  if (picked.length >= 2) {
    const hit = existing.find((g) => normName(g.title) === normName(title));
    const tabIds = picked.map((t) => chromeTabId(t)).filter((id): id is number => id != null);
    if (hit) {
      absorbInto(hit, tabIds, title);
    } else if (tabIds.length >= 2) {
      create.push({ name: title, tabIds });
      for (const id of tabIds) claimed.add(id);
    }
  }
  return {
    absorb: [...absorbMap.values()].filter((a) => a.tabIds.length),
    create,
    merge: [],
    leftoverCount: stashableTabs(windowTabs).filter((t) => typeof t.id === 'number' && !claimed.has(t.id)).length,
  };
}

/**
 * @param windowTabs
 * @param existingMeta
 * @param leftoverPreview  本窗可收纳标签的分类结果（含已成组）
 * @param none
 * @param opts  选中整理传 mergeExisting:false，不合并未选中的同名组
 */
export function planLiveOrganize(
  windowTabs: PlanTab[] | null | undefined,
  existingMeta: ExistingGroupMeta[] | null | undefined,
  leftoverPreview: OrganizePreviewIn | null | undefined,
  none = TAB_GROUP_NONE,
  opts: { mergeExisting?: boolean } = {},
): LivePlan {
  const existing = decorateExistingGroups(windowTabs, existingMeta || [], none);
  const mergeExisting = opts.mergeExisting !== false;

  const merge: LivePlan['merge'] = [];
  const clusters = new Map<string, DecoratedGroup[]>();
  for (const g of existing) {
    const key = existingClusterKey(g);
    const bucket = clusters.get(key) ?? [];
    clusters.set(key, bucket);
    bucket.push(g);
  }
  const keepGroups: DecoratedGroup[] = [];
  for (const groups of clusters.values()) {
    const keep = largest(groups);
    keepGroups.push(keep);
    if (!mergeExisting || groups.length < 2) continue;
    const tabIds: number[] = [];
    for (const g of groups) {
      if (g.groupId === keep.groupId) continue;
      for (const t of g.tabs) {
        if (typeof t.id === 'number') tabIds.push(t.id);
      }
    }
    if (tabIds.length) {
      merge.push({
        keepGroupId: keep.groupId,
        name: keep.title || siteLabel(keep.site) || '标签组',
        tabIds,
      });
    }
  }

  const absorbMap = new Map<number, AbsorbRec>();
  const claimed = new Set<number>();
  for (const m of merge) {
    for (const id of m.tabIds) claimed.add(id);
  }

  const absorbInto = makeAbsorbInto(absorbMap, claimed, tabGroupOf(windowTabs, none));
  const create: LivePlan['create'] = [];

  for (const g of leftoverPreview?.groups || []) {
    const fromTabs = chromeTabIds(g.tabs);
    const fromIds = (g.tabIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id >= 0);
    const tabIds = [...new Set(fromTabs.length ? fromTabs : fromIds)].filter((id) => !claimed.has(id));
    if (!tabIds.length) continue;
    const byTitle = keepGroups.filter((e) => e.title && normName(e.title) === normName(g.name));
    if (byTitle.length) {
      absorbInto(largest(byTitle), tabIds, g.name);
      continue;
    }
    if (tabIds.length >= 2) {
      create.push({ name: g.name || '未命名', tabIds });
      for (const id of tabIds) claimed.add(id);
    }
  }

  const leftovers = stashableTabs(windowTabs).filter((t) => typeof t.id === 'number' && !claimed.has(t.id));

  return {
    absorb: [...absorbMap.values()].filter((a) => a.tabIds.length),
    create,
    merge,
    leftoverCount: leftovers.length,
  };
}

/** 只整理预览里的标签：可并入同名已有组，不合并窗口里其它同名组。 */
export function planSelectedOrganize(
  windowTabs: PlanTab[] | null | undefined,
  existingMeta: ExistingGroupMeta[] | null | undefined,
  selectedPreview: OrganizePreviewIn | null | undefined,
  none = TAB_GROUP_NONE,
): LivePlan {
  return planLiveOrganize(windowTabs, existingMeta, selectedPreview, none, { mergeExisting: false });
}

export function previewFromPlan(
  plan: LivePlan | null | undefined,
  windowTabs: PlanTab[] | null | undefined,
): LivePreview {
  const byId = new Map<number, PlanTab>();
  for (const t of windowTabs || []) {
    if (typeof t.id === 'number') byId.set(t.id, t);
  }
  const titleOf = (id: number) => {
    const t = byId.get(id);
    return t?.title || t?.url || String(id);
  };
  const groups: LivePreview['groups'] = [];
  for (const a of plan?.absorb || []) {
    groups.push({
      name: a.name,
      action: 'absorb',
      tabs: a.tabIds.map((id) => ({ title: titleOf(id) })),
      tabIds: a.tabIds.map(String),
    });
  }
  for (const c of plan?.create || []) {
    groups.push({
      name: c.name,
      action: 'create',
      tabs: c.tabIds.map((id) => ({ title: titleOf(id) })),
      tabIds: c.tabIds.map(String),
    });
  }
  for (const m of plan?.merge || []) {
    groups.push({
      name: m.name,
      action: 'merge',
      tabs: m.tabIds.map((id) => ({ title: titleOf(id) })),
      tabIds: m.tabIds.map(String),
    });
  }
  return { groups, ungrouped: [] };
}
