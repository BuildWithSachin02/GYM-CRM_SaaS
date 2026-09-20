"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { paymentSchema, type PaymentInput } from "@/lib/validators"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import { checkMembershipPaymentLink } from "@/lib/payments"

export type PaymentActionResult =
  | { success: true; data: { id: string } }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

export async function recordPayment(input: PaymentInput): Promise<PaymentActionResult> {
  const user = await requireUserOrThrow()

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
    select: { id: true, memberId: true, organizationId: true, status: true },
  })

  const link = checkMembershipPaymentLink(
    { memberId: data.memberId, membershipId: data.membershipId },
    membership,
    user.organizationId
  )
  if (!link.ok) {
    return { success: false, error: link.error }
  }

  const payment = await prisma.payment.create({
    data: {
      organizationId: user.organizationId,
      memberId: data.memberId,
      membershipId: link.membershipId,
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
