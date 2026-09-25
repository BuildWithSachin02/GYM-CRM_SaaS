"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ShieldCheck } from "lucide-react"

import {
  getStaffPermissionDetail,
  updateUserPermissions,
  type StaffUserDTO,
} from "@/lib/actions/users"
import { roleDefaultPermissions } from "@/lib/permissions"
import { defaultPermissionMap } from "@/lib/permission-ui"
import { USER_ROLE } from "@/lib/status"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { StatusBadge } from "@/components/common/status-badge"
import { PermissionMatrix } from "@/components/users/permission-matrix"

type Role = StaffUserDTO["role"]

const SENSITIVE_GRANTS = new Set<string>(["staff:manage"])

type PermissionEditorDialogProps = {
  staff: StaffUserDTO
  /** Effective permission keys of the ACTOR (locks grants beyond their reach). */
  actorPermissions: string[]
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function PermissionEditorDialog({
  staff,
  actorPermissions,
  trigger,
  open,
  onOpenChange,
}: PermissionEditorDialogProps) {
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)
  const [granted, setGranted] = useState<Record<string, boolean>>({})
  const [confirmSensitive, setConfirmSensitive] = useState(false)
  const [original, setOriginal] = useState<Record<string, boolean>>({})
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)

  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const setOpen = (value: boolean) => (isControlled ? onOpenChange?.(value) : setInternalOpen(value))

  const roleTone = (USER_ROLE[staff.role as Role] ?? { tone: "muted" }).tone as Parameters<
    typeof StatusBadge
  >[0]["tone"]
  const roleLabel = USER_ROLE[staff.role as Role]?.label ?? staff.role

  useEffect(() => {
    if (!open) return
    getStaffPermissionDetail(staff.id).then((detail) => {
      if (!detail) {
        setServerError("Staff member not found")
        setLoading(false)
        return
      }
      const map: Record<string, boolean> = {}
      for (const row of detail.rows) map[row.permission] = row.granted
      setGranted(map)
      setOriginal(map)
      setConfirmSensitive(false)
      setLoading(false)
    })
  }, [open, staff.id])

  const isOwner = staff.role === "OWNER"

  const roleDefaults = useMemo(
    () => new Set(roleDefaultPermissions(staff.role as Role)),
    [staff.role]
  )

  const grantable = useMemo(() => new Set(actorPermissions), [actorPermissions])

  const needsSensitiveConfirmation = useMemo(() => {
    if (isOwner) return false
    return [...SENSITIVE_GRANTS].some((p) => granted[p] && !original[p])
  }, [granted, isOwner, original])

  const saveDisabled = loading || isPending || (needsSensitiveConfirmation && !confirmSensitive)

  function resetToRoleDefaults() {
    setGranted(defaultPermissionMap(staff.role as Role))
    setConfirmSensitive(false)
    setConfirmResetOpen(false)
  }

  function onSubmit() {
    setServerError(null)
    startTransition(async () => {
      const res = await updateUserPermissions({ staffId: staff.id, permissions: granted })
      if (res.success) {
        toast.success("Permissions updated")
        setOpen(false)
        router.refresh()
      } else {
        setServerError(res.error ?? "Something went wrong")
      }
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {isControlled ? null : (
        <DialogTrigger render={trigger ? undefined : <Button variant="outline" size="sm" />}>
          {trigger ?? (
            <>
              <ShieldCheck className="size-3.5" /> Permissions
            </>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-xl md:max-w-3xl lg:max-w-4xl xl:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Access Permissions</DialogTitle>
          <DialogDescription>
            {staff.name} <span className="text-muted-foreground">({staff.email})</span> —{" "}
            <StatusBadge tone={roleTone}>{roleLabel}</StatusBadge>
          </DialogDescription>
        </DialogHeader>

        {isOwner ? (
          <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="font-medium">Owner access</p>
              <p className="text-sm text-muted-foreground">
                This account has full access to the CRM. Owner permissions cannot be restricted
                from this screen.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="min-w-0 text-muted-foreground">
                Role defaults: <span className="font-medium text-foreground">{roleLabel}</span> —
                the baseline {staff.name.split(" ")[0]} started from. Unchecking a granted
                permission revokes it immediately after saving.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmResetOpen(true)}
                disabled={loading || isPending}
              >
                Reset to role defaults
              </Button>
            </div>

            {serverError && <p className="text-sm text-destructive">{serverError}</p>}

            {loading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Loading permissions…
              </p>
            ) : (
              <PermissionMatrix
                value={granted}
                onChange={setGranted}
                grantable={grantable}
                roleDefaults={roleDefaults}
                disabled={isPending}
              />
            )}

            {needsSensitiveConfirmation && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <Checkbox
                  checked={confirmSensitive}
                  onCheckedChange={(v) => setConfirmSensitive(Boolean(v))}
                  aria-label="Confirm granting user-management access"
                />
                <div>
                  <p className="font-medium text-amber-700 dark:text-amber-500">
                    Staff management access requires confirmation
                  </p>
                  <p className="text-xs text-muted-foreground">
                    This user will be able to create/edit staff accounts, reset passwords and
                    change other people&apos;s permissions. Confirm to save.
                  </p>
                </div>
              </div>
            )}

            <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-col-reverse gap-2 border-t bg-popover p-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={onSubmit}
                disabled={saveDisabled}
                title={
                  needsSensitiveConfirmation
                    ? "Confirm granting user-management access to save"
                    : undefined
                }
              >
                {isPending ? "Saving..." : "Save permissions"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>

      <AlertDialog open={confirmResetOpen} onOpenChange={setConfirmResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to {roleLabel} role defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              {staff.name}&apos;s permissions will return to what the {roleLabel} role grants by
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