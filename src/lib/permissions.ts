import type { SessionUser } from "@/lib/auth/auth"

/**
 * Lightweight role-based permissions. Server-side only.
 * Keep simple on purpose — this is a small-gym SaaS, not an enterprise RBAC.
 */

export type Permission =
  | "members:view"
  | "members:create"
  | "members:update"
  | "members:archive"
  | "plans:view"
  | "plans:manage"
  | "memberships:view"
  | "memberships:manage"
  | "payments:view"
  | "payments:record"
  | "attendance:view"
  | "attendance:record"
  | "leads:view"
  | "leads:create"
  | "leads:update"
  | "leads:convert"
  | "leads:manage"
  | "trainers:view"
  | "trainers:manage"
  | "appointments:view"
  | "appointments:manage"
  | "tasks:view"
  | "tasks:manage"
  | "reports:view"
  | "settings:view"
  | "settings:manage"
  | "staff:manage"

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  OWNER: [
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
    "settings:view",
    "settings:manage",
    "staff:manage",
  ],
  ADMIN: [
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
    "settings:view",
    "settings:manage",
    "staff:manage",
  ],
  RECEPTIONIST: [
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
    "settings:view",
  ],
  TRAINER: [
    "members:view",
    "attendance:view",
    "leads:view",
    "appointments:view",
    "tasks:view",
    "reports:view",
  ],
}

export function can(user: Pick<SessionUser, "role">, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[user.role] ?? []).includes(permission)
}

export function canAny(
  user: Pick<SessionUser, "role">,
  permissions: Permission[]
): boolean {
  const allowed = ROLE_PERMISSIONS[user.role] ?? []
  return permissions.some((p) => allowed.includes(p))
}

export function requirePermission(user: Pick<SessionUser, "role">, permission: Permission) {
  if (!can(user, permission)) {
    throw new Error("Forbidden")
  }
}