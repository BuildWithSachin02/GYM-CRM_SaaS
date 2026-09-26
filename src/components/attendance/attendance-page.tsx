"use client"

import { useState } from "react"
import Link from "next/link"
import { CalendarCheck, QrCode, TriangleAlert, UserCheck } from "lucide-react"

import { formatTime } from "@/lib/format"
import { StatusBadge } from "@/components/common/status-badge"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ManualCheckinForm } from "@/components/attendance/manual-checkin-form"
import { QrManager } from "@/components/attendance/qr-manager"

type SerializedCheckin = {
  id: string
  memberName: string
  memberCode: string | null
  source: "MANUAL" | "QR_SESSION"
  checkedInAt: string
}

type SerializedQrSession = {
  id: string
  label: string | null
  branchName: string
  expiresAt: string
}

type Member = {
  id: string
  firstName: string
  lastName: string
  memberCode?: string | null
  phone?: string | null
}
type Branch = { id: string; name: string }

type AttendancePageProps = {
  checkins: SerializedCheckin[]
  totalCount: number
  totalPages: number
  page: number
  todayKey: string
  activeQrSessions: SerializedQrSession[]
  members: Member[]
  branches: Branch[]
  canRecord: boolean
  pendingRequests?: number
}

export function AttendancePage({
  checkins,
  totalCount,
  totalPages,
  page,
  todayKey,
  activeQrSessions,
  members,
  branches,
  canRecord,
  pendingRequests = 0,
}: AttendancePageProps) {
  const [showQrSection, setShowQrSection] = useState(false)

  const pageSize = 100
  const firstShown = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const lastShown = Math.min(page * pageSize, totalCount)
  const pageHref = (target: number) =>
    `/dashboard/attendance?date=${encodeURIComponent(todayKey)}&page=${target}`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description={
          totalCount <= pageSize
            ? `${totalCount} check-in${totalCount === 1 ? "" : "s"} on ${todayKey}`
            : `Showing ${firstShown}–${lastShown} of ${totalCount} check-ins on ${todayKey}`
        }
        actions={
          canRecord ? (
            <div className="flex gap-2">
              <ManualCheckinForm
                members={members}
                trigger={
                  <Button>
                    <UserCheck className="size-4" /> Mark Attendance
                  </Button>
                }
              />
              <Button
                variant="outline"
                onClick={() => setShowQrSection(!showQrSection)}
              >
                <QrCode className="size-4" /> QR Sessions
              </Button>
            </div>
          ) : undefined
        }
      />

      {pendingRequests > 0 && (
        <div className="flex flex-col items-start justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-900">
              <span className="font-medium">
                {pendingRequests} attendance request{pendingRequests === 1 ? "" : "s"}
              </span>{" "}
              from members with an expired membership are awaiting your review.
            </p>
          </div>
          <Button variant="outline" render={<Link href="/dashboard/attendance/requests" />}>
            Review requests
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s Check-ins</CardTitle>
        </CardHeader>
        <CardContent>
          {checkins.length === 0 ? (
            <EmptyState
              icon={CalendarCheck}
              title={page > 1 ? "No check-ins on this page" : "No check-ins today"}
              description="No members have checked in yet today."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-muted-foreground">#</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checkins.map((c, index) => (
                  <TableRow key={c.id}>
                    <TableCell className="w-10 text-xs tabular-nums text-muted-foreground">
                      {index + 1}
                    </TableCell>
                    <TableCell className="font-medium">
                      {c.memberName}
                      {c.memberCode && (
                        <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                          {c.memberCode}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={c.source === "QR_SESSION" ? "info" : "default"}
                      >
                        {c.source === "QR_SESSION" ? "QR" : "Manual"}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>{formatTime(c.checkedInAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link href={pageHref(page - 1)} />}
                  >
                    Previous
                  </Button>
                )}
                {page < totalPages && (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link href={pageHref(page + 1)} />}
                  >
                    Next
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {showQrSection && (
        <QrManager
          activeQrSessions={activeQrSessions}
          branches={branches}
        />
      )}
    </div>
  )
}
