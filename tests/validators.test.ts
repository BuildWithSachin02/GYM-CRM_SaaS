import { test } from "node:test"
import assert from "node:assert/strict"

import {
  appointmentSchema,
  appointmentStatusSchema,
  leadSchema,
  loginSchema,
  memberSchema,
  orgSettingsSchema,
  paymentSchema,
  planSchema,
  staffSchema,
  staffUpdateSchema,
  taskSchema,
  trainerSchema,
} from "../src/lib/validators"

test("memberSchema accepts a valid member", () => {
  const res = memberSchema.safeParse({
    firstName: "Rahul",
    lastName: "Sharma",
    phone: "+91 98765 43210",
    email: "",
    gender: null,
    dateOfBirth: null,
    notes: "",
  })
  assert.equal(res.success, true)
})

test("memberSchema rejects missing phone", () => {
  const res = memberSchema.safeParse({
    firstName: "Rahul",
    lastName: "Sharma",
    phone: "",
  })
  assert.equal(res.success, false)
})

test("planSchema rejects non-positive price", () => {
  const res = planSchema.safeParse({
    name: "Monthly",
    billingInterval: "MONTHLY",
    priceMinor: 0,
    durationDays: 30,
  })
  assert.equal(res.success, false)
})

test("appointmentSchema rejects appointment without member or lead", () => {
  const res = appointmentSchema.safeParse({
    memberId: null,
    leadId: null,
    startsAt: "2026-09-10T10:00:00.000Z",
    endsAt: "2026-09-10T11:00:00.000Z",
    status: "SCHEDULED",
    notes: null,
  })
  assert.equal(res.success, false)
})

test("appointmentSchema rejects end before start", () => {
  const res = appointmentSchema.safeParse({
    memberId: "e6f5a048-9294-45cb-b0cd-000000000001",
    leadId: null,
    startsAt: "2026-09-10T11:00:00.000Z",
    endsAt: "2026-09-10T10:00:00.000Z",
    status: "SCHEDULED",
    notes: null,
  })
  assert.equal(res.success, false)
})

test("appointmentSchema accepts valid member appointment", () => {
  const res = appointmentSchema.safeParse({
    memberId: "e6f5a048-9294-45cb-b0cd-000000000001",
    leadId: null,
    staffId: null,
    trainerId: null,
    status: "SCHEDULED",
    startsAt: "2026-09-10T10:00:00.000Z",
    endsAt: "2026-09-10T11:00:00.000Z",
  })
  assert.equal(res.success, true)
})

test("appointmentStatusSchema accepts valid statuses", () => {
  for (const status of ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"]) {
    const res = appointmentStatusSchema.safeParse({
      appointmentId: "e6f5a048-9294-45cb-b0cd-000000000001",
      status,
    })
    assert.equal(res.success, true, `status ${status} should be valid`)
  }
})

test("staffSchema requires password of at least 8 chars", () => {
  const bad = staffSchema.safeParse({
    name: "Receptionist",
    email: "reception@kingsgym.com",
    phone: null,
    role: "RECEPTIONIST",
    password: "short",
  })
  assert.equal(bad.success, false)
  const good = staffSchema.safeParse({
    name: "Receptionist",
    email: "reception@kingsgym.com",
    phone: null,
    role: "RECEPTIONIST",
    password: "longenough",
  })
  assert.equal(good.success, true)
})

test("staffUpdateSchema allows optional empty password reset", () => {
  const res = staffUpdateSchema.safeParse({
    staffId: "e6f5a048-9294-45cb-b0cd-000000000001",
    name: "Receptionist",
    phone: null,
    role: "RECEPTIONIST",
    status: "ACTIVE",
    password: null,
  })
  assert.equal(res.success, true)
})

test("trainerSchema requires valid staff userId", () => {
  const res = trainerSchema.safeParse({
    userId: "not-a-uuid",
    active: true,
  })
  assert.equal(res.success, false)
})

test("leadSchema rejects invalid stage", () => {
  const res = leadSchema.safeParse({
    name: "Arjun",
    phone: "+91 90000 00000",
    source: "INSTAGRAM",
    stage: "BOGUS",
  })
  assert.equal(res.success, false)
})

test("paymentSchema rejects payment with invalid method", () => {
  const res = paymentSchema.safeParse({
    memberId: "e6f5a048-9294-45cb-b0cd-000000000001",
    membershipId: null,
    amountMinor: 1000,
    method: "CHEQUE",
    paymentDate: "2026-09-09T00:00:00.000Z",
  })
  assert.equal(res.success, false)
})

test("orgSettingsSchema accepts valid org settings without openingHours", () => {
  const res = orgSettingsSchema.safeParse({
    name: "King's Gym",
    phone: "+91 98765 43210",
    email: "info@kingsgym.com",
    address: "MG Road",
    city: "Pune",
    state: "MH",
    country: "India",
    timezone: "Asia/Kolkata",
  })
  assert.equal(res.success, true)
})

test("loginSchema validates email and password presence", () => {
  assert.equal(
    loginSchema.safeParse({ email: "owner@kingsgym.com", password: "secret123" }).success,
    true
  )
  assert.equal(loginSchema.safeParse({ email: "owner@kingsgym.com", password: "" }).success, false)
  assert.equal(
    loginSchema.safeParse({ email: "not-an-email", password: "secret123" }).success,
    false
  )
})

test("taskSchema requires a due date", () => {
  const res = taskSchema.safeParse({
    title: "Follow up",
    description: null,
    dueDate: "",
    status: "TODO",
    assigneeId: null,
    memberId: null,
    leadId: null,
  })
  assert.equal(res.success, false)
})