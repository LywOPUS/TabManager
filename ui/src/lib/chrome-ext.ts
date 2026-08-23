import {
  getData as getDataRaw,
  getRecentSession as getRecentSessionRaw,
  mutateData as mutateDataRaw,
  updateSession,
  deleteSession,
  newId,
  buildExportPayload,
  mergeImport,
} from '@ext/lib/storage.js'
import {
  ensureFixedGroups,
  isReadLaterName,
  isUngroupedName,
  pruneEmptyKeepFixed,
} from '@ext/lib/groupNames.js'

export { updateSession, deleteSession, newId, buildExportPayload, mergeImport }

export { suggestGroupsSmart } from '@ext/lib/localClassify.js'
export { proposeEnhancement, applyEnhancement, applyPreviewToSession } from '@ext/lib/agentEnhance.js'
export {
  READ_LATER_NAME,
  UNGROUPED_NAME,
  ensureFixedGroups,
  isReadLaterName,
  isUngroupedName,
  isReservedGroupName,
  sortSessionGroups,
  tabsForSuggest,
  findReadLaterGroup,
  pruneEmptyKeepFixed,
} from '@ext/lib/groupNames.js'
export {
  preloadBrowserModel,
  getBrowserModelWarmState,
  getLastEmbedDevice,
  unloadBrowserModel,
} from '@ext/lib/browserEmbedClassify.js'
import { isBrowserModelCacheReady } from '@ext/lib/browserModelCache.js'
export {
  MODEL_NOT_DOWNLOADED,
  inspectBrowserModelCache,
  listBrowserModelCache,
  deleteBrowserModelCache,
  purgeLeftoverModelCache,
  isBrowserModelCacheReady,
} from '@ext/lib/browserModelCache.js'
export {
  collectClosableTabs,
  CLOSE_IDLE_MS,
} from '@ext/lib/closeSuggest.js'
export {
  findDuplicates,
  removeDuplicates,
  findOpenTabDuplicates,
  closeOpenTabDuplicates,
} from '@ext/lib/dedup.js'
export {
  collectTabUsage,
  discardTabsByIds,
  closeTabsByIds,
  formatBytes,
  formatIdle,
  DEFAULT_IDLE_MS,
  defaultIdleMinutes,
  processesApiAvailable,
  ensureProcessesPermission,
  isActionableUsageRow,
} from '@ext/lib/tabUsage.js'
import {
  getSettings,
  setSettings,
  classifyOptsFromSettings,
} from '@ext/lib/settings.js'
export {
  getSettings,
  setSettings,
  classifyOptsFromSettings,
}
export { BROWSER_MODELS } from '@ext/lib/browserModels.js'
export { isRestorableUrl } from '@ext/lib/urls.js'
export {
  mergeOrganizeSummary,
  getCurrentWindowOrganizePreview,
  applyNativeGroups,
  applyLivePlan,
  mergeAndOrganizeCurrent,
  summarizeHighlightedTabs,
} from '@ext/lib/liveOrganize.js'

export type OrganizeJobResult = {
  ok?: boolean
  reason?: string
  error?: string
  count?: number
  name?: string
  moved?: number
  topic?: string
  source?: string
  apply?: { created?: number; absorbTabs?: number; merged?: number }
  summary?: { movableTabs?: number }
}

/** 弹窗整理：只发消息，活在 background。关掉弹窗也不中断。 */
export async function runPopupOrganize(
  op: 'window' | 'selected' | 'around' | 'topic' | 'related-summary' | 'related' | 'merge',
  payload: { query?: string } = {},
  onStatus?: (text: string) => void,
): Promise<OrganizeJobResult> {
  const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const onMsg = (msg: { type?: string; reqId?: string; text?: string }) => {
    if (msg?.type === 'tm-job-status' && msg.reqId === reqId && msg.text) {
      const t = String(msg.text)
      onStatus?.(/文件已齐|下载中|^从 .+ 拉取|正在下载/.test(t) ? '正在加载模型' : t)
    }
  }
  chrome.runtime.onMessage.addListener(onMsg)
  try {
    const r = await chrome.runtime.sendMessage({
      type: 'tm-organize',
      job: op,
      reqId,
      query: payload.query,
    })
    if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message)
    if (!r) return { ok: false, reason: 'stale_sw' }
    if (r.reason === 'unknown' || r.error === 'unknown') {
      return { ok: false, reason: 'stale_sw', error: r.error }
    }
    return r
  } finally {
    chrome.runtime.onMessage.removeListener(onMsg)
  }
}
export { summarizeOpenTabGroups, ungroupAllWindows } from '@ext/lib/ungroupTabs.js'
export { restoreGroup, restoreSessionGroups } from '@ext/lib/restore.js'

export type StashedTab = {
  id: string
  title: string
  url: string
  favIconUrl?: string
}

export type Group = {
  id: string
  name: string
  tabs: StashedTab[]
}

export type Session = {
  id: string
  name: string
  createdAt: number
  groups: Group[]
}

export type StoreData = {
  schemaVersion: number
  sessions: Session[]
}

export async function getData(): Promise<StoreData> {
  return getDataRaw() as Promise<StoreData>
}

export async function mutateData<T>(mutator: (data: StoreData) => T | Promise<T>): Promise<T> {
  return mutateDataRaw(mutator) as Promise<T>
}

export async function getRecentSession(): Promise<Session | null> {
  return getRecentSessionRaw() as Promise<Session | null>
}

export function tabCount(session: Session) {
  return session.groups.reduce((n, g) => n + g.tabs.length, 0)
}

export function flattenTabs(session: Session) {
  const items: Array<StashedTab & { groupId: string }> = []
  for (const g of session.groups) {
    for (const t of g.tabs) items.push({ ...t, groupId: g.id })
  }
  return items
}

/** 移动会话内标签到「稍后阅读」或「未分组」 */
export async function moveTabToGroup(
  sessionId: string,
  tabId: string,
  target: 'readLater' | 'ungrouped',
) {
  return mutateData((data) => {
    const session = data.sessions.find((s) => s.id === sessionId)
    if (!session) return { ok: false as const, reason: 'missing' }
    const { readLater, ungrouped } = ensureFixedGroups(session, { newId })
    let tab: StashedTab | null = null
    for (const g of session.groups) {
      const idx = g.tabs.findIndex((t) => t.id === tabId)
      if (idx >= 0) {
        tab = g.tabs[idx]
        g.tabs.splice(idx, 1)
        break
      }
    }
    if (!tab) return { ok: false as const, reason: 'no_tab' }
    ;(target === 'readLater' ? readLater : ungrouped).tabs.push(tab)
    pruneEmptyKeepFixed(session)
    ensureFixedGroups(session, { newId })
    return { ok: true as const }
  })
}

/**
 * 解散分组：标签并入「未分组」。
 * 「未分组」「稍后阅读」不可解散；其它主题组解散后删除。
 */
export async function dissolveGroup(sessionId: string, groupId: string) {
  return mutateData((data) => {
    const session = data.sessions.find((s) => s.id === sessionId)
    if (!session) return { ok: false as const, reason: 'missing' }
    const { ungrouped } = ensureFixedGroups(session, { newId })
    const group = session.groups.find((g) => g.id === groupId)
    if (!group) return { ok: false as const, reason: 'no_group' }
    if (isUngroupedName(group.name)) return { ok: false as const, reason: 'ungrouped' }
    if (isReadLaterName(group.name)) return { ok: false as const, reason: 'read_later' }

    const moved = group.tabs.length
    if (moved) ungrouped.tabs.push(...group.tabs)
    session.groups = session.groups.filter((g) => g.id !== groupId)
    pruneEmptyKeepFixed(session)
    ensureFixedGroups(session, { newId })
    return { ok: true as const, moved, name: group.name }
  })
}

export function dissolvePrompt(groupName: string, n: number) {
  return n > 0
    ? `解散「${groupName}」？其中 ${n} 个标签将移入「未分组」。`
    : `删除空分组「${groupName}」？`
}

export function dissolveFailText(reason?: string) {
  if (reason === 'ungrouped') return '「未分组」不能解散'
  if (reason === 'read_later') return '「稍后阅读」不能解散'
  return '解散失败'
}

export function dissolveOkText(r: { moved?: number; name?: string }) {
  return r.moved
    ? `已解散「${r.name}」，${r.moved} 个标签已移入未分组`
    : `已删除空分组「${r.name}」`
}

export function ungroupAllPrompt(groupCount: number, windowCount: number) {
  if (!groupCount) return '当前没有标签组可解散'
  const win = windowCount > 1 ? `（${windowCount} 个窗口）` : ''
  return `解散全部窗口中的 ${groupCount} 个标签组${win}？标签会留下，只拆开分组。`
}

export function ungroupAllOkText(r: { tabCount: number; groupCount: number }) {
  if (!r.groupCount) return '没有标签组'
  return `已解散 ${r.groupCount} 个标签组（${r.tabCount} 个标签）`
}

export async function browserModelLibraryRequired(settings?: {
  classifyMode?: string
  browserModelId?: string
}) {
  const s = settings || (await getSettings())
  if (s.classifyMode !== 'browser') return false
  return !(await isBrowserModelCacheReady(s.browserModelId))
}

export function organizeFailText(reason?: string, error?: string) {
  const err = String(error || '')
  if (err.includes('模型未下载')) return err.slice(0, 140)
  if (reason === 'busy') return err || '正在整理，请稍候'
  if (reason === 'stale_sw' || reason === 'unknown') {
    return '扩展后台未更新，请到扩展页重新加载后再整理'
  }
  if (reason === 'classify_failed') {
    return error ? `分类失败：${err.slice(0, 140)}` : '分类模型不可用，未改动标签组'
  }
  if (reason === 'too_few') return '可整理的标签太少'
  if (reason === 'no_selection') return '请先在标签栏多选至少 2 个标签（Ctrl / Shift）'
  if (reason === 'no_seed') return '当前页无法作为归组起点'
  if (reason === 'no_seed_match') return '当前页附近没有可归入的标签'
  if (reason === 'no_topic') return '请输入主题'
  if (reason === 'no_topic_match') return '没有匹配该主题的标签'
  if (reason === 'no_groups' || reason === 'no_valid_groups') return '没有可成组的建议'
  if (reason === 'no_window') return '找不到当前窗口'
  if (reason === 'partial') return '部分标签组未完成'
  if (reason === 'all_failed' || reason === 'apply_failed') return '分组失败，已有标签组未改'
  if (err) return `整理失败：${err.slice(0, 140)}`
  return '整理失败'
}

export function organizeOkText(r: {
  apply?: { created?: number; absorbTabs?: number; merged?: number }
  source?: string
}) {
  const a = r.apply || {}
  const parts = []
  if (a.absorbTabs) parts.push(`并入 ${a.absorbTabs}`)
  if (a.created) parts.push(`新建 ${a.created} 组`)
  if (a.merged) parts.push(`合并 ${a.merged} 组`)
  const src = sourceLabel(r.source)
  return parts.length ? `已整理 · ${parts.join(' · ')}（${src}）` : `已整理当前窗口（${src}）`
}

export function selectedOrganizeOkText(r: {
  apply?: { created?: number; absorbTabs?: number; merged?: number }
  source?: string
  count?: number
}) {
  const a = r.apply || {}
  const parts = []
  if (a.absorbTabs) parts.push(`并入 ${a.absorbTabs}`)
  if (a.created) parts.push(`新建 ${a.created} 组`)
  if (a.merged) parts.push(`合并 ${a.merged} 组`)
  const src = sourceLabel(r.source)
  const n = r.count ? `${r.count} 个` : '选中'
  return parts.length ? `已整理${n}标签 · ${parts.join(' · ')}（${src}）` : `已整理${n}标签（${src}）`
}

export function seedOrganizeOkText(r: {
  apply?: { created?: number; absorbTabs?: number }
}) {
  const a = r.apply || {}
  const parts = []
  if (a.absorbTabs) parts.push(`并入 ${a.absorbTabs}`)
  if (a.created) parts.push(`新建 ${a.created} 组`)
  return parts.length ? `已按当前页归组 · ${parts.join(' · ')}` : '已按当前页归组'
}

export function topicOrganizeOkText(r: {
  apply?: { created?: number; absorbTabs?: number }
  topic?: string
}) {
  const a = r.apply || {}
  const parts = []
  if (a.absorbTabs) parts.push(`并入 ${a.absorbTabs}`)
  if (a.created) parts.push(`新建 ${a.created} 组`)
  const topic = r.topic ? `「${r.topic}」` : '主题'
  return parts.length ? `已按${topic}归组 · ${parts.join(' · ')}` : `已按${topic}归组`
}

export function relatedWindowPrompt(n: number, name?: string) {
  const label = name ? `「${name}」` : '相关'
  return `把 ${n} 个${label}标签移到新窗口并成组？`
}

export function relatedWindowOkText(r: { moved?: number; name?: string }) {
  const name = r.name ? `「${r.name}」` : ''
  return `已将 ${r.moved ?? 0} 个标签移到新窗口${name}`
}

export function mergeAllPrompt(otherWindows: number, movableTabs: number) {
  if (!otherWindows || !movableTabs) return '没有其他窗口可合并'
  return `将 ${otherWindows} 个其他窗口的 ${movableTabs} 个标签并到当前窗口并整理？`
}

export function mergeOkText(r: {
  apply?: { created?: number; absorbTabs?: number; merged?: number }
  source?: string
  summary?: { movableTabs?: number }
}) {
  const moved = r.summary?.movableTabs
  const organized = organizeOkText(r)
  return moved ? `已合并 ${moved} 个标签 · ${organized}` : organized
}

export function sourceLabel(source: string | undefined) {
  if (source === 'browser-embed') return '浏览器内小模型'
  if (source === 'error') return '分类失败'
  if (source === 'empty') return '无标签'
  return '分类模型'
}

export function classifyModeLabel(_mode?: string) {
  return '浏览器内小模型'
}
