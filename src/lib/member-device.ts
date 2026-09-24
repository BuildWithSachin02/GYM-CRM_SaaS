import "server-only"

import { cookies } from "next/headers"

import { prisma } from "@/lib/prisma"
import {
  generateDeviceToken,
  hashDeviceToken,
} from "@/lib/device-tokens"

/**
 * Trusted-device identification for QR attendance (server-side).
 *
 * Security contract:
 *   - The raw token lives only in an HttpOnly cookie scoped to `/attendance/qr`
 *     (the QR pages). Only its SHA-256 hash is stored in MemberDevice.
 *   - The cookie content is indistinguishable from random and NEVER encodes the
 *     memberId or organizationId.
 *   - A remember= association is therefore an IDENTIFICATION convenience only.
 *     Authorization (membership validity, tenant, duplicates, eligibility) is
 *     always re-validated server-side on every scan — see qr-attendance.ts.
 *   - Tenant isolation is enforced by the caller: device.organizationId must
 *     equal the QRSession.organizationId. When it does not match (e.g. the
 *     same browser opens a QR of a different gym), resolution simply fails and
 *     the caller silently falls back to member search.
 */

export const DEVICE_COOKIE = "gym_device"
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 60 // 60 days
export const MAX_DEVICES_PER_MEMBER = 3

export type ResolvedDeviceMember = {
  deviceId: string
  memberId: string
  organizationId: string
  firstName: string
  lastName: string
}

function deviceCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/attendance/qr",
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
  } as const
}

/** The raw device token from the browser cookie, if present. */
export async function readDeviceToken(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(DEVICE_COOKIE)?.value ?? null
}

/**
 * Resolve the remembered member from the device cookie.
 *
 * Returns null — never throws — when the cookie is missing, the stored hash is
 * revoked, the member was archived/inactivated, or the member row disappeared.
 * Callers treat null as "fall back silently to the member-search flow".
 */
export async function resolveDeviceMember(): Promise<ResolvedDeviceMember | null> {
  const token = await readDeviceToken()
  if (!token) return null

  const tokenHash = hashDeviceToken(token)
  const device = await prisma.memberDevice.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      memberId: true,
      organizationId: true,
      revokedAt: true,
      member: {
        select: { firstName: true, lastName: true, status: true, deletedAt: true },
      },
    },
  })

  if (!device || device.revokedAt) return null
  if (device.member.status !== "ACTIVE" || device.member.deletedAt !== null) {
    return null
  }

  return {
    deviceId: device.id,
    memberId: device.memberId,
    organizationId: device.organizationId,
    firstName: device.member.firstName,
    lastName: device.member.lastName,
  }
}

/**
 * Create (or refresh) a trusted-device association for a member and set the
 * cookie. At most `MAX_DEVICES_PER_MEMBER` active devices exist per member:
 * when the cap is reached the oldest active device is automatically revoked so
 * revoking still always works from the member profile's device list.
 */
export async function rememberDevice(args: {
  organizationId: string
  memberId: string
}): Promise<{ deviceId: string; revokedDeviceIds: string[] }> {
  const token = generateDeviceToken()
  const tokenHash = hashDeviceToken(token)

  let deviceId = ""
  let revokedDeviceIds: string[] = []
  await prisma.$transaction(async (tx) => {
    const active = await tx.memberDevice.findMany({
      where: {
        organizationId: args.organizationId,
        memberId: args.memberId,
        revokedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    })

    if (active.length >= MAX_DEVICES_PER_MEMBER) {
      const excess = active.length - MAX_DEVICES_PER_MEMBER + 1
      const toRevoke = active.slice(0, Math.max(excess, 0))
      if (toRevoke.length > 0) {
        revokedDeviceIds = toRevoke.map((d) => d.id)
        await tx.memberDevice.updateMany({
          where: { id: { in: revokedDeviceIds } },
          data: { revokedAt: new Date() },
        })
      }
    }

    const created = await tx.memberDevice.create({
      data: {
        organizationId: args.organizationId,
        memberId: args.memberId,
        tokenHash,
      },
      select: { id: true },
    })
    deviceId = created.id
  })

  const cookieStore = await cookies()
  cookieStore.set(DEVICE_COOKIE, token, deviceCookieOptions())

  return { deviceId, revokedDeviceIds }
}

/** Refresh "last used at" for a device whose member was just identified. */
export async function touchDevice(deviceId: string): Promise<void> {
  await prisma.memberDevice.update({
    where: { id: deviceId },
    data: { lastUsedAt: new Date() },
  })
}