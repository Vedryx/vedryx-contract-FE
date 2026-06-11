// PostHog browser SDK init + named-event helpers. No-op when
// VITE_POSTHOG_KEY is unset so this is safe to ship before the project
// is provisioned.

let initialized = false
let posthogRef = null
let initPromise = null

async function ensureInit() {
  if (initialized) return posthogRef
  if (initPromise) return initPromise
  if (typeof window === 'undefined') return null

  initPromise = (async () => {
    const key = import.meta.env?.VITE_POSTHOG_KEY
    if (!key) {
      initialized = true
      return null
    }
    try {
      const mod = await import('posthog-js')
      const posthog = mod.default ?? mod
      posthog.init(key, {
        api_host: import.meta.env?.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
        person_profiles: 'identified_only',
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: true,
        disable_session_recording: true,
        sanitize_properties(properties) {
          const PII_KEYS = ['email', 'phone', 'summary']
          for (const key of Object.keys(properties || {})) {
            if (PII_KEYS.some((p) => key.toLowerCase().includes(p))) {
              properties[key] = '[redacted]'
            }
          }
          return properties
        },
      })
      posthogRef = posthog
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('PostHog init failed', err)
    }
    initialized = true
    return posthogRef
  })()

  return initPromise
}

export async function initPostHog() {
  await ensureInit()
}

export async function track(eventName, props = {}) {
  const posthog = await ensureInit()
  if (!posthog) return
  posthog.capture(eventName, props)
}
