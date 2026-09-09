"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import { updateTrainer } from "@/lib/actions/trainers"
import type { TrainerRow } from "@/components/trainers/trainer-list"

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
import { Switch } from "@/components/ui/switch"

const editSchema = z.object({
  bio: z.string().trim().max(500).optional(),
  specialties: z.string().trim().max(300).optional(),
  active: z.boolean(),
})

type EditValues = z.infer<typeof editSchema>

type TrainerEditFormProps = {
  trainer: TrainerRow
  trigger: React.ReactNode
}

export function TrainerEditForm({ trainer, trigger }: TrainerEditFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      bio: trainer.bio ?? "",
      specialties: trainer.specialties.join(", ") ?? "",
      active: trainer.active,
    },
  })

  function onSubmit(data: EditValues) {
    setServerError(null)
    const specialties = data.specialties
      ? data.specialties.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10)
      : []
    startTransition(async () => {
      const res = await updateTrainer(trainer.id, {
        userId: trainer.user.id,
        bio: data.bio || null,
        specialties,
        active: data.active,
      })
      if (res.success) {
        toast.success("Trainer updated")
        setOpen(false)
        router.refresh()
      } else {
        setServerError(res.error ?? "Something went wrong")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={undefined}>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Trainer</DialogTitle>
          <DialogDescription>Update {trainer.user.name}&apos;s details.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormServerError>{serverError}</FormServerError>

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
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}