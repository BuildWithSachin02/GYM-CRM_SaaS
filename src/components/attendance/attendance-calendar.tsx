import { cn } from "@/lib/utils"
import {
  CALENDAR_WEEKDAY_HEADERS,
  type CalendarMonth,
} from "@/lib/member-attendance"

export type AttendanceCalendarProps = {
  months: CalendarMonth[]
  todayKey: string | null
  renderedMonths: number
  totalMonths: number
}

/**
 * A compact Monday-first attendance calendar. Attended days (within the
 * selected range) are filled with the primary tone; range-but-not-attended
 * days render normally; out-of-range/adjacent-month days are dimmed. Pure
 * presentation driven by the day keys passed from the server.
 */
export function AttendanceCalendar({
  months,
  todayKey,
  renderedMonths,
  totalMonths,
}: AttendanceCalendarProps) {
  if (months.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No attendance in this period.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {months.map((month) => (
          <div key={`${month.year}-${month.month}`}>
            <p className="mb-2 text-sm font-medium">{month.label}</p>
            <div className="grid grid-cols-7 gap-1 text-center">
              {CALENDAR_WEEKDAY_HEADERS.map((h) => (
                <span
                  key={h}
                  className="text-[11px] font-normal text-muted-foreground"
                >
                  {h}
                </span>
              ))}
              {month.weeks.flat().map((cell, i) => {
                const isToday = todayKey !== null && cell.key === todayKey
                return (
                  <div
                    key={`${cell.key}-${i}`}
                    aria-label={`${cell.key}${cell.attended ? " · attended" : ""}`}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-md text-xs tabular-nums",
                      cell.outside && "text-muted-foreground/40",
                      cell.inRange &&
                        !cell.outside &&
                        !cell.attended &&
                        "text-muted-foreground",
                      cell.attended &&
                        "bg-primary font-medium text-primary-foreground",
                      isToday &&
                        !cell.attended &&
                        "ring-1 ring-inset ring-ring"
                    )}
                  >
                    {cell.day}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded bg-primary" /> Attended
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded ring-1 ring-inset ring-ring" /> Today
          </span>
        </div>
        {totalMonths > renderedMonths && (
          <span>
            +{totalMonths - renderedMonths} more month{totalMonths - renderedMonths === 1 ? "" : "s"} in range
          </span>
        )}
      </div>
    </div>
  )
}