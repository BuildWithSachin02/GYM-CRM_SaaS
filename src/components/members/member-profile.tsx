"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  Clock,
  CreditCard,
  Edit,
  FileText,
  Mail,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
  UserCircle,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

import { formatDate, formatDateTime, formatDayKey, formatMoney, formatTimeInZone, fullName, pluralize } from "@/lib/format"
import { MEMBERSHIP_LIFECYCLE_STATUS, MEMBER_STATUS, OUTSTANDING_STATUS, PAYMENT_METHOD, PLAN_INTERVAL } from "@/lib/status"
import { getSafeReturnPath } from "@/lib/navigation"
import type { MemberStatus, PaymentMethod, PaymentStatus } from "@prisma/client"
import type { MembershipLifecycleStatus } from "@/lib/memberships"
import type { OutstandingStatus } from "@/lib/outstanding"

import { archiveMember } from "@/lib/actions/members"
import { revokeMemberDevice } from "@/lib/actions/attendance-requests"
import { PageHeader } from "@/components/common/page-header"
import { StatusBadge } from "@/components/common/status-badge"
import { MemberAttendanceSummary } from "@/components/attendance/member-attendance-summary"
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
import { MembershipForm } from "@/components/memberships/membership-form"
import { RenewalForm } from "@/components/memberships/renewal-form"
import { PaymentForm } from "@/components/payments/payment-form"

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
      status: MembershipLifecycleStatus
      daysLeft: number | null
      daysUntilStart: number | null
      /** Amount actually charged for this membership (minor units). */
      amountMinor: number
      /** Sum of RECORDED payments settled against this membership. */
      paidMinor: number
      /** amountMinor - paidMinor; never negative (overpayment is rejected). */
      outstandingMinor: number
      /** Commitment date (org-local ISO) the balance is due by, or null. */
      expectedPaymentDate: string | null
      /** Derived balance status; null for CANCELLED outcomes. */
      outstandingStatus: OutstandingStatus | null
      /** True when this record is the member's primary/current display row. */
      isPrimary: boolean
      /** True when a later record continues coverage past this one's end. */
      renewedThrough: boolean
      /** Farthest valid coverage end (YYYY-MM-DD) across this member's records. */
      coverageThroughKey: string | null
      /** Member-level lifecycle (union of all records) for the primary row. */
      memberStatus: MembershipLifecycleStatus
      memberDaysLeft: number | null
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
      status: PaymentStatus
      paymentDate: string
      reference: string | null
      notes: string | null
      createdAt: string
      membership: {
        id: string
        startDate: string
        endDate: string
        plan: { name: string }
      } | null
      recordedBy: { name: string }
    }[]
    checkIns: {
      id: string
      /** Attendance calendar day (YYYY-MM-DD) in the org's timezone. */
      dayKey: string
      source: "MANUAL" | "QR_SESSION"
      checkedInAt: string
      locationName: string | null
    }[]
    checkInCount: number
    /** Total of RECORDED payments for this member (not just recent rows). */
    totalPaidMinor: number
  }
  attendance: {
    lifetime: {
      totalVisits: number
      thisMonth: number
      thisYear: number
      avgPerWeek: number
      currentStreak: number
      longestStreak: number
    }
    lastVisit: { dayKey: string; checkedInAt: string } | null
  }
  timeZone?: string
  canViewAttendance: boolean
  canUpdate: boolean
  canArchive: boolean
  canManageMemberships: boolean
  canRecordPayment: boolean
  /** Active plans the owner can sell from this profile. */
  plans: { id: string; name: string; priceMinor: number; durationDays: number }[]
  /** Business date (YYYY-MM-DD) in the org's timezone. */
  todayKey: string
  /** Renewal context when the member genuinely needs a renewal today (server
   * decision — null otherwise) so the profile opens the auto-dated renewal
   * modal instead of the plain "new membership" form. */
  renewal: {
    membershipId: string
    planId: string
    planName: string
    endDate: string
    status: "EXPIRED" | "EXPIRING_SOON"
    suggestedStart: string
    coverageThroughKey: string | null
    renewedThrough: boolean
  } | null
  /** Trusted devices the member can use for QR identification. */
  devices: {
    id: string
    lastUsedAt: string
    createdAt: string
    revokedAt: string | null
  }[]
  canManageDevices: boolean
}

export function MemberProfile({
  member,
  attendance,
  timeZone = "UTC",
  canViewAttendance,
  canUpdate,
  canArchive,
  canManageMemberships,
  canRecordPayment,
  plans,
  todayKey,
  renewal,
  devices,
  canManageDevices,
}: MemberProfileProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)

  const name = fullName(member.firstName, member.lastName)
  const statusEntry = MEMBER_STATUS[member.status]

  // Return to the exact dashboard list the user came from (Memberships list
  // or Plan members), validated so a crafted ?returnTo= can never open-redirect.
  const backHref = useMemo(
    () => getSafeReturnPath(searchParams.get("returnTo"), "/dashboard/members"),
    [searchParams]
  )

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

  function handleRevokeDevice(deviceId: string) {
    startTransition(async () => {
      const result = await revokeMemberDevice(deviceId)
      if (result.success) {
        toast.success("Device revoked — it will no longer auto check in")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={name}
        description={`Member since ${formatDate(member.createdAt)}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" render={<Link href={backHref} />}>
              <ArrowLeft className="size-4" /> Back
            </Button>
            {canManageMemberships && member.status !== "ARCHIVED" && (
              renewal ? (
                <RenewalForm
                  membership={{
                    id: renewal.membershipId,
                    memberId: member.id,
                    memberName: name,
                    planId: renewal.planId,
                    planName: renewal.planName,
                    endDate: renewal.endDate,
                    status: renewal.status,
                  }}
                  suggestedStart={renewal.suggestedStart}
                  coverageThroughKey={renewal.coverageThroughKey}
                  renewedThrough={renewal.renewedThrough}
                  plans={plans}
                  trigger={
                    <Button>
                      <RefreshCw className="size-4" /> Renew Membership
                    </Button>
                  }
                />
              ) : (
                <MembershipForm
                  members={[
                    {
                      id: member.id,
                      firstName: member.firstName,
                      lastName: member.lastName,
                    },
                  ]}
                  plans={plans}
                  todayKey={todayKey}
                  defaultMemberId={member.id}
                  trigger={
                    <Button>
                      <Plus className="size-4" /> Add Membership
                    </Button>
                  }
                />
              )
            )}
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
                      <TableHead className="w-10 text-muted-foreground">#</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>For</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Recorded by</TableHead>
                      <TableHead>Reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {member.payments.map((payment, index) => {
                      const methodEntry = PAYMENT_METHOD[payment.method]
                      return (
                        <TableRow key={payment.id}>
                          <TableCell className="w-10 text-xs tabular-nums text-muted-foreground">
                            {index + 1}
                          </TableCell>
                          <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                          <TableCell className="font-medium">
                            {formatMoney(payment.amountMinor)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {payment.membership ? (
                              <span>
                                {payment.membership.plan.name} Membership
                                <span className="block text-xs">
                                  {formatDate(payment.membership.startDate)} →{" "}
                                  {formatDate(payment.membership.endDate)}
                                </span>
                              </span>
                            ) : (
                              <span className="text-xs italic">Standalone</span>
                            )}
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="size-4" /> Attendance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <MemberAttendanceSummary
                compact
                timeZone={timeZone}
                totalVisits={attendance.lifetime.totalVisits}
                thisMonth={attendance.lifetime.thisMonth}
                thisYear={attendance.lifetime.thisYear}
                avgPerWeek={attendance.lifetime.avgPerWeek}
                lastVisit={attendance.lastVisit}
              />

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Recent Attendance</p>
                  {canViewAttendance && (
                    <Button
                      variant="outline"
                      size="sm"
                      render={
                        <Link href={`/dashboard/members/${member.id}/attendance`} />
                      }
                    >
                      View Full Attendance{" "}
                      <ArrowRight className="size-4" />
                    </Button>
                  )}
                </div>
                {member.checkIns.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No check-ins recorded yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 text-muted-foreground">#</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Location</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {member.checkIns.map((checkIn, index) => (
                        <TableRow key={checkIn.id}>
                          <TableCell className="w-10 text-xs tabular-nums text-muted-foreground">
                            {index + 1}
                          </TableCell>
                          <TableCell>{formatDayKey(checkIn.dayKey)}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatTimeInZone(checkIn.checkedInAt, timeZone)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              tone={checkIn.source === "QR_SESSION" ? "info" : "default"}
                            >
                              {checkIn.source === "QR_SESSION" ? "QR" : "Manual"}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {checkIn.locationName ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
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
                  {formatMoney(member.totalPaidMinor)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Last Updated</span>
                <span className="text-muted-foreground">{formatDateTime(member.updatedAt)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="size-4" /> QR Access
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Devices this member opted to remember for faster QR check-ins.
                Remembering a device is identification only — every scan still
                validates membership server-side.
              </p>
              {devices.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                  No trusted devices yet.
                </p>
              ) : (
                devices.map((device) => {
                  const revoked = device.revokedAt !== null
                  return (
                    <div
                      key={device.id}
                      className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 p-2"
                    >
                      <div className="min-w-0 space-y-0.5 text-xs">
                        <p className="font-medium text-foreground">
                          {revoked ? "Revoked device" : "Trusted device"}
                        </p>
                        <p className="text-muted-foreground">
                          Remembered {formatDate(device.createdAt)} · Last used{" "}
                          {formatDateTime(device.lastUsedAt)}
                        </p>
                      </div>
                      {canManageDevices && !revoked && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleRevokeDevice(device.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          {member.memberships.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="size-4" /> Memberships
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {member.memberships.map((membership) => {
                  const statusKey = membership.isPrimary
                    ? membership.memberStatus
                    : membership.status
                  const daysLeft = membership.isPrimary
                    ? membership.memberDaysLeft
                    : membership.daysLeft
                  const statusEntry = MEMBERSHIP_LIFECYCLE_STATUS[statusKey]
                  const membershipStatus = {
                    tone: statusEntry?.tone ?? "muted",
                    label: statusEntry?.label ?? statusKey,
                  }
                  const lifecycleNote =
                    statusKey === "EXPIRING_SOON" && daysLeft !== null
                      ? ` · ${daysLeft}d left`
                      : statusKey === "UPCOMING" && membership.daysUntilStart !== null
                        ? ` · starts in ${membership.daysUntilStart}d`
                        : ""
                  const outstandingEntry = membership.outstandingStatus
                    ? OUTSTANDING_STATUS[membership.outstandingStatus]
                    : null

                  return (
                    <div key={membership.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{membership.plan.name}</span>
                        <StatusBadge tone={membershipStatus.tone}>
                          {membershipStatus.label}
                          {lifecycleNote}
                        </StatusBadge>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p>Interval: {PLAN_INTERVAL[membership.plan.billingInterval as keyof typeof PLAN_INTERVAL]?.label ?? membership.plan.billingInterval}</p>
                        <p>
                          Price: {formatMoney(membership.amountMinor)}
                          {membership.amountMinor !== membership.plan.priceMinor && (
                            <span className="text-muted-foreground">
                              {" "}
                              (plan {formatMoney(membership.plan.priceMinor)})
                            </span>
                          )}
                        </p>
                        <p>
                          Duration: {membership.plan.durationDays} {pluralize(membership.plan.durationDays, "day")}
                        </p>
                        <p>
                          Period: {formatDate(membership.startDate)} — {formatDate(membership.endDate)}
                        </p>
                        {(statusKey === "ACTIVE" ||
                            statusKey === "EXPIRING_SOON" ||
                            statusKey === "UPCOMING") &&
                            membership.renewedThrough &&
                            membership.coverageThroughKey && (
                              <p>
                                Covered through{" "}
                                {formatDayKey(membership.coverageThroughKey)}
                              </p>
                            )}
                      </div>

                      <div className="space-y-1 rounded-md border bg-muted/40 p-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Amount</span>
                          <span>{formatMoney(membership.amountMinor)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Paid</span>
                          <span>{formatMoney(membership.paidMinor)}</span>
                        </div>
                        {membership.outstandingMinor > 0 ? (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Pending</span>
                              <span className="font-semibold text-red-600 dark:text-red-400">
                                {formatMoney(membership.outstandingMinor)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Expected by</span>
                              <span>
                                {membership.expectedPaymentDate ? (
                                  formatDate(membership.expectedPaymentDate)
                                ) : (
                                  <span className="italic text-muted-foreground">Not set</span>
                                )}
                              </span>
                            </div>
                            {outstandingEntry && membership.outstandingStatus && (
                              <div className="flex items-center justify-between pt-0.5">
                                <span className="text-muted-foreground">Payment status</span>
                                <StatusBadge tone={outstandingEntry.tone}>
                                  {outstandingEntry.label}
                                </StatusBadge>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Pending</span>
                            <span className="text-emerald-600 dark:text-emerald-400">
                              Fully paid
                            </span>
                          </div>
                        )}
                      </div>

                      {canRecordPayment &&
                        member.status !== "ARCHIVED" &&
                        membership.outstandingMinor > 0 && (
                          <PaymentForm
                            members={[
                              {
                                id: member.id,
                                firstName: member.firstName,
                                lastName: member.lastName,
                                phone: member.phone,
                                memberships: member.memberships.map((ms) => ({
                                  id: ms.id,
                                  startDate: ms.startDate,
                                  endDate: ms.endDate,
                                  amountMinor: ms.amountMinor,
                                  status: ms.status,
                                  expectedPaymentDate: ms.expectedPaymentDate,
                                  paidMinor: ms.paidMinor,
                                  outstandingMinor: ms.outstandingMinor,
                                  plan: { name: ms.plan.name, priceMinor: ms.plan.priceMinor },
                                })),
                              },
                            ]}
                            defaultMemberId={member.id}
                            defaultMembershipId={membership.id}
                            trigger={
                              <Button variant="outline" size="sm" className="w-full">
                                Record payment
                              </Button>
                            }
                          />
                        )}
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
