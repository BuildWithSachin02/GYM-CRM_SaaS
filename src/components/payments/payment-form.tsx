"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import { fullName } from "@/lib/format"
import { recordPayment } from "@/lib/actions/payments"

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

const PAYMENT_METHODS = ["CASH", "UPI", "CARD", "BANK_TRANSFER"] as const

const paymentFormSchema = z.object({
  memberId: z.string().min(1, "Select a member"),
  amount: z
    .string()
    .trim()
    .min(1, "Enter an amount")
    .refine((v) => !Number.isNaN(Number(v)), "Enter a valid amount")
    .refine((v) => Number(v) > 0, "Amount must be positive")
    .refine((v) => Number(v) <= 1_000_000, "Amount too large"),
  method: z.enum(PAYMENT_METHODS),
  paymentDate: z.string().min(1, "Select a date"),
  reference: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
})

type PaymentFormValues = z.infer<typeof paymentFormSchema>

type PaymentFormProps = {
  members: { id: string; firstName: string; lastName: string; phone: string }[]
  trigger?: React.ReactNode
}

export function PaymentForm({ members, trigger }: PaymentFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: {
      memberId: "",
      amount: "",
      method: "CASH",
      paymentDate: new Date().toISOString().slice(0, 10),
      reference: "",
      notes: "",
    },
  })

  function onSubmit(data: PaymentFormValues) {
    setServerError(null)
    startTransition(async () => {
      const result = await recordPayment({
        memberId: data.memberId,
        amountMinor: Math.round(Number(data.amount) * 100),
        method: data.method,
        paymentDate: data.paymentDate,
        reference: data.reference || null,
        notes: data.notes || null,
      })

      if (result.success) {
        toast.success("Payment recorded")
        setOpen(false)
        form.reset()
        router.refresh()
      } else {
        setServerError(result.error)
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
        {trigger ?? "Record Payment"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            Log a manual payment received from a member.
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
                    <EntityCombobox
                      value={field.value}
                      onValueChange={(val) => field.onChange(val ?? "")}
                      options={members.map((m) => ({
                        id: m.id,
                        label: fullName(m.firstName, m.lastName),
                        sublabel: m.phone,
                      }))}
                      placeholder="Search or select a member"
                      emptyText="No members found."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
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
              <FormField
                control={form.control}
                name="paymentDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
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
                        field.onChange(
                          val as PaymentFormValues["method"]
                        )
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select method" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CASH">Cash</SelectItem>
                        <SelectItem value="UPI">UPI</SelectItem>
                        <SelectItem value="CARD">Card</SelectItem>
                        <SelectItem value="BANK_TRANSFER">
                          Bank Transfer
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Transaction ID, receipt no., etc."
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
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Optional notes about this payment"
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
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Recording..." : "Record Payment"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
