"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { createBranch, updateBranch } from "@/lib/actions/branches"

/**
 * Create / edit branch dialog.
 *
 * The branch CODE is never an input: it is generated server-side, scoped to the
 * organization and permanent (see `@/lib/branch-code`). Everything the server
 * owns — authorization, the code, the name-uniqueness check — is validated
 * again inside the action; this form only does field-level validation and
 * surfaces the server's field errors inline.
 */

const branchFormSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120, "Too long"),
  phone: z.string().trim().max(20).or(z.literal("")),
  email: z
    .string()
    .trim()
    .max(120)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email"),
  address: z.string().trim().max(300).or(z.literal("")),
  city: z.string().trim().max(80).or(z.literal("")),
  state: z.string().trim().max(80).or(z.literal("")),
  country: z.string().trim().max(80).or(z.literal("")),
})

type BranchFormValues = z.infer<typeof branchFormSchema>

export type BranchFormBranch = {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  country: string | null
}

type BranchFormDialogProps = {
  branch?: BranchFormBranch
  /** The caller's trigger button. When omitted, a default "Add Branch" button. */
  trigger?: React.ReactNode
}

export function BranchFormDialog({ branch, trigger }: BranchFormDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<BranchFormValues>({
    resolver: zodResolver(branchFormSchema),
    defaultValues: {
      name: branch?.name ?? "",
      phone: branch?.phone ?? "",
      email: branch?.email ?? "",
      address: branch?.address ?? "",
      city: branch?.city ?? "",
      state: branch?.state ?? "",
      country: branch?.country ?? "",
    },
  })

  function onSubmit(data: BranchFormValues) {
    setServerError(null)
    startTransition(async () => {
      const payload = {
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        address: data.address || null,
        city: data.city || null,
        state: data.state || null,
        country: data.country || null,
      }
      const res = branch
        ? await updateBranch({ branchId: branch.id, ...payload })
        : await createBranch(payload)

      if (res.success) {
        toast.success(branch ? "Branch updated" : "Branch created")
        setOpen(false)
        form.reset()
        router.refresh()
        return
      }
      if (res.fieldErrors?.name) form.setError("name", { message: res.fieldErrors.name[0] })
      setServerError(res.error ?? "Something went wrong")
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setServerError(null) }}>
      <DialogTrigger render={trigger ? undefined : <Button />}>
        {trigger ?? "Add Branch"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{branch ? `Edit ${branch.name}` : "Add a Branch"}</DialogTitle>
          <DialogDescription>
            {branch
              ? "Update this branch's contact details. The branch code never changes."
              : "A unique branch code (BR-XXXX) is generated automatically."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Branch name *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. King's Gym — Main" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input placeholder="+91 98765 43210" {...field} />
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
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="main@kingsgym.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input placeholder="12 MG Road" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input placeholder="Bengaluru" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="state"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>State</FormLabel>
                    <FormControl>
                      <Input placeholder="Karnataka" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <FormControl>
                      <Input placeholder="India" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {serverError && (
              <p className="text-sm font-medium text-destructive">{serverError}</p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : branch ? "Save Changes" : "Create Branch"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
