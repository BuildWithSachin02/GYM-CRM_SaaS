import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { getBranchFilterForRequest, requireBranchAccess } from "@/lib/branches"
import { branchFilterWhere } from "@/lib/branch-scope"

import { LeadList } from "@/components/leads/lead-list"

export const metadata: Metadata = {
  title: "Leads",
}

type SearchParams = Promise<{
  q?: string
  stage?: string
  page?: string
  /** Explicit branch context from a Branches quick link (server-validated). */
  branch?: string
}>

const VALID_STAGES = [
  "NEW",
  "CONTACTED",
  "VISIT_SCHEDULED",
  "VISIT_DONE",
  "CONVERTED",
  "LOST",
] as const

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await requireUser()
  if (!can(user, "leads:view")) notFound()
  await requireBranchAccess()
  const params = await searchParams
  const branchFilter = await getBranchFilterForRequest(params.branch)
  const branchClause = branchFilterWhere(branchFilter)

  const q = params.q?.trim() || ""
  const stageFilter = params.stage?.trim() || ""
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1)
  const pageSize = 25
  const skip = (page - 1) * pageSize

  const where: Record<string, unknown> = {
    organizationId: user.organizationId,
    deletedAt: null,
  }

  // Search arms and branch arms share ONE `OR` array (a second `OR` key would
  // overwrite the first). An org-wide reader contributes no branch arms.
  const orArms: Array<Record<string, unknown>> = []

  if (q) {
    orArms.push(
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } }
    )
  }

  orArms.push(...(branchClause.OR ?? []))

  if (orArms.length > 0) {
    where.OR = orArms
  }

  if (stageFilter && (VALID_STAGES as readonly string[]).includes(stageFilter)) {
    where.stage = stageFilter
  }

  const [leads, totalCount] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        source: true,
        sourceDetail: true,
        stage: true,
        followUpDate: true,
        createdAt: true,
        ownerUser: {
          select: { name: true },
        },
        _count: {
          select: { leadActivities: true },
        },
      },
    }),
    prisma.lead.count({ where }),
  ])

  const serializedLeads = leads.map((l) => ({
    id: l.id,
    name: l.name,
    phone: l.phone,
    email: l.email,
    source: l.source,
    sourceDetail: l.sourceDetail,
    stage: l.stage,
    followUpDate: l.followUpDate?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    ownerName: l.ownerUser?.name ?? null,
    activityCount: l._count.leadActivities,
  }))

  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <LeadList
      leads={serializedLeads}
      totalCount={totalCount}
      totalPages={totalPages}
      filters={{ q, stage: stageFilter, page }}
      canCreate={can(user, "leads:create")}
    />
  )
}
