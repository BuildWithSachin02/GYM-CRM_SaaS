"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  ShieldAlert,
  Trash2,
} from "lucide-react"

import {
  CATEGORY_META,
  DATA_CATEGORY_ORDER,
  EXPORT_SHEET_ORDER,
  RESET_CONFIRM_PHRASE,
  RESET_SELECTABLE_CATEGORIES,
  dataRangeLabel,
  type DataCategoryKey,
  type DataDateRange,
} from "@/lib/data-catalog"
import { isDayKey } from "@/lib/analytics-core"
import {
  executeDataResetAction,
  previewDataResetAction,
  type DataPreviewActionResult,
  type DataResetExecuteActionResult,
} from "@/lib/actions/data-reset"
import type { ResetPreviewCategory } from "@/lib/services/data-reset"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type DataSettingsProps = {
  gymName: string
}

/**
 * Settings → Data tab. Two cards:
 *  1. Data Export — pick categories + date range and download an .xlsx file.
 *  2. Danger Zone — a guarded, dependency-aware reset wizard.
 * Both are tenant-scoped; the server re-checks auth/permission on every call.
 */
export function DataSettings({ gymName }: DataSettingsProps) {
  return (
    <div className="grid gap-6">
      <DataExportCard />
      <DangerZoneCard gymName={gymName} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

type RangeState = { mode: "all" | "custom"; draftFrom: string; draftTo: string }

function useRangeState(): [RangeState, (next: "all" | "custom") => void, (key: string, value: string) => void] {
  const [range, setRange] = useState<RangeState>({ mode: "all", draftFrom: "", draftTo: "" })
  const setMode = (mode: "all" | "custom") => setRange((r) => ({ ...r, mode }))
  const setDraft = (key: string, value: string) =>
    setRange((r) => (key === "from" ? { ...r, draftFrom: value } : { ...r, draftTo: value }))
  return [range, setMode, setDraft]
}

function usableRange(range: RangeState): DataDateRange | null {
  if (range.mode === "all") return { mode: "all" }
  if (!range.draftFrom || !range.draftTo) return null
  if (!isDayKey(range.draftFrom) || !isDayKey(range.draftTo)) return null
  if (range.draftFrom > range.draftTo) return null
  return { mode: "custom", fromKey: range.draftFrom, toKey: range.draftTo }
}

function RangePicker({
  range,
  onModeChange,
  onDraftChange,
}: {
  range: RangeState
  onModeChange: (mode: "all" | "custom") => void
  onDraftChange: (key: string, value: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant={range.mode === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => onModeChange("all")}
        >
          All time
        </Button>
        <Button
          type="button"
          variant={range.mode === "custom" ? "default" : "outline"}
          size="sm"
          onClick={() => onModeChange("custom")}
        >
          Custom range
        </Button>
      </div>
      {range.mode === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="From date"
            value={range.draftFrom}
            onChange={(e) => onDraftChange("from", e.target.value)}
            className="h-7 w-36"
          />
          <Input
            type="date"
            aria-label="To date"
            value={range.draftTo}
            onChange={(e) => onDraftChange("to", e.target.value)}
            className="h-7 w-36"
          />
        </div>
      )}
    </div>
  )
}

function CategoryChecklist({
  keys,
  selected,
  onToggle,
  showSelectAll = false,
}: {
  keys: readonly DataCategoryKey[]
  selected: ReadonlySet<DataCategoryKey>
  onToggle: (key: DataCategoryKey) => void
  showSelectAll?: boolean
}) {
  const allSelected = keys.every((key) => selected.has(key))

  return (
    <div className="space-y-1.5">
      {showSelectAll && (
        <Label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={allSelected}
            onCheckedChange={() => {
              if (allSelected) {
                keys.forEach((key) => selected.has(key) && onToggle(key))
              } else {
                keys.forEach((key) => onToggle(key))
              }
            }}
          />
          {allSelected ? "Deselect all" : "Select all"}
        </Label>
      )}
      <div className="grid gap-1.5 sm:grid-cols-2">
        {keys.map((key) => {
          const meta = CATEGORY_META[key]
          return (
            <Label key={key} className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
              <Checkbox
                checked={selected.has(key)}
                onCheckedChange={() => onToggle(key)}
              />
              <span className="text-sm">{meta.label}</span>
            </Label>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export card
// ---------------------------------------------------------------------------

function DataExportCard() {
  const [selected, setSelected] = useState<Set<DataCategoryKey>>(
    () => new Set(DATA_CATEGORY_ORDER)
  )
  const [range, setMode, setDraft] = useRangeState()
  const [pending, startTransition] = useTransition()
  const [rangeError, setRangeError] = useState<string | null>(null)

  function toggle(key: DataCategoryKey) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function download() {
    setRangeError(null)
    const dateRange = usableRange(range)
    if (selected.size === 0) {
      toast.error("Select at least one data category to export")
      return
    }
    if (!dateRange) {
      setRangeError("Enter a valid From and To date (from ≤ to)")
      return
    }

    const categories = DATA_CATEGORY_ORDER.filter((key) => selected.has(key))
    startTransition(async () => {
      try {
        const res = await fetch("/api/data/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categories, dateRange }),
        })
        if (!res.ok) {
          let message = "Export failed"
          try {
            const data = (await res.json()) as { error?: string }
            message = data.error ?? message
          } catch {
            /* keep default */
          }
          toast.error(message)
          return
        }
        const blob = await res.blob()
        const filename =
          res.headers.get("X-Export-Filename") ??
          `GymCRM-Export-${new Date().toISOString().slice(0, 10)}.xlsx`
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = filename
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
        toast.success("Export downloaded")
      } catch {
        toast.error("Export failed. Please try again.")
      }
    })
  }

  const dateRange = usableRange(range)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="size-4 text-primary" />
          Data Export
        </CardTitle>
        <CardDescription>
          Download your business data as one professional Excel workbook. The workbook always opens with a
          Summary sheet (members, memberships, payments and revenue for the selected range) and includes a
          Member Financial Summary when members/memberships/payments are exported. Choose the data sheets and
          date range, then save the file.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <CategoryChecklist
          keys={EXPORT_SHEET_ORDER}
          selected={selected}
          onToggle={toggle}
          showSelectAll
        />
        <RangePicker range={range} onModeChange={setMode} onDraftChange={setDraft} />
        {rangeError && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {rangeError}
          </p>
        )}
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {selected.size} of {DATA_CATEGORY_ORDER.length} categories ·{" "}
            {dateRange ? dataRangeLabel(dateRange) : "Range not set"}
          </p>
          <Button onClick={download} disabled={pending || selected.size === 0}>
            {pending ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="size-4" /> Export
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Danger zone (reset wizard)
// ---------------------------------------------------------------------------

type ResetStep = 1 | 2 | 3

function DangerZoneCard({ gymName }: { gymName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<ResetStep>(1)
  const [selected, setSelected] = useState<Set<DataCategoryKey>>(() => new Set())
  const [range, setMode, setDraft] = useRangeState()
  const [preview, setPreview] = useState<{ total: number; categories: ResetPreviewCategory[] } | null>(null)
  const [confirmPhrase, setConfirmPhrase] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<"idle" | "loading" | "executing" | "done">("idle")
  const [, startTransition] = useTransition()

  function toggle(key: DataCategoryKey) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const resetAll = () => {
    setStep(1)
    setSelected(new Set())
    setPreview(null)
    setConfirmPhrase("")
    setPassword("")
    setError(null)
    setPhase("idle")
    setMode("all")
  }

  function openDialog() {
    resetAll()
    setOpen(true)
  }

  function closeDialog() {
    if (phase === "executing") return
    setOpen(false)
    resetAll()
  }

  const dateRange = usableRange(range)

  function continueToConfirm() {
    setError(null)
    if (selected.size === 0) {
      setError("Select at least one category to reset")
      return
    }
    if (!dateRange) {
      setError("Enter a valid From and To date (from ≤ to)")
      return
    }
    setPhase("loading")
    const categories = RESET_SELECTABLE_CATEGORIES.filter((key) => selected.has(key))
    startTransition(async () => {
      const res: DataPreviewActionResult = await previewDataResetAction({
        categories,
        dateRange,
      })
      if (res.success) {
        setPreview({ total: res.data.total, categories: res.data.categories })
        setStep(2)
        setPhase("idle")
      } else {
        setError(res.error ?? "Could not preview the reset")
        setPhase("idle")
      }
    })
  }

  function execute() {
    setError(null)
    if (!preview) return
    setPhase("executing")
    const categories = RESET_SELECTABLE_CATEGORIES.filter((key) => selected.has(key))
    startTransition(async () => {
      const res: DataResetExecuteActionResult = await executeDataResetAction({
        categories,
        dateRange: dateRange ?? { mode: "all" },
        confirmPhrase,
        password,
      })
      if (res.success) {
        setPreview({ total: res.data.deleted, categories: res.data.categories })
        setStep(3)
        setPhase("done")
        toast.success(`Data reset complete — ${res.data.deleted} records removed`)
        router.refresh()
      } else {
        setError(res.error ?? "Reset failed")
        setPhase("idle")
      }
    })
  }

  const phraseMatches = confirmPhrase.trim().toUpperCase() === RESET_CONFIRM_PHRASE
  const canExecute = step === 2 && dateRange !== null && phraseMatches && password.length > 0

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="size-4" />
          Danger Zone
        </CardTitle>
        <CardDescription>
          Permanently delete business data for {gymName}. This cannot be undone — the affected rows are removed
          immediately and are not recoverable.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" size="sm" onClick={openDialog}>
          <Trash2 className="size-4" /> Reset Data…
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => (next ? openDialog() : closeDialog())}>
        <DialogContent className="sm:max-w-lg">
          {step === 1 && (
            <>
              <DialogHeader>
                <DialogTitle>What do you want to delete?</DialogTitle>
                <DialogDescription>
                  Pick the categories to reset. Related records (payments, attendance, follow-ups, …) are always
                  removed along with their parent — for example, deleting <strong>Members</strong> also deletes their
                  memberships, payments, check-ins, appointments and tasks.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <CategoryChecklist
                  keys={RESET_SELECTABLE_CATEGORIES}
                  selected={selected}
                  onToggle={toggle}
                />
                <div>
                  <Label className="mb-2">Date range</Label>
                  <RangePicker range={range} onModeChange={setMode} onDraftChange={setDraft} />
                </div>
              </div>

              {error && (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {error}
                </p>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button type="button" onClick={continueToConfirm} disabled={phase === "loading"}>
                  {phase === "loading" ? "Checking…" : "Continue"}
                </Button>
              </DialogFooter>
            </>
          )}

          {step === 2 && preview && (
            <>
              <DialogHeader>
                <DialogTitle>Final confirmation</DialogTitle>
                <DialogDescription>
                  Deleting <span className="font-medium text-foreground">{preview.total.toLocaleString()}</span> rows
                  for <span className="font-medium text-foreground">{gymName}</span>
                  {" "}({dateRange ? dataRangeLabel(dateRange) : "range not set"}). This action is permanent.
                </DialogDescription>
              </DialogHeader>

              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertTitle>This cannot be undone</AlertTitle>
                <AlertDescription>
                  Deleted rows are removed immediately. There is no recycle bin.
                </AlertDescription>
              </Alert>

              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Affected data</p>
                <ul className="space-y-1 text-sm">
                  {preview.categories.map((cat) => (
                    <li key={cat.category} className="flex items-center justify-between gap-2">
                      <span>
                        {cat.label}
                        {cat.role === "dependent" && (
                          <span className="ml-1 text-xs text-muted-foreground">(included)</span>
                        )}
                      </span>
                      <span className="tabular-nums">{cat.count.toLocaleString()}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-2 border-t border-border pt-1 font-medium">
                    <span>Total</span>
                    <span className="tabular-nums">{preview.total.toLocaleString()}</span>
                  </li>
                </ul>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reset-phrase">
                    Type <span className="font-mono">{RESET_CONFIRM_PHRASE}</span> to confirm
                  </Label>
                  <Input
                    id="reset-phrase"
                    value={confirmPhrase}
                    onChange={(e) => {
                      setError(null)
                      setConfirmPhrase(e.target.value)
                    }}
                    placeholder={RESET_CONFIRM_PHRASE}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reset-password">Re-enter your password</Label>
                  <Input
                    id="reset-password"
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setError(null)
                      setPassword(e.target.value)
                    }}
                    placeholder="Your account password"
                    autoComplete="current-password"
                  />
                </div>
              </div>

              {error && (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {error}
                </p>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={phase === "executing"}>
                  Back
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={execute}
                  disabled={!canExecute || phase === "executing"}
                >
                  {phase === "executing" ? "Deleting…" : `Delete ${preview.total.toLocaleString()} rows permanently`}
                </Button>
              </DialogFooter>
            </>
          )}

          {step === 3 && preview && (
            <>
              <DialogHeader>
                <DialogTitle>Reset complete</DialogTitle>
                <DialogDescription>
                  {preview.total.toLocaleString()} records were permanently deleted from {gymName}.
                </DialogDescription>
              </DialogHeader>

              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="size-4" />
                The data has been removed and your dashboard is up to date.
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}