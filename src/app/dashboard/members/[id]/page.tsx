import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import {
  dayKeyInTimeZone,
  getMemberCoverage,
  getMembershipLifecycle,
  memberNeedsRenewal,
  nextValidRenewalStartKey,
  pickPrimaryMembership,
} from "@/lib/memberships"

import { MemberProfile } from "@/components/members/member-profile"
import { getMemberAttendanceOverview } from "@/lib/domain/member-attendance"

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
        orderBy: [{ endDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          memberId: true,
          startDate: true,
          endDate: true,
          status: true,
          amountMinor: true,
          plan: {
            select: {
              id: true,
              name: true,
              billingInterval: true,
              priceMinor: true,
              durationDays: true,
            },
          },
        },
      },
      payments: {
        where: { status: "RECORDED" },
        orderBy: { paymentDate: "desc" },
        take: 10,
        select: {
          id: true,
          amountMinor: true,
          method: true,
          status: true,
          paymentDate: true,
          reference: true,
          notes: true,
          createdAt: true,
          membership: {
            select: {
              id: true,
              startDate: true,
              endDate: true,
              plan: { select: { name: true } },
            },
          },
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

  const timeZone = user.organization.timezone
  const today = new Date()
  const todayKey = dayKeyInTimeZone(today, timeZone)

  const plans = await prisma.membershipPlan.findMany({
    where: { organizationId: user.organizationId, active: true },
    orderBy: { priceMinor: "asc" },
    select: { id: true, name: true, priceMinor: true, durationDays: true },
  })

  const attendanceOverview = await getMemberAttendanceOverview(
    user.organizationId,
    member.id,
    timeZone
  )

  // Member-level coverage: the summary badge/labels come from the union of
  // every valid period (the same rule as the memberships list), so a record
  // that ended but is chained to future coverage never reads "expiring".
  const coverage = getMemberCoverage(member.memberships, timeZone, todayKey)
  const primary = pickPrimaryMembership(member.memberships, timeZone, today)
  const coverageThroughKey = coverage.overallEndKey

  // Renewal is a genuine, server-computed action (not a copy of the list's
  // "Renew" affordance): only when today is inside the renewal window or
  // after expiry. When due, the profile opens the auto-dated renewal modal.
  const needsRenewal = memberNeedsRenewal(member.memberships, timeZone, todayKey)
  const suggestedStart = nextValidRenewalStartKey(
    member.memberships,
    timeZone,
    todayKey
  )
  const renewalContext =
    needsRenewal &&
    primary &&
    (primary.lifecycle.status === "EXPIRED" ||
      primary.lifecycle.status === "EXPIRING_SOON")
      ? {
          membershipId: primary.row.id,
          planId: primary.row.plan.id,
          planName: primary.row.plan.name,
          endDate: primary.row.endDate.toISOString(),
          status: primary.lifecycle.status,
          suggestedStart,
          coverageThroughKey,
          renewedThrough:
            coverageThroughKey != null &&
            coverageThroughKey >
              dayKeyInTimeZone(primary.row.endDate, timeZone),
        }
      : null

  const serialized = {
    ...member,
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
    dateOfBirth: member.dateOfBirth?.toISOString() ?? null,
    memberships: member.memberships.map((m) => {
      const lifecycle = getMembershipLifecycle({
        startDate: m.startDate,
        endDate: m.endDate,
        status: m.status,
        timeZone,
      })
      return {
        ...m,
        startDate: m.startDate.toISOString(),
        endDate: m.endDate.toISOString(),
        status: lifecycle.status,
        daysLeft: lifecycle.daysLeft,
        daysUntilStart: lifecycle.daysUntilStart,
        isPrimary: primary?.row.id === m.id,
        renewedThrough:
          coverageThroughKey != null &&
          coverageThroughKey > dayKeyInTimeZone(m.endDate, timeZone),
        coverageThroughKey,
        memberStatus: primary?.lifecycle.status ?? lifecycle.status,
        memberDaysLeft: primary?.lifecycle.daysLeft ?? lifecycle.daysLeft,
      }
    }),
    payments: member.payments.map((p) => ({
      ...p,
      paymentDate: p.paymentDate.toISOString(),
      createdAt: p.createdAt.toISOString(),
      membership: p.membership
        ? {
            ...p.membership,
            startDate: p.membership.startDate.toISOString(),
            endDate: p.membership.endDate.toISOString(),
          }
        : null,
    })),
    checkIns: attendanceOverview.recent,
    checkInCount: member._count.checkIns,
  }

  return (
    <MemberProfile
      member={serialized}
      attendance={attendanceOverview}
      timeZone={timeZone}
      canUpdate={can(user, "members:update")}
      canArchive={can(user, "members:archive")}
      canViewAttendance={can(user, "attendance:view")}
      canManageMemberships={can(user, "memberships:manage")}
      plans={plans}
      todayKey={todayKey}
      renewal={renewalContext}
    />
  )
}
