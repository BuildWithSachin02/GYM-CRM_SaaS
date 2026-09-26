import { test } from "node:test"
import assert from "node:assert/strict"

import {
  branchFilterWhere,
  branchFilterWhereRequired,
  exactBranchFilter,
  filterBranchIds,
  includesOrgWideRecords,
  isRecordVisible,
  type BranchFilter,
  type BranchWhereFragment,
} from "../src/lib/branch-scope"

// ---------------------------------------------------------------------------
// Branch filter semantics.
//
//   all    �?" open filter; caller must STILL org-scope every query.
//   single �?" one explicit branch + org-wide records (branchId = null).
//   multi  �?" a set of branches + org-wide records.
//   exact  �?" ONE branch and NOTHING else: no org-wide arm, no sibling branch.
//            Used for branch-card metrics, where "this branch's revenue" must
//            not silently absorb org-wide or other-branch records.
//   none   �?" fail-closed: matches nothing (a defensive backstop; callers hard
//            stop with ForbiddenError before querying).
// ---------------------------------------------------------------------------

const all: BranchFilter = { kind: "all" }
const none: BranchFilter = { kind: "none" }
const single: BranchFilter = { kind: "single", branchId: "b1" }
const multi: BranchFilter = { kind: "multi", branchIds: ["b1", "b2"] }
const exact: BranchFilter = exactBranchFilter("b1")

test("filterBranchIds exposes concrete ids only", () => {
  assert.deepEqual(filterBranchIds(all), [])
  assert.deepEqual(filterBranchIds(none), [])
  assert.deepEqual(filterBranchIds(single), ["b1"])
  assert.deepEqual(filterBranchIds(multi), ["b1", "b2"])
})

test("org-wide inclusion is bounded by the filter kind", () => {
  assert.equal(includesOrgWideRecords(all), true)
  assert.equal(includesOrgWideRecords(single), true)
  assert.equal(includesOrgWideRecords(multi), true)
  // `exact` is the one kind that deliberately excludes the org-wide arm.
  assert.equal(includesOrgWideRecords(exact), false)
  // Fail-closed: a zero-assignment user sees no org-wide records either.
  assert.equal(includesOrgWideRecords(none), false)
})

test("exact filter exposes its single id", () => {
  assert.deepEqual(filterBranchIds(exact), ["b1"])
  // A blank id is a programming error, not a "match everything" request.
  assert.throws(() => exactBranchFilter(""), /branch id/i)})

test("exact filter never matches org-wide or sibling records", () => {
  assert.equal(isRecordVisible(exact, "b1"), true)
  assert.equal(isRecordVisible(exact, "b2"), false)
  // The whole point: no org-wide arm.
  assert.equal(isRecordVisible(exact, null), false)
  assert.equal(isRecordVisible(exact, undefined), false)
})

test("isRecordVisible: branch records respect the filter", () => {
  // all → everything
  assert.equal(isRecordVisible(all, "b1"), true)
  assert.equal(isRecordVisible(all, "b100"), true)
  assert.equal(isRecordVisible(all, null), true)
  // single → the branch + org-wide
  assert.equal(isRecordVisible(single, "b1"), true)
  assert.equal(isRecordVisible(single, null), true)
  assert.equal(isRecordVisible(single, "b2"), false)
  // `undefined` is never treated as org-wide (fail-closed on unknown).
  assert.equal(isRecordVisible(single, undefined), false)
  // multi → any listed branch + org-wide
  assert.equal(isRecordVisible(multi, "b1"), true)
  assert.equal(isRecordVisible(multi, "b2"), true)
  assert.equal(isRecordVisible(multi, null), true)
  assert.equal(isRecordVisible(multi, "b9"), false)
  // none → nothing, not even org-wide
  assert.equal(isRecordVisible(none, "b1"), false)
  assert.equal(isRecordVisible(none, null), false)
})

test("branchFilterWhere builds the canonical where fragment", () => {
  // all → no clause at all
  assert.deepEqual(branchFilterWhere(all), {})
  // single → OR(branch, org-wide)
  assert.deepEqual(branchFilterWhere(single), {
    OR: [{ branchId: "b1" }, { branchId: null }],
  })
  // multi → OR(in, org-wide)
  assert.deepEqual(branchFilterWhere(multi), {
    OR: [{ branchId: { in: ["b1", "b2"] } }, { branchId: null }],
  })
  // none → never match (in: [] WITHOUT the org-wide arm)
  assert.deepEqual(branchFilterWhere(none), { OR: [{ branchId: { in: [] } }] })
  // exact: a single equality, with NO org-wide arm and no OR wrapper.
  assert.deepEqual(branchFilterWhere(exact), { branchId: "b1" })
})

test("branchFilterWhere honours a custom field name", () => {
  assert.deepEqual(branchFilterWhere(single, "locationField"), {
    OR: [{ locationField: "b1" }, { locationField: null }],
  })
})

test("multi with an empty set degenerates to never-match (fail-closed)", () => {
  const emptyMulti: BranchFilter = { kind: "multi", branchIds: [] }
  assert.deepEqual(branchFilterWhere(emptyMulti), { OR: [{ branchId: { in: [] } }] })
  assert.equal(isRecordVisible(emptyMulti, null), false)
  assert.equal(isRecordVisible(emptyMulti, "b1"), false)
})

test("the where fragment never leaks a tenant clause (callers add org scope)", () => {
  const where = branchFilterWhere(single) as { OR?: unknown[] }
  assert.ok(where.OR)
  const hasOrganization = JSON.stringify(where).includes("organization")
  assert.equal(hasOrganization, false)
})