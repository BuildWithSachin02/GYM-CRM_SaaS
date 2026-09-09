import "server-only"

import { prisma } from "@/lib/prisma"
import type { NotificationType } from "@prisma/client"

type PushArgs = {
  organizationId: string
  userId: string
  type: NotificationType
  title: string
  body?: string | null
  link?: string | null
}

export async function pushNotification(args: PushArgs) {
  return prisma.notification.create({
    data: {
      organizationId: args.organizationId,
      userId: args.userId,
      type: args.type,
      title: args.title,
      body: args.body ?? null,
      link: args.link ?? null,
    },
  })
}