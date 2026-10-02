import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { App } from './App'
import { useSettings } from './state/settings'
import { requestPersistentStorage } from './db/db'

registerSW({ immediate: true })
requestPersistentStorage()

useSettings
  .getState()
  .load()
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
