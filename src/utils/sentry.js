// Sentry browser SDK init. No-op when VITE_SENTRY_DSN is unset so this is
// safe to ship before the DSN is provisioned. Once the DSN lands in Vercel
// env, the next deploy turns telemetry on with no further code changes.
//
// Free tier budget: 5K errors / 10K perf events per month. We keep
// tracesSampleRate low and disable session replay to stay inside it.

let initialized = false

export async function initSentry() {
  if (initialized) return
  if (typeof window === 'undefined') return

  const dsn = import.meta.env?.VITE_SENTRY_DSN
  if (!dsn) return

  try {
    const Sentry = await import('@sentry/browser')
    Sentry.init({
      dsn,
      environment: import.meta.env?.MODE || 'production',
      tracesSampleRate: 0.1,
      // PII: scrub default PII. Callback form collects work email + phone.
      sendDefaultPii: false,
      beforeBreadcrumb(breadcrumb) {
        if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
          if (breadcrumb.data?.url?.includes('/api/callback')) {
            delete breadcrumb.data.request_body
            delete breadcrumb.data.response_body
          }
        }
        return breadcrumb
      },
    })
    initialized = true
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Sentry init failed', err)
  }
}
