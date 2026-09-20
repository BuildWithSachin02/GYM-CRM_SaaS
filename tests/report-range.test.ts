import { test } from "node:test"
import assert from "node:assert/strict"

import {
  addDaysToKey,
  buildTrendSeries,
  isDayKey,
  rangeKeysBetween,
  rangeKeysEndingAt,
  resolveReportRange,
  sumByDay,
} from "../src/lib/analytics-core"
import { formatRangeLabel } from "../src/lib/format"

// ---------------------------------------------------------------------------
// isDayKey — the gate that decides whether ?from=/?to= are safe to use
// ---------------------------------------------------------------------------

test("isDayKey accepts well-formed real calendar days", () => {
  assert.equal(isDayKey("2026-09-20"), true)
  assert.equal(isDayKey("2026-01-01"), true)
  assert.equal(isDayKey("2024-02-29"), true) // leap year
  assert.equal(isDayKey("2000-01-31"), true)
})

test("isDayKey rejects malformed or impossible dates", () => {
  assert.equal(isDayKey(""), false)
  assert.equal(isDayKey("2026-9-20"), false)
  assert.equal(isDayKey("20-09-2026"), false)
  assert.equal(isDayKey("2026-13-01"), false)
  assert.equal(isDayKey("2026-00-10"), false)
  assert.equal(isDayKey("2026-02-30"), false)
  assert.equal(isDayKey("2023-02-29"), false) // not a leap year
  assert.equal(isDayKey("abcd-ef-gh"), false)
  assert.equal(isDayKey("2026-09-20T00:00:00"), false)
  assert.equal(isDayKey(null), false)
  assert.equal(isDayKey(undefined), false)
})

// ---------------------------------------------------------------------------
// rangeKeysBetween — the custom-range key span
// ---------------------------------------------------------------------------

test("rangeKeysBetween is inclusive on both ends, oldest first", () => {
  const keys = rangeKeysBetween("2026-09-01", "2026-09-20")
  assert.equal(keys.length, 20)
  assert.equal(keys[0], "2026-09-01")
  assert.equal(keys[19], "2026-09-20")
  // every calendar day is present and contiguous
  assert.deepEqual(keys, Array.from({ length: 20 }, (_, i) => addDaysToKey("2026-09-01", i)))
})

test("rangeKeysBetween handles single-day and reversed ranges", () => {
  assert.deepEqual(rangeKeysBetween("2026-09-20", "2026-09-20"), ["2026-09-20"])
  assert.deepEqual(rangeKeysBetween("2026-09-21", "2026-09-20"), [])
  assert.deepEqual(rangeKeysBetween("2026-03-01", "2026-02-28"), [])
})

test("rangeKeysBetween over a preset equals rangeKeysEndingAt (parity)", () => {
  const today = "2026-09-20"
  assert.deepEqual(
    rangeKeysBetween(addDaysToKey(today, -(30 - 1)), today),
    rangeKeysEndingAt(today, 30)
  )
  assert.deepEqual(
    rangeKeysBetween(addDaysToKey(today, -(90 - 1)), today),
    rangeKeysEndingAt(today, 90)
  )
})

// ---------------------------------------------------------------------------
// resolveReportRange — URL params -> concrete inclusive day-key span
// ---------------------------------------------------------------------------

const todayKey = "2026-09-20"

test("valid ?from=+?to= resolves to a custom range", () => {
  assert.deepEqual(
    resolveReportRange({ range: "30", from: "2026-09-01", to: "2026-09-20", todayKey }),
    { range: "custom", fromKey: "2026-09-01", toKey: "2026-09-20" }
  )
})

test("single-day custom range is preserved", () => {
  assert.deepEqual(
    resolveReportRange({ range: "90", from: "2026-09-20", to: "2026-09-20", todayKey }),
    { range: "custom", fromKey: "2026-09-20", toKey: "2026-09-20" }
  )
})

test("from > to is rejected and falls back to the preset, never shipped", () => {
  assert.deepEqual(
    resolveReportRange({ range: "30", from: "2026-09-21", to: "2026-09-20", todayKey }),
    { range: "30", fromKey: "2026-08-22", toKey: "2026-09-20" }
  )
})

test("?range=90 resolves to the last 90 days including today", () => {
  assert.deepEqual(resolveReportRange({ range: "90", from: null, to: null, todayKey }), {
    range: "90",
    fromKey: "2026-06-23",
    toKey: "2026-09-20",
  })
  const r = resolveReportRange({ range: "90", from: null, to: null, todayKey })
  assert.equal(rangeKeysBetween(r.fromKey, r.toKey).length, 90)
})

test("empty params default to the last 30 days, not an error page", () => {
  assert.deepEqual(resolveReportRange({ range: undefined, from: undefined, to: undefined, todayKey }), {
    range: "30",
    fromKey: "2026-08-22",
    toKey: "2026-09-20",
  })
  assert.equal(rangeKeysBetween("2026-08-22", "2026-09-20").length, 30)
})

test("unknown range values and malformed dates fall back to 30", () => {
  assert.deepEqual(resolveReportRange({ range: "120", from: null, to: null, todayKey }).range, "30")
  assert.deepEqual(resolveReportRange({ range: "90", from: "junk", to: "2026-09-20", todayKey }).range, "90")
  assert.deepEqual(resolveReportRange({ range: "custom", from: "2026-09-01", to: "not-a-date", todayKey }).range, "30")
  assert.deepEqual(resolveReportRange({ range: "custom", from: "2026-09-01", to: null, todayKey }).range, "30")
  assert.deepEqual(resolveReportRange({ range: "custom", from: undefined, to: "2026-09-20", todayKey }).range, "30")
})

// ---------------------------------------------------------------------------
// Custom-range trend bucketing reconciles to the same total as the KPI
// ---------------------------------------------------------------------------

test("daily granularity for a 20-day custom range (01 Sep — 20 Sep 2026)", () => {
  const keys = rangeKeysBetween("2026-09-01", "2026-09-20")
  const byDay = new Map<string, number>([])
  byDay.set("2026-09-01", 129900) // first day included
  byDay.set("2026-09-20", 349900) // last day included
  byDay.set("2026-08-31", 999999) // day before the range: excluded
  byDay.set("2026-09-21", 999999) // day after the range: excluded
  const trend = buildTrendSeries(byDay, keys)
  const total = sumByDay(byDay, keys)
  assert.equal(total, 479800)
  assert.equal(trend.length, 20)
  const trendSum = trend.reduce((acc, p) => acc + p.value, 0)
  assert.equal(trendSum, total)
  assert.equal(trend[0].key, "2026-09-01")
  assert.equal(trend[19].key, "2026-09-20")
  assert.equal(trend[0].value, 129900)
  assert.equal(trend[19].value, 349900)
})

test("custom range not anchored to today/now still reconciles", () => {
  const keys = rangeKeysBetween("2026-08-10", "2026-08-20")
  const byDay = new Map<string, number>([
    ["2026-08-10", 500],
    ["2026-08-13", 700],
    ["2026-08-20", 900],
  ])
  const trend = buildTrendSeries(byDay, keys)
  const trendSum = trend.reduce((acc, p) => acc + p.value, 0)
  assert.equal(trendSum, sumByDay(byDay, keys))
  assert.equal(trend[trend.length - 1].key, "2026-08-20")
})

test("weekly granularity for a ~7-month custom range sums to the same total", () => {
  const keys = rangeKeysBetween("2026-03-01", "2026-09-20")
  assert.equal(keys.length, 204)
  const byDay = new Map<string, number>()
  keys.forEach((k, i) => {
    if (i % 5 === 0) byDay.set(k, 1000)
  })
  const trend = buildTrendSeries(byDay, keys)
  assert.ok(trend.length < keys.length) // weekly (or coarser) buckets
  const total = sumByDay(byDay, keys)
  const trendSum = trend.reduce((acc, p) => acc + p.value, 0)
  assert.equal(trendSum, total)
})

test("same-day custom range yields a single bucket", () => {
  const keys = rangeKeysBetween("2026-09-20", "2026-09-20")
  const byDay = new Map<string, number>([["2026-09-20", 502000]])
  const trend = buildTrendSeries(byDay, keys)
  assert.equal(trend.length, 1)
  assert.equal(trend[0].key, "2026-09-20")
  assert.equal(trend[0].value, 502000)
  assert.equal(sumByDay(byDay, keys), 502000)
})

// ---------------------------------------------------------------------------
// formatRangeLabel — compact "01 Sep — 20 Sep" range subtitle
// ---------------------------------------------------------------------------

test("formatRangeLabel omits the year within the same calendar year", () => {
  assert.equal(formatRangeLabel("2026-09-01", "2026-09-20"), "01 Sep — 20 Sep")
  assert.equal(formatRangeLabel("2026-01-01", "2026-12-31"), "01 Jan — 31 Dec")
})

test("formatRangeLabel shows the year when the range crosses a year boundary", () => {
  assert.equal(formatRangeLabel("2026-09-01", "2027-01-05"), "01 Sep 2026 — 05 Jan 2027")
  assert.equal(formatRangeLabel("2025-12-30", "2026-09-20"), "30 Dec 2025 — 20 Sep 2026")
})

test("formatRangeLabel handles a single-day range and bad input", () => {
  assert.equal(formatRangeLabel("2026-09-20", "2026-09-20"), "20 Sep — 20 Sep")
  assert.equal(formatRangeLabel(null, "2026-09-20"), "")
  assert.equal(formatRangeLabel(undefined, undefined), "")
  assert.equal(formatRangeLabel("not-a-key", "2026-09-20"), "")
  assert.equal(formatRangeLabel("2026-13-01", "2026-09-20"), "")
})