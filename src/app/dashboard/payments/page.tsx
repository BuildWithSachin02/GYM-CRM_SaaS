import type { Metadata } from "next"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"

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
    })),
  }))

  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <PaymentList
      payments={serializedPayments}
      totalCount={totalCount}
      totalPages={totalPages}
      filters={{ q, method: methodFilter, from: fromDate, to: toDate, page }}
      canCreate={can(user, "payments:record")}
      members={serializedMembers}
    />
  )
}
