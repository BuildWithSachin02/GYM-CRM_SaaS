import { test } from "node:test"
import assert from "node:assert/strict"

import {
  ALL_PERMISSIONS,
  PERMISSION_MATRIX,
  PERMISSION_VALUES,
  roleDefaultPermissions,
  type Permission,
} from "../src/lib/permissions"
import {
  ACTION_DESCRIPTIONS,
  actionPermissionsOf,
  clearAllPermissions,
  defaultPermissionMap,
  enforceViewDependency,
  PERMISSION_DESCRIPTIONS,
  permissionDescription,
  selectAllGrantable,
  setModulePermission,
  summarizePermissions,
  toggleModuleAccessIn,
  togglePermissionIn,
  viewPermissionOf,
} from "../src/lib/permission-ui"

// ---------------------------------------------------------------------------
// Presentation metadata — never invents permissions, only explains the catalog
// ---------------------------------------------------------------------------

function fullOffMap(): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const p of ALL_PERMISSIONS) map[p] = false
  return map
}

function membersModule() {
  return PERMISSION_MATRIX.find((m) => m.module === "Members")!
}

test("every catalog permission has a non-empty human explanation", () => {
  for (const p of ALL_PERMISSIONS) {
    assert.ok(
      PERMISSION_DESCRIPTIONS[p]?.length > 0,
      `${p} has no description`
    )
  }
})

test("permission descriptions never drift from the catalog", () => {
  const keys = Object.keys(PERMISSION_DESCRIPTIONS).sort()
  assert.deepEqual(keys, [...ALL_PERMISSIONS].sort())
})

test("every action label used in the matrix has a glossary line", () => {
  const actions = new Set(PERMISSION_MATRIX.flatMap((m) => m.permissions.map((p) => p.action)))
  for (const action of actions) {
    assert.ok(ACTION_DESCRIPTIONS[action], `action "${action}" has no explanation`)
  }
})

test("permissionDescription prefers the specific permission text then the action label", () => {
  assert.equal(
    permissionDescription("members:view", "View"),
    PERMISSION_DESCRIPTIONS["members:view"]
  )
  assert.ok(permissionDescription("members:view", "View").length > 0)
})

// ---------------------------------------------------------------------------
// Module shape — view base vs. action rows (drives the card layout)
// ---------------------------------------------------------------------------

test("viewPermissionOf finds the :view base of a module", () => {
  const members = PERMISSION_MATRIX.find((m) => m.module === "Members")!
  assert.equal(viewPermissionOf(members), "members:view")
  const qr = PERMISSION_MATRIX.find((m) => m.module === "QR Check-in")!
  assert.equal(viewPermissionOf(qr), undefined)
})

test("actionPermissionsOf excludes the view base from the action rows", () => {
  const members = PERMISSION_MATRIX.find((m) => m.module === "Members")!
  const actions = actionPermissionsOf(members).map((p) => p.permission)
  assert.ok(!actions.includes("members:view"))
  assert.deepEqual(actions, ["members:create", "members:update", "members:archive"])
})

test("actionPermissionsOf leaves no-view modules (QR Check-in) intact", () => {
  const qr = PERMISSION_MATRIX.find((m) => m.module === "QR Check-in")!
  assert.deepEqual(
    actionPermissionsOf(qr).map((p) => p.permission),
    ["attendance:record"]
  )
})

// ---------------------------------------------------------------------------
// View-dependency normalization — the same rule the backend expects
// ---------------------------------------------------------------------------

test("togglePermissionIn: enabling an action forces the module view on", () => {
  const map = fullOffMap()
  const next = togglePermissionIn(map, "members:create", membersModule())
  assert.equal(next["members:create"], true)
  assert.equal(next["members:view"], true)
})

test("togglePermissionIn: turning the view off clears the module's other actions", () => {
  const boost = (map: Record<string, boolean>) => {
    for (const p of ALL_PERMISSIONS) map[p] = true
  }
  const map: Record<string, boolean> = {}
  boost(map)
  const next = togglePermissionIn(map, "members:view", membersModule())
  assert.equal(next["members:view"], false)
  assert.equal(next["members:create"], false)
  assert.equal(next["members:update"], false)
  assert.equal(next["members:archive"], false)
  assert.equal(next["payments:view"], true)
})

test("toggleModuleAccessIn: turning module access off clears the module's actions", () => {
  const map: Record<string, boolean> = {}
  for (const p of ALL_PERMISSIONS) map[p] = true
  const next = toggleModuleAccessIn(map, membersModule())
  assert.equal(next["members:view"], false)
  assert.equal(next["members:create"], false)
  assert.equal(next["members:archive"], false)
})

test("toggleModuleAccessIn: turning module access on enables the view only", () => {
  const next = toggleModuleAccessIn(fullOffMap(), membersModule())
  assert.equal(next["members:view"], true)
  assert.equal(next["members:create"], false)
})

test("toggleModuleAccessIn is a no-op for modules without a view (QR Check-in)", () => {
  const qr = PERMISSION_MATRIX.find((m) => m.module === "QR Check-in")!
  const map = fullOffMap()
  assert.deepEqual(toggleModuleAccessIn(map, qr), map)
})

test("setModulePermission: Select all only enables grantable permissions", () => {
  const next = setModulePermission(
    fullOffMap(),
    membersModule(),
    true,
    new Set(["members:view", "members:update"])
  )
  assert.equal(next["members:view"], true)
  assert.equal(next["members:update"], true)
  assert.equal(next["members:create"], false) // not grantable by the actor
  assert.equal(next["members:archive"], false)
})

test("setModulePermission: Clear all turns the module off and respects view cleanup", () => {
  const map: Record<string, boolean> = {}
  for (const p of ALL_PERMISSIONS) map[p] = true
  const next = setModulePermission(map, membersModule(), false, new Set())
  assert.equal(next["members:view"], false)
  assert.equal(next["members:create"], false)
  assert.equal(next["payments:view"], true)
})

test("enforceViewDependency: view off clears the module's other actions", () => {
  const map: Record<string, boolean> = {}
  for (const p of ALL_PERMISSIONS) map[p] = true
  map["members:view"] = false
  const next = enforceViewDependency(map)
  assert.equal(next["members:create"], false)
  assert.equal(next["members:update"], false)
  assert.equal(next["members:archive"], false)
  assert.equal(next["payments:view"], true)
})

test("enforceViewDependency: attendance:record flows to QR Check-in (shared key)", () => {
  const map: Record<string, boolean> = {}
  for (const p of ALL_PERMISSIONS) map[p] = true
  map["attendance:view"] = false
  const next = enforceViewDependency(map)
  assert.equal(next["attendance:record"], false)
})

test("enforceViewDependency is idempotent and leaves unknown keys alone", () => {
  const map = fullOffMap()
  map["members:create"] = true
  const once = enforceViewDependency(map)
  const twice = enforceViewDependency(once)
  assert.deepEqual(twice, once)
  ;(once as Record<string, boolean>)["future:thing"] = true
  assert.equal(enforceViewDependency(once)["future:thing"], true)
})

// ---------------------------------------------------------------------------
// Role baseline maps
// ---------------------------------------------------------------------------

test("defaultPermissionMap covers the full key set and mirrors role defaults", () => {
  for (const role of ["OWNER", "ADMIN", "RECEPTIONIST", "TRAINER"] as const) {
    const map = defaultPermissionMap(role)
    assert.deepEqual(Object.keys(map).sort(), [...ALL_PERMISSIONS].sort())
    const defaults = new Set(roleDefaultPermissions(role))
    for (const p of ALL_PERMISSIONS) {
      assert.equal(map[p], defaults.has(p), `${role} ${p}`)
    }
  }
})

// ---------------------------------------------------------------------------
// Select / clear helpers
// ---------------------------------------------------------------------------

test("selectAllGrantable turns on only grantable permissions", () => {
  const next = selectAllGrantable(fullOffMap(), new Set(["members:view", "members:create", "payments:view"]))
  assert.equal(next["members:view"], true)
  assert.equal(next["members:create"], true)
  assert.equal(next["payments:view"], true)
  assert.equal(next["payments:record"], false)
})

test("selectAllGrantable never silently revokes what the actor cannot re-grant", () => {
  const map = fullOffMap()
  map["settings:view"] = true // consistent: the module's base is on
  map["settings:manage"] = true // currently on, actor cannot grant it
  const next = selectAllGrantable(map, new Set(["members:view"]))
  assert.equal(next["settings:view"], true)
  assert.equal(next["settings:manage"], true)
})

test("clearAllPermissions turns everything off and keeps the key set", () => {
  const map: Record<string, boolean> = {}
  for (const p of ALL_PERMISSIONS) map[p] = true
  const next = clearAllPermissions(map)
  assert.deepEqual(Object.keys(next).sort(), [...ALL_PERMISSIONS].sort())
  assert.ok(Object.values(next).every((v) => v === false))
})

// ---------------------------------------------------------------------------
// Summary counts
// ---------------------------------------------------------------------------

test("summarizePermissions counts enabled, accessible modules and custom changes", () => {
  const roleDefaults = new Set(roleDefaultPermissions("RECEPTIONIST"))
  const map = defaultPermissionMap("RECEPTIONIST")
  map["members:create"] = false // one revoke
  map["staff:manage"] = true // one grant

  const summary = summarizePermissions(map, roleDefaults)
  const expectedEnabled = Object.values(map).filter(Boolean).length
  const expectedModules = new Set(
    PERMISSION_MATRIX.filter((e) => e.permissions.some((p) => map[p.permission])).map(
      (e) => e.module
    )
  ).size

  assert.equal(summary.enabled, expectedEnabled)
  assert.equal(summary.modules, expectedModules)
  assert.equal(summary.changes, 2)
})

test("summarizePermissions counts custom changes against the role baseline", () => {
  const roleDefaults = new Set(roleDefaultPermissions("RECEPTIONIST"))
  const map = defaultPermissionMap("RECEPTIONIST") // exactly the baseline
  assert.equal(summarizePermissions(map, roleDefaults).changes, 0)
  map["members:create"] = false // one revoke
  map["staff:manage"] = true // one grant
  assert.equal(summarizePermissions(map, roleDefaults).changes, 2)
})

test("permission catalog integrity is unchanged by the UI metadata", () => {
  // The editor must never add/remove permissions — the catalog is the single
  // source of truth and stays exactly PERMISSION_VALUES.
  assert.deepEqual(ALL_PERMISSIONS, [...PERMISSION_VALUES])
  assert.deepEqual(Object.keys(PERMISSION_DESCRIPTIONS).sort(), [...PERMISSION_VALUES].sort())
})

test("every matrix module still only declares real permissions", () => {
  for (const entry of PERMISSION_MATRIX) {
    for (const p of entry.permissions) {
      assert.ok(
        PERMISSION_VALUES.includes(p.permission),
        `${entry.module} declares unknown permission ${p.permission}`
      )
      assert.ok(permissionDescription(p.permission as Permission, p.action).length > 0)
    }
  }
})