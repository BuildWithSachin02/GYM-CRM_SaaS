import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"

import { NotificationList } from "@/components/notifications/notification-list"

export const metadata: Metadata = {
  title: "Notifications",
}

export default async function NotificationsPage() {
  const user = await requireUser()
  if (!can(user, "notifications:view")) notFound()

  const notifications = await prisma.notification.findMany({
    where: { organizationId: user.organizationId, userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
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

  const serialized = notifications.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
  }))

  return <NotificationList notifications={serialized} />
}
