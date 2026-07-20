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
 * 下拉收纳：橡皮筋跟手，箭头随进度旋转蓄力，
 * 过阈值松手触发，成功后对勾弹一下再收起。
 */
export function PullToStash({ disabled, onFire, children }: Props) {
  const [offset, setOffset] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const offsetRef = useRef(0)
  const st = useRef({ startY: 0, pid: -1, dragging: false })
  const resetTimer = useRef(0)

  useEffect(
    () => () => {
      window.clearTimeout(resetTimer.current)
    },
    [],
  )

  const setBoth = (v: number) => {
    offsetRef.current = v
    setOffset(v)
  }

  /** 分段橡皮筋：阈值前 0.65 增益，过后 0.2 增益并封顶 */
  const damp = (raw: number) => {
    const r = Math.max(0, raw)
    if (r <= ARM_RAW) return r * 0.65
    return Math.min(MAX_OFFSET, THRESHOLD + (r - ARM_RAW) * 0.2)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || phase === 'fire' || e.button !== 0) return
    // 从按钮/输入框上起手不拦截，保留原有交互
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return
    st.current.startY = e.clientY
    st.current.pid = e.pointerId
    st.current.dragging = false
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = st.current
    if (s.pid !== e.pointerId) return
    const dy = e.clientY - s.startY
    if (!s.dragging) {
      if (dy < 8) return // 8px 死区，避免误触
      s.dragging = true
      e.currentTarget.setPointerCapture(e.pointerId)
      setPhase('pull')
    }
    setBoth(damp(dy - 8))
  }

  const finish = (fire: boolean) => {
    st.current.pid = -1
    st.current.dragging = false
    if (!fire) {
      setPhase('idle')
      setBoth(0)
      return
    }
    setPhase('fire')
    setBoth(REST)
    void (async () => {
      const r = await onFire()
      if (r === false) {
        setPhase('idle')
        setBoth(0)
        return
      }
      setPhase('done')
      window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => {
        setPhase('idle')
        setBoth(0)
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

  const progress = Math.min(1, offset / THRESHOLD)
  const armed = phase === 'pull' && progress >= 0.99
  const label =
    phase === 'fire' ? '收纳中…'
    : phase === 'done' ? '已收纳'
    : armed ? '松手立即收纳'
    : '继续下拉收纳'

  return (
    <div
      className={cn('relative flex flex-col gap-2', phase === 'pull' && 'select-none')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* 揭示区：高度即跟手位移，松手后弹簧收敛 */}
      <div
        aria-hidden={phase === 'idle'}
        className="overflow-hidden"
        style={{
          height: offset,
          transition:
            phase === 'pull' ? 'none' : 'height 400ms cubic-bezier(0.34, 1.4, 0.64, 1)',
        }}
      >
        <div className="flex h-full flex-col items-center justify-end gap-1 pb-1.5">
          <span
            className={cn(
              'flex size-9 items-center justify-center rounded-full border transition-colors duration-150',
              armed || phase !== 'pull'
                ? 'border-[#0a0a0a] bg-[#0a0a0a] text-white'
                : 'border-black/20 bg-white/70 text-[#0a0a0a]',
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
                viewBox="0 0 16 16"
                className="size-4"
                fill="none"
                style={{ transform: `rotate(${progress * 180}deg)` }}
              >
                <path d="M8 3v10m0 0 4-4m-4 4-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span
            className={cn(
              'text-[11px] leading-none transition-colors',
              armed ? 'font-medium text-[#0a0a0a]' : 'text-[#8b8b8e]',
            )}
          >
            {label}
          </span>
        </div>
      </div>

      {children}
    </div>
  )
}
