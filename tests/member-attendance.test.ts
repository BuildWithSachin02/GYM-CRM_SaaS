import { test } from "node:test"
import assert from "node:assert/strict"

import {
  ATTENDANCE_RANGE_PRESETS,
  buildAttendanceCalendar,
  buildAttendanceTrend,
  CALENDAR_WEEKDAY_HEADERS,
  computeLifetimeStats,
  computeRangeAttendance,
  dayOfWeekForKey,
  endOfMonthKey,
  isValidDayKey,
  resolveAttendanceRange,
  startOfMonthKey,
  startOfWeekKey,
  startOfYearKey,
  streakStats,
} from "../src/lib/member-attendance"
import {
  addDaysToKey,
  dayKeyInTimeZone,
  daysBetweenKeys,
} from "../src/lib/memberships"
import { formatTimeInZone } from "../src/lib/format"

// "Today" used across the suite: 2026-10-20 (a Tuesday).
const TODAY = "2026-10-20"

// ---------------------------------------------------------------------------
// Day-key validity
// ---------------------------------------------------------------------------

test("isValidDayKey accepts strict YYYY-MM-DD and rejects everything else", () => {
  assert.equal(isValidDayKey("2026-10-20"), true)
  assert.equal(isValidDayKey(null), false)
  assert.equal(isValidDayKey(undefined), false)
  assert.equal(isValidDayKey("2026-10-2"), false)
  assert.equal(isValidDayKey("2026-13-01"), true) // shape only — we don't validate ranges
  assert.equal(isValidDayKey("hello"), false)
  assert.equal(isValidDayKey(""), false)
})

// ---------------------------------------------------------------------------
// Fixed-anchor weekday math (2026-09-18 is a Friday per the environment)
// ---------------------------------------------------------------------------

test("dayOfWeekForKey reports Sunday=0 .. Saturday=6", () => {
  assert.equal(dayOfWeekForKey("2026-09-18"), 5) // Friday
  assert.equal(dayOfWeekForKey("2026-09-21"), 1) // Monday
  assert.equal(dayOfWeekForKey("2026-09-20"), 0) // Sunday
})

test("startOfWeekKey returns the Monday of the containing ISO week", () => {
  assert.equal(startOfWeekKey("2026-09-18"), "2026-09-14") // mid-week → Monday
  assert.equal(startOfWeekKey("2026-09-21"), "2026-09-21") // already Monday
  assert.equal(startOfWeekKey("2026-09-20"), "2026-09-14") // Sunday → same week's Monday
})

// ---------------------------------------------------------------------------
// Month/year boundaries
// ---------------------------------------------------------------------------

test("startOfMonthKey / startOfYearKey normalise to the first day", () => {
  assert.equal(startOfMonthKey("2026-10-20"), "2026-10-01")
  assert.equal(startOfYearKey("2026-10-20"), "2026-01-01")
})

test("endOfMonthKey handles 30/31-day months and leap February", () => {
  assert.equal(endOfMonthKey("2026-09-15"), "2026-09-30")
  assert.equal(endOfMonthKey("2026-10-20"), "2026-10-31")
  assert.equal(endOfMonthKey("2026-02-05"), "2026-02-28")
  assert.equal(endOfMonthKey("2024-02-05"), "2024-02-29")
})

// ---------------------------------------------------------------------------
// Range presets
// ---------------------------------------------------------------------------

test("resolveAttendanceRange resolves TODAY to a single-day inclusive range", () => {
  assert.deepEqual(resolveAttendanceRange("TODAY", TODAY), {
    preset: "TODAY",
    fromKey: TODAY,
    toKey: TODAY,
  })
})

test("resolveAttendanceRange THIS_WEEK spans Monday..today inclusive", () => {
  const range = resolveAttendanceRange("THIS_WEEK", TODAY)
  assert.equal(range.preset, "THIS_WEEK")
  assert.equal(range.fromKey, "2026-10-19")
  assert.equal(range.toKey, TODAY)
})

test("resolveAttendanceRange THIS_MONTH spans month start..today inclusive", () => {
  const range = resolveAttendanceRange("THIS_MONTH", TODAY)
  assert.equal(range.fromKey, "2026-10-01")
  assert.equal(range.toKey, TODAY)
})

test("resolveAttendanceRange LAST_MONTH covers the full previous calendar month", () => {
  const range = resolveAttendanceRange("LAST_MONTH", TODAY)
  assert.equal(range.fromKey, "2026-09-01")
  assert.equal(range.toKey, "2026-09-30")
})

test("resolveAttendanceRange THIS_YEAR spans Jan 1..today inclusive", () => {
  const range = resolveAttendanceRange("THIS_YEAR", TODAY)
  assert.equal(range.fromKey, "2026-01-01")
  assert.equal(range.toKey, TODAY)
})

test("resolveAttendanceRange falls back to All Time for unknown preset", () => {
  assert.deepEqual(resolveAttendanceRange("NEXT_MONTH", TODAY), {
    preset: "ALL",
    fromKey: null,
    toKey: null,
  })
  assert.deepEqual(resolveAttendanceRange(undefined, TODAY), {
    preset: "ALL",
    fromKey: null,
    toKey: null,
  })
})

test("resolveAttendanceRange CUSTOM accepts a valid inclusive window", () => {
  assert.deepEqual(resolveAttendanceRange("CUSTOM", TODAY, "2026-08-01", "2026-09-30"), {
    preset: "CUSTOM",
    fromKey: "2026-08-01",
    toKey: "2026-09-30",
  })
})

test("resolveAttendanceRange CUSTOM falls back to All Time on inverted or invalid bounds", () => {
  assert.deepEqual(resolveAttendanceRange("CUSTOM", TODAY, "2026-10-01", "2026-09-01"), {
    preset: "ALL",
    fromKey: null,
    toKey: null,
  })
  assert.deepEqual(resolveAttendanceRange("CUSTOM", TODAY, "banana", "2026-09-30"), {
    preset: "ALL",
    fromKey: null,
    toKey: null,
  })
})

test("ATTENDANCE_RANGE_PRESETS covers the six nav presets in order", () => {
  assert.deepEqual(
    ATTENDANCE_RANGE_PRESETS.map((p) => p.id),
    ["TODAY", "THIS_WEEK", "THIS_MONTH", "LAST_MONTH", "THIS_YEAR", "ALL"]
  )
})

// ---------------------------------------------------------------------------
// Lifetime stats
// ---------------------------------------------------------------------------

test("computeLifetimeStats zero attendance returns all zeros", () => {
  const s = computeLifetimeStats([], TODAY)
  assert.deepEqual(s, {
    totalVisits: 0,
    distinctDays: 0,
    thisMonth: 0,
    thisYear: 0,
    avgPerWeek: 0,
    currentStreak: 0,
    longestStreak: 0,
  })
})

test("computeLifetimeStats counts a single day correctly", () => {
  const s = computeLifetimeStats(["2026-10-15"], TODAY)
  assert.equal(s.totalVisits, 1)
  assert.equal(s.distinctDays, 1)
  assert.equal(s.thisMonth, 1)
  assert.equal(s.thisYear, 1)
  assert.equal(s.avgPerWeek, 1) // weeks are min 1, so 1/1
  assert.equal(s.currentStreak, 0)
  assert.equal(s.longestStreak, 1)
})

test("computeLifetimeStats totalVisits counts duplicates but distinctDays de-dupes", () => {
  const s = computeLifetimeStats(
    ["2026-10-15", "2026-10-15", "2026-10-15", "2026-10-16"],
    TODAY
  )
  assert.equal(s.totalVisits, 4)
  assert.equal(s.distinctDays, 2)
})

test("computeLifetimeStats filters thisMonth/thisYear by the org's today key", () => {
  const s = computeLifetimeStats(["2026-09-30", "2026-10-01", "2025-12-31"], TODAY)
  assert.equal(s.thisMonth, 1)
  assert.equal(s.thisYear, 2)
  assert.equal(s.totalVisits, 3)
})

test("computeLifetimeStats weekly average divides days by weeks since first visit", () => {
  const days = addDaysToKey(TODAY, -6)
  const keys = []
  for (let k = days; k <= TODAY; k = addDaysToKey(k, 1)) keys.push(k)
  const s = computeLifetimeStats(keys, TODAY)
  assert.equal(s.distinctDays, 7)
  assert.equal(s.avgPerWeek, 7) // 7 days over exactly 1 week
  assert.equal(s.currentStreak, 7)
  assert.equal(s.longestStreak, 7)
})

test("streakStats current streak counts back from the anchor day", () => {
  const keys = ["2026-10-18", "2026-10-19", "2026-10-20"]
  assert.deepEqual(streakStats(keys, TODAY), { current: 3, longest: 3 })
})

test("streakStats current streak counts from yesterday when today not visited", () => {
  const keys = ["2026-10-18", "2026-10-19"]
  assert.deepEqual(streakStats(keys, TODAY), { current: 2, longest: 2 })
})

test("streakStats reports zero current streak after a gap", () => {
  const keys = ["2026-10-15", "2026-10-16", "2026-10-18"]
  assert.deepEqual(streakStats(keys, TODAY), { current: 0, longest: 2 })
})

test("streakStats longest streak survives out-of-order inputs", () => {
  const keys = ["2026-10-03", "2026-10-01", "2026-10-02"]
  assert.deepEqual(streakStats(keys, TODAY), { current: 0, longest: 3 })
})

// ---------------------------------------------------------------------------
// Range-scoped stats
// ---------------------------------------------------------------------------

test("computeRangeAttendance empty range yields zeros and null visit keys", () => {
  const s = computeRangeAttendance([], TODAY, "2026-10-01", "2026-10-31")
  assert.equal(s.visits, 0)
  assert.equal(s.firstVisitKey, null)
  assert.equal(s.lastVisitKey, null)
  assert.equal(s.avgPerWeek, 0)
  assert.equal(s.currentStreak, 0)
  assert.equal(s.longestStreak, 0)
})

test("computeRangeAttendance respects custom window bounds", () => {
  const keys = ["2026-09-15", "2026-10-01", "2026-10-10", "2026-10-30"]
  const s = computeRangeAttendance(keys, TODAY, "2026-10-01", "2026-10-20")
  assert.equal(s.visits, 2)
  assert.equal(s.distinctDays, 2)
  assert.equal(s.firstVisitKey, "2026-10-01")
  assert.equal(s.lastVisitKey, "2026-10-10")
  assert.equal(s.avgPerWeek, 0.7) // 2 visits over 20/7 ≈ 2.86 weeks
  assert.equal(s.currentStreak, 0)
  assert.equal(s.longestStreak, 1)
})

test("computeRangeAttendance unbounded range includes every day", () => {
  const keys = ["2025-01-05", "2026-10-19", "2026-10-20"]
  const s = computeRangeAttendance(keys, TODAY, null, null)
  assert.equal(s.visits, 3)
  assert.equal(s.firstVisitKey, "2025-01-05")
  assert.equal(s.lastVisitKey, "2026-10-20")
})

test("computeRangeAttendance current streak is anchored to the range end", () => {
  const keys = ["2026-10-10", "2026-10-11"]
  const s = computeRangeAttendance(keys, TODAY, "2026-10-09", "2026-10-11")
  assert.equal(s.visits, 2)
  assert.equal(s.currentStreak, 2) // anchored at toKey, both consecutive
})

// ---------------------------------------------------------------------------
// Trend aggregation
// ---------------------------------------------------------------------------

test("buildAttendanceTrend buckets short ranges weekly with Monday labels", () => {
  const keys = ["2026-10-05", "2026-10-06", "2026-10-19", "2026-10-20"]
  const trend = buildAttendanceTrend(keys, "2026-10-05", TODAY)
  const total = trend.reduce((sum, b) => sum + b.count, 0)
  assert.equal(total, 4)
  assert.ok(trend.length >= 1)
  assert.equal(trend[0].count, 2) // Oct 5..11
  assert.equal(trend[trend.length - 1].day, "19 Oct")
})

test("buildAttendanceTrend buckets long ranges monthly", () => {
  const keys = ["2026-01-15", "2026-03-02", "2026-10-01"]
  const trend = buildAttendanceTrend(keys, "2026-01-01", TODAY)
  const labels = trend.map((b) => b.day)
  assert.deepEqual(labels, [
    "Jan 26", "Feb 26", "Mar 26", "Apr 26",
    "May 26", "Jun 26", "Jul 26", "Aug 26",
    "Sep 26", "Oct 26",
  ])
  const counts = trend.map((b) => b.count).filter((c) => c > 0)
  assert.deepEqual(counts, [1, 1, 1])
})

test("buildAttendanceTrend caps buckets at maxPoints from the end", () => {
  const trend = buildAttendanceTrend([], "2020-01-01", "2026-12-31")
  assert.equal(trend.length, 36)
  assert.equal(trend[trend.length - 1].day, "Dec 26")
})

test("buildAttendanceTrend returns [] when there is no data or range is empty", () => {
  assert.deepEqual(buildAttendanceTrend([], null, null), [])
  assert.deepEqual(buildAttendanceTrend(["2026-10-05"], "2026-10-20", "2026-10-01"), [])
})

// ---------------------------------------------------------------------------
// Attendance calendar grids
// ---------------------------------------------------------------------------

test("buildAttendanceCalendar renders Monday-first grids with outside padding", () => {
  // 2026-09-01 is a Tuesday → one leading outside cell (Mon 2026-08-31).
  const months = buildAttendanceCalendar(["2026-09-03"], "2026-09-01", "2026-09-30")
  assert.equal(months.length, 1)
  assert.equal(months[0].label, "Sep 2026")
  const firstWeek = months[0].weeks[0]
  assert.equal(firstWeek.length, 7)
  assert.equal(firstWeek[0].key, "2026-08-31")
  assert.equal(firstWeek[0].outside, true)
  assert.equal(CALENDAR_WEEKDAY_HEADERS.length, 7)
})

test("buildAttendanceCalendar marks attended cells only inside the range", () => {
  const months = buildAttendanceCalendar(
    ["2026-09-03", "2026-09-25"],
    "2026-09-01",
    "2026-09-20"
  )
  const cells = months[0].weeks.flat()
  const sep3 = cells.find((c) => c.key === "2026-09-03")
  const sep25 = cells.find((c) => c.key === "2026-09-25")
  assert.ok(sep3)
  assert.ok(sep25)
  assert.equal(sep3.attended, true)
  assert.equal(sep3.inRange, true)
  // A September day outside the selected range is dimmed, not "attended".
  assert.equal(sep25.attended, false)
  assert.equal(sep25.inRange, false)
})

test("buildAttendanceCalendar collapses unbounded ranges to the attendance span", () => {
  const months = buildAttendanceCalendar(["2026-03-15"], null, null)
  assert.equal(months.length, 1)
  assert.equal(months[0].label, "Mar 2026")
})

test("buildAttendanceCalendar honours maxMonths", () => {
  const keys = ["2024-01-15", "2026-10-20"]
  const months = buildAttendanceCalendar(keys, null, null, 12)
  assert.equal(months.length, 12)
  assert.equal(months[0].label, "Jan 2024")
  assert.equal(months[11].label, "Dec 2024")
})

// ---------------------------------------------------------------------------
// Timezone safety (org calendar foundation used by the routes)
// ---------------------------------------------------------------------------

test("dayKeyInTimeZone never shifts a check-in across the org calendar", () => {
  // 00:00 IST on Jan 2 is still Jan 1, 18:30 UTC.
  assert.equal(dayKeyInTimeZone(new Date("2026-01-01T18:30:00Z"), "Asia/Kolkata"), "2026-01-02")
  assert.equal(dayKeyInTimeZone(new Date("2026-01-01T18:30:00Z"), "UTC"), "2026-01-01")
  assert.equal(dayKeyInTimeZone(new Date("2026-01-01T10:00:00Z"), "Asia/Kolkata"), "2026-01-01")
})

test("formatTimeInZone renders check-in time in the org timezone", () => {
  // 18:30Z is exactly midnight in Asia/Kolkata (UTC+5:30) → 12:00 AM.
  assert.equal(formatTimeInZone("2026-01-01T18:30:00Z", "Asia/Kolkata"), "12:00 AM")
})

// ---------------------------------------------------------------------------
// Cross-cutting invariants
// ---------------------------------------------------------------------------

test("day-key range math never crosses a month boundary", () => {
  for (const k of ["2026-01-31", "2026-02-28", "2026-04-30", "2026-12-31"]) {
    const month = Number(k.split("-")[1])
    const expectedLen = [4, 6, 9, 11].includes(month)
      ? 30
      : month === 2
        ? 28
        : 31
    assert.equal(daysBetweenKeys(startOfMonthKey(k), endOfMonthKey(k)) + 1, expectedLen)
    assert.equal(startOfMonthKey(k) <= k && k <= endOfMonthKey(k), true)
  }
})

test("a week of attendance then a gap reports streak and trend consistently", () => {
  const keys = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-20"]
  const s = computeRangeAttendance(keys, TODAY, null, null)
  assert.equal(s.visits, 6)
  assert.equal(s.longestStreak, 5)
  assert.equal(s.currentStreak, 1)
  const trend = buildAttendanceTrend(keys, null, null)
  assert.equal(trend.reduce((sum, b) => sum + b.count, 0), 6)
})