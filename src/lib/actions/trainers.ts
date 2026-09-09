"use server"

import { revalidatePath } from "next/cache"
import type { Prisma } from "@prisma/client"
import { ZodError } from "zod"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import { trainerSchema } from "@/lib/validators"
import type { TrainerInput } from "@/lib/validators"

type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

function buildFieldErrors(error: unknown): Record<string, string[]> | undefined {
  if (!(error instanceof ZodError)) return undefined
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const key = issue.path.join(".")
    if (!fieldErrors[key]) fieldErrors[key] = []
    fieldErrors[key].push(issue.message)
  }
  return fieldErrors
}

export async function createTrainer(input: TrainerInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "trainers:manage")) return { success: false, error: "Not authorized" }

  const parsed = trainerSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  const { userId, bio, specialties, active } = parsed.data

  const targetUser = await prisma.user.findFirst({
    where: { id: userId, organizationId: user.organizationId },
  })
  if (!targetUser) return { success: false, error: "Staff member not found" }

  const existing = await prisma.trainer.findUnique({ where: { userId } })
  if (existing) return { success: false, error: "This staff member is already a trainer" }

  const trainer = await prisma.trainer.create({
    data: {
      organizationId: user.organizationId,
      userId,
      bio: bio ?? null,
      specialties: (specialties ?? []) as unknown as Prisma.InputJsonValue,
      active,
    },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.TRAINER_CREATED,
    entityType: "Trainer",
    entityId: trainer.id,
    after: { userId, active },
  })

  revalidatePath("/dashboard/trainers")
  return { success: true }
}

export async function updateTrainer(trainerId: string, input: TrainerInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "trainers:manage")) return { success: false, error: "Not authorized" }

  const parsed = trainerSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  const { bio, specialties, active } = parsed.data

  const trainer = await prisma.trainer.findFirst({
    where: { id: trainerId, organizationId: user.organizationId },
  })
  if (!trainer) return { success: false, error: "Trainer not found" }

  await prisma.trainer.update({
    where: { id: trainerId },
    data: {
      bio: bio ?? null,
      specialties: (specialties ?? []) as unknown as Prisma.InputJsonValue,
      active,
    },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.TRAINER_UPDATED,
    entityType: "Trainer",
    entityId: trainerId,
    after: { bio, specialties, active },
  })

  revalidatePath("/dashboard/trainers")
  return { success: true }
}

export async function toggleTrainerActive(trainerId: string): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "trainers:manage")) return { success: false, error: "Not authorized" }

  const trainer = await prisma.trainer.findFirst({
    where: { id: trainerId, organizationId: user.organizationId },
  })
  if (!trainer) return { success: false, error: "Trainer not found" }

  const active = !trainer.active
  await prisma.trainer.update({ where: { id: trainerId }, data: { active } })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.TRAINER_UPDATED,
    entityType: "Trainer",
    entityId: trainerId,
    after: { active },
  })

  revalidatePath("/dashboard/trainers")
  return { success: true }
}