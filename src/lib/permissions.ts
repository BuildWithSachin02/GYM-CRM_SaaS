import type { UserRole } from "@prisma/client"

/**
 * Server-side authorization.
 *
 * The client never decides who may act. The browser can only show/hide UI; the
 * authority is always the server's view of the authenticated user, their role,
 * their per-user permission overrides, and their tenant.
 *
 * Model (Phase 2 decision, documented in docs/AUTHORIZATION.md):
 *
 *   Role defaults (ROLE_PERMISSIONS) act as the baseline.
 *   UserPermission rows override the baseline per user (granted true/false).
 *   OWNER is hardcoded to FULL access and can never be narrowed — the owner can
 *   never lock themselves out of the gym's CRM.
 *
 * Precedence: OWNER full-access  >  explicit UserPermission row  >  role default.
 *
 * `can()`/`canAny()`/`requirePermission()` accept an optional `permissions`
 * list; when present that list IS the effective set (computed server-side for
 * the SessionUser). When absent they fall back to the role default so existing
 * callers and unit tests keep working.
 */

export type Permission =
  // Dashboard
  | "dashboard:view"
  // Members
  | "members:view"
  | "members:create"
  | "members:update"
  | "members:archive"
  // Plans (membership plans)
  | "plans:view"
  | "plans:manage"
  // Memberships
  | "memberships:view"
  | "memberships:manage"
  // Payments
  | "payments:view"
  | "payments:record"
  // Attendance (manual + QR)
  | "attendance:view"
  | "attendance:record"
  // Leads / CRM
  | "leads:view"
  | "leads:create"
  | "leads:update"
  | "leads:convert"
  | "leads:manage"
  // Trainers
  | "trainers:view"
  | "trainers:manage"
  // Appointments
  | "appointments:view"
  | "appointments:manage"
  // Tasks
  | "tasks:view"
  | "tasks:manage"
  // Reports
  | "reports:view"
  // Notifications (in-app inbox)
  | "notifications:view"
  | "notifications:update"
  // Settings (gym details, data reset)
  | "settings:view"
  | "settings:manage"
  // Users & Access Control
  | "staff:manage"

export const PERMISSION_VALUES = [
  "dashboard:view",
  "members:view",
  "members:create",
  "members:update",
  "members:archive",
  "plans:view",
  "plans:manage",
  "memberships:view",
  "memberships:manage",
  "payments:view",
  "payments:record",
  "attendance:view",
  "attendance:record",
  "leads:view",
  "leads:create",
  "leads:update",
  "leads:convert",
  "leads:manage",
  "trainers:view",
  "trainers:manage",
  "appointments:view",
  "appointments:manage",
  "tasks:view",
  "tasks:manage",
  "reports:view",
  "notifications:view",
  "notifications:update",
  "settings:view",
  "settings:manage",
  "staff:manage",
] as const

/** The canonical, ordered catalog — drives both validation and the UI matrix. */
export const ALL_PERMISSIONS: Permission[] = [...PERMISSION_VALUES]

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value)
}

/**
 * Human-friendly label for a single permission key. Used in the permission
 * editor and anywhere a specific action must be named for a non-technical user.
 */
export function permissionLabel(permission: Permission): string {
  const known: Record<Permission, string> = {
    "dashboard:view": "View Dashboard",
    "members:view": "View Members",
    "members:create": "Add Members",
    "members:update": "Edit Members",
    "members:archive": "Delete/Archive Members",
    "plans:view": "View Plans",
    "plans:manage": "Manage Plans",
    "memberships:view": "View Memberships",
    "memberships:manage": "Manage Memberships",
    "payments:view": "View Payments",
    "payments:record": "Record Payments",
    "attendance:view": "View Attendance",
    "attendance:record": "Record Attendance",
    "leads:view": "View Leads",
    "leads:create": "Add Leads",
    "leads:update": "Edit Leads",
    "leads:convert": "Convert Leads",
    "leads:manage": "Manage Lead Assignment",
    "trainers:view": "View Trainers",
    "trainers:manage": "Manage Trainers",
    "appointments:view": "View Appointments",
    "appointments:manage": "Manage Appointments",
    "tasks:view": "View Tasks",
    "tasks:manage": "Manage Tasks",
    "reports:view": "View Reports",
    "notifications:view": "View Notifications",
    "notifications:update": "Mark Notifications Read",
    "settings:view": "View Settings",
    "settings:manage": "Manage Settings",
    "staff:manage": "Manage Users & Access",
  }
  return known[permission]
}

/**
 * The permission matrix shown in the Users & Access editor.
 *
 * Each module maps to the real permission keys that gate its route/actions, so
 * the editor never invents permissions for functionality that does not exist.
 * Action labels are human words ("View", "Add", "Edit", "Delete") — the UI must
 * never expose the internal `module:action` keys to a gym owner.
 */
export type PermissionMatrixEntry = {
  module: string
  description?: string
  permissions: {
    permission: Permission
    action: string
    /** Sensitive to grant — the editor asks for a confirmation when granted. */
    sensitive?: boolean
  }[]
}

export const PERMISSION_MATRIX: PermissionMatrixEntry[] = [
  {
    module: "Dashboard",
    permissions: [{ permission: "dashboard:view", action: "View" }],
  },
  {
    module: "Members",
    description: "Member profiles, contact info, attendance history.",
    permissions: [
      { permission: "members:view", action: "View" },
      { permission: "members:create", action: "Add" },
      { permission: "members:update", action: "Edit" },
      { permission: "members:archive", action: "Delete" },
    ],
  },
  {
    module: "Memberships",
    description: "Membership plans linked to members and renewals.",
    permissions: [
      { permission: "memberships:view", action: "View" },
      { permission: "memberships:manage", action: "Manage" },
    ],
  },
  {
    module: "Plans",
    description: "Membership plans and pricing.",
    permissions: [
      { permission: "plans:view", action: "View" },
      { permission: "plans:manage", action: "Manage" },
    ],
  },
  {
    module: "Payments",
    description: "Payment records, refunds and voids.",
    permissions: [
      { permission: "payments:view", action: "View" },
      { permission: "payments:record", action: "Record" },
    ],
  },
  {
    module: "Attendance",
    description: "Manual check-ins and attendance lists.",
    permissions: [
      { permission: "attendance:view", action: "View" },
      { permission: "attendance:record", action: "Check-in" },
    ],
  },
  {
    module: "QR Check-in",
    description: "QR sessions, pending requests and trusted devices.",
    permissions: [{ permission: "attendance:record", action: "Use" }],
  },
  {
    module: "Leads",
    description: "Lead pipeline, activities and conversion.",
    permissions: [
      { permission: "leads:view", action: "View" },
      { permission: "leads:create", action: "Add" },
      { permission: "leads:update", action: "Edit" },
      { permission: "leads:convert", action: "Convert" },
      { permission: "leads:manage", action: "Assign" },
    ],
  },
  {
    module: "Trainers",
    description: "Trainer staff profiles.",
    permissions: [
      { permission: "trainers:view", action: "View" },
      { permission: "trainers:manage", action: "Manage" },
    ],
  },
  {
    module: "Appointments",
    description: "Appointments and schedules.",
    permissions: [
      { permission: "appointments:view", action: "View" },
      { permission: "appointments:manage", action: "Manage" },
    ],
  },
  {
    module: "Tasks",
    description: "Follow-up tasks and reminders.",
    permissions: [
      { permission: "tasks:view", action: "View" },
      { permission: "tasks:manage", action: "Manage" },
    ],
  },
  {
    module: "Reports",
    description: "Analytics and revenue reports.",
    permissions: [{ permission: "reports:view", action: "View" }],
  },
  {
    module: "Notifications",
    description: "In-app notification inbox.",
    permissions: [
      { permission: "notifications:view", action: "View" },
      { permission: "notifications:update", action: "Mark read" },
    ],
  },
  {
    module: "Settings",
    description: "Gym details and data management.",
    permissions: [
      { permission: "settings:view", action: "View" },
      { permission: "settings:manage", action: "Manage" },
    ],
  },
  {
    module: "Users & Access",
    description: "Creating, editing and granting access to staff accounts.",
    permissions: [{ permission: "staff:manage", action: "Manage users", sensitive: true }],
  },
]

export type UserRoleValue = UserRole

/**
 * Role defaults — the baseline permission set for every role.
 * Extend only; removing an entry would silently revoke default access.
 */
const ROLE_PERMISSIONS: Record<UserRoleValue, Permission[]> = {
  OWNER: [
    "dashboard:view",
    "members:view",
    "members:create",
    "members:update",
    "members:archive",
    "plans:view",
    "plans:manage",
    "memberships:view",
    "memberships:manage",
    "payments:view",
    "payments:record",
    "attendance:view",
    "attendance:record",
    "leads:view",
    "leads:create",
    "leads:update",
    "leads:convert",
    "leads:manage",
    "trainers:view",
    "trainers:manage",
    "appointments:view",
    "appointments:manage",
    "tasks:view",
    "tasks:manage",
    "reports:view",
    "notifications:view",
    "notifications:update",
    "settings:view",
    "settings:manage",
    "staff:manage",
  ],
  ADMIN: [
    "dashboard:view",
    "members:view",
    "members:create",
    "members:update",
    "members:archive",
    "plans:view",
    "plans:manage",
    "memberships:view",
    "memberships:manage",
    "payments:view",
    "payments:record",
    "attendance:view",
    "attendance:record",
    "leads:view",
    "leads:create",
    "leads:update",
    "leads:convert",
    "leads:manage",
    "trainers:view",
    "trainers:manage",
    "appointments:view",
    "appointments:manage",
    "tasks:view",
    "tasks:manage",
    "reports:view",
    "notifications:view",
    "notifications:update",
    "settings:view",
    "settings:manage",
    "staff:manage",
  ],
  RECEPTIONIST: [
    "dashboard:view",
    "members:view",
    "members:create",
    "members:update",
    "memberships:view",
    "memberships:manage",
    "payments:view",
    "payments:record",
    "attendance:view",
    "attendance:record",
    "leads:view",
    "leads:create",
    "leads:update",
    "leads:convert",
    "appointments:view",
    "appointments:manage",
    "tasks:view",
    "tasks:manage",
    "reports:view",
    "notifications:view",
    "notifications:update",
    "settings:view",
  ],
  TRAINER: [
    "dashboard:view",
    "members:view",
    "attendance:view",
    "leads:view",
    "appointments:view",
    "tasks:view",
    "reports:view",
    "notifications:view",
    "notifications:update",
  ],
}

/** OWNER always has the full catalog — never narrowed by overrides. */
export const OWNER_FULL_ACCESS: Permission[] = [...ALL_PERMISSIONS]

/** The role's default permission set (baseline before per-user overrides). */
export function roleDefaultPermissions(role: UserRoleValue): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])]
}

export type PermissionUser = {
  role: UserRoleValue
  /** Effective permission set when present (server-computed); else role default. */
  permissions?: Permission[]
}

export function can(user: PermissionUser, permission: Permission): boolean {
  if (user.permissions) return user.permissions.includes(permission)
  return (ROLE_PERMISSIONS[user.role] ?? []).includes(permission)
}

export function canAny(
  user: PermissionUser,
  permissions: Permission[]
): boolean {
  const allowed = user.permissions ?? ROLE_PERMISSIONS[user.role] ?? []
  return permissions.some((p) => allowed.includes(p))
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message)
    this.name = "ForbiddenError"
  }
}

export function requirePermission(user: PermissionUser, permission: Permission) {
  if (!can(user, permission)) {
    throw new ForbiddenError()
  }
}