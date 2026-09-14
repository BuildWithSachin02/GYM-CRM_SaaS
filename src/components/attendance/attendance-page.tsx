"use client"

import { useState } from "react"
import Link from "next/link"
import { CalendarCheck, QrCode, UserCheck } from "lucide-react"

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
  source: "MANUAL" | "QR_SESSION"
  checkedInAt: string
}

type SerializedQrSession = {
  id: string
  label: string | null
  locationName: string
  expiresAt: string
}

type Member = { id: string; firstName: string; lastName: string }
type Location = { id: string; name: string }

type AttendancePageProps = {
  checkins: SerializedCheckin[]
  totalCount: number
  totalPages: number
  page: number
  todayKey: string
  activeQrSessions: SerializedQrSession[]
  members: Member[]
  locations: Location[]
  canRecord: boolean
}

export function AttendancePage({
  checkins,
  totalCount,
  totalPages,
  page,
  todayKey,
  activeQrSessions,
  members,
  locations,
  canRecord,
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
          locations={locations}
        />
      )}
    </div>
  )
}
