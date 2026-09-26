"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  TriangleAlert,
  XCircle,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/common/status-badge"
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
import { BranchFormDialog } from "@/components/branches/branch-form-dialog"
import { BranchStaffDialog } from "@/components/branches/branch-staff-dialog"
import { branchCardActions } from "@/lib/branch-rules"
import { formatMoney } from "@/lib/format"
import { BRANCH_STATUS } from "@/lib/status"
import { deactivateBranch, reactivateBranch } from "@/lib/actions/branches"
import type { BranchCardModel, BranchStaffOption } from "@/lib/domain/branches"

/**
 * The branch detail view.
 *
 * Reuses the exact same card model as the directory, so a figure can never mean
 * two different things between the grid and the detail page. The quick links
 * carry `?branch=<id>`, which every target page re-validates server-side, so
 * following one keeps the visitor inside this branch's data.
 */

type BranchOverviewProps = {
  branch: BranchCardModel
  currency: string
  staff: BranchStaffOption[] | null
  assignments: { userId: string; isPrimary: boolean }[] | null
}

export function BranchOverview({
  branch,
  currency,
  staff,
  assignments,
}: BranchOverviewProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const status = BRANCH_STATUS[branch.status]
  const actions = branchCardActions({
    status: branch.status,
    canEdit: branch.canEdit,
    canManageStaff: branch.canManageStaff,
    canDeactivate: branch.canDeactivate,
  })
  const addressLine = [branch.address, branch.city, branch.state].filter(Boolean).join(", ")

  function onReactivate() {
    startTransition(async () => {
      const res = await reactivateBranch(branch.id)
      if (res.success) {
        toast.success("Branch reactivated")
        router.refresh()
      } else {
        toast.error(res.error ?? "Could not reactivate branch")
      }
    })
  }

  function onDeactivate() {
    startTransition(async () => {
      const res = await deactivateBranch(branch.id)
      setConfirmDeactivate(false)
      if (res.success) {
        toast.success("Branch deactivated")
        router.refresh()
      } else {
        toast.error(res.error ?? "Could not deactivate branch")
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" render={<Link href="/dashboard/branches" />}>
            <ArrowLeft className="size-4" /> Branches
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions.includes("edit") && (
            <BranchFormDialog
              branch={{
                id: branch.id,
                name: branch.name,
                phone: branch.phone,
                email: branch.email,
                address: branch.address,
                city: branch.city,
                state: branch.state,
                country: branch.country,
              }}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil className="size-4" /> Edit
                </Button>
              }
            />
          )}
          {actions.includes("staff") && (
            <BranchStaffDialog
              branchId={branch.id}
              branchName={branch.name}
              staff={staff ?? []}
              assigned={assignments ?? []}
            />
          )}
          {actions.includes("deactivate") && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={isPending}
              onClick={() => setConfirmDeactivate(true)}
            >
              <XCircle className="size-4" /> Deactivate
            </Button>
          )}
          {actions.includes("reactivate") && (
            <Button variant="outline" size="sm" disabled={isPending} onClick={onReactivate}>
              <CheckCircle2 className="size-4" /> Reactivate
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-start gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Building2 className="size-6" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{branch.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="font-mono text-[11px]">
              {branch.branchCode}
            </Badge>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            {branch.isPrimaryForViewer && <Badge variant="outline">Your primary branch</Badge>}
          </div>
        </div>
      </div>

      {branch.attention.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {branch.attention.map((item) => (
            <li
              key={item.id}
              className={
                item.tone === "warning"
                  ? "flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400"
                  : "flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
              }
            >
              {item.tone === "warning" && <TriangleAlert className="size-3.5" />}
              {item.label}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Quick overview</CardTitle>
            <p className="text-xs text-muted-foreground">
              This branch&apos;s own records only — organization-wide entries are not counted
              here.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {branch.metrics.map((metric) => (
                <div key={metric.id} className="rounded-lg bg-muted/50 px-3 py-3">
                  <p className="text-xl font-semibold leading-none tabular-nums">
                    {metric.kind === "money" ? formatMoney(metric.value, currency) : metric.value}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {metric.label}
                    {metric.hint && <span className="block opacity-70">{metric.hint}</span>}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
          {branch.quickLinks.length > 0 && (
            <CardFooter className="flex flex-wrap gap-2">
              {branch.quickLinks.map((link) => (
                <Link
                  key={link.id}
                  href={link.href}
                  className="rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {link.label}
                </Link>
              ))}
            </CardFooter>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <DetailRow icon={Phone} label="Phone" value={branch.phone} />
            <DetailRow icon={Mail} label="Email" value={branch.email} />
            <DetailRow icon={MapPin} label="Address" value={addressLine || null} />
            {branch.staffCount !== null && (
              <p className="text-xs text-muted-foreground">
                {branch.staffCount} staff assigned to this branch
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {branch.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Check-ins and QR sessions at this branch will stop working. Historical data
              stays, and the branch can be reactivated any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDeactivate}>
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | null
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
      <span className="w-16 shrink-0 text-xs text-muted-foreground/70">{label}</span>
      <span className="min-w-0 truncate font-medium text-foreground/80">{value || "—"}</span>
    </div>
  )
}
