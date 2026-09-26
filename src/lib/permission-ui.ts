import {
  ALL_PERMISSIONS,
  PERMISSION_MATRIX,
  type Permission,
  type PermissionMatrixEntry,
  roleDefaultPermissions,
  type UserRoleValue,
} from "@/lib/permissions"

/**
 * Presentation + normalization helpers for the permission editor UI.
 *
 * AUTHORIZATION SEMANTICS DO NOT LIVE HERE. This module only:
 *   - maps the real permission catalog to short human explanations
 *     (presentation metadata — no new permission keys are invented),
 *   - normalizes the editor's checkbox state so it matches the server's
 *     rules (View is the base of each module; enabling an action forces View
 *     on, turning View off clears the module's other actions), and
 *   - computes read-only summary counts for the UI.
 *
 * All enforcement stays server-side in src/lib/actions/users.ts and
 * src/lib/user-access.ts. The UI never replaces the backend; it only renders
 * the same decision shapes.
 */

/**
 * Fallback explanation per ACTION label shown in the editor. Used when the
 * permission-specific description is absent so the UI can always explain a
 * control in plain language.
 */
export const ACTION_DESCRIPTIONS: Record<string, string> = {
  View: "Can see this module and its records.",
  Add: "Can create new records.",
  Edit: "Can modify existing records.",
  Delete: "Can remove or archive records.",
  Manage: "Can manage configuration and related records.",
  Record: "Can record a payment or attendance entry.",
  "Check-in": "Can perform member check-ins.",
  Use: "Can use this feature.",
  Convert: "Can convert a lead into a member.",
  Assign: "Can assign records to staff.",
  "Mark read": "Can mark notifications as read.",
  "Manage users": "Can create and edit staff accounts and change other people's access.",
  Activate: "Can deactivate and reactivate a location, which pauses new work there without deleting its history.",
  "Manage staff": "Can grant and revoke which staff members have access to a location.",
}

/**
 * Permission-specific explanations keyed by the real catalog permission. The
 * `Permission` type enforces that every catalog key is present — the compiler
 * fails if this map ever drifts from PERMISSION_VALUES.
 */
export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  "dashboard:view": "Can see the dashboard and its day overview.",
  "members:view": "Can view members and their profiles.",
  "members:create": "Can add new members.",
  "members:update": "Can edit member information.",
  "members:archive": "Can remove or archive member records.",
  "plans:view": "Can view membership plans and pricing.",
  "plans:manage": "Can create, edit and archive membership plans.",
  "memberships:view": "Can view memberships and renewals.",
  "memberships:manage": "Can create, renew, pause and cancel memberships.",
  "payments:view": "Can view payment records.",
  "payments:record": "Can record payments, refunds and voids.",
  "attendance:view": "Can view attendance lists and check-in history.",
  "attendance:record": "Can perform member check-ins.",
  "branches:view": "Can view branches and their quick overview.",
  "branches:create": "Can add a new branch.",
  "branches:edit": "Can edit a branch's name and contact details.",
  "branches:deactivate": "Can deactivate or reactivate a branch.",
  "branches:manage": "Can decide which staff can operate in each branch.",
  "leads:view": "Can view leads and their pipeline.",
  "leads:create": "Can add new leads.",
  "leads:update": "Can edit lead details.",
  "leads:convert": "Can convert a lead into a member.",
  "leads:manage": "Can assign leads to staff and manage the pipeline.",
  "trainers:view": "Can view trainer profiles.",
  "trainers:manage": "Can add, edit and manage trainers.",
  "appointments:view": "Can view appointments and schedules.",
  "appointments:manage": "Can create and manage appointments.",
  "tasks:view": "Can view follow-up tasks.",
  "tasks:manage": "Can create, edit and complete tasks.",
  "reports:view": "Can view analytics and revenue reports.",
  "notifications:view": "Can view the notification inbox.",
  "notifications:update": "Can mark notifications as read.",
  "settings:view": "Can view gym settings.",
  "settings:manage": "Can update gym details and manage data.",
  "staff:manage": "Can create and edit staff accounts and change other people's access.",
}

/** Human explanation for one permission card row. */
export function permissionDescription(permission: Permission, action: string): string {
  return (
    PERMISSION_DESCRIPTIONS[permission] ??
    ACTION_DESCRIPTIONS[action] ??
    "Controls what this user can do in this module."
  )
}

/** The `:view` permission of a module entry, when it exists. */
export function viewPermissionOf(entry: PermissionMatrixEntry): Permission | undefined {
  return entry.permissions.find((p) => p.permission.endsWith(":view"))?.permission
}

/**
 * The module's permissions excluding its `:view` base (QR Check-in has no
 * `:view`, so its permissions are returned as-is). The editor renders the view
 * as a dedicated "Module access" switch and the rest as action cards.
 */
export function actionPermissionsOf(entry: PermissionMatrixEntry): PermissionMatrixEntry["permissions"] {
  const viewKey = viewPermissionOf(entry)
  return viewKey ? entry.permissions.filter((p) => p.permission !== viewKey) : entry.permissions
}

/**
 * Normalization rule that mirrors what the backend expects: when a module has a
 * `:view` permission, any granted action forces View on, and a turned-off View
 * clears every other action in that module. Idempotent; unknown keys pass
 * through untouched.
 */
export function enforceViewDependency(map: Record<string, boolean>): Record<string, boolean> {
  const next = { ...map }
  for (const entry of PERMISSION_MATRIX) {
    const viewKey = viewPermissionOf(entry)
    if (!viewKey) continue
    if (!next[viewKey]) {
      for (const p of entry.permissions) {
        if (p.permission !== viewKey) next[p.permission] = false
      }
    }
  }
  return next
}

/**
 * Full desired permission map for a role — every catalog key present, true
 * when the role default grants it. Used to seed the Create User flow (Step 2)
 * and to reset a user back to their role defaults.
 */
export function defaultPermissionMap(role: UserRoleValue): Record<string, boolean> {
  const defaults = new Set(roleDefaultPermissions(role))
  const map: Record<string, boolean> = {}
  for (const key of ALL_PERMISSIONS) map[key] = defaults.has(key)
  return map
}

/**
 * Everything a show/evaluate user can grant at once: turn on every GRANTABLE
 * permission, leaving un-grantable keys exactly as they are (never silently
 * revoke what the actor cannot re-grant). Always view-normalized.
 */
export function selectAllGrantable(
  value: Record<string, boolean>,
  grantable: Set<string>
): Record<string, boolean> {
  const next: Record<string, boolean> = {}
  for (const key of Object.keys(value)) {
    next[key] = grantable.has(key) ? true : Boolean(value[key])
  }
  return enforceViewDependency(next)
}

/** Turn every permission off, preserving the full key set. */
export function clearAllPermissions(map: Record<string, boolean>): Record<string, boolean> {
  const next: Record<string, boolean> = {}
  for (const key of Object.keys(map)) next[key] = false
  return next
}

/**
 * Flip a single permission in the editor, applying the View rule: enabling an
 * action automatically enables the module's View (Module access); turning View
 * off clears the module's other actions.
 */
export function togglePermissionIn(
  value: Record<string, boolean>,
  permission: Permission,
  module: PermissionMatrixEntry
): Record<string, boolean> {
  const checked = !value[permission]
  const next = { ...value, [permission]: checked }
  const viewKey = viewPermissionOf(module)
  if (viewKey && checked && permission !== viewKey && !next[viewKey]) next[viewKey] = true
  return enforceViewDependency(next)
}

/**
 * Flip the "Module access" switch of a module (its `:view` base). Turning it
 * off clears the module's other actions; turning it on enables just the view.
 * Modules without a `:view` (QR Check-in) have no module-access switch.
 */
export function toggleModuleAccessIn(
  value: Record<string, boolean>,
  module: PermissionMatrixEntry
): Record<string, boolean> {
  const viewKey = viewPermissionOf(module)
  if (!viewKey) return value
  const next = { ...value, [viewKey]: !value[viewKey] }
  return enforceViewDependency(next)
}

/**
 * Select all / Clear all for one module card: enabling only turns on
 * GRANTABLE permissions (never silently revokes what the actor cannot
 * re-grant); clearing turns the module's permissions off. Always normalized.
 */
export function setModulePermission(
  value: Record<string, boolean>,
  module: PermissionMatrixEntry,
  enabled: boolean,
  grantable: Set<string>
): Record<string, boolean> {
  const next = { ...value }
  for (const key of module.permissions.map((p) => p.permission)) {
    next[key] = enabled ? (grantable.has(key) ? true : Boolean(next[key])) : false
  }
  return enforceViewDependency(next)
}

export type PermissionStateSummary = {
  enabled: number
  modules: number
  changes: number
}

/**
 * Read-only summary of the current editor state: how many permissions are on,
 * how many modules have any access, and how many permissions differ from the
 * role baseline (the "custom changes" count).
 */
export function summarizePermissions(
  value: Record<string, boolean>,
  roleDefaults: Set<string> = new Set()
): PermissionStateSummary {
  let enabled = 0
  let changes = 0
  for (const [key, granted] of Object.entries(value)) {
    if (granted) enabled += 1
    if (Boolean(granted) !== roleDefaults.has(key)) changes += 1
  }
  let modules = 0
  for (const entry of PERMISSION_MATRIX) {
    if (entry.permissions.some((p) => value[p.permission])) modules += 1
  }
  return { enabled, modules, changes }
}