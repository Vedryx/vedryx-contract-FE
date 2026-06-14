// Nightly US dentist scrape cron. Hit by Vercel Cron at 20:30 UTC (02:00 IST).
//
// Pipeline (one city per night, oldest last_scraped first):
//   1. Apify compass/crawler-google-places → ~60 raw dentist places for city
//      (3 search strings × 20/search). `scrapeContacts: false` — email is a
//      pass-through from Google Maps listing data when present.
//   2. PSI mobile-perf grade  → drop dentists whose site scores >= 50
//   3. Strict AND gate (see api/_dentist.js#landsInDb)
//   4. Upsert into pulse_local_leads, dedup by phone
//
// Iteration 1 fix (2026-06-14, pulse-local-dentist-cron/cto-002):
//   - normalizer maps `title` → name, falls back to `subTitle`; pulls website
//     from `website || webResults[0]?.url`; surfaces `emails[0]` inline.
//   - maxCrawledPlacesPerSearch raised 40 → 120 (Apify cost ~$0.20/run vs $0.05).
//   - email-scrape stage REMOVED. Email is now optional pass-through from the
//     maps row's `emails` array.
//   - Sentry breadcrumbs at stage entry/exit; `dropped:` counter on response.
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
import { breadcrumb, captureRouteError } from './_sentry.js'
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
  mapBounded,
} from './_dentist.js'

const LEADS_COLLECTION = 'pulse_local_leads'
const RUNS_COLLECTION = 'pipeline_runs'
const LEDGER_COLLECTION = 'pipeline_cost_ledger'

// Per-night volumes. Apify Actor returns ~120 places per search string × 3
// strings = ~360 raw places. Iteration 0 used 40 → too few survived field-
// availability gates (only ~30-50% of Google profiles list a website at all).
// Apify cost stays small (~$0.20/run vs prior ~$0.05).
//
// Iteration 4 fix (2026-06-14, pulse-local-dentist-cron/eng-001):
//   - 120/search × 3 + scrapeContacts: true needs ~300-400s to FINISH. Apify's
//     `run-sync-get-dataset-items` only returns items on Actor finish, not on
//     `waitForFinish` timeout — so our 235s wait window returned empty after
//     244s wall-clock. Drop to 40/search → 120 places/run, ~120-150s total,
//     fits comfortably under the 235s waitForFinish. Expected ~20-30 leads/
//     city/night survive the AND gate.
// Iteration 6 fix (2026-06-14, pulse-local-dentist-cron/eng-003):
//   - Phoenix retest with scrapeContacts: false hit FUNCTION_INVOCATION_TIMEOUT
//     at 301s. Apify maps finished in 146s (119 items), but PSI at concurrency
//     8 needed ~223s for 119 sites at 15s avg — far exceeding `psi-grade`
//     STAGE_TIMEOUT_MS of 60s and blowing the Vercel 300s hard cap.
//   - Cut MAPS_PER_SEARCH 40 → 20 (60 places/run). PSI concurrency raised
//     8 → 16 separately. New math: maps ~80s + PSI ~57s + persist ~20s ≈ 160s.
// Iteration 8 revert (2026-06-14, pulse-local-dentist-cron/eng-005):
//   - PR #47 bumped MAPS_PER_SEARCH 20 → 40 (iter-7) chasing more leads/run.
//     Re-hit FUNCTION_INVOCATION_TIMEOUT at 301s. PSI's real-world throughput
//     is capped by PageSpeed API rate limits, not just our concurrency math —
//     so doubling input volume doubled PSI wall-clock back over the 300s cap.
//   - Revert to iter-6 proven-working state: 20/search → 60 places/run, ~7
//     leads/run survives the AND gate. Volume scaling must come from
//     parallelizing across cities/nights, not from raising per-search count.
const MAPS_PER_SEARCH = 20
const MAPS_MAX_PLACES = MAPS_PER_SEARCH * 3 // ledger projection ceiling

// Per-stage wall-clock budgets. Vercel Hobby caps function at 300s.
//
// Iteration 2 fix (2026-06-14, pulse-local-dentist-cron/cto-003):
//   - LA cron run aborted at 120s with `no-rows-from-maps`, but the Apify
//     Actor was still running and the dataset already held 41+ items. The
//     AbortController fired before the Actor finished scraping its ~360
//     places (120/search × 3 search strings) with `scrapeContacts: true`.
//   - Raise `maps-scrape` 120s → 240s. The Actor needs more wall-clock for
//     the larger volume bumped in iter-1.
//   - Drop `psi-grade` 120s → 60s so the additive ceiling stays within the
//     Vercel Hobby maxDuration of 300s (240 + 60 = 300, exactly the cap).
//     PSI is concurrency-bounded (8 in flight, 200ms inter-batch); in
//     production runs after the AND-gate it processes far fewer rows than
//     the raw maps haul, so 60s remains adequate for the common case.
// Iteration 6 fix (2026-06-14, pulse-local-dentist-cron/eng-003):
//   - Phoenix retest: PSI on 119 sites @ concurrency 8 needed ~223s but
//     `psi-grade` budget was 60s → STAGE_TIMEOUT plus Vercel 300s death.
//   - Volume cut to 60 places + PSI concurrency 8→16 (below) drops PSI to
//     ~57s. Rebudget: maps 180s (80s actual + 100s safety), psi 100s
//     (57s actual + 43s safety). Sum 280s under 300s hard cap.
const STAGE_TIMEOUT_MS = {
  'maps-scrape': 180_000,
  'psi-grade': 100_000,
}

const MAPS_ACTOR = 'compass/crawler-google-places'

// PSI concurrency. Iter 6 (pulse-local-dentist-cron/eng-003): bumped 8 → 16.
// At ~15s Lighthouse avg per site, 60 sites / 16 concurrent ≈ 57s — fits
// `psi-grade` STAGE_TIMEOUT of 100s with 40s safety. PSI daily quota is 25K
// and per-IP throttle ~50 RPS, so 16 in flight + 200ms inter-batch stays
// well within both ceilings. If we ever raise volume back up, reconsider.
const PSI_CONCURRENCY = 16
const PSI_DELAY_MS = 200

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
 * Run the Google Maps stage. Returns ALL normalized rows (incl. rows with
 * null website). AND-gate enforcement happens downstream in persistLeads so
 * dropReasons get an honest per-field breakdown. Updates ledger.
 */
async function runMapsStage({ db, req, city, results }) {
  const stageName = 'maps-scrape'
  await breadcrumb('dentist-cron', 'maps-stage:enter', {
    city: city.city, state: city.state, perSearch: MAPS_PER_SEARCH,
  })
  const input = {
    searchStringsArray: ['dentist', 'cosmetic dentist', 'orthodontist'],
    locationQuery: `${city.city}, ${city.state}, USA`,
    maxCrawledPlacesPerSearch: MAPS_PER_SEARCH,
    language: 'en',
    // Iteration 5 (pulse-local-dentist-cron/eng-002): false. `scrapeContacts: true`
    // fires a per-place website crawl that adds 1-2s/place — at 120 places that
    // pushed total wall-clock past 244s and Apify's sync endpoint returned empty
    // before the Actor finished. `website` and `phone` come from Google's Maps
    // listing data, NOT from the contact crawl, so the founder's AND gate
    // (name + phone + website + score + flag) stays satisfied. Email becomes
    // null for all rows — acceptable per founder spec (email is OPTIONAL).
    scrapeContacts: false,
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
    await breadcrumb('dentist-cron', 'maps-stage:exit', { ok: false, kind }, 'error')
    results.stages.push({
      name: stageName, actor: MAPS_ACTOR, ok: false, error: errMsg,
      errorKind: kind, ...(action ? { recommendedAction: action } : {}),
    })
    return { rows: [], ledgerOk: true }
  }
  const { items, runId, datasetId, usageTotalUsd } = actorOut

  // Normalize. Only drops on missing name (truly unusable). Missing website
  // is preserved (and `website: null`) so persistLeads can count the drop.
  const rows = []
  let unnamedDropped = 0
  let withWebsite = 0
  let withEmail = 0
  for (const raw of items) {
    const norm = normalizeGoogleMapsDentist(raw)
    if (!norm) {
      unnamedDropped += 1
      continue
    }
    if (norm.website) withWebsite += 1
    if (norm.email) withEmail += 1
    rows.push(norm)
  }

  await breadcrumb('dentist-cron', 'maps-stage:normalize', {
    raw: items.length,
    normalized: rows.length,
    unnamedDropped,
    withWebsite,
    withEmail,
  })

  // Ledger — measured if Apify returned a figure, else conservative projection.
  try {
    await recordActorCost(db, MAPS_ACTOR, {
      runUsageUsd: usageTotalUsd,
      itemCount: items.length,
    })
    results.stages.push({
      name: stageName, actor: MAPS_ACTOR, items: items.length,
      normalized: rows.length, unnamedDropped,
      withWebsite, withEmail,
      runUsageUsd: usageTotalUsd,
      runId, datasetId, ok: true,
    })
    await breadcrumb('dentist-cron', 'maps-stage:exit', { ok: true, rows: rows.length })
    return { rows, ledgerOk: true }
  } catch (err) {
    console.error(`[${stageName}] ledger write failed`, err?.message)
    await captureRouteError(req, err, { stage: stageName, actor: MAPS_ACTOR, kind: 'ledger-write-failure' })
    results.stages.push({
      name: stageName, actor: MAPS_ACTOR, items: items.length,
      normalized: rows.length, unnamedDropped,
      withWebsite, withEmail, ok: false,
      error: `ledger-write-failure: ${String(err?.message || err)}`,
    })
    await breadcrumb('dentist-cron', 'maps-stage:exit', { ok: false, kind: 'ledger-write-failure' }, 'error')
    return { rows, ledgerOk: false }
  }
}

/**
 * Run PSI on each candidate that has a website. Rows without a website pass
 * through with `pagespeed: null` so persistLeads can count them as
 * `no-website` drops with honest per-field accounting.
 *
 * Concurrency (PSI_CONCURRENCY) with 200ms inter-batch delay stays well
 * within 25K/day quota and the ~50 RPS per-IP throttle.
 */
async function runPsiStage({ req, rows, apiKey, results }) {
  const stageName = 'psi-grade'
  await breadcrumb('dentist-cron', 'psi-stage:enter', { candidates: rows.length })
  if (!apiKey) {
    results.stages.push({
      name: stageName, ok: false, error: 'no-pagespeed-api-key',
      recommendedAction: 'Founder: set PAGESPEED_API_KEY in Vercel env.',
    })
    await breadcrumb('dentist-cron', 'psi-stage:exit', { ok: false, reason: 'no-api-key' }, 'error')
    return rows.map((r) => ({ ...r, pagespeed: null, flag: null }))
  }
  if (!rows.length) {
    results.stages.push({ name: stageName, items: 0, graded: 0, psiErrors: 0, ok: true })
    await breadcrumb('dentist-cron', 'psi-stage:exit', { ok: true, graded: 0 })
    return []
  }

  // Split: only grade rows that actually have a website. Pass the rest
  // through untouched (pagespeed: null) so AND-gate drop accounting is honest.
  const gradable = rows.filter((r) => typeof r.website === 'string' && r.website.length > 0)
  const ungradable = rows.filter((r) => !r.website).map((r) => ({ ...r, pagespeed: null, flag: null }))

  const startedAt = Date.now()
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
    const errMsg = String(err?.message || err)
    console.error(`[${stageName}] failed`, errMsg)
    await captureRouteError(req, err, { stage: stageName })
    results.stages.push({ name: stageName, ok: false, error: errMsg })
    await breadcrumb('dentist-cron', 'psi-stage:exit', { ok: false, error: errMsg }, 'error')
    return ungradable
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
    name: stageName,
    items: rows.length,
    gradable: gradable.length,
    ungradable: ungradable.length,
    graded: graded.length,
    psiErrors,
    badSites: badSites.length,
    ok: true,
  })
  await breadcrumb('dentist-cron', 'psi-stage:exit', {
    ok: true, graded: graded.length, psiErrors, badSites: badSites.length,
  })
  // Return ALL rows (graded + ungradable) so persistLeads can count drops
  // accurately. AND-gate enforces the final filter.
  return [...graded, ...ungradable]
}

/**
 * Insert / dedup leads. Dedup key = phone (Mongo unique index).
 * On collision: update pagespeed/flag/scraped_at; preserve `first_seen`.
 *
 * Also returns a structured `dropped:` counter so the cron response surfaces
 * "dropped 35 for missing website, 12 for score>=50" etc. — founder reads it
 * post-manual-trigger to decide the next iteration.
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
  await breadcrumb('dentist-cron', 'persist:done', {
    candidates: candidates.length, inserted, updated, dropped,
    ...dropReasons,
  })
  return { inserted, updated, dropped, dropReasons }
}

/**
 * Classify why a lead failed the AND gate. Order matters — first matching
 * reason wins. The counter is surfaced verbatim in the cron response so
 * founder can see "dropped 35 for no-website" without rummaging through
 * pipeline_runs.
 */
function whyDropped(lead) {
  if (typeof lead.name !== 'string' || !lead.name.trim()) return 'no-name'
  if (typeof lead.phone !== 'string' || lead.phone.replace(/\D/g, '').length < 7) return 'bad-phone'
  if (typeof lead.website !== 'string' || !lead.website.trim()) return 'no-website'
  if (!Number.isFinite(lead.pagespeed)) return 'pagespeed-error'
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
      results.aborted = 'no-rows-from-maps'
      // Still mark the city as scraped — it had its turn even if dry.
      await markCityScraped(db, city)
      results.finishedAt = new Date()
      await db.collection(RUNS_COLLECTION).insertOne(results)
      return res.status(200).json({
        ok: true, aborted: 'no-rows-from-maps', city: results.city,
      })
    }

    // -------------------- Stage 2: PSI --------------------
    // Re-read ledger for honest projection.
    ledger = await readLedger(db, monthKey)
    state = budgetState(ledger)
    results.budgetState = state
    results.monthToDateInr = ledger?.total_inr ?? 0

    const psiKey = process.env.PAGESPEED_API_KEY
    const allGraded = await runPsiStage({ req, rows: mapsRows, apiKey: psiKey, results })

    // -------------------- Persist (AND gate) --------------------
    // Email is sourced inline from the maps row (Actor's scrapeContacts).
    // No separate email stage. AND-gate enforces required fields; dropReasons
    // surfaces per-field accounting in the response.
    const persist = await persistLeads({ db, candidates: allGraded, city, results })

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
      dropped: persist.dropReasons,
      stages: results.stages.map(({ name, items, ok, error, normalized, withWebsite, withEmail, graded, psiErrors, badSites }) => ({
        name, items, normalized, withWebsite, withEmail, graded, psiErrors, badSites, ok, error,
      })),
      skippedStages: results.skippedStages,
    })
  } catch (err) {
    console.error('[dentist-scrape-cron] fatal', err)
    await captureRouteError(req, err, { fatal: true })
    return res.status(500).json({ ok: false, message: 'Cron failed' })
  }
}
