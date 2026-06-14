// Dentist grader cron — drains pending Apify runs + grades unchecked leads.
//
// Triggered by GitHub Actions every 10 minutes (see
// .github/workflows/dentist-grader.yml). Two jobs per invocation:
//
//   JOB A — Drain `pending_scrape_runs`:
//     For each queued/running pending run:
//       - GET Apify run status
//       - if SUCCEEDED → fetch dataset items, normalize, upsert into
//         `pulse_local_leads` with checked=false (dedup via compound unique
//         index on (placeId, cid, fid)). Mark pending doc processed.
//       - if FAILED   → mark pending doc failed; Sentry breadcrumb.
//       - if RUNNING  → leave alone; next tick checks again.
//
//   JOB B — Grade `pulse_local_leads` where checked=false:
//     - take GRADER_BATCH_SIZE (15) unchecked rows
//     - PSI grade each (concurrency 16, proven on the monolith)
//     - update doc: checked=true, pagespeed, flag, graded_at
//     - if passes AND gate → upsert into `valid_pulse_leads`, mark
//       outcome='lead'. Else outcome='discarded' + discard_reason.
//
// Same auth as the scraper cron (CRON_SECRET, Authorization Bearer or
// x-cron-secret header). Same Sentry breadcrumb pattern. Same shared
// pipeline_cost_ledger (cost lands during Job A when we read Apify's
// usageTotalUsd post-run).

import { getDatabaseName, getMongoClient } from './_mongo.js'
import { breadcrumb, captureRouteError } from './_sentry.js'
import {
  getActorRunStatus,
  fetchDatasetItems,
  recordActorCost,
} from './_apify.js'
import {
  getCollectionNames,
  normalizeGoogleMapsDentist,
  gradeWebsiteWithPsi,
  landsInDb,
  mapBounded,
} from './_dentist.js'

const PSI_CONCURRENCY = 16
const PSI_DELAY_MS = 200
const GRADER_BATCH_SIZE = 15
const MAX_PENDING_PER_TICK = 10 // soft ceiling on Job A drain

// -------------------- Job A: drain pending_scrape_runs --------------------

/**
 * Why a lead failed the AND gate. Order matters — first match wins.
 * Mirrors the iter-8 monolith's whyDropped so the discard_reason taxonomy
 * stays stable across the architectural split.
 */
function whyDropped(lead) {
  if (typeof lead.name !== 'string' || !lead.name.trim()) return 'no-name'
  if (typeof lead.phone !== 'string' || lead.phone.replace(/\D/g, '').length < 7) return 'no-phone'
  if (typeof lead.website !== 'string' || !lead.website.trim()) return 'no-website'
  if (!Number.isFinite(lead.pagespeed)) return 'psi-error'
  if (lead.pagespeed >= 50) return 'site_too_good'
  if (typeof lead.flag !== 'string' || !lead.flag.trim()) return 'no-flag'
  return 'unknown'
}

async function drainPendingRuns({ db, cols, req, summary }) {
  const pendingCol = db.collection(cols.PENDING_RUNS)
  const leadsCol = db.collection(cols.LEADS)

  // Idempotent index setup — leads collection.
  // Compound unique index on (placeId, cid, fid) per RA §5 + brief §4.
  // Partial filter so docs with NULL on all three (legacy or first-run
  // anomalies) don't collide. RA-recommended dedup stability.
  await leadsCol.createIndex(
    { placeId: 1, cid: 1, fid: 1 },
    {
      unique: true,
      partialFilterExpression: {
        $or: [
          { placeId: { $type: 'string' } },
          { cid: { $type: 'string' } },
          { fid: { $type: 'string' } },
        ],
      },
      name: 'dedup_placeId_cid_fid',
    }
  )
  await leadsCol.createIndex({ checked: 1, scraped_at: 1 })
  await leadsCol.createIndex({ city: 1, scraped_at: -1 })
  await leadsCol.createIndex({ outcome: 1 })

  const pending = await pendingCol
    .find({ status: { $in: ['queued', 'running'] } })
    .sort({ started_at: 1 })
    .limit(MAX_PENDING_PER_TICK)
    .toArray()

  summary.pendingFound = pending.length
  if (!pending.length) return

  for (const doc of pending) {
    let statusRes
    try {
      statusRes = await getActorRunStatus(doc.runId)
    } catch (err) {
      console.warn('[grader] run-status fetch failed', doc.runId, err?.message)
      await captureRouteError(req, err, { stage: 'job-a-status', runId: doc.runId })
      continue
    }

    const { status: apifyStatus, usageTotalUsd, datasetId } = statusRes

    if (apifyStatus === 'RUNNING' || apifyStatus === 'READY') {
      // Still in flight. Update apifyStatus + status=running. Next tick checks.
      await pendingCol.updateOne(
        { _id: doc._id },
        { $set: { apifyStatus, status: 'running', last_polled_at: new Date() } }
      )
      summary.stillRunning += 1
      continue
    }

    if (apifyStatus === 'SUCCEEDED') {
      const useDatasetId = datasetId || doc.datasetId
      let items
      try {
        const fetched = await fetchDatasetItems(useDatasetId)
        items = fetched.items
      } catch (err) {
        console.warn('[grader] dataset fetch failed', useDatasetId, err?.message)
        await captureRouteError(req, err, { stage: 'job-a-dataset', runId: doc.runId, datasetId: useDatasetId })
        await pendingCol.updateOne(
          { _id: doc._id },
          { $set: { status: 'failed', failed_reason: 'dataset-fetch', finished_at: new Date() } }
        )
        summary.failed += 1
        continue
      }

      // Normalize + upsert with dedup.
      let normalized = 0
      let unnamedDropped = 0
      let inserted = 0
      let duplicatesSkipped = 0
      const now = new Date()
      for (const raw of items) {
        const norm = normalizeGoogleMapsDentist(raw)
        if (!norm) {
          unnamedDropped += 1
          continue
        }
        normalized += 1

        // Build dedup query: prefer placeId, else cid, else fid, else phone
        // (last-resort for legacy rows that lack identity keys).
        const orParts = []
        if (norm.placeId) orParts.push({ placeId: norm.placeId })
        if (norm.cid) orParts.push({ cid: norm.cid })
        if (norm.fid) orParts.push({ fid: norm.fid })
        if (!orParts.length && norm.phone) orParts.push({ phone: norm.phone })

        const setOnInsert = {
          first_seen: now,
          checked: false,
          outcome: null,
          discard_reason: null,
          pagespeed: null,
          flag: null,
          graded_at: null,
          status: 'queued',
        }

        try {
          if (!orParts.length) {
            // No usable dedup key at all — insert as new.
            await leadsCol.insertOne({
              ...setOnInsert,
              name: norm.name,
              phone: norm.phone,
              email: norm.email ?? null,
              website: norm.website,
              address: norm.address,
              category: norm.category,
              placeId: norm.placeId,
              cid: norm.cid,
              fid: norm.fid,
              city: doc.city.city,
              state: doc.city.state,
              scraped_at: now,
            })
            inserted += 1
            continue
          }
          const result = await leadsCol.updateOne(
            { $or: orParts },
            {
              $set: {
                name: norm.name,
                phone: norm.phone,
                email: norm.email ?? null,
                website: norm.website,
                address: norm.address,
                category: norm.category,
                placeId: norm.placeId,
                cid: norm.cid,
                fid: norm.fid,
                city: doc.city.city,
                state: doc.city.state,
                scraped_at: now,
              },
              $setOnInsert: setOnInsert,
            },
            { upsert: true }
          )
          if (result.upsertedCount) inserted += 1
          else duplicatesSkipped += 1
        } catch (err) {
          if (err?.code === 11000) {
            duplicatesSkipped += 1
          } else {
            console.warn('[grader] upsert error', err?.message)
          }
        }
      }

      // Cost ledger — measured if Apify returned usage, else projection.
      try {
        await recordActorCost(db, doc.actorId || 'compass/crawler-google-places', {
          runUsageUsd: usageTotalUsd,
          itemCount: items.length,
        }, { ledgerCollection: cols.LEDGER })
      } catch (err) {
        console.warn('[grader] ledger write failed', err?.message)
        await captureRouteError(req, err, { stage: 'job-a-ledger', runId: doc.runId })
      }

      await pendingCol.updateOne(
        { _id: doc._id },
        {
          $set: {
            status: 'processed',
            apifyStatus,
            items_pulled: items.length,
            inserted_new: inserted,
            duplicates_skipped: duplicatesSkipped,
            unnamed_dropped: unnamedDropped,
            normalized,
            finished_at: new Date(),
            usage_total_usd: usageTotalUsd,
          },
        }
      )

      summary.processed += 1
      summary.itemsPulled += items.length
      summary.insertedNew += inserted
      summary.duplicatesSkipped += duplicatesSkipped
      await breadcrumb('dentist-grader', 'job-a:succeeded', {
        runId: doc.runId, items: items.length, inserted, duplicatesSkipped,
      })
      continue
    }

    // FAILED / ABORTED / TIMED-OUT.
    await pendingCol.updateOne(
      { _id: doc._id },
      {
        $set: {
          status: 'failed',
          apifyStatus,
          failed_reason: `apify-${apifyStatus.toLowerCase()}`,
          finished_at: new Date(),
        },
      }
    )
    await breadcrumb('dentist-grader', 'job-a:failed', {
      runId: doc.runId, apifyStatus,
    }, 'warning')
    summary.failed += 1
  }
}

// -------------------- Job B: grade unchecked leads --------------------

async function gradeUnchecked({ db, cols, req, apiKey, summary }) {
  const leadsCol = db.collection(cols.LEADS)
  const validCol = db.collection(cols.VALID)

  // Idempotent indexes — valid collection.
  await validCol.createIndex({ placeId: 1 }, { unique: true, sparse: true })
  await validCol.createIndex({ city: 1, scraped_at: -1 })

  if (!apiKey) {
    summary.gradingSkipped = 'no-pagespeed-api-key'
    return
  }

  const batch = await leadsCol
    .find({ checked: false })
    .sort({ scraped_at: 1 })
    .limit(GRADER_BATCH_SIZE)
    .toArray()

  summary.gradeBatchSize = batch.length
  if (!batch.length) return

  await breadcrumb('dentist-grader', 'job-b:enter', { batch: batch.length })

  // Split gradable / ungradable so AND-gate accounting is honest.
  const gradable = batch.filter((r) => typeof r.website === 'string' && r.website.length > 0)
  const ungradable = batch.filter((r) => !r.website)

  let graded
  try {
    graded = await mapBounded(
      gradable,
      async (row) => {
        const psi = await gradeWebsiteWithPsi(row.website, apiKey, { timeoutMs: 30_000 })
        return { ...row, pagespeed: psi.score, flag: psi.flag, psiError: psi.error }
      },
      { concurrency: PSI_CONCURRENCY, delayMs: PSI_DELAY_MS }
    )
  } catch (err) {
    console.warn('[grader] PSI batch failed', err?.message)
    await captureRouteError(req, err, { stage: 'job-b-psi' })
    summary.gradingError = String(err?.message || err)
    return
  }
  if (!Array.isArray(graded)) graded = []

  const now = new Date()
  const allGraded = [
    ...graded,
    ...ungradable.map((r) => ({ ...r, pagespeed: null, flag: null })),
  ]

  let promoted = 0
  let discarded = 0
  const discardReasons = {}

  for (const row of allGraded) {
    const passes = landsInDb({
      name: row.name,
      phone: row.phone,
      email: row.email,
      website: row.website,
      pagespeed: row.pagespeed,
      flag: row.flag,
    })

    if (passes) {
      // Promote into valid_pulse_leads.
      try {
        await validCol.updateOne(
          { placeId: row.placeId || `phone:${row.phone}` },
          {
            $set: {
              name: row.name,
              phone: row.phone,
              email: row.email ?? null,
              website: row.website,
              pagespeed: row.pagespeed,
              flag: row.flag,
              city: row.city,
              state: row.state,
              placeId: row.placeId || null,
              cid: row.cid || null,
              fid: row.fid || null,
              address: row.address || null,
              category: row.category || null,
              scraped_at: row.scraped_at,
              promoted_at: now,
            },
            $setOnInsert: {
              first_seen: row.first_seen || row.scraped_at,
              status: 'queued',
            },
          },
          { upsert: true }
        )
        promoted += 1
      } catch (err) {
        if (err?.code !== 11000) {
          console.warn('[grader] valid upsert error', err?.message)
        }
      }

      await leadsCol.updateOne(
        { _id: row._id },
        {
          $set: {
            checked: true,
            pagespeed: row.pagespeed,
            flag: row.flag,
            graded_at: now,
            outcome: 'lead',
            discard_reason: null,
          },
        }
      )
    } else {
      const reason = whyDropped({
        name: row.name,
        phone: row.phone,
        website: row.website,
        pagespeed: row.pagespeed,
        flag: row.flag,
      })
      discardReasons[reason] = (discardReasons[reason] || 0) + 1
      discarded += 1
      await leadsCol.updateOne(
        { _id: row._id },
        {
          $set: {
            checked: true,
            pagespeed: row.pagespeed ?? null,
            flag: row.flag ?? null,
            graded_at: now,
            outcome: 'discarded',
            discard_reason: reason,
          },
        }
      )
    }
  }

  summary.promoted = promoted
  summary.discarded = discarded
  summary.discardReasons = discardReasons
  await breadcrumb('dentist-grader', 'job-b:exit', {
    promoted, discarded, ...discardReasons,
  })
}

// -------------------- Handler --------------------

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('[dentist-grader-cron] CRON_SECRET not configured; refusing to run')
    await captureRouteError(req, new Error('CRON_SECRET not configured'), {
      kind: 'auth-misconfigured',
    })
    return res.status(503).json({ ok: false, message: 'Cron not configured' })
  }
  const auth = req.headers['authorization'] || ''
  const manualKey = req.headers['x-cron-secret'] || ''
  if (auth !== `Bearer ${expected}` && manualKey !== expected) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' })
  }

  const cols = getCollectionNames()
  const startedAt = new Date()
  const summary = {
    kind: 'dentist-grader',
    preview: cols.isPreview,
    startedAt,
    pendingFound: 0,
    processed: 0,
    stillRunning: 0,
    failed: 0,
    itemsPulled: 0,
    insertedNew: 0,
    duplicatesSkipped: 0,
    gradeBatchSize: 0,
    promoted: 0,
    discarded: 0,
    discardReasons: {},
  }

  try {
    const client = await getMongoClient()
    const db = client.db(getDatabaseName())

    await breadcrumb('dentist-grader', 'enter', { preview: cols.isPreview })

    // Job A — drain pending runs.
    await drainPendingRuns({ db, cols, req, summary })

    // Job B — grade unchecked leads.
    const psiKey = process.env.PAGESPEED_API_KEY
    await gradeUnchecked({ db, cols, req, apiKey: psiKey, summary })

    summary.finishedAt = new Date()
    summary.durationMs = summary.finishedAt - summary.startedAt

    // Persist run doc for observability.
    await db.collection(cols.RUNS).insertOne(summary)

    return res.status(200).json({ ok: true, ...summary })
  } catch (err) {
    console.error('[dentist-grader-cron] fatal', err)
    await captureRouteError(req, err, { fatal: true })
    return res.status(500).json({ ok: false, message: 'Grader cron failed' })
  }
}
