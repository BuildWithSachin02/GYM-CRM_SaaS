"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import { correctAttendanceMember } from "@/lib/actions/attendance-requests"
import {
  memberSelectionLabel,
  memberSelectionSublabel,
} from "@/lib/member-code"

import { Button } from "@/components/ui/button"
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormServerError,
} from "@/components/ui/form"
import { EntityCombobox } from "@/components/ui/entity-combobox"
import { Textarea } from "@/components/ui/textarea"

export type CorrectionMember = {
  id: string
  firstName: string
  lastName: string
  memberCode?: string | null
  phone?: string | null
}

const correctionFormSchema = z.object({
  memberId: z.string().uuid("Please select the correct member"),
  reason: z.string().max(500, "Keep the reason under 500 characters").optional(),
})

type CorrectionFormValues = z.infer<typeof correctionFormSchema>

type AttendanceCorrectionDialogProps = {
  checkInId: string
  /** Day the wrong check-in was recorded (YYYY-MM-DD in gym timezone). */
  dayKey: string
  /** Members who may be the intended recipient (org-scoped, ACTIVE only). */
  candidates: CorrectionMember[]
  trigger?: React.ReactNode
}

export function AttendanceCorrectionDialog({
  checkInId,
  dayKey,
  candidates,
  trigger,
}: AttendanceCorrectionDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<CorrectionFormValues>({
    resolver: zodResolver(correctionFormSchema),
    defaultValues: { memberId: "", reason: "" },
  })

  function onSubmit(data: CorrectionFormValues) {
    setServerError(null)
    startTransition(async () => {
      const result = await correctAttendanceMember({
        checkInId,
        memberId: data.memberId,
        reason: data.reason?.trim() || undefined,
      })

      if (result.success) {
        toast.success("Attendance corrected")
        setOpen(false)
        form.reset()
        router.refresh()
      } else {
        setServerError(result.error ?? null)
      }
    })
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      form.reset()
      setServerError(null)
    }
  }

  const selectedMemberId = form.watch("memberId")

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger ? undefined : <Button />}>
        {trigger ?? "Correct Attendance"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Correct Attendance</DialogTitle>
          <DialogDescription>
            Reassign this QR check-in from {dayKey} to the correct member. The
            original record is reassigned — never deleted.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormServerError>{serverError}</FormServerError>

            <FormField
              control={form.control}
              name="memberId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Correct member</FormLabel>
                  <FormControl>
                    <EntityCombobox
                      value={field.value}
                      onValueChange={field.onChange}
                      options={candidates.map((m) => ({
                        id: m.id,
                        label: memberSelectionLabel(m),
                        sublabel: memberSelectionSublabel(m),
                      }))}
                      placeholder="Search or select the member"
                      emptyText="No members found."
                    />
                  </FormControl>
                  <FormDescription>
                    The member who actually attended on {dayKey}.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g. member checked in under the wrong name"
                      maxLength={500}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={isPending || !selectedMemberId}>
                {isPending ? "Correcting..." : "Correct Attendance"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}