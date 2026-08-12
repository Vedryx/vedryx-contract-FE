// Mongo-backed rate limiter and dedupe for /api/callback.
//
// Two checks, run in order:
//   1. IP rate limit — 5 requests per IP per 10 minutes (sliding window via TTL).
//   2. Dedupe — same email+phone seen in last 24h returns an idempotent 200 with
//      no new insert. Phone is optional now, so the dedupe key falls back to
//      email-only when phone is absent.
//
// Soft-fail posture: if Mongo is unreachable, we log + capture to Sentry and
// allow the request through. Blocking legitimate leads on infra flake is worse
// than letting a rare double-submit through during an outage.
//
// Storage: `rate_limits` collection, one doc per IP, one per identity key.
// Both docs carry an `expiresAt` field; a TTL index removes them automatically.

export const RATE_LIMIT_COLLECTION = 'rate_limits'

const IP_WINDOW_MS = 10 * 60 * 1000 // 10 min
const IP_MAX = 5
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 h

const indexPromises = new WeakMap()

async function ensureIndexes(collection) {
  let indexesReadyPromise = indexPromises.get(collection)
  if (!indexesReadyPromise) {
    indexesReadyPromise = Promise.all([
      collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      collection.createIndex({ key: 1 }, { unique: true }),
    ]).catch((error) => {
      indexPromises.delete(collection)
      throw error
    })
    indexPromises.set(collection, indexesReadyPromise)
  }
  await indexesReadyPromise
}

export function extractIp(req) {
  const forwarded = req.headers?.['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return req.socket?.remoteAddress || ''
}

function dedupeKey(source, email, phone) {
  const e = (email || '').toLowerCase().trim()
  const p = (phone || '').trim()
  if (!e) return null
  return p ? `${source}:dedupe:${e}|${p}` : `${source}:dedupe:${e}`
}

function createAttemptId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getReturnedDocument(result) {
  return result?.value || result
}

function asDate(value) {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

/**
 * Check + record rate limit. Returns one of:
 *   { ok: true }                                   — proceed with insert
 *   { block: true, status: 429, message: '...' }   — IP rate-limited
 *   { idempotent: true, message: '...' }           — already submitted recently
 *
 * On infra failure, returns { ok: true, softFailed: error } so the caller can
 * Sentry-capture and continue.
 *
 * @param {object} args
 * @param {import('mongodb').Collection} args.collection
 * @param {string} args.source - 'vedryx-landing' or 'vedryx-pulse-landing'
 * @param {string} args.ip
 * @param {string} args.email
 * @param {string} args.phone
 */
export async function checkRateLimit({ collection, source, ip, email, phone }) {
  try {
    await ensureIndexes(collection)
    const now = new Date()

    // --- 1. IP window ---
    if (ip) {
      const ipKey = `${source}:ip:${ip}`
      const ipWindowStart = new Date(now.getTime() - IP_WINDOW_MS)

      const ipDoc = await collection.findOneAndUpdate(
        { key: ipKey },
        {
          $push: {
            hits: {
              $each: [now],
              $slice: -50, // safety cap on the array size
            },
          },
          $setOnInsert: { key: ipKey, createdAt: now },
          $set: { expiresAt: new Date(now.getTime() + IP_WINDOW_MS) },
        },
        { upsert: true, returnDocument: 'after' }
      )

      const ipRecord = getReturnedDocument(ipDoc)
      const hits = Array.isArray(ipRecord?.hits) ? ipRecord.hits : []
      const inWindow = hits.filter((t) => {
        const hitAt = asDate(t)
        return hitAt && hitAt >= ipWindowStart
      })

      if (inWindow.length > IP_MAX) {
        return {
          block: true,
          status: 429,
          message: 'Too many requests. Please try again in a few minutes.',
        }
      }
    }

    // --- 2. Dedupe ---
    const key = dedupeKey(source, email, phone)
    if (key) {
      const expiresAt = new Date(now.getTime() + DEDUPE_WINDOW_MS)
      const attemptId = createAttemptId()
      const dedupeDoc = await collection.findOneAndUpdate(
        { key },
        [
          {
            $set: {
              key,
              wasActive: { $gt: ['$expiresAt', now] },
              createdAt: {
                $cond: [{ $gt: ['$expiresAt', now] }, '$createdAt', now],
              },
              expiresAt: {
                $cond: [{ $gt: ['$expiresAt', now] }, '$expiresAt', expiresAt],
              },
              attemptId: {
                $cond: [{ $gt: ['$expiresAt', now] }, '$attemptId', attemptId],
              },
            },
          },
        ],
        { upsert: true, returnDocument: 'after' }
      )

      if (getReturnedDocument(dedupeDoc)?.wasActive) {
        return {
          idempotent: true,
          message:
            'We already have your request from earlier — Vedryx will be in touch within 1 business day.',
        }
      }

      return { ok: true, reservation: { key, attemptId } }
    }

    return { ok: true }
  } catch (error) {
    // Soft-fail: caller decides whether to capture; we just signal degraded.
    return { ok: true, softFailed: error }
  }
}

export async function releaseRateLimitReservation({ collection, reservation }) {
  if (!reservation?.key || !reservation?.attemptId) return
  await collection.deleteOne({
    key: reservation.key,
    attemptId: reservation.attemptId,
  })
}
