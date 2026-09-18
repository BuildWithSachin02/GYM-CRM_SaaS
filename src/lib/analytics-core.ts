/**
 * Pure analytics math (no DB access). Everything that turns raw records into
 * day buckets / trend series lives here so it is deterministic and unit
 * testable. The prisma-backed analytics layer (src/lib/analytics.ts) is the
 * only importer that turns these pure helpers into production queries.
 */

import { dayKeyInTimeZone } from "@/lib/memberships"

// ---------------------------------------------------------------------------
// Day-key math. Day keys are YYYY-MM-DD strings that represent a calendar day
// in the ORGANIZATION timezone. Using string/UTC math here (not
// `new Date("YYYY-MM-DD")`) keeps date arithmetic DST- and shift-safe.
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0")

export function addDaysToKey(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`
}

/** The `days` calendar-day keys ending at `todayKey` (inclusive), oldest first. */
export function rangeKeysEndingAt(todayKey: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDaysToKey(todayKey, i - (days - 1)))
}

/**
 * Attribute records to org-timezone calendar days. This is the ONE place a
 * timestamp becomes a business day for revenue/attendance analytics, so every
 * card and chart derives from the same definition of "which day a payment
 * belongs to".
 */
export function attributeMinorByDay(
  rows: { paymentDate: Date; amountMinor: number }[],
  timeZone: string
): Map<string, number> {
  const byDay = new Map<string, number>()
  for (const r of rows) {
    const key = dayKeyInTimeZone(r.paymentDate, timeZone)
    byDay.set(key, (byDay.get(key) ?? 0) + r.amountMinor)
  }
  return byDay
}

export function sumByDay(byDay: Map<string, number>, keys: string[]): number {
  let total = 0
  for (const k of keys) total += byDay.get(k) ?? 0
  return total
}

// ---------------------------------------------------------------------------
// Dynamic trend bucketing.
//
// Bucket width grows with the range so the chart stays readable, and buckets
// are anchored to the range start (the last bucket may be partial), which
// keeps `sum of all buckets == total` exact for every range length.
// ---------------------------------------------------------------------------

export type TrendGranularity = "day" | "week" | "month"

export function pickGranularity(days: number): TrendGranularity {
  if (days <= 60) return "day"
  if (days <= 240) return "week"
  return "month"
}

export type TrendPoint = {
  key: string
  label: string
  value: number
}

export type RevenueMetric<T extends string = string> = {
  key: T
  amountMinor: number
  count: number
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function shortLabelOfKey(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number)
  return `${d} ${MONTH_LABELS[m - 1]}`
}

export function buildTrendSeries(
  byDay: Map<string, number>,
  keys: string[]
): TrendPoint[] {
  if (keys.length === 0) return []
  const granularity = pickGranularity(keys.length)
  const endKey = keys[keys.length - 1]
  const points: TrendPoint[] = []

  if (granularity === "day") {
    return keys.map((k) => ({ key: k, label: shortLabelOfKey(k), value: byDay.get(k) ?? 0 }))
  }

  if (granularity === "week") {
    let cursor = keys[0]
    while (cursor <= endKey) {
      const bucketKeys: string[] = []
      for (let i = 0; i < 7; i++) {
        const k = addDaysToKey(cursor, i)
        if (k > endKey) break
        bucketKeys.push(k)
      }
      const sum = bucketKeys.reduce((acc, k) => acc + (byDay.get(k) ?? 0), 0)
      points.push({ key: cursor, label: shortLabelOfKey(cursor), value: sum })
      cursor = addDaysToKey(cursor, bucketKeys.length)
    }
    return points
  }

  let cursor = `${keys[0].slice(0, 7)}-01`
  while (cursor.slice(0, 7) <= endKey.slice(0, 7)) {
    const [y, m] = cursor.slice(0, 7).split("-").map(Number)
    const monthLen = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const monthEnd = addDaysToKey(cursor, monthLen - 1)
    const monthDays = rangeKeysEndingAt(monthEnd, monthLen)
    const sum = monthDays
      .filter((k) => k >= keys[0] && k <= endKey)
      .reduce((acc, k) => acc + (byDay.get(k) ?? 0), 0)
    points.push({ key: cursor.slice(0, 7), label: `${MONTH_LABELS[m - 1]} ${y}`, value: sum })
    cursor = addDaysToKey(cursor, monthLen)
  }
  return points
}

// ---------------------------------------------------------------------------
// Query envelope. Fetching a superset (widened ~1 day on each side to absorb
// timezone offsets) and then attributing/filtering to the exact org-timezone
// day keys keeps the SQL simple AND guarantees the returned rows are exactly
// what a correct org-timezone range would include.
// ---------------------------------------------------------------------------

export function revenueEnvelope(keys: string[]): { gte: Date; lte: Date } {
  if (keys.length === 0) {
    const now = new Date()
    return { gte: now, lte: now }
  }
  const [y0, m0, d0] = keys[0].split("-").map(Number)
  const [y1, m1, d1] = keys[keys.length - 1].split("-").map(Number)
  return {
    gte: new Date(Date.UTC(y0, m0 - 1, d0 - 1)),
    lte: new Date(Date.UTC(y1, m1 - 1, d1 + 2)),
  }
}