import type { Prisma, PrismaClient } from "@prisma/client"

/**
 * Membership date + overlap rules shared by server actions and UI.
 *
 * Period convention (preserved from the original implementation):
 * a membership period is [startDate, endDate], both inclusive.
 * endDate = startDate + durationDays calendar days.
 * Example: start 2026-10-01, duration 30 -> end 2026-10-31.
 */

export const ACTIVE_MEMBERSHIP_STATUSES = ["ACTIVE", "PAUSED"] as const

export type ActiveMembershipStatus = (typeof ACTIVE_MEMBERSHIP_STATUSES)[number]

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