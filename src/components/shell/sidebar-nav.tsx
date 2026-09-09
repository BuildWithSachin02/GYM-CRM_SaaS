"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Banknote,
  BarChart3,
  CalendarDays,
  CheckSquare,
  ClipboardCheck,
  Dumbbell,
  FileText,
  LayoutDashboard,
  Settings,
  TrendingUp,
  Users,
  UserCheck,
  ScanLine,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { can, type Permission } from "@/lib/permissions"
import type { SessionUser } from "@/lib/auth/auth"

type NavItem = {
  label: string
  href: string
  icon: LucideIcon
  permission: Permission
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, permission: "members:view" },
  { label: "Members", href: "/dashboard/members", icon: Users, permission: "members:view" },
  { label: "Memberships", href: "/dashboard/memberships", icon: UserCheck, permission: "memberships:view" },
  { label: "Plans", href: "/dashboard/plans", icon: FileText, permission: "plans:view" },
  { label: "Payments", href: "/dashboard/payments", icon: Banknote, permission: "payments:view" },
  { label: "Attendance", href: "/dashboard/attendance", icon: ScanLine, permission: "attendance:view" },
  { label: "QR Check-in", href: "/dashboard/attendance/qr", icon: ClipboardCheck, permission: "attendance:record" },
  { label: "Leads", href: "/dashboard/leads", icon: TrendingUp, permission: "leads:view" },
  { label: "Trainers", href: "/dashboard/trainers", icon: Dumbbell, permission: "trainers:view" },
  { label: "Appointments", href: "/dashboard/appointments", icon: CalendarDays, permission: "appointments:view" },
  { label: "Tasks", href: "/dashboard/tasks", icon: CheckSquare, permission: "tasks:view" },
  { label: "Reports", href: "/dashboard/reports", icon: BarChart3, permission: "reports:view" },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, permission: "settings:view" },
]

export function SidebarNav({ user }: { user: SessionUser }) {
  const pathname = usePathname()
  const items = NAV_ITEMS.filter((item) => can(user, item.permission))

  return (
    <div className="flex flex-1 flex-col gap-1 px-3 py-4">
      {items.map((item) => {
        const active =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}

export function SidebarBrand() {
  return (
    <div className="flex items-center gap-2 px-5 py-4">
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Dumbbell className="size-4" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold tracking-tight">Gym CRM</p>
        <p className="text-xs text-muted-foreground">King&apos;s Gym</p>
      </div>
    </div>
  )
}