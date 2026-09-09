"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { memberSchema, type MemberInput } from "@/lib/validators"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"

export type MemberActionResult =
  | { success: true; data: { id: string } }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

export async function createMember(input: MemberInput): Promise<MemberActionResult> {
  const user = await requireUserOrThrow()

  const parsed = memberSchema.safeParse(input)
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

  const member = await prisma.member.create({
    data: {
      organizationId: user.organizationId,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      email: data.email || null,
      gender: (data.gender as "MALE" | "FEMALE" | "OTHER") ?? null,
      dateOfBirth: data.dateOfBirth ?? null,
      address: data.address ?? null,
      emergencyContactName: data.emergencyContactName ?? null,
      emergencyContactPhone: data.emergencyContactPhone ?? null,
      trainerId: data.trainerId ?? null,
      signupSource: (data.signupSource as "WEBSITE" | "INSTAGRAM" | "FACEBOOK" | "WHATSAPP" | "GOOGLE" | "WALK_IN" | "MANUAL") ?? null,
      notes: data.notes ?? null,
      status: "ACTIVE",
    },
    select: { id: true },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.MEMBER_CREATED,
    entityType: "Member",
    entityId: member.id,
    after: { ...data, id: member.id },
  })

  revalidatePath("/dashboard/members")

  return { success: true, data: { id: member.id } }
}

export async function updateMember(
  memberId: string,
  input: MemberInput
): Promise<MemberActionResult> {
  const user = await requireUserOrThrow()

  const parsed = memberSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {}
    parsed.error.issues.forEach((issue) => {
      const key = issue.path.join(".")
      if (!fieldErrors[key]) fieldErrors[key] = []
      fieldErrors[key].push(issue.message)
    })
    return { success: false, error: "Validation failed", fieldErrors }
  }

  const existing = await prisma.member.findFirst({
    where: { id: memberId, organizationId: user.organizationId, deletedAt: null },
    select: { id: true },
  })

  if (!existing) {
    return { success: false, error: "Member not found" }
  }

  const data = parsed.data

  const updated = await prisma.member.update({
    where: { id: memberId },
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      email: data.email || null,
      gender: (data.gender as "MALE" | "FEMALE" | "OTHER") ?? null,
      dateOfBirth: data.dateOfBirth ?? null,
      address: data.address ?? null,
      emergencyContactName: data.emergencyContactName ?? null,
      emergencyContactPhone: data.emergencyContactPhone ?? null,
      trainerId: data.trainerId ?? null,
      signupSource: (data.signupSource as "WEBSITE" | "INSTAGRAM" | "FACEBOOK" | "WHATSAPP" | "GOOGLE" | "WALK_IN" | "MANUAL") ?? null,
      notes: data.notes ?? null,
    },
    select: { id: true },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.MEMBER_UPDATED,
    entityType: "Member",
    entityId: updated.id,
    after: { ...data, id: updated.id },
  })

  revalidatePath("/dashboard/members")
  revalidatePath(`/dashboard/members/${memberId}`)

  return { success: true, data: { id: updated.id } }
}

export async function archiveMember(memberId: string): Promise<MemberActionResult> {
  const user = await requireUserOrThrow()

  const existing = await prisma.member.findFirst({
    where: { id: memberId, organizationId: user.organizationId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  })

  if (!existing) {
    return { success: false, error: "Member not found" }
  }

  await prisma.member.update({
    where: { id: memberId },
    data: { deletedAt: new Date(), status: "ARCHIVED" },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.MEMBER_ARCHIVED,
    entityType: "Member",
    entityId: memberId,
    before: { firstName: existing.firstName, lastName: existing.lastName },
  })

  revalidatePath("/dashboard/members")
  revalidatePath(`/dashboard/members/${memberId}`)

  return { success: true, data: { id: memberId } }
}
