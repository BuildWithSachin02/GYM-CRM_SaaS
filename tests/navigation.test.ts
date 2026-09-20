import { test } from "node:test"
import assert from "node:assert/strict"

import {
  activeNavItemHref,
  getSafeReturnPath,
  isNavRouteActive,
  isSafeDashboardPath,
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

// ---------------------------------------------------------------------------
// Safe return-path handling (Requirement 4/5): detail pages may only link back
// through validated internal dashboard paths — never raw ?returnTo= input.
// ---------------------------------------------------------------------------
test("isSafeDashboardPath accepts only internal dashboard paths", () => {
  assert.equal(isSafeDashboardPath("/dashboard"), true)
  assert.equal(isSafeDashboardPath("/dashboard/members"), true)
  assert.equal(
    isSafeDashboardPath("/dashboard/plans/123/members?x=1&y=2"),
    true
  )
  assert.equal(isSafeDashboardPath("/dashboard/memberships?status=EXPIRED"), true)
})

test("isSafeDashboardPath rejects external, scheme-less and out-of-app paths", () => {
  assert.equal(isSafeDashboardPath(""), false)
  assert.equal(isSafeDashboardPath("https://evil.com"), false)
  assert.equal(isSafeDashboardPath("http://evil.com"), false)
  assert.equal(isSafeDashboardPath("//evil.com"), false)
  assert.equal(isSafeDashboardPath("javascript:alert(1)"), false)
  assert.equal(isSafeDashboardPath("/\\evil.com"), false)
  assert.equal(isSafeDashboardPath("/logout"), false)
  assert.equal(isSafeDashboardPath("/"), false)
  assert.equal(isSafeDashboardPath("dashboard/members"), false)
})

test("getSafeReturnPath decodes encoded query values and falls back otherwise", () => {
  const fallback = "/dashboard/members"
  assert.equal(
    getSafeReturnPath("/dashboard", fallback),
    "/dashboard"
  )
  assert.equal(
    getSafeReturnPath(
      encodeURIComponent("/dashboard/memberships?status=EXPIRED&page=2"),
      fallback
    ),
    "/dashboard/memberships?status=EXPIRED&page=2"
  )
  assert.equal(getSafeReturnPath("%zz", fallback), fallback)
  assert.equal(getSafeReturnPath(encodeURIComponent("https://evil.com"), fallback), fallback)
  assert.equal(getSafeReturnPath(encodeURIComponent("//evil.com"), fallback), fallback)
  assert.equal(getSafeReturnPath("", fallback), fallback)
  assert.equal(getSafeReturnPath(null, fallback), fallback)
  assert.equal(getSafeReturnPath(undefined, fallback), fallback)
})

test("getSafeReturnPath rejects control characters even when decodable", () => {
  const fallback = "/dashboard/members"
  assert.equal(getSafeReturnPath("/dashboard/\u0000", fallback), fallback)
  assert.equal(getSafeReturnPath("/dashboard/\n", fallback), fallback)
})