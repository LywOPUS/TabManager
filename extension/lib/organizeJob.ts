import { isRecord, optFiniteNumber, optString } from './unknown.js'

export const ORGANIZE_JOBS = [
  'window',
  'selected',
  'around',
  'topic',
  'related-summary',
  'related',
  'merge',
] as const

export type OrganizeJobName = (typeof ORGANIZE_JOBS)[number]

export type OrganizeApply = {
  created?: number
  absorbTabs?: number
  merged?: number
}

export type OrganizeJobOk = {
  ok: true
  count?: number
  name?: string
  moved?: number
  topic?: string
  source?: string
  apply?: OrganizeApply
  summary?: { movableTabs?: number }
}

export type OrganizeJobFail = {
  ok: false
  reason: string
  error?: string
}

export type OrganizeJobResult = OrganizeJobOk | OrganizeJobFail

export function isOrganizeJobName(value: unknown): value is OrganizeJobName {
  if (typeof value !== 'string') return false
  for (const job of ORGANIZE_JOBS) if (job === value) return true
  return false
}

/** 弹窗 / 管理页收到的整理回包。消息边界上的数据一律当 unknown。 */
export function parseOrganizeJobResult(input: unknown): OrganizeJobResult {
  if (!isRecord(input)) return { ok: false, reason: 'stale_sw' }
  const reason = optString(input.reason)
  const error = optString(input.error)
  if (input.ok === false || reason === 'unknown' || error === 'unknown') {
    return {
      ok: false,
      reason: reason === 'unknown' || !reason ? 'stale_sw' : reason,
      error,
    }
  }
  const applyRaw = isRecord(input.apply) ? input.apply : undefined
  const summaryRaw = isRecord(input.summary) ? input.summary : undefined
  return {
    ok: true,
    count: optFiniteNumber(input.count),
    name: optString(input.name),
    moved: optFiniteNumber(input.moved),
    topic: optString(input.topic),
    source: optString(input.source),
    apply: applyRaw
      ? {
          created: optFiniteNumber(applyRaw.created),
          absorbTabs: optFiniteNumber(applyRaw.absorbTabs),
          merged: optFiniteNumber(applyRaw.merged),
        }
      : undefined,
    summary: summaryRaw ? { movableTabs: optFiniteNumber(summaryRaw.movableTabs) } : undefined,
  }
}
