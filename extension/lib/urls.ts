const SKIP_SCHEMES = /^(chrome|chrome-extension|edge|about|devtools|javascript|data|blob|view-source):/i;

export function isStashableTab(tab) {
  if (!tab || tab.pinned) return false;
  const url = tab.pendingUrl || tab.url || '';
  if (!url || SKIP_SCHEMES.test(url)) return false;
  if (url.startsWith('chrome://') || url.startsWith('edge://')) return false;
  return true;
}

export function isRestorableUrl(url) {
  if (!url || SKIP_SCHEMES.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
