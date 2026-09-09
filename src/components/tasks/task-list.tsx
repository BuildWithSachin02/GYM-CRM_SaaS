"use client"

import { useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import { ListTodo, Search, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { TASK_STATUS } from "@/lib/status"
import { formatDateTime } from "@/lib/format"
import { deleteTask, updateTaskStatus } from "@/lib/actions/tasks"
import { TaskForm } from "@/components/tasks/task-form"

export type TaskRow = {
  id: string
  title: string
  description: string | null
  dueDate: string
  status: "TODO" | "IN_PROGRESS" | "COMPLETED"
  assigneeId: string | null
  assigneeName: string | null
  memberId: string | null
  memberName: string | null
  leadId: string | null
  leadName: string | null
}

type TaskListProps = {
  tasks: TaskRow[]
  totalCount: number
  totalPages: number
  filters: { status: string; assignee: string; page: number }
  assignees: { id: string; name: string }[]
  members: { id: string; name: string }[]
  leads: { id: string; name: string }[]
  canCreate: boolean
  canManage: boolean
}

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "TODO", label: "To do" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
]

export function TaskList({
  tasks,
  totalCount,
  totalPages,
  filters,
  assignees,
  members,
  leads,
  canCreate,
  canManage,
}: TaskListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    if (key !== "page") params.delete("page")
    router.push(`/dashboard/tasks?${params.toString()}`)
  }

  function onToggleStatus(task: TaskRow) {
    const next = task.status === "COMPLETED" ? "TODO" : "COMPLETED"
    startTransition(async () => {
      const res = await updateTaskStatus({ taskId: task.id, status: next })
      if (res.success) {
        toast.success(next === "COMPLETED" ? "Task completed" : "Task reopened")
        router.refresh()
      } else {
        toast.error(res.error ?? "Something went wrong")
      }
    })
  }

  function onDelete(taskId: string) {
    if (!window.confirm("Delete this task?")) return
    setDeletingId(taskId)
    startTransition(async () => {
      const res = await deleteTask(taskId)
      setDeletingId(null)
      if (res.success) {
        toast.success("Task deleted")
        router.refresh()
      } else {
        toast.error(res.error ?? "Something went wrong")
      }
    })
  }

  return (
    <div>
      <PageHeader
        title="Tasks"
        description={`${totalCount} task(s)`}
        actions={
          canCreate && (
            <TaskForm
              members={members}
              leads={leads}
              assignees={assignees}
              trigger={
                <Button>
                  <ListTodo className="size-4" /> New Task
                </Button>
              }
            />
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1">
          {STATUS_TABS.map((tab) => {
            const active = filters.status === tab.value
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
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            className="pl-8"
            defaultValue={searchParams.get("q") ?? ""}
            onChange={(e) => setParam("q", e.target.value)}
          />
        </div>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="No tasks found"
          description="Create a task to track follow-ups and reminders."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Task</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Linked to</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="w-14 text-right" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => {
                const isOverdue =
                  task.status !== "COMPLETED" && new Date(task.dueDate) < new Date()
                return (
                  <TableRow key={task.id} className={task.status === "COMPLETED" ? "opacity-60" : ""}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => onToggleStatus(task)}
                        className="flex size-5 items-center justify-center rounded border border-muted-foreground/40 transition-colors hover:border-primary hover:text-primary"
                        aria-label={task.status === "COMPLETED" ? "Reopen task" : "Complete task"}
                      >
                        {task.status === "COMPLETED" && <span className="text-primary">✓</span>}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{task.title}</div>
                      {task.description && (
                        <div className="line-clamp-1 text-xs text-muted-foreground">
                          {task.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          isOverdue ? "text-sm font-medium text-destructive" : "text-sm"
                        }
                      >
                        {formatDateTime(task.dueDate)}
                      </span>
                      {isOverdue && <div className="text-xs text-destructive">Overdue</div>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {task.assigneeName ?? "Unassigned"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {task.memberName
                        ? `Member: ${task.memberName}`
                        : task.leadName
                          ? `Lead: ${task.leadName}`
                          : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={TASK_STATUS[task.status].tone}>
                        {TASK_STATUS[task.status].label}
                      </StatusBadge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={deletingId === task.id}
                          onClick={() => onDelete(task.id)}
                          aria-label="Delete task"
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page <= 1}
            onClick={() => setParam("page", String(filters.page - 1))}
          >
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {filters.page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page >= totalPages}
            onClick={() => setParam("page", String(filters.page + 1))}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}