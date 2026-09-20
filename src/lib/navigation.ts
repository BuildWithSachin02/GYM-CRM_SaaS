/**
 * Segment-aware active navigation matching.
 *
 * A nav item is active when the pathname equals its href, or falls BELOW it
 * as a real child segment (href + "/"). This prevents prefix collisions such
 * as "/dashboard/members" matching "/dashboard/memberships" — the trailing
 * slash separates true segments.
 *
 * The dashboard root ("/dashboard") only matches itself, never its children.
 */

export function isNavRouteActive(href: string, pathname: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard"
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Given the visible nav items, return the single href that should render as
 * active for `pathname`. When several items match (e.g. an ancestor and a
 * nested child such as "/dashboard/attendance" and "/dashboard/attendance/qr"),
 * the deepest (longest href) match wins so siblings never look active at once.
 */
export function activeNavItemHref(
  items: ReadonlyArray<{ href: string }>,
  pathname: string
): string | null {
  let deepest: string | null = null
  for (const item of items) {
    if (isNavRouteActive(item.href, pathname)) {
      if (deepest === null || item.href.length > deepest.length) {
        deepest = item.href
      }
    }
  }
  return deepest
}

/**
 * Safe internal-return-path helper.
 *
 * Detail pages reached from a filtered list should return to the exact list
 * view the user left (filters, pagination, search preserved). The originating
 * list passes its own path in a `?returnTo=` query parameter and the detail
 * page only ever links back through this validator — never raw user input.
 *
 * SECURITY: only same-app dashboard routes are accepted. Anything carrying a
 * scheme, a backslash, a `//` prefix, control characters, or that does not
 * start with `/dashboard` is rejected and the caller's fallback is used, so a
 * crafted `returnTo` can never produce an open redirect.
 */

const DASHBOARD_BASE = "/dashboard"
const MAX_RETURN_TO_LENGTH = 2000
const FORBIDDEN = /[\u0000-\u001f\u007f]/

export function isSafeDashboardPath(value: string): boolean {
  if (!value) return false
  if (value.length > MAX_RETURN_TO_LENGTH) return false
  if (value.startsWith("//")) return false
  if (value.includes("://") || value.includes("\\")) return false
  if (FORBIDDEN.test(value)) return false
  return value === DASHBOARD_BASE || value.startsWith(`${DASHBOARD_BASE}/`)
}

/**
 * Return `raw` (a URL-decoded `returnTo` query value) when it is a safe
 * internal dashboard path, otherwise the caller-provided `fallback`.
 * Never throws — malformed percent-encoding falls back too.
 */
export function getSafeReturnPath(
  raw: string | null | undefined,
  fallback: string
): string {
  if (!raw) return fallback
  let candidate: string
  try {
    candidate = decodeURIComponent(raw)
  } catch {
    return fallback
  }
  return isSafeDashboardPath(candidate) ? candidate : fallback
}