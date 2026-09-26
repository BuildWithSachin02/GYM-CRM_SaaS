import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { getBranchFilter, requireBranchAccess } from "@/lib/branches"
import { branchFilterWhere } from "@/lib/branch-scope"
import { dayKeyInTimeZone } from "@/lib/memberships"
import {
  ATTENDANCE_RANGE_PRESETS,
  resolveAttendanceRange,
} from "@/lib/member-attendance"
import { getMemberAttendanceView } from "@/lib/domain/member-attendance"

import { MemberAttendancePage } from "@/components/attendance/member-attendance-page"

export const metadata: Metadata = {
  title: "Member Attendance",
}

type PageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    preset?: string
    from?: string
    to?: string
    page?: string
  }>
}

const PAGE_SIZE = 25

export default async function MemberAttendanceRoute({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params
  const user = await requireUser()
  if (!can(user, "attendance:view")) notFound()
  await requireBranchAccess()
  const memberBranchClause = branchFilterWhere(await getBranchFilter(), "homeBranchId")

  const member = await prisma.member.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null, ...memberBranchClause },
    select: { id: true },
  })
  if (!member) notFound()

  const canCorrect =
    can(user, "attendance:record") && ["OWNER", "ADMIN"].includes(user.role)

  const correctMembers = canCorrect
    ? await prisma.member.findMany({
        where: {
          organizationId: user.organizationId,
          status: "ACTIVE",
          deletedAt: null,
          id: { not: member.id },
          ...memberBranchClause,
        },
        select: { id: true, firstName: true, lastName: true, memberCode: true, phone: true },
        orderBy: { firstName: "asc" },
      })
    : []

  const qp = await searchParams
  const timeZone = user.organization.timezone
  const todayKey = dayKeyInTimeZone(new Date(), timeZone)
  const range = resolveAttendanceRange(qp.preset, todayKey, qp.from, qp.to)
  const page = Math.max(1, parseInt(qp.page ?? "1", 10) || 1)

  const view = await getMemberAttendanceView(
    user.organizationId,
    id,
    timeZone,
    range,
    page,
    PAGE_SIZE,
    await getBranchFilter()
  )
  if (!view) notFound()

  return (
    <MemberAttendancePage
      memberId={view.member.id}
      memberName={view.member.name}
      memberCode={view.member.memberCode}
      timeZone={timeZone}
      presets={ATTENDANCE_RANGE_PRESETS.map((p) => ({
        id: p.id,
        label: p.label,
      }))}
      range={view.range}
      lifetimeTotal={view.lifetimeTotal}
      lifetimeStreakCurrent={view.lifetimeStreakCurrent}
      lifetimeStreakLongest={view.lifetimeStreakLongest}
      stats={view.stats}
      lastVisit={view.lastVisit}
      calendar={{
        months: view.calendarMonths,
        todayKey,
        renderedMonths: view.calendarRenderedMonths,
        totalMonths: view.calendarTotalMonths,
      }}
      trend={view.trend}
      checkIns={view.checkIns}
      totalCount={view.totalCount}
      totalPages={view.totalPages}
      page={view.page}
      pageSize={PAGE_SIZE}
      canCorrect={canCorrect}
      correctMembers={correctMembers}
    />
  )
}