import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles/globals.css'
import { initSentry } from './utils/sentry.js'
import { initPostHog, track } from './utils/posthog.js'
import { registerWebMcpTools } from './utils/webmcp.js'

// Fire-and-forget. No-op when VITE_SENTRY_DSN is unset.
initSentry()

// Fire-and-forget. No-op when VITE_POSTHOG_KEY is unset.
initPostHog().then(() => {
  track('landing_view', { site: 'vedryx-core-web' })
})

registerWebMcpTools()

// Global click delegation for callback CTAs — every "Request Callback"
// anchor on the site points at #submit. One listener covers nav, hero,
// closing, risk-free, footer in one place.
if (typeof window !== 'undefined') {
  document.addEventListener('click', (event) => {
    const anchor = event.target?.closest?.('a[href="#submit"]')
    if (!anchor) return
    const label = (anchor.textContent || '').trim().toLowerCase()
    const intent = label.includes('contact') ? 'contact' : 'request_callback'
    const section =
      anchor.closest('section')?.id ||
      anchor.closest('[class*="Section"]')?.className?.split(' ')[0] ||
      'unknown'
    track('cta_callback_click', {
      site: 'vedryx-core-web',
      intent,
      section,
    })
  })
}

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
