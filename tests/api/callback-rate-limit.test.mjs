import assert from 'node:assert/strict'
import test from 'node:test'

import { persistCallbackRequest } from '../../api/callback.js'
import {
  RATE_LIMIT_COLLECTION,
  checkRateLimit,
  extractIp,
  releaseRateLimitReservation,
} from '../../api/_rateLimit.js'

class MemoryRateLimitCollection {
  constructor({ fail = false, failInserts = 0 } = {}) {
    this.fail = fail
    this.failInserts = failInserts
    this.docs = new Map()
    this.indexes = []
  }

  async createIndex(keys, options) {
    if (this.fail) throw new Error('index failed')
    this.indexes.push({ keys, options })
    return Object.keys(keys).join('_')
  }

  async insertOne(document) {
    if (this.fail) throw new Error('insert failed')
    if (this.failInserts > 0) {
      this.failInserts -= 1
      throw new Error('insert failed')
    }
    const id = `${this.docs.size + 1}`
    this.docs.set(id, { ...document, _id: id })
    return { acknowledged: true, insertedId: id }
  }

  async deleteOne(filter) {
    if (this.fail) throw new Error('delete failed')
    const current = this.docs.get(filter.key)
    if (!current || current.attemptId !== filter.attemptId) {
      return { acknowledged: true, deletedCount: 0 }
    }
    this.docs.delete(filter.key)
    return { acknowledged: true, deletedCount: 1 }
  }

  async findOneAndUpdate(filter, update, options = {}) {
    if (this.fail) throw new Error('write failed')
    if (Array.isArray(update)) {
      return this.applyPipelineUpdate(filter, update, options)
    }
    return this.applyClassicUpdate(filter, update)
  }

  async applyClassicUpdate(filter, update) {
    const current = this.docs.get(filter.key) || {}
    const next = { ...current }

    if (!current.key && update.$setOnInsert) Object.assign(next, update.$setOnInsert)
    if (update.$push?.hits) {
      const hits = Array.isArray(next.hits) ? next.hits : []
      next.hits = [...hits, ...update.$push.hits.$each].slice(update.$push.hits.$slice)
    }
    if (update.$set) Object.assign(next, update.$set)

    this.docs.set(filter.key, next)
    return next
  }

  async applyPipelineUpdate(filter, update) {
    const now = update[0].$set.createdAt.$cond[0].$gt[1]
    const expiresAt = update[0].$set.expiresAt.$cond[2]
    const attemptId = update[0].$set.attemptId.$cond[2]
    const current = this.docs.get(filter.key)
    const wasActive = current?.expiresAt instanceof Date && current.expiresAt > now
    const next = {
      key: filter.key,
      wasActive,
      createdAt: wasActive ? current.createdAt : now,
      expiresAt: wasActive ? current.expiresAt : expiresAt,
      attemptId: wasActive ? current.attemptId : attemptId,
    }

    this.docs.set(filter.key, next)
    return next
  }
}

class MemoryDb {
  constructor({
    rateLimitCollection = new MemoryRateLimitCollection(),
    callbackCollection = new MemoryRateLimitCollection(),
  } = {}) {
    this.collections = new Map([
      [RATE_LIMIT_COLLECTION, rateLimitCollection],
      ['callback_requests', callbackCollection],
    ])
  }

  collection(name) {
    return this.collections.get(name)
  }
}

function req(ip = '203.0.113.10') {
  return {
    headers: {
      'x-forwarded-for': ip,
      'user-agent': 'node-test',
    },
    socket: { remoteAddress: '10.0.0.1' },
  }
}

function payload(index = 1) {
  return {
    email: `lead-${index}@vedryx.test`,
    phone: `+9199999999${index}`,
    company: 'Vedryx Test',
    role: 'Frontend (React, JS)',
    summary: 'Need senior React engineer for a dashboard build.',
  }
}

test('exports the Mongo collection used by the callback handler', () => {
  assert.equal(RATE_LIMIT_COLLECTION, 'rate_limits')
})

test('extractIp prefers the first forwarded IP', () => {
  const req = {
    headers: { 'x-forwarded-for': '203.0.113.4, 198.51.100.9' },
    socket: { remoteAddress: '10.0.0.2' },
  }

  assert.equal(extractIp(req), '203.0.113.4')
})

test('allows five requests per IP window and blocks the sixth', async () => {
  const collection = new MemoryRateLimitCollection()
  const base = { collection, source: 'vedryx-landing', ip: '203.0.113.5' }

  for (let index = 0; index < 5; index += 1) {
    const result = await checkRateLimit({
      ...base,
      email: `lead-${index}@vedryx.test`,
      phone: `+91999999999${index}`,
    })
    assert.equal(result.ok, true)
  }

  const blocked = await checkRateLimit({
    ...base,
    email: 'lead-6@vedryx.test',
    phone: '+919999999996',
  })

  assert.equal(blocked.block, true)
  assert.equal(blocked.status, 429)
})

test('returns idempotent for duplicate email and phone within dedupe window', async () => {
  const collection = new MemoryRateLimitCollection()
  const input = {
    collection,
    source: 'vedryx-landing',
    ip: '203.0.113.6',
    email: 'Same@Vedryx.test',
    phone: '+919999999997',
  }

  const first = await checkRateLimit(input)
  const second = await checkRateLimit(input)

  assert.equal(first.ok, true)
  assert.equal(second.idempotent, true)
})

test('releases only the owned dedupe reservation', async () => {
  const collection = new MemoryRateLimitCollection()
  const input = {
    collection,
    source: 'vedryx-landing',
    ip: '203.0.113.8',
    email: 'owned@vedryx.test',
    phone: '+919999999991',
  }

  const first = await checkRateLimit(input)
  await releaseRateLimitReservation({
    collection,
    reservation: { ...first.reservation, attemptId: 'wrong-owner' },
  })
  const stillBlocked = await checkRateLimit(input)
  await releaseRateLimitReservation({ collection, reservation: first.reservation })
  const allowedAfterRelease = await checkRateLimit(input)

  assert.equal(stillBlocked.idempotent, true)
  assert.equal(allowedAfterRelease.ok, true)
})

test('soft-fails open when the limiter collection is unavailable', async () => {
  const result = await checkRateLimit({
    collection: new MemoryRateLimitCollection({ fail: true }),
    source: 'vedryx-landing',
    ip: '203.0.113.7',
    email: 'lead@vedryx.test',
    phone: '+919999999998',
  })

  assert.equal(result.ok, true)
  assert.ok(result.softFailed instanceof Error)
})

test('callback persistence returns idempotent duplicate without a second lead insert', async () => {
  const db = new MemoryDb()
  const first = await persistCallbackRequest({ req: req(), payload: payload(), db })
  const second = await persistCallbackRequest({ req: req(), payload: payload(), db })
  const callbackRequests = db.collection('callback_requests')

  assert.deepEqual(first.body, { ok: true })
  assert.equal(second.body.idempotent, true)
  assert.equal(callbackRequests.docs.size, 1)
})

test('callback persistence blocks sixth IP hit before inserting a lead', async () => {
  const db = new MemoryDb()

  for (let index = 1; index <= 5; index += 1) {
    const result = await persistCallbackRequest({
      req: req('203.0.113.20'),
      payload: payload(index),
      db,
    })
    assert.equal(result.status, 200)
  }

  const blocked = await persistCallbackRequest({
    req: req('203.0.113.20'),
    payload: payload(6),
    db,
  })
  const callbackRequests = db.collection('callback_requests')

  assert.equal(blocked.status, 429)
  assert.equal(blocked.body.ok, false)
  assert.equal(callbackRequests.docs.size, 5)
})

test('failed first insert releases dedupe reservation so retry creates exactly one lead', async () => {
  const db = new MemoryDb({
    callbackCollection: new MemoryRateLimitCollection({ failInserts: 1 }),
  })

  await assert.rejects(
    () => persistCallbackRequest({ req: req('203.0.113.30'), payload: payload(), db }),
    /insert failed/
  )

  const retry = await persistCallbackRequest({
    req: req('203.0.113.30'),
    payload: payload(),
    db,
  })
  const duplicate = await persistCallbackRequest({
    req: req('203.0.113.30'),
    payload: payload(),
    db,
  })
  const callbackRequests = db.collection('callback_requests')

  assert.deepEqual(retry.body, { ok: true })
  assert.equal(duplicate.body.idempotent, true)
  assert.equal(callbackRequests.docs.size, 1)
})
