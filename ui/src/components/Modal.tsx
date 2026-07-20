import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { GlassCard } from '@/components/ui/glasscn/glass-card'

type Props = {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  dismissible?: boolean
}

export function Modal({ open, onClose, children, className, dismissible = true }: Props) {
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      let inner = 0
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(outer)
        cancelAnimationFrame(inner)
      }
    }
    setShown(false)
    const t = window.setTimeout(() => setMounted(false), 280)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open || !dismissible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, dismissible])

  if (!mounted) return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/28 p-5 transition-opacity duration-[280ms]',
        shown ? 'opacity-100' : 'opacity-0',
      )}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose()
      }}
      role="presentation"
    >
      <GlassCard
        className={cn(
          'max-h-[80vh] w-[min(480px,92vw)] overflow-auto px-5 py-5 transition duration-[280ms]',
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2.5 scale-[0.96] opacity-0',
          className,
        )}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </GlassCard>
    </div>
  )
}
