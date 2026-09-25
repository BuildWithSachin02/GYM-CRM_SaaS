import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"

import { SettingsPage } from "@/components/settings/settings-page"

export const metadata: Metadata = {
  title: "Settings",
}

export default async function SettingsPageServer() {
  const user = await requireUser()
  if (!can(user, "settings:view")) notFound()

  const org = await prisma.organization.findUnique({
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
  })

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

  return (
    <SettingsPage
      org={serializedOrg}
      canManageSettings={can(user, "settings:manage")}
      canManageStaff={can(user, "staff:manage")}
      isOwner={user.role === "OWNER"}
    />
  )
}
