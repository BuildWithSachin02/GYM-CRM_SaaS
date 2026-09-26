import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { getBranchFilterForRequest, requireBranchAccess } from "@/lib/branches"
import { branchFilterWhere, branchFilterWhereRequired } from "@/lib/branch-scope"
import type { Prisma } from "@prisma/client"
import { getOutstandingDuesRows } from "@/lib/domain/outstanding"
import { matchesDuesSearch } from "@/lib/outstanding"

import { PaymentList } from "@/components/payments/payment-list"

export const metadata: Metadata = {
  title: "Payments",
}

const PAGE_SIZE = 25

const DUE_STATUSES = new Set(["PENDING", "OVERDUE"])

type SearchParams = Promise<{
  q?: string
  method?: string
  from?: string
  to?: string
  page?: string
  dueStatus?: string
  /** Explicit branch context from a Branches quick link (server-validated). */
  branch?: string
}>

/**
 * The Payments page has two distinct views sharing one URL:
 *
 *   1. PAYMENT HISTORY (no `dueStatus`, or `dueStatus=ALL`): every recorded
 *      Payment row — unchanged. Search by member name/member code, method,
 *      and payment-date range apply here.
 *
 *   2. PENDING / OVERDUE DUES (`dueStatus=PENDING|OVERDUE`): the canonical
 *      outstanding ledger (`getOutstandingDuesRows` — the same source as the
 *      dashboard "Pending dues" widget). A membership that still has an
 *      unpaid balance shows here EVEN IF it has no Payment rows yet: a balance
 *      is derived from membership price − RECORDED payments, never from a
 *      Payment row existing. Method/date filters do not apply to a balance.
 *
 * The dues view must never invent Payment rows, and a balance never counts as
 * revenue — this page only lists balances; money received is recorded through
 * the existing Record Payment workflow.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await requireUser()
  if (!can(user, "payments:view")) notFound()
  await requireBranchAccess()
  const params = await searchParams
  const branchFilter = await getBranchFilterForRequest(params.branch)
  const branchClause = branchFilterWhereRequired(branchFilter)
  const memberBranchClause = branchFilterWhere(branchFilter, "homeBranchId")

  const q = params.q?.trim() || ""
  const methodFilter = params.method?.trim() || ""
  const fromDate = params.from?.trim() || ""
  const toDate = params.to?.trim() || ""
  const rawDueStatus = params.dueStatus?.trim().toUpperCase() || ""
  const dueStatus = DUE_STATUSES.has(rawDueStatus) ? rawDueStatus : ""

  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1)
  const skip = (page - 1) * PAGE_SIZE

  // Members for the Record Payment form (org-scoped, session-resolved). In
  // dues mode inactive-but-not-archived members are included so a real
  // outstanding balance can still be settled; history mode keeps the existing
  // ACTIVE-only picker.
  const memberWhere: Prisma.MemberWhereInput = dueStatus
    ? {
        organizationId: user.organizationId,
        deletedAt: null,
        ...memberBranchClause,
      }
    : {
        organizationId: user.organizationId,
        deletedAt: null,
        status: "ACTIVE",
        ...memberBranchClause,
      }

  const [members, paymentTotals, duesRows] = await Promise.all([
    prisma.member.findMany({
      where: memberWhere,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        memberCode: true,
        memberships: {
          where: { status: { not: "CANCELLED" }, ...branchClause },
          orderBy: [{ endDate: "desc" }],
          select: {
            id: true,
            startDate: true,
            endDate: true,
            amountMinor: true,
            status: true,
            expectedPaymentDate: true,
            plan: { select: { name: true, priceMinor: true } },
          },
        },
      },
    }),
    // RECORDED-only sums per membership so the payment form can show the
    // remaining balance (VOIDED/REFUNDED never count — same rule as the
    // outstanding ledger).
    prisma.payment.groupBy({
      by: ["membershipId"],
      where: {
        organizationId: user.organizationId,
        status: "RECORDED",
        membershipId: { not: null },
        ...branchClause,
      },
      _sum: { amountMinor: true },
    }),
    dueStatus
      ? getOutstandingDuesRows(
          user.organizationId,
          user.organization.timezone,
          branchFilter
        )
      : Promise.resolve([] as Awaited<ReturnType<typeof getOutstandingDuesRows>>),
  ])

  const paidByMembership = new Map(
    paymentTotals
      .filter((r) => r.membershipId)
      .map((r) => [r.membershipId as string, r._sum.amountMinor ?? 0])
  )

  // ---- Dues view (PENDING / OVERDUE) -------------------------------------
  // Canonical ledger rows already carry member + plan identity, balances and
  // statuses; here we only narrow by status + search and paginate. Search runs
  // against member name and the display-only Member Code.
  const ledgerRows = dueStatus
    ? duesRows.filter((r) => r.status === dueStatus && matchesDuesSearch(r, q))
    : []
  const duesTotal = ledgerRows.length
  const duesTotalPages = Math.ceil(duesTotal / PAGE_SIZE)

  // ---- Payment history view (default) -------------------------------------
  // Top level has no `OR` of its own (the search OR lives inside the nested
  // member filter), so the branch clause spreads in as-is.
  const where: Record<string, unknown> = {
    organizationId: user.organizationId,
    ...branchClause,
  }

  if (q) {
    where.member = {
      is: {
        organizationId: user.organizationId,
        deletedAt: null,
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { memberCode: { contains: q, mode: "insensitive" } },
        ],
      },
    }
  }

  if (methodFilter && ["CASH", "UPI", "CARD", "BANK_TRANSFER"].includes(methodFilter)) {
    where.method = methodFilter
  }

  if (fromDate) {
    const from = new Date(fromDate)
    if (!Number.isNaN(from.getTime())) {
      where.paymentDate = { ...(where.paymentDate as object), gte: from }
    }
  }

  if (toDate) {
    const to = new Date(toDate)
    if (!Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999)
      where.paymentDate = { ...(where.paymentDate as object), lte: to }
    }
  }

  const [payments, totalCount] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { paymentDate: "desc" },
      skip,
      take: PAGE_SIZE,
      select: {
        id: true,
        amountMinor: true,
        method: true,
        status: true,
        reference: true,
        paymentDate: true,
        createdAt: true,
        member: {
          select: { id: true, firstName: true, lastName: true, phone: true, memberCode: true },
        },
        membership: {
          select: {
            id: true,
            startDate: true,
            endDate: true,
            plan: { select: { name: true } },
          },
        },
        recordedBy: {
          select: { name: true },
        },
      },
    }),
    dueStatus
      ? Promise.resolve(0)
      : prisma.payment.count({ where }),
  ])

  const serializedPayments = payments.map((p) => ({
    ...p,
    paymentDate: p.paymentDate.toISOString(),
    createdAt: p.createdAt.toISOString(),
    membership: p.membership
      ? {
          ...p.membership,
          startDate: p.membership.startDate.toISOString(),
          endDate: p.membership.endDate.toISOString(),
        }
      : null,
  }))

  const serializedMembers = members.map((m) => ({
    ...m,
    memberships: m.memberships.map((ms) => ({
      ...ms,
      startDate: ms.startDate.toISOString(),
      endDate: ms.endDate.toISOString(),
      expectedPaymentDate: ms.expectedPaymentDate?.toISOString() ?? null,
      paidMinor: paidByMembership.get(ms.id) ?? 0,
      outstandingMinor: ms.amountMinor - (paidByMembership.get(ms.id) ?? 0),
    })),
  }))

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <PaymentList
      payments={serializedPayments}
      totalCount={totalCount}
      totalPages={totalPages}
      filters={{ q, method: methodFilter, from: fromDate, to: toDate, page, dueStatus }}
      canCreate={can(user, "payments:record")}
      members={serializedMembers}
      dues={
        dueStatus
          ? {
              rows: ledgerRows.slice(skip, skip + PAGE_SIZE),
              totalCount: duesTotal,
              totalPages: duesTotalPages,
            }
          : undefined
      }
    />
  )
}