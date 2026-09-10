"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import { manualCheckin } from "@/lib/actions/attendance"

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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormServerError,
} from "@/components/ui/form"
import { EntityCombobox } from "@/components/ui/entity-combobox"

type Member = { id: string; firstName: string; lastName: string }

const manualCheckinFormSchema = z.object({
  memberId: z.string().uuid("Please select a member"),
})

type ManualCheckinFormValues = z.infer<typeof manualCheckinFormSchema>

type ManualCheckinFormProps = {
  members: Member[]
  trigger?: React.ReactNode
}

export function ManualCheckinForm({ members, trigger }: ManualCheckinFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<ManualCheckinFormValues>({
    resolver: zodResolver(manualCheckinFormSchema),
    defaultValues: { memberId: "" },
  })

  function onSubmit(data: ManualCheckinFormValues) {
    setServerError(null)
    startTransition(async () => {
      const result = await manualCheckin({
        memberId: data.memberId,
      })

      if (result.success) {
        toast.success("Member checked in successfully")
        setOpen(false)
        form.reset()
        router.refresh()
      } else {
        setServerError(result.error ?? null)
        if (result.fieldErrors) {
          for (const [field, message] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof ManualCheckinFormValues, {
              type: "server",
              message,
            })
          }
        }
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
        {trigger ?? "Mark Attendance"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manual Check-in</DialogTitle>
          <DialogDescription>
            Select a member to record their attendance.
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
                  <FormLabel>Member</FormLabel>
                  <FormControl>
                    <EntityCombobox
                      value={field.value}
                      onValueChange={field.onChange}
                      options={members.map((m) => ({
                        id: m.id,
                        label: `${m.firstName} ${m.lastName}`.trim(),
                      }))}
                      placeholder="Search or select a member"
                      emptyText="No members found."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={isPending || !selectedMemberId}>
                {isPending ? "Checking in..." : "Check In"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
