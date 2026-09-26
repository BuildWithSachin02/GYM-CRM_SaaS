import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { getBranchFilter } from "@/lib/branches"
import { branchFilterWhereRequired } from "@/lib/branch-scope"

import { QrManager } from "@/components/attendance/qr-manager"

export const metadata: Metadata = {
  title: "QR Check-in",
}

export default async function QrCheckinRoute() {
  const user = await requireUser()

  if (!can(user, "attendance:record")) {
    redirect("/dashboard/attendance")
  }

  const filter = await getBranchFilter()
  const branchClause = branchFilterWhereRequired(filter)

  const [activeQrSessions, branches] = await Promise.all([
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
    prisma.branch.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])

  const serializedSessions = activeQrSessions.map((s) => ({
    id: s.id,
    label: s.label,
    branchName: s.branch.name,
    expiresAt: s.expiresAt.toISOString(),
  }))

  return (
    <QrManager
      activeQrSessions={serializedSessions}
      branches={branches}
    />
  )
}