"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import { orgSettingsSchema } from "@/lib/validators"
import type { OrgSettingsInput } from "@/lib/validators"

// Staff/user management lives in src/lib/actions/users.ts under the dedicated
// "Users & Access" settings screen (roles, deactivation, passwords, per-user
// permissions). Nothing staff-related lives here anymore.

type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

function buildFieldErrors(error: unknown): Record<string, string[]> | undefined {
  if (!(error instanceof ZodError)) return undefined
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const key = issue.path.join(".")
    if (!fieldErrors[key]) fieldErrors[key] = []
    fieldErrors[key].push(issue.message)
  }
  return fieldErrors
}

export async function updateOrgSettings(input: OrgSettingsInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "settings:manage")) return { success: false, error: "Not authorized" }

  const parsed = orgSettingsSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  const { name, phone, email, address, city, state, country, timezone } = parsed.data

  const org = await prisma.organization.update({
    where: { id: user.organizationId },
    data: {
      name,
      phone,
      email,
      address,
      city,
      state,
      country,
      timezone,
    },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.ORG_UPDATED,
    entityType: "Organization",
    entityId: org.id,
    after: { name, phone, email, address, city, state, country, timezone },
  })

  revalidatePath("/dashboard/settings")
  return { success: true }
}
