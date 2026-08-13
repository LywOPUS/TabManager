/** 打开管理页。hash 如 `#organize` / `#dedup`；弹窗会关掉自己。 */
export function openManagement(hash = '') {
  const h = !hash || hash.startsWith('#') ? hash : `#${hash}`
  void chrome.runtime.sendMessage({ type: 'OPEN_MANAGEMENT', hash: h })
  if (typeof window === 'undefined') return
  if (window !== window.top) {
    window.parent.postMessage({ type: 'tm-panel-close' }, '*')
    return
  }
  if (document.body.classList.contains('popup-body')) window.close()
}
