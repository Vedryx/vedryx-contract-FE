#!/usr/bin/env node
// scripts/test-classify-leads.mjs
//
// Smoke test for classifyLead() — the ICP routing brain.
// Run via: node scripts/test-classify-leads.mjs
// Exits non-zero on any failure. No deps.

import {
  classifyLead,
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
]

let failures = 0
for (const tc of cases) {
  const got = classifyLead(tc.lead)
  const ok = got.icp === tc.expect
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${tc.name}  (got=${got.icp}, score=${got.score.toFixed(2)})`)
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
