"use server"

import { revalidatePath } from "next/cache"
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import { branchSchema, branchUpdateSchema } from "@/lib/validators"
import type { BranchInput, BranchUpdateInput } from "@/lib/validators"
import { nextBranchCode, isBranchCodeCollision } from "@/lib/branch-code"
import {
  decideBranchDeactivation,
  decideBranchReactivation,
  decideBranchCreation,
  canViewBranch,
} from "@/lib/branch-rules"
import { getBranchAccess } from "@/lib/branches"

/**
 * The Branches module is a FIRST-CLASS module, not a Settings tab: it has its
 * own route and its own dedicated permissions (`branches:*`). Settings access is
 * deliberately NOT enough — a tenant admin who may edit billing but not branches
 * must not be able to create or deactivate a gym location.
 */
const BRANCHES_PATH = "/dashboard/branches"

/**
 * Whether this actor may act on THIS branch.
 *
 * The permission answers "may you run branches at all?"; this answers "at which
 * ones?". A server action is a public endpoint, so a restricted admin who is
 * assigned to branch A only — but holds `branches:edit` through a per-user
 * override — could otherwise craft a request naming branch B and edit, rename or
 * deactivate a location they have no access to. The visible-branch set is
 * therefore re-checked on EVERY branch-scoped mutation.
 *
 * Note the INACTIVE consequence: a restricted viewer's accessible set contains
 * only ACTIVE branches, so they can neither edit nor reactivate a deactivated
 * branch. Lifting that back up is an owner-level action, which is the intent.
 *
 * The actor is the current session user; every caller has already resolved the
 * branch with `organizationId` in its where clause, so this only ever NARROWS.
 */
async function mayActOnBranch(branchId: string): Promise<boolean> {
  const access = await getBranchAccess()
  if (access.mode === "none") return false
  return canViewBranch({
    mode: access.mode,
    accessibleBranchIds: access.accessibleBranches.map((b) => b.id),
    branchId,
  })
}

/** Revalidate the directory, the branch's own detail page and the shell counts. */
function revalidateBranchViews(branchId?: string): void {
  revalidatePath(BRANCHES_PATH)
  revalidatePath(BRANCHES_PATH + "/[id]", "page")
  if (branchId) revalidatePath(`${BRANCHES_PATH}/${branchId}`)
}

type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

function toFieldErrors(issues: Array<{ path: PropertyKey[]; message: string }>): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of issues) {
    const key = issue.path.join(".")
    if (!fieldErrors[key]) fieldErrors[key] = []
    fieldErrors[key].push(issue.message)
  }
  return fieldErrors
}

/** Sequential-create retries: two creates may race for the same free code. */
const BRANCH_CODE_MAX_TRIES = 5

// ---------------------------------------------------------------------------
// Branch CRUD
// ---------------------------------------------------------------------------

export async function createBranch(input: BranchInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "branches:create")) return { success: false, error: "Not authorized" }

  const parsed = branchSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: toFieldErrors(parsed.error.issues),
    }
  }

  const data = parsed.data
  const existingCodes = await prisma.branch.findMany({
    where: { organizationId: user.organizationId },
    select: { branchCode: true },
  })

  // Plan limit seam (unlimited today) — the SAME pure rule the page uses to
  // decide whether to show the "Add branch" button, so UI and action agree.
  const currentCount = existingCodes.length
  const creationGate = decideBranchCreation({ branchLimit: null, currentBranchCount: currentCount })
  if (!creationGate.allowed) return { success: false, error: "Branch limit reached" }

  const existingName = await prisma.branch.findFirst({
    where: { organizationId: user.organizationId, name: data.name },
    select: { id: true },
  })
  if (existingName) {
    return {
      success: false,
      error: "A branch with this name already exists",
      fieldErrors: { name: ["A branch with this name already exists in your gym"] },
    }
  }

  let branchId: string | null = null
  let lastRaceError: unknown = null
  for (let attempt = 0; attempt < BRANCH_CODE_MAX_TRIES; attempt += 1) {
    try {
      const created = await prisma.branch.create({
        data: {
          organizationId: user.organizationId,
          branchCode: nextBranchCode(existingCodes.map((r) => r.branchCode)),
          name: data.name,
          phone: data.phone ?? null,
          email: data.email ?? null,
          address: data.address ?? null,
          city: data.city ?? null,
          state: data.state ?? null,
          country: data.country ?? null,
        },
        select: { id: true },
      })
      branchId = created.id
      break
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Either the code raced (retry) or the name was taken concurrently.
        if (isBranchCodeCollision(error)) {
          lastRaceError = error
          continue
        }
        return {
          success: false,
          error: "A branch with this name already exists",
          fieldErrors: { name: ["A branch with this name already exists in your gym"] },
        }
      }
      throw error
    }
  }

  if (!branchId) {
    console.error("createBranch could not allocate a unique branch code", lastRaceError)
    return { success: false, error: "Could not create the branch. Please try again." }
  }

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.BRANCH_CREATED,
    entityType: "Branch",
    entityId: branchId,
    after: { ...data, id: branchId },
  })

  revalidateBranchViews(branchId)
  return { success: true }
}

export async function updateBranch(input: BranchUpdateInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "branches:edit")) return { success: false, error: "Not authorized" }

  const parsed = branchUpdateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: toFieldErrors(parsed.error.issues),
    }
  }

  const { branchId, ...data } = parsed.data

  const existing = await prisma.branch.findFirst({
    where: { id: branchId, organizationId: user.organizationId },
    select: { id: true, name: true, branchCode: true },
  })
  if (!existing) return { success: false, error: "Branch not found" }
  if (!(await mayActOnBranch(branchId))) {
    return { success: false, error: "You do not have access to this branch" }
  }

  const nameTaken = await prisma.branch.findFirst({
    where: { organizationId: user.organizationId, name: data.name, NOT: { id: branchId } },
    select: { id: true },
  })
  if (nameTaken) {
    return {
      success: false,
      error: "A branch with this name already exists",
      fieldErrors: { name: ["A branch with this name already exists in your gym"] },
    }
  }

  const updated = await prisma.branch.update({
    where: { id: branchId },
    data: {
      name: data.name,
      phone: data.phone ?? null,
      email: data.email ?? null,
      address: data.address ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      country: data.country ?? null,
    },
    select: { id: true },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.BRANCH_UPDATED,
    entityType: "Branch",
    entityId: branchId,
    before: { name: existing.name, branchCode: existing.branchCode },
    after: { ...data, id: updated.id },
  })

  revalidateBranchViews(branchId)
  return { success: true }
}

export async function deactivateBranch(branchId: string): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "branches:deactivate")) return { success: false, error: "Not authorized" }

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId: user.organizationId },
    select: { id: true, name: true, status: true },
  })
  if (!branch) return { success: false, error: "Branch not found" }
  if (!(await mayActOnBranch(branchId))) {
    return { success: false, error: "You do not have access to this branch" }
  }

  const activeCount = await prisma.branch.count({
    where: { organizationId: user.organizationId, status: "ACTIVE" },
  })

  const gate = decideBranchDeactivation({ status: branch.status, activeBranchCount: activeCount })
  if (!gate.allowed) {
    return {
      success: false,
      error:
        gate.reason === "only_active_branch"
          ? "You cannot deactivate your gym's only active branch."
          : "This branch is already inactive.",
    }
  }

  await prisma.branch.update({
    where: { id: branchId },
    data: { status: "INACTIVE" },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.BRANCH_DEACTIVATED,
    entityType: "Branch",
    entityId: branchId,
    before: { status: branch.status },
    after: { status: "INACTIVE" },
  })

  revalidateBranchViews(branchId)
  return { success: true }
}

export async function reactivateBranch(branchId: string): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "branches:deactivate")) return { success: false, error: "Not authorized" }

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId: user.organizationId },
    select: { id: true, name: true, status: true },
  })
  if (!branch) return { success: false, error: "Branch not found" }
  if (!(await mayActOnBranch(branchId))) {
    return { success: false, error: "You do not have access to this branch" }
  }

  const gate = decideBranchReactivation({ status: branch.status })
  if (!gate.allowed) {
    return { success: false, error: "Only inactive branches can be reactivated." }
  }

  await prisma.branch.update({
    where: { id: branchId },
    data: { status: "ACTIVE" },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.BRANCH_REACTIVATED,
    entityType: "Branch",
    entityId: branchId,
    before: { status: "INACTIVE" },
    after: { status: "ACTIVE" },
  })

  revalidateBranchViews(branchId)
  return { success: true }
}

// ---------------------------------------------------------------------------
// User ↔ branch assignments (UserBranch)
// ---------------------------------------------------------------------------

export async function assignUserToBranch(input: {
  userId: string
  branchId: string
  isPrimary?: boolean
}): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "branches:manage")) return { success: false, error: "Not authorized" }

  const { userId, branchId, isPrimary = false } = input

  const [target, branch] = await Promise.all([
    prisma.user.findFirst({
      where: { id: userId, organizationId: user.organizationId, status: "ACTIVE" },
      select: { id: true, role: true, name: true },
    }),
    prisma.branch.findFirst({
      where: { id: branchId, organizationId: user.organizationId, status: "ACTIVE" },
      select: { id: true, name: true, branchCode: true },
    }),
  ])

  if (!target) return { success: false, error: "Staff member not found" }
  if (target.role === "OWNER") {
    return { success: false, error: "Owners hold org-wide branch access and cannot be assigned to a branch." }
  }
  if (!branch) return { success: false, error: "Branch not found or inactive" }
  if (!(await mayActOnBranch(branchId))) {
    return { success: false, error: "You do not have access to this branch" }
  }

  await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      await tx.userBranch.updateMany({
        where: { organizationId: user.organizationId, userId, isPrimary: true, NOT: { branchId } },
        data: { isPrimary: false },
      })
    }
    await tx.userBranch.upsert({
      where: {
        organizationId_userId_branchId: {
          organizationId: user.organizationId,
          userId,
          branchId,
        },
      },
      update: { isPrimary },
      create: { organizationId: user.organizationId, userId, branchId, isPrimary },
    })
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.USER_BRANCH_ASSIGNED,
    entityType: "UserBranch",
    entityId: `${userId}:${branchId}`,
    after: { userId, branchId, name: target.name, branchName: branch.name, isPrimary },
  })

  revalidateBranchViews(branchId)
  return { success: true }
}

export async function removeUserFromBranch(input: {
  userId: string
  branchId: string
}): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "branches:manage")) return { success: false, error: "Not authorized" }

  const { userId, branchId } = input

  const assignment = await prisma.userBranch.findFirst({
    where: { organizationId: user.organizationId, userId, branchId },
    select: { id: true, isPrimary: true },
  })
  if (!assignment) return { success: false, error: "Assignment not found" }
  if (!(await mayActOnBranch(branchId))) {
    return { success: false, error: "You do not have access to this branch" }
  }

  await prisma.$transaction(async (tx) => {
    await tx.userBranch.delete({ where: { id: assignment.id } })
    if (assignment.isPrimary) {
      // Promote another remaining assignment to primary so the user keeps a
      // deterministic active branch.
      const next = await tx.userBranch.findFirst({
        where: { organizationId: user.organizationId, userId },
        orderBy: [{ createdAt: "asc" }, { branchId: "asc" }],
        select: { id: true },
      })
      if (next) {
        await tx.userBranch.update({
          where: { id: next.id },
          data: { isPrimary: true },
        })
      }
    }
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.USER_BRANCH_REMOVED,
    entityType: "UserBranch",
    entityId: `${userId}:${branchId}`,
    after: { userId, branchId },
  })

  revalidateBranchViews(branchId)
  return { success: true }
}