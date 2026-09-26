import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { getBranchFilterForRequest, requireBranchAccess } from "@/lib/branches"
import { branchFilterWhere } from "@/lib/branch-scope"

import { TaskList } from "@/components/tasks/task-list"

export const metadata: Metadata = {
  title: "Tasks",
}

type SearchParams = Promise<{
  status?: string
  assignee?: string
  page?: string
  /** Explicit branch context from a Branches quick link (server-validated). */
  branch?: string
}>

const VALID_STATUSES = ["TODO", "IN_PROGRESS", "COMPLETED"] as const

export default async function TasksPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await requireUser()
  if (!can(user, "tasks:view")) notFound()
  await requireBranchAccess()
  const params = await searchParams
  const branchFilter = await getBranchFilterForRequest(params.branch)
  const branchClause = branchFilterWhere(branchFilter)
  const memberBranchClause = branchFilterWhere(branchFilter, "homeBranchId")

  const statusFilter = params.status?.trim() || ""
  const assigneeFilter = params.assignee?.trim() || ""
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1)
  const pageSize = 25
  const skip = (page - 1) * pageSize

  const where: Record<string, unknown> = {
    organizationId: user.organizationId,
    ...branchClause,
  }

  if (statusFilter && (VALID_STATUSES as readonly string[]).includes(statusFilter)) {
    where.status = statusFilter
  }

  if (assigneeFilter) {
    where.assigneeId = assigneeFilter
  }

  const [tasks, totalCount, users, members, leads] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: { dueDate: "asc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        title: true,
        description: true,
        dueDate: true,
        status: true,
        assignee: { select: { id: true, name: true } },
        member: {
          select: { id: true, firstName: true, lastName: true },
        },
        lead: {
          select: { id: true, name: true },
        },
      },
    }),
    prisma.task.count({ where }),
    // Users carry NO branchId (access comes from UserBranch), so the assignee
    // picker stays org-wide.
    prisma.user.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.member.findMany({
      where: {
        organizationId: user.organizationId,
        deletedAt: null,
        status: "ACTIVE",
        ...memberBranchClause,
      },
      orderBy: { firstName: "asc" },
      select: { id: true, firstName: true, lastName: true, memberCode: true },
    }),
    prisma.lead.findMany({
      where: {
        organizationId: user.organizationId,
        deletedAt: null,
        stage: { not: "CONVERTED" },
        ...branchClause,
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ])

  const serializedTasks = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    dueDate: task.dueDate.toISOString(),
    status: task.status,
    assigneeId: task.assignee?.id ?? null,
    assigneeName: task.assignee?.name ?? null,
    memberId: task.member?.id ?? null,
    memberName: task.member
      ? `${task.member.firstName} ${task.member.lastName}`.trim()
      : null,
    leadId: task.lead?.id ?? null,
    leadName: task.lead?.name ?? null,
  }))

  const serializedUsers = users.map((u) => ({ id: u.id, name: u.name }))
  const serializedMembers = members.map((m) => ({
    id: m.id,
    name: `${m.firstName} ${m.lastName}`.trim(),
    memberCode: m.memberCode,
  }))
  const serializedLeads = leads.map((l) => ({ id: l.id, name: l.name }))

  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <TaskList
      tasks={serializedTasks}
      totalCount={totalCount}
      totalPages={totalPages}
      filters={{ status: statusFilter, assignee: assigneeFilter, page }}
      assignees={serializedUsers}
      members={serializedMembers}
      leads={serializedLeads}
      canCreate={can(user, "tasks:manage")}
      canManage={can(user, "tasks:manage")}
      />
  )
}
