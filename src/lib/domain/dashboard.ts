import "server-only"

import {
  endOfDay,
  format,
  startOfDay,
  subDays,
} from "date-fns"

import { prisma } from "@/lib/prisma"
import { dayKeyOf } from "@/lib/format"

const DAY = 24 * 60 * 60 * 1000

export type DashboardData = {
  stats: {
    totalMembers: number
    activeMembers: number
    expiringSoon7: number
    expiredCount: number
    todayAttendance: number
    todayRevenue: number
    newLeads: number
    pendingFollowUps: number
  }
  revenueTrend: { day: string; revenue: number }[]
  attendanceTrend: { day: string; count: number }[]
  expiringMemberships: {
    id: string
    memberName: string
    memberId: string
    planName: string
    endDate: string
    daysLeft: number
  }[]
  overdueTasks: {
    id: string
    title: string
    dueDate: string
    assignee: string | null
  }[]
  todayAppointments: {
    id: string
    title: string
    startsAt: string
    endsAt: string
    trainer: string | null
    status: string
  }[]
  recentPayments: {
    id: string
    memberId: string
    memberName: string
    amountMinor: number
    method: string
    paymentDate: string
    recordedBy: string | null
  }[]
  recentMembers: {
    id: string
    firstName: string
    lastName: string
    phone: string
    status: string
    createdAt: string
  }[]
  newLeadsToday: {
    id: string
    name: string
    source: string
    stage: string
    followUpDate: string | null
    createdAt: string
  }[]
  leadPipeline: { stage: string; count: number }[]
  nextWeekAppointments: { id: string; title: string; startsAt: string }[]
}

export async function getDashboardData(organizationId: string): Promise<DashboardData> {
  const todayStart = startOfDay(new Date())
  const todayEnd = endOfDay(new Date())
  const todayKey = dayKeyOf(new Date())

  const [totalMembers, activeMembers, expiringSoon7, expiredCount, todayAttendance, todayRevenue, newLeads, pendingFollowUps] =
    await Promise.all([
      prisma.member.count({ where: { organizationId, deletedAt: null } }),
      prisma.member.count({
        where: { organizationId, deletedAt: null, status: "ACTIVE" },
      }),
      prisma.membership.count({
        where: {
          organizationId,
          status: "ACTIVE",
          endDate: { gte: todayStart, lte: endOfDay(addDays(todayStart, 7)) },
        },
      }),
      prisma.membership.count({
        where: { organizationId, status: "EXPIRED", endDate: { lt: todayStart } },
      }),
      prisma.checkIn.count({ where: { organizationId, dayKey: todayKey } }),
      prisma.payment.aggregate({
        where: {
          organizationId,
          status: "RECORDED",
          paymentDate: { gte: todayStart, lte: todayEnd },
        },
        _sum: { amountMinor: true },
      }),
      prisma.lead.count({ where: { organizationId, deletedAt: null, stage: "NEW" } }),
      prisma.lead.count({
        where: {
          organizationId,
          deletedAt: null,
          stage: { in: ["NEW", "CONTACTED", "VISIT_SCHEDULED", "VISIT_DONE"] },
          followUpDate: { lte: todayEnd },
        },
      }),
    ])

  const revenueTrend = await getRevenueTrend(organizationId, todayStart)
  const attendanceTrend = await getAttendanceTrend(organizationId)
  const expiringMemberships = await getExpiringMemberships(organizationId, todayStart)
  const overdueTasks = await getOverdueTasks(organizationId)
  const todayAppointments = await getTodayAppointments(organizationId)
  const recentPayments = await getRecentPayments(organizationId)
  const recentMembers = await getRecentMembers(organizationId)
  const newLeadsToday = await getNewLeads(organizationId)
  const leadPipeline = await getLeadPipeline(organizationId)
  const nextWeekAppointments = await getNextWeekAppointments(organizationId)

  return {
    stats: {
      totalMembers,
      activeMembers,
      expiringSoon7,
      expiredCount,
      todayAttendance,
      todayRevenue: todayRevenue._sum.amountMinor ?? 0,
      newLeads,
      pendingFollowUps,
    },
    revenueTrend,
    attendanceTrend,
    expiringMemberships,
    overdueTasks,
    todayAppointments,
    recentPayments,
    recentMembers,
    newLeadsToday,
    leadPipeline,
    nextWeekAppointments,
  }
}

function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * DAY)
}

async function getRevenueTrend(organizationId: string, todayStart: Date) {
  const from = startOfDay(subDays(todayStart, 29))
  const rows = await prisma.payment.groupBy({
    by: ["paymentDate"],
    where: {
      organizationId,
      status: "RECORDED",
      paymentDate: { gte: from },
    },
    _sum: { amountMinor: true },
  })
  const byDay = new Map<string, number>()
  for (const r of rows) {
    const key = dayKeyOf(r.paymentDate)
    byDay.set(key, (byDay.get(key) ?? 0) + (r._sum.amountMinor ?? 0))
  }
  return Array.from({ length: 30 }, (_, i) => {
    const d = addDays(from, i)
    const key = dayKeyOf(d)
    return { day: format(d, "dd MMM"), revenue: byDay.get(key) ?? 0 }
  })
}

async function getAttendanceTrend(organizationId: string) {
  const from = startOfDay(subDays(new Date(), 13))
  const rows = await prisma.checkIn.groupBy({
    by: ["dayKey"],
    where: { organizationId, checkedInAt: { gte: from } },
    _count: { _all: true },
  })
  const byDay = new Map(rows.map((r) => [r.dayKey, r._count._all]))
  return Array.from({ length: 14 }, (_, i) => {
    const d = addDays(from, i)
    const key = dayKeyOf(d)
    return { day: format(d, "dd MMM"), count: byDay.get(key) ?? 0 }
  })
}

async function getExpiringMemberships(organizationId: string, todayStart: Date) {
  const rows = await prisma.membership.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      endDate: { gte: todayStart, lte: endOfDay(addDays(todayStart, 30)) },
    },
    orderBy: { endDate: "asc" },
    take: 12,
    select: {
      id: true,
      endDate: true,
      plan: { select: { name: true } },
      member: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  return rows.map((m) => ({
    id: m.id,
    memberName: `${m.member.firstName} ${m.member.lastName}`,
    memberId: m.member.id,
    planName: m.plan.name,
    endDate: m.endDate.toISOString(),
    daysLeft: Math.max(0, Math.round((m.endDate.getTime() - Date.now()) / DAY)),
  }))
}

async function getOverdueTasks(organizationId: string) {
  const rows = await prisma.task.findMany({
    where: {
      organizationId,
      status: { in: ["TODO", "IN_PROGRESS"] },
      dueDate: { lt: endOfDay(new Date()) },
    },
    orderBy: { dueDate: "asc" },
    take: 6,
    select: {
      id: true,
      title: true,
      dueDate: true,
      assignee: { select: { name: true } },
    },
  })
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: t.dueDate.toISOString(),
    assignee: t.assignee?.name ?? null,
  }))
}

async function getTodayAppointments(organizationId: string) {
  const todayStart = startOfDay(new Date())
  const todayEnd = endOfDay(new Date())
  const rows = await prisma.appointment.findMany({
    where: { organizationId, startsAt: { gte: todayStart, lte: todayEnd } },
    orderBy: { startsAt: "asc" },
    take: 6,
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      member: { select: { firstName: true, lastName: true } },
      lead: { select: { name: true } },
      trainer: { select: { user: { select: { name: true } } } },
    },
  })
  return rows.map((a) => ({
    id: a.id,
    title: a.member
      ? `${a.member.firstName} ${a.member.lastName}`
      : a.lead
        ? a.lead.name
        : "Appointment",
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    trainer: a.trainer?.user.name ?? null,
    status: a.status,
  }))
}

async function getRecentPayments(organizationId: string) {
  const rows = await prisma.payment.findMany({
    where: { organizationId, status: "RECORDED" },
    orderBy: { paymentDate: "desc" },
    take: 6,
    select: {
      id: true,
      amountMinor: true,
      method: true,
      paymentDate: true,
      member: { select: { id: true, firstName: true, lastName: true } },
      recordedBy: { select: { name: true } },
    },
  })
  return rows.map((p) => ({
    id: p.id,
    memberId: p.member.id,
    memberName: `${p.member.firstName} ${p.member.lastName}`,
    amountMinor: p.amountMinor,
    method: p.method,
    paymentDate: p.paymentDate.toISOString(),
    recordedBy: p.recordedBy.name,
  }))
}

async function getRecentMembers(organizationId: string) {
  const rows = await prisma.member.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      status: true,
      createdAt: true,
    },
  })
  return rows.map((m) => ({
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName,
    phone: m.phone,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  }))
}

async function getNewLeads(organizationId: string) {
  const rows = await prisma.lead.findMany({
    where: {
      organizationId,
      deletedAt: null,
      stage: { in: ["NEW", "CONTACTED", "VISIT_SCHEDULED"] },
      followUpDate: { lte: endOfDay(addDays(new Date(), 3)) },
    },
    orderBy: { followUpDate: "asc" },
    take: 6,
    select: {
      id: true,
      name: true,
      source: true,
      stage: true,
      followUpDate: true,
      createdAt: true,
    },
  })
  return rows.map((l) => ({
    id: l.id,
    name: l.name,
    source: l.source,
    stage: l.stage,
    followUpDate: l.followUpDate?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
  }))
}

async function getLeadPipeline(organizationId: string) {
  const rows = await prisma.lead.groupBy({
    by: ["stage"],
    where: { organizationId, deletedAt: null },
    _count: { _all: true },
  })
  return rows.map((r) => ({ stage: r.stage, count: r._count._all }))
}

async function getNextWeekAppointments(organizationId: string) {
  const todayStart = startOfDay(new Date())
  const rows = await prisma.appointment.findMany({
    where: {
      organizationId,
      status: "SCHEDULED",
      startsAt: { gte: todayStart, lte: endOfDay(addDays(todayStart, 7)) },
    },
    orderBy: { startsAt: "asc" },
    take: 8,
    select: {
      id: true,
      startsAt: true,
      member: { select: { firstName: true, lastName: true } },
      lead: { select: { name: true } },
    },
  })
  return rows.map((a) => ({
    id: a.id,
    title: a.member ? `${a.member.firstName} ${a.member.lastName}` : a.lead ? a.lead.name : "Appointment",
    startsAt: a.startsAt.toISOString(),
  }))
}