import type { MembershipStatus, Prisma, PrismaClient } from "@prisma/client"

/**
 * Membership date + overlap rules shared by server actions and UI.
 *
 * Period convention (preserved from the original implementation):
 * a membership period is [startDate, endDate], both inclusive.
 * endDate = startDate + durationDays calendar days.
 * Example: start 2026-10-01, duration 30 -> end 2026-10-31.
 *
 * Periods are stored in the DB as the organization-timezone local midnight of
 * the start/end day (see utcInstantForKey), so day-granular math never drifts
 * across DST boundaries. The comparison unit everywhere is the calendar day
 * key (YYYY-MM-DD).
 */

export type MembershipLifecycleRecord = {
  id: string
  memberId: string
  startDate: Date
  endDate: Date
  status: MembershipStatus
}

export const ACTIVE_MEMBERSHIP_STATUSES = ["ACTIVE", "PAUSED"] as const

export type ActiveMembershipStatus = (typeof ACTIVE_MEMBERSHIP_STATUSES)[number]

// ---------------------------------------------------------------------------
// Lifecycle rules
//
// The DB stores a MembershipStatus enum (ACTIVE/EXPIRED/CANCELLED/PAUSED) set
// at write time. Business state, however, is derived from the membership
// period relative to "today" in the organization's timezone:
//
//   - UPCOMING     period starts in the future
//   - ACTIVE       today is inside [start, end] and more than
//                  RENEWAL_WARNING_DAYS before the end
//   - EXPIRING_SOON  ACTIVE and the end is within RENEWAL_WARNING_DAYS
//                  (a warning window, NOT an extension)
//   - EXPIRED      the end date has passed -> expired immediately
//   - CANCELLED / PAUSED  explicit user actions, keep their own label
//
// Periods are inclusive: end = start + durationDays calendar days, and the end
// day itself is still a valid (last) membership day. daysLeft is 0 on the last
// day; once the end date has passed the membership is EXPIRED.
//
// Member-level state goes further: a member's membership is the union of all
// their valid (non-CANCELLED, non-PAUSED) periods. Overlapping or back-to-back
// records merge into continuous coverage, so a member who was renewed mid-way
// (or holds multiple records) is ACTIVE through the FARTHEST valid end date
// rather than through whatever single record ends soonest.
// ---------------------------------------------------------------------------

/** Days before expiry during which an ACTIVE membership may be renewed. */
export const RENEWAL_WARNING_DAYS = 7

/**
 * Days after expiry before a renewal is allowed. 0 = renew immediately the
 * day after the period ends (memberships expire on their end date).
 */
export const RENEWAL_AFTER_EXPIRY_DAYS = 0

export type MembershipLifecycleStatus =
  | "UPCOMING"
  | "ACTIVE"
  | "EXPIRING_SOON"
  | "EXPIRED"
  | "CANCELLED"
  | "PAUSED"

export type MembershipLifecycle = {
  status: MembershipLifecycleStatus
  /** Calendar days left until the end date (0 on the last day). */
  daysLeft: number | null
  /** Calendar days until the start date (only meaningful for UPCOMING). */
  daysUntilStart: number | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Calendar day key (YYYY-MM-DD) for a Date in a given IANA time zone.
 * Deterministic and DST-safe because it reads the wall-clock time in the zone
 * instead of UTC fields.
 */
export function dayKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** Whole calendar days between two YYYY-MM-DD day keys (b - a). */
export function daysBetweenKeys(aYmd: string, bYmd: string): number {
  const [ya, ma, da] = aYmd.split("-").map(Number)
  const [yb, mb, db] = bYmd.split("-").map(Number)
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY_MS)
}

const LIFECYCLE_STATUSES: MembershipLifecycleStatus[] = [
  "UPCOMING",
  "ACTIVE",
  "EXPIRING_SOON",
  "EXPIRED",
  "CANCELLED",
  "PAUSED",
]

/** The presentation order used for tabs/counts (UPCOMING first). */
export const LIFECYCLE_STATUS_ORDER: ReadonlyArray<MembershipLifecycleStatus> =
  LIFECYCLE_STATUSES

/**
 * Derive the business lifecycle of a SINGLE membership from its period and the
 * DB status, relative to "today" in the organization's timezone.
 *
 * `today` defaults to the current instant; pass an explicit Date in tests.
 * NOTE: this is record-level. For the member's overall membership state use
 * getMemberCoverage + membershipCoverageStatus (see below).
 */
export function getMembershipLifecycle(input: {
  startDate: Date | string
  endDate: Date | string
  status: string
  timeZone: string
  today?: Date
}): MembershipLifecycle {
  const todayKey = dayKeyInTimeZone(input.today ?? new Date(), input.timeZone)
  const startKey = dayKeyInTimeZone(new Date(input.startDate), input.timeZone)
  const endKey = dayKeyInTimeZone(new Date(input.endDate), input.timeZone)

  if (input.status === "CANCELLED") {
    return { status: "CANCELLED", daysLeft: null, daysUntilStart: null }
  }
  if (input.status === "PAUSED") {
    return {
      status: "PAUSED",
      daysLeft: todayKey <= endKey ? daysBetweenKeys(todayKey, endKey) : 0,
      daysUntilStart: null,
    }
  }

  // Status no longer matters: today vs the period decides.
  if (todayKey > endKey) {
    return { status: "EXPIRED", daysLeft: 0, daysUntilStart: null }
  }
  if (todayKey < startKey) {
    return {
      status: "UPCOMING",
      daysLeft: null,
      daysUntilStart: daysBetweenKeys(todayKey, startKey),
    }
  }
  const daysLeft = daysBetweenKeys(todayKey, endKey)
  if (daysLeft <= RENEWAL_WARNING_DAYS) {
    return { status: "EXPIRING_SOON", daysLeft, daysUntilStart: null }
  }
  return { status: "ACTIVE", daysLeft, daysUntilStart: null }
}

/**
 * Can this membership be renewed through the normal renewal flow?
 * Only EXPIRED (immediately, per RENEWAL_AFTER_EXPIRY_DAYS) and ACTIVE
 * memberships inside the warning window qualify. UPCOMING/CANCELLED/PAUSED
 * memberships are excluded.
 */
export function canRenewLifecycle(status: MembershipLifecycleStatus): boolean {
  return status === "EXPIRED" || status === "EXPIRING_SOON"
}

/** End date for a period that starts on `startDate` and lasts `days` days. */
export function addDurationDays(startDate: Date, days: number): Date {
  const end = new Date(startDate)
  end.setDate(end.getDate() + days)
  return end
}

/**
 * Do two inclusive periods [aStart,aEnd] and [bStart,bEnd] overlap at all?
 * Adjacent periods (aEnd + 1 day = bStart) do NOT overlap.
 */
export function periodsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

/** Format a local calendar day as YYYY-MM-DD. */
function toYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Shift a YYYY-MM-DD (or ISO date-part) day key by calendar days. "" for invalid. */
export function addDaysToKey(ymd: string | null | undefined, days: number): string {
  const value = ymd ?? ""
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return ""
  const [, y, m, d] = match.map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  return toYmd(date)
}

/**
 * The calendar day after a YYYY-MM-DD string (or the date-part of an ISO
 * string). Returns "" for invalid input. E.g. "2026-09-30" -> "2026-10-01".
 */
export function dayAfterYmd(ymd: string | null | undefined): string {
  return addDaysToKey(ymd, 1)
}

/**
 * The calendar-day END key of a membership period that starts on `startKey`
 * (YYYY-MM-DD) and lasts `durationDays` days — the plan's own configured
 * duration, never a hard-coded 30/90/180/365.
 *
 * This is the exact convention membershipPeriodFromStart persists (end day =
 * start day + durationDays calendar days, both inclusive), so a UI preview
 * built with this helper always matches the period the server will actually
 * store. A renewal period starting the day after the previous coverage ends
 * therefore never overlaps that coverage.
 */
export function periodEndKey(startKey: string, durationDays: number): string {
  return addDaysToKey(startKey, durationDays)
}

/**
 * Earliest allowed renewal start day key for a renew-eligible membership:
 *   - EXPIRED -> today (RENEWAL_AFTER_EXPIRY_DAYS = 0, no grace period)
 *   - EXPIRING_SOON -> the day after the current end date (back-to-back,
 *     never overlapping the period being renewed)
 */
export function earliestRenewalStartKey(
  status: MembershipLifecycleStatus,
  endKey: string,
  todayKey: string
): string {
  if (status === "EXPIRED") return todayKey
  return dayAfterYmd(endKey)
}

/**
 * The instant on which a calendar day starts in the organization's timezone:
 * i.e. local midnight for yMd. The implementation lands on the right calendar
 * day first (probing the zone's wall clock), then subtracts the time-of-day to
 * reach 00:00:00.000. Used so periods are persisted as org-timezone local
 * midnights, which never drift across DST or negative-UTC-offset zones.
 */
export function utcInstantForKey(yMd: string, timeZone: string): Date {
  const [y, m, d] = yMd.split("-").map(Number)

  // Step 1: land on the right calendar day in the zone.
  let shifted = new Date(Date.UTC(y, m - 1, d))
  for (let i = 0; i < 4; i++) {
    const key = dayKeyInTimeZone(shifted, timeZone)
    if (key === yMd) break
    const diff = daysBetweenKeys(key, yMd)
    shifted = new Date(shifted.getTime() + diff * DAY_MS)
  }

  // Step 2: subtract the wall-clock time-of-day in the zone to reach midnight.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  }).formatToParts(shifted)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const timeOfDayMs =
    get("hour") * 3_600_000 + get("minute") * 60_000 + get("second") * 1000 +
    get("fractionalSecond")
  return new Date(shifted.getTime() - timeOfDayMs)
}

/**
 * DB instants for a period that starts (in the org's timezone) on the day of
 * `startDate` and lasts `durationDays` days. Both the start and the end are
 * returned as org-timezone local midnights so day-key math stays exact.
 */
export function membershipPeriodFromStart(
  startDate: Date,
  durationDays: number,
  timeZone: string
): { start: Date; end: Date } {
  const startKey = dayKeyInTimeZone(startDate, timeZone)
  const endKey = addDaysToKey(startKey, durationDays)
  return {
    start: utcInstantForKey(startKey, timeZone),
    end: utcInstantForKey(endKey, timeZone),
  }
}

/**
 * Do two calendar-day ranges overlap? Keys are lexicographically ordered
 * YYYY-MM-DD, so string comparison is safe. Fully timezone-exact: overlap is
 * decided on day keys, not instants, so records persisted under either the
 * legacy (UTC midnight) or the org-timezone-local-midnight convention
 * compare correctly.
 */
export function dayPeriodsOverlap(
  aStartKey: string,
  aEndKey: string,
  bStartKey: string,
  bEndKey: string
): boolean {
  return aStartKey <= bEndKey && bStartKey <= aEndKey
}

// ---------------------------------------------------------------------------
// Member-level coverage
// ---------------------------------------------------------------------------

export type MembershipCoverageInterval = {
  startKey: string
  endKey: string
}

/** Minimal membership shape needed for coverage math. */
export type MembershipCoverageRow = {
  id: string
  startDate: Date
  endDate: Date
  status: string
}

export type MemberCoverage = {
  todayKey: string
  /** Merged coverage intervals (contiguous or overlapping), sorted by startKey. */
  intervals: MembershipCoverageInterval[]
  /** True when todayKey falls inside a merged coverage interval. */
  coveredToday: boolean
  /** The merged interval containing todayKey (null when not covered today). */
  currentInterval: MembershipCoverageInterval | null
  /** First merged interval that starts strictly after todayKey (null when none). */
  upcomingInterval: MembershipCoverageInterval | null
  /** End key of the farthest coverage day across all valid records. */
  overallEndKey: string | null
}

/**
 * Merge inclusive day-key periods: two periods merge when they overlap OR sit
 * back-to-back (nextStartKey === day after prevEndKey). A 1+ day gap between
 * them keeps them as separate intervals.
 */
export function mergeMembershipPeriods(
  periods: readonly MembershipCoverageInterval[]
): MembershipCoverageInterval[] {
  const sorted = [...periods].sort(
    (a, b) =>
      a.startKey.localeCompare(b.startKey) || b.endKey.localeCompare(a.endKey)
  )
  const merged: MembershipCoverageInterval[] = []
  for (const p of sorted) {
    const last = merged[merged.length - 1]
    if (!last) {
      merged.push({ startKey: p.startKey, endKey: p.endKey })
      continue
    }
    if (p.startKey <= last.endKey || p.startKey === dayAfterYmd(last.endKey)) {
      if (p.endKey > last.endKey) last.endKey = p.endKey
    } else {
      merged.push({ startKey: p.startKey, endKey: p.endKey })
    }
  }
  return merged
}

/**
 * A member's membership coverage: the merged union of every valid period.
 * CANCELLED and PAUSED records never contribute coverage (their period may
 * have been paid for, but the member does not currently hold a valid slot on
 * those days). Past EXPIRED records keep contributing — they are part of the
 * continuous chain that ends at the member's farthest valid end date.
 */
export function getMemberCoverage(
  rows: readonly MembershipCoverageRow[],
  timeZone: string,
  todayKey: string
): MemberCoverage {
  const periods = rows
    .filter((r) => r.status !== "CANCELLED" && r.status !== "PAUSED")
    .map((r) => ({
      startKey: dayKeyInTimeZone(r.startDate, timeZone),
      endKey: dayKeyInTimeZone(r.endDate, timeZone),
    }))
  const intervals = mergeMembershipPeriods(periods)
  const currentInterval =
    intervals.find((iv) => iv.startKey <= todayKey && todayKey <= iv.endKey) ?? null
  const upcomingInterval = intervals.find((iv) => iv.startKey > todayKey) ?? null
  return {
    todayKey,
    intervals,
    coveredToday: currentInterval !== null,
    currentInterval,
    upcomingInterval,
    overallEndKey:
      intervals.length > 0 ? intervals[intervals.length - 1].endKey : null,
  }
}

/**
 * Member-level lifecycle derived from coverage:
 *   - covered today -> ACTIVE, or EXPIRING_SOON when the coverage end is within
 *     RENEWAL_WARNING_DAYS (driven by the FARTHEST coverage end, not by the
 *     soonest single record)
 *   - not covered today but a future interval exists -> UPCOMING
 *   - otherwise -> EXPIRED (and the fallback display in pickPrimaryMembership
 *     covers CANCELLED/PAUSED members)
 */
export function membershipCoverageStatus(
  coverage: MemberCoverage
): MembershipLifecycle {
  if (coverage.coveredToday && coverage.currentInterval) {
    const daysLeft = daysBetweenKeys(
      coverage.todayKey,
      coverage.currentInterval.endKey
    )
    return {
      status: daysLeft <= RENEWAL_WARNING_DAYS ? "EXPIRING_SOON" : "ACTIVE",
      daysLeft,
      daysUntilStart: null,
    }
  }
  if (coverage.upcomingInterval) {
    return {
      status: "UPCOMING",
      daysLeft: null,
      daysUntilStart: daysBetweenKeys(
        coverage.todayKey,
        coverage.upcomingInterval.startKey
      ),
    }
  }
  return { status: "EXPIRED", daysLeft: 0, daysUntilStart: null }
}

/**
 * Does the member genuinely need a renewal TODAY, based on their TOTAL
 * coverage?
 *
 * This is the canonical "show the Renew button" rule for the memberships list
 * and history views. It is a member-level decision, never a per-record one: a
 * member whose records chain back-to-back or overlap stays ACTIVE through the
 * FARTHEST valid end date, so they must NOT be offered a renewal even when one
 * historical record individually reads EXPIRED/EXPIRING_SOON. Only when the
 * member-level state is EXPIRED or EXPIRING_SOON (i.e. coverage has genuinely
 * ended or is ending soon with no replacement coverage) is a renewal offered.
 *
 * Members with no valid coverage at all (CANCELLED/PAUSED-only history) can
 * never be renewed through this flow — the owner uses "New Membership" instead.
 */
export function memberNeedsRenewal(
  rows: readonly MembershipCoverageRow[],
  timeZone: string,
  todayKey: string
): boolean {
  const hasValidCoverage = rows.some(
    (r) => r.status !== "CANCELLED" && r.status !== "PAUSED"
  )
  if (!hasValidCoverage) return false
  const coverage = getMemberCoverage(rows, timeZone, todayKey)
  return canRenewLifecycle(membershipCoverageStatus(coverage).status)
}

/**
 * The earliest day a NEW membership can start for this member without
 * overlapping anything the member already holds, and without breaking their
 * continuous coverage.
 *
 * Reservations are built from every non-CANCELLED record (PAUSED records block
 * overlaps just like the old ACTIVE/PAUSED overlap rule; the record being
 * renewed is intentionally kept in the reservation set).
 *
 * The result is never a date inside the member's existing coverage. Because a
 * renewal period is contiguous and its length depends on the plan picked, any
 * candidate that could run into a later reservation is unsafe: a start "in the
 * gap" before a future scheduled membership would overlap that membership for
 * a long-enough plan. So whenever the member still has coverage at or after
 * today, the earliest safe start is the day AFTER their farthest valid
 * coverage end. Only when every period ended in the past (a genuinely expired
 * member with no future coverage) does the renewal open from today.
 *
 * Computed server-side (org timezone) and passed to the client as the renewal
 * modal's default start; the server rejects any start earlier than this.
 */
export function nextValidRenewalStartKey(
  rows: readonly MembershipCoverageRow[],
  timeZone: string,
  todayKey: string
): string {
  const periods = rows
    .filter((r) => r.status !== "CANCELLED")
    .map((r) => ({
      startKey: dayKeyInTimeZone(r.startDate, timeZone),
      endKey: dayKeyInTimeZone(r.endDate, timeZone),
    }))
  const intervals = mergeMembershipPeriods(periods)
  if (intervals.length === 0) return todayKey
  const overallEndKey = intervals[intervals.length - 1].endKey
  if (todayKey <= overallEndKey) return dayAfterYmd(overallEndKey)
  return todayKey
}

type PrismaMembership = PrismaClient | Prisma.TransactionClient

/**
 * Find a non-CANCELLED membership for the member whose period overlaps
 * [startDate, endDate]. Used to enforce "one membership per period" in the
 * application layer now that the DB unique index is gone.
 *
 * The overlap is decided on calendar day keys (see dayPeriodsOverlap), so it
 * is exact regardless of the instant convention used to store the periods.
 * `excludeMembershipId` lets a renewal skip the record being renewed (its own
 * overlap is already blocked by the start-date gate).
 */
export async function findOverlappingActiveMembership(
  client: PrismaMembership,
  organizationId: string,
  memberId: string,
  startDate: Date,
  endDate: Date,
  timeZone: string,
  excludeMembershipId?: string
) {
  const startKey = dayKeyInTimeZone(startDate, timeZone)
  const endKey = dayKeyInTimeZone(endDate, timeZone)
  const candidates = await client.membership.findMany({
    where: {
      organizationId,
      memberId,
      status: { not: "CANCELLED" },
      ...(excludeMembershipId ? { id: { not: excludeMembershipId } } : {}),
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      plan: { select: { name: true } },
    },
  })
  return (
    candidates.find((m) =>
      dayPeriodsOverlap(
        startKey,
        endKey,
        dayKeyInTimeZone(m.startDate, timeZone),
        dayKeyInTimeZone(m.endDate, timeZone)
      )
    ) ?? null
  )
}

export type PickPrimaryMembershipResult<T extends MembershipLifecycleRecord> = {
  row: T
  lifecycle: MembershipLifecycle
  coverage: MemberCoverage
}

/**
 * Choose the single membership row that best represents a member's *current*
 * membership state ("one current/latest membership per member") together with
 * the member-level lifecycle and full coverage.
 *
 * Lifecycle/status is derived from COVERAGE (the union of all valid periods),
 * never from a single record: a member whose records chain back-to-back or
 * overlap stays ACTIVE until the farthest valid end date. The displayed row:
 *   - covered today -> the valid record containing today with the latest end
 *   - otherwise, future coverage -> the record that opens the next interval
 *   - all periods in the past -> the valid record with the latest end date
 *
 * When the member has no valid coverage at all (only CANCELLED/PAUSED/whatever
 * records), it falls back to the record-level ranking across ALL rows so those
 * memberships stay visible, preserving their own labels.
 *
 * Historical records are never deleted — they simply aren't picked here and
 * remain reachable through the member's history view.
 */
export function pickPrimaryMembership<T extends MembershipLifecycleRecord>(
  rows: T[],
  timeZone: string,
  today?: Date
): PickPrimaryMembershipResult<T> | null {
  if (rows.length === 0) return null

  const todayKey = dayKeyInTimeZone(today ?? new Date(), timeZone)
  const coverage = getMemberCoverage(rows, timeZone, todayKey)

  // No valid coverage: fall back to the record-level ranking across all rows.
  if (coverage.intervals.length === 0) {
    const scored = rows.map((row) => {
      const lifecycle = getMembershipLifecycle({
        startDate: row.startDate,
        endDate: row.endDate,
        status: row.status,
        timeZone,
        today,
      })
      const currentRank =
        lifecycle.status === "ACTIVE" || lifecycle.status === "EXPIRING_SOON"
          ? 1
          : 0
      return { row, lifecycle, currentRank }
    })
    scored.sort(
      (a, b) =>
        b.currentRank - a.currentRank ||
        b.row.endDate.getTime() - a.row.endDate.getTime() ||
        b.row.startDate.getTime() - a.row.startDate.getTime() ||
        a.row.id.localeCompare(b.row.id)
    )
    const best = scored[0]
    return best ? { row: best.row, lifecycle: best.lifecycle, coverage } : null
  }

  const lifecycle = membershipCoverageStatus(coverage)
  const isValid = (r: MembershipLifecycleRecord) =>
    r.status !== "CANCELLED" && r.status !== "PAUSED"
  const startKeyOf = (r: MembershipLifecycleRecord) =>
    dayKeyInTimeZone(r.startDate, timeZone)
  const endKeyOf = (r: MembershipLifecycleRecord) =>
    dayKeyInTimeZone(r.endDate, timeZone)

  const validRows = rows.filter(isValid)

  let displayRow: T | undefined
  if (coverage.coveredToday && coverage.currentInterval) {
    // The valid record containing today with the latest end (then latest start).
    displayRow = validRows
      .filter(
        (r) => startKeyOf(r) <= todayKey && todayKey <= endKeyOf(r)
      )
      .sort(
        (a, b) =>
          endKeyOf(b).localeCompare(endKeyOf(a)) ||
          startKeyOf(b).localeCompare(startKeyOf(a)) ||
          b.id.localeCompare(a.id)
      )[0] as T | undefined
  } else if (coverage.upcomingInterval) {
    // The record that opens the next (future) coverage interval.
    const intervalStart = coverage.upcomingInterval.startKey
    displayRow = validRows
      .filter((r) => startKeyOf(r) === intervalStart)
      .sort(
        (a, b) =>
          endKeyOf(b).localeCompare(endKeyOf(a)) ||
          b.id.localeCompare(a.id)
      )[0] as T | undefined
  }

  if (!displayRow) {
    // All coverage ended in the past (or a degenerate edge): show the valid
    // record with the latest end date.
    displayRow = [...validRows].sort(
      (a, b) =>
        endKeyOf(b).localeCompare(endKeyOf(a)) ||
        startKeyOf(b).localeCompare(startKeyOf(a)) ||
        b.id.localeCompare(a.id)
    )[0] as T | undefined
  }

  if (!displayRow) return null
  return { row: displayRow, lifecycle, coverage }
}