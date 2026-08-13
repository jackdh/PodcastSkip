import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installAppLog } from './appLog'
import { initPwa } from './pwa'
import './styles.css'
import './live.css'

installAppLog()
initPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
