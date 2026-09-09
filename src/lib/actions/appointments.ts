"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import { appointmentSchema, appointmentStatusSchema } from "@/lib/validators"
import type { AppointmentInput, AppointmentStatusInput } from "@/lib/validators"
import { ZodError } from "zod"

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

export async function createAppointment(input: AppointmentInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "appointments:manage")) return { success: false, error: "Not authorized" }

  const parsed = appointmentSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  const {
    memberId,
    leadId,
    trainerId,
    staffId,
    startsAt,
    endsAt,
    status,
    notes,
    locationId,
  } = parsed.data

  const appointment = await prisma.appointment.create({
    data: {
      organizationId: user.organizationId,
      memberId: memberId ?? null,
      leadId: leadId ?? null,
      trainerId: trainerId ?? null,
      staffId: staffId ?? null,
      startsAt,
      endsAt,
      status,
      notes: notes ?? null,
      locationId: locationId ?? null,
    },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.APPOINTMENT_CREATED,
    entityType: "Appointment",
    entityId: appointment.id,
    after: {
      memberId: memberId ?? null,
      leadId: leadId ?? null,
      trainerId: trainerId ?? null,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      status,
    },
  })

  revalidatePath("/dashboard/appointments")
  return { success: true }
}

export async function updateAppointmentStatus(input: AppointmentStatusInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "appointments:manage")) return { success: false, error: "Not authorized" }

  const parsed = appointmentStatusSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  const { appointmentId, status } = parsed.data
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, organizationId: user.organizationId },
  })
  if (!appointment) return { success: false, error: "Appointment not found" }

  await prisma.appointment.update({ where: { id: appointmentId }, data: { status } })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.APPOINTMENT_UPDATED,
    entityType: "Appointment",
    entityId: appointmentId,
    before: { status: appointment.status },
    after: { status },
  })

  revalidatePath("/dashboard/appointments")
  return { success: true }
}

export async function deleteAppointment(appointmentId: string): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "appointments:manage")) return { success: false, error: "Not authorized" }

  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, organizationId: user.organizationId },
  })
  if (!appointment) return { success: false, error: "Appointment not found" }

  await prisma.appointment.delete({ where: { id: appointmentId } })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: "appointment.deleted",
    entityType: "Appointment",
    entityId: appointmentId,
    after: { startsAt: appointment.startsAt.toISOString(), status: appointment.status },
  })

  revalidatePath("/dashboard/appointments")
  return { success: true }
}
