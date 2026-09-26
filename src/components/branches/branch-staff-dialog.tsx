"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { assignUserToBranch, removeUserFromBranch } from "@/lib/actions/branches"

/**
 * Staff ↔ branch assignment for ONE branch.
 *
 * A UserBranch row is the user's branch SCOPE (which branches they may operate
 * in); the `branches:manage` permission is what lets this dialog be reached at
 * all. Both are re-checked server-side in every action, so this component only
 * ever renders what the server already authorized.
 */

type StaffOption = { id: string; name: string; email: string; role: string }

type StaffAccessDialogProps = {
  branchId: string
  branchName: string
  /** Every active non-owner staff member of the org (the assignable pool). */
  staff: StaffOption[]
  /** Users already assigned to this branch. */
  assigned: { userId: string; isPrimary: boolean }[]
  trigger?: React.ReactNode
}

type DraftEntry = { assigned: boolean; isPrimary: boolean }

export function BranchStaffDialog({
  branchId,
  branchName,
  staff,
  assigned,
  trigger,
}: StaffAccessDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const priorByUser = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const a of assigned) map.set(a.userId, a.isPrimary)
    return map
  }, [assigned])

  const [draft, setDraft] = useState<Record<string, DraftEntry>>(() => {
    const initial: Record<string, DraftEntry> = {}
    for (const user of staff) {
      const isPrimary = priorByUser.get(user.id) ?? false
      initial[user.id] = { assigned: priorByUser.has(user.id), isPrimary }
    }
    return initial
  })

  // Re-seed the draft whenever the dialog is (re)opened so a cancelled edit
  // never leaks into the next open, and a server refresh is reflected.
  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setServerError(null)
      setDraft(
        Object.fromEntries(
          staff.map((user) => {
            const isPrimary = priorByUser.get(user.id) ?? false
            return [user.id, { assigned: priorByUser.has(user.id), isPrimary }]
          })
        )
      )
    }
  }

  const assignedCount = Object.values(draft).filter((d) => d.assigned).length

  function toggleAssigned(userId: string, next: boolean) {
    setDraft((prev) => ({
      ...prev,
      [userId]: { assigned: next, isPrimary: next ? prev[userId]?.isPrimary ?? false : false },
    }))
  }

  function togglePrimary(userId: string, next: boolean) {
    setDraft((prev) => ({ ...prev, [userId]: { assigned: true, isPrimary: next } }))
  }

  function save() {
    setServerError(null)
    startTransition(async () => {
      const failures: string[] = []
      for (const user of staff) {
        const next = draft[user.id] ?? { assigned: false, isPrimary: false }
        const wasAssigned = priorByUser.has(user.id)
        const wasPrimary = priorByUser.get(user.id) ?? false

        if (next.assigned && (!wasAssigned || wasPrimary !== next.isPrimary)) {
          const res = await assignUserToBranch({
            userId: user.id,
            branchId,
            isPrimary: next.isPrimary,
          })
          if (!res.success) failures.push(user.name)
        } else if (!next.assigned && wasAssigned) {
          const res = await removeUserFromBranch({ userId: user.id, branchId })
          if (!res.success) failures.push(user.name)
        }
      }

      if (failures.length > 0) {
        setServerError(`Could not update: ${failures.join(", ")}`)
        return
      }
      toast.success("Staff access updated")
      handleOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={trigger ? undefined : <Button variant="outline" size="sm" />}
      >
        {trigger ?? (
          <>
            <ShieldCheck className="size-4" /> Staff Access
          </>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Staff access — {branchName}</DialogTitle>
          <DialogDescription>
            Assign staff to this branch. Staff see only the branches they belong to;
            a primary branch is their default view.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-80">
          <div className="space-y-1 pr-3">
            {staff.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No active staff to assign. Create staff under Users &amp; Access first.
              </p>
            ) : (
              staff.map((user) => {
                const entry = draft[user.id] ?? { assigned: false, isPrimary: false }
                return (
                  <div
                    key={user.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Checkbox
                        checked={entry.assigned}
                        disabled={isPending}
                        onCheckedChange={(v) => toggleAssigned(user.id, Boolean(v))}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium leading-tight">{user.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {user.role} · {user.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Label
                        htmlFor={`primary-${user.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        Primary
                      </Label>
                      <Switch
                        id={`primary-${user.id}`}
                        size="sm"
                        checked={entry.isPrimary}
                        disabled={!entry.assigned || isPending}
                        onCheckedChange={(v) => togglePrimary(user.id, Boolean(v))}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {assignedCount} of {staff.length} staff assigned
          </span>
          {serverError && <span className="text-[13px] text-destructive">{serverError}</span>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={isPending} onClick={save}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
