import { NextResponse, type NextRequest } from "next/server"

import { requireUserOrThrow, type SessionUser } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { getBranchFilter } from "@/lib/branches"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import { dataExportSchema } from "@/lib/validators"
import { buildExportWorkbook } from "@/lib/services/data-export"

export const dynamic = "force-dynamic"

/**
 * POST /api/data/export → binary .xlsx workbook.
 *
 * A Route Handler (not a server action) so the response is a real file
 * download the browser can save directly, without server-action body-size
 * limits. Auth + permission are re-checked here server-side; the workbook is
 * scoped entirely to user.organizationId from the session and then narrowed to
 * the requester's branch scope (a fail-closed scope exports nothing).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let user: SessionUser
  try {
    user = await requireUserOrThrow()
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!can(user, "settings:manage")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = dataExportSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
  }

  const { categories, dateRange } = parsed.data
  const branchFilter = await getBranchFilter()

  try {
    const { buffer, filename } = await buildExportWorkbook({
      organizationId: user.organizationId,
      gymName: user.organization.name,
      categories,
      range: dateRange,
      timeZone: user.organization.timezone,
      branchFilter,
    })

    await writeAudit({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: AUDIT_ACTIONS.DATA_EXPORTED,
      entityType: "OrganizationData",
      after: { categories, range: dateRange },
    })

    const headers = new Headers()
    headers.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    headers.set("X-Export-Filename", filename)
    headers.set("Cache-Control", "no-store")

    return new NextResponse(buffer, { status: 200, headers })
  } catch {
    return NextResponse.json({ error: "Export failed" }, { status: 500 })
  }
}