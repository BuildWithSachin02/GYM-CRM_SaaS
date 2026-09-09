import type { Metadata } from "next"

import { requireUser } from "@/lib/auth/auth"
import { getReportsData } from "@/lib/domain/reports"
import { ReportsPage } from "@/components/reports/reports-page"

export const metadata: Metadata = {
  title: "Reports",
}

type SearchParams = Promise<{
  range?: string
}>

export default async function ReportsServerPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await requireUser()
  const params = await searchParams

  const range = params.range === "90" ? "90" : "30"
  const data = await getReportsData(user.organizationId, range)

  return <ReportsPage data={data} />
}
