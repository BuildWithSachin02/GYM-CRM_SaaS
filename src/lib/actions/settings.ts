"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { hashPassword } from "@/lib/auth/password"
import { can } from "@/lib/permissions"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import { orgSettingsSchema, staffSchema, staffUpdateSchema } from "@/lib/validators"
import type { OrgSettingsInput, StaffInput, StaffUpdateInput } from "@/lib/validators"

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

  revalidatePath("/settings")
  return { success: true }
}

export async function createStaff(input: StaffInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "staff:manage")) return { success: false, error: "Not authorized" }

  const parsed = staffSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  const { name, email, phone, role, password } = parsed.data

  const existing = await prisma.user.findFirst({
    where: { organizationId: user.organizationId, email },
  })
  if (existing) {
    return {
      success: false,
      error: "A user with this email already exists in your organization",
      fieldErrors: { email: ["Email already in use"] },
    }
  }

  const passwordHash = await hashPassword(password)

  const staff = await prisma.user.create({
    data: {
      organizationId: user.organizationId,
      name,
      email,
      phone,
      role,
      passwordHash,
      status: "ACTIVE",
    },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.STAFF_CREATED,
    entityType: "User",
    entityId: staff.id,
    after: { name, email, phone, role },
  })

  revalidatePath("/settings")
  return { success: true }
}

export async function updateStaff(staffId: string, input: StaffUpdateInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "staff:manage")) return { success: false, error: "Not authorized" }

  const parsed = staffUpdateSchema.safeParse({ ...input, staffId })
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  const { name, phone, role, status, password } = parsed.data

  const existing = await prisma.user.findFirst({
    where: { id: staffId, organizationId: user.organizationId },
  })
  if (!existing) return { success: false, error: "Staff member not found" }

  const data: {
    name: string
    phone: string | null
    role: "OWNER" | "ADMIN" | "RECEPTIONIST" | "TRAINER"
    status: "ACTIVE" | "DEACTIVATED"
    passwordHash?: string
  } = { name, phone, role, status }

  if (password) {
    data.passwordHash = await hashPassword(password)
  }

  await prisma.user.update({ where: { id: staffId }, data })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.STAFF_UPDATED,
    entityType: "User",
    entityId: staffId,
    after: { name, phone, role, status, passwordChanged: !!password },
  })

  revalidatePath("/settings")
  return { success: true }
}
