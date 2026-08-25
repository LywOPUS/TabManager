/**
 * 收纳后的 agent 增强：提议（分组 + 命名）与确认应用分离。
 * 在扩展页面上下文（管理页 / popup）调用；service worker 不跑模型。
 */
import { mutateData, newId } from './storage.js';
import { suggestGroupsSmart } from './localClassify.js';
import {
  READ_LATER_NAME,
  UNGROUPED_NAME,
  ensureFixedGroups,
  isReadLaterName,
  isReservedGroupName,
  sortSessionGroups,
} from './groupNames.js';

/** 把 suggest 预览写回 session（就地修改 groups）；「稍后阅读」整组保留不动 */
export function applyPreviewToSession(session, preview) {
  const { readLater } = ensureFixedGroups(session, { newId });
  const readLaterIds = new Set((readLater.tabs || []).map((t) => t.id));
  const readLaterTabs = [...(readLater.tabs || [])];

  const flat = [];
  for (const g of session.groups) {
    if (isReadLaterName(g.name)) continue;
    for (const t of g.tabs) flat.push(t);
  }
  const byId = new Map(flat.map((t) => [t.id, t]));
  const used = new Set();
  const groups = [];

  for (const g of preview.groups || []) {
    const rawName = String(g.name || '分组').slice(0, 40);
    // 模型若输出「稍后阅读」，并入固定组而非另建同名组
    if (isReadLaterName(rawName)) {
      for (const id of g.tabIds || []) {
        const t = byId.get(id);
        if (t && !used.has(t.id) && !readLaterIds.has(t.id)) {
          used.add(t.id);
          readLaterTabs.push(t);
          readLaterIds.add(t.id);
        }
      }
      continue;
    }
    const tabs = [];
    for (const id of g.tabIds || []) {
      const t = byId.get(id);
      if (t && !used.has(t.id)) {
        used.add(t.id);
        tabs.push(t);
      }
    }
    if (tabs.length) {
      const name = isReservedGroupName(rawName) ? '分组' : rawName;
      groups.push({ id: newId(), name, tabs });
    }
  }
  const rest = flat.filter((t) => !used.has(t.id));
  if (rest.length || !groups.length) {
    groups.push({ id: newId(), name: UNGROUPED_NAME, tabs: rest });
  }
  session.groups = sortSessionGroups([
    { id: readLater.id, name: READ_LATER_NAME, tabs: readLaterTabs },
    ...groups.filter((g) => !isReadLaterName(g.name)),
  ]);
  ensureFixedGroups(session, { newId });
}

/** 会话名：用模型给出的最大两个组名拼接，不用域名 */
function nameFromGroups(groups) {
  const sized = (groups || [])
    .filter((g) => g.name && !isReservedGroupName(g.name))
    .map((g) => ({ name: g.name, n: (g.tabIds || g.tabs || []).length }))
    .sort((a, b) => b.n - a.n);
  if (sized.length) return sized.slice(0, 2).map((g) => g.name).join(' · ');
  return '';
}

/**
 * 生成增强提议（不写存储）：
 * - preview：分组预览（suggestGroupsSmart，浏览器内小模型）
 * - name：建议会话名（最大两个组名拼接）
 *
 * opts 同 suggestGroupsSmart；withName 仅为旧调用兼容，忽略。
 * 返回 { preview, source, error, name }。
 */
export async function proposeEnhancement(items, opts = {}, { onStatus } = {}) {
  const { withName, ...classifyOpts } = opts;
  onStatus?.('生成分组');
  const { preview, source, error } = await suggestGroupsSmart(items, { ...classifyOpts, onStatus });
  const name = nameFromGroups(preview.groups);
  return { preview, source, error, name };
}

/**
 * 确认后应用：把预览分组与（可选）会话名写回存储。
 * preview 传 null 可只改名。
 */
export async function applyEnhancement(sessionId, { preview, name } = {}) {
  return mutateData((data) => {
    const session = data.sessions.find((s) => s.id === sessionId);
    if (!session) return { ok: false, reason: 'missing' };
    const grouped = !!preview?.groups?.length;
    if (grouped) applyPreviewToSession(session, preview);
    const renamed = !!name && name !== session.name;
    if (renamed) session.name = name;
    return { ok: true, grouped, renamed, name: session.name };
  });
}
