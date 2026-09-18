import { test } from "node:test"
import assert from "node:assert/strict"

import {
  addDaysToKey,
  attributeMinorByDay,
  buildTrendSeries,
  pickGranularity,
  rangeKeysEndingAt,
  revenueEnvelope,
  sumByDay,
} from "../src/lib/analytics-core"
import { dayKeyInTimeZone } from "../src/lib/memberships"

// ---------------------------------------------------------------------------
// Day-key math
// ---------------------------------------------------------------------------

test("addDaysToKey stays on calendar days across month/year/leap boundaries", () => {
  assert.equal(addDaysToKey("2026-09-18", 0), "2026-09-18")
  assert.equal(addDaysToKey("2026-09-18", -1), "2026-09-17")
  assert.equal(addDaysToKey("2026-09-18", 1), "2026-09-19")
  assert.equal(addDaysToKey("2026-03-01", -1), "2026-02-28")
  assert.equal(addDaysToKey("2025-01-01", -1), "2024-12-31")
  assert.equal(addDaysToKey("2024-02-29", 1), "2024-03-01")
  assert.equal(addDaysToKey("2023-02-28", 1), "2023-03-01")
})

test("rangeKeysEndingAt returns `days` keys ending at today, oldest first", () => {
  const keys = rangeKeysEndingAt("2026-09-18", 30)
  assert.equal(keys.length, 30)
  assert.equal(keys[0], "2026-08-20")
  assert.equal(keys[29], "2026-09-18")
  const single = rangeKeysEndingAt("2026-09-18", 1)
  assert.deepEqual(single, ["2026-09-18"])
})

// ---------------------------------------------------------------------------
// Timezone attribution (the core business-day definition)
// ---------------------------------------------------------------------------

test("IST midnight boundary: 23:59 yesterday vs 00:00 today", () => {
  const rows = [
    { paymentDate: new Date("2026-09-17T18:29:59.000Z"), amountMinor: 100 },
    { paymentDate: new Date("2026-09-17T18:30:00.000Z"), amountMinor: 200 },
    { paymentDate: new Date("2026-09-18T18:30:00.000Z"), amountMinor: 300 },
  ]
  const byDay = attributeMinorByDay(rows, "Asia/Kolkata")
  // 18:29:59Z +05:30 = 23:59:59 IST (Sep 17); 18:30:00Z = 00:00 IST (Sep 18)
  assert.equal(byDay.get("2026-09-17"), 100)
  assert.equal(byDay.get("2026-09-18"), 200)
  assert.equal(byDay.get("2026-09-19"), 300)
  assert.equal(byDay.size, 3)
})

test("same timestamp lands on different org days in different timezones", () => {
  const t = new Date("2026-09-17T23:30:00.000Z")
  assert.equal(dayKeyInTimeZone(t, "Asia/Kolkata"), "2026-09-18") // 05:00 IST
  assert.equal(dayKeyInTimeZone(t, "America/New_York"), "2026-09-17") // 19:30 EDT
  const rows = [{ paymentDate: t, amountMinor: 999 }]
  assert.equal(attributeMinorByDay(rows, "Asia/Kolkata").get("2026-09-18"), 999)
  assert.equal(attributeMinorByDay(rows, "America/New_York").get("2026-09-17"), 999)
})

test("multiple payments on the same business day sum into one bucket", () => {
  const rows = [
    { paymentDate: new Date("2026-09-18T00:30:00.000Z"), amountMinor: 502000 },
    { paymentDate: new Date("2026-09-18T11:36:51.000Z"), amountMinor: 649900 },
    { paymentDate: new Date("2026-09-18T11:54:56.000Z"), amountMinor: 349900 },
  ]
  const byDay = attributeMinorByDay(rows, "Asia/Kolkata")
  assert.equal(byDay.get("2026-09-18"), 1501800)
})

// ---------------------------------------------------------------------------
// sumByDay / range filtering
// ---------------------------------------------------------------------------

test("sumByDay only counts keys inside the requested range", () => {
  const byDay = new Map<string, number>([
    ["2026-09-15", 100],
    ["2026-09-16", 200],
    ["2026-09-18", 300],
    ["2026-09-19", 400], // outside 30-day range ending 18th
    ["2026-08-19", 500], // before range
  ])
  const keys = rangeKeysEndingAt("2026-09-18", 30)
  assert.equal(sumByDay(byDay, keys), 600)
  assert.equal(JSON.stringify(keys.includes("2026-09-19")), "false")
})

// ---------------------------------------------------------------------------
// Granularity selection + reconciliation
// ---------------------------------------------------------------------------

test("pickGranularity: day ≤60, week ≤240, month beyond", () => {
  assert.equal(pickGranularity(1), "day")
  assert.equal(pickGranularity(30), "day")
  assert.equal(pickGranularity(60), "day")
  assert.equal(pickGranularity(61), "week")
  assert.equal(pickGranularity(90), "week")
  assert.equal(pickGranularity(240), "week")
  assert.equal(pickGranularity(241), "month")
  assert.equal(pickGranularity(365), "month")
})

test("REGRESSION: 30-day revenue trend reconciles exactly with KPI (the 18 Sep ₹15,01,800 case)", () => {
  const rows = [
    { paymentDate: new Date("2026-08-22T05:00:00.000Z"), amountMinor: 129900 },
    { paymentDate: new Date("2026-09-15T05:00:00.000Z"), amountMinor: 349900 },
    { paymentDate: new Date("2026-09-15T05:30:00.000Z"), amountMinor: 349900 },
    { paymentDate: new Date("2026-09-16T05:00:00.000Z"), amountMinor: 219900 },
    { paymentDate: new Date("2026-09-16T05:10:00.000Z"), amountMinor: 219900 },
    { paymentDate: new Date("2026-09-16T05:20:00.000Z"), amountMinor: 219900 },
    { paymentDate: new Date("2026-09-16T05:30:00.000Z"), amountMinor: 219900 },
    { paymentDate: new Date("2026-09-16T05:40:00.000Z"), amountMinor: 219900 },
    { paymentDate: new Date("2026-09-18T00:00:00.000Z"), amountMinor: 502000 },
    { paymentDate: new Date("2026-09-18T11:36:51.000Z"), amountMinor: 649900 },
    { paymentDate: new Date("2026-09-18T11:54:56.000Z"), amountMinor: 349900 },
  ]
  const tz = "Asia/Kolkata"
  const byDay = attributeMinorByDay(rows, tz)
  const keys = rangeKeysEndingAt("2026-09-18", 30)
  const total = sumByDay(byDay, keys)
  assert.equal(total, 3431000) // = ₹34,310 (what the summary card shows)
  assert.equal(byDay.get("2026-09-18"), 1501800) // = ₹15,018, NOT ₹15,01,800

  const trend = buildTrendSeries(byDay, keys)
  const trendSum = trend.reduce((acc, p) => acc + p.value, 0)
  assert.equal(trendSum, total) // every trend bucket has the same rows as the KPI
  assert.equal(trend.length, 30) // daily granularity for a 30-day range
  // The last point (18 Sep) carries today's revenue.
  assert.equal(trend[29].key, "2026-09-18")
  assert.equal(trend[29].value, 1501800)
})

test("weekly bucketing for 90-day ranges sums to the same total", () => {
  const keys = rangeKeysEndingAt("2026-09-18", 90)
  const byDay = new Map<string, number>()
  keys.forEach((k, i) => {
    if (i % 5 === 0) byDay.set(k, 1000) // sparse data, one value every 5 days
  })
  const trend = buildTrendSeries(byDay, keys)
  assert.ok(trend.length < keys.length)
  const total = sumByDay(byDay, keys)
  const trendSum = trend.reduce((acc, p) => acc + p.value, 0)
  assert.equal(trendSum, total)
  for (const p of trend) assert.ok(p.value >= 0)
})

test("monthly bucketing for year-long ranges sums to the same total", () => {
  const keys = rangeKeysEndingAt("2026-09-18", 365)
  const byDay = new Map<string, number>()
  keys.forEach((k, i) => {
    if (i % 11 === 0) byDay.set(k, 500) // sparse
  })
  const trend = buildTrendSeries(byDay, keys)
  assert.ok(trend.length >= 12 && trend.length <= 13)
  assert.equal(trend.length, 13) // Sep 2025 … Sep 2026 windows that intersect the range
  const total = sumByDay(byDay, keys)
  const trendSum = trend.reduce((acc, p) => acc + p.value, 0)
  assert.equal(trendSum, total)
  assert.equal(trend[0].label.slice(-4), "2025")
  assert.equal(trend[trend.length - 1].label, "Sep 2026")
})

test("monthly bucketing handles February (28/29 days) without leaking value", () => {
  const keys = rangeKeysEndingAt("2024-03-01", 366) // leap-year span
  const byDay = new Map<string, number>([["2024-02-29", 777]])
  const trend = buildTrendSeries(byDay, keys)
  const total = sumByDay(byDay, keys)
  const trendSum = trend.reduce((acc, p) => acc + p.value, 0)
  assert.equal(trendSum, total)
  assert.equal(trendSum, 777)
})

test("empty key list produces an empty trend", () => {
  assert.deepEqual(buildTrendSeries(new Map(), []), [])
  assert.deepEqual(buildTrendSeries(new Map(), []), [])
})

// ---------------------------------------------------------------------------
// Query envelope
// ---------------------------------------------------------------------------

test("revenueEnvelope is a strict superset of the org-timezone day range", () => {
  const keys = rangeKeysEndingAt("2026-09-18", 30) // first 2026-08-20, last 2026-09-18
  const { gte, lte } = revenueEnvelope(keys)
  // First IST day of the range starts at 2026-08-19T18:30Z
  assert.ok(gte.getTime() <= new Date("2026-08-19T18:30:00.000Z").getTime())
  // Last IST day ends at 2026-09-18T18:30Z
  assert.ok(lte.getTime() >= new Date("2026-09-18T18:30:00.000Z").getTime())
  // And the envelope is not enormous (one day of padding on each side maximum).
  assert.ok(lte.getTime() - new Date("2026-09-18T18:30:00.000Z").getTime() < 2 * 24 * 3600 * 1000)
})

test("future-dated payments in the envelope are excluded by key filtering", () => {
  const keys = rangeKeysEndingAt("2026-09-18", 30)
  const byDay = new Map<string, number>([
    ["2026-09-19", 999999], // tomorrow's business day — outside the range keys
  ])
  // sumByDay ignores it; buildTrendSeries over `keys` never shows it either.
  assert.equal(sumByDay(byDay, keys), 0)
  const trend = buildTrendSeries(byDay, keys)
  assert.equal(trend.reduce((a, p) => a + p.value, 0), 0)
})

test("zero-revenue day renders a 0 bucket, not an exception", () => {
  const keys = rangeKeysEndingAt("2026-09-18", 5)
  const byDay = new Map<string, number>()
  const trend = buildTrendSeries(byDay, keys)
  assert.equal(trend.length, 5)
  assert.ok(trend.every((p) => p.value === 0))
})