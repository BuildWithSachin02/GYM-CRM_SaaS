import "server-only"

import { cache } from "react"
import { cookies } from "next/headers"
import { notFound } from "next/navigation"

import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth/auth"
import { canViewBranch, resolveBranchContext } from "@/lib/branch-rules"
import type { BranchFilter } from "@/lib/branch-scope"
import { ForbiddenError } from "@/lib/permissions"

/**
 * Server-side branch context.
 *
 * A request's branch scope is fan-out only from the authenticated session:
 *
 *   getCurrentUser()  → identity, role, org, permissions  (WHAT the user can do)
 *   getBranchAccess() → WHERE the user can do it           (scope)
 *
 * The branch context is resolved from TWO server-side sources:
 *   1. the user's role (OWNER ⇒ org-wide "all" by role, no rows needed)
 *   2. their UserBranch assignments (only ACTIVE branches count as accessible;
 *      a deactivated branch drops out of the accessible set while its row stays)
 *
 * The `gym_branch` cookie is an ordinary HttpOnly preference. It carries NO
 * authority: the value is validated against the assignment list above and a
 * tampered/foreign id is silently ignored (see resolveBranchContext).
 *
 * A branch may ALSO be requested per navigation via the `?branch=` search param
 * (used by the Branches module's quick links). That value is equally
 * untrusted: it is validated server-side against the org's ACTIVE branches and
 * the viewer's own authority, and a rejected id FAILS CLOSED with a 403 rather
 * than falling back to a wider scope (see getBranchFilterForRequest).
 *
 * SECURITY: branch scope is NEVER a tenant boundary. Every data query MUST
 * still be org-scoped; the branch filter only narrows inside the org.
 */

export const BRANCH_COOKIE = "gym_branch"

export type AccessibleBranch = {
  id: string
  name: string
  branchCode: string
  status: "ACTIVE" | "INACTIVE"
  isPrimary: boolean
}

export type BranchAccess = {
  /** "all" (OWNER) | "single" | "multi" | "none" (fail-closed). */
  mode: "all" | "single" | "multi" | "none"
  /**
   * The user's current branch (cookie-resolved → primary → first active). null
   * for an OWNER ("all") and for fail-closed users.
   */
  activeBranchId: string | null
  /** Every ACTIVE assigned branch (the complete accessible set). */
  accessibleBranches: AccessibleBranch[]
}

export const getBranchAccess = cache(async (): Promise<BranchAccess> => {
  const user = await getCurrentUser()
  if (!user) {
    return { mode: "none", activeBranchId: null, accessibleBranches: [] }
  }

  const cookieStore = await cookies()
  const requestedBranchId = cookieStore.get(BRANCH_COOKIE)?.value ?? null

  // OWNER holds org-wide access by role — no UserBranch rows exist for them
  // and the cookie is not consulted for authority (only `?branch=` below can
  // narrow an owner's view, and only to an ACTIVE branch of their own org).
  if (user.role === "OWNER") {
    return { mode: "all", activeBranchId: null, accessibleBranches: [] }
  }

  const assignments = await prisma.userBranch.findMany({
    where: { organizationId: user.organizationId, userId: user.id },
    select: {
      branchId: true,
      isPrimary: true,
      branch: { select: { name: true, branchCode: true, status: true } },
    },
  })

  // Order deterministically (primary first, then by branch code) so an OWNER
  // never relied on ordering and restricted users get a stable "first" branch.
  const accessible = assignments
    .filter((a) => a.branch.status === "ACTIVE")
    .map<AccessibleBranch>((a) => ({
      id: a.branchId,
      name: a.branch.name,
      branchCode: a.branch.branchCode,
      status: a.branch.status,
      isPrimary: a.isPrimary,
    }))
    .sort((a, b) =>
      a.isPrimary === b.isPrimary ? (a.branchCode < b.branchCode ? -1 : 1) : a.isPrimary ? -1 : 1
    )

  const resolution = resolveBranchContext({
    role: user.role,
    assignedBranches: accessible.map((a) => ({ id: a.id, isPrimary: a.isPrimary })),
    requestedBranchId,
  })

  return {
    mode: resolution.mode,
    activeBranchId: resolution.activeBranchId,
    accessibleBranches: accessible,
  }
})

/** Hard-stop for restricted users with no branch access. */
export async function requireBranchAccess(): Promise<BranchAccess> {
  const access = await getBranchAccess()
  if (access.mode === "none") {
    throw new ForbiddenError()
  }
  return access
}

/**
 * Hard-stop: may this viewer open THIS branch? The branch is loaded inside the
 * caller's organization (so a cross-tenant id is simply "not found" to the
 * client, never a permission leak) and the branch scope gate is then applied.
 */
export async function requireBranchView(branchId: string): Promise<AccessibleBranch> {
  const user = await getCurrentUser()
  if (!user) throw new ForbiddenError()

  const access = await getBranchAccess()
  const allowed = canViewBranch({
    mode: access.mode,
    accessibleBranchIds: access.accessibleBranches.map((b) => b.id),
    branchId,
  })
  if (!allowed) throw new ForbiddenError()

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId: user.organizationId },
    select: { id: true, name: true, branchCode: true, status: true },
  })
  if (!branch) throw new ForbiddenError()
  return { ...branch, isPrimary: access.accessibleBranches.some((b) => b.id === branch.id) }
}

/**
 * The read filter for every data query in the app. Combine it with
 * `organizationId` — this filter alone is never a tenant boundary.
 */
export async function getBranchFilter(): Promise<BranchFilter> {
  const access = await getBranchAccess()
  switch (access.mode) {
    case "all":
      return { kind: "all" }
    case "none":
      return { kind: "none" }
    case "single": {
      if (!access.activeBranchId) return { kind: "none" }
      return { kind: "single", branchId: access.activeBranchId }
    }
    case "multi":
      return { kind: "multi", branchIds: access.accessibleBranches.map((b) => b.id) }
  }
}

/**
 * The read filter for a page that supports an explicit `?branch=` context (the
 * Branches module's quick links). With no param this is exactly
 * `getBranchFilter()`. With a param the branch is resolved SERVER-SIDE against
 * the org's ACTIVE branches and the viewer's own authority:
 *
 *   authorized → { kind: "single" }   that branch + the organization-wide arm
 *   unauthorized / foreign / unknown / INACTIVE → 404 (FAIL CLOSED)
 *
 * It never falls back to a wider scope: a rejected id must not silently widen
 * what the user sees. A deactivated branch is rejected because operational
 * writes and new work are blocked there (see decideBranchDeactivation), so a
 * card must not deep-link into it. `notFound()` — not a redirect and not a
 * wider scope — is the response, so a crafted id learns nothing about whether
 * the branch exists elsewhere.
 */
export async function getBranchFilterForRequest(
  requestedBranchId?: string | null
): Promise<BranchFilter> {
  if (!requestedBranchId) return getBranchFilter()

  const user = await getCurrentUser()
  if (!user) notFound()

  const access = await getBranchAccess()
  const branch = await prisma.branch.findFirst({
    where: { id: requestedBranchId, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  })

  const allowed =
    branch !== null &&
    canViewBranch({
      mode: access.mode,
      accessibleBranchIds: access.accessibleBranches.map((b) => b.id),
      branchId: requestedBranchId,
    })

  if (!allowed) notFound()
  return { kind: "single", branchId: requestedBranchId }
}

/**
 * The concrete branch a WRITE is stamped with when the form carries no branch:
 *   restricted user → their active branch (cookie-resolved, always non-null)
 *   OWNER           → the org's first ACTIVE branch (deterministic: createdAt, id)
 *
 * The org is guaranteed ≥1 active branch by the deactivation rule, so this is
 * never null for a healthy tenant.
 */
export async function resolveDefaultBranchId(): Promise<string | null> {
  const user = await getCurrentUser()
  if (!user) return null

  const access = await getBranchAccess()
  if (access.mode === "single" || access.mode === "multi") {
    return access.activeBranchId
  }
  if (access.mode === "none") return null

  // OWNER: first ACTIVE branch of the org.
  const first = await prisma.branch.findFirst({
    where: { organizationId: user.organizationId, status: "ACTIVE" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  })
  return first?.id ?? null
}

export type ResolvedWriteBranch =
  | { ok: true; branchId: string }
  | { ok: false; error: string }

/**
 * Resolve the branch a WRITE is stamped with, shared by every write action.
 * A form-provided `branchId` wins, but only when it is within the actor's
 * authority; otherwise fall back to the actor's own branch. Restricted users
 * may write to their accessible (ACTIVE) branches only; owners to any ACTIVE
 * org branch. Returns a user-facing error instead of throwing so form actions
 * can render it inline.
 */
export async function resolveWriteBranch(
  formBranchId?: string | null
): Promise<ResolvedWriteBranch> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: "Not authorized" }

  const access = await getBranchAccess()
  if (access.mode === "none") return { ok: false, error: "Not authorized" }

  const candidate =
    formBranchId ??
    (access.mode === "all" ? await resolveDefaultBranchId() : access.activeBranchId)

  if (!candidate) {
    return { ok: false, error: "No branch is available for this operation" }
  }

  // Restricted user: the branch must be in their accessible (ACTIVE) set.
  if (
    access.mode !== "all" &&
    !access.accessibleBranches.some((b) => b.id === candidate)
  ) {
    return { ok: false, error: "You do not have access to this branch" }
  }

  // Owner: must resolve to a real ACTIVE org branch.
  if (access.mode === "all") {
    const branch = await prisma.branch.findFirst({
      where: { id: candidate, organizationId: user.organizationId, status: "ACTIVE" },
      select: { id: true },
    })
    if (!branch) return { ok: false, error: "Branch not found or inactive" }
  }

  return { ok: true, branchId: candidate }
}