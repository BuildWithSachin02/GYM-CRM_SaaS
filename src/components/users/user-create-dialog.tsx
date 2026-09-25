"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { UserPlus, ShieldCheck } from "lucide-react"

import { createStaff } from "@/lib/actions/users"
import { ALL_PERMISSIONS, roleDefaultPermissions } from "@/lib/permissions"
import { defaultPermissionMap } from "@/lib/permission-ui"
import { USER_ROLE } from "@/lib/status"
import type { UserRole } from "@prisma/client"

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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { PermissionMatrix } from "@/components/users/permission-matrix"

const USERNAME_HINT = "3-32 characters: letters, numbers, dots, underscores or hyphens"

const createUserSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  email: z.string().trim().email("Enter a valid email").toLowerCase(),
  phone: z.string().trim().optional().nullable(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/, USERNAME_HINT)
    .optional()
    .nullable(),
  role: z.enum(["OWNER", "ADMIN", "RECEPTIONIST", "TRAINER"]),
  password: z.string().min(8, "Password must be at least 8 characters"),
})

type CreateUserValues = z.infer<typeof createUserSchema>

type UserCreateDialogProps = {
  isOwner: boolean
  /** Effective permission keys of the actor (used to lock un-grantable rows). */
  actorPermissions: string[]
  trigger?: React.ReactNode
}

export function UserCreateDialog({ isOwner, actorPermissions, trigger }: UserCreateDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [permissions, setPermissions] = useState<Record<string, boolean>>(() =>
    defaultPermissionMap("RECEPTIONIST")
  )
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)

  const grantable = useMemo(() => {
    const set = new Set<string>(actorPermissions)
    if (isOwner) for (const key of ALL_PERMISSIONS) set.add(key)
    return set
  }, [actorPermissions, isOwner])

  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      username: "",
      role: "RECEPTIONIST",
      password: "",
    },
  })

  const roleOptions = (Object.entries(USER_ROLE) as [UserRole, (typeof USER_ROLE)[UserRole]][])
    .map(([value, { label }]) => ({ value, label }))
    .filter((r) => r.value !== "OWNER" || isOwner)

  const selectedRole = form.watch("role")
  const selectedRoleLabel = USER_ROLE[selectedRole].label

  function openDialog() {
    setStep(1)
    setServerError(null)
    setPermissions(defaultPermissionMap("RECEPTIONIST"))
    form.reset()
    setOpen(true)
  }

  // Entering step 2 always seeds the editor from the CURRENTLY selected role's
  // defaults — role is the baseline, and the owner can then customize.
  function goToPermissions() {
    form.trigger().then((valid) => {
      if (!valid) return
      setServerError(null)
      setPermissions(defaultPermissionMap(selectedRole))
      setStep(2)
    })
  }

  function resetToRoleDefaults() {
    setPermissions(defaultPermissionMap(selectedRole))
    setServerError(null)
    setConfirmResetOpen(false)
  }

  function onSubmit() {
    setServerError(null)
    startTransition(async () => {
      const res = await createStaff({
        name: form.getValues("name"),
        email: form.getValues("email"),
        phone: form.getValues("phone") || null,
        username: form.getValues("username") || null,
        role: form.getValues("role"),
        password: form.getValues("password"),
        permissions,
      })
      if (res.success) {
        toast.success("User created")
        setOpen(false)
        form.reset()
        setStep(1)
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
    <Dialog open={open} onOpenChange={(next) => (next ? openDialog() : setOpen(false))}>
      <DialogTrigger render={trigger ? undefined : <Button />}>
        {trigger ?? (
          <>
            <UserPlus className="size-4" /> Add User
          </>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl md:max-w-3xl lg:max-w-4xl xl:max-w-6xl">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? "Add User" : "Configure Access"}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              Step {step} of 2
            </span>
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Start with the account details. The user signs in with their email."
              : "Choose what this user can access — permissions start from the selected role's defaults."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormServerError>{serverError}</FormServerError>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Full name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email *</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="name@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input placeholder="optional, e.g. tanvi.fitness" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">{USERNAME_HINT}</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="+91 98765 43210" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role *</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          {roleOptions.map(({ value, label }) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      The role sets the default access — you customize permission-by-permission in the next step.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password *</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Min 8 characters" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={goToPermissions}>
                  Continue
                </Button>
              </DialogFooter>
            </form>
          </Form>
        ) : (
          <div className="space-y-4">
            <FormServerError>{serverError}</FormServerError>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="min-w-0 text-muted-foreground">
                <ShieldCheck className="mr-1.5 inline size-3.5 -translate-y-px text-primary" />
                Role baseline: <span className="font-medium text-foreground">{selectedRoleLabel}</span> —{" "}
                {form.getValues("name") || "the new user"} starts with the {selectedRoleLabel}&apos;s
                defaults. You can customize below.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmResetOpen(true)}
                disabled={isPending}
              >
                Reset to {selectedRoleLabel} defaults
              </Button>
            </div>

            <PermissionMatrix
              value={permissions}
              onChange={setPermissions}
              grantable={grantable}
              roleDefaults={new Set(roleDefaultPermissions(selectedRole))}
              disabled={isPending}
            />

            <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-col-reverse gap-2 border-t bg-popover p-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(1)}
                disabled={isPending}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="button" onClick={onSubmit} disabled={isPending}>
                {isPending ? "Creating..." : "Create User"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>

      <AlertDialog open={confirmResetOpen} onOpenChange={setConfirmResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to {selectedRoleLabel} role defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              The permission selections will return to what the {selectedRoleLabel} role grants by
              default. All custom permission changes will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={resetToRoleDefaults}>Reset permissions</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}