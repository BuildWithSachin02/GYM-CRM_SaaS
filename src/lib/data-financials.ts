import type { MembershipStatus } from "@prisma/client"

import { filterRecordedPayments } from "@/lib/analytics-core"
import { dayKeyInTimeZone, pickPrimaryMembership } from "@/lib/memberships"

/**
 * Pure financial aggregation for the derived "Member Financial Summary"
 * worksheet. No DB access, no Excel — deterministic and unit-testable.
 *
 * Money semantics reuse the app's existing rules:
 *   - Revenue/paid totals come ONLY from actual Payment rows whose status is
 *     RECORDED (filterRecordedPayments). VOIDED/REFUNDED rows never count.
 *   - Membership amountMinor is the agreed price ASSIGNED to the member; it is
 *     never treated as received revenue. It is reported separately as
 *     "Total Membership Value".
 *
 * Range scoping is consistent with the category sheets:
 *   - memberships → those whose org-local start date falls in the range
 *   - payments    → those inside the range (the caller already scopes them)
 * The caller passes the member universe (union of in-range member /
 * membership / payment records) with the memberships PAYMENTS scoped already.
 */

/** An inclusive org-day-key range; null means "all time". */
export type FinancialRange = { fromKey: string; toKey: string } | null

export type FinancialMembershipRow = {
  id: string
  memberId: string
  status: MembershipStatus
  startDate: Date
  endDate: Date
  amountMinor: number
  plan: { name: string }
}

export type FinancialPaymentRow = {
  id: string
  memberId: string
  amountMinor: number
  method: string
  status: string | null
  paymentDate: Date
}

export type MemberFinancialSummaryRow = {
  memberId: string
  memberName: string
  /** Plan name of the member's primary (current) membership; "" when none. */
  currentPlan: string
  /** Lifecycle status (ACTIVE/EXPIRING_SOON/UPCOMING/EXPIRED/CANCELLED/PAUSED). */
  currentStatus: string
  currentStartKey: string
  currentEndKey: string
  /** Sum of membership.amountMinor for memberships STARTING in the range. */
  totalMembershipValueMinor: number
  /** Sum of RECORDED payment amounts in the range. */
  totalPaidMinor: number
  /** Count of RECORDED payments in the range. */
  paymentCount: number
  /** Amount of the most recent RECORDED in-range payment (null when none). */
  latestPaymentMinor: number | null
  /** Org day key of the most recent RECORDED in-range payment. */
  latestPaymentKey: string | null
  /** Distinct payment methods used by RECORDED in-range payments. */
  methods: string[]
}

export type FinancialAggregationInput = {
  /** Universe members (memberId → "First Last"). Order is not significant. */
  memberNames: ReadonlyMap<string, string>
  /** ALL memberships of the universe members (all time), for current coverage. */
  memberships: readonly FinancialMembershipRow[]
  /** Payments of the universe members, already scoped by the export range. */
  payments: readonly FinancialPaymentRow[]
  /** Membership range for "Total Membership Value" (null = all time). */
  membershipRange: FinancialRange
  timeZone: string
  today?: Date
}

function inMembershipRange(
  startKey: string,
  range: FinancialRange
): boolean {
  if (!range) return true
  return startKey >= range.fromKey && startKey <= range.toKey
}

function sortId(a: string, b: string): number {
  return a.localeCompare(b)
}

/** Latest RECORDED payment by paymentDate (tie-break: newest id wins). */
function latestOf(rows: readonly FinancialPaymentRow[]): FinancialPaymentRow | null {
  if (rows.length === 0) return null
  let latest = rows[0]
  for (const p of rows) {
    if (p.paymentDate > latest.paymentDate || (p.paymentDate.getTime() === latest.paymentDate.getTime() && sortId(p.id, latest.id) > 0)) {
      latest = p
    }
  }
  return latest
}

/**
 * Build one financial summary row per universe member, sorted by member name
 * then id. Membership coverage ("Current Membership") is derived with the
 * same pickPrimaryMembership coverage engine the app uses everywhere.
 */
export function buildMemberFinancialRows(
  input: FinancialAggregationInput
): MemberFinancialSummaryRow[] {
  const { memberNames, memberships, payments, membershipRange, timeZone, today } = input

  const membershipsByMember = new Map<string, FinancialMembershipRow[]>()
  for (const m of memberships) {
    const list = membershipsByMember.get(m.memberId)
    if (list) list.push(m)
    else membershipsByMember.set(m.memberId, [m])
  }

  const paymentsByMember = new Map<string, FinancialPaymentRow[]>()
  for (const p of payments) {
    const list = paymentsByMember.get(p.memberId)
    if (list) list.push(p)
    else paymentsByMember.set(p.memberId, [p])
  }

  const rows: MemberFinancialSummaryRow[] = []
  for (const [memberId, memberName] of memberNames) {
    const memberMemberships = membershipsByMember.get(memberId) ?? []
    const memberPayments = paymentsByMember.get(memberId) ?? []

    const primary = pickPrimaryMembership(memberMemberships, timeZone, today)
    const currentStartKey = primary ? dayKeyInTimeZone(primary.row.startDate, timeZone) : ""
    const currentEndKey = primary ? dayKeyInTimeZone(primary.row.endDate, timeZone) : ""

    let totalMembershipValueMinor = 0
    for (const m of memberMemberships) {
      if (inMembershipRange(dayKeyInTimeZone(m.startDate, timeZone), membershipRange)) {
        totalMembershipValueMinor += m.amountMinor
      }
    }

    const recorded = filterRecordedPayments(memberPayments)
    let totalPaidMinor = 0
    for (const p of recorded) totalPaidMinor += p.amountMinor

    const latest = latestOf(recorded)
    const methods = [...new Set(recorded.map((p) => p.method))].sort((a, b) => a.localeCompare(b))

    rows.push({
      memberId,
      memberName,
      currentPlan: primary?.row.plan.name ?? "",
      currentStatus: primary?.lifecycle.status ?? "",
      currentStartKey,
      currentEndKey,
      totalMembershipValueMinor,
      totalPaidMinor,
      paymentCount: recorded.length,
      latestPaymentMinor: latest != null ? latest.amountMinor : null,
      latestPaymentKey: latest != null ? dayKeyInTimeZone(latest.paymentDate, timeZone) : null,
      methods,
    })
  }

  rows.sort(
    (a, b) => a.memberName.localeCompare(b.memberName) || sortId(a.memberId, b.memberId)
  )
  return rows
}