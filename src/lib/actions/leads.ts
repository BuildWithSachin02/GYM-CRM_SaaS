"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import {
  leadSchema,
  leadStageSchema,
  leadActivitySchema,
  leadConvertSchema,
  type LeadInput,
  type LeadStageInput,
} from "@/lib/validators"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import { can } from "@/lib/permissions"
import {
  isMemberCodeCollision,
  nextMemberCode,
} from "@/lib/member-code"

/** Sequential-create retries: two creates may race for the same free code. */
const MEMBER_CODE_MAX_TRIES = 5

export type LeadActionResult =
  | { success: true; data: { id: string } }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

function collectFieldErrors(
  issues: Array<{ path: PropertyKey[]; message: string }>
): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of issues) {
    const key = issue.path.join(".")
    if (!fieldErrors[key]) fieldErrors[key] = []
    fieldErrors[key].push(issue.message)
  }
  return fieldErrors
}

export async function createLead(input: LeadInput): Promise<LeadActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "leads:create")) {
    return { success: false, error: "Not authorized" }
  }

  const parsed = leadSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: collectFieldErrors(parsed.error.issues),
    }
  }

  const data = parsed.data

  const lead = await prisma.lead.create({
    data: {
      organizationId: user.organizationId,
      name: data.name,
      phone: data.phone,
      email: data.email || null,
      source: data.source,
      sourceDetail: data.sourceDetail ?? null,
      stage: data.stage,
      interestedPlanId: data.interestedPlanId ?? null,
      ownerUserId: data.ownerUserId ?? null,
      followUpDate: data.followUpDate ?? null,
      notes: data.notes ?? null,
    },
    select: { id: true },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.LEAD_CREATED,
    entityType: "Lead",
    entityId: lead.id,
    after: { ...data, id: lead.id },
  })

  revalidatePath("/dashboard/leads")

  return { success: true, data: { id: lead.id } }
}

export async function updateLead(
  leadId: string,
  input: LeadInput
): Promise<LeadActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "leads:update")) {
    return { success: false, error: "Not authorized" }
  }

  const parsed = leadSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: collectFieldErrors(parsed.error.issues),
    }
  }

  const existing = await prisma.lead.findFirst({
    where: { id: leadId, organizationId: user.organizationId, deletedAt: null },
    select: { id: true },
  })

  if (!existing) {
    return { success: false, error: "Lead not found" }
  }

  const data = parsed.data

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      name: data.name,
      phone: data.phone,
      email: data.email || null,
      source: data.source,
      sourceDetail: data.sourceDetail ?? null,
      stage: data.stage,
      interestedPlanId: data.interestedPlanId ?? null,
      ownerUserId: data.ownerUserId ?? null,
      followUpDate: data.followUpDate ?? null,
      notes: data.notes ?? null,
    },
    select: { id: true },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.LEAD_UPDATED,
    entityType: "Lead",
    entityId: updated.id,
    after: { ...data, id: updated.id },
  })

  revalidatePath("/dashboard/leads")
  revalidatePath(`/dashboard/leads/${leadId}`)

  return { success: true, data: { id: updated.id } }
}

export async function deleteLead(leadId: string): Promise<LeadActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "leads:manage")) {
    return { success: false, error: "Not authorized" }
  }

  const existing = await prisma.lead.findFirst({
    where: { id: leadId, organizationId: user.organizationId, deletedAt: null },
    select: { id: true, name: true },
  })

  if (!existing) {
    return { success: false, error: "Lead not found" }
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: { deletedAt: new Date() },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.LEAD_UPDATED,
    entityType: "Lead",
    entityId: leadId,
    before: { name: existing.name },
  })

  revalidatePath("/dashboard/leads")

  return { success: true, data: { id: leadId } }
}

export async function updateLeadStage(
  leadId: string,
  stage: LeadStageInput["stage"]
): Promise<LeadActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "leads:update")) {
    return { success: false, error: "Not authorized" }
  }

  const parsed = leadStageSchema.safeParse({ leadId, stage })
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: collectFieldErrors(parsed.error.issues),
    }
  }

  const existing = await prisma.lead.findFirst({
    where: { id: leadId, organizationId: user.organizationId, deletedAt: null },
    select: { id: true, stage: true },
  })

  if (!existing) {
    return { success: false, error: "Lead not found" }
  }

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: { stage: parsed.data.stage },
    select: { id: true },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.LEAD_STAGE_CHANGED,
    entityType: "Lead",
    entityId: leadId,
    before: { stage: existing.stage },
    after: { stage: parsed.data.stage },
  })

  revalidatePath("/dashboard/leads")
  revalidatePath(`/dashboard/leads/${leadId}`)

  return { success: true, data: { id: updated.id } }
}

export async function addLeadActivity(
  input: z.input<typeof leadActivitySchema>
): Promise<LeadActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "leads:update")) {
    return { success: false, error: "Not authorized" }
  }

  const parsed = leadActivitySchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: collectFieldErrors(parsed.error.issues),
    }
  }

  const existing = await prisma.lead.findFirst({
    where: { id: parsed.data.leadId, organizationId: user.organizationId, deletedAt: null },
    select: { id: true },
  })

  if (!existing) {
    return { success: false, error: "Lead not found" }
  }

  const activity = await prisma.leadActivity.create({
    data: {
      organizationId: user.organizationId,
      leadId: parsed.data.leadId,
      createdById: user.id,
      type: parsed.data.type,
      body: parsed.data.body,
      activityDate: parsed.data.activityDate,
    },
    select: { id: true },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.LEAD_ACTIVITY_CREATED,
    entityType: "LeadActivity",
    entityId: activity.id,
    after: { leadId: parsed.data.leadId, type: parsed.data.type },
  })

  revalidatePath(`/dashboard/leads/${parsed.data.leadId}`)

  return { success: true, data: { id: activity.id } }
}

export async function convertLeadToMember(
  input: z.input<typeof leadConvertSchema>
): Promise<LeadActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "leads:convert")) {
    return { success: false, error: "Not authorized" }
  }

  const parsed = leadConvertSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: collectFieldErrors(parsed.error.issues),
    }
  }

  const data = parsed.data

  const lead = await prisma.lead.findFirst({
    where: { id: data.leadId, organizationId: user.organizationId, deletedAt: null },
    select: { id: true, name: true, phone: true, email: true, source: true },
  })

  if (!lead) {
    return { success: false, error: "Lead not found" }
  }

  const nameParts = lead.name.trim().split(/\s+/)
  const firstName = nameParts[0] || lead.name
  const lastName = nameParts.slice(1).join(" ") || ""

  const endDate = new Date(data.startDate)
  endDate.setDate(endDate.getDate() + data.durationDays)

  let result: { memberId: string } | null = null
  let lastRaceError: unknown = null
  for (let attempt = 0; attempt < MEMBER_CODE_MAX_TRIES; attempt += 1) {
    try {
      result = await prisma.$transaction(async (tx) => {
        const existingCodes = await tx.member.findMany({
          where: { organizationId: user.organizationId },
          select: { memberCode: true },
        })
        const member = await tx.member.create({
          data: {
            organizationId: user.organizationId,
            memberCode: nextMemberCode(existingCodes.map((r) => r.memberCode)),
            firstName,
            lastName,
            phone: lead.phone,
            email: lead.email,
            signupSource: lead.source,
            status: "ACTIVE",
          },
          select: { id: true, memberCode: true },
        })

        await tx.membership.create({
          data: {
            organizationId: user.organizationId,
            memberId: member.id,
            planId: data.planId,
            startDate: data.startDate,
            endDate,
            amountMinor: data.amountMinor,
            status: "ACTIVE",
          },
        })

        // Conversion assigns a membership only — it creates no revenue. Actual
        // money received is recorded separately via Record Payment.

        await tx.lead.update({
          where: { id: data.leadId },
          data: {
            stage: "CONVERTED",
            convertedMemberId: member.id,
            convertedAt: new Date(),
          },
        })

        return { memberId: member.id }
      })
      break
    } catch (error) {
      // A concurrent lead conversion claimed the same free code — recompute
      // and retry the whole transaction with the next code. Only a memberCode
      // collision retries; everything else is a real failure.
      if (isMemberCodeCollision(error)) {
        lastRaceError = error
        continue
      }
      throw error
    }
  }

  if (!result) {
    console.error("leadConvert could not allocate a unique member code", lastRaceError)
    return { success: false, error: "Could not convert the lead. Please try again." }
  }

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.LEAD_CONVERTED,
    entityType: "Lead",
    entityId: data.leadId,
    after: { memberId: result.memberId, planId: data.planId, amountMinor: data.amountMinor },
  })

  revalidatePath("/dashboard/leads")
  revalidatePath(`/dashboard/leads/${data.leadId}`)
  revalidatePath("/dashboard/members")

  return { success: true, data: { id: result.memberId } }
}