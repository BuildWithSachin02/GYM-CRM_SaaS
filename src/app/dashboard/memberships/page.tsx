import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { getBranchFilterForRequest, requireBranchAccess } from "@/lib/branches"
import { branchFilterWhere, branchFilterWhereRequired } from "@/lib/branch-scope"
import {
  dayKeyInTimeZone,
  getMemberCoverage,
  getMembershipLifecycle,
  LIFECYCLE_STATUS_ORDER,
  memberNeedsRenewal,
  nextValidRenewalStartKey,
  type MembershipLifecycleStatus,
} from "@/lib/memberships"
import { getMembershipLifecycleStats, pickPrimaryMembership } from "@/lib/domain/memberships"

import { MembershipList } from "@/components/memberships/membership-list"
import { MembershipHistory } from "@/components/memberships/membership-history"

export const metadata: Metadata = {
  title: "Memberships",
}

type SearchParams = Promise<{
  q?: string
  status?: string
  page?: string
  member?: string
  /** Explicit branch context from a Branches quick link (server-validated). */
  branch?: string
}>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isLifecycleStatus = (v: string): v is MembershipLifecycleStatus =>
  (LIFECYCLE_STATUS_ORDER as readonly string[]).includes(v)

function serializeHistoryRows(
  rows: Array<{
    id: string
    startDate: Date
    endDate: Date
    status: string
    amountMinor: number
    expectedPaymentDate: Date | null
    plan: { id: string; name: string }
  }>,
  timeZone: string,
  todayKey: string,
  paidByMembership: Map<string, number>
) {
  // Renewal rules are per-member, not per-record: every record in this member's
  // history shares the same suggested start (the day after ALL their coverage),
  // the same coverage-through information, and the same "needs renewal" flag.
  const suggestedStart = nextValidRenewalStartKey(rows, timeZone, todayKey)
  const coverageThroughKey = getMemberCoverage(rows, timeZone, todayKey).overallEndKey
  const canRenew = memberNeedsRenewal(rows, timeZone, todayKey)
  const today = new Date()
  return rows.map((m) => {
    const lifecycle = getMembershipLifecycle({
      startDate: m.startDate,
      endDate: m.endDate,
      status: m.status,
      timeZone,
      today,
    })
    const paidMinor = paidByMembership.get(m.id) ?? 0
    return {
      id: m.id,
      planId: m.plan.id,
      planName: m.plan.name,
      startDate: m.startDate.toISOString(),
      endDate: m.endDate.toISOString(),
      status: lifecycle.status,
      daysLeft: lifecycle.daysLeft,
      suggestedStart,
      coverageThroughKey,
      canRenew,
      renewedThrough:
        coverageThroughKey != null &&
        coverageThroughKey > dayKeyInTimeZone(m.endDate, timeZone),
      amountMinor: m.amountMinor,
      paidMinor,
      outstandingMinor: m.amountMinor - paidMinor,
      expectedPaymentDate: m.expectedPaymentDate?.toISOString() ?? null,
    }
  })
}

export default async function MembershipsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await requireUser()
  if (!can(user, "memberships:view")) notFound()
  await requireBranchAccess()
  const params = await searchParams
  const branchFilter = await getBranchFilterForRequest(params.branch)
  const branchClause = branchFilterWhereRequired(branchFilter)
  const memberBranchClause = branchFilterWhere(branchFilter, "homeBranchId")
  const timeZone = user.organization.timezone
  const todayKey = dayKeyInTimeZone(new Date(), timeZone)
  const canManage = can(user, "memberships:manage")

  const q = params.q?.trim() || ""
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1)
  const pageSize = 25

  const plans = await prisma.membershipPlan.findMany({
    where: { organizationId: user.organizationId, active: true },
    orderBy: { priceMinor: "asc" },
    select: { id: true, name: true, priceMinor: true, durationDays: true },
  })

  // RECORDED-only sums per membership so the list/history can show what is
  // paid and what is still pending (VOIDED/REFUNDED never count).
  const recordedByMembership = await prisma.payment.groupBy({
    by: ["membershipId"],
    where: {
      organizationId: user.organizationId,
      status: "RECORDED",
      membershipId: { not: null },
      ...branchClause,
    },
    _sum: { amountMinor: true },
  })
  const paidByMembership = new Map(
    recordedByMembership
      .filter((r) => r.membershipId)
      .map((r) => [r.membershipId as string, r._sum.amountMinor ?? 0])
  )

  const memberFilter = params.member?.trim()
  if (memberFilter) {
    const target = UUID_RE.test(memberFilter)
      ? await prisma.member.findFirst({
          where: {
            id: memberFilter,
            organizationId: user.organizationId,
            deletedAt: null,
            ...memberBranchClause,
          },
          select: { id: true, firstName: true, lastName: true, memberCode: true },
        })
      : null
    if (!target) notFound()

    const rows = await prisma.membership.findMany({
      where: {
        organizationId: user.organizationId,
        memberId: target.id,
        ...branchClause,
      },
      include: {
        plan: { select: { id: true, name: true } },
      },
      orderBy: [{ endDate: "desc" }, { startDate: "desc" }, { createdAt: "desc" }],
    })

    return (
      <MembershipHistory
        memberId={target.id}
        memberName={`${target.firstName} ${target.lastName}`.trim()}
        memberCode={target.memberCode}
        memberships={serializeHistoryRows(rows, timeZone, todayKey, paidByMembership)}
        plans={plans}
        canManage={canManage}
      />
    )
  }

  const statusFilter = params.status?.trim() || ""
  const memberships = await prisma.membership.findMany({
    where: {
      organizationId: user.organizationId,
      ...branchClause,
    },
    include: {
      member: { select: { id: true, firstName: true, lastName: true, memberCode: true } },
      plan: { select: { id: true, name: true } },
    },
    orderBy: [{ member: { firstName: "asc" } }, { member: { lastName: "asc" } }],
  })

  const rowsByMember = new Map<string, Array<(typeof memberships)[number]>>()
  for (const row of memberships) {
    const list = rowsByMember.get(row.memberId) ?? []
    list.push(row)
    rowsByMember.set(row.memberId, list)
  }

  const stats = await getMembershipLifecycleStats(user.organizationId, timeZone, branchFilter)

  const entries = []
  for (const [memberId, rows] of rowsByMember) {
    const primary = pickPrimaryMembership(rows, timeZone)
    if (!primary || primary.row.memberId !== memberId) continue

    const member = primary.row.member
    const memberName = `${member.firstName} ${member.lastName}`.trim()
    if (q) {
      const nameMatches = memberName.toLowerCase().includes(q.toLowerCase())
      const codeMatches = (member.memberCode ?? "").toLowerCase().includes(q.toLowerCase())
      if (!nameMatches && !codeMatches) continue
    }
    if (statusFilter) {
      if (!isLifecycleStatus(statusFilter)) continue
      if (primary.lifecycle.status !== statusFilter) continue
    }

    // The member's coverage extends through the farthest valid end date; a
    // renewal may only start after all of it (never inside a 1+ day gap, but
    // the day after the last coverage end even if that end already passed).
    const coverageThroughKey = primary.coverage.overallEndKey
    const suggestedStart = nextValidRenewalStartKey(rows, timeZone, todayKey)
    // Renew is a MEMBER-LEVEL decision based on total coverage — never driven
    // by a single record's expiry (a historical record may read EXPIRED while
    // the member's coverage chain continues into the future).
    const canRenew = memberNeedsRenewal(rows, timeZone, todayKey)

    const paidMinor = paidByMembership.get(primary.row.id) ?? 0

    entries.push({
      id: primary.row.id,
      memberId,
      memberName,
      memberCode: member.memberCode ?? null,
      planId: primary.row.plan.id,
      planName: primary.row.plan.name,
      startDate: primary.row.startDate.toISOString(),
      endDate: primary.row.endDate.toISOString(),
      status: primary.lifecycle.status,
      daysLeft: primary.lifecycle.daysLeft,
      historyCount: rows.length,
      suggestedStart,
      coverageThroughKey,
      renewedThrough:
        coverageThroughKey != null &&
        coverageThroughKey > dayKeyInTimeZone(primary.row.endDate, timeZone),
      canRenew,
      amountMinor: primary.row.amountMinor,
      paidMinor,
      outstandingMinor: primary.row.amountMinor - paidMinor,
      expectedPaymentDate: primary.row.expectedPaymentDate?.toISOString() ?? null,
    })
  }

  entries.sort((a, b) => a.memberName.localeCompare(b.memberName, "en"))

  const totalCount = entries.length
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageEntries = entries.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const members = await prisma.member.findMany({
    where: {
      organizationId: user.organizationId,
      deletedAt: null,
      status: "ACTIVE",
      ...memberBranchClause,
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: { id: true, firstName: true, lastName: true, memberCode: true, phone: true },
  })

  return (
    <MembershipList
      memberships={pageEntries}
      totalCount={totalCount}
      totalPages={totalPages}
      filters={{ q, status: statusFilter, page: currentPage }}
      stats={{
        totalActive: stats.members.ACTIVE,
        expiringIn7Days: stats.members.EXPIRING_SOON,
        expired: stats.members.EXPIRED,
      }}
      members={members}
      plans={plans}
      canManage={canManage}
      todayKey={todayKey}
    />
  )
}