import { test } from "node:test"
import assert from "node:assert/strict"

import {
  APPOINTMENT_STATUS,
  LEAD_SOURCE,
  LEAD_STAGE,
  MEMBER_STATUS,
  MEMBERSHIP_STATUS,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  PLAN_INTERVAL,
  TASK_STATUS,
  USER_ROLE,
  toneOfStatus,
} from "../src/lib/status"

test("all status maps expose a tone and label", () => {
  const maps = [
    APPOINTMENT_STATUS,
    LEAD_SOURCE,
    LEAD_STAGE,
    MEMBER_STATUS,
    MEMBERSHIP_STATUS,
    PAYMENT_METHOD,
    PAYMENT_STATUS,
    PLAN_INTERVAL,
    TASK_STATUS,
    USER_ROLE,
  ]
  for (const map of maps) {
    for (const [key, entry] of Object.entries(map)) {
      assert.ok(entry.label, `${key} should have a label`)
      assert.ok(entry.tone, `${key} should have a tone`)
    }
  }
})

test("PLAN_INTERVAL maps billing intervals to day counts", () => {
  assert.equal(PLAN_INTERVAL.MONTHLY.days, 30)
  assert.equal(PLAN_INTERVAL.QUARTERLY.days, 90)
  assert.equal(PLAN_INTERVAL.HALF_YEARLY.days, 180)
  assert.equal(PLAN_INTERVAL.YEARLY.days, 365)
})

test("toneOfStatus preserves entry", () => {
  const entry = toneOfStatus({ tone: "success", label: "Active" })
  assert.equal(entry.tone, "success")
  assert.equal(entry.label, "Active")
})

test("APPOINTMENT_STATUS covers the four CRM statuses", () => {
  assert.deepEqual(Object.keys(APPOINTMENT_STATUS).sort(), [
    "CANCELLED",
    "COMPLETED",
    "NO_SHOW",
    "SCHEDULED",
  ])
})