import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { resolveReportRange } from "@/lib/analytics-core"
import { dayKeyInTimeZone } from "@/lib/memberships"
import { getReportsData } from "@/lib/domain/reports"
import { getOutstandingDuesRows, getOutstandingOverview } from "@/lib/domain/outstanding"
import { getBranchFilterForRequest, requireBranchAccess } from "@/lib/branches"
import { ReportsPage } from "@/components/reports/reports-page"

export const metadata: Metadata = {
  title: "Reports",
}

type SearchParams = Promise<{
  range?: string
  from?: string
  to?: string
  /** Explicit branch context from a Branches quick link (server-validated). */
  branch?: string
}>

export default async function ReportsServerPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await requireUser()
  if (!can(user, "reports:view")) notFound()
  await requireBranchAccess()
  const params = await searchParams
  const branchFilter = await getBranchFilterForRequest(params.branch)

  const query = resolveReportRange({
    range: params.range,
    from: params.from,
    to: params.to,
    todayKey: dayKeyInTimeZone(new Date(), user.organization.timezone),
  })
  const data = await getReportsData(
    user.organizationId,
    user.organization.timezone,
    query,
    branchFilter
  )

  // Outstanding is an all-time balance snapshot (not range-restricted): how
  // much is still owed across every tracked membership right now.
  const [overview, duesRows] = await Promise.all([
    getOutstandingOverview(user.organizationId, user.organization.timezone, branchFilter),
    getOutstandingDuesRows(user.organizationId, user.organization.timezone, branchFilter),
  ])

  return <ReportsPage data={data} dues={{ overview, rows: duesRows }} />
}
