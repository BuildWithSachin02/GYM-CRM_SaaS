"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { planFormSchema, type PlanInput } from "@/lib/validators"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import type { PlanInterval } from "@prisma/client"

export type PlanActionResult =
  | { success: true; data: { id: string } }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

export async function createPlan(input: PlanInput): Promise<PlanActionResult> {
  const user = await requireUserOrThrow()

  const parsed = planFormSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {}
    parsed.error.issues.forEach((issue) => {
      const key = issue.path.join(".")
      if (!fieldErrors[key]) fieldErrors[key] = []
      fieldErrors[key].push(issue.message)
    })
    return { success: false, error: "Validation failed", fieldErrors }
  }

  const data = parsed.data

  const plan = await prisma.membershipPlan.create({
    data: {
      organizationId: user.organizationId,
      name: data.name,
      billingInterval: data.billingInterval as PlanInterval,
      priceMinor: data.priceMinor,
      currency: data.currency,
      durationDays: data.durationDays,
      description: data.description ?? null,
      active: data.active,
    },
    select: { id: true },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.PLAN_CREATED,
    entityType: "MembershipPlan",
    entityId: plan.id,
    after: { ...data, id: plan.id },
  })

  revalidatePath("/dashboard/plans")

  return { success: true, data: { id: plan.id } }
}

export async function updatePlan(
  planId: string,
  input: PlanInput
): Promise<PlanActionResult> {
  const user = await requireUserOrThrow()

  const parsed = planFormSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {}
    parsed.error.issues.forEach((issue) => {
      const key = issue.path.join(".")
      if (!fieldErrors[key]) fieldErrors[key] = []
      fieldErrors[key].push(issue.message)
    })
    return { success: false, error: "Validation failed", fieldErrors }
  }

  const existing = await prisma.membershipPlan.findFirst({
    where: { id: planId, organizationId: user.organizationId },
    select: { id: true },
  })

  if (!existing) {
    return { success: false, error: "Plan not found" }
  }

  const data = parsed.data

  const updated = await prisma.membershipPlan.update({
    where: { id: planId },
    data: {
      name: data.name,
      billingInterval: data.billingInterval as PlanInterval,
      priceMinor: data.priceMinor,
      currency: data.currency,
      durationDays: data.durationDays,
      description: data.description ?? null,
      active: data.active,
    },
    select: { id: true },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.PLAN_UPDATED,
    entityType: "MembershipPlan",
    entityId: updated.id,
    after: { ...data, id: updated.id },
  })

  revalidatePath("/dashboard/plans")

  return { success: true, data: { id: updated.id } }
}

export async function archivePlan(planId: string): Promise<PlanActionResult> {
  const user = await requireUserOrThrow()

  const existing = await prisma.membershipPlan.findFirst({
    where: { id: planId, organizationId: user.organizationId },
    select: { id: true, name: true, active: true },
  })

  if (!existing) {
    return { success: false, error: "Plan not found" }
  }

  const updated = await prisma.membershipPlan.update({
    where: { id: planId },
    data: { active: !existing.active },
    select: { id: true },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.PLAN_UPDATED,
    entityType: "MembershipPlan",
    entityId: updated.id,
    before: { name: existing.name, active: existing.active },
    after: { name: existing.name, active: !existing.active },
  })

  revalidatePath("/dashboard/plans")

  return { success: true, data: { id: updated.id } }
}
