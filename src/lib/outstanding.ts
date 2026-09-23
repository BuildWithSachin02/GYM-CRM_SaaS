import type { MembershipStatus } from "@prisma/client"

import { filterRecordedPayments } from "@/lib/analytics-core"
import { formatMoney, fullName } from "@/lib/format"
import { dayKeyInTimeZone, daysBetweenKeys } from "@/lib/memberships"

/**
 * Outstanding / dues business rules — PURE (no Prisma, no `server-only`) so
 * they can be unit-tested in isolation, exactly like the analytics core.
 *
 * Money semantics reuse the app's existing rules:
 *   - A membership's FINAL PAYABLE is `Membership.amountMinor` (the price
 *     agreed when the membership was created/renewed). It is never revenue.
 *   - PAID comes ONLY from actual Payment rows whose status is RECORDED
 *     (`filterRecordedPayments`). VOIDED/REFUNDED never count.
 *   - OUTSTANDING = finalPayable - paid, computed PER MEMBERSHIP (a member
 *     with several memberships has separate balances; no cross-membership
 *     netting, so ₹1,000 + ₹4,000 + unpaid ₹4,000 never reads as ₹9,000).
 *   - The outstanding STATUS (PAID/PENDING/OVERDUE) is DERIVED, never stored:
 *       PAID    outstanding = 0
 *       PENDING outstanding > 0 and no expected date, or the org-local
 *               expected day has not passed yet (due today still counts)
 *       OVERDUE outstanding > 0 and the org-local expected day has passed
 *
 * `expectedPaymentDate` is a commitment date, never a payment/revenue date.
 */

export type OutstandingStatus = "PAID" | "PENDING" | "OVERDUE"

/** Presentation order for the status filter dropdowns / chips. */
export const OUTSTANDING_STATUS_ORDER: readonly OutstandingStatus[] = [
  "OVERDUE",
  "PENDING",
  "PAID",
]

export type OutstandingMembershipRecord = {
  id: string
  memberId: string
  startDate: Date
  endDate: Date
  status: MembershipStatus | string
  /** The agreed price this membership must be paid in full by. */
  amountMinor: number
  expectedPaymentDate: Date | null
}

/** The subset of a Payment needed for balance math. */
export type OutstandingPaymentRecord = {
  membershipId: string | null
  amountMinor: number
  status: string | null
}

export type OutstandingMembership = {
  membershipId: string
  finalPayableMinor: number
  paidMinor: number
  outstandingMinor: number
  status: OutstandingStatus
  /** Org-local calendar day key of the expected payment date (null when unset). */
  expectedPaymentKey: string | null
  /** Calendar days until the expected day (PENDING with a due date). */
  daysRemaining: number | null
  /** Calendar days the expected day has already passed (OVERDUE). */
  daysOverdue: number | null
}

export type OutstandingMembershipInput = OutstandingMembershipRecord & {
  member: { firstName: string; lastName: string; phone?: string | null }
  plan: { name: string }
}

export type OutstandingDuesRow = {
  membershipId: string
  memberId: string
  memberName: string
  memberPhone: string
  planName: string
  startKey: string
  endKey: string
  expectedPaymentKey: string | null
  finalPayableMinor: number
  paidMinor: number
  outstandingMinor: number
  paymentCount: number
  status: OutstandingStatus
  daysRemaining: number | null
  daysOverdue: number | null
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * Which memberships still owe money? CANCELLED memberships cannot receive new
 * payments (see checkMembershipPaymentLink) so they never produce a due.
 * PAUSED/EXPIRED memberships keep their balance — they can still be settled.
 */
export function isOutstandingTrackedStatus(status: string): boolean {
  return status !== "CANCELLED"
}

/**
 * Derived outstanding status from the balance and the expected payment date
 * (commits are compared on org-local calendar day keys — never instants, so
 * DST and negative-offset zones stay exact). Due on the expected day itself
 * is still PENDING; only a strictly-past expected day is OVERDUE.
 */
export function deriveOutstandingStatus(input: {
  outstandingMinor: number
  expectedPaymentDate: Date | null
  timeZone: string
  today?: Date
}): OutstandingStatus {
  if (input.outstandingMinor <= 0) return "PAID"
  const todayKey = dayKeyInTimeZone(input.today ?? new Date(), input.timeZone)
  if (input.expectedPaymentDate == null) return "PENDING"
  const expectedKey = dayKeyInTimeZone(input.expectedPaymentDate, input.timeZone)
  return todayKey > expectedKey ? "OVERDUE" : "PENDING"
}

/**
 * Balance + status of ONE membership. `paidMinor` must be the sum of its
 * RECORDED payments (see buildOutstandingTotals). The balance can never go
 * negative — overpayment is rejected by checkPaymentAmount before it exists.
 */
export function outstandingOfMembership(input: {
  row: OutstandingMembershipRecord
  paidMinor: number
  timeZone: string
  today?: Date
}): OutstandingMembership {
  const { row, timeZone } = input
  const todayKey = dayKeyInTimeZone(input.today ?? new Date(), timeZone)
  const outstandingMinor = Math.max(0, Math.round(row.amountMinor - input.paidMinor))
  const expectedPaymentKey = row.expectedPaymentDate
    ? dayKeyInTimeZone(row.expectedPaymentDate, timeZone)
    : null
  const status = deriveOutstandingStatus({
    outstandingMinor,
    expectedPaymentDate: row.expectedPaymentDate,
    timeZone,
    today: input.today,
  })
  return {
    membershipId: row.id,
    finalPayableMinor: row.amountMinor,
    paidMinor: input.paidMinor,
    outstandingMinor,
    status,
    expectedPaymentKey,
    daysRemaining:
      status === "PENDING" && expectedPaymentKey != null
        ? daysBetweenKeys(todayKey, expectedPaymentKey)
        : null,
    daysOverdue:
      status === "OVERDUE" && expectedPaymentKey != null
        ? daysBetweenKeys(expectedPaymentKey, todayKey)
        : null,
  }
}

/**
 * membershipId → { paidMinor, paymentCount } using ONLY RECORDED payments
 * (VOIDED/REFUNDED are excluded). Payments without a membership link never
 * contribute — a balance is always the business of the membership it settles.
 */
export function buildOutstandingTotals(
  payments: readonly OutstandingPaymentRecord[]
): Map<string, { paidMinor: number; paymentCount: number }> {
  const totals = new Map<string, { paidMinor: number; paymentCount: number }>()
  for (const p of filterRecordedPayments([...payments])) {
    if (!p.membershipId) continue
    const entry = totals.get(p.membershipId)
    if (entry) {
      entry.paidMinor += p.amountMinor
      entry.paymentCount += 1
    } else {
      totals.set(p.membershipId, { paidMinor: p.amountMinor, paymentCount: 1 })
    }
  }
  return totals
}

export type PaymentAmountCheck =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Server-side guard against overpayment/credits: a payment cannot exceed what
 * is still owed on the membership (and cannot be recorded when nothing is
 * owed). This rule lives here so it is unit-testable with the exact message
 * the server action returns.
 */
export function checkPaymentAmount(input: {
  amountMinor: number
  remainingMinor: number
}): PaymentAmountCheck {
  if (input.amountMinor <= 0) {
    return { ok: false, error: "Payment amount must be positive." }
  }
  if (input.remainingMinor <= 0) {
    return {
      ok: false,
      error: "This membership has no outstanding balance left to pay.",
    }
  }
  if (input.amountMinor > input.remainingMinor) {
    return {
      ok: false,
      error: `Payment amount cannot exceed the outstanding balance of ${formatMoney(input.remainingMinor)}.`,
    }
  }
  return { ok: true }
}

export type OutstandingSummary = {
  /** Sum of outstandingMinor across every tracked membership. */
  totalOutstandingMinor: number
  /** Sum of outstandingMinor for PENDING memberships. */
  pendingMinor: number
  pendingCount: number
  /** Sum of outstandingMinor for OVERDUE memberships. */
  overdueMinor: number
  overdueCount: number
  /** Count of memberships with a non-zero balance (PENDING + OVERDUE). */
  duesCount: number
  paidCount: number
}

export function summarizeOutstanding(
  rows: readonly OutstandingMembership[]
): OutstandingSummary {
  let totalOutstandingMinor = 0
  let pendingMinor = 0
  let pendingCount = 0
  let overdueMinor = 0
  let overdueCount = 0
  let duesCount = 0
  let paidCount = 0
  for (const r of rows) {
    totalOutstandingMinor += r.outstandingMinor
    if (r.status === "OVERDUE") {
      overdueMinor += r.outstandingMinor
      overdueCount += 1
      duesCount += 1
    } else if (r.status === "PENDING") {
      pendingMinor += r.outstandingMinor
      pendingCount += 1
      duesCount += 1
    } else {
      paidCount += 1
    }
  }
  return {
    totalOutstandingMinor,
    pendingMinor,
    pendingCount,
    overdueMinor,
    overdueCount,
    duesCount,
    paidCount,
  }
}

// ---------------------------------------------------------------------------
// Composition helpers (shared by UI loaders and the Excel export)
// ---------------------------------------------------------------------------

/** One balance row per tracked membership, with no identity/plan info. */
export function buildOutstandingMemberships(input: {
  memberships: readonly OutstandingMembershipRecord[]
  payments: readonly OutstandingPaymentRecord[]
  timeZone: string
  today?: Date
}): OutstandingMembership[] {
  const totals = buildOutstandingTotals(input.payments)
  const rows: OutstandingMembership[] = []
  for (const m of input.memberships) {
    if (!isOutstandingTrackedStatus(m.status)) continue
    const paidMinor = totals.get(m.id)?.paidMinor ?? 0
    rows.push(outstandingOfMembership({ row: m, paidMinor, timeZone: input.timeZone, today: input.today }))
  }
  return rows
}

/**
 * The full dues ledger: one enriched row per tracked membership (member + plan
 * identity, period day keys and expected date). Deterministic ordering for
 * lists/exports: OVERDUE first, then PENDING, then PAID; within a status the
 * most urgent (most overdue / soonest expected day) comes first, then the
 * largest balance, then member name, then id.
 */
export function buildOutstandingDuesRows(input: {
  memberships: readonly OutstandingMembershipInput[]
  payments: readonly OutstandingPaymentRecord[]
  timeZone: string
  today?: Date
}): OutstandingDuesRow[] {
  const totals = buildOutstandingTotals(input.payments)
  const balanceByMembership = new Map<string, OutstandingMembership>()
  for (const o of buildOutstandingMemberships(input)) {
    balanceByMembership.set(o.membershipId, o)
  }

  const todayKey = dayKeyInTimeZone(input.today ?? new Date(), input.timeZone)
  const rows: OutstandingDuesRow[] = []
  for (const m of input.memberships) {
    if (!isOutstandingTrackedStatus(m.status)) continue
    const o = balanceByMembership.get(m.id)
    if (!o) continue
    rows.push({
      membershipId: m.id,
      memberId: m.memberId,
      memberName: fullName(m.member.firstName, m.member.lastName),
      memberPhone: m.member.phone ?? "",
      planName: m.plan.name,
      startKey: dayKeyInTimeZone(m.startDate, input.timeZone),
      endKey: dayKeyInTimeZone(m.endDate, input.timeZone),
      expectedPaymentKey: o.expectedPaymentKey,
      finalPayableMinor: o.finalPayableMinor,
      paidMinor: o.paidMinor,
      outstandingMinor: o.outstandingMinor,
      paymentCount: totals.get(m.id)?.paymentCount ?? 0,
      status: o.status,
      daysRemaining: o.daysRemaining,
      daysOverdue: o.daysOverdue,
    })
  }

  const rank = (s: OutstandingStatus) => (s === "OVERDUE" ? 0 : s === "PENDING" ? 1 : 2)
  const byDateKey = (key: string | null) => key ?? todayKey
  rows.sort((a, b) => {
    if (a.status !== b.status) return rank(a.status) - rank(b.status)
    if (a.status === "OVERDUE") {
      const ao = a.daysOverdue ?? 0
      const bo = b.daysOverdue ?? 0
      if (ao !== bo) return bo - ao
    } else if (a.status === "PENDING") {
      const ak = byDateKey(a.expectedPaymentKey)
      const bk = byDateKey(b.expectedPaymentKey)
      if (ak !== bk) return ak < bk ? -1 : 1
    }
    if (a.outstandingMinor !== b.outstandingMinor) return b.outstandingMinor - a.outstandingMinor
    if (a.memberName !== b.memberName) return a.memberName.localeCompare(b.memberName)
    return a.membershipId.localeCompare(b.membershipId)
  })
  return rows
}