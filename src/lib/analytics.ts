import "server-only"

import { prisma } from "@/lib/prisma"
import { branchFilterWhereRequired, type BranchFilter } from "@/lib/branch-scope"
import { dayKeyInTimeZone } from "@/lib/memberships"
import {
  attributeMinorByDay,
  buildTrendSeries,
  filterRecordedPayments,
  rangeKeysBetween,
  rangeKeysEndingAt,
  revenueEnvelope,
  sumByDay,
  type DayKeyRange,
  type RevenueMetric,
  type TrendPoint,
} from "@/lib/analytics-core"

export * from "@/lib/analytics-core"

/**
 * Canonical revenue analytics for an organization.
 *
 * Single source of truth: one org-scoped fetch of RECORDED payments, one
 * timezone attribution, and every derived value (KPI total, trend, payment
 * method, plan) is computed from the SAME rows over the SAME org-timezone day
 * keys. The summary card, the trend chart and the breakdowns therefore
 * reconcile by construction — there is no separate query that could drift.
 *
 * Revenue is always `Payment.amountMinor` (integer paise) for `status =
 * RECORDED` only (VOIDED payments never count), attributed to the business
 * day in the organization timezone.
 *
 * `branchFilter` (optional; omitted = org-wide) narrows the payments — and the
 * membership plan-name lookup that follows — to the caller's branch scope plus
 * organization-wide records. A fail-closed filter matches nothing.
 */
export async function getRevenueAnalysis(
  organizationId: string,
  timeZone: string,
  range: number | DayKeyRange,
  branchFilter?: BranchFilter
): Promise<{
  todayKey: string
  keys: string[]
  byDay: Map<string, number>
  totalMinor: number
  trend: TrendPoint[]
  byMethod: RevenueMetric[]
  byPlan: { planName: string; amountMinor: number; count: number }[]
}> {
  const todayKey = dayKeyInTimeZone(new Date(), timeZone)
  const keys =
    typeof range === "number"
      ? rangeKeysEndingAt(todayKey, range)
      : rangeKeysBetween(range.fromKey, range.toKey)
  const keySet = new Set(keys)
  const { gte, lte } = revenueEnvelope(keys)
  const branchWhere = branchFilterWhereRequired(branchFilter ?? { kind: "all" })

  const fetched = await prisma.payment.findMany({
    where: {
      organizationId,
      status: "RECORDED",
      paymentDate: { gte, lte },
      ...branchWhere,
    },
    select: {
      id: true,
      memberId: true,
      membershipId: true,
      amountMinor: true,
      method: true,
      paymentDate: true,
    },
  })

  const rows = filterRecordedPayments(fetched)

  const byDay = attributeMinorByDay(rows, timeZone)
  const totalMinor = sumByDay(byDay, keys)
  const trend = buildTrendSeries(byDay, keys)

  const methodAgg = new Map<string, { amountMinor: number; count: number }>()
  const planAgg = new Map<string, { amountMinor: number; count: number }>()
  const membershipIds = new Set<string>()

  for (const r of rows) {
    const dayKey = dayKeyInTimeZone(r.paymentDate, timeZone)
    if (!keySet.has(dayKey)) continue
    const m = methodAgg.get(r.method) ?? { amountMinor: 0, count: 0 }
    m.amountMinor += r.amountMinor
    m.count++
    methodAgg.set(r.method, m)
    if (r.membershipId) membershipIds.add(r.membershipId)
  }

  const planNameById = new Map<string, string>()
  if (membershipIds.size > 0) {
    const memberships = await prisma.membership.findMany({
      where: { id: { in: Array.from(membershipIds) }, organizationId, ...branchWhere },
      select: { id: true, plan: { select: { name: true } } },
    })
    for (const m of memberships) planNameById.set(m.id, m.plan.name)
  }

  for (const r of rows) {
    const dayKey = dayKeyInTimeZone(r.paymentDate, timeZone)
    if (!keySet.has(dayKey)) continue
    const name = r.membershipId ? (planNameById.get(r.membershipId) ?? "Unattached") : "Unattached"
    const p = planAgg.get(name) ?? { amountMinor: 0, count: 0 }
    p.amountMinor += r.amountMinor
    p.count++
    planAgg.set(name, p)
  }

  return {
    todayKey,
    keys,
    byDay,
    totalMinor,
    trend,
    byMethod: Array.from(methodAgg.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.amountMinor - a.amountMinor),
    byPlan: Array.from(planAgg.entries())
      .map(([planName, v]) => ({ planName, ...v }))
      .sort((a, b) => b.amountMinor - a.amountMinor),
  }
}

/**
 * Attendance trend in org-timezone days: `days` calendar-day buckets ending
 * today, or an explicit inclusive day-key range. `branchFilter` (optional;
 * omitted = org-wide) narrows the check-ins to the caller's branch scope plus
 * organization-wide records.
 */
export async function getAttendanceTrendByDay(
  organizationId: string,
  timeZone: string,
  range: number | DayKeyRange,
  branchFilter?: BranchFilter
): Promise<TrendPoint[]> {
  const todayKey = dayKeyInTimeZone(new Date(), timeZone)
  const keys =
    typeof range === "number"
      ? rangeKeysEndingAt(todayKey, range)
      : rangeKeysBetween(range.fromKey, range.toKey)
  const rows = await prisma.checkIn.groupBy({
    by: ["dayKey"],
    where: {
      organizationId,
      dayKey: { in: keys },
      ...branchFilterWhereRequired(branchFilter ?? { kind: "all" }),
    },
    _count: { _all: true },
  })
  const byDay = new Map(rows.map((r) => [r.dayKey, r._count._all]))
  return buildTrendSeries(byDay, keys)
}