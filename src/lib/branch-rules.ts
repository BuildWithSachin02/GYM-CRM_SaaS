/**
 * Branch lifecycle + access rules (PURE — no DB access, unit-testable).
 *
 * Every rule in this file is a decision gate: given the current facts, is the
 * operation allowed, and if not, WHY. The server actions resolve the facts
 * with org-scoped queries and feed them in; the gate never reaches for the
 * database itself. This keeps the business rules identical across pages,
 * server actions, exports and tests.
 */

// ---------------------------------------------------------------------------
// Branch lifecycle
// ---------------------------------------------------------------------------

export type BranchDeactivationGate =
  | { allowed: true }
  | { allowed: false; reason: "already_inactive" | "only_active_branch" }

/**
 * Deactivation guard. A branch may be deactivated only when it is currently
 * ACTIVE and it is not the organization's LAST active branch — otherwise a
 * single careless flip would silently orphan the whole org's operational
 * scope. Historical records are never touched by deactivation (no hard
 * delete; legacy rows keep their branch forever).
 */
export function decideBranchDeactivation(input: {
  status: string
  activeBranchCount: number
}): BranchDeactivationGate {
  if (input.status !== "ACTIVE") return { allowed: false, reason: "already_inactive" }
  if (input.activeBranchCount <= 1) return { allowed: false, reason: "only_active_branch" }
  return { allowed: true }
}

export type BranchReactivationGate =
  | { allowed: true }
  | { allowed: false; reason: "not_inactive" }

/** Reactivation guard: only an INACTIVE branch can come back. */
export function decideBranchReactivation(input: {
  status: string
}): BranchReactivationGate {
  if (input.status !== "INACTIVE") return { allowed: false, reason: "not_inactive" }
  return { allowed: true }
}

// ---------------------------------------------------------------------------
// Branch access mode (WHAT a user can see vs WHERE)
// ---------------------------------------------------------------------------

export type BranchAccessMode = "all" | "single" | "multi" | "none"

/**
 * Resolve a user's branch access mode from their role + assignments.
 *
 *   OWNER  → "all"  (org-wide by role; needs no UserBranch rows)
 *   else 0 → "none" (FAIL-CLOSED: zero assignments, zero branch data)
 *   else 1 → "single" (implicit, no switcher — identical UX to today)
 *   else n → "multi" (explicit switcher)
 */
export function decideBranchAccessMode(input: {
  role: string
  assignedBranchCount: number
}): BranchAccessMode {
  if (input.role === "OWNER") return "all"
  if (input.assignedBranchCount === 0) return "none"
  if (input.assignedBranchCount === 1) return "single"
  return "multi"
}

/** Should the in-shell branch switcher render? multi only. */
export function shouldShowBranchSwitcher(mode: BranchAccessMode): boolean {
  return mode === "multi"
}

/**
 * Deterministic branch-context resolution: which branch is this user
 * "in" right now?
 *
 *   OWNER                        → mode "all", activeBranchId null (org-wide)
 *   restricted, no assignment    → mode "none", activeBranchId null (forbidden)
 *
 *   Otherwise the ACTIVE branch is chosen in strict priority order:
 *     1. the explicitly requested branch (the signed `gym_branch` cookie)
 *        — accepted ONLY when it is one of the user's assigned branches
 *        (a tampered/wrong cookie is silently ignored, never honoured)
 *     2. the user's primary branch (UserBranch.isPrimary)
 *     3. the first assigned branch — deterministic via the caller-supplied
 *        ordering (createdAt, id). Guarantees the same branch for every
 *        request of an owner who has never opened the picker.
 *
 * Mode stays "single"/"multi" based on the full assignment count — a user
 * with two assigned branches who pins one still has switchable scope.
 */
export type BranchResolution = {
  mode: BranchAccessMode
  activeBranchId: string | null
}

export type AccessibleBranchInfo = {
  id: string
  isPrimary: boolean
}

export function resolveBranchContext(input: {
  role: string
  assignedBranches: AccessibleBranchInfo[]
  requestedBranchId: string | null
}): BranchResolution {
  const { role, assignedBranches, requestedBranchId } = input

  if (role === "OWNER") {
    return { mode: "all", activeBranchId: null }
  }

  const count = assignedBranches.length
  if (count === 0) {
    // Fail-closed: a RESTRICTED user with zero assignments gets no branch scope.
    return { mode: "none", activeBranchId: null }
  }

  const mode: BranchResolution["mode"] = count === 1 ? "single" : "multi"

  // 1. requested cookie value — honored only if it is an assigned branch.
  if (
    requestedBranchId &&
    assignedBranches.some((b) => b.id === requestedBranchId)
  ) {
    return { mode, activeBranchId: requestedBranchId }
  }

  // 2. primary assignment.
  const primary = assignedBranches.find((b) => b.isPrimary)
  if (primary) return { mode, activeBranchId: primary.id }

  // 3. deterministic first assignment (caller orders by createdAt, id).
  return { mode, activeBranchId: assignedBranches[0].id }
}

/** "Can/does this user need a branch switcher?" for the shell/topbar. */
export function branchSwitcherVisiblity(input: {
  role: string
  assignedBranchCount: number
}): { visible: boolean; mode: BranchAccessMode } {
  const mode = decideBranchAccessMode(input)
  return { visible: shouldShowBranchSwitcher(mode), mode }
}

// ---------------------------------------------------------------------------
// Branch directory visibility (WHICH branches a viewer may see at all)
// ---------------------------------------------------------------------------

export type VisibleBranchSet = {
  /** The branch ids the viewer may see on the Branches page (already authorized). */
  branchIds: string[]
  /** True when the viewer is org-wide (OWNER) and may focus/act on any org branch. */
  orgWide: boolean
}

/**
 * Which branches may appear on the Branches page for this viewer?
 *
 *   OWNER               → every branch of the org (orgWide).
 *   restricted, >= 1    → exactly their assigned ACTIVE branches.
 *   restricted, 0       → NONE (fail-closed): the page hard-stops before this,
 *                         and the result is an empty set even if called.
 *
 * The caller intersects nothing: the input is the branch list ALREADY scoped by
 * `organizationId` from the session, so this gate can only ever narrow it.
 */
export function decideVisibleBranchSet(input: {
  mode: BranchAccessMode
  orgBranchIds: readonly string[]
  accessibleBranchIds: readonly string[]
}): VisibleBranchSet {
  if (input.mode === "all") {
    return { branchIds: [...input.orgBranchIds], orgWide: true }
  }
  if (input.mode === "none") return { branchIds: [], orgWide: false }
  const allowed = new Set(input.accessibleBranchIds)
  return {
    branchIds: input.orgBranchIds.filter((id) => allowed.has(id)),
    orgWide: false,
  }
}

/**
 * May this viewer open this specific branch on the Branches page?
 *
 *   OWNER               → any branch of the org (org-wide authority).
 *   restricted          → only their assigned ACTIVE branches.
 *   restricted, 0       → false (fail-closed).
 *
 * The caller must still load the branch with `organizationId` in the where
 * clause; this gate can only narrow, never widen, an org-scoped list.
 */
export function canViewBranch(input: {
  mode: BranchAccessMode
  accessibleBranchIds: readonly string[]
  branchId: string
}): boolean {
  if (input.mode === "none") return false
  if (input.mode === "all") return true
  return input.accessibleBranchIds.includes(input.branchId)
}

// ---------------------------------------------------------------------------
// Branch card actions (PART 16)
// ---------------------------------------------------------------------------

export type BranchCardAction = "open" | "edit" | "staff" | "deactivate" | "reactivate"

/**
 * Which actions a branch card may offer this viewer. Purely derived from the
 * viewer's EFFECTIVE branch permissions (server-computed) and the branch's
 * lifecycle state — never from anything the client sends.
 *
 *   open       ← branches:view          (always, for every branch they may see)
 *   edit       ← branches:edit
 *   staff      ← branches:manage
 *   deactivate ← branches:deactivate + ACTIVE
 *   reactivate ← branches:deactivate + INACTIVE
 *
 * Note `branches:view` is not re-checked here: the card is only ever rendered
 * for a viewer who already passed the page-level gate.
 */
export function branchCardActions(input: {
  status: string
  canEdit: boolean
  canManageStaff: boolean
  canDeactivate: boolean
}): BranchCardAction[] {
  const actions: BranchCardAction[] = ["open"]
  if (input.canEdit) actions.push("edit")
  if (input.canManageStaff) actions.push("staff")
  if (input.canDeactivate) {
    actions.push(input.status === "ACTIVE" ? "deactivate" : "reactivate")
  }
  return actions
}

// ---------------------------------------------------------------------------
// QR attendance authorization
// ---------------------------------------------------------------------------

export type QrBranchGate = { allowed: true } | { allowed: false; reason: "branch_inactive" }

/**
 * A QR scan may only produce a CheckIn/request when the residing branch is
 * ACTIVE. A deactivated branch keeps its historical sessions visible for the
 * record but rejects every new scan.
 */
export function decideQrBranchGate(input: { branchStatus: string }): QrBranchGate {
  if (input.branchStatus !== "ACTIVE") return { allowed: false, reason: "branch_inactive" }
  return { allowed: true }
}

// ---------------------------------------------------------------------------
// Branch creation allowance (future SaaS pricing seam)
// ---------------------------------------------------------------------------

export type BranchCreationGate =
  | { allowed: true }
  | { allowed: false; reason: "plan_limit_reached" }

/**
 * PURE seam for future plan-based pricing: given the org's branch limit
 * (`null` = unlimited) decide whether another branch may be created. There are
 * deliberately NO subscription/plan fields on Branch itself; the limit is a
 * projected value the domain layer can source from the org's plan later
 * without touching the schema.
 */
export function decideBranchCreation(input: {
  branchLimit: number | null
  currentBranchCount: number
}): BranchCreationGate {
  if (input.branchLimit === null) return { allowed: true }
  if (input.currentBranchCount >= input.branchLimit) {
    return { allowed: false, reason: "plan_limit_reached" }
  }
  return { allowed: true }
}