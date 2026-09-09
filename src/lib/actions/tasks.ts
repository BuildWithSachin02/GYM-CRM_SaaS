"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { requireUserOrThrow } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit"
import { taskSchema, taskStatusSchema } from "@/lib/validators"
import type { TaskInput, TaskStatusInput } from "@/lib/validators"
import { ZodError } from "zod"

type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

function buildFieldErrors(error: unknown): Record<string, string[]> | undefined {
  if (!(error instanceof ZodError)) return undefined
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const key = issue.path.join(".")
    if (!fieldErrors[key]) fieldErrors[key] = []
    fieldErrors[key].push(issue.message)
  }
  return fieldErrors
}

export async function createTask(input: TaskInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "tasks:manage")) return { success: false, error: "Not authorized" }

  const parsed = taskSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  const { title, description, dueDate, status, assigneeId, memberId, leadId } = parsed.data

  const task = await prisma.task.create({
    data: {
      organizationId: user.organizationId,
      title,
      description: description ?? null,
      dueDate,
      status,
      assigneeId: assigneeId ?? null,
      memberId: memberId ?? null,
      leadId: leadId ?? null,
      createdById: user.id,
    },
  })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.TASK_CREATED,
    entityType: "Task",
    entityId: task.id,
    after: { title, dueDate: dueDate.toISOString(), status },
  })

  revalidatePath("/dashboard/tasks")
  return { success: true }
}

export async function updateTaskStatus(input: TaskStatusInput): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "tasks:manage")) return { success: false, error: "Not authorized" }

  const parsed = taskStatusSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: buildFieldErrors(parsed.error),
    }
  }

  const { taskId, status } = parsed.data
  const task = await prisma.task.findFirst({
    where: { id: taskId, organizationId: user.organizationId },
  })
  if (!task) return { success: false, error: "Task not found" }

  await prisma.task.update({ where: { id: taskId }, data: { status } })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: AUDIT_ACTIONS.TASK_UPDATED,
    entityType: "Task",
    entityId: taskId,
    after: { status },
  })

  revalidatePath("/dashboard/tasks")
  return { success: true }
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  const user = await requireUserOrThrow()
  if (!can(user, "tasks:manage")) return { success: false, error: "Not authorized" }

  const task = await prisma.task.findFirst({
    where: { id: taskId, organizationId: user.organizationId },
  })
  if (!task) return { success: false, error: "Task not found" }

  await prisma.task.delete({ where: { id: taskId } })

  await writeAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: "task.deleted",
    entityType: "Task",
    entityId: taskId,
    after: { title: task.title },
  })

  revalidatePath("/dashboard/tasks")
  return { success: true }
}