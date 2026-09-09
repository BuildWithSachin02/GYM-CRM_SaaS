"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  CalendarCheck,
  CreditCard,
  Edit,
  FileText,
  Mail,
  MapPin,
  Phone,
  Trash2,
  UserCircle,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

import { formatDate, formatDateTime, formatMoney, fullName, pluralize } from "@/lib/format"
import { MEMBER_STATUS, PAYMENT_METHOD } from "@/lib/status"
import type { MemberStatus, MembershipStatus, PaymentMethod } from "@prisma/client"

import { archiveMember } from "@/lib/actions/members"
import { PageHeader } from "@/components/common/page-header"
import { StatusBadge } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { MemberForm } from "@/components/members/member-form"

type MemberProfileProps = {
  member: {
    id: string
    firstName: string
    lastName: string
    phone: string
    email: string | null
    gender: "MALE" | "FEMALE" | "OTHER" | null
    dateOfBirth: string | null
    address: string | null
    emergencyContactName: string | null
    emergencyContactPhone: string | null
    signupSource: string | null
    notes: string | null
    status: MemberStatus
    createdAt: string
    updatedAt: string
    memberships: {
      id: string
      startDate: string
      endDate: string
      status: MembershipStatus
      plan: {
        name: string
        billingInterval: string
        priceMinor: number
        durationDays: number
      }
    }[]
    payments: {
      id: string
      amountMinor: number
      method: PaymentMethod
      paymentDate: string
      reference: string | null
      notes: string | null
      createdAt: string
      recordedBy: { name: string }
    }[]
    checkInCount: number
  }
  canUpdate: boolean
  canArchive: boolean
}

export function MemberProfile({ member, canUpdate, canArchive }: MemberProfileProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)

  const name = fullName(member.firstName, member.lastName)
  const statusEntry = MEMBER_STATUS[member.status]

  function handleArchive() {
    startTransition(async () => {
      const result = await archiveMember(member.id)
      if (result.success) {
        toast.success("Member archived")
        router.push("/dashboard/members")
      } else {
        toast.error(result.error)
      }
      setShowArchiveConfirm(false)
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={name}
        description={`Member since ${formatDate(member.createdAt)}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" render={<Link href="/dashboard/members" />}>
              <ArrowLeft className="size-4" /> Back
            </Button>
            {canUpdate && (
              <MemberForm
                member={member}
                trigger={
                  <Button variant="outline">
                    <Edit className="size-4" /> Edit
                  </Button>
                }
              />
            )}
            {canArchive && member.status !== "ARCHIVED" && (
              <Button
                variant="destructive"
                onClick={() => setShowArchiveConfirm(true)}
                disabled={isPending}
              >
                <Trash2 className="size-4" /> Archive
              </Button>
            )}
          </div>
        }
      />

      {showArchiveConfirm && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <p className="text-sm">
              Are you sure you want to archive <strong>{name}</strong>? This action can be undone later.
            </p>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowArchiveConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleArchive}
                disabled={isPending}
              >
                {isPending ? "Archiving..." : "Yes, archive"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCircle className="size-4" /> Member Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-4">
                <Avatar size="lg">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {name
                      .split(" ")
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((n) => n[0]?.toUpperCase())
                      .join("")}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">{name}</h2>
                    <StatusBadge tone={statusEntry?.tone ?? "muted"}>
                      {statusEntry?.label ?? member.status}
                    </StatusBadge>
                  </div>

                  <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <InfoRow icon={Phone} label="Phone" value={member.phone} />
                    <InfoRow icon={Mail} label="Email" value={member.email ?? "—"} />
                    <InfoRow
                      icon={UserCircle}
                      label="Gender"
                      value={member.gender?.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) ?? "—"}
                    />
                    <InfoRow icon={CalendarCheck} label="Date of Birth" value={formatDate(member.dateOfBirth)} />
                    <InfoRow icon={MapPin} label="Address" value={member.address ?? "—"} className="sm:col-span-2" />
                    <InfoRow icon={Zap} label="Signup Source" value={member.signupSource ?? "—"} />
                  </div>

                  {(member.emergencyContactName || member.emergencyContactPhone) && (
                    <>
                      <Separator />
                      <div>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">Emergency Contact</p>
                        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                          <InfoRow icon={UserCircle} label="Name" value={member.emergencyContactName ?? "—"} />
                          <InfoRow icon={Phone} label="Phone" value={member.emergencyContactPhone ?? "—"} />
                        </div>
                      </div>
                    </>
                  )}

                  {member.notes && (
                    <>
                      <Separator />
                      <div>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">Notes</p>
                        <p className="whitespace-pre-wrap text-sm">{member.notes}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="size-4" /> Recent Payments
              </CardTitle>
            </CardHeader>
            <CardContent>
              {member.payments.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No payments recorded yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Recorded by</TableHead>
                      <TableHead>Reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {member.payments.map((payment) => {
                      const methodEntry = PAYMENT_METHOD[payment.method]
                      return (
                        <TableRow key={payment.id}>
                          <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                          <TableCell className="font-medium">
                            {formatMoney(payment.amountMinor)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge tone={methodEntry?.tone ?? "muted"}>
                              {methodEntry?.label ?? payment.method}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {payment.recordedBy.name}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {payment.reference ?? "—"}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="size-4" /> Quick Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total Check-ins</span>
                <span className="font-semibold">{member.checkInCount}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total Payments</span>
                <span className="font-semibold">
                  {formatMoney(member.payments.reduce((sum, p) => sum + p.amountMinor, 0))}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Last Updated</span>
                <span className="text-muted-foreground">{formatDateTime(member.updatedAt)}</span>
              </div>
            </CardContent>
          </Card>

          {member.memberships.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="size-4" /> Active Membership
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {member.memberships.map((membership) => {
                  const membershipStatus =
                    membership.status === "ACTIVE"
                      ? { tone: "success" as const, label: "Active" }
                      : membership.status === "EXPIRED"
                        ? { tone: "destructive" as const, label: "Expired" }
                        : membership.status === "PAUSED"
                          ? { tone: "warning" as const, label: "Paused" }
                          : { tone: "muted" as const, label: membership.status }

                  return (
                    <div key={membership.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{membership.plan.name}</span>
                        <StatusBadge tone={membershipStatus.tone}>
                          {membershipStatus.label}
                        </StatusBadge>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p>Interval: {membership.plan.billingInterval.toLowerCase().replace("_", " ")}</p>
                        <p>Price: {formatMoney(membership.plan.priceMinor)}</p>
                        <p>
                          Duration: {membership.plan.durationDays} {pluralize(membership.plan.durationDays, "day")}
                        </p>
                        <p>
                          Period: {formatDate(membership.startDate)} — {formatDate(membership.endDate)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <p className="mt-0.5 text-sm">{value}</p>
    </div>
  )
}
