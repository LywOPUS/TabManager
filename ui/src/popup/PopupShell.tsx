import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { GlassSurface } from 'glass-lens-react'
import { JetBrainsAmbient } from '@/components/JetBrainsAmbient'
import { cn } from '@/lib/utils'

type PopupShellProps = {
  children: ReactNode
  className?: string
}

export function PopupShell({ children, className }: PopupShellProps) {
  return (
    <div
      className={cn(
        'popup-shell relative w-[320px] overflow-hidden rounded-[14px]',
        'ring-1 ring-black/8 shadow-[0_10px_32px_rgba(0,0,0,0.14)]',
        className,
      )}
    >
      <JetBrainsAmbient variant="popup" />
      <div className="relative flex flex-col gap-2 p-3">{children}</div>
    </div>
  )
}

type LensPanelProps = {
  children: ReactNode
  className?: string
  as?: 'div' | 'button'
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

/** 列表行用矩形 lens（强制 radius=12，避免 preset 的 999 胶囊） */
export function LensPanel({
  children,
  className,
  as = 'div',
  disabled,
  onClick,
  ...rest
}: LensPanelProps) {
  const surface = (
    <GlassSurface
      preset="portfolio"
      radius={12}
      blur={8}
      saturate={1.35}
      scale={18}
      bezel={9}
      thickness={0.12}
      tint={0.18}
      border={0.48}
      edge={0.35}
      glow={0.06}
      dispersion={0.03}
      reveal={as === 'button'}
    />
  )

  if (as === 'button') {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'glass-control relative w-full overflow-hidden rounded-[12px] border-0 bg-transparent',
          'cursor-pointer px-3 py-2.5 text-left text-[13px] font-medium text-[#0a0a0a]',
          'disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        {...rest}
      >
        {surface}
        <span className="relative">{children}</span>
      </button>
    )
  }

  return (
    <div
      className={cn(
        'glass-control relative overflow-hidden rounded-[12px]',
        'px-3 py-2.5 text-xs text-[#0a0a0a]',
        className,
      )}
    >
      {surface}
      <div className="relative">{children}</div>
    </div>
  )
}
