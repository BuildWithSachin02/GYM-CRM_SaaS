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

/**
 * Staff gate for correcting an incorrectly attributed check-in (pure).
 *
 * The correction REASSIGNS the existing CheckIn row to the intended member —
 * it never deletes the record, and it never creates a second row for the same
 * day (duplicates stay blocked). The gate order matches the server flow:
 *   1. the check-in must exist in the tenant
 *   2. the target must actually be a different member
 *   3. check-ins produced by an approved AttendanceRequest are never
 *      reassigned (the request is bound to its own member)
 *   4. the target member must exist in the SAME organization and not be deleted
 *   5. the target member must NOT already have a check-in for that day
 */
export type AttendanceCorrectionGate =
  | { allowed: true }
  | { allowed: false; reason: "not_found" }
  | { allowed: false; reason: "no_change" }
  | { allowed: false; reason: "linked_to_request" }
  | { allowed: false; reason: "member_invalid" }
  | { allowed: false; reason: "duplicate_day" }

export type AttendanceCorrectionInput = {
  checkInExists: boolean
  sameMember: boolean
  linkedToRequest: boolean
  targetMemberValid: boolean
  targetHasCheckInOnDay: boolean
}

export function decideAttendanceCorrection(
  input: AttendanceCorrectionInput
): AttendanceCorrectionGate {
  if (!input.checkInExists) return { allowed: false, reason: "not_found" }
  if (input.sameMember) return { allowed: false, reason: "no_change" }
  if (input.linkedToRequest) return { allowed: false, reason: "linked_to_request" }
  if (!input.targetMemberValid) return { allowed: false, reason: "member_invalid" }
  if (input.targetHasCheckInOnDay) return { allowed: false, reason: "duplicate_day" }
  return { allowed: true }
}

// ---------------------------------------------------------------------------
// Identity confirmation (pure)
// ---------------------------------------------------------------------------

/**
 * Mask a phone number for the public identity-confirmation screen. Only the
 * last four digits are ever exposed — never the raw number.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return ""
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 0) return ""
  return `******${digits.slice(-4)}`
}

export type IdentitySummaryInput = {
  firstName: string
  lastName: string
  phone: string | null | undefined
  /** Current plan name when the member is covered today, else null. */
  membershipPlanName?: string | null
}

export type IdentitySummary = {
  name: string
  maskedPhone: string
  membershipPlanName: string | null
}

/**
 * The confirming details shown BEFORE a trusted device may be created. Enough
 * to catch a wrong-member selection (name + masked phone + current plan) but
 * deliberately free of sensitive data.
 */
export function buildIdentitySummary(input: IdentitySummaryInput): IdentitySummary {
  return {
    name: `${input.firstName} ${input.lastName}`.trim(),
    maskedPhone: maskPhone(input.phone),
    membershipPlanName: input.membershipPlanName ?? null,
  }
}