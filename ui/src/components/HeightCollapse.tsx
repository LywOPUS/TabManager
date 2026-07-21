import { useEffect, useRef, useState, type ReactNode } from 'react'

const OPEN_MS = 260
const CLOSE_MS = 200

/**
 * 高度动画折叠容器：打开时 0 → 内容高 → auto，收起时反向。
 * 子树仅在挂载期间渲染，挂载期间的 CSS 入场动画（如 .anim-row）随打开自然播放一次。
 */
export function HeightCollapse({ open, children }: { open: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(open)
  const rafRef = useRef(0)
  const timerRef = useRef(0)
  const onEndRef = useRef<((e?: TransitionEvent) => void) | null>(null)

  useEffect(() => {
    const el = ref.current
    const detach = () => {
      cancelAnimationFrame(rafRef.current)
      window.clearTimeout(timerRef.current)
      const node = ref.current
      if (node && onEndRef.current) node.removeEventListener('transitionend', onEndRef.current)
      onEndRef.current = null
    }

    // 大块内容（多标签会话）跳过高度动画，避免 scrollHeight + 强制 layout 卡顿
    const LARGE_PX = 480

    if (open) {
      setMounted(true)
      rafRef.current = requestAnimationFrame(() => {
        const node = ref.current
        if (!node) return
        const h = node.scrollHeight
        if (h > LARGE_PX) {
          node.style.transition = ''
          node.style.height = 'auto'
          node.style.opacity = '1'
          return
        }
        node.style.height = '0px'
        node.style.opacity = '0'
        void node.offsetHeight
        node.style.transition =
          `height ${OPEN_MS}ms var(--ease-out, cubic-bezier(0.2,0.7,0.2,1)), ` +
          `opacity 180ms ease-out`
        node.style.height = `${h}px`
        node.style.opacity = '1'
        const done = (e: TransitionEvent) => {
          if (e.propertyName !== 'height' || e.target !== node) return
          node.removeEventListener('transitionend', done)
          if (onEndRef.current === done) onEndRef.current = null
          node.style.transition = ''
          node.style.height = 'auto'
        }
        onEndRef.current = done
        node.addEventListener('transitionend', done)
      })
    } else if (mounted) {
      if (!el) {
        setMounted(false)
        return detach
      }
      const h = el.scrollHeight
      if (h > LARGE_PX) {
        // 大内容：直接卸挂载，避免再量一次做收起插值
        setMounted(false)
        return detach
      }
      el.style.height = `${h}px`
      el.style.opacity = '1'
      void el.offsetHeight
      el.style.transition =
        `height ${CLOSE_MS}ms var(--ease-in, cubic-bezier(0.4,0,0.2,1)), ` +
        `opacity 140ms ease-in`
      el.style.height = '0px'
      el.style.opacity = '0'
      let finished = false
      const done = (e?: TransitionEvent) => {
        if (e && (e.propertyName !== 'height' || e.target !== el)) return
        if (finished) return
        finished = true
        el.removeEventListener('transitionend', done)
        if (onEndRef.current === done) onEndRef.current = null
        setMounted(false)
      }
      onEndRef.current = done
      el.addEventListener('transitionend', done)
      timerRef.current = window.setTimeout(() => done(), CLOSE_MS + 60)
    }
    return detach
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!mounted) return null
  return (
    <div ref={ref} className="overflow-hidden">
      {children}
    </div>
  )
}
