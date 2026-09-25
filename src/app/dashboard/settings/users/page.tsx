import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { listStaffUsers } from "@/lib/actions/users"

import { UsersAccessPage } from "@/components/users/users-access-page"

export const metadata: Metadata = {
  title: "Users & Access",
}

export default async function UsersAccessSettingsPage() {
  const user = await requireUser()
  if (!can(user, "staff:manage")) notFound()

  const staff = await listStaffUsers()

  return (
    <UsersAccessPage
      staff={staff}
      actor={{ id: user.id, role: user.role, permissions: user.permissions }}
    />
  )
}