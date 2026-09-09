"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Bell,
  LogOut,
  ChevronDown,
  Users,
  Wallet,
  TrendingUp,
} from "lucide-react"
import { useState, useTransition } from "react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { logoutAction } from "@/lib/actions/auth"
import { markNotificationRead } from "@/lib/actions/notifications"
import { USER_ROLE } from "@/lib/status"
import { formatDateTime, initials } from "@/lib/format"
import type { SessionUser } from "@/lib/auth/auth"

export type ShellNotification = {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  isRead: boolean
  createdAt: string
}

function NotificationsMenu({
  notifications,
  unreadCount,
}: {
  notifications: ShellNotification[]
  unreadCount: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)

  function markRead(id: string, link?: string | null) {
    startTransition(async () => {
      await markNotificationRead(id)
      router.refresh()
    })
    if (link) {
      router.push(link)
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label="Notifications"
          />
        }
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="text-sm font-semibold">Notifications</p>
          {unreadCount > 0 && (
            <Badge variant="secondary">{unreadCount} unread</Badge>
          )}
        </div>
        <ScrollArea className="h-[320px]">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
              <Bell className="size-6 opacity-40" />
              <p>You&apos;re all caught up.</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  disabled={isPending}
                  onClick={() => markRead(n.id, n.link)}
                  className={[
                    "flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-muted/60",
                    !n.isRead && "bg-primary/5",
                  ].join(" ")}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm font-medium">{n.title}</span>
                    {!n.isRead && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                  </span>
                  {n.body && (
                    <span className="text-xs text-muted-foreground line-clamp-2">{n.body}</span>
                  )}
                  <span className="mt-1 text-[11px] text-muted-foreground/70">
                    {formatDateTime(n.createdAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
        <div className="border-t p-1">
          <Link
            href="/dashboard/notifications"
            className="flex items-center justify-center rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
          >
            View all
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const roleMeta = USER_ROLE[user.role]

  function onLogout() {
    startTransition(async () => {
      await logoutAction()
      router.replace("/login")
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="h-9 gap-2 px-2" />}
      >
        <Avatar className="size-7">
          <AvatarFallback className="bg-primary/10 text-primary text-xs">
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
        <span className="hidden text-sm font-medium sm:inline">{user.name}</span>
        <ChevronDown className="hidden size-4 text-muted-foreground sm:inline" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{user.name}</span>
            <span className="text-xs font-normal text-muted-foreground">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <div className="px-2 pb-1 pt-0.5">
          <Badge variant="secondary" className="text-[11px]">
            {roleMeta.label}
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link href="/dashboard/members" />}>
            <Users className="size-4" /> Members
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/dashboard/payments" />}>
            <Wallet className="size-4" /> Payments
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/dashboard/leads" />}>
            <TrendingUp className="size-4" /> Leads
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isPending}
          onClick={(e) => {
            e.preventDefault()
            onLogout()
          }}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { NotificationsMenu, UserMenu }