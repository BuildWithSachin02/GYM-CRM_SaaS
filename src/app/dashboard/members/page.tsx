import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { getBranchFilterForRequest, requireBranchAccess } from "@/lib/branches"
import { branchFilterWhere } from "@/lib/branch-scope"

import { MemberList } from "@/components/members/member-list"

export const metadata: Metadata = {
  title: "Members",
}

type SearchParams = Promise<{
  q?: string
  status?: string
  page?: string
  /** Explicit branch context from a Branches quick link (server-validated). */
  branch?: string
}>

export default async function MembersPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await requireUser()
  if (!can(user, "members:view")) notFound()
  await requireBranchAccess()
  const params = await searchParams
  const branchFilter = await getBranchFilterForRequest(params.branch)
  const memberBranchClause = branchFilterWhere(branchFilter, "homeBranchId")

  const q = params.q?.trim() || ""
  const statusFilter = params.status?.trim() || ""
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1)
  const pageSize = 25
  const skip = (page - 1) * pageSize

  const where: Record<string, unknown> = {
    organizationId: user.organizationId,
    deletedAt: null,
  }

  // The search box and the branch scope both constrain the SAME rows, so they
  // share ONE `OR` array: a second `OR` key would silently overwrite the first.
  // An org-wide reader (kind "all") contributes no arms, so the search OR stays
  // exactly as it was.
  const orArms: Array<Record<string, unknown>> = []

  if (q) {
    orArms.push(
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { memberCode: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } }
    )
  }

  orArms.push(...(memberBranchClause.OR ?? []))

  if (orArms.length > 0) {
    where.OR = orArms
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
