import type { Metadata } from "next"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"

import { MembershipList } from "@/components/memberships/membership-list"

export const metadata: Metadata = {
  title: "Memberships",
}

type SearchParams = Promise<{
  q?: string
  status?: string
  page?: string
}>

export default async function MembershipsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await requireUser()
  const params = await searchParams

  const q = params.q?.trim() || ""
  const statusFilter = params.status?.trim() || ""
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1)
  const pageSize = 25
  const skip = (page - 1) * pageSize

  const where: Record<string, unknown> = {
    organizationId: user.organizationId,
  }

  if (statusFilter && ["ACTIVE", "EXPIRED", "CANCELLED", "PAUSED"].includes(statusFilter)) {
    where.status = statusFilter
  }

  if (q) {
    where.member = {
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
      ],
    }
  }

  const now = new Date()
  const in7Days = new Date(now)
  in7Days.setDate(in7Days.getDate() + 7)

  const [memberships, totalCount, activeCount, expiringCount, expiredCount, members, plans] =
    await Promise.all([
      prisma.membership.findMany({
        where,
        include: {
          member: { select: { id: true, firstName: true, lastName: true } },
          plan: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.membership.count({ where }),
      prisma.membership.count({
        where: { organizationId: user.organizationId, status: "ACTIVE" },
      }),
      prisma.membership.count({
        where: {
          organizationId: user.organizationId,
          status: "ACTIVE",
          endDate: { gte: now, lte: in7Days },
        },
      }),
      prisma.membership.count({
        where: { organizationId: user.organizationId, status: "EXPIRED" },
      }),
      prisma.member.findMany({
        where: { organizationId: user.organizationId, deletedAt: null, status: "ACTIVE" },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        select: { id: true, firstName: true, lastName: true },
      }),
      prisma.membershipPlan.findMany({
        where: { organizationId: user.organizationId, active: true },
        orderBy: { priceMinor: "asc" },
        select: { id: true, name: true, priceMinor: true, durationDays: true },
      }),
    ])

  const serializedMemberships = memberships.map((m) => ({
    id: m.id,
    memberId: m.memberId,
    memberName: `${m.member.firstName} ${m.member.lastName}`.trim(),
    planId: m.plan.id,
    planName: m.plan.name,
    startDate: m.startDate.toISOString(),
    endDate: m.endDate.toISOString(),
    status: m.status,
    daysLeft:
      m.status === "ACTIVE"
        ? Math.max(
            0,
            Math.ceil((m.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          )
        : null,
  }))

  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <MembershipList
      memberships={serializedMemberships}
      totalCount={totalCount}
      totalPages={totalPages}
      filters={{ q, status: statusFilter, page }}
      stats={{
        totalActive: activeCount,
        expiringIn7Days: expiringCount,
        expired: expiredCount,
      }}
      members={members}
      plans={plans}
      canManage={can(user, "memberships:manage")}
    />
  )
}
