import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { dayKeyOf } from "@/lib/format"

import { AttendancePage } from "@/components/attendance/attendance-page"

export const metadata: Metadata = {
  title: "Attendance",
}

type SearchParams = Promise<{ date?: string; page?: string }>

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

  const [checkins, totalCount, activeQrSessions, members, locations, pendingRequests] =
    await Promise.all([
      prisma.checkIn.findMany({
        where: {
          organizationId: user.organizationId,
          dayKey: todayKey,
        },
        include: {
          member: {
            select: { id: true, firstName: true, lastName: true },
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
        },
      }),
      prisma.qRSession.findMany({
        where: {
          organizationId: user.organizationId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: {
          location: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.member.findMany({
        where: {
          organizationId: user.organizationId,
          status: "ACTIVE",
          deletedAt: null,
        },
        select: { id: true, firstName: true, lastName: true },
        orderBy: { firstName: "asc" },
      }),
      prisma.gymLocation.findMany({
        where: { organizationId: user.organizationId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.attendanceRequest.count({
        where: {
          organizationId: user.organizationId,
          status: "PENDING",
        },
      }),
    ])

  const serializedCheckins = checkins.map((c) => ({
    id: c.id,
    memberName: `${c.member.firstName} ${c.member.lastName}`,
    source: c.source,
    checkedInAt: c.checkedInAt.toISOString(),
  }))

  const serializedSessions = activeQrSessions.map((s) => ({
    id: s.id,
    label: s.label,
    locationName: s.location.name,
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
      locations={locations}
      canRecord={can(user, "attendance:record")}
      pendingRequests={pendingRequests}
    />
  )
}
