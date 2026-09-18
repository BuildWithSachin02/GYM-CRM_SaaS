import "server-only"

import { endOfDay, startOfDay, subDays } from "date-fns"

import { prisma } from "@/lib/prisma"
import { LIFECYCLE_STATUS_ORDER } from "@/lib/memberships"
import { getMembershipLifecycleStats } from "@/lib/domain/memberships"
import { getAttendanceTrendByDay, getRevenueAnalysis } from "@/lib/analytics"

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

export async function getReportsData(
  organizationId: string,
  range: ReportRange,
  timeZone: string
): Promise<ReportsData> {
  const days = range === "90" ? 90 : 30
  const now = new Date()
  const rangeStart = startOfDay(subDays(now, days - 1))
  const rangeEnd = endOfDay(now)

  // Canonical revenue: one org-scoped, org-timezone attribution used by the
  // KPI, the trend and both revenue breakdowns — they reconcile by
  // construction (see getRevenueAnalysis).
  const [revenueData, attendanceRange, memberGain, newLeads, conversions] =
    await Promise.all([
      getRevenueAnalysis(organizationId, timeZone, days),
      getAttendanceTrendByDay(organizationId, timeZone, days),
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
    ])

  const [attendanceTrend, leadSources, membershipStatuses, appointmentStatuses] =
    await Promise.all([
      getAttendanceTrendByDay(organizationId, timeZone, 14),
      prisma.lead.groupBy({
        by: ["source"],
        where: { organizationId, deletedAt: null, createdAt: { gte: rangeStart, lte: rangeEnd } },
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

  return {
    range,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    kpis: {
      revenue: revenueData.totalMinor,
      paymentsCount: revenueData.byMethod.reduce((acc, m) => acc + m.count, 0),
      memberGain,
      newLeads,
      conversions,
      attendanceCount: attendanceRange.reduce((acc, p) => acc + p.value, 0),
    },
    revenueTrend: revenueData.trend.map((t) => ({ day: t.label, revenue: t.value })),
    attendanceTrend: attendanceTrend.map((t) => ({ day: t.label, count: t.value })),
    paymentMethods: revenueData.byMethod.map((m) => ({
      method: m.key,
      amountMinor: m.amountMinor,
      count: m.count,
    })),
    leadSources: leadSources
      .map((r) => ({ source: r.source, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    planRevenue: revenueData.byPlan,
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
