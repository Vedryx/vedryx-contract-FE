// Apify REST client + ICP routing + cost ledger.
// No SDK dep — direct fetch. Keeps node_modules small.
// All actor calls use the run-sync-get-dataset-items endpoint:
//   POST https://api.apify.com/v2/acts/<actor>/run-sync-get-dataset-items?token=<APIFY_TOKEN>
// Sync endpoint blocks until the run completes and returns the dataset directly,
// which removes the need for a webhook callback flow. Timeout is enforced both
// client-side (AbortController) and server-side via the actor's `timeout` input.

const APIFY_BASE = 'https://api.apify.com/v2'

// Per-item cost in USD, used by the cost ledger. Source: workspace/auto-lead-pipeline/cmo.md §3.
// Keep in sync with that artifact if pricing changes.
export const ACTOR_COSTS_USD = {
  'bebity/linkedin-premium-actor': 0.003,
  'harvestapi/linkedin-company-employees': 0.004,
  'supreme_coder/linkedin-post': 0.001,
  'supreme_coder/linkedin-profile-scraper': 0.003,
}

// INR conversion rate. Conservative — used only for the soft cap alarm.
export const USD_TO_INR = 83

export function getApifyToken() {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new Error('APIFY_TOKEN is not configured')
  return token
}

/**
 * Run an Apify actor synchronously and return the dataset items.
 * @param {string} actorId - e.g. "harvestapi/linkedin-company-employees"
 * @param {object} input - actor input JSON
 * @param {object} opts - { timeoutMs?: number, memoryMbytes?: number }
 * @returns {Promise<{items: any[], runId: string, datasetId: string}>}
 */
export async function runActor(actorId, input, opts = {}) {
  const token = getApifyToken()
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000 // 5 min per actor
  const memoryMbytes = opts.memoryMbytes ?? 1024

  const slug = actorId.replace('/', '~')
  const url = `${APIFY_BASE}/acts/${slug}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&memory=${memoryMbytes}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Apify actor ${actorId} returned ${res.status}: ${text.slice(0, 200)}`)
    }

    const runId = res.headers.get('x-apify-pagination-offset') || res.headers.get('x-apify-run-id') || ''
    const datasetId = res.headers.get('x-apify-dataset-id') || ''
    const items = await res.json()
    if (!Array.isArray(items)) {
      throw new Error(`Apify actor ${actorId} returned non-array payload`)
    }

    return { items, runId, datasetId }
  } finally {
    clearTimeout(timer)
  }
}

// -------------------- ICP routing --------------------

// Strict regex-bounded list. Source: cmo.md §6.
const CORE_TITLE_PATTERNS = [
  /head of engineering/i,
  /vp engineering/i,
  /\bcto\b/i,
  /vp talent/i,
  /hr director/i,
  /technical recruiter/i,
  /engineering manager/i,
  /director of engineering/i,
]

const PULSE_TITLE_PATTERNS = [
  /\bfounder\b/i,
  /co-?founder/i,
  /\bceo\b/i,
  /solo founder/i,
  /indie maker/i,
]

const PULSE_POST_SIGNALS = [
  'building', 'mvp', 'idea', 'launch', 'need developer',
  'technical co-founder', ' dev ', 'app', 'startup',
]

const CORE_COUNTRY_ALLOW = new Set([
  'us', 'usa', 'united states',
  'uk', 'united kingdom', 'gb',
  'au', 'australia',
  'de', 'germany', 'nl', 'netherlands', 'se', 'sweden', 'fr', 'france', 'ie', 'ireland',
  'ae', 'uae', 'united arab emirates', 'sa', 'saudi arabia', 'qa', 'qatar',
  'in', 'india',
])

const CORE_INDUSTRY_ALLOW = [
  'software', 'saas', 'fintech', 'e-commerce', 'ecommerce',
  'healthtech', 'agritech', 'edtech', 'technology', 'internet',
]

/**
 * Classify a normalized lead record into core | pulse | disqualified.
 * @param {object} lead - normalized lead (see lead-scrape-cron.js -> normalizeXxx)
 * @returns {{ icp: 'core'|'pulse'|'disqualified', score: number, matched: string[] }}
 */
export function classifyLead(lead) {
  const matched = []
  const title = lead.person?.title || ''
  const empCount = lead.company?.employee_count
  const country = (lead.company?.hq_country || '').toLowerCase()
  const industry = (lead.company?.industry || '').toLowerCase()
  const postSnippet = (lead.signal?.post_content_snippet || '').toLowerCase()

  // ---- Core scoring ----
  let coreHits = 0
  if (CORE_TITLE_PATTERNS.some((re) => re.test(title))) {
    matched.push(`core:title:${title.slice(0, 40)}`)
    coreHits += 2
  }
  if (typeof empCount === 'number' && empCount >= 20 && empCount <= 2000) {
    matched.push('core:emp-band')
    coreHits += 1
  }
  if (CORE_INDUSTRY_ALLOW.some((i) => industry.includes(i))) {
    matched.push(`core:industry:${industry.slice(0, 30)}`)
    coreHits += 1
  }
  if (country && CORE_COUNTRY_ALLOW.has(country)) {
    matched.push(`core:geo:${country}`)
    coreHits += 1
  }
  if (/\b(founder|ceo)\b/i.test(title) && typeof empCount === 'number' && empCount > 20) {
    matched.push('core:founder-of-scaled')
    coreHits += 2
  }

  // ---- Pulse scoring (ALL of: title + small-emp + post signal) ----
  let pulseHits = 0
  const pulseTitleHit = PULSE_TITLE_PATTERNS.some((re) => re.test(title))
  if (pulseTitleHit) {
    matched.push(`pulse:title:${title.slice(0, 40)}`)
    pulseHits += 1
  }
  const pulseEmpHit = empCount == null || (typeof empCount === 'number' && empCount <= 10)
  if (pulseEmpHit) {
    matched.push('pulse:tiny-company')
    pulseHits += 1
  }
  const pulsePostHit = PULSE_POST_SIGNALS.some((kw) => postSnippet.includes(kw))
  if (pulsePostHit) {
    matched.push('pulse:post-signal')
    pulseHits += 1
  }

  // ---- Decide ----
  // Conflict rule per cmo.md §6: both signals present → core (higher LTV).
  if (coreHits >= 3) {
    return { icp: 'core', score: Math.min(1, coreHits / 5), matched }
  }
  if (pulseHits === 3) {
    return { icp: 'pulse', score: Math.min(1, pulseHits / 3), matched }
  }
  return { icp: 'disqualified', score: 0, matched }
}

// -------------------- Cost ledger --------------------

/**
 * Update the monthly cost ledger after an actor run.
 * Returns the ledger doc post-update. Caller decides what to do with it.
 * @param {import('mongodb').Db} db
 * @param {string} actorId
 * @param {number} itemCount
 */
export async function recordActorCost(db, actorId, itemCount) {
  const usd = (ACTOR_COSTS_USD[actorId] ?? 0) * itemCount
  const inr = usd * USD_TO_INR
  const now = new Date()
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const ledger = db.collection('pipeline_cost_ledger')

  const updated = await ledger.findOneAndUpdate(
    { month: ym },
    {
      $inc: {
        [`actors.${actorId.replace(/\W/g, '_')}.items`]: itemCount,
        [`actors.${actorId.replace(/\W/g, '_')}.usd`]: usd,
        total_usd: usd,
        total_inr: inr,
      },
      $setOnInsert: { month: ym, created_at: now },
      $set: { updated_at: now },
    },
    { upsert: true, returnDocument: 'after' }
  )
  return updated?.value ?? updated
}

// Soft cap = 85% of monthly budget. Above this, only run "cheap" Pulse actors.
export const SOFT_CAP_INR = 1700
// Hard cap = 100% of monthly budget. Above this, skip the run entirely.
export const HARD_CAP_INR = 2000

export function budgetState(ledger) {
  const totalInr = ledger?.total_inr ?? 0
  if (totalInr >= HARD_CAP_INR) return 'hard-cap'
  if (totalInr >= SOFT_CAP_INR) return 'soft-cap'
  return 'ok'
}
