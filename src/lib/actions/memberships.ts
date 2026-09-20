"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { BusinessRuleError } from "@/lib/errors"
import { formatDayKey } from "@/lib/format"
import {
  membershipCreateSchema,
  membershipRenewSchema,
  type MembershipCreateInput,
  type MembershipRenewInput,
} from "@/lib/validators"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import {
  canRenewLifecycle,
  dayKeyInTimeZone,
  findOverlappingActiveMembership,
  getMemberCoverage,
  getMembershipLifecycle,
  membershipPeriodFromStart,
  nextValidRenewalStartKey,
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

  // Period derived from the org-timezone calendar day so the stored instants
  // are local midnights and never drift across DST/timezone boundaries.
  const { start, end } = membershipPeriodFromStart(
    data.startDate,
    plan.durationDays,
    user.organization.timezone
  )

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
        start,
        end,
        user.organization.timezone
      )
      if (overlap) {
        throw new BusinessRuleError(
          `This member already has a membership (${overlap.plan.name}, ${formatDayKey(
            dayKeyInTimeZone(overlap.startDate, user.organization.timezone)
          )} – ${formatDayKey(
            dayKeyInTimeZone(overlap.endDate, user.organization.timezone)
          )}) that overlaps this period. Use "Renew" on that membership, or choose a non-overlapping start date.`
        )
      }

      // Close any ACTIVE memberships that already ended before this new period.
      await tx.membership.updateMany({
        where: {
          organizationId: user.organizationId,
          memberId: data.memberId,
          status: "ACTIVE",
          endDate: { lt: start },
        },
        data: { status: "EXPIRED" },
      })

      // A membership is the plan/price ASSIGNED to the member; it is NOT
      // received revenue. No payment row is created here — actual money
      // received is recorded separately via Record Payment (only RECORDED
      // Payment rows contribute to revenue, never membership.amountMinor).
      const membership = await tx.membership.create({
        data: {
          organizationId: user.organizationId,
          memberId: data.memberId,
          planId: data.planId,
          startDate: start,
          endDate: end,
          amountMinor: data.amountMinor,
          status: "ACTIVE",
          notes: data.notes ?? null,
        },
        select: { id: true },
      })

      return membership.id
    })

    await writeAudit({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: AUDIT_ACTIONS.MEMBERSHIP_CREATED,
      entityType: "Membership",
      entityId: membershipId,
      after: { ...data, id: membershipId, endDate: end.toISOString() },
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

  // Load the member's whole membership history: eligibility and the allowable
  // start date depend on their total coverage, not just the record renewed.
  const allRows = await prisma.membership.findMany({
    where: {
      organizationId: user.organizationId,
      memberId: existing.memberId,
    },
    select: { id: true, status: true, startDate: true, endDate: true },
  })

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

  // Renewal start-date rules, driven by the member's TOTAL coverage:
  //  - never from a past date.
  //  - never inside (or earlier than) the member's existing coverage — the
  //    start must be >= nextValidRenewalStartKey, the day after all their
  //    non-cancelled records end. This applies to every member identically:
  //    a member whose records chain back-to-back can only renew from the day
  //    after their farthest valid coverage ends.
  const todayKey = dayKeyInTimeZone(new Date(), timeZone)
  const startKey = dayKeyInTimeZone(data.startDate, timeZone)
  const coverage = getMemberCoverage(allRows, timeZone, todayKey)
  const suggestedStart = nextValidRenewalStartKey(allRows, timeZone, todayKey)
  const coverageThroughKey = coverage.overallEndKey

  if (startKey < todayKey) {
    return {
      success: false,
      error: `Renewal must start today (${formatDayKey(todayKey)}) or later — past start dates are not allowed.`,
    }
  }

  if (startKey < suggestedStart) {
    return {
      success: false,
      error: `Cannot start a renewal on ${formatDayKey(
        startKey
      )} because this member already has membership coverage${
        coverageThroughKey
          ? ` until ${formatDayKey(coverageThroughKey)}`
          : ""
      }. Choose ${formatDayKey(suggestedStart)} or later.`,
    }
  }

  // Period derived from the org-timezone calendar day (local midnights).
  const { start, end } = membershipPeriodFromStart(
    data.startDate,
    plan.durationDays,
    timeZone
  )

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
        start,
        end,
        timeZone,
        data.membershipId
      )
      if (overlap) {
        throw new BusinessRuleError(
          `This member already has a membership (${overlap.plan.name}) until ${formatDayKey(
            dayKeyInTimeZone(overlap.endDate, timeZone)
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
          startDate: start,
          endDate: end,
          amountMinor: data.amountMinor,
          status: "ACTIVE",
          notes: data.notes ?? null,
        },
        select: { id: true },
      })

      // Renewal assigns the next period at the chosen plan price; it does not
      // create revenue. Actual money received is recorded separately.
      return created.id
    })

    await writeAudit({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: AUDIT_ACTIONS.MEMBERSHIP_RENEWED,
      entityType: "Membership",
      entityId: newMembershipId,
      before: { oldMembershipId: data.membershipId, oldStatus: existing.status },
      after: { id: newMembershipId, endDate: end.toISOString() },
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