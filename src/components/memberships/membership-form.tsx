"use client"

import { useState, useTransition, useMemo, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import { formatMoney } from "@/lib/format"
import {
  memberSelectionLabel,
  memberSelectionSublabel,
} from "@/lib/member-code"
import { createMembership } from "@/lib/actions/memberships"

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

const membershipFormSchema = z.object({
  memberId: z.string().min(1, "Select a member"),
  planId: z.string().min(1, "Select a plan"),
  startDate: z.string().min(1, "Start date is required"),
  amount: z
    .string()
    .trim()
    .min(1, "Enter an amount")
    .refine((v) => !Number.isNaN(Number(v)), "Enter a valid amount")
    .refine((v) => Number(v) > 0, "Amount must be positive"),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
})

type MembershipFormValues = z.infer<typeof membershipFormSchema>

type MembershipFormProps = {
  members: {
    id: string
    firstName: string
    lastName: string
    memberCode?: string | null
    phone?: string | null
  }[]
  plans: { id: string; name: string; priceMinor: number; durationDays: number }[]
  /** Business date (YYYY-MM-DD) in the org's timezone, from the server. */
  todayKey: string
  /** Lock the form to one member (e.g. from a member profile page). */
  defaultMemberId?: string
  trigger?: React.ReactNode
}

export function MembershipForm({
  members,
  plans,
  todayKey,
  defaultMemberId,
  trigger,
}: MembershipFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const lockedMember = defaultMemberId
    ? members.find((m) => m.id === defaultMemberId) ?? null
    : null

  const form = useForm<MembershipFormValues>({
    resolver: zodResolver(membershipFormSchema),
    defaultValues: {
      memberId: defaultMemberId ?? "",
      planId: "",
      startDate: todayKey,
      amount: "",
      notes: "",
    },
  })

  const selectedPlanId = form.watch("planId")

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) ?? null,
    [plans, selectedPlanId]
  )

  const prevPlanIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (selectedPlanId && selectedPlan && selectedPlanId !== prevPlanIdRef.current) {
      prevPlanIdRef.current = selectedPlanId
      form.setValue("amount", String(selectedPlan.priceMinor / 100))
    }
  }, [selectedPlanId, selectedPlan, form])

  function onSubmit(data: MembershipFormValues) {
    setServerError(null)
    if (!selectedPlan) {
      setServerError("Select a valid plan")
      return
    }
    startTransition(async () => {
      const result = await createMembership({
        memberId: data.memberId,
        planId: data.planId,
        startDate: data.startDate,
        durationDays: selectedPlan.durationDays,
        amountMinor: Math.round(Number(data.amount) * 100),
        notes: data.notes || null,
      })

      if (result.success) {
        toast.success("Membership created")
        setOpen(false)
        form.reset()
        prevPlanIdRef.current = null
        router.refresh()
      } else {
        setServerError(result.error)
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof MembershipFormValues, {
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
      prevPlanIdRef.current = null
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger ? undefined : <Button />}>
        {trigger ?? "New Membership"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Membership</DialogTitle>
          <DialogDescription>
            Assign a plan to this member. Payment is recorded separately when
            you receive it.
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
                  <FormLabel>Member *</FormLabel>
                  <FormControl>
                    {lockedMember ? (
                      <Input
                        value={memberSelectionLabel(lockedMember)}
                        readOnly
                        disabled
                      />
                    ) : (
                      <EntityCombobox
                        value={field.value}
                        onValueChange={field.onChange}
                        options={members.map((m) => ({
                          id: m.id,
                          label: memberSelectionLabel(m),
                          sublabel: memberSelectionSublabel(m),
                        }))}
                        placeholder="Search or select a member"
                        emptyText="No members found."
                      />
                    )}
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                    <FormLabel>Plan price (₹) *</FormLabel>
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
                {isPending ? "Creating..." : "Create Membership"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
