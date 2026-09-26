import "server-only"

import {
  endOfDay,
  startOfDay,
} from "date-fns"
import { cache } from "react"

import { prisma } from "@/lib/prisma"
import {
  branchFilterWhere,
  branchFilterWhereRequired,
  type BranchFilter,
} from "@/lib/branch-scope"
import { getMembershipLifecycleStats } from "@/lib/domain/memberships"
import { getAttendanceTrendByDay, getRevenueAnalysis } from "@/lib/analytics"
import {
  dayKeyInTimeZone,
  daysBetweenKeys,
  pickPrimaryMembership,
} from "@/lib/memberships"

const DAY = 24 * 60 * 60 * 1000

/**
 * The org-wide scope used whenever a caller omits the branch filter. A single
 * shared reference so the React-cached loaders below still deduplicate on it.
 */
const ORG_WIDE: BranchFilter = { kind: "all" }

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
    memberCode: string | null
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
    memberCode: string | null
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
    memberCode: string | null
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
  timeZone: string,
  branchFilter?: BranchFilter
): Promise<DashboardData> {
  const [statsData, trends, activity, remaining] = await Promise.all([
    getDashboardStatsData(organizationId, timeZone, branchFilter),
    getDashboardTrendsData(organizationId, timeZone, branchFilter),
    getDashboardActivityData(organizationId, branchFilter),
    getDashboardRemainingData(organizationId, timeZone, branchFilter),
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
 *
 * `branchFilter` is optional (omitted = org-wide). A fail-closed filter makes
 * every stat zero because each query matches nothing.
 */
export async function getDashboardStatsData(
  organizationId: string,
  timeZone: string,
  branchFilter?: BranchFilter
): Promise<DashboardStatsData> {
  const todayEnd = endOfDay(new Date())
  const todayKey = dayKeyInTimeZone(new Date(), timeZone)
  const branchFilterOrAll = branchFilter ?? ORG_WIDE
  // Two classes of model, two builders: Lead.branchId is NULLABLE (a website
  // lead has no branch yet) so it keeps the org-wide arm, while CheckIn.branchId
  // is NOT NULL and must never receive one.
  const leadWhere = branchFilterWhere(branchFilterOrAll)
  const checkInWhere = branchFilterWhereRequired(branchFilterOrAll)
  // Members are scoped by their home branch, not by a branch column of their own.
  const memberBranchWhere = branchFilterWhere(branchFilterOrAll, "homeBranchId")

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
    getMembershipLifecycleStats(organizationId, timeZone, branchFilter),
    prisma.member.count({
      where: { organizationId, deletedAt: null, ...memberBranchWhere },
    }),
    prisma.member.count({
      where: {
        organizationId,
        deletedAt: null,
        status: "ACTIVE",
        ...memberBranchWhere,
      },
    }),
    prisma.checkIn.count({ where: { organizationId, dayKey: todayKey, ...checkInWhere } }),
    // Canonical today revenue: same org-timezone attribution as every other
    // revenue chart (see getRevenueAnalysis).
    getRevenueAnalysis(organizationId, timeZone, 1, branchFilter).then((r) => r.totalMinor),
    prisma.lead.count({
      where: { organizationId, deletedAt: null, stage: "NEW", ...leadWhere },
    }),
    prisma.lead.count({
      where: {
        organizationId,
        deletedAt: null,
        stage: { in: ["NEW", "CONTACTED", "VISIT_SCHEDULED", "VISIT_DONE"] },
        followUpDate: { lte: todayEnd },
        ...leadWhere,
      },
    }),
    getDashboardUpcomingAppointments(organizationId, branchFilterOrAll),
  ])

  return {
    stats: {
      totalMembers,
      activeMembers,
      expiringSoon7: lifecycleStats.members.EXPIRING_SOON,
      expiredCount: lifecycleStats.members.EXPIRED,
      todayAttendance,
      todayRevenue,
      newLeads,
      pendingFollowUps,
    },
    upcomingCount: nextWeekAppointments.length,
  }
}

/**
 * Segment loader for the trend charts (revenue + attendance).
 * Both trends use the same org-timezone day-key attribution as the stat
 * cards, so "today's revenue" reconciles with the last point of the revenue
 * trend and the attendance counts reconcile with the attendance trend.
 * `branchFilter` (optional; omitted = org-wide) narrows both series.
 */
export async function getDashboardTrendsData(
  organizationId: string,
  timeZone: string,
  branchFilter?: BranchFilter
): Promise<Pick<DashboardData, "revenueTrend" | "attendanceTrend">> {
  const [revenue, attendance] = await Promise.all([
    getRevenueAnalysis(organizationId, timeZone, 30, branchFilter),
    getAttendanceTrendByDay(organizationId, timeZone, 14, branchFilter),
  ])
  return {
    revenueTrend: revenue.trend.map((t) => ({ day: t.label, revenue: t.value })),
    attendanceTrend: attendance.map((t) => ({ day: t.label, count: t.value })),
  }
}

/**
 * Segment loader for recent activity widgets (payments, members, leads).
 * `branchFilter` (optional; omitted = org-wide) narrows every widget.
 */
export async function getDashboardActivityData(
  organizationId: string,
  branchFilter?: BranchFilter
): Promise<
  Pick<DashboardData, "recentPayments" | "recentMembers" | "newLeadsToday" | "leadPipeline">
> {
  const filter = branchFilter ?? ORG_WIDE
  const [recentPayments, recentMembers, newLeadsToday, leadPipeline] =
    await Promise.all([
      getRecentPayments(organizationId, filter),
      getRecentMembers(organizationId, filter),
      getNewLeads(organizationId, filter),
      getLeadPipeline(organizationId, filter),
    ])
  return { recentPayments, recentMembers, newLeadsToday, leadPipeline }
}

/**
 * Segment loader for the remaining dashboard widgets
 * (expiring, today's appointments, overdue tasks, upcoming appointments).
 * `branchFilter` (optional; omitted = org-wide) narrows every widget.
 */
export async function getDashboardRemainingData(
  organizationId: string,
  timeZone: string,
  branchFilter?: BranchFilter
): Promise<
  Pick<
    DashboardData,
    "expiringMemberships" | "todayAppointments" | "overdueTasks" | "nextWeekAppointments"
  >
> {
  const filter = branchFilter ?? ORG_WIDE
  const [expiringMemberships, todayAppointments, overdueTasks, nextWeekAppointments] =
    await Promise.all([
      getExpiringMemberships(organizationId, timeZone, filter),
      getTodayAppointments(organizationId, filter),
      getOverdueTasks(organizationId, filter),
      getDashboardUpcomingAppointments(organizationId, filter),
    ])
  return { expiringMemberships, todayAppointments, overdueTasks, nextWeekAppointments }
}

function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * DAY)
}

/**
 * Members whose *effective coverage* ends within the next 30 days.
 *
 * "Expiring" is derived from the member's full valid timeline (all non-
 * cancelled records merged into coverage intervals), never from a single
 * record's DB status. A member whose records chain back-to-back or overlap
 * keeps their coverage (and so is NOT listed here) until the farthest covered
 * day. Members not covered today (already expired, or only upcoming) are
 * likewise excluded — they need a different follow-up, not an "expiring" badge.
 *
 * Only memberships inside the branch scope are scanned, so coverage is derived
 * from the branches the viewer can actually see.
 */
async function getExpiringMemberships(
  organizationId: string,
  timeZone: string,
  branchFilter: BranchFilter
) {
  const today = new Date()
  const todayKey = dayKeyInTimeZone(today, timeZone)
  const rows = await prisma.membership.findMany({
    where: { organizationId, ...branchFilterWhereRequired(branchFilter) },
    select: {
      id: true,
      memberId: true,
      startDate: true,
      endDate: true,
      status: true,
      plan: { select: { name: true } },
      member: { select: { id: true, firstName: true, lastName: true, memberCode: true } },
    },
  })

  const byMember = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = byMember.get(r.member.id) ?? []
    list.push(r)
    byMember.set(r.member.id, list)
  }

  return Array.from(byMember.values())
    .map((list) => {
      const picked = pickPrimaryMembership(list, timeZone, today)
      if (!picked) return null
      const { row, coverage } = picked
      if (!coverage.coveredToday || !coverage.currentInterval) return null
      const daysLeft = daysBetweenKeys(todayKey, coverage.currentInterval.endKey)
      if (daysLeft < 0 || daysLeft > 30) return null
      return {
        id: row.id,
        memberName: `${row.member.firstName} ${row.member.lastName}`,
        memberCode: row.member.memberCode,
        memberId: row.member.id,
        planName: row.plan.name,
        endDate: coverage.currentInterval.endKey,
        daysLeft,
      }
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 12)
}

async function getOverdueTasks(organizationId: string, branchFilter: BranchFilter) {
  const rows = await prisma.task.findMany({
    where: {
      organizationId,
      status: { in: ["TODO", "IN_PROGRESS"] },
      dueDate: { lt: endOfDay(new Date()) },
      ...branchFilterWhere(branchFilter),
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

async function getTodayAppointments(organizationId: string, branchFilter: BranchFilter) {
  const todayStart = startOfDay(new Date())
  const todayEnd = endOfDay(new Date())
  const rows = await prisma.appointment.findMany({
    where: {
      organizationId,
      startsAt: { gte: todayStart, lte: todayEnd },
      ...branchFilterWhere(branchFilter),
    },
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

async function getRecentPayments(organizationId: string, branchFilter: BranchFilter) {
  const rows = await prisma.payment.findMany({
    where: { organizationId, status: "RECORDED", ...branchFilterWhereRequired(branchFilter) },
    orderBy: { paymentDate: "desc" },
    take: 6,
    select: {
      id: true,
      amountMinor: true,
      method: true,
      paymentDate: true,
      member: { select: { id: true, firstName: true, lastName: true, memberCode: true } },
      recordedBy: { select: { name: true } },
    },
  })
  return rows.map((p) => ({
    id: p.id,
    memberId: p.member.id,
    memberName: `${p.member.firstName} ${p.member.lastName}`,
    memberCode: p.member.memberCode,
    amountMinor: p.amountMinor,
    method: p.method,
    paymentDate: p.paymentDate.toISOString(),
    recordedBy: p.recordedBy.name,
  }))
}

async function getRecentMembers(organizationId: string, branchFilter: BranchFilter) {
  const rows = await prisma.member.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...branchFilterWhere(branchFilter, "homeBranchId"),
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      memberCode: true,
      status: true,
      createdAt: true,
    },
  })
  return rows.map((m) => ({
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName,
    phone: m.phone,
    memberCode: m.memberCode,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  }))
}

async function getNewLeads(organizationId: string, branchFilter: BranchFilter) {
  const rows = await prisma.lead.findMany({
    where: {
      organizationId,
      deletedAt: null,
      stage: { in: ["NEW", "CONTACTED", "VISIT_SCHEDULED"] },
      followUpDate: { lte: endOfDay(addDays(new Date(), 3)) },
      ...branchFilterWhere(branchFilter),
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

async function getLeadPipeline(organizationId: string, branchFilter: BranchFilter) {
  const rows = await prisma.lead.groupBy({
    by: ["stage"],
    where: { organizationId, deletedAt: null, ...branchFilterWhere(branchFilter) },
    _count: { _all: true },
  })
  return rows.map((r) => ({ stage: r.stage, count: r._count._all }))
}

/**
 * Deduplicates the next-week appointments query across the dashboard's
 * Suspense segments within the same request (stats card + upcoming widget).
 * The branch filter is part of the cache key: the same organization yields
 * different rows per branch scope.
 */
export const getDashboardUpcomingAppointments = cache(
  (organizationId: string, branchFilter: BranchFilter) =>
    getNextWeekAppointments(organizationId, branchFilter)
)

async function getNextWeekAppointments(organizationId: string, branchFilter: BranchFilter) {
  const todayStart = startOfDay(new Date())
  const rows = await prisma.appointment.findMany({
    where: {
      organizationId,
      status: "SCHEDULED",
      startsAt: { gte: todayStart, lte: endOfDay(addDays(todayStart, 7)) },
      ...branchFilterWhere(branchFilter),
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