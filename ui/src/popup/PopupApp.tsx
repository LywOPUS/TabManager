/**
 * 弹窗：对着「当前打开的标签」立刻动手。
 * 收纳 / 恢复最近会话 / 整理当前窗口 / 解散全部窗口标签组 / 打开标签去重。
 * 管理页：会话、预览整理、跨窗合并、已收纳去重、闲置、设置。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ClassifyPicker,
  mergeClassifySettings,
  type ClassifySettings,
} from '@/components/ClassifyPicker'
import { timeAgo } from '@/lib/timeAgo'
import { openManagement } from '@/lib/openManagement'
import {
  applyEnhancement,
  classifyOptsFromSettings,
  closeOpenTabDuplicates,
  ensureFixedGroups,
  findOpenTabDuplicates,
  getData,
  getRecentSession,
  getSettings,
  isReadLaterName,
  isUngroupedName,
  newId,
  organizeCurrentWindow,
  organizeFailText,
  organizeOkText,
  proposeEnhancement,
  restoreSessionGroups,
  setData,
  setSettings,
  sourceLabel,
  summarizeOpenTabGroups,
  tabCount,
  tabsForSuggest,
  ungroupAllOkText,
  ungroupAllPrompt,
  ungroupAllWindows,
  type Session,
} from '@/lib/chrome-ext'
import {
  ActionButton,
  ActionGroup,
  IconBack,
  IconGrid,
  IconInbox,
  IconLayers,
  IconMerge,
  IconRestore,
  IconUngroup,
  MetaCard,
  PopupShell,
} from './PopupShell'
import { PullToStash } from './PullToStash'
import { stashFailText, stashResultText } from '@/lib/stashResultText'

type OpenDupe = {
  key: string
  keep: { title: string; active?: boolean }
  items: Array<{ title: string }>
}

type Panel =
  | { kind: 'idle' }
  | { kind: 'stash-busy'; status: string; picker: ClassifySettings; sessionId: string }
  | {
      kind: 'stash'
      status: string
      picker: ClassifySettings
      sessionId: string
      source?: string
      name: string
      preview: { groups: Array<{ name: string; tabs: Array<{ title: string }>; tabIds: string[] }> }
    }
  | { kind: 'dedup'; groups: OpenDupe[]; removing: boolean }

export function PopupApp() {
  const [recent, setRecent] = useState<Session | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<Panel>({ kind: 'idle' })
  const [groupStats, setGroupStats] = useState({ tabCount: 0, groupCount: 0, windowCount: 0 })
  const [dupeCloseCount, setDupeCloseCount] = useState(0)

  const loadRecent = useCallback(async () => {
    const session = await getRecentSession()
    if (!session) {
      setRecent(null)
      return
    }
    const hadReadLater = session.groups.some((g) => isReadLaterName(g.name))
    const hadUngrouped = session.groups.some((g) => isUngroupedName(g.name))
    ensureFixedGroups(session, { newId })
    if (!hadReadLater || !hadUngrouped) {
      const data = await getData()
      const i = data.sessions.findIndex((s) => s.id === session.id)
      if (i >= 0) {
        data.sessions[i] = session
        await setData(data)
      }
    }
    setRecent(session)
  }, [])

  const loadLiveStats = useCallback(async () => {
    const [groups, dupes] = await Promise.all([summarizeOpenTabGroups(), findOpenTabDuplicates()])
    setGroupStats(groups)
    setDupeCloseCount(dupes.reduce((n, g) => n + g.items.length, 0))
  }, [])

  useEffect(() => {
    void loadRecent()
    void loadLiveStats()
    void chrome.action?.setBadgeText?.({ text: '' })
  }, [loadRecent, loadLiveStats])

  const count = recent ? tabCount(recent) : 0
  const canRestore = !!recent && count > 0

  async function runStashReview(sessionId: string, p: ClassifySettings) {
    await setSettings(p)
    setPanel({ kind: 'stash-busy', status: '生成预览', picker: p, sessionId })
    const data = await getData()
    const session = data.sessions.find((s) => s.id === sessionId)
    if (!session) {
      setPanel({ kind: 'idle' })
      setMsg('会话不存在')
      return
    }
    ensureFixedGroups(session, { newId })
    const items = tabsForSuggest(session)
    const { preview, source, error, name } = await proposeEnhancement(items, {
      ...classifyOptsFromSettings(p),
      withName: true,
      onStatus: (m: string) =>
        setPanel((prev) => (prev.kind === 'stash-busy' ? { ...prev, status: m } : prev)),
    })
    setPanel({
      kind: 'stash',
      status: error
        ? `来源：${sourceLabel(source)} · ${String(error).slice(0, 40)}`
        : `来源：${sourceLabel(source)}`,
      picker: p,
      sessionId,
      source,
      name,
      preview: { groups: preview.groups },
    })
  }

  async function applyStashReview() {
    if (panel.kind !== 'stash') return
    const { sessionId, preview, name } = panel
    setBusy(true)
    const r = await applyEnhancement(sessionId, { preview, name: name.trim() || undefined })
    setBusy(false)
    setPanel({ kind: 'idle' })
    setMsg(r.ok ? `已应用分组${r.renamed ? `并命名「${r.name}」` : ''}` : '应用失败')
    await loadRecent()
  }

  async function onStash(keepActive = true): Promise<boolean> {
    setBusy(true)
    setMsg('收纳中…')
    const s = await getSettings()
    const reviewInTab = !keepActive && s.stashReview !== false
    const r = await chrome.runtime.sendMessage({
      type: 'STASH_CURRENT_WINDOW',
      keepActive,
      reviewInTab,
    })
    if (!r.ok) {
      setBusy(false)
      setMsg(stashFailText(r))
      return false
    }
    setMsg(stashResultText(r))
    await loadRecent()
    await loadLiveStats()
    if (reviewInTab) {
      setBusy(false)
      return true
    }
    if (s.stashReview === false) {
      try {
        const data = await getData()
        const session = data.sessions.find((x) => x.id === r.session.id)
        if (session) ensureFixedGroups(session, { newId })
        const items = session ? tabsForSuggest(session) : []
        const { preview, source, name } = await proposeEnhancement(items, {
          ...classifyOptsFromSettings(s),
          withName: true,
          onStatus: (m: string) => setMsg(`${m}…`),
        })
        const e = await applyEnhancement(r.session.id, { preview, name })
        setMsg(e.ok && e.grouped ? `已收纳并整理「${e.name}」（${sourceLabel(source)}）` : stashResultText(r))
      } catch {
        setMsg(`${stashResultText(r)}（智能整理未完成）`)
      }
      await loadRecent()
      setBusy(false)
      return true
    }
    setBusy(false)
    await runStashReview(r.session.id, s)
    return true
  }

  async function onRestore() {
    if (!recent) return
    setBusy(true)
    setMsg('分批打开中…')
    try {
      const n = await restoreSessionGroups(recent, {
        onProgress: (m: string) => setMsg(m),
      })
      setMsg(`已打开 ${n} 个标签`)
    } catch {
      setMsg('恢复失败')
    }
    setBusy(false)
    await loadLiveStats()
  }

  async function onOrganize() {
    setBusy(true)
    setMsg('整理中…')
    try {
      const r = await organizeCurrentWindow((m: string) => setMsg(m))
      setMsg(r.ok ? organizeOkText(r) : organizeFailText(r.reason))
    } catch {
      setMsg('整理失败')
    }
    setBusy(false)
    await loadLiveStats()
  }

  async function onUngroupAll() {
    if (!groupStats.groupCount) {
      setMsg('没有标签组')
      return
    }
    if (!confirm(ungroupAllPrompt(groupStats.groupCount, groupStats.windowCount))) return
    setBusy(true)
    setMsg('解散中…')
    try {
      const r = await ungroupAllWindows((m: string) => setMsg(m))
      setMsg(ungroupAllOkText(r))
    } catch {
      setMsg('解散失败')
    }
    setBusy(false)
    await loadLiveStats()
  }

  async function openDedup() {
    setBusy(true)
    const groups = (await findOpenTabDuplicates()) as OpenDupe[]
    setBusy(false)
    if (!groups.length) {
      setDupeCloseCount(0)
      setMsg('全部窗口中没有重复网页')
      return
    }
    setPanel({ kind: 'dedup', groups, removing: false })
  }

  async function applyOpenDedup() {
    if (panel.kind !== 'dedup') return
    const n = panel.groups.reduce((sum, g) => sum + g.items.length, 0)
    if (!confirm(`关闭全部窗口中的 ${n} 个重复标签？每组保留一份。`)) return
    setPanel({ ...panel, removing: true })
    setBusy(true)
    const groups = await findOpenTabDuplicates()
    const closed = await closeOpenTabDuplicates(groups)
    setBusy(false)
    setPanel({ kind: 'idle' })
    setMsg(closed ? `已关闭 ${closed} 个重复标签` : '没有重复可合并')
    await loadLiveStats()
  }

  function onPickerChange(patch: Partial<ClassifySettings> & { localModel?: { model: string } }) {
    if (panel.kind !== 'stash' && panel.kind !== 'stash-busy') return
    void runStashReview(panel.sessionId, mergeClassifySettings(panel.picker, patch))
  }

  const reviewing = panel.kind === 'stash' || panel.kind === 'stash-busy'
  const groups = panel.kind === 'stash' ? panel.preview.groups : null
  const dedupCloseN =
    panel.kind === 'dedup' ? panel.groups.reduce((n, g) => n + g.items.length, 0) : 0

  return (
    <PopupShell>
      {reviewing ? (
        <>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="返回"
              className="grid size-7 shrink-0 place-items-center rounded-lg text-[#8b8b8e] transition-[background-color,color,transform] duration-100 ease-out hover:bg-black/5 hover:text-[#0a0a0a] active:scale-95"
              onClick={() => setPanel({ kind: 'idle' })}
            >
              <IconBack />
            </button>
            <h1 className="m-0 text-[15px] font-semibold tracking-tight text-[#0a0a0a]">
              收纳确认
            </h1>
          </div>

          <ClassifyPicker value={panel.picker} onChange={onPickerChange} />

          <p className="m-0 px-0.5 text-[11.5px] leading-snug text-[#8b8b8e]" role="status" aria-live="polite">
            {panel.status}
            {(panel.kind === 'stash-busy' || busy) && '…'}
          </p>

          {groups && groups.length > 0 && (
            <div className="flex max-h-[220px] flex-col divide-y divide-black/[0.06] overflow-auto rounded-[11px] border border-black/[0.07] bg-white/80 px-2.5 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset]">
              {groups.map((g, i) => (
                <div
                  key={g.name}
                  className="anim-row flex items-baseline justify-between gap-2 py-[7px]"
                  style={{ '--row-delay': `${Math.min(i, 12) * 18}ms` } as React.CSSProperties}
                >
                  <span className="min-w-0 truncate text-[13px] font-medium tracking-tight text-[#0a0a0a]">{g.name}</span>
                  <span className="shrink-0 rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[11px] tabular-nums text-[#6b6b6e]">
                    {g.tabs.length}
                  </span>
                </div>
              ))}
            </div>
          )}

          {panel.kind === 'stash' && (
            <label className="flex items-center gap-2 px-0.5 text-[12px] text-[#6b6b6e]">
              会话名
              <input
                type="text"
                className="min-w-0 flex-1 rounded-lg border border-black/12 bg-white/90 px-2.5 py-1.5 text-[13px] text-[#0a0a0a] outline-none transition-[border-color,box-shadow] duration-150 focus:border-black/30 focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)]"
                value={panel.name}
                placeholder="保持原名称"
                onChange={(e) =>
                  setPanel((prev) => (prev.kind === 'stash' ? { ...prev, name: e.target.value } : prev))
                }
              />
            </label>
          )}

          {panel.kind === 'stash' && (
            <div className="mt-0.5 flex items-center justify-end gap-2 px-0.5">
              <button
                type="button"
                className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs text-[#8b8b8e] transition-[background-color,color,transform] duration-100 ease-out hover:bg-black/5 hover:text-[#0a0a0a] active:scale-[0.98]"
                onClick={() => setPanel({ kind: 'idle' })}
              >
                保持原样
              </button>
              <button
                type="button"
                disabled={busy || (!panel.preview.groups.length && !panel.name.trim())}
                className="cursor-pointer rounded-lg bg-[#0a0a0a] px-3 py-1.5 text-xs font-medium text-white transition-[transform,opacity] duration-100 ease-out enabled:active:scale-[0.98] disabled:opacity-35"
                onClick={() => void applyStashReview()}
              >
                应用分组并命名
              </button>
            </div>
          )}
        </>
      ) : panel.kind === 'dedup' ? (
        <>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="返回"
              className="grid size-7 shrink-0 place-items-center rounded-lg text-[#8b8b8e] transition-[background-color,color,transform] duration-100 ease-out hover:bg-black/5 hover:text-[#0a0a0a] active:scale-95"
              onClick={() => setPanel({ kind: 'idle' })}
            >
              <IconBack />
            </button>
            <h1 className="m-0 text-[15px] font-semibold tracking-tight text-[#0a0a0a]">
              合并重复网页
            </h1>
          </div>
          <p className="m-0 px-0.5 text-[11.5px] leading-snug text-[#8b8b8e]">
            全部窗口中打开的标签，每组保留一份。不含已收纳会话。
          </p>
          <div className="flex max-h-[220px] flex-col divide-y divide-black/[0.06] overflow-auto rounded-[11px] border border-black/[0.07] bg-white/80 px-2.5 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset]">
            {panel.groups.map((g, i) => (
              <div
                key={g.key}
                className="anim-row py-[7px]"
                style={{ '--row-delay': `${Math.min(i, 12) * 18}ms` } as React.CSSProperties}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[13px] font-medium tracking-tight text-[#0a0a0a]">
                    {g.keep.title}
                  </span>
                  <span className="shrink-0 rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[11px] tabular-nums text-[#6b6b6e]">
                    ×{g.items.length + 1}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-[#8b8b8e]">
                  保留一份{g.keep.active ? '（当前标签）' : ''} · 关闭 {g.items.length} 个
                </div>
              </div>
            ))}
          </div>
          <div className="mt-0.5 flex items-center justify-end gap-2 px-0.5">
            <button
              type="button"
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs text-[#8b8b8e] transition-[background-color,color,transform] duration-100 ease-out hover:bg-black/5 hover:text-[#0a0a0a] active:scale-[0.98]"
              onClick={() => setPanel({ kind: 'idle' })}
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || panel.removing || !dedupCloseN}
              className="cursor-pointer rounded-lg bg-[#0a0a0a] px-3 py-1.5 text-xs font-medium text-white transition-[transform,opacity] duration-100 ease-out enabled:active:scale-[0.98] disabled:opacity-35"
              onClick={() => void applyOpenDedup()}
            >
              {panel.removing ? '合并中…' : `关闭 ${dedupCloseN} 个重复`}
            </button>
          </div>
        </>
      ) : (
        <PullToStash disabled={busy} onFire={onStash}>
          <header className="flex items-center justify-between gap-2 px-0.5">
            <h1 className="m-0 text-[15px] font-semibold tracking-tight text-[#0a0a0a]">Tab Manager</h1>
            {busy && (
              <span className="text-[11px] tabular-nums text-[#8b8b8e]" aria-live="polite">
                处理中…
              </span>
            )}
          </header>

          {recent ? (
            <MetaCard>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10.5px] font-medium uppercase tracking-[0.04em] text-[#8b8b8e]">
                    最近会话
                  </div>
                  <div className="mt-0.5 truncate text-[13px] font-semibold tracking-tight text-[#0a0a0a]">
                    {recent.name}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[12px] font-medium tabular-nums text-[#0a0a0a]">{count}</div>
                  <div className="text-[10.5px] text-[#8b8b8e]">标签</div>
                </div>
              </div>
              {recent.createdAt > 0 && (
                <div className="mt-1 text-[11px] text-[#a1a1a4]">{timeAgo(recent.createdAt)}</div>
              )}
            </MetaCard>
          ) : (
            <MetaCard>
              <span className="text-[#8b8b8e]">还没有会话 — 收纳其他标签开始</span>
            </MetaCard>
          )}

          <ActionButton
            primary
            disabled={busy}
            icon={<IconInbox className="size-[15px]" />}
            onClick={() => void onStash(true)}
          >
            收纳其他标签
          </ActionButton>
          <div className="flex items-center justify-between gap-2 px-0.5">
            <span className="text-[11px] leading-none text-[#8b8b8e]">当前页会留下</span>
            <button
              type="button"
              disabled={busy}
              className="cursor-pointer text-[11px] leading-none text-[#8b8b8e] transition-colors hover:text-[#0a0a0a] hover:underline disabled:opacity-35"
              onClick={() => void onStash(false)}
            >
              连当前页一起收纳
            </button>
          </div>

          <ActionGroup>
            <ActionButton
              disabled={busy || !canRestore}
              icon={<IconRestore />}
              hint={canRestore ? String(count) : undefined}
              title={!canRestore ? '暂无可恢复的会话' : undefined}
              onClick={() => void onRestore()}
            >
              恢复最近会话
            </ActionButton>
          </ActionGroup>

          <ActionGroup>
            <ActionButton
              disabled={busy}
              icon={<IconLayers />}
              title="跨站主题优先成组，其余同站并入已有组"
              onClick={() => void onOrganize()}
            >
              整理当前窗口
            </ActionButton>
            <ActionButton
              disabled={busy || !groupStats.groupCount}
              icon={<IconUngroup />}
              hint={groupStats.groupCount ? String(groupStats.groupCount) : undefined}
              title={
                groupStats.groupCount
                  ? groupStats.windowCount > 1
                    ? `全部 ${groupStats.windowCount} 个窗口的原生标签组`
                    : '当前打开窗口的原生标签组'
                  : '没有标签组'
              }
              onClick={() => void onUngroupAll()}
            >
              解散全部标签组
            </ActionButton>
            <ActionButton
              disabled={busy || !dupeCloseCount}
              icon={<IconMerge />}
              hint={dupeCloseCount ? String(dupeCloseCount) : undefined}
              title={dupeCloseCount ? '全部窗口中打开的标签' : '没有重复网页'}
              onClick={() => void openDedup()}
            >
              合并重复网页
            </ActionButton>
          </ActionGroup>

          <ActionGroup>
            <ActionButton disabled={busy} icon={<IconGrid />} onClick={() => openManagement()}>
              打开标签管理
            </ActionButton>
          </ActionGroup>

          <p
            className={`m-0 min-h-[15px] px-0.5 text-[11.5px] leading-snug transition-opacity duration-150 ${
              msg ? 'text-[#5c5c5f] opacity-100' : 'opacity-0'
            }`}
            role="status"
            aria-live="polite"
          >
            {msg || '\u00a0'}
          </p>

          <div
            className="mx-auto -mb-0.5 h-1 w-8 shrink-0 rounded-full bg-black/[0.12]"
            title="下拉快速收纳"
            aria-hidden
          />
        </PullToStash>
      )}
    </PopupShell>
  )
}
