import "server-only"

import { prisma } from "@/lib/prisma"
import { dayKeyInTimeZone } from "@/lib/memberships"
import { branchFilterWhere, branchFilterWhereRequired } from "@/lib/branch-scope"
import type { BranchFilter } from "@/lib/branch-scope"
import {
  buildAttendanceCalendar,
  buildAttendanceTrend,
  computeLifetimeStats,
  computeRangeAttendance,
  type AttendanceRange,
  type CalendarMonth,
} from "@/lib/member-attendance"

/**
 * Member-level attendance data. Every query is scoped by (organizationId,
 * memberId) — never by the gym's whole attendance dataset — and day-key
 * filtering is done with inclusive [fromKey, toKey] bounds in the
 * organization's calendar so filtering is timezone-exact.
 */

export type AttendanceCheckinRow = {
  id: string
  dayKey: string
  source: "MANUAL" | "QR_SESSION"
  checkedInAt: string
  branchName: string | null
}

export type MemberAttendanceOverview = {
  todayKey: string
  lifetime: {
    totalVisits: number
    distinctDays: number
    thisMonth: number
    thisYear: number
    avgPerWeek: number
    currentStreak: number
    longestStreak: number
  }
  lastVisit: { dayKey: string; checkedInAt: string } | null
  recent: AttendanceCheckinRow[]
}

export type MemberAttendanceView = {
  todayKey: string
  member: { id: string; name: string; memberCode: string | null; status: string }
  range: AttendanceRange
  lifetimeTotal: number
  lifetimeStreakCurrent: number
  lifetimeStreakLongest: number
  stats: {
    visits: number
    distinctDays: number
    firstVisitKey: string | null
    lastVisitKey: string | null
    avgPerWeek: number
    currentStreak: number
    longestStreak: number
  }
  lastVisit: AttendanceCheckinRow | null
  calendarMonths: CalendarMonth[]
  calendarRenderedMonths: number
  calendarTotalMonths: number
  trend: { day: string; count: number }[]
  checkIns: AttendanceCheckinRow[]
  totalCount: number
  totalPages: number
  page: number
  pageSize: number
}

function rangeWhere(
  organizationId: string,
  memberId: string,
  range: AttendanceRange
) {
  return {
    organizationId,
    memberId,
    ...(range.fromKey ? { dayKey: { gte: range.fromKey } } : {}),
    ...(range.toKey ? { dayKey: { lte: range.toKey } } : {}),
  }
}

const checkinSelect = {
  id: true,
  dayKey: true,
  source: true,
  checkedInAt: true,
  branch: { select: { name: true } },
} as const

type CheckinRow = {
  id: string
  dayKey: string
  source: "MANUAL" | "QR_SESSION"
  checkedInAt: Date
  branch: { name: string } | null
}

function serializeCheckin(row: CheckinRow): AttendanceCheckinRow {
  return {
    id: row.id,
    dayKey: row.dayKey,
    source: row.source,
    checkedInAt: row.checkedInAt.toISOString(),
    branchName: row.branch?.name ?? null,
  }
}

/**
 * Member profile summary: lifetime stats + the 20 most recent check-ins.
 * Three small, member-scoped queries (never the gym-wide set).
 */
export async function getMemberAttendanceOverview(
  organizationId: string,
  memberId: string,
  timeZone: string,
  branchFilter: BranchFilter
): Promise<MemberAttendanceOverview> {
  const todayKey = dayKeyInTimeZone(new Date(), timeZone)
  const branchWhere = branchFilterWhereRequired(branchFilter)

  const [dayKeyRows, lastRow, recent] = await Promise.all([
    prisma.checkIn.findMany({
      where: { organizationId, memberId, ...branchWhere },
      orderBy: { dayKey: "asc" },
      select: { dayKey: true },
    }),
    prisma.checkIn.findFirst({
      where: { organizationId, memberId, ...branchWhere },
      orderBy: { dayKey: "desc" },
      select: checkinSelect,
    }),
    prisma.checkIn.findMany({
      where: { organizationId, memberId, ...branchWhere },
      orderBy: { checkedInAt: "desc" },
      take: 20,
      select: checkinSelect,
    }),
  ])

  const lifetime = computeLifetimeStats(
    dayKeyRows.map((r) => r.dayKey),
    todayKey
  )

  return {
    todayKey,
    lifetime,
    lastVisit: lastRow
      ? { dayKey: lastRow.dayKey, checkedInAt: lastRow.checkedInAt.toISOString() }
      : null,
    recent: recent.map(serializeCheckin),
  }
}

/**
 * Full attendance page: range-scoped stats, calendar, trend, and a paginated
 * check-in list. All-time day keys are read once (member-scoped, small) for
 * the lifetime counter; range filtering is done against the same set. The
 * paginated detail list is computed in the database with skip/take, so no
 * unbounded payload ever reaches the browser.
 */
export async function getMemberAttendanceView(
  organizationId: string,
  memberId: string,
  timeZone: string,
  range: AttendanceRange,
  page: number,
  pageSize: number,
  branchFilter: BranchFilter
): Promise<MemberAttendanceView | null> {
  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId, deletedAt: null, ...branchFilterWhere(branchFilter, "homeBranchId") },
    select: { id: true, firstName: true, lastName: true, memberCode: true, status: true },
  })
  if (!member) return null

  const todayKey = dayKeyInTimeZone(new Date(), timeZone)
  const branchWhere = branchFilterWhereRequired(branchFilter)
  const where = { ...rangeWhere(organizationId, memberId, range), ...branchWhere }
  const skip = (page - 1) * pageSize

  const [dayKeyRows, lastRow, checkins, totalCount] = await Promise.all([
    prisma.checkIn.findMany({
      where: { organizationId, memberId, ...branchWhere },
      orderBy: { dayKey: "asc" },
      select: { dayKey: true },
    }),
    prisma.checkIn.findFirst({
      where,
      orderBy: { checkedInAt: "desc" },
      select: checkinSelect,
    }),
    prisma.checkIn.findMany({
      where,
      orderBy: { checkedInAt: "desc" },
      skip,
      take: pageSize,
      select: checkinSelect,
    }),
    prisma.checkIn.count({ where }),
  ])

  const allKeys = dayKeyRows.map((r) => r.dayKey)
  const rangeKeys = allKeys.filter(
    (k) =>
      (range.fromKey === null || k >= range.fromKey) &&
      (range.toKey === null || k <= range.toKey)
  )

  const stats = computeRangeAttendance(rangeKeys, todayKey, range.fromKey, range.toKey)
  const lifetime = computeLifetimeStats(allKeys, todayKey)

  const calendarMonths = buildAttendanceCalendar(
    rangeKeys,
    range.fromKey,
    range.toKey
  )
  const calendarTotalMonths = buildAttendanceCalendar(
    rangeKeys,
    range.fromKey,
    range.toKey,
    Number.MAX_SAFE_INTEGER
  ).length

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  return {
    todayKey,
    member: {
      id: member.id,
      name: `${member.firstName} ${member.lastName}`.trim(),
      memberCode: member.memberCode,
      status: member.status,
    },
    range,
    lifetimeTotal: lifetime.totalVisits,
    lifetimeStreakCurrent: lifetime.currentStreak,
    lifetimeStreakLongest: lifetime.longestStreak,
    stats,
    lastVisit: lastRow ? serializeCheckin(lastRow) : null,
    calendarMonths,
    calendarRenderedMonths: calendarMonths.length,
    calendarTotalMonths,
    trend: buildAttendanceTrend(rangeKeys, range.fromKey, range.toKey),
    checkIns: checkins.map(serializeCheckin),
    totalCount,
    totalPages,
    page,
    pageSize,
  }
}