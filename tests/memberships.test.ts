import { test } from "node:test"
import assert from "node:assert/strict"

import {
  addDurationDays,
  addDaysToKey,
  canRenewLifecycle,
  dayAfterYmd,
  dayKeyInTimeZone,
  dayPeriodsOverlap,
  daysBetweenKeys,
  earliestRenewalStartKey,
  getMemberCoverage,
  getMembershipLifecycle,
  membershipCoverageStatus,
  membershipPeriodFromStart,
  mergeMembershipPeriods,
  nextValidRenewalStartKey,
  pickPrimaryMembership,
  periodsOverlap,
  RENEWAL_AFTER_EXPIRY_DAYS,
  RENEWAL_WARNING_DAYS,
  utcInstantForKey,
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

test("dayPeriodsOverlap rejects overlapping starts inside existing coverage and accepts after-coverage starts", () => {
  // Candidate 2026-10-15 (30d) overlaps record B ending 2026-10-18.
  assert.equal(
    dayPeriodsOverlap(
      "2026-10-15",
      addDaysToKey("2026-10-15", 30),
      "2026-09-18",
      "2026-10-18"
    ),
    true
  )
  // Candidate 2027-01-18 (30d) sits after ALL of the member's coverage
  // (which ends 2027-01-17).
  assert.equal(
    dayPeriodsOverlap(
      "2027-01-18",
      addDaysToKey("2027-01-18", 30),
      "2026-01-12",
      "2027-01-17"
    ),
    false
  )
})

// ---------------------------------------------------------------------------
// Day-key helpers
// ---------------------------------------------------------------------------
test("addDaysToKey shifts calendar day keys", () => {
  assert.equal(addDaysToKey("2026-09-30", 1), "2026-10-01")
  assert.equal(addDaysToKey("2026-12-31", 1), "2027-01-01")
  assert.equal(addDaysToKey("2026-09-18", 30), "2026-10-18")
  assert.equal(addDaysToKey("not-a-date", 1), "")
  assert.equal(addDaysToKey(null, 1), "")
})

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

test("utcInstantForKey resolves local midnight for Asia/Kolkata", () => {
  const instant = utcInstantForKey("2026-09-18", "Asia/Kolkata")
  assert.equal(instant.toISOString(), "2026-09-17T18:30:00.000Z")
  assert.equal(dayKeyInTimeZone(instant, "Asia/Kolkata"), "2026-09-18")
})

test("utcInstantForKey resolves local midnight in a negative-offset (DST) zone", () => {
  const instant = utcInstantForKey("2026-09-18", "America/New_York")
  assert.equal(instant.toISOString(), "2026-09-18T04:00:00.000Z")
  assert.equal(dayKeyInTimeZone(instant, "America/New_York"), "2026-09-18")
})

test("membershipPeriodFromStart persists periods at org-timezone local midnight", () => {
  const { start, end } = membershipPeriodFromStart(
    new Date("2026-09-18T00:00:00Z"),
    30,
    "Asia/Kolkata"
  )
  assert.equal(start.toISOString(), "2026-09-17T18:30:00.000Z")
  assert.equal(end.toISOString(), "2026-10-17T18:30:00.000Z")
  assert.equal(dayKeyInTimeZone(start, "Asia/Kolkata"), "2026-09-18")
  assert.equal(dayKeyInTimeZone(end, "Asia/Kolkata"), "2026-10-18")
})

// ---------------------------------------------------------------------------
// Renewal constants and single-record rules
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
// Member-level coverage (the core of the fix)
// ---------------------------------------------------------------------------
type Row = {
  id: string
  memberId: string
  startDate: Date
  endDate: Date
  status: "ACTIVE" | "EXPIRED" | "CANCELLED" | "PAUSED"
}

function row(
  id: string,
  start: string,
  end: string,
  status: Row["status"]
): Row {
  return {
    id,
    memberId: "m1",
    startDate: new Date(`${start}T00:00:00Z`),
    endDate: new Date(`${end}T00:00:00Z`),
    status,
  }
}

/**
 * A continuously covered member (King's Gym, Asia/Kolkata): a monthly that
 * ended today plus two more ACTIVE records chaining back-to-back through
 * 17 Jan 2027. The exact member name/dates are irrelevant — this is the
 * generic "current record ends today but the chain continues" timeline.
 */
function continuousCoverageRows(): Row[] {
  return [
    row("A", "2026-01-12", "2026-09-17", "EXPIRED"),
    row("B", "2026-09-18", "2026-10-18", "ACTIVE"),
    row("C", "2026-10-19", "2027-01-17", "ACTIVE"),
  ]
}

test("back-to-back coverage: member with a chain keeps ACTIVE (not expiring soon) and renews after the chain", () => {
  const rows = continuousCoverageRows()
  const picked = pickPrimaryMembership(
    rows,
    "Asia/Kolkata",
    new Date("2026-09-17T00:00:00Z")
  )
  assert.ok(picked)
  // Coverage merges all three records into one continuous period.
  assert.equal(picked!.coverage.intervals.length, 1)
  assert.equal(picked!.coverage.overallEndKey, "2027-01-17")
  assert.equal(picked!.coverage.coveredToday, true)
  // The member is ACTIVE through the FARTHEST end — never "expiring soon".
  assert.equal(picked!.lifecycle.status, "ACTIVE")
  assert.equal(picked!.lifecycle.daysLeft, 122)
  // The display row is the record containing today (the expired-in-DB one).
  assert.equal(picked!.row.id, "A")

  // Renewal may start only after ALL of the member's coverage ends.
  assert.equal(
    nextValidRenewalStartKey(rows, "Asia/Kolkata", "2026-09-17"),
    "2027-01-18"
  )
  // The record-level state of A (ends today) is still renew-eligible, so the
  // Renew button stays available.
  const a = getMembershipLifecycle({
    startDate: rows[0].startDate,
    endDate: rows[0].endDate,
    status: rows[0].status,
    timeZone: "Asia/Kolkata",
    today: new Date("2026-09-17T00:00:00Z"),
  })
  assert.equal(a.status, "EXPIRING_SOON")
  assert.equal(canRenewLifecycle(a.status), true)
})

test("renewal suggestion opens the modal clean: default start never overlaps coverage", () => {
  const rows = continuousCoverageRows()
  const start = nextValidRenewalStartKey(rows, "Asia/Kolkata", "2026-09-17")
  assert.equal(start, "2027-01-18")
  // Suggested start is never in the past nor earlier than the suggestion itself.
  assert.ok(start >= "2026-09-17")
  // And the period it produces does not overlap the member's current coverage.
  assert.equal(
    dayPeriodsOverlap(start, addDaysToKey(start, 365), "2026-01-12", "2027-01-17"),
    false
  )
})

test("renewal acceptance: a start on/after the suggestion passes the server gate", () => {
  const rows = continuousCoverageRows()
  const todayKey = "2026-09-17"
  const start = nextValidRenewalStartKey(rows, "Asia/Kolkata", todayKey)
  // Server gates: not in the past, and >= the suggested start.
  assert.ok(start >= todayKey)
  assert.ok(start >= start)
  // A full-year period after coverage is back-to-back (no gap, no overlap).
  assert.equal(
    dayPeriodsOverlap(start, addDaysToKey(start, 365), "2026-01-12", "2027-01-17"),
    false
  )
})

test("Member A: ends today, future starts tomorrow — NOT expiring soon, renew after the far end", () => {
  const rows = [
    row("current", "2026-06-01", "2026-09-17", "ACTIVE"),
    row("future", "2026-09-18", "2026-10-17", "ACTIVE"), // back-to-back
  ]
  const picked = pickPrimaryMembership(
    rows,
    "UTC",
    new Date("2026-09-17T00:00:00Z")
  )
  assert.ok(picked)
  assert.equal(picked!.lifecycle.status, "ACTIVE")
  assert.equal(picked!.lifecycle.daysLeft, 30)
  // The continuous chain merges into one interval; renewal can never start
  // inside it — the proposal is the day after the FARTHEST end.
  assert.equal(picked!.coverage.intervals.length, 1)
  assert.equal(nextValidRenewalStartKey(rows, "UTC", "2026-09-17"), "2026-10-18")
})

test("Member D: expired yesterday + future starts tomorrow — UPCOMING and renewal never overlaps the future record", () => {
  const rows = [
    row("expired", "2026-06-01", "2026-09-16", "EXPIRED"),
    row("future", "2026-09-18", "2026-10-17", "ACTIVE"), // 2026-09-17 is a 1-day gap
  ]
  const picked = pickPrimaryMembership(
    rows,
    "UTC",
    new Date("2026-09-17T00:00:00Z")
  )
  assert.ok(picked)
  // The old expired record is NOT the effective state — the member is UPCOMING.
  assert.equal(picked!.lifecycle.status, "UPCOMING")
  assert.equal(picked!.lifecycle.daysUntilStart, 1)
  assert.equal(picked!.coverage.intervals.length, 2)
  // Proposal must be after ALL coverage, never inside the gap-to-future.
  assert.equal(nextValidRenewalStartKey(rows, "UTC", "2026-09-17"), "2026-10-18")
  // A year-long renewal from the proposal never overlaps either record.
  assert.equal(
    dayPeriodsOverlap("2026-10-18", addDaysToKey("2026-10-18", 365), "2026-06-01", "2026-09-16"),
    false
  )
  assert.equal(
    dayPeriodsOverlap("2026-10-18", addDaysToKey("2026-10-18", 365), "2026-09-18", "2026-10-17"),
    false
  )
})

test("Member E: ends today with a 5-day gap before future coverage — periods stay separate and renewal jumps past both", () => {
  const rows = [
    row("now", "2026-08-01", "2026-09-17", "ACTIVE"),
    row("later", "2026-09-22", "2026-10-21", "ACTIVE"), // 4 uncovered days
  ]
  const picked = pickPrimaryMembership(
    rows,
    "UTC",
    new Date("2026-09-17T00:00:00Z")
  )
  assert.ok(picked)
  // The gap is real: two intervals, so this member IS expiring (0 days left now).
  assert.equal(picked!.coverage.intervals.length, 2)
  assert.equal(picked!.lifecycle.status, "EXPIRING_SOON")
  assert.equal(picked!.lifecycle.daysLeft, 0)
  // Renewal start must be the day after the FARTHEST coverage, not "tomorrow",
  // so a 30-day renewal can never collide with the purchased future record.
  assert.equal(nextValidRenewalStartKey(rows, "UTC", "2026-09-17"), "2026-10-22")
  assert.equal(
    dayPeriodsOverlap("2026-10-22", addDaysToKey("2026-10-22", 30), "2026-09-22", "2026-10-21"),
    false
  )
})

test("mergeMembershipPeriods merges overlapping and back-to-back periods only (gaps stay separate)", () => {
  const merged = mergeMembershipPeriods([
    { startKey: "2026-01-01", endKey: "2026-01-10" },
    { startKey: "2026-01-05", endKey: "2026-01-20" }, // overlaps the first
    { startKey: "2026-01-21", endKey: "2026-01-31" }, // back-to-back with second
    { startKey: "2026-02-02", endKey: "2026-02-10" }, // 1-day gap: not merged
  ])
  assert.deepEqual(merged, [
    { startKey: "2026-01-01", endKey: "2026-01-31" },
    { startKey: "2026-02-02", endKey: "2026-02-10" },
  ])
})

test("gap detection: a 1+ day gap is not merged and leaves the member uncovered", () => {
  const rows = [
    row("early", "2026-01-01", "2026-09-30", "EXPIRED"),
    row("late", "2026-10-02", "2026-10-31", "ACTIVE"), // 2026-10-01 is a hole
  ]
  const coverage = getMemberCoverage(rows, "UTC", "2026-09-15")
  assert.equal(coverage.intervals.length, 2)
  assert.equal(coverage.intervals[0].endKey, "2026-09-30")
  assert.equal(coverage.intervals[1].startKey, "2026-10-02")
  // On the hole day the member is not covered; the next interval is upcoming.
  const inTheHole = membershipCoverageStatus(
    getMemberCoverage(rows, "UTC", "2026-10-01")
  )
  assert.equal(inTheHole.status, "UPCOMING")
  assert.equal(inTheHole.daysUntilStart, 1)
})

test("cancelled future memberships never extend coverage or block the suggestion", () => {
  const rows = [
    row("active", "2026-01-01", "2026-12-31", "ACTIVE"),
    row("cancelled-future", "2027-06-01", "2027-12-31", "CANCELLED"),
  ]
  const picked = pickPrimaryMembership(
    rows,
    "UTC",
    new Date("2026-09-17T00:00:00Z")
  )
  assert.ok(picked)
  assert.equal(picked!.coverage.overallEndKey, "2026-12-31")
  assert.equal(picked!.lifecycle.status, "ACTIVE")
  // Renewal must start the day after the VALID coverage ends.
  assert.equal(
    nextValidRenewalStartKey(rows, "UTC", "2026-09-17"),
    "2027-01-01"
  )
})

test("multi-future coverage chain: upcoming coverage extends across every future record", () => {
  const rows = [
    row("f1", "2026-10-01", "2026-10-30", "ACTIVE"),
    row("f2", "2026-10-31", "2026-11-29", "ACTIVE"),
    row("f3", "2026-11-30", "2027-01-28", "ACTIVE"),
  ]
  const picked = pickPrimaryMembership(
    rows,
    "UTC",
    new Date("2026-09-17T00:00:00Z")
  )
  assert.ok(picked)
  assert.equal(picked!.lifecycle.status, "UPCOMING")
  assert.equal(picked!.coverage.intervals.length, 1)
  assert.equal(picked!.coverage.overallEndKey, "2027-01-28")
  assert.equal(picked!.lifecycle.daysUntilStart, daysBetweenKeys("2026-09-17", "2026-10-01"))
})

test("upcoming member: all records in the future show UPCOMING until coverage begins", () => {
  const rows = [row("future", "2026-11-01", "2027-01-30", "ACTIVE")]
  const picked = pickPrimaryMembership(
    rows,
    "UTC",
    new Date("2026-09-17T00:00:00Z")
  )
  assert.ok(picked)
  assert.equal(picked!.lifecycle.status, "UPCOMING")
  assert.equal(picked!.lifecycle.daysUntilStart, 45)
  assert.equal(picked!.lifecycle.daysLeft, null)
})

test("expired member: all coverage in the past shows EXPIRED and can renew from today", () => {
  const rows = [row("old", "2025-01-01", "2025-03-31", "EXPIRED")]
  const today = new Date("2026-09-17T00:00:00Z")
  const picked = pickPrimaryMembership(rows, "UTC", today)
  assert.ok(picked)
  assert.equal(picked!.lifecycle.status, "EXPIRED")
  assert.equal(picked!.coverage.coveredToday, false)
  assert.equal(picked!.coverage.upcomingInterval, null)
  assert.equal(nextValidRenewalStartKey(rows, "UTC", "2026-09-17"), "2026-09-17")
  const rec = getMembershipLifecycle({
    startDate: rows[0].startDate,
    endDate: rows[0].endDate,
    status: rows[0].status,
    timeZone: "UTC",
    today,
  })
  assert.equal(rec.status, "EXPIRED")
  assert.equal(canRenewLifecycle(rec.status), true)
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

test("pickPrimaryMembership keeps CANCELLED memberships visible when no valid coverage exists", () => {
  const rows: Row[] = [
    row("cancelled-only", "2026-01-01", "2026-12-31", "CANCELLED"),
  ]
  const picked = pickPrimaryMembership(
    rows as Parameters<typeof pickPrimaryMembership>[0],
    "UTC",
    new Date("2026-09-17T00:00:00Z")
  )
  assert.ok(picked)
  assert.equal(picked!.row.id, "cancelled-only")
  assert.equal(picked!.lifecycle.status, "CANCELLED")
  assert.equal(picked!.coverage.intervals.length, 0)
})

test("pickPrimaryMembership returns null for an empty history", () => {
  assert.equal(pickPrimaryMembership([], "UTC"), null)
})