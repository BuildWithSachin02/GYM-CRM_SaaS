import { CalendarCheck, CalendarDays, Clock, Repeat } from "lucide-react"

import { formatDayKey, formatTimeInZone } from "@/lib/format"
import { pluralize } from "@/lib/format"
import { StatCard } from "@/components/common/stat-card"

export type AttendanceSummaryProps = {
  timeZone: string
  totalVisits: number
  thisMonth: number
  thisYear: number
  avgPerWeek: number
  lastVisit: { dayKey: string; checkedInAt: string } | null
  /** Compact layout — no "This Year" tile, used on the member profile. */
  compact?: boolean
}

/**
 * Member attendance summary tiles. Pure presentation: the values are computed
 * on the server from real CheckIn records (never fabricated) and passed in.
 */
export function MemberAttendanceSummary({
  timeZone,
  totalVisits,
  thisMonth,
  thisYear,
  avgPerWeek,
  lastVisit,
  compact = false,
}: AttendanceSummaryProps) {
  const streakLine = [
    `Last visit ${lastVisit ? `${formatDayKey(lastVisit.dayKey)} · ${formatTimeInZone(lastVisit.checkedInAt, timeZone)}` : "—"}`,
    `${thisYear} ${pluralize(thisYear, "visit", "visits")} this year`,
  ].join("  ·  ")

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard
          label="Total Visits"
          value={totalVisits.toLocaleString("en-IN")}
          icon={CalendarCheck}
        />
        <StatCard
          label="This Month"
          value={thisMonth.toLocaleString("en-IN")}
          icon={CalendarDays}
        />
        {!compact && (
          <StatCard
            label="This Year"
            value={thisYear.toLocaleString("en-IN")}
            icon={CalendarDays}
          />
        )}
        <StatCard
          label="Avg / Week"
          value={avgPerWeek.toLocaleString("en-IN", {
            maximumFractionDigits: 1,
          })}
          icon={Repeat}
        />
        <StatCard
          label="Last Visit"
          value={lastVisit ? formatDayKey(lastVisit.dayKey) : "—"}
          hint={lastVisit ? formatTimeInZone(lastVisit.checkedInAt, timeZone) : "No check-ins yet"}
          icon={Clock}
          className={compact ? "col-span-2 md:col-span-1" : undefined}
        />
      </div>
      <p className="text-xs text-muted-foreground">{streakLine}</p>
    </div>
  )
}