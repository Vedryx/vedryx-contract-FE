// Nightly US dentist scrape cron. Hit by Vercel Cron at 20:30 UTC (02:00 IST).
//
// Pipeline (one city per night, oldest last_scraped first):
//   1. Apify compass/crawler-google-places → 100 raw dentist places for city
//   2. PSI mobile-perf grade  → drop dentists whose site scores >= 50
//   3. Apify apify/website-content-crawler → optional domain email
//   4. Strict AND gate (see api/_dentist.js#landsInDb)
//   5. Upsert into pulse_local_leads, dedup by phone
//
// Reuses the LinkedIn cron's patterns: CRON_SECRET fail-closed auth, monthly
// pipeline_cost_ledger with SOFT/HARD caps in INR, Mon-IST skip, Sentry on
// failure. Does NOT touch lead_pipeline or core_seed_companies — orthogonal.
//
// Touches new collections:
//   us_cities          (city rotation pool; seed with scripts/seed-us-cities.mjs)
//   pulse_local_leads  (output)
//   pipeline_runs      (kind: 'dentist-scrape')
//   pipeline_cost_ledger (shared with LinkedIn cron — same monthly budget)

import { getDatabaseName, getMongoClient } from './_mongo.js'
import { captureRouteError } from './_sentry.js'
import {
  runActor,
  recordActorCost,
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
  landsInDb,
  normalizeGoogleMapsDentist,
  gradeWebsiteWithPsi,
  scrapeDomainEmail,
  mapBounded,
} from './_dentist.js'

const LEADS_COLLECTION = 'pulse_local_leads'
const RUNS_COLLECTION = 'pipeline_runs'
const LEDGER_COLLECTION = 'pipeline_cost_ledger'

// Per-night volumes. RA §5 expected ~100 raw → ~38 land after AND gate.
const MAPS_MAX_PLACES = 100
const EMAIL_MAX_TARGETS = 80 // cap email-stage runs; bigger than expected after PSI filter

// Per-stage wall-clock budgets. Vercel Hobby caps function at 300s. PSI and
// email stages are concurrency-bounded; total budget below 270s leaves headroom
// for Mongo writes and ledger updates.
const STAGE_TIMEOUT_MS = {
  'maps-scrape': 90_000,
  'psi-grade': 120_000,
  'email-scrape': 90_000,
}

const MAPS_ACTOR = 'compass/crawler-google-places'
const EMAIL_ACTOR = 'apify/website-content-crawler'

function classifyActorError(message = '') {
  const m = String(message)
  if (/operation was aborted/i.test(m)) {
    return { kind: 'client-timeout', action: 'Stage timeout exceeded; raise STAGE_TIMEOUT_MS.' }
  }
  if (/returned 400/.test(m)) {
    return { kind: 'invalid-input', action: 'Check Actor input schema for breaking changes.' }
  }
  if (/returned 4(?!00)/.test(m)) {
    return { kind: 'auth-or-quota', action: 'Verify APIFY_TOKEN scope and Actor billing tier.' }
  }
  return { kind: 'unknown', action: null }
}

async function readLedger(db, monthKey) {
  return db.collection(LEDGER_COLLECTION).findOne({ month: monthKey })
}

/**
 * Run the Google Maps stage. Returns the normalized rows that survived the
 * "must have website" early-drop. Updates ledger.
 */
async function runMapsStage({ db, req, city, results }) {
  const stageName = 'maps-scrape'
  const input = {
    searchStringsArray: ['dentist', 'cosmetic dentist', 'orthodontist'],
    locationQuery: `${city.city}, ${city.state}, USA`,
    maxCrawledPlacesPerSearch: Math.ceil(MAPS_MAX_PLACES / 3),
    language: 'en',
    scrapeContacts: true,
    exportPlaceUrls: false,
    maxTotalChargeUsd: DENTIST_PER_RUN_MAX_USD[MAPS_ACTOR],
  }
  let actorOut
  try {
    actorOut = await runActor(MAPS_ACTOR, input, {
      timeoutMs: STAGE_TIMEOUT_MS[stageName],
      maxItems: MAPS_MAX_PLACES,
    })
  } catch (err) {
    const errMsg = String(err?.message || err)
    const { kind, action } = classifyActorError(errMsg)
    console.error(`[${stageName}] actor failed (${kind})`, errMsg)
    await captureRouteError(req, err, { stage: stageName, actor: MAPS_ACTOR, errorKind: kind })
    results.stages.push({
      name: stageName, actor: MAPS_ACTOR, ok: false, error: errMsg,
      errorKind: kind, ...(action ? { recommendedAction: action } : {}),
    })
    return { rows: [], ledgerOk: true }
  }
  const { items, runId, datasetId, usageTotalUsd } = actorOut

  // Normalize + early-drop (no website = no business for us).
  const rows = []
  for (const raw of items) {
    const norm = normalizeGoogleMapsDentist(raw)
    if (norm) rows.push(norm)
  }

  // Ledger — measured if Apify returned a figure, else conservative projection.
  try {
    await recordActorCost(db, MAPS_ACTOR, {
      runUsageUsd: usageTotalUsd,
      itemCount: items.length,
    })
    results.stages.push({
      name: stageName, actor: MAPS_ACTOR, items: items.length,
      withWebsite: rows.length, runUsageUsd: usageTotalUsd,
      runId, datasetId, ok: true,
    })
    return { rows, ledgerOk: true }
  } catch (err) {
    console.error(`[${stageName}] ledger write failed`, err?.message)
    await captureRouteError(req, err, { stage: stageName, actor: MAPS_ACTOR, kind: 'ledger-write-failure' })
    results.stages.push({
      name: stageName, actor: MAPS_ACTOR, items: items.length,
      withWebsite: rows.length, ok: false,
      error: `ledger-write-failure: ${String(err?.message || err)}`,
    })
    return { rows, ledgerOk: false }
  }
}

/**
 * Run PSI on each candidate. Returns the subset whose mobile-perf score < 50.
 * Concurrency 8 with 200ms inter-batch delay stays well within 25K/day quota
 * and the ~50 RPS per-IP throttle.
 */
async function runPsiStage({ req, rows, apiKey, results }) {
  const stageName = 'psi-grade'
  if (!apiKey) {
    results.stages.push({
      name: stageName, ok: false, error: 'no-pagespeed-api-key',
      recommendedAction: 'Founder: set PAGESPEED_API_KEY in Vercel env.',
    })
    return []
  }
  if (!rows.length) {
    results.stages.push({ name: stageName, items: 0, badSites: 0, ok: true })
    return []
  }

  const startedAt = Date.now()
  let graded
  try {
    graded = await mapBounded(
      rows,
      async (row) => {
        const psi = await gradeWebsiteWithPsi(row.website, apiKey, { timeoutMs: 30_000 })
        return { ...row, pagespeed: psi.score, flag: psi.flag, psiError: psi.error }
      },
      { concurrency: 8, delayMs: 200 }
    )
  } catch (err) {
    const errMsg = String(err?.message || err)
    console.error(`[${stageName}] failed`, errMsg)
    await captureRouteError(req, err, { stage: stageName })
    results.stages.push({ name: stageName, ok: false, error: errMsg })
    return []
  }

  // Stage budget enforcement: bail if we've blown the timeout slot.
  if (Date.now() - startedAt > STAGE_TIMEOUT_MS[stageName] + 5_000) {
    results.stages.push({
      name: stageName, ok: false, error: 'stage-timeout-exceeded',
      items: graded.length, gracefulBail: true,
    })
  }

  const psiErrors = graded.filter((r) => r.psiError).length
  const badSites = graded.filter(
    (r) => Number.isFinite(r.pagespeed) && r.pagespeed < 50 && r.flag
  )
  results.stages.push({
    name: stageName, items: rows.length, graded: graded.length,
    psiErrors, badSites: badSites.length, ok: true,
  })
  return badSites
}

/**
 * Email scrape for bad-site rows. Email is OPTIONAL — failures land null,
 * not dropped. Ledger uses pagesCrawled * actor cost as the projection floor;
 * Apify's run-level usage figure overrides if available.
 */
async function runEmailStage({ db, req, rows, results }) {
  const stageName = 'email-scrape'
  if (!rows.length) {
    results.stages.push({ name: stageName, items: 0, emailsFound: 0, ok: true })
    return rows
  }
  // Cap targets — even at 100 PSI-failing dentists we don't want to spawn
  // 100 separate Apify runs; bigger crawls amortize better but we treat
  // each as an isolated cheap call here for simplicity.
  const targets = rows.slice(0, EMAIL_MAX_TARGETS)

  let withEmail
  let pagesTotal = 0
  let errors = 0
  try {
    withEmail = await mapBounded(
      targets,
      async (row) => {
        const r = await scrapeDomainEmail(row.website, { maxPages: 5, timeoutMs: 45_000 })
        if (r.error) errors += 1
        pagesTotal += r.pagesCrawled || 0
        return { ...row, email: r.email }
      },
      { concurrency: 3, delayMs: 300 }
    )
  } catch (err) {
    const errMsg = String(err?.message || err)
    console.error(`[${stageName}] failed`, errMsg)
    await captureRouteError(req, err, { stage: stageName })
    results.stages.push({ name: stageName, ok: false, error: errMsg })
    // Email is optional — fall through with email=null on the targets we never
    // got to, so the AND gate can still drop or keep them on phone/site/score.
    return targets.map((r) => ({ ...r, email: null }))
  }

  // Ledger — projection floor based on pages crawled (single-actor accounting).
  try {
    await recordActorCost(db, EMAIL_ACTOR, {
      runUsageUsd: null, // sync-run total is split across many calls; use projection
      itemCount: pagesTotal || targets.length,
    })
  } catch (err) {
    console.error(`[${stageName}] ledger write failed`, err?.message)
    await captureRouteError(req, err, { stage: stageName, actor: EMAIL_ACTOR, kind: 'ledger-write-failure' })
    results.stages.push({
      name: stageName, items: targets.length, ok: false,
      error: `ledger-write-failure: ${String(err?.message || err)}`,
    })
    return withEmail
  }

  const emailsFound = withEmail.filter((r) => r.email).length
  results.stages.push({
    name: stageName, items: targets.length, pagesCrawled: pagesTotal,
    emailsFound, errors, ok: true,
  })
  return withEmail
}

/**
 * Insert / dedup leads. Dedup key = phone (Mongo unique index).
 * On collision: update pagespeed/flag/scraped_at; preserve `first_seen`.
 */
async function persistLeads({ db, candidates, city, results }) {
  const col = db.collection(LEADS_COLLECTION)
  // Indexes (idempotent — createIndex no-ops when present).
  await col.createIndex({ phone: 1 }, { unique: true })
  await col.createIndex({ city: 1, scraped_at: -1 })
  await col.createIndex({ pagespeed: 1 })

  let inserted = 0
  let updated = 0
  let dropped = 0
  const dropReasons = {}
  const now = new Date()

  for (const raw of candidates) {
    const lead = {
      name: raw.name,
      phone: raw.phone,
      email: raw.email ?? null,
      website: raw.website,
      pagespeed: raw.pagespeed,
      flag: raw.flag,
      city: city.city,
      state: city.state,
      scraped_at: now,
    }
    if (!landsInDb(lead)) {
      dropped += 1
      const reason = whyDropped(lead)
      dropReasons[reason] = (dropReasons[reason] || 0) + 1
      continue
    }
    try {
      const res = await col.updateOne(
        { phone: lead.phone },
        {
          $set: {
            name: lead.name,
            email: lead.email,
            website: lead.website,
            pagespeed: lead.pagespeed,
            flag: lead.flag,
            city: lead.city,
            state: lead.state,
            scraped_at: lead.scraped_at,
          },
          $setOnInsert: {
            first_seen: lead.scraped_at,
            status: 'queued',
          },
        },
        { upsert: true }
      )
      if (res.upsertedCount) inserted += 1
      else if (res.modifiedCount) updated += 1
    } catch (err) {
      // 11000 = dup key race; safe to swallow.
      if (err?.code !== 11000) {
        console.warn('[persist] upsert error', err?.message)
      }
      dropped += 1
      dropReasons['mongo-error'] = (dropReasons['mongo-error'] || 0) + 1
    }
  }

  results.persistence = {
    candidates: candidates.length,
    inserted, updated, dropped, dropReasons,
  }
  return { inserted, updated, dropped }
}

function whyDropped(lead) {
  if (typeof lead.name !== 'string' || !lead.name.trim()) return 'no-name'
  if (typeof lead.phone !== 'string' || lead.phone.replace(/\D/g, '').length < 7) return 'bad-phone'
  if (typeof lead.website !== 'string' || !lead.website.trim()) return 'no-website'
  if (!Number.isFinite(lead.pagespeed)) return 'no-pagespeed'
  if (lead.pagespeed >= 50) return 'pagespeed-too-good'
  if (typeof lead.flag !== 'string' || !lead.flag.trim()) return 'no-flag'
  return 'unknown'
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

  // -------------------- Mon-IST skip --------------------
  const startedAt = new Date()
  if (isMondayIST(startedAt)) {
    console.log('[dentist-scrape-cron] hi — monday IST, skipping')
    return res.status(200).json({
      ok: true, skipped: 'monday-ist', kind: 'dentist-scrape', startedAt,
    })
  }

  const monthKey = ledgerMonthKey(startedAt)
  const results = {
    kind: 'dentist-scrape',
    startedAt, monthKey, stages: [], skippedStages: [],
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
      await db.collection(RUNS_COLLECTION).insertOne(results)
      return res.status(200).json({
        ok: true, aborted: 'no-cities-seeded',
        message: 'Run scripts/seed-us-cities.mjs to seed us_cities collection.',
      })
    }
    results.city = { city: city.city, state: city.state }

    // -------------------- Budget gate (pre-run) --------------------
    let ledger = await readLedger(db, monthKey)
    let state = budgetState(ledger)
    results.budgetState = state
    results.monthToDateInr = ledger?.total_inr ?? 0

    if (state === 'hard-cap') {
      results.aborted = 'hard-cap'
      results.finishedAt = new Date()
      await db.collection(RUNS_COLLECTION).insertOne(results)
      console.warn('[dentist-scrape-cron] hard cap reached, skipping run')
      return res.status(200).json({
        ok: true, aborted: 'hard-cap', monthToDateInr: results.monthToDateInr,
      })
    }

    // -------------------- Per-stage budget gates --------------------
    // We project each stage's worst-case cost ADDITIVELY and refuse to enter
    // the stage if projected total breaches HARD_CAP_INR. Cheap stages first
    // so a near-cap month still gets the Maps scrape.
    const mapsProj = projectDentistStageCostInr(MAPS_ACTOR, MAPS_MAX_PLACES)
    if ((ledger?.total_inr ?? 0) + mapsProj > HARD_CAP_INR) {
      results.skippedStages.push({
        name: 'maps-scrape', reason: 'pre-stage-hard-cap',
        currentTotalInr: ledger?.total_inr ?? 0,
        projectedAdd: mapsProj,
      })
      results.aborted = 'pre-stage-hard-cap'
      results.finishedAt = new Date()
      await db.collection(RUNS_COLLECTION).insertOne(results)
      return res.status(200).json({ ok: true, aborted: 'pre-stage-hard-cap' })
    }

    // -------------------- Stage 1: Google Maps --------------------
    const maps = await runMapsStage({ db, req, city, results })
    if (!maps.ledgerOk) {
      results.aborted = 'cost-tracking-failure'
      results.finishedAt = new Date()
      await db.collection(RUNS_COLLECTION).insertOne(results)
      return res.status(500).json({ ok: false, aborted: 'cost-tracking-failure' })
    }
    const mapsRows = maps.rows
    if (mapsRows.length === 0) {
      results.aborted = 'no-rows-with-website'
      // Still mark the city as scraped — it had its turn even if dry.
      await markCityScraped(db, city)
      results.finishedAt = new Date()
      await db.collection(RUNS_COLLECTION).insertOne(results)
      return res.status(200).json({
        ok: true, aborted: 'no-rows-with-website', city: results.city,
      })
    }

    // -------------------- Stage 2: PSI --------------------
    // Re-read ledger for honest projection.
    ledger = await readLedger(db, monthKey)
    state = budgetState(ledger)
    results.budgetState = state
    results.monthToDateInr = ledger?.total_inr ?? 0

    const psiKey = process.env.PAGESPEED_API_KEY
    const badSites = await runPsiStage({ req, rows: mapsRows, apiKey: psiKey, results })

    // -------------------- Stage 3: Email --------------------
    // Cheap projection before entering: email crawl × max targets.
    const emailProj = projectDentistStageCostInr(EMAIL_ACTOR, Math.min(badSites.length, EMAIL_MAX_TARGETS) * 5)
    if ((ledger?.total_inr ?? 0) + emailProj > HARD_CAP_INR) {
      results.skippedStages.push({
        name: 'email-scrape', reason: 'pre-stage-hard-cap',
        currentTotalInr: ledger?.total_inr ?? 0,
        projectedAdd: emailProj,
      })
      // Run AND-gate without emails — they're optional.
      const noEmail = badSites.map((r) => ({ ...r, email: null }))
      await persistLeads({ db, candidates: noEmail, city, results })
    } else {
      const withEmail = await runEmailStage({ db, req, rows: badSites, results })
      await persistLeads({ db, candidates: withEmail, city, results })
    }

    // -------------------- City rotation --------------------
    await markCityScraped(db, city)

    // -------------------- Final state + run doc --------------------
    ledger = await readLedger(db, monthKey)
    state = budgetState(ledger)
    results.budgetState = state
    results.monthToDateInr = ledger?.total_inr ?? 0
    results.finishedAt = new Date()
    results.durationMs = results.finishedAt - results.startedAt
    await db.collection(RUNS_COLLECTION).insertOne(results)

    return res.status(200).json({
      ok: true,
      kind: 'dentist-scrape',
      city: results.city,
      budgetState: state,
      monthToDateInr: results.monthToDateInr,
      persistence: results.persistence,
      stages: results.stages.map(({ name, items, ok, error }) => ({ name, items, ok, error })),
      skippedStages: results.skippedStages,
    })
  } catch (err) {
    console.error('[dentist-scrape-cron] fatal', err)
    await captureRouteError(req, err, { fatal: true })
    return res.status(500).json({ ok: false, message: 'Cron failed' })
  }
}
