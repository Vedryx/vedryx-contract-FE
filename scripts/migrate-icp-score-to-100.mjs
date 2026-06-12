#!/usr/bin/env node
// scripts/migrate-icp-score-to-100.mjs
//
// One-time migration: rescale signal.icp_score from the old 0-1 range to the
// new 0-100 weighted-rubric range (RA §6.7, lead-quality-throttle/cto-001).
//
// Runs idempotently — any document whose icp_score is already > 1 is skipped
// (it has already been migrated, or was written by post-deploy classifyLead
// which writes 0-100 directly). Documents with scores in [0, 1] are multiplied
// by 100 and rounded; scores of exactly 0 are left unchanged (disqualified
// leads stay at 0).
//
// Also backfills `status` (priority/queued/review/disqualified) from the new
// score so the telecaller surface query (status: { $in: ['priority','queued']})
// returns historical leads consistently with new ones.
//
// Run:
//   MONGODB_URI=... node scripts/migrate-icp-score-to-100.mjs
//   MONGODB_URI=... DRY_RUN=1 node scripts/migrate-icp-score-to-100.mjs
//
// Exits non-zero on connection / write failures.

import process from 'node:process'

const COLLECTION = 'lead_pipeline'

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error('MONGODB_URI is required')
    process.exit(1)
  }
  const dryRun = Boolean(process.env.DRY_RUN)

  // Lazy import so this script can be linted without the dep installed in
  // unrelated environments.
  const { MongoClient } = await import('mongodb')
  const client = new MongoClient(uri)
  await client.connect()
  try {
    // Pick database name the same way api/_mongo.js does.
    const dbName = process.env.MONGODB_DB || client.options?.dbName || 'vedryx'
    const db = client.db(dbName)
    const col = db.collection(COLLECTION)

    // Documents to migrate: icp_score present, > 0, <= 1.
    // We exclude exactly 0 because disqualified leads already correctly read 0
    // on the new scale. We exclude > 1 because those are already-migrated docs.
    const query = {
      'signal.icp_score': { $gt: 0, $lte: 1 },
    }
    const total = await col.countDocuments(query)
    console.log(`[migrate-icp-score] candidates: ${total}`)

    if (dryRun) {
      console.log('[migrate-icp-score] DRY_RUN=1 — no writes')
      return
    }

    if (total === 0) {
      console.log('[migrate-icp-score] nothing to migrate')
      return
    }

    let migrated = 0
    let statusBackfilled = 0
    const cursor = col.find(query, { projection: { _id: 1, signal: 1, icp: 1 } })
    for await (const doc of cursor) {
      const old = Number(doc.signal?.icp_score) || 0
      const next = Math.max(0, Math.min(100, Math.round(old * 100)))
      const isDisqualified = doc.icp === 'disqualified'
      let status
      if (isDisqualified) status = 'disqualified'
      else if (next >= 80) status = 'priority'
      else if (next >= 70) status = 'queued'
      else if (next >= 50) status = 'review'
      else status = 'disqualified'

      const setOps = {
        'signal.icp_score': next,
        status,
      }
      const r = await col.updateOne({ _id: doc._id }, { $set: setOps })
      if (r.modifiedCount) {
        migrated += 1
        statusBackfilled += 1
      }
    }
    console.log(`[migrate-icp-score] migrated=${migrated} status_backfilled=${statusBackfilled}`)
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
