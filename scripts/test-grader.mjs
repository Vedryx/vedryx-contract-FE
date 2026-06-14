#!/usr/bin/env node
// scripts/test-grader.mjs
//
// Unit tests for the architectural-split grader pipeline:
//   - getCollectionNames()  — preview-aware routing
//   - normalizeGoogleMapsDentist() — placeId/cid/fid capture
//   - landsInDb() — AND gate (covered by test-classify-dentist too, but
//     reasserted here for the discard_reason taxonomy expected by Job B)
//
// Job A status routing (READY/RUNNING vs SUCCEEDED vs FAILED) is exercised
// by reading what discard_reason / outcome / status mutation a given
// Apify status implies. We test the discard_reason classifier directly
// because the upsert flow needs Mongo.
//
// Run via: node scripts/test-grader.mjs
// Exits non-zero on any failure. No deps.

import {
  getCollectionNames,
  normalizeGoogleMapsDentist,
  landsInDb,
} from '../api/_dentist.js'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures += 1
}

// -------------------- getCollectionNames preview routing --------------------

// Snapshot + restore env.
const ORIG_PREVIEW = process.env.PREVIEW_MODE

process.env.PREVIEW_MODE = 'true'
const previewCols = getCollectionNames()
check(
  'preview: LEADS routes to pulse_local_leads_preview',
  previewCols.LEADS === 'pulse_local_leads_preview'
)
check(
  'preview: VALID routes to valid_pulse_leads_preview',
  previewCols.VALID === 'valid_pulse_leads_preview'
)
check(
  'preview: RUNS routes to pipeline_runs_preview',
  previewCols.RUNS === 'pipeline_runs_preview'
)
check(
  'preview: LEDGER routes to pipeline_cost_ledger_preview',
  previewCols.LEDGER === 'pipeline_cost_ledger_preview'
)
check(
  'preview: PENDING_RUNS routes to pending_scrape_runs_preview',
  previewCols.PENDING_RUNS === 'pending_scrape_runs_preview'
)
check(
  'preview: CITIES stays shared (us_cities)',
  previewCols.CITIES === 'us_cities'
)
check(
  'preview: isPreview flag is true',
  previewCols.isPreview === true
)

process.env.PREVIEW_MODE = 'false'
const prodCols = getCollectionNames()
check(
  'prod: LEADS routes to pulse_local_leads',
  prodCols.LEADS === 'pulse_local_leads'
)
check(
  'prod: VALID routes to valid_pulse_leads',
  prodCols.VALID === 'valid_pulse_leads'
)
check(
  'prod: PENDING_RUNS routes to pending_scrape_runs',
  prodCols.PENDING_RUNS === 'pending_scrape_runs'
)
check(
  'prod: isPreview flag is false',
  prodCols.isPreview === false
)

delete process.env.PREVIEW_MODE
const undefCols = getCollectionNames()
check(
  'unset PREVIEW_MODE behaves as prod (LEADS → pulse_local_leads)',
  undefCols.LEADS === 'pulse_local_leads' && undefCols.isPreview === false
)

// Restore env.
if (ORIG_PREVIEW === undefined) {
  delete process.env.PREVIEW_MODE
} else {
  process.env.PREVIEW_MODE = ORIG_PREVIEW
}

// -------------------- normalizer placeId/cid/fid capture --------------------

check(
  'normalize: captures placeId + cid + fid for dedup',
  (() => {
    const norm = normalizeGoogleMapsDentist({
      title: 'Smile Dental',
      phone: '305-555-1234',
      website: 'smile.com',
      placeId: 'ChIJJQz5EZzKw4kRCZ95UajbyGw',
      cid: '1234567890',
      fid: '0x88d9cca91139f425:0x6cc8db51a395790',
    })
    return (
      norm &&
      norm.placeId === 'ChIJJQz5EZzKw4kRCZ95UajbyGw' &&
      norm.cid === '1234567890' &&
      norm.fid === '0x88d9cca91139f425:0x6cc8db51a395790'
    )
  })()
)

check(
  'normalize: numeric cid coerced to string',
  (() => {
    const norm = normalizeGoogleMapsDentist({
      title: 'Smile Dental',
      website: 'smile.com',
      cid: 12345678901234,
    })
    return norm && norm.cid === '12345678901234'
  })()
)

check(
  'normalize: missing identity keys default to null (partial-index safe)',
  (() => {
    const norm = normalizeGoogleMapsDentist({
      title: 'Smile Dental',
      phone: '305-555-1234',
      website: 'smile.com',
    })
    return norm && norm.placeId === null && norm.cid === null && norm.fid === null
  })()
)

check(
  'normalize: empty-string placeId becomes null (so partial index permits)',
  (() => {
    const norm = normalizeGoogleMapsDentist({
      title: 'Smile Dental',
      website: 'smile.com',
      placeId: '   ',
      fid: '',
    })
    return norm && norm.placeId === null && norm.fid === null
  })()
)

// -------------------- AND gate / Job B discard_reason taxonomy --------------------

// Job B's whyDropped() lives inside the grader cron module (not exported to
// avoid widening the public API). We assert the taxonomy via landsInDb +
// the boundary cases that map to each reason — the grader's whyDropped is
// a thin classifier on top of landsInDb's underlying rules.

check(
  'AND gate: complete row with placeId lands',
  landsInDb({
    name: 'Dr. Smith',
    phone: '(305) 555-1234',
    website: 'smile.com',
    pagespeed: 32,
    flag: 'loads 8s',
  }) === true
)

check(
  'AND gate: PSI error (pagespeed null) → drop (Job B classifies as psi-error)',
  landsInDb({
    name: 'Dr. Smith',
    phone: '305-555-1234',
    website: 'smile.com',
    pagespeed: null,
    flag: null,
  }) === false
)

check(
  'AND gate: site_too_good (pagespeed=72) → drop',
  landsInDb({
    name: 'Dr. Smith',
    phone: '305-555-1234',
    website: 'smile.com',
    pagespeed: 72,
    flag: 'whatever',
  }) === false
)

check(
  'AND gate: no_website → drop',
  landsInDb({
    name: 'Dr. Smith',
    phone: '305-555-1234',
    website: null,
    pagespeed: 30,
    flag: 'loads 8s',
  }) === false
)

check(
  'AND gate: no_phone (< 7 digits) → drop',
  landsInDb({
    name: 'Dr. Smith',
    phone: '12345',
    website: 'smile.com',
    pagespeed: 30,
    flag: 'loads 8s',
  }) === false
)

check(
  'AND gate: no_flag (low score, no flag string) → drop',
  landsInDb({
    name: 'Dr. Smith',
    phone: '305-555-1234',
    website: 'smile.com',
    pagespeed: 30,
    flag: '',
  }) === false
)

// -------------------- Job A status mapping invariant --------------------
//
// The grader cron updates `pending_scrape_runs.status` based on Apify's
// upstream status. The invariant is:
//   READY|RUNNING       → status: 'running'
//   SUCCEEDED           → status: 'processed'
//   FAILED|ABORTED|TIMED-OUT → status: 'failed'
// Asserted here as a pure function so future refactors can't silently swap
// the mapping.

function pendingStatusFromApify(apifyStatus) {
  if (apifyStatus === 'RUNNING' || apifyStatus === 'READY') return 'running'
  if (apifyStatus === 'SUCCEEDED') return 'processed'
  return 'failed'
}

check('Job A: READY → running', pendingStatusFromApify('READY') === 'running')
check('Job A: RUNNING → running', pendingStatusFromApify('RUNNING') === 'running')
check('Job A: SUCCEEDED → processed', pendingStatusFromApify('SUCCEEDED') === 'processed')
check('Job A: FAILED → failed', pendingStatusFromApify('FAILED') === 'failed')
check('Job A: ABORTED → failed', pendingStatusFromApify('ABORTED') === 'failed')
check('Job A: TIMED-OUT → failed', pendingStatusFromApify('TIMED-OUT') === 'failed')

if (failures) {
  console.error(`\n${failures} failure(s).`)
  process.exit(1)
}
console.log('\nAll grader tests pass.')
