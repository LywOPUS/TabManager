import { useCallback, useEffect, useState } from 'react'
import { ClassifyPicker, type ClassifySettings } from '@/components/ClassifyPicker'
import {
  applyEnhancement,
  applyNativeGroups,
  flattenTabs,
  getCurrentWindowOrganizePreview,
  getData,
  getRecentSession,
  getSettings,
  proposeEnhancement,
  restoreSessionGroups,
  setSettings,
  sourceLabel,
  tabCount,
  type Session,
} from '@/lib/chrome-ext'
import { LensPanel, PopupShell } from './PopupShell'
import { PullToStash } from './PullToStash'
import { stashResultText } from '@/lib/stashResultText'

type GroupPreview = { name: string; tabs: Array<{ title: string }>; tabIds?: string[] }

type Panel =
  | { kind: 'idle' }
  | { kind: 'organize-busy'; status: string; picker: ClassifySettings }
  | {
      kind: 'organize'
      status: string
      picker: ClassifySettings
      windowId: number
      source?: string
      groups: GroupPreview[]
    }
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

function mergePicker(picker: ClassifySettings, patch: Partial<ClassifySettings> & { localModel?: { model: string } }) {
  return { ...picker, ...patch, localModel: { ...picker.localModel, ...(patch.localModel || {}) } }
}

export function PopupApp() {
  const [recent, setRecent] = useState<Session | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<Panel>({ kind: 'idle' })

  const loadRecent = useCallback(async () => {
    setRecent(await getRecentSession())
  }, [])

  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  const count = recent ? tabCount(recent) : 0
  const panelOpen = panel.kind !== 'idle'
  const picker = panelOpen ? panel.picker : null

  // ---------------------------------------------------------------- organize

  async function runOrganizePreview(p: ClassifySettings) {
    await setSettings(p)
    setBusy(true)
    setPanel({ kind: 'organize-busy', status: '生成预览', picker: p })
    const r = await getCurrentWindowOrganizePreview((m: string) =>
      setPanel((prev) => (prev.kind === 'organize-busy' ? { ...prev, status: m } : prev)),
    )
    setBusy(false)
    if (!r.ok) {
      setPanel({
        kind: 'organize',
        status:
          r.reason === 'too_few' ? '未分组标签太少'
          : r.reason === 'no_groups' ? '没有可成组的建议'
          : '无法整理',
        picker: p,
        windowId: -1,
        groups: [],
      })
      return
    }
    setPanel({
      kind: 'organize',
      status: r.error
        ? `来源：${sourceLabel(r.source)} · ${String(r.error).slice(0, 40)}`
        : `来源：${sourceLabel(r.source)}`,
      picker: p,
      windowId: r.windowId,
      source: r.source,
      groups: r.preview.groups,
    })
  }

  async function startOrganize() {
    const s = await getSettings()
    await runOrganizePreview(s)
  }

  async function applyOrganize() {
    if (panel.kind !== 'organize' || panel.windowId < 0 || !panel.groups.length) return
    const { windowId, source, groups, picker: p } = panel
    setBusy(true)
    setPanel({ kind: 'organize-busy', status: '正在创建标签组', picker: p })
    await applyNativeGroups(windowId, { groups }, (m: string) =>
      setPanel((prev) => (prev.kind === 'organize-busy' ? { ...prev, status: m } : prev)),
    )
    setBusy(false)
    setPanel({ kind: 'idle' })
    setMsg(`已整理当前窗口（${sourceLabel(source)}）`)
  }

  // ---------------------------------------------------------------- stash review

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
    const items = flattenTabs(session)
    const { preview, source, error, name } = await proposeEnhancement(items, {
      classifyMode: p.classifyMode,
      browserModelId: p.browserModelId,
      preferWebGPU: p.preferWebGPU,
      baseUrl: p.localModel.baseUrl,
      model: p.localModel.model,
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

  // ---------------------------------------------------------------- actions

  async function onStash(): Promise<boolean> {
    setBusy(true)
    setMsg('收纳中…')
    const r = await chrome.runtime.sendMessage({ type: 'STASH_CURRENT_WINDOW' })
    if (!r.ok) {
      setBusy(false)
      if (r.reason === 'empty') setMsg('没有可收纳的标签')
      else if (r.reason === 'all_dupe') setMsg('没有新网页可收纳（本批网址全部重复）')
      else if (r.reason === 'all_unrestorable') setMsg('没有可收纳的网页（本地文件等页面无法恢复，已保留）')
      else setMsg('收纳失败')
      return false
    }
    setMsg(stashResultText(r))
    await loadRecent()
    const s = await getSettings()
    if (s.stashReview === false) {
      // 关闭「收纳后询问」：静默提议并直接应用
      try {
        const data = await getData()
        const session = data.sessions.find((x) => x.id === r.session.id)
        const items = session ? flattenTabs(session) : []
        const { preview, source, name } = await proposeEnhancement(items, {
          classifyMode: s.classifyMode,
          browserModelId: s.browserModelId,
          preferWebGPU: s.preferWebGPU,
          baseUrl: s.localModel.baseUrl,
          model: s.localModel.model,
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

  function onPickerChange(patch: Partial<ClassifySettings> & { localModel?: { model: string } }) {
    const cur = panel
    if (cur.kind === 'idle') return
    const next = mergePicker(cur.picker, patch)
    if (cur.kind === 'organize' || cur.kind === 'organize-busy') void runOrganizePreview(next)
    else void runStashReview(cur.sessionId, next)
  }

  // ---------------------------------------------------------------- render

  if (panelOpen && picker) {
    const isStash = panel.kind === 'stash' || panel.kind === 'stash-busy'
    const groups = panel.kind === 'organize' ? panel.groups : panel.kind === 'stash' ? panel.preview.groups : null
    return (
      <PopupShell>
        <div className="flex items-center gap-1.5 px-0.5">
          <button
            type="button"
            aria-label="返回"
            className="cursor-pointer text-[15px] leading-none text-[#8b8b8e] transition-colors hover:text-[#0a0a0a]"
            onClick={() => setPanel({ kind: 'idle' })}
          >
            ←
          </button>
          <h1 className="m-0 text-[15px] font-semibold tracking-tight text-[#0a0a0a]">
            {isStash ? '收纳确认' : '整理当前窗口'}
          </h1>
        </div>

        <ClassifyPicker value={picker} onChange={onPickerChange} />

        <p className="m-0 px-0.5 text-xs text-[#8b8b8e]">
          {panel.status}
          {(panel.kind.endsWith('busy') || busy) && '…'}
        </p>

        {groups && groups.length > 0 && (
          <div className="flex max-h-[220px] flex-col divide-y divide-black/8 overflow-auto rounded-[10px] border border-black/8 bg-white/40 px-2.5">
            {groups.map((g, i) => (
              <div
                key={g.name}
                className="anim-row flex items-baseline justify-between gap-2 py-1.5"
                style={{ '--row-delay': `${Math.min(i, 12) * 18}ms` } as React.CSSProperties}
              >
                <span className="min-w-0 truncate text-[13px] font-medium text-[#0a0a0a]">{g.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-[#8b8b8e]">{g.tabs.length}</span>
              </div>
            ))}
          </div>
        )}

        {panel.kind === 'stash' && (
          <label className="flex items-center gap-2 px-0.5 text-xs text-[#8b8b8e]">
            会话名
            <input
              type="text"
              className="min-w-0 flex-1 rounded-lg border border-black/15 bg-white/70 px-2 py-1 text-[13px] text-[#0a0a0a]"
              value={panel.name}
              placeholder="保持原名称"
              onChange={(e) =>
                setPanel((prev) => (prev.kind === 'stash' ? { ...prev, name: e.target.value } : prev))
              }
            />
          </label>
        )}

        {(panel.kind === 'organize' || panel.kind === 'stash') && (
          <div className="flex justify-end gap-3 px-0.5">
            <button
              type="button"
              className="cursor-pointer text-xs text-[#8b8b8e] underline-offset-4 hover:text-[#0a0a0a] hover:underline"
              onClick={() => setPanel({ kind: 'idle' })}
            >
              {panel.kind === 'stash' ? '保持原样' : '取消'}
            </button>
            <button
              type="button"
              disabled={
                busy ||
                (panel.kind === 'organize'
                  ? panel.windowId < 0 || !panel.groups.length
                  : !panel.preview.groups.length && !panel.name.trim())
              }
              className="cursor-pointer text-xs font-medium text-[#0a0a0a] underline underline-offset-4 disabled:opacity-40"
              onClick={() => void (panel.kind === 'organize' ? applyOrganize() : applyStashReview())}
            >
              {panel.kind === 'stash' ? '应用分组并命名' : '应用分组'}
            </button>
          </div>
        )}
      </PopupShell>
    )
  }

  return (
    <PopupShell>
      <PullToStash disabled={busy} onFire={onStash}>
      {/* 抓手：提示可以下拉 */}
      <div className="mx-auto -mt-1 h-1 w-9 shrink-0 rounded-full bg-black/12" title="下拉快速收纳" aria-hidden />

      <h1 className="m-0 px-0.5 text-[15px] font-semibold tracking-tight text-[#0a0a0a]">
        Tab Manager
      </h1>

      {recent && (
        <LensPanel>
          <span className="text-[#0a0a0a]">最近：{recent.name}</span>
          <span className="ml-1 text-[#8b8b8e]">{count} 个标签</span>
        </LensPanel>
      )}

      <LensPanel as="button" disabled={busy} onClick={() => void onStash()}>
        收纳当前窗口
      </LensPanel>

      <LensPanel as="button" disabled={busy} onClick={() => void startOrganize()}>
        整理当前窗口
      </LensPanel>

      <LensPanel
        as="button"
        disabled={busy || !recent || count === 0}
        onClick={() => {
          void (async () => {
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
          })()
        }}
      >
        恢复最近会话
      </LensPanel>

      <LensPanel
        as="button"
        disabled={busy}
        onClick={() => {
          chrome.runtime.sendMessage({ type: 'OPEN_MANAGEMENT' })
          window.close()
        }}
      >
        打开标签管理
      </LensPanel>

      <p className="m-0 min-h-[16px] px-0.5 text-xs text-[#8b8b8e]">{msg}</p>
      </PullToStash>
    </PopupShell>
  )
}
