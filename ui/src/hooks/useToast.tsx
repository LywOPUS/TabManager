import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type ToastCtx = { toast: (text: string) => void }

const Ctx = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => () => {
    timers.current.forEach(clearTimeout)
  }, [])

  const toast = useCallback((text: string) => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setMsg(text)
    setVisible(true)
    timers.current.push(
      window.setTimeout(() => setVisible(false), 2200),
      window.setTimeout(() => setMsg(null), 2450),
    )
  }, [])

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      {msg && (
        <div
          className={cn(
            'pointer-events-none fixed bottom-6 left-1/2 z-60 -translate-x-1/2 rounded-xl bg-[#1d1d1f]/92 px-4 py-2.5 text-[13px] font-medium text-white shadow-lg backdrop-blur-md transition',
            visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
          )}
        >
          {msg}
        </div>
      )}
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast outside provider')
  return ctx
}
