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

const COLLECTION = 'rate_limits'

const IP_WINDOW_MS = 10 * 60 * 1000 // 10 min
const IP_MAX = 5
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 h

let indexesReadyPromise

async function ensureIndexes(collection) {
  if (!indexesReadyPromise) {
    indexesReadyPromise = Promise.all([
      collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      collection.createIndex({ key: 1 }, { unique: true }),
    ]).catch((error) => {
      indexesReadyPromise = undefined
      throw error
    })
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

      const hits = Array.isArray(ipDoc?.value?.hits)
        ? ipDoc.value.hits
        : Array.isArray(ipDoc?.hits)
          ? ipDoc.hits
          : []
      const inWindow = hits.filter((t) => t instanceof Date && t >= ipWindowStart)

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
      const cutoff = new Date(now.getTime() - DEDUPE_WINDOW_MS)
      const existing = await collection.findOne({ key, createdAt: { $gte: cutoff } })

      if (existing) {
        return {
          idempotent: true,
          message:
            'We already have your request from earlier — Vedryx will be in touch within 1 business day.',
        }
      }

      await collection.updateOne(
        { key },
        {
          $setOnInsert: { key, createdAt: now },
          $set: { expiresAt: new Date(now.getTime() + DEDUPE_WINDOW_MS) },
        },
        { upsert: true }
      )
    }

    return { ok: true }
  } catch (error) {
    // Soft-fail: caller decides whether to capture; we just signal degraded.
    return { ok: true, softFailed: error }
  }
}
