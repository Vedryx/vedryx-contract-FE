// Nightly US dentist scrape — ENQUEUE-ONLY. Hit by Vercel Cron at 20:30 UTC
// (02:00 IST).
//
// ARCHITECTURAL SPLIT (2026-06-14, pulse-local-dentist-cron/eng-006):
//   The monolithic cron of iters 0-8 ran ALL stages in one Vercel invocation
//   (Maps scrape + PSI grade + persist). At MAPS_PER_SEARCH 40 it blew the
//   Vercel 300s ceiling because PSI's per-IP rate cap stretched wall-clock
//   beyond what raising concurrency could compensate for.
//
//   The pipeline now splits across TWO schedulers:
//
//     1. THIS endpoint (Vercel Cron, nightly @ 20:30 UTC) — picks the next
//        city, kicks off an ASYNC Apify run, persists the runId in
//        `pending_scrape_runs`, returns in ~3-5s. No 5-minute cap.
//
//     2. `api/dentist-grader-cron.js` (GitHub Actions, every 10 min) — drains
//        `pending_scrape_runs` (Job A: SUCCEEDED → upsert into
//        `pulse_local_leads` with checked=false), then grades the unchecked
//        backlog (Job B: PSI → AND-gate → `valid_pulse_leads`).
//
// What this file owns now (much smaller surface):
//   - Auth fail-closed
//   - Mon-IST skip
//   - City pick + mark scraped
//   - Budget pre-check
//   - ASYNC Apify enqueue → write `pending_scrape_runs` doc → return
//   - PREVIEW_MODE collection routing via getCollectionNames()
//
// What this file NO LONGER owns:
//   - The sync-wait on Apify (moved to Job A in grader cron)
//   - PSI grading (moved to Job B in grader cron)
//   - persistLeads / AND gate / drop reasons (moved to Job B in grader cron)

import { getDatabaseName, getMongoClient } from './_mongo.js'
import { breadcrumb, captureRouteError } from './_sentry.js'
import {
  startActorRunAsync,
  budgetState,
  ledgerMonthKey,
  isMondayIST,
  HARD_CAP_INR,
} from './_apify.js'
import {
  DENTIST_PER_RUN_MAX_USD,
  projectDentistStageCostInr,
  pickNextCity,
  markCityScraped,
  getCollectionNames,
} from './_dentist.js'

// -------------------- GitHub workflow_dispatch helper --------------------
//
// Fires `dentist-grader.yml` via the GitHub Actions workflow_dispatch API
// immediately after enqueueing the Apify run. This removes dependency on
// GHA free-tier cron scheduler skew (which can lag 2-8 hours). The GHA
// cron schedule is kept as a belt-and-suspenders fallback.
//
// Auth: fine-grained PAT stored in GH_DISPATCH_PAT env var (Vercel secret).
// Scope required: Actions (write) on the vedryx-contract-FE repo.
//
// Fire-and-forget: we do NOT await the dispatch result inline — we use a
// 5-second timeout and log success/failure. Lead is already in
// `pending_scrape_runs`; even if dispatch fails, GHA cron drains within
// ~10 min on its next tick.
//
// Idempotency: the grader is fully dedup-safe (compound unique index on
// placeId/cid/fid). Multiple dispatch triggers in the same window produce
// no double-writes.
//
const GH_DISPATCH_OWNER = 'Vedryx'
const GH_DISPATCH_REPO = 'vedryx-contract-FE'
const GH_DISPATCH_WORKFLOW = 'dentist-grader.yml'
const GH_DISPATCH_TIMEOUT_MS = 5_000

async function fireGraderDispatch({ runId }) {
  const pat = process.env.GH_DISPATCH_PAT
  if (!pat) {
    console.warn('[dentist-scrape-cron] GH_DISPATCH_PAT not set — skipping workflow_dispatch')
    return { ok: false, reason: 'no-pat' }
  }

  const url = `https://api.github.com/repos/${GH_DISPATCH_OWNER}/${GH_DISPATCH_REPO}/actions/workflows/${GH_DISPATCH_WORKFLOW}/dispatches`
  const body = JSON.stringify({ ref: 'main' })

  let status
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), GH_DISPATCH_TIMEOUT_MS)
    const res = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body,
    })
    clearTimeout(timer)
    status = res.status
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : String(err?.message || err)
    console.warn('[dentist-scrape-cron] workflow_dispatch failed:', reason, { runId })
    return { ok: false, reason }
  }

  if (status === 204) {
    console.log('[dentist-scrape-cron] workflow_dispatch fired OK (204)', { runId })
    return { ok: true, status }
  }

  // 422 = workflow not on ref (dentist-grader.yml not merged to main yet)
  // 401/403 = PAT scope wrong or expired
  console.warn('[dentist-scrape-cron] workflow_dispatch unexpected status', status, { runId })
  return { ok: false, status }
}

// Per-night volume. Iter 6/8 proved 20/search × 3 strings = 60 places fits
// PSI's real-world throughput on the grader side. Volume scaling is now
// across-cities (nightly rotation) not per-search.
const MAPS_PER_SEARCH = 20
const MAPS_MAX_PLACES = MAPS_PER_SEARCH * 3 // ledger projection ceiling
const MAPS_ACTOR = 'compass/crawler-google-places'

async function readLedger(db, ledgerCollection, monthKey) {
  return db.collection(ledgerCollection).findOne({ month: monthKey })
}

// -------------------- Handler --------------------

export default async function handler(req, res) {
  // -------------------- Auth: fail-closed --------------------
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('[dentist-scrape-cron] CRON_SECRET not configured; refusing to run')
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

  // -------------------- Preview-aware collections --------------------
  const cols = getCollectionNames()

  // -------------------- Mon-IST skip --------------------
  const startedAt = new Date()
  if (isMondayIST(startedAt)) {
    console.log('[dentist-scrape-cron] hi — monday IST, skipping')
    return res.status(200).json({
      ok: true,
      skipped: 'monday-ist',
      kind: 'dentist-scrape-enqueue',
      preview: cols.isPreview,
      startedAt,
    })
  }

  const monthKey = ledgerMonthKey(startedAt)
  const results = {
    kind: 'dentist-scrape-enqueue',
    preview: cols.isPreview,
    startedAt,
    monthKey,
    stages: [],
    skippedStages: [],
  }

  try {
    const client = await getMongoClient()
    const db = client.db(getDatabaseName())

    // -------------------- City pick --------------------
    const city = await pickNextCity(db)
    if (!city) {
      console.warn('[dentist-scrape-cron] us_cities empty — run scripts/seed-us-cities.mjs')
      results.aborted = 'no-cities-seeded'
      results.finishedAt = new Date()
      await db.collection(cols.RUNS).insertOne(results)
      return res.status(200).json({
        ok: true,
        aborted: 'no-cities-seeded',
        preview: cols.isPreview,
        message: 'Run scripts/seed-us-cities.mjs to seed us_cities collection.',
      })
    }
    results.city = { city: city.city, state: city.state }

    // -------------------- Budget gate (pre-run) --------------------
    let ledger = await readLedger(db, cols.LEDGER, monthKey)
    let state = budgetState(ledger)
    results.budgetState = state
    results.monthToDateInr = ledger?.total_inr ?? 0

    if (state === 'hard-cap') {
      results.aborted = 'hard-cap'
      results.finishedAt = new Date()
      await db.collection(cols.RUNS).insertOne(results)
      console.warn('[dentist-scrape-cron] hard cap reached, skipping run')
      return res.status(200).json({
        ok: true,
        aborted: 'hard-cap',
        preview: cols.isPreview,
        monthToDateInr: results.monthToDateInr,
      })
    }

    // Per-stage pre-projection. Cost lands when the run finishes (grader cron
    // calls recordActorCost during Job A), but we still refuse to enqueue if
    // worst-case projection would breach the hard cap.
    const mapsProj = projectDentistStageCostInr(MAPS_ACTOR, MAPS_MAX_PLACES)
    if ((ledger?.total_inr ?? 0) + mapsProj > HARD_CAP_INR) {
      results.skippedStages.push({
        name: 'maps-enqueue',
        reason: 'pre-stage-hard-cap',
        currentTotalInr: ledger?.total_inr ?? 0,
        projectedAdd: mapsProj,
      })
      results.aborted = 'pre-stage-hard-cap'
      results.finishedAt = new Date()
      await db.collection(cols.RUNS).insertOne(results)
      return res.status(200).json({
        ok: true,
        aborted: 'pre-stage-hard-cap',
        preview: cols.isPreview,
      })
    }

    // -------------------- Enqueue async Apify run --------------------
    await breadcrumb('dentist-cron', 'enqueue:start', {
      city: city.city,
      state: city.state,
      perSearch: MAPS_PER_SEARCH,
      preview: cols.isPreview,
    })

    const input = {
      searchStringsArray: ['dentist', 'cosmetic dentist', 'orthodontist'],
      locationQuery: `${city.city}, ${city.state}, USA`,
      maxCrawledPlacesPerSearch: MAPS_PER_SEARCH,
      language: 'en',
      // scrapeContacts: false — see iter-5 note; phone + website + emails[]
      // come from base Google Maps listing data without the contact crawl.
      scrapeContacts: false,
      exportPlaceUrls: false,
      maxTotalChargeUsd: DENTIST_PER_RUN_MAX_USD[MAPS_ACTOR],
    }

    let enqueued
    try {
      enqueued = await startActorRunAsync(MAPS_ACTOR, input, {
        maxItems: MAPS_MAX_PLACES,
      })
    } catch (err) {
      const errMsg = String(err?.message || err)
      console.error('[dentist-scrape-cron] enqueue failed', errMsg)
      await captureRouteError(req, err, { stage: 'maps-enqueue', actor: MAPS_ACTOR })
      await breadcrumb('dentist-cron', 'enqueue:fail', { error: errMsg }, 'error')
      results.stages.push({ name: 'maps-enqueue', ok: false, error: errMsg })
      results.aborted = 'enqueue-failed'
      results.finishedAt = new Date()
      await db.collection(cols.RUNS).insertOne(results)
      return res.status(502).json({
        ok: false,
        aborted: 'enqueue-failed',
        preview: cols.isPreview,
        error: errMsg,
      })
    }

    // -------------------- Persist pending run --------------------
    const pendingCol = db.collection(cols.PENDING_RUNS)
    await pendingCol.createIndex({ status: 1, started_at: 1 })
    await pendingCol.createIndex({ runId: 1 }, { unique: true })

    const pendingDoc = {
      runId: enqueued.runId,
      datasetId: enqueued.datasetId,
      actorId: MAPS_ACTOR,
      city: { city: city.city, state: city.state },
      input,
      status: 'queued',
      apifyStatus: enqueued.status,
      started_at: startedAt,
      items_pulled: 0,
      inserted_new: 0,
      duplicates_skipped: 0,
      finished_at: null,
      preview: cols.isPreview,
    }
    await pendingCol.insertOne(pendingDoc)

    // -------------------- Mark city scraped --------------------
    // City had its turn. If the async run later fails, the grader cron logs
    // it but we do not re-pick this city tonight. Rotation continues.
    await markCityScraped(db, city)

    // -------------------- Fire grader workflow_dispatch --------------------
    // Kick GHA grader immediately so it starts polling the new Apify run.
    // Fire-and-forget: 5s timeout, no inline await on result beyond logging.
    // Belt-and-suspenders: GHA cron (*/10 * * * *) drains anyway if this fails.
    // 422 here means dentist-grader.yml not merged to main yet — do NOT ship
    // this cron change before merging the dentist-pipeline-split PR to main.
    const dispatchResult = await fireGraderDispatch({ runId: enqueued.runId })
    console.log('[dentist-scrape-cron] dispatch result', JSON.stringify(dispatchResult))

    // -------------------- Final state + run doc --------------------
    results.stages.push({
      name: 'maps-enqueue',
      actor: MAPS_ACTOR,
      ok: true,
      runId: enqueued.runId,
      datasetId: enqueued.datasetId,
      apifyStatus: enqueued.status,
    })
    results.runId = enqueued.runId
    results.datasetId = enqueued.datasetId
    results.dispatchResult = dispatchResult
    results.finishedAt = new Date()
    results.durationMs = results.finishedAt - results.startedAt
    await db.collection(cols.RUNS).insertOne(results)
    await breadcrumb('dentist-cron', 'enqueue:ok', {
      runId: enqueued.runId,
      durationMs: results.durationMs,
      dispatchOk: dispatchResult.ok,
    })

    return res.status(200).json({
      ok: true,
      kind: 'dentist-scrape-enqueue',
      preview: cols.isPreview,
      city: results.city,
      runId: enqueued.runId,
      datasetId: enqueued.datasetId,
      apifyStatus: enqueued.status,
      budgetState: state,
      monthToDateInr: results.monthToDateInr,
      durationMs: results.durationMs,
      dispatchResult,
      message: 'Run enqueued. Grader dispatch fired.',
    })
  } catch (err) {
    console.error('[dentist-scrape-cron] fatal', err)
    await captureRouteError(req, err, { fatal: true })
    return res.status(500).json({ ok: false, message: 'Cron failed' })
  }
}
