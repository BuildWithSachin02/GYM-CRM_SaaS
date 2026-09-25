import {
  ALL_PERMISSIONS,
  OWNER_FULL_ACCESS,
  roleDefaultPermissions,
  type Permission,
  type UserRoleValue,
} from "@/lib/permissions"

/**
 * Pure, DB-free authorization/access-control decision helpers.
 *
 * Everything here is a deterministic function of plain inputs so it can be
 * unit-tested without a database (see tests/users-access.test.ts). The server
 * actions in src/lib/actions/* feed real records through these helpers and
 * never trust client-provided role/permission/organization values.
 */

export type PermissionOverride = {
  permission: string
  granted: boolean
}

/**
 * Effective permission set for a user = OWNER full-access, otherwise
 * role defaults merged with explicit per-user overrides. An explicit override
 * row wins over the role default (granted=true adds, granted=false removes).
 */
export function effectivePermissions(
  role: UserRoleValue,
  overrides: PermissionOverride[]
): Permission[] {
  if (role === "OWNER") {
    return [...OWNER_FULL_ACCESS]
  }

  const allowed = new Set(roleDefaultPermissions(role))
  for (const row of overrides) {
    if (ALL_PERMISSIONS.includes(row.permission as Permission)) {
      const key = row.permission as Permission
      if (row.granted) allowed.add(key)
      else allowed.delete(key)
    }
  }
  return [...allowed]
}

/**
 * Only an OWNER may create or promote another user to the OWNER role.
 * ADMIN (and below) managing staff can never create/promote OWNERs, which
 * keeps the role hierarchy and prevents privilege escalation by delegation.
 */
export function ownerRoleChangeForbidden(
  actorRole: UserRoleValue,
  targetRole: UserRoleValue
): boolean {
  return targetRole === "OWNER" && actorRole !== "OWNER"
}

export type LastOwnerChange = {
  /** Is the target an ACTIVE OWNER right now? */
  targetIsActiveOwner: boolean
  /** Total ACTIVE OWNERs in the organization (including the target). */
  activeOwnerCount: number
  /** Will the target still be an ACTIVE OWNER after the change? */
  targetBecomesInactiveOrNonOwner: boolean
}

/**
 * True when the change would leave the organization with zero ACTIVE OWNERs.
 * Guards deactivation, role demotion (OWNER -> lower), and any status change
 * that would remove the last remaining owner.
 */
export function wouldRemoveLastOwner(change: LastOwnerChange): boolean {
  if (!change.targetIsActiveOwner) return false
  if (!change.targetBecomesInactiveOrNonOwner) return false
  return change.activeOwnerCount <= 1
}

/** Safe guard for one actor deactivating themselves. */
export function isSelf(id: string, actorId: string): boolean {
  return id === actorId
}

/**
 * Anti-privilege-escalation rule.
 *
 * The permissions an actor is allowed to GRANT to another user:
 * - The OWNER may grant the full catalog (they are the org-level authority).
 * - Any other user may only grant permissions they effectively hold themselves.
 *
 * This stops a subordinate who happens to hold `staff:manage` from handing out
 * powers they never possessed (module permissions, other people's user access,
 * or `staff:manage` itself via self-grant). Revocation is never restricted; the
 * rule targets elevation only.
 */
export function grantablePermissions(
  actorRole: UserRoleValue,
  actorEffective: Permission[]
): Permission[] {
  return actorRole === "OWNER" ? [...ALL_PERMISSIONS] : [...actorEffective]
}

export const USERNAME_MIN = 3
export const USERNAME_MAX = 32
export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/

/**
 * Normalize a username for storage: trim, collapse, lowercase, validate.
 * Returns null when the value is empty/absent; throws a descriptive string
 * (used as a field validation message) when the value is invalid.
 */
export function normalizeUsername(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  if (
    trimmed.length < USERNAME_MIN ||
    trimmed.length > USERNAME_MAX ||
    !USERNAME_RE.test(trimmed)
  ) {
    throw new Error(
      `Usernames must be ${USERNAME_MIN}-${USERNAME_MAX} characters using letters, numbers, dots, underscores or hyphens`
    )
  }
  return trimmed
}

export type PermissionDiff = {
  granted: string[]
  revoked: string[]
}

/**
 * Compare the current permission state (a full map) against the desired one
 * and return what changed — used to audit permission edits without logging the
 * sensitive full matrix when unnecessary.
 */
export function diffPermissions(
  current: Record<string, boolean> | null,
  desired: Record<string, boolean>
): PermissionDiff | null {
  const granted: string[] = []
  const revoked: string[] = []
  for (const [key, value] of Object.entries(desired)) {
    const before = current?.[key] ?? false
    if (value && !before) granted.push(key)
    if (!value && before) revoked.push(key)
  }
  if (granted.length === 0 && revoked.length === 0) return null
  return { granted, revoked }
}