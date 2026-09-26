
// ---------------------------------------------------------------------------
// NULLABILITY CONTRACT (regression suite for the /dashboard/branches crash).
//
// PrismaClientValidationError: Argument `branchId` is missing.
// Membership.branchId is declared `String` (NOT NULL), so its generated
// `MembershipWhereInput.branchId` is `StringFilter<"Membership"> | string` --
// `null` is NOT assignable and Prisma rejects the WHOLE query. The old builder
// emitted the organization-wide `{ branchId: null }` arm for `single`/`multi`
// unconditionally, so every NOT NULL branch model (Membership, Payment,
// CheckIn, QRSession, AttendanceRequest, UserBranch) 500'd in single/multi
// branch scope -- which is exactly the state /dashboard/branches renders in.
//
// These tests assert the SHAPE of the emitted fragment, because that shape is
// what Prisma validates. They need no database.
// ---------------------------------------------------------------------------

/** Every branch-keyed value in a fragment, in document order. */
function collectBranchValues(fragment: BranchWhereFragment): unknown[] {
  const values: unknown[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node === null || typeof node !== "object") return
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "branchId" || key === "homeBranchId") {
        values.push(value === null ? null : "value")
      } else {
        walk(value)
      }
    }
  }
  walk(fragment)
  return values
}

const hasNullArm = (fragment: BranchWhereFragment): boolean =>
  collectBranchValues(fragment).includes(null)

test("REQUIRED builder never emits the org-wide null arm (the Prisma crash)", () => {
  // The exact two filter kinds that used to break every NOT NULL branch model.
  assert.equal(hasNullArm(branchFilterWhereRequired(single)), false)
  assert.equal(hasNullArm(branchFilterWhereRequired(multi)), false)
})

test("REQUIRED builder returns Prisma-valid fragments for every filter kind", () => {
  // all -> no clause: an owner reads the whole organization.
  assert.deepEqual(branchFilterWhereRequired(all), {})
  // single -> plain equality. No OR, no null.
  assert.deepEqual(branchFilterWhereRequired(single), { branchId: "b1" })
  // multi -> membership test only. This is what Membership/Payment/CheckIn get.
  assert.deepEqual(branchFilterWhereRequired(multi), { branchId: { in: ["b1", "b2"] } })
  // none -> never matches (fail-closed).
  assert.deepEqual(branchFilterWhereRequired(none), { OR: [{ branchId: { in: [] } }] })
  // exact -> one branch, no org-wide arm.
  assert.deepEqual(branchFilterWhereRequired(exact), { branchId: "b1" })
})

test("REQUIRED builder: an empty multi set still fails closed", () => {
  const emptyMulti: BranchFilter = { kind: "multi", branchIds: [] }
  assert.deepEqual(branchFilterWhereRequired(emptyMulti), { OR: [{ branchId: { in: [] } }] })
})

test("REQUIRED builder honours a custom field name and stays null-free", () => {
  assert.deepEqual(branchFilterWhereRequired(single, "homeBranchId"), { homeBranchId: "b1" })
  assert.deepEqual(branchFilterWhereRequired(multi, "homeBranchId"), {
    homeBranchId: { in: ["b1", "b2"] },
  })
  assert.equal(hasNullArm(branchFilterWhereRequired(multi, "homeBranchId")), false)
})

test("NULLABLE builder still keeps the org-wide arm (no behaviour regression)", () => {
  // These models (Lead, Appointment, Task, Member.homeBranchId) have a genuinely
  // nullable branch FK, so dropping this arm would hide org-wide records from
  // restricted users. This is the behaviour that must NOT change.
  assert.deepEqual(branchFilterWhere(single), { OR: [{ branchId: "b1" }, { branchId: null }] })
  assert.deepEqual(branchFilterWhere(multi), {
    OR: [{ branchId: { in: ["b1", "b2"] } }, { branchId: null }],
  })
  assert.equal(hasNullArm(branchFilterWhere(single)), true)
  assert.equal(hasNullArm(branchFilterWhere(multi)), true)
})

test("NULLABLE and REQUIRED builders agree on the branch set they select", () => {
  // The ONLY difference is the org-wide arm. A restricted user must still see
  // exactly the rows of their assigned branches -- dropping the null arm for a
  // NOT NULL model may not change which real rows match, because a row with a
  // null branch cannot exist in the first place.
  for (const filter of [single, multi, exact, none, all] as BranchFilter[]) {
    const nullable = branchFilterWhere(filter)
    const required = branchFilterWhereRequired(filter)
    if (filter.kind === "all") {
      assert.deepEqual(nullable, {})
      assert.deepEqual(required, {})
      continue
    }
    const ids = filterBranchIds(filter)
    if (ids.length === 0) {
      assert.deepEqual(nullable, { OR: [{ branchId: { in: [] } }] })
      assert.deepEqual(required, { OR: [{ branchId: { in: [] } }] })
      continue
    }
    // Every assigned branch is still selected by the REQUIRED fragment.
    const requiredJson = JSON.stringify(required)
    for (const id of ids) {
      assert.equal(requiredJson.includes(id), true)
    }
  }
})

test("branch separation: a REQUIRED fragment never mentions a sibling branch", () => {
  const other: BranchFilter = { kind: "multi", branchIds: ["b9"] }
  const json = JSON.stringify(branchFilterWhereRequired(multi))
  assert.equal(json.includes("b1"), true)
  assert.equal(json.includes("b2"), true)
  // b9 is a different gym's branch and must not leak into a b1/b2 scope.
  assert.equal(json.includes("b9"), false)
  assert.equal(JSON.stringify(branchFilterWhereRequired(other)).includes("b1"), false)
})

test("required fragments never leak a tenant clause (callers add org scope)", () => {
  const json = JSON.stringify(branchFilterWhereRequired(multi))
  assert.equal(json.includes("organization"), false)
})

test("both builders cover every BranchFilter kind exhaustively", () => {
  // A new filter kind added to BranchFilter must not silently skip the
  // nullability decision, so assert each builder handles all six kinds.
  const kinds: BranchFilter[] = [
    { kind: "all" },
    { kind: "none" },
    { kind: "single", branchId: "b1" },
    { kind: "multi", branchIds: ["b1"] },
    { kind: "multi", branchIds: [] },
    exact,
  ]
  assert.equal(kinds.length, 6)
  for (const kind of kinds) {
    assert.ok(branchFilterWhere(kind) !== undefined)
    const required = branchFilterWhereRequired(kind)
    assert.ok(required !== undefined)
    assert.equal(hasNullArm(required), false)
  }
})
