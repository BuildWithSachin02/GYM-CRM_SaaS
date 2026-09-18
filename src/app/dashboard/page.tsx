import Link from "next/link"
import type { Metadata } from "next"
import { Suspense } from "react"
import {
  ClipboardCheck,
  Dumbbell,
  ListTodo,
  TrendingUp,
  UserPlus,
} from "lucide-react"

import { requireUser } from "@/lib/auth/auth"
import { can } from "@/lib/permissions"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  HomeActivitySection,
  HomeActivitySkeleton,
  HomeCardsSkeleton,
  HomeChartsSkeleton,
  HomeRemainingSection,
  HomeStatsSection,
  HomeStatsSkeleton,
  HomeTrendsSection,
} from "@/components/dashboard/home-sections"

export const metadata: Metadata = {
  title: "Dashboard",
}

export default async function DashboardPage() {
  const user = await requireUser()
  const canManage = can(user, "members:create")

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button render={<Link href="/dashboard/members?action=new" />}>
            <UserPlus className="size-4" /> Add Member
          </Button>
          <Button variant="outline" render={<Link href="/dashboard/attendance?action=checkin" />}>
            <ClipboardCheck className="size-4" /> Mark Attendance
          </Button>
          <Button variant="outline" render={<Link href="/dashboard/leads?action=new" />}>
            <TrendingUp className="size-4" /> Add Lead
          </Button>
          <Button variant="outline" render={<Link href="/dashboard/tasks?action=new" />}>
            <ListTodo className="size-4" /> New Task
          </Button>
        </div>
      )}

      <Suspense fallback={<HomeStatsSkeleton />}>
        <HomeStatsSection
          organizationId={user.organizationId}
          timeZone={user.organization.timezone}
        />
      </Suspense>

      <Suspense fallback={<HomeChartsSkeleton />}>
        <HomeTrendsSection
          organizationId={user.organizationId}
          timeZone={user.organization.timezone}
        />
      </Suspense>

      <Suspense fallback={<HomeCardsSkeleton />}>
        <HomeRemainingSection
          organizationId={user.organizationId}
          timeZone={user.organization.timezone}
        />
      </Suspense>

      <Suspense fallback={<HomeActivitySkeleton />}>
        <HomeActivitySection organizationId={user.organizationId} />
      </Suspense>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Dumbbell className="size-4" />
          <span>
            Welcome back, <strong className="text-foreground">{user.name.split(" ")[0]}</strong>.
            Here&apos;s what&apos;s happening at {user.organization.name} today.
          </span>
        </div>
      </div>
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-7 w-16" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-48" />
        </div>
        <div className="rounded-xl border p-5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-4 h-48" />
        </div>
      </div>
    </div>
  )
}