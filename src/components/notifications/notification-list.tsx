"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { Bell, CheckCheck } from "lucide-react"
import type { NotificationType } from "@prisma/client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/common/empty-state"
import { PageHeader } from "@/components/common/page-header"
import { formatDateTime } from "@/lib/format"
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/actions/notifications"

export type NotificationRow = {
  id: string
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  isRead: boolean
  createdAt: string
}

type NotificationListProps = {
  notifications: NotificationRow[]
}

const NOTIFICATION_TYPES: Record<NotificationType, { label: string }> = {
  MEMBERSHIP_EXPIRING: { label: "Membership expiring" },
  MEMBERSHIP_EXPIRED: { label: "Membership expired" },
  NEW_LEAD: { label: "New lead" },
  TASK_ASSIGNED: { label: "Task assigned" },
  TASK_OVERDUE: { label: "Task overdue" },
  APPOINTMENT_REMINDER: { label: "Appointment reminder" },
  PAYMENT_RECORDED: { label: "Payment recorded" },
  LEAD_CONVERTED: { label: "Lead converted" },
  ATTENDANCE_REQUEST: { label: "Attendance request" },
}

export function NotificationList({ notifications }: NotificationListProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const unreadCount = notifications.filter((n) => !n.isRead).length

  function onMarkAllRead() {
    startTransition(async () => {
      await markAllNotificationsRead()
      toast.success("All notifications marked as read")
      router.refresh()
    })
  }

  function onOpen(notification: NotificationRow) {
    startTransition(async () => {
      if (!notification.isRead) {
        await markNotificationRead(notification.id)
      }
      router.refresh()
      if (notification.link) {
        router.push(notification.link)
      }
    })
  }

  return (
    <div>
      <PageHeader
        title="Notifications"
        description={`${unreadCount} unread`}
        actions={
          <Button
            variant="outline"
            disabled={unreadCount === 0 || isPending}
            onClick={onMarkAllRead}
          >
            <CheckCheck className="size-4" />
            Mark all read
          </Button>
        }
      />

      {notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications"
          description="You're all caught up."
        />
      ) : (
        <div className="divide-y rounded-lg border">
          {notifications.map((n) => {
            const typeLabel = NOTIFICATION_TYPES[n.type]?.label ?? n.type
            const content = (
              <div
                className={[
                  "flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/60",
                  !n.isRead && "bg-primary/5",
                ].join(" ")}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-medium">{n.title}</span>
                  {!n.isRead && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                </span>
                {n.body && (
                  <span className="text-sm text-muted-foreground">{n.body}</span>
                )}
                <span className="flex w-full items-center justify-between gap-2">
                  <Badge variant="secondary" className="text-[11px]">
                    {typeLabel}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground/70">
                    {formatDateTime(n.createdAt)}
                  </span>
                </span>
              </div>
            )

            return n.link ? (
              <Link
                key={n.id}
                href={n.link}
                onClick={(e) => {
                  e.preventDefault()
                  onOpen(n)
                }}
                className="block decoration-transparent"
              >
                {content}
              </Link>
            ) : (
              <button
                key={n.id}
                type="button"
                disabled={isPending}
                onClick={() => onOpen(n)}
                className="block w-full"
              >
                {content}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
