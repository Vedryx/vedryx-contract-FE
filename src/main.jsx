import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles/globals.css'
import { initSentry } from './utils/sentry.js'

// Fire-and-forget. No-op when VITE_SENTRY_DSN is unset.
initSentry()

const root = document.getElementById('root')
const app = (
  <StrictMode>
    <App />
  </StrictMode>
)

if (root.hasChildNodes()) {
  hydrateRoot(root, app)
} else {
  createRoot(root).render(app)
}
