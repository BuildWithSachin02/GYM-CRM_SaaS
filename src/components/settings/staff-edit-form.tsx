"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Pencil } from "lucide-react"

import { updateStaff } from "@/lib/actions/settings"
import { USER_ROLE } from "@/lib/status"
import type { UserRole } from "@prisma/client"
import type { StaffData } from "@/components/settings/settings-page"

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

const staffEditSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  phone: z.string().trim().optional().nullable(),
  role: z.enum(["OWNER", "ADMIN", "RECEPTIONIST", "TRAINER"]),
  status: z.enum(["ACTIVE", "DEACTIVATED"]),
  password: z
    .string()
    .optional()
    .nullable()
    .refine((v) => !v || v.length >= 8, {
      message: "Password must be at least 8 characters",
    }),
})

type StaffEditValues = z.infer<typeof staffEditSchema>

type StaffEditFormProps = {
  staff: StaffData
  defaultStatus?: "ACTIVE" | "DEACTIVATED"
  trigger?: React.ReactNode
}

export function StaffEditForm({ staff, defaultStatus, trigger }: StaffEditFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<StaffEditValues>({
    resolver: zodResolver(staffEditSchema),
    defaultValues: {
      name: staff.name,
      phone: staff.phone ?? "",
      role: staff.role,
      status: defaultStatus ?? staff.status,
      password: "",
    },
  })

  function onSubmit(data: StaffEditValues) {
    setServerError(null)
    startTransition(async () => {
      const res = await updateStaff(staff.id, {
        staffId: staff.id,
        name: data.name,
        phone: data.phone || null,
        role: data.role,
        status: data.status,
        password: data.password || null,
      })
      if (res.success) {
        toast.success("Staff updated")
        setOpen(false)
        router.refresh()
      } else {
        setServerError(res.error ?? "Something went wrong")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ? undefined : <Button variant="ghost" size="icon-sm" />}>
        {trigger ?? <Pencil className="size-3.5" />}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Staff</DialogTitle>
          <DialogDescription>Update {staff.name}&apos;s details.</DialogDescription>
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

            <div className="grid grid-cols-2 gap-3">
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
                          {(Object.entries(USER_ROLE) as [UserRole, (typeof USER_ROLE)[UserRole]][]).map(
                            ([value, { label }]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            )
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
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status *</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ACTIVE">Active</SelectItem>
                          <SelectItem value="DEACTIVATED">Deactivated</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Leave blank to keep current"
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
                {isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
