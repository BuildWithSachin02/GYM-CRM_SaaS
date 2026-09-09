"use client"

import { useState, useTransition, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import { manualCheckin } from "@/lib/actions/attendance"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  const [search, setSearch] = useState("")

  const form = useForm<ManualCheckinFormValues>({
    resolver: zodResolver(manualCheckinFormSchema),
    defaultValues: { memberId: "" },
  })

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return members
    const q = search.toLowerCase()
    return members.filter(
      (m) =>
        m.firstName.toLowerCase().includes(q) ||
        m.lastName.toLowerCase().includes(q) ||
        `${m.firstName} ${m.lastName}`.toLowerCase().includes(q)
    )
  }, [members, search])

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
        setSearch("")
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
      setSearch("")
    }
  }

  const selectedMemberId = form.watch("memberId")
  const selectedMember = members.find((m) => m.id === selectedMemberId)

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
                  <div className="space-y-2">
                    <Input
                      placeholder="Search members..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {selectedMember && (
                      <p className="text-sm text-muted-foreground">
                        Selected:{" "}
                        <span className="font-medium text-foreground">
                          {selectedMember.firstName} {selectedMember.lastName}
                        </span>
                      </p>
                    )}
                    <div className="max-h-48 overflow-y-auto rounded-lg border">
                      {filteredMembers.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-muted-foreground">
                          No members found.
                        </p>
                      ) : (
                        filteredMembers.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              field.onChange(m.id)
                              setSearch(
                                `${m.firstName} ${m.lastName}`
                              )
                            }}
                            className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                              field.value === m.id ? "bg-muted font-medium" : ""
                            }`}
                          >
                            {m.firstName} {m.lastName}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                  <FormControl>
                    <input type="hidden" {...field} />
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
