import { Suspense } from "react"
import type { Metadata } from "next"

import { requireUser } from "@/lib/auth/auth"
import {
  NotificationsBellFallback,
  NotificationsWithCounts,
  SidebarNavWithCounts,
} from "@/components/shell/dashboard-shell-sections"
import { SidebarNav } from "@/components/shell/sidebar-nav"
import { Shell } from "@/components/shell/shell"

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

  return (
    <Shell
      user={user}
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