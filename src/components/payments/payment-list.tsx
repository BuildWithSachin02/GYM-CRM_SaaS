"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Banknote, SearchIcon } from "lucide-react"
import type { PaymentMethod, PaymentStatus } from "@prisma/client"

import { formatDate, formatMoney, fullName } from "@/lib/format"
import { PAYMENT_METHOD, OUTSTANDING_STATUS, PAYMENT_STATUS } from "@/lib/status"
import { voidPayment } from "@/lib/actions/payments"

import { PageHeader } from "@/components/common/page-header"
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PaymentForm } from "@/components/payments/payment-form"

type SerializedMembershipLink = {
  id: string
  startDate: string
  endDate: string
  plan: { name: string }
}

type SerializedPayment = {
  id: string
  amountMinor: number
  method: PaymentMethod
  status: PaymentStatus
  reference: string | null
  paymentDate: string
  createdAt: string
  member: { id: string; firstName: string; lastName: string; phone: string }
  membership: SerializedMembershipLink | null
  recordedBy: { name: string }
}

type MemberOption = {
  id: string
  firstName: string
  lastName: string
  phone: string
  memberships: {
    id: string
    startDate: string
    endDate: string
    amountMinor: number
    status: string
    expectedPaymentDate: string | null
    paidMinor: number
    outstandingMinor: number
    plan: { name: string; priceMinor: number }
  }[]
}

type PaymentListProps = {
  payments: SerializedPayment[]
  totalCount: number
  totalPages: number
  filters: { q: string; method: string; from: string; to: string; page: number; dueStatus: string }
  canCreate: boolean
  members: MemberOption[]
}

const METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All Methods" },
  ...Object.entries(PAYMENT_METHOD).map(([value, { label }]) => ({
    value,
    label,
  })),
]

const DUE_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All Dues" },
  { value: "OVERDUE", label: OUTSTANDING_STATUS.OVERDUE.label },
  { value: "PENDING", label: OUTSTANDING_STATUS.PENDING.label },
]

export function PaymentList({
  payments,
  totalCount,
  totalPages,
  filters,
  canCreate,
  members,
}: PaymentListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [voidingId, setVoidingId] = useState<string | null>(null)

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
          router.push(`/dashboard/payments?${params.toString()}`)
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

  function updateFilters(key: "method" | "from" | "to" | "dueStatus", value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    params.delete("page")
    startTransition(() => {
      router.push(`/dashboard/payments?${params.toString()}`)
    })
  }

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(page))
    startTransition(() => {
      router.push(`/dashboard/payments?${params.toString()}`)
    })
  }

  function handleVoid() {
    if (!voidingId) return
    startTransition(async () => {
      const result = await voidPayment(voidingId)
      setVoidingId(null)
      if (result.success) {
        router.refresh()
      }
    })
  }

  const currentPage = filters.page
  const hasPrev = currentPage > 1
  const hasNext = currentPage < totalPages
  const hasFilters = !!(filters.q || filters.method || filters.from || filters.to || filters.dueStatus)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payments"
        description={`${totalCount} ${totalCount === 1 ? "payment" : "payments"} total`}
        actions={
          canCreate ? (
            <PaymentForm members={members} trigger={<Button>Record Payment</Button>} />
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by member name..."
            value={searchValue}
            onChange={(e) => updateSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Method</span>
            <Select value={filters.method} onValueChange={(v) => updateFilters("method", v ?? "")}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All Methods" />
              </SelectTrigger>
              <SelectContent>
                {METHOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Dues</span>
            <Select value={filters.dueStatus} onValueChange={(v) => updateFilters("dueStatus", v ?? "")}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All Dues" />
              </SelectTrigger>
              <SelectContent>
                {DUE_STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">From</span>
            <Input
              type="date"
              value={filters.from}
              onChange={(e) => updateFilters("from", e.target.value)}
              className="w-40"
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">To</span>
            <Input
              type="date"
              value={filters.to}
              onChange={(e) => updateFilters("to", e.target.value)}
              className="w-40"
            />
          </div>
        </div>
      </div>

      {isPending && (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          Loading...
        </div>
      )}

      {!isPending && payments.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title="No payments found"
          description={
            hasFilters
              ? "Try adjusting your search or filters."
              : "Record your first payment to get started."
          }
          actionLabel={canCreate && !hasFilters ? "Record Payment" : undefined}
          actionHref={
            canCreate && !hasFilters ? "/dashboard/payments?action=new" : undefined
          }
        />
      ) : (
        !isPending && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-muted-foreground">#</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Recorded By</TableHead>
                  {canCreate && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment, index) => {
                  const methodEntry = PAYMENT_METHOD[payment.method]
                  const statusEntry = PAYMENT_STATUS[payment.status]
                  const name = fullName(payment.member.firstName, payment.member.lastName)
                  const voidable = canCreate && payment.status === "RECORDED"
                  const rowNumber = (currentPage - 1) * 25 + index + 1

                  return (
                    <TableRow key={payment.id}>
                      <TableCell className="w-10 text-xs tabular-nums text-muted-foreground">
                        {rowNumber}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(payment.paymentDate)}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/dashboard/members/${payment.member.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {name}
                        </Link>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {payment.member.phone}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {payment.membership ? (
                          <span>
                            {payment.membership.plan.name} Membership
                            <span className="block text-xs">
                              {formatDate(payment.membership.startDate)} →{" "}
                              {formatDate(payment.membership.endDate)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs italic">
                            No membership linked
                            {payment.status !== "RECORDED" && " (legacy)"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatMoney(payment.amountMinor)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={methodEntry?.tone ?? "muted"}>
                          {methodEntry?.label ?? payment.method}
                        </StatusBadge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={statusEntry?.tone ?? "muted"}>
                          {statusEntry?.label ?? payment.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {payment.recordedBy.name}
                      </TableCell>
                      {canCreate && (
                        <TableCell className="text-right">
                          {voidable && (
                            <AlertDialog
                              open={voidingId === payment.id}
                              onOpenChange={(open) =>
                                setVoidingId(open ? payment.id : null)
                              }
                            >
                              <AlertDialogTrigger
                                render={
                                  <Button variant="outline" size="sm">
                                    Void
                                  </Button>
                                }
                              />
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Void payment?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will mark the {formatMoney(payment.amountMinor)}{" "}
                                    payment from {name} as voided. This action cannot be
                                    undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    variant="destructive"
                                    onClick={handleVoid}
                                  >
                                    Void Payment
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </TableCell>
                      )}
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
