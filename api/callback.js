import { getDatabaseName, getMongoClient } from './_mongo.js'
import {
  RATE_LIMIT_COLLECTION,
  checkRateLimit,
  extractIp,
  releaseRateLimitReservation,
} from './_rateLimit.js'
import { captureRouteError } from './_sentry.js'

const REQUIRED_FIELDS = ['email', 'phone', 'role', 'summary']
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function getBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}')
  return req.body
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function validate(payload) {
  const missing = REQUIRED_FIELDS.filter((field) => !clean(payload[field]))
  if (missing.length) {
    return `Missing required fields: ${missing.join(', ')}`
  }

  if (!EMAIL_PATTERN.test(clean(payload.email))) {
    return 'Enter a valid work email.'
  }

  return null
}

export async function persistCallbackRequest({ req, payload, db, captureError = captureRouteError }) {
  const collection = db.collection('callback_requests')
  const cleanedEmail = clean(payload.email).toLowerCase()
  const cleanedPhone = clean(payload.phone)
  const ip = extractIp(req)

  const limit = await checkRateLimit({
    collection: db.collection(RATE_LIMIT_COLLECTION),
    source: 'vedryx-landing',
    ip,
    email: cleanedEmail,
    phone: cleanedPhone,
  })

  if (limit.softFailed) {
    console.warn('Callback rate limit soft-failed', limit.softFailed)
    await captureError(req, limit.softFailed, {
      source: 'vedryx-landing',
      stage: 'rate_limit',
    })
  }

  if (limit.block) {
    return { status: limit.status, body: { ok: false, message: limit.message } }
  }

  if (limit.idempotent) {
    return {
      status: 200,
      body: { ok: true, message: limit.message, idempotent: true },
    }
  }

  try {
    await collection.insertOne({
      email: cleanedEmail,
      phone: cleanedPhone,
      company: clean(payload.company),
      role: clean(payload.role),
      summary: clean(payload.summary),
      source: 'vedryx-landing',
      status: 'new',
      createdAt: new Date(),
      userAgent: req.headers['user-agent'] || '',
      ip,
    })
  } catch (error) {
    try {
      await releaseRateLimitReservation({
        collection: db.collection(RATE_LIMIT_COLLECTION),
        reservation: limit.reservation,
      })
    } catch (releaseError) {
      error.releaseRateLimitError = releaseError
    }
    throw error
  }

  return { status: 200, body: { ok: true } }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, message: 'Method not allowed' })
  }

  let payload
  try {
    payload = getBody(req)
  } catch {
    return res.status(400).json({ ok: false, message: 'Invalid request body' })
  }

  if (clean(payload.website)) {
    return res.status(200).json({ ok: true })
  }

  const validationError = validate(payload)
  if (validationError) {
    return res.status(400).json({ ok: false, message: validationError })
  }

  try {
    const client = await getMongoClient()
    const db = client.db(getDatabaseName())
    const result = await persistCallbackRequest({ req, payload, db })
    return res.status(result.status).json(result.body)
  } catch (error) {
    console.error('Callback request failed', error)
    await captureRouteError(req, error, { source: 'vedryx-landing' })
    return res.status(500).json({ ok: false, message: 'Unable to submit the request right now.' })
  }
}
