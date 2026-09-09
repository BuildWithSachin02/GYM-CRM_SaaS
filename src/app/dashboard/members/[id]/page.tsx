import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"

import { MemberProfile } from "@/components/members/member-profile"

type PageProps = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const user = await requireUser()

  const member = await prisma.member.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    select: { firstName: true, lastName: true },
  })

  return {
    title: member ? `${member.firstName} ${member.lastName}` : "Member",
  }
}

export default async function MemberDetailPage({ params }: PageProps) {
  const { id } = await params
  const user = await requireUser()

  const member = await prisma.member.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      gender: true,
      dateOfBirth: true,
      address: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      signupSource: true,
      notes: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      memberships: {
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          startDate: true,
          endDate: true,
          status: true,
          plan: {
            select: {
              name: true,
              billingInterval: true,
              priceMinor: true,
              durationDays: true,
            },
          },
        },
      },
      payments: {
        orderBy: { paymentDate: "desc" },
        take: 10,
        select: {
          id: true,
          amountMinor: true,
          method: true,
          paymentDate: true,
          reference: true,
          notes: true,
          createdAt: true,
          recordedBy: {
            select: { name: true },
          },
        },
      },
      _count: {
        select: { checkIns: true },
      },
    },
  })

  if (!member) {
    notFound()
  }

  const serialized = {
    ...member,
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
    dateOfBirth: member.dateOfBirth?.toISOString() ?? null,
    memberships: member.memberships.map((m) => ({
      ...m,
      startDate: m.startDate.toISOString(),
      endDate: m.endDate.toISOString(),
    })),
    payments: member.payments.map((p) => ({
      ...p,
      paymentDate: p.paymentDate.toISOString(),
      createdAt: p.createdAt.toISOString(),
    })),
    checkInCount: member._count.checkIns,
  }

  return (
    <MemberProfile
      member={serialized}
      canUpdate={can(user, "members:update")}
      canArchive={can(user, "members:archive")}
    />
  )
}
