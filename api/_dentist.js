// Dentist scrape helpers: city rotation, PSI grading, AND-gate classification,
// Google Maps + email normalizers.
//
// Kept separate from api/_apify.js to leave the LinkedIn pipeline untouched.
// The two modules share:
//   - the same `pipeline_cost_ledger` Mongo collection (ledgerMonthKey,
//     SOFT_CAP_INR, HARD_CAP_INR, USD_TO_INR, isMondayIST imported from _apify)
//   - the same `runActor()` REST entry-point (also from _apify)
//
// We do NOT share `ACTOR_COSTS_USD` because the dentist pipeline uses
// completely different Apify Actors (Google Maps + website-content-crawler)
// with different PPE shapes. Defined locally below.

import { runActor, USD_TO_INR } from './_apify.js'

// -------------------- Preview-aware collection routing --------------------
//
// Vercel preview deploys carry PREVIEW_MODE=true (env var pushed via the
// Vercel MCP). When set, ALL Mongo collection names this pipeline writes to
// are suffixed `_preview` so a preview/PR test cannot pollute production data.
//
// Use this helper EVERYWHERE the cron touches Mongo. Hard-coded collection
// names elsewhere in the dentist pipeline are a bug.
//
// Note: `pipeline_cost_ledger` IS preview-routed for symmetry — a preview
// burst that hits Apify still costs real money and should be ledgered, but
// against the preview ledger so it cannot trip the prod hard-cap gate by
// itself. (Same actor calls — Apify doesn't have a sandbox — but logically
// isolated for accounting.)
//
// `pipeline_runs` is preview-routed so prod observability stays clean.
// `us_cities` is shared (it is a static rotation pool, not output data).
export function getCollectionNames() {
  const isPreview = process.env.PREVIEW_MODE === 'true'
  const suffix = isPreview ? '_preview' : ''
  return {
    LEADS: `pulse_local_leads${suffix}`,
    VALID: `valid_pulse_leads${suffix}`,
    RUNS: `pipeline_runs${suffix}`,
    LEDGER: `pipeline_cost_ledger${suffix}`,
    PENDING_RUNS: `pending_scrape_runs${suffix}`,
    // us_cities is the rotation pool — shared across preview + prod so a
    // preview run rotates the same way prod would.
    CITIES: 'us_cities',
    isPreview,
  }
}

// -------------------- Actor cost shape (PPE) --------------------
// Sized from Apify Actor marketplace pricing as of 2026-06-14. Belt+suspenders
// against the monthly ledger gate. Founder pays a $30/mo subscription that
// already covers these Actors; the ledger is still enforced so a misconfigured
// run cannot drain the subscription credit AND surprise-bill an overage.
//
// `compass/crawler-google-places` — flat per-1k items (~$1/1k). Treat as
// expectedEvent only. actorStart minimal.
// `apify/website-content-crawler` — per-page fee (~$1/1k pages). We crawl up to
// 5 pages per dentist site; itemCount in the ledger reflects pages crawled,
// not dentists processed.
export const DENTIST_ACTOR_COSTS_USD = {
  'compass/crawler-google-places': {
    actorStart: 0.0,
    expectedEvent: 0.001, // $1/1k Google Maps places
  },
  'apify/website-content-crawler': {
    actorStart: 0.0,
    expectedEvent: 0.001, // $1/1k pages crawled
  },
}

export const DENTIST_PER_RUN_MAX_USD = {
  'compass/crawler-google-places': 2.0,
  'apify/website-content-crawler': 3.0,
}

/**
 * Project the INR cost of running a dentist-pipeline actor at a given volume.
 * Conservatively over-projects (worst event × itemCount + actorStart) so the
 * gate never under-budgets.
 *
 * @param {string} actorId
 * @param {number} itemCount
 * @returns {number} projected INR; 0 if actor is unknown (caller must guard).
 */
export function projectDentistStageCostInr(actorId, itemCount) {
  const cfg = DENTIST_ACTOR_COSTS_USD[actorId]
  if (!cfg) return 0
  const usd = (cfg.actorStart || 0) + (cfg.expectedEvent || 0) * itemCount
  return usd * USD_TO_INR
}

// -------------------- City rotation --------------------

/**
 * Pick the next US city to scrape — oldest `last_scraped` first (NULL first
 * per Mongo asc sort semantics). Limits to one city per call.
 *
 * Returns the full city doc or null if the collection is empty (founder hasn't
 * run scripts/seed-us-cities.mjs yet). Caller MUST guard on null and short-
 * circuit the run.
 *
 * @param {import('mongodb').Db} db
 * @returns {Promise<{ city: string, state: string, population: number, last_scraped: Date|null }|null>}
 */
export async function pickNextCity(db) {
  const doc = await db
    .collection('us_cities')
    .find({ active: true })
    .sort({ last_scraped: 1 })
    .limit(1)
    .next()
  return doc || null
}

/**
 * Mark a city as scraped — sets last_scraped = now. Called after the night's
 * pipeline succeeds (even if 0 leads landed; the city had its turn).
 *
 * @param {import('mongodb').Db} db
 * @param {{ city: string, state: string }} city
 * @returns {Promise<void>}
 */
export async function markCityScraped(db, city) {
  await db.collection('us_cities').updateOne(
    { city: city.city, state: city.state },
    { $set: { last_scraped: new Date() } }
  )
}

// -------------------- AND-gate classification --------------------

/**
 * Strict AND gate: required-field check before Mongo insert.
 *
 * Schema:
 *   name      string, non-empty           REQUIRED
 *   phone     string, length >= 7          REQUIRED
 *   website   string, non-empty            REQUIRED
 *   pagespeed finite number < 50           REQUIRED (low score = bad site)
 *   flag      string, non-empty            REQUIRED (human-readable explanation)
 *   email     string|null                  OPTIONAL
 *
 * If pagespeed >= 50 the site is fine; we drop the lead — Vedryx Pulse has
 * nothing to sell. If any required field is missing OR the wrong type, drop.
 *
 * @param {object} lead
 * @returns {boolean} true if the lead may be inserted into Mongo.
 */
export function landsInDb(lead) {
  if (!lead || typeof lead !== 'object') return false
  // name
  if (typeof lead.name !== 'string' || lead.name.trim().length === 0) return false
  // phone (digits-only length >= 7; raw string keeps formatting)
  if (typeof lead.phone !== 'string') return false
  const phoneDigits = lead.phone.replace(/\D/g, '')
  if (phoneDigits.length < 7) return false
  // website
  if (typeof lead.website !== 'string' || lead.website.trim().length === 0) return false
  // pagespeed must be a finite number strictly less than 50
  if (!Number.isFinite(lead.pagespeed)) return false
  if (lead.pagespeed >= 50) return false
  if (lead.pagespeed < 0) return false
  // flag
  if (typeof lead.flag !== 'string' || lead.flag.trim().length === 0) return false
  // email is optional; if present must be string
  if (lead.email != null && typeof lead.email !== 'string') return false
  return true
}

// -------------------- Google Maps normalizer --------------------

/**
 * Normalize a `compass/crawler-google-places` record into our partial lead
 * shape (pre-PSI). Field-mapping reality (CEO inspection 2026-06-14):
 *
 *   - the Actor returns `title` for the business name (NOT `name`).
 *     `subTitle` is a usable secondary fallback for branded listings.
 *   - `website` is present only when the Google Maps profile lists one;
 *     `webResults[0]?.url` is a usable fallback (the Actor's enriched
 *     web-search result).
 *   - `emails` (array, populated when `scrapeContacts: true`) supersedes the
 *     standalone website-content-crawler stage — surface emails[0] here so
 *     the cron can drop the separate stage entirely.
 *
 * We DO NOT early-drop on missing website. The AND gate (`landsInDb`) handles
 * required-field enforcement; rows missing website get dropped there with
 * `dropReasons['no-website']` for observability.
 *
 * Returns `null` only when the row has no usable name at all.
 *
 * @param {object} raw
 * @returns {{ name: string, phone: string|null, website: string|null, email: string|null, address: string|null, category: string|null }|null}
 */
export function normalizeGoogleMapsDentist(raw = {}) {
  const name = (
    (typeof raw.title === 'string' && raw.title) ||
    (typeof raw.name === 'string' && raw.name) ||
    (typeof raw.subTitle === 'string' && raw.subTitle) ||
    ''
  ).trim()
  if (!name) return null

  // Website: prefer Actor's `website` field, fall back to webResults enrichment.
  // No early drop — AND gate enforces required-field. null = drop downstream.
  let website = null
  if (typeof raw.website === 'string' && raw.website.trim()) {
    website = raw.website.trim()
  } else if (Array.isArray(raw.webResults) && raw.webResults.length > 0) {
    const w = raw.webResults[0]
    if (w && typeof w.url === 'string' && w.url.trim()) {
      website = w.url.trim()
    }
  }

  // Phone normalization: the Actor returns either `phone` (single string),
  // `phoneUnformatted` (digits only), `phones` (array — newer Actor shape),
  // or `phoneNumbers` (array — older shape).
  const phone =
    (typeof raw.phone === 'string' && raw.phone) ||
    (typeof raw.phoneUnformatted === 'string' && raw.phoneUnformatted) ||
    (Array.isArray(raw.phones) && typeof raw.phones[0] === 'string' && raw.phones[0]) ||
    (Array.isArray(raw.phoneNumbers) && typeof raw.phoneNumbers[0] === 'string' && raw.phoneNumbers[0]) ||
    null

  // Email: surface Actor's own contact extraction. `emails` is populated when
  // input.scrapeContacts === true. Filter junk (must contain '@').
  let email = null
  if (Array.isArray(raw.emails)) {
    const first = raw.emails.find((e) => typeof e === 'string' && e.includes('@'))
    if (first) email = first.trim().toLowerCase()
  }

  const address = (raw.address || raw.street || null) || null
  const category =
    raw.categoryName ||
    (Array.isArray(raw.categories) && raw.categories[0]) ||
    null

  // Long-horizon identity keys (RA §5, brief §4):
  //   - placeId: Google Place ID. Stable for ~12 months; rotates on relocation/
  //     rebrand/DB churn. Day-to-day dedup key.
  //   - cid: numeric Customer ID. PERMANENT for verified businesses; survives
  //     placeId rotation. Long-horizon merge key.
  //   - fid: internal Google feature id. Treat as opaque backup.
  // Compound unique index on (placeId, cid, fid) — partial so null fields
  // are allowed but among-non-null values are unique.
  const placeId = (typeof raw.placeId === 'string' && raw.placeId.trim()) || null
  const cidRaw = raw.cid ?? null
  const cid = cidRaw == null ? null : String(cidRaw).trim() || null
  const fid = (typeof raw.fid === 'string' && raw.fid.trim()) || null

  return { name, phone, website, email, address, category, placeId, cid, fid }
}

// -------------------- PageSpeed grading --------------------

const PSI_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

/**
 * Fetch a mobile PageSpeed Insights score for a website. Returns a normalized
 * `{ score, flag }` pair plus the raw audit names that contributed to the
 * flag string (for ledger / observability).
 *
 * Errors return `{ score: null, flag: null, error }` — callers drop the lead
 * (pagespeed required by the AND gate).
 *
 * @param {string} websiteUrl
 * @param {string} apiKey
 * @param {object} [opts]
 * @returns {Promise<{ score: number|null, flag: string|null, failedAudits: string[], error?: string }>}
 */
export async function gradeWebsiteWithPsi(websiteUrl, apiKey, opts = {}) {
  if (!apiKey) {
    return { score: null, flag: null, failedAudits: [], error: 'no-api-key' }
  }
  if (!websiteUrl) {
    return { score: null, flag: null, failedAudits: [], error: 'no-url' }
  }

  // Ensure scheme — compass returns raw domains for some places.
  const url = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`

  const qs = new URLSearchParams({
    url,
    key: apiKey,
    strategy: 'mobile',
    category: 'performance',
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 30_000)
  try {
    const res = await fetch(`${PSI_BASE}?${qs.toString()}`, {
      method: 'GET',
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return {
        score: null,
        flag: null,
        failedAudits: [],
        error: `psi-${res.status}:${text.slice(0, 120)}`,
      }
    }
    const json = await res.json()
    return parsePsiResponse(json)
  } catch (err) {
    return {
      score: null,
      flag: null,
      failedAudits: [],
      error: String(err?.message || err),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Parse a PSI API response into our normalized shape. Split out from
 * gradeWebsiteWithPsi() so unit tests can hit it without network.
 *
 * @param {object} json - PSI JSON response
 * @returns {{ score: number|null, flag: string|null, failedAudits: string[] }}
 */
export function parsePsiResponse(json) {
  const perf = json?.lighthouseResult?.categories?.performance?.score
  if (typeof perf !== 'number') {
    return { score: null, flag: null, failedAudits: [] }
  }
  const score = Math.round(perf * 100)
  const audits = json?.lighthouseResult?.audits || {}

  const failed = []
  const flagParts = []

  // LCP > 3s — quote actual seconds in the flag.
  const lcp = audits['largest-contentful-paint']
  if (lcp && typeof lcp.numericValue === 'number' && lcp.numericValue > 3000) {
    const sec = (lcp.numericValue / 1000).toFixed(1)
    flagParts.push(`loads ${sec}s`)
    failed.push('largest-contentful-paint')
  }

  // Viewport tag missing → marketing copy "mobile-broken".
  const viewport = audits['viewport']
  if (viewport && typeof viewport.score === 'number' && viewport.score < 1) {
    flagParts.push('mobile-broken')
    failed.push('viewport')
  }

  // CLS / layout shift surfacing.
  const cls = audits['cumulative-layout-shift']
  if (cls && typeof cls.numericValue === 'number' && cls.numericValue > 0.25) {
    flagParts.push('layout shift')
    failed.push('cumulative-layout-shift')
  }

  // Unsized images audit — separate signal even when CLS is OK.
  const unsizedImages = audits['unsized-images']
  if (
    unsizedImages &&
    typeof unsizedImages.score === 'number' &&
    unsizedImages.score < 1 &&
    !flagParts.includes('layout shift')
  ) {
    flagParts.push('layout shift')
    failed.push('unsized-images')
  }

  // Render-blocking resources — common on outdated WordPress sites.
  const blocking = audits['render-blocking-resources']
  if (
    blocking &&
    typeof blocking.score === 'number' &&
    blocking.score < 1 &&
    flagParts.length < 3
  ) {
    flagParts.push('render-blocking JS')
    failed.push('render-blocking-resources')
  }

  // If we have a low score but no failed audits surfaced (rare),
  // fall back to the score itself.
  if (flagParts.length === 0 && score < 50) {
    flagParts.push(`PSI ${score}`)
  }

  // Cap flag string at 80 chars to keep telecaller surface readable.
  let flag = flagParts.join(', ')
  if (flag.length > 80) flag = flag.slice(0, 77) + '...'

  return { score, flag, failedAudits: failed }
}

// -------------------- Concurrency helper --------------------

/**
 * Run an async mapper over an array with bounded concurrency. PSI quota is
 * 25K/day so a 100-row batch isn't quota-bound, but the API still throttles
 * individual IPs around ~50 RPS. Concurrency 8 with a 200ms inter-batch delay
 * stays well inside that.
 *
 * @template T, U
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<U>} mapper
 * @param {{ concurrency?: number, delayMs?: number }} [opts]
 * @returns {Promise<U[]>}
 */
export async function mapBounded(items, mapper, opts = {}) {
  const concurrency = Math.max(1, opts.concurrency || 8)
  const delayMs = Math.max(0, opts.delayMs || 0)
  const out = new Array(items.length)
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map((it, j) => mapper(it, i + j))
    )
    for (let j = 0; j < results.length; j += 1) {
      out[i + j] = results[j]
    }
    if (delayMs && i + concurrency < items.length) {
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  return out
}

// -------------------- Email scrape via website-content-crawler --------------------

/**
 * Crawl a dentist site's contact-shaped pages and extract the first email that
 * matches the site's own domain. Returns null when no domain-matched email
 * found — the AND gate does NOT require email.
 *
 * One Apify run per dentist (up to MAX_EMAIL_PAGES pages). Concurrency is
 * managed by the caller via mapBounded().
 *
 * @param {string} websiteUrl
 * @param {object} [opts]
 * @returns {Promise<{ email: string|null, pagesCrawled: number, error?: string }>}
 */
export async function scrapeDomainEmail(websiteUrl, opts = {}) {
  if (!websiteUrl) {
    return { email: null, pagesCrawled: 0, error: 'no-url' }
  }
  const url = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`
  let host
  try {
    host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return { email: null, pagesCrawled: 0, error: 'bad-url' }
  }

  const input = {
    startUrls: [
      { url },
      { url: new URL('/contact', url).toString() },
      { url: new URL('/contact-us', url).toString() },
      { url: new URL('/about', url).toString() },
      { url: new URL('/about-us', url).toString() },
    ],
    maxCrawlPages: opts.maxPages || 5,
    maxCrawlDepth: 1,
    crawlerType: 'cheerio',
    saveHtml: false,
    saveMarkdown: false,
    saveScreenshots: false,
    keepUrlFragments: false,
  }

  try {
    const { items } = await runActor('apify/website-content-crawler', input, {
      timeoutMs: opts.timeoutMs || 45_000,
      maxItems: opts.maxPages || 5,
    })
    return extractDomainEmail(items, host)
  } catch (err) {
    return {
      email: null,
      pagesCrawled: 0,
      error: String(err?.message || err),
    }
  }
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi

/**
 * Given Apify website-content-crawler output rows + a target hostname,
 * extract the first email whose domain matches the hostname (apex or
 * subdomain). Split out for unit-testability.
 *
 * @param {object[]} items - rows from the crawler
 * @param {string} host - apex hostname (lowercase, no www.)
 * @returns {{ email: string|null, pagesCrawled: number }}
 */
export function extractDomainEmail(items = [], host = '') {
  const pagesCrawled = Array.isArray(items) ? items.length : 0
  if (!host) return { email: null, pagesCrawled }
  for (const row of items || []) {
    // Crawler may surface text under `text`, `markdown`, or `pageContent`.
    const text = [row?.text, row?.markdown, row?.pageContent, row?.html]
      .filter((s) => typeof s === 'string')
      .join('\n')
    if (!text) continue
    const matches = text.match(EMAIL_RE) || []
    for (const raw of matches) {
      const lower = raw.toLowerCase()
      const at = lower.lastIndexOf('@')
      if (at < 0) continue
      const emailHost = lower.slice(at + 1)
      if (emailHost === host || emailHost.endsWith(`.${host}`)) {
        return { email: raw, pagesCrawled }
      }
    }
  }
  return { email: null, pagesCrawled }
}
