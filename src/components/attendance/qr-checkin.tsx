"use client"

import { useState, useTransition, useMemo } from "react"
import { toast } from "sonner"
import { CheckCircle, XCircle, QrCode } from "lucide-react"

import { qrCheckin } from "@/lib/actions/attendance"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/common/status-badge"

type Member = { id: string; firstName: string; lastName: string }

type QrCheckinProps = {
  token: string
  isValid: boolean
  members: Member[]
  errorMessage?: string
}

export function QrCheckin({
  token,
  isValid,
  members,
  errorMessage,
}: QrCheckinProps) {
  const [isPending, startTransition] = useTransition()
  const [success, setSuccess] = useState(false)
  const [search, setSearch] = useState("")
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return members
    const q = search.toLowerCase()
    return members.filter(
      (m) =>
        m.firstName.toLowerCase().includes(q) ||
        m.lastName.toLowerCase().includes(q) ||
        `${m.firstName} ${m.lastName}`.toLowerCase().includes(q)
    )
  }, [members, search])

  const selectedMember = members.find((m) => m.id === selectedMemberId)

  function handleCheckin() {
    if (!selectedMemberId) return

    startTransition(async () => {
      const result = await qrCheckin(token, selectedMemberId)

      if (result.success) {
        setSuccess(true)
        toast.success("Check-in successful!")
      } else {
        toast.error(result.error ?? "Check-in failed")
      }
    })
  }

  if (!isValid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <XCircle className="size-6 text-destructive" />
            </div>
            <CardTitle className="text-destructive">
              Check-in Unavailable
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground">
              {errorMessage ?? "This QR code is no longer valid."}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle className="size-6 text-emerald-600" />
            </div>
            <CardTitle>Check-in Successful!</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground">
              Your attendance has been recorded. You may close this page.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
            <QrCode className="size-6 text-primary" />
          </div>
          <CardTitle>QR Check-in</CardTitle>
          <p className="text-sm text-muted-foreground">
            Search and select your name to check in.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Search your name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {selectedMember && (
            <StatusBadge tone="success">
              Selected: {selectedMember.firstName} {selectedMember.lastName}
            </StatusBadge>
          )}

          <div className="max-h-60 overflow-y-auto rounded-lg border">
            {filteredMembers.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                No members found.
              </p>
            ) : (
              filteredMembers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelectedMemberId(m.id)
                    setSearch(`${m.firstName} ${m.lastName}`)
                  }}
                  className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                    selectedMemberId === m.id ? "bg-muted font-medium" : ""
                  }`}
                >
                  {m.firstName} {m.lastName}
                </button>
              ))
            )}
          </div>

          <Button
            className="w-full"
            disabled={isPending || !selectedMemberId}
            onClick={handleCheckin}
          >
            {isPending ? "Checking in..." : "Check In"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
