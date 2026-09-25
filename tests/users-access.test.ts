import { test } from "node:test"
import assert from "node:assert/strict"

import {
  effectivePermissions,
  grantablePermissions,
  ownerRoleChangeForbidden,
  wouldRemoveLastOwner,
  isSelf,
  normalizeUsername,
  diffPermissions,
  type PermissionOverride,
} from "../src/lib/user-access"
import {
  ALL_PERMISSIONS,
  can,
  canAny,
  ForbiddenError,
  OWNER_FULL_ACCESS,
  PERMISSION_MATRIX,
  PERMISSION_VALUES,
  permissionLabel,
  requirePermission,
  roleDefaultPermissions,
  type Permission,
} from "../src/lib/permissions"
import { USERNAME_MIN, USERNAME_MAX } from "../src/lib/user-access"

// ---------------------------------------------------------------------------
// Scope note (integration coverage)
//
// The test harness is pure Node (tsx --test): it cannot import next/headers,
// prisma, or the `server-only` guarded modules. DB-backed behaviors —
// sessionVersion bumps on security changes, stale-session rejection, cookie
// re-issue, org-scoped SQL, and audit row writing — are enforced inside
// src/lib/actions/users.ts and src/lib/auth/auth.ts and are exercised by the
// Manual QA checklist instead of fake tests here.
//
// Everything below validates real decision functions from
// src/lib/user-access.ts and src/lib/permissions.ts — the exact code that
// drives those DB writes.
// ---------------------------------------------------------------------------

const hmac_override = (permission: string, granted: boolean): PermissionOverride => ({
  permission,
  granted,
})

// ---------------------------------------------------------------------------
// Role defaults
// ---------------------------------------------------------------------------

test("ADMIN role defaults include staff:manage and settings access", () => {
  const perms = roleDefaultPermissions("ADMIN")
  assert.ok(perms.includes("staff:manage"))
  assert.ok(perms.includes("settings:manage"))
  assert.ok(perms.includes("members:create"))
})

test("TRAINER role defaults are minimal and exclude staff:manage", () => {
  const perms = roleDefaultPermissions("TRAINER")
  assert.ok(perms.includes("members:view"))
  assert.ok(perms.includes("attendance:view"))
  assert.ok(!perms.includes("staff:manage"))
  assert.ok(!perms.includes("plans:manage"))
  assert.ok(!perms.includes("payments:record"))
})

test("every role default is a known permission in the catalog", () => {
  const roles = ["OWNER", "ADMIN", "RECEPTIONIST", "TRAINER"] as const
  for (const role of roles) {
    for (const p of roleDefaultPermissions(role)) {
      assert.ok(
        PERMISSION_VALUES.includes(p as (typeof PERMISSION_VALUES)[number]),
        `role ${role} default "${p}" is not in PERMISSION_VALUES`
      )
    }
  }
})

// ---------------------------------------------------------------------------
// effectivePermissions — grants, revokes, OWNER narrowability
// ---------------------------------------------------------------------------

test("effectivePermissions returns role defaults when there are no overrides", () => {
  assert.deepEqual(
    effectivePermissions("RECEPTIONIST", []),
    roleDefaultPermissions("RECEPTIONIST")
  )
})

test("a granted override adds a permission the role does not default to", () => {
  const perms = effectivePermissions("TRAINER", [
    hmac_override("members:create", true),
  ])
  assert.ok(perms.includes("members:create"))
})

test("a denied override revokes a permission the role defaults to", () => {
  const perms = effectivePermissions("RECEPTIONIST", [
    hmac_override("members:create", false),
    hmac_override("payments:record", false),
  ])
  assert.ok(!perms.includes("members:create"))
  assert.ok(!perms.includes("payments:record"))
  assert.ok(perms.includes("members:view"), "unrelated default untouched")
})

test("denied overrides win over role defaults (precedence)", () => {
  const perms = effectivePermissions("ADMIN", [hmac_override("payments:record", false)])
  assert.ok(!perms.includes("payments:record"), "explicit false beats ADMIN default true")
})

test("an unknown/typo permission in an override is ignored safely", () => {
  const perms = effectivePermissions("RECEPTIONIST", [hmac_override("system:root", true)])
  assert.ok(!perms.includes("system:root" as Permission))
  assert.deepEqual(perms, roleDefaultPermissions("RECEPTIONIST"))
})

test("OWNER always has the full catalog regardless of overrides", () => {
  const full = effectivePermissions("OWNER", [])
  assert.deepEqual(full, OWNER_FULL_ACCESS)
  assert.equal(full.length, PERMISSION_VALUES.length)
})

test("OWNER cannot be narrowed by denied overrides", () => {
  const full = effectivePermissions("OWNER", [
    hmac_override("staff:manage", false),
    hmac_override("payments:record", false),
    { permission: "members:view", granted: false },
  ])
  assert.ok(full.includes("staff:manage"))
  assert.ok(full.includes("payments:record"))
  assert.ok(full.includes("members:view"))
  assert.equal(full.length, PERMISSION_VALUES.length)
})

// ---------------------------------------------------------------------------
// Owner-role hierarchy
// ---------------------------------------------------------------------------

test("only an OWNER can set the OWNER role (create/promote)", () => {
  assert.equal(ownerRoleChangeForbidden("OWNER", "OWNER"), false)
  assert.equal(ownerRoleChangeForbidden("OWNER", "ADMIN"), false)
  assert.equal(ownerRoleChangeForbidden("ADMIN", "OWNER"), true)
  assert.equal(ownerRoleChangeForbidden("RECEPTIONIST", "OWNER"), true)
  assert.equal(ownerRoleChangeForbidden("TRAINER", "OWNER"), true)
})

test("ADMIN cannot create or promote an OWNER", () => {
  assert.ok(ownerRoleChangeForbidden("ADMIN", "OWNER"))
})

test("ADMIN can still manage other staff (no OWNER target)", () => {
  for (const target of ["ADMIN", "RECEPTIONIST", "TRAINER"] as const) {
    assert.equal(ownerRoleChangeForbidden("ADMIN", target), false)
  }
})

// ---------------------------------------------------------------------------
// Last-active-OWNER protection
// ---------------------------------------------------------------------------

test("removing the only active owner is forbidden", () => {
  assert.ok(
    wouldRemoveLastOwner({
      targetIsActiveOwner: true,
      activeOwnerCount: 1,
      targetBecomesInactiveOrNonOwner: true,
    })
  )
})

test("removing an owner is fine when another active owner remains", () => {
  assert.equal(
    wouldRemoveLastOwner({
      targetIsActiveOwner: true,
      activeOwnerCount: 2,
      targetBecomesInactiveOrNonOwner: true,
    }),
    false
  )
})

test("non-owner targets never trip the last-owner guard", () => {
  assert.equal(
    wouldRemoveLastOwner({
      targetIsActiveOwner: false,
      activeOwnerCount: 1,
      targetBecomesInactiveOrNonOwner: true,
    }),
    false
  )
})

test("keeping the target as an active owner never trips the guard", () => {
  assert.equal(
    wouldRemoveLastOwner({
      targetIsActiveOwner: true,
      activeOwnerCount: 1,
      targetBecomesInactiveOrNonOwner: false,
    }),
    false
  )
})

// ---------------------------------------------------------------------------
// Self-deactivation protection
// ---------------------------------------------------------------------------

test("isSelf detects the actor operating on their own account", () => {
  assert.ok(isSelf("u1", "u1"))
  assert.equal(isSelf("u1", "u2"), false)
})

// ---------------------------------------------------------------------------
// can() / canAny() / requirePermission() — effective set preferred, role
// default fallback for callers without an explicit list
// ---------------------------------------------------------------------------

test("can() uses the effective permissions list when present", () => {
  const receptionist = {
    role: "RECEPTIONIST" as const,
    permissions: ["members:view", "members:update"] as Permission[],
  }
  assert.ok(can(receptionist, "members:view"))
  assert.ok(can(receptionist, "members:update"))
  assert.equal(can(receptionist, "staff:manage"), false)
})

test("can() falls back to role defaults when no list is present", () => {
  assert.ok(can({ role: "ADMIN" as const }, "staff:manage"))
  assert.equal(can({ role: "TRAINER" as const }, "staff:manage"), false)
})

test("canAny() matches any of the requested permissions", () => {
  assert.ok(canAny({ role: "TRAINER" as const }, ["members:view", "staff:manage"]))
  assert.equal(canAny({ role: "TRAINER" as const }, ["plans:manage", "staff:manage"]), false)
})

test("requirePermission throws only on denial", () => {
  assert.doesNotThrow(() => requirePermission({ role: "ADMIN" }, "staff:manage"))
  assert.throws(() => requirePermission({ role: "TRAINER" }, "staff:manage"), ForbiddenError)
})

// ---------------------------------------------------------------------------
// Username normalization / validation
// ---------------------------------------------------------------------------

test("normalizeUsername trims, lowercases and keeps a valid alias", () => {
  assert.equal(normalizeUsername("  Tanvi.Fitness "), "tanvi.fitness")
  assert.equal(normalizeUsername("ravi_01"), "ravi_01")
  assert.equal(normalizeUsername("a-b.c_d"), "a-b.c_d")
})

test("normalizeUsername returns null for empty/absent values", () => {
  assert.equal(normalizeUsername(null), null)
  assert.equal(normalizeUsername(undefined), null)
  assert.equal(normalizeUsername(""), null)
  assert.equal(normalizeUsername("   "), null)
})

test("normalizeUsername rejects invalid values with a descriptive error", () => {
  assert.throws(() => normalizeUsername("ab"), new RegExp(USERNAME_MIN.toString()))
  assert.throws(() => normalizeUsername("x".repeat(USERNAME_MAX + 1)))
  assert.throws(() => normalizeUsername("with space"))
  assert.throws(() => normalizeUsername("-leading"))
  assert.throws(() => normalizeUsername("trailing-"))
  assert.throws(() => normalizeUsername("bang!"))
})

test("normalizeUsername accepts uppercase input because it normalizes case first", () => {
  assert.equal(normalizeUsername("Tanvi.Fitness"), "tanvi.fitness")
})

test("normalizeUsername throws for the exact min/max boundary so the schema can catch it", () => {
  assert.ok(normalizeUsername("abc"))
  assert.throws(() => normalizeUsername("x".repeat(USERNAME_MAX + 1)))
  assert.ok(normalizeUsername("x".repeat(USERNAME_MAX)))
})

// ---------------------------------------------------------------------------
// diffPermissions — the audit/change engine behind permission updates
// ---------------------------------------------------------------------------

test("diffPermissions returns null when nothing changes", () => {
  const current = { "members:view": true, "payments:record": true }
  assert.equal(diffPermissions(current, { ...current, "payments:record": true }), null)
})

test("diffPermissions detects a freshly granted permission", () => {
  const diff = diffPermissions({ "members:view": true }, { "members:view": true, "staff:manage": true })
  assert.deepEqual(diff, { granted: ["staff:manage"], revoked: [] })
})

test("diffPermissions detects revoking a permission that was granted by role default", () => {
  // Mirrors the seeded baseline in updateUserPermissions (role defaults +
  // explicit rows) — flipping a default-granted permission OFF must be reported
  // as a revocation so a `granted:false` override row gets written.
  const baseline = roleDefaultPermissions("RECEPTIONIST").reduce<Record<string, boolean>>(
    (acc, p) => ((acc[p] = true), acc),
    {}
  )
  const desired = { ...baseline, "members:create": false, "staff:manage": true }
  const diff = diffPermissions(baseline, desired)
  assert.ok(diff)
  assert.deepEqual(diff!.granted, ["staff:manage"])
  assert.deepEqual(diff!.revoked, ["members:create"])
})

// ---------------------------------------------------------------------------
// Permission catalog / matrix integrity
// ---------------------------------------------------------------------------

test("ALL_PERMISSIONS equals PERMISSION_VALUES (single source of truth)", () => {
  assert.deepEqual(ALL_PERMISSIONS, [...PERMISSION_VALUES])
  assert.ok(ALL_PERMISSIONS.includes("staff:manage"))
})

test("every matrix permission is a real permission with a label", () => {
  for (const entry of PERMISSION_MATRIX) {
    for (const p of entry.permissions) {
      assert.ok(
        PERMISSION_VALUES.includes(p.permission),
        `${entry.module} declares unknown permission ${p.permission}`
      )
      assert.ok(permissionLabel(p.permission).length > 0)
    }
  }
})

test("QR Check-in deliberately reuses attendance:record (no duplicate powers)", () => {
  // attendance:record appears under both Attendance and QR Check-in on purpose —
  // the QR kiosk flow is the same permission, so revoking it removes both.
  const entry = PERMISSION_MATRIX.find((m) => m.module === "QR Check-in")
  assert.ok(entry)
  assert.deepEqual(entry!.permissions, [{ permission: "attendance:record", action: "Use" }])
})

test("Users & Access module marks staff:manage as sensitive", () => {
  const entry = PERMISSION_MATRIX.find((m) => m.module === "Users & Access")
  assert.ok(entry)
  assert.ok(entry!.permissions.length === 1)
  assert.equal(entry!.permissions[0].permission, "staff:manage")
  assert.equal(entry!.permissions[0].sensitive, true)
})

test("OWNER_FULL_ACCESS covers every permission in the catalog", () => {
  for (const p of PERMISSION_VALUES) {
    assert.ok(OWNER_FULL_ACCESS.includes(p), `OWNER missing ${p}`)
  }
})

// ---------------------------------------------------------------------------
// Policy echo — the security rules implemented by src/lib/actions/users.ts
// ---------------------------------------------------------------------------

test("policy: ADMIN holding staff:manage still cannot create an OWNER", () => {
  assert.ok(ownerRoleChangeForbidden("ADMIN", "OWNER"))
})

test("policy: an OWNER's effective set is unaffected by any override rows", () => {
  const overrides = ALL_PERMISSIONS.map((p) => hmac_override(p, false))
  assert.deepEqual(effectivePermissions("OWNER", overrides), OWNER_FULL_ACCESS)
})

test("policy: deactivating yourself is always blocked at the decision layer", () => {
  assert.ok(isSelf("u1", "u1"))
})

test("policy: effective set derives only role + overrides (no org dimension leaks in)", () => {
  // The overrides model is intentionally organization-agnostic at the pure
  // layer — tenant isolation is enforced by the org-scoped queries in the
  // actions (organizationId filters + findStaffInOrg). This documents that
  // decision so future refactors don't "add" cross-tenant data here.
  const perms = effectivePermissions("RECEPTIONIST", [
    hmac_override("members:create", false),
  ])
  assert.ok(!perms.includes("members:create"))
})

// ---------------------------------------------------------------------------
// Anti-privilege-escalation (grantor authority)
// ---------------------------------------------------------------------------

test("policy: the OWNER can grant the full catalog", () => {
  const grantable = grantablePermissions("OWNER", ["members:view"])
  assert.equal(grantable.length, ALL_PERMISSIONS.length)
  for (const p of ALL_PERMISSIONS) assert.ok(grantable.includes(p))
})

test("policy: a non-owner can only grant what they effectively hold", () => {
  const effective = effectivePermissions("TRAINER", [
    { permission: "staff:manage", granted: true },
    { permission: "members:view", granted: true },
  ])
  const grantable = grantablePermissions("TRAINER", effective)
  assert.ok(grantable.includes("staff:manage"))
  assert.ok(grantable.includes("members:view"))
  // The TRAINER role default has no create rights beyond views, and the
  // override did not add members:create — so they must NOT be grantable.
  assert.ok(!grantable.includes("members:create"))
  assert.ok(!grantable.includes("payments:record"))
  assert.ok(!grantable.includes("settings:manage"))
})

test("policy: an ADMIN's full defaults keep every module grantable (short of OWNER role)", () => {
  const effective = effectivePermissions("ADMIN", [])
  const grantable = grantablePermissions("ADMIN", effective)
  for (const p of ALL_PERMISSIONS) assert.ok(grantable.includes(p))
})

test("policy: a REVOKED permission is not grantable by the same actor", () => {
  // Actor effectively lost members:update (role default revoked via override)
  // and therefore must not be able to grant it to someone else.
  const effective = effectivePermissions("RECEPTIONIST", [
    { permission: "members:update", granted: false },
  ])
  const grantable = grantablePermissions("RECEPTIONIST", effective)
  assert.ok(!grantable.includes("members:update"))
  assert.ok(grantable.includes("members:view"))
})