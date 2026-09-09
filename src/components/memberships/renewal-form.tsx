"use client"

import { useState, useTransition, useMemo, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import { renewMembership } from "@/lib/actions/memberships"

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

const renewalFormSchema = z.object({
  planId: z.string().min(1, "Select a plan"),
  startDate: z.string().min(1, "Start date is required"),
  amount: z
    .string()
    .trim()
    .min(1, "Enter an amount")
    .refine((v) => !Number.isNaN(Number(v)), "Enter a valid amount")
    .refine((v) => Number(v) > 0, "Amount must be positive"),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER"]),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
})

type RenewalFormValues = z.infer<typeof renewalFormSchema>

type RenewalFormProps = {
  membership: {
    id: string
    memberId: string
    memberName: string
    planName: string
    endDate: string
  }
  plans: { id: string; name: string; priceMinor: number; durationDays: number }[]
  trigger?: React.ReactNode
}

export function RenewalForm({ membership, plans, trigger }: RenewalFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const currentPlan = useMemo(
    () => plans.find((p) => p.name === membership.planName) ?? null,
    [plans, membership.planName]
  )

  const form = useForm<RenewalFormValues>({
    resolver: zodResolver(renewalFormSchema),
    defaultValues: {
      planId: currentPlan?.id ?? "",
      startDate: new Date().toISOString().slice(0, 10),
      amount: currentPlan ? String(currentPlan.priceMinor / 100) : "",
      method: "CASH",
      notes: "",
    },
  })

  const selectedPlanId = form.watch("planId")

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) ?? null,
    [plans, selectedPlanId]
  )

  const prevPlanIdRef = useRef<string | null>(currentPlan?.id ?? null)

  useEffect(() => {
    if (selectedPlanId && selectedPlan && selectedPlanId !== prevPlanIdRef.current) {
      prevPlanIdRef.current = selectedPlanId
      form.setValue("amount", String(selectedPlan.priceMinor / 100))
    }
  }, [selectedPlanId, selectedPlan, form])

  function onSubmit(data: RenewalFormValues) {
    setServerError(null)
    if (!selectedPlan) {
      setServerError("Select a valid plan")
      return
    }
    startTransition(async () => {
      const result = await renewMembership({
        membershipId: membership.id,
        planId: data.planId,
        startDate: new Date(data.startDate),
        durationDays: selectedPlan.durationDays,
        amountMinor: Math.round(Number(data.amount) * 100),
        method: data.method,
        notes: data.notes || null,
      })

      if (result.success) {
        toast.success("Membership renewed")
        setOpen(false)
        form.reset()
        router.refresh()
      } else {
        setServerError(result.error)
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof RenewalFormValues, {
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
      setServerError(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger ? undefined : <Button />}>
        {trigger ?? "Renew"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Renew Membership</DialogTitle>
          <DialogDescription>
            Renew membership for {membership.memberName}.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormServerError>{serverError}</FormServerError>

            <FormField
              control={form.control}
              name="planId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Plan *</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={(val) => field.onChange(val)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a plan" />
                      </SelectTrigger>
                      <SelectContent>
                        {plans.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} ({p.durationDays} days)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (₹) *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        placeholder="0.00"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Method *</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={(val) =>
                        field.onChange(val as RenewalFormValues["method"])
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select method" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CASH">Cash</SelectItem>
                        <SelectItem value="UPI">UPI</SelectItem>
                        <SelectItem value="CARD">Card</SelectItem>
                        <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Optional notes"
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
                {isPending ? "Renewing..." : "Renew Membership"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
