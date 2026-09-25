import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"

import { AppointmentList } from "@/components/appointments/appointment-list"

export const metadata: Metadata = {
  title: "Appointments",
}

type SearchParams = Promise<{
  date?: string
  status?: string
}>

const VALID_STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await requireUser()
  if (!can(user, "appointments:view")) notFound()
  const params = await searchParams

  const statusFilter = params.status?.trim() || ""
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? params.date!
    : localDateKey(new Date())

  const startOfDay = new Date(`${dateKey}T00:00:00`)
  const endOfDay = new Date(`${dateKey}T23:59:59.999`)

  const where: Record<string, unknown> = {
    organizationId: user.organizationId,
    startsAt: { gte: startOfDay, lte: endOfDay },
  }

  if (statusFilter && (VALID_STATUSES as readonly string[]).includes(statusFilter)) {
    where.status = statusFilter
  }

  const [appointments, members, leads, trainers] = await Promise.all([
    prisma.appointment.findMany({
      where,
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        status: true,
        notes: true,
        member: { select: { id: true, firstName: true, lastName: true } },
        lead: { select: { id: true, name: true } },
        trainer: {
          select: { id: true, user: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.member.findMany({
      where: { organizationId: user.organizationId, deletedAt: null, status: "ACTIVE" },
      orderBy: { firstName: "asc" },
      select: { id: true, firstName: true, lastName: true, memberCode: true },
    }),
    prisma.lead.findMany({
      where: { organizationId: user.organizationId, deletedAt: null, stage: { not: "CONVERTED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.trainer.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: { user: { name: "asc" } },
      select: { id: true, user: { select: { id: true, name: true } } },
    }),
  ])

  const serializedAppointments = appointments.map((a) => ({
    id: a.id,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: a.status,
    notes: a.notes,
    memberId: a.member?.id ?? null,
    memberName: a.member ? `${a.member.firstName} ${a.member.lastName}`.trim() : null,
    leadId: a.lead?.id ?? null,
    leadName: a.lead?.name ?? null,
    trainerId: a.trainer?.id ?? null,
    trainerName: a.trainer?.user.name ?? null,
  }))

  const serializedMembers = members.map((m) => ({
    id: m.id,
    name: `${m.firstName} ${m.lastName}`.trim(),
    memberCode: m.memberCode,
  }))
  const serializedLeads = leads.map((l) => ({ id: l.id, name: l.name }))
  const serializedTrainers = trainers.map((t) => ({ id: t.id, name: t.user.name }))

  return (
    <AppointmentList
      appointments={serializedAppointments}
      members={serializedMembers}
      leads={serializedLeads}
      trainers={serializedTrainers}
      selectedDate={dateKey}
      statusFilter={statusFilter}
      canManage={can(user, "appointments:manage")}
    />
  )
}
