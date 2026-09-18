/**
 * Member-level attendance analytics — pure, timezone-safe.
 *
 * All date math runs on calendar-day keys (YYYY-MM-DD) so it never shifts
 * across timezones. "Today" must be supplied by the caller as the
 * organization's calendar day (dayKeyInTimeZone); ranges are inclusive
 * [fromKey, toKey] with a null bound meaning "unbounded".
 *
 * Day keys also follow the gym's attendance business rule: at most one
 * check-in per member per day (see CheckIn @@unique[organizationId,
 * memberId, dayKey]). Stats therefore treat one key = one attended day.
 */

import { format } from "date-fns"

import { addDaysToKey, daysBetweenKeys } from "@/lib/memberships"

// ---------------------------------------------------------------------------
// Range presets
// ---------------------------------------------------------------------------

export const ATTENDANCE_RANGE_PRESETS = [
  { id: "TODAY", label: "Today" },
  { id: "THIS_WEEK", label: "This Week" },
  { id: "THIS_MONTH", label: "This Month" },
  { id: "LAST_MONTH", label: "Last Month" },
  { id: "THIS_YEAR", label: "This Year" },
  { id: "ALL", label: "All Time" },
] as const

export type AttendanceRangePresetId =
  | "TODAY"
  | "THIS_WEEK"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "THIS_YEAR"
  | "ALL"
  | "CUSTOM"

export type AttendanceRange = {
  preset: AttendanceRangePresetId
  /** Inclusive lower bound (Y-M-D) or null for unbounded. */
  fromKey: string | null
  /** Inclusive upper bound (Y-M-D) or null for unbounded. */
  toKey: string | null
}

export const PRESET_LABELS: Record<AttendanceRangePresetId, string> = {
  TODAY: "Today",
  THIS_WEEK: "This Week",
  THIS_MONTH: "This Month",
  LAST_MONTH: "Last Month",
  THIS_YEAR: "This Year",
  ALL: "All Time",
  CUSTOM: "Custom Range",
}

// ---------------------------------------------------------------------------
// Day-key math
// ---------------------------------------------------------------------------

export function isValidDayKey(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function keyFromParts(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${y}-${pad(m)}-${pad(d)}`
}

/** Day of the week for a day key: 0 = Sunday .. 6 = Saturday (pure UTC math). */
export function dayOfWeekForKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Monday-start week boundary (ISO 8601 week). */
export function startOfWeekKey(key: string): string {
  return addDaysToKey(key, -((dayOfWeekForKey(key) + 6) % 7))
}

export function startOfMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number)
  return keyFromParts(y, m, 1)
}

export function endOfMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number)
  return addDaysToKey(keyFromParts(y, m + 1, 1), -1)
}

export function startOfYearKey(key: string): string {
  const [y] = key.split("-").map(Number)
  return keyFromParts(y, 1, 1)
}

function labelOfKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  return format(new Date(y, m - 1, d), "dd MMM")
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

// ---------------------------------------------------------------------------
// Range resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a requested preset (+ optional custom bounds) into an inclusive
 * day-key range in the organization's calendar. Unrecognised presets, invalid
 * custom values, and inverted custom ranges all fall back to an unbounded
 * (All Time) range so a malicious or stale query string can never crash a
 * query or shift dates by a day.
 */
export function resolveAttendanceRange(
  preset: string | null | undefined,
  todayKey: string,
  customFrom?: string | null,
  customTo?: string | null
): AttendanceRange {
  const today = isValidDayKey(todayKey) ? todayKey : dayKeyFromUtcToday()

  switch (preset) {
    case "TODAY":
      return { preset: "TODAY", fromKey: today, toKey: today }
    case "THIS_WEEK":
      return { preset: "THIS_WEEK", fromKey: startOfWeekKey(today), toKey: today }
    case "THIS_MONTH":
      return { preset: "THIS_MONTH", fromKey: startOfMonthKey(today), toKey: today }
    case "LAST_MONTH": {
      const prevStart = startOfMonthKey(addDaysToKey(startOfMonthKey(today), -1))
      return { preset: "LAST_MONTH", fromKey: prevStart, toKey: endOfMonthKey(prevStart) }
    }
    case "THIS_YEAR":
      return { preset: "THIS_YEAR", fromKey: startOfYearKey(today), toKey: today }
    case "CUSTOM": {
      const from = sanitizeKey(customFrom)
      const to = sanitizeKey(customTo)
      if (from && to && from <= to) return { preset: "CUSTOM", fromKey: from, toKey: to }
      return { preset: "ALL", fromKey: null, toKey: null }
    }
    default:
      return { preset: "ALL", fromKey: null, toKey: null }
  }
}

function sanitizeKey(value: string | null | undefined): string | null {
  if (!isValidDayKey(value)) return null
  return value
}

function dayKeyFromUtcToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .trim()
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export type LifetimeAttendanceStats = {
  totalVisits: number
  distinctDays: number
  thisMonth: number
  thisYear: number
  avgPerWeek: number
  currentStreak: number
  longestStreak: number
}

export type RangeAttendanceStats = {
  visits: number
  distinctDays: number
  firstVisitKey: string | null
  lastVisitKey: string | null
  avgPerWeek: number
  currentStreak: number
  longestStreak: number
}

/** Current + longest consecutive-day streak over a sorted day-key list. */
export function streakStats(
  dayKeys: readonly string[],
  anchorKey: string
): { current: number; longest: number } {
  const set = new Set(dayKeys.filter(isValidDayKey))
  const sorted = [...set].sort()

  let current = 0
  let cursor = set.has(anchorKey)
    ? anchorKey
    : set.has(addDaysToKey(anchorKey, -1))
      ? addDaysToKey(anchorKey, -1)
      : null
  while (cursor && set.has(cursor)) {
    current += 1
    cursor = addDaysToKey(cursor, -1)
  }

  let longest = 0
  let run = 0
  let prev: string | null = null
  for (const k of sorted) {
    run = prev !== null && addDaysToKey(prev, 1) === k ? run + 1 : 1
    if (run > longest) longest = run
    prev = k
  }

  return { current, longest }
}

/** Lifetime attendance metrics for the member profile summary. */
export function computeLifetimeStats(
  dayKeys: readonly string[],
  todayKey: string
): LifetimeAttendanceStats {
  const distinct = [...new Set(dayKeys.filter(isValidDayKey))].sort()
  const totalVisits = dayKeys.filter(isValidDayKey).length
  const distinctDays = distinct.length

  const monthStart = startOfMonthKey(todayKey)
  const yearStart = startOfYearKey(todayKey)
  let thisMonth = 0
  let thisYear = 0
  for (const k of distinct) {
    if (k >= monthStart && k <= todayKey) thisMonth += 1
    if (k >= yearStart && k <= todayKey) thisYear += 1
  }

  const first = distinct[0]
  const weeks = first ? Math.max(1, (daysBetweenKeys(first, todayKey) + 1) / 7) : 1
  const avgPerWeek =
    distinctDays === 0 ? 0 : Math.round((distinctDays / weeks) * 10) / 10

  const { current, longest } = streakStats(distinct, todayKey)

  return {
    totalVisits,
    distinctDays,
    thisMonth,
    thisYear,
    avgPerWeek,
    currentStreak: current,
    longestStreak: longest,
  }
}

/** Attendance metrics scoped to an inclusive day-key range. */
export function computeRangeAttendance(
  dayKeys: readonly string[],
  todayKey: string,
  fromKey: string | null,
  toKey: string | null
): RangeAttendanceStats {
  const sorted = [...new Set(dayKeys.filter(isValidDayKey))].sort()
  const inRange = sorted.filter(
    (k) =>
      (fromKey === null || k >= fromKey) && (toKey === null || k <= toKey)
  )

  const first = inRange[0] ?? null
  const last = inRange[inRange.length - 1] ?? null
  const rangeStart = fromKey ?? first ?? todayKey
  const rangeEnd = toKey ?? todayKey
  const spanWeeks = Math.max(1, (daysBetweenKeys(rangeStart, rangeEnd) + 1) / 7)
  const visits = inRange.length
  const avgPerWeek =
    visits === 0 ? 0 : Math.round((visits / spanWeeks) * 10) / 10

  const { current, longest } = streakStats(inRange, toKey ?? todayKey)

  return {
    visits,
    distinctDays: visits,
    firstVisitKey: first,
    lastVisitKey: last,
    avgPerWeek,
    currentStreak: current,
    longestStreak: longest,
  }
}

// ---------------------------------------------------------------------------
// Trend aggregation
// ---------------------------------------------------------------------------

/**
 * Bucket attended days for a trend chart. Short ranges (<= 14 weeks) bucket
 * weekly (labelled by the Monday of the week); longer ranges bucket by month
 * (labelled "Oct 26"). Returns [{ day, count }] compatible with the existing
 * AttendanceTrendChart.
 */
export function buildAttendanceTrend(
  dayKeys: readonly string[],
  fromKey: string | null,
  toKey: string | null,
  maxPoints = 36
): { day: string; count: number }[] {
  const sorted = [...new Set(dayKeys.filter(isValidDayKey))].sort()
  const from = fromKey ?? sorted[0] ?? null
  const to = toKey ?? sorted[sorted.length - 1] ?? null
  if (!from || !to || from > to) return []

  const spanDays = daysBetweenKeys(from, to) + 1
  const useWeekly = spanDays <= 14 * 7

  let buckets: { day: string; count: number }[]

  if (useWeekly) {
    buckets = []
    let weekStart = startOfWeekKey(from)
    while (weekStart <= to) {
      const weekEnd = addDaysToKey(weekStart, 6)
      const upper = weekEnd <= to ? weekEnd : to
      const count = sorted.filter((k) => k >= weekStart && k <= upper).length
      buckets.push({ day: labelOfKey(weekStart), count })
      weekStart = addDaysToKey(weekStart, 7)
    }
  } else {
    buckets = []
    let cursor = startOfMonthKey(from)
    const lastMonth = startOfMonthKey(to)
    while (cursor <= lastMonth) {
      const monthEnd = endOfMonthKey(cursor)
      const upper = monthEnd <= to ? monthEnd : to
      const count = sorted.filter((k) => k >= cursor && k <= upper).length
      const [y, m] = cursor.split("-").map(Number)
      buckets.push({ day: `${MONTH_ABBR[m - 1]} ${String(y).slice(2)}`, count })
      cursor = addDaysToKey(monthEnd, 1)
    }
  }

  if (buckets.length > maxPoints) {
    buckets = buckets.slice(buckets.length - maxPoints)
  }
  return buckets
}

// ---------------------------------------------------------------------------
// Attendance calendar
// ---------------------------------------------------------------------------

export type CalendarDayCell = {
  key: string
  /** Day-of-month (1..31) for display inside the cell. */
  day: number
  /** True when the member attended on this calendar day (within range). */
  attended: boolean
  /** True when the cell falls inside the selected range (not just the month). */
  inRange: boolean
  /** True when the cell belongs to an adjacent month (grid padding). */
  outside: boolean
}

export type CalendarMonth = {
  year: number
  month: number
  label: string
  weeks: CalendarDayCell[][]
}

export const CALENDAR_WEEKDAY_HEADERS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

/**
 * Build Monday-first month grids over [from, to] marking attended days.
 * Unbounded ranges collapse to the member's actual attendance span; at most
 * `maxMonths` months are rendered (caller shows a note if more exist).
 */
export function buildAttendanceCalendar(
  dayKeys: readonly string[],
  fromKey: string | null,
  toKey: string | null,
  maxMonths = 12
): CalendarMonth[] {
  const sorted = [...new Set(dayKeys.filter(isValidDayKey))].sort()
  const attended = new Set(sorted)
  const from = fromKey ?? sorted[0] ?? null
  const to = toKey ?? sorted[sorted.length - 1] ?? null
  if (!from || !to || from > to) return []

  const months: CalendarMonth[] = []
  let cursor = startOfMonthKey(from)
  const lastMonth = startOfMonthKey(to)

  while (cursor <= lastMonth && months.length < maxMonths) {
    const [y, m] = cursor.split("-").map(Number)
    const monthEnd = endOfMonthKey(cursor)

    const weeks: CalendarDayCell[][] = []
    let week: CalendarDayCell[] = []

    // Leading padding — adjacent-month days that complete the first week.
    const leading = (dayOfWeekForKey(cursor) + 6) % 7
    let d = addDaysToKey(cursor, -leading)
    for (let i = 0; i < leading; i++) {
      week.push({
        key: d,
        day: Number(d.split("-")[2]),
        attended: false,
        inRange: false,
        outside: true,
      })
      d = addDaysToKey(d, 1)
    }

    // Days of this month.
    while (d <= monthEnd) {
      const inRange = d >= from && d <= to
      week.push({
        key: d,
        day: Number(d.split("-")[2]),
        attended: inRange ? attended.has(d) : false,
        inRange,
        outside: false,
      })
      if (week.length === 7) {
        weeks.push(week)
        week = []
      }
      d = addDaysToKey(d, 1)
    }

    // Trailing padding — the leading days of next month.
    if (week.length > 0) {
      while (week.length < 7) {
        week.push({
          key: d,
          day: Number(d.split("-")[2]),
          attended: false,
          inRange: false,
          outside: true,
        })
        d = addDaysToKey(d, 1)
      }
      weeks.push(week)
    }

    months.push({ year: y, month: m, label: `${MONTH_ABBR[m - 1]} ${y}`, weeks })
    cursor = addDaysToKey(monthEnd, 1)
  }

  return months
}