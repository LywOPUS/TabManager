import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

type Orb = {
  x: number
  y: number
  r: number
  color: string
  /** drift period seconds */
  period: number
  ampX: number
  ampY: number
  phase: number
}

type Props = {
  className?: string
  /** popup 更紧凑；page 更大更慢 */
  variant?: 'popup' | 'page'
}

const PAPER = '#f8f8f8'

/**
 * JetBrains New UI 气质的缓慢氛围底：
 * 大面积柔焦色团，超慢漂移（~20–40s），不抢前景。
 *
 * popup 用纯 CSS（高度跟手变化时 canvas 改尺寸会先清成黑底再重画 → 闪黑白）。
 * 管理页仍用 canvas 慢漂。
 */
export function JetBrainsAmbient({ className, variant = 'page' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (variant === 'popup') return

    const canvas = canvasRef.current
    if (!canvas) return
    // alpha:false 改 width/height 时缓冲默认是黑的，必须同帧立刻填纸色
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
    if (!ctx) return

    const reduceMotion =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches

    const orbs: Orb[] = [
      { x: 0.12, y: 0.15, r: 0.42, color: '212,216,224', period: 32, ampX: 0.1, ampY: 0.07, phase: 0.3 },
      { x: 0.82, y: 0.25, r: 0.38, color: '230,228,222', period: 38, ampX: 0.08, ampY: 0.09, phase: 1.1 },
      { x: 0.7, y: 0.75, r: 0.45, color: '222,224,230', period: 44, ampX: 0.09, ampY: 0.06, phase: 2.2 },
      { x: 0.25, y: 0.7, r: 0.4, color: '226,224,218', period: 40, ampX: 0.07, ampY: 0.08, phase: 3.5 },
    ]

    let raf = 0
    let running = true
    let paused = typeof document !== 'undefined' && document.hidden
    const t0 = performance.now()
    // 漂移周期 28–44s，12fps 足够；避免管理页全屏 canvas 空转 60fps
    const FRAME_MS = 1000 / 12
    let lastPaint = 0
    let lastCssW = 0
    let lastCssH = 0

    const paint = (w: number, h: number, t: number) => {
      // base — warm paper, near flat
      const base = ctx.createLinearGradient(0, 0, w, h)
      base.addColorStop(0, '#fbfbfb')
      base.addColorStop(0.5, PAPER)
      base.addColorStop(1, '#f4f4f4')
      ctx.fillStyle = base
      ctx.fillRect(0, 0, w, h)

      ctx.globalCompositeOperation = 'source-over'
      for (const o of orbs) {
        const ang = (t / o.period) * Math.PI * 2 + o.phase
        const cx = (o.x + Math.sin(ang) * o.ampX) * w
        const cy = (o.y + Math.cos(ang * 0.85) * o.ampY) * h
        const radius = o.r * Math.max(w, h)
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
        g.addColorStop(0, `rgba(${o.color}, 0.5)`)
        g.addColorStop(0.45, `rgba(${o.color}, 0.2)`)
        g.addColorStop(1, `rgba(${o.color}, 0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.fill()
      }

      // soft vignette — keeps edges calm (helps rounded shell read)
      const vig = ctx.createRadialGradient(
        w * 0.5,
        h * 0.45,
        Math.min(w, h) * 0.2,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.75,
      )
      vig.addColorStop(0, 'rgba(255,255,255,0)')
      vig.addColorStop(1, 'rgba(240,240,240,0.5)')
      ctx.fillStyle = vig
      ctx.fillRect(0, 0, w, h)
    }

    /** 改 canvas 缓冲尺寸会清空为黑；同帧立刻铺纸色，避免闪黑 */
    const fillPaper = () => {
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = PAPER
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.restore()
    }

    const resize = () => {
      // Soft-focus gradients need no sharp pixels: render at half resolution
      // and let CSS upscale — big paint savings on tall windows.
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * 0.5
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w < 1 || h < 1) return false
      // 尺寸未变则不碰 width/height，避免无意义清屏闪烁
      if (w === lastCssW && h === lastCssH && canvas.width > 0) return true
      lastCssW = w
      lastCssH = h
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      fillPaper()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      return true
    }

    const frame = (now: number) => {
      if (!running || paused) return
      if (!reduceMotion && now - lastPaint < FRAME_MS) {
        raf = requestAnimationFrame(frame)
        return
      }
      lastPaint = now
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w < 1 || h < 1) {
        if (!reduceMotion) raf = requestAnimationFrame(frame)
        return
      }
      const t = reduceMotion ? 0 : (now - t0) / 1000
      paint(w, h, t)
      if (!reduceMotion) raf = requestAnimationFrame(frame)
    }

    const kick = () => {
      cancelAnimationFrame(raf)
      if (!resize()) return
      // 同帧立刻画完整一帧，不要只等下一个 rAF（否则中间可能露出清屏色）
      const t = reduceMotion ? 0 : (performance.now() - t0) / 1000
      paint(canvas.clientWidth, canvas.clientHeight, t)
      if (paused || reduceMotion) return
      raf = requestAnimationFrame(frame)
    }

    const onVisibility = () => {
      paused = document.hidden
      if (paused) cancelAnimationFrame(raf)
      else kick()
    }

    // 合并同一帧内多次 resize 通知
    let roRaf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(roRaf)
      roRaf = requestAnimationFrame(kick)
    })
    ro.observe(canvas)
    document.addEventListener('visibilitychange', onVisibility)
    kick()

    return () => {
      running = false
      cancelAnimationFrame(raf)
      cancelAnimationFrame(roRaf)
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [variant])

  if (variant === 'popup') {
    return (
      <div
        aria-hidden
        className={cn('pointer-events-none absolute inset-0 popup-ambient', className)}
      />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
    />
  )
}
