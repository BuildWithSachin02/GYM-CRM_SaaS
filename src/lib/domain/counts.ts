import "server-only"

import { prisma } from "@/lib/prisma"
import { dayKeyOf } from "@/lib/format"
import {
  branchFilterWhere,
  branchFilterWhereRequired,
  type BranchFilter,
} from "@/lib/branch-scope"
import { getMembershipLifecycleStats } from "@/lib/domain/memberships"

export type SidebarCounts = {
  members: number
  memberships: number
  plans: number
  payments: number
  attendance: number
  leads: number
  trainers: number
  appointments: number
  tasks: number
}

/**
 * Returns live counts for sidebar navigation badges.
 * All queries are scoped to the authenticated user's organization; the branch
 * filter narrows each badge to the caller's branch scope (+ org-wide records).
 *
 * Plans and trainers have no branch column and stay org-wide counts.
 * A fail-closed filter ("none") returns every badge at zero without querying.
 */
export async function getSidebarCounts(
  organizationId: string,
  timeZone: string,
  branchFilter: BranchFilter
): Promise<SidebarCounts> {
  if (branchFilter.kind === "none") {
    return {
      members: 0,
      memberships: 0,
      plans: 0,
      payments: 0,
      attendance: 0,
      leads: 0,
      trainers: 0,
      appointments: 0,
      tasks: 0,
    }
  }

  const todayKey = dayKeyOf(new Date())
  const now = new Date()

  // All 9 queries run in parallel — lifecycle stats + 8 counts have no
  // dependencies between them. React cache() deduplicates lifecycle stats
  // across layout + page within the same request.
  const [
    lifecycleStats,
    members,
    plans,
    payments,
    todayAttendance,
    leads,
    trainers,
    upcomingAppointments,
    pendingTasks,
  ] = await Promise.all([
    getMembershipLifecycleStats(organizationId, timeZone, branchFilter),
    prisma.member.count({
      where: {
        organizationId,
        deletedAt: null,
        ...branchFilterWhere(branchFilter, "homeBranchId"),
      },
    }),
    prisma.membershipPlan.count({
      where: { organizationId, active: true },
    }),
    prisma.payment.count({
      where: { organizationId, status: "RECORDED", ...branchFilterWhereRequired(branchFilter) },
    }),
    prisma.checkIn.count({
      where: { organizationId, dayKey: todayKey, ...branchFilterWhereRequired(branchFilter) },
    }),
    prisma.lead.count({
      where: {
        organizationId,
        deletedAt: null,
        stage: { notIn: ["CONVERTED", "LOST"] },
        ...branchFilterWhere(branchFilter),
      },
    }),
    prisma.trainer.count({
      where: { organizationId, active: true },
    }),
    prisma.appointment.count({
      where: {
        organizationId,
        status: "SCHEDULED",
        startsAt: { gte: now },
        ...branchFilterWhere(branchFilter),
      },
    }),
    prisma.task.count({
      where: {
        organizationId,
        status: { in: ["TODO", "IN_PROGRESS"] },
        ...branchFilterWhere(branchFilter),
      },
    }),
  ])

  // Active memberships = records whose business state is ACTIVE or within the
  // renewal warning window (date-derived, so stale "ACTIVE" rows whose end
  // date passed are not counted).
  const activeMemberships =
    lifecycleStats.records.ACTIVE + lifecycleStats.records.EXPIRING_SOON

  return {
    members,
    memberships: activeMemberships,
    plans,
    payments,
    attendance: todayAttendance,
    leads,
    trainers,
    appointments: upcomingAppointments,
    tasks: pendingTasks,
  }
}
