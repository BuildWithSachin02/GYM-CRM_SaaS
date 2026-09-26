"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  MapPin,
  Pencil,
  Phone,
  TriangleAlert,
  XCircle,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
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
import { BranchFormDialog } from "@/components/branches/branch-form-dialog"
import { BranchStaffDialog } from "@/components/branches/branch-staff-dialog"
import { BRANCH_STATUS } from "@/lib/status"
import { branchCardActions } from "@/lib/branch-rules"
import type { BranchMetric } from "@/lib/branch-overview"
import { formatMoney } from "@/lib/format"
import { deactivateBranch, reactivateBranch } from "@/lib/actions/branches"
import type { BranchCardModel, BranchStaffOption } from "@/lib/domain/branches"

/**
 * One branch card.
 *
 * Every number on this card is branch-attributed by the server (see
 * `getBranchDirectory`) — the component only formats and lays it out. The action
 * buttons are derived from the viewer's EFFECTIVE branch permissions plus the
 * branch's lifecycle state by the pure `branchCardActions` rule, so the UI can
 * never offer an action the server would reject.
 *
 * The quick links are permission-filtered and carry `?branch=<id>`; the target
 * page re-validates that id server-side before narrowing any query, so
 * following one never loses (or widens) branch context.
 */

type BranchCardProps = {
  branch: BranchCardModel
  currency: string
  staff: BranchStaffOption[]
  assignments: { userId: string; isPrimary: boolean }[]
}

export function BranchCard({ branch, currency, staff, assignments }: BranchCardProps) {
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
  const inactive = branch.status !== "ACTIVE"
  const location = [branch.city, branch.state].filter(Boolean).join(", ")

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

  return (
    <Card className={inactive ? "opacity-80" : undefined}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="size-5" />
          </span>
          <div className="min-w-0">
            <CardTitle className="truncate">
              <Link
                href={branch.detailHref}
                className="outline-none hover:underline focus-visible:underline"
              >
                {branch.name}
              </Link>
            </CardTitle>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="font-mono text-[11px]">
                {branch.branchCode}
              </Badge>
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              {branch.isPrimaryForViewer && <Badge variant="outline">Primary</Badge>}
            </div>
          </div>
        </div>
        {location && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate">{location}</span>
          </p>
        )}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {branch.metrics.map((metric) => (
            <BranchMetricTile key={metric.id} metric={metric} currency={currency} />
          ))}
        </div>

        {branch.attention.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {branch.attention.map((item) => (
              <li
                key={item.id}
                className={
                  item.tone === "warning"
                    ? "flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400"
                    : "flex items-center gap-1.5 text-xs text-muted-foreground"
                }
              >
                {item.tone === "warning" && <TriangleAlert className="size-3.5 shrink-0" />}
                {item.label}
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-1.5 text-sm text-muted-foreground">
          {branch.phone && (
            <p className="flex items-center gap-2">
              <Phone className="size-3.5 shrink-0 text-muted-foreground/70" />
              <span className="truncate font-medium text-foreground/80">{branch.phone}</span>
            </p>
          )}
          {branch.staffCount !== null && (
            <p className="text-xs text-muted-foreground">
              {branch.staffCount} staff assigned
            </p>
          )}
        </div>
      </CardContent>

      {branch.quickLinks.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-(--card-spacing) pb-3">
          {branch.quickLinks.map((link) => (
            <Link
              key={link.id}
              href={link.href}
              className="rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}

      <CardFooter className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" render={<Link href={branch.detailHref} />}>
          Open branch
          <ArrowRight className="size-4" />
        </Button>
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
              staff={staff}
              assigned={assignments}
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
      </CardFooter>

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
    </Card>
  )
}

function BranchMetricTile({ metric, currency }: { metric: BranchMetric; currency: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-2.5">
      <p className="text-lg font-semibold leading-none tabular-nums">
        {metric.kind === "money" ? formatMoney(metric.value, currency) : metric.value}
      </p>
      <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">
        {metric.label}
        {metric.hint && <span className="block opacity-70">{metric.hint}</span>}
      </p>
    </div>
  )
}
