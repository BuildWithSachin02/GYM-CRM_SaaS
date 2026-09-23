import type { Metadata } from "next"

import { requireUser } from "@/lib/auth/auth"
import { resolveReportRange } from "@/lib/analytics-core"
import { dayKeyInTimeZone } from "@/lib/memberships"
import { getReportsData } from "@/lib/domain/reports"
import { getOutstandingDuesRows, getOutstandingOverview } from "@/lib/domain/outstanding"
import { ReportsPage } from "@/components/reports/reports-page"

export const metadata: Metadata = {
  title: "Reports",
}

type SearchParams = Promise<{
  range?: string
  from?: string
  to?: string
}>

export default async function ReportsServerPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await requireUser()
  const params = await searchParams

  const query = resolveReportRange({
    range: params.range,
    from: params.from,
    to: params.to,
    todayKey: dayKeyInTimeZone(new Date(), user.organization.timezone),
  })
  const data = await getReportsData(user.organizationId, user.organization.timezone, query)

  // Outstanding is an all-time balance snapshot (not range-restricted): how
  // much is still owed across every tracked membership right now.
  const [overview, duesRows] = await Promise.all([
    getOutstandingOverview(user.organizationId, user.organization.timezone),
    getOutstandingDuesRows(user.organizationId, user.organization.timezone),
  ])

  return <ReportsPage data={data} dues={{ overview, rows: duesRows }} />
}
