import { test } from "node:test"
import assert from "node:assert/strict"

import {
  buildResetPlan,
  categoryFilter,
  CATEGORY_META,
  DATA_CATEGORY_ORDER,
  dataRangeLabel,
  EXPORT_SHEET_ORDER,
  FINANCIAL_CATEGORIES,
  isFullExportRange,
  matchesResetPhrase,
  RESET_CONFIRM_PHRASE,
  RESET_ORDER,
  sanitizeFileNamePart,
} from "../src/lib/data-catalog"

const ORG = "org-king-gym"
const TZ = "Asia/Kolkata"

function allTimeRange() {
  return { mode: "all" } as const
}

function customRange(fromKey: string, toKey: string) {
  return { mode: "custom", fromKey, toKey } as const
}

// ---------------------------------------------------------------------------
// categoryFilter
// ---------------------------------------------------------------------------

test("categoryFilter: all-mode filter only scopes to the organization", () => {
  const where = categoryFilter("members", ORG, allTimeRange(), TZ)
  assert.deepEqual(where, { organizationId: ORG })
})

test("categoryFilter: instant categories use org-timezone midnight bounds", () => {
  const where = categoryFilter("members", ORG, customRange("2026-09-21", "2026-09-23"), TZ) as {
    createdAt: { gte: Date; lt: Date }
  }
  // 2026-09-21 00:00 IST == 2026-09-20 18:30 UTC
  assert.equal(where.createdAt.gte.toISOString(), "2026-09-20T18:30:00.000Z")
  // Exclusive upper bound = day after 23 (2026-09-24 00:00 IST)
  assert.equal(where.createdAt.lt.toISOString(), "2026-09-23T18:30:00.000Z")
})

test("categoryFilter: instant categories use their catalogue date field", () => {
  const byField: Record<string, unknown> = {}
  for (const key of DATA_CATEGORY_ORDER) {
    const meta = CATEGORY_META[key]
    if (meta.dateKind !== "instant") continue
    const where = categoryFilter(key, ORG, customRange("2026-09-21", "2026-09-21"), TZ) as Record<string, unknown>
    byField[key] = where[meta.dateField]
    assert.ok(where[meta.dateField], `${key} should filter on ${meta.dateField}`)
  }
  assert.equal(Object.keys(byField).length, 10)
})

test("categoryFilter: trainers is an instant export category (never a reset category)", () => {
  const where = categoryFilter("trainers", ORG, customRange("2026-09-21", "2026-09-21"), TZ) as Record<string, unknown>
  assert.ok(where.organizationId)
  assert.ok(where.createdAt)
  assert.equal(CATEGORY_META.trainers.dateKind, "instant")
  assert.equal(CATEGORY_META.trainers.modelName, "trainer")
  assert.equal(CATEGORY_META.trainers.resetSelectable, false)
  assert.ok(EXPORT_SHEET_ORDER.includes("trainers"))
  assert.ok(!RESET_ORDER.includes("trainers"))
})

test("categoryFilter: dayKey categories use inclusive string bounds", () => {
  const where = categoryFilter("attendance", ORG, customRange("2026-09-21", "2026-09-23"), TZ) as {
    dayKey: { gte: string; lte: string }
  }
  assert.deepEqual(where.dayKey, { gte: "2026-09-21", lte: "2026-09-23" })
})

test("categoryFilter: all categories carry the session organization id", () => {
  for (const key of DATA_CATEGORY_ORDER) {
    const where = categoryFilter(key, ORG, customRange("2026-09-21", "2026-09-23"), TZ) as {
      organizationId?: string
    }
    assert.equal(where.organizationId, ORG)
  }
})

// ---------------------------------------------------------------------------
// buildResetPlan
// ---------------------------------------------------------------------------

test("buildResetPlan: empty selection produces an empty plan", () => {
  assert.deepEqual(buildResetPlan([], ORG, allTimeRange(), TZ), [])
})

test("buildResetPlan: selecting members pulls in every dependent category leaf-first", () => {
  const plan = buildResetPlan(["members"], ORG, allTimeRange(), TZ)
  // leadActivities is a dependency of leads, not members — deleting leads via
  // CASCADE removes their activities automatically, so no separate op appears.
  const expected = ["attendance", "payments", "memberships", "appointments", "tasks", "leads", "members"]
  assert.deepEqual(
    plan.map((op) => op.category),
    expected
  )
  for (const op of plan) {
    assert.ok(RESET_ORDER.indexOf(op.category) >= 0)
    assert.equal((op.where as { organizationId: string }).organizationId, ORG)
  }
  const membersOp = plan.find((op) => op.category === "members")!
  assert.equal(membersOp.role, "selected")
  const attendanceOp = plan.find((op) => op.category === "attendance")!
  assert.equal(attendanceOp.role, "dependent")
  assert.deepEqual(attendanceOp.dependencyOf, ["members"])
})

test("buildResetPlan: dependent categories are scoped through their parent", () => {
  const plan = buildResetPlan(["members"], ORG, customRange("2026-09-21", "2026-09-21"), TZ)
  const attendanceOp = plan.find((op) => op.category === "attendance")!
  const where = attendanceOp.where as {
    organizationId: string
    member: { organizationId: string; createdAt: { gte: Date } }
  }
  assert.equal(where.organizationId, ORG)
  assert.equal(where.member.organizationId, ORG)
  assert.ok(where.member.createdAt.gte)
})

test("buildResetPlan: selecting a category that is also a dependency unions its own filter", () => {
  const plan = buildResetPlan(["members", "attendance"], ORG, customRange("2026-09-21", "2026-09-23"), TZ)
  const attendanceOp = plan.find((op) => op.category === "attendance")!
  assert.equal(attendanceOp.role, "selected")
  const where = attendanceOp.where as { OR?: Array<{ dayKey?: unknown; member?: unknown }> }
  assert.ok(where.OR, "attendance should be an OR of its own scope and the member dependency")
  const dayScope = where.OR?.filter((segment) => segment.dayKey !== undefined)
  const memberScope = where.OR?.filter((segment) => segment.member !== undefined)
  assert.equal(dayScope?.length, 1)
  assert.equal(memberScope?.length, 1)
})

test("buildResetPlan: plans pull in memberships as a dependent", () => {
  const plan = buildResetPlan(["plans"], ORG, allTimeRange(), TZ)
  assert.deepEqual(
    plan.map((op) => op.category),
    ["memberships", "plans"]
  )
  const membershipsOp = plan.find((op) => op.category === "memberships")!
  assert.equal(membershipsOp.role, "dependent")
  assert.deepEqual(membershipsOp.dependencyOf, ["plans"])
})

test("buildResetPlan: leads pull in lead activities only", () => {
  const plan = buildResetPlan(["leads"], ORG, allTimeRange(), TZ)
  assert.deepEqual(plan.map((op) => op.category), ["leadActivities", "leads"])
})

test("buildResetPlan: QR sessions pull in attendance, attendance resets do not pull QR sessions", () => {
  const fromQr = buildResetPlan(["qrSessions"], ORG, allTimeRange(), TZ)
  assert.deepEqual(fromQr.map((op) => op.category), ["attendance", "qrSessions"])

  const fromAttendance = buildResetPlan(["attendance"], ORG, allTimeRange(), TZ)
  assert.deepEqual(fromAttendance.map((op) => op.category), ["attendance"])
})

test("buildResetPlan: the plan is ordered per RESET_ORDER", () => {
  for (const selected of [
    ["members"] as const,
    ["plans", "members"] as const,
    ["payments", "leads", "attendance"] as const,
  ]) {
    const plan = buildResetPlan([...selected], ORG, allTimeRange(), TZ)
    const indexOrder = plan.map((op) => RESET_ORDER.indexOf(op.category))
    assert.deepEqual(indexOrder, [...indexOrder].sort((a, b) => a - b))
  }
})

test("buildResetPlan: no duplicate operations ever appear", () => {
  const plan = buildResetPlan(["members", "plans", "qrSessions", "attendance"], ORG, allTimeRange(), TZ)
  const seen = new Set(plan.map((op) => op.category))
  assert.equal(seen.size, plan.length)
})

// ---------------------------------------------------------------------------
// Confirmation phrase + filename safety
// ---------------------------------------------------------------------------

test("reset phrase: exact match passes after trimming and case-insensitively", () => {
  assert.equal(matchesResetPhrase(RESET_CONFIRM_PHRASE), true)
  assert.equal(matchesResetPhrase("  DELETE MY GYM DATA  "), true)
  assert.equal(matchesResetPhrase("delete my gym data"), true)
})

test("reset phrase: mismatches and empty inputs fail", () => {
  assert.equal(matchesResetPhrase("delete my data"), false)
  assert.equal(matchesResetPhrase("DELETE MY GYM DATA please"), false)
  assert.equal(matchesResetPhrase(""), false)
  assert.equal(matchesResetPhrase(null), false)
  assert.equal(matchesResetPhrase(undefined), false)
})

test("sanitizeFileNamePart: strips filesystem-unsafe characters", () => {
  assert.equal(sanitizeFileNamePart('King"s <Gym> / NEW: 2026'), "King s Gym NEW 2026")
  assert.equal(sanitizeFileNamePart("  gym  "), "gym")
  assert.equal(sanitizeFileNamePart("...gym..."), "gym")
  assert.equal(sanitizeFileNamePart("a\\b|c?d*e:gym"), "a b c d e gym")
})

test("sanitizeFileNamePart: falls back to Gym and caps the length", () => {
  assert.equal(sanitizeFileNamePart(null), "Gym")
  assert.equal(sanitizeFileNamePart(""), "Gym")
  assert.equal(sanitizeFileNamePart("..."), "Gym")
  const long = sanitizeFileNamePart("x".repeat(120))
  assert.ok(long.length <= 60)
})

// ---------------------------------------------------------------------------
// Range label
// ---------------------------------------------------------------------------

test("dataRangeLabel: describes all-time and custom ranges", () => {
  assert.equal(dataRangeLabel(allTimeRange()), "All Time")
  assert.equal(dataRangeLabel(customRange("2026-09-21", "2026-09-23")), "2026-09-21 — 2026-09-23")
  assert.equal(dataRangeLabel(customRange("2026-09-21", "2026-09-21")), "2026-09-21")
  assert.equal(dataRangeLabel(null), "All Time")
})

// ---------------------------------------------------------------------------
// Catalog structure sanity
// ---------------------------------------------------------------------------

test("catalog: every category has metadata and a stable order", () => {
  for (const key of DATA_CATEGORY_ORDER) {
    const meta = CATEGORY_META[key]
    assert.ok(meta.label.length > 0)
    assert.ok(meta.dateField.length > 0)
    assert.ok(["instant", "dayKey"].includes(meta.dateKind))
  }
  assert.equal(new Set(DATA_CATEGORY_ORDER).size, DATA_CATEGORY_ORDER.length)
})

// ---------------------------------------------------------------------------
// Workbook structure: sheet order, financial trigger, Excel title limits
// ---------------------------------------------------------------------------

test("workbook: EXPORT_SHEET_ORDER is a permutation of every category", () => {
  assert.equal(EXPORT_SHEET_ORDER.length, DATA_CATEGORY_ORDER.length)
  assert.deepEqual(
    [...EXPORT_SHEET_ORDER].sort(),
    [...DATA_CATEGORY_ORDER].sort()
  )
})

test("workbook: financial summary triggers on member/membership/payment exports", () => {
  assert.deepEqual(FINANCIAL_CATEGORIES, ["members", "memberships", "payments"])
  for (const key of FINANCIAL_CATEGORIES) {
    assert.ok(DATA_CATEGORY_ORDER.includes(key))
  }
})

test("workbook: every worksheet title (incl. Summary sheets) fits Excel's 31 chars", () => {
  const sizes = [
    "Summary".length,
    "Member Financial Summary".length,
    ...EXPORT_SHEET_ORDER.map((key) => CATEGORY_META[key].label.length),
  ]
  for (const size of sizes) assert.ok(size <= 31, `title ${size} chars exceeds Excel limit`)
  const labels = ["Summary", "Member Financial Summary", ...EXPORT_SHEET_ORDER.map((key) => CATEGORY_META[key].label)]
  assert.equal(new Set(labels).size, labels.length)
})

test("isFullExportRange: all-mode and null are full exports", () => {
  assert.equal(isFullExportRange(allTimeRange()), true)
  assert.equal(isFullExportRange(null), true)
  assert.equal(isFullExportRange(undefined), true)
  assert.equal(isFullExportRange(customRange("2026-09-21", "2026-09-23")), false)
})