"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowRight,
  Calendar,
  Edit,
  Mail,
  Phone,
  StickyNote,
  Trash2,
  UserCheck,
  MessageSquare,
  PhoneCall,
  MapPin,
  Clock,
} from "lucide-react"

import { formatDate, formatDateTime, formatMoney } from "@/lib/format"
import { LEAD_STAGE, LEAD_SOURCE } from "@/lib/status"
import type { LeadStage, LeadSource, LeadActivityType } from "@prisma/client"

import { StatusBadge } from "@/components/common/status-badge"
import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EntityCombobox } from "@/components/ui/entity-combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  updateLeadStage,
  deleteLead,
  convertLeadToMember,
} from "@/lib/actions/leads"
import { LeadForm } from "@/components/leads/lead-form"
import { LeadActivityForm } from "@/components/leads/lead-activity-form"

type Activity = {
  id: string
  type: LeadActivityType
  body: string
  activityDate: string
  actorName: string
}

type Plan = {
  id: string
  name: string
  priceMinor: number
  durationDays: number
  billingInterval: string
}

type LeadProfileProps = {
  lead: {
    id: string
    name: string
    phone: string
    email: string | null
    source: LeadSource
    sourceDetail: string | null
    stage: LeadStage
    followUpDate: string | null
    notes: string | null
    createdAt: string
    updatedAt: string
    owner: { id: string; name: string } | null
    interestedPlan: {
      id: string
      name: string
      priceMinor: number
      durationDays: number
      billingInterval: string
    } | null
    activities: Activity[]
    activityCount: number
    appointmentCount: number
  }
  plans: Plan[]
  canUpdate: boolean
  canManage: boolean
  canConvert: boolean
}

const STAGE_FLOW: Record<LeadStage, LeadStage | null> = {
  NEW: "CONTACTED",
  CONTACTED: "VISIT_SCHEDULED",
  VISIT_SCHEDULED: "VISIT_DONE",
  VISIT_DONE: "CONVERTED",
  CONVERTED: null,
  LOST: null,
}

const ACTIVITY_ICONS: Record<LeadActivityType, typeof PhoneCall> = {
  CALL: PhoneCall,
  WHATSAPP: MessageSquare,
  MESSAGE: MessageSquare,
  VISIT: MapPin,
  NOTE: StickyNote,
  FOLLOW_UP: Clock,
}

const ACTIVITY_TYPE_LABELS: Record<LeadActivityType, string> = {
  CALL: "Call",
  WHATSAPP: "WhatsApp",
  MESSAGE: "Message",
  VISIT: "Visit",
  NOTE: "Note",
  FOLLOW_UP: "Follow-up",
}

export function LeadProfile({
  lead,
  plans,
  canUpdate,
  canManage,
  canConvert,
}: LeadProfileProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)

  // Convert form state
  const [convertPlanId, setConvertPlanId] = useState(lead.interestedPlan?.id ?? "")
  const [convertStartDate, setConvertStartDate] = useState(
    new Date().toISOString().slice(0, 10)
  )
  const [convertAmount, setConvertAmount] = useState(
    lead.interestedPlan ? String((lead.interestedPlan.priceMinor ?? 0) / 100) : ""
  )
  const [convertError, setConvertError] = useState<string | null>(null)

  const selectedPlan = plans.find((p) => p.id === convertPlanId)

  function handleStageUpdate(stage: LeadStage) {
    startTransition(async () => {
      const result = await updateLeadStage(lead.id, stage)
      if (result.success) {
        toast.success(`Stage updated to ${LEAD_STAGE[stage]?.label ?? stage}`)
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteLead(lead.id)
      if (result.success) {
        toast.success("Lead deleted")
        router.push("/dashboard/leads")
      } else {
        toast.error(result.error)
      }
    })
  }

  function handleConvert() {
    setConvertError(null)

    if (!convertPlanId) {
      setConvertError("Please select a plan")
      return
    }

    const amountNum = parseFloat(convertAmount)
    const amountMinor = Number.isFinite(amountNum)
      ? Math.round(amountNum * 100)
      : 0
    if (!amountMinor || amountMinor <= 0) {
      setConvertError("Please enter a valid amount")
      return
    }

    startTransition(async () => {
      const result = await convertLeadToMember({
        leadId: lead.id,
        planId: convertPlanId,
        startDate: convertStartDate,
        durationDays: selectedPlan?.durationDays ?? 30,
        amountMinor,
      })

      if (result.success) {
        toast.success("Lead converted to member!")
        setConvertOpen(false)
        router.refresh()
      } else {
        setConvertError(result.error)
      }
    })
  }

  const nextStage = STAGE_FLOW[lead.stage]
  const stageEntry = LEAD_STAGE[lead.stage]
  const sourceEntry = LEAD_SOURCE[lead.source]
  const canConvertStage =
    lead.stage === "VISIT_DONE" || lead.stage === "CONVERTED"

  return (
    <div className="space-y-6">
      <PageHeader
        title={lead.name}
        description={`Lead since ${formatDate(lead.createdAt)}`}
        actions={
          <div className="flex gap-2">
            {canUpdate && (
              <LeadForm
                lead={lead}
                trigger={
                  <Button variant="outline">
                    <Edit className="size-4" /> Edit
                  </Button>
                }
              />
            )}
            {canManage && (
              <Button
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-4" /> Delete
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Lead Info */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Lead Information</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="font-medium">{lead.name}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd className="flex items-center gap-1.5 font-medium">
                    <Phone className="size-3.5 text-muted-foreground" />
                    {lead.phone}
                  </dd>
                </div>
                {lead.email && (
                  <div>
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="flex items-center gap-1.5 font-medium">
                      <Mail className="size-3.5 text-muted-foreground" />
                      {lead.email}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">Source</dt>
                  <dd>
                    <StatusBadge tone={sourceEntry?.tone ?? "muted"}>
                      {sourceEntry?.label ?? lead.source}
                    </StatusBadge>
                  </dd>
                </div>
                {lead.sourceDetail && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Source Detail</dt>
                    <dd>{lead.sourceDetail}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">Stage</dt>
                  <dd>
                    <StatusBadge tone={stageEntry?.tone ?? "muted"}>
                      {stageEntry?.label ?? lead.stage}
                    </StatusBadge>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Follow-up Date</dt>
                  <dd className="flex items-center gap-1.5">
                    <Calendar className="size-3.5 text-muted-foreground" />
                    {formatDate(lead.followUpDate)}
                  </dd>
                </div>
                {lead.owner && (
                  <div>
                    <dt className="text-muted-foreground">Owner</dt>
                    <dd>{lead.owner.name}</dd>
                  </div>
                )}
                {lead.interestedPlan && (
                  <div>
                    <dt className="text-muted-foreground">Interested Plan</dt>
                    <dd>
                      {lead.interestedPlan.name} -{" "}
                      {formatMoney(lead.interestedPlan.priceMinor)}
                    </dd>
                  </div>
                )}
                {lead.notes && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Notes</dt>
                    <dd className="whitespace-pre-wrap">{lead.notes}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Stage Actions */}
          {canUpdate && (
            <Card>
              <CardHeader>
                <CardTitle>Update Stage</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {nextStage && (
                    <Button
                      onClick={() => handleStageUpdate(nextStage)}
                      disabled={isPending}
                    >
                      <ArrowRight className="size-4" /> Move to{" "}
                      {LEAD_STAGE[nextStage]?.label ?? nextStage}
                    </Button>
                  )}
                  {(Object.keys(LEAD_STAGE) as LeadStage[]).map((s) => (
                    <Button
                      key={s}
                      variant={s === lead.stage ? "outline" : "ghost"}
                      size="sm"
                      disabled={s === lead.stage || isPending}
                      onClick={() => handleStageUpdate(s)}
                    >
                      {LEAD_STAGE[s]?.label ?? s}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Convert to Member */}
          {canConvert && canConvertStage && lead.stage !== "CONVERTED" && (
            <Card>
              <CardHeader>
                <CardTitle>Convert to Member</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-muted-foreground">
                  Convert this lead into a gym member with an active membership.
                </p>
                <Button onClick={() => setConvertOpen(true)}>
                  <UserCheck className="size-4" /> Convert to Member
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Activity Timeline */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Activities</h2>
            {canUpdate && (
              <LeadActivityForm
                leadId={lead.id}
                trigger={
                  <Button size="sm">
                    <StickyNote className="size-3.5" /> Add Activity
                  </Button>
                }
              />
            )}
          </div>

          {lead.activityCount > lead.activities.length && (
            <p className="text-xs text-muted-foreground">
              Showing recent {lead.activities.length} of {lead.activityCount} activities
            </p>
          )}

          {lead.activities.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No activities yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {lead.activities.map((activity) => {
                const Icon = ACTIVITY_ICONS[activity.type] ?? StickyNote
                return (
                  <Card key={activity.id} size="sm">
                    <CardContent className="pt-0">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                          <Icon className="size-3.5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <StatusBadge tone="muted" className="text-xs">
                              {ACTIVITY_TYPE_LABELS[activity.type]}
                            </StatusBadge>
                            <span className="text-xs text-muted-foreground">
                              {formatDateTime(activity.activityDate)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm whitespace-pre-wrap">
                            {activity.body}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            by {activity.actorName}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Lead</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this lead? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending ? "Deleting..." : "Delete Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert to Member Dialog */}
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Convert Lead to Member</DialogTitle>
            <DialogDescription>
              Create a member account and active membership for {lead.name}.
              Payment is recorded separately when you receive it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {convertError && (
              <p className="text-sm text-destructive">{convertError}</p>
            )}

            <div className="grid gap-2">
              <Label htmlFor="convert-plan">Plan *</Label>
              <EntityCombobox
                value={convertPlanId}
                onValueChange={setConvertPlanId}
                options={plans.map((plan) => ({
                  id: plan.id,
                  label: plan.name,
                  sublabel: `${formatMoney(plan.priceMinor)} · ${plan.durationDays} days`,
                }))}
                placeholder="Search or select a plan"
                emptyText="No plans found."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="convert-start">Start Date *</Label>
                <Input
                  id="convert-start"
                  type="date"
                  value={convertStartDate}
                  onChange={(e) => setConvertStartDate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="convert-amount">Plan price (₹) *</Label>
                <Input
                  id="convert-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={convertAmount}
                  onChange={(e) => setConvertAmount(e.target.value)}
                  placeholder="e.g. 999"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConvert} disabled={isPending}>
              {isPending ? "Converting..." : "Convert to Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
