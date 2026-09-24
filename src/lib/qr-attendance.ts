import type { MemberCoverage, MembershipCoverageInterval } from "@/lib/memberships"

/**
 * Pure decision logic for QR attendance scans (no DB access).
 *
 * Every scan — first-time via member search OR repeated via a remembered
 * device — converges on this decision so the two paths can never diverge. The
 * remembered device only supplies the member's identity; membership, status,
 * duplicate and eligibility rules are always re-derived from the database.
 *
 * Decision order:
 *   1. member must be ACTIVE (otherwise: stop, never create a CheckIn/request)
 *   2. an existing CheckIn for the (org, member, day) means "already checked in"
 *   3. coverage of today (ACTIVE / EXPIRING_SOON periods) → normal CheckIn
 *   4. otherwise a genuine business state (EXPIRED / CANCELLED / PAUSED /
 *      UPCOMING / no membership) → reviewable PENDING attendance request
 */

export type QrScanPlan =
  | { outcome: "member_not_active" }
  | { outcome: "already_checked_in" }
  | { outcome: "check_in" }
  | { outcome: "request_attendance" }

export type QrScanInput = {
  memberStatus: string
  hasCheckInToday: boolean
  coverage: MemberCoverage
}

export function decideQrScan(input: QrScanInput): QrScanPlan {
  if (input.memberStatus !== "ACTIVE") return { outcome: "member_not_active" }
  if (input.hasCheckInToday) return { outcome: "already_checked_in" }
  if (input.coverage.coveredToday) return { outcome: "check_in" }
  return { outcome: "request_attendance" }
}

/**
 * Does any coverage interval include the given org-timezone calendar day?
 * Membership coverage is decided on day keys (inclusive on both ends), so a
 * pending request for a PAST day can be approved only when the (renewed)
 * membership actually covers that day — never merely because it is valid today.
 */
export function dayKeyIsCovered(
  intervals: readonly MembershipCoverageInterval[],
  dayKey: string
): boolean {
  return intervals.some((iv) => iv.startKey <= dayKey && dayKey <= iv.endKey)
}

/**
 * Owner/staff approval gate for a PENDING attendance request (pure).
 *
 * Returns exactly one gate result. Order matters and matches the server flow:
 * the request must still be PENDING, the member must still be ACTIVE, and the
 * current membership must cover the ORIGINAL request day. An outstanding
 * balance is intentionally NOT part of this gate — dues never block attendance.
 */
export type AttendanceApprovalGate =
  | { allowed: true }
  | { allowed: false; reason: "not_pending" }
  | { allowed: false; reason: "member_inactive" }
  | { allowed: false; reason: "still_expired" }

export type AttendanceApprovalGateInput = {
  requestStatus: string
  memberActive: boolean
  requestDayCovered: boolean
}

export function decideAttendanceApproval(
  input: AttendanceApprovalGateInput
): AttendanceApprovalGate {
  if (input.requestStatus !== "PENDING") return { allowed: false, reason: "not_pending" }
  if (!input.memberActive) return { allowed: false, reason: "member_inactive" }
  if (!input.requestDayCovered) return { allowed: false, reason: "still_expired" }
  return { allowed: true }
}