import {
  getData as getDataRaw,
  getRecentSession as getRecentSessionRaw,
  setData,
  updateSession,
  deleteSession,
  newId,
  buildExportPayload,
  mergeImport,
} from '../../../extension/lib/storage.js'

export { setData, updateSession, deleteSession, newId, buildExportPayload, mergeImport }

export { suggestGroupsSmart } from '../../../extension/lib/localClassify.js'
export { proposeEnhancement, applyEnhancement, applyPreviewToSession } from '../../../extension/lib/agentEnhance.js'
export {
  preloadBrowserModel,
  getBrowserModelWarmState,
  getLastEmbedDevice,
} from '../../../extension/lib/browserEmbedClassify.js'
export { findDuplicates, removeDuplicates } from '../../../extension/lib/dedup.js'
export { getSettings, setSettings } from '../../../extension/lib/settings.js'
export { BROWSER_MODELS } from '../../../extension/lib/browserModels.js'
export { isRestorableUrl } from '../../../extension/lib/urls.js'
export {
  mergeOrganizeSummary,
  getCurrentWindowOrganizePreview,
  applyNativeGroups,
  mergeAndOrganizeCurrent,
} from '../../../extension/lib/liveOrganize.js'
export { restoreGroup, restoreSessionGroups } from '../../../extension/lib/restore.js'

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

export function sourceLabel(source: string | undefined) {
  if (source === 'gemini-nano') return 'Gemini Nano'
  if (source === 'browser-embed') return '浏览器内小模型'
  if (source === 'local-model') return 'Ollama'
  if (source === 'heuristic-fallback') return '已回退站点'
  return '按站点'
}
