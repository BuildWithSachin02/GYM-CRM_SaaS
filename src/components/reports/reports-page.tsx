"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import {
  Banknote,
  ClipboardCheck,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/common/page-header"
import { StatCard } from "@/components/common/stat-card"
import { StatusBadge } from "@/components/common/status-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { RevenueTrendChart } from "@/components/charts/revenue-trend-chart"
import { AttendanceTrendChart } from "@/components/charts/attendance-trend-chart"
import { BreakdownChart } from "@/components/reports/breakdown-chart"
import { Input } from "@/components/ui/input"
import { formatMoney, formatRangeLabel } from "@/lib/format"
import { isDayKey } from "@/lib/analytics-core"
import { LEAD_SOURCE, PAYMENT_METHOD, MEMBERSHIP_LIFECYCLE_STATUS, APPOINTMENT_STATUS } from "@/lib/status"
import type { ReportsData } from "@/lib/domain/reports"

type ReportsPageProps = {
  data: ReportsData
}

export function ReportsPage({ data }: ReportsPageProps) {
  const [tab, setTab] = useState("overview")

  const rangeLabel =
    data.range === "90"
      ? "Last 90 days"
      : data.range === "30"
        ? "Last 30 days"
        : formatRangeLabel(data.fromKey, data.toKey) || "Custom range"

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={`Business insights · ${rangeLabel}`}
        actions={
          <RangeControl
            key={`${data.range}:${data.fromKey}:${data.toKey}`}
            data={data}
          />
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Revenue"
          value={formatMoney(data.kpis.revenue)}
          icon={Wallet}
          iconClassName="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        />
        <StatCard
          label="Payments"
          value={data.kpis.paymentsCount}
          icon={Banknote}
        />
        <StatCard
          label="New Members"
          value={data.kpis.memberGain}
          icon={UserPlus}
        />
        <StatCard
          label="New Leads"
          value={data.kpis.newLeads}
          icon={TrendingUp}
        />
        <StatCard
          label="Conversions"
          value={data.kpis.conversions}
          icon={Users}
        />
        <StatCard
          label="Check-ins"
          value={data.kpis.attendanceCount}
          icon={ClipboardCheck}
          iconClassName="bg-amber-500/10 text-amber-600 dark:text-amber-400"
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Revenue trend</CardTitle>
                <CardDescription className="text-xs">
                  {rangeLabel}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RevenueTrendChart data={data.revenueTrend} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Attendance trend</CardTitle>
                <CardDescription className="text-xs">{rangeLabel}</CardDescription>
              </CardHeader>
              <CardContent>
                <AttendanceTrendChart data={data.attendanceTrend} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="revenue" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Revenue by payment method</CardTitle>
                <CardDescription className="text-xs">{rangeLabel}</CardDescription>
              </CardHeader>
              <CardContent>
                <BreakdownChart
                  data={data.paymentMethods.map((p) => ({
                    label: PAYMENT_METHOD[p.method as keyof typeof PAYMENT_METHOD]?.label ?? p.method,
                    value: p.amountMinor,
                  }))}
                  color="var(--primary)"
                  money
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Revenue by plan</CardTitle>
                <CardDescription className="text-xs">{rangeLabel}</CardDescription>
              </CardHeader>
              <CardContent>
                {data.planRevenue.length === 0 ? (
                  <EmptyChartNote>No plan revenue in this period.</EmptyChartNote>
                ) : (
                  <BreakdownChart
                    data={data.planRevenue.map((p) => ({
                      label: p.planName,
                      value: p.amountMinor,
                    }))}
                    color="var(--primary)"
                    money
                  />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment method breakdown</CardTitle>
              <CardDescription className="text-xs">{rangeLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              {data.paymentMethods.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No payments recorded in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 text-muted-foreground">#</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Payments</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.paymentMethods.map((p, index) => {
                      const config = PAYMENT_METHOD[p.method as keyof typeof PAYMENT_METHOD]
                      return (
                        <TableRow key={p.method}>
                          <TableCell className="w-10 text-xs tabular-nums text-muted-foreground">
                            {index + 1}
                          </TableCell>
                          <TableCell>
                            <StatusBadge tone={config?.tone ?? "muted"}>
                              {config?.label ?? p.method}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{p.count}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatMoney(p.amountMinor)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="leads" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Leads by source</CardTitle>
                <CardDescription className="text-xs">{rangeLabel}</CardDescription>
              </CardHeader>
              <CardContent>
                {data.leadSources.length === 0 ? (
                  <EmptyChartNote>No leads in this period.</EmptyChartNote>
                ) : (
                  <BreakdownChart
                    data={data.leadSources.map((l) => ({
                      label: LEAD_SOURCE[l.source as keyof typeof LEAD_SOURCE]?.label ?? l.source,
                      value: l.count,
                    }))}
                    color="var(--primary)"
                  />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Leads by source (detail)</CardTitle>
                <CardDescription className="text-xs">{rangeLabel}</CardDescription>
              </CardHeader>
              <CardContent>
                {data.leadSources.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No leads in this period.</p>
                ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 text-muted-foreground">#</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.leadSources.map((l, index) => {
                        const config = LEAD_SOURCE[l.source as keyof typeof LEAD_SOURCE]
                        return (
                          <TableRow key={l.source}>
                            <TableCell className="w-10 text-xs tabular-nums text-muted-foreground">
                              {index + 1}
                            </TableCell>
                            <TableCell>
                              <StatusBadge tone={config?.tone ?? "muted"}>
                                {config?.label ?? l.source}
                              </StatusBadge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{l.count}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="attendance" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Attendance trend</CardTitle>
              <CardDescription className="text-xs">{rangeLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              <AttendanceTrendChart data={data.attendanceTrend} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Membership status</CardTitle>
                <CardDescription className="text-xs">All-time</CardDescription>
              </CardHeader>
              <CardContent>
                {data.membershipStatuses.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No memberships yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 text-muted-foreground">#</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.membershipStatuses.map((m, index) => {
                        const config = MEMBERSHIP_LIFECYCLE_STATUS[m.status as keyof typeof MEMBERSHIP_LIFECYCLE_STATUS]
                        return (
                          <TableRow key={m.status}>
                            <TableCell className="w-10 text-xs tabular-nums text-muted-foreground">
                              {index + 1}
                            </TableCell>
                            <TableCell>
                              <StatusBadge tone={config?.tone ?? "muted"}>
                                {config?.label ?? m.status}
                              </StatusBadge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{m.count}</TableCell>
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
                <CardTitle className="text-base">Appointments by status</CardTitle>
                <CardDescription className="text-xs">All-time</CardDescription>
              </CardHeader>
              <CardContent>
                {data.appointmentStatuses.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No appointments yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 text-muted-foreground">#</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.appointmentStatuses.map((a, index) => {
                        const config = APPOINTMENT_STATUS[a.status as keyof typeof APPOINTMENT_STATUS]
                        return (
                          <TableRow key={a.status}>
                            <TableCell className="w-10 text-xs tabular-nums text-muted-foreground">
                              {index + 1}
                            </TableCell>
                            <TableCell>
                              <StatusBadge tone={config?.tone ?? "info"}>
                                {config?.label ?? a.status}
                              </StatusBadge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{a.count}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function EmptyChartNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-56 items-center justify-center">
      <p className="text-center text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

/**
 * Range selector + custom From/To filter. The range lives in the URL
 * (?range=30|90|custom&from=YYYY-MM-DD&to=YYYY-MM-DD) so refresh, Back/Forward
 * and tab switches all preserve the exact selection. Preset buttons navigate
 * immediately; the custom range is committed only on Apply, and invalid dates
 * are never sent to the URL.
 */
function RangeControl({ data }: { data: ReportsData }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  // State is keyed to the committed range by the caller (`key=`), so any real
  // navigation (preset click, Apply, or Back/Forward) remounts this component
  // with fresh drafts — no effect-needed prop-sync needed here.
  const [open, setOpen] = useState(data.range === "custom")
  const [from, setFrom] = useState(data.fromKey ?? "")
  const [to, setTo] = useState(data.toKey ?? "")
  const [error, setError] = useState<string | null>(null)

  const go = (range: string, fromKey?: string, toKey?: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("range", range)
    if (fromKey && toKey) {
      params.set("from", fromKey)
      params.set("to", toKey)
    } else {
      params.delete("from")
      params.delete("to")
    }
    router.push(`/dashboard/reports?${params.toString()}`)
  }

  const applyCustom = (e: React.FormEvent) => {
    e.preventDefault()
    if (!from || !to) {
      setError(!from ? "From date is required." : "To date is required.")
      return
    }
    if (!isDayKey(from) || !isDayKey(to)) {
      setError("Enter valid From and To dates.")
      return
    }
    if (from > to) {
      setError("From date must be before or equal to To date.")
      return
    }
    setError(null)
    go("custom", from, to)
  }

  return (
    <form onSubmit={applyCustom} className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant={data.range === "30" ? "default" : "outline"}
          size="sm"
          onClick={() => go("30")}
        >
          30 days
        </Button>
        <Button
          type="button"
          variant={data.range === "90" ? "default" : "outline"}
          size="sm"
          onClick={() => go("90")}
        >
          90 days
        </Button>
        <Button
          type="button"
          variant={data.range === "custom" ? "default" : "outline"}
          size="sm"
          onClick={() => setOpen((o) => !o)}
        >
          Custom
        </Button>
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="From date"
            value={from}
            onChange={(e) => {
              setError(null)
              setFrom(e.target.value)
            }}
            className="h-7 w-36"
          />
          <Input
            type="date"
            aria-label="To date"
            value={to}
            onChange={(e) => {
              setError(null)
              setTo(e.target.value)
            }}
            className="h-7 w-36"
          />
          <Button type="submit" size="sm">
            Apply
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => go("30")}>
            Reset
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
