import { Suspense } from "react"
import type { Metadata } from "next"

import { requireUser } from "@/lib/auth/auth"
import { getBranchAccess } from "@/lib/branches"
import {
  NotificationsBellFallback,
  NotificationsWithCounts,
  SidebarNavWithCounts,
} from "@/components/shell/dashboard-shell-sections"
import { SidebarNav } from "@/components/shell/sidebar-nav"
import { Shell } from "@/components/shell/shell"
import {
  BranchScopeBadge,
  BranchSwitcher,
  type SwitcherBranch,
} from "@/components/shell/branch-switcher"

export const metadata: Metadata = {
  title: "Dashboard",
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Authentication/authorization stays on the critical path so every
  // dashboard route remains protected. Notifications and sidebar counts are
  // streamed in below so the shell can paint immediately after auth.
  const user = await requireUser()

  // Branch scope: OWNER = org-wide (no switcher); single = static badge;
  // multi = picker. mode "none" is fail-closed — pages gate individually.
  const access = await getBranchAccess()
  let branchSwitcher: React.ReactNode = null
  if (access.mode === "single" && access.accessibleBranches[0]) {
    const { id, name, branchCode } = access.accessibleBranches[0]
    branchSwitcher = <BranchScopeBadge branch={{ id, name, branchCode }} />
  } else if (access.mode === "multi") {
    const candidates: SwitcherBranch[] = access.accessibleBranches.map((b) => ({
      id: b.id,
      name: b.name,
      branchCode: b.branchCode,
    }))
    branchSwitcher = (
      <BranchSwitcher branches={candidates} activeBranchId={access.activeBranchId} />
    )
  }

  return (
    <Shell
      user={user}
      branchSwitcher={branchSwitcher}
      sidebarNav={
        <Suspense fallback={<SidebarNav user={user} />}>
          <SidebarNavWithCounts user={user} />
        </Suspense>
      }
      topbarActions={
        <Suspense fallback={<NotificationsBellFallback />}>
          <NotificationsWithCounts user={user} />
        </Suspense>
      }
    >
      {children}
    </Shell>
  )
}