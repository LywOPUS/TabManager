/**
 * 管理页：会话列表、搜索、预览整理/跨窗合并、已收纳去重、闲置、分类、导入导出。
 * 弹窗对打开的标签立刻动手（整理/合并窗口/解散标签组/打开标签去重），见 popup/PopupApp.tsx。
 */
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { GlassButton } from '@/components/ui/glasscn/glass-button'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/Modal'
import { HeightCollapse } from '@/components/HeightCollapse'
import {
  ClassifyPicker,
  mergeClassifySettings,
  type ClassifySettings,
} from '@/components/ClassifyPicker'
import { timeAgo } from '@/lib/timeAgo'
import { ToastProvider, useToast } from '@/hooks/useToast'
import { JetBrainsAmbient } from '@/components/JetBrainsAmbient'
import { cn } from '@/lib/utils'
import { stashFailText, stashResultText } from '@/lib/stashResultText'
import { collectSearchHits, highlightMatch, type TabHit } from '@/lib/searchHits'
import {
  applyEnhancement,
  applyLivePlan,
  buildExportPayload,
  deleteSession,
  closeOpenTabDuplicates,
  closeTabsByIds,
  collectTabUsage,
  discardTabsByIds,
  ensureProcessesPermission,
  findDuplicates,
  isActionableUsageRow,
  processesApiAvailable,
  findOpenTabDuplicates,
  defaultIdleMinutes,
  formatBytes,
  formatIdle,
  getCurrentWindowOrganizePreview,
  getData,
  getSettings,
  isReadLaterName,
  isRestorableUrl,
  isUngroupedName,
  ensureFixedGroups,
  mergeAndOrganizeCurrent,
  mergeImport,
  mergeOrganizeSummary,
  organizeOkText,
  moveTabToGroup,
  dissolveGroup,
  dissolveFailText,
  dissolveOkText,
  dissolvePrompt,
  newId,
  classifyOptsFromSettings,
  proposeEnhancement,
  removeDuplicates,
  restoreGroup,
  restoreSessionGroups,
  setData,
  setSettings,
  sourceLabel,
  tabCount,
  tabsForSuggest,
  updateSession,
  type Session,
} from '@/lib/chrome-ext'

type UsageRow = {
  tabId: number
  title: string
  url: string
  bytes: number | null
  cpu: number | null
  idleMs: number | null
  discarded: boolean
  active: boolean
  audible: boolean
  pinned: boolean
  sharedProcess: boolean
  suggestDiscard: boolean
}

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
      preview: { groups: Array<{ name: string; action?: string; tabs: Array<{ title: string }> }> } | null
      plan?: {
        absorb: Array<{ groupId: number; name: string; tabIds: number[] }>
        create: Array<{ name: string; tabIds: number[] }>
        merge: Array<{ keepGroupId: number; name: string; tabIds: number[] }>
      } | null
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
      openGroups: Array<{
        key: string
        keep: { title: string; active?: boolean }
        items: Array<{ title: string }>
      }>
      stashGroups: Array<{
        key: string
        keep: { title: string; sessionName: string }
        items: Array<{ title: string; sessionName: string }>
      }>
    }
  | {
      kind: 'usage'
      loading: boolean
      source: string
      error?: string
      rows: UsageRow[]
      suggestedIds: number[]
      selected: Set<number>
    }

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const hit = highlightMatch(text, query)
  if (!hit) return text
  return (
    <>
      {hit.before}
      <mark className="rounded-[2px] bg-black/10 text-inherit">{hit.match}</mark>
      {hit.after}
    </>
  )
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

function GroupPreviewList({ groups }: { groups: Array<{ name: string; action?: string; tabs: Array<{ title: string }> }> }) {
  let row = 0
  const actionText = (action?: string) =>
    action === 'absorb' ? '并入已有'
    : action === 'merge' ? '合并同名'
    : action === 'create' ? '新建'
    : ''
  return (
    <div className="mt-2 flex flex-col divide-y divide-border/70 border-y border-border/70">
      {groups.map((g) => (
        <div key={`${g.action || 'g'}-${g.name}`} className="py-2.5">
          <h3
            className="anim-row m-0 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            style={{ '--row-delay': `${Math.min(row++, 16) * 16}ms` } as React.CSSProperties}
          >
            {actionText(g.action) ? `${actionText(g.action)} · ${g.name}` : g.name} · {g.tabs.length}
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

type SessionActions = {
  restoreSession: (sessionId: string, andDelete: boolean) => void
  openSuggest: (sessionId: string) => void
  renameSession: (sessionId: string) => void
  confirmDeleteSession: (sessionId: string) => void
  restoreOneGroup: (sessionId: string, groupId: string) => void
  openOneTab: (sessionId: string, groupId: string, tabId: string) => void
  deleteOneTab: (sessionId: string, groupId: string, tabId: string) => void
  moveTabReadLater: (sessionId: string, tabId: string, toReadLater: boolean) => void
  dissolveOneGroup: (sessionId: string, groupId: string, groupName: string, tabCount: number) => void
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
            const readLater = isReadLaterName(g.name)
            const ungrouped = isUngroupedName(g.name)
            const canDissolve = !ungrouped && !readLater
            return (
              <div key={g.id} className="mt-2">
                <div className="group/g flex items-center gap-2 py-0.5">
                  <button
                    type="button"
                    aria-expanded={!collapsed}
                    className={cn(
                      'cursor-pointer rounded-sm text-[11px] font-medium tracking-[0.04em] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35',
                      readLater
                        ? 'normal-case text-foreground/80'
                        : 'uppercase tracking-[0.08em] text-muted-foreground',
                    )}
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
                    {readLater && (
                      <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground/70">
                        （建议分组不改动）
                      </span>
                    )}
                  </button>
                  <span aria-hidden className="h-px flex-1 bg-border/60" />
                  {canDissolve && (
                    <TextAction
                      className="text-xs opacity-55 transition-opacity group-hover/g:opacity-100 focus-visible:opacity-100"
                      onClick={() =>
                        void a.current.dissolveOneGroup(session.id, g.id, g.name, g.tabs.length)
                      }
                    >
                      解散
                    </TextAction>
                  )}
                  <TextAction
                    className="text-xs opacity-55 transition-opacity group-hover/g:opacity-100 focus-visible:opacity-100"
                    onClick={() => void a.current.restoreOneGroup(session.id, g.id)}
                  >
                    恢复此分组
                  </TextAction>
                </div>
                <HeightCollapse open={!collapsed}>
                  <div className="mt-0.5 max-h-[min(52vh,420px)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
                    {!g.tabs.length && readLater && (
                      <p className="px-1 py-1.5 text-[12px] text-muted-foreground/70">
                        把想留着慢慢看的标签移到这里；整理时不会被重新分组。
                      </p>
                    )}
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
                          <TextAction
                            className="text-xs"
                            onClick={() => void a.current.moveTabReadLater(session.id, t.id, !readLater)}
                          >
                            {readLater ? '移出' : '稍后阅读'}
                          </TextAction>
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
  const [showClassify, setShowClassify] = useState(false)
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
    moveTabReadLater: () => {},
    dissolveOneGroup: () => {},
  })

  const deferredQuery = useDeferredValue(query)
  const searching = !!deferredQuery.trim()
  const { tabHits, sessionOnly } = useMemo(
    () => collectSearchHits(sessions, deferredQuery),
    [sessions, deferredQuery],
  )
  const groupedHits = useMemo(() => {
    const map = new Map<string, { sessionId: string; sessionName: string; hits: TabHit[] }>()
    for (const hit of tabHits) {
      let g = map.get(hit.sessionId)
      if (!g) {
        g = { sessionId: hit.sessionId, sessionName: hit.sessionName, hits: [] }
        map.set(hit.sessionId, g)
      }
      g.hits.push(hit)
    }
    return [...map.values()]
  }, [tabHits])
  const filteredSessions = useMemo(() => {
    if (searching) return sessionOnly
    return sessions
  }, [searching, sessionOnly, sessions])

  const reload = useCallback(async () => {
    const data = await getData()
    let dirty = false
    for (const s of data.sessions) {
      const hadReadLater = s.groups.some((g) => isReadLaterName(g.name))
      const hadUngrouped = s.groups.some((g) => isUngroupedName(g.name))
      ensureFixedGroups(s, { newId })
      if (!hadReadLater || !hadUngrouped) dirty = true
    }
    if (dirty) await setData(data)
    setSessions(data.sessions)
  }, [])

  const closeModal = useCallback(() => setModal({ kind: 'none' }), [])
  const onToggleSession = useCallback((id: string) => {
    setExpanded((prev) => (prev === id ? null : id))
  }, [])

  async function persistSettings(
    patch: Partial<ClassifySettings> & {
      localModel?: Partial<ClassifySettings['localModel']>
      remoteModel?: Partial<ClassifySettings['remoteModel']>
    },
  ) {
    const next = await setSettings(patch)
    setSettingsState(next as ClassifySettings)
    return next as ClassifySettings
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
        if (
          hash === '#merge' ||
          hash === '#organize' ||
          hash === '#dedup' ||
          hash === '#usage' ||
          hash.startsWith('#review=')
        ) {
          history.replaceState(null, '', location.pathname + location.search)
          if (hash === '#merge') await openMerge()
          else if (hash === '#organize') await openLive()
          else if (hash === '#dedup') await openDedup()
          else if (hash === '#usage') await openUsage()
          else {
            const id = decodeURIComponent(hash.slice('#review='.length))
            if (id) {
              setExpanded(id)
              await openStashReview(id)
            }
          }
        }
      } catch {
        setSettingsState({
          classifyMode: 'site',
          groupQuality: 'fast',
          browserModelId: 'Xenova/all-MiniLM-L6-v2',
          preferWebGPU: true,
          localModel: { model: 'qwen2.5:0.5b' },
          remoteModel: {
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            model: 'gpt-4o-mini',
          },
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

  async function onStash(keepActive = true) {
    if (stashBusy) return
    setStashBusy(true)
    let sessionId: string | null = null
    try {
      const r = await chrome.runtime.sendMessage({
        type: 'STASH_CURRENT_WINDOW',
        keepActive,
      })
      if (!r.ok) {
        toast(stashFailText(r))
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
      ensureFixedGroups(session, { newId })
      const { preview, source, name } = await proposeEnhancement(tabsForSuggest(session), {
        ...classifyOptsFromSettings(s),
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
    const [openGroups, data] = await Promise.all([findOpenTabDuplicates(), getData()])
    const stashGroups = findDuplicates(data) as Array<{
      key: string
      keep: { title: string; sessionName: string }
      items: Array<{ title: string; sessionName: string }>
    }>
    setModal({
      kind: 'dedup',
      openGroups: openGroups as Array<{
        key: string
        keep: { title: string; active?: boolean }
        items: Array<{ title: string }>
      }>,
      stashGroups,
      removing: false,
    })
  }

  function usageFromResult(r: {
    source: string
    error?: string
    rows?: UsageRow[]
    suggestedIds?: number[]
  }): Extract<ModalState, { kind: 'usage' }> {
    const suggestedIds = r.suggestedIds || []
    return {
      kind: 'usage',
      loading: false,
      source: r.source,
      error: r.error,
      rows: (r.rows || []) as UsageRow[],
      suggestedIds,
      selected: new Set(suggestedIds),
    }
  }

  async function openUsage() {
    setModal({
      kind: 'usage',
      loading: true,
      source: '',
      rows: [],
      suggestedIds: [],
      selected: new Set(),
    })
    const preferProcesses = await ensureProcessesPermission()
    try {
      setModal(usageFromResult(await collectTabUsage({ preferProcesses })))
    } catch (e) {
      setModal({
        kind: 'usage',
        loading: false,
        source: 'idle',
        error: String((e as Error)?.message || e),
        rows: [],
        suggestedIds: [],
        selected: new Set(),
      })
    }
  }

  async function refreshUsage() {
    setModal((prev) => (prev.kind === 'usage' ? { ...prev, loading: true } : prev))
    try {
      const r = await collectTabUsage({ preferProcesses: processesApiAvailable() })
      setModal((prev) => (prev.kind === 'usage' ? usageFromResult(r) : prev))
    } catch (e) {
      setModal((prev) =>
        prev.kind === 'usage'
          ? {
              kind: 'usage',
              loading: false,
              source: 'idle',
              error: String((e as Error)?.message || e),
              rows: [],
              suggestedIds: [],
              selected: new Set(),
            }
          : prev,
      )
    }
  }

  function toggleUsageSelect(tabId: number) {
    setModal((prev) => {
      if (prev.kind !== 'usage') return prev
      const row = prev.rows.find((r) => r.tabId === tabId)
      if (!row || !isActionableUsageRow(row)) return prev
      const next = new Set(prev.selected)
      if (next.has(tabId)) next.delete(tabId)
      else next.add(tabId)
      return { ...prev, selected: next }
    })
  }

  function actionableSelectedIds() {
    if (modal.kind !== 'usage') return [] as number[]
    const byId = new Map(modal.rows.map((r) => [r.tabId, r]))
    return [...modal.selected].filter((id) => isActionableUsageRow(byId.get(id)))
  }

  async function discardSelectedUsage() {
    if (modal.kind !== 'usage') return
    const ids = actionableSelectedIds()
    if (!ids.length) {
      toast('没有可休眠的选中标签（已排除钉住/有声/当前）')
      return
    }
    const n = await discardTabsByIds(ids)
    toast(n ? `已休眠 ${n} 个标签` : '休眠失败')
    await refreshUsage()
  }

  async function discardSuggestedUsage() {
    if (modal.kind !== 'usage' || !modal.suggestedIds.length) return
    const byId = new Map(modal.rows.map((r) => [r.tabId, r]))
    const ids = modal.suggestedIds.filter((id) => isActionableUsageRow(byId.get(id)))
    if (!ids.length) {
      toast('没有可休眠的建议标签')
      return
    }
    const n = await discardTabsByIds(ids)
    toast(n ? `已休眠 ${n} 个闲置标签` : '休眠失败')
    await refreshUsage()
  }

  async function closeSelectedUsage() {
    if (modal.kind !== 'usage') return
    const ids = actionableSelectedIds()
    if (!ids.length) {
      toast('没有可关闭的选中标签（已排除钉住/有声/当前）')
      return
    }
    if (!confirm(`关闭选中的 ${ids.length} 个标签？`)) return
    const n = await closeTabsByIds(ids)
    toast(n ? `已关闭 ${n} 个标签` : '关闭失败')
    await refreshUsage()
  }

  async function applyDedup() {
    if (modal.kind !== 'dedup') return
    setModal({ ...modal, removing: true })
    const openGroups = await findOpenTabDuplicates()
    const closed = await closeOpenTabDuplicates(openGroups)
    const data = await getData()
    const stashGroups = findDuplicates(data)
    const removed = removeDuplicates(data, stashGroups)
    if (removed) await setData(data)
    setModal({ kind: 'none' })
    await reload()
    if (!closed && !removed) toast('没有重复可合并')
    else {
      const parts = []
      if (closed) parts.push(`关闭 ${closed} 个打开的重复标签`)
      if (removed) parts.push(`删除 ${removed} 条已收纳重复`)
      toast(`已合并：${parts.join('，')}`)
    }
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
    if (!session) return
    const group = session.groups.find((g) => g.id === groupId)
    if (!group) return
    group.tabs = group.tabs.filter((t) => t.id !== tabId)
    session.groups = session.groups.filter(
      (g) => g.tabs.length > 0 || isReadLaterName(g.name) || isUngroupedName(g.name),
    )
    ensureFixedGroups(session, { newId })
    await setData(data)
    await reload()
    toast('已删除标签')
  }

  async function moveTabReadLater(sessionId: string, tabId: string, toReadLater: boolean) {
    const r = await moveTabToGroup(sessionId, tabId, toReadLater ? 'readLater' : 'ungrouped')
    if (!r.ok) {
      toast('移动失败')
      return
    }
    await reload()
    toast(toReadLater ? '已移入稍后阅读' : '已移出稍后阅读')
  }

  async function dissolveOneGroup(
    sessionId: string,
    groupId: string,
    groupName: string,
    n: number,
  ) {
    if (!confirm(dissolvePrompt(groupName, n))) return
    const r = await dissolveGroup(sessionId, groupId)
    if (!r.ok) {
      toast(dissolveFailText(r.reason))
      return
    }
    await reload()
    toast(dissolveOkText(r))
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
    if (!session) return
    ensureFixedGroups(session, { newId })
    const items = tabsForSuggest(session)
    setModal((prev) =>
      prev.kind === 'suggest'
        ? { ...prev, status: '生成预览', busy: true, preview: null, picker }
        : prev,
    )
    const { preview, source, error, name } = await proposeEnhancement(items, {
      ...classifyOptsFromSettings(picker),
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
        ? { ...prev, busy: true, status: '生成预览', preview: null, plan: null, picker }
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
                r.reason === 'too_few' ? '可整理的标签太少'
                : r.reason === 'no_groups' ? '没有可成组的建议'
                : '无法整理',
              preview: null,
              plan: null,
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
              : `来源：${sourceLabel(r.source)} · 跨站主题优先，其余同站并入已有组`,
            preview: r.preview,
            plan: r.plan,
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
    moveTabReadLater: (sessionId, tabId, toReadLater) => {
      void moveTabReadLater(sessionId, tabId, toReadLater)
    },
    dissolveOneGroup: (sessionId, groupId, groupName, n) => {
      void dissolveOneGroup(sessionId, groupId, groupName, n)
    },
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
    : modal.kind === 'dedup' ? '合并重复网页'
    : modal.kind === 'usage' ? '闲置休眠'
    : undefined

  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <JetBrainsAmbient variant="page" className="fixed inset-0 z-0" />
      <header className="sticky top-0 z-20 flex flex-col gap-2 border-b border-border/80 bg-white/60 px-4 py-2.5 backdrop-blur-[24px] backdrop-saturate-150">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="m-0 text-lg font-semibold tracking-tight">标签管理</h1>
          {sessions.length > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {searching
                ? `${tabHits.length} 个标签${sessionOnly.length ? ` · ${sessionOnly.length} 个会话` : ''}`
                : `${sessions.length} 个会话`}
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <GlassButton
              disabled={stashBusy}
              title="收纳当前窗口里除当前页以外的标签"
              onClick={() => void onStash(true)}
            >
              {stashBusy ? '收纳中…' : '收纳其他标签'}
            </GlassButton>
            <button
              type="button"
              disabled={stashBusy}
              className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline disabled:opacity-35"
              onClick={() => void onStash(false)}
            >
              连当前页
            </button>
            <GlassButton
              variant="outline"
              disabled={stashBusy}
              title="预览后应用；已成组标签也可以重分"
              onClick={() => void openLive()}
            >
              整理当前窗口
            </GlassButton>
            <GlassButton
              variant="secondary"
              disabled={stashBusy}
              title="把其他窗口的标签并进本窗再重建标签组"
              onClick={() => void openMerge()}
            >
              合并并整理全部窗口
            </GlassButton>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sessions.length > 0 && (
            <>
              <label className="sr-only" htmlFor="session-search">
                搜索会话与标签
              </label>
              <input
                ref={searchRef}
                id="session-search"
                type="search"
                value={query}
                placeholder="搜索标题或网址…（/）"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-lg border border-transparent bg-black/[0.04] px-3 py-1.5 text-sm text-foreground outline-none transition-[background,box-shadow,border-color] placeholder:text-muted-foreground/65 hover:bg-black/[0.055] focus-visible:border-ring/30 focus-visible:bg-white/90 focus-visible:ring-3 focus-visible:ring-ring/25"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query) {
                    e.preventDefault()
                    setQuery('')
                    return
                  }
                  if (e.key === 'Enter') {
                    const first = collectSearchHits(sessions, query).tabHits[0]
                    if (!first) return
                    e.preventDefault()
                    void openOneTab(first.sessionId, first.groupId, first.tab.id)
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
            </>
          )}
          <Button
            variant={showClassify ? 'secondary' : 'ghost'}
            size="sm"
            aria-expanded={showClassify}
            onClick={() => setShowClassify((v) => !v)}
          >
            分类设置
          </Button>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={settings.stashReview !== false}
              onChange={(e) => { void persistSettings({ stashReview: e.target.checked }) }}
            />
            收纳后询问
          </label>
          <Button variant="ghost" size="sm" title="打开的标签（全部窗口）与已收纳会话" onClick={() => void openDedup()}>合并重复</Button>
          <Button variant="ghost" size="sm" onClick={() => void openUsage()}>闲置休眠</Button>
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
        {showClassify && (
          <div className="border-t border-border/50 pt-2">
            <ClassifyPicker
              value={settings}
              onChange={(patch) => { void persistSettings(patch) }}
            />
          </div>
        )}
      </header>

      <main className="relative z-10 mx-auto flex max-w-[880px] flex-col px-4 py-4 pb-16">
        {!sessions.length && (
          <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border/90 bg-white/40 px-6 py-20 text-center backdrop-blur-[8px]">
            <div className="flex flex-col gap-1.5">
              <p className="m-0 text-[15px] font-medium tracking-tight text-foreground/90">还没有会话</p>
              <p className="m-0 text-sm text-muted-foreground">收纳其他标签，当前页会留下</p>
            </div>
            <div className="flex flex-col items-center gap-2">
              <GlassButton disabled={stashBusy} onClick={() => void onStash(true)}>
                {stashBusy ? '收纳中…' : '收纳其他标签'}
              </GlassButton>
              <button
                type="button"
                disabled={stashBusy}
                className="cursor-pointer text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-35"
                onClick={() => void onStash(false)}
              >
                连当前页一起收纳
              </button>
            </div>
          </div>
        )}

        {sessions.length > 0 && searching && !tabHits.length && !sessionOnly.length && (
          <div className="mt-2 rounded-xl border border-border/70 bg-white/50 px-4 py-14 text-center" role="status">
            <p className="m-0 text-sm text-muted-foreground">
              没有匹配「{query.trim()}」的标签
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

        {searching && groupedHits.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border/90 bg-white/92 shadow-[0_1px_2px_rgba(0,0,0,0.035)]">
            <div className="divide-y divide-border/70">
              {groupedHits.map((block) => (
                <section key={block.sessionId} className="px-3.5 py-2.5">
                  <div className="mb-1 flex items-center gap-2">
                    <h2 className="m-0 min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight">
                      {block.sessionName}
                    </h2>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {block.hits.length}
                    </span>
                    <TextAction
                      className="text-xs"
                      onClick={() => void actionsRef.current.restoreSession(block.sessionId, false)}
                    >
                      全部恢复
                    </TextAction>
                  </div>
                  <div className="flex flex-col">
                    {block.hits.slice(0, 40).map((hit) => (
                      <div
                        key={`${hit.sessionId}:${hit.tab.id}`}
                        className="group/row -mx-1 flex items-center gap-2 rounded-md px-1 py-[4px] hover:bg-black/[0.035]"
                      >
                        <Favicon url={hit.tab.url} favIconUrl={hit.tab.favIconUrl} />
                        <button
                          type="button"
                          className="min-w-0 flex-1 cursor-pointer truncate text-left text-[13px] leading-[18px] text-foreground/85 hover:text-foreground"
                          title={hit.tab.url}
                          onClick={() => void openOneTab(hit.sessionId, hit.groupId, hit.tab.id)}
                        >
                          <HighlightText text={hit.tab.title} query={deferredQuery} />
                        </button>
                        <span className="hidden max-w-[120px] shrink-0 truncate text-[11px] text-muted-foreground/55 sm:block">
                          {hit.groupName}
                        </span>
                        <TextAction
                          className="text-xs opacity-60 group-hover/row:opacity-100"
                          onClick={() => void openOneTab(hit.sessionId, hit.groupId, hit.tab.id)}
                        >
                          打开
                        </TextAction>
                      </div>
                    ))}
                    {block.hits.length > 40 && (
                      <p className="m-0 px-1 py-1 text-[11px] text-muted-foreground">
                        仅显示前 40 条
                      </p>
                    )}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}

        {filteredSessions.length > 0 && (
          <div className={searching && groupedHits.length > 0 ? 'mt-3 overflow-hidden rounded-xl border border-border/90 bg-white/92 shadow-[0_1px_2px_rgba(0,0,0,0.035)]' : 'overflow-hidden rounded-xl border border-border/90 bg-white/92 shadow-[0_1px_2px_rgba(0,0,0,0.035)]'}>
            {searching && groupedHits.length > 0 && sessionOnly.length > 0 && (
              <p className="m-0 border-b border-border/70 px-3.5 py-2 text-[11px] text-muted-foreground">
                会话名匹配
              </p>
            )}
            <div className="divide-y divide-border/70">
              {filteredSessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  open={searching || expanded === session.id}
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
        dismissible={
          !(
            modal.kind === 'busy' ||
            (modal.kind === 'merge' && modal.busy) ||
            (modal.kind === 'dedup' && modal.removing) ||
            (modal.kind === 'usage' && modal.loading)
          )
        }
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
                const next = mergeClassifySettings(modal.picker, patch)
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
            <p className="mt-1 text-xs text-muted-foreground">
              跨站同一主题会先成组。已在标签组里的也可以抽走重分。X 能确定作者或主题时用 X|alice、X|React。其余同站并入已有组（单条也并入），同站多组合并；忙的 GitHub 会按所有者拆开。应用后折叠非当前组。
            </p>
            <ClassifyPicker
              className="mt-2.5"
              value={modal.picker}
              onChange={(patch) => {
                const next = mergeClassifySettings(modal.picker, patch)
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
                disabled={!modal.plan || modal.windowId == null || modal.busy}
                onClick={() => {
                  if (!modal.plan || modal.windowId == null) return
                  const source = modal.source
                  const plan = modal.plan
                  void (async () => {
                    await setSettings(modal.picker)
                    setModal((prev) => (prev.kind === 'live' ? { ...prev, busy: true, status: '正在整理标签组' } : prev))
                    try {
                      const applied = await applyLivePlan(modal.windowId!, plan, (m: string) =>
                        setModal((prev) => (prev.kind === 'live' ? { ...prev, status: m } : prev)),
                      )
                      setModal({ kind: 'none' })
                      if (!applied?.ok) {
                        if (applied?.reason === 'partial') {
                          toast(
                            `部分完成：并入 ${applied.absorbTabs || 0} · 新建 ${applied.created || 0} · 失败 ${applied.failed?.length || 0}`,
                          )
                        } else {
                          const detail = applied?.failed?.[0]?.error
                          toast(detail ? `分组失败：${detail}` : '分组失败，已有标签组未改')
                        }
                        return
                      }
                      toast(organizeOkText({ apply: applied, source }))
                    } catch (e) {
                      setModal((prev) =>
                        prev.kind === 'live'
                          ? { ...prev, busy: false, status: String((e as Error)?.message || e) }
                          : prev,
                      )
                      toast(`整理未完成：${String((e as Error)?.message || e)}`)
                    }
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
                    ? { ...prev, picker: mergeClassifySettings(prev.picker, patch) }
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
                        else if (r.reason === 'partial') {
                          toast(
                            `已拆组但未完成：成功 ${r.apply?.created || 0} 组，失败 ${r.apply?.failed?.length || 0} 组`,
                          )
                        } else if (r.reason === 'all_failed' || r.reason === 'apply_failed') {
                          toast('分组失败，旧组已尽量保留')
                        } else toast('整理失败')
                        setModal({ kind: 'none' })
                        return
                      }
                      setModal({ kind: 'none' })
                      toast(`已合并并整理（${sourceLabel(r.source)}）`)
                    } catch (e) {
                      toast(`已拆组但未完成：${String((e as Error)?.message || e)}`)
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
            <h2 className="m-0 text-[17px] font-semibold tracking-tight">合并重复网页</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              打开的标签扫全部窗口；已收纳会话另计。忽略尾斜杠 / www；保留 hash、query 与端口。打开的优先留当前页；收纳同会话优先留主题组。
            </p>
            {!modal.openGroups.length && !modal.stashGroups.length && (
              <p className="mt-3 text-sm text-muted-foreground">没有发现重复网页。</p>
            )}
            <div className="mt-2 flex max-h-[46vh] flex-col gap-3 overflow-auto">
              {modal.openGroups.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                    全部窗口中打开的标签 · {modal.openGroups.reduce((n, g) => n + g.items.length, 0)} 个可关
                  </div>
                  <div className="flex flex-col divide-y divide-border/70 border-y border-border/70">
                    {modal.openGroups.map((g) => (
                      <div key={`o-${g.key}`} className="py-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-[13px] font-medium">{g.keep.title}</span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            ×{g.items.length + 1}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          保留打开中的一份{g.keep.active ? '（当前标签）' : ''} · 关闭 {g.items.length} 个
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {modal.stashGroups.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                    已收纳 · {modal.stashGroups.reduce((n, g) => n + g.items.length, 0)} 条可删
                  </div>
                  <div className="flex flex-col divide-y divide-border/70 border-y border-border/70">
                    {modal.stashGroups.map((g) => (
                      <div key={`s-${g.key}`} className="py-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-[13px] font-medium">{g.keep.title}</span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            ×{g.items.length + 1}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          保留于「{g.keep.sessionName}」 · 删除 {g.items.length} 份
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={modal.removing} onClick={() => setModal({ kind: 'none' })}>取消</Button>
              <Button
                disabled={
                  modal.removing || (!modal.openGroups.length && !modal.stashGroups.length)
                }
                onClick={() => void applyDedup()}
              >
                {modal.removing
                  ? '合并中…'
                  : `合并（关 ${modal.openGroups.reduce((n, g) => n + g.items.length, 0)} / 删 ${modal.stashGroups.reduce((n, g) => n + g.items.length, 0)}）`}
              </Button>
            </div>
          </>
        )}
        {modal.kind === 'usage' && (
          <>
            <p className="text-sm text-muted-foreground">
              按最近访问排序。默认勾选闲置 ≥{defaultIdleMinutes()}{' '}
              分钟、非当前/非钉住/无声音的标签；休眠后点开即恢复。
              {modal.source.includes('processes') ? '（Dev 另附进程内存参考）' : ''}
              {modal.error ? ` ${modal.error}` : ''}
            </p>
            {modal.loading ? (
              <p className="mt-3 text-sm text-muted-foreground">加载中…</p>
            ) : (
              <div className="mt-3 max-h-[min(52vh,420px)] overflow-y-auto">
                {!modal.rows.length ? (
                  <p className="text-sm text-muted-foreground">没有可列出的标签。</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border/70 border-y border-border/70">
                    {modal.rows.map((row) => (
                      <li key={row.tabId} className="flex items-start gap-2 py-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={modal.selected.has(row.tabId)}
                          disabled={!isActionableUsageRow(row)}
                          onChange={() => toggleUsageSelect(row.tabId)}
                          aria-label={`选择 ${row.title}`}
                        />
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => {
                            setModal((prev) => {
                              if (prev.kind !== 'usage') return prev
                              const next = new Set(prev.selected)
                              next.delete(row.tabId)
                              return { ...prev, selected: next }
                            })
                            void chrome.tabs.update(row.tabId, { active: true }).then((tab) => {
                              if (tab?.windowId != null) {
                                void chrome.windows.update(tab.windowId, { focused: true })
                              }
                            })
                          }}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0 truncate text-[13px] font-medium">
                              {row.title || '（无标题）'}
                              {row.suggestDiscard ? ' · 建议休眠' : ''}
                              {row.active ? ' · 当前' : ''}
                              {row.discarded ? ' · 已休眠' : ''}
                              {row.audible ? ' · 有声音' : ''}
                              {row.pinned ? ' · 钉住' : ''}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {formatIdle(row.idleMs)}
                              {row.bytes != null ? ` · ${formatBytes(row.bytes)}` : ''}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            {row.url}
                            {row.sharedProcess ? ' · 共享进程' : ''}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={modal.loading} onClick={() => void refreshUsage()}>
                刷新
              </Button>
              <Button
                disabled={modal.loading || !modal.suggestedIds.length}
                onClick={() => void discardSuggestedUsage()}
              >
                休眠建议（{modal.suggestedIds.length}）
              </Button>
              <Button
                variant="outline"
                disabled={modal.loading || !modal.selected.size}
                onClick={() => void discardSelectedUsage()}
              >
                休眠选中
              </Button>
              <Button
                variant="outline"
                disabled={modal.loading || !modal.selected.size}
                onClick={() => void closeSelectedUsage()}
              >
                关闭选中
              </Button>
              <Button variant="outline" disabled={modal.loading} onClick={() => setModal({ kind: 'none' })}>
                关闭
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
