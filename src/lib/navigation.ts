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