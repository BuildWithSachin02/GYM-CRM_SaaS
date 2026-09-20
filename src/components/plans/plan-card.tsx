"use client"

import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Archive, ArchiveRestore, Pencil, Users } from "lucide-react"
import { toast } from "sonner"

import type { PlanInterval } from "@prisma/client"
import { formatMoney, pluralize } from "@/lib/format"
import { PLAN_INTERVAL } from "@/lib/status"

import { archivePlan } from "@/lib/actions/plans"
import { StatusBadge } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
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

export function PlanCard({ plan, canManage }: { plan: SerializedPlan; canManage: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const interval = PLAN_INTERVAL[plan.billingInterval]

  function handleArchive() {
    startTransition(async () => {
      const result = await archivePlan(plan.id)
      if (result.success) {
        toast.success(plan.active ? "Plan archived" : "Plan restored")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{plan.name}</CardTitle>
          <StatusBadge tone={plan.active ? "success" : "muted"}>
            {plan.active ? "Active" : "Inactive"}
          </StatusBadge>
        </div>
        <CardDescription>
          {plan.description || "No description"}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 space-y-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold">
            {formatMoney(plan.priceMinor, plan.currency)}
          </span>
          <span className="text-sm text-muted-foreground">
            / {interval.label.toLowerCase()}
          </span>
        </div>

        <Separator />

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Duration</span>
          <span className="font-medium">
            {plan.durationDays} {pluralize(plan.durationDays, "day")}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Members</span>
          <span className="font-medium">
            {plan.memberCount} {pluralize(plan.memberCount, "member")}
          </span>
        </div>
      </CardContent>

      <Separator className="mx-0" />
      <div className="flex items-center justify-between gap-2 p-(--card-spacing)">
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={`/dashboard/plans/${plan.id}/members`} />}
        >
          <Users className="size-3.5" /> View Members
        </Button>
        {canManage && (
          <div className="flex items-center justify-end gap-2">
            <PlanForm
              plan={plan}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil className="size-3.5" /> Edit
                </Button>
              }
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleArchive}
              disabled={isPending}
            >
              {plan.active ? (
                <>
                  <Archive className="size-3.5" /> Archive
                </>
              ) : (
                <>
                  <ArchiveRestore className="size-3.5" /> Restore
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
