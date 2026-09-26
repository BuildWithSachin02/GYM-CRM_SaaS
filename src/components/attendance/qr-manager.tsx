"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { z } from "zod"
import { toast } from "sonner"
import { PlusCircle, XCircle } from "lucide-react"

import { createQrSession, deactivateQrSession } from "@/lib/actions/attendance"
import { formatDateTime } from "@/lib/format"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/empty-state"
import { EntityCombobox } from "@/components/ui/entity-combobox"
import { QrDisplay } from "@/components/attendance/qr-display"

type SerializedQrSession = {
  id: string
  label: string | null
  branchName: string
  expiresAt: string
}

type Branch = { id: string; name: string }

type QrManagerProps = {
  activeQrSessions: SerializedQrSession[]
  branches: Branch[]
}

const generateQrSchema = z.object({
  branchId: z.string().uuid("Please select a branch"),
  label: z.string().max(120).optional().nullable(),
  expiresInMinutes: z.number().int().min(1).max(1440).default(60),
})

export function QrManager({ activeQrSessions, branches }: QrManagerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [generatedToken, setGeneratedToken] = useState<string | null>(null)

  const [label, setLabel] = useState("")
  const [branchId, setBranchId] = useState("")
  const [expiresInMinutes, setExpiresInMinutes] = useState("60")

  function handleGenerate() {
    const parsed = generateQrSchema.safeParse({
      branchId,
      label: label || null,
      expiresInMinutes: parseInt(expiresInMinutes, 10) || 60,
    })

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      toast.error(firstIssue?.message ?? "Invalid input")
      return
    }

    startTransition(async () => {
      const result = await createQrSession({
        branchId: parsed.data.branchId,
        label: parsed.data.label ?? null,
        expiresInMinutes: parsed.data.expiresInMinutes,
      })

      if (result.success && result.token) {
        toast.success("QR session created")
        setGeneratedToken(result.token)
        setLabel("")
        setBranchId("")
        setExpiresInMinutes("60")
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed to create QR session")
      }
    })
  }

  function handleDeactivate(sessionId: string) {
    startTransition(async () => {
      const result = await deactivateQrSession(sessionId)

      if (result.success) {
        toast.success("QR session deactivated")
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed to deactivate session")
      }
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Active QR Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {activeQrSessions.length === 0 ? (
            <EmptyState
              icon={PlusCircle}
              title="No active QR sessions"
              description="Generate a QR code for members to scan and check in."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-muted-foreground">#</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeQrSessions.map((s, index) => (
                  <TableRow key={s.id}>
                    <TableCell className="w-10 text-xs tabular-nums text-muted-foreground">
                      {index + 1}
                    </TableCell>
                    <TableCell className="font-medium">
                      {s.label ?? "—"}
                    </TableCell>
                    <TableCell>{s.branchName}</TableCell>
                    <TableCell>
                      <StatusBadge tone="warning">
                        {formatDateTime(s.expiresAt)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={isPending}
                        onClick={() => handleDeactivate(s.id)}
                      >
                        <XCircle className="size-3.5" /> Deactivate
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Generate QR Code</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="qr-location">Branch</Label>
              <EntityCombobox
                value={branchId}
                onValueChange={setBranchId}
                options={branches.map((b) => ({ id: b.id, label: b.name }))}
                placeholder="Search or select branch"
                emptyText="No branches found."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qr-label">Label (optional)</Label>
              <Input
                id="qr-label"
                placeholder="e.g. Front Desk"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qr-expiry">Expiry (minutes)</Label>
              <Input
                id="qr-expiry"
                type="number"
                min={1}
                max={1440}
                value={expiresInMinutes}
                onChange={(e) => setExpiresInMinutes(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-4">
            <Button
              onClick={handleGenerate}
              disabled={isPending || !branchId}
            >
              <PlusCircle className="size-4" />{" "}
              {isPending ? "Generating..." : "Generate QR"}
            </Button>
          </div>

          {generatedToken && (
            <div className="mt-6">
              <QrDisplay
                token={generatedToken}
                origin={typeof window !== "undefined" ? window.location.origin : ""}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
