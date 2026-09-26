import type { Permission } from "@/lib/permissions"

/**
 * The single, PURE source of truth for the dashboard navigation.
 *
 * Why it lives here rather than inside `sidebar-nav.tsx`:
 *
 *   - ORDER is a product requirement (Dashboard → Branches → Members → … →
 *     Settings last), so it must be assertable in a unit test instead of only
 *     being visible by looking at the rendered sidebar.
 *   - VISIBILITY is a permission rule, so it must be testable without React,
 *     a router or a session cookie.
 *   - The desktop sidebar and the mobile sheet render the SAME component, so
 *     there is exactly one list — they can never drift apart.
 *
 * Icons deliberately do NOT live here: they are React components and this
 * module is imported by plain unit tests. The client component maps
 * `NAV_ICONS[item.href]` onto these entries.
 */

/** Sidebar badge keys, mirrored from the server-only `SidebarCounts` shape. */
export type NavCountKey =
  | "members"
  | "memberships"
  | "plans"
  | "payments"
  | "attendance"
  | "leads"
  | "trainers"
  | "appointments"
  | "tasks"

export type NavItem = {
  label: string
  href: string
  permission: Permission
  countKey?: NavCountKey
}

/**
 * The canonical order. Two invariants are enforced by tests:
 *   1. Branches comes directly after Dashboard (branches are the second
 *      module a multi-site gym needs, above member data).
 *   2. Settings is ALWAYS last.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", href: "/dashboard", permission: "dashboard:view" },
  { label: "Branches", href: "/dashboard/branches", permission: "branches:view" },
  { label: "Members", href: "/dashboard/members", permission: "members:view", countKey: "members" },
  {
    label: "Memberships",
    href: "/dashboard/memberships",
    permission: "memberships:view",
    countKey: "memberships",
  },
  { label: "Plans", href: "/dashboard/plans", permission: "plans:view", countKey: "plans" },
  { label: "Payments", href: "/dashboard/payments", permission: "payments:view", countKey: "payments" },
  {
    label: "Attendance",
    href: "/dashboard/attendance",
    permission: "attendance:view",
    countKey: "attendance",
  },
  { label: "QR Check-in", href: "/dashboard/attendance/qr", permission: "attendance:record" },
  { label: "Leads", href: "/dashboard/leads", permission: "leads:view", countKey: "leads" },
  { label: "Trainers", href: "/dashboard/trainers", permission: "trainers:view", countKey: "trainers" },
  {
    label: "Appointments",
    href: "/dashboard/appointments",
    permission: "appointments:view",
    countKey: "appointments",
  },
  { label: "Tasks", href: "/dashboard/tasks", permission: "tasks:view", countKey: "tasks" },
  { label: "Reports", href: "/dashboard/reports", permission: "reports:view" },
  { label: "Users & Access", href: "/dashboard/settings/users", permission: "staff:manage" },
  // Settings is ALWAYS the final navigation item — it must never appear before
  // any module (Users & Access sits directly above it when authorized).
  { label: "Settings", href: "/dashboard/settings", permission: "settings:view" },
]

/**
 * The items this viewer may see, in canonical order.
 *
 * `can` is injected rather than imported so the caller reuses the EXACT
 * effective-permission resolution the rest of the request already used (role
 * defaults + UserPermission overrides) and so the rule stays unit testable.
 */
export function visibleNavItems(
  can: (permission: Permission) => boolean
): NavItem[] {
  return NAV_ITEMS.filter((item) => can(item.permission))
}

/** The nav href a given page title belongs to (drives the topbar heading). */
export const NAV_TITLES: Readonly<Record<string, string>> = {
  "/dashboard": "Dashboard",
  "/dashboard/branches": "Branches",
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
  "/dashboard/settings/users": "Users & Access",
}

/**
 * The page title for a pathname. Falls back to a section label for detail
 * routes (e.g. a branch detail page) so the topbar never shows "Dashboard".
 */
export function navTitleForPath(pathname: string): string {
  if (NAV_TITLES[pathname]) return NAV_TITLES[pathname]
  if (pathname.startsWith("/dashboard/branches/")) return "Branch Details"
  if (pathname.startsWith("/dashboard/members/")) return "Member Profile"
  if (pathname.startsWith("/dashboard/leads/")) return "Lead Profile"
  if (pathname.startsWith("/dashboard/trainers/")) return "Trainer Profile"
  return "Dashboard"
}
