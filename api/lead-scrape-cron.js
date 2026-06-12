// Nightly lead-scrape cron. Hit by Vercel Cron at 20:30 UTC (02:00 IST).
//
// Flow:
//   1. Auth check (CRON_SECRET header — Vercel signs cron invocations).
//   2. Pull monthly cost ledger; if hard-capped, abort with 200 + status doc.
//   3. Run each Apify actor sequentially with per-actor try/catch:
//      - normalize items into the lead schema (cmo.md §7)
//      - classify ICP via classifyLead()
//      - upsert into lead_pipeline keyed by person.linkedin_url
//      - record cost ledger
//   4. Write a pipeline_runs status doc summarizing the run.
//   5. Errors → Sentry (already wired in api/_sentry.js).
//
// Failure model: one bad actor does NOT kill the run. Errors are caught
// per-actor, captured to Sentry, and the run continues. The status doc
// records which actors succeeded.

import { getDatabaseName, getMongoClient } from './_mongo.js'
import { captureRouteError } from './_sentry.js'
import {
  runActor,
  classifyLead,
  recordActorCost,
  budgetState,
  projectStageCostInr,
  ledgerMonthKey,
  normalizeHarvestCompanyEmployee,
  normalizeHarvestPostAuthor,
  HARD_CAP_INR,
  PER_RUN_MAX_USD,
} from './_apify.js'

const COLLECTION = 'lead_pipeline'
const RUNS_COLLECTION = 'pipeline_runs'
const LEDGER_COLLECTION = 'pipeline_cost_ledger'

// -------------------- Actor configs --------------------
// Three-stage pipeline post lead-pipeline-actor-rework:
//   1) core-companies  — harvestapi/linkedin-company        (firmographics)
//   2) core-employees  — harvestapi/linkedin-company-employees (Short tier)
//   3) pulse-posts     — harvestapi/linkedin-post-search    (keyword search)
//
// The old pulse-profiles stage (supreme_coder/linkedin-profile-scraper) is
// dropped: the post-search Actor returns `author.linkedinUrl` directly, so
// Pulse leads land complete in stage 3. Volumes match cmo.md §5.
//
// `maxTotalChargeUsd` is set per-Actor as belt+suspenders against the monthly
// ledger gate. harvestapi/linkedin-post-search REQUIRES it (HTTP 400 otherwise,
// min $0.01 — RA §5.1). Sized to PER_RUN_MAX_USD in _apify.js so a single
// misbehaving run cannot blow the monthly budget by itself.

const CORE_COMPANY_ACTOR_INPUT = {
  // harvestapi/linkedin-company — keyword OR company URL seeds.
  // Sales Lead refreshes the seed list per cmo.md §9.
  searches: [
    'SaaS 50 employees United States',
    'fintech 100 employees United Kingdom',
    'software 200 employees Australia',
  ],
  maxItems: 2000,
  maxTotalChargeUsd: PER_RUN_MAX_USD['harvestapi/linkedin-company'],
}

const CORE_EMPLOYEE_ACTOR_INPUT = {
  // harvestapi/linkedin-company-employees — Short tier (name + URL only).
  // The literal enum value MUST include the price tag (RA §5 + research-001 §6.2).
  // Old enum 'Short' is invalid post-rebuild and returns HTTP 400.
  profileScraperMode: 'Short ($4 per 1k)',
  maxItems: 1200,
  maxTotalChargeUsd: PER_RUN_MAX_USD['harvestapi/linkedin-company-employees'],
  // companies injected at runtime from a config doc; see TODO below.
}

const PULSE_POST_ACTOR_INPUT = {
  // harvestapi/linkedin-post-search — native keyword search.
  // Tier-1 high-signal queries (RA §5). Sales Lead tunes after week 2.
  searchQueries: [
    'looking for technical cofounder',
    'looking for tech cofounder',
    'need a developer for my MVP',
    'non-technical founder building',
    'hiring CTO for early stage',
    'looking for engineering partner',
    'MVP no-code limitations',
    'ready to launch my MVP',
    '#buildinpublic looking for dev',
    '#indiehackers cofounder wanted',
  ],
  maxItems: 3000,
  maxTotalChargeUsd: PER_RUN_MAX_USD['harvestapi/linkedin-post-search'],
}

// -------------------- Run pipeline for one actor --------------------

/**
 * Run one Apify actor + normalize + classify + upsert + ledger.
 *
 * Returns `{ ledgerOk: boolean }` so the caller can decide whether further
 * stages may run. A failed ledger write means we no longer have a reliable
 * budget total — continuing would erode the hard-cap guarantee (B3 in QA).
 * Actor failures are isolated and DO NOT stop the run (per CMO spec).
 * Ledger failures DO stop the run.
 */
// Per-actor wall-clock budget. Vercel Hobby caps the whole function at 300s.
// Four serial stages at 60s each = 240s, leaving ~60s for DB upserts and the
// per-stage budget gate. If an actor exceeds this, it's caught as a stage
// failure and the run continues (per CMO spec).
const PER_ACTOR_TIMEOUT_MS = 60_000

async function runStage({ db, req, name, actorId, input, normalize, results }) {
  let actorOut
  try {
    actorOut = await runActor(actorId, input, { timeoutMs: PER_ACTOR_TIMEOUT_MS })
  } catch (err) {
    console.error(`[${name}] actor failed`, err?.message)
    await captureRouteError(req, err, { stage: name, actor: actorId })
    results.stages.push({ name, actor: actorId, ok: false, error: String(err?.message || err) })
    // Actor failure is non-fatal to the run; ledger state is unchanged.
    return { ledgerOk: true }
  }
  const { items, runId, datasetId, usageTotalUsd } = actorOut

  let inserted = 0
  let skipped = 0
  const collection = db.collection(COLLECTION)
  for (const raw of items) {
    const normalized = normalize({ ...raw, __runId: runId, __datasetId: datasetId })
    if (!normalized.person.linkedin_url) {
      skipped += 1
      continue
    }
    const { icp, score, matched } = classifyLead(normalized)
    normalized.icp = icp
    normalized.signal.icp_score = score
    normalized.signal.routing_signals = matched

    try {
      await collection.updateOne(
        { 'person.linkedin_url': normalized.person.linkedin_url },
        { $setOnInsert: normalized },
        { upsert: true }
      )
      inserted += 1
    } catch (e) {
      // Most common cause: duplicate-key race. Acceptable, just log.
      if (e?.code !== 11000) {
        console.warn(`[${name}] upsert error`, e?.message)
      }
      skipped += 1
    }
  }

  // Cost accounting is load-bearing for the hard-cap guarantee. If we cannot
  // record what we just spent, the next stage would read a stale ledger and
  // potentially overrun the budget. Treat ledger failure as a hard stop.
  //
  // Ledger uses the measured `usageTotalUsd` from Apify when available
  // (RA §6.5 option A — single source of truth). Falls back to the
  // conservative projection (actorStart + expectedEvent × itemCount) if Apify
  // didn't return a usage figure.
  try {
    await recordActorCost(db, actorId, {
      runUsageUsd: usageTotalUsd,
      itemCount: items.length,
    })
    results.stages.push({
      name, actor: actorId, items: items.length, inserted, skipped,
      runUsageUsd: usageTotalUsd, ok: true,
    })
    return { ledgerOk: true }
  } catch (err) {
    console.error(`[${name}] ledger write failed`, err?.message)
    await captureRouteError(req, err, { stage: name, actor: actorId, kind: 'ledger-write-failure' })
    results.stages.push({
      name, actor: actorId, items: items.length, inserted, skipped,
      ok: false, error: `ledger-write-failure: ${String(err?.message || err)}`,
    })
    return { ledgerOk: false }
  }
}

// -------------------- Handler --------------------

// Three stages post lead-pipeline-actor-rework. The old pulse-profiles stage
// is removed — harvestapi/linkedin-post-search returns author.linkedinUrl
// inline (RA §6.4), so Pulse leads land complete in stage 3. The B1 per-stage
// pre-check still gates each stage before it spends.
//
// `core-companies` uses the same employee normalizer surface for now — the
// firmographic output (employeeCount/industry/locations) populates the
// company sub-doc with no person attached. The downstream join happens when
// stage 2's employees enrich against this companies pool. For v1 we emit a
// company-only doc; Sales Lead's qualification reads it via
// company.linkedin_url.
const STAGES = [
  {
    name: 'core-companies',
    actorId: 'harvestapi/linkedin-company',
    input: CORE_COMPANY_ACTOR_INPUT,
    // Company-only docs share the employee normalizer surface; person fields
    // remain empty (cron skips empty linkedin_url → no Mongo upsert).
    normalize: normalizeHarvestCompanyEmployee,
    maxItems: CORE_COMPANY_ACTOR_INPUT.maxItems,
    tier: 'core',
  },
  {
    name: 'core-employees',
    actorId: 'harvestapi/linkedin-company-employees',
    input: CORE_EMPLOYEE_ACTOR_INPUT,
    normalize: normalizeHarvestCompanyEmployee,
    maxItems: CORE_EMPLOYEE_ACTOR_INPUT.maxItems,
    tier: 'core',
  },
  {
    name: 'pulse-posts',
    actorId: 'harvestapi/linkedin-post-search',
    input: PULSE_POST_ACTOR_INPUT,
    normalize: normalizeHarvestPostAuthor,
    maxItems: PULSE_POST_ACTOR_INPUT.maxItems,
    tier: 'pulse',
  },
]

async function readLedger(db, monthKey) {
  return db.collection(LEDGER_COLLECTION).findOne({ month: monthKey })
}

export default async function handler(req, res) {
  // -------------------- Auth: fail-closed (B2 fix) --------------------
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when configured.
  // We also accept a manual trigger via x-cron-secret for debugging.
  // If CRON_SECRET is unset (env-var misconfigured) we REFUSE TO RUN.
  // Previous fail-open behaviour meant any unauthenticated request would
  // trigger a paid Apify run; a single missed env-var deploy made the
  // endpoint publicly drainable. Hard-503 is louder than a silent compromise.
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('[lead-scrape-cron] CRON_SECRET not configured; refusing to run')
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

  const startedAt = new Date()
  const monthKey = ledgerMonthKey(startedAt)
  const results = { startedAt, monthKey, stages: [], skippedStages: [] }

  try {
    const client = await getMongoClient()
    const db = client.db(getDatabaseName())

    // -------------------- Initial budget check --------------------
    let ledger = await readLedger(db, monthKey)
    let state = budgetState(ledger)
    results.budgetState = state
    results.monthToDateInr = ledger?.total_inr ?? 0

    if (state === 'hard-cap') {
      results.aborted = 'hard-cap'
      await db.collection(RUNS_COLLECTION).insertOne({
        ...results,
        finishedAt: new Date(),
      })
      console.warn('[lead-scrape-cron] hard cap reached, skipping run')
      return res.status(200).json({ ok: true, aborted: 'hard-cap', monthToDateInr: results.monthToDateInr })
    }

    // -------------------- Per-stage budget gate (B1 fix) --------------------
    // Pre-check ledger BEFORE each stage. Project worst-case post-stage cost
    // (actorCost × maxItems). If projected total would breach HARD_CAP_INR,
    // skip the stage. Soft-cap behaviour preserved: under soft cap, run only
    // Pulse tier (cheaper per item).
    //
    // Worked example (the QA worst case, replayed by scripts/test-budget-gate.mjs):
    //   ledger = ₹1,699, state = ok (₹1 below soft cap at ₹1,700).
    //   stage 1 (core-companies):  project ₹498  → 1,699 + 498 = 2,197 > 2,000 → SKIP
    //   stage 2 (core-employees):  project ₹398  → 1,699 + 398 = 2,097 > 2,000 → SKIP
    //   stage 3 (pulse-posts):     project ₹249  → 1,699 + 249 = 1,948 ≤ 2,000 → RUN
    //   stage 4 (pulse-profiles):  project ₹224  → 1,948 + 224 = 2,172 > 2,000 → SKIP
    //   net spend this run: ≤₹249 vs ₹1,368 overrun pre-fix. Hard cap holds.
    let ledgerOk = true
    for (const stage of STAGES) {
      // Tier filter: under soft-cap, skip Core stages.
      if (state === 'soft-cap' && stage.tier === 'core') {
        results.skippedStages.push({ name: stage.name, reason: 'soft-cap' })
        continue
      }

      const currentTotalInr = ledger?.total_inr ?? 0
      const projectedAdd = projectStageCostInr(stage.actorId, stage.maxItems)
      const projectedTotal = currentTotalInr + projectedAdd
      if (projectedTotal > HARD_CAP_INR) {
        results.skippedStages.push({
          name: stage.name,
          reason: 'pre-stage-hard-cap',
          currentTotalInr,
          projectedAdd,
          projectedTotal,
        })
        continue
      }

      const { ledgerOk: stageLedgerOk } = await runStage({
        db, req,
        name: stage.name, actorId: stage.actorId, input: stage.input,
        normalize: stage.normalize, results,
      })

      if (!stageLedgerOk) {
        // Cost-tracking failure (B3 fix). The ledger no longer reflects reality;
        // continuing would jeopardise the hard cap. Record state and stop.
        ledgerOk = false
        results.aborted = 'cost-tracking-failure'
        // Mark every un-run stage as skipped for clarity in the run doc.
        const remaining = STAGES.slice(STAGES.indexOf(stage) + 1)
        for (const r of remaining) {
          results.skippedStages.push({ name: r.name, reason: 'cost-tracking-failure' })
        }
        break
      }

      // Re-read the ledger so the next stage's projection is honest.
      ledger = await readLedger(db, monthKey)
      state = budgetState(ledger)
      results.budgetState = state
      results.monthToDateInr = ledger?.total_inr ?? 0
    }

    results.finishedAt = new Date()
    results.durationMs = results.finishedAt - results.startedAt
    await db.collection(RUNS_COLLECTION).insertOne(results)

    return res.status(ledgerOk ? 200 : 500).json({
      ok: ledgerOk,
      aborted: results.aborted,
      budgetState: state,
      monthToDateInr: results.monthToDateInr,
      stages: results.stages.map(({ name, items, inserted, ok, error }) => ({
        name, items, inserted, ok, error,
      })),
      skippedStages: results.skippedStages,
    })
  } catch (err) {
    console.error('[lead-scrape-cron] fatal', err)
    await captureRouteError(req, err, { fatal: true })
    return res.status(500).json({ ok: false, message: 'Cron failed' })
  }
}
