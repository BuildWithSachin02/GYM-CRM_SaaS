import "server-only"

import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { prisma } from "@/lib/prisma"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session"
import { effectivePermissions, type PermissionOverride } from "@/lib/user-access"
import type { Permission } from "@/lib/permissions"

export type SessionUser = {
  id: string
  name: string
  email: string
  username: string | null
  role: "OWNER" | "ADMIN" | "RECEPTIONIST" | "TRAINER"
  organizationId: string
  organization: { id: string; name: string; slug: string; currency: string; timezone: string }
  /**
   * The user's EFFECTIVE permission set (OWNER full-access > explicit
   * UserPermission override rows > role defaults), computed server-side on
   * every request. `can()` in src/lib/permissions.ts honors this list when
   * present, so every action/page that receives this user enforces the exact
   * granted access — never a client-provided permutation.
   */
  permissions: Permission[]
}

/** Reads the current session and returns the authenticated user (or null). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  const decoded = await verifySessionToken(token)
  if (!decoded) return null

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
      role: true,
      status: true,
      sessionVersion: true,
      organizationId: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          currency: true,
          timezone: true,
          status: true,
        },
      },
    },
  })

  if (!user || user.status !== "ACTIVE" || user.organization.status !== "ACTIVE") {
    return null
  }

  // Session revocation: a stale cookie (issued before sessionVersion was
  // bumped by deactivation/password-change/role-change/permission-edit) is
  // rejected here even though the signature still verifies.
  if (decoded.v !== user.sessionVersion) {
    return null
  }

  const overrides = await prisma.userPermission.findMany({
    where: { userId: user.id, organizationId: user.organizationId },
    select: { permission: true, granted: true },
  })
  const permissions = effectivePermissions(
    user.role,
    overrides as PermissionOverride[]
  )

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    organizationId: user.organizationId,
    organization: user.organization,
    permissions,
  }
})

/** Requires an authenticated, active user — otherwise redirects to login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/login")
  }
  return user
}

/** Requires the user to be logged in; throws otherwise (for actions/APIs). */
export async function requireUserOrThrow(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error("Unauthorized")
  }
  return user
}

/** Redirects authenticated users away from the login page. */
export async function optionalUser(): Promise<SessionUser | null> {
  return getCurrentUser()
}