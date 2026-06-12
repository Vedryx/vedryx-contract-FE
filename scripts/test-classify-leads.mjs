#!/usr/bin/env node
// scripts/test-classify-leads.mjs
//
// Smoke test for classifyLead() — the ICP routing brain.
// Run via: node scripts/test-classify-leads.mjs
// Exits non-zero on any failure. No deps.

import { classifyLead } from '../api/_apify.js'

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
if (failures) {
  console.error(`\n${failures} failure(s).`)
  process.exit(1)
} else {
  console.log(`\nAll ${cases.length} classifier cases pass.`)
}
