import { test } from "node:test"
import assert from "node:assert/strict"

import {
  branchCardActions,
  branchSwitcherVisiblity,
  canViewBranch,
  decideBranchAccessMode,
  decideBranchCreation,
  decideBranchDeactivation,
  decideBranchReactivation,
  decideQrBranchGate,
  decideVisibleBranchSet,
  resolveBranchContext,
} from "../src/lib/branch-rules"

// ---------------------------------------------------------------------------
// Branch lifecycle + access rules (pure decision gates).
// ---------------------------------------------------------------------------

test("decideBranchDeactivation allows only an ACTIVE non-final branch", () => {
  assert.deepEqual(decideBranchDeactivation({ status: "ACTIVE", activeBranchCount: 2 }), { allowed: true })
  // Final active branch must never be deactivatable.
  assert.deepEqual(decideBranchDeactivation({ status: "ACTIVE", activeBranchCount: 1 }), {
    allowed: false,
    reason: "only_active_branch",
  })
  // Already inactive.
  assert.deepEqual(decideBranchDeactivation({ status: "INACTIVE", activeBranchCount: 5 }), {
    allowed: false,
    reason: "already_inactive",
  })
})

test("decideBranchReactivation allows only an INACTIVE branch", () => {
  assert.deepEqual(decideBranchReactivation({ status: "INACTIVE" }), { allowed: true })
  assert.deepEqual(decideBranchReactivation({ status: "ACTIVE" }), {
    allowed: false,
    reason: "not_inactive",
  })
})

test("decideBranchAccessMode maps role + assignment count to a mode", () => {
  assert.equal(decideBranchAccessMode({ role: "OWNER", assignedBranchCount: 0 }), "all")
  assert.equal(decideBranchAccessMode({ role: "ADMIN", assignedBranchCount: 2 }), "multi")
  assert.equal(decideBranchAccessMode({ role: "RECEPTIONIST", assignedBranchCount: 1 }), "single")
  // Fail-closed: zero assignments, zero scope.
  assert.equal(decideBranchAccessMode({ role: "ADMIN", assignedBranchCount: 0 }), "none")
})

test("shouldShowBranchSwitcher shows ONLY for multi mode", () => {
  assert.equal(branchSwitcherVisiblity({ role: "OWNER", assignedBranchCount: 4 }).visible, false)
  assert.equal(branchSwitcherVisiblity({ role: "ADMIN", assignedBranchCount: 1 }).visible, false)
  assert.equal(branchSwitcherVisiblity({ role: "ADMIN", assignedBranchCount: 2 }).visible, true)
  assert.equal(branchSwitcherVisiblity({ role: "ADMIN", assignedBranchCount: 0 }).visible, false)
})

test("resolveBranchContext: OWNER is always org-wide", () => {
  assert.deepEqual(
    resolveBranchContext({ role: "OWNER", assignedBranches: [], requestedBranchId: "b9" }),
    { mode: "all", activeBranchId: null }
  )
  // Even with a valid-looking cookie an OWNER stays org-wide by role.
  assert.deepEqual(
    resolveBranchContext({ role: "OWNER", assignedBranches: [{ id: "b1", isPrimary: true }], requestedBranchId: "b1" }),
    { mode: "all", activeBranchId: null }
  )
})

test("resolveBranchContext: zero assignments is fail-closed", () => {
  assert.deepEqual(
    resolveBranchContext({ role: "ADMIN", assignedBranches: [], requestedBranchId: "b1" }),
    { mode: "none", activeBranchId: null }
  )
})

test("resolveBranchContext honours the requested cookie only when assigned", () => {
  const assigned = [
    { id: "b1", isPrimary: true },
    { id: "b2", isPrimary: false },
  ]
  // Valid requested branch wins over the primary.
  assert.deepEqual(resolveBranchContext({ role: "ADMIN", assignedBranches: assigned, requestedBranchId: "b2" }), {
    mode: "multi",
    activeBranchId: "b2",
  })
  // Tampered / foreign requested branch is silently ignored → primary wins.
  assert.deepEqual(resolveBranchContext({ role: "ADMIN", assignedBranches: assigned, requestedBranchId: "b9999" }), {
    mode: "multi",
    activeBranchId: "b1",
  })
  // No cookie → primary wins.
  assert.deepEqual(resolveBranchContext({ role: "ADMIN", assignedBranches: assigned, requestedBranchId: null }), {
    mode: "multi",
    activeBranchId: "b1",
  })
})

test("resolveBranchContext falls back to the primary, then the first assignment", () => {
  // No primary flagged anywhere → deterministic first assignment (caller's order).
  const noPrimary = [
    { id: "b2", isPrimary: false },
    { id: "b1", isPrimary: false },
  ]
  assert.deepEqual(resolveBranchContext({ role: "RECEPTIONIST", assignedBranches: noPrimary, requestedBranchId: null }), {
    mode: "multi",
    activeBranchId: "b2",
  })
  // Single assignment → single mode.
  assert.deepEqual(
    resolveBranchContext({ role: "RECEPTIONIST", assignedBranches: [{ id: "b1", isPrimary: true }], requestedBranchId: null }),
    { mode: "single", activeBranchId: "b1" }
  )
})

test("decideQrBranchGate rejects scans at an inactive branch", () => {
  assert.deepEqual(decideQrBranchGate({ branchStatus: "ACTIVE" }), { allowed: true })
  assert.deepEqual(decideQrBranchGate({ branchStatus: "INACTIVE" }), {
    allowed: false,
    reason: "branch_inactive",
  })
})

test("decideBranchCreation is the future pricing seam (unlimited today)", () => {
  assert.deepEqual(decideBranchCreation({ branchLimit: null, currentBranchCount: 99 }), { allowed: true })
  assert.deepEqual(decideBranchCreation({ branchLimit: 2, currentBranchCount: 1 }), { allowed: true })
  assert.deepEqual(decideBranchCreation({ branchLimit: 2, currentBranchCount: 2 }), {
    allowed: false,
    reason: "plan_limit_reached",
  })
})

// ---------------------------------------------------------------------------
// Branches page visibility (WHO may see which branch at all)
// ---------------------------------------------------------------------------

test("decideVisibleBranchSet: an owner sees every org branch", () => {
  assert.deepEqual(
    decideVisibleBranchSet({ mode: "all", orgBranchIds: ["b1", "b2", "b3"], accessibleBranchIds: [] }),
    { branchIds: ["b1", "b2", "b3"], orgWide: true }
  )
})

test("decideVisibleBranchSet: a restricted viewer sees only assigned branches", () => {
  assert.deepEqual(
    decideVisibleBranchSet({ mode: "multi", orgBranchIds: ["b1", "b2", "b3"], accessibleBranchIds: ["b2"] }),
    { branchIds: ["b2"], orgWide: false }
  )
  assert.deepEqual(
    decideVisibleBranchSet({ mode: "single", orgBranchIds: ["b1", "b2"], accessibleBranchIds: ["b1"] }),
    { branchIds: ["b1"], orgWide: false }
  )
})

test("decideVisibleBranchSet: never widens beyond the org's own branch list", () => {
  // An assignment id that is not in orgBranchIds (stale/foreign row) is dropped.
  assert.deepEqual(
    decideVisibleBranchSet({ mode: "multi", orgBranchIds: ["b1"], accessibleBranchIds: ["b1", "b9999"] }),
    { branchIds: ["b1"], orgWide: false }
  )
  // Fail-closed: zero assignments -> no branches at all (the page hard-stops).
  assert.deepEqual(
    decideVisibleBranchSet({ mode: "none", orgBranchIds: ["b1", "b2"], accessibleBranchIds: [] }),
    { branchIds: [], orgWide: false }
  )
  assert.deepEqual(
    decideVisibleBranchSet({ mode: "multi", orgBranchIds: ["b1"], accessibleBranchIds: [] }),
    { branchIds: [], orgWide: false }
  )
})

test("canViewBranch mirrors the visible set, per branch", () => {
  const owner = { mode: "all", accessibleBranchIds: [] } as const
  assert.equal(canViewBranch({ ...owner, branchId: "b1" }), true)
  assert.equal(canViewBranch({ ...owner, branchId: "anything" }), true)

  const restricted = { mode: "multi", accessibleBranchIds: ["b2"] } as const
  assert.equal(canViewBranch({ ...restricted, branchId: "b2" }), true)
  assert.equal(canViewBranch({ ...restricted, branchId: "b1" }), false)

  // Fail-closed for a user with no branch at all.
  assert.equal(canViewBranch({ mode: "none", accessibleBranchIds: [], branchId: "b1" }), false)
})

// ---------------------------------------------------------------------------
// Branch card actions
// ---------------------------------------------------------------------------

test("branchCardActions always offers 'open' and only the permitted extras", () => {
  assert.deepEqual(
    branchCardActions({ status: "ACTIVE", canEdit: false, canManageStaff: false, canDeactivate: false }),
    ["open"]
  )
  assert.deepEqual(
    branchCardActions({ status: "ACTIVE", canEdit: true, canManageStaff: true, canDeactivate: true }),
    ["open", "edit", "staff", "deactivate"]
  )
})

test("branchCardActions offers reactivate (never deactivate) on an inactive branch", () => {
  assert.deepEqual(
    branchCardActions({ status: "INACTIVE", canEdit: true, canManageStaff: false, canDeactivate: true }),
    ["open", "edit", "reactivate"]
  )
  // Without the permission, an inactive branch is read-only.
  assert.deepEqual(
    branchCardActions({ status: "INACTIVE", canEdit: false, canManageStaff: false, canDeactivate: false }),
    ["open"]
  )
})

test("branchCardActions never offers staff management without the permission", () => {
  const actions = branchCardActions({
    status: "ACTIVE",
    canEdit: true,
    canManageStaff: false,
    canDeactivate: false,
  })
  assert.equal(actions.includes("staff"), false)
  assert.equal(actions.includes("deactivate"), false)
})