import { format } from "date-fns"

/** Money is stored as integer minor units (paise). */
export function formatMoney(amountMinor: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100)
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