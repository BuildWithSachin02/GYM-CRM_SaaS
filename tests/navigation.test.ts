import { test } from "node:test"
import assert from "node:assert/strict"

import {
  activeNavItemHref,
  isNavRouteActive,
} from "../src/lib/navigation"

// ---------------------------------------------------------------------------
// isNavRouteActive: a nav item matches only itself or real child segments.
// ---------------------------------------------------------------------------
test("exact path matches", () => {
  assert.equal(isNavRouteActive("/dashboard/members", "/dashboard/members"), true)
  assert.equal(isNavRouteActive("/dashboard/memberships", "/dashboard/memberships"), true)
  assert.equal(isNavRouteActive("/dashboard", "/dashboard"), true)
})

test("child segments of an item match, but only below a real slash boundary", () => {
  assert.equal(isNavRouteActive("/dashboard/members", "/dashboard/members/123"), true)
})

test("prefix collisions between sibling routes do NOT match (the trailing slash guard)", () => {
  assert.equal(isNavRouteActive("/dashboard/members", "/dashboard/memberships"), false)
  assert.equal(isNavRouteActive("/dashboard/members", "/dashboard/memberships/9"), false)
  assert.equal(isNavRouteActive("/dashboard/attendance", "/dashboard/attendance/qr"), true)
})

test("dashboard root only matches itself, never children", () => {
  assert.equal(isNavRouteActive("/dashboard", "/dashboard/members"), false)
  assert.equal(isNavRouteActive("/dashboard", "/dashboard/memberships"), false)
  assert.equal(isNavRouteActive("/dashboard", "/dashboard/attendance/qr"), false)
})

test("unrelated paths do not match", () => {
  assert.equal(isNavRouteActive("/dashboard/members", "/dashboard/plans"), false)
  assert.equal(isNavRouteActive("/dashboard/memberships", "/dashboard/members"), false)
})

// ---------------------------------------------------------------------------
// activeNavItemHref: no sibling route looks active at the same time.
// ---------------------------------------------------------------------------
test("sibling routes never both appear active", () => {
  const items = [
    { href: "/dashboard" },
    { href: "/dashboard/members" },
    { href: "/dashboard/memberships" },
    { href: "/dashboard/attendance" },
    { href: "/dashboard/attendance/qr" },
  ]

  assert.equal(activeNavItemHref(items, "/dashboard/members/123"), "/dashboard/members")
  assert.equal(activeNavItemHref(items, "/dashboard/members/definitely/not/a/plan"), "/dashboard/members")
  assert.equal(activeNavItemHref(items, "/dashboard/memberships"), "/dashboard/memberships")
  assert.equal(activeNavItemHref(items, "/dashboard/memberships/42"), "/dashboard/memberships")
})

test("longest href wins so nested children drop their parent highlight", () => {
  const items = [
    { href: "/dashboard/attendance" },
    { href: "/dashboard/attendance/qr" },
  ]

  assert.equal(activeNavItemHref(items, "/dashboard/attendance"), "/dashboard/attendance")
  assert.equal(activeNavItemHref(items, "/dashboard/attendance/qr"), "/dashboard/attendance/qr")
})

test("dashboard active only on the exact dashboard route", () => {
  const items = [
    { href: "/dashboard" },
    { href: "/dashboard/members" },
    { href: "/dashboard/reports" },
  ]

  assert.equal(activeNavItemHref(items, "/dashboard"), "/dashboard")
  assert.equal(activeNavItemHref(items, "/dashboard/reports"), "/dashboard/reports")
  // no permission for members here — ensure the dashboard never claims it
  assert.equal(activeNavItemHref([{ href: "/dashboard" }], "/dashboard/reports"), null)
})

test("unknown routes leave nothing active", () => {
  const items = [
    { href: "/dashboard" },
    { href: "/dashboard/members" },
    { href: "/dashboard/plans" },
  ]

  assert.equal(activeNavItemHref(items, "/dashboard/notifications"), null)
  assert.equal(activeNavItemHref(items, "/login"), null)
})