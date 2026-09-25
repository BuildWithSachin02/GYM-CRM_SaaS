import "server-only"

import type { Prisma } from "@prisma/client"

import {
  categoryFilter,
  EXPORT_SHEET_ORDER,
  FINANCIAL_CATEGORIES,
  type CategoryWhere,
  type DataCategoryKey,
  type DataDateRange,
} from "@/lib/data-catalog"
import {
  type AnyExportRow,
  type ExportRowMap,
  type SummaryCounts,
} from "@/lib/data-export-mapping"
import {
  buildMemberFinancialRows,
  type FinancialMembershipRow,
  type FinancialPaymentRow,
} from "@/lib/data-financials"
import {
  buildOutstandingTotals,
  outstandingOfMembership,
} from "@/lib/outstanding"
import { prisma } from "@/lib/prisma"
import {
  buildWorkbookFile,
  type WorkbookBuildResult,
  type WorkbookSheetData,
} from "@/lib/workbook-builder"

/**
 * Server-only data service for the xlsx export.
 *
 *  1. Fetches EVERY matching record per selected module (cursor-paginated, so
 *     nothing is truncated) — org-scoped, plus the same soft-delete rule the
 *     dashboard uses for members/leads.
 *  2. Aggregates the Summary counters and the derived financial summary.
 *  3. Handed the pure workbook builder, which renders a clickable, Excel-native
 *     workbook (Summary index + hyperlinked detail sheets).
 *
 * All record sets are fetched with the SAME filters that feed the Summary
 * counters, so Summary totals reconcile with the detailed sheets.
 */

export const EXPORT_BATCH_SIZE = 1000

export type BuildExportArgs = {
  organizationId: string
  gymName: string
  categories: DataCategoryKey[]
  range: DataDateRange
  timeZone: string
}

/**
 * Export-scoped filter for a category. Adds the soft-delete exclusion the
 * dashboard already applies to members and leads (`deletedAt: null`) so the
 * workbook never contradicts the in-app lists — but only for export, never for
 * the reset flow which uses categoryFilter() directly.
 */
function exportScopeFilter<K extends DataCategoryKey>(
  key: K,
  organizationId: string,
  range: DataDateRange,
  timeZone: string
): CategoryWhere<K> {
  const base = categoryFilter(key, organizationId, range, timeZone) as Record<string, unknown>
  if (key === "members" || key === "leads") {
    return { ...base, deletedAt: null } as CategoryWhere<K>
  }
  return base as CategoryWhere<K>
}

// ---------------------------------------------------------------------------
// Per-category batched fetch (org-scoped, cursor-paginated)
// ---------------------------------------------------------------------------

async function fetchBatch(
  key: DataCategoryKey,
  organizationId: string,
  range: DataDateRange,
  timeZone: string,
  cursorId: string | undefined
): Promise<AnyExportRow[]> {
  const take = EXPORT_BATCH_SIZE

  switch (key) {
    case "members":
      return (await prisma.member.findMany({
        where: exportScopeFilter(key, organizationId, range, timeZone) as Prisma.MemberWhereInput,
        orderBy: { id: "asc" },
        take,
        cursor: cursorId ? { id: cursorId } : undefined,
        skip: cursorId ? 1 : undefined,
        include: {
          trainer: { select: { user: { select: { name: true } } } },
          location: { select: { name: true } },
        },
      })) as unknown as ExportRowMap["members"][]
    case "memberships":
      return (await prisma.membership.findMany({
        where: exportScopeFilter(key, organizationId, range, timeZone) as Prisma.MembershipWhereInput,
        orderBy: { id: "asc" },
        take,
        cursor: cursorId ? { id: cursorId } : undefined,
        skip: cursorId ? 1 : undefined,
        include: {
          member: { select: { firstName: true, lastName: true, phone: true, memberCode: true } },
          plan: { select: { name: true, priceMinor: true } },
        },
      })) as unknown as ExportRowMap["memberships"][]
    case "plans":
      return (await prisma.membershipPlan.findMany({
        where: exportScopeFilter(key, organizationId, range, timeZone) as Prisma.MembershipPlanWhereInput,
        orderBy: { id: "asc" },
        take,
        cursor: cursorId ? { id: cursorId } : undefined,
        skip: cursorId ? 1 : undefined,
      })) as unknown as ExportRowMap["plans"][]
    case "payments":
      return (await prisma.payment.findMany({
        where: exportScopeFilter(key, organizationId, range, timeZone) as Prisma.PaymentWhereInput,
        orderBy: { id: "asc" },
        take,
        cursor: cursorId ? { id: cursorId } : undefined,
        skip: cursorId ? 1 : undefined,
        include: {
          member: { select: { firstName: true, lastName: true, memberCode: true } },
          membership: {
            select: {
              id: true,
              status: true,
              startDate: true,
              endDate: true,
              plan: { select: { id: true, name: true } },
            },
          },
          recordedBy: { select: { name: true } },
        },
      })) as unknown as ExportRowMap["payments"][]
    case "attendance":
      return (await prisma.checkIn.findMany({
        where: exportScopeFilter(key, organizationId, range, timeZone) as Prisma.CheckInWhereInput,
        orderBy: { id: "asc" },
        take,
        cursor: cursorId ? { id: cursorId } : undefined,
        skip: cursorId ? 1 : undefined,
        include: {
          member: { select: { firstName: true, lastName: true, memberCode: true } },
          location: { select: { name: true } },
          qrSession: { select: { id: true, label: true } },
        },
      })) as unknown as ExportRowMap["attendance"][]
    case "leads":
      return (await prisma.lead.findMany({
        where: exportScopeFilter(key, organizationId, range, timeZone) as Prisma.LeadWhereInput,
        orderBy: { id: "asc" },
        take,
        cursor: cursorId ? { id: cursorId } : undefined,
        skip: cursorId ? 1 : undefined,
        include: {
          location: { select: { name: true } },
          interestedPlan: { select: { name: true } },
          ownerUser: { select: { name: true } },
          convertedMember: { select: { firstName: true, lastName: true } },
        },
      })) as unknown as ExportRowMap["leads"][]
    case "appointments":
      return (await prisma.appointment.findMany({
        where: exportScopeFilter(key, organizationId, range, timeZone) as Prisma.AppointmentWhereInput,
        orderBy: { id: "asc" },
        take,
        cursor: cursorId ? { id: cursorId } : undefined,
        skip: cursorId ? 1 : undefined,
        include: {
          member: { select: { id: true, firstName: true, lastName: true, memberCode: true } },
          lead: { select: { id: true, name: true } },
          trainer: { select: { user: { select: { name: true } } } },
          staff: { select: { name: true } },
          location: { select: { name: true } },
        },
      })) as unknown as ExportRowMap["appointments"][]
    case "tasks":
      return (await prisma.task.findMany({
        where: exportScopeFilter(key, organizationId, range, timeZone) as Prisma.TaskWhereInput,
        orderBy: { id: "asc" },
        take,
        cursor: cursorId ? { id: cursorId } : undefined,
        skip: cursorId ? 1 : undefined,
        include: {
          assignee: { select: { name: true } },
          createdBy: { select: { name: true } },
          member: { select: { id: true, firstName: true, lastName: true, memberCode: true } },
          lead: { select: { id: true, name: true } },
        },
      })) as unknown as ExportRowMap["tasks"][]
    case "qrSessions":
      return (await prisma.qRSession.findMany({
        where: exportScopeFilter(key, organizationId, range, timeZone) as Prisma.QRSessionWhereInput,
        orderBy: { id: "asc" },
        take,
        cursor: cursorId ? { id: cursorId } : undefined,
        skip: cursorId ? 1 : undefined,
        include: {
          location: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
      })) as unknown as ExportRowMap["qrSessions"][]
    case "leadActivities":
      return (await prisma.leadActivity.findMany({
        where: exportScopeFilter(key, organizationId, range, timeZone) as Prisma.LeadActivityWhereInput,
        orderBy: { id: "asc" },
        take,
        cursor: cursorId ? { id: cursorId } : undefined,
        skip: cursorId ? 1 : undefined,
        include: {
          lead: { select: { id: true, name: true } },
          createdBy: { select: { name: true } },
        },
      })) as unknown as ExportRowMap["leadActivities"][]
    case "trainers":
      return (await prisma.trainer.findMany({
        where: exportScopeFilter(key, organizationId, range, timeZone) as Prisma.TrainerWhereInput,
        orderBy: { id: "asc" },
        take,
        cursor: cursorId ? { id: cursorId } : undefined,
        skip: cursorId ? 1 : undefined,
        select: {
          id: true,
          bio: true,
          specialties: true,
          active: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { name: true, email: true, phone: true, role: true, status: true } },
          _count: { select: { members: true } },
        },
      })) as unknown as ExportRowMap["trainers"][]
  }
}

/** Fetch EVERY matching record for one category (no truncation). */
async function fetchAllRows(
  key: DataCategoryKey,
  args: BuildExportArgs
): Promise<AnyExportRow[]> {
  const all: AnyExportRow[] = []
  let cursorId: string | undefined
  for (;;) {
    const rows = await fetchBatch(key, args.organizationId, args.range, args.timeZone, cursorId)
    all.push(...rows)
    if (rows.length < EXPORT_BATCH_SIZE) break
    cursorId = rows[rows.length - 1].id
  }
  return all
}

// ---------------------------------------------------------------------------
// Summary metrics (aggregated, org-scoped, same filters as the sheets)
// ---------------------------------------------------------------------------

async function loadSummaryCounts(args: BuildExportArgs): Promise<SummaryCounts> {
  const { organizationId, range, timeZone } = args

  const byStatus = <T extends { status: string }>(
    rows: readonly T[]
  ): { [status: string]: number } =>
    rows.reduce<{ [status: string]: number }>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1
      return acc
    }, {})

  const memberRows = await prisma.member.groupBy({
    by: ["status"],
    where: exportScopeFilter("members", organizationId, range, timeZone) as Prisma.MemberWhereInput,
    _count: { _all: true },
  })
  const memberCounts = byStatus(memberRows)

  const membershipRows = await prisma.membership.groupBy({
    by: ["status"],
    where: exportScopeFilter("memberships", organizationId, range, timeZone) as Prisma.MembershipWhereInput,
    _count: { _all: true },
  })
  const membershipCounts = byStatus(membershipRows)

  const paymentRows = await prisma.payment.groupBy({
    by: ["status"],
    where: exportScopeFilter("payments", organizationId, range, timeZone) as Prisma.PaymentWhereInput,
    _count: { _all: true },
    _sum: { amountMinor: true },
  })
  const paymentCounts = byStatus(paymentRows)

  // Revenue rule: only RECORDED payments are money actually received.
  const collectedMinor = paymentRows.reduce(
    (sum, p) => (p.status === "RECORDED" ? sum + (p._sum.amountMinor ?? 0) : sum),
    0
  )

  const leadWhere = exportScopeFilter("leads", organizationId, range, timeZone) as Prisma.LeadWhereInput

  const [plans, attendance, leads, convertedLeads, appointments, tasks, qrSessions, leadActivities, trainers] =
    await Promise.all([
      prisma.membershipPlan.count({
        where: exportScopeFilter("plans", organizationId, range, timeZone) as Prisma.MembershipPlanWhereInput,
      }),
      prisma.checkIn.count({
        where: exportScopeFilter("attendance", organizationId, range, timeZone) as Prisma.CheckInWhereInput,
      }),
      prisma.lead.count({ where: leadWhere }),
      prisma.lead.count({ where: { ...leadWhere, stage: "CONVERTED" } }),
      prisma.appointment.count({
        where: exportScopeFilter("appointments", organizationId, range, timeZone) as Prisma.AppointmentWhereInput,
      }),
      prisma.task.count({
        where: exportScopeFilter("tasks", organizationId, range, timeZone) as Prisma.TaskWhereInput,
      }),
      prisma.qRSession.count({
        where: exportScopeFilter("qrSessions", organizationId, range, timeZone) as Prisma.QRSessionWhereInput,
      }),
      prisma.leadActivity.count({
        where: exportScopeFilter("leadActivities", organizationId, range, timeZone) as Prisma.LeadActivityWhereInput,
      }),
      prisma.trainer.count({
        where: exportScopeFilter("trainers", organizationId, range, timeZone) as Prisma.TrainerWhereInput,
      }),
    ])

  return {
    members: {
      active: memberCounts["ACTIVE"] ?? 0,
      inactive: memberCounts["INACTIVE"] ?? 0,
      archived: memberCounts["ARCHIVED"] ?? 0,
    },
    memberships: {
      active: membershipCounts["ACTIVE"] ?? 0,
      expired: membershipCounts["EXPIRED"] ?? 0,
      cancelled: membershipCounts["CANCELLED"] ?? 0,
      paused: membershipCounts["PAUSED"] ?? 0,
    },
    payments: {
      recorded: paymentCounts["RECORDED"] ?? 0,
      voided: paymentCounts["VOIDED"] ?? 0,
      refunded: paymentCounts["REFUNDED"] ?? 0,
    },
    collectedMinor,
    plans,
    attendance,
    leads,
    convertedLeads,
    appointments,
    tasks,
    qrSessions,
    leadActivities,
    trainers,
  }
}

// ---------------------------------------------------------------------------
// Member Financial Summary aggregation
// ---------------------------------------------------------------------------

async function loadFinancialAggregation(args: BuildExportArgs): Promise<{
  rows: ReturnType<typeof buildMemberFinancialRows>
} | null> {
  const selected = new Set(args.categories)
  const hasFinancial = FINANCIAL_CATEGORIES.some((key) => selected.has(key))
  if (!hasFinancial) return null

  const { organizationId, range, timeZone } = args
  const memberFilter = exportScopeFilter("members", organizationId, range, timeZone) as Prisma.MemberWhereInput
  const membershipFilter = exportScopeFilter("memberships", organizationId, range, timeZone) as Prisma.MembershipWhereInput
  const paymentFilter = exportScopeFilter("payments", organizationId, range, timeZone) as Prisma.PaymentWhereInput

  const ids = new Set<string>()

  if (selected.has("members")) {
    const rows = await prisma.member.findMany({ where: memberFilter, select: { id: true } })
    for (const r of rows) ids.add(r.id)
  }
  if (selected.has("memberships")) {
    const rows = await prisma.membership.findMany({
      where: membershipFilter,
      select: { memberId: true },
      distinct: ["memberId"],
    })
    for (const r of rows) ids.add(r.memberId)
  }
  if (selected.has("payments")) {
    const rows = await prisma.payment.findMany({
      where: paymentFilter,
      select: { memberId: true },
      distinct: ["memberId"],
    })
    for (const r of rows) ids.add(r.memberId)
  }

  if (ids.size === 0) return null

  const idList = [...ids]
  const memberRows = await prisma.member.findMany({
    where: { organizationId, id: { in: idList } },
    select: { id: true, firstName: true, lastName: true, memberCode: true },
  })
  const memberNames = new Map<string, string>()
  const memberCodes = new Map<string, string | null>()
  for (const m of memberRows) {
    memberNames.set(m.id, `${m.firstName} ${m.lastName}`.trim())
    memberCodes.set(m.id, m.memberCode)
  }

  const memberships = (await prisma.membership.findMany({
    where: { organizationId, memberId: { in: idList } },
    select: {
      id: true,
      memberId: true,
      status: true,
      startDate: true,
      endDate: true,
      amountMinor: true,
      plan: { select: { name: true } },
    },
  })) as unknown as FinancialMembershipRow[]

  const payments = (await prisma.payment.findMany({
    where: { ...paymentFilter, memberId: { in: idList } },
    select: {
      id: true,
      memberId: true,
      amountMinor: true,
      method: true,
      status: true,
      paymentDate: true,
    },
  })) as unknown as FinancialPaymentRow[]

  const rows = buildMemberFinancialRows({
    memberNames,
    memberCodes,
    memberships,
    payments,
    membershipRange: range.mode === "custom" ? { fromKey: range.fromKey, toKey: range.toKey } : null,
    timeZone,
  })

  if (rows.length === 0) return null
  return { rows }
}

// ---------------------------------------------------------------------------
// Workbook entry point
// ---------------------------------------------------------------------------

/**
 * Build the complete, clickable .xlsx workbook for the selected categories and
 * date range. Returns the tenant-scoped filename for the download.
 */
export async function buildExportWorkbook(args: BuildExportArgs): Promise<WorkbookBuildResult> {
  const selected = new Set(args.categories)

  // Fetch every record per selected module (batched, never truncated).
  const sheets: WorkbookSheetData[] = []
  for (const key of EXPORT_SHEET_ORDER) {
    if (!selected.has(key)) continue
    const rows = await fetchAllRows(key, args)
    if (rows.length > 0) sheets.push({ key, rows })
  }

  const counts = await loadSummaryCounts(args)
  const financial = await loadFinancialAggregation(args)

  // Balances are ALL-TIME and org-scoped (a pending balance is a live
  // snapshot, not range-restricted). Computed once from RECORDED payments and
  // used to enrich the Memberships sheet so Plan - Paid = Pending holds right
  // next to the membership rows that own them.
  const membershipSheet = sheets.find((s) => s.key === "memberships")
  if (membershipSheet) {
    const orgPayments = await prisma.payment.findMany({
      where: { organizationId: args.organizationId },
      select: { membershipId: true, amountMinor: true, status: true },
    })

    const totals = buildOutstandingTotals(orgPayments)
    for (const row of membershipSheet.rows as ExportRowMap["memberships"][]) {
      const paidMinor = totals.get(row.id)?.paidMinor ?? 0
      const balance = outstandingOfMembership({
        row,
        paidMinor,
        timeZone: args.timeZone,
      })
      row._finance = {
        paidMinor,
        outstandingMinor: balance.outstandingMinor,
        expectedPaymentKey: balance.expectedPaymentKey,
        status: balance.status,
      }
    }
  }

  return buildWorkbookFile({
    gymName: args.gymName,
    categories: args.categories,
    range: args.range,
    timeZone: args.timeZone,
    generatedAt: new Date(),
    counts,
    sheets,
    financialRows: financial?.rows ?? [],
  })
}