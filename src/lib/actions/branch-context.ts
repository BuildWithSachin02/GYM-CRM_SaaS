"use server"

import { cookies } from "next/headers"

import { requireUserOrThrow } from "@/lib/auth/auth"
import { BRANCH_COOKIE, getBranchAccess } from "@/lib/branches"

export type BranchContextResult =
  | { success: true }
  | { success: false; error: string }

/**
 * Persist the user's branch preference in the ordinary HttpOnly `gym_branch`
 * cookie. The value carries NO authority — reads validate it against the
 * user's UserBranch assignments and ignore anything else (see
 * `resolveBranchContext`). `null` clears the pin back to the default
 * (primary / first assigned) branch.
 */
export async function setBranchContext(branchId: string | null): Promise<BranchContextResult> {
  await requireUserOrThrow()
  const access = await getBranchAccess()

  // OWNERs are org-wide "all" by role and never get a cookie; clearing is a
  // harmless no-op that also restores sanity after a role change.
  if (access.mode === "all") {
    await clearBranchCookie()
    return { success: true }
  }

  if (access.mode === "none") {
    return { success: false, error: "Not authorized" }
  }

  if (branchId !== null) {
    const allowed = access.accessibleBranches.some((b) => b.id === branchId)
    if (!allowed) {
      return { success: false, error: "You do not have access to this branch" }
    }
  }

  const cookieStore = await cookies()
  if (branchId === null) {
    cookieStore.delete(BRANCH_COOKIE)
  } else {
    cookieStore.set(BRANCH_COOKIE, branchId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    })
  }

  return { success: true }
}

async function clearBranchCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(BRANCH_COOKIE)
}