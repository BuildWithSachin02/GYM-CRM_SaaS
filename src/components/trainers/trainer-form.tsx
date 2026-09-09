"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import { createTrainer } from "@/lib/actions/trainers"
import { USER_ROLE } from "@/lib/status"

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
import { Switch } from "@/components/ui/switch"
import type { StaffOption, TrainerRow } from "@/components/trainers/trainer-list"

const trainerFormSchema = z.object({
  userId: z.string().min(1, "Select a staff member"),
  bio: z.string().trim().max(500).optional(),
  specialties: z.string().trim().max(300).optional(),
  active: z.boolean(),
})

type TrainerFormValues = z.infer<typeof trainerFormSchema>

type TrainerFormProps = {
  trigger: React.ReactNode
  availableUsers: StaffOption[]
  trainer?: TrainerRow
}

export function TrainerForm({ trigger, availableUsers, trainer }: TrainerFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<TrainerFormValues>({
    resolver: zodResolver(trainerFormSchema),
    defaultValues: {
      userId: trainer?.user.id ?? "",
      bio: trainer?.bio ?? "",
      specialties: trainer?.specialties.join(", ") ?? "",
      active: trainer?.active ?? true,
    },
  })

  function onSubmit(data: TrainerFormValues) {
    setServerError(null)
    const specialties = data.specialties
      ? data.specialties.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10)
      : []
    startTransition(async () => {
      const res = await createTrainer({
        userId: data.userId,
        bio: data.bio || null,
        specialties,
        active: data.active,
      })
      if (res.success) {
        toast.success("Trainer created")
        setOpen(false)
        router.refresh()
      } else {
        setServerError(res.error ?? "Something went wrong")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ? undefined : <Button />}>
        {trigger ?? "Add Trainer"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Trainer</DialogTitle>
          <DialogDescription>Assign a staff member as a trainer.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormServerError>{serverError}</FormServerError>

            <FormField
              control={form.control}
              name="userId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Staff Member *</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={(val) => field.onChange(val)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select staff member" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableUsers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name} · {USER_ROLE[u.role].label}
                          </SelectItem>
                        ))}
                        {availableUsers.length === 0 && (
                          <div className="px-3 py-2 text-sm text-muted-foreground">
                            No available staff to add.
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="bio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bio</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Short bio / certifications"
                      className="min-h-16"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="specialties"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Specialties</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Weight Training, HIIT, Yoga (comma separated)"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Active</FormLabel>
                    <p className="text-xs text-muted-foreground">Available for assignments</p>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating..." : "Create Trainer"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}