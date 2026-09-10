"use client"

import { useState } from "react"
import { Pencil, Power, UserPlus } from "lucide-react"

import type { UserRole, UserStatus } from "@prisma/client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/common/page-header"
import { StatusBadge } from "@/components/common/status-badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { USER_ROLE } from "@/lib/status"
import { initials, formatDate } from "@/lib/format"

import { OrgForm } from "@/components/settings/org-form"
import { StaffForm } from "@/components/settings/staff-form"
import { StaffEditForm } from "@/components/settings/staff-edit-form"

export type OrgData = {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  timezone: string
}

export type StaffData = {
  id: string
  name: string
  email: string
  phone: string | null
  role: UserRole
  status: UserStatus
  createdAt: string
}

type SettingsPageProps = {
  org: OrgData | null
  staff: StaffData[]
  currentUserId: string
  canManageSettings: boolean
  canManageStaff: boolean
}

const STATUS_CONFIG: Record<UserStatus, { tone: "success" | "muted" | "destructive"; label: string }> = {
  ACTIVE: { tone: "success", label: "Active" },
  DEACTIVATED: { tone: "destructive", label: "Deactivated" },
}

export function SettingsPage({
  org,
  staff,
  currentUserId,
  canManageSettings,
  canManageStaff,
}: SettingsPageProps) {
  const [tab, setTab] = useState("gym")

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Manage your gym details and staff"
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="gym">Gym Details</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
        </TabsList>

        <TabsContent value="gym" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Gym Information</CardTitle>
            </CardHeader>
            <CardContent>
              {org && canManageSettings ? (
                <OrgForm org={org} />
              ) : org ? (
                <div className="grid gap-4 text-sm sm:grid-cols-2">
                  <Field label="Name" value={org.name} />
                  <Field label="Phone" value={org.phone} />
                  <Field label="Email" value={org.email} />
                  <Field label="Address" value={org.address} />
                  <Field label="City" value={org.city} />
                  <Field label="State" value={org.state} />
                  <Field label="Country" value={org.country} />
                  <Field label="Timezone" value={org.timezone} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No organization data found.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="staff" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Staff Members</CardTitle>
              {canManageStaff && org && (
                <StaffForm
                  orgId={org.id}
                  trigger={
                    <Button>
                      <UserPlus className="size-4" /> Add Staff
                    </Button>
                  }
                />
              )}
            </CardHeader>
            <CardContent>
              {staff.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No staff members yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 text-muted-foreground">#</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Joined</TableHead>
                      {canManageStaff && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {staff.map((s, index) => (
                      <TableRow key={s.id}>
                        <TableCell className="w-10 text-xs tabular-nums text-muted-foreground">
                          {index + 1}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="size-7">
                              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                {initials(s.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{s.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{s.email}</TableCell>
                        <TableCell>
                          <StatusBadge tone={USER_ROLE[s.role].tone}>
                            {USER_ROLE[s.role].label}
                          </StatusBadge>
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={STATUS_CONFIG[s.status].tone}>
                            {STATUS_CONFIG[s.status].label}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(s.createdAt)}
                        </TableCell>
                        {canManageStaff && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <StaffEditForm
                                staff={s}
                                trigger={
                                  <Button variant="ghost" size="icon-sm">
                                    <Pencil className="size-3.5" />
                                  </Button>
                                }
                              />
                              <StatusToggleButton
                                staffId={s.id}
                                staffName={s.name}
                                currentStatus={s.status}
                                isSelf={s.id === currentUserId}
                              />
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value || "—"}</p>
    </div>
  )
}

function StatusToggleButton({
  staffId,
  staffName,
  currentStatus,
  isSelf,
}: {
  staffId: string
  staffName: string
  currentStatus: UserStatus
  isSelf: boolean
}) {
  const [pending, setPending] = useState(false)
  const newStatus: UserStatus = currentStatus === "ACTIVE" ? "DEACTIVATED" : "ACTIVE"

  if (isSelf) return null

  return (
    <StaffEditForm
      staff={{
        id: staffId,
        name: staffName,
        email: "",
        phone: null,
        role: "RECEPTIONIST",
        status: currentStatus,
        createdAt: "",
      }}
      defaultStatus={newStatus}
      trigger={
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          title={currentStatus === "ACTIVE" ? "Deactivate" : "Activate"}
        >
          <Power className="size-3.5" />
        </Button>
      }
    />
  )
}
