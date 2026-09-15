import "server-only"

import {
  endOfDay,
  format,
  startOfDay,
  subDays,
} from "date-fns"
import { cache } from "react"

import { prisma } from "@/lib/prisma"
import { dayKeyOf } from "@/lib/format"
import { getMembershipLifecycleStats } from "@/lib/domain/memberships"

const DAY = 24 * 60 * 60 * 1000

export type DashboardData = {
  stats: {
    totalMembers: number
    activeMembers: number
    expiringSoon7: number
    expiredCount: number
    todayAttendance: number
    todayRevenue: number
    newLeads: number
    pendingFollowUps: number
  }
  revenueTrend: { day: string; revenue: number }[]
  attendanceTrend: { day: string; count: number }[]
  expiringMemberships: {
    id: string
    memberName: string
    memberId: string
    planName: string
    endDate: string
    daysLeft: number
  }[]
  overdueTasks: {
    id: string
    title: string
    dueDate: string
    assignee: string | null
  }[]
  todayAppointments: {
    id: string
    title: string
    startsAt: string
    endsAt: string
    trainer: string | null
    status: string
  }[]
  recentPayments: {
    id: string
    memberId: string
    memberName: string
    amountMinor: number
    method: string
    paymentDate: string
    recordedBy: string | null
  }[]
  recentMembers: {
    id: string
    firstName: string
    lastName: string
    phone: string
    status: string
    createdAt: string
  }[]
  newLeadsToday: {
    id: string
    name: string
    source: string
    stage: string
    followUpDate: string | null
    createdAt: string
  }[]
  leadPipeline: { stage: string; count: number }[]
  nextWeekAppointments: { id: string; title: string; startsAt: string }[]
}

export async function getDashboardData(
  organizationId: string,
  timeZone: string
): Promise<DashboardData> {
  const [statsData, trends, activity, remaining] = await Promise.all([
    getDashboardStatsData(organizationId, timeZone),
    getDashboardTrendsData(organizationId),
    getDashboardActivityData(organizationId),
    getDashboardRemainingData(organizationId),
  ])

  return {
    stats: statsData.stats,
    revenueTrend: trends.revenueTrend,
    attendanceTrend: trends.attendanceTrend,
    recentPayments: activity.recentPayments,
    recentMembers: activity.recentMembers,
    newLeadsToday: activity.newLeadsToday,
    leadPipeline: activity.leadPipeline,
    expiringMemberships: remaining.expiringMemberships,
    todayAppointments: remaining.todayAppointments,
    overdueTasks: remaining.overdueTasks,
    nextWeekAppointments: remaining.nextWeekAppointments,
  }
}

export type DashboardStatsData = {
  stats: DashboardData["stats"]
  upcomingCount: number
}

/**
 * Segment loader for the dashboard stats row (8 stat cards).
 * Shares the request-scoped membership lifecycle scan and the
 * next-week appointments query with other segments via React cache().
 */
export async function getDashboardStatsData(
  organizationId: string,
  timeZone: string
): Promise<DashboardStatsData> {
  const todayStart = startOfDay(new Date())
  const todayEnd = endOfDay(new Date())
  const todayKey = dayKeyOf(new Date())

  const [
    lifecycleStats,
    totalMembers,
    activeMembers,
    todayAttendance,
    todayRevenue,
    newLeads,
    pendingFollowUps,
    nextWeekAppointments,
  ] = await Promise.all([
    getMembershipLifecycleStats(organizationId, timeZone),
    prisma.member.count({ where: { organizationId, deletedAt: null } }),
    prisma.member.count({
      where: { organizationId, deletedAt: null, status: "ACTIVE" },
    }),
    prisma.checkIn.count({ where: { organizationId, dayKey: todayKey } }),
    prisma.payment.aggregate({
      where: {
        organizationId,
        status: "RECORDED",
        paymentDate: { gte: todayStart, lte: todayEnd },
      },
      _sum: { amountMinor: true },
    }),
    prisma.lead.count({ where: { organizationId, deletedAt: null, stage: "NEW" } }),
    prisma.lead.count({
      where: {
        organizationId,
        deletedAt: null,
        stage: { in: ["NEW", "CONTACTED", "VISIT_SCHEDULED", "VISIT_DONE"] },
        followUpDate: { lte: todayEnd },
      },
    }),
    getDashboardUpcomingAppointments(organizationId),
  ])

  return {
    stats: {
      totalMembers,
      activeMembers,
      expiringSoon7: lifecycleStats.members.EXPIRING_SOON,
      expiredCount: lifecycleStats.members.EXPIRED,
      todayAttendance,
      todayRevenue: todayRevenue._sum.amountMinor ?? 0,
      newLeads,
      pendingFollowUps,
    },
    upcomingCount: nextWeekAppointments.length,
  }
}

/**
 * Segment loader for the trend charts (revenue + attendance).
 */
export async function getDashboardTrendsData(
  organizationId: string
): Promise<Pick<DashboardData, "revenueTrend" | "attendanceTrend">> {
  const [revenueTrend, attendanceTrend] = await Promise.all([
    getRevenueTrend(organizationId, startOfDay(new Date())),
    getAttendanceTrend(organizationId),
  ])
  return { revenueTrend, attendanceTrend }
}

/**
 * Segment loader for recent activity widgets (payments, members, leads).
 */
export async function getDashboardActivityData(
  organizationId: string
): Promise<
  Pick<DashboardData, "recentPayments" | "recentMembers" | "newLeadsToday" | "leadPipeline">
> {
  const [recentPayments, recentMembers, newLeadsToday, leadPipeline] =
    await Promise.all([
      getRecentPayments(organizationId),
      getRecentMembers(organizationId),
      getNewLeads(organizationId),
      getLeadPipeline(organizationId),
    ])
  return { recentPayments, recentMembers, newLeadsToday, leadPipeline }
}

/**
 * Segment loader for the remaining dashboard widgets
 * (expiring, today's appointments, overdue tasks, upcoming appointments).
 */
export async function getDashboardRemainingData(
  organizationId: string
): Promise<
  Pick<
    DashboardData,
    "expiringMemberships" | "todayAppointments" | "overdueTasks" | "nextWeekAppointments"
  >
> {
  const [expiringMemberships, todayAppointments, overdueTasks, nextWeekAppointments] =
    await Promise.all([
      getExpiringMemberships(organizationId, startOfDay(new Date())),
      getTodayAppointments(organizationId),
      getOverdueTasks(organizationId),
      getDashboardUpcomingAppointments(organizationId),
    ])
  return { expiringMemberships, todayAppointments, overdueTasks, nextWeekAppointments }
}

function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * DAY)
}

async function getRevenueTrend(organizationId: string, todayStart: Date) {
  const from = startOfDay(subDays(todayStart, 29))
  const rows = await prisma.payment.groupBy({
    by: ["paymentDate"],
    where: {
      organizationId,
      status: "RECORDED",
      paymentDate: { gte: from },
    },
    _sum: { amountMinor: true },
  })
  const byDay = new Map<string, number>()
  for (const r of rows) {
    const key = dayKeyOf(r.paymentDate)
    byDay.set(key, (byDay.get(key) ?? 0) + (r._sum.amountMinor ?? 0))
  }
  return Array.from({ length: 30 }, (_, i) => {
    const d = addDays(from, i)
    const key = dayKeyOf(d)
    return { day: format(d, "dd MMM"), revenue: byDay.get(key) ?? 0 }
  })
}

async function getAttendanceTrend(organizationId: string) {
  const from = startOfDay(subDays(new Date(), 13))
  const rows = await prisma.checkIn.groupBy({
    by: ["dayKey"],
    where: { organizationId, checkedInAt: { gte: from } },
    _count: { _all: true },
  })
  const byDay = new Map(rows.map((r) => [r.dayKey, r._count._all]))
  return Array.from({ length: 14 }, (_, i) => {
    const d = addDays(from, i)
    const key = dayKeyOf(d)
    return { day: format(d, "dd MMM"), count: byDay.get(key) ?? 0 }
  })
}

async function getExpiringMemberships(organizationId: string, todayStart: Date) {
  const todayEnd = endOfDay(todayStart)
  const rows = await prisma.membership.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      startDate: { lte: todayEnd },
      endDate: { gte: todayStart, lte: endOfDay(addDays(todayStart, 30)) },
    },
    orderBy: { endDate: "asc" },
    take: 12,
    select: {
      id: true,
      endDate: true,
      plan: { select: { name: true } },
      member: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  return rows.map((m) => ({
    id: m.id,
    memberName: `${m.member.firstName} ${m.member.lastName}`,
    memberId: m.member.id,
    planName: m.plan.name,
    endDate: m.endDate.toISOString(),
    daysLeft: Math.max(0, Math.round((m.endDate.getTime() - Date.now()) / DAY)),
  }))
}

async function getOverdueTasks(organizationId: string) {
  const rows = await prisma.task.findMany({
    where: {
      organizationId,
      status: { in: ["TODO", "IN_PROGRESS"] },
      dueDate: { lt: endOfDay(new Date()) },
    },
    orderBy: { dueDate: "asc" },
    take: 6,
    select: {
      id: true,
      title: true,
      dueDate: true,
      assignee: { select: { name: true } },
    },
  })
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: t.dueDate.toISOString(),
    assignee: t.assignee?.name ?? null,
  }))
}

async function getTodayAppointments(organizationId: string) {
  const todayStart = startOfDay(new Date())
  const todayEnd = endOfDay(new Date())
  const rows = await prisma.appointment.findMany({
    where: { organizationId, startsAt: { gte: todayStart, lte: todayEnd } },
    orderBy: { startsAt: "asc" },
    take: 6,
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      member: { select: { firstName: true, lastName: true } },
      lead: { select: { name: true } },
      trainer: { select: { user: { select: { name: true } } } },
    },
  })
  return rows.map((a) => ({
    id: a.id,
    title: a.member
      ? `${a.member.firstName} ${a.member.lastName}`
      : a.lead
        ? a.lead.name
        : "Appointment",
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    trainer: a.trainer?.user.name ?? null,
    status: a.status,
  }))
}

async function getRecentPayments(organizationId: string) {
  const rows = await prisma.payment.findMany({
    where: { organizationId, status: "RECORDED" },
    orderBy: { paymentDate: "desc" },
    take: 6,
    select: {
      id: true,
      amountMinor: true,
      method: true,
      paymentDate: true,
      member: { select: { id: true, firstName: true, lastName: true } },
      recordedBy: { select: { name: true } },
    },
  })
  return rows.map((p) => ({
    id: p.id,
    memberId: p.member.id,
    memberName: `${p.member.firstName} ${p.member.lastName}`,
    amountMinor: p.amountMinor,
    method: p.method,
    paymentDate: p.paymentDate.toISOString(),
    recordedBy: p.recordedBy.name,
  }))
}

async function getRecentMembers(organizationId: string) {
  const rows = await prisma.member.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      status: true,
      createdAt: true,
    },
  })
  return rows.map((m) => ({
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName,
    phone: m.phone,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  }))
}

async function getNewLeads(organizationId: string) {
  const rows = await prisma.lead.findMany({
    where: {
      organizationId,
      deletedAt: null,
      stage: { in: ["NEW", "CONTACTED", "VISIT_SCHEDULED"] },
      followUpDate: { lte: endOfDay(addDays(new Date(), 3)) },
    },
    orderBy: { followUpDate: "asc" },
    take: 6,
    select: {
      id: true,
      name: true,
      source: true,
      stage: true,
      followUpDate: true,
      createdAt: true,
    },
  })
  return rows.map((l) => ({
    id: l.id,
    name: l.name,
    source: l.source,
    stage: l.stage,
    followUpDate: l.followUpDate?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
  }))
}

async function getLeadPipeline(organizationId: string) {
  const rows = await prisma.lead.groupBy({
    by: ["stage"],
    where: { organizationId, deletedAt: null },
    _count: { _all: true },
  })
  return rows.map((r) => ({ stage: r.stage, count: r._count._all }))
}

/**
 * Deduplicates the next-week appointments query across the dashboard's
 * Suspense segments within the same request (stats card + upcoming widget).
 */
export const getDashboardUpcomingAppointments = cache((organizationId: string) =>
  getNextWeekAppointments(organizationId)
)

async function getNextWeekAppointments(organizationId: string) {
  const todayStart = startOfDay(new Date())
  const rows = await prisma.appointment.findMany({
    where: {
      organizationId,
      status: "SCHEDULED",
      startsAt: { gte: todayStart, lte: endOfDay(addDays(todayStart, 7)) },
    },
    orderBy: { startsAt: "asc" },
    take: 8,
    select: {
      id: true,
      startsAt: true,
      member: { select: { firstName: true, lastName: true } },
      lead: { select: { name: true } },
    },
  })
  return rows.map((a) => ({
    id: a.id,
    title: a.member ? `${a.member.firstName} ${a.member.lastName}` : a.lead ? a.lead.name : "Appointment",
    startsAt: a.startsAt.toISOString(),
  }))
}