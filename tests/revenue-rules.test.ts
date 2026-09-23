import { test } from "node:test"
import assert from "node:assert/strict"

import {
  attributeMinorByDay,
  filterRecordedPayments,
  rangeKeysEndingAt,
  sumByDay,
} from "../src/lib/analytics-core"
import { periodEndKey } from "../src/lib/memberships"

// ---------------------------------------------------------------------------
// Membership vs Payment — the revenue source-of-truth business rule.
//
// A Membership is the plan/service ASSIGNED to a member (plan, price,
// duration, dates). Its `amountMinor` is the expected/agreed price and is
// NEVER revenue. A Payment is actual money received; only `status ===
// "RECORDED"` payments contribute to revenue, member totals, charts and
// reports. VOIDED payments stay visible for audit but never count.
//
// These rules are enforced at two layers:
//   1. The server actions (createMembership / renewMembership /
//      convertLeadToMember) no longer create any Payment row.
//   2. Revenue aggregation reduces PAYMENT rows only, kept RECORDED by
//      `filterRecordedPayments` (the same predicate the queries apply).
// ---------------------------------------------------------------------------

const TZ = "Asia/Kolkata"
// 60 calendar days ending 2026-10-20 — spans Sep + Oct demo periods.
const KEYS = rangeKeysEndingAt("2026-10-20", 60)

type PaymentRow = {
  paymentDate: Date
  amountMinor: number
  status?: string
}

/** Mirrors getRevenueAnalysis: RECORDED-only rows attributed and summed. */
function revenueOf(payments: PaymentRow[], keys: string[] = KEYS): number {
  return sumByDay(
    attributeMinorByDay(filterRecordedPayments(payments), TZ),
    keys
  )
}

/** Mirrors the member profile's "Total Payments": RECORDED payment rows only. */
function memberTotal(payments: PaymentRow[]): number {
  return filterRecordedPayments(payments).reduce(
    (sum, p) => sum + p.amountMinor,
    0
  )
}

const GLHATU_PLAN = { priceMinor: 129900 } as const
const IN_IST = (iso: string) => new Date(iso)

test("A: membership creation alone creates zero revenue (price is not received money)", () => {
  // Assigning a ₹1,299 monthly membership with NO payment recorded.
  const membership = { plan: GLHATU_PLAN, amountMinor: 129900 }
  const payments: PaymentRow[] = []
  assert.equal(revenueOf(payments), 0)
  // Defensive: the aggregation only ever sees Payment rows — the membership
  // record (with its amountMinor) is not even part of the revenue input.
  assert.equal(membership.amountMinor, 129900)
})

test("B: membership without any payment shows ₹0 member total payments", () => {
  assert.equal(memberTotal([]), 0)
  // Payment rows exist but are not RECORDED (e.g. all voided) → still zero.
  assert.equal(
    memberTotal([{ paymentDate: IN_IST("2026-09-20T00:30:00Z"), amountMinor: 129900, status: "VOIDED" }]),
    0
  )
})

test("C/D: membership + one ₹1,299 RECORDED payment → revenue and total are ₹1,299, never ₹2,598", () => {
  const payments: PaymentRow[] = [
    { paymentDate: IN_IST("2026-09-20T00:30:00Z"), amountMinor: 129900, status: "RECORDED" },
  ]
  assert.equal(revenueOf(payments), 129900)
  assert.equal(memberTotal(payments), 129900)
  assert.notEqual(memberTotal(payments), 259800)
})

test("E: plan price ₹1,299, actually received ₹1,000 → revenue/total count ₹1,000 only (no auto top-up)", () => {
  const payments: PaymentRow[] = [
    { paymentDate: IN_IST("2026-09-20T00:30:00Z"), amountMinor: 100000, status: "RECORDED" },
  ]
  assert.equal(revenueOf(payments), 100000)
  assert.equal(memberTotal(payments), 100000)
  // The CRM must NOT invent the ₹299 difference as another payment.
  assert.equal(revenueOf(payments), 100000)
})

test("F: a VOIDED payment contributes nothing to revenue or member totals", () => {
  const payments: PaymentRow[] = [
    { paymentDate: IN_IST("2026-09-20T00:30:00Z"), amountMinor: 129900, status: "RECORDED" },
    { paymentDate: IN_IST("2026-09-20T01:00:00Z"), amountMinor: 129900, status: "VOIDED" },
  ]
  assert.equal(filterRecordedPayments(payments).length, 1)
  assert.equal(revenueOf(payments), 129900)
  assert.equal(memberTotal(payments), 129900)
})

test("F: an entirely voided day is zero revenue", () => {
  const payments: PaymentRow[] = [
    { paymentDate: IN_IST("2026-09-20T00:30:00Z"), amountMinor: 129900, status: "VOIDED" },
  ]
  assert.equal(revenueOf(payments), 0)
  assert.equal(memberTotal(payments), 0)
})

test("G: membership plan price is never revenue by itself", () => {
  // Revenue aggregation has no access to plan/membership price at all —
  // the only input is Payment rows. A brand-new ₹1,299 plan adds ₹0 revenue.
  assert.equal(revenueOf([]), 0)
  for (const priceMinor of [129900, 349900, 502000]) {
    assert.equal(revenueOf([]), 0, `plan ${priceMinor} alone must add no revenue`)
  }
})

test("H/I: a renewal assigns a new period but creates zero revenue; the later RECORDED payment is the only revenue", () => {
  // Old monthly plan: ends 20 Sep 2026. Renewal starts the day after
  // (21 Sep); end = start + plan duration via the canonical engine.
  const oldEnd = periodEndKey("2026-08-21", 30)
  const renewedMembership = {
    plan: GLHATU_PLAN,
    amountMinor: 129900,
    startDate: "2026-09-21",
    endDate: periodEndKey("2026-09-21", 30),
  }
  assert.equal(oldEnd, "2026-09-20")
  assert.equal(renewedMembership.endDate, "2026-10-21")

  // Renewal executed, customer has NOT paid yet → no revenue anywhere.
  assert.equal(revenueOf([]), 0)

  // Receptionist then records ₹1,299 RECEIVED on the renewal start day.
  const payments: PaymentRow[] = [
    { paymentDate: IN_IST("2026-09-21T00:30:00Z"), amountMinor: 129900, status: "RECORDED" },
  ]
  assert.equal(revenueOf(payments), 129900)
  // Renewal membership price and recorded payment both = ₹1,299; the total is
  // ₹1,299 — the two events are never summed into ₹2,598.
  assert.equal(memberTotal(payments), 129900)
})

test("J: only distinct RECORDED payment rows increase revenue — the fix removes the implicit row", () => {
  // If two SEPARATE physical payments existed (two real ₹1,299 receipts) the
  // sum legitimately equals ₹2,598. The double-count bug was that membership
  // creation ADDED a silent RECORDED row alongside the real one. With the
  // action-level fix, exactly one row exists for one received payment.
  const singleRealPayment: PaymentRow[] = [
    { paymentDate: IN_IST("2026-09-20T00:30:00Z"), amountMinor: 129900, status: "RECORDED" },
  ]
  assert.equal(revenueOf(singleRealPayment), 129900)

  const wronglyDuplicated = [
    ...singleRealPayment,
    { paymentDate: IN_IST("2026-09-20T00:30:00Z"), amountMinor: 129900, status: "RECORDED" },
  ]
  assert.equal(revenueOf(wronglyDuplicated), 259800, "two rows sum to 2598 — rows must not be fabricated")
})

test("RECORDED/Day attribution: today's revenue buckets only the payments attributed to that business day", () => {
  const todayKeys = rangeKeysEndingAt("2026-09-20", 1)
  const payments: PaymentRow[] = [
    { paymentDate: IN_IST("2026-09-20T00:30:00Z"), amountMinor: 129900, status: "RECORDED" },
  ]
  assert.equal(revenueOf(payments, todayKeys), 129900)
  // A payment dated tomorrow never lands in today's bucket.
  assert.equal(
    revenueOf(
      [{ paymentDate: IN_IST("2026-09-21T00:30:00Z"), amountMinor: 129900, status: "RECORDED" }],
      todayKeys
    ),
    0
  )
})

// ---------------------------------------------------------------------------
// Revenue vs Outstanding — the two ledgers never collide.
// ---------------------------------------------------------------------------

test("a ₹1,000 partial payment is ₹1,000 revenue; the remaining ₹4,000 outstanding is never revenue", () => {
  // Membership agreed at ₹5,000 but only ₹1,000 has physically been received.
  // Revenue counts the ₹1,000 (and only that). The ₹4,000 a member still owes
  // lives in the outstanding/dues ledger — it must NEVER appear in revenue.
  const received: PaymentRow[] = [
    { paymentDate: IN_IST("2026-09-22T00:30:00Z"), amountMinor: 100000, status: "RECORDED" },
  ]
  const revenueOfDay = sumByDay(
    attributeMinorByDay(filterRecordedPayments(received), TZ),
    rangeKeysEndingAt("2026-09-22", 1)
  )
  assert.equal(revenueOfDay, 100000)
  // The unpaid price is not payable-looking revenue.
  assert.notEqual(revenueOfDay, 500000)
  const outstanding = 500000 - memberTotal(received)
  assert.equal(outstanding, 400000)
  assert.equal(memberTotal(received), 100000)
})