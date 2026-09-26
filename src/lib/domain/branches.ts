import "server-only"

import { cache } from "react"

import { prisma } from "@/lib/prisma"
import type { SessionUser } from "@/lib/auth/auth"
import { getBranchAccess, requireBranchView } from "@/lib/branches"
import { decideBranchCreation, decideVisibleBranchSet } from "@/lib/branch-rules"
import {
  buildBranchMetrics,
  buildBranchQuickLinks,
  branchAttentionItems,
  branchDetailHref,
  type BranchAttentionItem,
  type BranchMetric,
  type BranchQuickLink,
} from "@/lib/branch-overview"
import { getOutstandingSummaryByBranch } from "@/lib/domain/outstanding"
import { addDaysToKey, revenueEnvelope } from "@/lib/analytics-core"
import { getMembershipLifecycle, dayKeyInTimeZone } from "@/lib/memberships"
import { can, ForbiddenError, type Permission } from "@/lib/permissions"
import type { BranchStatus } from "@prisma/client"

/**
 * Server-only loaders for the Branches module.
 *
 * Authorization happens BEFORE any row is read, in this order:
 *
 *   1. the viewer must hold `branches:view`                        (WHAT)
 *   2. the viewer must have at least one branch                     (WHERE)
 *   3. the branch list is narrowed by `decideVisibleBranchSet` over an
 *      ORGANIZATION-scoped query, so a restricted user only ever receives their
 *      own assigned ACTIVE branches
 *   4. every aggregate below is restricted to those same branch ids
 *
 * All card figures are branch-ATTRIBUTED: aggregates group by the branch column
 * and are bounded to the visible branch ids, so a card can never absorb another
 * branch's rows. Organization-wide rows (a lead with no branch, a member with
 * no home branch) belong to the org view and are deliberately NOT folded into a
 * card — that is what the `exact` filter in `@/lib/branch-scope` exists for.
 */

export type BranchCardModel = {
  id: string
  name: string
  branchCode: string
  status: "ACTIVE" | "INACTIVE"
  /** The VIEWER's primary branch (UserBranch.isPrimary) — a personal badge. */
  isPrimaryForViewer: boolean
  city: string | null
  state: string | null
  country: string | null
  address: string | null
  phone: string | null
  email: string | null
  metrics: BranchMetric[]
  attention: BranchAttentionItem[]
  quickLinks: BranchQuickLink[]
  detailHref: string
  /** Staff assigned to this branch, or null when the viewer may not manage staff. */
  staffCount: number | null
  canEdit: boolean
  canManageStaff: boolean
  canDeactivate: boolean
}

export type BranchDirectory = {
  branches: BranchCardModel[]
  canCreate: boolean
  canCreateBlockedReason: string | null
}

/** The recorded-revenue window shown on a card. */
const REVENUE_WINDOW_DAYS = 30

/** Lead stages still in the pipeline (everything except the two exits). */
const OPEN_LEAD_STAGES = ["NEW", "CONTACTED", "VISIT_SCHEDULED"] as const

type BranchAggregateInput = {
  organizationId: string
  branchIds: string[]
  timeZone: string
  today: Date
}

type BranchAggregates = {
  activeMembers: Map<string, number>
  expiringSoon: Map<string, number>
  checkInsToday: Map<string, number>
  openLeads: Map<string, number>
  revenue30dMinor: Map<string, number>
  staffCount: Map<string, number>
}

function countInto(map: Map<string, number>, key: string | null, by = 1): void {
  if (!key) return
  map.set(key, (map.get(key) ?? 0) + by)
}

/**
 * Every per-branch figure the cards need, in one pass.
 *
 * Cost is bounded by the number of VISIBLE BRANCHES, not by the number of
 * records: the `groupBy` reads are index-covered by the (organizationId,
 * branchId, …) indexes, and the single membership scan is exactly the scan
 * `getMembershipLifecycleStats` already performs for the dashboard — so
 * "expiring soon" is SHARED through `getMembershipLifecycle` instead of being
 * re-derived as an `endDate BETWEEN …` shortcut, which would disagree with the
 * rest of the app on org-timezone day boundaries.
 */
const loadBranchAggregates = cache(
  async (input: BranchAggregateInput): Promise<BranchAggregates> => {
    const { organizationId, branchIds, timeZone, today } = input
    const empty = (): BranchAggregates => ({
      activeMembers: new Map(),
      expiringSoon: new Map(),
      checkInsToday: new Map(),
      openLeads: new Map(),
      revenue30dMinor: new Map(),
      staffCount: new Map(),
    })
    if (branchIds.length === 0) return empty()

    const todayKey = dayKeyInTimeZone(today, timeZone)
    const { gte: revenueFrom, lte: revenueTo } = revenueEnvelope(
      Array.from({ length: REVENUE_WINDOW_DAYS }, (_, i) =>
        addDaysToKey(todayKey, -(REVENUE_WINDOW_DAYS - 1 - i))
      )
    )
    const inBranches = { in: branchIds }

    const [members, memberships, checkIns, leads, payments, staff] = await Promise.all([
      prisma.member.groupBy({
        by: ["homeBranchId"],
        where: { organizationId, homeBranchId: inBranches, status: "ACTIVE", deletedAt: null },
        _count: { _all: true },
      }),
      prisma.membership.findMany({
        where: { organizationId, branchId: inBranches },
        select: { branchId: true, startDate: true, endDate: true, status: true },
      }),
      prisma.checkIn.groupBy({
        by: ["branchId"],
        where: { organizationId, branchId: inBranches, dayKey: todayKey },
        _count: { _all: true },
      }),
      prisma.lead.groupBy({
        by: ["branchId"],
        where: {
          organizationId,
          branchId: inBranches,
          stage: { in: [...OPEN_LEAD_STAGES] },
          deletedAt: null,
        },
        _count: { _all: true },
      }),
      prisma.payment.groupBy({
        by: ["branchId"],
        where: {
          organizationId,
          branchId: inBranches,
          status: "RECORDED",
          paymentDate: { gte: revenueFrom, lte: revenueTo },
        },
        _sum: { amountMinor: true },
      }),
      prisma.userBranch.groupBy({
        by: ["branchId"],
        where: { organizationId, branchId: inBranches },
        _count: { _all: true },
      }),
    ])

    const activeMembers = new Map<string, number>()
    for (const row of members) countInto(activeMembers, row.homeBranchId, row._count._all)

    const expiringSoon = new Map<string, number>()
    for (const row of memberships) {
      const lifecycle = getMembershipLifecycle({
        startDate: row.startDate,
        endDate: row.endDate,
        status: row.status,
        timeZone,
        today,
      })
      if (lifecycle.status === "EXPIRING_SOON") countInto(expiringSoon, row.branchId)
    }

    const checkInsToday = new Map<string, number>()
    for (const row of checkIns) countInto(checkInsToday, row.branchId, row._count._all)

    const openLeads = new Map<string, number>()
    for (const row of leads) countInto(openLeads, row.branchId, row._count._all)

    const revenue30dMinor = new Map<string, number>()
    for (const row of payments) {
      countInto(revenue30dMinor, row.branchId, row._sum.amountMinor ?? 0)
    }

    const staffCount = new Map<string, number>()
    for (const row of staff) countInto(staffCount, row.branchId, row._count._all)

    return {
      activeMembers,
      expiringSoon,
      checkInsToday,
      openLeads,
      revenue30dMinor,
      staffCount,
    }
  }
)

export type BranchCreationEntitlement = { allowed: true } | { allowed: false; reason: string }

/**
 * FUTURE SEAM — branch-slot entitlement.
 *
 * The single place that answers "may this tenant add another branch?". It calls
 * the ONE pure rule (`decideBranchCreation`) that the create ACTION enforces, so
 * the button the user sees and the rule the server applies can never disagree.
 * `branchLimit` is `null` (unlimited) today because no subscription model
 * exists; when plans arrive, only this function sources the limit — there are
 * deliberately no plan columns on Branch.
 */
export async function getBranchCreationEntitlement(
  user: SessionUser
): Promise<BranchCreationEntitlement> {
  const currentBranchCount = await prisma.branch.count({
    where: { organizationId: user.organizationId },
  })
  const gate = decideBranchCreation({ branchLimit: null, currentBranchCount })
  if (gate.allowed) return { allowed: true }
  return { allowed: false, reason: "Your plan does not include another branch." }
}

type BranchRow = {
  id: string
  name: string
  branchCode: string
  status: BranchStatus
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  phone: string | null
  email: string | null
}

function buildBranchCard(input: {
  branch: BranchRow
  user: SessionUser
  aggregates: BranchAggregates
  outstandingMinor: number
  duesCount: number
  isPrimaryForViewer: boolean
}): BranchCardModel {
  const { branch, user, aggregates, isPrimaryForViewer } = input
  const canManageStaff = can(user, "branches:manage")
  const snapshot = {
    branchId: branch.id,
    status: branch.status,
    activeMembers: aggregates.activeMembers.get(branch.id) ?? 0,
    expiringSoon: aggregates.expiringSoon.get(branch.id) ?? 0,
    outstandingDuesMinor: input.outstandingMinor,
    duesCount: input.duesCount,
    checkInsToday: aggregates.checkInsToday.get(branch.id) ?? 0,
    openLeads: aggregates.openLeads.get(branch.id) ?? 0,
    revenue30dMinor: aggregates.revenue30dMinor.get(branch.id) ?? 0,
  }

  return {
    id: branch.id,
    name: branch.name,
    branchCode: branch.branchCode,
    status: branch.status,
    isPrimaryForViewer,
    city: branch.city,
    state: branch.state,
    country: branch.country,
    address: branch.address,
    phone: branch.phone,
    email: branch.email,
    metrics: buildBranchMetrics({
      activeMembers: snapshot.activeMembers,
      expiringSoon: snapshot.expiringSoon,
      outstandingDuesMinor: snapshot.outstandingDuesMinor,
      checkInsToday: snapshot.checkInsToday,
      openLeads: snapshot.openLeads,
      revenue30dMinor: snapshot.revenue30dMinor,
    }),
    attention: branchAttentionItems(snapshot),
    quickLinks: buildBranchQuickLinks({
      branchId: branch.id,
      branchStatus: branch.status,
      can: (permission: Permission) => can(user, permission),
    }),
    detailHref: branchDetailHref(branch.id),
    staffCount: canManageStaff ? (aggregates.staffCount.get(branch.id) ?? 0) : null,
    canEdit: can(user, "branches:edit"),
    canManageStaff,
    canDeactivate: can(user, "branches:deactivate"),
  }
}

/**
 * The branch directory behind the /dashboard/branches card grid.
 *
 * Fails CLOSED: a viewer without `branches:view`, or with no branch assignment
 * at all, is rejected before any branch row is returned.
 */
export async function getBranchDirectory(
  user: SessionUser,
  today = new Date()
): Promise<BranchDirectory> {
  if (!can(user, "branches:view")) throw new ForbiddenError()

  const access = await getBranchAccess()
  if (access.mode === "none") throw new ForbiddenError()

  const allBranches = await prisma.branch.findMany({
    where: { organizationId: user.organizationId },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      branchCode: true,
      status: true,
      address: true,
      city: true,
      state: true,
      country: true,
      phone: true,
      email: true,
    },
  })

  const visible = decideVisibleBranchSet({
    mode: access.mode,
    orgBranchIds: allBranches.map((b) => b.id),
    accessibleBranchIds: access.accessibleBranches.map((b) => b.id),
  })
  const branches = allBranches.filter((b) => visible.branchIds.includes(b.id))
  if (branches.length === 0) throw new ForbiddenError()

  const timeZone = user.organization.timezone
  const branchIds = branches.map((b) => b.id)
  const [aggregates, duesByBranch, entitlement] = await Promise.all([
    loadBranchAggregates({ organizationId: user.organizationId, branchIds, timeZone, today }),
    // Membership and payment rows both carry a NOT NULL branch, so this filter
    // is already branch-exact; the per-branch grouping inside keeps it that way
    // and reuses the ONE outstanding-balance implementation.
    getOutstandingSummaryByBranch(
      user.organizationId,
      timeZone,
      { kind: "multi", branchIds },
      today
    ),
    getBranchCreationEntitlement(user),
  ])

  const primaryForViewer = new Set(
    access.accessibleBranches.filter((b) => b.isPrimary).map((b) => b.id)
  )

  return {
    branches: branches.map((branch) => {
      const dues = duesByBranch.get(branch.id)
      return buildBranchCard({
        branch,
        user,
        aggregates,
        outstandingMinor: dues?.totalOutstandingMinor ?? 0,
        duesCount: dues?.duesCount ?? 0,
        isPrimaryForViewer: primaryForViewer.has(branch.id),
      })
    }),
    canCreate: can(user, "branches:create") && entitlement.allowed,
    canCreateBlockedReason: entitlement.allowed ? null : entitlement.reason,
  }
}

/** Quick overview for exactly ONE branch (the branch detail page). */
export async function getBranchDetail(
  user: SessionUser,
  branchId: string,
  today = new Date()
): Promise<{ branch: BranchCardModel; canCreate: boolean; canCreateBlockedReason: string | null }> {
  if (!can(user, "branches:view")) throw new ForbiddenError()
  // Re-validates org membership + branch authority server-side (403 otherwise).
  await requireBranchView(branchId)

  const access = await getBranchAccess()
  const timeZone = user.organization.timezone
  const [branch, aggregates, dues, entitlement] = await Promise.all([
    prisma.branch.findFirst({
      where: { id: branchId, organizationId: user.organizationId },
      select: {
        id: true,
        name: true,
        branchCode: true,
        status: true,
        address: true,
        city: true,
        state: true,
        country: true,
        phone: true,
        email: true,
      },
    }),
    loadBranchAggregates({
      organizationId: user.organizationId,
      branchIds: [branchId],
      timeZone,
      today,
    }),
    getOutstandingSummaryByBranch(
      user.organizationId,
      timeZone,
      { kind: "exact", branchId },
      today
    ),
    getBranchCreationEntitlement(user),
  ])
  if (!branch) throw new ForbiddenError()

  return {
    branch: buildBranchCard({
      branch,
      user,
      aggregates,
      outstandingMinor: dues.get(branchId)?.totalOutstandingMinor ?? 0,
      duesCount: dues.get(branchId)?.duesCount ?? 0,
      isPrimaryForViewer: access.accessibleBranches.some(
        (b) => b.id === branchId && b.isPrimary
      ),
    }),
    canCreate: can(user, "branches:create") && entitlement.allowed,
    canCreateBlockedReason: entitlement.allowed ? null : entitlement.reason,
  }
}

export type BranchStaffOption = { id: string; name: string; email: string; role: string }

export type BranchAssignment = { branchId: string; userId: string; isPrimary: boolean }

export type BranchStaffPool = {
  /** Every active non-owner staff member of the org (the assignable pool). */
  staff: BranchStaffOption[]
  /** Every UserBranch row of the org, so a card can show its own assignment. */
  assignments: BranchAssignment[]
}

/**
 * The staff-access data for the branches the VIEWER can see, loaded ONCE per
 * page.
 *
 * Requires `branches:manage`, and the assignment read is restricted to the
 * viewer's own visible branch set — holding `branches:manage` must not become a
 * way to enumerate who is assigned to a branch outside the viewer's scope. For
 * a restricted staff member that set is exactly their assignments, so the pool
 * degrades safely; an owner sees every branch.
 *
 * A card filters the assignments down to its own branch, so a card never has to
 * ask the server "who is in this branch" individually (no N+1 dialog fetches).
 */
export async function getBranchStaffPool(user: SessionUser): Promise<BranchStaffPool> {
  if (!can(user, "branches:manage")) {
    throw new ForbiddenError()
  }

  const access = await getBranchAccess()

  // Owner authority is org-wide (`mode: "all"` holds NO UserBranch rows of its
  // own), so only a RESTRICTED viewer gets an explicit id allow-list. Assigning
  // to an empty list is not silently treated as "everything" — that would be
  // the leak this filter exists to close.
  const visibleBranchIds =
    access.mode === "all" ? null : access.accessibleBranches.map((b) => b.id)

  const [staff, assignments] = await Promise.all([
    prisma.user.findMany({
      where: {
        organizationId: user.organizationId,
        status: "ACTIVE",
        role: { not: "OWNER" },
      },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, email: true, role: true },
    }),
    prisma.userBranch.findMany({
      // Scoped to the viewer's visible branches, not just the organization: an
      // assignment row outside that set is metadata the viewer may not read.
      where: {
        organizationId: user.organizationId,
        ...(visibleBranchIds ? { branchId: { in: visibleBranchIds } } : {}),
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: { branchId: true, userId: true, isPrimary: true },
    }),
  ])

  return {
    staff: staff.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
    assignments: assignments.map((a) => ({
      branchId: a.branchId,
      userId: a.userId,
      isPrimary: a.isPrimary,
    })),
  }
}
