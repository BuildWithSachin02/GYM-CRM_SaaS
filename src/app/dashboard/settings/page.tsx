import type { Metadata } from "next"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"

import { SettingsPage } from "@/components/settings/settings-page"

export const metadata: Metadata = {
  title: "Settings",
}

export default async function SettingsPageServer() {
  const user = await requireUser()

  const [org, staff] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        state: true,
        country: true,
        timezone: true,
      },
    }),
    prisma.user.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
      },
    }),
  ])

  const serializedOrg = org
    ? {
        id: org.id,
        name: org.name,
        phone: org.phone,
        email: org.email,
        address: org.address,
        city: org.city,
        state: org.state,
        country: org.country,
        timezone: org.timezone,
      }
    : null

  const serializedStaff = staff.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    phone: s.phone,
    role: s.role,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
  }))

  return (
    <SettingsPage
      org={serializedOrg}
      staff={serializedStaff}
      currentUserId={user.id}
      canManageSettings={can(user, "settings:manage")}
      canManageStaff={can(user, "staff:manage")}
    />
  )
}
