import type { Group, Session, StashedTab } from './storage.js'

/** Session 内固定/保留组名（靠名称识别，无额外 schema 字段） */
export const UNGROUPED_NAME = '未分组'
export const READ_LATER_NAME = '稍后阅读'

export function isUngroupedName(name: string | undefined) {
  return String(name || '') === UNGROUPED_NAME
}

export function isReadLaterName(name: string | undefined) {
  return String(name || '') === READ_LATER_NAME
}

/** 建议分组/启发式命名时忽略的组 */
export function isReservedGroupName(name: string | undefined) {
  return isUngroupedName(name) || isReadLaterName(name)
}

export function findReadLaterGroup(session: Session | undefined) {
  return (session?.groups || []).find((g) => isReadLaterName(g.name)) || null
}

/**
 * 保证会话内存在「稍后阅读」（可空）与「未分组」（可空）。
 * 排序：稍后阅读 → 其它主题组 → 未分组。
 */
export function ensureFixedGroups(session: Session, { newId }: { newId: () => string }) {
  if (!session.groups) session.groups = [];
  let readLater = findReadLaterGroup(session);
  if (!readLater) {
    readLater = { id: newId(), name: READ_LATER_NAME, tabs: [] };
    session.groups.push(readLater);
  }
  let ungrouped = session.groups.find((g) => isUngroupedName(g.name));
  if (!ungrouped) {
    ungrouped = { id: newId(), name: UNGROUPED_NAME, tabs: [] };
    session.groups.push(ungrouped);
  }
  session.groups = sortSessionGroups(session.groups);
  return { readLater, ungrouped };
}

export function sortSessionGroups(groups: Group[] | undefined) {
  const readLater: Group[] = []
  const ungrouped: Group[] = []
  const rest: Group[] = []
  for (const g of groups || []) {
    if (isReadLaterName(g.name)) readLater.push(g);
    else if (isUngroupedName(g.name)) ungrouped.push(g);
    else rest.push(g);
  }
  // 主题组保留原有相对顺序（不按名重排，避免写回 storage 打乱用户/建议顺序）
  return [...readLater, ...rest, ...ungrouped];
}

/** 参与建议分组的标签（排除稍后阅读） */
export function tabsForSuggest(session: Session | undefined) {
  const out: StashedTab[] = []
  for (const g of session?.groups || []) {
    if (isReadLaterName(g.name)) continue;
    for (const t of g.tabs || []) out.push(t);
  }
  return out;
}

/** 去掉空主题组，保留空的固定组，并稳定排序 */
export function pruneEmptyKeepFixed(session: Session) {
  session.groups = sortSessionGroups(
    (session.groups || []).filter(
      (g) => g.tabs.length > 0 || isReadLaterName(g.name) || isUngroupedName(g.name),
    ),
  );
  return session;
}
