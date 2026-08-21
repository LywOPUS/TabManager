import { useCallback, useEffect, useState } from 'react'
import {
  BROWSER_MODELS,
  ensureRemoteHostPermission,
  getBrowserModelWarmState,
  listBrowserModelCache,
} from '@/lib/chrome-ext'
import { cn } from '@/lib/utils'

export type ClassifySettings = {
  classifyMode: string
  /** fast = 快速；enhanced = 增强（后处理 / 近义合并 / 模型命名） */
  groupQuality?: 'fast' | 'enhanced'
  browserModelId: string
  preferWebGPU: boolean
  /** 收纳后弹确认；false = 静默自动整理 */
  stashReview?: boolean
  localModel: { model: string; baseUrl?: string }
  remoteModel: { baseUrl: string; apiKey: string; model: string }
}

export type ClassifySettingsPatch = Partial<ClassifySettings> & {
  localModel?: Partial<ClassifySettings['localModel']>
  remoteModel?: Partial<ClassifySettings['remoteModel']>
}

/** 合并分类设置 patch（管理页 / popup 共用） */
export function mergeClassifySettings(
  picker: ClassifySettings,
  patch: ClassifySettingsPatch,
): ClassifySettings {
  const remoteModel = picker.remoteModel || {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  }
  return {
    ...picker,
    ...patch,
    localModel: { ...picker.localModel, ...(patch.localModel || {}) },
    remoteModel: {
      ...remoteModel,
      ...(patch.remoteModel || {}),
    },
  }
}

type BrowserModelMeta = { id: string; label: string; note?: string; bundled?: boolean }

type CacheRow = {
  id: string
  state: 'bundled' | 'ready' | 'partial' | 'leftover' | 'empty'
  hint?: string
}

type Props = {
  value: ClassifySettings
  onChange: (
    next: Partial<ClassifySettings> & {
      localModel?: Partial<ClassifySettings['localModel']>
      remoteModel?: Partial<ClassifySettings['remoteModel']>
    },
  ) => void
  className?: string
  /** 管理页「模型」或弹窗跳到 #models */
  onOpenLibrary?: () => void
}

/**
 * 选分类方式。浏览器内小模型的下载/删除只在管理页「模型」。
 * 扩展不跑 Node；Ollama 是本机独立服务，与浏览器生命周期无关。
 */
export function ClassifyPicker({ value, onChange, className, onOpenLibrary }: Props) {
  const browserOn = value.classifyMode === 'browser'
  const ollamaOn = value.classifyMode === 'ollama'
  const openaiOn = value.classifyMode === 'openai'
  const quality = value.groupQuality === 'enhanced' ? 'enhanced' : 'fast'
  const remote = value.remoteModel || { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' }
  const meta = (BROWSER_MODELS as BrowserModelMeta[]).find((m) => m.id === value.browserModelId)
  const [permHint, setPermHint] = useState<string | null>(null)
  const [modelHint, setModelHint] = useState<string | null>(null)
  const [needLibrary, setNeedLibrary] = useState(false)

  const refreshHint = useCallback(() => {
    if (!browserOn) {
      setModelHint(null)
      setNeedLibrary(false)
      return
    }
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
  }, [browserOn, meta, value.browserModelId, value.preferWebGPU])

  useEffect(() => {
    refreshHint()
  }, [refreshHint])

  function patchRemote(patch: Partial<ClassifySettings['remoteModel']>) {
    onChange({ remoteModel: { ...remote, ...patch } })
  }

  async function requestRemoteHost(baseUrl?: string) {
    const ok = await ensureRemoteHostPermission(baseUrl || remote.baseUrl)
    setPermHint(ok ? null : '未授予该主机访问权限，请求会失败；可在浏览器扩展权限里允许')
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex flex-wrap items-center gap-2 rounded-[11px] border border-border bg-white/60 px-2.5 py-2.5 text-xs text-muted-foreground">
        <label className="inline-flex items-center gap-1.5 font-medium">
          分组质量
          <select
            className="max-w-[120px] rounded-lg border border-black/15 bg-white/80 px-2 py-1 text-[13px] text-foreground"
            value={quality}
            onChange={(e) =>
              onChange({ groupQuality: e.target.value === 'enhanced' ? 'enhanced' : 'fast' })
            }
          >
            <option value="fast">快速</option>
            <option value="enhanced">增强</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 font-medium">
          分类模型
          <select
            className="max-w-[200px] rounded-lg border border-black/15 bg-white/80 px-2 py-1 text-[13px] text-foreground"
            value={value.classifyMode === 'site' ? 'browser' : value.classifyMode}
            onChange={(e) => {
              const mode = e.target.value
              onChange({ classifyMode: mode })
              if (mode === 'openai') void requestRemoteHost(remote.baseUrl)
              else setPermHint(null)
            }}
          >
            <option value="browser">浏览器内小模型</option>
            <option value="gemini">Google Gemini Nano</option>
            <option value="ollama">Ollama（本机服务）</option>
            <option value="openai">OpenAI 兼容</option>
          </select>
        </label>
        <select
          className={cn(
            'max-w-[210px] rounded-lg border border-black/15 bg-white/80 px-2 py-1 text-[13px] text-foreground',
            !browserOn && 'hidden',
          )}
          value={value.browserModelId}
          onChange={(e) => onChange({ browserModelId: e.target.value })}
        >
          {BROWSER_MODELS.map((m: BrowserModelMeta) => (
            <option key={m.id} value={m.id} title={m.note}>
              {m.label}
            </option>
          ))}
        </select>
        <label className={cn('inline-flex items-center gap-1.5 font-medium', !browserOn && 'hidden')}>
          <input
            type="checkbox"
            checked={value.preferWebGPU !== false}
            onChange={(e) => onChange({ preferWebGPU: e.target.checked })}
          />
          优先 WebGPU
        </label>
        <input
          type="text"
          className={cn(
            'max-w-[200px] rounded-lg border border-black/15 bg-white/80 px-2 py-1 text-[13px] text-foreground',
            !ollamaOn && 'hidden',
          )}
          value={value.localModel.model || 'qwen2.5:0.5b'}
          placeholder="qwen2.5:0.5b"
          onChange={(e) => onChange({ localModel: { model: e.target.value } })}
        />
      </div>

      <p className="m-0 px-0.5 text-[11px] leading-snug text-muted-foreground/80">
        {quality === 'enhanced'
          ? '增强：主题提示加强；OpenAI 另含近义组合并与模型命名（更慢、更准）。失败不会改回按站点。'
          : '快速：本地全局聚类。填了下方远程 Key 时，只把每组几条标题发出去起名、剔脏。失败不会改回按站点。'}
      </p>

      {(openaiOn || browserOn) && (
        <div className="flex min-w-0 flex-col gap-2 rounded-[11px] border border-border bg-white/60 px-3 py-2 text-xs text-muted-foreground">
          <label className="flex min-w-0 flex-col gap-1 font-medium text-foreground/80">
            API Base
            <input
              type="url"
              className="w-full rounded-lg border border-black/15 bg-white/80 px-2 py-1 text-[13px] font-normal text-foreground"
              value={remote.baseUrl || ''}
              placeholder="https://api.openai.com/v1"
              onChange={(e) => patchRemote({ baseUrl: e.target.value })}
              onBlur={() => void requestRemoteHost()}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 font-medium text-foreground/80">
            API Key
            <input
              type="password"
              autoComplete="off"
              className="w-full rounded-lg border border-black/15 bg-white/80 px-2 py-1 text-[13px] font-normal text-foreground"
              value={remote.apiKey || ''}
              placeholder="sk-…"
              onChange={(e) => patchRemote({ apiKey: e.target.value })}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 font-medium text-foreground/80">
            Model
            <input
              type="text"
              className="w-full rounded-lg border border-black/15 bg-white/80 px-2 py-1 text-[13px] font-normal text-foreground"
              value={remote.model || ''}
              placeholder="gpt-4o-mini"
              onChange={(e) => patchRemote({ model: e.target.value })}
            />
          </label>
          <p className="m-0 text-[11px] leading-snug text-muted-foreground/80">
            {browserOn
              ? '可选。填了 Key，整理时只把每组 3–5 条标题发到该端点起名、剔预告/音乐/空壳。Key 只存在本机。'
              : '标题与域名会发到你配置的端点；Key 仅存本机 chrome.storage.local。保存时归一到 /v1。'}
          </p>
          {permHint && (
            <p className="m-0 text-[11px] leading-snug text-amber-700">{permHint}</p>
          )}
        </div>
      )}

      {browserOn && modelHint && (
        <div className="flex min-w-0 items-center justify-between gap-2 rounded-[11px] border border-border bg-white/60 px-3 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 leading-snug">{modelHint}</span>
          {needLibrary && onOpenLibrary && (
            <button
              type="button"
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-foreground/80 hover:bg-black/[0.06]"
              onClick={onOpenLibrary}
            >
              去下载
            </button>
          )}
        </div>
      )}

      {ollamaOn && (
        <div className="rounded-[11px] border border-border bg-white/60 px-3 py-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-amber-500" />
            Ollama 是本机独立服务（默认 127.0.0.1:11434）
          </span>
          <p className="m-0 mt-1 text-[11px] leading-snug text-muted-foreground/80">
            关浏览器不会关掉 Ollama；需在系统里自行启动/停止。扩展只发 HTTP 请求。
          </p>
        </div>
      )}
    </div>
  )
}
