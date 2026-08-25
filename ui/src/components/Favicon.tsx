import { memo, useMemo, useState } from 'react'
import { isNonEmptyString } from '@ext/lib/unknown.ts'
import { cn } from '@/lib/utils'

export function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** _favicon API → 收纳时存的 favIconUrl → 域名首字母 */
export const Favicon = memo(function Favicon({
  url,
  favIconUrl,
  className,
}: {
  url: string
  favIconUrl?: string
  className?: string
}) {
  const [stage, setStage] = useState(0)
  const host = useMemo(() => domainOf(url), [url])
  const srcs = useMemo(() => {
    const extId = globalThis.chrome?.runtime?.id
    return [
      extId ? `chrome-extension://${extId}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32` : '',
      favIconUrl || '',
    ].filter(isNonEmptyString)
  }, [url, favIconUrl])

  if (stage >= srcs.length) {
    return (
      <span
        aria-hidden
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-black/8 text-[9px] font-semibold uppercase text-muted-foreground',
          className,
        )}
      >
        {host.charAt(0) || '·'}
      </span>
    )
  }
  return (
    <img
      src={srcs[stage]}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setStage((s) => s + 1)}
      className={cn('size-4 shrink-0 rounded-[4px]', className)}
    />
  )
})
