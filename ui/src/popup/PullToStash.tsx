import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const THRESHOLD = 72 // 触发所需的跟手位移
const MAX_OFFSET = 96 // 橡皮筋最大拉伸
const REST = 52 // 触发后停靠高度
const ARM_RAW = THRESHOLD / 0.65 // 到达阈值所需的原始拖动距离

type Phase = 'idle' | 'pull' | 'fire' | 'done'

type Props = {
  disabled?: boolean
  /** 返回 false 表示动作失败（立刻弹回，不亮对勾） */
  onFire: () => Promise<boolean | void> | boolean | void
  children: ReactNode
}

/**
 * 下拉收纳（揭示区在底部）：向下拖动手势，箭头随进度旋转蓄力，
 * 过阈值松手触发，成功后对勾弹一下再收起。
 *
 * 跟手阶段用 DOM 直写，避免每帧 setState 重渲染整棵 popup 子树（含 GlassSurface）。
 */
export function PullToStash({ disabled, onFire, children }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const phaseRef = useRef<Phase>('idle')
  const offsetRef = useRef(0)
  const armedRef = useRef(false)
  const st = useRef({ startY: 0, pid: -1, dragging: false })
  const resetTimer = useRef(0)

  const revealRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const badgeRef = useRef<HTMLSpanElement>(null)
  const arrowRef = useRef<SVGSVGElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }

  useEffect(
    () => () => {
      window.clearTimeout(resetTimer.current)
    },
    [],
  )

  // fire/done/idle 的文案由 React phase 驱动；pull 阶段文案由 paintPull 直写，避免被重渲染清空
  useEffect(() => {
    const el = labelRef.current
    if (!el || phase === 'pull') return
    el.textContent =
      phase === 'fire' ? '收纳中…'
      : phase === 'done' ? '已收纳'
      : ''
    el.classList.toggle('pull-label-armed', phase === 'done')
  }, [phase])

  /** 分段橡皮筋：阈值前 0.65 增益，过后 0.2 增益并封顶 */
  const damp = (raw: number) => {
    const r = Math.max(0, raw)
    if (r <= ARM_RAW) return r * 0.65
    return Math.min(MAX_OFFSET, THRESHOLD + (r - ARM_RAW) * 0.2)
  }

  const paintPull = (offset: number) => {
    offsetRef.current = offset
    const progress = Math.min(1, offset / THRESHOLD)
    const armed = progress >= 0.99
    const reveal = revealRef.current
    const inner = innerRef.current
    const badge = badgeRef.current
    const arrow = arrowRef.current
    const label = labelRef.current
    if (reveal) {
      reveal.style.height = `${offset}px`
      reveal.style.transition = 'none'
    }
    if (inner) inner.style.opacity = String(0.45 + progress * 0.55)
    if (badge) {
      badge.style.transform = `scale(${0.88 + progress * 0.14})`
      if (armed !== armedRef.current) {
        armedRef.current = armed
        badge.classList.toggle('pull-badge-armed', armed)
        label?.classList.toggle('pull-label-armed', armed)
        if (label) label.textContent = armed ? '松手立即收纳' : '继续下拉收纳'
      }
    }
    // 箭头默认朝下；进度到 1 时转 180°（蓄力完成）
    if (arrow) arrow.style.transform = `rotate(${progress * 180}deg)`
  }

  const paintSettled = (offset: number, p: Phase) => {
    offsetRef.current = offset
    const reveal = revealRef.current
    const inner = innerRef.current
    const badge = badgeRef.current
    if (reveal) {
      reveal.style.height = `${offset}px`
      reveal.style.transition =
        p === 'pull' ? 'none' : 'height 400ms cubic-bezier(0.34, 1.4, 0.64, 1)'
    }
    if (inner) inner.style.opacity = p === 'idle' ? '0' : '1'
    if (badge) badge.style.transform = 'scale(1)'
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || phaseRef.current === 'fire' || e.button !== 0) return
    // 从按钮/输入框上起手不拦截，保留原有交互
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return
    st.current.startY = e.clientY
    st.current.pid = e.pointerId
    st.current.dragging = false
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = st.current
    if (s.pid !== e.pointerId) return
    // 下拉：手指向下移动 → 正位移
    const dy = e.clientY - s.startY
    if (!s.dragging) {
      if (dy < 8) return // 8px 死区，避免误触
      s.dragging = true
      e.currentTarget.setPointerCapture(e.pointerId)
      armedRef.current = false
      setPhaseBoth('pull')
      const label = labelRef.current
      if (label) {
        label.textContent = '继续下拉收纳'
        label.classList.remove('pull-label-armed')
      }
      badgeRef.current?.classList.remove('pull-badge-armed')
    }
    paintPull(damp(dy - 8))
  }

  const finish = (fire: boolean) => {
    st.current.pid = -1
    st.current.dragging = false
    if (!fire) {
      setPhaseBoth('idle')
      armedRef.current = false
      paintSettled(0, 'idle')
      return
    }
    setPhaseBoth('fire')
    paintSettled(REST, 'fire')
    void (async () => {
      const r = await onFire()
      if (r === false) {
        setPhaseBoth('idle')
        armedRef.current = false
        paintSettled(0, 'idle')
        return
      }
      setPhaseBoth('done')
      paintSettled(REST, 'done')
      window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => {
        setPhaseBoth('idle')
        armedRef.current = false
        paintSettled(0, 'idle')
      }, 780)
    })()
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (st.current.pid !== e.pointerId) return
    if (st.current.dragging) finish(offsetRef.current >= THRESHOLD - 1)
    else st.current.pid = -1
  }

  const onPointerCancel = () => {
    if (st.current.dragging) finish(false)
    else st.current.pid = -1
  }

  return (
    <div
      className={cn('relative flex flex-col gap-2.5', phase === 'pull' && 'select-none')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {children}

      {/* 揭示区在底部：高度即跟手位移，松手后弹簧收敛 */}
      <div
        ref={revealRef}
        aria-hidden={phase === 'idle'}
        className="overflow-hidden"
        style={{ height: 0 }}
      >
        <div
          ref={innerRef}
          className="flex h-full flex-col items-center justify-start gap-1.5 pt-1.5"
          style={{ opacity: 0 }}
        >
          <span
            ref={badgeRef}
            className={cn(
              'pull-badge flex size-9 items-center justify-center rounded-full border',
              'transition-[background-color,border-color,color,box-shadow] duration-150',
              phase === 'pull'
                ? 'border-black/20 bg-white/70 text-[#0a0a0a]'
                : 'border-[#0a0a0a] bg-[#0a0a0a] text-white shadow-[0_2px_8px_rgba(0,0,0,0.18)]',
            )}
          >
            {phase === 'fire' ? (
              <span className="pull-spin size-4 rounded-full border-2 border-white/30 border-t-white" />
            ) : phase === 'done' ? (
              <svg viewBox="0 0 16 16" className="pull-pop size-4" fill="none">
                <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg
                ref={arrowRef}
                viewBox="0 0 16 16"
                className="size-4"
                fill="none"
              >
                <path d="M8 3v10m0 0 4-4m-4 4-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span
            ref={labelRef}
            role="status"
            aria-live="polite"
            className={cn(
              'pull-label text-[11px] leading-none tracking-wide transition-colors duration-150',
              phase === 'done' ? 'font-medium text-[#0a0a0a]' : 'text-[#8b8b8e]',
            )}
          />
        </div>
      </div>
    </div>
  )
}
