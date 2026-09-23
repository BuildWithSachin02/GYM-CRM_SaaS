import "server-only"

import { cache } from "react"

import { prisma } from "@/lib/prisma"
import {
  buildOutstandingDuesRows,
  buildOutstandingMemberships,
  summarizeOutstanding,
  type OutstandingDuesRow,
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
 * client.
 */

/** Org-scoped source rows: every non-CANCELLED membership + every payment. */
export const loadOutstandingSource = cache(async (organizationId: string) => {
  const [memberships, payments] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      orderBy: [{ member: { firstName: "asc" } }, { member: { lastName: "asc" } }],
      select: {
        id: true,
        memberId: true,
        startDate: true,
        endDate: true,
        status: true,
        amountMinor: true,
        expectedPaymentDate: true,
        member: { select: { id: true, firstName: true, lastName: true, phone: true } },
        plan: { select: { name: true } },
      },
    }),
    prisma.payment.findMany({
      where: { organizationId },
      select: { membershipId: true, amountMinor: true, status: true },
    }),
  ])
  return {
    memberships: memberships as unknown as OutstandingMembershipInput[],
    payments,
  }
})

/** Aggregate totals for the whole gym (dashboard KPIs / reports). */
export async function getOutstandingOverview(
  organizationId: string,
  timeZone: string,
  today = new Date()
): Promise<OutstandingSummary> {
  const { memberships, payments } = await loadOutstandingSource(organizationId)
  return summarizeOutstanding(
    buildOutstandingMemberships({ memberships, payments, timeZone, today })
  )
}

/** The enriched dues ledger (member + plan identity), full org snapshot. */
export async function getOutstandingDuesRows(
  organizationId: string,
  timeZone: string,
  today = new Date()
): Promise<OutstandingDuesRow[]> {
  const { memberships, payments } = await loadOutstandingSource(organizationId)
  return buildOutstandingDuesRows({ memberships, payments, timeZone, today })
}