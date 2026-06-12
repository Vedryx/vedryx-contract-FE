import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import { AppRoutes } from './App.jsx'

export function render(url = '/') {
  return renderToString(
    <StrictMode>
      <StaticRouter location={url}>
        <AppRoutes />
      </StaticRouter>
    </StrictMode>,
  )
}

// Re-exported for the prerender script (FAQPage JSON-LD injection).
// Single source of truth: content + schema both flow from landingContent.js.
export { buildFaqSchema, faqItems } from './data/landingContent.js'
