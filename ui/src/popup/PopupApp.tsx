/**
 * 弹窗：对着「当前打开的标签」立刻动手。
 * 收纳 / 整理 / 选中整理 / 按当前页归组 / 相关到新窗口 / 按主题归组 / 合并窗口 / 解散 / 去重。
 * 管理页：会话、恢复、预览整理、跨窗合并确认、已收纳去重、闲置、设置。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ClassifyPicker,
  mergeClassifySettings,
  type ClassifySettings,
} from '@/components/ClassifyPicker'
import { openManagement } from '@/lib/openManagement'
import {
  applyEnhancement,
  browserModelLibraryRequired,
  classifyOptsFromSettings,
  closeOpenTabDuplicates,
  closeTabsByIds,
  collectClosableTabs,
  ensureFixedGroups,
  findOpenTabDuplicates,
  getData,
  getSettings,
  MODEL_NOT_DOWNLOADED,
  newId,
  mergeAllPrompt,
  mergeOkText,
  mergeOrganizeSummary,
  organizeFailText,
  organizeOkText,
  selectedOrganizeOkText,
  relatedWindowOkText,
  relatedWindowPrompt,
  runPopupOrganize,
  type OrganizeJobName,
  type OrganizeJobResult,
  summarizeHighlightedTabs,
  type ClassifyPreview,
  type ClosableTab,
  type OpenDupeGroup,
  seedOrganizeOkText,
  topicOrganizeOkText,
  proposeEnhancement,
  setSettings,
  sourceLabel,
  summarizeOpenTabGroups,
  tabsForSuggest,
  ungroupAllOkText,
  ungroupAllPrompt,
  ungroupAllWindows,
} from '@/lib/chrome-ext'
import {
  ActionButton,
  ActionGroup,
  ActionMore,
  IconInbox,
  IconLayers,
  IconSelectTabs,
  IconNewWindow,
  IconTarget,
  IconTopic,
  IconMerge,
  IconCloseTabs,
  IconUngroup,
  IconWindows,
  PanelHeader,
  PopupShell,
} from './PopupShell'
import { PullToStash } from './PullToStash'
import { parseStashResult, stashFailText, stashResultText } from '@/lib/stashResultText'

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
      preview: ClassifyPreview
    }
  | { kind: 'dedup'; groups: OpenDupeGroup[]; removing: boolean }
  | { kind: 'close'; rows: ClosableTab[]; kept: number; source: string; checked: Set<number>; closing: boolean }
  | { kind: 'topic'; query: string }
  | { kind: 'confirm'; action: 'related' | 'merge' | 'ungroup'; title: string; detail: string }

export function PopupApp() {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<Panel>({ kind: 'idle' })
  const [groupStats, setGroupStats] = useState({ tabCount: 0, groupCount: 0, windowCount: 0 })
  const [dupeCloseCount, setDupeCloseCount] = useState(0)
  const [mergeStats, setMergeStats] = useState({ otherWindows: 0, movableTabs: 0 })
  const [selectedCount, setSelectedCount] = useState(0)
  const [moreOrganize, setMoreOrganize] = useState(false)
  const [needModelLibrary, setNeedModelLibrary] = useState(false)

  const loadLiveStats = useCallback(async () => {
    const [groups, dupes, merge, highlighted] = await Promise.all([
      summarizeOpenTabGroups(),
      findOpenTabDuplicates(),
      mergeOrganizeSummary(),
      summarizeHighlightedTabs(),
    ])
    setGroupStats(groups)
    setDupeCloseCount(dupes.reduce((n, g) => n + g.items.length, 0))
    setMergeStats({
      otherWindows: merge?.otherWindows ?? 0,
      movableTabs: merge?.movableTabs ?? 0,
    })
    setSelectedCount(highlighted?.count ?? 0)
  }, [])

  const refreshModelGate = useCallback(async () => {
    const s = await getSettings()
    setNeedModelLibrary(await browserModelLibraryRequired(s))
    return s
  }, [])

  useEffect(() => {
    void loadLiveStats()
    void refreshModelGate()
    void chrome.action?.setBadgeText?.({ text: '' })
  }, [loadLiveStats, refreshModelGate])

  async function modelMissing(settings?: ClassifySettings) {
    const need = await browserModelLibraryRequired(settings)
    setNeedModelLibrary(need)
    return need
  }

  async function callOrganize(
    op: OrganizeJobName,
    payload: { query?: string } = {},
    busyText: string,
  ): Promise<OrganizeJobResult> {
    setBusy(true)
    setMsg(busyText)
    try {
      return await runPopupOrganize(op, payload, setMsg)
    } catch {
      return { ok: false, reason: 'apply_failed' }
    } finally {
      setBusy(false)
      await loadLiveStats()
    }
  }

  async function runStashReview(sessionId: string, p: ClassifySettings) {
    await setSettings(p)
    if (await modelMissing(p)) {
      setPanel({
        kind: 'stash',
        status: MODEL_NOT_DOWNLOADED,
        picker: p,
        sessionId,
        name: '',
        preview: { groups: [], ungrouped: [] },
      })
      return
    }
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
      preview,
    })
  }

  async function applyStashReview() {
    if (panel.kind !== 'stash') return
    const { sessionId, preview, name } = panel
    setBusy(true)
    try {
      const r = await applyEnhancement(sessionId, { preview, name: name.trim() || undefined })
      setPanel({ kind: 'idle' })
      setMsg(r.ok ? `已应用分组${r.renamed ? `并命名「${r.name}」` : ''}` : '应用失败')
    } catch {
      setMsg('应用失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  async function onStash(keepActive = true): Promise<boolean> {
    setBusy(true)
    setMsg('收纳中…')
    try {
      const s = await getSettings()
      const reviewInTab = !keepActive && s.stashReview !== false
      const r = parseStashResult(
        await chrome.runtime.sendMessage({
          type: 'STASH_CURRENT_WINDOW',
          keepActive,
          reviewInTab,
        }),
      )
      if (!r.ok) {
        setMsg(stashFailText(r))
        return false
      }
      setMsg(stashResultText(r))
      await loadLiveStats()
      if (reviewInTab) return true
      if (s.stashReview === false) {
        try {
          const data = await getData()
          const session = data.sessions.find((x) => x.id === r.session.id)
          if (session) ensureFixedGroups(session, { newId })
          const items = session ? tabsForSuggest(session) : []
          if (await browserModelLibraryRequired(s)) {
            setMsg(`${stashResultText(r)}（${MODEL_NOT_DOWNLOADED}）`)
            return true
          }
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
        return true
      }
      await runStashReview(r.session.id, s)
      return true
    } catch {
      setMsg('收纳失败，请重试')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function onOrganize() {
    const r = await callOrganize('window', {}, '整理中…')
    setMsg(r.ok ? organizeOkText(r) : organizeFailText(r.reason, r.error))
  }

  async function onOrganizeSelected() {
    const r = await callOrganize('selected', {}, '整理选中标签…')
    setMsg(r.ok ? selectedOrganizeOkText(r) : organizeFailText(r.reason, r.error))
  }

  async function onOrganizeAroundPage() {
    const r = await callOrganize('around', {}, '按当前页归组…')
    setMsg(r.ok ? seedOrganizeOkText(r) : organizeFailText(r.reason, r.error))
  }

  async function onRelatedToNewWindow() {
    const summary = await callOrganize('related-summary', {}, '判断相关标签…')
    if (!summary.ok) {
      setMsg(organizeFailText(summary.reason, summary.error))
      return
    }
    const count = summary.count ?? 0
    if (count < 2) {
      setMsg(organizeFailText('no_seed_match'))
      return
    }
    setMsg('')
    setPanel({
      kind: 'confirm',
      action: 'related',
      title: '相关到新窗口',
      detail: relatedWindowPrompt(count, summary.name),
    })
  }

  async function onTopicOrganize() {
    if (panel.kind !== 'topic') return
    const q = panel.query.trim()
    if (!q) {
      setMsg('请输入主题')
      return
    }
    const r = await callOrganize('topic', { query: q }, `按「${q}」归组…`)
    setMsg(r.ok ? topicOrganizeOkText(r) : organizeFailText(r.reason, r.error))
    if (r.ok) setPanel({ kind: 'idle' })
  }

  async function onMergeAll() {
    const summary = await mergeOrganizeSummary()
    if (!summary?.otherWindows || !summary.movableTabs) {
      setMsg('没有其他窗口可合并')
      return
    }
    setPanel({
      kind: 'confirm',
      action: 'merge',
      title: '合并全部窗口',
      detail: mergeAllPrompt(summary.otherWindows, summary.movableTabs),
    })
  }

  async function onUngroupAll() {
    if (!groupStats.groupCount) {
      setMsg('没有标签组')
      return
    }
    setPanel({
      kind: 'confirm',
      action: 'ungroup',
      title: '解散全部标签组',
      detail: ungroupAllPrompt(groupStats.groupCount, groupStats.windowCount),
    })
  }

  async function onConfirmAction() {
    if (panel.kind !== 'confirm') return
    const { action } = panel
    setPanel({ kind: 'idle' })
    if (action === 'ungroup') {
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
      return
    }
    const r = await callOrganize(
      action === 'related' ? 'related' : 'merge',
      {},
      action === 'related' ? '移到新窗口…' : '合并中…',
    )
    setMsg(
      r.ok
        ? action === 'related'
          ? relatedWindowOkText(r)
          : mergeOkText(r)
        : organizeFailText(r.reason, r.error),
    )
  }

  async function openDedup() {
    setBusy(true)
    try {
      const groups = await findOpenTabDuplicates()
      if (!groups.length) {
        setDupeCloseCount(0)
        setMsg('全部窗口中没有重复网页')
        return
      }
      setPanel({ kind: 'dedup', groups, removing: false })
    } catch {
      setMsg('检查重复网页失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  /** 建议关闭：优先侧栏详细视图；sidePanel 不可用时回退弹窗内面板 */
  async function openCloseSuggest() {
    try {
      const win = await chrome.windows.getCurrent()
      if (typeof win.id !== 'number') throw new Error('no window id')
      await chrome.sidePanel.open({ windowId: win.id })
      return
    } catch {
      /* sidePanel 不可用，走弹窗内面板 */
    }
    setBusy(true)
    setMsg('分析可关闭的标签…')
    try {
      const { rows, actionableCount } = await collectClosableTabs()
      if (!actionableCount) {
        setMsg('没有可考虑关闭的标签')
        return
      }
      const suggested = rows.filter((r) => r.reasons.length > 0)
      if (!suggested.length) {
        setMsg('没有建议关闭的标签')
        return
      }
      setMsg('')
      setPanel({
        kind: 'close',
        rows: suggested,
        kept: actionableCount - suggested.length,
        source: '启发式',
        checked: new Set(suggested.map((r) => r.tabId)),
        closing: false,
      })
    } catch {
      setMsg('分析失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  function toggleCloseCheck(tabId: number) {
    setPanel((prev) => {
      if (prev.kind !== 'close') return prev
      const checked = new Set(prev.checked)
      if (checked.has(tabId)) checked.delete(tabId)
      else checked.add(tabId)
      return { ...prev, checked }
    })
  }

  async function applyCloseSuggest() {
    if (panel.kind !== 'close') return
    const ids = [...panel.checked]
    if (!ids.length) {
      setPanel({ kind: 'idle' })
      setMsg('没有选中要关闭的标签')
      return
    }
    setPanel({ ...panel, closing: true })
    setBusy(true)
    try {
      const n = await closeTabsByIds(ids)
      setPanel({ kind: 'idle' })
      setMsg(n ? `已关闭 ${n} 个标签` : '没有选中要关闭的标签')
      await loadLiveStats()
    } catch {
      setPanel((current) => (current.kind === 'close' ? { ...current, closing: false } : current))
      setMsg('关闭失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  async function applyOpenDedup() {
    if (panel.kind !== 'dedup') return
    setPanel({ ...panel, removing: true })
    setBusy(true)
    try {
      const groups = await findOpenTabDuplicates()
      const closed = await closeOpenTabDuplicates(groups)
      setPanel({ kind: 'idle' })
      setMsg(closed ? `已关闭 ${closed} 个重复标签` : '没有重复可合并')
      await loadLiveStats()
    } catch {
      setPanel((current) => current.kind === 'dedup' ? { ...current, removing: false } : current)
      setMsg('关闭重复标签失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  function onPickerChange(patch: Partial<ClassifySettings>) {
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
          <PanelHeader title="收纳确认" onBack={() => setPanel({ kind: 'idle' })} />

          <ClassifyPicker
            value={panel.picker}
            onChange={onPickerChange}
            onOpenLibrary={() => openManagement('#models')}
          />

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
      ) : panel.kind === 'topic' ? (
        <>
          <PanelHeader title="按主题归组" onBack={() => setPanel({ kind: 'idle' })} />
          <p className="m-0 px-0.5 text-[11.5px] leading-snug text-[#8b8b8e]">
            输入主题，用分类模型找出对应的一组。已成组的也可以抽过来。
          </p>
          <input
            type="text"
            autoFocus
            className="w-full rounded-[11px] border border-black/12 bg-white/90 px-3 py-2 text-[13px] text-[#0a0a0a] outline-none transition-[border-color,box-shadow] duration-150 focus:border-black/30 focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)]"
            placeholder="例如 React、alice"
            value={panel.query}
            onChange={(e) => setPanel({ kind: 'topic', query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onTopicOrganize()
            }}
          />
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
              disabled={busy || !panel.query.trim()}
              className="cursor-pointer rounded-lg bg-[#0a0a0a] px-3 py-1.5 text-xs font-medium text-white transition-[transform,opacity] duration-100 ease-out enabled:active:scale-[0.98] disabled:opacity-35"
              onClick={() => void onTopicOrganize()}
            >
              {busy ? '归组中…' : '归组'}
            </button>
          </div>
          <p
            className={`m-0 min-h-[15px] px-0.5 text-[11.5px] leading-snug ${
              msg ? 'text-[#5c5c5f]' : 'opacity-0'
            }`}
            role="status"
            aria-live="polite"
          >
            {msg || '\u00a0'}
          </p>
        </>
      ) : panel.kind === 'dedup' ? (
        <>
          <PanelHeader title="合并重复网页" onBack={() => setPanel({ kind: 'idle' })} />
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
      ) : panel.kind === 'close' ? (
        <>
          <PanelHeader title="建议关闭" onBack={() => setPanel({ kind: 'idle' })} />
          <p className="m-0 px-0.5 text-[11.5px] leading-snug text-[#8b8b8e]">
            来源：{panel.source}。钉住 / 有声 / 当前页不参与{panel.kept > 0 ? `，其余 ${panel.kept} 个保留` : ''}。
          </p>
          <div className="flex max-h-[240px] flex-col divide-y divide-black/[0.06] overflow-auto rounded-[11px] border border-black/[0.07] bg-white/80 px-2.5 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset]">
            {panel.rows.map((r, i) => {
              const on = panel.checked.has(r.tabId)
              const why = r.reasons.join(' · ')
              return (
                <label
                  key={r.tabId}
                  className="anim-row flex cursor-pointer items-start gap-2 py-[7px]"
                  style={{ '--row-delay': `${Math.min(i, 12) * 18}ms` } as React.CSSProperties}
                >
                  <input
                    type="checkbox"
                    className="mt-[3px] size-3.5 shrink-0 cursor-pointer accent-[#0a0a0a]"
                    checked={on}
                    onChange={() => toggleCloseCheck(r.tabId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[13px] font-medium tracking-tight transition-colors ${
                        on ? 'text-[#0a0a0a]' : 'text-[#a1a1a4]'
                      }`}
                      title={r.url}
                    >
                      {r.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-[#8b8b8e]">{why}</span>
                  </span>
                </label>
              )
            })}
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
              disabled={busy || panel.closing || !panel.checked.size}
              className="cursor-pointer rounded-lg bg-[#0a0a0a] px-3 py-1.5 text-xs font-medium text-white transition-[transform,opacity] duration-100 ease-out enabled:active:scale-[0.98] disabled:opacity-35"
              onClick={() => void applyCloseSuggest()}
            >
              {panel.closing ? '关闭中…' : `关闭 ${panel.checked.size} 个`}
            </button>
          </div>
        </>
      ) : panel.kind === 'confirm' ? (
        <>
          <PanelHeader title={panel.title} onBack={() => setPanel({ kind: 'idle' })} />
          <p className="m-0 px-0.5 text-[13px] leading-snug text-[#3a3a3c]">{panel.detail}</p>
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
              disabled={busy}
              className="cursor-pointer rounded-lg bg-[#0a0a0a] px-3 py-1.5 text-xs font-medium text-white transition-[transform,opacity] duration-100 ease-out enabled:active:scale-[0.98] disabled:opacity-35"
              onClick={() => void onConfirmAction()}
            >
              {busy ? '处理中…' : '确认'}
            </button>
          </div>
          <p
            className={`m-0 min-h-[15px] px-0.5 text-[11.5px] leading-snug ${
              msg ? 'text-[#5c5c5f]' : 'opacity-0'
            }`}
            role="status"
            aria-live="polite"
          >
            {msg || '\u00a0'}
          </p>
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

          <ActionButton
            primary
            disabled={busy}
            icon={<IconInbox className="size-[15px]" />}
            title="收纳当前窗口里除当前页以外的标签"
            onClick={() => void onStash(true)}
          >
            收纳
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
              disabled={busy}
              icon={<IconLayers />}
              title="用当前分类模型给本窗标签分组，已成组的也可以重分"
              onClick={() => void onOrganize()}
            >
              整理当前窗口
            </ActionButton>
            <ActionButton
              disabled={busy || selectedCount < 2}
              icon={<IconSelectTabs />}
              hint={selectedCount >= 2 ? String(selectedCount) : undefined}
              title={
                selectedCount >= 2
                  ? `只用分类模型整理这 ${selectedCount} 个选中标签，其余不动`
                  : '先在标签栏用 Ctrl / Shift 多选至少 2 个标签'
              }
              onClick={() => void onOrganizeSelected()}
            >
              整理选中标签
            </ActionButton>
            {moreOrganize && (
              <>
                <ActionButton
                  disabled={busy}
                  icon={<IconTarget />}
                  title="用分类模型找出当前页那一组，不整理其余标签"
                  onClick={() => void onOrganizeAroundPage()}
                >
                  按当前页归组
                </ActionButton>
                <ActionButton
                  disabled={busy}
                  icon={<IconNewWindow />}
                  title="用分类模型找出当前页那一组，移到新窗口"
                  onClick={() => void onRelatedToNewWindow()}
                >
                  相关到新窗口
                </ActionButton>
                <ActionButton
                  disabled={busy}
                  icon={<IconTopic />}
                  title="输入主题，用分类模型收成一组"
                  onClick={() => setPanel({ kind: 'topic', query: '' })}
                >
                  按主题归组
                </ActionButton>
              </>
            )}
            <ActionMore open={moreOrganize} onClick={() => setMoreOrganize((v) => !v)}>
              {moreOrganize ? '收起' : '更多整理'}
            </ActionMore>
          </ActionGroup>

          <ActionGroup>
            <ActionButton
              disabled={busy || !mergeStats.movableTabs}
              icon={<IconWindows />}
              hint={mergeStats.otherWindows ? String(mergeStats.otherWindows) : undefined}
              title={
                mergeStats.movableTabs
                  ? `把 ${mergeStats.otherWindows} 个其他窗口的 ${mergeStats.movableTabs} 个标签并进当前窗口再整理`
                  : '没有其他窗口可合并'
              }
              onClick={() => void onMergeAll()}
            >
              合并全部窗口
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
            <ActionButton
              disabled={busy}
              icon={<IconCloseTabs />}
              title="按已收纳、重复、闲置与模型判断，选出可以关掉的标签"
              onClick={() => void openCloseSuggest()}
            >
              建议关闭
            </ActionButton>
          </ActionGroup>

          <div className="flex items-center justify-between gap-2 px-0.5">
            <button
              type="button"
              disabled={busy}
              className="cursor-pointer text-[11px] leading-none text-[#8b8b8e] transition-colors hover:text-[#0a0a0a] hover:underline disabled:opacity-35"
              onClick={() => openManagement()}
            >
              打开标签管理
            </button>
            {needModelLibrary ? (
              <button
                type="button"
                disabled={busy}
                className="cursor-pointer truncate text-[10.5px] leading-none text-[#8b8b8e] transition-colors hover:text-[#0a0a0a] hover:underline disabled:opacity-35"
                title="弹窗不会下载模型"
                onClick={() => openManagement('#models')}
              >
                模型未下载
              </button>
            ) : (
              <span className="truncate text-[10.5px] leading-none text-[#a1a1a4]" title="分类模型在管理页更改">
                浏览器内小模型
              </span>
            )}
          </div>

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
