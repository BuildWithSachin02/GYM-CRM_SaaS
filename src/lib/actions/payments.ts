"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { paymentSchema, type PaymentInput } from "@/lib/validators"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import { can } from "@/lib/permissions"
import { checkMembershipPaymentLink } from "@/lib/payments"
import { checkPaymentAmount } from "@/lib/outstanding"
import { dayKeyInTimeZone, utcInstantForKey } from "@/lib/memberships"

export type PaymentActionResult =
  | { success: true; data: { id: string } }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

export async function recordPayment(input: PaymentInput): Promise<PaymentActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "payments:record")) {
    return { success: false, error: "Not authorized" }
  }

  const parsed = paymentSchema.safeParse(input)
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

  const member = await prisma.member.findFirst({
    where: { id: data.memberId, organizationId: user.organizationId, deletedAt: null },
    select: { id: true },
  })

  if (!member) {
    return { success: false, error: "Member not found" }
  }

  // Every payment must be tied to a membership that really belongs to this
  // member in this organization. Never trust memberId + membershipId from the
  // client. A member-only (standalone) payment is rejected by the rule.
  const membership = await prisma.membership.findFirst({
    where: { id: data.membershipId, organizationId: user.organizationId },
    select: {
      id: true,
      memberId: true,
      organizationId: true,
      status: true,
      amountMinor: true,
      branchId: true,
    },
  })

  const link = checkMembershipPaymentLink(
    { memberId: data.memberId, membershipId: data.membershipId },
    membership,
    user.organizationId
  )
  if (!link.ok) {
    return { success: false, error: link.error }
  }

  // Partial payments are supported, but never overpayment: the amount cannot
  // exceed what is still owed on this membership. "Paid" is the RECORDED sum
  // (VOIDED/REFUNDED never count) — the same rule that drives every balance.
  const paidMinor = await prisma.payment.aggregate({
    where: {
      organizationId: user.organizationId,
      membershipId: link.membershipId,
      status: "RECORDED",
    },
    _sum: { amountMinor: true },
  })
  const remainingMinor = membership!.amountMinor - (paidMinor._sum.amountMinor ?? 0)
  const amountCheck = checkPaymentAmount({
    amountMinor: data.amountMinor,
    remainingMinor,
  })
  if (!amountCheck.ok) {
    return { success: false, error: amountCheck.error }
  }

  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        organizationId: user.organizationId,
        memberId: data.memberId,
        membershipId: link.membershipId,
        // A payment is stamped with the branch of the membership it settles.
        branchId: membership!.branchId,
        amountMinor: data.amountMinor,
        method: data.method,
        paymentDate: data.paymentDate,
        reference: data.reference ?? null,
        notes: data.notes ?? null,
        recordedById: user.id,
        status: "RECORDED",
      },
      select: { id: true },
    })

    // The form can (re)set the commitment day this membership should be paid
    // in full by — stored as the org-timezone local midnight (same convention
    // as membership periods). Null clears it; it never creates revenue.
    if ("expectedPaymentDate" in data) {
      const raw = data.expectedPaymentDate
      const expected = raw
        ? utcInstantForKey(
            dayKeyInTimeZone(raw, user.organization.timezone),
            user.organization.timezone
          )
        : null
      await tx.membership.update({
        where: { id: link.membershipId },
        data: { expectedPaymentDate: expected },
      })
    }

    return created
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.PAYMENT_RECORDED,
    entityType: "Payment",
    entityId: payment.id,
    after: {
      memberId: data.memberId,
      amountMinor: data.amountMinor,
      method: data.method,
      paymentDate: data.paymentDate.toISOString(),
    },
  })

  revalidatePath("/dashboard/payments")
  revalidatePath(`/dashboard/members/${data.memberId}`)

  return { success: true, data: { id: payment.id } }
}

export async function voidPayment(paymentId: string): Promise<PaymentActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "payments:record")) {
    return { success: false, error: "Not authorized" }
  }

  const existing = await prisma.payment.findFirst({
    where: { id: paymentId, organizationId: user.organizationId },
    select: {
      id: true,
      status: true,
      amountMinor: true,
      method: true,
      paymentDate: true,
      member: { select: { id: true, firstName: true, lastName: true } },
      recordedBy: { select: { name: true } },
    },
  })

  if (!existing) {
    return { success: false, error: "Payment not found" }
  }

  if (existing.status !== "RECORDED") {
    return { success: false, error: "Only recorded payments can be voided" }
  }

  await prisma.payment.update({
    where: { id: paymentId },
    data: { status: "VOIDED" },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.PAYMENT_VOIDED,
    entityType: "Payment",
    entityId: paymentId,
    before: { status: existing.status },
    after: { status: "VOIDED" },
  })

  revalidatePath("/dashboard/payments")
  revalidatePath(`/dashboard/members/${existing.member.id}`)

  return { success: true, data: { id: paymentId } }
}
