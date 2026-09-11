"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { BusinessRuleError } from "@/lib/errors"
import { formatDate } from "@/lib/format"
import {
  membershipCreateSchema,
  membershipRenewSchema,
  type MembershipCreateInput,
  type MembershipRenewInput,
} from "@/lib/validators"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import {
  addDurationDays,
  canRenewLifecycle,
  dayKeyInTimeZone,
  earliestRenewalStartKey,
  findOverlappingActiveMembership,
  getMembershipLifecycle,
  RENEWAL_WARNING_DAYS,
} from "@/lib/memberships"

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
  if (!can(user, "memberships:manage")) {
    return { success: false, error: "Not authorized" }
  }

  const parsed = membershipCreateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: toFieldErrors(parsed.error.issues),
    }
  }

  const data = parsed.data

  const [member, plan] = await Promise.all([
    prisma.member.findFirst({
      where: { id: data.memberId, organizationId: user.organizationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.membershipPlan.findFirst({
      where: { id: data.planId, organizationId: user.organizationId, active: true },
      select: { id: true, name: true, durationDays: true },
    }),
  ])

  if (!member) return { success: false, error: "Member not found" }
  if (!plan) return { success: false, error: "Selected plan is not available for your gym" }

  const endDate = addDurationDays(data.startDate, plan.durationDays)

  try {
    const membershipId = await prisma.$transaction(async (tx) => {
      // Serialize concurrent submissions for the same member, then re-check
      // overlap inside the transaction so two redirect requests cannot both
      // create overlapping active memberships.
      await tx.$queryRaw`SELECT 1 FROM "Member" WHERE "id" = ${data.memberId} FOR UPDATE`

      const overlap = await findOverlappingActiveMembership(
        tx,
        user.organizationId,
        data.memberId,
        data.startDate,
        endDate
      )
      if (overlap) {
        throw new BusinessRuleError(
          `This member already has an active membership (${overlap.plan.name}, ${formatDate(
            overlap.startDate
          )} – ${formatDate(overlap.endDate)}) that overlaps this period. Use "Renew" on that membership, or choose a non-overlapping start date.`
        )
      }

      // Close any ACTIVE memberships that already ended before this new period.
      await tx.membership.updateMany({
        where: {
          organizationId: user.organizationId,
          memberId: data.memberId,
          status: "ACTIVE",
          endDate: { lt: data.startDate },
        },
        data: { status: "EXPIRED" },
      })

      const membership = await tx.membership.create({
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

      await tx.payment.create({
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

      return membership.id
    })

    await writeAudit({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: AUDIT_ACTIONS.MEMBERSHIP_CREATED,
      entityType: "Membership",
      entityId: membershipId,
      after: { ...data, id: membershipId, endDate: endDate.toISOString() },
    })

    revalidatePath("/dashboard/memberships")
    revalidatePath(`/dashboard/members/${data.memberId}`)

    return { success: true, data: { id: membershipId } }
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return { success: false, error: error.message }
    }
    throw error
  }
}

export async function renewMembership(
  input: MembershipRenewInput
): Promise<MembershipActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "memberships:manage")) {
    return { success: false, error: "Not authorized" }
  }

  const parsed = membershipRenewSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: toFieldErrors(parsed.error.issues),
    }
  }

  const data = parsed.data
  const timeZone = user.organization.timezone

  const existing = await prisma.membership.findFirst({
    where: { id: data.membershipId, organizationId: user.organizationId },
    select: {
      id: true,
      memberId: true,
      status: true,
      startDate: true,
      endDate: true,
    },
  })

  if (!existing) {
    return { success: false, error: "Membership not found" }
  }

  const plan = await prisma.membershipPlan.findFirst({
    where: { id: data.planId, organizationId: user.organizationId, active: true },
    select: { id: true, name: true, durationDays: true },
  })
  if (!plan) {
    return { success: false, error: "Selected plan is not available for your gym" }
  }

  // Derive the business state. Only EXPIRED and EXPIRING_SOON memberships can
  // be renewed: ACTIVE ones are too far from expiry, UPCOMING ones have not
  // started, PAUSED/CANCELLED ones are not eligible.
  const lifecycle = getMembershipLifecycle({
    startDate: existing.startDate,
    endDate: existing.endDate,
    status: existing.status,
    timeZone,
  })

  if (!canRenewLifecycle(lifecycle.status)) {
    if (lifecycle.status === "CANCELLED") {
      return { success: false, error: "Cancelled memberships cannot be renewed" }
    }
    if (lifecycle.status === "PAUSED") {
      return { success: false, error: "Paused memberships cannot be renewed" }
    }
    if (lifecycle.status === "UPCOMING") {
      return {
        success: false,
        error: "This membership has not started yet. It can be renewed only once it is active.",
      }
    }
    return {
      success: false,
      error: `This membership is active with more than ${RENEWAL_WARNING_DAYS} days left. Renew it within ${RENEWAL_WARNING_DAYS} days of the end date.`,
    }
  }

  // Renewal start-date rules (see earliestRenewalStartKey):
  //  - EXPIRED: renew from today (RENEWAL_AFTER_EXPIRY_DAYS = 0) — never from a
  //    past date.
  //  - EXPIRING_SOON: renew only after the current period ends (no overlap with
  //    the membership being renewed).
  const todayKey = dayKeyInTimeZone(new Date(), timeZone)
  const startKey = dayKeyInTimeZone(data.startDate, timeZone)
  const endKeyOfExisting = dayKeyInTimeZone(existing.endDate, timeZone)
  const earliestStartKey = earliestRenewalStartKey(
    lifecycle.status,
    endKeyOfExisting,
    todayKey
  )

  if (startKey < earliestStartKey) {
    if (lifecycle.status === "EXPIRED") {
      return {
        success: false,
        error: "An expired membership must renew from today or later (past dates are not allowed).",
      }
    }
    return {
      success: false,
      error: `Renewal must begin after the current membership ends on ${formatDate(
        existing.endDate
      )} (back-to-back periods are allowed).`,
    }
  }

  const endDate = addDurationDays(data.startDate, plan.durationDays)

  try {
    const newMembershipId = await prisma.$transaction(async (tx) => {
      // Lock the membership row so two concurrent renewals cannot both create
      // a fresh ACTIVE membership for the same member + period.
      await tx.$queryRaw`SELECT 1 FROM "Membership" WHERE "id" = ${data.membershipId} FOR UPDATE`

      const locked = await tx.membership.findFirst({
        where: { id: data.membershipId, organizationId: user.organizationId },
        select: { id: true, memberId: true, status: true },
      })
      if (!locked || locked.status === "CANCELLED") {
        throw new BusinessRuleError("Membership not found or cancelled")
      }

      const overlap = await findOverlappingActiveMembership(
        tx,
        user.organizationId,
        existing.memberId,
        data.startDate,
        endDate
      )
      if (overlap) {
        throw new BusinessRuleError(
          `This member already has an active membership (${overlap.plan.name}) until ${formatDate(
            overlap.endDate
          )}. Choose a start date after the current membership ends.`
        )
      }

      await tx.membership.update({
        where: { id: data.membershipId },
        data: { status: "EXPIRED" },
      })

      const created = await tx.membership.create({
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

      await tx.payment.create({
        data: {
          organizationId: user.organizationId,
          memberId: existing.memberId,
          membershipId: created.id,
          amountMinor: data.amountMinor,
          method: data.method,
          status: "RECORDED",
          recordedById: user.id,
          notes: data.notes ?? null,
        },
      })

      return created.id
    })

    await writeAudit({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: AUDIT_ACTIONS.MEMBERSHIP_RENEWED,
      entityType: "Membership",
      entityId: newMembershipId,
      before: { oldMembershipId: data.membershipId, oldStatus: existing.status },
      after: { id: newMembershipId, endDate: endDate.toISOString() },
    })

    revalidatePath("/dashboard/memberships")
    revalidatePath(`/dashboard/members/${existing.memberId}`)

    return { success: true, data: { id: newMembershipId } }
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return { success: false, error: error.message }
    }
    throw error
  }
}

export async function cancelMembership(
  membershipId: string
): Promise<MembershipActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "memberships:manage")) {
    return { success: false, error: "Not authorized" }
  }

  const existing = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId: user.organizationId },
    select: { id: true, memberId: true, status: true },
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
  revalidatePath(`/dashboard/members/${existing.memberId}`)

  return { success: true, data: { id: updated.id } }
}

export async function pauseMembership(
  membershipId: string
): Promise<MembershipActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "memberships:manage")) {
    return { success: false, error: "Not authorized" }
  }

  const existing = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId: user.organizationId },
    select: { id: true, memberId: true, status: true },
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
  revalidatePath(`/dashboard/members/${existing.memberId}`)

  return { success: true, data: { id: updated.id } }
}