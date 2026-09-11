import type { Metadata } from "next"

import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/auth/auth"
import { getSidebarCounts } from "@/lib/domain/counts"
import { Shell } from "@/components/shell/shell"

export const metadata: Metadata = {
  title: "Dashboard",
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()

  const [notifications, sidebarCounts] = await Promise.all([
    prisma.notification.findMany({
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
    }),
    getSidebarCounts(user.organizationId, user.organization.timezone),
  ])

  return (
    <Shell
      user={user}
      notifications={notifications.map((n) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
      }))}
      sidebarCounts={sidebarCounts}
    >
      {children}
    </Shell>
  )
}