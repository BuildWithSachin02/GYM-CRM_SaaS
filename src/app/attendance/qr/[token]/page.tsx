import { createHash } from "node:crypto"

import { prisma } from "@/lib/prisma"
import { resolveDeviceMember } from "@/lib/member-device"
import { maskPhone, type IdentitySummary } from "@/lib/qr-attendance"
import { dayKeyInTimeZone, getMemberCoverage } from "@/lib/memberships"

import { QrCheckin, type Member, type RememberedMember } from "@/components/attendance/qr-checkin"

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
      organization: { select: { timezone: true } },
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

  const timeZone = session.organization.timezone
  const todayKey = dayKeyInTimeZone(new Date(), timeZone)

  const members = await prisma.member.findMany({
    where: {
      organizationId: session.organizationId,
      status: "ACTIVE",
      deletedAt: null,
    },
    select: { id: true, firstName: true, lastName: true, phone: true },
    orderBy: { firstName: "asc" },
  })

  // Current plan label per member for the identity-confirmation screen. Only a
  // MASKED phone and the plan name reach the client — never the raw number.
  const membershipRows = await prisma.membership.findMany({
    where: {
      organizationId: session.organizationId,
      memberId: { in: members.map((m) => m.id) },
    },
    select: {
      memberId: true,
      id: true,
      startDate: true,
      endDate: true,
      status: true,
      plan: { select: { name: true } },
    },
  })

  const rowsByMember = new Map<string, typeof membershipRows>()
  for (const row of membershipRows) {
    const list = rowsByMember.get(row.memberId)
    if (list) list.push(row)
    else rowsByMember.set(row.memberId, [row])
  }

  const memberList: Member[] = members.map((m) => {
    const rows = rowsByMember.get(m.id) ?? []
    const coverage = getMemberCoverage(rows, timeZone, todayKey)
    const planLabel = coverage.coveredToday
      ? (rows
          .filter((r) => r.status !== "CANCELLED" && r.status !== "PAUSED")
          .map((r) => ({
            ...r,
            startKey: dayKeyInTimeZone(r.startDate, timeZone),
            endKey: dayKeyInTimeZone(r.endDate, timeZone),
          }))
          .filter((r) => r.startKey <= todayKey && todayKey <= r.endKey)
          .sort(
            (a, b) =>
              b.endKey.localeCompare(a.endKey) || b.startKey.localeCompare(a.startKey)
          )[0]?.plan.name ?? null)
      : null
    const identity: IdentitySummary = {
      name: `${m.firstName} ${m.lastName}`,
      maskedPhone: maskPhone(m.phone),
      membershipPlanName: planLabel,
    }
    return { id: m.id, firstName: m.firstName, lastName: m.lastName, identity }
  })

  // Trusted device present and, crucially, belonging to the SAME gym as this
  // QR? Auto-check-in it. Anything else (other gym, revoked, inactive member)
  // silently renders the ordinary member-search screen instead.
  const device = await resolveDeviceMember()
  const rememberedMember: RememberedMember | null =
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
      members={memberList}
      rememberedMember={rememberedMember}
    />
  )
}