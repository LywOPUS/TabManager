import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'glass-lens-react/styles.css'
import '../index.css'
import { PopupApp } from './PopupApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
)
