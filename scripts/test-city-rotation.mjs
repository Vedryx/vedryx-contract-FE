#!/usr/bin/env node
// scripts/test-city-rotation.mjs
//
// Unit tests for city rotation logic. Builds an in-memory fake Mongo db that
// implements the slice of the driver surface pickNextCity()/markCityScraped()
// touch (collection().find().sort().limit().next() and updateOne()).
//
// Validates the rotation rule: oldest last_scraped first (NULL first), one
// city per call. After a city is marked scraped, the next call returns the
// next-oldest. After all cities have a recent timestamp, the cycle wraps to
// the oldest.

import { pickNextCity, markCityScraped } from '../api/_dentist.js'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures += 1
}

// ---------- in-memory Mongo shim ----------
// Implements only what _dentist.js#pickNextCity / markCityScraped touch.
function makeDb(initial) {
  let rows = initial.map((r) => ({ ...r }))
  const col = {
    find(filter = {}) {
      // Apply filter: support { active: true }.
      let view = rows.filter((r) => {
        if (filter.active != null && r.active !== filter.active) return false
        return true
      })
      let sortKey
      let sortDir = 1
      const chain = {
        sort(spec) {
          const [k, d] = Object.entries(spec)[0]
          sortKey = k
          sortDir = d
          return chain
        },
        limit() { return chain },
        async next() {
          // Mongo sorts nulls as the lowest value in ascending order.
          // Mirror that here.
          view.sort((a, b) => {
            const av = a[sortKey]
            const bv = b[sortKey]
            if (av == null && bv == null) return 0
            if (av == null) return -1 * sortDir
            if (bv == null) return 1 * sortDir
            if (av < bv) return -1 * sortDir
            if (av > bv) return 1 * sortDir
            return 0
          })
          return view[0] || null
        },
      }
      return chain
    },
    async updateOne(filter, update) {
      const idx = rows.findIndex(
        (r) => r.city === filter.city && r.state === filter.state
      )
      if (idx < 0) return { matchedCount: 0, modifiedCount: 0 }
      Object.assign(rows[idx], update.$set || {})
      return { matchedCount: 1, modifiedCount: 1 }
    },
    _rows: () => rows,
  }
  return {
    collection: (name) => {
      if (name !== 'us_cities') throw new Error(`unexpected collection ${name}`)
      return col
    },
  }
}

// ---------- tests ----------

// Test 1: empty pool → null.
{
  const db = makeDb([])
  const next = await pickNextCity(db)
  check('empty pool returns null', next === null)
}

// Test 2: fresh seed (all last_scraped = null) → returns the first row
// regardless of population.
{
  const db = makeDb([
    { city: 'A', state: 'XX', last_scraped: null, active: true, population: 1 },
    { city: 'B', state: 'YY', last_scraped: null, active: true, population: 999 },
  ])
  const next = await pickNextCity(db)
  // Either is acceptable — both nulls sort equal, Mongo's pick is order of
  // insertion; what matters is that SOME city is returned.
  check('fresh seed returns a city', next && (next.city === 'A' || next.city === 'B'))
}

// Test 3: oldest last_scraped wins over recent ones.
{
  const now = Date.now()
  const db = makeDb([
    { city: 'Fresh', state: 'XX', last_scraped: new Date(now - 1_000), active: true },
    { city: 'Stale', state: 'YY', last_scraped: new Date(now - 10 * 86_400_000), active: true },
    { city: 'Mid', state: 'ZZ', last_scraped: new Date(now - 86_400_000), active: true },
  ])
  const next = await pickNextCity(db)
  check('oldest last_scraped wins', next?.city === 'Stale')
}

// Test 4: NULL last_scraped beats any timestamp (per Mongo asc sort).
{
  const now = Date.now()
  const db = makeDb([
    { city: 'Stale', state: 'YY', last_scraped: new Date(now - 30 * 86_400_000), active: true },
    { city: 'Untouched', state: 'XX', last_scraped: null, active: true },
  ])
  const next = await pickNextCity(db)
  check('NULL beats any timestamp', next?.city === 'Untouched')
}

// Test 5: markCityScraped updates last_scraped to ~now.
{
  const before = Date.now()
  const db = makeDb([
    { city: 'Miami', state: 'FL', last_scraped: null, active: true },
  ])
  await markCityScraped(db, { city: 'Miami', state: 'FL' })
  const row = db.collection('us_cities')._rows()[0]
  const ok = row.last_scraped instanceof Date && row.last_scraped.getTime() >= before
  check('markCityScraped sets last_scraped to a fresh Date', ok)
}

// Test 6: full rotation cycle — N consecutive picks march through every
// distinct city, then wrap back to the first.
{
  const seed = [
    { city: 'A', state: 'X', last_scraped: null, active: true },
    { city: 'B', state: 'X', last_scraped: null, active: true },
    { city: 'C', state: 'X', last_scraped: null, active: true },
  ]
  const db = makeDb(seed)
  const visited = []
  // Simulate 6 nights — every city should appear twice, never two consecutive
  // hits of the same city.
  for (let i = 0; i < 6; i += 1) {
    const next = await pickNextCity(db)
    visited.push(next.city)
    // Each "night" the last_scraped clock advances strictly forward so we
    // don't get tied timestamps from sub-ms calls.
    await markCityScraped(db, next)
    // Force a small gap by overwriting the just-stamped row with a unique
    // future date — same effect Mongo gives in practice.
    const rows = db.collection('us_cities')._rows()
    const idx = rows.findIndex((r) => r.city === next.city)
    rows[idx].last_scraped = new Date(Date.now() + i)
  }
  const counts = visited.reduce((m, c) => ({ ...m, [c]: (m[c] || 0) + 1 }), {})
  const allCovered = counts.A === 2 && counts.B === 2 && counts.C === 2
  const noConsecutive = visited.every((c, i) => i === 0 || c !== visited[i - 1])
  check('rotation covers every city, wraps cleanly', allCovered, JSON.stringify({ visited, counts }))
  check('rotation never hits same city twice in a row', noConsecutive, JSON.stringify(visited))
}

// Test 7: inactive cities are excluded from rotation.
{
  const db = makeDb([
    { city: 'Active', state: 'X', last_scraped: null, active: true },
    { city: 'Killed', state: 'Y', last_scraped: null, active: false },
  ])
  const next = await pickNextCity(db)
  check('inactive cities excluded', next?.city === 'Active')
}

// Test 8: empty after dropping inactives → null.
{
  const db = makeDb([
    { city: 'Killed1', state: 'X', last_scraped: null, active: false },
    { city: 'Killed2', state: 'Y', last_scraped: null, active: false },
  ])
  const next = await pickNextCity(db)
  check('all-inactive pool returns null', next === null)
}

if (failures) {
  console.error(`\n${failures} failure(s).`)
  process.exit(1)
}
console.log('\nAll city-rotation tests pass.')
