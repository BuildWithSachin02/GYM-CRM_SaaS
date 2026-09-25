"use client"

import { useState } from "react"
import { Users } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/common/page-header"

import { OrgForm } from "@/components/settings/org-form"
import { DataSettings } from "@/components/settings/data-settings"

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

type SettingsPageProps = {
  org: OrgData | null
  canManageSettings: boolean
  canManageStaff: boolean
  isOwner: boolean
}

export function SettingsPage({
  org,
  canManageSettings,
  canManageStaff,
  isOwner,
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
          {canManageStaff && <TabsTrigger value="users">Users & Access</TabsTrigger>}
          {canManageSettings && <TabsTrigger value="data">Data</TabsTrigger>}
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

        {canManageStaff && (
          <TabsContent value="users" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Users & Access Control</CardTitle>
                <CardDescription>
                  Manage staff accounts, roles, passwords and fine-grained permissions.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-4 sm:flex-row">
                  <Button render={<Link href="/dashboard/settings/users" />}>
                    <Users className="size-4" /> Manage Users & Access
                  </Button>
                  <div className="max-w-xl text-sm text-muted-foreground">
                    {isOwner
                      ? "You own this gym. You can create owner accounts, staff and receptionists, and control exactly what each user can see and do."
                      : "Your owner controls who has access. You can edit staff details and reset passwords here."}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {canManageSettings && (
          <TabsContent value="data" className="mt-4">
            {org ? <DataSettings gymName={org.name} /> : null}
          </TabsContent>
        )}
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
