import "server-only"

import { prisma } from "@/lib/prisma"
import { dayKeyOf } from "@/lib/format"
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
 * All queries are scoped to the authenticated user's organization.
 */
export async function getSidebarCounts(
  organizationId: string,
  timeZone: string
): Promise<SidebarCounts> {
  const todayKey = dayKeyOf(new Date())
  const now = new Date()

  // Active memberships = records whose business state is ACTIVE or within the
  // renewal warning window (date-derived, so stale "ACTIVE" rows whose end
  // date passed are not counted).
  const lifecycleStats = await getMembershipLifecycleStats(organizationId, timeZone)
  const activeMemberships =
    lifecycleStats.records.ACTIVE + lifecycleStats.records.EXPIRING_SOON

  const [
    members,
    plans,
    payments,
    todayAttendance,
    leads,
    trainers,
    upcomingAppointments,
    pendingTasks,
  ] = await Promise.all([
    prisma.member.count({
      where: { organizationId, deletedAt: null },
    }),
    prisma.membershipPlan.count({
      where: { organizationId, active: true },
    }),
    prisma.payment.count({
      where: { organizationId, status: "RECORDED" },
    }),
    prisma.checkIn.count({
      where: { organizationId, dayKey: todayKey },
    }),
    prisma.lead.count({
      where: {
        organizationId,
        deletedAt: null,
        stage: { notIn: ["CONVERTED", "LOST"] },
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
      },
    }),
    prisma.task.count({
      where: {
        organizationId,
        status: { in: ["TODO", "IN_PROGRESS"] },
      },
    }),
  ])

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
