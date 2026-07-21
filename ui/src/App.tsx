import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { GlassButton } from '@/components/ui/glasscn/glass-button'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/Modal'
import { HeightCollapse } from '@/components/HeightCollapse'
import { ClassifyPicker, type ClassifySettings } from '@/components/ClassifyPicker'
import { ToastProvider, useToast } from '@/hooks/useToast'
import { JetBrainsAmbient } from '@/components/JetBrainsAmbient'
import { cn } from '@/lib/utils'
import { stashResultText } from '@/lib/stashResultText'
import {
  applyEnhancement,
  applyNativeGroups,
  buildExportPayload,
  deleteSession,
  findDuplicates,
  flattenTabs,
  getCurrentWindowOrganizePreview,
  getData,
  getSettings,
  isRestorableUrl,
  mergeAndOrganizeCurrent,
  mergeImport,
  mergeOrganizeSummary,
  newId,
  proposeEnhancement,
  removeDuplicates,
  restoreGroup,
  restoreSessionGroups,
  setData,
  setSettings,
  sourceLabel,
  tabCount,
  updateSession,
  type Session,
} from '@/lib/chrome-ext'

type ModalState =
  | { kind: 'none' }
  | { kind: 'busy'; title: string; message: string; progress: string }
  | {
      kind: 'suggest'
      sessionId: string
      status: string
      busy: boolean
      picker: ClassifySettings
      /** 收纳后确认流程才有：建议的会话名（可编辑） */
      proposedName?: string
      preview: { groups: Array<{ name: string; tabs: Array<{ title: string }>; tabIds: string[] }>; ungrouped: unknown[] } | null
      source?: string
    }
  | {
      kind: 'live'
      status: string
      busy: boolean
      picker: ClassifySettings
      preview: { groups: Array<{ name: string; tabs: Array<{ title: string }> }> } | null
      windowId: number | null
      source?: string
    }
  | {
      kind: 'merge'
      summary: { otherWindows: number; movableTabs: number; skippedPinned: number; skippedUrl: number }
      picker: ClassifySettings
      progress: string
      busy: boolean
    }
  | {
      kind: 'dedup'
      removing: boolean
      groups: Array<{
        key: string
        keep: { title: string; sessionName: string }
        items: Array<{ title: string; sessionName: string }>
      }>
    }

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function timeAgo(ts: number) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo} 个月前`
  return `${Math.floor(mo / 12)} 年前`
}

/** _favicon API → 收纳时存的 favIconUrl → 域名首字母 */
const Favicon = memo(function Favicon({
  url,
  favIconUrl,
  className,
}: {
  url: string
  favIconUrl?: string
  className?: string
}) {
  const [stage, setStage] = useState(0)
  const host = useMemo(() => domainOf(url), [url])
  const srcs = useMemo(() => {
    const extId = globalThis.chrome?.runtime?.id
    return [
      extId ? `chrome-extension://${extId}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32` : null,
      favIconUrl || null,
    ].filter(Boolean) as string[]
  }, [url, favIconUrl])

  if (stage >= srcs.length) {
    return (
      <span
        aria-hidden
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-black/8 text-[9px] font-semibold uppercase text-muted-foreground',
          className,
        )}
      >
        {host.charAt(0) || '·'}
      </span>
    )
  }
  return (
    <img
      src={srcs[stage]}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setStage((s) => s + 1)}
      className={cn('size-4 shrink-0 rounded-[4px]', className)}
    />
  )
})

function TextAction({
  danger,
  emphasis,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean; emphasis?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'cursor-pointer rounded-sm text-[13px] underline-offset-4 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-1',
        emphasis
          ? 'font-medium text-foreground/80 hover:text-foreground hover:underline'
          : 'text-muted-foreground hover:text-foreground hover:underline',
        danger && 'hover:text-destructive hover:underline',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

function GroupPreviewList({ groups }: { groups: Array<{ name: string; tabs: Array<{ title: string }> }> }) {
  let row = 0
  return (
    <div className="mt-2 flex flex-col divide-y divide-border/70 border-y border-border/70">
      {groups.map((g) => (
        <div key={g.name} className="py-2.5">
          <h3
            className="anim-row m-0 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            style={{ '--row-delay': `${Math.min(row++, 16) * 16}ms` } as React.CSSProperties}
          >
            {g.name} · {g.tabs.length}
          </h3>
          {g.tabs.map((t, i) => (
            <div
              key={i}
              className="anim-row truncate text-[13px] leading-6 text-foreground/85"
              style={{ '--row-delay': `${Math.min(row++, 16) * 16}ms` } as React.CSSProperties}
            >
              {t.title}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** 会话变更时预建小写 haystack，避免每次 keystroke 对全部 tab 做 toLowerCase / URL 解析 */
function buildSessionHaystack(session: Session) {
  const parts: string[] = [session.name]
  for (const g of session.groups) {
    parts.push(g.name)
    for (const t of g.tabs) {
      parts.push(t.title, t.url, domainOf(t.url))
    }
  }
  return parts.join('\n').toLowerCase()
}

type SessionActions = {
  restoreSession: (sessionId: string, andDelete: boolean) => void
  openSuggest: (sessionId: string) => void
  renameSession: (sessionId: string) => void
  confirmDeleteSession: (sessionId: string) => void
  restoreOneGroup: (sessionId: string, groupId: string) => void
  openOneTab: (sessionId: string, groupId: string, tabId: string) => void
  deleteOneTab: (sessionId: string, groupId: string, tabId: string) => void
}

const SessionRow = memo(function SessionRow({
  session,
  open,
  onToggle,
  actionsRef,
}: {
  session: Session
  open: boolean
  onToggle: (id: string) => void
  actionsRef: React.MutableRefObject<SessionActions>
}) {
  // 分组折叠留在行内，避免父级 Set 更新导致整表重渲染
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const count = tabCount(session)
  const a = actionsRef

  return (
    <section
      className={cn(
        !open && '[content-visibility:auto] [contain-intrinsic-size:auto_44px]',
        open && 'bg-black/[0.015]',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        className={cn(
          'flex w-full cursor-pointer items-center gap-2 px-3.5 py-2.5 text-left transition-colors',
          'hover:bg-black/[0.03] focus-visible:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30',
          open && 'hover:bg-black/[0.02]',
        )}
        onClick={() => onToggle(session.id)}
      >
        <span
          className={cn(
            'flex size-4 shrink-0 items-center justify-center text-[10px] text-muted-foreground/80 transition-transform duration-150',
            open && 'rotate-90 text-foreground/55',
          )}
          aria-hidden
        >
          ▸
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight">{session.name}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          <span className="text-foreground/55">{count}</span>
          <span className="mx-1 text-border">·</span>
          {timeAgo(session.createdAt)}
        </span>
      </button>
      <HeightCollapse open={open}>
        <div className="border-t border-border/50 px-3.5 pb-3.5 pt-2.5">
          <div className="mb-1 flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <TextAction emphasis onClick={() => void a.current.restoreSession(session.id, false)}>全部恢复</TextAction>
            <TextAction onClick={() => void a.current.restoreSession(session.id, true)}>恢复并删除会话</TextAction>
            <TextAction onClick={() => void a.current.openSuggest(session.id)}>建议分组</TextAction>
            <TextAction onClick={() => void a.current.renameSession(session.id)}>改名</TextAction>
            <TextAction danger onClick={() => void a.current.confirmDeleteSession(session.id)}>删除</TextAction>
          </div>
          {session.groups.map((g) => {
            const key = `${session.id}:${g.id}`
            const collapsed = collapsedGroups.has(key)
            return (
              <div key={g.id} className="mt-2">
                <div className="group/g flex items-center gap-2 py-0.5">
                  <button
                    type="button"
                    aria-expanded={!collapsed}
                    className="cursor-pointer rounded-sm text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                    onClick={() => {
                      setCollapsedGroups((prev) => {
                        const next = new Set(prev)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        return next
                      })
                    }}
                  >
                    <span aria-hidden>{collapsed ? '▸' : '▾'} </span>
                    {g.name} · {g.tabs.length}
                  </button>
                  <span aria-hidden className="h-px flex-1 bg-border/60" />
                  <TextAction
                    className="text-xs opacity-55 transition-opacity group-hover/g:opacity-100 focus-visible:opacity-100"
                    onClick={() => void a.current.restoreOneGroup(session.id, g.id)}
                  >
                    恢复此分组
                  </TextAction>
                </div>
                <HeightCollapse open={!collapsed}>
                  <div className="mt-0.5 max-h-[min(52vh,420px)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
                    {g.tabs.map((t, i) => (
                      <div
                        key={t.id}
                        className={cn(
                          'group/row -mx-1 flex items-center gap-2 rounded-md px-1 py-[3px] transition-colors hover:bg-black/[0.035] focus-within:bg-black/[0.03]',
                          i < 12 && 'anim-row',
                        )}
                        style={i < 12 ? ({ '--row-delay': `${i * 18}ms` } as React.CSSProperties) : undefined}
                      >
                        <Favicon url={t.url} favIconUrl={t.favIconUrl} />
                        <span
                          className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-muted-foreground transition-colors group-hover/row:text-foreground"
                          title={t.url}
                        >
                          {t.title}
                        </span>
                        <span className="hidden max-w-[120px] shrink-0 truncate text-[11px] text-muted-foreground/55 sm:block">
                          {domainOf(t.url)}
                        </span>
                        <span className="flex shrink-0 items-center gap-2.5 opacity-60 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
                          <TextAction className="text-xs" onClick={() => void a.current.openOneTab(session.id, g.id, t.id)}>打开</TextAction>
                          <TextAction danger className="text-xs" onClick={() => void a.current.deleteOneTab(session.id, g.id, t.id)}>删除</TextAction>
                        </span>
                      </div>
                    ))}
                  </div>
                </HeightCollapse>
              </div>
            )
          })}
        </div>
      </HeightCollapse>
    </section>
  )
})

function ManagementApp() {
  const { toast } = useToast()
  const [sessions, setSessions] = useState<Session[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [settings, setSettingsState] = useState<ClassifySettings | null>(null)
  const [modal, setModal] = useState<ModalState>({ kind: 'none' })
  const [query, setQuery] = useState('')
  const [stashBusy, setStashBusy] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const bootRef = useRef(false)
  const actionsRef = useRef<SessionActions>({
    restoreSession: () => {},
    openSuggest: () => {},
    renameSession: () => {},
    confirmDeleteSession: () => {},
    restoreOneGroup: () => {},
    openOneTab: () => {},
    deleteOneTab: () => {},
  })

  const deferredQuery = useDeferredValue(query)
  const sessionHays = useMemo(
    () => new Map(sessions.map((s) => [s.id, buildSessionHaystack(s)] as const)),
    [sessions],
  )
  const filteredSessions = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) => sessionHays.get(s.id)?.includes(q))
  }, [sessions, deferredQuery, sessionHays])
  const liveMatchCount = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions.length
    let n = 0
    for (const s of sessions) {
      if (sessionHays.get(s.id)?.includes(q)) n++
    }
    return n
  }, [query, sessions, sessionHays])

  const reload = useCallback(async () => {
    const data = await getData()
    setSessions(data.sessions)
  }, [])

  const closeModal = useCallback(() => setModal({ kind: 'none' }), [])
  const onToggleSession = useCallback((id: string) => {
    setExpanded((prev) => (prev === id ? null : id))
  }, [])

  async function persistSettings(patch: Partial<ClassifySettings> & { localModel?: { model: string } }) {
    const next = await setSettings(patch)
    setSettingsState(next)
    return next
  }

  async function openLive() {
    const s = await getSettings()
    setModal({ kind: 'live', status: '生成预览', busy: true, picker: s, preview: null, windowId: null })
    await runLivePreview(s)
  }

  async function openMerge() {
    const summary = await mergeOrganizeSummary()
    if (!summary) return toast('无法获取窗口信息')
    const s = await getSettings()
    setModal({ kind: 'merge', summary, picker: s, progress: '', busy: false })
  }

  useEffect(() => {
    if (bootRef.current) return
    bootRef.current = true
    void (async () => {
      try {
        setSettingsState(await getSettings())
        await reload()
        const hash = location.hash
        if (hash === '#merge' || hash === '#organize') {
          history.replaceState(null, '', location.pathname + location.search)
          if (hash === '#merge') await openMerge()
          else await openLive()
        }
      } catch {
        setSettingsState({
          classifyMode: 'site',
          browserModelId: 'Xenova/all-MiniLM-L6-v2',
          preferWebGPU: true,
          localModel: { model: 'qwen2.5:0.5b' },
        })
      }
    })()
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.tabManagerData) void reload()
    }
    const storage = globalThis.chrome?.storage?.onChanged
    storage?.addListener(onChanged)
    return () => storage?.removeListener(onChanged)
  }, [reload])

  // `/` 聚焦搜索（输入框内不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (!sessions.length || modal.kind !== 'none') return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sessions.length, modal.kind])

  async function onStash() {
    if (stashBusy) return
    setStashBusy(true)
    let sessionId: string | null = null
    try {
      const r = await chrome.runtime.sendMessage({ type: 'STASH_CURRENT_WINDOW' })
      if (!r.ok) {
        if (r.reason === 'empty') toast('没有可收纳的标签')
        else if (r.reason === 'all_dupe') toast('没有新网页可收纳（本批网址全部重复）')
        else if (r.reason === 'all_unrestorable') toast('没有可收纳的网页（本地文件等页面无法恢复，已保留）')
        else toast('收纳失败')
        return
      }
      toast(stashResultText(r))
      setExpanded(r.session.id)
      await reload()
      sessionId = r.session.id as string
    } finally {
      setStashBusy(false)
    }
    if (!sessionId) return
    if (settings?.stashReview === false) {
      await silentEnhance(sessionId)
    } else {
      await openStashReview(sessionId)
    }
  }

  /** 关闭「收纳后询问」时的静默整理：提议后直接应用 */
  async function silentEnhance(sessionId: string) {
    const s = settings
    if (!s) return
    try {
      const data = await getData()
      const session = data.sessions.find((x: Session) => x.id === sessionId)
      if (!session) return
      const { preview, source, name } = await proposeEnhancement(flattenTabs(session), {
        classifyMode: s.classifyMode,
        browserModelId: s.browserModelId,
        preferWebGPU: s.preferWebGPU,
        baseUrl: s.localModel.baseUrl,
        model: s.localModel.model,
        withName: true,
      })
      const r = await applyEnhancement(sessionId, { preview, name })
      if (r.ok) {
        toast(r.grouped ? `已整理并命名「${r.name}」（${sourceLabel(source)}）` : `已命名「${r.name}」`)
        await reload()
      }
    } catch {
      /* 收纳已成功，智能增强失败不影响结果 */
    }
  }

  async function openDedup() {
    const data = await getData()
    const groups = findDuplicates(data) as Array<{
      key: string
      keep: { title: string; sessionName: string }
      items: Array<{ title: string; sessionName: string }>
    }>
    setModal({ kind: 'dedup', groups, removing: false })
  }

  async function applyDedup() {
    if (modal.kind !== 'dedup') return
    setModal({ ...modal, removing: true })
    const data = await getData()
    const groups = findDuplicates(data)
    const n = removeDuplicates(data, groups)
    await setData(data)
    setModal({ kind: 'none' })
    await reload()
    toast(n ? `已删除 ${n} 个重复标签` : '没有重复可删')
  }

  async function openOneTab(sessionId: string, groupId: string, tabId: string) {
    const data = await getData()
    const session = data.sessions.find((s: Session) => s.id === sessionId)
    const group = session?.groups.find((g) => g.id === groupId)
    const tab = group?.tabs.find((t) => t.id === tabId)
    if (tab && isRestorableUrl(tab.url)) await chrome.tabs.create({ url: tab.url })
    else toast('无法打开此 URL')
  }

  async function deleteOneTab(sessionId: string, groupId: string, tabId: string) {
    const data = await getData()
    const session = data.sessions.find((s: Session) => s.id === sessionId)
    const group = session.groups.find((g) => g.id === groupId)
    group.tabs = group.tabs.filter((t) => t.id !== tabId)
    session.groups = session.groups.filter((g) => g.tabs.length > 0)
    if (!session.groups.length) {
      session.groups = [{ id: newId(), name: '未分组', tabs: [] }]
    }
    await setData(data)
    await reload()
    toast('已删除标签')
  }

  async function restoreOneGroup(sessionId: string, groupId: string) {
    const data = await getData()
    const session = data.sessions.find((s: Session) => s.id === sessionId)
    const group = session?.groups.find((g) => g.id === groupId)
    if (!group?.tabs?.length) return toast('此分组没有标签')
    setModal({ kind: 'busy', title: `恢复分组 · ${group.name}`, message: `${group.tabs.length} 个标签，将分批打开并打成标签组。`, progress: '准备中' })
    try {
      const n = await restoreGroup(group, {
        onProgress: (m: string) => setModal((prev) => (prev.kind === 'busy' ? { ...prev, progress: m } : prev)),
      })
      setModal({ kind: 'none' })
      toast(`已恢复分组「${group.name}」共 ${n} 个标签`)
    } catch {
      toast('恢复分组失败')
      setModal({ kind: 'none' })
    }
  }

  async function restoreSession(sessionId: string, andDelete: boolean) {
    const data = await getData()
    const session = data.sessions.find((s: Session) => s.id === sessionId)
    if (!session) return
    const total = tabCount(session)
    setModal({
      kind: 'busy',
      title: andDelete ? '恢复并删除会话' : '全部恢复',
      message: `共 ${total} 个标签，按分组分批打开（不会一次全部前台激活）。`,
      progress: '准备中',
    })
    try {
      const n = await restoreSessionGroups(session, {
        onProgress: (m: string) => setModal((prev) => (prev.kind === 'busy' ? { ...prev, progress: m } : prev)),
      })
      if (andDelete) {
        await deleteSession(sessionId)
        setExpanded(null)
      }
      setModal({ kind: 'none' })
      toast(andDelete ? `已恢复 ${n} 个标签并删除会话` : `已恢复 ${n} 个标签`)
      await reload()
    } catch {
      toast('恢复失败')
      setModal({ kind: 'none' })
    }
  }

  async function renameSession(sessionId: string) {
    const data = await getData()
    const session = data.sessions.find((s: Session) => s.id === sessionId)
    const name = prompt('会话名称', session.name)
    if (name == null || !name.trim()) return
    await updateSession(sessionId, { name: name.trim() })
    await reload()
  }

  async function confirmDeleteSession(sessionId: string) {
    if (!confirm('确定删除此会话？')) return
    await deleteSession(sessionId)
    setExpanded(null)
    await reload()
    toast('已删除会话')
  }

  async function runSuggest(sessionId: string, picker: ClassifySettings, withName = false) {
    await setSettings(picker)
    setSettingsState(picker)
    const data = await getData()
    const session = data.sessions.find((s: Session) => s.id === sessionId)
    const items = flattenTabs(session)
    setModal((prev) =>
      prev.kind === 'suggest'
        ? { ...prev, status: '生成预览', busy: true, preview: null, picker }
        : prev,
    )
    const { preview, source, error, name } = await proposeEnhancement(items, {
      classifyMode: picker.classifyMode,
      browserModelId: picker.browserModelId,
      preferWebGPU: picker.preferWebGPU,
      baseUrl: picker.localModel.baseUrl,
      model: picker.localModel.model,
      withName,
      onStatus: (m: string) => setModal((prev) => (prev.kind === 'suggest' ? { ...prev, status: m } : prev)),
    })
    setModal((prev) =>
      prev.kind === 'suggest'
        ? {
            ...prev,
            status: error
              ? `来源：${sourceLabel(source)} · ${String(error).slice(0, 40)}`
              : `来源：${sourceLabel(source)}`,
            busy: false,
            preview,
            source,
            ...(withName ? { proposedName: name } : {}),
          }
        : prev,
    )
  }

  async function openSuggest(sessionId: string) {
    const s = await getSettings()
    setModal({ kind: 'suggest', sessionId, status: '生成预览', busy: true, picker: s, preview: null })
    await runSuggest(sessionId, s)
  }

  /** 收纳后的确认流程：分组预览 + 建议会话名，用户确认才应用 */
  async function openStashReview(sessionId: string) {
    const s = await getSettings()
    setModal({ kind: 'suggest', sessionId, status: '生成预览', busy: true, picker: s, preview: null, proposedName: '' })
    await runSuggest(sessionId, s, true)
  }

  async function applySuggestedGroups(sessionId: string, preview: { groups: Array<{ name: string; tabIds: string[] }> }, name?: string) {
    await applyEnhancement(sessionId, { preview, name: name?.trim() || undefined })
  }

  async function runLivePreview(picker: ClassifySettings) {
    await setSettings(picker)
    setSettingsState(picker)
    setModal((prev) =>
      prev.kind === 'live'
        ? { ...prev, busy: true, status: '生成预览', preview: null, picker }
        : prev,
    )
    const r = await getCurrentWindowOrganizePreview((m: string) =>
      setModal((prev) => (prev.kind === 'live' ? { ...prev, status: m } : prev)),
    )
    if (!r.ok) {
      setModal((prev) =>
        prev.kind === 'live'
          ? {
              ...prev,
              busy: false,
              status:
                r.reason === 'too_few' ? '未分组标签太少'
                : r.reason === 'no_groups' ? '没有可成组的建议'
                : '无法整理',
              preview: null,
              windowId: null,
            }
          : prev,
      )
      return
    }
    setModal((prev) =>
      prev.kind === 'live'
        ? {
            ...prev,
            busy: false,
            status: r.error
              ? `来源：${sourceLabel(r.source)} · ${String(r.error).slice(0, 40)}`
              : `来源：${sourceLabel(r.source)} · 将为未分组标签创建原生标签组`,
            preview: r.preview,
            windowId: r.windowId,
            source: r.source,
          }
        : prev,
    )
  }

  async function onExport() {
    const data = await getData()
    const payload = buildExportPayload(data)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `tab-manager-export-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast('已导出')
  }

  async function onImport(file: File) {
    try {
      const text = await file.text()
      const imported = JSON.parse(text)
      const data = await getData()
      mergeImport(data, imported)
      await setData(data)
      toast(`已导入 ${imported.sessions?.length || 0} 个会话`)
      await reload()
    } catch {
      toast('导入失败：文件格式无效')
    }
  }

  actionsRef.current = {
    restoreSession: (sessionId, andDelete) => { void restoreSession(sessionId, andDelete) },
    openSuggest: (sessionId) => { void openSuggest(sessionId) },
    renameSession: (sessionId) => { void renameSession(sessionId) },
    confirmDeleteSession: (sessionId) => { void confirmDeleteSession(sessionId) },
    restoreOneGroup: (sessionId, groupId) => { void restoreOneGroup(sessionId, groupId) },
    openOneTab: (sessionId, groupId, tabId) => { void openOneTab(sessionId, groupId, tabId) },
    deleteOneTab: (sessionId, groupId, tabId) => { void deleteOneTab(sessionId, groupId, tabId) },
  }

  if (!settings) {
    return (
      <div className="relative min-h-svh" aria-busy="true">
        <JetBrainsAmbient variant="page" className="fixed inset-0 z-0" />
        <div className="relative z-10 p-8 text-muted-foreground" role="status">
          加载中…
        </div>
      </div>
    )
  }

  const modalLabel =
    modal.kind === 'busy' ? modal.title
    : modal.kind === 'suggest' ? (modal.proposedName !== undefined ? '收纳完成 · 确认分组' : '建议分组')
    : modal.kind === 'live' ? '整理当前窗口'
    : modal.kind === 'merge' ? '合并并整理到当前窗口'
    : modal.kind === 'dedup' ? '网页去重'
    : undefined

  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <JetBrainsAmbient variant="page" className="fixed inset-0 z-0" />
      <header className="sticky top-0 z-20 flex flex-col gap-2 border-b border-border/80 bg-white/60 px-4 py-2.5 backdrop-blur-[24px] backdrop-saturate-150">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="m-0 text-lg font-semibold tracking-tight">标签管理</h1>
          {sessions.length > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {query.trim() ? `${liveMatchCount}/${sessions.length}` : sessions.length} 个会话
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <GlassButton disabled={stashBusy} onClick={() => void onStash()}>
              {stashBusy ? '收纳中…' : '收纳当前窗口'}
            </GlassButton>
            <GlassButton variant="outline" disabled={stashBusy} onClick={() => void openLive()}>整理当前窗口</GlassButton>
            <GlassButton variant="secondary" disabled={stashBusy} onClick={() => void openMerge()}>合并并整理全部窗口</GlassButton>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ClassifyPicker
            value={settings}
            onChange={(patch) => { void persistSettings(patch) }}
          />
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={settings.stashReview !== false}
              onChange={(e) => { void persistSettings({ stashReview: e.target.checked }) }}
            />
            收纳后询问
          </label>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => void openDedup()}>去重</Button>
          <Button variant="ghost" size="sm" onClick={() => void onExport()}>导出</Button>
          <Button variant="ghost" size="sm" onClick={() => importRef.current?.click()}>导入</Button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void onImport(file)
              e.target.value = ''
            }}
          />
        </div>
        {sessions.length > 0 && (
          <div className="flex items-center gap-2 border-t border-border/50 pt-2">
            <label className="sr-only" htmlFor="session-search">
              搜索会话与标签
            </label>
            <input
              ref={searchRef}
              id="session-search"
              type="search"
              value={query}
              placeholder="搜索会话、标题或网址…（/）"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-lg border border-transparent bg-black/[0.04] px-3 py-1.5 text-sm text-foreground outline-none transition-[background,box-shadow,border-color] placeholder:text-muted-foreground/65 hover:bg-black/[0.055] focus-visible:border-ring/30 focus-visible:bg-white/90 focus-visible:ring-3 focus-visible:ring-ring/25"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.preventDefault()
                  setQuery('')
                }
              }}
            />
            {query.trim() && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery('')
                  searchRef.current?.focus()
                }}
              >
                清除
              </Button>
            )}
          </div>
        )}
      </header>

      <main className="relative z-10 mx-auto flex max-w-[880px] flex-col px-4 py-4 pb-16">
        {!sessions.length && (
          <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border/90 bg-white/40 px-6 py-20 text-center backdrop-blur-[8px]">
            <div className="flex flex-col gap-1.5">
              <p className="m-0 text-[15px] font-medium tracking-tight text-foreground/90">还没有会话</p>
              <p className="m-0 text-sm text-muted-foreground">收纳当前窗口，把标签整理到这里</p>
            </div>
            <GlassButton disabled={stashBusy} onClick={() => void onStash()}>
              {stashBusy ? '收纳中…' : '收纳当前窗口'}
            </GlassButton>
          </div>
        )}

        {sessions.length > 0 && !filteredSessions.length && (
          <div className="mt-2 rounded-xl border border-border/70 bg-white/50 px-4 py-14 text-center" role="status">
            <p className="m-0 text-sm text-muted-foreground">
              没有匹配「{query.trim()}」的会话
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => {
                setQuery('')
                searchRef.current?.focus()
              }}
            >
              清除搜索
            </Button>
          </div>
        )}

        {filteredSessions.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border/90 bg-white/92 shadow-[0_1px_2px_rgba(0,0,0,0.035)]">
            <div className="divide-y divide-border/70">
              {filteredSessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  open={expanded === session.id}
                  onToggle={onToggleSession}
                  actionsRef={actionsRef}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      <Modal
        open={modal.kind !== 'none'}
        label={modalLabel}
        dismissible={!(modal.kind === 'busy' || (modal.kind === 'merge' && modal.busy) || (modal.kind === 'dedup' && modal.removing))}
        onClose={closeModal}
      >
        {modal.kind === 'busy' && (
          <>
            <h2 className="m-0 text-[17px] font-semibold tracking-tight">{modal.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{modal.message}</p>
            <p className="mt-2.5 rounded-[10px] bg-black/[0.04] px-3 py-2.5 text-[13px]">{modal.progress}…</p>
          </>
        )}
        {modal.kind === 'suggest' && (
          <>
            <h2 className="m-0 text-[17px] font-semibold tracking-tight">
              {modal.proposedName !== undefined ? '收纳完成 · 确认分组' : '建议分组'}
            </h2>
            <ClassifyPicker
              className="mt-2.5"
              value={modal.picker}
              onChange={(patch) => {
                const next = {
                  ...modal.picker,
                  ...patch,
                  localModel: { ...modal.picker.localModel, ...(patch.localModel || {}) },
                }
                void runSuggest(modal.sessionId, next, modal.proposedName !== undefined)
              }}
            />
            <p className={cn('mt-2 rounded-[10px] bg-black/[0.04] px-3 py-2.5 text-[13px]', modal.busy && 'opacity-80')}>
              {modal.status}
            </p>
            {modal.proposedName !== undefined && !modal.busy && (
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                会话名
                <input
                  type="text"
                  className="min-w-0 flex-1 rounded-lg border border-black/15 bg-white/80 px-2 py-1.5 text-[13px] text-foreground"
                  value={modal.proposedName}
                  placeholder="保持原名称"
                  onChange={(e) =>
                    setModal((prev) =>
                      prev.kind === 'suggest' ? { ...prev, proposedName: e.target.value } : prev,
                    )
                  }
                />
              </label>
            )}
            {modal.preview && <GroupPreviewList groups={modal.preview.groups} />}
            {!modal.busy && !modal.preview?.groups.length && (
              <p className="mt-2 text-xs text-muted-foreground">没有可成组的建议。</p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setModal({ kind: 'none' })}>
                {modal.proposedName !== undefined ? '保持原样' : '取消'}
              </Button>
              <Button
                variant="secondary"
                disabled={modal.busy}
                onClick={() => void runSuggest(modal.sessionId, modal.picker, modal.proposedName !== undefined)}
              >
                重新预览
              </Button>
              <Button
                disabled={modal.busy || (!modal.preview?.groups.length && !modal.proposedName?.trim())}
                onClick={() => {
                  if (!modal.preview) return
                  void applySuggestedGroups(modal.sessionId, modal.preview, modal.proposedName).then(async () => {
                    setModal({ kind: 'none' })
                    await reload()
                    toast(modal.proposedName?.trim() ? `已应用分组并命名「${modal.proposedName.trim()}」` : '已应用分组')
                  })
                }}
              >
                {modal.proposedName !== undefined ? '应用分组并命名' : '应用分组'}
              </Button>
            </div>
          </>
        )}
        {modal.kind === 'live' && (
          <>
            <h2 className="m-0 text-[17px] font-semibold tracking-tight">整理当前窗口</h2>
            <ClassifyPicker
              className="mt-2.5"
              value={modal.picker}
              onChange={(patch) => {
                const next = {
                  ...modal.picker,
                  ...patch,
                  localModel: { ...modal.picker.localModel, ...(patch.localModel || {}) },
                }
                void runLivePreview(next)
              }}
            />
            <p className={cn('mt-2 rounded-[10px] bg-black/[0.04] px-3 py-2.5 text-[13px]', modal.busy && 'opacity-80')}>
              {modal.status}
            </p>
            {modal.preview && <GroupPreviewList groups={modal.preview.groups} />}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setModal({ kind: 'none' })}>取消</Button>
              <Button variant="secondary" disabled={modal.busy} onClick={() => void runLivePreview(modal.picker)}>重新预览</Button>
              <Button
                disabled={!modal.preview || modal.windowId == null || modal.busy}
                onClick={() => {
                  if (!modal.preview || modal.windowId == null) return
                  void (async () => {
                    await setSettings(modal.picker)
                    setModal((prev) => (prev.kind === 'live' ? { ...prev, busy: true, status: '正在创建标签组' } : prev))
                    await applyNativeGroups(modal.windowId!, modal.preview!, (m: string) =>
                      setModal((prev) => (prev.kind === 'live' ? { ...prev, status: m } : prev)),
                    )
                    setModal({ kind: 'none' })
                    toast(`已整理当前窗口（${sourceLabel(modal.source)}）`)
                  })()
                }}
              >
                应用分组
              </Button>
            </div>
          </>
        )}
        {modal.kind === 'merge' && (
          <>
            <h2 className="m-0 text-[17px] font-semibold tracking-tight">合并并整理到当前窗口？</h2>
            <p className="mt-1 text-sm">
              将合并 <strong>{modal.summary.otherWindows}</strong> 个其他窗口的{' '}
              <strong>{modal.summary.movableTabs}</strong> 个标签。
            </p>
            <p className="text-xs text-muted-foreground">
              跳过 pinned：{modal.summary.skippedPinned}；不可恢复 URL：{modal.summary.skippedUrl}
            </p>
            <ClassifyPicker
              className="mt-2.5"
              value={modal.picker}
              onChange={(patch) =>
                setModal((prev) =>
                  prev.kind === 'merge'
                    ? {
                        ...prev,
                        picker: {
                          ...prev.picker,
                          ...patch,
                          localModel: { ...prev.picker.localModel, ...(patch.localModel || {}) },
                        },
                      }
                    : prev,
                )
              }
            />
            {modal.progress && (
              <p className="mt-2 rounded-[10px] bg-black/[0.04] px-3 py-2.5 text-[13px]">{modal.progress}</p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={modal.busy} onClick={() => setModal({ kind: 'none' })}>取消</Button>
              <Button
                disabled={modal.busy}
                onClick={() => {
                  void (async () => {
                    await setSettings(modal.picker)
                    setSettingsState(modal.picker)
                    setModal((prev) => (prev.kind === 'merge' ? { ...prev, busy: true, progress: '开始…' } : prev))
                    try {
                      const r = await mergeAndOrganizeCurrent({
                        onProgress: (msg: string) =>
                          setModal((prev) => (prev.kind === 'merge' ? { ...prev, progress: msg } : prev)),
                      })
                      if (!r.ok) {
                        if (r.reason === 'no_groups') toast('没有可成组的建议')
                        else if (r.reason === 'too_few') toast('可整理标签太少')
                        else toast('整理失败')
                        setModal({ kind: 'none' })
                        return
                      }
                      setModal({ kind: 'none' })
                      toast(`已合并并整理（${sourceLabel(r.source)}）`)
                    } catch {
                      toast('整理出错')
                      setModal({ kind: 'none' })
                    }
                  })()
                }}
              >
                合并并整理
              </Button>
            </div>
          </>
        )}
        {modal.kind === 'dedup' && (
          <>
            <h2 className="m-0 text-[17px] font-semibold tracking-tight">网页去重</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              只处理完全相同的网址（逐字一致），保留最新收纳的一份。
            </p>
            {!modal.groups.length && (
              <p className="mt-3 text-sm text-muted-foreground">没有发现重复网页。</p>
            )}
            {modal.groups.length > 0 && (
              <div className="mt-2 flex max-h-[46vh] flex-col divide-y divide-border/70 overflow-auto border-y border-border/70">
                {modal.groups.map((g) => (
                  <div key={g.key} className="py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[13px] font-medium">{g.keep.title}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        ×{g.items.length + 1}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      保留于「{g.keep.sessionName}」 · 删除 {g.items.length} 份（
                      {g.items.map((d) => d.sessionName).join('、')}）
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={modal.removing} onClick={() => setModal({ kind: 'none' })}>取消</Button>
              <Button
                disabled={!modal.groups.length || modal.removing}
                onClick={() => void applyDedup()}
              >
                {modal.removing ? '删除中…' : `删除重复（${modal.groups.reduce((n, g) => n + g.items.length, 0)}）`}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

export function App() {
  return (
    <ToastProvider>
      <ManagementApp />
    </ToastProvider>
  )
}
