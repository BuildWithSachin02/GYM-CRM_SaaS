import { createHash } from "node:crypto"

import { prisma } from "@/lib/prisma"
import { resolveDeviceMember } from "@/lib/member-device"

import { QrCheckin } from "@/components/attendance/qr-checkin"

type QrTokenPageProps = {
  params: Promise<{ token: string }>
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export default async function QrTokenPage({ params }: QrTokenPageProps) {
  const { token } = await params
  const tokenHash = hashToken(token)

  const session = await prisma.qRSession.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      organizationId: true,
      expiresAt: true,
      revokedAt: true,
    },
  })

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    const errorMessage = !session
      ? "Invalid QR code."
      : session.revokedAt
        ? "This QR code has been deactivated."
        : "This QR code has expired."

    return <QrCheckin token={token} isValid={false} members={[]} errorMessage={errorMessage} />
  }

  const members = await prisma.member.findMany({
    where: {
      organizationId: session.organizationId,
      status: "ACTIVE",
      deletedAt: null,
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  })

  // Trusted device present and, crucially, belonging to the SAME gym as this
  // QR? Auto-check-in it. Anything else (other gym, revoked, inactive member)
  // silently renders the ordinary member-search screen instead.
  const device = await resolveDeviceMember()
  const rememberedMember =
    device && device.organizationId === session.organizationId
      ? {
          id: device.memberId,
          firstName: device.firstName,
          lastName: device.lastName,
        }
      : null

  return (
    <QrCheckin
      token={token}
      isValid={true}
      members={members}
      rememberedMember={rememberedMember}
    />
  )
}