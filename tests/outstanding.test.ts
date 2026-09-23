import { test } from "node:test"
import assert from "node:assert/strict"

import {
  buildOutstandingDuesRows,
  buildOutstandingMemberships,
  buildOutstandingTotals,
  checkPaymentAmount,
  deriveOutstandingStatus,
  isOutstandingTrackedStatus,
  outstandingOfMembership,
  OUTSTANDING_STATUS_ORDER,
  summarizeOutstanding,
  type OutstandingMembershipInput,
  type OutstandingPaymentRecord,
} from "../src/lib/outstanding"

// ---------------------------------------------------------------------------
// Outstanding / dues business rules.
//
//  - A membership's FINAL PAYABLE is `amountMinor` (the agreed price), never
//    revenue.
//  - PAID comes ONLY from RECORDED payment rows (VOIDED/REFUNDED excluded).
//  - OUTSTANDING = finalPayable - paid, per membership (no cross-membership
//    netting).
//  - Status is DERIVED: PAID (no balance), PENDING (no due date yet, or the
//    org-local expected day has not passed), OVERDUE (expected day passed).
//  - CANCELLED memberships can't receive payment, so they never produce a due.
// ---------------------------------------------------------------------------

const TZ = "Asia/Kolkata"
// A fixed "today" so day comparisons are deterministic: IST 2026-09-22.
const TODAY = new Date("2026-09-22T06:00:00Z")

function member(firstName = "Aarav", lastName = "Sharma") {
  return { firstName, lastName, phone: "9000000001" }
}

function makeMembership(overrides: Partial<OutstandingMembershipInput>): OutstandingMembershipInput {
  const plan = { name: "Monthly" }
  return {
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    memberId: "member-1",
    startDate: new Date("2026-09-01T00:00:00Z"),
    endDate: new Date("2026-09-30T00:00:00Z"),
    status: "ACTIVE",
    amountMinor: 500000, // ₹5,000
    expectedPaymentDate: null,
    member: member(),
    plan,
    ...overrides,
  }
}

function makePayment(
  membershipId: string | null,
  amountMinor: number,
  status = "RECORDED"
): OutstandingPaymentRecord {
  return { membershipId, amountMinor, status }
}

// ---------------------------------------------------------------------------
// Balance math
// ---------------------------------------------------------------------------

test("partial payment: ₹1,000 of a ₹5,000 membership leaves ₹4,000 outstanding (PENDING)", () => {
  const membership = makeMembership({})
  const payments = [makePayment(membership.id, 100000)]
  const [row] = buildOutstandingMemberships({ memberships: [membership], payments, timeZone: TZ, today: TODAY })
  assert.equal(row.finalPayableMinor, 500000)
  assert.equal(row.paidMinor, 100000)
  assert.equal(row.outstandingMinor, 400000)
  assert.equal(row.status, "PENDING")
  assert.equal(row.expectedPaymentKey, null)
})

test("multiple partial payments sum to the same paid total", () => {
  const membership = makeMembership({})
  const payments = [
    makePayment(membership.id, 100000),
    makePayment(membership.id, 150000),
    makePayment(membership.id, 50000),
  ]
  const [row] = buildOutstandingMemberships({ memberships: [membership], payments, timeZone: TZ, today: TODAY })
  assert.equal(row.paidMinor, 300000)
  assert.equal(row.outstandingMinor, 200000)
  assert.equal(row.status, "PENDING")
})

test("full payment marks the membership PAID with zero outstanding", () => {
  const membership = makeMembership({})
  const payments = [makePayment(membership.id, 500000)]
  const [row] = buildOutstandingMemberships({ memberships: [membership], payments, timeZone: TZ, today: TODAY })
  assert.equal(row.outstandingMinor, 0)
  assert.equal(row.status, "PAID")
})

test("VOIDED and REFUNDED payments never reduce the balance", () => {
  const membership = makeMembership({})
  const payments = [
    makePayment(membership.id, 100000, "RECORDED"),
    makePayment(membership.id, 400000, "VOIDED"),
    makePayment(membership.id, 400000, "REFUNDED"),
  ]
  const [row] = buildOutstandingMemberships({ memberships: [membership], payments, timeZone: TZ, today: TODAY })
  assert.equal(row.paidMinor, 100000)
  assert.equal(row.outstandingMinor, 400000)
  assert.equal(row.status, "PENDING")
})

test("payments without a membership link never contribute to a balance", () => {
  const membership = makeMembership({})
  const payments = [
    makePayment(null, 100000),
    makePayment("someone-else-membership", 400000),
  ]
  const [row] = buildOutstandingMemberships({ memberships: [membership], payments, timeZone: TZ, today: TODAY })
  assert.equal(row.paidMinor, 0)
  assert.equal(row.outstandingMinor, 500000)
})

test("several memberships of one member keep separate balances (no netting)", () => {
  const paid = makeMembership({ id: "m1", amountMinor: 500000 })
  const unpaid = makeMembership({ id: "m2", amountMinor: 400000 })
  const payments = [
    makePayment("m1", 500000),
    makePayment("m2", 10000), // still owes most of its ₹4,000
  ]
  const rows = buildOutstandingMemberships({ memberships: [paid, unpaid], payments, timeZone: TZ, today: TODAY })
  const byId = new Map(rows.map((r) => [r.membershipId, r]))
  assert.equal(byId.get("m1")!.status, "PAID")
  assert.equal(byId.get("m1")!.outstandingMinor, 0)
  assert.equal(byId.get("m2")!.outstandingMinor, 390000)
  // The zero balance on m1 never nets against m2's balance.
  const summary = summarizeOutstanding(rows)
  assert.equal(summary.totalOutstandingMinor, 390000)
  assert.equal(summary.paidCount, 1)
  assert.equal(summary.duesCount, 1)
})

// ---------------------------------------------------------------------------
// Overpayment guard (server + client share the same rule and message)
// ---------------------------------------------------------------------------

test("a payment cannot exceed the remaining balance (exact guard message)", () => {
  const over = checkPaymentAmount({ amountMinor: 400100, remainingMinor: 400000 })
  assert.equal(over.ok, false)
  assert.equal(
    "error" in over ? over.error : "",
    // The message quotes the REMAINING balance — the ceiling being protected.
    "Payment amount cannot exceed the outstanding balance of ₹4,000."
  )
  // Exact remaining is fine.
  assert.deepEqual(checkPaymentAmount({ amountMinor: 400000, remainingMinor: 400000 }), { ok: true })
  // Under is fine (keeps a partial balance).
  assert.deepEqual(checkPaymentAmount({ amountMinor: 250000, remainingMinor: 400000 }), { ok: true })
})

test("no payment is allowed when the balance is already settled", () => {
  const blocked = checkPaymentAmount({ amountMinor: 1000, remainingMinor: 0 })
  assert.equal(blocked.ok, false)
  assert.equal(
    "error" in blocked ? blocked.error : "",
    "This membership has no outstanding balance left to pay."
  )
})

test("zero/negative amounts are rejected by the guard", () => {
  assert.equal(checkPaymentAmount({ amountMinor: 0, remainingMinor: 400000 }).ok, false)
  assert.equal(checkPaymentAmount({ amountMinor: -100, remainingMinor: 400000 }).ok, false)
})

// ---------------------------------------------------------------------------
// Derived status: expected payment date boundaries
// ---------------------------------------------------------------------------

test("due today is still PENDING; only a strictly-past expected day is OVERDUE", () => {
  const expectedToday = new Date("2026-09-22T06:00:00Z") // IST day 22, same as TODAY
  const expectedYesterday = new Date("2026-09-21T06:00:00Z")
  const expectedTomorrow = new Date("2026-09-23T06:00:00Z")
  for (const expected of [expectedToday, expectedTomorrow]) {
    assert.equal(
      deriveOutstandingStatus({ outstandingMinor: 400000, expectedPaymentDate: expected, timeZone: TZ, today: TODAY }),
      "PENDING",
      `expected ${expected.toISOString()}`
    )
  }
  assert.equal(
    deriveOutstandingStatus({ outstandingMinor: 400000, expectedPaymentDate: expectedYesterday, timeZone: TZ, today: TODAY }),
    "OVERDUE"
  )
})

test("a settlement with no expected date is PENDING (not overdue)", () => {
  const s = deriveOutstandingStatus({ outstandingMinor: 400000, expectedPaymentDate: null, timeZone: TZ, today: TODAY })
  assert.equal(s, "PENDING")
})

test("a settled balance is PAID regardless of the expected date", () => {
  assert.equal(
    deriveOutstandingStatus({ outstandingMinor: 0, expectedPaymentDate: new Date("2026-09-01T06:00:00Z"), timeZone: TZ, today: TODAY }),
    "PAID"
  )
})

test("expected PaymentDate comparisons use org-local day keys", () => {
  // UTC midnight lands on the SAME IST day → PENDING (due "today").
  assert.equal(
    deriveOutstandingStatus({
      outstandingMinor: 1,
      expectedPaymentDate: new Date("2026-09-21T18:30:00Z"), // IST 22nd 00:00
      timeZone: TZ,
      today: TODAY,
    }),
    "PENDING"
  )
})

test("daysOverdue counts whole org-local calendar days past the due date", () => {
  const membership = makeMembership({
    expectedPaymentDate: new Date("2026-09-19T06:00:00Z"), // 3 days before IST 22nd
  })
  const [row] = buildOutstandingMemberships({
    memberships: [membership],
    payments: [makePayment(membership.id, 0)],
    timeZone: TZ,
    today: TODAY,
  })
  assert.equal(row.status, "OVERDUE")
  assert.equal(row.daysOverdue, 3)
  assert.equal(row.daysRemaining, null)
})

test("daysRemaining counts whole org-local calendar days until the due date", () => {
  const membership = makeMembership({
    expectedPaymentDate: new Date("2026-09-27T06:00:00Z"), // 5 days after IST 22nd
  })
  const [row] = buildOutstandingMemberships({
    memberships: [membership],
    payments: [makePayment(membership.id, 10000)],
    timeZone: TZ,
    today: TODAY,
  })
  assert.equal(row.status, "PENDING")
  assert.equal(row.daysRemaining, 5)
  assert.equal(row.daysOverdue, null)
  assert.equal(row.expectedPaymentKey, "2026-09-27")
})

// ---------------------------------------------------------------------------
// Summary + status ordering
// ---------------------------------------------------------------------------

test("summaries split total/pending/overdue and count dues vs paid", () => {
  const overdue = makeMembership({ id: "a", amountMinor: 400000, expectedPaymentDate: new Date("2026-09-10T06:00:00Z") })
  const pending = makeMembership({ id: "b", amountMinor: 300000 })
  const paid = makeMembership({ id: "c", amountMinor: 200000 })
  const payments = [
    makePayment("a", 0),
    makePayment("b", 50000),
    makePayment("c", 200000),
  ]
  const rows = buildOutstandingMemberships({ memberships: [overdue, pending, paid], payments, timeZone: TZ, today: TODAY })
  const s = summarizeOutstanding(rows)
  assert.equal(s.totalOutstandingMinor, 400000 + 250000)
  assert.equal(s.pendingMinor, 250000)
  assert.equal(s.pendingCount, 1)
  assert.equal(s.overdueMinor, 400000)
  assert.equal(s.overdueCount, 1)
  assert.equal(s.duesCount, 2)
  assert.equal(s.paidCount, 1)
})

test("dues rows sort OVERDUE → PENDING → PAID, most urgent first", () => {
  const oldestOverdue = makeMembership({ id: "o1", memberId: "m-o1", amountMinor: 400000, expectedPaymentDate: new Date("2026-09-05T06:00:00Z") })
  const newerOverdue = makeMembership({ id: "o2", memberId: "m-o2", amountMinor: 400000, expectedPaymentDate: new Date("2026-09-20T06:00:00Z") })
  const pending = makeMembership({ id: "p1", memberId: "m-p", amountMinor: 250000 })
  const paid = makeMembership({ id: "d1", memberId: "m-d", amountMinor: 100000 })
  const payments = [
    makePayment("d1", 100000),
    makePayment("p1", 0),
    makePayment("o1", 10000),
    makePayment("o2", 10000),
  ]
  const rows = buildOutstandingDuesRows({
    memberships: [paid, pending, newerOverdue, oldestOverdue],
    payments,
    timeZone: TZ,
    today: TODAY,
  })
  assert.deepEqual(
    rows.map((r) => r.membershipId),
    ["o1", "o2", "p1", "d1"]
  )
  assert.equal(rows[0].daysOverdue, 17)
  assert.equal(rows[1].daysOverdue, 2)
})

test("the dues ledger carries member + plan identity and payment counts", () => {
  const membership = makeMembership({
    id: "m-id",
    memberId: "member-42",
    amountMinor: 500000,
    expectedPaymentDate: new Date("2026-09-28T06:00:00Z"),
    member: member("Diya", "Kapoor"),
  })
  const payments = [makePayment("m-id", 100000), makePayment("m-id", 100000)]
  const [row] = buildOutstandingDuesRows({ memberships: [membership], payments, timeZone: TZ, today: TODAY })
  assert.equal(row.memberName, "Diya Kapoor")
  assert.equal(row.memberPhone, "9000000001")
  assert.equal(row.planName, "Monthly")
  assert.equal(row.paidMinor, 200000)
  assert.equal(row.outstandingMinor, 300000)
  assert.equal(row.paymentCount, 2)
  assert.equal(row.status, "PENDING")
  assert.equal(row.daysRemaining, 6)
})

test("CANCELLED memberships never appear in the ledger even with a balance", () => {
  const cancelled = makeMembership({ id: "cancelled", status: "CANCELLED", amountMinor: 400000 })
  const active = makeMembership({ id: "active-m", amountMinor: 400000 })
  const payments = [makePayment("cancelled", 0), makePayment("active-m", 0)]
  const rows = buildOutstandingDuesRows({ memberships: [cancelled, active], payments, timeZone: TZ, today: TODAY })
  assert.deepEqual(rows.map((r) => r.membershipId), ["active-m"])
  assert.equal(isOutstandingTrackedStatus("CANCELLED"), false)
  assert.equal(isOutstandingTrackedStatus("PAUSED"), true)
  assert.equal(isOutstandingTrackedStatus("EXPIRED"), true)
})

test("PAUSED and EXPIRED memberships keep their balance as dues", () => {
  const paused = makeMembership({ id: "pz", status: "PAUSED", amountMinor: 400000 })
  const expired = makeMembership({ id: "ex", status: "EXPIRED", amountMinor: 400000 })
  const payments = [makePayment("pz", 0), makePayment("ex", 200000)]
  const rows = buildOutstandingDuesRows({ memberships: [paused, expired], payments, timeZone: TZ, today: TODAY })
  assert.equal(rows.length, 2)
  assert.equal(rows.find((r) => r.membershipId === "pz")!.outstandingMinor, 400000)
  assert.equal(rows.find((r) => r.membershipId === "ex")!.outstandingMinor, 200000)
})

test("the status presentation order is stable for filter dropdowns", () => {
  assert.deepEqual(OUTSTANDING_STATUS_ORDER, ["OVERDUE", "PENDING", "PAID"])
})

test("money math stays in integer paise (no float drift across three payments)", () => {
  const membership = makeMembership({ amountMinor: 500000 })
  const payments = [
    makePayment(membership.id, 12345),
    makePayment(membership.id, 99999),
    makePayment(membership.id, 123456),
  ]
  const totals = buildOutstandingTotals(payments)
  assert.equal(totals.get(membership.id)!.paidMinor, 12345 + 99999 + 123456)
  assert.equal(totals.get(membership.id)!.paymentCount, 3)
  const [row] = buildOutstandingMemberships({ memberships: [membership], payments, timeZone: TZ, today: TODAY })
  assert.equal(row.outstandingMinor, 500000 - (12345 + 99999 + 123456))
})

test("outstandingOfMembership clamps a negative balance at zero defensively", () => {
  const membership = makeMembership({})
  const row = outstandingOfMembership({ row: membership, paidMinor: 999999, timeZone: TZ, today: TODAY })
  assert.equal(row.outstandingMinor, 0)
  assert.equal(row.status, "PAID")
})