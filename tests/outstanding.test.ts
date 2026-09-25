import { test } from "node:test"
import assert from "node:assert/strict"

import {
  buildOutstandingDuesRows,
  buildOutstandingMemberships,
  buildOutstandingTotals,
  checkPaymentAmount,
  deriveOutstandingStatus,
  isOutstandingTrackedStatus,
  matchesDuesSearch,
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

// ---------------------------------------------------------------------------
// REGRESSION: a balance with ZERO Payment rows must still show as pending dues
// (the Prince Gond / MEM-0028 ₹3,499 case). The dues ledger is derived from
// membership price − RECORDED payments, never from a Payment row existing.
// ---------------------------------------------------------------------------

test("REGRESSION: unpaid membership with zero Payment rows appears as PENDING dues", () => {
  const membership = makeMembership({
    id: "prince-gond",
    memberId: "member-prince",
    amountMinor: 349900, // ₹3,499
    expectedPaymentDate: null,
    member: { firstName: "Prince", lastName: "Gond", memberCode: "MEM-0028" },
  })
  const rows = buildOutstandingDuesRows({ memberships: [membership], payments: [], timeZone: TZ, today: TODAY })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].membershipId, "prince-gond")
  assert.equal(rows[0].memberName, "Prince Gond")
  assert.equal(rows[0].memberCode, "MEM-0028")
  assert.equal(rows[0].paidMinor, 0)
  assert.equal(rows[0].outstandingMinor, 349900)
  assert.equal(rows[0].status, "PENDING")
  assert.equal(rows[0].expectedPaymentKey, null)
})

test("CASE A: ₹5,000 membership, ₹0 paid → ₹5,000 outstanding, listed as pending", () => {
  const membership = makeMembership({ id: "m-a", amountMinor: 500000 })
  const rows = buildOutstandingDuesRows({ memberships: [membership], payments: [], timeZone: TZ, today: TODAY })
  assert.equal(rows[0].paidMinor, 0)
  assert.equal(rows[0].outstandingMinor, 500000)
  assert.equal(rows[0].status, "PENDING")
})

test("CASE B: ₹5,000 membership, ₹1,000 paid → ₹4,000 outstanding, still pending", () => {
  const membership = makeMembership({ id: "m-b", amountMinor: 500000 })
  const rows = buildOutstandingDuesRows({
    memberships: [membership],
    payments: [makePayment("m-b", 100000)],
    timeZone: TZ,
    today: TODAY,
  })
  assert.equal(rows[0].paidMinor, 100000)
  assert.equal(rows[0].outstandingMinor, 400000)
  assert.equal(rows[0].status, "PENDING")
})

test("CASE C: fully paid membership is excluded from the pending list", () => {
  const membership = makeMembership({ id: "m-c", amountMinor: 500000 })
  const rows = buildOutstandingDuesRows({
    memberships: [membership],
    payments: [makePayment("m-c", 500000)],
    timeZone: TZ,
    today: TODAY,
  })
  assert.equal(rows[0].status, "PAID")
  // The Payments page's PENDING filter is `status === "PENDING"` — a settled
  // membership never matches it, so it drops off the pending-due list.
  assert.equal(rows.filter((r) => r.status === "PENDING").length, 0)
})

test("CASE E: outstanding with NO due date is PENDING (never OVERDUE, never hidden)", () => {
  const membership = makeMembership({
    id: "m-e",
    amountMinor: 349900,
    expectedPaymentDate: null,
  })
  const rows = buildOutstandingDuesRows({ memberships: [membership], payments: [], timeZone: TZ, today: TODAY })
  assert.equal(rows[0].status, "PENDING")
  assert.equal(rows[0].expectedPaymentKey, null)
})

test("CASE F: outstanding with a future due date is PENDING", () => {
  const membership = makeMembership({
    id: "m-f",
    expectedPaymentDate: new Date("2026-09-30T06:00:00Z"), // after the fixed TODAY
  })
  const rows = buildOutstandingDuesRows({ memberships: [membership], payments: [], timeZone: TZ, today: TODAY })
  assert.equal(rows[0].status, "PENDING")
  assert.equal(rows[0].daysRemaining, 8)
})

test("CASE G: outstanding with a passed due date is OVERDUE", () => {
  const membership = makeMembership({
    id: "m-g",
    expectedPaymentDate: new Date("2026-09-10T06:00:00Z"),
  })
  const rows = buildOutstandingDuesRows({ memberships: [membership], payments: [], timeZone: TZ, today: TODAY })
  assert.equal(rows[0].status, "OVERDUE")
  assert.equal(rows[0].daysOverdue, 12)
})

test("CASE H: multiple memberships keep separate balances — no double counting", () => {
  const paid = makeMembership({ id: "m-h1", memberId: "member-multi", amountMinor: 500000 })
  const unpaid = makeMembership({ id: "m-h2", memberId: "member-multi", amountMinor: 400000 })
  const rows = buildOutstandingDuesRows({
    memberships: [paid, unpaid],
    payments: [makePayment("m-h1", 500000)],
    timeZone: TZ,
    today: TODAY,
  })
  const dues = rows.filter((r) => r.status === "PENDING" || r.status === "OVERDUE")
  assert.equal(dues.length, 1)
  assert.equal(dues[0].membershipId, "m-h2")
  assert.equal(dues[0].outstandingMinor, 400000)
  // The settled membership's ₹5,000 is never netted against the open ₹4,000.
  assert.equal(summarizeOutstanding(buildOutstandingMemberships({
    memberships: [paid, unpaid],
    payments: [makePayment("m-h1", 500000)],
    timeZone: TZ,
    today: TODAY,
  })).totalOutstandingMinor, 400000)
})

test("recording a payment reduces outstanding; a second (settling) payment clears it", () => {
  const membership = makeMembership({ id: "m-pay", amountMinor: 349900 })
  const afterFirst = buildOutstandingDuesRows({
    memberships: [membership],
    payments: [makePayment("m-pay", 100000)],
    timeZone: TZ,
    today: TODAY,
  })
  assert.equal(afterFirst[0].outstandingMinor, 249900)
  assert.equal(afterFirst[0].status, "PENDING")
  assert.equal(afterFirst[0].paymentCount, 1)

  const afterSecond = buildOutstandingDuesRows({
    memberships: [membership],
    payments: [makePayment("m-pay", 100000), makePayment("m-pay", 249900)],
    timeZone: TZ,
    today: TODAY,
  })
  assert.equal(afterSecond[0].outstandingMinor, 0)
  assert.equal(afterSecond[0].status, "PAID")
  assert.equal(afterSecond[0].paymentCount, 2)
  assert.equal(afterSecond.filter((r) => r.status === "PENDING").length, 0)
})

test("an unpaid balance is NEVER revenue (outstanding ≠ received)", () => {
  // ₹3,499 outstanding exists only as a balance: zero RECORDED payments means
  // zero paid. The outstanding amount is what is still owed — it is never
  // added to paid totals (the revenue pipeline counts only Payment rows).
  const membership = makeMembership({ id: "m-rev", amountMinor: 349900 })
  const [row] = buildOutstandingMemberships({ memberships: [membership], payments: [], timeZone: TZ, today: TODAY })
  assert.equal(row.paidMinor, 0)
  assert.equal(row.outstandingMinor, 349900)
  assert.equal(buildOutstandingTotals([]).get("m-rev"), undefined)
})

// ---------------------------------------------------------------------------
// Dues search (member name + Member Code) — the Payments pending view predicate
// ---------------------------------------------------------------------------

test("dues search matches by member name and by Member Code, case-insensitively", () => {
  const row = { memberName: "Prince Gond", memberCode: "MEM-0028" }
  assert.equal(matchesDuesSearch(row, ""), true)
  assert.equal(matchesDuesSearch(row, "Prince"), true)
  assert.equal(matchesDuesSearch(row, "  prince gond  "), true)
  assert.equal(matchesDuesSearch(row, "MEM-0028"), true)
  assert.equal(matchesDuesSearch(row, "mem-0028"), true)
  assert.equal(matchesDuesSearch(row, "0028"), true)
  assert.equal(matchesDuesSearch(row, "arjun"), false)
})

test("dues search never exposes the raw phone (name/code only)", () => {
  const row = { memberName: "Prince Gond", memberCode: "MEM-0028" }
  assert.equal(matchesDuesSearch(row, "90000 10020"), false)
})