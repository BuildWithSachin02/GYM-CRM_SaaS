import { test } from "node:test"
import assert from "node:assert/strict"

import {
  addDurationDays,
  dayAfterYmd,
  periodsOverlap,
} from "../src/lib/memberships"

function ymd(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d)
}

function toYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ---------------------------------------------------------------------------
// Date convention: end = start + durationDays calendar days, both inclusive.
// start 2026-10-01 + 30 days = end 2026-10-31 (matches the product spec).
// ---------------------------------------------------------------------------
test("addDurationDays keeps the existing end-date convention for a 30-day plan", () => {
  assert.equal(toYmd(addDurationDays(ymd(2026, 10, 1), 30)), "2026-10-31")
})

test("addDurationDays rolls across month boundaries without off-by-one", () => {
  assert.equal(toYmd(addDurationDays(ymd(2026, 8, 1), 30)), "2026-08-31")
  assert.equal(toYmd(addDurationDays(ymd(2026, 9, 1), 30)), "2026-10-01")
})

test("addDurationDays handles leap-year February and year boundaries", () => {
  assert.equal(toYmd(addDurationDays(ymd(2024, 1, 31), 30)), "2024-03-01")
  assert.equal(toYmd(addDurationDays(ymd(2026, 12, 1), 31)), "2027-01-01")
})

// ---------------------------------------------------------------------------
// Overlap rule: exclusive at the boundary — a renewal starting the day after
// the current end does NOT overlap.
// ---------------------------------------------------------------------------
test("periodsOverlap detects overlapping inclusive periods", () => {
  assert.equal(periodsOverlap(ymd(2026, 8, 1), ymd(2026, 8, 31), ymd(2026, 8, 15), ymd(2026, 9, 30)), true)
  assert.equal(periodsOverlap(ymd(2026, 8, 1), ymd(2026, 8, 31), ymd(2026, 7, 1), ymd(2026, 8, 15)), true)
  assert.equal(periodsOverlap(ymd(2026, 8, 1), ymd(2026, 8, 31), ymd(2026, 8, 1), ymd(2026, 8, 31)), true)
})

test("periodsOverlap rejects adjacent (contiguous) periods", () => {
  assert.equal(periodsOverlap(ymd(2026, 8, 1), ymd(2026, 8, 31), ymd(2026, 9, 1), ymd(2026, 9, 30)), false)
})

test("periodsOverlap rejects fully disjoint periods", () => {
  assert.equal(periodsOverlap(ymd(2026, 8, 1), ymd(2026, 8, 31), ymd(2026, 10, 1), ymd(2026, 10, 31)), false)
  assert.equal(periodsOverlap(ymd(2026, 10, 1), ymd(2026, 10, 31), ymd(2026, 8, 1), ymd(2026, 8, 31)), false)
})

// ---------------------------------------------------------------------------
// Renewal start suggestion: the day after the current membership ends.
// ---------------------------------------------------------------------------
test("dayAfterYmd returns the next calendar day", () => {
  assert.equal(dayAfterYmd("2026-09-30"), "2026-10-01")
  assert.equal(dayAfterYmd("2026-12-31"), "2027-01-01")
})

test("dayAfterYmd accepts an ISO timestamp and ignores the time part", () => {
  assert.equal(dayAfterYmd("2026-08-31T00:00:00.000Z"), "2026-09-01")
})

test("dayAfterYmd returns an empty string for invalid input", () => {
  assert.equal(dayAfterYmd(""), "")
  assert.equal(dayAfterYmd("not-a-date"), "")
  assert.equal(dayAfterYmd(null), "")
  assert.equal(dayAfterYmd(undefined), "")
})