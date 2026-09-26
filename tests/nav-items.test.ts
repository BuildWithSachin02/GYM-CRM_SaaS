import { test } from "node:test"
import assert from "node:assert/strict"

import { NAV_ITEMS, NAV_TITLES, navTitleForPath, visibleNavItems } from "../src/lib/nav-items"
import { activeNavItemHref, isNavRouteActive } from "../src/lib/navigation"
import type { Permission } from "../src/lib/permissions"

// ---------------------------------------------------------------------------
// The dashboard navigation is a product contract, not a styling detail: the
// canonical ORDER, the single shared list for desktop + mobile, and the
// Branches entry sitting directly under Dashboard are all asserted here so a
// refactor cannot silently reshuffle the sidebar.
// ---------------------------------------------------------------------------

const hrefs = NAV_ITEMS.map((item) => item.href)
const indexOf = (href: string) => {
  const index = hrefs.indexOf(href)
  assert.notEqual(index, -1, `${href} is missing from NAV_ITEMS`)
  return index
}

test("NAV_ITEMS keeps the canonical module order", () => {
  assert.deepEqual(hrefs, [
    "/dashboard",
    "/dashboard/branches",
    "/dashboard/members",
    "/dashboard/memberships",
    "/dashboard/plans",
    "/dashboard/payments",
    "/dashboard/attendance",
    "/dashboard/attendance/qr",
    "/dashboard/leads",
    "/dashboard/trainers",
    "/dashboard/appointments",
    "/dashboard/tasks",
    "/dashboard/reports",
    "/dashboard/settings/users",
    "/dashboard/settings",
  ])
})

test("Branches sits directly under Dashboard and above member data", () => {
  assert.equal(indexOf("/dashboard/branches"), 1)
  assert.equal(indexOf("/dashboard"), 0)
  assert.ok(indexOf("/dashboard/branches") < indexOf("/dashboard/members"))
})

test("Settings is always the final navigation item", () => {
  assert.equal(hrefs[hrefs.length - 1], "/dashboard/settings")
  assert.equal(indexOf("/dashboard/settings/users"), hrefs.length - 2)
})

test("every nav item has a label, an in-app href and a permission gate", () => {
  for (const item of NAV_ITEMS) {
    assert.ok(item.label.length > 0, `${item.href} has no label`)
    assert.ok(item.href.startsWith("/dashboard"), `${item.href} is not an in-app path`)
    assert.ok(item.permission.length > 0, `${item.href} has no permission`)
  }
})

test("nav hrefs are unique and nested entries resolve to exactly one active item", () => {
  assert.equal(new Set(hrefs).size, hrefs.length)
  // Attendance and QR Check-in are parent/child: on the QR page both match, and
  // the DEEPEST href wins so siblings never look active at once.
  assert.equal(isNavRouteActive("/dashboard/attendance", "/dashboard/attendance/qr"), true)
  assert.equal(
    activeNavItemHref(NAV_ITEMS, "/dashboard/attendance/qr"),
    "/dashboard/attendance/qr"
  )
  assert.equal(activeNavItemHref(NAV_ITEMS, "/dashboard/attendance"), "/dashboard/attendance")
  // A filtered-out item can never be the active one.
  assert.equal(
    activeNavItemHref(
      NAV_ITEMS.filter((item) => item.href !== "/dashboard/attendance/qr"),
      "/dashboard/attendance/qr"
    ),
    "/dashboard/attendance"
  )
})

test("visibleNavItems filters by permission without reordering", () => {
  const blocked = new Set<Permission>([
    "leads:view",
    "trainers:view",
    "appointments:view",
    "tasks:view",
    "reports:view",
    "staff:manage",
    "settings:view",
  ])
  const visible = visibleNavItems((permission) => !blocked.has(permission))
  assert.deepEqual(
    visible.map((item) => item.href),
    hrefs.filter((href) => {
      const item = NAV_ITEMS.find((candidate) => candidate.href === href)
      return item ? !blocked.has(item.permission) : false
    })
  )
  assert.equal(
    visible.some((item) => item.href === "/dashboard/settings/users"),
    false
  )
})

test("a viewer without branches:view never sees the Branches entry", () => {
  const visible = visibleNavItems((permission) => permission !== "branches:view")
  assert.equal(
    visible.some((item) => item.href === "/dashboard/branches"),
    false
  )
  // ...and the order of the remaining items is untouched.
  assert.deepEqual(
    visible.map((item) => item.href),
    hrefs.filter((href) => href !== "/dashboard/branches")
  )
})

test("an owner-level viewer sees every nav item", () => {
  const all = visibleNavItems(() => true)
  assert.equal(all.length, NAV_ITEMS.length)
  assert.equal(all[1].href, "/dashboard/branches")
})

test("navTitleForPath titles every nav entry and falls back per section", () => {
  for (const item of NAV_ITEMS) {
    assert.equal(navTitleForPath(item.href), NAV_TITLES[item.href])
  }
  // Detail routes resolve to a section label, never to bare "Dashboard".
  assert.equal(navTitleForPath("/dashboard/branches/abc"), "Branch Details")
  assert.equal(navTitleForPath("/dashboard/branches/abc/staff"), "Branch Details")
  assert.equal(navTitleForPath("/dashboard/members/abc"), "Member Profile")
  assert.equal(navTitleForPath("/dashboard/unknown-route"), "Dashboard")
})
