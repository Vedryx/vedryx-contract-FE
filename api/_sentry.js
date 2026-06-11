// Server-side Sentry helper for Vercel serverless API routes.
// No-op when SENTRY_DSN is unset so this is safe to ship before the DSN
// is provisioned. Use captureRouteError(req, err) inside catch blocks.

let nodeSentry = null
let initialized = false
let initPromise = null

async function ensureInit() {
  if (initialized) return nodeSentry
  if (initPromise) return initPromise

  initPromise = (async () => {
    const dsn = process.env.SENTRY_DSN
    if (!dsn) {
      initialized = true
      return null
    }
    try {
      const Sentry = await import('@sentry/node')
      Sentry.init({
        dsn,
        environment: process.env.VERCEL_ENV || 'production',
        tracesSampleRate: 0.1,
        sendDefaultPii: false,
      })
      nodeSentry = Sentry
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Sentry node init failed', err)
    }
    initialized = true
    return nodeSentry
  })()

  return initPromise
}

export async function captureRouteError(req, error, extra = {}) {
  const Sentry = await ensureInit()
  if (!Sentry) return
  Sentry.withScope((scope) => {
    scope.setTag('route', req?.url || 'unknown')
    scope.setTag('method', req?.method || 'unknown')
    scope.setTag('source', extra.source || 'unknown')
    if (error?.code) scope.setTag('error_code', error.code)
    Sentry.captureException(error)
  })
  try {
    await Sentry.flush(2000)
  } catch {
    // best-effort
  }
}
