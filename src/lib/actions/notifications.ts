"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { z } from "zod"

export async function markNotificationRead(notificationId: string) {
  const user = await requireUserOrThrow()
  if (!can(user, "notifications:update")) return
  const id = z.string().uuid().safeParse(notificationId)
  if (!id.success) return

  await prisma.notification.updateMany({
    where: {
      id: id.data,
      organizationId: user.organizationId,
      userId: user.id,
      isRead: false,
    },
    data: { isRead: true },
  })
  revalidatePath("/dashboard")
}

export async function markAllNotificationsRead() {
  const user = await requireUserOrThrow()
  if (!can(user, "notifications:update")) return
  await prisma.notification.updateMany({
    where: { organizationId: user.organizationId, userId: user.id, isRead: false },
    data: { isRead: true },
  })
  revalidatePath("/dashboard")
}