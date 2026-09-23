"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Users, Plus, SearchIcon, Clock, XCircle, History } from "lucide-react"
import type { MembershipLifecycleStatus } from "@/lib/memberships"

import { formatDate, formatDayKey, formatMoney } from "@/lib/format"
import { MEMBERSHIP_LIFECYCLE_STATUS } from "@/lib/status"

import { PageHeader } from "@/components/common/page-header"
import { StatCard } from "@/components/common/stat-card"
import { EmptyState } from "@/components/common/empty-state"
import { StatusBadge } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { MembershipForm } from "@/components/memberships/membership-form"
import { RenewalForm } from "@/components/memberships/renewal-form"

type SerializedMembership = {
  id: string
  memberId: string
  memberName: string
  planId: string
  planName: string
  startDate: string
  endDate: string
  status: MembershipLifecycleStatus
  daysLeft: number | null
  /** Total membership records for this member (1 = no history). */
  historyCount: number
  /** Server-computed earliest valid renewal start (YYYY-MM-DD). */
  suggestedStart: string
  /** Farthest valid coverage end (YYYY-MM-DD) across the member's records. */
  coverageThroughKey: string | null
  /** True when this display period is covered further by another record. */
  renewedThrough: boolean
  /** Whether the member has any record eligible to renew (server decision). */
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

type MembershipListProps = {
  memberships: SerializedMembership[]
  totalCount: number
  totalPages: number
  filters: { q: string; status: string; page: number }
  stats: { totalActive: number; expiringIn7Days: number; expired: number }
  members: { id: string; firstName: string; lastName: string }[]
  plans: { id: string; name: string; priceMinor: number; durationDays: number }[]
  canManage: boolean
  /** Business date (YYYY-MM-DD) in the org's timezone. */
  todayKey: string
}

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  ...Object.entries(MEMBERSHIP_LIFECYCLE_STATUS).map(([value, { label }]) => ({
    value,
    label,
  })),
]

export function MembershipList({
  memberships,
  totalCount,
  totalPages,
  filters,
  stats,
  members,
  plans,
  canManage,
  todayKey,
}: MembershipListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [searchValue, setSearchValue] = useState(filters.q)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updateSearch = useCallback(
    (value: string) => {
      setSearchValue(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString())
        if (value) {
          params.set("q", value)
        } else {
          params.delete("q")
        }
        params.delete("page")
        params.delete("member")
        startTransition(() => {
          router.push(`/dashboard/memberships?${params.toString()}`)
        })
      }, 350)
    },
    [router, searchParams, startTransition]
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function setStatusFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set("status", value)
    } else {
      params.delete("status")
    }
    params.delete("page")
    params.delete("member")
    startTransition(() => {
      router.push(`/dashboard/memberships?${params.toString()}`)
    })
  }

  function goToPage(pg: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(pg))
    startTransition(() => {
      router.push(`/dashboard/memberships?${params.toString()}`)
    })
  }

  const currentPage = filters.page
  const hasPrev = currentPage > 1
  const hasNext = currentPage < totalPages

  // Current Memberships-list view (live filters) so a member profile opened
  // from this list can return to the exact filters/pagination it left.
  const listReturnTo = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("member")
    return `/dashboard/memberships?${params.toString()}`
  }, [searchParams])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Memberships"
        description={`${totalCount} ${totalCount === 1 ? "member" : "members"} with memberships (one current membership per member)`}
        actions={
          canManage ? (
            <MembershipForm
              members={members}
              plans={plans}
              todayKey={todayKey}
              trigger={
                <Button>
                  <Plus className="size-4" /> New Membership
                </Button>
              }
            />
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Active" value={stats.totalActive} icon={Users} />
        <StatCard
          label="Expiring in 7 days"
          value={stats.expiringIn7Days}
          icon={Clock}
          iconClassName="bg-amber-500/10 text-amber-600 dark:text-amber-400"
        />
        <StatCard
          label="Expired"
          value={stats.expired}
          icon={XCircle}
          iconClassName="bg-red-500/10 text-red-600 dark:text-red-400"
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by member name..."
            value={searchValue}
            onChange={(e) => updateSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map((tab) => (
            <Button
              key={tab.value}
              variant={filters.status === tab.value ? "outline" : "ghost"}
              size="sm"
              onClick={() => setStatusFilter(tab.value)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      {isPending && (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          Loading...
        </div>
      )}

      {!isPending && memberships.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No memberships found"
          description={
            filters.q || filters.status
              ? "Try adjusting your search or filters."
              : "Get started by creating the first membership."
          }
        />
      ) : (
        !isPending && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-muted-foreground">#</TableHead>
                  <TableHead>Member</TableHead>
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
                  const rowNumber = (currentPage - 1) * 25 + index + 1

                  return (
                    <TableRow key={m.memberId}>
                      <TableCell className="w-10 text-xs tabular-nums text-muted-foreground">
                        {rowNumber}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/dashboard/members/${m.memberId}?returnTo=${encodeURIComponent(listReturnTo)}`}
                          className="font-medium hover:text-primary"
                        >
                          {m.memberName}
                        </Link>
                        {m.historyCount > 1 && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {m.historyCount} records
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {m.planName}
                      </TableCell>
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
                          tone={
                            MEMBERSHIP_LIFECYCLE_STATUS[m.status]?.tone ?? "muted"
                          }
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
                        <div className="flex items-center justify-end gap-1.5">
                          {m.historyCount > 1 && (
                            <Button variant="ghost" size="sm" render={<Link href={`/dashboard/memberships?member=${m.memberId}`} />}>
                              <History className="size-4" /> History
                            </Button>
                          )}
                          {canRenew && (
                            <RenewalForm
                              membership={{
                                id: m.id,
                                memberId: m.memberId,
                                memberName: m.memberName,
                                planId: m.planId,
                                planName: m.planName,
                                endDate: m.endDate,
                                status: m.status === "EXPIRING_SOON" ? "EXPIRING_SOON" : "EXPIRED",
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
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </p>
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        text="Prev"
                        onClick={(e) => {
                          e.preventDefault()
                          if (hasPrev) goToPage(currentPage - 1)
                        }}
                        aria-disabled={!hasPrev}
                        className={
                          !hasPrev ? "pointer-events-none opacity-50" : "cursor-pointer"
                        }
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        text="Next"
                        onClick={(e) => {
                          e.preventDefault()
                          if (hasNext) goToPage(currentPage + 1)
                        }}
                        aria-disabled={!hasNext}
                        className={
                          !hasNext ? "pointer-events-none opacity-50" : "cursor-pointer"
                        }
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </>
        )
      )}
    </div>
  )
}