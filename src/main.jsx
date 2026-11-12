import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// When a new version of the app has been downloaded, switch to it right away (instead of needing two reloads).
// If someone is in the middle of uploading photos, wait until they come back to the app.
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller)
  let reloading = false
  const reload = () => {
    if (reloading) return
    if (document.querySelector('[data-uploading="true"]')) return setTimeout(reload, 5000)
    reloading = true
    window.location.reload()
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) reload() })
}
