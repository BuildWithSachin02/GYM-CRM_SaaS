import type { Metadata } from "next"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { outstandingOfMembership } from "@/lib/outstanding"

import { PaymentList } from "@/components/payments/payment-list"

export const metadata: Metadata = {
  title: "Payments",
}

type SearchParams = Promise<{
  q?: string
  method?: string
  from?: string
  to?: string
  page?: string
  dueStatus?: string
}>

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await requireUser()
  const params = await searchParams

  const q = params.q?.trim() || ""
  const methodFilter = params.method?.trim() || ""
  const fromDate = params.from?.trim() || ""
  const toDate = params.to?.trim() || ""
  const dueStatus = params.dueStatus?.trim().toUpperCase() || ""
  const dueFilter = dueStatus === "OVERDUE" || dueStatus === "PENDING" ? dueStatus : ""

  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1)
  const pageSize = 25
  const skip = (page - 1) * pageSize

  const where: Record<string, unknown> = {
    organizationId: user.organizationId,
  }

  if (q) {
    where.member = {
      is: {
        organizationId: user.organizationId,
        deletedAt: null,
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
        ],
      },
    }
  }

  if (methodFilter && ["CASH", "UPI", "CARD", "BANK_TRANSFER"].includes(methodFilter)) {
    where.method = methodFilter
  }

  if (fromDate) {
    const from = new Date(fromDate)
    if (!Number.isNaN(from.getTime())) {
      where.paymentDate = { ...(where.paymentDate as object), gte: from }
    }
  }

  if (toDate) {
    const to = new Date(toDate)
    if (!Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999)
      where.paymentDate = { ...(where.paymentDate as object), lte: to }
    }
  }

  const [balanceMemberships, paymentTotals] = await Promise.all([
    // Every non-CANCELLED membership and its commitment day, so the derived
    // outstanding status can be computed with the same rules as the dues
    // ledger (a balance is never revenue).
    prisma.membership.findMany({
      where: { organizationId: user.organizationId, status: { not: "CANCELLED" } },
      select: {
        id: true,
        memberId: true,
        startDate: true,
        endDate: true,
        status: true,
        amountMinor: true,
        expectedPaymentDate: true,
      },
    }),
    // RECORDED-only sums per membership so the payment form can show the
    // remaining balance (VOIDED/REFUNDED never count — same rule as the
    // outstanding ledger).
    prisma.payment.groupBy({
      by: ["membershipId"],
      where: {
        organizationId: user.organizationId,
        status: "RECORDED",
        membershipId: { not: null },
      },
      _sum: { amountMinor: true },
    }),
  ])

  const paidByMembership = new Map(
    paymentTotals
      .filter((r) => r.membershipId)
      .map((r) => [
        r.membershipId as string,
        r._sum.amountMinor ?? 0,
      ])
  )

  // Optional deep-link from the dashboard dues widgets: restrict the list to
  // payments whose membership currently carries an OVERDUE/PENDING balance.
  if (dueFilter) {
    const dueMembershipIds = balanceMemberships
      .map((m) =>
        outstandingOfMembership({
          row: m,
          paidMinor: paidByMembership.get(m.id) ?? 0,
          timeZone: user.organization.timezone,
        })
      )
      .filter((o) => o.status === dueFilter)
      .map((o) => o.membershipId)
    where.membershipId = { in: dueMembershipIds }
  }

  const [payments, totalCount, members] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { paymentDate: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        amountMinor: true,
        method: true,
        status: true,
        reference: true,
        paymentDate: true,
        createdAt: true,
        member: {
          select: { id: true, firstName: true, lastName: true, phone: true },
        },
        membership: {
          select: {
            id: true,
            startDate: true,
            endDate: true,
            plan: { select: { name: true } },
          },
        },
        recordedBy: {
          select: { name: true },
        },
      },
    }),
    prisma.payment.count({ where }),
    prisma.member.findMany({
      where: { organizationId: user.organizationId, deletedAt: null, status: "ACTIVE" },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        memberships: {
          where: { status: { not: "CANCELLED" } },
          orderBy: [{ endDate: "desc" }],
          select: {
            id: true,
            startDate: true,
            endDate: true,
            amountMinor: true,
            status: true,
            expectedPaymentDate: true,
            plan: { select: { name: true, priceMinor: true } },
          },
        },
      },
    }),
  ])

  const serializedPayments = payments.map((p) => ({
    ...p,
    paymentDate: p.paymentDate.toISOString(),
    createdAt: p.createdAt.toISOString(),
    membership: p.membership
      ? {
          ...p.membership,
          startDate: p.membership.startDate.toISOString(),
          endDate: p.membership.endDate.toISOString(),
        }
      : null,
  }))

  const serializedMembers = members.map((m) => ({
    ...m,
    memberships: m.memberships.map((ms) => ({
      ...ms,
      startDate: ms.startDate.toISOString(),
      endDate: ms.endDate.toISOString(),
      expectedPaymentDate: ms.expectedPaymentDate?.toISOString() ?? null,
      paidMinor: paidByMembership.get(ms.id) ?? 0,
      outstandingMinor: ms.amountMinor - (paidByMembership.get(ms.id) ?? 0),
    })),
  }))

  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <PaymentList
      payments={serializedPayments}
      totalCount={totalCount}
      totalPages={totalPages}
      filters={{ q, method: methodFilter, from: fromDate, to: toDate, page, dueStatus: dueFilter }}
      canCreate={can(user, "payments:record")}
      members={serializedMembers}
    />
  )
}
