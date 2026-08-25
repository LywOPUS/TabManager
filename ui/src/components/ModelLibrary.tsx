import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteBrowserModelCache,
  formatBytes,
  inspectBrowserModelCache,
  preloadBrowserModel,
  purgeLeftoverModelCache,
  unloadBrowserModel,
} from '@/lib/chrome-ext'
import { cn } from '@/lib/utils'

type ModelRow = {
  id: string
  label: string
  note: string
  bundled: boolean
  state: 'bundled' | 'ready' | 'partial' | 'leftover' | 'empty'
  bytes: number
  fileCount: number
  leftoverBytes: number
  missingGraph?: boolean
  hint: string
}

type Orphan = { url: string; name: string; bytes: number }

type Inventory = {
  models: ModelRow[]
  orphans: Orphan[]
  leftoverBytes: number
  leftoverCount: number
  orphanBytes: number
  totalBytes: number
}

type StatusDetail = {
  phase?: string
  pct?: number
}

type Props = {
  currentModelId: string
  preferWebGPU: boolean
  onUse: (modelId: string) => void
}

function parseProgress(msg: string, detail?: StatusDetail) {
  if (msg.startsWith('下载失败')) return { kind: 'error' as const, text: msg, pct: 0 }
  if (detail?.phase === 'loading' || msg.startsWith('文件已齐') || msg.startsWith('加载') || msg.startsWith('编码') || msg.includes('改用')) {
    return { kind: 'loading' as const, text: msg, pct: detail?.pct ?? 70 }
  }
  if (detail?.phase === 'download' || msg.startsWith('下载')) {
    return { kind: 'downloading' as const, text: msg, pct: detail?.pct ?? 4 }
  }
  return { kind: 'checking' as const, text: msg, pct: detail?.pct ?? 8 }
}

export function ModelLibrary({ currentModelId, preferWebGPU, onUse }: Props) {
  const [inv, setInv] = useState<Inventory | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [status, setStatus] = useState<{ kind: string; text: string; pct: number } | null>(null)
  const seqRef = useRef(0)

  const refresh = useCallback(() => {
    void inspectBrowserModelCache()
      .then((next: unknown) => setInv(next as Inventory))
      .catch(() => setInv(null))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  function startDownload(modelId: string, resumeGraph = false) {
    const seq = ++seqRef.current
    setBusyId(modelId)
    setConfirm(null)
    setStatus({
      kind: 'checking',
      text: resumeGraph ? '补全 0.6MB 图文件…' : '开始下载量化版…',
      pct: 2,
    })
    if (modelId !== currentModelId) onUse(modelId)
    void preloadBrowserModel(modelId, {
      preferWebGPU,
      onStatus: (m: string, detail?: StatusDetail) => {
        if (seq !== seqRef.current) return
        setStatus(parseProgress(m, detail))
      },
    })
      .then(() => {
        if (seq !== seqRef.current) return
        setStatus({ kind: 'ready', text: '已下载，整理时从本地加载', pct: 100 })
        setBusyId(null)
        refresh()
      })
      .catch((e: unknown) => {
        if (seq !== seqRef.current) return
        setBusyId(null)
        setStatus({
          kind: 'error',
          text: `失败：${String((e as Error)?.message || e).slice(0, 160)}`,
          pct: 0,
        })
        refresh()
      })
  }

  async function removeModel(modelId: string) {
    setBusyId(modelId)
    try {
      if (modelId === currentModelId) unloadBrowserModel()
      await deleteBrowserModelCache(modelId)
      seqRef.current += 1
      setConfirm(null)
      setStatus({ kind: 'idle', text: '已删除该模型缓存', pct: 0 })
      refresh()
    } catch (e) {
      setStatus({
        kind: 'error',
        text: `删除失败：${String((e as Error)?.message || e).slice(0, 60)}`,
        pct: 0,
      })
    }
    setBusyId(null)
  }

  async function clearLeftover(modelId?: string) {
    setBusyId(modelId || '*')
    try {
      if (!modelId || modelId === currentModelId) unloadBrowserModel()
      const r = await purgeLeftoverModelCache(modelId)
      setConfirm(null)
      setStatus({
        kind: 'idle',
        text: r.removed
          ? `已清除残留 ${r.removed} 个文件${r.bytes ? ` · ${formatBytes(r.bytes)}` : ''}`
          : '没有可清的残留',
        pct: 0,
      })
      refresh()
    } catch (e) {
      setStatus({
        kind: 'error',
        text: `清除失败：${String((e as Error)?.message || e).slice(0, 60)}`,
        pct: 0,
      })
    }
    setBusyId(null)
  }

  const rows = inv?.models || []
  const busy = !!busyId
  const downloading = status?.kind === 'downloading' || status?.kind === 'loading' || status?.kind === 'checking'

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[11px] border border-border bg-white/60 px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="m-0 text-[13px] font-medium text-foreground">模型</p>
        {inv && (
          <p className="m-0 text-[11px] tabular-nums text-muted-foreground">
            缓存 {formatBytes(inv.totalBytes)}
            {inv.leftoverBytes > 0 ? ` · 残留 ${formatBytes(inv.leftoverBytes)}` : ''}
          </p>
        )}
      </div>
      <p className="m-0 text-[11px] leading-snug text-muted-foreground/80">
        浏览器内小模型只在这里下载。整理、收纳、打开设置都不会偷偷开下。Gemma 是 309MB 权重加 0.6MB 图文件，图文件再小也不会当残留删掉。
      </p>

      {status && (
        <div className="flex min-w-0 flex-col gap-1.5">
          <span
            className={cn(
              'inline-flex min-w-0 items-center gap-1.5',
              status.kind === 'error' ? 'text-red-600' : 'text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                status.kind === 'error'
                  ? 'bg-red-500'
                  : status.kind === 'ready'
                    ? 'bg-emerald-500'
                    : downloading
                      ? 'animate-pulse bg-foreground/50'
                      : 'bg-emerald-500/70',
              )}
            />
            <span className="min-w-0 text-[12px] leading-snug tabular-nums">{status.text}</span>
          </span>
          {downloading && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.07]">
              <div
                className="h-full rounded-full bg-foreground/60 transition-[width] duration-300"
                style={{ width: `${Math.max(2, status.pct)}%` }}
              />
            </div>
          )}
        </div>
      )}

      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {rows.map((row) => {
          const current = row.id === currentModelId
          const rowBusy = busyId === row.id
          const canDelete = !row.bundled && (row.state === 'ready' || row.state === 'partial' || row.state === 'leftover')
          const canPurge = !row.bundled && row.leftoverBytes > 0
          return (
            <li
              key={row.id}
              className="flex min-w-0 items-start justify-between gap-2 rounded-lg bg-black/[0.03] px-2 py-1.5"
            >
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-foreground">
                  {row.label.replace(/（[^）]*）$/, '')}
                  {current ? (
                    <span className="ml-1.5 font-normal text-muted-foreground">使用中</span>
                  ) : null}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {rowBusy && downloading ? status?.text : row.hint}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {!current && (
                  <button
                    type="button"
                    className="rounded-md px-1.5 py-0.5 text-[11px] text-foreground/80 hover:bg-black/[0.06]"
                    onClick={() => onUse(row.id)}
                  >
                    使用
                  </button>
                )}
                {!row.bundled && row.state === 'empty' && (
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-md px-1.5 py-0.5 text-[11px] text-foreground/80 hover:bg-black/[0.06] disabled:opacity-40"
                    onClick={() => startDownload(row.id)}
                  >
                    下载
                  </button>
                )}
                {!row.bundled && (row.state === 'partial' || row.state === 'leftover') && (
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-md px-1.5 py-0.5 text-[11px] text-foreground/80 hover:bg-black/[0.06] disabled:opacity-40"
                    onClick={() => startDownload(row.id, !!row.missingGraph)}
                  >
                    {row.missingGraph ? '补全图文件' : row.state === 'partial' ? '续下' : '下载量化版'}
                  </button>
                )}
                {canPurge && (
                  confirm === `purge:${row.id}` ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-md px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50"
                      onClick={() => void clearLeftover(row.id)}
                    >
                      确认清残留
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-black/[0.06] disabled:opacity-40"
                      onClick={() => setConfirm(`purge:${row.id}`)}
                    >
                      清残留
                    </button>
                  )
                )}
                {canDelete && (
                  confirm === `del:${row.id}` ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-md px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50"
                      onClick={() => void removeModel(row.id)}
                    >
                      确认删除
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-black/[0.06] disabled:opacity-40"
                      onClick={() => setConfirm(`del:${row.id}`)}
                    >
                      删除
                    </button>
                  )
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {inv && inv.orphans.length > 0 && (
        <div className="rounded-lg bg-amber-50/80 px-2 py-1.5 text-[11px] leading-snug text-amber-900">
          另有 {inv.orphans.length} 个对不上已知模型的文件 · {formatBytes(inv.orphanBytes)}
          {inv.orphans.slice(0, 3).map((o) => (
            <div key={o.url} className="truncate text-amber-800/80">{o.name}</div>
          ))}
        </div>
      )}

      {inv && inv.leftoverCount > 0 && (
        confirm === 'purge-all' ? (
          <button
            type="button"
            disabled={busy}
            className="self-start rounded-md px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50"
            onClick={() => void clearLeftover()}
          >
            确认清除全部残留（{formatBytes(inv.leftoverBytes)}）
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            className="self-start rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-black/[0.06] disabled:opacity-40"
            onClick={() => setConfirm('purge-all')}
          >
            清除全部残留
          </button>
        )
      )}
    </div>
  )
}
