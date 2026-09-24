"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  CheckCircle,
  Clock,
  Info,
  QrCode,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
  XCircle,
} from "lucide-react"

import {
  autoQrCheckin,
  qrCheckin,
  reportWrongIdentity,
  type QrCheckinResult,
} from "@/lib/actions/attendance"
import type { IdentitySummary } from "@/lib/qr-attendance"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export type RememberedMember = { id: string; firstName: string; lastName: string }

export type Member = {
  id: string
  firstName: string
  lastName: string
  /** Server-derived identity summary for the confirmation screen. */
  identity: IdentitySummary
}

type QrCheckinProps = {
  token: string
  isValid: boolean
  members: Member[]
  errorMessage?: string
  /** Server-resolved remembered device member (same gym as the QR). */
  rememberedMember?: RememberedMember | null
}

type View = "checking" | "confirm" | "result" | "search"

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

  // Whether this browser holds a trusted-device association for the member
  // just identified: the "Not you? Report wrong identity" safety action only
  // makes sense when a device exists (or was just created) and auto-check-in
  // would otherwise happen again.
  const deviceInvolved = rememberedMember !== null || rememberDevice

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

  function handleNotYou() {
    startTransition(async () => {
      const res = await reportWrongIdentity()
      if (res.success) {
        toast.success(
          res.revoked
            ? "Your saved device was removed and will no longer auto-check you in."
            : "No saved device was found on this browser."
        )
      } else {
        toast.error(res.error ?? "Could not remove the device")
      }
      setResult(null)
      setSelectedMemberId(null)
      setSearch("")
      setRememberDevice(false)
      setView("search")
    })
  }

  function handleSelectMember(m: Member) {
    setSelectedMemberId(m.id)
    setSearch(`${m.firstName} ${m.lastName}`)
    setRememberDevice(false)
    setView("confirm")
  }

  function handleBackToSearch() {
    setSelectedMemberId(null)
    setSearch("")
    setRememberDevice(false)
    setView("search")
  }

  function handleConfirm() {
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
        deviceInvolved={deviceInvolved}
        onReportWrongIdentity={handleNotYou}
      />
    )
  }

  if (view === "confirm" && selectedMember) {
    const { identity } = selectedMember
    return (
      <Screen
        icon={<ShieldCheck className="size-6 text-primary" />}
        title={<CardTitle>Confirm your identity</CardTitle>}
      >
        <div className="w-full space-y-3 text-left">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="text-muted-foreground">You selected:</p>
            <p className="font-medium text-foreground">{identity.name}</p>
            <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between gap-3">
                <dt>Phone</dt>
                <dd className="tabular-nums">{identity.maskedPhone || "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Membership</dt>
                <dd>{identity.membershipPlanName ?? "No active membership"}</dd>
              </div>
            </dl>
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
                You&apos;ll be checked in automatically next time. Unchecked by
                default.
              </span>
            </span>
          </label>

          <Button
            className="w-full"
            disabled={isPending}
            onClick={handleConfirm}
          >
            {isPending ? "Checking in..." : "Confirm — This is me"}
          </Button>
          <Button variant="outline" className="w-full" onClick={handleBackToSearch}>
            Go back
          </Button>
        </div>
      </Screen>
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
        <Button
          variant="outline"
          className="w-full text-destructive"
          onClick={handleNotYou}
        >
          Not you? Report wrong identity
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
            Search and select your name to begin. You&apos;ll be asked to confirm
            before checking in.
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
                onClick={() => handleSelectMember(m)}
                className="flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <UserCheck className="mr-2 size-4 text-muted-foreground" />
                {m.firstName} {m.lastName}
              </button>
            ))
          )}
        </div>
      </div>
    </Screen>
  )
}

function ResultScreen({
  result,
  deviceInvolved,
  onReportWrongIdentity,
}: {
  result: Extract<QrCheckinResult, { success: true }>
  deviceInvolved: boolean
  onReportWrongIdentity: () => void
}) {
  const { outcome, memberName } = result
  const reportButton = deviceInvolved ? (
    <Button
      variant="outline"
      className="w-full text-destructive"
      onClick={onReportWrongIdentity}
    >
      <TriangleAlert className="size-4" /> Not you? Report wrong identity
    </Button>
  ) : null

  if (outcome === "checked_in") {
    return (
      <Screen
        icon={<CheckCircle className="size-6 text-emerald-600" />}
        title={<CardTitle>Check-in Successful!</CardTitle>}
      >
        <p className="text-sm font-medium text-foreground">Welcome, {memberName}</p>
        <p className="text-sm text-muted-foreground">
          Your attendance has been recorded. You may close this page.
        </p>
        {reportButton}
      </Screen>
    )
  }

  if (outcome === "already_checked_in") {
    return (
      <Screen
        icon={<Clock className="size-6 text-sky-600" />}
        title={<CardTitle>Already Checked In</CardTitle>}
      >
        <p className="text-sm font-medium text-foreground">Welcome, {memberName}</p>
        <p className="text-sm text-muted-foreground">
          Already checked in today. You may close this page.
        </p>
        {reportButton}
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
        {reportButton}
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
      {reportButton}
    </Screen>
  )
}