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
  ShieldCheck,
  TrendingUp,
  Users,
  UserCheck,
  ScanLine,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { activeNavItemHref } from "@/lib/navigation"
import { can, type Permission } from "@/lib/permissions"
import type { SessionUser } from "@/lib/auth/auth"
import type { SidebarCounts } from "@/lib/domain/counts"

type NavItem = {
  label: string
  href: string
  icon: LucideIcon
  permission: Permission
  countKey?: keyof SidebarCounts
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, permission: "dashboard:view" },
  { label: "Members", href: "/dashboard/members", icon: Users, permission: "members:view", countKey: "members" },
  { label: "Memberships", href: "/dashboard/memberships", icon: UserCheck, permission: "memberships:view", countKey: "memberships" },
  { label: "Plans", href: "/dashboard/plans", icon: FileText, permission: "plans:view", countKey: "plans" },
  { label: "Payments", href: "/dashboard/payments", icon: Banknote, permission: "payments:view", countKey: "payments" },
  { label: "Attendance", href: "/dashboard/attendance", icon: ScanLine, permission: "attendance:view", countKey: "attendance" },
  { label: "QR Check-in", href: "/dashboard/attendance/qr", icon: ClipboardCheck, permission: "attendance:record" },
  { label: "Leads", href: "/dashboard/leads", icon: TrendingUp, permission: "leads:view", countKey: "leads" },
  { label: "Trainers", href: "/dashboard/trainers", icon: Dumbbell, permission: "trainers:view", countKey: "trainers" },
  { label: "Appointments", href: "/dashboard/appointments", icon: CalendarDays, permission: "appointments:view", countKey: "appointments" },
  { label: "Tasks", href: "/dashboard/tasks", icon: CheckSquare, permission: "tasks:view", countKey: "tasks" },
  { label: "Reports", href: "/dashboard/reports", icon: BarChart3, permission: "reports:view" },
  { label: "Users & Access", href: "/dashboard/settings/users", icon: ShieldCheck, permission: "staff:manage" },
  // Settings is ALWAYS the final navigation item — it must never appear before
  // any module (Users & Access sits directly above it when authorized).
  { label: "Settings", href: "/dashboard/settings", icon: Settings, permission: "settings:view" },
]

export function SidebarNav({ user, counts }: { user: SessionUser; counts?: SidebarCounts }) {
  const pathname = usePathname()
  const items = NAV_ITEMS.filter((item) => can(user, item.permission))
  const activeHref = activeNavItemHref(items, pathname)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
      {items.map((item) => {
        const active = item.href === activeHref
        const Icon = item.icon
        const count = item.countKey && counts ? counts[item.countKey] : undefined
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
            <span className="flex-1">{item.label}</span>
            {count !== undefined && count > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}

export function SidebarBrand() {
  return (
    <div className="flex shrink-0 items-center gap-2 px-5 py-4">
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
