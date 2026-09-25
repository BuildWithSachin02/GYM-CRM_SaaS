"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  BarChart3,
  CalendarCheck,
  CalendarRange,
  PenLine,
} from "lucide-react"

import { formatDayKey, formatTimeInZone } from "@/lib/format"

import { StatusBadge } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/empty-state"
import { StatCard } from "@/components/common/stat-card"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  AttendanceCorrectionDialog,
  type CorrectionMember,
} from "@/components/attendance/attendance-correction-dialog"
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
import { Input } from "@/components/ui/input"
import { AttendanceTrendChart } from "@/components/charts/attendance-trend-chart"
import { AttendanceCalendar, type AttendanceCalendarProps } from "@/components/attendance/attendance-calendar"

type Checkin = {
  id: string
  dayKey: string
  source: "MANUAL" | "QR_SESSION"
  checkedInAt: string
  locationName: string | null
}

type Preset = { id: string; label: string }

type MemberAttendancePageProps = {
  memberId: string
  memberName: string
  memberCode?: string | null
  timeZone: string
  presets: Preset[]
  range: { preset: string; fromKey: string | null; toKey: string | null }
  lifetimeTotal: number
  lifetimeStreakCurrent: number
  lifetimeStreakLongest: number
  stats: {
    visits: number
    distinctDays: number
    firstVisitKey: string | null
    lastVisitKey: string | null
    avgPerWeek: number
    currentStreak: number
    longestStreak: number
  }
  lastVisit: Checkin | null
  calendar: AttendanceCalendarProps
  trend: { day: string; count: number }[]
  checkIns: Checkin[]
  totalCount: number
  totalPages: number
  page: number
  pageSize: number
  /** Staff may correct a wrongly-attributed QR check-in (OWNER/ADMIN + permission). */
  canCorrect?: boolean
  /** Org-scoped ACTIVE members to pick from when correcting (excludes this member). */
  correctMembers?: CorrectionMember[]
}

const RANGE_LABELS: Record<string, string> = {
  TODAY: "Today",
  THIS_WEEK: "This Week",
  THIS_MONTH: "This Month",
  LAST_MONTH: "Last Month",
  THIS_YEAR: "This Year",
  ALL: "All Time",
  CUSTOM: "Custom Range",
}

export function MemberAttendancePage({
  memberId,
  memberName,
  memberCode = null,
  timeZone,
  presets,
  range,
  lifetimeTotal,
  lifetimeStreakCurrent,
  lifetimeStreakLongest,
  stats,
  lastVisit,
  calendar,
  trend,
  checkIns,
  totalCount,
  totalPages,
  page,
  pageSize,
  canCorrect = false,
  correctMembers = [],
}: MemberAttendancePageProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [customFrom, setCustomFrom] = useState(range.fromKey ?? "")
  const [customTo, setCustomTo] = useState(range.toKey ?? "")

  function hrefFor(updates: Record<string, string | null>): string {
    const sp = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") sp.delete(key)
      else sp.set(key, value)
    }
    if (!("page" in updates)) sp.delete("page")
    const qs = sp.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  function applyCustom() {
    if (!customFrom || !customTo) return
    router.push(
      hrefFor({ preset: "CUSTOM", from: customFrom, to: customTo })
    )
  }

  const rangeLabel =
    range.preset === "CUSTOM" || range.preset === "ALL"
      ? !range.fromKey && !range.toKey
        ? "All time"
        : range.fromKey && range.toKey
          ? `${formatDayKey(range.fromKey)} – ${formatDayKey(range.toKey)}`
          : range.fromKey
            ? `From ${formatDayKey(range.fromKey)}`
            : `Until ${formatDayKey(range.toKey)}`
      : RANGE_LABELS[range.preset] ?? "All time"

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{memberName}</h1>
          {memberCode && (
            <p className="text-xs font-medium text-muted-foreground">{memberCode}</p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            Attendance · {rangeLabel} · {totalCount.toLocaleString("en-IN")}{" "}
            {totalCount === 1 ? "check-in" : "check-ins"}
          </p>
        </div>
        <Button
          variant="ghost"
          render={<Link href={`/dashboard/members/${memberId}`} />}
        >
          <ArrowLeft className="size-4" /> Back to Profile
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-4">
          {presets.map((preset) => {
            const active = range.preset === preset.id
            return (
              <Button
                key={preset.id}
                variant={active ? "default" : "outline"}
                size="sm"
                render={<Link href={hrefFor({ preset: preset.id })} />}
              >
                {preset.label}
              </Button>
            )
          })}
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="w-40"
              aria-label="From date"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <Input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="w-40"
              aria-label="To date"
            />
            <Button variant="outline" size="sm" onClick={applyCustom} disabled={!customFrom || !customTo}>
              Apply
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Range stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Visits in Range"
          value={stats.visits.toLocaleString("en-IN")}
          icon={CalendarCheck}
        />
        <StatCard
          label="Avg / Week"
          value={stats.avgPerWeek.toLocaleString("en-IN", {
            maximumFractionDigits: 1,
          })}
          icon={BarChart3}
        />
        <StatCard
          label="Longest Streak"
          value={`${stats.longestStreak}d`}
          hint="in selected range"
          icon={CalendarRange}
        />
        <StatCard
          label="Last Visit"
          value={lastVisit ? formatDayKey(lastVisit.dayKey) : "—"}
          hint={lastVisit ? formatTimeInZone(lastVisit.checkedInAt, timeZone) : "No check-ins in range"}
          icon={CalendarCheck}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Lifetime: {lifetimeTotal.toLocaleString("en-IN")} visits · Current
        streak {lifetimeStreakCurrent}d · Longest all-time{" "}
        {lifetimeStreakLongest}d
      </p>

      {/* Calendar */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarCheck className="size-4" /> When does{" "}
            {memberName.split(" ")[0] ?? "this member"} usually come?
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AttendanceCalendar {...calendar} />
        </CardContent>
      </Card>

      {/* Trend */}
      {trend.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="size-4" /> Visits over time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AttendanceTrendChart data={trend} />
          </CardContent>
        </Card>
      )}

      {/* Full history */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarCheck className="size-4" /> Full Attendance History
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {checkIns.length === 0 ? (
            <EmptyState
              icon={CalendarCheck}
              title="No check-ins in this period"
              description={
                range.preset === "ALL"
                  ? "This member has never checked in."
                  : "Try a wider date range."
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-muted-foreground">#</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Check-in time</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Location</TableHead>
                  {canCorrect && (
                    <TableHead className="w-24 text-right text-muted-foreground">
                      Actions
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {checkIns.map((c, index) => (
                  <TableRow key={c.id}>
                    <TableCell className="w-10 text-xs tabular-nums text-muted-foreground">
                      {(page - 1) * pageSize + index + 1}
                    </TableCell>
                    <TableCell>{formatDayKey(c.dayKey)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTimeInZone(c.checkedInAt, timeZone)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={c.source === "QR_SESSION" ? "info" : "default"}
                      >
                        {c.source === "QR_SESSION" ? "QR" : "Manual"}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.locationName ?? "—"}
                    </TableCell>
                    {canCorrect && (
                      <TableCell className="text-right">
                        {c.source === "QR_SESSION" ? (
                          <AttendanceCorrectionDialog
                            checkInId={c.id}
                            dayKey={c.dayKey}
                            candidates={correctMembers}
                            trigger={
                              <Button variant="ghost" size="sm">
                                <PenLine className="size-3.5" /> Correct
                              </Button>
                            }
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                {page > 1 && (
                  <PaginationItem>
                    <PaginationPrevious
                      href={hrefFor({ page: String(page - 1) })}
                    />
                  </PaginationItem>
                )}
                <span className="px-3 text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                {page < totalPages && (
                  <PaginationItem>
                    <PaginationNext
                      href={hrefFor({ page: String(page + 1) })}
                    />
                  </PaginationItem>
                )}
              </PaginationContent>
            </Pagination>
          )}
        </CardContent>
      </Card>
    </div>
  )
}