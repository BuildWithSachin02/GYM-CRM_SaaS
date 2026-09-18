import Link from "next/link"
import {
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  Clock,
  CreditCard,
  TrendingUp,
  Users,
  Users2,
  Wallet,
  XCircle,
} from "lucide-react"

import {
  getDashboardActivityData,
  getDashboardRemainingData,
  getDashboardStatsData,
  getDashboardTrendsData,
  getDashboardUpcomingAppointments,
} from "@/lib/domain/dashboard"
import { formatDateTime, formatMoney, formatTime, pluralize } from "@/lib/format"
import { APPOINTMENT_STATUS, LEAD_STAGE, MEMBER_STATUS, PAYMENT_METHOD } from "@/lib/status"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { StatCard } from "@/components/common/stat-card"
import { StatusBadge } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"
import { RevenueTrendChart } from "@/components/charts/revenue-trend-chart"
import { AttendanceTrendChart } from "@/components/charts/attendance-trend-chart"

function WidgetCard({
  title,
  description,
  href,
  actionLabel,
  children,
  className,
}: {
  title: string
  description?: string
  href?: string
  actionLabel?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && (
            <CardDescription className="mt-0.5 text-xs">{description}</CardDescription>
          )}
        </div>
        {href && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            render={<Link href={href} />}
          >
            {actionLabel ?? "View all"} <ArrowRight className="size-3" />
          </Button>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
}

function initialsOf(first: string, last: string) {
  return `${(first[0] ?? "").toUpperCase()}${(last[0] ?? "").toUpperCase()}`
}

/**
 * Streamed segment: the 8 stat cards at the top of the dashboard.
 */
export async function HomeStatsSection({
  organizationId,
  timeZone,
}: {
  organizationId: string
  timeZone: string
}) {
  const { stats: s, upcomingCount } = await getDashboardStatsData(
    organizationId,
    timeZone
  )

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatCard
        label="Total Members"
        value={s.totalMembers}
        hint={`${s.activeMembers} active`}
        icon={Users}
      />
      <StatCard
        label="Expiring in 7 days"
        value={s.expiringSoon7}
        hint="members due soon"
        icon={Clock}
        iconClassName="bg-amber-500/10 text-amber-600 dark:text-amber-400"
      />
      <StatCard
        label="Today's Attendance"
        value={s.todayAttendance}
        hint={`${pluralize(s.todayAttendance, "check-in")} today`}
        icon={ClipboardCheck}
      />
      <StatCard
        label="Today's Revenue"
        value={formatMoney(s.todayRevenue)}
        hint="collected today"
        icon={Wallet}
        iconClassName="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      />
      <StatCard
        label="Expired Memberships"
        value={s.expiredCount}
        hint="need renewal follow-up"
        icon={XCircle}
        iconClassName="bg-red-500/10 text-red-600 dark:text-red-400"
      />
      <StatCard
        label="New Leads"
        value={s.newLeads}
        hint="in funnel pipeline"
        icon={Users2}
      />
      <StatCard
        label="Pending Follow-ups"
        value={s.pendingFollowUps}
        hint="leads needing attention"
        icon={TrendingUp}
        iconClassName="bg-amber-500/10 text-amber-600 dark:text-amber-400"
      />
      <StatCard
        label="Appointments"
        value={upcomingCount}
        hint="next 7 days"
        icon={CalendarDays}
      />
    </div>
  )
}

/**
 * Streamed segment: the revenue + attendance trend charts.
 */
export async function HomeTrendsSection({
  organizationId,
  timeZone,
}: {
  organizationId: string
  timeZone: string
}) {
  const { revenueTrend, attendanceTrend } = await getDashboardTrendsData(
    organizationId,
    timeZone
  )

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <WidgetCard
        title="Revenue trend"
        description="Last 30 days"
        className="lg:col-span-2"
        href="/dashboard/reports"
      >
        <RevenueTrendChart data={revenueTrend} />
      </WidgetCard>
      <WidgetCard
        title="Attendance trend"
        description="Last 14 days"
        href="/dashboard/attendance"
      >
        <AttendanceTrendChart data={attendanceTrend} />
      </WidgetCard>
    </div>
  )
}

/**
 * Streamed segment: expiring memberships, today's appointments, overdue tasks.
 */
export async function HomeRemainingSection({
  organizationId,
  timeZone,
}: {
  organizationId: string
  timeZone: string
}) {
  const { expiringMemberships, todayAppointments, overdueTasks } =
    await getDashboardRemainingData(organizationId, timeZone)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <WidgetCard
        title="Expiring memberships"
        description="Next 30 days"
        href="/dashboard/memberships"
      >
        {expiringMemberships.length === 0 ? (
          <EmptyRow>No expiring memberships.</EmptyRow>
        ) : (
          <ul className="divide-y">
            {expiringMemberships.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/members/${m.memberId}`}
                    className="block truncate text-sm font-medium hover:text-primary"
                  >
                    {m.memberName}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">{m.planName}</p>
                </div>
                {m.daysLeft <= 7 ? (
                  <StatusBadge tone="destructive">{m.daysLeft} days left</StatusBadge>
                ) : (
                  <StatusBadge tone="warning">{m.daysLeft} days left</StatusBadge>
                )}
              </li>
            ))}
          </ul>
        )}
      </WidgetCard>

      <WidgetCard
        title="Today's appointments"
        href="/dashboard/appointments"
        description="All scheduled for today"
      >
        {todayAppointments.length === 0 ? (
          <EmptyRow>No appointments today.</EmptyRow>
        ) : (
          <ul className="divide-y">
            {todayAppointments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatTime(a.startsAt)} – {formatTime(a.endsAt)}
                  </p>
                </div>
                <StatusBadge
                  tone={APPOINTMENT_STATUS[a.status as keyof typeof APPOINTMENT_STATUS]?.tone ?? "info"}
                >
                  {APPOINTMENT_STATUS[a.status as keyof typeof APPOINTMENT_STATUS]?.label ?? a.status}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </WidgetCard>

      <WidgetCard title="Overdue tasks" href="/dashboard/tasks">
        {overdueTasks.length === 0 ? (
          <EmptyRow>No overdue tasks.</EmptyRow>
        ) : (
          <ul className="divide-y">
            {overdueTasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">{t.assignee ?? "Unassigned"}</p>
                </div>
                <span className="shrink-0 text-xs text-destructive">
                  {formatDateTime(t.dueDate)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </WidgetCard>
    </div>
  )
}

/**
 * Streamed segment: recent payments, leads to follow up, lead pipeline,
 * recently added members, and upcoming appointments.
 */
export async function HomeActivitySection({
  organizationId,
}: {
  organizationId: string
}) {
  const [activity, upcomingAppointments] = await Promise.all([
    getDashboardActivityData(organizationId),
    getDashboardUpcomingAppointments(organizationId),
  ])
  const { recentPayments, recentMembers, newLeadsToday, leadPipeline } = activity

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <WidgetCard
          title="Recent payments"
          href="/dashboard/payments"
          className="lg:col-span-2"
        >
          {recentPayments.length === 0 ? (
            <EmptyRow>No payments recorded yet.</EmptyRow>
          ) : (
            <ul className="divide-y">
              {recentPayments.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <CreditCard className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <Link
                        href={`/dashboard/members/${p.memberId}`}
                        className="block truncate text-sm font-medium hover:text-primary"
                      >
                        {p.memberName}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(p.paymentDate)} · by {p.recordedBy}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge tone={PAYMENT_METHOD[p.method as keyof typeof PAYMENT_METHOD]?.tone ?? "muted"}>
                      {PAYMENT_METHOD[p.method as keyof typeof PAYMENT_METHOD]?.label ?? p.method}
                    </StatusBadge>
                    <span className="text-sm font-semibold">{formatMoney(p.amountMinor)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>

        <WidgetCard title="Leads to follow up" href="/dashboard/leads">
          {newLeadsToday.length === 0 ? (
            <EmptyRow>No leads need follow-up.</EmptyRow>
          ) : (
            <ul className="divide-y">
              {newLeadsToday.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/leads/${l.id}`}
                      className="block truncate text-sm font-medium hover:text-primary"
                    >
                      {l.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {l.followUpDate ? `Follow-up ${formatDateTime(l.followUpDate)}` : "No follow-up set"}
                    </p>
                  </div>
                  <StatusBadge tone={LEAD_STAGE[l.stage as keyof typeof LEAD_STAGE]?.tone ?? "muted"}>
                    {LEAD_STAGE[l.stage as keyof typeof LEAD_STAGE]?.label ?? l.stage}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <WidgetCard title="Lead pipeline">
          {leadPipeline.length === 0 ? (
            <EmptyRow>No leads yet.</EmptyRow>
          ) : (
            <ul className="space-y-3">
              {leadPipeline.map((p) => {
                const total = leadPipeline.reduce((acc, x) => acc + x.count, 0)
                const pct = total > 0 ? Math.round((p.count / total) * 100) : 0
                return (
                  <li key={p.stage}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <StatusBadge tone={LEAD_STAGE[p.stage as keyof typeof LEAD_STAGE]?.tone ?? "muted"}>
                        {LEAD_STAGE[p.stage as keyof typeof LEAD_STAGE]?.label ?? p.stage}
                      </StatusBadge>
                      <span className="text-xs text-muted-foreground">{p.count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </WidgetCard>

        <WidgetCard title="Recently added members" href="/dashboard/members">
          {recentMembers.length === 0 ? (
            <EmptyRow>No members yet.</EmptyRow>
          ) : (
            <ul className="divide-y">
              {recentMembers.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {initialsOf(m.firstName, m.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/dashboard/members/${m.id}`}
                      className="block truncate text-sm font-medium hover:text-primary"
                    >
                      {m.firstName} {m.lastName}
                    </Link>
                    <p className="text-xs text-muted-foreground">{m.phone}</p>
                  </div>
                  <StatusBadge tone={MEMBER_STATUS[m.status as keyof typeof MEMBER_STATUS]?.tone ?? "muted"}>
                    {MEMBER_STATUS[m.status as keyof typeof MEMBER_STATUS]?.label ?? m.status}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>

        <WidgetCard
          title="Upcoming appointments"
          href="/dashboard/appointments"
          description="Next 7 days"
        >
          {upcomingAppointments.length === 0 ? (
            <EmptyRow>No upcoming appointments.</EmptyRow>
          ) : (
            <ul className="divide-y">
              {upcomingAppointments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                  <p className="truncate text-sm font-medium">{a.title}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(a.startsAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>
      </div>
    </div>
  )
}

// --- Suspense fallbacks (static, data-free) ---

export function HomeStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-xl border p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-7 w-16" />
          <Skeleton className="mt-2 h-3 w-28" />
        </div>
      ))}
    </div>
  )
}

export function HomeChartsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="rounded-xl border p-5 lg:col-span-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-48" />
      </div>
      <div className="rounded-xl border p-5">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="mt-4 h-48" />
      </div>
    </div>
  )
}

export function HomeCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl border p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-24" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-2/3" />
        </div>
      ))}
    </div>
  )
}

export function HomeActivitySkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border p-5 lg:col-span-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-24" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-2/3" />
        </div>
        <div className="rounded-xl border p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-24" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-1/2" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-4 h-24" />
            <Skeleton className="mt-3 h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}