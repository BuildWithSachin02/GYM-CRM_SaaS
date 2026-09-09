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
      _count: {
        select: { memberships: true },
      },
    },
  })

  const serializedPlans = plans.map((plan) => ({
    ...plan,
    updatedAt: plan.updatedAt.toISOString(),
  }))

  return <PlanList plans={serializedPlans} canManage={can(user, "plans:manage")} />
}
