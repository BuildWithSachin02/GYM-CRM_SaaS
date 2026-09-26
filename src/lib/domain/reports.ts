import "server-only"

import { prisma } from "@/lib/prisma"
import { branchFilterWhere, type BranchFilter } from "@/lib/branch-scope"
import { LIFECYCLE_STATUS_ORDER } from "@/lib/memberships"
import { addDaysToKey, utcInstantForKey } from "@/lib/memberships"
import { getMembershipLifecycleStats } from "@/lib/domain/memberships"
import {
  getAttendanceTrendByDay,
  getRevenueAnalysis,
  type ReportRange,
} from "@/lib/analytics"

export type { ReportRange } from "@/lib/analytics"

export type ReportQuery = {
  range: ReportRange
  fromKey: string
  toKey: string
}

export type ReportsData = {
  range: ReportRange
  fromKey: string
  toKey: string
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

/**
 * Every section runs over the SAME inclusive [fromKey, toKey] span AND the
 * SAME branch scope, so the KPI, both trends and every breakdown reconcile by
 * construction. A fail-closed filter ("none") short-circuits to an empty
 * report instead of querying.
 */
export async function getReportsData(
  organizationId: string,
  timeZone: string,
  query: ReportQuery,
  branchFilter: BranchFilter
): Promise<ReportsData> {
  const { range, fromKey, toKey } = query

  // Every section below runs over the SAME inclusive [fromKey, toKey] span, so
  // the KPI, both trends and every breakdown reconcile by construction.

  // Instant bounds are org-timezone local midnights: inclusive From 00:00 up
  // to but not including 00:00 of the day after To (i.e. the whole To day).
  // `lt` keeps the edge exact — a record at 23:59:59.999 on To still counts.
  const rangeStart = utcInstantForKey(fromKey, timeZone)
  const rangeEnd = utcInstantForKey(addDaysToKey(toKey, 1), timeZone)

  if (branchFilter.kind === "none") {
    return {
      range,
      fromKey,
      toKey,
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      kpis: {
        revenue: 0,
        memberGain: 0,
        newLeads: 0,
        conversions: 0,
        attendanceCount: 0,
        paymentsCount: 0,
      },
      revenueTrend: [],
      attendanceTrend: [],
      paymentMethods: [],
      leadSources: [],
      planRevenue: [],
      membershipStatuses: LIFECYCLE_STATUS_ORDER.map((status) => ({ status, count: 0 })),
      appointmentStatuses: [],
    }
  }

  // Canonical revenue: one org-scoped, org-timezone attribution used by the
  // KPI, the trend and both revenue breakdowns — they reconcile by
  // construction (see getRevenueAnalysis).
  const [revenueData, attendanceTrend, memberGain, newLeads, conversions] =
    await Promise.all([
      getRevenueAnalysis(organizationId, timeZone, { fromKey, toKey }, branchFilter),
      getAttendanceTrendByDay(organizationId, timeZone, { fromKey, toKey }, branchFilter),
      prisma.member.count({
        where: {
          organizationId,
          deletedAt: null,
          createdAt: { gte: rangeStart, lt: rangeEnd },
          ...branchFilterWhere(branchFilter, "homeBranchId"),
        },
      }),
      prisma.lead.count({
        where: {
          organizationId,
          deletedAt: null,
          createdAt: { gte: rangeStart, lt: rangeEnd },
          ...branchFilterWhere(branchFilter),
        },
      }),
      prisma.lead.count({
        where: {
          organizationId,
          deletedAt: null,
          convertedAt: { gte: rangeStart, lt: rangeEnd },
          ...branchFilterWhere(branchFilter),
        },
      }),
    ])

  const [leadSources, membershipStatuses, appointmentStatuses] =
    await Promise.all([
      prisma.lead.groupBy({
        by: ["source"],
        where: {
          organizationId,
          deletedAt: null,
          createdAt: { gte: rangeStart, lt: rangeEnd },
          ...branchFilterWhere(branchFilter),
        },
        _count: { _all: true },
      }),
      // Membership statuses are record-level and date-derived (UPCOMING /
      // ACTIVE / EXPIRING_SOON / EXPIRED / CANCELLED / PAUSED) so the report
      // reflects business state, not the write-time DB enum.
      getMembershipLifecycleStats(organizationId, timeZone, branchFilter).then(
        (s) => s.records
      ),
      prisma.appointment.groupBy({
        by: ["status"],
        where: { organizationId, ...branchFilterWhere(branchFilter) },
        _count: { _all: true },
      }),
    ])

  return {
    range,
    fromKey,
    toKey,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    kpis: {
      revenue: revenueData.totalMinor,
      paymentsCount: revenueData.byMethod.reduce((acc, m) => acc + m.count, 0),
      memberGain,
      newLeads,
      conversions,
      attendanceCount: attendanceTrend.reduce((acc, p) => acc + p.value, 0),
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