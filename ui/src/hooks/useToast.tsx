import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type ToastCtx = { toast: (text: string) => void }

const Ctx = createContext<ToastCtx | null>(null)

/**
 * Toast 状态放在兄弟节点 ToastHost，避免 Provider 自身 setState 时
 * 连带重渲染整棵管理页（列表 / modal）。
 */
function ToastHost({
  register,
}: {
  register: (toast: (text: string) => void) => void
}) {
  const [msg, setMsg] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const timers = useRef<number[]>([])
  const raf = useRef({ outer: 0, inner: 0 })

  useEffect(() => () => {
    timers.current.forEach(clearTimeout)
    cancelAnimationFrame(raf.current.outer)
    cancelAnimationFrame(raf.current.inner)
  }, [])

  useEffect(() => {
    register((text: string) => {
      timers.current.forEach(clearTimeout)
      timers.current = []
      cancelAnimationFrame(raf.current.outer)
      cancelAnimationFrame(raf.current.inner)

      setMsg(text)
      setVisible(false)
      // 双 rAF：先挂到「出」态再切「入」，否则同帧 visible=true 会跳过入场
      raf.current.outer = requestAnimationFrame(() => {
        raf.current.inner = requestAnimationFrame(() => setVisible(true))
      })
      timers.current.push(
        window.setTimeout(() => setVisible(false), 2200),
        window.setTimeout(() => setMsg(null), 2450),
      )
    })
  }, [register])

  if (!msg) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'anim-toast pointer-events-none fixed bottom-[var(--space-6)] left-1/2 z-60 -translate-x-1/2',
        'rounded-[var(--radius-xl)] bg-[var(--toast)] px-[var(--space-4)] py-[var(--space-2)]',
        'text-[13px] font-medium text-[var(--toast-foreground)] shadow-[var(--shadow-md)] backdrop-blur-md',
        visible ? 'is-in translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
    >
      {msg}
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const toastRef = useRef<(text: string) => void>(() => {})
  const register = useCallback((fn: (text: string) => void) => {
    toastRef.current = fn
  }, [])
  const value = useMemo<ToastCtx>(
    () => ({
      toast: (text: string) => toastRef.current(text),
    }),
    [],
  )

  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastHost register={register} />
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast outside provider')
  return ctx
}
