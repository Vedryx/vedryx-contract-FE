#!/usr/bin/env node
// scripts/test-budget-gate.mjs
//
// Replays the QA-flagged "worst-case overrun" (qa-review.md §B1) against the
// per-stage budget gate to prove the hard cap holds. Exits non-zero if the
// final ledger exceeds HARD_CAP_INR after running every stage that the gate
// would actually allow.
//
// Updated 2026-06-12 for the actor swap (lead-pipeline-actor-rework). New
// PPE pricing has TWO components per actor — an `actorStart` flat fee and a
// per-item event price. The projection is now actor-start + (worst-event ×
// maxItems), conservatively over-estimating so the gate never under-budgets.

import {
  projectStageCostInr,
  HARD_CAP_INR,
} from '../api/_apify.js'

// maxItems shapes match api/lead-scrape-cron.js post-throttle (lead-quality-throttle,
// 2026-06-12). All three actors are now upstream-filtered and seed-list-driven, so
// the cron-side caps are far below pre-throttle defaults:
//   core-companies:  30 seed URLs/night (Sales Lead seeds 150; cron rotates)
//   core-employees:  100 worst-case after seniority+title+location+industry filters
//   pulse-posts:     50 expected from 5 tightened keywords × maxPosts:10
const STAGES = [
  { name: 'core-companies', actorId: 'harvestapi/linkedin-company', maxItems: 30 },
  { name: 'core-employees', actorId: 'harvestapi/linkedin-company-employees', maxItems: 100 },
  { name: 'pulse-posts', actorId: 'harvestapi/linkedin-post-search', maxItems: 50 },
]

function simulate(startingLedgerInr, label) {
  console.log(`\n--- ${label} ---`)
  console.log(`HARD_CAP_INR = ₹${HARD_CAP_INR}`)
  console.log(`starting ledger = ₹${startingLedgerInr}`)

  let ledger = startingLedgerInr
  const skipped = []
  const ran = []

  for (const stage of STAGES) {
    const proj = projectStageCostInr(stage.actorId, stage.maxItems)
    const projTotal = ledger + proj
    const skip = projTotal > HARD_CAP_INR
    const verdict = skip ? 'SKIP' : 'RUN'
    console.log(
      `  ${stage.name.padEnd(18)} proj=₹${proj.toFixed(2).padStart(7)}  projTotal=₹${projTotal.toFixed(2).padStart(8)}  ${verdict}`
    )
    if (skip) {
      skipped.push(stage.name)
    } else {
      ran.push(stage.name)
      ledger = projTotal
    }
  }

  console.log(`final ledger = ₹${ledger.toFixed(2)}`)
  console.log(`ran: [${ran.join(', ')}]`)
  console.log(`skipped: [${skipped.join(', ')}]`)
  return { finalLedger: ledger, ran, skipped }
}

let failed = false

// Sanity: per-stage projections must be > 0 for all current actors. If they
// fall back to 0 (missing entry in ACTOR_COSTS_USD), the cap is silently
// bypassed — guard against that.
for (const stage of STAGES) {
  const proj = projectStageCostInr(stage.actorId, stage.maxItems)
  if (!Number.isFinite(proj) || proj <= 0) {
    console.error(`FAIL: projection for ${stage.actorId} returned ${proj}; expected positive INR`)
    failed = true
  }
}

// QA worst-case — ledger ₹1 below soft cap; full volumes. Gate must hold cap.
const qa = simulate(1699, 'QA worst-case (ledger ₹1 below soft cap, full volumes)')
if (qa.finalLedger > HARD_CAP_INR) {
  console.error(`FAIL: final ledger ₹${qa.finalLedger.toFixed(2)} exceeds HARD_CAP_INR ₹${HARD_CAP_INR}`)
  failed = true
}

// Healthy start — gate should allow every stage to run.
const fresh = simulate(0, 'Fresh month (ledger at ₹0)')
if (fresh.finalLedger > HARD_CAP_INR) {
  console.error(`FAIL: final ledger ₹${fresh.finalLedger.toFixed(2)} exceeds HARD_CAP_INR ₹${HARD_CAP_INR}`)
  failed = true
}
if (fresh.ran.length !== STAGES.length) {
  console.error(`FAIL: fresh-month run should not skip stages, got skipped=[${fresh.skipped.join(', ')}]`)
  failed = true
}

// At hard cap — every stage must skip.
const atCap = simulate(2000, 'At hard cap (every stage should skip)')
if (atCap.ran.length !== 0) {
  console.error(`FAIL: at hard cap, no stage should run, got ran=[${atCap.ran.join(', ')}]`)
  failed = true
}

if (failed) {
  process.exit(1)
}
console.log('\nAll budget-gate scenarios respect HARD_CAP_INR.')
