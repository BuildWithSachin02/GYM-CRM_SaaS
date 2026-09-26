import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { getBranchDirectory, getBranchStaffPool } from "@/lib/domain/branches"
import { BranchesPage } from "@/components/branches/branches-page"

/**
 * /dashboard/branches — the canonical branch management module.
 *
 * Gates:
 *   `branches:view` decides whether the page exists at all (a 404, exactly like
 *   every other module page) and the LOADER additionally fails closed for a
 *   restricted user with no branch assignment. The loader narrows the branch
 *   list to what this viewer may see, so a receptionist never receives an org
 *   branch they are not assigned to.
 */
export const metadata: Metadata = {
  title: "Branches",
}

export default async function BranchesRoute() {
  const user = await requireUser()
  if (!can(user, "branches:view")) notFound()

  const directory = await getBranchDirectory(user)
  // The staff pool is only fetched for a viewer who may manage staff access;
  // it is loaded once here and shared with every card.
  const pool = can(user, "branches:manage") ? await getBranchStaffPool(user) : null

  return (
    <BranchesPage
      branches={directory.branches}
      currency={user.organization.currency}
      canCreate={directory.canCreate}
      canCreateBlockedReason={directory.canCreateBlockedReason}
      staff={pool?.staff ?? null}
      assignments={pool?.assignments ?? null}
    />
  )
}
