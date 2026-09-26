"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Banknote,
  BarChart3,
  Building2,
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
import { visibleNavItems } from "@/lib/nav-items"
import { can, type Permission } from "@/lib/permissions"
import type { SessionUser } from "@/lib/auth/auth"
import type { SidebarCounts } from "@/lib/domain/counts"

/**
 * Icons are the only reason this stays a component: the ORDER, LABELS and
 * PERMISSION gating live in the pure `@/lib/nav-items` module so they can be
 * asserted in a unit test. The desktop sidebar and the mobile sheet both render
 * this component, so there is a single navigation source for both.
 */
const NAV_ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/dashboard/branches": Building2,
  "/dashboard/members": Users,
  "/dashboard/memberships": UserCheck,
  "/dashboard/plans": FileText,
  "/dashboard/payments": Banknote,
  "/dashboard/attendance": ScanLine,
  "/dashboard/attendance/qr": ClipboardCheck,
  "/dashboard/leads": TrendingUp,
  "/dashboard/trainers": Dumbbell,
  "/dashboard/appointments": CalendarDays,
  "/dashboard/tasks": CheckSquare,
  "/dashboard/reports": BarChart3,
  "/dashboard/settings/users": ShieldCheck,
  "/dashboard/settings": Settings,
}

export function SidebarNav({ user, counts }: { user: SessionUser; counts?: SidebarCounts }) {
  const pathname = usePathname()
  const items = visibleNavItems((permission: Permission) => can(user, permission))
  const activeHref = activeNavItemHref(items, pathname)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
      {items.map((item) => {
        const active = item.href === activeHref
        const Icon = NAV_ICONS[item.href] ?? LayoutDashboard
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
