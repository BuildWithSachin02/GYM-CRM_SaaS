"use client"

import { Dumbbell } from "lucide-react"

import type { PlanInterval } from "@prisma/client"
import { pluralize } from "@/lib/format"

import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { Button } from "@/components/ui/button"
import { PlanCard } from "@/components/plans/plan-card"
import { PlanForm } from "@/components/plans/plan-form"

type SerializedPlan = {
  id: string
  name: string
  billingInterval: PlanInterval
  priceMinor: number
  currency: string
  durationDays: number
  description: string | null
  active: boolean
  updatedAt: string
  /** Distinct members with a non-cancelled membership on this plan. */
  memberCount: number
}

type PlanListProps = {
  plans: SerializedPlan[]
  canManage: boolean
}

export function PlanList({ plans, canManage }: PlanListProps) {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Plans"
        description={`${plans.length} ${pluralize(plans.length, "plan")} total`}
        actions={
          canManage ? (
            <PlanForm
              trigger={
                <Button>
                  <Dumbbell className="size-4" /> Add Plan
                </Button>
              }
            />
          ) : undefined
        }
      />

      {plans.length === 0 ? (
        <EmptyState
          icon={Dumbbell}
          title="No plans yet"
          description="Create a membership plan to start enrolling members."
          actionLabel={canManage ? "Add Plan" : undefined}
          actionHref={canManage ? "/dashboard/plans?action=new" : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} canManage={canManage} />
          ))}
        </div>
      )}
    </div>
  )
}
