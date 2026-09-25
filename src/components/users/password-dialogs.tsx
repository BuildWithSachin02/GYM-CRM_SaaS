"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { KeyRound } from "lucide-react"

import { changeOwnPassword, resetPassword } from "@/lib/actions/users"

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

// ---------------------------------------------------------------------------
// Reset a different user's password (staff:manage)
// ---------------------------------------------------------------------------

const resetSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
  confirm: z.string().min(1, "Confirm the password"),
}).refine((v) => v.newPassword === v.confirm, {
  message: "Passwords do not match",
  path: ["confirm"],
})

type ResetValues = z.infer<typeof resetSchema>

type ResetPasswordDialogProps = {
  staffId: string
  staffName: string
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ResetPasswordDialog({
  staffId,
  staffName,
  trigger,
  open,
  onOpenChange,
}: ResetPasswordDialogProps) {
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const setOpen = (value: boolean) => (isControlled ? onOpenChange?.(value) : setInternalOpen(value))

  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: "", confirm: "" },
  })

  function onSubmit(data: ResetValues) {
    setServerError(null)
    startTransition(async () => {
      const res = await resetPassword({ staffId, newPassword: data.newPassword })
      if (res.success) {
        toast.success("Password reset — the user is signed out everywhere")
        setOpen(false)
        form.reset()
        router.refresh()
      } else {
        setServerError(res.error ?? "Something went wrong")
      }
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {isControlled ? null : (
        <DialogTrigger render={trigger ? undefined : <Button variant="ghost" size="sm" />}>
          {trigger ?? (
            <>
              <KeyRound className="size-3.5" /> Reset password
            </>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for {staffName}. They will need to sign in again.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormServerError>{serverError}</FormServerError>

            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password *</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Min 8 characters" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirm"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm password *</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Repeat the password" {...field} />
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
                {isPending ? "Resetting..." : "Reset password"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Change own password
// ---------------------------------------------------------------------------

const changeOwnSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
    confirm: z.string().min(1, "Confirm the password"),
  })
  .refine((v) => v.newPassword === v.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  })

type ChangeOwnValues = z.infer<typeof changeOwnSchema>

type ChangeOwnPasswordDialogProps = {
  trigger?: React.ReactNode
}

export function ChangeOwnPasswordDialog({ trigger }: ChangeOwnPasswordDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<ChangeOwnValues>({
    resolver: zodResolver(changeOwnSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
  })

  function onSubmit(data: ChangeOwnValues) {
    setServerError(null)
    startTransition(async () => {
      const res = await changeOwnPassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
        confirmPassword: data.confirm,
      })
      if (res.success) {
        toast.success("Password changed. All your other sessions were signed out.")
        setOpen(false)
        form.reset()
        router.refresh()
      } else {
        setServerError(res.error ?? "Something went wrong")
        if (res.fieldErrors) {
          for (const [key, messages] of Object.entries(res.fieldErrors)) {
            if (messages[0]) form.setError(key as never, { message: messages[0] })
          }
        }
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ? undefined : <Button variant="outline" size="sm" />}>
        {trigger ?? (
          <>
            <KeyRound className="size-3.5" /> Change my password
          </>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change my password</DialogTitle>
          <DialogDescription>
            Changing your password signs all other sessions out for security.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormServerError>{serverError}</FormServerError>

            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current password *</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password *</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Min 8 characters" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirm"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm new password *</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
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
                {isPending ? "Changing..." : "Change password"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}