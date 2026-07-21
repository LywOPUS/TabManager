import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type PopupShellProps = {
  children: ReactNode
  className?: string
}

/** ponytail: 无 Ambient/GlassSurface；圆角靠壳 + body 透明留边，不靠玻璃特效 */
export function PopupShell({ children, className }: PopupShellProps) {
  return (
    <div
      className={cn(
        'popup-shell w-[280px] overflow-hidden rounded-[16px] bg-[#f7f7f8]',
        'ring-1 ring-black/10',
        className,
      )}
    >
      <div className="flex flex-col gap-1.5 p-2.5">{children}</div>
    </div>
  )
}

type LensTone = 'default' | 'primary' | 'quiet' | 'meta'

type LensPanelProps = {
  children: ReactNode
  className?: string
  as?: 'div' | 'button'
  tone?: LensTone
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

const toneClass: Record<LensTone, string> = {
  primary: 'border-black/15 bg-white px-3 py-2 text-[13px] font-semibold tracking-tight shadow-sm',
  default: 'border-black/10 bg-white/90 px-3 py-2 text-[13px] font-medium',
  quiet: 'border-transparent bg-black/[0.04] px-3 py-1.5 text-[12.5px] font-normal text-[#3a3a3c]',
  meta: 'border-black/8 bg-black/[0.03] px-2.5 py-1.5 text-[12px] leading-snug',
}

export function LensPanel({
  children,
  className,
  as = 'div',
  tone = 'default',
  disabled,
  onClick,
  ...rest
}: LensPanelProps) {
  const cls = cn(
    'w-full rounded-[10px] border text-left text-[#0a0a0a]',
    toneClass[tone],
    as === 'button' &&
      'cursor-pointer transition-[transform,background-color] duration-100 enabled:active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40',
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
