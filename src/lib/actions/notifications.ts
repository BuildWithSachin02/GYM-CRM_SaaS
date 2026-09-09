"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { z } from "zod"

export async function markNotificationRead(notificationId: string) {
  const user = await requireUserOrThrow()
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
  await prisma.notification.updateMany({
    where: { organizationId: user.organizationId, userId: user.id, isRead: false },
    data: { isRead: true },
  })
  revalidatePath("/dashboard")
}