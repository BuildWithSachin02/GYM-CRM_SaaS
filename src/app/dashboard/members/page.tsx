import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"

import { MemberList } from "@/components/members/member-list"

export const metadata: Metadata = {
  title: "Members",
}

type SearchParams = Promise<{
  q?: string
  status?: string
  page?: string
}>

export default async function MembersPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await requireUser()
  if (!can(user, "members:view")) notFound()
  const params = await searchParams

  const q = params.q?.trim() || ""
  const statusFilter = params.status?.trim() || ""
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1)
  const pageSize = 25
  const skip = (page - 1) * pageSize

  const where: Record<string, unknown> = {
    organizationId: user.organizationId,
    deletedAt: null,
  }

  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { memberCode: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ]
  }

  if (statusFilter && ["ACTIVE", "INACTIVE", "ARCHIVED"].includes(statusFilter)) {
    where.status = statusFilter
  }

  const [members, totalCount] = await Promise.all([
    prisma.member.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        memberCode: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.member.count({ where }),
  ])

  const serializedMembers = members.map((m) => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
  }))

  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <MemberList
      members={serializedMembers}
      totalCount={totalCount}
      totalPages={totalPages}
      filters={{ q, status: statusFilter, page }}
      canCreate={can(user, "members:create")}
    />
  )
}
