import "server-only"

import { cache } from "react"

import { prisma } from "@/lib/prisma"
import { branchFilterWhereRequired, type BranchFilter } from "@/lib/branch-scope"
import {
  buildOutstandingDuesRows,
  buildOutstandingMemberships,
  summarizeOutstanding,
  type OutstandingDuesRow,
  type OutstandingMembership,
  type OutstandingMembershipInput,
  type OutstandingSummary,
} from "@/lib/outstanding"

/**
 * Server-only outstanding/dues loaders (org-scoped, session-resolved).
 *
 * Balance math lives in the pure module `@/lib/outstanding`; these loaders
 * fetch the source rows (memberships + payments for the organization) once per
 * request (React cache) and hand them to the pure builders. Everything is
 * scoped by `organizationId` from the authenticated session — never from the
 * client — and then narrowed by the request's branch filter.
 *
 * The branch filter is part of the cache key: the same organization produces
 * different source rows per branch scope, so it MUST be an argument of the
 * cached function. A fail-closed ("none") filter yields the never-matching
 * where-clause, i.e. empty source rows and therefore zero balances.
 */

/** Org- + branch-scoped source rows: every non-CANCELLED membership + every payment. */
export const loadOutstandingSource = cache(
  async (organizationId: string, branchFilter: BranchFilter) => {
    // Membership.branchId and Payment.branchId are NOT NULL in the schema, so the
    // REQUIRED builder is used: a `branchId: null` arm would be rejected by
    // Prisma ("Argument `branchId` is missing") AND would be meaningless, since
    // no such row can exist. A restricted viewer's scope therefore reduces to
    // exactly their assigned branches.
    const branchWhere = branchFilterWhereRequired(branchFilter)
    const [memberships, payments] = await Promise.all([
      prisma.membership.findMany({
        where: { organizationId, status: { not: "CANCELLED" }, ...branchWhere },
        orderBy: [{ member: { firstName: "asc" } }, { member: { lastName: "asc" } }],
        select: {
          id: true,
          memberId: true,
          branchId: true,
          startDate: true,
          endDate: true,
          status: true,
          amountMinor: true,
          expectedPaymentDate: true,
          member: { select: { id: true, firstName: true, lastName: true, phone: true, memberCode: true } },
          plan: { select: { name: true } },
        },
      }),
      prisma.payment.findMany({
        where: { organizationId, ...branchWhere },
        select: { membershipId: true, amountMinor: true, status: true },
      }),
    ])
    return {
      memberships: memberships as unknown as OutstandingMembershipInput[],
      payments,
    }
  }
)

/** Aggregate totals for the branch scope (dashboard KPIs / reports). */
export async function getOutstandingOverview(
  organizationId: string,
  timeZone: string,
  branchFilter: BranchFilter,
  today = new Date()
): Promise<OutstandingSummary> {
  const { memberships, payments } = await loadOutstandingSource(organizationId, branchFilter)
  return summarizeOutstanding(
    buildOutstandingMemberships({ memberships, payments, timeZone, today })
  )
}

/** The enriched dues ledger (member + plan identity) for the branch scope. */
export async function getOutstandingDuesRows(
  organizationId: string,
  timeZone: string,
  branchFilter: BranchFilter,
  today = new Date()
): Promise<OutstandingDuesRow[]> {
  const { memberships, payments } = await loadOutstandingSource(organizationId, branchFilter)
  return buildOutstandingDuesRows({ memberships, payments, timeZone, today })
}

/**
 * Outstanding totals grouped by the branch each membership was sold at.
 *
 * Used by the Branches overview, which must attribute dues to exactly one
 * branch per card. It reuses the SAME source rows and the SAME balance math as
 * the ledger above — there is no second, divergent notion of "outstanding" —
 * and simply partitions the built rows by the branch id carried through from
 * the source. Rows with no branch id (only possible for a hand-built pure
 * input) are dropped: an unattributable balance is never guessed onto a card.
 */
export async function getOutstandingSummaryByBranch(
  organizationId: string,
  timeZone: string,
  branchFilter: BranchFilter,
  today = new Date()
): Promise<Map<string, OutstandingSummary>> {
  const { memberships, payments } = await loadOutstandingSource(organizationId, branchFilter)
  const rows = buildOutstandingMemberships({ memberships, payments, timeZone, today })
  const byBranch = new Map<string, OutstandingMembership[]>()
  for (const row of rows) {
    if (!row.branchId) continue
    const bucket = byBranch.get(row.branchId)
    if (bucket) bucket.push(row)
    else byBranch.set(row.branchId, [row])
  }
  const summaries = new Map<string, OutstandingSummary>()
  for (const [branchId, branchRows] of byBranch) {
    summaries.set(branchId, summarizeOutstanding(branchRows))
  }
  return summaries
}