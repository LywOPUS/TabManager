/**
 * 整理活只在 background 跑。弹窗发 ORGANIZE，听 tm-job-status。
 */
import {
  mergeAndOrganizeCurrent,
  moveRelatedToNewWindow,
  organizeAroundCurrentPage,
  organizeByTopic,
  organizeCurrentWindow,
  organizeSelectedTabs,
  relatedToNewWindowSummary,
  type MergeOrganizeResult,
  type MoveRelatedResult,
  type OrganizeResult,
  type RelatedSummary,
} from './liveOrganize.js'
import type { OrganizeJobResult } from './organizeJob.js'

export type { OrganizeApply, OrganizeJobFail, OrganizeJobName, OrganizeJobOk, OrganizeJobResult } from './organizeJob.js'
export { isOrganizeJobName, parseOrganizeJobResult } from './organizeJob.js'

export type OrganizeJobPayload = {
  query?: string
}

function fromOrganizeResult(r: OrganizeResult): OrganizeJobResult {
  if (!r.ok) return { ok: false, reason: r.reason, error: r.error }
  return {
    ok: true,
    source: r.source,
    count: r.count,
    topic: r.topic,
    apply: {
      created: r.apply.created,
      absorbTabs: r.apply.absorbTabs,
      merged: r.apply.merged,
    },
  }
}

function fromMoveRelated(r: MoveRelatedResult): OrganizeJobResult {
  if (!r.ok) return { ok: false, reason: r.reason, error: r.error }
  return { ok: true, moved: r.moved, name: r.name, source: r.source }
}

function fromMerge(r: MergeOrganizeResult): OrganizeJobResult {
  if (!r.ok) return { ok: false, reason: r.reason, error: r.error }
  return {
    ok: true,
    source: r.source,
    apply: { created: r.apply.created },
    summary: { movableTabs: r.summary.movableTabs },
  }
}

function fromRelatedSummary(s: RelatedSummary | null): OrganizeJobResult {
  if (!s) return { ok: false, reason: 'no_window' }
  if (!s.ok) return { ok: false, reason: s.reason, error: s.error }
  return { ok: true, count: s.count, name: s.name, source: s.source }
}

let running: Promise<OrganizeJobResult> | null = null

export function organizeJobBusy(): boolean {
  return !!running
}

export async function runOrganizeJob(
  op: string,
  payload: OrganizeJobPayload = {},
  onStatus?: (text: string) => void,
): Promise<OrganizeJobResult> {
  if (running) return { ok: false, reason: 'busy', error: '正在整理，请稍候' }
  const task = (async (): Promise<OrganizeJobResult> => {
    switch (op) {
      case 'window':
        return fromOrganizeResult(await organizeCurrentWindow(onStatus))
      case 'selected':
        return fromOrganizeResult(await organizeSelectedTabs(onStatus))
      case 'around':
        return fromOrganizeResult(await organizeAroundCurrentPage(onStatus))
      case 'topic':
        return fromOrganizeResult(await organizeByTopic(String(payload.query || ''), onStatus))
      case 'related-summary':
        return fromRelatedSummary(await relatedToNewWindowSummary(onStatus))
      case 'related':
        return fromMoveRelated(await moveRelatedToNewWindow(onStatus))
      case 'merge':
        return fromMerge(await mergeAndOrganizeCurrent({ onProgress: onStatus }))
      default:
        return { ok: false, reason: 'stale_sw', error: `不支持的整理操作：${op || '空'}` }
    }
  })()
  running = task
  try {
    return await task
  } finally {
    if (running === task) running = null
  }
}

export function organizeStatusText(text: unknown): string {
  const t = String(text || '')
  if (!t) return ''
  if (/文件已齐|下载中|^从 .+ 拉取|正在下载/.test(t)) return '正在加载模型'
  return t
}

export function jobStatusFn(reqId: string | undefined): ((text: string) => void) | undefined {
  if (!reqId) return undefined
  return (text) => {
    const out = organizeStatusText(text)
    if (!out) return
    chrome.runtime.sendMessage({
      type: 'tm-job-status',
      reqId,
      text: out,
    }).catch(() => {})
  }
}
