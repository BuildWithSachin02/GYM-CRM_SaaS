import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { getBranchDetail, getBranchStaffPool } from "@/lib/domain/branches"
import { BranchOverview } from "@/components/branches/branch-overview"

/**
 * /dashboard/branches/[id] — quick overview for ONE branch.
 *
 * The loader calls `requireBranchView`, which loads the branch INSIDE the
 * caller's organization and applies the branch-scope gate. A foreign, unknown or
 * unassigned branch id therefore fails closed (403 / not found) before any
 * figure is aggregated, and every metric on the page is branch-attributed.
 */
export const metadata: Metadata = {
  title: "Branch Details",
}

export default async function BranchDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireUser()
  if (!can(user, "branches:view")) notFound()

  const { id } = await params
  const { branch } = await getBranchDetail(user, id)
  const pool = can(user, "branches:manage") ? await getBranchStaffPool(user) : null

  return (
    <BranchOverview
      branch={branch}
      currency={user.organization.currency}
      staff={pool?.staff ?? null}
      assignments={pool?.assignments.filter((a) => a.branchId === branch.id) ?? null}
    />
  )
}
