import type { Metadata } from "next"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"

import { PlanList } from "@/components/plans/plan-list"

export const metadata: Metadata = {
  title: "Plans",
}

export default async function PlansPage() {
  const user = await requireUser()

  const plans = await prisma.membershipPlan.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { priceMinor: "asc" },
    select: {
      id: true,
      name: true,
      billingInterval: true,
      priceMinor: true,
      currency: true,
      durationDays: true,
      description: true,
      active: true,
      updatedAt: true,
    },
  })

  // Member-centric counts: a "member on this plan" is a distinct member holding
  // at least one non-cancelled membership record — NOT the raw membership-row
  // count (which would double-count members with PAUSED + EXPIRED records and
  // is what the raw `_count` used to show). CANCELLED records and archived
  // members never count.
  const memberships = await prisma.membership.findMany({
    where: { organizationId: user.organizationId },
    select: {
      planId: true,
      memberId: true,
      status: true,
      member: { select: { id: true, deletedAt: true } },
    },
  })

  const memberIdsByPlan = new Map<string, Set<string>>()
  for (const row of memberships) {
    if (row.status === "CANCELLED" || row.member.deletedAt) continue
    const ids = memberIdsByPlan.get(row.planId) ?? new Set<string>()
    ids.add(row.memberId)
    memberIdsByPlan.set(row.planId, ids)
  }

  const serializedPlans = plans.map((plan) => ({
    ...plan,
    updatedAt: plan.updatedAt.toISOString(),
    memberCount: memberIdsByPlan.get(plan.id)?.size ?? 0,
  }))

  return <PlanList plans={serializedPlans} canManage={can(user, "plans:manage")} />
}
