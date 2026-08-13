/**
 * 当前窗口整理计划：跨站主题组优先新建/按组名并入，站点桶仍并入已有同站组，合并同站重复组。
 * 纯函数，不碰 chrome。
 */
import { isStashableTab } from './urls.js';
import { groupIsSiteish, isJunkGroupName, majoritySite, siteLabel, siteOfTab } from './groupLabels.js';

const TAB_GROUP_NONE = -1;

function isNativeUngrouped(tab, none = TAB_GROUP_NONE) {
  if (!tab) return false;
  return tab.groupId === undefined || tab.groupId === none;
}

function ungroupedStashable(tabs, none = TAB_GROUP_NONE) {
  return (tabs || []).filter((t) => isStashableTab(t) && isNativeUngrouped(t, none));
}

function chromeTabId(tab) {
  if (typeof tab?.tabId === 'number' && Number.isInteger(tab.tabId) && tab.tabId >= 0) return tab.tabId;
  const n = Number(tab?.id);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function chromeTabIds(tabs) {
  const ids = [];
  const seen = new Set();
  for (const t of tabs || []) {
    const id = chromeTabId(t);
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function decorateExistingGroups(windowTabs, existingMeta = [], none = TAB_GROUP_NONE) {
  const tabsByG = new Map();
  for (const t of windowTabs || []) {
    if (!isStashableTab(t) || isNativeUngrouped(t, none)) continue;
    if (typeof t.groupId !== 'number') continue;
    if (!tabsByG.has(t.groupId)) tabsByG.set(t.groupId, []);
    tabsByG.get(t.groupId).push(t);
  }
  const metaById = new Map((existingMeta || []).map((m) => [m.groupId, m]));
  const out = [];
  for (const [groupId, tabs] of tabsByG) {
    const meta = metaById.get(groupId) || {};
    out.push({
      groupId,
      title: String(meta.title || '').trim(),
      color: meta.color,
      tabs,
      site: majoritySite(tabs, 0.5),
    });
  }
  return out;
}

function largest(groups) {
  return [...groups].sort((a, b) => b.tabs.length - a.tabs.length || a.groupId - b.groupId)[0];
}

function normName(s) {
  return String(s || '').trim().toLowerCase();
}

export function matchExistingGroup(tab, existing) {
  const site = siteOfTab(tab);
  const label = site ? siteLabel(site) : '';
  const bySite = (existing || []).filter((g) => g.site && site && g.site === site);
  if (bySite.length) return largest(bySite);
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

function existingClusterKey(g) {
  if (g.site) return `site:${g.site}`;
  const title = String(g.title || '').trim();
  if (title && !isJunkGroupName(title)) return `title:${title.toLowerCase()}`;
  return `id:${g.groupId}`;
}

export function planHasWork(plan) {
  return !!(plan?.absorb?.length || plan?.create?.length || plan?.merge?.length);
}

/** 未成组、且对不上已有标签组的标签（站点对得上的会并入，不代表不参与主题分类） */
export function leftoversForClassify(windowTabs, existingMeta, none = TAB_GROUP_NONE) {
  const existing = decorateExistingGroups(windowTabs, existingMeta, none);
  return ungroupedStashable(windowTabs, none).filter((t) => !matchExistingGroup(t, existing));
}

/**
 * @param {object[]} windowTabs
 * @param {Array<{ groupId: number, title?: string }>} existingMeta
 * @param {{ groups?: Array<{ name: string, tabs?: object[] }> }} leftoverPreview  未成组标签的分类结果（含主题组）
 */
export function planLiveOrganize(windowTabs, existingMeta, leftoverPreview, none = TAB_GROUP_NONE) {
  const existing = decorateExistingGroups(windowTabs, existingMeta, none);

  const merge = [];
  const clusters = new Map();
  for (const g of existing) {
    const key = existingClusterKey(g);
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(g);
  }
  const keepGroups = [];
  for (const groups of clusters.values()) {
    const keep = largest(groups);
    keepGroups.push(keep);
    if (groups.length < 2) continue;
    const tabIds = [];
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

  const absorbMap = new Map();
  const claimed = new Set();
  for (const m of merge) {
    for (const id of m.tabIds) claimed.add(id);
  }

  const absorbInto = (hit, tabIds, name) => {
    if (!hit || !tabIds?.length) return;
    if (!absorbMap.has(hit.groupId)) {
      absorbMap.set(hit.groupId, {
        groupId: hit.groupId,
        name: hit.title || name || siteLabel(hit.site) || '标签组',
        tabIds: [],
      });
    }
    const rec = absorbMap.get(hit.groupId);
    for (const id of tabIds) {
      if (claimed.has(id)) continue;
      rec.tabIds.push(id);
      claimed.add(id);
    }
  };

  const create = [];
  for (const g of leftoverPreview?.groups || []) {
    const tabIds = chromeTabIds(g.tabs);
    if (!tabIds.length) continue;
    const byTitle = keepGroups.filter((e) => e.title && normName(e.title) === normName(g.name));
    if (byTitle.length) {
      absorbInto(largest(byTitle), tabIds, g.name);
      continue;
    }
    if (groupIsSiteish(g)) {
      const site = majoritySite(g.tabs);
      const bySite = keepGroups.filter((e) => e.site && site && e.site === site);
      if (bySite.length) {
        absorbInto(largest(bySite), tabIds, g.name);
        continue;
      }
    }
    if (tabIds.length >= 2) {
      create.push({ name: g.name || '未命名', tabIds });
      for (const id of tabIds) claimed.add(id);
    }
  }

  for (const t of ungroupedStashable(windowTabs, none)) {
    if (typeof t.id !== 'number' || claimed.has(t.id)) continue;
    const hit = matchExistingGroup(t, keepGroups);
    if (!hit) continue;
    absorbInto(hit, [t.id], hit.title);
  }

  const leftovers = ungroupedStashable(windowTabs, none).filter((t) => {
    if (typeof t.id !== 'number' || claimed.has(t.id)) return false;
    return !matchExistingGroup(t, keepGroups);
  });

  return {
    absorb: [...absorbMap.values()].filter((a) => a.tabIds.length),
    create,
    merge,
    leftoverCount: leftovers.length,
  };
}

export function previewFromPlan(plan, windowTabs) {
  const byId = new Map();
  for (const t of windowTabs || []) {
    if (typeof t.id === 'number') byId.set(t.id, t);
  }
  const titleOf = (id) => {
    const t = byId.get(id);
    return t?.title || t?.url || String(id);
  };
  const groups = [];
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
