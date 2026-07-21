import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { GlassCard } from '@/components/ui/glasscn/glass-card'

type Props = {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  dismissible?: boolean
  /** 无障碍：对话框名称 */
  label?: string
}

export function Modal({ open, onClose, children, className, dismissible = true, label }: Props) {
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

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

  // 打开时聚焦对话框内首个可聚焦控件；关闭后还给焦点
  useEffect(() => {
    if (!open || !shown) return
    prevFocusRef.current = document.activeElement as HTMLElement | null
    const root = overlayRef.current?.querySelector<HTMLElement>('[role="dialog"]')
    if (!root) return
    const focusable = root.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    ;(focusable || root).focus()
    return () => {
      prevFocusRef.current?.focus?.()
    }
  }, [open, shown])

  if (!mounted) return null

  return (
    <div
      ref={overlayRef}
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-[var(--space-5)]',
        'transition-opacity duration-[var(--dur-panel)] ease-[var(--ease-out)]',
        shown ? 'opacity-100' : 'opacity-0 ease-[var(--ease-in)]',
      )}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose()
      }}
      role="presentation"
    >
      <GlassCard
        tabIndex={-1}
        surfaceClassName="rounded-[var(--radius-xl)] shadow-[var(--shadow-float)]"
        className={cn(
          'max-h-[80vh] w-[min(480px,92vw)] overflow-auto px-[var(--space-5)] py-[var(--space-5)] outline-none',
          'transition duration-[var(--dur-panel)] ease-[var(--ease-out)]',
          'focus-visible:ring-2 focus-visible:ring-ring/30',
          shown
            ? 'translate-y-0 scale-100 opacity-100'
            : 'translate-y-2.5 scale-[0.96] opacity-0 ease-[var(--ease-in)]',
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </GlassCard>
    </div>
  )
}
