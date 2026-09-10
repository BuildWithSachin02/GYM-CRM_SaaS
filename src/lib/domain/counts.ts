import "server-only"

import { prisma } from "@/lib/prisma"
import { dayKeyOf } from "@/lib/format"

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
export async function getSidebarCounts(organizationId: string): Promise<SidebarCounts> {
  const todayKey = dayKeyOf(new Date())
  const now = new Date()

  const [
    members,
    activeMemberships,
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
    prisma.membership.count({
      where: { organizationId, status: "ACTIVE" },
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
