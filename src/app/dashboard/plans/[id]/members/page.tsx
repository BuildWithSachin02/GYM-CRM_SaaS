import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { dayKeyInTimeZone, pickPrimaryMembership } from "@/lib/memberships"

import { PlanMembersList } from "@/components/plans/plan-members-list"

type PageProps = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const user = await requireUser()

  const plan = await prisma.membershipPlan.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { name: true },
  })

  return { title: plan ? `${plan.name} Members` : "Plan Members" }
}

export default async function PlanMembersPage({ params }: PageProps) {
  const { id } = await params
  const user = await requireUser()

  const plan = await prisma.membershipPlan.findFirst({
    where: { id, organizationId: user.organizationId },
    select: {
      id: true,
      name: true,
      billingInterval: true,
      priceMinor: true,
      currency: true,
      durationDays: true,
      active: true,
    },
  })

  if (!plan) {
    notFound()
  }

  // All non-cancelled records for this plan. Members are grouped per plan
  // (deduped by memberId); the primary display row per member comes from the
  // same coverage engine used everywhere, so counts here and on the plan card
  // ("View Members") always agree.
  const memberships = await prisma.membership.findMany({
    where: {
      organizationId: user.organizationId,
      planId: plan.id,
      status: { not: "CANCELLED" },
    },
    include: {
      member: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          deletedAt: true,
        },
      },
    },
    orderBy: [{ endDate: "desc" }, { createdAt: "desc" }],
  })

  const timeZone = user.organization.timezone
  const today = new Date()
  const todayKey = dayKeyInTimeZone(today, timeZone)

  const rowsByMember = new Map<string, typeof memberships>()
  for (const ms of memberships) {
    if (ms.member.deletedAt) continue
    const list = rowsByMember.get(ms.memberId) ?? []
    list.push(ms)
    rowsByMember.set(ms.memberId, list)
  }

  const entries = Array.from(rowsByMember.entries())
    .map(([memberId, rows]) => {
      const primary = pickPrimaryMembership(rows, timeZone, today)
      if (!primary) return null
      const { row, lifecycle } = primary
      return {
        memberId,
        memberName: `${row.member.firstName} ${row.member.lastName}`.trim(),
        phone: row.member.phone,
        status: lifecycle.status,
        daysLeft: lifecycle.daysLeft,
        startDate: row.startDate.toISOString(),
        endDate: row.endDate.toISOString(),
        amountMinor: row.amountMinor,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => a.memberName.localeCompare(b.memberName))

  return (
    <PlanMembersList
      plan={{
        id: plan.id,
        name: plan.name,
        billingInterval: plan.billingInterval,
        priceMinor: plan.priceMinor,
        currency: plan.currency,
        durationDays: plan.durationDays,
        active: plan.active,
      }}
      members={entries}
      todayKey={todayKey}
      canViewMembers={can(user, "members:view")}
    />
  )
}