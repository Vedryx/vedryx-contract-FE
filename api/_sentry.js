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

/**
 * Is this error an expected, handled AbortController timeout fired by our own
 * stage-timeout logic (not a genuine fatal abort)?
 *
 * Rules:
 *  - Must be an AbortError (name === 'AbortError' or message matches the
 *    Node fetch "operation was aborted" string).
 *  - Must NOT be marked fatal: true. Fatal aborts (top-level catch blocks)
 *    represent truly unexpected failures and must still page.
 *  - Must NOT come from an unknown origin — we only downgrade when a stage
 *    name is present (i.e. the caller identified the context).
 *
 * When this returns true we downgrade from captureException → captureMessage
 * at 'warning' level. The event still lands in Sentry for debugging but does
 * not count against the error quota or trigger inbox noise.
 */
function isExpectedStageAbort(error, extra) {
  if (extra.fatal === true) return false
  const isAbort =
    error?.name === 'AbortError' ||
    /operation was aborted/i.test(String(error?.message || '')) ||
    /aborted/i.test(String(error?.name || ''))
  if (!isAbort) return false
  // Only downgrade when caller supplied a stage tag — ensures we don't
  // accidentally suppress an AbortError that slips through an untagged path.
  const hasStageContext = Boolean(extra.stage || extra.errorKind === 'client-timeout')
  return hasStageContext
}

export async function captureRouteError(req, error, extra = {}) {
  const Sentry = await ensureInit()
  if (!Sentry) return
  Sentry.withScope((scope) => {
    scope.setTag('route', req?.url || 'unknown')
    scope.setTag('method', req?.method || 'unknown')
    scope.setTag('source', extra.source || 'unknown')
    if (error?.code) scope.setTag('error_code', error.code)
    if (extra.stage) scope.setTag('stage', extra.stage)
    if (extra.errorKind) scope.setTag('error_kind', extra.errorKind)
    if (extra.fatal) scope.setTag('fatal', 'true')

    if (isExpectedStageAbort(error, extra)) {
      // Handled stage-timeout abort: downgrade to warning. Not a bug —
      // AbortController fired because Apify API was slow (or the stage
      // ceiling was too tight). Still visible in Sentry for triage but
      // does not create an unresolved error issue or eat error quota.
      Sentry.captureMessage(
        `[stage-timeout] ${extra.stage || 'unknown'}: ${error?.message || 'AbortError'}`,
        { level: 'warning' }
      )
    } else {
      // All other errors — including fatal: true, unknown origin, and any
      // non-abort error — remain full captureException so they page.
      Sentry.captureException(error)
    }
  })
  try {
    await Sentry.flush(2000)
  } catch {
    // best-effort
  }
}

/**
 * Drop a Sentry breadcrumb so debugging long-running serverless invocations is
 * possible after the fact. No-op when Sentry is not initialized (no DSN). Use
 * for stage entry/exit and notable counters in cron handlers.
 *
 * @param {string} category   stage / subsystem name, e.g. 'dentist-cron'
 * @param {string} message    short, human-readable event
 * @param {object} [data]     structured payload (counters, ids, etc.)
 * @param {'info'|'warning'|'error'} [level]
 */
export async function breadcrumb(category, message, data = {}, level = 'info') {
  const Sentry = await ensureInit()
  if (!Sentry) return
  try {
    Sentry.addBreadcrumb({ category, message, data, level })
  } catch {
    // best-effort
  }
}
