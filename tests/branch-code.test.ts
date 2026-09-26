import { test } from "node:test"
import assert from "node:assert/strict"

import {
  branchSelectionLabel,
  isBranchCodeCollision,
  isValidBranchCode,
  nextBranchCode,
  parseBranchCode,
  toBranchCode,
} from "../src/lib/branch-code"

// ---------------------------------------------------------------------------
// Branch Code: org-scoped, human-facing identifier.
//
//   - Format "BR-" + zero-padded 4-digit minimum (BR-0001 … BR-9999,
//     BR-10000 …) — NO 9999 cap.
//   - Deterministic, server-side, lowest-free sequence (no randomness, no
//     timestamps, no client counters, no name/UUID derivation).
//   - Uniqueness is org-scoped; the DB constraint is the source of truth and
//     callers retry on P2002. Codes are never recycled after deactivation.
// ---------------------------------------------------------------------------

test("toBranchCode formats with a 4-digit minimum and no upper bound", () => {
  assert.equal(toBranchCode(1), "BR-0001")
  assert.equal(toBranchCode(42), "BR-0042")
  assert.equal(toBranchCode(9999), "BR-9999")
  assert.equal(toBranchCode(10000), "BR-10000")
  assert.equal(toBranchCode(100001), "BR-100001")
})

test("toBranchCode rejects invalid sequences", () => {
  assert.throws(() => toBranchCode(0))
  assert.throws(() => toBranchCode(-1))
  assert.throws(() => toBranchCode(1.5))
  assert.throws(() => toBranchCode(NaN))
})

test("parseBranchCode round-trips and rejects malformed strings", () => {
  assert.equal(parseBranchCode("BR-0001"), 1)
  assert.equal(parseBranchCode("BR-0042"), 42)
  assert.equal(parseBranchCode("BR-9999"), 9999)
  assert.equal(parseBranchCode("BR-10000"), 10000)
  assert.equal(parseBranchCode("  br-0042 "), 42)
  assert.equal(parseBranchCode(null), null)
  assert.equal(parseBranchCode(undefined), null)
  assert.equal(parseBranchCode(""), null)
  assert.equal(parseBranchCode("BR-0000"), null)
  assert.equal(parseBranchCode("BR-"), null)
  assert.equal(parseBranchCode("BR-x42"), null)
  assert.equal(parseBranchCode("X-0042"), null)
  assert.equal(parseBranchCode("0042"), null)
})

test("isValidBranchCode gates well-formed codes only", () => {
  assert.equal(isValidBranchCode("BR-0001"), true)
  assert.equal(isValidBranchCode("br-10000"), true)
  assert.equal(isValidBranchCode("BR-0042 "), true)
  assert.equal(isValidBranchCode("BR-0000"), false)
  assert.equal(isValidBranchCode("BR-21"), true)
  assert.equal(isValidBranchCode("BR-abc"), false)
  assert.equal(isValidBranchCode(""), false)
  assert.equal(isValidBranchCode(null), false)
})

test("nextBranchCode picks the lowest free integer deterministically", () => {
  assert.equal(nextBranchCode([]), "BR-0001")
  assert.equal(nextBranchCode(["BR-0001"]), "BR-0002")
  assert.equal(nextBranchCode(["BR-0001", "BR-0002", "BR-0004"]), "BR-0003")
  assert.equal(nextBranchCode(["BR-0007"]), "BR-0001")
  // Unparseable / foreign codes are ignored safely.
  assert.equal(nextBranchCode(["garbage", "BR-0003", "X-0012"]), "BR-0001")
})

test("nextBranchCode fills the sequence and crosses into 5 digits", () => {
  const codes = Array.from({ length: 9999 }, (_, i) => toBranchCode(i + 1))
  assert.equal(codes[0], "BR-0001")
  assert.equal(codes[9998], "BR-9999")
  assert.equal(nextBranchCode(codes), "BR-10000")
  assert.equal(nextBranchCode([...codes, "BR-10000"]), "BR-10001")
})

test("isBranchCodeCollision recognizes a branchCode P2002 only", () => {
  assert.equal(
    isBranchCodeCollision({
      code: "P2002",
      meta: { target: ["Branch_organizationId_branchCode_key"] },
    }),
    true
  )
  assert.equal(
    isBranchCodeCollision({ code: "P2002", meta: { target: ["organizationId", "branchCode"] } }),
    true
  )
  assert.equal(isBranchCodeCollision({ code: "P2002", meta: { target: ["branchCode"] } }), true)
  // Same code, different column: NOT a branchCode collision.
  assert.equal(
    isBranchCodeCollision({ code: "P2002", meta: { target: ["Branch_organizationId_name_key"] } }),
    false
  )
  // String-shaped targets are ignored (guards against Prisma revving the shape).
  assert.equal(isBranchCodeCollision({ code: "P2002", meta: { target: "branchCode" } }), false)
  assert.equal(isBranchCodeCollision({ code: "P2000" }), false)
  assert.equal(isBranchCodeCollision(new Error("boom")), false)
  assert.equal(isBranchCodeCollision(null), false)
  assert.equal(isBranchCodeCollision(undefined), false)
  assert.equal(isBranchCodeCollision("P2002"), false)
})

test("branchSelectionLabel renders 'Name / BR-0001' only when a code exists", () => {
  assert.equal(
    branchSelectionLabel({ name: "King's Gym — Main", branchCode: "BR-0001" }),
    "King's Gym — Main / BR-0001"
  )
  assert.equal(branchSelectionLabel({ name: "King's Gym — Main", branchCode: null }), "King's Gym — Main")
  // A branch without a code predates the backfill; render the name alone.
  assert.equal(branchSelectionLabel({ name: "Annex" }), "Annex")
})