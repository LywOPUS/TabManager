export interface StashResultLike {
  ok: boolean
  reason?: string
  count?: number
  skipped?: number
  skippedUnrestorable?: number
  keptActive?: boolean
}

export function stashFailText(r: { reason?: string }): string {
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
export function stashResultText(r: StashResultLike): string {
  const parts = [`已收纳 ${r.count ?? 0} 个标签`]
  if (r.keptActive) parts.push('当前页已留下')
  if (r.skipped) parts.push(`跳过 ${r.skipped} 个本批重复`)
  if (r.skippedUnrestorable) parts.push(`${r.skippedUnrestorable} 个本地文件等页面无法恢复，已保留`)
  return parts.join(' · ')
}
