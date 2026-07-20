import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '@/lib/utils'
import {
  DEFAULT_PARAMS,
  createLiquidGlassRenderer,
  destroyLiquidGlassRenderer,
  renderLiquidGlassFrame,
  type LiquidGlassParams,
} from './renderer'

export type WebGpuLiquidGlassProps = {
  children?: ReactNode
  className?: string
  contentClassName?: string
  style?: CSSProperties
  params?: Partial<LiquidGlassParams>
  /** 无 WebGPU 时是否显示 CSS 回退 */
  fallback?: boolean
}

function CssFallback({
  className,
  contentClassName,
  style,
  children,
}: {
  className?: string
  contentClassName?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl',
        'border border-white/50 bg-white/55 shadow-[0_2px_20px_rgba(0,0,0,0.06)]',
        'backdrop-blur-[16px] backdrop-saturate-[1.6]',
        className,
      )}
      style={style}
      data-liquid-glass="css-fallback"
    >
      <div className={cn('relative z-[1]', contentClassName)}>{children}</div>
    </div>
  )
}

export function WebGpuLiquidGlass({
  children,
  className,
  contentClassName,
  style,
  params: paramsProp,
  fallback = true,
}: WebGpuLiquidGlassProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<'pending' | 'webgpu' | 'fallback'>('pending')
  const paramsRef = useRef({ ...DEFAULT_PARAMS, ...paramsProp })
  paramsRef.current = { ...DEFAULT_PARAMS, ...paramsProp }

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return

    let cancelled = false
    let raf = 0
    let state: Awaited<ReturnType<typeof createLiquidGlassRenderer>> = null
    const start = performance.now()

    const prefersReduce =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-transparency: reduce)').matches

    if (prefersReduce || !navigator.gpu) {
      setMode(fallback ? 'fallback' : 'pending')
      return
    }

    void (async () => {
      try {
        state = await createLiquidGlassRenderer(canvas)
        if (cancelled) {
          if (state) destroyLiquidGlassRenderer(state)
          return
        }
        if (!state) {
          setMode(fallback ? 'fallback' : 'pending')
          return
        }
        setMode('webgpu')

        const tick = (now: number) => {
          if (!state || cancelled) return
          const dpr = Math.min(window.devicePixelRatio || 1, 2)
          const reduceMotion =
            typeof matchMedia !== 'undefined' &&
            matchMedia('(prefers-reduced-motion: reduce)').matches
          const t = reduceMotion ? 0 : (now - start) / 1000
          renderLiquidGlassFrame(state, canvas, t, paramsRef.current, dpr)
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      } catch {
        if (!cancelled) setMode(fallback ? 'fallback' : 'pending')
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      if (state) destroyLiquidGlassRenderer(state)
    }
  }, [fallback])

  if (mode === 'fallback') {
    return (
      <CssFallback className={className} contentClassName={contentClassName} style={style}>
        {children}
      </CssFallback>
    )
  }

  return (
    <div
      ref={hostRef}
      className={cn('relative overflow-hidden rounded-2xl', className)}
      style={style}
      data-liquid-glass={mode === 'webgpu' ? 'webgpu' : 'pending'}
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
      />
      <div className={cn('relative z-[1]', contentClassName)}>{children}</div>
    </div>
  )
}
