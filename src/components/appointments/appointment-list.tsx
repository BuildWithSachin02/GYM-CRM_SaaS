"use client"

import { useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/empty-state"
import { PageHeader } from "@/components/common/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { APPOINTMENT_STATUS } from "@/lib/status"
import { formatDate, formatTime, pluralize } from "@/lib/format"
import { deleteAppointment, updateAppointmentStatus } from "@/lib/actions/appointments"
import { AppointmentForm } from "@/components/appointments/appointment-form"

export type AppointmentRow = {
  id: string
  startsAt: string
  endsAt: string
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW"
  notes: string | null
  memberId: string | null
  memberName: string | null
  leadId: string | null
  leadName: string | null
  trainerId: string | null
  trainerName: string | null
}

const STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const
type Status = (typeof STATUSES)[number]

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "NO_SHOW", label: "No-show" },
]

type AppointmentListProps = {
  appointments: AppointmentRow[]
  members: { id: string; name: string }[]
  leads: { id: string; name: string }[]
  trainers: { id: string; name: string }[]
  selectedDate: string
  statusFilter: string
  canManage: boolean
}

function shiftDay(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T00:00:00`)
  d.setDate(d.getDate() + delta)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function todayKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function AppointmentList({
  appointments,
  members,
  leads,
  trainers,
  selectedDate,
  statusFilter,
  canManage,
}: AppointmentListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`/dashboard/appointments?${params.toString()}`)
  }

  function onStatusChange(appt: AppointmentRow, status: Status) {
    if (status === appt.status) return
    startTransition(async () => {
      const res = await updateAppointmentStatus({ appointmentId: appt.id, status })
      if (res.success) {
        toast.success(`Status updated to ${APPOINTMENT_STATUS[status].label}`)
        router.refresh()
      } else {
        toast.error(res.error ?? "Something went wrong")
      }
    })
  }

  function onDelete(appt: AppointmentRow) {
    if (!window.confirm("Delete this appointment?")) return
    setDeletingId(appt.id)
    startTransition(async () => {
      const res = await deleteAppointment(appt.id)
      setDeletingId(null)
      if (res.success) {
        toast.success("Appointment deleted")
        router.refresh()
      } else {
        toast.error(res.error ?? "Something went wrong")
      }
    })
  }

  return (
    <div>
      <PageHeader
        title="Appointments"
        description={`${pluralize(appointments.length, "appointment")} for ${formatDate(selectedDate)}`}
        actions={
          canManage && (
            <AppointmentForm
              members={members}
              leads={leads}
              trainers={trainers}
              trigger={
                <Button>
                  <CalendarDays className="size-4" /> New Appointment
                </Button>
              }
            />
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1">
          {STATUS_TABS.map((tab) => {
            const active = statusFilter === tab.value
            return (
              <Button
                key={tab.value}
                variant={active ? "default" : "ghost"}
                size="sm"
                onClick={() => setParam("status", tab.value)}
              >
                {tab.label}
              </Button>
            )
          })}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setParam("date", shiftDay(selectedDate, -1))}
            aria-label="Previous day"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setParam("date", todayKey())}
            className="min-w-24"
          >
            {formatDate(selectedDate)}
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setParam("date", shiftDay(selectedDate, 1))}
            aria-label="Next day"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {appointments.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No appointments"
          description="No appointments scheduled for this day."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date &amp; time</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Trainer</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="w-14 text-right" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {appointments.map((appt) => {
                const type = appt.memberId ? "MEMBER" : "LEAD"
                return (
                  <TableRow key={appt.id}>
                    <TableCell>
                      <div className="font-medium">{formatDate(appt.startsAt)}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatTime(appt.startsAt)} – {formatTime(appt.endsAt)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{appt.memberName ?? appt.leadName}</div>
                      {appt.notes && (
                        <div className="line-clamp-1 text-xs text-muted-foreground">
                          {appt.notes}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={type === "MEMBER" ? "info" : "warning"}>
                        {type === "MEMBER" ? "Member" : "Lead"}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {appt.trainerName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={APPOINTMENT_STATUS[appt.status].tone}>
                        {APPOINTMENT_STATUS[appt.status].label}
                      </StatusBadge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Appointment actions"
                              />
                            }
                          >
                            <MoreHorizontal className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuLabel>Change status</DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                              value={appt.status}
                              onValueChange={(v) => onStatusChange(appt, v as Status)}
                            >
                              {STATUSES.map((s) => (
                                <DropdownMenuRadioItem key={s} value={s}>
                                  {APPOINTMENT_STATUS[s].label}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={deletingId === appt.id}
                              onClick={() => onDelete(appt)}
                              variant="destructive"
                            >
                              <Trash2 className="size-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
