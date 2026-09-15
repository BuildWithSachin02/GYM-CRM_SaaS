import { Bell } from "lucide-react"

import { prisma } from "@/lib/prisma"
import type { SessionUser } from "@/lib/auth/auth"
import { getSidebarCounts } from "@/lib/domain/counts"

import { NotificationsMenu } from "@/components/shell/topbar"
import { SidebarNav } from "@/components/shell/sidebar-nav"
import { Button } from "@/components/ui/button"

/**
 * Streamed sidebar navigation including live count badges.
 * Rendered inside React `<Suspense>` so the shell can paint before counts resolve.
 */
export async function SidebarNavWithCounts({ user }: { user: SessionUser }) {
  const counts = await getSidebarCounts(
    user.organizationId,
    user.organization.timezone
  )
  return <SidebarNav user={user} counts={counts} />
}

/**
 * Streamed notifications bell for the topbar.
 * Queries are scoped to the authenticated user's organization and user id.
 */
export async function NotificationsWithCounts({ user }: { user: SessionUser }) {
  const notifications = await prisma.notification.findMany({
    where: { organizationId: user.organizationId, userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      link: true,
      isRead: true,
      createdAt: true,
    },
  })

  return (
    <NotificationsMenu
      notifications={notifications.map((n) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
      }))}
      unreadCount={notifications.filter((n) => !n.isRead).length}
    />
  )
}

/**
 * Static bell shown while notifications stream in.
 * Deliberately data-free — no unread badge or list is leaked early.
 */
export function NotificationsBellFallback() {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative"
      aria-label="Notifications"
    >
      <Bell className="size-4" />
    </Button>
  )
}