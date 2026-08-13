import { useEffect, useRef, useState } from 'react'
import {
  BROWSER_MODELS,
  ensureRemoteHostPermission,
  getBrowserModelWarmState,
  getLastEmbedDevice,
  preloadBrowserModel,
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
  return {
    ...picker,
    ...patch,
    localModel: { ...picker.localModel, ...(patch.localModel || {}) },
    remoteModel: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      ...picker.remoteModel,
      ...(patch.remoteModel || {}),
    },
  }
}

type BrowserModelMeta = { id: string; label: string; note?: string; bundled?: boolean }

type Props = {
  value: ClassifySettings
  onChange: (
    next: Partial<ClassifySettings> & {
      localModel?: Partial<ClassifySettings['localModel']>
      remoteModel?: Partial<ClassifySettings['remoteModel']>
    },
  ) => void
  className?: string
}

type StatusPhase =
  | 'idle'
  | 'warm'
  | 'checking'
  | 'downloading'
  | 'loading'
  | 'ready-cache'
  | 'ready-fresh'
  | 'error'

type Status = {
  phase: StatusPhase
  text: string
  pct?: number
  device?: string
}

function parseProgress(msg: string): Partial<Status> | null {
  if (msg.startsWith('下载失败')) return { phase: 'error', text: msg }
  const m = msg.match(/(\d{1,3})%/)
  if (m) return { phase: 'downloading', text: msg, pct: Math.min(100, parseInt(m[1], 10)) }
  if (msg.includes('WebGPU 失败') || msg.includes('回退')) {
    return { phase: 'loading', text: msg }
  }
  if (msg.startsWith('加载') || msg.startsWith('编码')) {
    return { phase: 'loading', text: msg }
  }
  if (msg.startsWith('下载')) return { phase: 'downloading', text: msg, pct: 4 }
  return { phase: 'checking', text: msg }
}

/**
 * 选中即准备。状态区分：
 * - 内存已热 / 磁盘缓存秒开 / 正在下载 / 加载进内存 / 失败
 * 扩展不跑 Node；Ollama 是本机独立服务，与浏览器生命周期无关。
 */
export function ClassifyPicker({ value, onChange, className }: Props) {
  const browserOn = value.classifyMode === 'browser'
  const ollamaOn = value.classifyMode === 'ollama'
  const openaiOn = value.classifyMode === 'openai'
  const siteOnly = value.classifyMode === 'site'
  const quality = value.groupQuality === 'enhanced' ? 'enhanced' : 'fast'
  const remote = value.remoteModel || { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' }
  const meta = (BROWSER_MODELS as BrowserModelMeta[]).find((m) => m.id === value.browserModelId)
  const [status, setStatus] = useState<Status | null>(null)
  const [permHint, setPermHint] = useState<string | null>(null)
  const seqRef = useRef(0)
  const sawDownloadRef = useRef(false)

  useEffect(() => {
    if (!browserOn || !meta) {
      setStatus(null)
      return
    }

    const warm = getBrowserModelWarmState(value.browserModelId, value.preferWebGPU !== false)
    if (warm.warm) {
      setStatus({
        phase: 'warm',
        text: `内存已就绪 · ${warm.lastDevice === 'webgpu' ? 'WebGPU' : 'WASM'}`,
        pct: 100,
        device: warm.lastDevice,
      })
      return
    }

    if (meta.bundled) {
      setStatus({
        phase: 'idle',
        text: '内置模型 · 首次使用时从扩展包加载（不联网下载）',
      })
      return
    }

    const seq = ++seqRef.current
    sawDownloadRef.current = false
    const t0 = performance.now()
    setStatus({
      phase: 'checking',
      text: warm.webgpuDead
        ? '检查本地缓存（WebGPU 近期失败，直接 WASM）…'
        : '检查本地缓存 / 准备加载…',
      pct: 2,
    })

    void preloadBrowserModel(value.browserModelId, {
      preferWebGPU: value.preferWebGPU !== false,
      onStatus: (m: string) => {
        if (seq !== seqRef.current) return
        const parsed = parseProgress(m)
        if (!parsed) return
        if (parsed.phase === 'downloading') sawDownloadRef.current = true
        setStatus((prev) => ({
          phase: parsed.phase || prev?.phase || 'checking',
          text: parsed.text || prev?.text || m,
          pct: parsed.pct ?? prev?.pct,
          device: prev?.device,
        }))
      },
    })
      .then(() => {
        if (seq !== seqRef.current) return
        const device = getLastEmbedDevice()
        const elapsed = performance.now() - t0
        const fromCache = !sawDownloadRef.current && elapsed < 2500
        setStatus({
          phase: fromCache ? 'ready-cache' : 'ready-fresh',
          text: fromCache
            ? `已缓存 · 秒开（${device === 'webgpu' ? 'WebGPU' : 'WASM'}）`
            : `模型已就绪（${device === 'webgpu' ? 'WebGPU' : 'WASM'}）`,
          pct: 100,
          device,
        })
      })
      .catch((e: unknown) => {
        if (seq !== seqRef.current) return
        setStatus({
          phase: 'error',
          text: `失败：${String((e as Error)?.message || e).slice(0, 72)}`,
        })
      })

    return () => {
      seqRef.current += 1
    }
  }, [browserOn, meta, value.browserModelId, value.preferWebGPU])

  function patchRemote(patch: Partial<ClassifySettings['remoteModel']>) {
    onChange({ remoteModel: { ...remote, ...patch } })
  }

  async function requestRemoteHost(baseUrl?: string) {
    const ok = await ensureRemoteHostPermission(baseUrl || remote.baseUrl)
    setPermHint(ok ? null : '未授予该主机访问权限，请求会失败；可在浏览器扩展权限里允许')
  }

  const showBrowserStatus = browserOn && !!status
  const busy =
    status &&
    (status.phase === 'checking' ||
      status.phase === 'downloading' ||
      status.phase === 'loading')

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex flex-wrap items-center gap-2 rounded-[11px] border border-border bg-white/60 px-2.5 py-2.5 text-xs text-muted-foreground">
        <label className="inline-flex items-center gap-1.5 font-medium">
          分组质量
          <select
            className="max-w-[120px] rounded-lg border border-black/15 bg-white/80 px-2 py-1 text-[13px] text-foreground"
            value={quality}
            disabled={siteOnly}
            title={siteOnly ? '按站点时质量档位无影响' : undefined}
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
            value={value.classifyMode}
            onChange={(e) => {
              const mode = e.target.value
              onChange({ classifyMode: mode })
              if (mode === 'openai') void requestRemoteHost(remote.baseUrl)
              else setPermHint(null)
            }}
          >
            <option value="site">按站点</option>
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

      {!siteOnly && (
        <p className="m-0 px-0.5 text-[11px] leading-snug text-muted-foreground/80">
          {quality === 'enhanced'
            ? '增强：主题提示加强、域名回填；OpenAI 另含近义组合并与模型命名（更慢、更准）。'
            : '快速：单次分类即可，分批时仍合并同名组；命名用启发式。'}
        </p>
      )}

      {openaiOn && (
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
            标题与域名会发到你配置的端点；Key 仅存本机 chrome.storage.local。保存时归一到 /v1。
          </p>
          {permHint && (
            <p className="m-0 text-[11px] leading-snug text-amber-700">{permHint}</p>
          )}
        </div>
      )}

      {showBrowserStatus && status && (
        <div className="min-w-0 rounded-[11px] border border-border bg-white/60 px-3 py-2 text-xs">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span
              className={cn(
                'inline-flex min-w-0 items-center gap-1.5',
                status.phase === 'error' ? 'text-red-600' : 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  status.phase === 'error'
                    ? 'bg-red-500'
                    : status.phase === 'ready-cache' ||
                        status.phase === 'ready-fresh' ||
                        status.phase === 'warm'
                      ? 'bg-emerald-500'
                      : status.phase === 'idle'
                        ? 'bg-emerald-500/70'
                        : 'animate-pulse bg-foreground/50',
                )}
              />
              <span className="min-w-0 truncate tabular-nums">{status.text}</span>
            </span>
            {busy && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-black/[0.07]">
                <div
                  className="h-full rounded-full bg-foreground/60 transition-[width] duration-300"
                  style={{
                    width: `${status.phase === 'checking' ? 8 : (status.pct ?? 12)}%`,
                  }}
                />
              </div>
            )}
            <p className="m-0 text-[11px] leading-snug text-muted-foreground/80">
              {meta?.bundled
                ? '权重随扩展提供；关页面只卸内存，不会重复安装。'
                : '下载写入浏览器缓存；再开页面通常秒开，不会重复安装。扩展不启动 Node 进程。'}
            </p>
          </div>
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
