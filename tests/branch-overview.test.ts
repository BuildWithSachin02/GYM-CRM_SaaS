import { test } from "node:test"
import assert from "node:assert/strict"

import {
  BRANCH_ATTENTION_LIMIT,
  BRANCH_OVERVIEW_METRICS,
  BRANCH_QUICK_LINKS,
  branchAttentionItems,
  branchDetailHref,
  buildBranchMetrics,
  buildBranchQuickLinks,
  type BranchOverviewSnapshot,
} from "../src/lib/branch-overview"
import type { Permission } from "../src/lib/permissions"

// ---------------------------------------------------------------------------
// PURE branch-overview presentation rules (no DB, no session, no render).
// ---------------------------------------------------------------------------

const snapshot = (overrides: Partial<BranchOverviewSnapshot> = {}): BranchOverviewSnapshot => ({
  branchId: "b1",
  status: "ACTIVE",
  activeMembers: 42,
  expiringSoon: 0,
  outstandingDuesMinor: 0,
  duesCount: 0,
  checkInsToday: 0,
  openLeads: 0,
  revenue30dMinor: 0,
  ...overrides,
})

test("buildBranchMetrics emits the six metrics in a stable order", () => {
  const metrics = buildBranchMetrics({
    activeMembers: 10,
    expiringSoon: 3,
    outstandingDuesMinor: 250000,
    checkInsToday: 7,
    openLeads: 2,
    revenue30dMinor: 900000,
  })

  assert.equal(metrics.length, 6)
  assert.deepEqual(
    metrics.map((m) => m.id),
    BRANCH_OVERVIEW_METRICS.map((m) => m.id)
  )
  // Money metrics are carried in MINOR units so formatting stays in one place.
  const dues = metrics.find((m) => m.id === "outstandingDues")
  assert.equal(dues?.kind, "money")
  assert.equal(dues?.value, 250000)
  const members = metrics.find((m) => m.id === "activeMembers")
  assert.equal(members?.kind, "count")
  assert.equal(members?.value, 10)
  // Every metric carries a definition (label/hint) for the card renderer.
  for (const metric of metrics) {
    assert.ok(metric.label.length > 0)
    assert.ok(metric.hint.length > 0)
  }
})

test("a healthy branch raises no attention items", () => {
  assert.deepEqual(branchAttentionItems(snapshot()), [])
})

test("attention items are capped and ordered by business priority", () => {
  const items = branchAttentionItems(
    snapshot({
      status: "INACTIVE",
      expiringSoon: 4,
      outstandingDuesMinor: 50000,
      activeMembers: 0,
      openLeads: 9,
    })
  )
  // Capped: a busy branch never grows taller than its neighbours.
  assert.equal(items.length, BRANCH_ATTENTION_LIMIT)
  assert.deepEqual(
    items.map((i) => i.id),
    ["branchInactive", "membershipsExpiring"]
  )
})

test("deactivation outranks every other alert and is a warning", () => {
  const [first] = branchAttentionItems(
    snapshot({ status: "INACTIVE", expiringSoon: 2, outstandingDuesMinor: 1000, activeMembers: 5 })
  )
  assert.equal(first?.id, "branchInactive")
  assert.equal(first?.tone, "warning")
})

test("a deactivated branch is never nagged about having no members", () => {
  const items = branchAttentionItems(snapshot({ status: "INACTIVE", activeMembers: 0 }))
  assert.equal(
    items.some((i) => i.id === "noActiveMembers"),
    false
  )
})

test("dues attention uses the membership COUNT, not the amount", () => {
  const [item] = branchAttentionItems(
    snapshot({ outstandingDuesMinor: 999999, duesCount: 1 })
  )
  assert.equal(item?.id, "duesOverdue")
  assert.equal(item?.label, "Dues on 1 membership")
  assert.equal(
    branchAttentionItems(snapshot({ outstandingDuesMinor: 1, duesCount: 3 }))[0]?.label,
    "Dues on 3 memberships"
  )
})

test("attention labels are pluralized correctly", () => {
  assert.equal(
    branchAttentionItems(snapshot({ expiringSoon: 1 }))[0]?.label,
    "1 membership expiring"
  )
  assert.equal(
    branchAttentionItems(snapshot({ expiringSoon: 2 }))[0]?.label,
    "2 memberships expiring"
  )
  assert.equal(branchAttentionItems(snapshot({ openLeads: 1 }))[0]?.label, "1 open lead")
  assert.equal(branchAttentionItems(snapshot({ openLeads: 5 }))[0]?.label, "5 open leads")
})

test("quick links only appear for an ACTIVE branch", () => {
  const can = () => true
  assert.equal(buildBranchQuickLinks({ branchId: "b1", branchStatus: "ACTIVE", can }).length, 8)
  assert.deepEqual(buildBranchQuickLinks({ branchId: "b1", branchStatus: "INACTIVE", can }), [])
})

test("quick links are filtered by the viewer's module permissions", () => {
  const allowed: Permission[] = ["members:view", "payments:view"]
  const links = buildBranchQuickLinks({
    branchId: "b1",
    branchStatus: "ACTIVE",
    can: (permission) => allowed.includes(permission),
  })
  assert.deepEqual(
    links.map((l) => l.id),
    ["members", "payments"]
  )
})

test("every quick link carries the branch context as an encoded ?branch param", () => {
  const links = buildBranchQuickLinks({
    branchId: "b 1/x",
    branchStatus: "ACTIVE",
    can: () => true,
  })
  for (const link of links) {
    assert.ok(link.href.includes("branch="))
    // The id is encoded, so a crafted id cannot break out of the query param.
    assert.ok(link.href.endsWith("branch=b%201%2Fx"))
  }
})

test("quick links come only from the fixed allowlist", () => {
  const links = buildBranchQuickLinks({ branchId: "b1", branchStatus: "ACTIVE", can: () => true })
  const allowedPaths = BRANCH_QUICK_LINKS.map((l) => l.path)
  for (const link of links) {
    const path = link.href.split("?")[0]
    assert.ok(allowedPaths.includes(path))
    // Never an external URL.
    assert.equal(link.href.startsWith("http"), false)
  }
})

test("branchDetailHref encodes the branch id", () => {
  assert.equal(branchDetailHref("b1"), "/dashboard/branches/b1")
  assert.equal(branchDetailHref("a/b"), "/dashboard/branches/a%2Fb")
})
