#!/usr/bin/env node
// scripts/test-classify-leads.mjs
//
// Smoke test for classifyLead() — the ICP routing brain.
// Run via: node scripts/test-classify-leads.mjs
// Exits non-zero on any failure. No deps.

import {
  classifyLead,
  computeLeadScore,
  normalizeHarvestCompanyEmployee,
  normalizeHarvestPostAuthor,
} from '../api/_apify.js'

const cases = [
  {
    name: 'core: Head of Engineering at 200-person US SaaS',
    lead: {
      person: { title: 'Head of Engineering' },
      company: { employee_count: 200, industry: 'SaaS', hq_country: 'us' },
      signal: {},
    },
    expect: 'core',
  },
  {
    name: 'core: VP Talent at 800-person UK fintech',
    lead: {
      person: { title: 'VP Talent' },
      company: { employee_count: 800, industry: 'fintech', hq_country: 'uk' },
      signal: {},
    },
    expect: 'core',
  },
  {
    name: 'core: Founder at 50-person scaled company (founder-of-scaled rule)',
    lead: {
      person: { title: 'Founder & CEO' },
      company: { employee_count: 50, industry: 'software', hq_country: 'in' },
      signal: {},
    },
    expect: 'core',
  },
  {
    name: 'pulse: solo Founder with MVP post signal',
    lead: {
      person: { title: 'Founder' },
      company: { employee_count: 1 },
      signal: { post_content_snippet: 'building my MVP, need developer help' },
    },
    expect: 'pulse',
  },
  {
    name: 'pulse: Indie Maker with buildinpublic snippet',
    lead: {
      person: { title: 'Indie Maker' },
      company: { employee_count: null },
      signal: { post_content_snippet: 'shipping my first app, learning to launch' },
    },
    expect: 'pulse',
  },
  {
    name: 'disqualified: Sales rep at 30-person company',
    lead: {
      person: { title: 'Account Executive' },
      company: { employee_count: 30, industry: 'logistics', hq_country: 'br' },
      signal: {},
    },
    expect: 'disqualified',
  },
  {
    name: 'disqualified: founder, no post signal, mid-size (neither full Core nor Pulse)',
    lead: {
      person: { title: 'Founder' },
      company: { employee_count: 15 },
      signal: {},
    },
    expect: 'disqualified',
  },
  {
    name: 'conflict → core (LTV rule): CTO at 100-person, also posts MVP',
    lead: {
      person: { title: 'CTO' },
      company: { employee_count: 100, industry: 'software', hq_country: 'us' },
      signal: { post_content_snippet: 'building MVP for new product' },
    },
    expect: 'core',
  },
  {
    // QA adversarial case (B-flag in qa-review.md):
    // Co-Founder & CTO at an 8-person startup with an MVP signal previously
    // returned `pulse` because pulseHits (title+tiny+post = 3) tripped before
    // coreHits reached 3 (title alone scores 2; emp-band/industry/geo missed).
    // Conflict-first rule per cmo.md §6 line 188 must route this to `core`.
    name: 'conflict-at-small-co → core: Co-Founder & CTO at 8-person startup, MVP post signal',
    lead: {
      person: { title: 'Co-Founder & CTO' },
      company: { employee_count: 8 },
      signal: { post_content_snippet: 'building our MVP, prepping launch' },
    },
    expect: 'core',
  },
  {
    // Guards against the "loose substring" regression — "happy", "rapper",
    // "application" must NOT trip the post signal. Lone Founder, tiny co,
    // no actual MVP/dev keyword → no pulse signal → disqualified.
    name: 'word-boundary regex: "happy" / "rapper" must not trip pulse:post-signal',
    lead: {
      person: { title: 'Founder' },
      company: { employee_count: 1 },
      signal: { post_content_snippet: 'i am happy our rapper friend dropped an album' },
    },
    expect: 'disqualified',
  },
  // ---- RA §6.5: title exclusions (lead-quality-throttle) ----
  {
    name: 'exclusion: Junior Engineering Manager → disqualified',
    lead: {
      person: { title: 'Junior Engineering Manager' },
      company: { employee_count: 100, industry: 'software', hq_country: 'us' },
      signal: {},
    },
    expect: 'disqualified',
  },
  {
    name: 'exclusion: ex-CTO must not score Core',
    lead: {
      person: { title: 'ex-CTO @ Acme' },
      company: { employee_count: 100, industry: 'software', hq_country: 'us' },
      signal: {},
    },
    expect: 'disqualified',
  },
  {
    name: 'exclusion: freelance Engineering Manager → disqualified',
    lead: {
      person: { title: 'Freelance Engineering Manager' },
      company: { employee_count: 100, industry: 'software', hq_country: 'us' },
      signal: {},
    },
    expect: 'disqualified',
  },
  // ---- RA §6.4: headcount band tightened to 51-500 ----
  {
    name: 'headcount band: 30-person company no longer earns core:emp-band (below 51)',
    lead: {
      person: { title: 'Technical Recruiter' },
      company: { employee_count: 30, industry: 'software', hq_country: 'us' },
      signal: {},
    },
    // 30-person co: title(2) + industry(1) + geo(1) = 4 coreHits → still core,
    // but emp-band must NOT be in matched.
    expect: 'core',
  },
  {
    name: 'headcount band: 800-person company no longer earns core:emp-band (above 500)',
    lead: {
      person: { title: 'Director of Engineering' },
      company: { employee_count: 800, industry: 'software', hq_country: 'uk' },
      signal: {},
    },
    expect: 'core',
  },
  // ---- RA §6.6: Pulse pre-filters (engagement, post age, funded exclusion) ----
  {
    name: 'pulse pre-filter: zero-engagement post → disqualified',
    lead: {
      person: { title: 'Founder' },
      company: { employee_count: 1 },
      signal: {
        post_content_snippet: 'building my MVP, need developer help',
        engagement: { likes: 0, comments: 0, reactions: [] },
        posted_at: { date: new Date().toISOString() },
      },
      apify: { actor_id: 'harvestapi/linkedin-post-search' },
    },
    expect: 'disqualified',
  },
  {
    name: 'pulse pre-filter: stale post (20h old) → disqualified',
    lead: {
      person: { title: 'Founder' },
      company: { employee_count: 1 },
      signal: {
        post_content_snippet: 'building my MVP, need developer help',
        engagement: { likes: 10, comments: 2, reactions: [{ count: 7 }] },
        posted_at: { date: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString() },
      },
      apify: { actor_id: 'harvestapi/linkedin-post-search' },
    },
    expect: 'disqualified',
  },
  {
    name: 'pulse pre-filter: fresh post (2h) with comments → pulse',
    lead: {
      person: { title: 'Founder' },
      company: { employee_count: 1 },
      signal: {
        post_content_snippet: 'looking for technical cofounder to build my MVP',
        engagement: { likes: 5, comments: 2, reactions: [{ count: 5 }] },
        posted_at: { date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
      },
      apify: { actor_id: 'harvestapi/linkedin-post-search' },
    },
    expect: 'pulse',
  },
  {
    name: 'pulse pre-filter: funded-stage exclusion ("just raised seed funding")',
    lead: {
      person: { title: 'Founder' },
      company: { employee_count: 5 },
      signal: {
        post_content_snippet: 'we just raised seed funding and are building our MVP',
        engagement: { likes: 50, comments: 10 },
        posted_at: { date: new Date().toISOString() },
      },
      apify: { actor_id: 'harvestapi/linkedin-post-search' },
    },
    expect: 'disqualified',
  },
  {
    name: 'pulse pre-filter: Series A exclusion',
    lead: {
      person: { title: 'Founder' },
      company: { employee_count: 5 },
      signal: {
        post_content_snippet: 'we just closed our Series A and are hiring devs',
        engagement: { likes: 100, comments: 25 },
        posted_at: { date: new Date().toISOString() },
      },
      apify: { actor_id: 'harvestapi/linkedin-post-search' },
    },
    expect: 'disqualified',
  },
  // ---- RA §F: 0-100 score range ----
  {
    name: 'score range: top-fit CTO at 200-person US SaaS lands >= 70',
    lead: {
      person: { first_name: 'Pat', title: 'CTO' },
      company: { employee_count: 200, industry: 'SaaS', hq_country: 'us' },
      signal: {},
    },
    expect: 'core',
    expectScoreMin: 70,
  },
  {
    name: 'score range: scores are integers in 0..100',
    lead: {
      person: { first_name: 'A', title: 'Head of Engineering' },
      company: { employee_count: 250, industry: 'SaaS', hq_country: 'us' },
      signal: {},
    },
    expect: 'core',
    expectScoreInt: true,
  },
]

let failures = 0
for (const tc of cases) {
  const got = classifyLead(tc.lead)
  let ok = got.icp === tc.expect
  if (ok && typeof tc.expectScoreMin === 'number' && got.score < tc.expectScoreMin) ok = false
  if (ok && tc.expectScoreInt && !Number.isInteger(got.score)) ok = false
  // Score must be 0-100 integer-valued from the new rubric.
  if (ok && (got.score < 0 || got.score > 100)) ok = false
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${tc.name}  (got=${got.icp}, score=${got.score})`)
  if (!ok) {
    failures += 1
    console.log(`  matched: ${JSON.stringify(got.matched)}`)
  }
}

// -------------------- Normalizer tests (lead-pipeline-actor-rework) --------------------
// The harvestapi/linkedin-company-employees Short tier returns title under
// `currentPositions[0].title` (top-level `headline` is null). Normalizer must
// flatten this so classifyLead's title-based scoring still fires.
//
// The harvestapi/linkedin-post-search actor returns author info under
// `author.{name,linkedinUrl,info}` — normalizer must map `info` to title and
// split `name` into first/last.

const normalizerCases = [
  {
    name: 'normalizeHarvestCompanyEmployee: nested currentPositions[0].title becomes person.title',
    fn: () => {
      const raw = {
        id: 'urn:abc',
        firstName: 'Pat',
        lastName: 'Singh',
        profileUrl: 'https://www.linkedin.com/in/pat-singh-abc',
        headline: null,
        currentPositions: [{ title: 'Head of Engineering', companyName: 'Acme', tenure: '2y' }],
        location: { linkedinText: 'San Francisco Bay Area' },
        companyUrl: 'https://www.linkedin.com/company/acme',
      }
      const norm = normalizeHarvestCompanyEmployee(raw)
      return (
        norm.person.title === 'Head of Engineering' &&
        norm.person.first_name === 'Pat' &&
        norm.person.linkedin_url === 'https://www.linkedin.com/in/pat-singh-abc' &&
        norm.company.name === 'Acme' &&
        norm.apify.actor_id === 'harvestapi/linkedin-company-employees'
      )
    },
  },
  {
    name: 'normalizeHarvestCompanyEmployee: missing currentPositions falls back to empty title (not crash)',
    fn: () => {
      const norm = normalizeHarvestCompanyEmployee({
        firstName: 'Lee',
        profileUrl: 'https://www.linkedin.com/in/lee',
      })
      return norm.person.title === '' && norm.person.first_name === 'Lee'
    },
  },
  {
    name: 'normalizeHarvestPostAuthor: author.linkedinUrl + author.name split correctly',
    fn: () => {
      const raw = {
        id: '7470031634256539648',
        content: 'My friend is building a dating startup and is looking for a Tech Co-founder',
        author: {
          name: 'Jayy Patil',
          publicIdentifier: 'jayy-patil-b83294a9',
          linkedinUrl: 'https://www.linkedin.com/in/jayy-patil-b83294a9?xyz',
          info: 'Founder',
        },
      }
      const norm = normalizeHarvestPostAuthor(raw)
      return (
        norm.person.first_name === 'Jayy' &&
        norm.person.last_name === 'Patil' &&
        norm.person.title === 'Founder' &&
        norm.person.linkedin_url === 'https://www.linkedin.com/in/jayy-patil-b83294a9?xyz' &&
        norm.signal.post_content_snippet.includes('building a dating startup') &&
        norm.apify.actor_id === 'harvestapi/linkedin-post-search'
      )
    },
  },
  {
    name: 'normalizeHarvestPostAuthor: missing author.linkedinUrl yields empty linkedin_url (cron will skip)',
    fn: () => {
      const norm = normalizeHarvestPostAuthor({ content: 'just a post', author: {} })
      return norm.person.linkedin_url === ''
    },
  },
  {
    name: 'classify after normalize: nested-title CTO at small co with MVP post → core (chain-end check)',
    fn: () => {
      // Pretend the post-search yielded an author whose downstream profile-enrichment
      // populated currentPositions; verify the full chain (normalize → classify) still
      // routes per cmo.md §6 conflict-resolves-to-core rule.
      const raw = {
        firstName: 'Riya',
        lastName: 'Mehta',
        profileUrl: 'https://www.linkedin.com/in/riya-mehta',
        headline: null,
        currentPositions: [{ title: 'Co-Founder & CTO', companyName: 'StartCo' }],
      }
      const norm = normalizeHarvestCompanyEmployee(raw)
      // Simulate the post-signal that originally tripped pulse (CMO conflict case).
      norm.company.employee_count = 8
      norm.signal.post_content_snippet = 'building our MVP, prepping launch'
      const got = classifyLead(norm)
      return got.icp === 'core'
    },
  },
  // ---- RA §6.6: normalizer retains engagement + postedAt for Pulse pre-filters ----
  {
    name: 'normalizeHarvestPostAuthor: retains raw.engagement and raw.postedAt',
    fn: () => {
      const norm = normalizeHarvestPostAuthor({
        content: 'looking for technical cofounder',
        author: { name: 'Sam Singh', linkedinUrl: 'https://www.linkedin.com/in/sam', info: 'Founder' },
        engagement: { likes: 12, comments: 3, reactions: [{ count: 12 }] },
        postedAt: { date: new Date().toISOString(), timestamp: Math.floor(Date.now() / 1000) },
      })
      return (
        norm.signal.engagement?.comments === 3 &&
        Array.isArray(norm.signal.engagement?.reactions) &&
        norm.signal.posted_at?.date != null
      )
    },
  },
  // ---- RA §6.4: emp-band must not fire outside 51-500 ----
  {
    name: 'headcount band: 30-person co does NOT get core:emp-band signal in matched list',
    fn: () => {
      const got = classifyLead({
        person: { title: 'Technical Recruiter' },
        company: { employee_count: 30, industry: 'software', hq_country: 'us' },
        signal: {},
      })
      return !got.matched.includes('core:emp-band')
    },
  },
  {
    name: 'headcount band: 100-person co DOES get core:emp-band signal',
    fn: () => {
      const got = classifyLead({
        person: { title: 'Technical Recruiter' },
        company: { employee_count: 100, industry: 'software', hq_country: 'us' },
        signal: {},
      })
      return got.matched.includes('core:emp-band')
    },
  },
  // ---- RA §F: computeLeadScore directly callable + bounded 0..100 ----
  {
    name: 'computeLeadScore: top-fit Core CTO at 200-person US SaaS lands >= 70 and <= 100',
    fn: () => {
      const s = computeLeadScore(
        {
          person: { first_name: 'Pat', title: 'CTO' },
          company: { employee_count: 200, industry: 'SaaS', hq_country: 'us' },
          signal: {},
          scraped_at: new Date(),
        },
        { icp: 'core', coreHits: 5, pulseHits: 0, matched: [], isPulseSource: false }
      )
      return Number.isInteger(s) && s >= 70 && s <= 100
    },
  },
  {
    name: 'computeLeadScore: disqualified always returns 0',
    fn: () => {
      const s = computeLeadScore(
        { person: { title: 'Account Executive' }, company: {}, signal: {} },
        { icp: 'disqualified', coreHits: 0, pulseHits: 0, matched: [], isPulseSource: false }
      )
      return s === 0
    },
  },
]

let normFailures = 0
for (const tc of normalizerCases) {
  let ok = false
  let err = null
  try {
    ok = tc.fn()
  } catch (e) {
    err = e
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${tc.name}`)
  if (!ok) {
    normFailures += 1
    if (err) console.log(`  threw: ${err.message}`)
  }
}

const totalFailures = failures + normFailures
const totalCases = cases.length + normalizerCases.length
if (totalFailures) {
  console.error(`\n${totalFailures} failure(s) across ${totalCases} cases.`)
  process.exit(1)
} else {
  console.log(`\nAll ${totalCases} cases pass.`)
}
