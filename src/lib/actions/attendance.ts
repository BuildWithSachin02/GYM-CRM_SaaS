"use server"

import { revalidatePath } from "next/cache"
import { createHash, randomUUID } from "node:crypto"

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { getCurrentUser, requireUserOrThrow } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import { dayKeyOf } from "@/lib/format"
import { dayKeyInTimeZone, getMemberCoverage } from "@/lib/memberships"
import { decideQrScan } from "@/lib/qr-attendance"
import {
  rememberDevice,
  resolveDeviceMember,
  touchDevice,
  type ResolvedDeviceMember,
} from "@/lib/member-device"
import { manualCheckinSchema, qrSessionSchema, qrCheckinSchema } from "@/lib/validators"
import type { ManualCheckinInput, QrSessionInput } from "@/lib/validators"

type ActionResult = { success: boolean; error?: string; fieldErrors?: Record<string, string> }

/**
 * Result of one QR scan. The same shape is returned for a first-time scan
 * (member search, opt-in remembered device) and a repeat scan (remembered
 * device auto-check-in). Every outcome is decided server-side.
 */
export type QrCheckinResult =
  | {
      success: true
      outcome: "checked_in" | "already_checked_in" | "request_pending" | "request_rejected"
      memberName: string
    }
  | { success: false; error: string; code?: "device_not_found" }

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

const QR_ERRORS = {
  invalid: "Invalid QR code",
  revoked: "QR code has been revoked",
  expired: "QR code has expired",
  memberNotFound: "Member not found",
  memberNotActive: "Member is not active",
} as const

function qrSessionError(code: "invalid" | "revoked" | "expired"): string {
  return QR_ERRORS[code]
}

type QrSessionContext = {
  id: string
  organizationId: string
  locationId: string
  timezone: string
}

type QrSessionResolution =
  | { ok: true; context: QrSessionContext }
  | { ok: false; error: "invalid" | "revoked" | "expired" }

type QrMemberContext = {
  id: string
  firstName: string
  lastName: string
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED"
}

async function resolveQrSession(token: string): Promise<QrSessionResolution> {
  const tokenHash = hashToken(token)
  const session = await prisma.qRSession.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      organizationId: true,
      locationId: true,
      expiresAt: true,
      revokedAt: true,
      organization: { select: { timezone: true } },
    },
  })
  if (!session) return { ok: false, error: "invalid" }
  if (session.revokedAt) return { ok: false, error: "revoked" }
  if (session.expiresAt < new Date()) return { ok: false, error: "expired" }
  return {
    ok: true,
    context: {
      id: session.id,
      organizationId: session.organizationId,
      locationId: session.locationId,
      timezone: session.organization.timezone,
    },
  }
}

async function resolveMember(
  organizationId: string,
  memberId: string
): Promise<QrMemberContext | null> {
  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, status: true },
  })
  return member as QrMemberContext | null
}

/**
 * The single shared QR-scan runner used by BOTH identification paths. It always
 * re-validates tenant, member status, duplicate rules and membership coverage
 * against the database — the remembered device never bypasses a single check.
 */
async function performQrScan(args: {
  session: QrSessionContext
  member: QrMemberContext
  device?: ResolvedDeviceMember | null
  rememberDevice?: boolean
}): Promise<QrCheckinResult> {
  const { session, member, device } = args
  const memberName = `${member.firstName} ${member.lastName}`

  const now = new Date()
  const todayKey = dayKeyInTimeZone(now, session.timezone)

  const [existingCheckIn, membershipRows, existingRequest] = await Promise.all([
    prisma.checkIn.findUnique({
      where: {
        organizationId_memberId_dayKey: {
          organizationId: session.organizationId,
          memberId: member.id,
          dayKey: todayKey,
        },
      },
      select: { id: true },
    }),
    prisma.membership.findMany({
      where: { organizationId: session.organizationId, memberId: member.id },
      select: { id: true, startDate: true, endDate: true, status: true },
    }),
    prisma.attendanceRequest.findUnique({
      where: {
        organizationId_memberId_dayKey: {
          organizationId: session.organizationId,
          memberId: member.id,
          dayKey: todayKey,
        },
      },
      select: { id: true, status: true },
    }),
  ])

  const coverage = getMemberCoverage(membershipRows, session.timezone, todayKey)
  const plan = decideQrScan({
    memberStatus: member.status,
    hasCheckInToday: existingCheckIn !== null,
    coverage,
  })

  const remember = async () => {
    if (device) {
      // Auto scan: refresh the existing device's timestamp, nothing else.
      await touchDevice(device.deviceId)
    } else if (args.rememberDevice) {
      // First-time scan with explicit member opt-in: create/refresh a device.
      const result = await rememberDevice({
        organizationId: session.organizationId,
        memberId: member.id,
      })
      await writeAudit({
        organizationId: session.organizationId,
        actorUserId: null,
        action: AUDIT_ACTIONS.DEVICE_REMEMBERED,
        entityType: "MemberDevice",
        entityId: result.deviceId,
        after: { memberId: member.id, autoRevoked: result.revokedDeviceIds.length > 0 },
      })
      for (const revokedId of result.revokedDeviceIds) {
        await writeAudit({
          organizationId: session.organizationId,
          actorUserId: null,
          action: AUDIT_ACTIONS.DEVICE_REVOKED,
          entityType: "MemberDevice",
          entityId: revokedId,
          after: { memberId: member.id, reason: "cap_reached" },
        })
      }
    }
  }

  switch (plan.outcome) {
    case "member_not_active":
      return { success: false, error: QR_ERRORS.memberNotActive }

    case "already_checked_in":
      await remember()
      return { success: true, outcome: "already_checked_in", memberName }

    case "check_in": {
      const checkIn = await prisma.checkIn.create({
        data: {
          organizationId: session.organizationId,
          memberId: member.id,
          locationId: session.locationId,
          qrSessionId: session.id,
          source: "QR_SESSION",
          dayKey: todayKey,
        },
      })

      const actor = await getCurrentUser()
      await writeAudit({
        organizationId: session.organizationId,
        actorUserId: actor?.id ?? null,
        action: AUDIT_ACTIONS.CHECKIN_QR,
        entityType: "CheckIn",
        entityId: checkIn.id,
        after: {
          memberId: member.id,
          dayKey: todayKey,
          source: "QR_SESSION",
          qrSessionId: session.id,
          anonymous: !actor,
        },
      })

      await remember()
      revalidatePath("/dashboard/attendance")
      return { success: true, outcome: "checked_in", memberName }
    }

    case "request_attendance": {
      // Anti-spam: at most one request per member per org-local day. If one
      // already exists, surface its state instead of stacking duplicates.
      if (existingRequest) {
        await remember()
        return {
          success: true,
          outcome:
            existingRequest.status === "REJECTED" ? "request_rejected" : "request_pending",
          memberName,
        }
      }

      let requestId: string
      try {
        const created = await prisma.attendanceRequest.create({
          data: {
            organizationId: session.organizationId,
            memberId: member.id,
            qrSessionId: session.id,
            source: "QR_SESSION",
            status: "PENDING",
            dayKey: todayKey,
            requestedAt: now,
          },
          select: { id: true },
        })
        requestId = created.id
      } catch (error) {
        // A concurrent scan created the request first — report it as pending.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          await remember()
          return { success: true, outcome: "request_pending", memberName }
        }
        throw error
      }

      await notifyStaffOfPendingRequest(session.organizationId, memberName)

      await writeAudit({
        organizationId: session.organizationId,
        actorUserId: null,
        action: AUDIT_ACTIONS.ATTENDANCE_REQUEST_CREATED,
        entityType: "AttendanceRequest",
        entityId: requestId,
        after: { memberId: member.id, dayKey: todayKey, source: "QR_SESSION", qrSessionId: session.id },
      })

      await remember()
      revalidatePath("/dashboard/attendance")
      revalidatePath("/dashboard/attendance/requests")
      return { success: true, outcome: "request_pending", memberName }
    }
  }
}

/**
 * Notify every active OWNER/ADMIN of the gym through the existing Notification
 * inbox (staff-only by design). Member-facing notifications do not exist yet;
 * the owner reviews pending requests in the dashboard.
 */
async function notifyStaffOfPendingRequest(
  organizationId: string,
  memberName: string
): Promise<void> {
  const staff = await prisma.user.findMany({
    where: {
      organizationId,
      role: { in: ["OWNER", "ADMIN"] },
      status: "ACTIVE",
    },
    select: { id: true },
  })
  if (staff.length === 0) return
  await prisma.notification.createMany({
    data: staff.map((user) => ({
      organizationId,
      userId: user.id,
      type: "ATTENDANCE_REQUEST",
      title: "Attendance request pending",
      body: `${memberName} scanned QR with an expired/inactive membership and needs review.`,
      link: "/dashboard/attendance/requests",
    })),
  })
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
    action: AUDIT_ACTIONS.QR_SESSION_REVOKED,
    entityType: "QRSession",
    entityId: sessionId,
  })

  revalidatePath("/dashboard/attendance")
  return { success: true }
}

/**
 * First-time scan: member picked from the search list. The device is only
 * remembered when the member explicitly opts in (`rememberDevice`).
 */
export async function qrCheckin(
  token: string,
  memberId: string,
  rememberDevice = false
): Promise<QrCheckinResult> {
  const parsed = qrCheckinSchema.safeParse({ token, memberId, rememberDevice })
  if (!parsed.success) return { success: false, error: QR_ERRORS.invalid }

  const resolution = await resolveQrSession(parsed.data.token)
  if (!resolution.ok) {
    return { success: false, error: qrSessionError(resolution.error) }
  }
  const session = resolution.context

  const member = await resolveMember(session.organizationId, parsed.data.memberId)
  if (!member) return { success: false, error: QR_ERRORS.memberNotFound }

  return performQrScan({
    session,
    member,
    rememberDevice: parsed.data.rememberDevice,
  })
}

/**
 * Repeat scan: identity comes from the remembered-device cookie. If the device
 * cannot be resolved (missing/revoked/wrong gym/member no longer active), the
 * caller silently falls back to the member-search flow — never an error wall.
 */
export async function autoQrCheckin(token: string): Promise<QrCheckinResult> {
  const device = await resolveDeviceMember()
  if (!device) return { success: false, error: "", code: "device_not_found" }

  const resolution = await resolveQrSession(token)
  if (!resolution.ok) {
    return { success: false, error: qrSessionError(resolution.error) }
  }
  const session = resolution.context

  // Tenant isolation: the device cookie must belong to the SAME gym as the QR
  // being scanned, otherwise fall back to search (the cookie never leaks which
  // gym it belongs to).
  if (device.organizationId !== session.organizationId) {
    return { success: false, error: "", code: "device_not_found" }
  }

  const member = await resolveMember(session.organizationId, device.memberId)
  if (!member) return { success: false, error: "", code: "device_not_found" }

  return performQrScan({ session, member, rememberDevice: false, device })
}