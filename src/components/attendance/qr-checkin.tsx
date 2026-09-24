"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { CheckCircle, Clock, Info, QrCode, TriangleAlert, XCircle } from "lucide-react"

import { autoQrCheckin, qrCheckin, type QrCheckinResult } from "@/lib/actions/attendance"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/common/status-badge"

type Member = { id: string; firstName: string; lastName: string }

type QrCheckinProps = {
  token: string
  isValid: boolean
  members: Member[]
  errorMessage?: string
  /** Server-resolved remembered device member (same gym as the QR). */
  rememberedMember?: Member | null
}

type View = "checking" | "result" | "search"

type ScreenTone = "default" | "destructive"

function Screen({
  tone = "default",
  icon,
  title,
  children,
}: {
  tone?: ScreenTone
  icon: React.ReactNode
  title: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div
            className={
              tone === "destructive"
                ? "mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10"
                : "mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10"
            }
          >
            {icon}
          </div>
          {title}
        </CardHeader>
        <CardContent className="space-y-3 text-center">{children}</CardContent>
      </Card>
    </div>
  )
}

export function QrCheckin({
  token,
  isValid,
  members,
  errorMessage,
  rememberedMember,
}: QrCheckinProps) {
  const [isPending, startTransition] = useTransition()
  const [view, setView] = useState<View>(rememberedMember ? "checking" : "search")
  const [result, setResult] = useState<QrCheckinResult | null>(null)
  const [search, setSearch] = useState("")
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [rememberDevice, setRememberDevice] = useState(false)

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

  // Repeat scan: the server already resolved a trusted device for this gym, so
  // try the automatic check-in once. A revoked/wrong-gym device falls back to
  // the search flow silently.
  useEffect(() => {
    if (!isValid || !rememberedMember || view !== "checking") return

    startTransition(async () => {
      const res = await autoQrCheckin(token)
      if (res.success) {
        setResult(res)
        setView("result")
      } else if (res.code === "device_not_found") {
        setView("search")
      } else {
        toast.error(res.error)
        setView("search")
      }
    })
  }, [isValid, rememberedMember, token, view])

  function useDifferentAccount() {
    setResult(null)
    setSelectedMemberId(null)
    setSearch("")
    setView("search")
  }

  function handleCheckin() {
    if (!selectedMemberId) return

    startTransition(async () => {
      const res = await qrCheckin(token, selectedMemberId, rememberDevice)
      if (res.success) {
        setResult(res)
        setView("result")
      } else {
        toast.error(res.error ?? "Check-in failed")
      }
    })
  }

  if (!isValid) {
    return (
      <Screen
        tone="destructive"
        icon={<XCircle className="size-6 text-destructive" />}
        title={<CardTitle className="text-destructive">Check-in Unavailable</CardTitle>}
      >
        <p className="text-sm text-muted-foreground">
          {errorMessage ?? "This QR code is no longer valid."}
        </p>
      </Screen>
    )
  }

  if (view === "result" && result?.success) {
    return (
      <ResultScreen
        result={result}
        onDifferentAccount={useDifferentAccount}
      />
    )
  }

  if (view === "checking") {
    return (
      <Screen
        icon={
          <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        }
        title={<CardTitle>Checking in…</CardTitle>}
      >
        <p className="text-sm text-muted-foreground">
          Scanning your saved device for {rememberedMember?.firstName}{" "}
          {rememberedMember?.lastName ?? ""}.
        </p>
        <Button variant="outline" onClick={useDifferentAccount}>
          Not you? Use a different account
        </Button>
      </Screen>
    )
  }

  return (
    <Screen
      icon={<QrCode className="size-6 text-primary" />}
      title={
        <>
          <CardTitle>QR Check-in</CardTitle>
          <p className="text-sm text-muted-foreground">
            Search and select your name to check in.
          </p>
        </>
      }
    >
      <div className="w-full space-y-4">
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

        <label className="flex items-start gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={rememberDevice}
            onCheckedChange={(checked) => setRememberDevice(Boolean(checked))}
            className="mt-0.5"
          />
          <span>
            Remember this device for faster QR check-ins.
            <span className="block text-xs text-muted-foreground/70">
              You&apos;ll be checked in automatically next time.
            </span>
          </span>
        </label>

        <Button
          className="w-full"
          disabled={isPending || !selectedMemberId}
          onClick={handleCheckin}
        >
          {isPending ? "Checking in..." : "Check In"}
        </Button>
      </div>
    </Screen>
  )
}

function ResultScreen({
  result,
  onDifferentAccount,
}: {
  result: Extract<QrCheckinResult, { success: true }>
  onDifferentAccount: () => void
}) {
  const { outcome, memberName } = result
  const differentAccountButton = (
    <Button variant="outline" className="w-full" onClick={onDifferentAccount}>
      Use a different member
    </Button>
  )

  if (outcome === "checked_in") {
    return (
      <Screen
        icon={<CheckCircle className="size-6 text-emerald-600" />}
        title={<CardTitle>Check-in Successful!</CardTitle>}
      >
        <p className="text-sm font-medium text-foreground">{memberName}</p>
        <p className="text-sm text-muted-foreground">
          Your attendance has been recorded. You may close this page.
        </p>
        {differentAccountButton}
      </Screen>
    )
  }

  if (outcome === "already_checked_in") {
    return (
      <Screen
        icon={<Clock className="size-6 text-sky-600" />}
        title={<CardTitle>Already Checked In</CardTitle>}
      >
        <p className="text-sm font-medium text-foreground">{memberName}</p>
        <p className="text-sm text-muted-foreground">
          Already checked in today. You may close this page.
        </p>
        {differentAccountButton}
      </Screen>
    )
  }

  if (outcome === "request_rejected") {
    return (
      <Screen
        tone="destructive"
        icon={<Info className="size-6 text-destructive" />}
        title={<CardTitle>Check-in Not Approved</CardTitle>}
      >
        <p className="text-sm font-medium text-foreground">{memberName}</p>
        <p className="text-sm text-muted-foreground">
          Your membership could not be confirmed for today. Please contact the
          gym reception.
        </p>
        {differentAccountButton}
      </Screen>
    )
  }

  return (
    <Screen
      icon={<TriangleAlert className="size-6 text-amber-600" />}
      title={<CardTitle>Attendance Request Pending</CardTitle>}
    >
      <p className="text-sm font-medium text-foreground">{memberName}</p>
      <p className="text-sm text-muted-foreground">
        Your membership has expired. Please contact the gym reception.
      </p>
      <p className="text-sm text-muted-foreground">
        Your attendance request is pending gym approval.
      </p>
      {differentAccountButton}
    </Screen>
  )
}