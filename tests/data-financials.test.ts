import { test } from "node:test"
import assert from "node:assert/strict"

import {
  buildMemberFinancialRows,
  type FinancialMembershipRow,
  type FinancialPaymentRow,
} from "../src/lib/data-financials"
import { utcInstantForKey } from "../src/lib/memberships"

const TZ = "Asia/Kolkata"

const DAY = (key: string): Date => utcInstantForKey(key, TZ)

function membership(overrides: {
  id: string
  memberId: string
  start: string
  end: string
  amountMinor?: number
  status?: FinancialMembershipRow["status"]
  plan?: string
}): FinancialMembershipRow {
  return {
    id: overrides.id,
    memberId: overrides.memberId,
    status: overrides.status ?? "ACTIVE",
    startDate: DAY(overrides.start),
    endDate: DAY(overrides.end),
    amountMinor: overrides.amountMinor ?? 500000,
    plan: { name: overrides.plan ?? "Monthly" },
  }
}

function payment(overrides: {
  id: string
  memberId: string
  key: string
  amountMinor?: number
  method?: string
  status?: FinancialPaymentRow["status"]
}): FinancialPaymentRow {
  return {
    id: overrides.id,
    memberId: overrides.memberId,
    amountMinor: overrides.amountMinor ?? 100000,
    method: overrides.method ?? "CASH",
    status: overrides.status ?? "RECORDED",
    paymentDate: DAY(overrides.key),
  }
}

const range = { fromKey: "2026-09-01", toKey: "2026-09-30" }

// ---------------------------------------------------------------------------
// One membership, multiple payments (the canonical ₹10,000 example)
// ---------------------------------------------------------------------------

test("one ₹10,000 membership with 3 recorded payments totals ₹10,000", () => {
  const rows = buildMemberFinancialRows({
    memberNames: new Map([["mem-1", "Aarav Sharma"]]),
    memberships: [
      membership({ id: "ms-1", memberId: "mem-1", start: "2026-09-01", end: "2026-10-01", amountMinor: 1000000, plan: "Quarterly" }),
    ],
    payments: [
      payment({ id: "p1", memberId: "mem-1", key: "2026-09-05", amountMinor: 300000, method: "CASH" }),
      payment({ id: "p2", memberId: "mem-1", key: "2026-09-10", amountMinor: 400000, method: "UPI" }),
      payment({ id: "p3", memberId: "mem-1", key: "2026-09-18", amountMinor: 300000, method: "UPI" }),
    ],
    membershipRange: range,
    timeZone: TZ,
    today: DAY("2026-09-21"),
  })

  assert.equal(rows.length, 1)
  const row = rows[0]
  assert.equal(row.currentPlan, "Quarterly")
  assert.equal(row.totalMembershipValueMinor, 1000000) // assigned value
  assert.equal(row.totalPaidMinor, 1000000) // recorded payments only
  assert.equal(row.paymentCount, 3)
  assert.equal(row.latestPaymentMinor, 300000)
  assert.equal(row.latestPaymentKey, "2026-09-18")
  assert.deepEqual(row.methods, ["CASH", "UPI"])
})

// ---------------------------------------------------------------------------
// VOIDED/REFUNDED payments never count as money received
// ---------------------------------------------------------------------------

test("VOIDED and REFUNDED payments are excluded from paid totals", () => {
  const rows = buildMemberFinancialRows({
    memberNames: new Map([["mem-1", "Aarav Sharma"]]),
    memberships: [membership({ id: "ms-1", memberId: "mem-1", start: "2026-09-01", end: "2026-10-01" })],
    payments: [
      payment({ id: "p1", memberId: "mem-1", key: "2026-09-05", amountMinor: 300000 }),
      payment({ id: "p2", memberId: "mem-1", key: "2026-09-08", amountMinor: 200000, status: "VOIDED" }),
      payment({ id: "p3", memberId: "mem-1", key: "2026-09-12", amountMinor: 500000, status: "REFUNDED" }),
    ],
    membershipRange: range,
    timeZone: TZ,
  })
  const row = rows[0]
  assert.equal(row.paymentCount, 1)
  assert.equal(row.totalPaidMinor, 300000)
  assert.equal(row.latestPaymentMinor, 300000)
  assert.deepEqual(row.methods, ["CASH"])
})

// ---------------------------------------------------------------------------
// Edge members shred safely
// ---------------------------------------------------------------------------

test("member with payments but no membership clears membership columns", () => {
  const rows = buildMemberFinancialRows({
    memberNames: new Map([["mem-2", "No Plan"]]),
    memberships: [],
    payments: [payment({ id: "p1", memberId: "mem-2", key: "2026-09-15", amountMinor: 990000, method: "UPI" })],
    membershipRange: range,
    timeZone: TZ,
  })
  const row = rows[0]
  assert.equal(row.currentPlan, "")
  assert.equal(row.currentStatus, "")
  assert.equal(row.currentStartKey, "")
  assert.equal(row.currentEndKey, "")
  assert.equal(row.totalMembershipValueMinor, 0)
  assert.equal(row.totalPaidMinor, 990000)
})

test("member with a membership but no payments zeros the paid fields", () => {
  const rows = buildMemberFinancialRows({
    memberNames: new Map([["mem-3", "No Payment Yet"]]),
    memberships: [membership({ id: "ms-9", memberId: "mem-3", start: "2026-09-01", end: "2026-09-30" })],
    payments: [],
    membershipRange: range,
    timeZone: TZ,
  })
  const row = rows[0]
  assert.equal(row.totalPaidMinor, 0)
  assert.equal(row.paymentCount, 0)
  assert.equal(row.latestPaymentMinor, null)
  assert.equal(row.latestPaymentKey, null)
  assert.deepEqual(row.methods, [])
  assert.equal(row.totalMembershipValueMinor, 500000)
})

// ---------------------------------------------------------------------------
// Membership range scoping for Total Membership Value
// ---------------------------------------------------------------------------

test("memberships starting outside the export range do not count toward value", () => {
  const rows = buildMemberFinancialRows({
    memberNames: new Map([["mem-4", "Many Records"]]),
    memberships: [
      // starts in-range (2026-09-01) → counted
      membership({ id: "ms-a", memberId: "mem-4", start: "2026-09-01", end: "2026-09-30", amountMinor: 300000 }),
      // starts outside-range (August) → NOT counted, but still current coverage
      membership({ id: "ms-b", memberId: "mem-4", start: "2026-08-01", end: "2026-08-31", amountMinor: 700000 }),
    ],
    payments: [payment({ id: "p1", memberId: "mem-4", key: "2026-09-10", amountMinor: 300000 })],
    membershipRange: range,
    timeZone: TZ,
    today: DAY("2026-09-15"),
  })
  const row = rows[0]
  assert.equal(row.totalMembershipValueMinor, 300000)
  // current membership/coverage comes from ALL records (Sept record covers today)
  assert.notEqual(row.currentPlan, "")
})

test("all-time (null) membership range counts every membership", () => {
  const rows = buildMemberFinancialRows({
    memberNames: new Map([["mem-5", "All Time"]]),
    memberships: [
      membership({ id: "ms-c", memberId: "mem-5", start: "2026-08-01", end: "2026-08-31", amountMinor: 700000 }),
      membership({ id: "ms-d", memberId: "mem-5", start: "2026-09-01", end: "2026-09-30", amountMinor: 300000 }),
    ],
    payments: [payment({ id: "p1", memberId: "mem-5", key: "2026-09-10", amountMinor: 300000 })],
    membershipRange: null,
    timeZone: TZ,
  })
  assert.equal(rows[0].totalMembershipValueMinor, 1000000)
})

// ---------------------------------------------------------------------------
// Latest payment: date wins, id breaks ties
// ---------------------------------------------------------------------------

test("latest payment is the most recent, tie-broken by id", () => {
  const rows = buildMemberFinancialRows({
    memberNames: new Map([["mem-6", "Ties"]]),
    memberships: [membership({ id: "ms-e", memberId: "mem-6", start: "2026-09-01", end: "2026-09-30" })],
    payments: [
      payment({ id: "p1", memberId: "mem-6", key: "2026-09-20", amountMinor: 1000 }),
      payment({ id: "p3", memberId: "mem-6", key: "2026-09-20", amountMinor: 3000 }),
      payment({ id: "p2", memberId: "mem-6", key: "2026-09-20", amountMinor: 2000 }),
    ],
    membershipRange: range,
    timeZone: TZ,
  })
  const row = rows[0]
  assert.equal(row.latestPaymentMinor, 3000) // newest tie-break id wins
  assert.equal(row.latestPaymentKey, "2026-09-20")
  assert.equal(row.totalPaidMinor, 6000)
})

// ---------------------------------------------------------------------------
// Multi-member: per-member isolation and sort order
// ---------------------------------------------------------------------------

test("rows stay per-member (no cross-member leakage) and sort by name then id", () => {
  const rows = buildMemberFinancialRows({
    memberNames: new Map([
      ["mem-z", "Aarav Sharma"],
      ["mem-a", "Aarav Sharma"],
      ["mem-b", "Neha Gupta"],
    ]),
    memberships: [membership({ id: "ms-1", memberId: "mem-z", start: "2026-09-01", end: "2026-09-30", amountMinor: 999999 })],
    payments: [
      payment({ id: "p-z1", memberId: "mem-z", key: "2026-09-05", amountMinor: 111000 }),
      payment({ id: "p-a1", memberId: "mem-a", key: "2026-09-06", amountMinor: 222000 }),
      payment({ id: "p-b1", memberId: "mem-b", key: "2026-09-07", amountMinor: 333000 }),
    ],
    membershipRange: range,
    timeZone: TZ,
  })
  assert.equal(rows.length, 3)
  // sorted by name then id: "Aarav Sharma" ties, so id decides → mem-a before mem-z
  assert.equal(rows[0].memberId, "mem-a")
  assert.equal(rows[0].totalPaidMinor, 222000)
  assert.equal(rows[1].memberId, "mem-z")
  assert.equal(rows[1].totalPaidMinor, 111000)
  assert.equal(rows[2].memberId, "mem-b")
  assert.equal(rows[2].totalPaidMinor, 333000)
  // no cross-member leakage of payment amounts
  assert.equal(rows[0].totalPaidMinor + rows[1].totalPaidMinor + rows[2].totalPaidMinor, 666000)
  // a member outside the passed universe never appears (tenant isolation boundary)
  assert.ok(!rows.some((r) => r.memberId === "mem-outside-universe"))
})

// ---------------------------------------------------------------------------
// Empty inputs
// ---------------------------------------------------------------------------

test("empty member universe produces no rows", () => {
  assert.deepEqual(
    buildMemberFinancialRows({
      memberNames: new Map(),
      memberships: [],
      payments: [],
      membershipRange: null,
      timeZone: TZ,
    }),
    []
  )
})

// ---------------------------------------------------------------------------
// Current membership coverage uses the primary membership engine
// ---------------------------------------------------------------------------

test("current membership reflects member-level coverage across records", () => {
  // A renewed chain: Aug record + Sept back-to-back record → ACTIVE, latest end shown.
  const rows = buildMemberFinancialRows({
    memberNames: new Map([["mem-7", "Renewed"]]),
    memberships: [
      membership({ id: "ms-1", memberId: "mem-7", start: "2026-08-01", end: "2026-08-31", amountMinor: 500000 }),
      membership({ id: "ms-2", memberId: "mem-7", start: "2026-09-01", end: "2026-09-30", amountMinor: 500000, plan: "Monthly Gold" }),
    ],
    payments: [payment({ id: "p1", memberId: "mem-7", key: "2026-09-01", amountMinor: 500000 })],
    membershipRange: range,
    timeZone: TZ,
    today: DAY("2026-09-15"),
  })
  const row = rows[0]
  assert.equal(row.currentPlan, "Monthly Gold")
  assert.equal(row.currentStatus, "ACTIVE")
  assert.equal(row.currentStartKey, "2026-09-01")
  assert.equal(row.currentEndKey, "2026-09-30")
  assert.equal(row.totalMembershipValueMinor, 500000) // only Sept start in-range
})

test("expired member keeps EXPIRED status and historical membership value", () => {
  const rows = buildMemberFinancialRows({
    memberNames: new Map([["mem-8", "Expired"]]),
    memberships: [
      membership({ id: "ms-1", memberId: "mem-8", start: "2026-07-01", end: "2026-07-31", amountMinor: 800000, status: "EXPIRED" }),
    ],
    payments: [],
    membershipRange: null,
    timeZone: TZ,
    today: DAY("2026-09-15"),
  })
  const row = rows[0]
  assert.equal(row.currentStatus, "EXPIRED")
  assert.equal(row.totalMembershipValueMinor, 800000)
  assert.equal(row.paymentCount, 0)
})