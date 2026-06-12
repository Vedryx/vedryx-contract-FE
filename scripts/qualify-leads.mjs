#!/usr/bin/env node
// scripts/qualify-leads.mjs
//
// One-shot script. Two responsibilities:
//   1. Bootstrap MongoDB indexes for the lead pipeline (idempotent).
//   2. Re-classify any existing lead_pipeline records whose icp_score is 0
//      (e.g. after classifier rule changes).
//
// Run via:
//   MONGODB_URI=... node scripts/qualify-leads.mjs            # both steps
//   MONGODB_URI=... node scripts/qualify-leads.mjs --indexes  # just indexes
//   MONGODB_URI=... node scripts/qualify-leads.mjs --reclassify
//
// Notes:
// - Safe to re-run. createIndex is idempotent.
// - Re-classification reads in batches of 500, classifies in memory, writes back.

import { MongoClient } from 'mongodb'
import { classifyLead } from '../api/_apify.js'

const URI = process.env.MONGODB_URI
const DB_NAME = process.env.MONGODB_DB || 'vedryx'
if (!URI) {
  console.error('MONGODB_URI is required')
  process.exit(1)
}

const argv = new Set(process.argv.slice(2))
const onlyIndexes = argv.has('--indexes')
const onlyReclassify = argv.has('--reclassify')
const runIndexes = !onlyReclassify
const runReclassify = !onlyIndexes

const TTL_DAYS = 90
const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60

async function main() {
  const client = new MongoClient(URI)
  await client.connect()
  try {
    const db = client.db(DB_NAME)
    const leads = db.collection('lead_pipeline')
    const runs = db.collection('pipeline_runs')
    const ledger = db.collection('pipeline_cost_ledger')

    if (runIndexes) {
      console.log('Creating indexes on lead_pipeline...')
      await leads.createIndex(
        { 'person.linkedin_url': 1 },
        { unique: true, partialFilterExpression: { 'person.linkedin_url': { $type: 'string' } } }
      )
      await leads.createIndex({ icp: 1, status: 1, scraped_at: -1 })
      await leads.createIndex({ source: 1, scraped_at: -1 })
      await leads.createIndex({ scraped_at: 1 }, { expireAfterSeconds: TTL_SECONDS, name: 'ttl_scraped_at' })

      console.log('Creating indexes on pipeline_runs...')
      await runs.createIndex({ startedAt: -1 })

      console.log('Creating indexes on pipeline_cost_ledger...')
      await ledger.createIndex({ month: 1 }, { unique: true })

      console.log('Indexes ready.')
    }

    if (runReclassify) {
      console.log('Re-classifying lead_pipeline entries with icp_score == 0...')
      const cursor = leads.find({ 'signal.icp_score': 0 }).batchSize(500)
      let touched = 0
      for await (const lead of cursor) {
        const { icp, score, matched } = classifyLead(lead)
        await leads.updateOne(
          { _id: lead._id },
          {
            $set: {
              icp,
              'signal.icp_score': score,
              'signal.routing_signals': matched,
            },
          }
        )
        touched += 1
        if (touched % 500 === 0) console.log(`  ${touched} re-classified`)
      }
      console.log(`Re-classification done: ${touched} records updated.`)
    }
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
