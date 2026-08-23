/**
 * 侧栏「建议关闭」详细视图。
 * 启发式（已收纳 / 重复打开 / 已休眠 / 闲置）。不走分类模型。
 * 按窗口分组，理由筛选，可附内存占用，勾选后批量关闭。
 * 钉住 / 有声 / 各窗口当前页不参与（collectClosableTabs 已排除）。
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Favicon, domainOf } from '@/components/Favicon'
import { JetBrainsAmbient } from '@/components/JetBrainsAmbient'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  closeTabsByIds,
  collectClosableTabs,
  collectTabUsage,
  ensureProcessesPermission,
  formatBytes,
  formatIdle,
  processesApiAvailable,
} from '@/lib/chrome-ext'

type CloseRow = {
  tabId: number
  windowId: number
  title: string
  url: string
  favIconUrl?: string
  idleMs: number | null
  discarded: boolean
  reasons: string[]
  bytes?: number | null
}

const FILTERS = [
  { key: 'stashed', label: '已收纳', match: (r: CloseRow) => r.reasons.includes('已收纳') },
  { key: 'dupe', label: '重复打开', match: (r: CloseRow) => r.reasons.includes('重复打开') },
  {
    key: 'idle',
    label: '闲置休眠',
    match: (r: CloseRow) => r.reasons.includes('已休眠') || r.reasons.some((x) => x.startsWith('闲置')),
  },
] as const

function isSuggested(r: CloseRow) {
  return r.reasons.length > 0
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded bg-black/[0.05] px-1 py-px text-[10.5px] leading-4 text-muted-foreground">
      {children}
    </span>
  )
}

/** 切换到该标签（行右侧，悬停/聚焦时显示） */
function IconGoToTab({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn('size-3.5', className)} aria-hidden>
      <path
        d="M2.5 8h10M9 4.5 12.5 8 9 11.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SidePanelApp() {
  const [rows, setRows] = useState<CloseRow[]>([])
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(false)
  const [msg, setMsg] = useState('')
  const [onlySuggested, setOnlySuggested] = useState(true)
  const [filters, setFilters] = useState<Set<string>>(new Set())
  const [windowLabels, setWindowLabels] = useState<Map<number, string>>(new Map())
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null)
  const [memAttached, setMemAttached] = useState(false)
  const [memBusy, setMemBusy] = useState(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const load = useCallback(async () => {
    setLoading(true)
    setMsg('')
    setMemAttached(false)
    try {
      const [{ rows: collected }, actives, win] = await Promise.all([
        collectClosableTabs(),
        chrome.tabs.query({ active: true }),
        chrome.windows.getCurrent(),
      ])
      const labels = new Map<number, string>()
      for (const t of actives) {
        if (typeof t.windowId === 'number') labels.set(t.windowId, t.title || t.url || '窗口')
      }
      setWindowLabels(labels)
      setCurrentWindowId(typeof win.id === 'number' ? win.id : null)
      setRows(collected as CloseRow[])
      setChecked(new Set((collected as CloseRow[]).filter(isSuggested).map((r) => r.tabId)))
      setLoading(false)
    } catch {
      setMsg('分析失败，请重试')
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** 别处关掉标签时同步移除 */
  useEffect(() => {
    const api = globalThis.chrome?.tabs?.onRemoved
    if (!api) return
    const onRemoved = (tabId: number) => {
      setRows((prev) => prev.filter((r) => r.tabId !== tabId))
      setChecked((prev) => {
        if (!prev.has(tabId)) return prev
        const next = new Set(prev)
        next.delete(tabId)
        return next
      })
    }
    api.addListener(onRemoved)
    return () => api.removeListener(onRemoved)
  }, [])

  async function attachMemory() {
    setMemBusy(true)
    try {
      const ok = await ensureProcessesPermission()
      if (!ok) {
        setMsg('当前浏览器不支持进程内存')
        return
      }
      const r = await collectTabUsage({ preferProcesses: true })
      const byId = new Map<number, number | null>(
        (r.rows || []).map((x: { tabId: number; bytes: number | null }) => [x.tabId, x.bytes]),
      )
      setRows((prev) => prev.map((row) => ({ ...row, bytes: byId.get(row.tabId) ?? null })))
      setMemAttached(true)
    } catch {
      setMsg('获取内存占用失败')
    } finally {
      setMemBusy(false)
    }
  }

  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return rows.filter((r) => {
      if (onlySuggested && !isSuggested(r)) return false
      if (filters.size && !FILTERS.some((f) => filters.has(f.key) && f.match(r))) return false
      if (!q) return true
      return (
        r.title.toLowerCase().includes(q) ||
        r.url.toLowerCase().includes(q) ||
        domainOf(r.url).includes(q)
      )
    })
  }, [rows, onlySuggested, filters, deferredQuery])

  const groups = useMemo(() => {
    const byWin = new Map<number, CloseRow[]>()
    for (const r of visible) {
      const arr = byWin.get(r.windowId) || []
      arr.push(r)
      byWin.set(r.windowId, arr)
    }
    return [...byWin.entries()].sort(([a], [b]) => {
      if (a === currentWindowId) return -1
      if (b === currentWindowId) return 1
      return a - b
    })
  }, [visible, currentWindowId])

  const suggestedCount = useMemo(() => rows.filter(isSuggested).length, [rows])

  function toggleOne(tabId: number) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(tabId)) next.delete(tabId)
      else next.add(tabId)
      return next
    })
  }

  /** 跳到标签确认内容；不改变勾选。标签已消失则从列表移除 */
  async function activateTab(row: CloseRow) {
    try {
      await chrome.tabs.update(row.tabId, { active: true })
      await chrome.windows.update(row.windowId, { focused: true })
    } catch {
      setMsg('标签已不存在，已从列表移除')
      setRows((prev) => prev.filter((r) => r.tabId !== row.tabId))
      setChecked((prev) => {
        if (!prev.has(row.tabId)) return prev
        const next = new Set(prev)
        next.delete(row.tabId)
        return next
      })
    }
  }

  function setGroupChecked(ids: number[], on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  function toggleFilter(key: string) {
    setFilters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function applyClose() {
    const ids = [...checked]
    if (!ids.length) {
      setMsg('没有选中要关闭的标签')
      return
    }
    setClosing(true)
    try {
      const n = await closeTabsByIds(ids)
      setMsg(n ? `已关闭 ${n} 个标签` : '关闭失败')
      if (n) {
        const closed = new Set(ids)
        setRows((prev) => prev.filter((r) => !closed.has(r.tabId)))
        setChecked(new Set())
      }
    } catch {
      setMsg('关闭失败，请重试')
    } finally {
      setClosing(false)
    }
  }

  return (
    <div className="relative flex h-svh flex-col overflow-hidden">
      <JetBrainsAmbient variant="page" className="fixed inset-0 z-0" />

      <header className="relative z-10 flex flex-col gap-2 border-b border-border/80 bg-white/60 px-3.5 py-2.5 backdrop-blur-[24px] backdrop-saturate-150">
        <div className="flex items-center gap-2">
          <h1 className="m-0 flex-1 text-[15px] font-semibold tracking-tight">建议关闭</h1>
          <Button variant="ghost" size="sm" disabled={loading || closing} onClick={() => void load()}>
            刷新
          </Button>
        </div>
        <p className="m-0 text-[11.5px] leading-snug text-muted-foreground">
          来源：启发式（已收纳 / 重复 / 闲置）。钉住 / 有声 / 各窗口当前页不参与。
        </p>
        <div className="relative">
          <input
            type="search"
            value={query}
            placeholder="过滤标题或网址…"
            autoComplete="off"
            aria-label="过滤标签"
            className="w-full rounded-lg border border-transparent bg-black/[0.04] px-2.5 py-1.5 text-[12.5px] text-foreground outline-none transition-[background,box-shadow,border-color] placeholder:text-muted-foreground/65 hover:bg-black/[0.055] focus-visible:border-ring/30 focus-visible:bg-white/90 focus-visible:ring-3 focus-visible:ring-ring/25"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault()
                setQuery('')
              }
            }}
          />
          {query && (
            <button
              type="button"
              aria-label="清除搜索"
              className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-[11px] text-muted-foreground/70 transition-colors hover:bg-black/[0.06] hover:text-foreground"
              onClick={() => setQuery('')}
            >
              ×
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filters.has(f.key)}
              className={cn(
                'cursor-pointer rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                filters.has(f.key)
                  ? 'border-[#0a0a0a] bg-[#0a0a0a] text-white'
                  : 'border-black/10 bg-white/70 text-muted-foreground hover:text-foreground',
              )}
              onClick={() => toggleFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              className="size-3 accent-[#0a0a0a]"
              checked={onlySuggested}
              onChange={(e) => setOnlySuggested(e.target.checked)}
            />
            仅看建议
          </label>
          {!memAttached && processesApiAvailable() && (
            <button
              type="button"
              disabled={memBusy}
              className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground hover:underline disabled:opacity-40"
              onClick={() => void attachMemory()}
            >
              {memBusy ? '获取中…' : '附带内存占用'}
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 flex-1 overflow-y-auto overscroll-contain px-2 py-2 pb-20">
        {loading ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground" role="status">
            分析可关闭的标签…
          </p>
        ) : !rows.length ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground" role="status">
            没有可考虑关闭的标签
          </p>
        ) : !groups.length ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground" role="status">
            {query.trim() ? `没有匹配「${query.trim()}」的标签` : '当前筛选下没有标签'}
          </p>
        ) : (
          groups.map(([windowId, list]) => {
            const allOn = list.every((r) => checked.has(r.tabId))
            return (
              <section key={windowId} className="mb-3">
                <div className="sticky top-0 z-10 flex items-center gap-2 bg-white/85 px-2 py-1.5 backdrop-blur-[8px]">
                  <h2 className="m-0 min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    {windowId === currentWindowId ? '本窗口' : windowLabels.get(windowId) || `窗口 ${windowId}`}
                    <span className="ml-1.5 font-normal tabular-nums">{list.length}</span>
                  </h2>
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground hover:underline"
                    onClick={() =>
                      setGroupChecked(
                        list.map((r) => r.tabId),
                        !allOn,
                      )
                    }
                  >
                    {allOn ? '清空' : '全选'}
                  </button>
                </div>
                <div className="flex flex-col">
                  {list.map((r) => {
                    const on = checked.has(r.tabId)
                    return (
                      <label
                        key={r.tabId}
                        className="group/row flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-black/[0.035]"
                      >
                        <input
                          type="checkbox"
                          className="mt-[3px] size-3.5 shrink-0 cursor-pointer accent-[#0a0a0a]"
                          checked={on}
                          onChange={() => toggleOne(r.tabId)}
                        />
                        <Favicon url={r.url} favIconUrl={r.favIconUrl} className="mt-[1px]" />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block truncate text-[13px] leading-[18px] tracking-tight transition-colors',
                              on ? 'text-foreground' : 'text-muted-foreground',
                            )}
                            title={r.url}
                          >
                            {r.title}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-4 text-muted-foreground/75">
                            <span className="truncate">{domainOf(r.url)}</span>
                            {r.idleMs != null && <span className="shrink-0 tabular-nums">{formatIdle(r.idleMs)}</span>}
                            {memAttached && (
                              <span className="shrink-0 tabular-nums">{formatBytes(r.bytes ?? null)}</span>
                            )}
                            {r.reasons.map((why) => (
                              <Badge key={why}>{why}</Badge>
                            ))}
                          </span>
                        </span>
                        <button
                          type="button"
                          title="切换到该标签"
                          aria-label={`切换到 ${r.title}`}
                          className="mt-px grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground/60 opacity-0 transition-[opacity,background-color,color] duration-100 hover:bg-black/[0.06] hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            void activateTab(r)
                          }}
                        >
                          <IconGoToTab />
                        </button>
                      </label>
                    )
                  })}
                </div>
              </section>
            )
          })
        )}
      </main>

      <footer className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 border-t border-border/80 bg-white/85 px-3.5 py-2.5 backdrop-blur-[24px] backdrop-saturate-150">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground" role="status" aria-live="polite">
          {msg || `可考虑 ${rows.length} · 建议 ${suggestedCount} · 选中 ${checked.size}`}
        </span>
        <Button
          disabled={closing || loading || !checked.size}
          onClick={() => void applyClose()}
        >
          {closing ? '关闭中…' : `关闭 ${checked.size} 个`}
        </Button>
      </footer>
    </div>
  )
}
