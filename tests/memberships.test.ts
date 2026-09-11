import { test } from "node:test"
import assert from "node:assert/strict"

import {
  addDurationDays,
  canRenewLifecycle,
  dayAfterYmd,
  dayKeyInTimeZone,
  daysBetweenKeys,
  earliestRenewalStartKey,
  getMembershipLifecycle,
  pickPrimaryMembership,
  periodsOverlap,
  RENEWAL_AFTER_EXPIRY_DAYS,
  RENEWAL_WARNING_DAYS,
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

// ---------------------------------------------------------------------------
// Renewal business rules
// ---------------------------------------------------------------------------
test("renewal constants match the product spec", () => {
  assert.equal(RENEWAL_WARNING_DAYS, 7)
  assert.equal(RENEWAL_AFTER_EXPIRY_DAYS, 0)
})

test("canRenewLifecycle allows expired and warning-window memberships only", () => {
  assert.equal(canRenewLifecycle("EXPIRED"), true)
  assert.equal(canRenewLifecycle("EXPIRING_SOON"), true)
  assert.equal(canRenewLifecycle("ACTIVE"), false)
  assert.equal(canRenewLifecycle("UPCOMING"), false)
  assert.equal(canRenewLifecycle("CANCELLED"), false)
  assert.equal(canRenewLifecycle("PAUSED"), false)
})

test("earliestRenewalStartKey: expired memberships renew from today (no grace)", () => {
  assert.equal(
    earliestRenewalStartKey("EXPIRED", "2026-09-30", "2026-10-15"),
    "2026-10-15"
  )
})

test("earliestRenewalStartKey: warning-window memberships renew after the end (no overlap)", () => {
  assert.equal(
    earliestRenewalStartKey("EXPIRING_SOON", "2026-09-30", "2026-09-25"),
    "2026-10-01"
  )
})

// ---------------------------------------------------------------------------
// Timezone-safe day keys
// ---------------------------------------------------------------------------
test("dayKeyInTimeZone folds an instant into the org calendar day", () => {
  assert.equal(dayKeyInTimeZone(new Date("2026-01-01T18:30:00Z"), "Asia/Kolkata"), "2026-01-02")
  assert.equal(dayKeyInTimeZone(new Date("2026-01-01T12:00:00Z"), "Asia/Kolkata"), "2026-01-01")
  assert.equal(dayKeyInTimeZone(new Date("2026-01-01T18:29:59Z"), "Asia/Kolkata"), "2026-01-01")
  assert.equal(dayKeyInTimeZone(new Date("2026-06-15T23:00:00Z"), "UTC"), "2026-06-15")
})

test("daysBetweenKeys counts inclusive window days across boundaries", () => {
  assert.equal(daysBetweenKeys("2026-01-01", "2026-01-31"), 30)
  assert.equal(daysBetweenKeys("2026-02-28", "2026-03-01"), 1)
  assert.equal(daysBetweenKeys("2024-02-28", "2024-03-01"), 2)
  assert.equal(daysBetweenKeys("2026-12-30", "2027-01-02"), 3)
  assert.equal(daysBetweenKeys("2026-01-15", "2026-01-15"), 0)
})

// ---------------------------------------------------------------------------
// Derived lifecycle
// ---------------------------------------------------------------------------
function lifecycleAt(
  status: string,
  start: string,
  end: string,
  today: string,
  timeZone = "UTC"
) {
  return getMembershipLifecycle({
    startDate: new Date(`${start}T00:00:00Z`),
    endDate: new Date(`${end}T00:00:00Z`),
    status,
    today: new Date(`${today}T00:00:00Z`),
    timeZone,
  })
}

test("getMembershipLifecycle marks a mid-period membership ACTIVE", () => {
  const l = lifecycleAt("ACTIVE", "2026-01-01", "2026-01-31", "2026-01-15")
  assert.equal(l.status, "ACTIVE")
  assert.equal(l.daysLeft, 16)
  assert.equal(l.daysUntilStart, null)
})

test("getMembershipLifecycle enters the warning window within 7 days of the end", () => {
  assert.equal(lifecycleAt("ACTIVE", "2026-01-01", "2026-01-22", "2026-01-15").status, "EXPIRING_SOON")
  assert.equal(lifecycleAt("ACTIVE", "2026-01-01", "2026-01-23", "2026-01-15").status, "ACTIVE")
})

test("getMembershipLifecycle treats the final day as EXPIRING_SOON (not expired)", () => {
  const l = lifecycleAt("ACTIVE", "2026-01-01", "2026-01-15", "2026-01-15")
  assert.equal(l.status, "EXPIRING_SOON")
  assert.equal(l.daysLeft, 0)
})

test("getMembershipLifecycle expires the day after the period ends, even for stale DB rows", () => {
  const l = lifecycleAt("ACTIVE", "2026-01-01", "2026-01-15", "2026-01-16")
  assert.equal(l.status, "EXPIRED")
  assert.equal(l.daysLeft, 0)
})

test("getMembershipLifecycle flags a future-start membership UPCOMING", () => {
  const l = lifecycleAt("ACTIVE", "2026-01-20", "2026-02-18", "2026-01-15")
  assert.equal(l.status, "UPCOMING")
  assert.equal(l.daysUntilStart, 5)
  assert.equal(l.daysLeft, null)
})

test("getMembershipLifecycle honors CANCELLED/PAUSED precedence", () => {
  const cancelled = lifecycleAt("CANCELLED", "2026-01-01", "2026-06-30", "2026-01-15")
  assert.equal(cancelled.status, "CANCELLED")
  assert.equal(cancelled.daysLeft, null)

  const paused = lifecycleAt("PAUSED", "2026-01-01", "2026-06-30", "2026-01-15")
  assert.equal(paused.status, "PAUSED")
  assert.equal(paused.daysLeft, 166)

  const pausedAfterEnd = lifecycleAt("PAUSED", "2026-01-01", "2026-01-15", "2026-01-16")
  assert.equal(pausedAfterEnd.status, "PAUSED")
  assert.equal(pausedAfterEnd.daysLeft, 0)
})

// ---------------------------------------------------------------------------
// One current membership per member
// ---------------------------------------------------------------------------
type Row = {
  id: string
  memberId: string
  startDate: Date
  endDate: Date
  status: string
}

function row(id: string, start: string, end: string, status: "ACTIVE" | "EXPIRED"): Row {
  return { id, memberId: "m1", startDate: new Date(`${start}T00:00:00Z`), endDate: new Date(`${end}T00:00:00Z`), status }
}

test("pickPrimaryMembership prefers the active period over older history", () => {
  const rows: Row[] = [
    row("history", "2025-10-01", "2025-10-31", "EXPIRED"),
    row("current", "2025-12-01", "2026-01-31", "ACTIVE"),
  ]
  const picked = pickPrimaryMembership(
    rows as Parameters<typeof pickPrimaryMembership>[0],
    "UTC",
    new Date("2026-01-15T00:00:00Z")
  )
  assert.ok(picked)
  assert.equal(picked!.row.id, "current")
  assert.equal(picked!.lifecycle.status, "ACTIVE")
})

test("pickPrimaryMembership falls back to the latest record when nothing is current", () => {
  const rows: Row[] = [
    row("older", "2024-01-01", "2024-01-31", "EXPIRED"),
    row("newer", "2024-03-01", "2024-03-31", "EXPIRED"),
  ]
  const picked = pickPrimaryMembership(
    rows as Parameters<typeof pickPrimaryMembership>[0],
    "UTC",
    new Date("2026-01-15T00:00:00Z")
  )
  assert.ok(picked)
  assert.equal(picked!.row.id, "newer")
  assert.equal(picked!.lifecycle.status, "EXPIRED")
})

test("pickPrimaryMembership picks the expiring-soon record within its loop", () => {
  const rows: Row[] = [
    row("history", "2025-09-01", "2025-09-30", "EXPIRED"),
    row("current", "2025-11-15", "2026-01-21", "ACTIVE"),
  ]
  const picked = pickPrimaryMembership(
    rows as Parameters<typeof pickPrimaryMembership>[0],
    "UTC",
    new Date("2026-01-15T00:00:00Z")
  )
  assert.ok(picked)
  assert.equal(picked!.row.id, "current")
  assert.equal(picked!.lifecycle.status, "EXPIRING_SOON")
  assert.equal(picked!.lifecycle.daysLeft, 6)
})

test("pickPrimaryMembership returns null for an empty history", () => {
  assert.equal(pickPrimaryMembership([], "UTC"), null)
})