"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { Menu, Dumbbell } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import {
  SidebarBrand,
  SidebarNav,
} from "@/components/shell/sidebar-nav"
import {
  NotificationsMenu,
  UserMenu,
  type ShellNotification,
} from "@/components/shell/topbar"
import { ThemeToggle } from "@/components/shell/theme-toggle"
import type { SessionUser } from "@/lib/auth/auth"
import type { SidebarCounts } from "@/lib/domain/counts"

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/members": "Members",
  "/dashboard/plans": "Membership Plans",
  "/dashboard/memberships": "Memberships",
  "/dashboard/payments": "Payments",
  "/dashboard/attendance": "Attendance",
  "/dashboard/attendance/qr": "QR Check-in",
  "/dashboard/leads": "Leads",
  "/dashboard/trainers": "Trainers",
  "/dashboard/appointments": "Appointments",
  "/dashboard/tasks": "Tasks",
  "/dashboard/notifications": "Notifications",
  "/dashboard/reports": "Reports",
  "/dashboard/settings": "Settings",
}

function titleForPath(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname]
  if (pathname.startsWith("/dashboard/members/")) return "Member Profile"
  if (pathname.startsWith("/dashboard/leads/")) return "Lead Profile"
  if (pathname.startsWith("/dashboard/trainers/")) return "Trainer Profile"
  return "Dashboard"
}

type ShellProps = {
  user: SessionUser
  notifications: ShellNotification[]
  sidebarCounts: SidebarCounts
  children: React.ReactNode
}

export function Shell({ user, notifications, sidebarCounts, children }: ShellProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const unreadCount = notifications.filter((n) => !n.isRead).length

  const sidebar = (
    <>
      <SidebarBrand />
      <SidebarNav user={user} counts={sidebarCounts} />
    </>
  )

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background print:relative print:h-auto print:overflow-visible">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r bg-muted/30 lg:flex lg:flex-col print:hidden">
        <SidebarBrand />
        <SidebarNav user={user} counts={sidebarCounts} />
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden print:hidden"
              aria-label="Open menu"
            />
          }
        >
          <Menu className="size-4" />
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <div className="flex h-full flex-col">{sidebar}</div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col print:relative print:overflow-visible">
        {/* Topbar */}
        <header className="z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6 print:hidden">
          <div className="flex items-center gap-2">
            <span className="lg:hidden">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Dumbbell className="size-4" />
              </span>
            </span>
            <div className="flex items-center gap-2 text-sm">
              <span className="hidden text-muted-foreground sm:inline">
                {user.organization.name}
              </span>
              <span className="hidden text-muted-foreground sm:inline">/</span>
              <h1 className="font-semibold tracking-tight">{titleForPath(pathname)}</h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <NotificationsMenu
              notifications={notifications}
              unreadCount={unreadCount}
            />
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 print:overflow-visible">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  )
}