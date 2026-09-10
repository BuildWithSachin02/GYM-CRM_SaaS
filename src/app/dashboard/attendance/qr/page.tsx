import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"

import { QrManager } from "@/components/attendance/qr-manager"

export const metadata: Metadata = {
  title: "QR Check-in",
}

export default async function QrCheckinRoute() {
  const user = await requireUser()

  if (!can(user, "attendance:record")) {
    redirect("/dashboard/attendance")
  }

  const [activeQrSessions, locations] = await Promise.all([
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
    prisma.gymLocation.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])

  const serializedSessions = activeQrSessions.map((s) => ({
    id: s.id,
    label: s.label,
    locationName: s.location.name,
    expiresAt: s.expiresAt.toISOString(),
  }))

  return (
    <QrManager
      activeQrSessions={serializedSessions}
      locations={locations}
    />
  )
}