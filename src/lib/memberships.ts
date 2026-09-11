import type { MembershipStatus, Prisma, PrismaClient } from "@prisma/client"

/**
 * Membership date + overlap rules shared by server actions and UI.
 *
 * Period convention (preserved from the original implementation):
 * a membership period is [startDate, endDate], both inclusive.
 * endDate = startDate + durationDays calendar days.
 * Example: start 2026-10-01, duration 30 -> end 2026-10-31.
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
 * Derive the business lifecycle of a membership from its period and the DB
 * status, relative to "today" in the organization's timezone.
 *
 * `today` defaults to the current instant; pass an explicit Date in tests.
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

/**
 * The calendar day after a YYYY-MM-DD string (or the date-part of an ISO
 * string). Returns "" for invalid input. E.g. "2026-09-30" -> "2026-10-01".
 */
export function dayAfterYmd(ymd: string | null | undefined): string {
  const value = ymd ?? ""
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return ""
  const [, y, m, d] = match.map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + 1)
  return toYmd(date)
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

type PrismaMembership = PrismaClient | Prisma.TransactionClient

/**
 * Find an ACTIVE/PAUSED membership for the member whose period overlaps
 * [startDate, endDate]. Used to enforce "one active membership per period"
 * in the application layer now that the DB unique index is gone.
 */
export async function findOverlappingActiveMembership(
  client: PrismaMembership,
  organizationId: string,
  memberId: string,
  startDate: Date,
  endDate: Date
) {
  return client.membership.findFirst({
    where: {
      organizationId,
      memberId,
      status: { in: [...ACTIVE_MEMBERSHIP_STATUSES] },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      plan: { select: { name: true } },
    },
  })
}

/**
 * Choose the single membership that best represents a member's *current*
 * membership state ("one current/latest membership per member").
 *
 * Priority:
 *   1. a membership whose loop contains today (derived ACTIVE or EXPIRING_SOON)
 *   2. otherwise the most recent one by end date (then start date, then id)
 *
 * Historical records are never deleted — they simply aren't picked here and
 * remain reachable through the member's history view.
 */
export function pickPrimaryMembership<T extends MembershipLifecycleRecord>(
  rows: T[],
  timeZone: string,
  today?: Date
): { row: T; lifecycle: MembershipLifecycle } | null {
  if (rows.length === 0) return null

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
  return best ? { row: best.row, lifecycle: best.lifecycle } : null
}