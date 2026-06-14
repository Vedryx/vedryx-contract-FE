#!/usr/bin/env node
// scripts/test-classify-dentist.mjs
//
// Unit tests for the dentist scrape pipeline:
//   - landsInDb() AND gate (the strict required-field check before Mongo)
//   - normalizeGoogleMapsDentist() (compass Actor output → partial lead)
//   - parsePsiResponse() (PSI JSON → score + flag string)
//   - extractDomainEmail() (crawler output → first domain-matched email)
//
// Run via: node scripts/test-classify-dentist.mjs
// Exits non-zero on any failure. No deps.

import {
  landsInDb,
  normalizeGoogleMapsDentist,
  parsePsiResponse,
  extractDomainEmail,
} from '../api/_dentist.js'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures += 1
}

// -------------------- landsInDb AND gate --------------------

check(
  'AND gate: complete lead lands',
  landsInDb({
    name: 'Dr. Sarah Smith',
    phone: '(305) 555-1234',
    email: 'drsmith@bright.com',
    website: 'brightsmilesmiami.com',
    pagespeed: 32,
    flag: 'loads 8s, mobile-broken',
  }) === true
)

check(
  'AND gate: email null lands (email is optional)',
  landsInDb({
    name: 'Dr. Smith',
    phone: '(305) 555-1234',
    email: null,
    website: 'bright.com',
    pagespeed: 32,
    flag: 'loads 8s',
  }) === true
)

check(
  'AND gate: missing name drops',
  landsInDb({
    name: '',
    phone: '(305) 555-1234',
    website: 'bright.com',
    pagespeed: 32,
    flag: 'loads 8s',
  }) === false
)

check(
  'AND gate: bad phone (under 7 digits) drops',
  landsInDb({
    name: 'Dr. Smith',
    phone: '12345',
    website: 'bright.com',
    pagespeed: 32,
    flag: 'loads 8s',
  }) === false
)

check(
  'AND gate: missing website drops',
  landsInDb({
    name: 'Dr. Smith',
    phone: '(305) 555-1234',
    website: '',
    pagespeed: 32,
    flag: 'loads 8s',
  }) === false
)

check(
  'AND gate: pagespeed boundary — 49 lands',
  landsInDb({
    name: 'Dr. Smith',
    phone: '(305) 555-1234',
    website: 'bright.com',
    pagespeed: 49,
    flag: 'PSI 49',
  }) === true
)

check(
  'AND gate: pagespeed boundary — 50 drops (>= 50 means decent site)',
  landsInDb({
    name: 'Dr. Smith',
    phone: '(305) 555-1234',
    website: 'bright.com',
    pagespeed: 50,
    flag: 'whatever',
  }) === false
)

check(
  'AND gate: pagespeed boundary — 51 drops',
  landsInDb({
    name: 'Dr. Smith',
    phone: '(305) 555-1234',
    website: 'bright.com',
    pagespeed: 51,
    flag: 'whatever',
  }) === false
)

check(
  'AND gate: non-number pagespeed drops',
  landsInDb({
    name: 'Dr. Smith',
    phone: '(305) 555-1234',
    website: 'bright.com',
    pagespeed: 'low',
    flag: 'loads 8s',
  }) === false
)

check(
  'AND gate: missing flag drops',
  landsInDb({
    name: 'Dr. Smith',
    phone: '(305) 555-1234',
    website: 'bright.com',
    pagespeed: 32,
    flag: '',
  }) === false
)

check(
  'AND gate: NaN pagespeed drops',
  landsInDb({
    name: 'Dr. Smith',
    phone: '(305) 555-1234',
    website: 'bright.com',
    pagespeed: NaN,
    flag: 'loads 8s',
  }) === false
)

check(
  'AND gate: non-string email drops (must be string|null)',
  landsInDb({
    name: 'Dr. Smith',
    phone: '(305) 555-1234',
    email: 123,
    website: 'bright.com',
    pagespeed: 32,
    flag: 'loads 8s',
  }) === false
)

check(
  'AND gate: phone with separators counts digits only — 7 digits lands',
  landsInDb({
    name: 'Dr. Smith',
    phone: '305-1234',
    website: 'bright.com',
    pagespeed: 32,
    flag: 'loads 8s',
  }) === true
)

// -------------------- normalizeGoogleMapsDentist --------------------

check(
  'normalize: full row maps title/phone/website/categoryName',
  (() => {
    const norm = normalizeGoogleMapsDentist({
      title: 'Bright Smiles Miami',
      phone: '(305) 555-1234',
      website: 'https://brightsmilesmiami.com',
      address: '123 Main St, Miami, FL',
      categoryName: 'Dentist',
    })
    return (
      norm &&
      norm.name === 'Bright Smiles Miami' &&
      norm.phone === '(305) 555-1234' &&
      norm.website === 'https://brightsmilesmiami.com' &&
      norm.category === 'Dentist'
    )
  })()
)

check(
  'normalize: no website returns null (early drop)',
  normalizeGoogleMapsDentist({
    title: 'Generic Dentist',
    phone: '305-555-1234',
  }) === null
)

check(
  'normalize: no title returns null',
  normalizeGoogleMapsDentist({
    website: 'bright.com',
  }) === null
)

check(
  'normalize: phoneNumbers array fallback works',
  (() => {
    const norm = normalizeGoogleMapsDentist({
      title: 'Smile',
      website: 'smile.com',
      phoneNumbers: ['(305) 555-9999', '(305) 555-1234'],
    })
    return norm && norm.phone === '(305) 555-9999'
  })()
)

check(
  'normalize: phoneUnformatted fallback works',
  (() => {
    const norm = normalizeGoogleMapsDentist({
      title: 'Smile',
      website: 'smile.com',
      phoneUnformatted: '3055551234',
    })
    return norm && norm.phone === '3055551234'
  })()
)

check(
  'normalize: categories[0] fallback when categoryName absent',
  (() => {
    const norm = normalizeGoogleMapsDentist({
      title: 'Smile',
      website: 'smile.com',
      categories: ['Cosmetic Dentist', 'Dental Clinic'],
    })
    return norm && norm.category === 'Cosmetic Dentist'
  })()
)

// -------------------- parsePsiResponse --------------------

check(
  'PSI parse: 32% score with LCP 8s + viewport fail emits flag string',
  (() => {
    const parsed = parsePsiResponse({
      lighthouseResult: {
        categories: { performance: { score: 0.32 } },
        audits: {
          'largest-contentful-paint': { numericValue: 8000, score: 0.1 },
          viewport: { score: 0 },
        },
      },
    })
    return (
      parsed.score === 32 &&
      parsed.flag.includes('loads 8.0s') &&
      parsed.flag.includes('mobile-broken') &&
      parsed.failedAudits.includes('largest-contentful-paint') &&
      parsed.failedAudits.includes('viewport')
    )
  })()
)

check(
  'PSI parse: high CLS surfaces as "layout shift"',
  (() => {
    const parsed = parsePsiResponse({
      lighthouseResult: {
        categories: { performance: { score: 0.45 } },
        audits: {
          'cumulative-layout-shift': { numericValue: 0.4, score: 0.2 },
        },
      },
    })
    return parsed.score === 45 && parsed.flag.includes('layout shift')
  })()
)

check(
  'PSI parse: malformed (no perf score) returns null',
  (() => {
    const parsed = parsePsiResponse({ lighthouseResult: { categories: {} } })
    return parsed.score === null && parsed.flag === null
  })()
)

check(
  'PSI parse: low score with no failed audits falls back to "PSI <n>"',
  (() => {
    const parsed = parsePsiResponse({
      lighthouseResult: {
        categories: { performance: { score: 0.4 } },
        audits: {},
      },
    })
    return parsed.score === 40 && parsed.flag === 'PSI 40'
  })()
)

check(
  'PSI parse: passing site (90+) yields null/empty flag (caller drops via AND gate)',
  (() => {
    const parsed = parsePsiResponse({
      lighthouseResult: {
        categories: { performance: { score: 0.92 } },
        audits: {
          'largest-contentful-paint': { numericValue: 1800, score: 1 },
          viewport: { score: 1 },
        },
      },
    })
    // High score, all audits pass → no flag parts; flag stays empty string,
    // but AND gate keys off pagespeed >= 50, not flag emptiness.
    return parsed.score === 92 && parsed.flag === ''
  })()
)

// -------------------- extractDomainEmail --------------------

check(
  'email extract: finds domain-matched mail in text',
  (() => {
    const r = extractDomainEmail(
      [{ text: 'Contact us: info@brightsmilesmiami.com or call us.' }],
      'brightsmilesmiami.com'
    )
    return r.email === 'info@brightsmilesmiami.com' && r.pagesCrawled === 1
  })()
)

check(
  'email extract: ignores foreign-domain email',
  (() => {
    const r = extractDomainEmail(
      [{ text: 'Need help? gmail at random@gmail.com works.' }],
      'brightsmilesmiami.com'
    )
    return r.email === null && r.pagesCrawled === 1
  })()
)

check(
  'email extract: subdomain match counts',
  (() => {
    const r = extractDomainEmail(
      [{ text: 'reach: hello@booking.brightsmilesmiami.com' }],
      'brightsmilesmiami.com'
    )
    return r.email === 'hello@booking.brightsmilesmiami.com'
  })()
)

check(
  'email extract: empty items → null',
  (() => {
    const r = extractDomainEmail([], 'brightsmilesmiami.com')
    return r.email === null && r.pagesCrawled === 0
  })()
)

check(
  'email extract: no host → null',
  (() => {
    const r = extractDomainEmail(
      [{ text: 'info@bright.com' }],
      ''
    )
    return r.email === null
  })()
)

check(
  'email extract: prefers domain match over earlier non-match',
  (() => {
    const r = extractDomainEmail(
      [
        { text: 'first: gmail-random@gmail.com' },
        { text: 'real: receptionist@brightsmilesmiami.com' },
      ],
      'brightsmilesmiami.com'
    )
    return r.email === 'receptionist@brightsmilesmiami.com'
  })()
)

if (failures) {
  console.error(`\n${failures} failure(s).`)
  process.exit(1)
}
console.log('\nAll dentist-classify tests pass.')
