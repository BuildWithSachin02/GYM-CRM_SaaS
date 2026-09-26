import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { dayKeyOf } from "@/lib/format"
import { getBranchFilterForRequest } from "@/lib/branches"
import { branchFilterWhere, branchFilterWhereRequired } from "@/lib/branch-scope"

import { AttendancePage } from "@/components/attendance/attendance-page"

export const metadata: Metadata = {
  title: "Attendance",
}

type SearchParams = Promise<{
  date?: string
  page?: string
  /** Explicit branch context from a Branches quick link (server-validated). */
  branch?: string
}>

export default async function AttendanceRoute({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await requireUser()

  if (!can(user, "attendance:view")) {
    redirect("/dashboard")
  }

  const params = await searchParams
  const todayKey = params.date?.trim() || dayKeyOf(new Date())
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1)
  const pageSize = 100
  const skip = (page - 1) * pageSize

  const filter = await getBranchFilterForRequest(params.branch)
  const branchClause = branchFilterWhereRequired(filter)
  const memberBranchClause = branchFilterWhere(filter, "homeBranchId")

  const [checkins, totalCount, activeQrSessions, members, branches, pendingRequests] =
    await Promise.all([
      prisma.checkIn.findMany({
        where: {
          organizationId: user.organizationId,
          dayKey: todayKey,
          ...branchClause,
        },
        include: {
          member: {
            select: { id: true, firstName: true, lastName: true, memberCode: true },
          },
        },
        orderBy: { checkedInAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.checkIn.count({
        where: {
          organizationId: user.organizationId,
          dayKey: todayKey,
          ...branchClause,
        },
      }),
      prisma.qRSession.findMany({
        where: {
          organizationId: user.organizationId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          ...branchClause,
        },
        include: {
          branch: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.member.findMany({
        where: {
          organizationId: user.organizationId,
          status: "ACTIVE",
          deletedAt: null,
          ...memberBranchClause,
        },
        select: { id: true, firstName: true, lastName: true, memberCode: true, phone: true },
        orderBy: { firstName: "asc" },
      }),
      prisma.branch.findMany({
        where: { organizationId: user.organizationId, status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.attendanceRequest.count({
        where: {
          organizationId: user.organizationId,
          status: "PENDING",
          ...branchClause,
        },
      }),
    ])

  const serializedCheckins = checkins.map((c) => ({
    id: c.id,
    memberName: `${c.member.firstName} ${c.member.lastName}`,
    memberCode: c.member.memberCode,
    source: c.source,
    checkedInAt: c.checkedInAt.toISOString(),
  }))

  const serializedSessions = activeQrSessions.map((s) => ({
    id: s.id,
    label: s.label,
    branchName: s.branch.name,
    expiresAt: s.expiresAt.toISOString(),
  }))

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const currentPage = Math.min(page, totalPages)

  return (
    <AttendancePage
      checkins={serializedCheckins}
      totalCount={totalCount}
      totalPages={totalPages}
      page={currentPage}
      todayKey={todayKey}
      activeQrSessions={serializedSessions}
      members={members}
      branches={branches}
      canRecord={can(user, "attendance:record")}
      pendingRequests={pendingRequests}
    />
  )
}
