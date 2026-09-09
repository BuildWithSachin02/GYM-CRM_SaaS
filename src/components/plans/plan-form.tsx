"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import type { PlanInterval } from "@prisma/client"
import { PLAN_INTERVAL } from "@/lib/status"
import type { PlanInput } from "@/lib/validators"
import { createPlan, updatePlan } from "@/lib/actions/plans"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const INTERVALS = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"] as const

const planFormSchema = z.object({
  name: z.string().trim().min(1, "Required").max(80),
  billingInterval: z.enum(INTERVALS),
  priceRupees: z
    .string()
    .trim()
    .min(1, "Required")
    .refine((v) => /^\d+$/.test(v), "Enter a valid amount")
    .refine((v) => Number(v) > 0, "Price must be positive")
    .refine((v) => Number(v) <= 100000, "Price too high"),
  durationDays: z
    .string()
    .trim()
    .min(1, "Required")
    .refine((v) => /^\d+$/.test(v), "Duration must be a whole number")
    .refine((v) => Number(v) > 0, "Duration must be positive")
    .refine((v) => Number(v) <= 3650, "Duration too long"),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  active: z.boolean(),
})

type PlanFormValues = z.infer<typeof planFormSchema>

type SerializedPlan = {
  id: string
  name: string
  billingInterval: PlanInterval
  priceMinor: number
  currency: string
  durationDays: number
  description: string | null
  active: boolean
  updatedAt: string
  _count: { memberships: number }
}

type PlanFormProps = {
  plan?: SerializedPlan
  currency?: string
  trigger?: React.ReactNode
}

export function PlanForm({ plan, currency = "INR", trigger }: PlanFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const isEdit = !!plan

  const form = useForm<PlanFormValues>({
    resolver: zodResolver(planFormSchema),
    defaultValues: {
      name: plan?.name ?? "",
      billingInterval: plan?.billingInterval ?? "MONTHLY",
      priceRupees: plan ? String(Math.round(plan.priceMinor / 100)) : "",
      durationDays: plan ? String(plan.durationDays) : "30",
      description: plan?.description ?? "",
      active: plan?.active ?? true,
    },
  })

  function handleIntervalChange(interval: PlanInterval) {
    form.setValue("billingInterval", interval)
    form.setValue("durationDays", String(PLAN_INTERVAL[interval].days))
  }

  function toPlanInput(values: PlanFormValues): PlanInput {
    return {
      name: values.name,
      billingInterval: values.billingInterval,
      priceMinor: Math.round(Number(values.priceRupees) * 100),
      currency,
      durationDays: Number(values.durationDays),
      description: values.description || null,
      active: values.active,
    }
  }

  function onSubmit(data: PlanFormValues) {
    setServerError(null)
    const input = toPlanInput(data)
    startTransition(async () => {
      const result = isEdit
        ? await updatePlan(plan.id, input)
        : await createPlan(input)

      if (result.success) {
        toast.success(isEdit ? "Plan updated" : "Plan created")
        setOpen(false)
        form.reset()
        router.refresh()
      } else {
        setServerError(result.error)
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof PlanFormValues, {
              type: "server",
              message: messages.join(", "),
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger ? undefined : <Button />}>
        {trigger ?? (isEdit ? "Edit" : "Add Plan")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Plan" : "New Plan"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the plan details below."
              : "Create a membership plan for your gym."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormServerError>{serverError}</FormServerError>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Plan Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Silver Monthly" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="billingInterval"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Billing Interval *</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        onValueChange={(val) =>
                          handleIntervalChange(val as PlanInterval)
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INTERVALS.map((interval) => (
                            <SelectItem key={interval} value={interval}>
                              {PLAN_INTERVAL[interval].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priceRupees"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price (₹) *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        placeholder="e.g. 1500"
                        {...field}
                        value={field.value}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="durationDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Duration (days) *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      placeholder="e.g. 30"
                      {...field}
                      value={field.value}
                    />
                  </FormControl>
                  <FormDescription>
                    Auto-filled from interval — adjust manually if needed.
                  </FormDescription>
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
                      placeholder="What's included in this plan?"
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
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-2">
                  <FormLabel className="mb-0">Active</FormLabel>
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
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending
                  ? isEdit
                    ? "Saving..."
                    : "Creating..."
                  : isEdit
                    ? "Save Changes"
                    : "Create Plan"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
