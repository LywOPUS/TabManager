/** 注入页内浮层：iframe 加载 popup.html，圆角由宿主裁切。 */
(() => {
  const WIDTH = 280

  if (window.__tmTogglePanel) return

  let root = null
  let iframe = null
  let open = false
  let outsideTimer = 0

  function onMsg(e) {
    if (!iframe || e.source !== iframe.contentWindow) return
    const d = e.data
    if (!d || typeof d !== 'object') return
    if (d.type === 'tm-panel-close') hide()
    if (d.type === 'tm-panel-size' && typeof d.height === 'number') {
      const h = Math.min(Math.max(Math.ceil(d.height), 120), Math.floor(window.innerHeight * 0.92))
      iframe.style.height = `${h}px`
    }
  }

  function onDocDown(e) {
    if (!open || !root) return
    if (root.contains(e.target)) return
    hide()
  }

  function ensure() {
    if (root) return
    root = document.createElement('div')
    root.id = 'tm-panel-host'
    root.setAttribute(
      'style',
      [
        'position:fixed',
        'top:12px',
        'right:12px',
        'z-index:2147483646',
        `width:${WIDTH}px`,
        'display:none',
        'border-radius:16px',
        'overflow:hidden',
        'box-shadow:0 12px 40px rgba(0,0,0,0.22)',
        'background:#f7f7f8',
        'pointer-events:auto',
      ].join(';'),
    )
    iframe = document.createElement('iframe')
    iframe.title = 'Tab Manager'
    iframe.setAttribute(
      'style',
      [
        'border:0',
        `width:${WIDTH}px`,
        'height:320px',
        'display:block',
        'background:#f7f7f8',
      ].join(';'),
    )
    root.appendChild(iframe)
    ;(document.body || document.documentElement).appendChild(root)
    window.addEventListener('message', onMsg)
  }

  function show() {
    ensure()
    open = true
    root.style.display = 'block'
    iframe.src = chrome.runtime.getURL('popup.html')
    window.clearTimeout(outsideTimer)
    // 避开工具栏点击连带的 page 事件，防止刚打开就被关掉
    outsideTimer = window.setTimeout(() => {
      document.addEventListener('mousedown', onDocDown, true)
    }, 300)
  }

  function hide() {
    if (!root) return
    open = false
    root.style.display = 'none'
    document.removeEventListener('mousedown', onDocDown, true)
    window.clearTimeout(outsideTimer)
    iframe.src = 'about:blank'
  }

  function toggle() {
    if (open) hide()
    else show()
  }

  window.__tmTogglePanel = toggle
  window.__tmShowPanel = show
  window.__tmHidePanel = hide

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'TM_TOGGLE_PANEL') {
      toggle()
      sendResponse({ ok: true, open })
      return true
    }
    return false
  })
})()
