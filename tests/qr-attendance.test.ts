import { test } from "node:test"
import assert from "node:assert/strict"

import {
  dayKeyIsCovered,
  decideAttendanceApproval,
  decideQrScan,
} from "../src/lib/qr-attendance"
import type { MemberCoverage } from "../src/lib/memberships"

function coverage(coveredToday: boolean): MemberCoverage {
  return {
    todayKey: "2026-10-20",
    intervals: [],
    coveredToday,
    currentInterval: null,
    upcomingInterval: null,
    overallEndKey: null,
  }
}

// ---------------------------------------------------------------------------
// decideQrScan — the single decision both identification paths converge on
// ---------------------------------------------------------------------------

test("scan decision: inactive members never get a CheckIn or request", () => {
  for (const memberStatus of ["INACTIVE", "ARCHIVED", "PAUSED"] as string[]) {
    assert.equal(
      decideQrScan({ memberStatus, hasCheckInToday: false, coverage: coverage(true) })
        .outcome,
      "member_not_active"
    )
    assert.equal(
      decideQrScan({ memberStatus, hasCheckInToday: true, coverage: coverage(true) })
        .outcome,
      "member_not_active"
    )
  }
})

test("scan decision: an existing check-in wins over coverage", () => {
  const plan = decideQrScan({ memberStatus: "ACTIVE", hasCheckInToday: true, coverage: coverage(true) })
  assert.equal(plan.outcome, "already_checked_in")
})

test("scan decision: covered active member -> normal check-in", () => {
  const plan = decideQrScan({ memberStatus: "ACTIVE", hasCheckInToday: false, coverage: coverage(true) })
  assert.equal(plan.outcome, "check_in")
})

test("scan decision: not covered today -> reviewable request, never silent denial", () => {
  const plan = decideQrScan({ memberStatus: "ACTIVE", hasCheckInToday: false, coverage: coverage(false) })
  assert.equal(plan.outcome, "request_attendance")
})

test("scan decision: a remembered device must run the exact same gate", () => {
  // The auto (remembered-device) path passes the same inputs — this asserts the
  // decision table never branches on identification method.
  const repeat = decideQrScan({ memberStatus: "ACTIVE", hasCheckInToday: true, coverage: coverage(true) })
  const first = decideQrScan({ memberStatus: "ACTIVE", hasCheckInToday: true, coverage: coverage(true) })
  assert.deepEqual(repeat, first)
})

// ---------------------------------------------------------------------------
// dayKeyIsCovered — inclusive membership coverage for a specific day
// ---------------------------------------------------------------------------

test("coverage intervals are inclusive on both ends", () => {
  const intervals = [{ startKey: "2026-10-01", endKey: "2026-10-31" }]
  assert.equal(dayKeyIsCovered(intervals, "2026-10-01"), true)
  assert.equal(dayKeyIsCovered(intervals, "2026-10-31"), true)
  assert.equal(dayKeyIsCovered(intervals, "2026-09-30"), false)
  assert.equal(dayKeyIsCovered(intervals, "2026-11-01"), false)
})

test("merged overlapping or back-to-back intervals cover their union", () => {
  const intervals = [
    { startKey: "2026-09-01", endKey: "2026-09-30" },
    { startKey: "2026-10-01", endKey: "2026-10-20" },
  ]
  assert.equal(dayKeyIsCovered(intervals, "2026-09-15"), true)
  assert.equal(dayKeyIsCovered(intervals, "2026-10-20"), true)
  assert.equal(dayKeyIsCovered(intervals, "2026-11-01"), false)
})

test("a past request day is covered only if the membership genuinely covers it", () => {
  // Request from a gap day (membership had already ended before that day).
  const intervals = [{ startKey: "2026-10-21", endKey: "2026-11-19" }]
  assert.equal(dayKeyIsCovered(intervals, "2026-10-20"), false)
  // Request from an overlapped day between two periods.
  const merged = [
    { startKey: "2026-10-01", endKey: "2026-10-15" },
    { startKey: "2026-10-16", endKey: "2026-10-31" },
  ]
  assert.equal(dayKeyIsCovered(merged, "2026-10-16"), true)
})

// ---------------------------------------------------------------------------
// decideAttendanceApproval — staff approval gate
// ---------------------------------------------------------------------------

test("approval gate: only a still-pending request may be approved", () => {
  const base = { memberActive: true, requestDayCovered: true }
  assert.deepEqual(decideAttendanceApproval({ requestStatus: "PENDING", ...base }), {
    allowed: true,
  })
  assert.deepEqual(decideAttendanceApproval({ requestStatus: "APPROVED", ...base }), {
    allowed: false,
    reason: "not_pending",
  })
  assert.deepEqual(decideAttendanceApproval({ requestStatus: "REJECTED", ...base }), {
    allowed: false,
    reason: "not_pending",
  })
})

test("approval gate: inactive members cannot receive an approved check-in", () => {
  assert.deepEqual(
    decideAttendanceApproval({ requestStatus: "PENDING", memberActive: false, requestDayCovered: true }),
    { allowed: false, reason: "member_inactive" }
  )
})

test("approval gate: a still-expired membership blocks approval explicitly", () => {
  assert.deepEqual(
    decideAttendanceApproval({ requestStatus: "PENDING", memberActive: true, requestDayCovered: false }),
    { allowed: false, reason: "still_expired" }
  )
})
