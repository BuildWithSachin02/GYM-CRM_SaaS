"use server"

import { revalidatePath } from "next/cache"

import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow, type SessionUser } from "@/lib/auth/auth"
import { memberSchema, type MemberInput } from "@/lib/validators"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import { can } from "@/lib/permissions"
import {
  classifyDuplicates,
  isMemberCodeCollision,
  nextMemberCode,
  type DuplicateWarning,
} from "@/lib/member-code"

export type MemberActionResult =
  | {
      success: true
      data: { id: string; memberCode: string | null }
      /** Informational only — never blocks the create/update. */
      warnings?: DuplicateWarning[]
    }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

/** Sequential-create retries: two creates may race for the same free code. */
const MEMBER_CODE_MAX_TRIES = 5

async function fetchMemberCodes(organizationId: string): Promise<string[]> {
  const rows = await prisma.member.findMany({
    where: { organizationId },
    select: { memberCode: true },
  })
  return rows.map((r) => r.memberCode)
}

async function fetchDuplicateCandidates(
  organizationId: string,
  excludeId?: string
) {
  return prisma.member.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      memberCode: true,
    },
  })
}

export async function createMember(input: MemberInput): Promise<MemberActionResult> {
  let user: SessionUser
  try {
    user = await requireUserOrThrow()
  } catch {
    return {
      success: false,
      error: "Your session has expired. Please sign in again.",
    }
  }
  if (!can(user, "members:create")) {
    return { success: false, error: "Not authorized" }
  }

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

  // Informational duplicate detection (never blocks): a STRONG match is
  // same normalized name + same phone; a WEAK match is same name only.
  // Different names sharing a phone is explicitly allowed.
  const candidates = await fetchDuplicateCandidates(user.organizationId)
  const warnings = classifyDuplicates(data, candidates)

  const baseData = {
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
    status: "ACTIVE" as const,
  }

  let member: { id: string; memberCode: string } | null = null
  let lastRaceError: unknown = null
  for (let attempt = 0; attempt < MEMBER_CODE_MAX_TRIES; attempt += 1) {
    const existingCodes = await fetchMemberCodes(user.organizationId)
    const memberCode = nextMemberCode(existingCodes)
    try {
      member = await prisma.member.create({
        data: { ...baseData, memberCode },
        select: { id: true, memberCode: true },
      })
      break
    } catch (error) {
      // A concurrent create claimed the same code — recompute and retry with
      // the next free code. Any other failure falls through.
      if (isMemberCodeCollision(error)) {
        lastRaceError = error
        continue
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        Array.isArray(error.meta?.target) &&
        (error.meta?.target as string[]).includes("email")
      ) {
        return {
          success: false,
          error: "A member with these details already exists.",
          fieldErrors: { email: ["A member with this email already exists."] },
        }
      }
      throw error
    }
  }

  if (!member) {
    console.error("createMember could not allocate a unique member code", lastRaceError)
    return {
      success: false,
      error: "Could not create the member. Please try again.",
    }
  }

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.MEMBER_CREATED,
    entityType: "Member",
    entityId: member.id,
    after: { ...data, id: member.id, memberCode: member.memberCode },
  })

  revalidatePath("/dashboard/members")

  return {
    success: true,
    data: { id: member.id, memberCode: member.memberCode },
    warnings,
  }
}

export async function updateMember(
  memberId: string,
  input: MemberInput
): Promise<MemberActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "members:update")) {
    return { success: false, error: "Not authorized" }
  }

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

  // Recompute duplicate warnings against the member's NEW identity, excluding
  // the member being edited. Informational only — never blocks the update.
  const candidates = await fetchDuplicateCandidates(
    user.organizationId,
    memberId
  )
  const warnings = classifyDuplicates(data, candidates)

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
    select: { id: true, memberCode: true },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.MEMBER_UPDATED,
    entityType: "Member",
    entityId: updated.id,
    after: {
      ...data,
      id: updated.id,
      memberCode: updated.memberCode,
    },
  })

  revalidatePath("/dashboard/members")
  revalidatePath(`/dashboard/members/${memberId}`)

  return {
    success: true,
    data: { id: updated.id, memberCode: updated.memberCode },
    warnings,
  }
}

export async function archiveMember(memberId: string): Promise<MemberActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "members:archive")) {
    return { success: false, error: "Not authorized" }
  }

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

  return { success: true, data: { id: memberId, memberCode: null } }
}
