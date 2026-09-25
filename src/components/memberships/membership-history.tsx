"use client"

import Link from "next/link"
import { ArrowLeft, ScrollText } from "lucide-react"
import type { MembershipLifecycleStatus } from "@/lib/memberships"

import { formatDate, formatDayKey, formatMoney } from "@/lib/format"
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
import { RenewalForm } from "@/components/memberships/renewal-form"

type SerializedMembership = {
  id: string
  planId: string
  planName: string
  startDate: string
  endDate: string
  status: MembershipLifecycleStatus
  daysLeft: number | null
  /** Server-computed earliest valid renewal start (YYYY-MM-DD). */
  suggestedStart: string
  /** Farthest valid coverage end (YYYY-MM-DD) across this member's records. */
  coverageThroughKey: string | null
  /** True when this record's period is covered further by another record. */
  renewedThrough: boolean
  /** Member-level "needs renewal now" flag (server decision from total coverage). */
  canRenew: boolean
  /** Amount actually charged for this membership (minor units). */
  amountMinor: number
  /** Sum of RECORDED payments settled against this membership. */
  paidMinor: number
  /** amountMinor - paidMinor; never negative (overpayment is rejected). */
  outstandingMinor: number
  /** Commitment date (ISO) the balance is due by, or null. */
  expectedPaymentDate: string | null
}

type MembershipHistoryProps = {
  memberId: string
  memberName: string
  memberCode?: string | null
  memberships: SerializedMembership[]
  plans: { id: string; name: string; priceMinor: number; durationDays: number }[]
  canManage: boolean
}

export function MembershipHistory({
  memberId,
  memberName,
  memberCode,
  memberships,
  plans,
  canManage,
}: MembershipHistoryProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title={memberName}
        description={`${memberCode ? `${memberCode} · ` : ""}${memberships.length} ${
          memberships.length === 1 ? "membership record" : "membership records"
        } (all-time history)`}
        actions={
          <Button variant="outline" render={<Link href="/dashboard/memberships" />}>
            <ArrowLeft className="size-4" /> Back to all memberships
          </Button>
        }
      />

      {memberships.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No membership history"
          description="This member has no memberships yet."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-muted-foreground">#</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              <TableHead>Start Date</TableHead>
              <TableHead>End Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {memberships.map((m, index) => {
              const canRenew = canManage && m.canRenew

              return (
                <TableRow key={m.id}>
                  <TableCell className="w-10 text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </TableCell>
                  <TableCell className="font-medium">{m.planName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(m.amountMinor)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatMoney(m.paidMinor)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      m.outstandingMinor > 0
                        ? "font-semibold text-red-600 dark:text-red-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {formatMoney(m.outstandingMinor)}
                    {m.outstandingMinor > 0 && m.expectedPaymentDate && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        expected {formatDate(m.expectedPaymentDate)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(m.startDate)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(m.endDate)}
                    {(m.status === "ACTIVE" ||
                      m.status === "EXPIRING_SOON" ||
                      m.status === "UPCOMING") &&
                      m.renewedThrough &&
                      m.coverageThroughKey && (
                        <span className="block text-xs text-muted-foreground">
                          covered through {formatDayKey(m.coverageThroughKey)}
                        </span>
                      )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={MEMBERSHIP_LIFECYCLE_STATUS[m.status]?.tone ?? "muted"}
                    >
                      {MEMBERSHIP_LIFECYCLE_STATUS[m.status]?.label ?? m.status}
                    </StatusBadge>
                    {m.status === "EXPIRING_SOON" && m.daysLeft !== null && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {m.daysLeft}d
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {canRenew && (
                      <RenewalForm
                        membership={{
                          id: m.id,
                          memberId,
                          memberName,
                          planId: m.planId,
                          planName: m.planName,
                          endDate: m.endDate,
                          status:
                            m.status === "EXPIRING_SOON" ? "EXPIRING_SOON" : "EXPIRED",
                        }}
                        suggestedStart={m.suggestedStart}
                        coverageThroughKey={m.coverageThroughKey}
                        renewedThrough={m.renewedThrough}
                        plans={plans}
                        trigger={
                          <Button variant="outline" size="sm">
                            Renew
                          </Button>
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}