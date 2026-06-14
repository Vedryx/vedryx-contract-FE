#!/usr/bin/env node
// scripts/seed-us-cities.mjs
//
// One-time idempotent seeder for the `us_cities` Mongo collection.
// Run after merging feat/dentist-scrape-cron so the dentist cron has a city
// rotation pool. Re-running is safe — upserts by {city, state}.
//
// Usage:
//   MONGODB_URI=mongodb+srv://... node scripts/seed-us-cities.mjs
//
// Seed source: top 100 US cities by 2020 Census population (city proper, not
// metro). Cities are the unit the Google Maps Apify Actor accepts via
// locationQuery (e.g. "Miami, FL, USA"). Metro-level queries return too broad
// a result set for night-by-night rotation.
//
// Population is stored for tiebreaker / ordering reference only — actual
// rotation key is `last_scraped` (oldest first; NULL first).
//
// Each doc shape:
//   { city: "Miami", state: "FL", population: 442241, last_scraped: null, active: true }

import { MongoClient } from 'mongodb'

const MONGODB_URI = process.env.MONGODB_URI
const MONGODB_DB = process.env.MONGODB_DB || 'vedryx'

if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Aborting.')
  process.exit(1)
}

// Top 100 US cities by 2020 decennial Census population (city proper).
// Source: US Census Bureau 2020 redistricting summary file.
// Pre-checked against city-proper boundaries (not MSAs) so the Google Maps
// Actor's `locationQuery` resolves to the correct dot on the map.
const TOP_100_CITIES = [
  { city: 'New York', state: 'NY', population: 8804190 },
  { city: 'Los Angeles', state: 'CA', population: 3898747 },
  { city: 'Chicago', state: 'IL', population: 2746388 },
  { city: 'Houston', state: 'TX', population: 2304580 },
  { city: 'Phoenix', state: 'AZ', population: 1608139 },
  { city: 'Philadelphia', state: 'PA', population: 1603797 },
  { city: 'San Antonio', state: 'TX', population: 1434625 },
  { city: 'San Diego', state: 'CA', population: 1386932 },
  { city: 'Dallas', state: 'TX', population: 1304379 },
  { city: 'San Jose', state: 'CA', population: 1013240 },
  { city: 'Austin', state: 'TX', population: 961855 },
  { city: 'Jacksonville', state: 'FL', population: 949611 },
  { city: 'Fort Worth', state: 'TX', population: 918915 },
  { city: 'Columbus', state: 'OH', population: 905748 },
  { city: 'Indianapolis', state: 'IN', population: 887642 },
  { city: 'Charlotte', state: 'NC', population: 874579 },
  { city: 'San Francisco', state: 'CA', population: 873965 },
  { city: 'Seattle', state: 'WA', population: 737015 },
  { city: 'Denver', state: 'CO', population: 715522 },
  { city: 'Washington', state: 'DC', population: 689545 },
  { city: 'Nashville', state: 'TN', population: 689447 },
  { city: 'Oklahoma City', state: 'OK', population: 681054 },
  { city: 'El Paso', state: 'TX', population: 678815 },
  { city: 'Boston', state: 'MA', population: 675647 },
  { city: 'Portland', state: 'OR', population: 652503 },
  { city: 'Las Vegas', state: 'NV', population: 641903 },
  { city: 'Detroit', state: 'MI', population: 639111 },
  { city: 'Memphis', state: 'TN', population: 633104 },
  { city: 'Louisville', state: 'KY', population: 633045 },
  { city: 'Baltimore', state: 'MD', population: 585708 },
  { city: 'Milwaukee', state: 'WI', population: 577222 },
  { city: 'Albuquerque', state: 'NM', population: 564559 },
  { city: 'Tucson', state: 'AZ', population: 542629 },
  { city: 'Fresno', state: 'CA', population: 542107 },
  { city: 'Mesa', state: 'AZ', population: 504258 },
  { city: 'Sacramento', state: 'CA', population: 524943 },
  { city: 'Atlanta', state: 'GA', population: 498715 },
  { city: 'Kansas City', state: 'MO', population: 508090 },
  { city: 'Colorado Springs', state: 'CO', population: 478961 },
  { city: 'Omaha', state: 'NE', population: 486051 },
  { city: 'Raleigh', state: 'NC', population: 467665 },
  { city: 'Miami', state: 'FL', population: 442241 },
  { city: 'Long Beach', state: 'CA', population: 466742 },
  { city: 'Virginia Beach', state: 'VA', population: 459470 },
  { city: 'Oakland', state: 'CA', population: 440646 },
  { city: 'Minneapolis', state: 'MN', population: 429954 },
  { city: 'Tulsa', state: 'OK', population: 413066 },
  { city: 'Arlington', state: 'TX', population: 394266 },
  { city: 'New Orleans', state: 'LA', population: 383997 },
  { city: 'Wichita', state: 'KS', population: 397532 },
  { city: 'Bakersfield', state: 'CA', population: 403455 },
  { city: 'Cleveland', state: 'OH', population: 372624 },
  { city: 'Aurora', state: 'CO', population: 386261 },
  { city: 'Anaheim', state: 'CA', population: 346824 },
  { city: 'Honolulu', state: 'HI', population: 350964 },
  { city: 'Santa Ana', state: 'CA', population: 310227 },
  { city: 'Riverside', state: 'CA', population: 314998 },
  { city: 'Corpus Christi', state: 'TX', population: 317863 },
  { city: 'Lexington', state: 'KY', population: 322570 },
  { city: 'Henderson', state: 'NV', population: 317610 },
  { city: 'Stockton', state: 'CA', population: 320804 },
  { city: 'Saint Paul', state: 'MN', population: 311527 },
  { city: 'Cincinnati', state: 'OH', population: 309317 },
  { city: 'Saint Louis', state: 'MO', population: 301578 },
  { city: 'Pittsburgh', state: 'PA', population: 302971 },
  { city: 'Greensboro', state: 'NC', population: 299035 },
  { city: 'Lincoln', state: 'NE', population: 291082 },
  { city: 'Anchorage', state: 'AK', population: 291247 },
  { city: 'Plano', state: 'TX', population: 285494 },
  { city: 'Orlando', state: 'FL', population: 307573 },
  { city: 'Irvine', state: 'CA', population: 307670 },
  { city: 'Newark', state: 'NJ', population: 311549 },
  { city: 'Durham', state: 'NC', population: 283506 },
  { city: 'Chula Vista', state: 'CA', population: 275487 },
  { city: 'Toledo', state: 'OH', population: 270871 },
  { city: 'Fort Wayne', state: 'IN', population: 263886 },
  { city: 'St. Petersburg', state: 'FL', population: 258308 },
  { city: 'Laredo', state: 'TX', population: 255205 },
  { city: 'Jersey City', state: 'NJ', population: 292449 },
  { city: 'Chandler', state: 'AZ', population: 275987 },
  { city: 'Madison', state: 'WI', population: 269840 },
  { city: 'Lubbock', state: 'TX', population: 257141 },
  { city: 'Scottsdale', state: 'AZ', population: 241361 },
  { city: 'Reno', state: 'NV', population: 264165 },
  { city: 'Buffalo', state: 'NY', population: 278349 },
  { city: 'Gilbert', state: 'AZ', population: 267918 },
  { city: 'Glendale', state: 'AZ', population: 248325 },
  { city: 'North Las Vegas', state: 'NV', population: 262527 },
  { city: 'Winston-Salem', state: 'NC', population: 249545 },
  { city: 'Chesapeake', state: 'VA', population: 249422 },
  { city: 'Norfolk', state: 'VA', population: 238005 },
  { city: 'Fremont', state: 'CA', population: 230504 },
  { city: 'Garland', state: 'TX', population: 246018 },
  { city: 'Irving', state: 'TX', population: 256684 },
  { city: 'Hialeah', state: 'FL', population: 223109 },
  { city: 'Richmond', state: 'VA', population: 226610 },
  { city: 'Boise', state: 'ID', population: 235684 },
  { city: 'Spokane', state: 'WA', population: 228989 },
  { city: 'Baton Rouge', state: 'LA', population: 227470 },
  { city: 'Tampa', state: 'FL', population: 384959 },
  { city: 'San Bernardino', state: 'CA', population: 222101 },
  { city: 'Modesto', state: 'CA', population: 218464 },
]

async function main() {
  const client = new MongoClient(MONGODB_URI)
  await client.connect()
  try {
    const db = client.db(MONGODB_DB)
    const col = db.collection('us_cities')

    // Idempotent index. Unique on (city, state) so re-runs upsert in place.
    await col.createIndex({ city: 1, state: 1 }, { unique: true })
    await col.createIndex({ last_scraped: 1 })
    await col.createIndex({ active: 1 })

    let upserted = 0
    let modified = 0
    for (const c of TOP_100_CITIES) {
      const res = await col.updateOne(
        { city: c.city, state: c.state },
        {
          $set: {
            population: c.population,
            active: true,
            updated_at: new Date(),
          },
          $setOnInsert: {
            city: c.city,
            state: c.state,
            last_scraped: null,
            created_at: new Date(),
          },
        },
        { upsert: true }
      )
      if (res.upsertedCount) upserted += 1
      else if (res.modifiedCount) modified += 1
    }

    const total = await col.countDocuments({ active: true })
    console.log(
      `Seeded us_cities: upserted=${upserted}, modified=${modified}, total_active=${total}`
    )
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error('Seeder failed:', err)
  process.exit(1)
})
