import { test } from "node:test"
import assert from "node:assert/strict"

import { checkMembershipPaymentLink } from "../src/lib/payments"
import { paymentSchema } from "../src/lib/validators"
import { formatMoney } from "../src/lib/format"

// ---------------------------------------------------------------------------
// Business rule: an owner payment must settle a specific membership.
// A member-only (standalone) payment is rejected. The membership supplied to
// the rule is always looked up server-side and must belong to the same member
// and organization.
// ---------------------------------------------------------------------------

const ORG = "801c5e7a-49f4-4a12-bf35-de4a2cba695c"
const OTHER_ORG = "00000000-0000-0000-0000-000000000000"

const ANANYA = "b7985e58-8309-445d-b301-b5c606a462d3"
const HIMANSHU = "11111111-1111-1111-1111-111111111111"

const membership = (over: Partial<{ id: string; memberId: string; organizationId: string; status: string }> = {}) => ({
  id: "cf97626f-e0e1-4537-952a-3e33f0963f23",
  memberId: ANANYA,
  organizationId: ORG,
  status: "ACTIVE",
  ...over,
})

test("TEST A: valid membership-linked payment is accepted", () => {
  const res = checkMembershipPaymentLink(
    { memberId: ANANYA, membershipId: membership().id },
    membership(),
    ORG
  )
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.membershipId, membership().id)
})

test("TEST B: member-only payment (membershipId null) is rejected", () => {
  const db = checkMembershipPaymentLink({ memberId: ANANYA, membershipId: null }, null, ORG)
  assert.equal(db.ok, false)
  if (!db.ok) assert.match(db.error, /membership/i)

  // The input schema also refuses it before the action ever runs.
  const parsed = paymentSchema.safeParse({
    memberId: ANANYA,
    membershipId: null,
    amountMinor: 502000,
    method: "CASH",
    paymentDate: "2026-09-18",
  })
  assert.equal(parsed.success, false)
})

test("TEST C: membership belonging to another member is rejected", () => {
  const res = checkMembershipPaymentLink(
    { memberId: ANANYA, membershipId: membership().id },
    membership({ memberId: HIMANSHU }),
    ORG
  )
  assert.equal(res.ok, false)
  if (!res.ok) assert.match(res.error, /does not belong to this member/i)
})

test("TEST D: membership belonging to another organization is rejected", () => {
  const res = checkMembershipPaymentLink(
    { memberId: ANANYA, membershipId: membership().id },
    membership({ organizationId: OTHER_ORG }),
    ORG
  )
  assert.equal(res.ok, false)
  if (!res.ok) assert.match(res.error, /does not belong to your gym/i)
})

test("TEST E: nonexistent or cancelled membership is rejected", () => {
  const missing = checkMembershipPaymentLink(
    { memberId: ANANYA, membershipId: "99999999-9999-9999-9999-999999999999" },
    null,
    ORG
  )
  assert.equal(missing.ok, false)

  const cancelled = checkMembershipPaymentLink(
    { memberId: ANANYA, membershipId: membership().id },
    membership({ status: "CANCELLED" }),
    ORG
  )
  assert.equal(cancelled.ok, false)
  if (!cancelled.ok) assert.match(cancelled.error, /cancelled/i)
})

test("TEST F: valid renewal payment (linked to a renewed membership) is accepted", () => {
  const renewed = membership({ id: "e1bee11e-c576-45c5-af76-bf0dcdff1aed" })
  const res = checkMembershipPaymentLink(
    { memberId: ANANYA, membershipId: renewed.id },
    renewed,
    ORG
  )
  assert.equal(res.ok, true)
})

test("TEST G: additional membership payment for an already-active member is accepted", () => {
  // A member may hold several memberships; a payment for any of them is valid.
  const second = membership({ id: "3538d658-2396-4ae0-9104-4a0a2f8df3e5" })
  const res = checkMembershipPaymentLink(
    { memberId: ANANYA, membershipId: second.id },
    second,
    ORG
  )
  assert.equal(res.ok, true)
})

test("TEST H: a charged amount different from the plan list price is preserved", () => {
  const parsed = paymentSchema.safeParse({
    memberId: ANANYA,
    membershipId: membership().id,
    amountMinor: 139900,
    method: "CASH",
    paymentDate: "2026-09-16",
  })
  assert.equal(parsed.success, true)
  if (parsed.success) {
    assert.equal(parsed.data.amountMinor, 139900)
    assert.equal(formatMoney(parsed.data.amountMinor), "₹1,399")
  }
  // The plan's list price is a different figure and must not be shown as the
  // collected amount.
  assert.equal(formatMoney(129900), "₹1,299")
  assert.notEqual(formatMoney(139900), formatMoney(129900))
})

test("TEST I: Ananya regression — each payment maps to its membership, no standalone", () => {
  const monthly = membership({
    id: "cf97626f-e0e1-4537-952a-3e33f0963f23",
    status: "ACTIVE",
  })
  const quarterly = membership({
    id: "e1bee11e-c576-45c5-af76-bf0dcdff1aed",
    status: "ACTIVE",
  })

  // ₹1,399 → Monthly membership
  const monthlyLink = checkMembershipPaymentLink(
    { memberId: ANANYA, membershipId: monthly.id },
    monthly,
    ORG
  )
  assert.equal(monthlyLink.ok, true)
  assert.equal(formatMoney(139900), "₹1,399")

  // ₹3,499 → Quarterly membership
  const quarterlyLink = checkMembershipPaymentLink(
    { memberId: ANANYA, membershipId: quarterly.id },
    quarterly,
    ORG
  )
  assert.equal(quarterlyLink.ok, true)
  assert.equal(formatMoney(349900), "₹3,499")

  // The unexplained ₹5,020 standalone payment is not a valid link.
  const standalone = checkMembershipPaymentLink(
    { memberId: ANANYA, membershipId: null },
    null,
    ORG
  )
  assert.equal(standalone.ok, false)
})
