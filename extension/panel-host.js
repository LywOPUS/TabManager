/** 注入页内浮层：iframe 加载 popup.html，圆角由宿主裁切。 */
(() => {
  const WIDTH = 280
  const RADIUS = 16
  const Z = 2147483646

  // 可重复注入：每次都把 API 绑到当前实现，避免 SPA 卸掉 DOM 后留下僵尸 toggle
  if (window.__tmPanelHost && typeof window.__tmPanelHost.rebind === 'function') {
    window.__tmPanelHost.rebind()
    return
  }

  let root = null
  let iframe = null
  let open = false
  let outsideTimer = 0
  let escHandler = null

  function panelUrl() {
    return chrome.runtime.getURL('popup.html')
  }

  function isAttached() {
    return !!(root && root.isConnected)
  }

  function isVisible() {
    return open && isAttached() && root.style.display !== 'none'
  }

  function onMsg(e) {
    if (!iframe || e.source !== iframe.contentWindow) return
    const d = e.data
    if (!d || typeof d !== 'object') return
    if (d.type === 'tm-panel-close') hide()
    if (d.type === 'tm-panel-size' && typeof d.height === 'number') {
      const cap = Math.floor(window.innerHeight * 0.92)
      const h = Math.min(Math.max(Math.ceil(d.height), 140), cap)
      iframe.style.height = `${h}px`
    }
  }

  function onDocDown(e) {
    if (!isVisible()) return
    if (root.contains(/** @type {Node} */ (e.target))) return
    hide()
  }

  function onKey(e) {
    if (e.key === 'Escape' && isVisible()) hide()
  }

  function build() {
    if (isAttached()) return

    // 旧节点残留则清掉
    document.getElementById('tm-panel-host')?.remove()

    root = document.createElement('div')
    root.id = 'tm-panel-host'
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', 'Tab Manager')
    Object.assign(root.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: String(Z),
      width: `${WIDTH}px`,
      height: 'auto',
      display: 'none',
      borderRadius: `${RADIUS}px`,
      overflow: 'hidden',
      boxSizing: 'border-box',
      // 实底兜底：Ambient 未画出来前也不会「全透明看不见」
      background: '#f4f4f5',
      // 阴影放在不裁切的外层：overflow:hidden 会裁 box-shadow，故用 outline + 父级不设 overflow 的 trick
      // 这里用 filter 画圆角阴影
      filter: 'drop-shadow(0 16px 40px rgba(0,0,0,0.28)) drop-shadow(0 2px 8px rgba(0,0,0,0.14))',
      pointerEvents: 'auto',
      isolation: 'isolate',
      // 明显描边，浅色网页上也能看见边界
      outline: '1px solid rgba(0,0,0,0.12)',
      outlineOffset: '-1px',
    })

    iframe = document.createElement('iframe')
    iframe.title = 'Tab Manager'
    iframe.allow = 'clipboard-read; clipboard-write'
    Object.assign(iframe.style, {
      border: '0',
      width: `${WIDTH}px`,
      height: '360px',
      display: 'block',
      background: '#f4f4f5',
      borderRadius: `${RADIUS}px`,
    })
    iframe.addEventListener('load', () => {
      // 首帧后尽量按内容收高度（子页也会 postMessage）
      try {
        const doc = iframe.contentDocument
        if (!doc) return
        const h = Math.ceil(doc.documentElement.scrollHeight || 0)
        if (h > 0) {
          const cap = Math.floor(window.innerHeight * 0.92)
          iframe.style.height = `${Math.min(Math.max(h, 140), cap)}px`
        }
      } catch {
        // 跨域读不到时靠 postMessage
      }
    })

    root.appendChild(iframe)
    const mount = document.documentElement || document.body
    mount.appendChild(root)
    window.addEventListener('message', onMsg)
  }

  function show() {
    build()
    open = true
    root.style.display = 'block'
    // 强制提到最前（部分站点有超高 z-index 层）
    root.style.zIndex = String(Z)
    // 每次打开重新载入，避免状态陈旧 / 空白 iframe
    iframe.src = panelUrl()

    window.clearTimeout(outsideTimer)
    document.removeEventListener('mousedown', onDocDown, true)
    if (escHandler) document.removeEventListener('keydown', escHandler, true)
    escHandler = onKey
    document.addEventListener('keydown', escHandler, true)
    // 避开工具栏点击冒泡到 page 的 mousedown
    outsideTimer = window.setTimeout(() => {
      document.addEventListener('mousedown', onDocDown, true)
    }, 400)
  }

  function hide() {
    open = false
    window.clearTimeout(outsideTimer)
    document.removeEventListener('mousedown', onDocDown, true)
    if (escHandler) {
      document.removeEventListener('keydown', escHandler, true)
      escHandler = null
    }
    if (root) root.style.display = 'none'
    if (iframe) iframe.src = 'about:blank'
  }

  function toggle() {
    if (isVisible()) hide()
    else show()
  }

  function rebind() {
    // 再次注入时：若 DOM 丢了，下次 show 会 rebuild
    window.__tmTogglePanel = toggle
    window.__tmShowPanel = show
    window.__tmHidePanel = hide
  }

  rebind()
  window.__tmPanelHost = { rebind, show, hide, toggle, isVisible }

  // 兼容 background 二次 executeScript / 消息
  if (!window.__tmPanelMsgBound) {
    window.__tmPanelMsgBound = true
    chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
      if (msg?.type === 'TM_TOGGLE_PANEL') {
        toggle()
        sendResponse({ ok: true, open: isVisible() })
        return true
      }
      if (msg?.type === 'TM_SHOW_PANEL') {
        show()
        sendResponse({ ok: true, open: true })
        return true
      }
      return false
    })
  }
})()
