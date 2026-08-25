const SKIP_SCHEMES = /^(chrome|chrome-extension|edge|about|devtools|javascript|data|blob|view-source):/i

export type UrlTab = {
  pinned?: boolean
  url?: string
  pendingUrl?: string
}

export function isStashableTab(tab: UrlTab | null | undefined): boolean {
  if (!tab || tab.pinned) return false
  const url = tab.pendingUrl || tab.url || ''
  if (!url || SKIP_SCHEMES.test(url)) return false
  if (url.startsWith('chrome://') || url.startsWith('edge://')) return false
  return true
}

export function isRestorableUrl(url: string | undefined): url is string {
  if (!url || SKIP_SCHEMES.test(url)) return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
