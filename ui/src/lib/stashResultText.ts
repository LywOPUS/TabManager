import { isRecord } from '@ext/lib/unknown.ts'

export type StashResultOk = {
  ok: true
  count: number
  session: { id: string }
  skipped?: number
  skippedUnrestorable?: number
  keptActive?: boolean
}

export type StashResultFail = {
  ok: false
  reason: string
  skipped?: number
  skippedUnrestorable?: number
}

export type StashResult = StashResultOk | StashResultFail

function optCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 解析 background 收纳回包。消息边界上的数据一律当 unknown。 */
export function parseStashResult(input: unknown): StashResult {
  if (!isRecord(input)) return { ok: false, reason: 'unknown' }
  const skipped = optCount(input.skipped)
  const skippedUnrestorable = optCount(input.skippedUnrestorable)
  if (input.ok !== true) {
    return {
      ok: false,
      reason: typeof input.reason === 'string' && input.reason ? input.reason : 'unknown',
      skipped,
      skippedUnrestorable,
    }
  }
  const session = isRecord(input.session) ? input.session : undefined
  const sessionId = typeof session?.id === 'string' ? session.id : ''
  if (!sessionId) return { ok: false, reason: 'unknown' }
  return {
    ok: true,
    count: optCount(input.count) ?? 0,
    session: { id: sessionId },
    skipped,
    skippedUnrestorable,
    keptActive: input.keptActive === true,
  }
}

export function stashFailText(r: StashResultFail): string {
  switch (r.reason) {
    case 'empty':
      return '没有可收纳的标签'
    case 'only_active':
      return '没有可收纳的标签（已保留当前页）'
    case 'all_dupe':
      return '没有新网页可收纳（本批网址全部重复）'
    case 'all_unrestorable':
      return '没有可收纳的网页（本地文件等页面无法恢复，已保留）'
    default:
      return '收纳失败'
  }
}

/** 收纳结果的一句话提示；重复与无法恢复（file: 等）分开说明 */
export function stashResultText(r: StashResultOk): string {
  const parts = [`已收纳 ${r.count} 个标签`]
  if (r.keptActive) parts.push('当前页已留下')
  if (r.skipped) parts.push(`跳过 ${r.skipped} 个本批重复`)
  if (r.skippedUnrestorable) parts.push(`${r.skippedUnrestorable} 个本地文件等页面无法恢复，已保留`)
  return parts.join(' · ')
}
