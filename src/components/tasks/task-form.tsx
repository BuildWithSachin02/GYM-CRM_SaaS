"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Plus } from "lucide-react"

import { createTask } from "@/lib/actions/tasks"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormServerError,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EntityCombobox } from "@/components/ui/entity-combobox"
import { TASK_STATUS } from "@/lib/status"
import type { TaskStatus } from "@prisma/client"

const taskFormSchema = z.object({
  title: z.string().trim().min(1, "Required").max(200),
  description: z.string().trim().max(1000).optional(),
  dueDate: z.string().min(1, "Required"),
  status: z.enum(["TODO", "IN_PROGRESS", "COMPLETED"]),
  assigneeId: z.string().optional(),
  memberId: z.string().optional(),
  leadId: z.string().optional(),
})

type TaskFormValues = z.infer<typeof taskFormSchema>

type TaskFormProps = {
  members: { id: string; name: string }[]
  leads: { id: string; name: string }[]
  assignees?: { id: string; name: string }[]
  trigger?: React.ReactNode
}

export function TaskForm({ members, leads, assignees = [], trigger }: TaskFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: "",
      description: "",
      dueDate: new Date().toISOString().slice(0, 10),
      status: "TODO",
      assigneeId: "",
      memberId: "",
      leadId: "",
    },
  })

  function onSubmit(data: TaskFormValues) {
    setServerError(null)
    startTransition(async () => {
      const res = await createTask({
        title: data.title,
        description: data.description || null,
        dueDate: data.dueDate,
        status: data.status,
        assigneeId: data.assigneeId || null,
        memberId: data.memberId || null,
        leadId: data.leadId || null,
      })
      if (res.success) {
        toast.success("Task created")
        setOpen(false)
        form.reset()
        router.refresh()
      } else {
        setServerError(res.error ?? "Something went wrong")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ? undefined : <Button />}>
        {trigger ?? (
          <>
            <Plus className="size-4" /> New Task
          </>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
          <DialogDescription>Create a task to track work or follow-ups.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormServerError>{serverError}</FormServerError>

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Call Rahul about membership renewal" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Details of the task"
                      className="min-h-16"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due Date *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.entries(TASK_STATUS) as [TaskStatus, (typeof TASK_STATUS)[TaskStatus]][]).map(
                            ([value, { label }]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="assigneeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assignee</FormLabel>
                  <FormControl>
                    <EntityCombobox
                      value={field.value ?? ""}
                      onValueChange={(v) => field.onChange(v || "")}
                      options={assignees.map((a) => ({ id: a.id, label: a.name }))}
                      placeholder="Unassigned"
                      emptyText="No assignees found."
                      allowClear
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="memberId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Linked Member</FormLabel>
                    <FormControl>
                      <EntityCombobox
                        value={field.value ?? ""}
                        onValueChange={(v) => field.onChange(v || "")}
                        options={members.map((m) => ({ id: m.id, label: m.name }))}
                        placeholder="None"
                        emptyText="No members found."
                        allowClear
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="leadId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Linked Lead</FormLabel>
                    <FormControl>
                      <EntityCombobox
                        value={field.value ?? ""}
                        onValueChange={(v) => field.onChange(v || "")}
                        options={leads.map((l) => ({ id: l.id, label: l.name }))}
                        placeholder="None"
                        emptyText="No leads found."
                        allowClear
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating..." : "Create Task"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}