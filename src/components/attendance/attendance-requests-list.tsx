"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, CheckCircle2, Clock, FileClock, XCircle } from "lucide-react"

import {
  approveAttendanceRequest,
  rejectAttendanceRequest,
} from "@/lib/actions/attendance-requests"
import { formatDateTime, formatDayKey, initials } from "@/lib/format"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { StatusBadge } from "@/components/common/status-badge"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

type RequestRow = {
  id: string
  memberId: string
  memberName: string
  memberActive: boolean
  dayKey: string
  requestedAt: string
  status: "PENDING" | "APPROVED" | "REJECTED"
  rejectionReason: string | null
  approvedBy: string | null
  rejectedBy: string | null
  stale: boolean
}

type AttendanceRequestsListProps = {
  requests: RequestRow[]
  canDecide: boolean
  pendingCount: number
}

const STATUS_TONES: Record<
  RequestRow["status"],
  { tone: "warning" | "success" | "destructive"; label: string }
> = {
  PENDING: { tone: "warning", label: "Pending" },
  APPROVED: { tone: "success", label: "Approved" },
  REJECTED: { tone: "destructive", label: "Rejected" },
}

export function AttendanceRequestsList({
  requests,
  canDecide,
  pendingCount,
}: AttendanceRequestsListProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [rejectingId, setRejectingId] = useState<string | null>(null)

  function onApprove(requestId: string) {
    startTransition(async () => {
      const res = await approveAttendanceRequest({ requestId })
      if (res.success) {
        toast.success("Attendance approved and check-in recorded")
        setRejectingId(null)
        router.refresh()
      } else {
        toast.error(res.error ?? "Could not approve request")
      }
    })
  }

  function onReject(requestId: string, reason: string) {
    startTransition(async () => {
      const res = await rejectAttendanceRequest({
        requestId,
        reason: reason.trim() || null,
      })
      if (res.success) {
        toast.success("Request rejected")
        setRejectingId(null)
        router.refresh()
      } else {
        toast.error(res.error ?? "Could not reject request")
      }
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance Requests"
        description={
          pendingCount > 0
            ? `${pendingCount} request${pendingCount === 1 ? "" : "s"} pending review`
            : "No pending attendance requests"
        }
        actions={
          <Button variant="outline" render={<Link href="/dashboard/attendance" />}>
            <ArrowLeft className="size-4" /> Back to Attendance
          </Button>
        }
      />

      {requests.length === 0 ? (
        <EmptyState
          icon={FileClock}
          title="No attendance requests"
          description="When a member with an expired membership scans a QR code, their request appears here for staff review after renewal."
        />
      ) : (
        <div className="divide-y rounded-lg border">
          {requests.map((request) => {
            const status = STATUS_TONES[request.status]
            return (
              <div
                key={request.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                    {initials(request.memberName)}
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/dashboard/members/${request.memberId}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {request.memberName}
                      </Link>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      {request.memberActive ? null : (
                        <StatusBadge tone="destructive">Not active</StatusBadge>
                      )}
                      {request.stale && request.status === "PENDING" ? (
                        <StatusBadge tone="muted">From an earlier day</StatusBadge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Requested for {formatDayKey(request.dayKey)} · {formatDateTime(request.requestedAt)}
                    </p>
                    {request.status === "REJECTED" && request.rejectionReason && (
                      <p className="text-xs text-muted-foreground">
                        Reason: {request.rejectionReason}
                      </p>
                    )}
                    {request.status === "APPROVED" && request.approvedBy && (
                      <p className="text-xs text-muted-foreground">
                        Approved by {request.approvedBy}
                      </p>
                    )}
                    {request.status === "REJECTED" && request.rejectedBy && (
                      <p className="text-xs text-muted-foreground">
                        Rejected by {request.rejectedBy}
                      </p>
                    )}
                  </div>
                </div>

                {request.status === "PENDING" && canDecide && (
                  <div className="flex shrink-0 gap-2">
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={<Button variant="outline" disabled={isPending} />}
                      >
                        <CheckCircle2 className="size-4" /> Approve
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Approve attendance?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {request.memberName} scanned a QR with an expired
                            membership on {formatDayKey(request.dayKey)}. Approval
                            creates a normal check-in and requires the membership
                            to cover that day.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => onApprove(request.id)}
                            disabled={isPending}
                          >
                            Approve
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>

                    <Dialog
                      open={rejectingId === request.id}
                      onOpenChange={(open) =>
                        setRejectingId(open ? request.id : null)
                      }
                    >
                      <DialogTrigger
                        render={
                          <Button variant="ghost" disabled={isPending} />
                        }
                      >
                        <XCircle className="size-4" /> Reject
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Reject attendance request</DialogTitle>
                          <DialogDescription>
                            Rejecting {request.memberName}&apos;s request for{" "}
                            {formatDayKey(request.dayKey)}.
                          </DialogDescription>
                        </DialogHeader>
                        <RejectReasonField
                          defaultValue={request.rejectionReason ?? ""}
                          isPending={isPending}
                          onSubmit={(reason) => onReject(request.id, reason)}
                        />
                        <DialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => setRejectingId(null)}
                            disabled={isPending}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="destructive"
                            form="reject-reason-form"
                            type="submit"
                            disabled={isPending}
                          >
                            Reject request
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                )}

                {request.status === "PENDING" && !canDecide && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="size-4" /> Awaiting owner review
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RejectReasonField({
  defaultValue,
  isPending,
  onSubmit,
}: {
  defaultValue: string
  isPending: boolean
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState(defaultValue)
  return (
    <form
      id="reject-reason-form"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(reason)
      }}
    >
      <Textarea
        placeholder="Optional reason shown to staff (e.g. membership not renewed)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        disabled={isPending}
      />
    </form>
  )
}