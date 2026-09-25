"use client"

import Link from "next/link"
import { ArrowLeft, Users } from "lucide-react"

import type { PlanInterval } from "@prisma/client"
import type { MembershipLifecycleStatus } from "@/lib/memberships"
import { formatDate, formatMoney, pluralize } from "@/lib/format"
import { MEMBERSHIP_LIFECYCLE_STATUS } from "@/lib/status"

import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { StatusBadge } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type SerializedMember = {
  memberId: string
  memberName: string
  memberCode: string | null
  phone: string
  status: MembershipLifecycleStatus
  daysLeft: number | null
  startDate: string
  endDate: string
  amountMinor: number
}

type PlanMembersListProps = {
  plan: {
    id: string
    name: string
    billingInterval: PlanInterval
    priceMinor: number
    currency: string
    durationDays: number
    active: boolean
  }
  members: SerializedMember[]
  /** Business date (YYYY-MM-DD) in the org's timezone. */
  todayKey: string
  canViewMembers: boolean
}

export function PlanMembersList({
  plan,
  members,
  todayKey,
  canViewMembers,
}: PlanMembersListProps) {
  const returnTo = encodeURIComponent(`/dashboard/plans/${plan.id}/members`)

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${plan.name} Members`}
        description={`${members.length} ${pluralize(members.length, "member")} on this plan${
          plan.active ? "" : " (plan inactive)"
        }`}
        actions={
          <Button variant="outline" render={<Link href="/dashboard/plans" />}>
            <ArrowLeft className="size-4" /> Back to Plans
          </Button>
        }
      />

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No members yet"
          description="No one is currently enrolled in this plan."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Start Date</TableHead>
              <TableHead>End Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m, index) => {
              const statusEntry = MEMBERSHIP_LIFECYCLE_STATUS[m.status]
              return (
                <TableRow key={m.memberId}>
                  <TableCell className="w-10 text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </TableCell>
                  <TableCell>
                    {canViewMembers ? (
                      <Link
                        href={`/dashboard/members/${m.memberId}?returnTo=${returnTo}`}
                        className="font-medium hover:text-primary"
                      >
                        {m.memberName}
                      </Link>
                    ) : (
                      <span className="font-medium">{m.memberName}</span>
                    )}
                    {m.memberCode && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {m.memberCode}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.phone}</TableCell>
                  <TableCell>
                    <StatusBadge tone={statusEntry?.tone ?? "muted"}>
                      {statusEntry?.label ?? m.status}
                    </StatusBadge>
                    {m.status === "EXPIRING_SOON" && m.daysLeft !== null && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {m.daysLeft}d
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(m.startDate)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(m.endDate)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoney(m.amountMinor, plan.currency)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <p className="text-xs text-muted-foreground">
        Business date: {todayKey}. Member counts and statuses use the same
        coverage engine as the rest of the app.
      </p>
    </div>
  )
}