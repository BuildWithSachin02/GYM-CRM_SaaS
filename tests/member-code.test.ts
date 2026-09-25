import { test } from "node:test"
import assert from "node:assert/strict"

import {
  classifyDuplicates,
  isMemberCodeCollision,
  isValidMemberCode,
  memberSelectionLabel,
  memberSelectionSublabel,
  nextMemberCode,
  normalizeMemberName,
  normalizePhoneKey,
  parseMemberCode,
  toMemberCode,
  type DuplicateCandidate,
} from "../src/lib/member-code"

// ---------------------------------------------------------------------------
// Member Code: org-scoped, human-facing identifier.
//
//   - Format "MEM-" + zero-padded 4-digit minimum (MEM-0001 … MEM-9999,
//     MEM-10000 …) — NO 9999 cap.
//   - Deterministic, server-side, lowest-free sequence (no randomness, no
//     timestamps, no client counters, no name/UUID derivation).
//   - Uniqueness is org-scoped; the DB constraint is the source of truth and
//     callers retry on P2002. Codes are never recycled.
//   - Duplicate warnings are informational only: STRONG = same normalized
//     name + same phone; WEAK = same normalized name only. Different names
//     sharing a phone is ALLOWED, and a strong match is never double-listed.
// ---------------------------------------------------------------------------

test("toMemberCode formats with a 4-digit minimum and no upper bound", () => {
  assert.equal(toMemberCode(1), "MEM-0001")
  assert.equal(toMemberCode(42), "MEM-0042")
  assert.equal(toMemberCode(9999), "MEM-9999")
  assert.equal(toMemberCode(10000), "MEM-10000")
  assert.equal(toMemberCode(100001), "MEM-100001")
})

test("toMemberCode rejects invalid sequences", () => {
  assert.throws(() => toMemberCode(0))
  assert.throws(() => toMemberCode(-1))
  assert.throws(() => toMemberCode(1.5))
  assert.throws(() => toMemberCode(NaN))
})

test("parseMemberCode round-trips and rejects malformed strings", () => {
  assert.equal(parseMemberCode("MEM-0001"), 1)
  assert.equal(parseMemberCode("MEM-0042"), 42)
  assert.equal(parseMemberCode("MEM-9999"), 9999)
  assert.equal(parseMemberCode("MEM-10000"), 10000)
  assert.equal(parseMemberCode("  mem-0042 "), 42)
  assert.equal(parseMemberCode(null), null)
  assert.equal(parseMemberCode(undefined), null)
  assert.equal(parseMemberCode(""), null)
  assert.equal(parseMemberCode("MEM-0000"), null)
  assert.equal(parseMemberCode("MEM-"), null)
  assert.equal(parseMemberCode("MEM-x42"), null)
  assert.equal(parseMemberCode("X-0042"), null)
  assert.equal(parseMemberCode("0042"), null)
})

test("isValidMemberCode gates well-formed codes only", () => {
  assert.equal(isValidMemberCode("MEM-0001"), true)
  assert.equal(isValidMemberCode("mem-10000"), true)
  assert.equal(isValidMemberCode("MEM-0042 "), true)
  assert.equal(isValidMemberCode("MEM-0000"), false)
  assert.equal(isValidMemberCode("MEM-21"), true)
  assert.equal(isValidMemberCode("MEM-abc"), false)
  assert.equal(isValidMemberCode(""), false)
  assert.equal(isValidMemberCode(null), false)
})

test("nextMemberCode picks the lowest free integer deterministically", () => {
  assert.equal(nextMemberCode([]), "MEM-0001")
  assert.equal(nextMemberCode(["MEM-0001"]), "MEM-0002")
  assert.equal(nextMemberCode(["MEM-0001", "MEM-0002", "MEM-0004"]), "MEM-0003")
  assert.equal(nextMemberCode(["MEM-0007"]), "MEM-0001")
  // Unparseable / foreign codes are ignored safely.
  assert.equal(nextMemberCode(["garbage", "MEM-0003", "X-0012"]), "MEM-0001")
})

test("nextMemberCode fills the sequence and crosses into 5 digits", () => {
  const codes = Array.from({ length: 9999 }, (_, i) => toMemberCode(i + 1))
  assert.equal(codes[0], "MEM-0001")
  assert.equal(codes[9998], "MEM-9999")
  assert.equal(nextMemberCode(codes), "MEM-10000")
  assert.equal(nextMemberCode([...codes, "MEM-10000"]), "MEM-10001")
})

test("isMemberCodeCollision recognizes a memberCode P2002 only", () => {
  // Prisma reports the target as the constraint name and/or the field names.
  assert.equal(
    isMemberCodeCollision({
      code: "P2002",
      meta: { target: ["Member_organizationId_memberCode_key"] },
    }),
    true
  )
  assert.equal(
    isMemberCodeCollision({ code: "P2002", meta: { target: ["organizationId", "memberCode"] } }),
    true
  )
  assert.equal(
    isMemberCodeCollision({ code: "P2002", meta: { target: ["memberCode"] } }),
    true
  )
  // Same code, different column: NOT a memberCode collision.
  assert.equal(
    isMemberCodeCollision({ code: "P2002", meta: { target: ["Member_email_key"] } }),
    false
  )
  // String-shaped targets are ignored (guards against Prisma revving the shape).
  assert.equal(isMemberCodeCollision({ code: "P2002", meta: { target: "memberCode" } }), false)
  // Non-P2002 and non-request errors are never retried.
  assert.equal(isMemberCodeCollision({ code: "P2000" }), false)
  assert.equal(isMemberCodeCollision(new Error("boom")), false)
  assert.equal(isMemberCodeCollision(null), false)
  assert.equal(isMemberCodeCollision(undefined), false)
  assert.equal(isMemberCodeCollision("P2002"), false)
})

test("normalization collapses whitespace and lowercases (warnings only)", () => {
  assert.equal(normalizeMemberName("Rahul Patel"), "rahul patel")
  assert.equal(normalizeMemberName("  Rahul   PATEL "), "rahul patel")
  assert.equal(normalizePhoneKey("90000 00001"), "9000000001")
  assert.equal(normalizePhoneKey("+91 90000-00001"), "919000000001")
})

// ---------------------------------------------------------------------------
// Duplicate classification
// ---------------------------------------------------------------------------

const base: DuplicateCandidate = {
  id: "c1",
  firstName: "Rahul",
  lastName: "Patel",
  phone: "9000000001",
  memberCode: "MEM-0002",
}

test("same normalized name + same phone is a single STRONG warning", () => {
  const out = classifyDuplicates(
    { firstName: "rahul", lastName: "  patel ", phone: "90000 00001" },
    [base]
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].memberId, "c1")
  assert.equal(out[0].memberCode, "MEM-0002")
  assert.equal(out[0].strength, "strong")
})

test("same normalized name with a different phone is a WEAK warning", () => {
  const out = classifyDuplicates({ firstName: "Rahul", lastName: "Patel", phone: "9000000002" }, [base])
  assert.equal(out.length, 1)
  assert.equal(out[0].strength, "weak")
  assert.equal(out[0].name, "Rahul Patel")
})

test("different names sharing a phone is ALLOWED (no warning)", () => {
  const siblings = [
    { ...base, firstName: "Priya", lastName: "Patel" },
    { ...base, id: "c2", firstName: "Rahul", lastName: "Patel", phone: "9000000002" },
  ]
  const out = classifyDuplicates({ firstName: "Aarav", lastName: "Sharma", phone: "9000000001" }, siblings)
  assert.equal(out.length, 0)
})

test("a strong match is never double-listed as weak", () => {
  const out = classifyDuplicates({ firstName: "Rahul", lastName: "Patel", phone: "9000000001" }, [base])
  const strongs = out.filter((w) => w.strength === "strong")
  assert.equal(strongs.length, 1)
})

test("only same-name candidates are considered", () => {
  const candidates: DuplicateCandidate[] = [
    base,
    { ...base, id: "other", firstName: "Simran", lastName: "Kaur", memberCode: "MEM-0009" },
  ]
  const out = classifyDuplicates({ firstName: "Rahul", lastName: "Patel", phone: "9000000003" }, candidates)
  assert.deepEqual(out.map((w) => w.memberId), ["c1"])
})

test("empty phones never produce a STRONG warning", () => {
  const out = classifyDuplicates(
    { firstName: "Rahul", lastName: "Patel", phone: "" },
    [{ ...base, phone: "" }]
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].strength, "weak")
})

test("memberCode of a duplicate candidate may be absent (pre-backfill), safely", () => {
  const out = classifyDuplicates(
    { firstName: "Rahul", lastName: "Patel", phone: "9000000001" },
    [{ ...base, memberCode: null }]
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].memberCode, null)
  assert.equal(out[0].strength, "strong")
})

test("org isolation is enforced by the caller, not by classification", () => {
  // classifyDuplicates is PURE: the caller must pass only same-org candidates
  // (the actions filter by organizationId). A same-name member from another
  // org would only match if the caller failed to scope the query.
  const out = classifyDuplicates({ firstName: "Rahul", lastName: "Patel", phone: "1111111111" }, [base])
  assert.ok(out.some((w) => w.memberId === "c1"))
})

// ---------------------------------------------------------------------------
// Shared selection-label helpers ("Name / MEM-0042" + masked-phone sublabel)
// ---------------------------------------------------------------------------

test("memberSelectionLabel renders 'Name / MEM-0042' only when a code exists", () => {
  assert.equal(
    memberSelectionLabel({ firstName: "Aarav", lastName: "Sharma", memberCode: "MEM-0042" }),
    "Aarav Sharma / MEM-0042"
  )
  assert.equal(
    memberSelectionLabel({ firstName: "Aarav", lastName: "Sharma", memberCode: null }),
    "Aarav Sharma"
  )
  assert.equal(
    memberSelectionLabel({ firstName: "Aarav", lastName: "Sharma", phone: "+91 90000 00000" }),
    "Aarav Sharma"
  )
})

test("memberSelectionSublabel masks the phone and never leaks the raw number", () => {
  assert.equal(
    memberSelectionSublabel({ firstName: "Aarav", lastName: "Sharma", phone: "+91 90000 00000", memberCode: "MEM-0042" }),
    "******0000"
  )
  assert.equal(memberSelectionSublabel({ firstName: "Aarav", lastName: "Sharma", phone: "" }), undefined)
  assert.equal(memberSelectionSublabel({ firstName: "Aarav", lastName: "Sharma", phone: null }), undefined)
  const raw = memberSelectionSublabel({ firstName: "Aarav", lastName: "Sharma", phone: "+91 90000 00000" })
  assert.ok(raw && !raw.includes("90000 00000"))
})