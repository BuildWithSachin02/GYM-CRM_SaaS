"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { Building2, Check, ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { setBranchContext } from "@/lib/actions/branch-context"

export type SwitcherBranch = {
  id: string
  name: string
  branchCode: string
}

export function branchScopeLabel(branch: SwitcherBranch | null): string {
  if (!branch) return "All branches"
  return `${branch.branchCode} · ${branch.name}`
}

/**
 * Static read-only badge shown when a restricted user has exactly one assigned
 * branch: their scope is unambiguous, so no switch is offered (identical UX to
 * a single-location gym).
 */
export function BranchScopeBadge({ branch }: { branch: SwitcherBranch }) {
  return (
    <span className="flex h-7 items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 text-xs text-muted-foreground">
      <Building2 className="size-3.5" />
      <span className="max-w-40 truncate">{branchScopeLabel(branch)}</span>
    </span>
  )
}

/**
 * Branch scope picker for users assigned to multiple branches. Selecting a
 * branch persists the signed `gym_branch` cookie (server-validated) and
 * refreshes the route tree so every page re-resolves its filter. Only the
 * user's accessible branches are offered — this UI can never widen scope.
 */
export function BranchSwitcher({
  branches,
  activeBranchId,
}: {
  branches: SwitcherBranch[]
  activeBranchId: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const active = branches.find((b) => b.id === activeBranchId) ?? null

  function select(branchId: string) {
    if (branchId === activeBranchId) return
    startTransition(async () => {
      await setBranchContext(branchId)
      router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs font-medium"
            aria-label="Switch branch"
          />
        }
      >
        <Building2 className="size-3.5" />
        <span className="max-w-40 truncate">{branchScopeLabel(active)}</span>
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Branch scope</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {branches.map((b) => (
          <DropdownMenuItem
            key={b.id}
            disabled={isPending}
            onClick={() => select(b.id)}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="max-w-48 truncate">{branchScopeLabel(b)}</span>
              {b.id === activeBranchId && <Check className="size-4 shrink-0" />}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}