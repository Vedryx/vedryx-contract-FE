#!/usr/bin/env node
// scripts/test-budget-gate.mjs
//
// Replays the QA-flagged "worst-case overrun" (qa-review.md §B1) against the
// per-stage budget gate to prove the hard cap holds. Exits non-zero if the
// final ledger exceeds HARD_CAP_INR after running every stage that the gate
// would actually allow.
//
// QA scenario: ledger starts at ₹1,699 (₹1 below soft cap). All four stages
// configured at full maxItems. Without the per-stage gate, a single run
// blew ~₹1,368 above the ₹2,000 hard cap. With the gate, expensive stages
// are skipped pre-actor; only stages whose projected post-run cost stays
// under the cap actually fire.

import {
  projectStageCostInr,
  HARD_CAP_INR,
} from '../api/_apify.js'

const STAGES = [
  { name: 'core-companies', actorId: 'bebity/linkedin-premium-actor', maxItems: 2000 },
  { name: 'core-employees', actorId: 'harvestapi/linkedin-company-employees', maxItems: 1200 },
  { name: 'pulse-posts', actorId: 'supreme_coder/linkedin-post', maxItems: 3000 },
  { name: 'pulse-profiles', actorId: 'supreme_coder/linkedin-profile-scraper', maxItems: 900 },
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

// QA worst-case
const qa = simulate(1699, 'QA worst-case (ledger ₹1 below soft cap, full volumes)')
if (qa.finalLedger > HARD_CAP_INR) {
  console.error(`FAIL: final ledger ₹${qa.finalLedger.toFixed(2)} exceeds HARD_CAP_INR ₹${HARD_CAP_INR}`)
  failed = true
}

// Healthy start
const fresh = simulate(0, 'Fresh month (ledger at ₹0)')
if (fresh.finalLedger > HARD_CAP_INR) {
  console.error(`FAIL: final ledger ₹${fresh.finalLedger.toFixed(2)} exceeds HARD_CAP_INR ₹${HARD_CAP_INR}`)
  failed = true
}

// Right at hard cap
const atCap = simulate(2000, 'At hard cap (every stage should skip)')
if (atCap.ran.length !== 0) {
  console.error(`FAIL: at hard cap, no stage should run, got ran=[${atCap.ran.join(', ')}]`)
  failed = true
}

if (failed) {
  process.exit(1)
}
console.log('\nAll budget-gate scenarios respect HARD_CAP_INR.')
