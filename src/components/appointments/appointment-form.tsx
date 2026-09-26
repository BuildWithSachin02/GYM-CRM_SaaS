"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { CalendarClock } from "lucide-react"

import { createAppointment } from "@/lib/actions/appointments"
import { cn } from "@/lib/utils"

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
import { EntityCombobox } from "@/components/ui/entity-combobox"

const appointmentFormSchema = z
  .object({
    subjectType: z.enum(["MEMBER", "LEAD"]),
    memberId: z.string().optional(),
    leadId: z.string().optional(),
    trainerId: z.string().optional(),
    startsAt: z.string().min(1, "Required"),
    endsAt: z.string().min(1, "Required"),
    notes: z.string().trim().max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.subjectType === "MEMBER" && !v.memberId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["memberId"],
        message: "Select a member",
      })
    }
    if (v.subjectType === "LEAD" && !v.leadId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["leadId"],
        message: "Select a lead",
      })
    }
    if (v.startsAt && v.endsAt && new Date(v.endsAt) <= new Date(v.startsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "End time must be after start time",
      })
    }
  })

type AppointmentFormValues = z.infer<typeof appointmentFormSchema>

type AppointmentFormProps = {
  members: { id: string; name: string; memberCode?: string | null }[]
  leads: { id: string; name: string }[]
  trainers: { id: string; name: string }[]
  trigger?: React.ReactNode
}

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}`
}

export function AppointmentForm({
  members,
  leads,
  trainers,
  trigger,
}: AppointmentFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const now = new Date()
  const defaultStart = toLocalInput(new Date(now.getTime() + 60 * 60 * 1000))
  const defaultEnd = toLocalInput(new Date(now.getTime() + 2 * 60 * 60 * 1000))

  const form = useForm<AppointmentFormValues>({
    resolver: zodResolver(appointmentFormSchema),
    defaultValues: {
      subjectType: "MEMBER",
      memberId: "",
      leadId: "",
      trainerId: "",
      startsAt: defaultStart,
      endsAt: defaultEnd,
      notes: "",
    },
  })

  const subjectType = form.watch("subjectType")

  function onSubmit(data: AppointmentFormValues) {
    setServerError(null)
    startTransition(async () => {
      const res = await createAppointment({
        memberId: data.subjectType === "MEMBER" ? data.memberId || null : null,
        leadId: data.subjectType === "LEAD" ? data.leadId || null : null,
        trainerId: data.trainerId || null,
        staffId: null,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        status: "SCHEDULED",
        notes: data.notes || null,
        branchId: null,
      })
      if (res.success) {
        toast.success("Appointment created")
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
            <CalendarClock className="size-4" /> New Appointment
          </>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Appointment</DialogTitle>
          <DialogDescription>Schedule a visit or session for a member or lead.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormServerError>{serverError}</FormServerError>

            <FormField
              control={form.control}
              name="subjectType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Appointment for *</FormLabel>
                  <FormControl>
                    <div className="flex w-full items-center gap-1 rounded-lg bg-muted p-[3px]">
                      {(["MEMBER", "LEAD"] as const).map((t) => {
                        const active = subjectType === t
                        return (
                          <Button
                            key={t}
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={cn(
                              "flex-1",
                              active && "bg-background text-foreground shadow-sm"
                            )}
                            onClick={() => field.onChange(t)}
                          >
                            {t === "MEMBER" ? "Member" : "Lead"}
                          </Button>
                        )
                      })}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {subjectType === "MEMBER" ? (
              <FormField
                control={form.control}
                name="memberId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Member *</FormLabel>
                    <FormControl>
                      <EntityCombobox
                        value={field.value ?? ""}
                        onValueChange={(v) => field.onChange(v || "")}
                        options={members.map((m) => ({
                          id: m.id,
                          label: m.memberCode ? `${m.name} / ${m.memberCode}` : m.name,
                        }))}
                        placeholder="Search or select member"
                        emptyText="No members found."
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <FormField
                control={form.control}
                name="leadId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lead *</FormLabel>
                    <FormControl>
                      <EntityCombobox
                        value={field.value ?? ""}
                        onValueChange={(v) => field.onChange(v || "")}
                        options={leads.map((l) => ({ id: l.id, label: l.name }))}
                        placeholder="Search or select lead"
                        emptyText="No leads found."
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="trainerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Trainer</FormLabel>
                  <FormControl>
                    <EntityCombobox
                      value={field.value ?? ""}
                      onValueChange={(v) => field.onChange(v || "")}
                      options={trainers.map((t) => ({ id: t.id, label: t.name }))}
                      placeholder="No trainer"
                      emptyText="No trainers found."
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
                name="startsAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Starts *</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endsAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ends *</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Purpose, preferences, etc."
                      className="min-h-16"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating..." : "Create Appointment"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
