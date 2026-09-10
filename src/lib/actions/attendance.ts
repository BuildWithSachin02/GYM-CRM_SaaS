"use server"

import { revalidatePath } from "next/cache"
import { createHash, randomUUID } from "node:crypto"

import { prisma } from "@/lib/prisma"
import { getCurrentUser, requireUserOrThrow } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import { dayKeyOf } from "@/lib/format"
import { manualCheckinSchema, qrSessionSchema } from "@/lib/validators"
import type { ManualCheckinInput, QrSessionInput } from "@/lib/validators"

type ActionResult = { success: boolean; error?: string; fieldErrors?: Record<string, string> }

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export async function manualCheckin(input: ManualCheckinInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "attendance:record")) return { success: false, error: "Not authorized" }

  const parsed = manualCheckinSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (typeof key === "string") fieldErrors[key] = issue.message
    }
    return { success: false, error: "Invalid input", fieldErrors }
  }

  const { memberId, locationId } = parsed.data
  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId: user.organizationId, deletedAt: null },
  })
  if (!member) return { success: false, error: "Member not found" }
  if (member.status !== "ACTIVE") return { success: false, error: "Member is not active" }

  const dayKey = dayKeyOf(new Date())
  const existing = await prisma.checkIn.findUnique({
    where: { organizationId_memberId_dayKey: { organizationId: user.organizationId, memberId, dayKey } },
  })
  if (existing) return { success: false, error: "Member already checked in today" }

  const checkIn = await prisma.checkIn.create({
    data: {
      organizationId: user.organizationId,
      memberId,
      locationId: locationId ?? null,
      source: "MANUAL",
      dayKey,
    },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.CHECKIN_MANUAL,
    entityType: "CheckIn",
    entityId: checkIn.id,
    after: { memberId, dayKey, source: "MANUAL" },
  })

  revalidatePath("/dashboard/attendance")
  return { success: true }
}

export async function createQrSession(input: QrSessionInput): Promise<ActionResult & { token?: string }> {
  const user = await requireUserOrThrow()
  if (!can(user, "attendance:record")) return { success: false, error: "Not authorized" }

  const parsed = qrSessionSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (typeof key === "string") fieldErrors[key] = issue.message
    }
    return { success: false, error: "Invalid input", fieldErrors }
  }

  const { locationId, label, expiresInMinutes } = parsed.data
  const token = randomUUID()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000)

  const session = await prisma.qRSession.create({
    data: {
      organizationId: user.organizationId,
      locationId,
      label: label ?? null,
      tokenHash,
      expiresAt,
      createdById: user.id,
    },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.QR_SESSION_CREATED,
    entityType: "QRSession",
    entityId: session.id,
    after: { locationId, label, expiresInMinutes },
  })

  revalidatePath("/dashboard/attendance")
  return { success: true, token }
}

export async function deactivateQrSession(sessionId: string): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "attendance:record")) return { success: false, error: "Not authorized" }

  const session = await prisma.qRSession.findFirst({
    where: { id: sessionId, organizationId: user.organizationId, revokedAt: null },
  })
  if (!session) return { success: false, error: "Session not found or already revoked" }

  await prisma.qRSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: "qrsession.revoked",
    entityType: "QRSession",
    entityId: sessionId,
  })

  revalidatePath("/dashboard/attendance")
  return { success: true }
}

export async function qrCheckin(token: string, memberId: string): Promise<ActionResult> {
  const tokenHash = hashToken(token)
  const session = await prisma.qRSession.findUnique({
    where: { tokenHash },
    select: { id: true, organizationId: true, locationId: true, expiresAt: true, revokedAt: true },
  })

  if (!session) return { success: false, error: "Invalid QR code" }
  if (session.revokedAt) return { success: false, error: "QR code has been revoked" }
  if (session.expiresAt < new Date()) return { success: false, error: "QR code has expired" }

  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId: session.organizationId, deletedAt: null },
  })
  if (!member) return { success: false, error: "Member not found" }
  if (member.status !== "ACTIVE") return { success: false, error: "Member is not active" }

  const now = new Date()
  const activeMembership = await prisma.membership.findFirst({
    where: {
      organizationId: session.organizationId,
      memberId,
      status: "ACTIVE",
      startDate: { lte: now },
      endDate: { gte: now },
    },
    select: { id: true },
  })
  if (!activeMembership) return { success: false, error: "No active membership" }

  const dayKey = dayKeyOf(now)
  const existing = await prisma.checkIn.findUnique({
    where: { organizationId_memberId_dayKey: { organizationId: session.organizationId, memberId, dayKey } },
  })
  if (existing) return { success: false, error: "Member already checked in today" }

  const checkIn = await prisma.checkIn.create({
    data: {
      organizationId: session.organizationId,
      memberId,
      locationId: session.locationId,
      qrSessionId: session.id,
      source: "QR_SESSION",
      dayKey,
    },
  })

  const actor = await getCurrentUser()
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: actor?.id ?? null,
    action: AUDIT_ACTIONS.CHECKIN_QR,
    entityType: "CheckIn",
    entityId: checkIn.id,
    after: { memberId, dayKey, source: "QR_SESSION", qrSessionId: session.id, anonymous: !actor },
  })

  revalidatePath("/dashboard/attendance")
  return { success: true }
}