"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Users, UserPlus, SearchIcon } from "lucide-react"

import { formatDate, fullName, initials } from "@/lib/format"
import { MEMBER_STATUS } from "@/lib/status"
import type { MemberStatus } from "@prisma/client"

import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { StatusBadge } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
import { MemberForm } from "@/components/members/member-form"

type SerializedMember = {
  id: string
  firstName: string
  lastName: string
  phone: string
  email: string | null
  status: MemberStatus
  createdAt: string
}

type MemberListProps = {
  members: SerializedMember[]
  totalCount: number
  totalPages: number
  filters: { q: string; status: string; page: number }
  canCreate: boolean
}

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  ...Object.entries(MEMBER_STATUS).map(([value, { label }]) => ({
    value,
    label,
  })),
]

export function MemberList({
  members,
  totalCount,
  totalPages,
  filters,
  canCreate,
}: MemberListProps) {
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
          router.push(`/dashboard/members?${params.toString()}`)
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
      router.push(`/dashboard/members?${params.toString()}`)
    })
  }

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(page))
    startTransition(() => {
      router.push(`/dashboard/members?${params.toString()}`)
    })
  }

  const currentPage = filters.page
  const hasPrev = currentPage > 1
  const hasNext = currentPage < totalPages

  return (
    <div className="space-y-4">
      <PageHeader
        title="Members"
        description={`${totalCount} ${totalCount === 1 ? "member" : "members"} total`}
        actions={
          canCreate ? (
            <MemberForm
              trigger={
                <Button>
                  <UserPlus className="size-4" /> Add Member
                </Button>
              }
            />
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, or email..."
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

      {!isPending && members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No members found"
          description={
            filters.q || filters.status
              ? "Try adjusting your search or filters."
              : "Get started by adding your first member."
          }
          actionLabel={canCreate && !filters.q && !filters.status ? "Add Member" : undefined}
          actionHref={canCreate && !filters.q && !filters.status ? "/dashboard/members?action=new" : undefined}
        />
      ) : (
        !isPending && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-muted-foreground">#</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member, index) => {
                  const name = fullName(member.firstName, member.lastName)
                  const statusEntry = MEMBER_STATUS[member.status]
                  const rowNumber = (currentPage - 1) * 25 + index + 1

                  return (
                    <TableRow key={member.id}>
                      <TableCell className="w-10 text-xs tabular-nums text-muted-foreground">
                        {rowNumber}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/dashboard/members/${member.id}`}
                          className="flex items-center gap-3 hover:text-primary"
                        >
                          <Avatar size="sm">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {initials(name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{name}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {member.phone}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {member.email ?? "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={statusEntry?.tone ?? "muted"}>
                          {statusEntry?.label ?? member.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(member.createdAt)}
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
                        className={!hasPrev ? "pointer-events-none opacity-50" : "cursor-pointer"}
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
                        className={!hasNext ? "pointer-events-none opacity-50" : "cursor-pointer"}
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
