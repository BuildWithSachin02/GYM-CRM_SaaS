import { format } from "date-fns"

/** Minor units (paise) per whole rupee. Money is stored as integer paise. */
export const MINOR_PER_RUPEE = 100

/** Convert an integer minor-unit (paise) amount to whole rupees. */
export function minorToRupees(amountMinor: number): number {
  return amountMinor / MINOR_PER_RUPEE
}

/**
 * Format a value that is ALREADY in rupees as Indian currency text.
 *
 * The single presentation rule for money: storage is paise; the only conversion
 * in the app is paise -> rupees at the chart/display boundary (minorToRupees),
 * and this formatter then renders the rupee value. It never converts paise, so
 * a raw paise amount can never be printed as if it were rupees.
 */
export function formatRupees(rupees: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(rupees)
}

/** Money is stored as integer minor units (paise). */
export function formatMoney(amountMinor: number, currency = "INR"): string {
  return formatRupees(minorToRupees(amountMinor), currency)
}

export function formatMoneyWithDecimal(amountMinor: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
  }).format(amountMinor / 100)
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—"
  return format(new Date(d), "dd MMM yyyy")
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—"
  return format(new Date(d), "dd MMM yyyy, h:mm a")
}

export function formatTime(d: Date | string | null | undefined): string {
  if (!d) return "—"
  return format(new Date(d), "h:mm a")
}

/**
 * Time-of-day rendered in a specific IANA timezone, so a check-in instant is
 * never shifted into the viewer's local clock. Used for attendance timestamps.
 */
export function formatTimeInZone(
  d: Date | string | null | undefined,
  timeZone: string
): string {
  if (!d) return "—"
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(d))
}

/**
 * Date + time rendered in a specific IANA timezone (see formatTimeInZone).
 */
export function formatDateTimeInZone(
  d: Date | string | null | undefined,
  timeZone: string
): string {
  if (!d) return "—"
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(d))
}

/**
 * Format a YYYY-MM-DD day key for display. Parses the components into a local
 * Date (avoids the `new Date("YYYY-MM-DD")` UTC shift) so the label reads the
 * same calendar day the key represents in the org's timezone.
 */
export function formatDayKey(key: string | null | undefined): string {
  if (!key) return "—"
  const [y, m, d] = key.split("-").map(Number)
  if (!y || !m || !d) return key
  return format(new Date(y, m - 1, d), "dd MMM yyyy")
}

const RANGE_MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

/**
 * Compact label for an inclusive report range expressed as org-timezone day
 * keys. Parses the components directly (no `new Date(ymd)` UTC shift) so the
 * label always reads the same calendar days the keys represent. The year is
 * shown only when the range crosses a year boundary:
 *   "01 Sep — 20 Sep"        (same year)
 *   "01 Sep 2026 — 20 Jan 2027" (crosses into a new year)
 */
export function formatRangeLabel(
  fromKey: string | null | undefined,
  toKey: string | null | undefined
): string {
  if (!fromKey || !toKey) return ""
  const from = fromKey.split("-").map(Number)
  const to = toKey.split("-").map(Number)
  if (from.length !== 3 || to.length !== 3 || from.some((n) => !Number.isFinite(n)) || to.some((n) => !Number.isFinite(n))) {
    return ""
  }
  const [y0, m0, d0] = from
  const [y1, m1, d1] = to
  if (
    m0 < 1 || m0 > 12 || d0 < 1 || d0 > 31 ||
    m1 < 1 || m1 > 12 || d1 < 1 || d1 > 31
  ) {
    return ""
  }
  const part0 = `${String(d0).padStart(2, "0")} ${RANGE_MONTH_LABELS[m0 - 1] ?? ""}`
  const part1 = `${String(d1).padStart(2, "0")} ${RANGE_MONTH_LABELS[m1 - 1] ?? ""}`
  if (y0 === y1) return `${part0} — ${part1}`
  return `${part0} ${y0} — ${part1} ${y1}`
}

export function dayKeyOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fullName(first: string, last: string): string {
  return `${first} ${last}`.trim()
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join("")
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`)
}