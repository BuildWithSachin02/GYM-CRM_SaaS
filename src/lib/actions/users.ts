"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { ZodError } from "zod"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { SESSION_COOKIE, createSessionToken } from "@/lib/auth/session"
import { hashPassword, verifyPassword } from "@/lib/auth/password"
import {
  can,
  ForbiddenError,
  ALL_PERMISSIONS,
  permissionLabel,
  roleDefaultPermissions,
  type Permission,
} from "@/lib/permissions"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import {
  changePasswordSchema,
  permissionUpdateSchema,
  resetPasswordSchema,
  staffSchema,
  staffUpdateSchema,
  type ChangePasswordInput,
  type PermissionUpdateInput,
  type ResetPasswordInput,
  type StaffInput,
  type StaffUpdateInput,
} from "@/lib/validators"
import {
  diffPermissions,
  effectivePermissions,
  grantablePermissions,
  isSelf,
  normalizeUsername,
  ownerRoleChangeForbidden,
  wouldRemoveLastOwner,
  type PermissionOverride,
} from "@/lib/user-access"

const USERS_PATH = "/dashboard/settings/users"
const SETTINGS_PATH = "/dashboard/settings"

type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

function buildFieldErrors(error: unknown): Record<string, string[]> | undefined {
  if (!(error instanceof ZodError)) return undefined
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const key = issue.path.join(".")
    if (!fieldErrors[key]) fieldErrors[key] = []
    fieldErrors[key].push(issue.message)
  }
  return fieldErrors
}

/** Org-scoped lookup so actions can never touch users of another tenant. */
async function findStaffInOrg(staffId: string, organizationId: string) {
  return prisma.user.findFirst({
    where: { id: staffId, organizationId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      username: true,
      role: true,
      status: true,
      sessionVersion: true,
    },
  })
}

async function bumpSessionVersion(staffId: string): Promise<number> {
  const updated = await prisma.user.update({
    where: { id: staffId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  })
  return updated.sessionVersion
}

/**
 * When a security-sensitive change bumps the session version of the CURRENT
 * actor, re-issue their own cookie with the fresh version so the session stays
 * alive instead of silently dropping them to the login page.
 */
async function refreshOwnSessionIfNeeded(actorId: string, staffId: string, version: number) {
  if (actorId !== staffId) return
  const cookieStore = await cookies()
  const token = await createSessionToken(actorId, version)
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  })
}

async function countActiveOwners(organizationId: string, excludeUserId?: string): Promise<number> {
  return prisma.user.count({
    where: {
      organizationId,
      role: "OWNER",
      status: "ACTIVE",
      NOT: excludeUserId ? { id: excludeUserId } : undefined,
    },
  })
}

/**
 * Anti-privilege-escalation: the actor may only GRANT permissions they
 * effectively hold themselves. OWNER (full catalog) is unconstrained. Only NEW
 * grants are policed — revocations and permissions the target already holds are
 * always allowed, so a subordinate can still correct/limit a colleague without
 * first having every permission that colleague has. Returns the labels the
 * actor is trying to grant but cannot.
 */
function cannotGrantLabels(
  actorRole: StaffUserDTO["role"],
  actorPermissions: Permission[],
  current: Record<string, boolean>,
  desired: Record<string, boolean>
): string[] {
  const grantable = new Set(grantablePermissions(actorRole, actorPermissions))
  return ALL_PERMISSIONS.filter(
    (permission) =>
      desired[permission] === true &&
      current[permission] !== true &&
      !grantable.has(permission)
  ).map(permissionLabel)
}

/**
 * Build the FULL effective permission map for a user. The optional `custom`
 * map is the desired effective set; missing keys fall back to the role default
 * (role = baseline, per-user customization = override).
 */
function desiredPermissionMap(
  role: StaffUserDTO["role"],
  custom: Record<string, boolean> | undefined
): Record<string, boolean> {
  const defaults = new Set(roleDefaultPermissions(role))
  const map: Record<string, boolean> = {}
  for (const key of ALL_PERMISSIONS) {
    map[key] = custom && key in custom ? Boolean(custom[key]) : defaults.has(key)
  }
  return map
}

// ---------------------------------------------------------------------------
// Create / update staff
// ---------------------------------------------------------------------------

export async function createStaff(input: StaffInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "staff:manage")) return { success: false, error: "Not authorized" }

  const parsed = staffSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  const { name, email, phone, role, password } = parsed.data
  let username: string | null
  try {
    username = normalizeUsername(parsed.data.username)
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Invalid username",
      fieldErrors: { username: [err instanceof Error ? err.message : "Invalid username"] },
    }
  }

  // Only an OWNER may create OWNER accounts — prevents privilege escalation.
  if (ownerRoleChangeForbidden(user.role, role)) {
    return { success: false, error: "Only the owner can create owner accounts" }
  }

  // OWNER access is unconditional — no creation-time customization allowed.
  const customPermissions = parsed.data.permissions
  if (role === "OWNER" && customPermissions) {
    return { success: false, error: "Owner accounts always have full access" }
  }

  const desired = desiredPermissionMap(role, customPermissions)

  // A non-owner actor may customize staff only within their own effective
  // authority — anything newly granted must be a permission they hold.
  const deniedGrants = cannotGrantLabels(
    user.role,
    user.permissions,
    desiredPermissionMap(role, undefined),
    desired
  )
  if (deniedGrants.length > 0) {
    return {
      success: false,
      error: `You can only grant permissions you have yourself: ${deniedGrants.join(", ")}`,
    }
  }

  const existingEmail = await prisma.user.findFirst({
    where: { organizationId: user.organizationId, email },
    select: { id: true },
  })
  if (existingEmail) {
    return {
      success: false,
      error: "A user with this email already exists in your organization",
      fieldErrors: { email: ["Email already in use"] },
    }
  }

  if (username) {
    const existingUsername = await prisma.user.findFirst({
      where: { organizationId: user.organizationId, username },
      select: { id: true },
    })
    if (existingUsername) {
      return {
        success: false,
        error: "This username is already taken in your organization",
        fieldErrors: { username: ["Username already in use"] },
      }
    }
  }

  const passwordHash = await hashPassword(password)

  const permissionRows = Object.entries(desired).map(([permission, granted]) => ({
    organizationId: user.organizationId,
    permission,
    granted,
  }))

  const staff = await prisma.user.create({
    data: {
      organizationId: user.organizationId,
      name,
      email,
      phone,
      username,
      role,
      passwordHash,
      status: "ACTIVE",
      userPermissions: { create: permissionRows },
    },
    select: { id: true },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.STAFF_CREATED,
    entityType: "User",
    entityId: staff.id,
    after: {
      name,
      email,
      phone,
      role,
      username,
      permissions: ALL_PERMISSIONS.filter((p) => desired[p]),
    },
  })

  revalidatePath(USERS_PATH)
  revalidatePath(SETTINGS_PATH)
  return { success: true }
}

export async function updateStaff(input: StaffUpdateInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "staff:manage")) return { success: false, error: "Not authorized" }

  const parsed = staffUpdateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  const { staffId, name, phone, role, status } = parsed.data
  let username: string | null
  try {
    username = normalizeUsername(parsed.data.username)
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Invalid username",
      fieldErrors: { username: [err instanceof Error ? err.message : "Invalid username"] },
    }
  }

  const existing = await findStaffInOrg(staffId, user.organizationId)
  if (!existing) return { success: false, error: "Staff member not found" }

  // Nobody can deactivate themselves through the management flow.
  if (isSelf(staffId, user.id) && status === "DEACTIVATED") {
    return { success: false, error: "You cannot deactivate your own account" }
  }

  // Only an OWNER may create/promote to OWNER.
  if (ownerRoleChangeForbidden(user.role, role)) {
    return { success: false, error: "Only the owner can create or promote owner accounts" }
  }

  // Never leave the organization without an active owner.
  const roleOrStatusTouchesOwnership =
    existing.role === "OWNER" && (role !== "OWNER" || status === "DEACTIVATED")
  if (roleOrStatusTouchesOwnership) {
    const otherActiveOwners = await countActiveOwners(user.organizationId, staffId)
    if (wouldRemoveLastOwner({
      targetIsActiveOwner: existing.role === "OWNER" && existing.status === "ACTIVE",
      activeOwnerCount: otherActiveOwners + (existing.status === "ACTIVE" ? 1 : 0),
      targetBecomesInactiveOrNonOwner: true,
    })) {
      return { success: false, error: "An organization must always have at least one active owner" }
    }
  }

  if (username) {
    const existingUsername = await prisma.user.findFirst({
      where: { organizationId: user.organizationId, username, NOT: { id: staffId } },
      select: { id: true },
    })
    if (existingUsername) {
      return {
        success: false,
        error: "This username is already taken in your organization",
        fieldErrors: { username: ["Username already in use"] },
      }
    }
  }

  let sessionVersion = existing.sessionVersion
  // Role changes and status changes revoke the target's existing sessions.
  const securityRelevant =
    existing.role !== role || existing.status !== status || existing.username !== username
  if (securityRelevant) {
    sessionVersion = await bumpSessionVersion(staffId)
  }

  await prisma.user.update({
    where: { id: staffId },
    data: { name, phone, username, role, status },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.STAFF_UPDATED,
    entityType: "User",
    entityId: staffId,
    after: { name, phone, role, status, username, sessionInvalidated: securityRelevant },
  })

  if (existing.role !== role) {
    await writeAudit({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
      entityType: "User",
      entityId: staffId,
      before: { role: existing.role },
      after: { role },
    })
  }

  await refreshOwnSessionIfNeeded(user.id, staffId, sessionVersion)
  revalidatePath(USERS_PATH)
  revalidatePath(SETTINGS_PATH)
  return { success: true }
}

export async function setUserStatus(
  staffId: string,
  status: "ACTIVE" | "DEACTIVATED"
): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "staff:manage")) return { success: false, error: "Not authorized" }

  if (status !== "ACTIVE" && status !== "DEACTIVATED") {
    return { success: false, error: "Invalid status" }
  }

  const existing = await findStaffInOrg(staffId, user.organizationId)
  if (!existing) return { success: false, error: "Staff member not found" }
  if (existing.status === status) return { success: true }

  if (status === "DEACTIVATED" && isSelf(staffId, user.id)) {
    return { success: false, error: "You cannot deactivate your own account" }
  }

  if (existing.role === "OWNER" && status === "DEACTIVATED") {
    const otherActiveOwners = await countActiveOwners(user.organizationId, staffId)
    if (otherActiveOwners === 0) {
      return { success: false, error: "An organization must always have at least one active owner" }
    }
  }

  const sessionVersion = await bumpSessionVersion(staffId)

  await prisma.user.update({
    where: { id: staffId },
    data: { status },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: status === "DEACTIVATED" ? AUDIT_ACTIONS.USER_DEACTIVATED : AUDIT_ACTIONS.USER_REACTIVATED,
    entityType: "User",
    entityId: staffId,
    after: { status },
  })

  await refreshOwnSessionIfNeeded(user.id, staffId, sessionVersion)
  revalidatePath(USERS_PATH)
  revalidatePath(SETTINGS_PATH)
  return { success: true }
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export async function changeOwnPassword(input: ChangePasswordInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()

  const parsed = changePasswordSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  const { currentPassword, newPassword } = parsed.data

  const current = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  })
  if (!current) return { success: false, error: "User not found" }

  const valid = await verifyPassword(currentPassword, current.passwordHash)
  if (!valid) {
    return {
      success: false,
      error: "Current password is incorrect",
      fieldErrors: { currentPassword: ["Current password is incorrect"] },
    }
  }
  if (currentPassword === newPassword) {
    return {
      success: false,
      error: "New password must be different from the current password",
      fieldErrors: { newPassword: ["Choose a different password"] },
    }
  }

  const passwordHash = await hashPassword(newPassword)
  const sessionVersion = await bumpSessionVersion(user.id)
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.PASSWORD_CHANGED,
    entityType: "User",
    entityId: user.id,
  })

  await refreshOwnSessionIfNeeded(user.id, user.id, sessionVersion)
  return { success: true }
}

export async function resetPassword(input: ResetPasswordInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "staff:manage")) return { success: false, error: "Not authorized" }

  const parsed = resetPasswordSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  const existing = await findStaffInOrg(parsed.data.staffId, user.organizationId)
  if (!existing) return { success: false, error: "Staff member not found" }
  if (existing.status !== "ACTIVE") {
    return { success: false, error: "Only active staff can have their password reset" }
  }

  const passwordHash = await hashPassword(parsed.data.newPassword)
  const sessionVersion = await bumpSessionVersion(existing.id)
  await prisma.user.update({ where: { id: existing.id }, data: { passwordHash } })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.PASSWORD_RESET,
    entityType: "User",
    entityId: existing.id,
  })

  await refreshOwnSessionIfNeeded(user.id, existing.id, sessionVersion)
  revalidatePath(USERS_PATH)
  return { success: true }
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export async function updateUserPermissions(input: PermissionUpdateInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "staff:manage")) return { success: false, error: "Not authorized" }

  const parsed = permissionUpdateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  const target = await findStaffInOrg(parsed.data.staffId, user.organizationId)
  if (!target) return { success: false, error: "Staff member not found" }

  // OWNER access is unconditional — there is nothing to edit.
  if (target.role === "OWNER") {
    return { success: false, error: "Owner accounts always have full access" }
  }

  const desired = parsed.data.permissions
  for (const key of ALL_PERMISSIONS) {
    if (!(key in desired)) desired[key] = false
  }

  const currentRows = await prisma.userPermission.findMany({
    where: { userId: target.id, organizationId: user.organizationId },
    select: { permission: true, granted: true },
  })
  // Baseline = role defaults, then explicit override rows on top. Without this,
  // "revoking" a permission that is granted only by the role default would see
  // no explicit row (no diff) and silently keep the access — but a false
  // override row MUST be written to actually remove it.
  const currentMap: Record<string, boolean> = {}
  for (const p of roleDefaultPermissions(target.role)) currentMap[p] = true
  for (const row of currentRows) {
    currentMap[row.permission] = row.granted
  }

  // Anti-privilege-escalation: the actor may not add abilities they do not
  // effectively hold themselves. Revocations and already-held grants pass
  // through; only NEW grants are policed.
  const deniedGrants = cannotGrantLabels(
    user.role,
    user.permissions,
    currentMap,
    desired
  )
  if (deniedGrants.length > 0) {
    return {
      success: false,
      error: `You can only grant permissions you have yourself: ${deniedGrants.join(", ")}`,
    }
  }

  const change = diffPermissions(currentMap, desired)
  if (!change) return { success: true }

  await prisma.$transaction([
    prisma.userPermission.deleteMany({
      where: { userId: target.id, organizationId: user.organizationId },
    }),
    ...ALL_PERMISSIONS.map((permission) =>
      prisma.userPermission.create({
        data: {
          organizationId: user.organizationId,
          userId: target.id,
          permission,
          granted: desired[permission],
        },
      })
    ),
  ])

  const sessionVersion = await bumpSessionVersion(target.id)

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.PERMISSIONS_UPDATED,
    entityType: "User",
    entityId: target.id,
    after: { granted: change.granted, revoked: change.revoked },
  })

  await refreshOwnSessionIfNeeded(user.id, target.id, sessionVersion)
  revalidatePath(USERS_PATH)
  return { success: true }
}

// ---------------------------------------------------------------------------
// Queries for the Users & Access page (server components call these directly)
// ---------------------------------------------------------------------------

export type StaffUserDTO = {
  id: string
  name: string
  email: string
  phone: string | null
  username: string | null
  role: "OWNER" | "ADMIN" | "RECEPTIONIST" | "TRAINER"
  status: "ACTIVE" | "DEACTIVATED"
  createdAt: string
  /** Effective permission set (already granted by role or override). */
  effectivePermissions: string[]
}

export async function listStaffUsers(): Promise<StaffUserDTO[]> {
  const user = await requireUserOrThrow()
  if (!can(user, "staff:manage")) return []
  const [staff, overrides] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        username: true,
        role: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.userPermission.findMany({
      where: { organizationId: user.organizationId },
      select: { userId: true, permission: true, granted: true },
    }),
  ])

  const byUser = new Map<string, PermissionOverride[]>()
  for (const row of overrides) {
    if (!byUser.has(row.userId)) byUser.set(row.userId, [])
    byUser.get(row.userId)!.push({ permission: row.permission, granted: row.granted })
  }

  return staff.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    phone: s.phone,
    username: s.username,
    role: s.role,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    effectivePermissions: effectivePermissions(s.role, byUser.get(s.id) ?? []),
  }))
}

export type PermissionRow = {
  permission: string
  granted: boolean
  /** true when an explicit override row exists for this user (vs. role default). */
  overridden: boolean
}

export async function getStaffPermissionDetail(staffId: string): Promise<{
  role: "OWNER" | "ADMIN" | "RECEPTIONIST" | "TRAINER"
  rows: PermissionRow[]
} | null> {
  const user = await requireUserOrThrow()
  if (!can(user, "staff:manage")) return null
  const target = await findStaffInOrg(staffId, user.organizationId)
  if (!target) return null

  const rows = await prisma.userPermission.findMany({
    where: { userId: staffId, organizationId: user.organizationId },
    select: { permission: true, granted: true },
  })
  const overrides = new Map(rows.map((r) => [r.permission, r.granted]))

  return {
    role: target.role,
    rows: ALL_PERMISSIONS.map((permission) => ({
      permission: permission as string,
      granted: overrides.has(permission)
        ? overrides.get(permission)!
        : can({ role: target.role }, permission),
      overridden: overrides.has(permission),
    })),
  }
}

export type AuditEntryDTO = {
  id: string
  action: string
  entityType: string
  entityId: string | null
  before: Prisma.InputJsonValue | null
  after: Prisma.InputJsonValue | null
  actorUserId: string | null
  createdAt: string
}

export async function getStaffAuditLog(staffId: string): Promise<AuditEntryDTO[]> {
  const user = await requireUserOrThrow()
  if (!can(user, "staff:manage")) return []

  const target = await findStaffInOrg(staffId, user.organizationId)
  if (!target) return []

  const entries = await prisma.auditLog.findMany({
    where: {
      organizationId: user.organizationId,
      OR: [{ entityType: "User", entityId: staffId }, { actorUserId: staffId }],
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      before: true,
      after: true,
      actorUserId: true,
      createdAt: true,
    },
  })

  return entries.map((e) => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
  }))
}

export { ForbiddenError }