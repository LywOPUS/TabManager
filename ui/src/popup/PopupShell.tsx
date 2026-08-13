import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { JetBrainsAmbient } from '@/components/JetBrainsAmbient'
import { cn } from '@/lib/utils'

type PopupShellProps = {
  children: ReactNode
  className?: string
}

/** 紧凑壳 + 氛围底。default_popup 铺满系统窗；页内嵌入时由 CSS 裁圆角 */
export function PopupShell({ children, className }: PopupShellProps) {
  return (
    <div
      className={cn(
        'popup-shell relative w-[280px] overflow-hidden',
        className,
      )}
    >
      <JetBrainsAmbient variant="popup" />
      <div className="relative z-[1] flex flex-col gap-2 p-3">{children}</div>
    </div>
  )
}

/* ─── icons (16×16, currentColor) ─── */

export function IconInbox({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn('size-4', className)} aria-hidden>
      <path
        d="M2.5 5.5 8 2l5.5 3.5v6A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5v-6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M2.5 6.5h3.2l1 1.8h2.6l1-1.8h3.2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

export function IconLayers({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn('size-4', className)} aria-hidden>
      <path
        d="m2.5 6.5 5.5 3 5.5-3M2.5 9.5l5.5 3 5.5-3M2.5 3.5l5.5 3 5.5-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function IconRestore({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn('size-4', className)} aria-hidden>
      <path
        d="M3.5 8a4.5 4.5 0 1 0 1.3-3.15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M3.5 3v2.5H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconGrid({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn('size-4', className)} aria-hidden>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** 解散原生标签组 */
export function IconUngroup({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn('size-4', className)} aria-hidden>
      <rect x="1.75" y="3.5" width="5.5" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="8.75" y="3.5" width="5.5" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** 合并重复 */
export function IconMerge({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn('size-4', className)} aria-hidden>
      <path
        d="M4 3.5h5.5A2.5 2.5 0 0 1 12 6v0A2.5 2.5 0 0 1 9.5 8.5H6.5A2.5 2.5 0 0 0 4 11v0a2.5 2.5 0 0 0 2.5 2.5H12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 闲置休眠 */
export function IconGauge({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn('size-4', className)} aria-hidden>
      <path
        d="M8 13.5a5.5 5.5 0 1 1 5.2-3.7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M8 8.5 10.8 5.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function IconChevronRight({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn('size-3.5', className)} aria-hidden>
      <path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconBack({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn('size-4', className)} aria-hidden>
      <path d="M10 3.5 5.5 8 10 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ─── action surfaces ─── */

type ActionButtonProps = {
  children: ReactNode
  icon?: ReactNode
  hint?: string
  primary?: boolean
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

/** 主操作（实心）或次级列表行 */
export function ActionButton({
  children,
  icon,
  hint,
  primary,
  disabled,
  className,
  ...rest
}: ActionButtonProps) {
  if (primary) {
    return (
      <button
        type="button"
        disabled={disabled}
        className={cn(
          'group flex w-full items-center justify-center gap-2 rounded-[11px] px-3 py-2.5',
          'bg-[#0a0a0a] text-[13px] font-semibold tracking-tight text-white',
          'shadow-[0_1px_2px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.04)]',
          'transition-[transform,opacity,background-color] duration-100 ease-out',
          'enabled:hover:bg-[#1a1a1a] enabled:active:scale-[0.98]',
          'disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        {...rest}
      >
        {icon && <span className="opacity-90">{icon}</span>}
        {children}
      </button>
    )
  }

  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'group flex w-full items-center gap-2.5 px-2.5 py-2 text-left',
        'text-[13px] font-medium tracking-tight text-[#0a0a0a]',
        'transition-[background-color,transform,opacity] duration-100 ease-out',
        'enabled:hover:bg-black/[0.04] enabled:active:bg-black/[0.06]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {icon && (
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-black/[0.05] text-[#3a3a3c] transition-colors group-enabled:group-hover:bg-black/[0.07]">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && (
        <span className="shrink-0 text-[11px] font-normal tabular-nums text-[#8b8b8e]">{hint}</span>
      )}
      <IconChevronRight className="shrink-0 text-[#c4c4c6] transition-transform duration-100 group-enabled:group-hover:translate-x-px group-enabled:group-hover:text-[#8b8b8e]" />
    </button>
  )
}

type ActionGroupProps = {
  children: ReactNode
  className?: string
}

/** 次级操作分组：白底卡片 + 分隔线 */
export function ActionGroup({ children, className }: ActionGroupProps) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-[11px] border border-black/[0.07] bg-white/88',
        'shadow-[0_1px_0_rgba(255,255,255,0.75)_inset]',
        'divide-y divide-black/[0.05]',
        className,
      )}
    >
      {children}
    </div>
  )
}

type MetaCardProps = {
  children: ReactNode
  className?: string
  as?: 'div' | 'button'
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

export function MetaCard({ children, className, as = 'div', disabled, onClick, ...rest }: MetaCardProps) {
  const cls = cn(
    'w-full rounded-[11px] border border-black/[0.06] bg-white/70 px-2.5 py-2',
    'text-left text-[12px] leading-snug text-[#5c5c5f]',
    'shadow-[0_1px_0_rgba(255,255,255,0.65)_inset]',
    as === 'button' &&
      'cursor-pointer transition-[background-color,transform] duration-100 ease-out enabled:hover:bg-white/85 enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40',
    className,
  )

  if (as === 'button') {
    return (
      <button type="button" disabled={disabled} onClick={onClick} className={cls} {...rest}>
        {children}
      </button>
    )
  }
  return <div className={cls}>{children}</div>
}
