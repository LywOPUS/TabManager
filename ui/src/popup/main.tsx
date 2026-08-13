import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { PopupApp } from './PopupApp'

/** 页内 iframe 嵌入：加 class，去掉独立小窗那圈灰边 */
if (window !== window.top) {
  document.body.classList.add('popup-embedded')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
)

/** 嵌入页内 iframe 时向宿主汇报高度，便于圆角裁切框跟内容走 */
function reportPanelSize() {
  if (window === window.top) return
  const h = Math.ceil(document.documentElement.scrollHeight)
  window.parent.postMessage({ type: 'tm-panel-size', height: h }, '*')
}

const ro = new ResizeObserver(() => reportPanelSize())
ro.observe(document.documentElement)
requestAnimationFrame(reportPanelSize)
