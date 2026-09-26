import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { requireBranchAccess, getBranchFilter } from "@/lib/branches"
import { branchFilterWhereRequired } from "@/lib/branch-scope"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { dayKeyInTimeZone } from "@/lib/memberships"

import { AttendanceRequestsList } from "@/components/attendance/attendance-requests-list"

export const metadata: Metadata = {
  title: "Attendance Requests",
}

export default async function AttendanceRequestsRoute() {
  const user = await requireUser()

  if (!can(user, "attendance:view")) {
    redirect("/dashboard")
  }
  await requireBranchAccess()
  const branchClause = branchFilterWhereRequired(await getBranchFilter())

  const timeZone = user.organization.timezone
  const todayKey = dayKeyInTimeZone(new Date(), timeZone)

  const requests = await prisma.attendanceRequest.findMany({
    where: { organizationId: user.organizationId, ...branchClause },
    orderBy: [{ requestedAt: "desc" }],
    take: 200,
    include: {
      member: {
        select: { id: true, firstName: true, lastName: true, status: true, memberCode: true },
      },
      approvedBy: { select: { name: true } },
      rejectedBy: { select: { name: true } },
    },
  })

  const pending = requests.filter((r) => r.status === "PENDING")
  const resolved = requests.filter((r) => r.status !== "PENDING")

  const serialized = [...pending, ...resolved].map((r) => ({
    id: r.id,
    memberId: r.member.id,
    memberName: `${r.member.firstName} ${r.member.lastName}`,
    memberCode: r.member.memberCode,
    memberActive: r.member.status === "ACTIVE",
    dayKey: r.dayKey,
    requestedAt: r.requestedAt.toISOString(),
    status: r.status,
    rejectionReason: r.rejectionReason,
    approvedBy: r.approvedBy?.name ?? null,
    rejectedBy: r.rejectedBy?.name ?? null,
    stale: r.dayKey < todayKey,
  }))

  const canDecide =
    can(user, "attendance:record") && ["OWNER", "ADMIN"].includes(user.role)

  return (
    <AttendanceRequestsList
      requests={serialized}
      canDecide={canDecide}
      pendingCount={pending.length}
    />
  )
}