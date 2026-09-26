import { test } from "node:test"
import assert from "node:assert/strict"

import {
  OWNER_FULL_ACCESS,
  PERMISSION_MATRIX,
  PERMISSION_VALUES,
  can,
  canAny,
  roleDefaultPermissions,
  type Permission,
} from "../src/lib/permissions"
import { PERMISSION_DESCRIPTIONS } from "../src/lib/permission-ui"

// ---------------------------------------------------------------------------
// The Branches module has its OWN permission surface, deliberately separate
// from `settings:manage`. A gym can therefore hand an admin the ability to run
// a branch (create/edit/deactivate/assign staff) WITHOUT handing over gym
// details, data export or staff administration — and the reverse.
// ---------------------------------------------------------------------------

const BRANCH_PERMISSIONS: Permission[] = [
  "branches:view",
  "branches:create",
  "branches:edit",
  "branches:deactivate",
  "branches:manage",
]

test("all five branch permissions exist in the catalog exactly once", () => {
  for (const permission of BRANCH_PERMISSIONS) {
    assert.ok(PERMISSION_VALUES.includes(permission), `${permission} is not in PERMISSION_VALUES`)
    assert.equal(
      PERMISSION_VALUES.filter((p) => p === permission).length,
      1,
      `${permission} is duplicated`
    )
  }
  assert.equal(PERMISSION_VALUES.length, new Set(PERMISSION_VALUES).size)
})

test("OWNER holds every branch permission", () => {
  const owner = { role: "OWNER" as const }
  for (const permission of BRANCH_PERMISSIONS) {
    assert.ok(can(owner, permission), `OWNER is missing ${permission}`)
  }
})

test("ADMIN manages branches, which is what makes the module a real product", () => {
  const admin = { role: "ADMIN" as const }
  for (const permission of BRANCH_PERMISSIONS) {
    assert.ok(can(admin, permission), `ADMIN is missing ${permission}`)
  }
})

test("RECEPTIONIST may view branches but never change them", () => {
  const receptionist = { role: "RECEPTIONIST" as const }
  assert.ok(can(receptionist, "branches:view"))
  assert.equal(can(receptionist, "branches:create"), false)
  assert.equal(can(receptionist, "branches:edit"), false)
  assert.equal(can(receptionist, "branches:deactivate"), false)
  assert.equal(can(receptionist, "branches:manage"), false)
  // Branch administration is independent of gym settings administration.
  assert.equal(can(receptionist, "settings:manage"), false)
})

test("TRAINER has no branch surface at all", () => {
  const trainer = { role: "TRAINER" as const }
  for (const permission of BRANCH_PERMISSIONS) {
    assert.equal(can(trainer, permission), false, `TRAINER should not hold ${permission}`)
  }
})

test("no role except OWNER/ADMIN holds branch administration", () => {
  for (const role of ["RECEPTIONIST", "TRAINER"] as const) {
    const defaults = roleDefaultPermissions(role)
    for (const permission of BRANCH_PERMISSIONS.filter((p) => p !== "branches:view")) {
      assert.equal(
        defaults.includes(permission),
        false,
        `${role} must not default to ${permission}`
      )
    }
  }
})

test("OWNER full access is the whole catalog, branches included", () => {
  assert.deepEqual(OWNER_FULL_ACCESS, [...PERMISSION_VALUES])
})

test("every branch permission is exposed in the permission UI matrix", () => {
  const flat = PERMISSION_MATRIX.flatMap((module) => module.permissions)
  for (const permission of BRANCH_PERMISSIONS) {
    assert.equal(
      flat.some((entry) => entry.permission === permission),
      true,
      `${permission} is missing from the permission matrix`
    )
    assert.ok(
      PERMISSION_DESCRIPTIONS[permission]?.length > 0,
      `${permission} has no description for the UI`
    )
  }
})

test("branch staff access is marked sensitive in the matrix", () => {
  const entry = PERMISSION_MATRIX.flatMap((module) => module.permissions).find(
    (candidate) => candidate.permission === "branches:manage"
  )
  assert.equal(entry?.sensitive, true)
})

test("branch permissions are listed in their own module, not under Settings", () => {
  const modules = PERMISSION_MATRIX.map((module) => module.module)
  assert.equal(modules.includes("Branches"), true)
  const branchModule = PERMISSION_MATRIX.find((module) => module.module === "Branches")
  assert.deepEqual(
    branchModule?.permissions.map((entry) => entry.permission),
    BRANCH_PERMISSIONS
  )
})

test("canAny treats branch permissions like any other permission", () => {
  const receptionist = { role: "RECEPTIONIST" as const }
  assert.ok(canAny(receptionist, ["branches:edit", "branches:view"]))
  assert.equal(canAny(receptionist, ["branches:edit", "branches:manage"]), false)
})
