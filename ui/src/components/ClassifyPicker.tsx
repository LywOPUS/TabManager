import { useCallback, useEffect, useState } from 'react'
import {
  BROWSER_MODELS,
  getBrowserModelWarmState,
  listBrowserModelCache,
} from '@/lib/chrome-ext'
import { cn } from '@/lib/utils'

export type ClassifySettings = {
  /** 固定 'browser'：分类引擎只有浏览器内小模型 */
  classifyMode: string
  browserModelId: string
  preferWebGPU: boolean
  /** 收纳后弹确认；false = 静默自动整理 */
  stashReview?: boolean
}

export type ClassifySettingsPatch = Partial<ClassifySettings>

/** 合并分类设置 patch（管理页 / popup 共用） */
export function mergeClassifySettings(
  picker: ClassifySettings,
  patch: ClassifySettingsPatch,
): ClassifySettings {
  return { ...picker, ...patch }
}

type BrowserModelMeta = { id: string; label: string; note?: string; bundled?: boolean }

type CacheRow = {
  id: string
  state: 'bundled' | 'ready' | 'partial' | 'leftover' | 'empty'
  hint?: string
}

type Props = {
  value: ClassifySettings
  onChange: (next: Partial<ClassifySettings>) => void
  className?: string
  /** 管理页「模型」或弹窗跳到 #models */
  onOpenLibrary?: () => void
}

/**
 * 浏览器内小模型设置：选模型 + WebGPU 偏好。
 * 模型的下载/删除只在管理页「模型」。
 */
export function ClassifyPicker({ value, onChange, className, onOpenLibrary }: Props) {
  const meta = (BROWSER_MODELS as BrowserModelMeta[]).find((m) => m.id === value.browserModelId)
  const [modelHint, setModelHint] = useState<string | null>(null)
  const [needLibrary, setNeedLibrary] = useState(false)

  const refreshHint = useCallback(() => {
    const warm = getBrowserModelWarmState(value.browserModelId, value.preferWebGPU !== false)
    if (warm.warm) {
      setModelHint(`内存已就绪 · ${warm.lastDevice === 'webgpu' ? 'WebGPU' : 'WASM'}`)
      setNeedLibrary(false)
      return
    }
    if (meta?.bundled) {
      setModelHint('内置模型 · 整理时从扩展包加载')
      setNeedLibrary(false)
      return
    }
    void listBrowserModelCache()
      .then((rows: unknown) => {
        const row = (rows as CacheRow[]).find((r) => r.id === value.browserModelId)
        if (row?.state === 'ready') {
          setModelHint(row.hint || '已下载 · 整理时加载')
          setNeedLibrary(false)
          return
        }
        if (row?.state === 'partial' || row?.state === 'leftover') {
          setModelHint(row.hint || '未下完或有残留 · 到「模型」处理')
          setNeedLibrary(true)
          return
        }
        setModelHint('未下载 · 到「模型」下载后再整理')
        setNeedLibrary(true)
      })
      .catch(() => {
        setModelHint('未下载 · 到「模型」下载后再整理')
        setNeedLibrary(true)
      })
  }, [meta, value.browserModelId, value.preferWebGPU])

  useEffect(() => {
    refreshHint()
  }, [refreshHint])

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex flex-wrap items-center gap-2 rounded-[11px] border border-border bg-white/60 px-2.5 py-2.5 text-xs text-muted-foreground">
        <label className="inline-flex items-center gap-1.5 font-medium">
          分类模型
          <select
            className="max-w-[210px] rounded-lg border border-black/15 bg-white/80 px-2 py-1 text-[13px] text-foreground"
            value={value.browserModelId}
            onChange={(e) => onChange({ browserModelId: e.target.value })}
          >
            {BROWSER_MODELS.map((m: BrowserModelMeta) => (
              <option key={m.id} value={m.id} title={m.note}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 font-medium">
          <input
            type="checkbox"
            checked={value.preferWebGPU !== false}
            onChange={(e) => onChange({ preferWebGPU: e.target.checked })}
          />
          优先 WebGPU
        </label>
      </div>

      <p className="m-0 px-0.5 text-[11px] leading-snug text-muted-foreground/80">
        浏览器内全局主题聚类，完全本机运行；失败不会改回按站点。
      </p>

      {modelHint && (
        <div className="flex min-w-0 items-center justify-between gap-2 rounded-[11px] border border-border bg-white/60 px-3 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 leading-snug">{modelHint}</span>
          {needLibrary && onOpenLibrary && (
            <button
              type="button"
              className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] text-foreground/80 hover:bg-black/[0.06]"
              onClick={onOpenLibrary}
            >
              去下载
            </button>
          )}
        </div>
      )}
    </div>
  )
}
