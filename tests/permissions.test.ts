import { test } from "node:test"
import assert from "node:assert/strict"

import { can, canAny } from "../src/lib/permissions"

test("OWNER can access all permission surfaces", () => {
  const owner = { role: "OWNER" as const }
  assert.ok(can(owner, "members:view"))
  assert.ok(can(owner, "members:create"))
  assert.ok(can(owner, "plans:manage"))
  assert.ok(can(owner, "payments:record"))
  assert.ok(can(owner, "appointments:manage"))
  assert.ok(can(owner, "reports:view"))
  assert.ok(can(owner, "settings:manage"))
  assert.ok(can(owner, "staff:manage"))
})

test("RECEPTIONIST can manage day-to-day operations but not staff", () => {
  const receptionist = { role: "RECEPTIONIST" as const }
  assert.ok(can(receptionist, "members:create"))
  assert.ok(can(receptionist, "payments:record"))
  assert.ok(can(receptionist, "appointments:manage"))
  assert.ok(can(receptionist, "reports:view"))
  assert.ok(!can(receptionist, "staff:manage"))
  assert.ok(!can(receptionist, "plans:manage"))
  assert.ok(!can(receptionist, "settings:manage"))
})

test("TRAINER has limited read-only access", () => {
  const trainer = { role: "TRAINER" as const }
  assert.ok(can(trainer, "members:view"))
  assert.ok(can(trainer, "attendance:view"))
  assert.ok(can(trainer, "leads:view"))
  assert.ok(can(trainer, "appointments:view"))
  assert.ok(can(trainer, "tasks:view"))
  assert.ok(!can(trainer, "members:create"))
  assert.ok(!can(trainer, "payments:record"))
  assert.ok(!can(trainer, "tasks:manage"))
  assert.ok(can(trainer, "reports:view"))
})

test("canAny returns true when any permission is granted", () => {
  const receptionist = { role: "RECEPTIONIST" as const }
  assert.ok(canAny(receptionist, ["staff:manage", "members:create"]))
  assert.ok(!canAny(receptionist, ["staff:manage", "plans:manage"]))
})

test("unknown role grants nothing", () => {
  assert.ok(!can({ role: "GHOST" as "OWNER" }, "members:view"))
})