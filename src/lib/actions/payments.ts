"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { paymentSchema, type PaymentInput } from "@/lib/validators"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"

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

  const payment = await prisma.payment.create({
    data: {
      organizationId: user.organizationId,
      memberId: data.memberId,
      membershipId: data.membershipId ?? null,
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
      member: { select: { firstName: true, lastName: true } },
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

  return { success: true, data: { id: paymentId } }
}
