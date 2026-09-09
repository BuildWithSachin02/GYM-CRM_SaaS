"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import {
  membershipCreateSchema,
  membershipRenewSchema,
  type MembershipCreateInput,
  type MembershipRenewInput,
} from "@/lib/validators"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"

export type MembershipActionResult =
  | { success: true; data: { id: string } }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

function toFieldErrors(
  issues: Array<{ path: PropertyKey[]; message: string }>
): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of issues) {
    const key = issue.path.filter((p): p is string | number => typeof p === "string" || typeof p === "number").join(".")
    if (!fieldErrors[key]) fieldErrors[key] = []
    fieldErrors[key].push(issue.message)
  }
  return fieldErrors
}

export async function createMembership(
  input: MembershipCreateInput
): Promise<MembershipActionResult> {
  const user = await requireUserOrThrow()

  const parsed = membershipCreateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: toFieldErrors(parsed.error.issues),
    }
  }

  const data = parsed.data
  const endDate = new Date(data.startDate)
  endDate.setDate(endDate.getDate() + data.durationDays)

  const membership = await prisma.membership.create({
    data: {
      organizationId: user.organizationId,
      memberId: data.memberId,
      planId: data.planId,
      startDate: data.startDate,
      endDate,
      amountMinor: data.amountMinor,
      status: "ACTIVE",
      notes: data.notes ?? null,
    },
    select: { id: true },
  })

  await prisma.payment.create({
    data: {
      organizationId: user.organizationId,
      memberId: data.memberId,
      membershipId: membership.id,
      amountMinor: data.amountMinor,
      method: data.method,
      status: "RECORDED",
      recordedById: user.id,
      notes: data.notes ?? null,
    },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.MEMBERSHIP_CREATED,
    entityType: "Membership",
    entityId: membership.id,
    after: { ...data, id: membership.id, endDate: endDate.toISOString() },
  })

  revalidatePath("/dashboard/memberships")

  return { success: true, data: { id: membership.id } }
}

export async function renewMembership(
  input: MembershipRenewInput
): Promise<MembershipActionResult> {
  const user = await requireUserOrThrow()

  const parsed = membershipRenewSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: toFieldErrors(parsed.error.issues),
    }
  }

  const data = parsed.data

  const existing = await prisma.membership.findFirst({
    where: { id: data.membershipId, organizationId: user.organizationId },
    select: { id: true, memberId: true, status: true },
  })

  if (!existing) {
    return { success: false, error: "Membership not found" }
  }

  const endDate = new Date(data.startDate)
  endDate.setDate(endDate.getDate() + data.durationDays)

  await prisma.membership.update({
    where: { id: data.membershipId },
    data: { status: "EXPIRED" },
  })

  const newMembership = await prisma.membership.create({
    data: {
      organizationId: user.organizationId,
      memberId: existing.memberId,
      planId: data.planId,
      startDate: data.startDate,
      endDate,
      amountMinor: data.amountMinor,
      status: "ACTIVE",
      notes: data.notes ?? null,
    },
    select: { id: true },
  })

  await prisma.payment.create({
    data: {
      organizationId: user.organizationId,
      memberId: existing.memberId,
      membershipId: newMembership.id,
      amountMinor: data.amountMinor,
      method: data.method,
      status: "RECORDED",
      recordedById: user.id,
      notes: data.notes ?? null,
    },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.MEMBERSHIP_RENEWED,
    entityType: "Membership",
    entityId: newMembership.id,
    before: { oldMembershipId: data.membershipId, oldStatus: existing.status },
    after: { id: newMembership.id, endDate: endDate.toISOString() },
  })

  revalidatePath("/dashboard/memberships")

  return { success: true, data: { id: newMembership.id } }
}

export async function cancelMembership(
  membershipId: string
): Promise<MembershipActionResult> {
  const user = await requireUserOrThrow()

  const existing = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId: user.organizationId },
    select: { id: true, status: true },
  })

  if (!existing) {
    return { success: false, error: "Membership not found" }
  }

  const updated = await prisma.membership.update({
    where: { id: membershipId },
    data: { status: "CANCELLED" },
    select: { id: true },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.MEMBERSHIP_CANCELLED,
    entityType: "Membership",
    entityId: membershipId,
    before: { status: existing.status },
    after: { status: "CANCELLED" },
  })

  revalidatePath("/dashboard/memberships")

  return { success: true, data: { id: updated.id } }
}

export async function pauseMembership(
  membershipId: string
): Promise<MembershipActionResult> {
  const user = await requireUserOrThrow()

  const existing = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId: user.organizationId },
    select: { id: true, status: true },
  })

  if (!existing) {
    return { success: false, error: "Membership not found" }
  }

  if (existing.status !== "ACTIVE") {
    return { success: false, error: "Only active memberships can be paused" }
  }

  const updated = await prisma.membership.update({
    where: { id: membershipId },
    data: { status: "PAUSED" },
    select: { id: true },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: "membership.paused",
    entityType: "Membership",
    entityId: membershipId,
    before: { status: existing.status },
    after: { status: "PAUSED" },
  })

  revalidatePath("/dashboard/memberships")

  return { success: true, data: { id: updated.id } }
}
