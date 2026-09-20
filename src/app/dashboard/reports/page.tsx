import type { Metadata } from "next"

import { requireUser } from "@/lib/auth/auth"
import { resolveReportRange } from "@/lib/analytics-core"
import { dayKeyInTimeZone } from "@/lib/memberships"
import { getReportsData } from "@/lib/domain/reports"
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

  return <ReportsPage data={data} />
}
