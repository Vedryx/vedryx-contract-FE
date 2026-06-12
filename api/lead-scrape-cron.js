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
const SEED_COMPANIES_COLLECTION = 'core_seed_companies'

/**
 * Pull the next batch of seed LinkedIn company URLs for the Core stages.
 *
 * Rotates least-recently-fetched first so a 150-URL seed list refreshes its
 * full surface every ~5 nights at 30/night. Marks fetched seeds with the
 * current timestamp so the next run picks fresh ones.
 *
 * Returns `[]` if the seed list is empty — Sales Lead has not seeded yet. The
 * downstream stages handle an empty `companies` input by returning 0 items
 * (Actor-side), which is the desired safe-default behaviour: the pipeline
 * runs Pulse only until seeds arrive.
 *
 * @param {import('mongodb').Db} db
 * @param {number} [batchSize=30]
 * @returns {Promise<string[]>}
 */
export async function getSeedBatch(db, batchSize = 30) {
  const col = db.collection(SEED_COMPANIES_COLLECTION)
  const seeds = await col
    .find({ active: { $ne: false } })
    .sort({ last_fetched: 1 })
    .limit(batchSize)
    .toArray()
  const urls = seeds
    .map((s) => s.linkedin_url)
    .filter((u) => typeof u === 'string' && u.length > 0)
  if (urls.length) {
    await col.updateMany(
      { linkedin_url: { $in: urls } },
      { $set: { last_fetched: new Date() } }
    )
  }
  return urls
}

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

// Per-stage maxItems caps (RA §6 + §C). These are forwarded as the `maxItems`
// URL query param on Apify's run-sync endpoint (the body field is ignored —
// PR #28 attempted that and saw 669 items returned anyway). Sized to match
// post-upstream-filter expected yields with headroom for classifier room.
const CORE_COMPANY_MAX = 30   // 30 seed URLs/night (Sales Lead seeds 150, cron rotates)
const CORE_EMPLOYEE_MAX = 100 // 30 seeds × ~3 senior+region+title matches = ~60-100
const PULSE_POST_MAX = 50     // 5 queries × 10/query post-tightening

const CORE_COMPANY_ACTOR_INPUT = {
  // harvestapi/linkedin-company — seeded from Mongo `core_seed_companies`.
  // Sales Lead maintains 150 vetted LinkedIn company URLs; getSeedBatch()
  // rotates 30/night. `companies` is injected at handler() runtime, so the
  // static input here intentionally omits it. Pre-seed, this stage yields 0
  // items — that is the desired safe-default behaviour.
  maxItems: CORE_COMPANY_MAX,
  maxTotalChargeUsd: PER_RUN_MAX_USD['harvestapi/linkedin-company'],
}

const CORE_EMPLOYEE_ACTOR_INPUT = {
  // harvestapi/linkedin-company-employees — Short tier (name + URL only).
  // The literal enum value MUST include the price tag (RA §5 + research-001 §6.2).
  // Old enum 'Short' is invalid post-rebuild and returns HTTP 400.
  profileScraperMode: 'Short ($4 per 1k)',
  maxItems: CORE_EMPLOYEE_MAX,
  maxTotalChargeUsd: PER_RUN_MAX_USD['harvestapi/linkedin-company-employees'],
  // RA §6.2 upstream quality filters — every match here is billed against
  // FEWER items (vs filtering client-side and paying for the full pull).
  // Live Apify build schema (btXbM48jsC4dsKfZ5) declares these as string[]
  // (items.type: "string"). Integer arrays trigger silent per-stage 400s.
  seniorityLevelIds: ['120', '130', '220', '300', '310'], // Senior / Strategic / Director / VP / CXO
  functionIds: ['8', '12'],                                // Engineering + HR
  jobTitles: [
    'Head of Engineering', 'VP Engineering', 'VP of Engineering',
    'CTO', 'Engineering Manager', 'Director of Engineering',
    'VP Talent', 'HR Director', 'Technical Recruiter',
  ],
  locations: [
    'United States', 'United Kingdom', 'Australia',
    'Germany', 'Netherlands', 'France', 'Sweden', 'Ireland',
    'United Arab Emirates', 'Saudi Arabia', 'India',
  ],
  companyHeadcount: ['D', 'E'], // 51-200, 201-500
  // Verified against harvestapi CSV 2026-06-12:
  //   4  = Software Development
  //   6  = Technology, Information and Internet
  //   96 = IT Services and IT Consulting
  //   43 = Financial Services
  // Source: github.com/HarvestAPI/linkedin-industry-codes-v2
  industryIds: ['4', '6', '96', '43'],
  // companies injected at runtime from getSeedBatch() — same seed set as core-companies.
}

const PULSE_POST_ACTOR_INPUT = {
  // harvestapi/linkedin-post-search — native keyword search.
  // RA §6.3 tightened set: 5 high-intent keywords replace the prior 10-key
  // generic set (which yielded the 669-item overshoot).
  searchQueries: [
    'looking for technical cofounder',
    'need a developer for my MVP',
    'hiring CTO for early stage',
    'ready to launch my MVP',
    '#buildinpublic looking for dev',
  ],
  // Throttle (2026-06-12, lead-quality-throttle):
  //   - `postedLimit: '24h'` is the tightest valid Actor enum. The 18h cap the
  //     founder wants is enforced client-side inside classifyLead() because
  //     '18h' is NOT a valid enum value.
  //   - `maxPosts: 10` is the Actor's authoritative per-query throttle ("Maximum
  //     posts per query"). 5 queries × 10 = 50 expected. The earlier bug (669
  //     items despite maxItems:40 in the input body) is because the body field
  //     is ignored; the real cap is the URL `maxItems` query param, which we
  //     forward via runActor({ maxItems }) below.
  //   - `authorKeywords` is a LinkedIn boolean-OR string (vendor schema: string,
  //     not array). Filters Actor-side to founder-shaped authors before billing.
  //   - `authorsIndustryId` is an array of LinkedIn V2 industry IDs (verified
  //     against harvestapi CSV today).
  postedLimit: '24h',
  maxItems: PULSE_POST_MAX,                 // also forwarded as URL param
  maxPosts: 10,                              // per-query Actor-native throttle
  maxTotalChargeUsd: PER_RUN_MAX_USD['harvestapi/linkedin-post-search'],
  authorKeywords: 'founder OR co-founder OR ceo OR "solo founder" OR "indie maker"',
  authorsIndustryId: ['4', '6', '96'],      // verified CSV IDs (RA §6.3); live schema = string[]
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
// Sized PER STAGE because the three actors have different runtime profiles
// (live-measured 2026-06-12 against the dev_for_vedryx Apify account):
//   - linkedin-company:           1–9s for 30 seeds (firmographic lookup, fast)
//   - linkedin-company-employees: 1–3s for empty seed input; ~30–60s for 30 seeds
//   - linkedin-post-search:       60–80s for 50 items across 5 queries
//
// The previous flat 60s cap was triggering an AbortController abort on
// pulse-posts even when Apify's run succeeded server-side in 76s — we lost the
// dataset AND paid the actor cost (Apify keeps charging after our fetch aborts).
// Per-stage budgets total ≤ 230s, leaving ≥ 70s for DB upserts + budget gate
// under Vercel Hobby's 300s function cap.
const STAGE_TIMEOUT_MS = {
  'core-companies': 60_000,
  'core-employees': 90_000,
  'pulse-posts': 120_000,
}
const DEFAULT_STAGE_TIMEOUT_MS = 60_000

// Friendly error mapper for the most common Apify 4xx failures. Surfaces
// actionable next-steps in the run doc + Sentry without losing the raw error.
function classifyActorError(message = '') {
  const m = String(message)
  if (/full-permission-actor-not-approved/i.test(m)) {
    return {
      kind: 'permissions-not-approved',
      action: 'Founder: open the Actor in the Apify console while logged in as the token-owning user, click "Approve permissions". The approval URL is in the error message.',
    }
  }
  if (/invalid-input/i.test(m) || /returned 400/.test(m)) {
    return { kind: 'invalid-input', action: 'Check Actor input schema for breaking changes.' }
  }
  if (/operation was aborted/i.test(m)) {
    return { kind: 'client-timeout', action: 'Stage timeout exceeded; consider raising STAGE_TIMEOUT_MS for this stage.' }
  }
  return { kind: 'unknown', action: null }
}

async function runStage({ db, req, name, actorId, input, normalize, maxItems, results }) {
  let actorOut
  const timeoutMs = STAGE_TIMEOUT_MS[name] ?? DEFAULT_STAGE_TIMEOUT_MS
  try {
    actorOut = await runActor(actorId, input, {
      timeoutMs,
      // Forward `maxItems` to Apify's URL query param — this is the AUTHORITATIVE
      // per-run cap. PR #28 set `maxItems` in the input body and still saw 669
      // items because the body field is ignored on the sync endpoint.
      maxItems,
    })
  } catch (err) {
    const errMsg = String(err?.message || err)
    const { kind, action } = classifyActorError(errMsg)
    console.error(`[${name}] actor failed (${kind})`, errMsg)
    await captureRouteError(req, err, { stage: name, actor: actorId, errorKind: kind })
    results.stages.push({
      name, actor: actorId, ok: false, error: errMsg,
      errorKind: kind,
      ...(action ? { recommendedAction: action } : {}),
    })
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
    // RA §F + §6.8: route to telecaller surface tiers based on weighted score.
    // Threshold 70 is the telecaller queue gate; the surface query at
    // `signal.icp_score >= 70` reads either `priority` (>=80) or `queued`
    // (>=70). Disqualified leads keep the legacy `disqualified` status.
    if (icp === 'disqualified') {
      normalized.status = 'disqualified'
    } else if (score >= 80) {
      normalized.status = 'priority'
    } else if (score >= 70) {
      normalized.status = 'queued'
    } else if (score >= 50) {
      normalized.status = 'review'
    } else {
      normalized.status = 'disqualified'
    }

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

    // -------------------- Seed list injection (RA §6.1) --------------------
    // Both Core stages run against the same nightly seed batch — companies
    // (firmographic) and employees (people in those companies). Pulling once
    // and reusing keeps the batch consistent across the two stages and
    // avoids double-rotating the seed pool.
    const seedUrls = await getSeedBatch(db, 30)
    results.seedUrlsCount = seedUrls.length
    if (seedUrls.length === 0) {
      console.warn('[lead-scrape-cron] core_seed_companies empty — Core stages will be skipped. Sales Lead must seed before Core pipeline runs.')
    }
    CORE_COMPANY_ACTOR_INPUT.companies = seedUrls
    CORE_EMPLOYEE_ACTOR_INPUT.companies = seedUrls

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

      // Seed-list short-circuit: both Core stages depend on the Mongo seed pool.
      // Running with companies:[] burns an actor-start fee for 0 results and
      // pollutes the status doc with successful-but-empty stages, masking the
      // real bottleneck (Sales Lead has not seeded core_seed_companies yet).
      if (stage.tier === 'core' && seedUrls.length === 0) {
        results.skippedStages.push({ name: stage.name, reason: 'no-seeds' })
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
        normalize: stage.normalize, maxItems: stage.maxItems, results,
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
      seedUrlsCount: results.seedUrlsCount,
      stages: results.stages.map(({ name, items, inserted, ok, error, errorKind, recommendedAction }) => ({
        name, items, inserted, ok, error, errorKind, recommendedAction,
      })),
      skippedStages: results.skippedStages,
    })
  } catch (err) {
    console.error('[lead-scrape-cron] fatal', err)
    await captureRouteError(req, err, { fatal: true })
    return res.status(500).json({ ok: false, message: 'Cron failed' })
  }
}
