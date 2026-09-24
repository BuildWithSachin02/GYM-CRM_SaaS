"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import { dayKeyInTimeZone, getMemberCoverage } from "@/lib/memberships"
import { dayKeyIsCovered, decideAttendanceApproval, decideAttendanceCorrection } from "@/lib/qr-attendance"
import { attendanceRequestDecisionSchema, attendanceCorrectionSchema } from "@/lib/validators"
import type { AttendanceRequestDecisionInput, AttendanceCorrectionInput } from "@/lib/validators"

type ActionResult = { success: boolean; error?: string }

const APPROVAL_MESSAGES = {
  not_pending: "This request has already been resolved.",
  member_inactive: "Member is not active.",
  still_expired:
    "Membership is still expired. Renew the membership before approving this attendance.",
} as const

async function findDecisionRequest(requestId: string) {
  return prisma.attendanceRequest.findFirst({
    where: { id: requestId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      dayKey: true,
      requestedAt: true,
      qrSession: { select: { locationId: true } },
      member: {
        select: { id: true, firstName: true, lastName: true, status: true, deletedAt: true },
      },
    },
  })
}

/**
 * Approve a PENDING attendance request, converting it into a normal completed
 * CheckIn. Revalidates EVERYTHING server-side (never trusts the stored day to
 * still be valid): the request must still be pending, the member still active,
 * the current membership must cover the ORIGINAL request day, and no check-in
 * may already exist for that day. An outstanding balance never blocks approval.
 */
export async function approveAttendanceRequest(
  input: AttendanceRequestDecisionInput
): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "attendance:record") || !["OWNER", "ADMIN"].includes(user.role)) {
    return { success: false, error: "Not authorized" }
  }

  const parsed = attendanceRequestDecisionSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: "Invalid request" }

  const request = await findDecisionRequest(parsed.data.requestId)
  if (!request || request.organizationId !== user.organizationId) {
    return { success: false, error: "Request not found" }
  }

  const memberActive =
    request.member.status === "ACTIVE" && request.member.deletedAt === null

  const membershipRows =
    memberActive
      ? await prisma.membership.findMany({
          where: {
            organizationId: user.organizationId,
            memberId: request.member.id,
          },
          select: { id: true, startDate: true, endDate: true, status: true },
        })
      : []

  const todayKey = dayKeyInTimeZone(new Date(), user.organization.timezone)
  const coverage = getMemberCoverage(membershipRows, user.organization.timezone, todayKey)

  const gate = decideAttendanceApproval({
    requestStatus: request.status,
    memberActive,
    requestDayCovered: dayKeyIsCovered(coverage.intervals, request.dayKey),
  })

  if (!gate.allowed) return { success: false, error: APPROVAL_MESSAGES[gate.reason] }

  // Defense in depth: the approval must never produce a duplicate check-in.
  const existing = await prisma.checkIn.findUnique({
    where: {
      organizationId_memberId_dayKey: {
        organizationId: user.organizationId,
        memberId: request.member.id,
        dayKey: request.dayKey,
      },
    },
    select: { id: true },
  })
  if (existing) {
    return { success: false, error: "Member already has a check-in for this day." }
  }

  const memberName = `${request.member.firstName} ${request.member.lastName}`

  try {
    await prisma.$transaction(async (tx) => {
      const checkIn = await tx.checkIn.create({
        data: {
          organizationId: user.organizationId,
          memberId: request.member.id,
          locationId: request.qrSession?.locationId ?? null,
          source: "QR_SESSION",
          dayKey: request.dayKey,
          checkedInAt: request.requestedAt,
        },
      })

      await tx.attendanceRequest.update({
        where: { id: request.id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedById: user.id,
          checkInId: checkIn.id,
        },
      })
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, error: "Member already has a check-in for this day." }
    }
    throw error
  }

  await markNotificationsRead(user.id)

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.ATTENDANCE_REQUEST_APPROVED,
    entityType: "AttendanceRequest",
    entityId: request.id,
    after: {
      memberId: request.member.id,
      dayKey: request.dayKey,
      requestedAt: request.requestedAt,
      approvedForMember: memberName,
    },
  })

  revalidatePath("/dashboard/attendance")
  revalidatePath("/dashboard/attendance/requests")
  revalidatePath(`/dashboard/members/${request.member.id}`)
  return { success: true }
}

/** Reject a PENDING attendance request with an optional staff note. */
export async function rejectAttendanceRequest(
  input: AttendanceRequestDecisionInput
): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "attendance:record") || !["OWNER", "ADMIN"].includes(user.role)) {
    return { success: false, error: "Not authorized" }
  }

  const parsed = attendanceRequestDecisionSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: "Invalid request" }

  const request = await findDecisionRequest(parsed.data.requestId)
  if (!request || request.organizationId !== user.organizationId) {
    return { success: false, error: "Request not found" }
  }
  if (request.status !== "PENDING") {
    return { success: false, error: "This request has already been resolved." }
  }

  await prisma.attendanceRequest.update({
    where: { id: request.id },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectedById: user.id,
      rejectionReason: parsed.data.reason,
    },
  })

  await markNotificationsRead(user.id)

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.ATTENDANCE_REQUEST_REJECTED,
    entityType: "AttendanceRequest",
    entityId: request.id,
    after: {
      memberId: request.member.id,
      dayKey: request.dayKey,
      rejectionReason: parsed.data.reason,
    },
  })

  revalidatePath("/dashboard/attendance/requests")
  revalidatePath(`/dashboard/members/${request.member.id}`)
  return { success: true }
}

/**
 * Revoke a trusted device so it no longer auto-identifies the member. The
 * browser cookie becomes useless (its hash no longer matches any active
 * device) and the next scan silently falls back to member search.
 */
export async function revokeMemberDevice(deviceId: string): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "members:update")) return { success: false, error: "Not authorized" }

  const trimmed = deviceId.trim()
  if (!trimmed) return { success: false, error: "Invalid device" }

  const device = await prisma.memberDevice.findFirst({
    where: { id: trimmed, organizationId: user.organizationId },
    select: { id: true, memberId: true, revokedAt: true },
  })
  if (!device) return { success: false, error: "Device not found" }
  if (device.revokedAt) {
    return { success: false, error: "This device is already revoked" }
  }

  await prisma.memberDevice.update({
    where: { id: device.id },
    data: { revokedAt: new Date() },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.DEVICE_REVOKED,
    entityType: "MemberDevice",
    entityId: device.id,
    after: { memberId: device.memberId },
  })

  revalidatePath(`/dashboard/members/${device.memberId}`)
  return { success: true }
}

/** Mark the acting staff member's own attendance-request notification as read. */
async function markNotificationsRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, type: "ATTENDANCE_REQUEST", isRead: false },
    data: { isRead: true },
  })
}

const CORRECTION_MESSAGES = {
  not_found: "Check-in not found",
  no_change: "Attendance already belongs to the selected member",
  linked_to_request:
    "This check-in was created from an approved attendance request and cannot be reassigned",
  member_invalid: "Selected member is not valid in this organization",
  duplicate_day: "The selected member already has a check-in for this day",
} as const

/**
 * Correct an incorrectly attributed check-in (e.g. a member was checked in
 * under the wrong name via QR). OWNER/ADMIN only.
 *
 * The existing CheckIn row is REASSIGNED to the correct member — never deleted,
 * never duplicated — so the unique (org, member, day) rule keeps duplicates
 * blocked and reports/history recompute naturally. Revalidates everything
 * server-side: same organization, valid member, and no existing check-in for
 * the target member on the original day. Every correction is audited.
 */
export async function correctAttendanceMember(
  input: AttendanceCorrectionInput
): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "attendance:record") || !["OWNER", "ADMIN"].includes(user.role)) {
    return { success: false, error: "Not authorized" }
  }

  const parsed = attendanceCorrectionSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: "Invalid correction" }

  const checkIn = await prisma.checkIn.findFirst({
    where: { id: parsed.data.checkInId, organizationId: user.organizationId },
    select: {
      id: true,
      memberId: true,
      dayKey: true,
      source: true,
      attendanceRequest: { select: { id: true } },
    },
  })
  if (!checkIn) return { success: false, error: CORRECTION_MESSAGES.not_found }

  const target = await prisma.member.findFirst({
    where: {
      id: parsed.data.memberId,
      organizationId: user.organizationId,
      deletedAt: null,
    },
    select: { id: true, firstName: true, lastName: true },
  })

  const targetDayCheckIn = target
    ? await prisma.checkIn.findUnique({
        where: {
          organizationId_memberId_dayKey: {
            organizationId: user.organizationId,
            memberId: target.id,
            dayKey: checkIn.dayKey,
          },
        },
        select: { id: true },
      })
    : null

  const gate = decideAttendanceCorrection({
    checkInExists: true,
    sameMember: checkIn.memberId === parsed.data.memberId,
    linkedToRequest: checkIn.attendanceRequest !== null,
    targetMemberValid: target !== null,
    targetHasCheckInOnDay: targetDayCheckIn !== null,
  })
  if (!gate.allowed) return { success: false, error: CORRECTION_MESSAGES[gate.reason] }
  if (!target) return { success: false, error: CORRECTION_MESSAGES.member_invalid }

  const targetName = `${target.firstName} ${target.lastName}`

  try {
    await prisma.checkIn.update({
      where: { id: checkIn.id },
      data: { memberId: target.id },
    })
  } catch (error) {
    // Defense in depth: the (org, member, day) unique index can never allow a
    // duplicate, even if a concurrent scan raced the pre-check above.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, error: CORRECTION_MESSAGES.duplicate_day }
    }
    throw error
  }

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.CHECKIN_MEMBER_CORRECTED,
    entityType: "CheckIn",
    entityId: checkIn.id,
    before: { memberId: checkIn.memberId, dayKey: checkIn.dayKey, source: checkIn.source },
    after: {
      memberId: target.id,
      memberName: targetName,
      dayKey: checkIn.dayKey,
      reason: parsed.data.reason,
    },
  })

  revalidatePath("/dashboard/attendance")
  revalidatePath(`/dashboard/members/${checkIn.memberId}`)
  revalidatePath(`/dashboard/members/${checkIn.memberId}/attendance`)
  revalidatePath(`/dashboard/members/${target.id}`)
  revalidatePath(`/dashboard/members/${target.id}/attendance`)
  return { success: true }
}