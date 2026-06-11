import { getDatabaseName, getMongoClient } from './_mongo.js'

// Read-only aggregation endpoint. Token-gated. Used for internal CFO/CMO reporting.
// Returns lead counts grouped by `source` and ISO week for the last N weeks.

const DEFAULT_WEEKS = 12

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ ok: false, message: 'Method not allowed' })
  }

  const expected = process.env.LEAD_STATS_TOKEN
  const provided = req.headers['x-stats-token'] || (req.query && req.query.token)
  if (!expected || provided !== expected) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' })
  }

  const weeks = Math.max(1, Math.min(52, parseInt((req.query && req.query.weeks) || DEFAULT_WEEKS, 10)))

  try {
    const client = await getMongoClient()
    const db = client.db(getDatabaseName())
    const collection = db.collection('callback_requests')

    // Boundary: start of ISO week (Mon UTC) N weeks ago.
    // Use UTC throughout to keep weeks deterministic.
    const now = new Date()
    const utcNow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const dayOfWeek = utcNow.getUTCDay() // 0 Sun .. 6 Sat
    const daysFromMonday = (dayOfWeek + 6) % 7
    const thisWeekMonday = new Date(utcNow)
    thisWeekMonday.setUTCDate(utcNow.getUTCDate() - daysFromMonday)
    const since = new Date(thisWeekMonday)
    since.setUTCDate(thisWeekMonday.getUTCDate() - 7 * (weeks - 1))

    const total = await collection.countDocuments({})
    const distinctSources = await collection.distinct('source')

    const firstDoc = await collection
      .find({}, { projection: { createdAt: 1, _id: 0 } })
      .sort({ createdAt: 1 })
      .limit(1)
      .toArray()
    const lastDoc = await collection
      .find({}, { projection: { createdAt: 1, _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray()

    const grouped = await collection
      .aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: {
              source: '$source',
              isoYear: { $isoWeekYear: '$createdAt' },
              isoWeek: { $isoWeek: '$createdAt' },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.isoYear': 1, '_id.isoWeek': 1, '_id.source': 1 } },
      ])
      .toArray()

    return res.status(200).json({
      ok: true,
      meta: {
        totalDocs: total,
        distinctSources,
        firstCreatedAt: firstDoc[0]?.createdAt || null,
        lastCreatedAt: lastDoc[0]?.createdAt || null,
        windowStartUtc: since.toISOString(),
        weeksRequested: weeks,
      },
      buckets: grouped.map((g) => ({
        source: g._id.source,
        isoYear: g._id.isoYear,
        isoWeek: g._id.isoWeek,
        count: g.count,
      })),
    })
  } catch (error) {
    console.error('Lead stats query failed', error)
    return res.status(500).json({ ok: false, message: 'Query failed' })
  }
}
