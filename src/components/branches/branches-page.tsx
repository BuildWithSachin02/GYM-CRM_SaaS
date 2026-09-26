"use client"

import { useMemo } from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/common/page-header"
import { BranchCard } from "@/components/branches/branch-card"
import { BranchFormDialog } from "@/components/branches/branch-form-dialog"
import type { BranchAssignment, BranchCardModel, BranchStaffOption } from "@/lib/domain/branches"

/**
 * The /dashboard/branches page.
 *
 * The staff pool (every active staff member + the UserBranch rows of the
 * branches this viewer can see) is fetched ONCE on the server and derived into
 * a per-branch map here, so opening a Staff Access dialog on any card needs no
 * extra round trip and no per-card duplication of the org's user list. When the
 * viewer may not manage staff the pool is null and no card renders the dialog.
 */

type StaffPoolValue = {
  staff: BranchStaffOption[]
  assignmentsByBranch: Map<string, { userId: string; isPrimary: boolean }[]>
}

type BranchesPageProps = {
  branches: BranchCardModel[]
  currency: string
  canCreate: boolean
  canCreateBlockedReason: string | null
  staff: BranchStaffOption[] | null
  assignments: BranchAssignment[] | null
}

export function BranchesPage({
  branches,
  currency,
  canCreate,
  canCreateBlockedReason,
  staff,
  assignments,
}: BranchesPageProps) {
  const assignmentsByBranch = useMemo(() => {
    const map = new Map<string, { userId: string; isPrimary: boolean }[]>()
    for (const row of assignments ?? []) {
      const list = map.get(row.branchId)
      if (list) list.push({ userId: row.userId, isPrimary: row.isPrimary })
      else map.set(row.branchId, [{ userId: row.userId, isPrimary: row.isPrimary }])
    }
    return map
  }, [assignments])

  const pool = useMemo<StaffPoolValue | null>(
    () => (staff ? { staff, assignmentsByBranch } : null),
    [staff, assignmentsByBranch]
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branches"
        description="Every location your gym operates from. Each branch keeps its own members, payments and attendance."
        actions={
          canCreate ? (
            <BranchFormDialog
              trigger={
                <Button>
                  <Plus className="size-4" /> Add Branch
                </Button>
              }
            />
          ) : undefined
        }
      />

      {canCreateBlockedReason && (
        <p className="text-sm text-muted-foreground">{canCreateBlockedReason}</p>
      )}

      {branches.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {canCreate
              ? "No branches yet. Add your first branch to start tracking members, payments and attendance per location."
              : "No branches are assigned to you yet. Ask an owner or admin to grant branch access."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {branches.map((branch) => (
            <BranchCard
              key={branch.id}
              branch={branch}
              currency={currency}
              staff={pool?.staff ?? []}
              assignments={pool?.assignmentsByBranch.get(branch.id) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  )
}
