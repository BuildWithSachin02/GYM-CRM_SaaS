"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { Pencil, Power, UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/common/status-badge"
import { USER_ROLE } from "@/lib/status"
import { initials } from "@/lib/format"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/common/page-header"
import { TrainerForm } from "@/components/trainers/trainer-form"
import { TrainerEditForm } from "@/components/trainers/trainer-edit-form"
import { toggleTrainerActive } from "@/lib/actions/trainers"
import type { UserRole } from "@prisma/client"

export type TrainerRow = {
  id: string
  bio: string | null
  specialties: string[]
  active: boolean
  user: { id: string; name: string; email: string; role: UserRole }
  memberCount: number
  appointmentCount: number
}

export type StaffOption = {
  id: string
  name: string
  email: string
  role: UserRole
}

type TrainerListProps = {
  trainers: TrainerRow[]
  canManage: boolean
  availableUsers: StaffOption[]
}

export function TrainerList({ trainers, canManage, availableUsers }: TrainerListProps) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function onToggle(id: string) {
    setBusyId(id)
    try {
      const res = await toggleTrainerActive(id)
      if (res.success) {
        toast.success("Trainer updated")
        router.refresh()
      } else {
        toast.error(res.error ?? "Something went wrong")
      }
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Trainers"
        description={`${trainers.length} trainer(s) on the team`}
        actions={
          canManage && (
            <TrainerForm
              trigger={
                <Button>
                  <UserPlus className="size-4" /> Add Trainer
                </Button>
              }
              availableUsers={availableUsers}
            />
          )
        }
      />

      {trainers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserPlus className="size-5" />
          </div>
          <h3 className="mt-3 text-sm font-medium">No trainers yet</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Add trainers to assign them to members and schedule appointments.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {trainers.map((trainer) => (
            <Card key={trainer.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-10">
                      <AvatarFallback className="bg-primary/10 text-primary">
                        {initials(trainer.user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{trainer.user.name}</p>
                      <p className="text-xs text-muted-foreground">{trainer.user.email}</p>
                    </div>
                  </div>
                  <StatusBadge tone={trainer.active ? "success" : "muted"}>
                    {trainer.active ? "Active" : "Inactive"}
                  </StatusBadge>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <StatusBadge tone={USER_ROLE[trainer.user.role].tone}>
                    {USER_ROLE[trainer.user.role].label}
                  </StatusBadge>
                  {trainer.specialties.slice(0, 3).map((s) => (
                    <Badge key={s} variant="secondary">
                      {s}
                    </Badge>
                  ))}
                </div>
                {trainer.bio && (
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{trainer.bio}</p>
                )}
                <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
                  <span>
                    <strong className="font-medium text-foreground">{trainer.memberCount}</strong>{" "}
                    members
                  </span>
                  <span>
                    <strong className="font-medium text-foreground">
                      {trainer.appointmentCount}
                    </strong>{" "}
                    appointments
                  </span>
                </div>
                {canManage && (
                  <div className="mt-4 flex items-center gap-2 border-t pt-3">
                    <TrainerEditForm
                      trainer={trainer}
                      trigger={
                        <Button variant="outline" size="sm">
                          <Pencil className="size-3.5" /> Edit
                        </Button>
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === trainer.id}
                      onClick={() => onToggle(trainer.id)}
                    >
                      <Power className="size-3.5" />
                      {trainer.active ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}