"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Users, SearchIcon } from "lucide-react"

import { formatDate } from "@/lib/format"
import { LEAD_STAGE, LEAD_SOURCE } from "@/lib/status"
import type { LeadStage, LeadSource } from "@prisma/client"

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
import { LeadForm } from "@/components/leads/lead-form"

type SerializedLead = {
  id: string
  name: string
  phone: string
  email: string | null
  source: LeadSource
  sourceDetail: string | null
  stage: LeadStage
  followUpDate: string | null
  createdAt: string
  ownerName: string | null
  activityCount: number
}

type LeadListProps = {
  leads: SerializedLead[]
  totalCount: number
  totalPages: number
  filters: { q: string; stage: string; page: number }
  canCreate: boolean
}

const STAGE_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "NEW", label: "New" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "VISIT_SCHEDULED", label: "Visit Scheduled" },
  { value: "VISIT_DONE", label: "Visit Done" },
  { value: "CONVERTED", label: "Converted" },
  { value: "LOST", label: "Lost" },
]

export function LeadList({
  leads,
  totalCount,
  totalPages,
  filters,
  canCreate,
}: LeadListProps) {
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
          router.push(`/dashboard/leads?${params.toString()}`)
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

  function setStageFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set("stage", value)
    } else {
      params.delete("stage")
    }
    params.delete("page")
    startTransition(() => {
      router.push(`/dashboard/leads?${params.toString()}`)
    })
  }

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(page))
    startTransition(() => {
      router.push(`/dashboard/leads?${params.toString()}`)
    })
  }

  const currentPage = filters.page
  const hasPrev = currentPage > 1
  const hasNext = currentPage < totalPages

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leads"
        description={`${totalCount} ${totalCount === 1 ? "lead" : "leads"} total`}
        actions={
          canCreate ? (
            <LeadForm
              trigger={
                <Button>
                  <Users className="size-4" /> Add Lead
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

        <div className="flex gap-1 overflow-x-auto">
          {STAGE_TABS.map((tab) => (
            <Button
              key={tab.value}
              variant={filters.stage === tab.value ? "outline" : "ghost"}
              size="sm"
              onClick={() => setStageFilter(tab.value)}
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

      {!isPending && leads.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No leads found"
          description={
            filters.q || filters.stage
              ? "Try adjusting your search or filters."
              : "Get started by adding your first lead."
          }
        />
      ) : (
        !isPending && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Follow-up</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => {
                  const stageEntry = LEAD_STAGE[lead.stage]
                  const sourceEntry = LEAD_SOURCE[lead.source]

                  return (
                    <TableRow key={lead.id}>
                      <TableCell>
                        <Link
                          href={`/dashboard/leads/${lead.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {lead.name}
                        </Link>
                        {lead.ownerName && (
                          <p className="text-xs text-muted-foreground">
                            Owner: {lead.ownerName}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {lead.phone}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={sourceEntry?.tone ?? "muted"}>
                          {sourceEntry?.label ?? lead.source}
                        </StatusBadge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={stageEntry?.tone ?? "muted"}>
                          {stageEntry?.label ?? lead.stage}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(lead.followUpDate)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(lead.createdAt)}
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
