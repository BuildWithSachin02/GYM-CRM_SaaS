import type { Permission } from "@/lib/permissions"

/**
 * PURE branch-overview rules.
 *
 * Everything a branch card / branch detail page renders is DERIVED here from a
 * plain snapshot of already-authorized numbers, so the presentation rules
 * (metric labels, "requires attention" items, quick-link allowlist) are unit
 * testable without a database, a session or a React render.
 *
 * Two invariants this module exists to protect:
 *
 *   1. A branch card reports ONLY that branch's own records. The loader always
 *      reads with an `exact` branch filter (`@/lib/branch-scope`), which
 *      deliberately excludes organization-wide (branchId = null) rows — those
 *      would otherwise be counted on every single card.
 *   2. Quick links may only point at a fixed allowlist of in-app module routes,
 *      and the branch context travels as a `?branch=<id>` search param that the
 *      target page re-validates server-side. No client-supplied path is ever
 *      echoed back into an href.
 */

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export type BranchMetricId =
  | "activeMembers"
  | "expiringSoon"
  | "outstandingDues"
  | "checkInsToday"
  | "openLeads"
  | "revenue30d"

export type BranchMetricKind = "count" | "money"

export type BranchMetricDef = {
  id: BranchMetricId
  label: string
  kind: BranchMetricKind
  /** Shown under the value as small muted text (e.g. "in 7 days"). */
  hint: string
  /** Drives the "requires attention" rule for this metric. */
  attentionWhen?: "nonZero"
}

/**
 * The card's metric set, in render order. `expiringSoon` uses the shared
 * RENEWAL_WARNING_DAYS window (7) that Members/Memberships already show, so
 * "6 expiring" means the same thing everywhere.
 */
export const BRANCH_OVERVIEW_METRICS: readonly BranchMetricDef[] = [
  { id: "activeMembers", label: "Active members", kind: "count", hint: "home branch" },
  {
    id: "expiringSoon",
    label: "Expiring soon",
    kind: "count",
    hint: "next 7 days",
    attentionWhen: "nonZero",
  },
  {
    id: "outstandingDues",
    label: "Outstanding dues",
    kind: "money",
    hint: "pending + overdue",
    attentionWhen: "nonZero",
  },
  { id: "checkInsToday", label: "Check-ins today", kind: "count", hint: "at this branch" },
  { id: "openLeads", label: "Open leads", kind: "count", hint: "pipeline" },
  { id: "revenue30d", label: "Revenue (30d)", kind: "money", hint: "recorded" },
]

export type BranchMetricValues = Record<BranchMetricId, number>

export type BranchMetric = BranchMetricDef & { value: number }

/** Raw, already-scoped numbers for ONE branch (the loader's output shape). */
export type BranchOverviewSnapshot = {
  branchId: string
  status: "ACTIVE" | "INACTIVE"
  activeMembers: number
  expiringSoon: number
  outstandingDuesMinor: number
  /** Memberships carrying a non-zero balance (pending + overdue). */
  duesCount: number
  checkInsToday: number
  openLeads: number
  revenue30dMinor: number
}

export type BranchMetricValuesInput = {
  activeMembers: number
  expiringSoon: number
  outstandingDuesMinor: number
  checkInsToday: number
  openLeads: number
  revenue30dMinor: number
}

export function buildBranchMetrics(
  input: BranchMetricValuesInput
): BranchMetric[] {
  const values: BranchMetricValues = {
    activeMembers: input.activeMembers,
    expiringSoon: input.expiringSoon,
    outstandingDues: input.outstandingDuesMinor,
    checkInsToday: input.checkInsToday,
    openLeads: input.openLeads,
    revenue30d: input.revenue30dMinor,
  }
  return BRANCH_OVERVIEW_METRICS.map((def) => ({ ...def, value: values[def.id] }))
}

// ---------------------------------------------------------------------------
// "Requires attention" (at most BRANCH_ATTENTION_LIMIT items, priority order)
// ---------------------------------------------------------------------------

export type BranchAttentionId =
  | "branchInactive"
  | "membershipsExpiring"
  | "duesOverdue"
  | "noActiveMembers"
  | "openLeadsWaiting"

export type BranchAttentionItem = {
  id: BranchAttentionId
  label: string
  tone: "warning" | "muted"
}

export const BRANCH_ATTENTION_LIMIT = 2

/**
 * Ordered candidate items. The first BRANCH_ATTENTION_LIMIT that apply are
 * shown; the rest are dropped rather than wrapping into a second row, so a
 * busy branch never pushes the card taller than its neighbours.
 *
 * `inactive` is a hard alert (it is the reason a card is dimmed). Dues and
 * expiring memberships are the two that cost the gym money. A branch with no
 * active members is informational. Open leads only surface when the rest is
 * clean.
 */
const ATTENTION_CANDIDATES: readonly {
  id: BranchAttentionId
  applies: (s: BranchOverviewSnapshot) => boolean
  label: (s: BranchOverviewSnapshot) => string
  tone: BranchAttentionItem["tone"]
}[] = [
  {
    id: "branchInactive",
    applies: (s) => s.status !== "ACTIVE",
    label: () => "Branch deactivated",
    tone: "warning",
  },
  {
    id: "membershipsExpiring",
    applies: (s) => s.expiringSoon > 0,
    label: (s) => `${s.expiringSoon} membership${s.expiringSoon === 1 ? "" : "s"} expiring`,
    tone: "warning",
  },
  {
    id: "duesOverdue",
    applies: (s) => s.outstandingDuesMinor > 0,
    label: (s) =>
      s.duesCount === 1
        ? "Dues on 1 membership"
        : `Dues on ${s.duesCount} memberships`,
    tone: "warning",
  },
  {
    id: "noActiveMembers",
    applies: (s) => s.activeMembers === 0 && s.status === "ACTIVE",
    label: () => "No active members yet",
    tone: "muted",
  },
  {
    id: "openLeadsWaiting",
    applies: (s) => s.openLeads > 0,
    label: (s) => `${s.openLeads} open lead${s.openLeads === 1 ? "" : "s"}`,
    tone: "muted",
  },
]

export function branchAttentionItems(snapshot: BranchOverviewSnapshot): BranchAttentionItem[] {
  const items: BranchAttentionItem[] = []
  for (const candidate of ATTENTION_CANDIDATES) {
    if (items.length >= BRANCH_ATTENTION_LIMIT) break
    if (!candidate.applies(snapshot)) continue
    items.push({ id: candidate.id, label: candidate.label(snapshot), tone: candidate.tone })
  }
  return items
}

// ---------------------------------------------------------------------------
// Quick links (PART 13)
// ---------------------------------------------------------------------------

export type BranchQuickLinkId =
  | "members"
  | "memberships"
  | "payments"
  | "attendance"
  | "leads"
  | "appointments"
  | "tasks"
  | "reports"

/**
 * The complete allowlist of quick-link destinations. A link is only ever
 * rendered when BOTH the module's `:view` permission is held AND the branch is
 * ACTIVE (a deactivated branch accepts no new operational work, so deep
 * linking into it would only ever show a dead end).
 */
export const BRANCH_QUICK_LINKS: readonly {
  id: BranchQuickLinkId
  label: string
  path: string
  permission: Permission
}[] = [
  { id: "members", label: "Members", path: "/dashboard/members", permission: "members:view" },
  {
    id: "memberships",
    label: "Memberships",
    path: "/dashboard/memberships",
    permission: "memberships:view",
  },
  { id: "payments", label: "Payments", path: "/dashboard/payments", permission: "payments:view" },
  {
    id: "attendance",
    label: "Attendance",
    path: "/dashboard/attendance",
    permission: "attendance:view",
  },
  { id: "leads", label: "Leads", path: "/dashboard/leads", permission: "leads:view" },
  {
    id: "appointments",
    label: "Appointments",
    path: "/dashboard/appointments",
    permission: "appointments:view",
  },
  { id: "tasks", label: "Tasks", path: "/dashboard/tasks", permission: "tasks:view" },
  { id: "reports", label: "Reports", path: "/dashboard/reports", permission: "reports:view" },
]

export type BranchQuickLink = { id: BranchQuickLinkId; label: string; href: string }

/**
 * Build the quick links a viewer may follow into ONE branch.
 *
 * The href is always `<allowlisted path>?branch=<branchId>`: the path comes
 * from BRANCH_QUICK_LINKS (never from the caller) and the id is the id the
 * loader already authorized, so no untrusted string reaches the URL. The
 * target page re-validates that id server-side before narrowing its queries.
 */
export function buildBranchQuickLinks(input: {
  branchId: string
  branchStatus: "ACTIVE" | "INACTIVE"
  can: (permission: Permission) => boolean
}): BranchQuickLink[] {
  if (input.branchStatus !== "ACTIVE") return []
  return BRANCH_QUICK_LINKS.filter((link) => input.can(link.permission)).map((link) => ({
    id: link.id,
    label: link.label,
    href: `${link.path}?branch=${encodeURIComponent(input.branchId)}`,
  }))
}

/** The canonical branch-detail path. */
export function branchDetailHref(branchId: string): string {
  return `/dashboard/branches/${encodeURIComponent(branchId)}`
}
