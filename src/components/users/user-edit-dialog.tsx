"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Pencil } from "lucide-react"

import { updateStaff } from "@/lib/actions/users"
import { USER_ROLE } from "@/lib/status"
import type { UserRole } from "@prisma/client"
import type { StaffUserDTO } from "@/lib/actions/users"

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const USERNAME_HINT = "3-32 characters: letters, numbers, dots, underscores or hyphens"

const editUserSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  phone: z.string().trim().optional().nullable(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/, USERNAME_HINT)
    .optional()
    .nullable(),
  role: z.enum(["OWNER", "ADMIN", "RECEPTIONIST", "TRAINER"]),
  status: z.enum(["ACTIVE", "DEACTIVATED"]),
})

type EditUserValues = z.infer<typeof editUserSchema>

type UserEditDialogProps = {
  staff: StaffUserDTO
  isOwnerActor: boolean
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function UserEditDialog({ staff, isOwnerActor, trigger, open, onOpenChange }: UserEditDialogProps) {
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const setOpen = (value: boolean) => (isControlled ? onOpenChange?.(value) : setInternalOpen(value))

  const form = useForm<EditUserValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      name: staff.name,
      phone: staff.phone ?? "",
      username: staff.username ?? "",
      role: staff.role,
      status: staff.status,
    },
  })

  const roleOptions = (Object.entries(USER_ROLE) as [UserRole, (typeof USER_ROLE)[UserRole]][])
    .map(([value, { label }]) => ({ value, label }))
    .filter((r) => r.value !== "OWNER" || isOwnerActor)

  const selectedStatus = form.watch("status")

  function onSubmit(data: EditUserValues) {
    setServerError(null)
    startTransition(async () => {
      const res = await updateStaff({
        staffId: staff.id,
        name: data.name,
        phone: data.phone || null,
        username: data.username || null,
        role: data.role,
        status: data.status,
      })
      if (res.success) {
        toast.success("User updated")
        setOpen(false)
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
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {isControlled ? null : (
        <DialogTrigger render={trigger ? undefined : <Button variant="ghost" size="icon-sm" />}>
          {trigger ?? <Pencil className="size-3.5" />}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>{staff.email}</DialogDescription>
        </DialogHeader>
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
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
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
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role *</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v)
                      }}
                    >
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
                    {staff.role === "OWNER"
                      ? "Only an owner can be the owner. Existing sessions are signed out."
                      : "Changing the role re-derives default permissions. Existing sessions are signed out."}
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {staff.role === "OWNER" && staff.status === "ACTIVE" ? null : (
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ACTIVE">Active</SelectItem>
                          <SelectItem value="DEACTIVATED">Deactivated</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    {selectedStatus === "DEACTIVATED" && (
                      <p className="text-xs text-amber-600 dark:text-amber-500">
                        Deactivating signs this user out immediately and blocks future logins.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}