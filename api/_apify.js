// Apify REST client + ICP routing + cost ledger.
// No SDK dep — direct fetch. Keeps node_modules small.
// All actor calls use the run-sync-get-dataset-items endpoint:
//   POST https://api.apify.com/v2/acts/<actor>/run-sync-get-dataset-items?token=<APIFY_TOKEN>
// Sync endpoint blocks until the run completes and returns the dataset directly,
// which removes the need for a webhook callback flow. Timeout is enforced both
// client-side (AbortController) and server-side via the actor's `timeout` input.

const APIFY_BASE = 'https://api.apify.com/v2'

// Pay-per-event (PPE) cost shape in USD, used by the cost ledger and budget
// gate. Source: workspace/lead-pipeline-actor-rework/research-analyst-v2.md §6
// (live-verified 2026-06-12 against Apify per-run breakdowns).
//
// Shape: { actorStart, expectedEvent } in USD plus a tier breakdown for audit.
// `actorStart` is a flat fee Apify charges every time a run starts (some
// Actors charge $0.00005, the company-employees Actor charges $0.02 — 400×
// higher, which dominates small runs). `expectedEvent` is the per-item price
// for the EVENT TIER THE CRON ACTUALLY USES (e.g. shortProfile for the
// company-employees Actor, since lead-scrape-cron.js sets
// profileScraperMode: "Short ($4 per 1k)"). Projection = actorStart +
// expectedEvent × itemCount.
//
// The hard-cap backstop is two-layered:
//   1) This ledger projection guards the monthly INR budget pre-stage.
//   2) Apify's per-run `maxTotalChargeUsd` (PER_RUN_MAX_USD below) caps a
//      single run if the Actor mis-charges (e.g. unexpected event mix).
// Real per-run cost is measured post-run from `run.usageTotalUsd`
// (single-source-of-truth ledger, RA §6.5 option A) — drift between projection
// and measured is logged in the ledger doc.
//
// Three swaps from main:
//   - bebity/linkedin-premium-actor (rental, $29/mo)
//        → harvestapi/linkedin-company (PPE, $4/1k items)
//   - supreme_coder/linkedin-post (rental, $30/mo, requires URLs we lack)
//        → harvestapi/linkedin-post-search (PPE, $2/1k posts; native keyword input)
//   - supreme_coder/linkedin-profile-scraper stage dropped — the post-search
//     Actor returns `author.linkedinUrl` directly (RA §6.4), so the separate
//     pulse-profile-enrich stage is no longer required for v1 routing.
export const ACTOR_COSTS_USD = {
  'harvestapi/linkedin-company': {
    actorStart: 0.00005,
    expectedEvent: 0.004, // datasetItem — $4/1k live-verified
  },
  'harvestapi/linkedin-company-employees': {
    actorStart: 0.02, // 400× the others; batch large to amortize
    expectedEvent: 0.003, // Short tier ($3/1k); cron picks this scraper mode
    shortProfile: 0.003,
    fullProfile: 0.008,
    fullProfileEmail: 0.012,
  },
  'harvestapi/linkedin-post-search': {
    actorStart: 0.00005,
    expectedEvent: 0.002, // post event — $2/1k live-verified
    post: 0.002,
    mainProfile: 0.002,
    fullProfile: 0.004,
    noResultQuery: 0.001,
  },
  // Kept for the optional Surface 4 enrichment path. Untested live as of
  // 2026-06-12 (RA §8 open item #1); price from vendor headline.
  'supreme_coder/linkedin-profile-scraper': {
    actorStart: 0.00005,
    expectedEvent: 0.003,
  },
}

// Per-run hard cap that we hand to Apify directly. Belt-and-suspenders against
// the monthly ledger gate: even if our state machine miscalculates, Apify will
// kill the run when this many dollars are spent. `harvestapi/linkedin-post-search`
// REQUIRES this field (returns HTTP 400 without it; min $0.01). RA §5.1.
// Sized at 2× expected per-stage spend so legitimate large batches survive.
export const PER_RUN_MAX_USD = {
  'harvestapi/linkedin-company': 16.00,
  'harvestapi/linkedin-company-employees': 5.00,
  'harvestapi/linkedin-post-search': 12.00,
  'supreme_coder/linkedin-profile-scraper': 0.50,
}

// INR conversion rate. Used by BOTH soft AND hard cap checks (see budgetState below).
// Overridable via USD_TO_INR env var so we don't ship code edits to track FX drift.
// Default 96 matches the rate as of 2026-06-12; widen the budget headroom rather
// than shrinking the rate if INR weakens materially.
export const USD_TO_INR = (() => {
  const raw = process.env.USD_TO_INR
  if (!raw) return 96
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 96
  // Floor at 80 to prevent a misconfigured low rate from understating real spend.
  return Math.max(n, 80)
})()

export function getApifyToken() {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new Error('APIFY_TOKEN is not configured')
  return token
}

/**
 * Run an Apify actor synchronously and return the dataset items.
 * @param {string} actorId - e.g. "harvestapi/linkedin-company-employees"
 * @param {object} input - actor input JSON
 * @param {object} opts - { timeoutMs?: number, memoryMbytes?: number, maxItems?: number }
 * @returns {Promise<{items: any[], runId: string, datasetId: string}>}
 *
 * `opts.maxItems` is forwarded as the `maxItems` URL query param on the
 * run-sync endpoint. This is the AUTHORITATIVE per-run cap on returned items:
 * the value Apify enforces is the URL parameter, NOT a `maxItems` field placed
 * in the input body. Past fix attempt (PR #28) set `maxItems: 40` in the body
 * and saw 669 items returned anyway — the body field is ignored by the sync
 * endpoint. Callers that want a per-run cap MUST pass `maxItems` here.
 */
export async function runActor(actorId, input, opts = {}) {
  const token = getApifyToken()
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000 // 5 min per actor
  const memoryMbytes = opts.memoryMbytes ?? 1024

  const slug = actorId.replace('/', '~')
  const params = new URLSearchParams({
    token,
    memory: String(memoryMbytes),
  })
  if (typeof opts.maxItems === 'number' && Number.isFinite(opts.maxItems) && opts.maxItems > 0) {
    params.set('maxItems', String(Math.floor(opts.maxItems)))
  }
  // Apify's run-sync-get-dataset-items endpoint defaults `waitForFinish` to 120s
  // server-side. Without an explicit value, the endpoint returns whatever is in
  // the dataset at 120s even when the Actor is still producing items — which
  // surfaces as the `no-rows-from-maps` abort at ~124s for stages that legitimately
  // need longer (e.g. maps-scraper). Match the server's wait window to the
  // client's AbortController timeout, minus a 5s buffer so the client times out
  // cleanly if Apify itself hangs rather than the other way round.
  const waitForFinishSec = Math.max(60, Math.floor(timeoutMs / 1000) - 5)
  params.set('waitForFinish', String(waitForFinishSec))
  const url = `${APIFY_BASE}/acts/${slug}/run-sync-get-dataset-items?${params.toString()}`

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

    // Best-effort post-run cost fetch. Apify exposes the run's totalUsageUsd on
    // GET /v2/actor-runs/<id>. We swallow failures here because the cron has a
    // projection fallback in recordActorCost(); cost accounting must not block
    // the data flow on a transient API blip.
    let usageTotalUsd = null
    if (runId) {
      try {
        const runRes = await fetch(
          `${APIFY_BASE}/actor-runs/${runId}?token=${encodeURIComponent(token)}`,
          { signal: controller.signal },
        )
        if (runRes.ok) {
          const runDoc = await runRes.json()
          const u = runDoc?.data?.usageTotalUsd
          if (typeof u === 'number' && Number.isFinite(u)) usageTotalUsd = u
        }
      } catch {
        // ignore — projection fallback covers it
      }
    }

    return { items, runId, datasetId, usageTotalUsd }
  } finally {
    clearTimeout(timer)
  }
}

// -------------------- ICP routing --------------------

// Strict regex-bounded list. Source: cmo.md §6 + RA §6.5 (tightened 2026-06-12).
// Word-boundary anchors keep these from matching titles like "vp engineering ops"
// or "former CTO". Substring matches over-classified Core (e.g. plain "vp
// engineering" matched "vp engineering operations consultant").
const CORE_TITLE_PATTERNS = [
  /\bhead of engineering\b/i,
  /\b(?:vp|vice president)(?: of)? engineering\b/i,
  /\bcto\b/i,
  /\b(?:vp|vice president|head)(?: of)? (?:talent|people)\b/i,
  /\b(?:hr|human resources?) director\b/i,
  /\b(?:senior |lead |principal )?technical recruiter\b/i,
  /\bengineering manager\b/i,
  /\bdirector of engineering\b/i,
]

// Auto-disqualify titles that contain these tokens. Order matters: applied
// BEFORE positive scoring so an "ex-CTO" does not pick up a Core hit on \bcto\b.
// RA §6.5 — covers intern/junior/former/freelance/job-seeker tracks.
const CORE_TITLE_EXCLUSIONS = [
  /\b(?:intern|junior|jr\b|associate|assistant|trainee|graduate|fresher)\b/i,
  /\b(?:former|ex[- ]|past|previous(?:ly)?|retired)\b/i,
  /\b(?:freelance|contract(?:or)?|consultant|self-employed)\b/i,
  /\b(?:looking for|seeking|open to|exploring)\b/i,
]

const PULSE_TITLE_PATTERNS = [
  /\bfounder\b/i,
  /co-?founder/i,
  /\bceo\b/i,
  /solo founder/i,
  /indie maker/i,
]

// Word-boundary regex list. Substring matches over-classified Pulse
// (e.g. 'app' matched 'happy', 'rapper', 'application'). All patterns use
// \b boundaries or explicit phrase matches. Case-insensitive.
const PULSE_POST_SIGNALS = [
  /\bbuilding\b/i,
  /\bmvp\b/i,
  /\bidea\b/i,
  /\blaunch(?:ing|ed)?\b/i,
  /\bneed (?:a )?developer\b/i,
  /\btechnical co-?founder\b/i,
  /\bdev(?:eloper)?s?\b/i,
  /\bapp\b/i,
  /\bstartup\b/i,
  /\bbuild ?in ?public\b/i,
  /\bsolo ?founder\b/i,
  /\bindie ?(?:hacker|maker)\b/i,
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

  // ---- Exclusion gate (RA §6.5) ----
  // Apply BEFORE positive scoring so titles like "ex-CTO" or "Junior Engineer"
  // do not pick up a stray Core hit on \bcto\b / engineering manager etc.
  if (title && CORE_TITLE_EXCLUSIONS.some((re) => re.test(title))) {
    matched.push('core:excluded-title')
    return { icp: 'disqualified', score: 0, matched }
  }

  // ---- Pulse-source pre-filters (RA §B.3-B.5) ----
  // Engagement floor, post age (client-side 18h cap — Actor's enum stops at
  // 24h), and a funded-stage exclusion. Only applied when the lead came from
  // the post-search Actor, because the engagement/postedAt fields are only
  // populated there.
  const isPulseSource = lead.apify?.actor_id === 'harvestapi/linkedin-post-search'
  if (isPulseSource) {
    // Engagement floor: posts with zero traction are noise.
    const eng = lead.signal?.engagement || {}
    const likes = Number(eng.likes) || 0
    const comments = Number(eng.comments) || 0
    const reactionsCount = Array.isArray(eng.reactions)
      ? eng.reactions.reduce((s, r) => s + (Number(r?.count) || 0), 0)
      : likes
    if (comments < 1 && reactionsCount < 5) {
      matched.push('pulse:zero-engagement')
      return { icp: 'disqualified', score: 0, matched }
    }

    // Post age: 18h freshness window. `postedLimit: '24h'` is the tightest
    // enum the Actor accepts; we trim the trailing 6h client-side.
    const postedAt = lead.signal?.posted_at || {}
    const ts =
      Date.parse(postedAt.date || '') ||
      (Number(postedAt.timestamp) ? Number(postedAt.timestamp) * 1000 : 0)
    if (!ts || (Date.now() - ts) > 18 * 60 * 60 * 1000) {
      matched.push('pulse:stale-post')
      return { icp: 'disqualified', score: 0, matched }
    }

    // Funded-stage exclusion: a founder mentioning "just raised Series A" has
    // dev capacity. Pulse's 19-day pitch does not fit.
    const FUNDED_PATTERN =
      /\b(?:series\s+[abcd]|just raised|raised \$\d|seed (?:round|funding)|y combinator)\b/i
    if (FUNDED_PATTERN.test(postSnippet)) {
      matched.push('pulse:funded-stage')
      return { icp: 'disqualified', score: 0, matched }
    }
  }

  // ---- Core scoring ----
  let coreHits = 0
  if (CORE_TITLE_PATTERNS.some((re) => re.test(title))) {
    matched.push(`core:title:${title.slice(0, 40)}`)
    coreHits += 2
  }
  // RA §6.4: tightened from 20-2000 to 51-500 (LinkedIn bands D + E). Below 51
  // there is no eng budget; above 500 the procurement gate elongates the cycle
  // beyond Vedryx's playbook.
  if (typeof empCount === 'number' && empCount >= 51 && empCount <= 500) {
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
  const pulsePostHit = PULSE_POST_SIGNALS.some((re) => re.test(postSnippet))
  if (pulsePostHit) {
    matched.push('pulse:post-signal')
    pulseHits += 1
  }

  // ---- Decide ----
  // Score is now 0-100 (was 0-1). RA §F weighted rubric drives the score; the
  // routing decision (core / pulse / disqualified) still keys off coreHits and
  // pulseHits. A one-time migration script rescales existing DB records so the
  // surface query at threshold 70 is consistent across new and historical docs.
  //
  // Conflict rule per cmo.md §6: when BOTH Core and Pulse signals are present,
  // route to core (higher LTV). This must be evaluated BEFORE the pulseHits === 3
  // check, because at small companies (<20 emp) a CTO/Founder with an MVP post
  // can hit pulseHits=3 before coreHits reaches 3.
  const hasCoreSignal = coreHits >= 2 // title-pattern alone scores 2
  const hasPulseSignal = pulseHits >= 1
  if (hasCoreSignal && hasPulseSignal) {
    matched.push('conflict:resolved-to-core')
    const score = computeLeadScore(lead, { icp: 'core', coreHits, pulseHits, matched, isPulseSource })
    return { icp: 'core', score, matched }
  }
  if (coreHits >= 3) {
    const score = computeLeadScore(lead, { icp: 'core', coreHits, pulseHits, matched, isPulseSource })
    return { icp: 'core', score, matched }
  }
  if (pulseHits === 3) {
    const score = computeLeadScore(lead, { icp: 'pulse', coreHits, pulseHits, matched, isPulseSource })
    return { icp: 'pulse', score, matched }
  }
  return { icp: 'disqualified', score: 0, matched }
}

// -------------------- Weighted 0-100 score (RA §F rubric) --------------------
// Sum-to-100 weighted rubric. Telecaller surface query thresholds:
//   >= 80 → priority queue
//   >= 70 → standard queue
//   >= 50 → manual review
//   <  50 → auto-disqualified
//
// Component weights (sum = 100):
//   title fit:           30
//   region fit:          15
//   recency:             15
//   source signal:       20
//   engagement:          10
//   bonus signals:       10
//
// Weights are judgment calls; revisit after week 4 with reply-rate data.

const TOP_CORE_TITLES = [
  /\bcto\b/i,
  /\b(?:vp|vice president)(?: of)? engineering\b/i,
  /\bhead of engineering\b/i,
  /\bdirector of engineering\b/i,
]
const MID_CORE_TITLES = [
  /\bengineering manager\b/i,
  /\b(?:vp|vice president|head)(?: of)? (?:talent|people)\b/i,
  /\b(?:hr|human resources?) director\b/i,
]

const REGION_TIER1 = new Set(['us', 'usa', 'united states', 'uk', 'united kingdom', 'gb'])
const REGION_TIER2 = new Set([
  'au', 'australia', 'de', 'germany', 'nl', 'netherlands',
  'se', 'sweden', 'fr', 'france', 'ie', 'ireland',
])
const REGION_TIER3 = new Set(['ae', 'uae', 'united arab emirates', 'sa', 'saudi arabia', 'qa', 'qatar'])
const REGION_TIER4 = new Set(['in', 'india'])

export function computeLeadScore(lead, ctx = {}) {
  const { icp = 'disqualified', coreHits = 0, isPulseSource = false } = ctx
  if (icp === 'disqualified') return 0

  const title = lead.person?.title || ''
  const empCount = lead.company?.employee_count
  const country = (lead.company?.hq_country || '').toLowerCase()
  const postSnippet = (lead.signal?.post_content_snippet || '').toLowerCase()
  const scrapedAt = lead.scraped_at instanceof Date ? lead.scraped_at : new Date(lead.scraped_at || Date.now())

  // 1) Title fit — 0..30
  let titleFit = 0
  if (TOP_CORE_TITLES.some((re) => re.test(title))) titleFit = 30
  else if (MID_CORE_TITLES.some((re) => re.test(title))) titleFit = 20
  else if (CORE_TITLE_PATTERNS.some((re) => re.test(title))) titleFit = 15
  else if (/\b(founder|ceo|co-?founder)\b/i.test(title) && typeof empCount === 'number' && empCount > 20) titleFit = 25
  else if (PULSE_TITLE_PATTERNS.some((re) => re.test(title))) titleFit = 15

  // 2) Region fit — 0..15
  let regionFit = 0
  if (country) {
    if (REGION_TIER1.has(country)) regionFit = 15
    else if (REGION_TIER2.has(country)) regionFit = 12
    else if (REGION_TIER3.has(country)) regionFit = 10
    else if (REGION_TIER4.has(country)) regionFit = 8
    else regionFit = 5
  }

  // 3) Recency — 0..15
  // For Pulse: post age. For Core: scraped_at age.
  let recencyTs = scrapedAt.getTime()
  if (isPulseSource) {
    const postedAt = lead.signal?.posted_at || {}
    const pts =
      Date.parse(postedAt.date || '') ||
      (Number(postedAt.timestamp) ? Number(postedAt.timestamp) * 1000 : 0)
    if (pts) recencyTs = pts
  }
  const ageHours = Math.max(0, (Date.now() - recencyTs) / (60 * 60 * 1000))
  let recency = 0
  if (ageHours <= 24) recency = 15
  else if (ageHours <= 72) recency = 10
  else if (ageHours <= 168) recency = 5

  // 4) Source signal — 0..20
  let sourceSignal
  if (isPulseSource) {
    if (/\b(looking for|hiring|need (?:a )?developer|seeking)\b/i.test(postSnippet)) sourceSignal = 20
    else if (/\b(building|shipping|launching|prepping)\b/i.test(postSnippet)) sourceSignal = 10
    else sourceSignal = 5
  } else {
    // Core: current-position-confirmed (first_name + title both populated)
    const hasName = Boolean((lead.person?.first_name || '').trim())
    sourceSignal = hasName && title ? 20 : 10
  }

  // 5) Engagement — 0..10
  let engagement = 0
  if (isPulseSource) {
    const eng = lead.signal?.engagement || {}
    const comments = Number(eng.comments) || 0
    const reactionsCount = Array.isArray(eng.reactions)
      ? eng.reactions.reduce((s, r) => s + (Number(r?.count) || 0), 0)
      : Number(eng.likes) || 0
    if (comments >= 5 || reactionsCount >= 20) engagement = 10
    else if (comments >= 1 || reactionsCount >= 5) engagement = 5
  } else {
    // Core: no engagement signal available at scrape time; default to 5
    // (neutral). Hooks for "company has open senior eng role" can lift this
    // to 10 when Sales Lead adds that enrichment.
    engagement = 5
  }

  // 6) Bonus signals — 0..10
  let bonus = 0
  if (isPulseSource) {
    if (/#buildinpublic/i.test(postSnippet)) bonus += 5
    if (/\b(pre-seed|pre-launch|pre-revenue|early stage)\b/i.test(postSnippet)) bonus += 5
  } else {
    if (coreHits >= 4) bonus += 5 // strong multi-signal Core lead
  }
  if (bonus > 10) bonus = 10

  const total = titleFit + regionFit + recency + sourceSignal + engagement + bonus
  return Math.max(0, Math.min(100, Math.round(total)))
}

// -------------------- Cost ledger --------------------

/**
 * Return the current ledger key in IST (Asia/Kolkata) — "YYYY-MM".
 * Founder's budget mental model is IST. The cron fires 20:30 UTC = 02:00 IST,
 * so anchoring the key to UTC would drift the monthly reset by 5.5 hours and
 * mis-attribute the first/last few runs of each month. Anchored to IST instead.
 * @param {Date} [now]
 */
export function ledgerMonthKey(now = new Date()) {
  // Intl with timeZone gives us the IST-correct year/month regardless of host TZ.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  })
  const parts = fmt.formatToParts(now)
  const year = parts.find((p) => p.type === 'year')?.value || ''
  const month = parts.find((p) => p.type === 'month')?.value || ''
  return `${year}-${month}`
}

/**
 * True when `now` falls on a Monday in IST. Used by lead-scrape-cron to
 * noop-skip the Monday-IST run so the telecaller's day off isn't flooded.
 * Vercel cron is scheduled `30 20 * * *` UTC (daily) because Hobby tier
 * day-of-week filters are flaky; the skip lives in code instead.
 * @param {Date} [now]
 */
export function isMondayIST(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
  })
  return fmt.format(now) === 'Mon'
}

/**
 * Project the INR cost of running an actor at a given item volume.
 * Used by the per-stage cap pre-check to refuse a stage if it would breach
 * the hard cap. Conservative: actorStart + (worstEvent × itemCount). For
 * PPE Actors with multiple chargeable event tiers, the worst event is used so
 * the gate never under-budgets (RA §6.5).
 *
 * Returns 0 when the actor has no pricing entry — callers (test-budget-gate)
 * trap that as a misconfiguration so the cap is not silently bypassed.
 *
 * @param {string} actorId
 * @param {number} itemCount
 */
export function projectStageCostInr(actorId, itemCount) {
  const cfg = ACTOR_COSTS_USD[actorId]
  if (!cfg) return 0
  // Numeric-only legacy entries (none expected post-rework) fall back to flat
  // per-item math. Object entries use actorStart + worstEvent × itemCount.
  const usd = typeof cfg === 'number'
    ? cfg * itemCount
    : (cfg.actorStart || 0) + ((cfg.expectedEvent || 0) * itemCount)
  return usd * USD_TO_INR
}

/**
 * Update the monthly cost ledger from a measured run's `usageTotalUsd`.
 * Single-source-of-truth approach (RA §6.5 option A): we read Apify's own
 * cost-per-run figure post-run rather than reconstructing from item count ×
 * unit price. Multi-event PPE Actors otherwise drift unpredictably.
 *
 * Returns the ledger doc post-update. Caller decides what to do with it.
 * THROWS on write failure — caller MUST treat ledger failure as a stop
 * condition (cost accounting is load-bearing for the hard-cap guarantee).
 *
 * @param {import('mongodb').Db} db
 * @param {string} actorId
 * @param {object} args - { runUsageUsd, itemCount } from runActor()
 */
export async function recordActorCost(db, actorId, args) {
  // Back-compat: callers that pass a bare itemCount (the pre-rework signature)
  // are routed through the conservative projector so we still bill SOMETHING
  // rather than silently zeroing out. Tests cover the new shape.
  const { runUsageUsd, itemCount } =
    typeof args === 'number'
      ? { runUsageUsd: null, itemCount: args }
      : args || {}

  let usd
  if (typeof runUsageUsd === 'number' && Number.isFinite(runUsageUsd) && runUsageUsd > 0) {
    usd = runUsageUsd
  } else {
    // Fallback: project conservatively from itemCount. Drift is logged in
    // the ledger doc (`source: 'projected'`) so an audit can spot it.
    const projInr = projectStageCostInr(actorId, itemCount || 0)
    usd = projInr / USD_TO_INR
  }
  const inr = usd * USD_TO_INR
  const now = new Date()
  const ym = ledgerMonthKey(now)
  const ledger = db.collection('pipeline_cost_ledger')

  const actorKey = actorId.replace(/\W/g, '_')
  const source = typeof runUsageUsd === 'number' ? 'measured' : 'projected'
  const updated = await ledger.findOneAndUpdate(
    { month: ym },
    {
      $inc: {
        [`actors.${actorKey}.items`]: itemCount || 0,
        [`actors.${actorKey}.usd`]: usd,
        [`actors.${actorKey}.runs`]: 1,
        total_usd: usd,
        total_inr: inr,
      },
      $setOnInsert: { month: ym, created_at: now },
      $set: { updated_at: now, [`actors.${actorKey}.last_source`]: source },
    },
    { upsert: true, returnDocument: 'after' }
  )
  return updated?.value ?? updated
}

// -------------------- Normalizers (lead-pipeline-actor-rework) --------------------
// The Apify Actor schema changed (RA §2.1). Both Short-tier company-employees
// and post-search Actors return data in nested shapes that the previous
// normalizers in lead-scrape-cron.js could not unpack. Exported so the cron AND
// the smoke tests can share a single normalizer surface.

const BASE_LEAD_DOC = () => ({
  source: 'apify-pipeline',
  scraped_at: new Date(),
  status: 'new',
  person: {
    first_name: '',
    last_name: '',
    linkedin_url: '',
    title: '',
    email: null,
    phone: null,
  },
  company: {
    name: '',
    linkedin_url: null,
    employee_count: null,
    industry: null,
    hq_country: null,
    hq_city: null,
  },
  signal: {
    routing_signals: [],
    post_content_snippet: null,
    icp_score: 0,
  },
  apify: {
    actor_id: '',
    run_id: '',
    dataset_id: '',
  },
  outreach: { sequence_step: 0, last_touch: null, reply_received: false },
})

/**
 * Normalize a `harvestapi/linkedin-company-employees` Short-tier record. Top-level
 * `headline` is null on Short; title lives in `currentPositions[0].title`.
 * @param {object} raw
 */
export function normalizeHarvestCompanyEmployee(raw = {}) {
  const doc = BASE_LEAD_DOC()
  const firstPosition = Array.isArray(raw.currentPositions) ? raw.currentPositions[0] : null
  doc.person.first_name = raw.firstName || ''
  doc.person.last_name = raw.lastName || ''
  doc.person.linkedin_url = raw.profileUrl || raw.linkedinUrl || ''
  doc.person.title = firstPosition?.title || raw.headline || ''
  doc.company.name = firstPosition?.companyName || raw.companyName || ''
  doc.company.linkedin_url = raw.companyUrl || null
  // Short tier omits firmographics; populated downstream by Surface 1 join.
  doc.company.employee_count = raw.companySize || raw.employeeCount || null
  doc.company.industry = raw.companyIndustry || raw.industry || null
  doc.company.hq_country = raw.companyCountry || raw.country || null
  doc.company.hq_city = raw.location?.linkedinText || raw.city || null
  doc.apify.actor_id = 'harvestapi/linkedin-company-employees'
  doc.apify.run_id = raw.__runId || ''
  doc.apify.dataset_id = raw.__datasetId || ''
  return doc
}

/**
 * Normalize a `harvestapi/linkedin-post-search` record into a lead doc. The
 * author block carries the LinkedIn URL + role info we need to qualify Pulse.
 * @param {object} raw
 */
export function normalizeHarvestPostAuthor(raw = {}) {
  const doc = BASE_LEAD_DOC()
  const author = raw.author || {}
  const fullName = author.name || ''
  const [first, ...rest] = fullName.split(' ')
  doc.person.first_name = first || ''
  doc.person.last_name = rest.join(' ') || ''
  doc.person.linkedin_url = author.linkedinUrl || ''
  doc.person.title = author.info || author.headline || ''
  doc.signal.post_content_snippet = (raw.content || raw.text || '').slice(0, 500)
  // RA §6.6: retain engagement + postedAt for classifier pre-filters.
  // Without these, the Pulse pre-filters (engagement floor, 18h freshness) fall
  // back to default-rejecting every post.
  doc.signal.engagement = raw.engagement || null
  doc.signal.posted_at = raw.postedAt || null
  doc.apify.actor_id = 'harvestapi/linkedin-post-search'
  doc.apify.run_id = raw.__runId || ''
  doc.apify.dataset_id = raw.__datasetId || ''
  return doc
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
