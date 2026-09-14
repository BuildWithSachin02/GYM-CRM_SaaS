import "server-only"

import { endOfDay, format, startOfDay, subDays } from "date-fns"

import { prisma } from "@/lib/prisma"
import { dayKeyOf } from "@/lib/format"
import { LIFECYCLE_STATUS_ORDER } from "@/lib/memberships"
import { getMembershipLifecycleStats } from "@/lib/domain/memberships"

const DAY = 24 * 60 * 60 * 1000

export type ReportRange = "30" | "90"

export type ReportsData = {
  range: ReportRange
  rangeStart: string
  rangeEnd: string
  kpis: {
    revenue: number
    memberGain: number
    newLeads: number
    conversions: number
    attendanceCount: number
    paymentsCount: number
  }
  revenueTrend: { day: string; revenue: number }[]
  attendanceTrend: { day: string; count: number }[]
  paymentMethods: { method: string; amountMinor: number; count: number }[]
  leadSources: { source: string; count: number }[]
  planRevenue: { planName: string; amountMinor: number; count: number }[]
  membershipStatuses: { status: string; count: number }[]
  appointmentStatuses: { status: string; count: number }[]
}

function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * DAY)
}

export async function getReportsData(
  organizationId: string,
  range: ReportRange,
  timeZone: string
): Promise<ReportsData> {
  const days = range === "90" ? 90 : 30
  const now = new Date()
  const rangeStart = startOfDay(subDays(now, days - 1))
  const rangeEnd = endOfDay(now)

  const revenueWhere = {
    organizationId,
    status: "RECORDED" as const,
    paymentDate: { gte: rangeStart, lte: rangeEnd },
  }

  const [revenueAgg, paymentsCount, memberGain, newLeads, conversions, attendanceCount] =
    await Promise.all([
      prisma.payment.aggregate({ where: revenueWhere, _sum: { amountMinor: true } }),
      prisma.payment.count({ where: revenueWhere }),
      prisma.member.count({
        where: { organizationId, deletedAt: null, createdAt: { gte: rangeStart, lte: rangeEnd } },
      }),
      prisma.lead.count({
        where: { organizationId, deletedAt: null, createdAt: { gte: rangeStart, lte: rangeEnd } },
      }),
      prisma.lead.count({
        where: {
          organizationId,
          deletedAt: null,
          convertedAt: { gte: rangeStart, lte: rangeEnd },
        },
      }),
      prisma.checkIn.count({
        where: { organizationId, checkedInAt: { gte: rangeStart, lte: rangeEnd } },
      }),
    ])

  const [revenueTrend, attendanceTrend, paymentMethods, leadSources, planRevenueGroups, unattachedRevenue, membershipStatuses, appointmentStatuses] =
    await Promise.all([
      getRevenueTrend(organizationId, rangeStart, days),
      getAttendanceTrend(organizationId),
      prisma.payment.groupBy({
        by: ["method"],
        where: revenueWhere,
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      prisma.lead.groupBy({
        by: ["source"],
        where: { organizationId, deletedAt: null, createdAt: { gte: rangeStart, lte: rangeEnd } },
        _count: { _all: true },
      }),
      prisma.payment.groupBy({
        by: ["membershipId"],
        where: { ...revenueWhere, membershipId: { not: null } },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      prisma.payment.aggregate({
        where: { ...revenueWhere, membershipId: null },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      // Membership statuses are record-level and date-derived (UPCOMING /
      // ACTIVE / EXPIRING_SOON / EXPIRED / CANCELLED / PAUSED) so the report
      // reflects business state, not the write-time DB enum.
      getMembershipLifecycleStats(organizationId, timeZone).then(
        (s) => s.records
      ),
      prisma.appointment.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { _all: true },
      }),
    ])

  const membershipIds = planRevenueGroups
    .map((g) => g.membershipId)
    .filter((id): id is string => id !== null)
  const planLinks = membershipIds.length
    ? await prisma.membership.findMany({
        where: { id: { in: membershipIds }, organizationId },
        select: { id: true, plan: { select: { name: true } } },
      })
    : []
  const planNameById = new Map(planLinks.map((m) => [m.id, m.plan.name]))

  const planRevenueMap = new Map<string, { amountMinor: number; count: number }>()
  for (const g of planRevenueGroups) {
    const name = g.membershipId
      ? planNameById.get(g.membershipId) ?? "Unattached"
      : "Unattached"
    const entry = planRevenueMap.get(name) ?? { amountMinor: 0, count: 0 }
    entry.amountMinor += g._sum.amountMinor ?? 0
    entry.count += g._count._all
    planRevenueMap.set(name, entry)
  }
  if (unattachedRevenue._count._all > 0) {
    const entry = planRevenueMap.get("Unattached") ?? { amountMinor: 0, count: 0 }
    entry.amountMinor += unattachedRevenue._sum.amountMinor ?? 0
    entry.count += unattachedRevenue._count._all
    planRevenueMap.set("Unattached", entry)
  }
  const planRevenue = Array.from(planRevenueMap.entries())
    .map(([planName, v]) => ({ planName, ...v }))
    .sort((a, b) => b.amountMinor - a.amountMinor)

  return {
    range,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    kpis: {
      revenue: revenueAgg._sum.amountMinor ?? 0,
      paymentsCount,
      memberGain,
      newLeads,
      conversions,
      attendanceCount,
    },
    revenueTrend,
    attendanceTrend,
    paymentMethods: paymentMethods
      .map((r) => ({
        method: r.method,
        amountMinor: r._sum.amountMinor ?? 0,
        count: r._count._all,
      }))
      .sort((a, b) => b.amountMinor - a.amountMinor),
    leadSources: leadSources
      .map((r) => ({ source: r.source, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    planRevenue,
    membershipStatuses: LIFECYCLE_STATUS_ORDER.map((status) => ({
      status,
      count: membershipStatuses[status] ?? 0,
    })),
    appointmentStatuses: appointmentStatuses.map((r) => ({
      status: r.status,
      count: r._count._all,
    })),
  }
}

async function getRevenueTrend(organizationId: string, from: Date, days: number) {
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
  return Array.from({ length: days }, (_, i) => {
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
