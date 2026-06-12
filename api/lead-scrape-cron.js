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
} from './_apify.js'

const COLLECTION = 'lead_pipeline'
const RUNS_COLLECTION = 'pipeline_runs'
const LEDGER_COLLECTION = 'pipeline_cost_ledger'

// -------------------- Actor configs --------------------
// Volumes match cmo.md §5. Adjust here when tuning. Keywords/filters are
// "starter" — Sales Lead owns final tuning per cmo.md §9.

const CORE_COMPANY_ACTOR_INPUT = {
  // bebity/linkedin-premium-actor — company firmographics
  searchQueries: [
    'site:linkedin.com/company SaaS US 50 employees',
    'site:linkedin.com/company fintech UK 100 employees',
    'site:linkedin.com/company software AU 200 employees',
  ],
  maxItems: 2000,
}

const CORE_EMPLOYEE_ACTOR_INPUT = {
  // harvestapi/linkedin-company-employees — Short tier (name + URL only)
  // Companies list is seeded; Sales Lead refreshes via Apify console.
  profileScraperMode: 'Short',
  maxItems: 1200,
  // companyUrls injected at runtime from a config doc; see TODO below.
}

const PULSE_POST_ACTOR_INPUT = {
  // supreme_coder/linkedin-post
  hashtags: ['buildinpublic', 'mvp', 'solofounder', 'needadeveloper', 'indiehackers'],
  maxItems: 3000,
}

const PULSE_PROFILE_ACTOR_INPUT = {
  // supreme_coder/linkedin-profile-scraper — enrich post authors
  // profileUrls injected from prior actor's results in-process.
  maxItems: 900,
}

// -------------------- Normalizers --------------------
// Each actor returns differently-shaped items. Normalize into the schema in cmo.md §7.

function normalizeCoreEmployee(raw) {
  return {
    source: 'apify-pipeline',
    scraped_at: new Date(),
    status: 'new',
    person: {
      first_name: raw.firstName || raw.first_name || '',
      last_name: raw.lastName || raw.last_name || '',
      linkedin_url: raw.profileUrl || raw.linkedinUrl || raw.url || '',
      title: raw.title || raw.headline || '',
      email: raw.email || null,
      phone: raw.phone || null,
    },
    company: {
      name: raw.companyName || raw.company || '',
      linkedin_url: raw.companyUrl || null,
      employee_count: raw.companySize || raw.employeeCount || null,
      industry: raw.companyIndustry || raw.industry || null,
      hq_country: raw.companyCountry || raw.country || null,
      hq_city: raw.companyCity || raw.city || null,
    },
    signal: {
      routing_signals: [],
      post_content_snippet: null,
      icp_score: 0,
    },
    apify: {
      actor_id: 'harvestapi/linkedin-company-employees',
      run_id: raw.__runId || '',
      dataset_id: raw.__datasetId || '',
    },
    outreach: { sequence_step: 0, last_touch: null, reply_received: false },
  }
}

function normalizePulsePostAuthor(raw) {
  return {
    source: 'apify-pipeline',
    scraped_at: new Date(),
    status: 'new',
    person: {
      first_name: raw.authorFirstName || (raw.authorName || '').split(' ')[0] || '',
      last_name: raw.authorLastName || (raw.authorName || '').split(' ').slice(1).join(' ') || '',
      linkedin_url: raw.authorProfileUrl || raw.profileUrl || '',
      title: raw.authorHeadline || raw.headline || raw.title || '',
      email: null,
      phone: null,
    },
    company: {
      name: raw.companyName || '',
      linkedin_url: null,
      employee_count: raw.companySize || null,
      industry: raw.companyIndustry || null,
      hq_country: raw.country || null,
      hq_city: null,
    },
    signal: {
      routing_signals: [],
      post_content_snippet: (raw.postText || raw.text || '').slice(0, 500),
      icp_score: 0,
    },
    apify: {
      actor_id: 'supreme_coder/linkedin-post',
      run_id: raw.__runId || '',
      dataset_id: raw.__datasetId || '',
    },
    outreach: { sequence_step: 0, last_touch: null, reply_received: false },
  }
}

// -------------------- Run pipeline for one actor --------------------

async function runStage({ db, name, actorId, input, normalize, results }) {
  try {
    const { items, runId, datasetId } = await runActor(actorId, input)
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

    await recordActorCost(db, actorId, items.length)
    results.stages.push({ name, actor: actorId, items: items.length, inserted, skipped, ok: true })
  } catch (err) {
     
    console.error(`[${name}] actor failed`, err?.message)
    await captureRouteError(
      { headers: {}, url: '/api/lead-scrape-cron', method: 'GET' },
      err,
      { stage: name, actor: actorId }
    )
    results.stages.push({ name, actor: actorId, ok: false, error: String(err?.message || err) })
  }
}

// -------------------- Handler --------------------

export default async function handler(req, res) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when configured.
  // We also accept a manual trigger via x-cron-secret for debugging.
  const expected = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || ''
  const manualKey = req.headers['x-cron-secret'] || ''
  if (expected && auth !== `Bearer ${expected}` && manualKey !== expected) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' })
  }

  const startedAt = new Date()
  const results = { startedAt, stages: [], skippedStages: [] }

  let client
  try {
    client = await getMongoClient()
    const db = client.db(getDatabaseName())

    // Budget check
    const ledger = await db.collection(LEDGER_COLLECTION).findOne({
      month: `${startedAt.getUTCFullYear()}-${String(startedAt.getUTCMonth() + 1).padStart(2, '0')}`,
    })
    const state = budgetState(ledger)
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

    // Core (run unless soft-capped — Core is the higher-LTV stream)
    if (state !== 'soft-cap') {
      await runStage({
        db, name: 'core-companies', actorId: 'bebity/linkedin-premium-actor',
        input: CORE_COMPANY_ACTOR_INPUT, normalize: normalizeCoreEmployee, results,
      })
      await runStage({
        db, name: 'core-employees', actorId: 'harvestapi/linkedin-company-employees',
        input: CORE_EMPLOYEE_ACTOR_INPUT, normalize: normalizeCoreEmployee, results,
      })
    } else {
      results.skippedStages.push('core-companies', 'core-employees')
    }

    // Pulse (cheap — runs even under soft-cap)
    await runStage({
      db, name: 'pulse-posts', actorId: 'supreme_coder/linkedin-post',
      input: PULSE_POST_ACTOR_INPUT, normalize: normalizePulsePostAuthor, results,
    })
    await runStage({
      db, name: 'pulse-profiles', actorId: 'supreme_coder/linkedin-profile-scraper',
      input: PULSE_PROFILE_ACTOR_INPUT, normalize: normalizePulsePostAuthor, results,
    })

    results.finishedAt = new Date()
    results.durationMs = results.finishedAt - results.startedAt
    await db.collection(RUNS_COLLECTION).insertOne(results)

    return res.status(200).json({
      ok: true,
      budgetState: state,
      monthToDateInr: results.monthToDateInr,
      stages: results.stages.map(({ name, items, inserted, ok, error }) => ({
        name, items, inserted, ok, error,
      })),
    })
  } catch (err) {
     
    console.error('[lead-scrape-cron] fatal', err)
    await captureRouteError(req, err, { fatal: true })
    return res.status(500).json({ ok: false, message: 'Cron failed' })
  }
}
