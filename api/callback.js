import { getDatabaseName, getMongoClient } from './_mongo.js'

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
    const collection = db.collection('callback_requests')

    await collection.insertOne({
      email: clean(payload.email).toLowerCase(),
      phone: clean(payload.phone),
      company: clean(payload.company),
      role: clean(payload.role),
      summary: clean(payload.summary),
      source: 'vedryx-landing',
      status: 'new',
      createdAt: new Date(),
      userAgent: req.headers['user-agent'] || '',
      ip: clean(req.headers['x-forwarded-for']).split(',')[0] || req.socket?.remoteAddress || '',
    })

    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('Callback request failed', error)
    return res.status(500).json({ ok: false, message: 'Unable to submit the request right now.' })
  }
}
