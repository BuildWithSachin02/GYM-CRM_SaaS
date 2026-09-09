"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Users, Plus, SearchIcon, Clock, XCircle } from "lucide-react"
import type { MembershipStatus } from "@prisma/client"

import { formatDate } from "@/lib/format"
import { MEMBERSHIP_STATUS } from "@/lib/status"

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
  planName: string
  startDate: string
  endDate: string
  status: MembershipStatus
  daysLeft: number | null
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
}

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "EXPIRED", label: "Expired" },
  { value: "CANCELLED", label: "Cancelled" },
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Memberships"
        description={`${totalCount} ${totalCount === 1 ? "membership" : "memberships"} total`}
        actions={
          canManage ? (
            <MembershipForm
              members={members}
              plans={plans}
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

        <div className="flex gap-1">
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
                  <TableHead>Member</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberships.map((m) => {
                  const canRenew =
                    canManage &&
                    (m.status === "EXPIRED" ||
                      (m.status === "ACTIVE" && m.daysLeft !== null && m.daysLeft <= 7))

                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <Link
                          href={`/dashboard/members/${m.memberId}`}
                          className="font-medium hover:text-primary"
                        >
                          {m.memberName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {m.planName}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(m.startDate)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(m.endDate)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={MEMBERSHIP_STATUS[m.status]?.tone ?? "muted"}
                        >
                          {MEMBERSHIP_STATUS[m.status]?.label ?? m.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canRenew && (
                          <RenewalForm
                            membership={{
                              id: m.id,
                              memberId: m.memberId,
                              memberName: m.memberName,
                              planName: m.planName,
                              endDate: m.endDate,
                            }}
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
