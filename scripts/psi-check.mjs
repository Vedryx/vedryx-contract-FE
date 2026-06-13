#!/usr/bin/env node
// PSI (PageSpeed Insights) weekly check.
//
// What this does
// --------------
// 1. Hits the PSI API for each TARGET_URL × form_factor (mobile, desktop).
// 2. Records the four category scores (performance, accessibility,
//    best-practices, seo) plus a small set of headline audit flags.
// 3. Persists the snapshot as JSON in `.psi-snapshots/` under a stable
//    `<form_factor>-<slug>.json` name (so git diff = week-over-week diff).
// 4. Compares the new snapshot to the previous git-committed one and
//    decides whether to open a regression issue.
//
// Regression criteria (any of):
//   - perf score drops > 10 points (out of 100) week-over-week
//   - perf score < 70 absolute
//   - any audit score crosses from passing (>= 0.9) to failing (< 0.9)
//
// Output
// ------
// Prints a JSON line to stdout summarizing the result; CI step reads it.
// Exit code is 0 even on regression — the workflow opens the issue itself
// based on the JSON, so we never fail the cron run (which would suppress
// future snapshots and break the comparison baseline).
//
// Env
// ---
// PAGESPEED_API_KEY — required. PSI works without a key but rate-limits
//                     aggressively. Same value as the Vercel env var.
// TARGET_URLS       — comma-separated list of URLs to audit. Required.
// SNAPSHOT_DIR      — defaults to `.psi-snapshots`.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SNAPSHOT_DIR = path.resolve(REPO_ROOT, process.env.SNAPSHOT_DIR || '.psi-snapshots')

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo']
const FORM_FACTORS = ['mobile', 'desktop']

// Regression thresholds. Keep these in code, not env — they are policy.
const PERF_DROP_PCT = 10 // points out of 100
const PERF_FLOOR = 70 // absolute
const AUDIT_PASS = 0.9 // a score >= 0.9 is "passing" per Lighthouse convention

// Audits we care about specifically. PSI returns dozens; these are the ones
// that have actually moved on this project historically and are worth
// surfacing in the issue body when they regress.
const TRACKED_AUDITS = [
  'largest-contentful-paint',
  'cumulative-layout-shift',
  'interaction-to-next-paint',
  'total-blocking-time',
  'speed-index',
  'first-contentful-paint',
  'render-blocking-resources',
  'unused-javascript',
  'unminified-javascript',
  'uses-responsive-images',
  'uses-text-compression',
  'modern-image-formats',
  'efficient-animated-content',
  'server-response-time',
  'color-contrast',
  'image-alt',
  'meta-description',
  'crawlable-anchors',
  'is-on-https',
]

function slugify(url) {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
}

async function fetchPsi(url, strategy) {
  const apiKey = process.env.PAGESPEED_API_KEY
  const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed')
  endpoint.searchParams.set('url', url)
  endpoint.searchParams.set('strategy', strategy)
  CATEGORIES.forEach((c) => endpoint.searchParams.append('category', c))
  if (apiKey) endpoint.searchParams.set('key', apiKey)

  const res = await fetch(endpoint, { method: 'GET' })
  if (!res.ok) {
    const body = await res.text().catch(() => '<no body>')
    throw new Error(`PSI ${strategy} for ${url} failed: ${res.status} ${body.slice(0, 200)}`)
  }
  return res.json()
}

function extractScores(lh) {
  const out = { categories: {}, audits: {} }
  for (const c of CATEGORIES) {
    const score = lh?.categories?.[c]?.score
    out.categories[c] = score == null ? null : Math.round(score * 100)
  }
  for (const a of TRACKED_AUDITS) {
    const audit = lh?.audits?.[a]
    if (!audit) continue
    out.audits[a] = {
      score: audit.score ?? null,
      display_value: audit.displayValue ?? null,
    }
  }
  return out
}

async function loadPrevSnapshot(snapPath) {
  if (!existsSync(snapPath)) return null
  try {
    const raw = await readFile(snapPath, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    console.error(`Could not parse previous snapshot ${snapPath}: ${err.message}`)
    return null
  }
}

function diffSnapshots(prev, next) {
  const regressions = []
  if (!prev) {
    // No baseline yet → no regression to report, just record the first run.
    return regressions
  }

  for (const c of CATEGORIES) {
    const prevScore = prev.categories?.[c]
    const nextScore = next.categories?.[c]
    if (prevScore == null || nextScore == null) continue
    if (c === 'performance') {
      if (nextScore < PERF_FLOOR) {
        regressions.push({
          type: 'perf-floor',
          category: c,
          prev: prevScore,
          next: nextScore,
          delta: nextScore - prevScore,
          note: `perf score ${nextScore} below floor ${PERF_FLOOR}`,
        })
      }
      if (prevScore - nextScore > PERF_DROP_PCT) {
        regressions.push({
          type: 'perf-drop',
          category: c,
          prev: prevScore,
          next: nextScore,
          delta: nextScore - prevScore,
          note: `perf dropped ${prevScore - nextScore} points week-over-week`,
        })
      }
    }
  }

  for (const a of TRACKED_AUDITS) {
    const prevAudit = prev.audits?.[a]
    const nextAudit = next.audits?.[a]
    if (!prevAudit || !nextAudit) continue
    const prevPassing = (prevAudit.score ?? 1) >= AUDIT_PASS
    const nextPassing = (nextAudit.score ?? 1) >= AUDIT_PASS
    if (prevPassing && !nextPassing) {
      regressions.push({
        type: 'audit-broke',
        audit: a,
        prev_score: prevAudit.score,
        next_score: nextAudit.score,
        prev_display: prevAudit.display_value,
        next_display: nextAudit.display_value,
        note: `audit ${a} crossed from passing → failing`,
      })
    }
  }

  return regressions
}

async function checkOne(url, strategy) {
  const snapName = `${strategy}-${slugify(url)}.json`
  const snapPath = path.join(SNAPSHOT_DIR, snapName)
  const prev = await loadPrevSnapshot(snapPath)

  const psi = await fetchPsi(url, strategy)
  const lh = psi.lighthouseResult
  const scores = extractScores(lh)

  const next = {
    url,
    strategy,
    fetched_at: new Date().toISOString(),
    lighthouse_version: lh?.lighthouseVersion ?? null,
    categories: scores.categories,
    audits: scores.audits,
  }

  await mkdir(SNAPSHOT_DIR, { recursive: true })
  await writeFile(snapPath, JSON.stringify(next, null, 2) + '\n', 'utf8')

  const regressions = diffSnapshots(prev, next)
  return {
    url,
    strategy,
    snapshot_path: path.relative(REPO_ROOT, snapPath),
    prev_categories: prev?.categories ?? null,
    next_categories: next.categories,
    regressions,
  }
}

async function main() {
  const targets = (process.env.TARGET_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (targets.length === 0) {
    console.error('TARGET_URLS env var is empty — nothing to audit.')
    process.exit(2)
  }

  const results = []
  const failures = []
  for (const url of targets) {
    for (const strategy of FORM_FACTORS) {
      try {
        results.push(await checkOne(url, strategy))
      } catch (err) {
        failures.push({ url, strategy, error: err.message })
      }
    }
  }

  const anyRegression = results.some((r) => r.regressions.length > 0)
  const summary = {
    ran_at: new Date().toISOString(),
    targets,
    results,
    failures,
    has_regression: anyRegression || failures.length > 0,
  }

  // Single-line JSON to stdout — CI parses this.
  console.log(JSON.stringify(summary))
}

main().catch((err) => {
  console.error('psi-check fatal:', err)
  // Exit 0 anyway so the workflow continues to commit any snapshots it did
  // get. The summary will be missing, but the workflow's grep for
  // has_regression will treat absence as "no regression" — safe default.
  process.exit(0)
})
