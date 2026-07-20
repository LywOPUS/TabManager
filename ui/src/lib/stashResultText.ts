export interface StashResultLike {
  ok: boolean
  count?: number
  skipped?: number
  skippedUnrestorable?: number
}

/** 收纳结果的一句话提示；重复与无法恢复（file: 等）分开说明 */
export function stashResultText(r: StashResultLike): string {
  const parts = [`已收纳 ${r.count ?? 0} 个标签`]
  if (r.skipped) parts.push(`跳过 ${r.skipped} 个本批重复`)
  if (r.skippedUnrestorable) parts.push(`${r.skippedUnrestorable} 个本地文件等页面无法恢复，已保留`)
  return parts.join(' · ')
}
