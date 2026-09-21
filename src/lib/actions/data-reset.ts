"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"

import { requireUserOrThrow } from "@/lib/auth/auth"
import { verifyPassword } from "@/lib/auth/password"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { matchesResetPhrase, RESET_CONFIRM_PHRASE } from "@/lib/data-catalog"
import {
  dataResetExecuteSchema,
  dataResetPreviewSchema,
  type DataResetExecuteInput,
  type DataResetPreviewInput,
} from "@/lib/validators"
import {
  executeReset,
  previewReset,
  type ResetPreview,
  type ResetPreviewCategory,
} from "@/lib/services/data-reset"

/**
 * Server actions for the Settings → Data tab.
 *
 * Both actions re-resolve the session server-side, re-assert settings:manage,
 * and scope every query to user.organizationId. The client could never fool
 * these into touching another tenant.
 */

export type DataPreviewActionResult =
  | { success: true; data: ResetPreview }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

export type DataResetExecuteActionResult =
  | { success: true; data: { deleted: number; categories: ResetPreviewCategory[] } }
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

/** Preview how many records a reset would delete (before any confirmation). */
export async function previewDataResetAction(
  input: DataResetPreviewInput
): Promise<DataPreviewActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "settings:manage")) return { success: false, error: "Not authorized" }

  const parsed = dataResetPreviewSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  const preview = await previewReset({
    organizationId: user.organizationId,
    categoryKeys: parsed.data.categories,
    range: parsed.data.dateRange,
    timeZone: user.organization.timezone,
  })

  return { success: true, data: preview }
}

/**
 * Execute the reset. Requires the typed confirmation phrase AND the current
 * user password, both re-checked here (never just in the UI). The actual
 * deletion runs in a single transaction in the service layer.
 */
export async function executeDataResetAction(
  input: DataResetExecuteInput
): Promise<DataResetExecuteActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "settings:manage")) return { success: false, error: "Not authorized" }

  const parsed = dataResetExecuteSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  if (!matchesResetPhrase(parsed.data.confirmPhrase)) {
    return {
      success: false,
      error: "Confirmation phrase does not match",
      fieldErrors: { confirmPhrase: [`Type ${RESET_CONFIRM_PHRASE} exactly to confirm`] },
    }
  }

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  })
  if (!account || !(await verifyPassword(parsed.data.password, account.passwordHash))) {
    return {
      success: false,
      error: "Incorrect password",
      fieldErrors: { password: ["Incorrect password"] },
    }
  }

  const result = await executeReset({
    organizationId: user.organizationId,
    categoryKeys: parsed.data.categories,
    range: parsed.data.dateRange,
    timeZone: user.organization.timezone,
    actorUserId: user.id,
  })

  revalidatePath("/dashboard", "layout")
  return { success: true, data: result }
}