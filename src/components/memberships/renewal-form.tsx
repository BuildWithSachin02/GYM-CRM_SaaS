"use client"

import { useState, useTransition, useMemo, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import { renewMembership } from "@/lib/actions/memberships"
import { formatDate, formatDayKey, formatMoney } from "@/lib/format"

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
    planId: string
    planName: string
    endDate: string
    /** Date-derived lifecycle of the membership being renewed. */
    status: "EXPIRED" | "EXPIRING_SOON"
  }
  /**
   * Server-computed default start date (YYYY-MM-DD) in the org's timezone.
   * It is the earliest start the server will accept, considering the renewed
   * period and every other membership the member holds, so submitting the
   * default never trips the overlap business rule.
   */
  suggestedStart: string
  /**
   * Farthest valid coverage end (YYYY-MM-DD) across the member's records.
   * When `renewedThrough` is set the modal explains that coverage continues
   * past the record being renewed, and that the renewal starts after it.
   */
  coverageThroughKey?: string | null
  /** True when another of the member's records covers past this one's end. */
  renewedThrough?: boolean
  plans: { id: string; name: string; priceMinor: number; durationDays: number }[]
  trigger?: React.ReactNode
}

export function RenewalForm({
  membership,
  suggestedStart,
  coverageThroughKey,
  renewedThrough,
  plans,
  trigger,
}: RenewalFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const currentPlan = useMemo(
    () => plans.find((p) => p.id === membership.planId) ?? null,
    [plans, membership.planId]
  )

  const form = useForm<RenewalFormValues>({
    resolver: zodResolver(renewalFormSchema),
    defaultValues: {
      planId: currentPlan?.id ?? "",
      startDate: suggestedStart,
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
    // Client-side mirror of the server gate: the start can never be earlier
    // than the coverage-based suggestion, so the modal never opens in error.
    if (data.startDate < suggestedStart) {
      form.setError("startDate", {
        type: "manual",
        message: `Start date cannot be before ${formatDayKey(suggestedStart)}`,
      })
      return
    }
    startTransition(async () => {
      const result = await renewMembership({
        membershipId: membership.id,
        planId: data.planId,
        startDate: data.startDate,
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
    if (nextOpen) {
      form.reset()
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

            <p className="text-sm text-muted-foreground">
              {renewedThrough && coverageThroughKey ? (
                <>
                  Your existing membership coverage runs until{" "}
                  {formatDayKey(coverageThroughKey)}. This renewal will start from{" "}
                  {formatDayKey(suggestedStart)} (the day after that coverage
                  ends) unless you change the start date.
                </>
              ) : membership.status === "EXPIRED" ? (
                <>
                  Current membership ended {formatDate(membership.endDate)}. Earliest
                  renewal date is {formatDayKey(suggestedStart)} unless you change
                  the start date.
                </>
              ) : (
                <>
                  Current membership ends {formatDate(membership.endDate)}. Earliest
                  renewal date is {formatDayKey(suggestedStart)} (back-to-back, no
                  overlap) unless you change the start date.
                </>
              )}
            </p>

            <FormField
              control={form.control}
              name="planId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Plan *</FormLabel>
                  <FormControl>
                    <EntityCombobox
                      value={field.value}
                      onValueChange={field.onChange}
                      options={plans.map((p) => ({
                        id: p.id,
                        label: p.name,
                        sublabel: `${formatMoney(p.priceMinor)} · ${p.durationDays} days`,
                      }))}
                      placeholder="Search or select a plan"
                      emptyText="No plans found."
                    />
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
                      <Input
                        type="date"
                        min={suggestedStart}
                        {...field}
                      />
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
