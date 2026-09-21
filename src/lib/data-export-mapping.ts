import type { DataCategoryKey } from "@/lib/data-catalog"
import { CATEGORY_META, sanitizeFileNamePart } from "@/lib/data-catalog"
import type { MemberFinancialSummaryRow } from "@/lib/data-financials"
import { minorToRupees } from "@/lib/format"
import { dayKeyInTimeZone, daysBetweenKeys } from "@/lib/memberships"

/**
 * Pure mapping from Prisma rows to Excel worksheet cells. No DB access, no
 * Excel dependency — unit-testable in isolation.
 *
 * When the workbook is written:
 *   - Column headers are human-readable (see EXPORT_COLUMNS).
 *   - Enums are exported as their stable, app-known codes (ACTIVE, CASH, ...).
 *   - Money is exported as decimal numbers (minor units / 100) with an
 *     "(INR)"-style header hint so it reconciles with the app's display rule.
 *   - Instants become Excel DATETIME cells whose wall clock is the
 *     ORGANIZATION timezone, so a check-in at 23:30 IST is never shifted into
 *     the viewer's clock and still sorts as a real date.
 *   - Calendar days become Excel DATE cells (org-local YYYY-MM-DD).
 *   - Secrets (passwordHash, tokenHash) and auth fields never appear here.
 */

export type DateCell =
  | { kind: "date"; value: Date } // org-local calendar day
  | { kind: "datetime"; value: Date } // org-timezone wall clock

export type ExcelCell = string | number | DateCell

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function dateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") }
}

/** "YYYY-MM-DD HH:MM:SS" in the org timezone (machine-readable, shift-proof). */
export function datetimeInZone(value: Date | string | null | undefined, timeZone: string): string {
  if (!value) return ""
  const d = new Date(value)
  const p = dateTimeParts(d, timeZone)
  const hour = p.hour === "24" ? "00" : p.hour
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second}`
}

/** "YYYY-MM-DD" (org-timezone calendar day) for date-only exports. */
export function dateKeyInZone(value: Date | string | null | undefined, timeZone: string): string {
  if (!value) return ""
  return dayKeyInTimeZone(new Date(value), timeZone)
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})/

/**
 * An Excel DATE cell for a YYYY-MM-DD org-calendar day. Built from the key's
 * components (UTC-labeled) so Excel displays the same calendar day the key
 * represents, independent of the viewer's timezone.
 */
export function dateCellFromKey(key: string | null | undefined): ExcelCell {
  const match = YMD.exec(key ?? "")
  if (!match) return ""
  return { kind: "date", value: new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])) } as DateCell
}

/**
 * An Excel DATETIME cell for an instant, whose wall clock is the org
 * timezone. The Date value is constructed from the org wall-clock components
 * (UTC-labeled), so Excel renders the org-local clock exactly.
 */
export function dateTimeCellInZone(value: Date | string | null | undefined, timeZone: string): ExcelCell {
  if (!value) return ""
  const d = new Date(value)
  const p = dateTimeParts(d, timeZone)
  const hour = p.hour === "24" ? "00" : p.hour
  return {
    kind: "datetime",
    value: new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute, +p.second)),
  } as DateCell
}

const empty = (v: ExcelCell | null | undefined): ExcelCell => v ?? ""

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

export type ColumnKind = "text" | "number" | "money" | "date" | "datetime"

export type ExportColumn = {
  header: string
  kind: ColumnKind
}

/**
 * Column kinds drive the workbook's number formats:
 *   money    → '#,##0.00'  (rupees, paise preserved to 2dp)
 *   number   → '#,##0'
 *   date     → 'yyyy-mm-dd'
 *   datetime → 'yyyy-mm-dd hh:mm:ss'
 */
export const COLUMN_NUMFMT: Record<ColumnKind, string | undefined> = {
  text: undefined,
  number: "#,##0",
  money: "#,##0.00",
  date: "yyyy-mm-dd",
  datetime: "yyyy-mm-dd hh:mm:ss",
}

// ---------------------------------------------------------------------------
// Row shapes (a deliberate subset of the Prisma rows — no secrets)
// ---------------------------------------------------------------------------

export type ExportRowMap = {
  members: {
    id: string
    firstName: string
    lastName: string
    phone: string
    email: string | null
    gender: string | null
    dateOfBirth: Date | null
    address: string | null
    emergencyContactName: string | null
    emergencyContactPhone: string | null
    signupSource: string | null
    status: string
    notes: string | null
    deletedAt: Date | null
    createdAt: Date
    updatedAt: Date
    trainer: { user: { name: string } } | null
    location: { name: string } | null
  }
  memberships: {
    id: string
    memberId: string
    planId: string
    status: string
    startDate: Date
    endDate: Date
    amountMinor: number
    renewsAutomatically: boolean
    notes: string | null
    createdAt: Date
    updatedAt: Date
    member: { firstName: string; lastName: string }
    plan: { name: string; priceMinor: number }
  }
  plans: {
    id: string
    name: string
    billingInterval: string
    priceMinor: number
    currency: string
    durationDays: number
    description: string | null
    active: boolean
    createdAt: Date
    updatedAt: Date
  }
  payments: {
    id: string
    memberId: string
    membershipId: string | null
    amountMinor: number
    currency: string
    paymentDate: Date
    method: string
    status: string
    reference: string | null
    notes: string | null
    createdAt: Date
    updatedAt: Date
    member: { firstName: string; lastName: string }
    membership: {
      id: string
      status: string
      startDate: Date
      endDate: Date
      plan: { id: string; name: string }
    } | null
    recordedBy: { name: string }
  }
  attendance: {
    id: string
    memberId: string
    dayKey: string
    checkedInAt: Date
    source: string
    member: { firstName: string; lastName: string }
    location: { name: string } | null
    qrSession: { id: string; label: string | null } | null
  }
  leads: {
    id: string
    name: string
    phone: string
    email: string | null
    source: string
    sourceDetail: string | null
    stage: string
    followUpDate: Date | null
    convertedAt: Date | null
    convertedMemberId: string | null
    notes: string | null
    deletedAt: Date | null
    createdAt: Date
    updatedAt: Date
    location: { name: string } | null
    interestedPlan: { name: string } | null
    ownerUser: { name: string } | null
    convertedMember: { firstName: string; lastName: string } | null
  }
  appointments: {
    id: string
    startsAt: Date
    endsAt: Date
    status: string
    notes: string | null
    createdAt: Date
    updatedAt: Date
    member: { id: string; firstName: string; lastName: string } | null
    lead: { id: string; name: string } | null
    trainer: { user: { name: string } } | null
    staff: { name: string } | null
    location: { name: string } | null
  }
  tasks: {
    id: string
    title: string
    description: string | null
    dueDate: Date
    status: string
    createdAt: Date
    updatedAt: Date
    assignee: { name: string } | null
    createdBy: { name: string } | null
    member: { id: string; firstName: string; lastName: string } | null
    lead: { id: string; name: string } | null
  }
  qrSessions: {
    id: string
    label: string | null
    expiresAt: Date
    revokedAt: Date | null
    createdAt: Date
    location: { name: string }
    createdBy: { name: string }
  }
  leadActivities: {
    id: string
    type: string
    body: string
    activityDate: Date
    createdAt: Date
    lead: { id: string; name: string }
    createdBy: { name: string } | null
  }
  trainers: {
    id: string
    user: { name: string; email: string; phone: string | null; role: string; status: string }
    bio: string | null
    /** JSON from Prisma (specialties array/object) — serialized for the cell. */
    specialties: unknown
    active: boolean
    createdAt: Date
    updatedAt: Date
    _count: { members: number }
  }
}

export type ExportRow<K extends DataCategoryKey> = ExportRowMap[K]

/** Union of every category's row shape (used by the batched exporter). */
export type AnyExportRow = ExportRowMap[DataCategoryKey]

// ---------------------------------------------------------------------------
// Sheet column catalogs (header + value kind)
// ---------------------------------------------------------------------------

export const EXPORT_COLUMNS: Record<DataCategoryKey, ExportColumn[]> = {
  members: [
    { header: "Member ID", kind: "text" },
    { header: "First Name", kind: "text" },
    { header: "Last Name", kind: "text" },
    { header: "Full Name", kind: "text" },
    { header: "Phone", kind: "text" },
    { header: "Email", kind: "text" },
    { header: "Gender", kind: "text" },
    { header: "Date of Birth", kind: "date" },
    { header: "Address", kind: "text" },
    { header: "Emergency Contact Name", kind: "text" },
    { header: "Emergency Contact Phone", kind: "text" },
    { header: "Trainer", kind: "text" },
    { header: "Primary Location", kind: "text" },
    { header: "Signup Source", kind: "text" },
    { header: "Status", kind: "text" },
    { header: "Notes", kind: "text" },
    { header: "Deleted At", kind: "datetime" },
    { header: "Created At", kind: "datetime" },
    { header: "Updated At", kind: "datetime" },
  ],
  memberships: [
    { header: "Membership ID", kind: "text" },
    { header: "Member ID", kind: "text" },
    { header: "Member Name", kind: "text" },
    { header: "Plan ID", kind: "text" },
    { header: "Plan Name", kind: "text" },
    { header: "Plan Price (INR)", kind: "money" },
    { header: "Start Date", kind: "date" },
    { header: "End Date", kind: "date" },
    { header: "Duration (Days)", kind: "number" },
    { header: "Status", kind: "text" },
    { header: "Amount (INR)", kind: "money" },
    { header: "Renews Automatically", kind: "text" },
    { header: "Notes", kind: "text" },
    { header: "Created At", kind: "datetime" },
    { header: "Updated At", kind: "datetime" },
  ],
  plans: [
    { header: "Plan ID", kind: "text" },
    { header: "Name", kind: "text" },
    { header: "Billing Interval", kind: "text" },
    { header: "Price (INR)", kind: "money" },
    { header: "Currency", kind: "text" },
    { header: "Duration (Days)", kind: "number" },
    { header: "Description", kind: "text" },
    { header: "Active", kind: "text" },
    { header: "Created At", kind: "datetime" },
    { header: "Updated At", kind: "datetime" },
  ],
  payments: [
    { header: "Payment ID", kind: "text" },
    { header: "Member ID", kind: "text" },
    { header: "Member Name", kind: "text" },
    { header: "Payment Date", kind: "datetime" },
    { header: "Amount (INR)", kind: "money" },
    { header: "Currency", kind: "text" },
    { header: "Payment Method", kind: "text" },
    { header: "Payment Status", kind: "text" },
    { header: "Membership ID", kind: "text" },
    { header: "Membership Plan", kind: "text" },
    { header: "Plan ID", kind: "text" },
    { header: "Membership Start Date", kind: "date" },
    { header: "Membership End Date", kind: "date" },
    { header: "Reference / Transaction ID", kind: "text" },
    { header: "Notes", kind: "text" },
    { header: "Recorded By", kind: "text" },
    { header: "Created At", kind: "datetime" },
    { header: "Updated At", kind: "datetime" },
  ],
  attendance: [
    { header: "Check-in ID", kind: "text" },
    { header: "Member ID", kind: "text" },
    { header: "Member Name", kind: "text" },
    { header: "Date", kind: "date" },
    { header: "Checked In At", kind: "datetime" },
    { header: "Location", kind: "text" },
    { header: "Source", kind: "text" },
    { header: "QR Session", kind: "text" },
    { header: "QR Session ID", kind: "text" },
  ],
  leads: [
    { header: "Lead ID", kind: "text" },
    { header: "Name", kind: "text" },
    { header: "Phone", kind: "text" },
    { header: "Email", kind: "text" },
    { header: "Source", kind: "text" },
    { header: "Source Detail", kind: "text" },
    { header: "Stage", kind: "text" },
    { header: "Interested Plan", kind: "text" },
    { header: "Owner", kind: "text" },
    { header: "Follow-up Date", kind: "datetime" },
    { header: "Converted At", kind: "datetime" },
    { header: "Converted Member ID", kind: "text" },
    { header: "Converted Member", kind: "text" },
    { header: "Location", kind: "text" },
    { header: "Notes", kind: "text" },
    { header: "Deleted At", kind: "datetime" },
    { header: "Created At", kind: "datetime" },
    { header: "Updated At", kind: "datetime" },
  ],
  appointments: [
    { header: "Appointment ID", kind: "text" },
    { header: "Member ID", kind: "text" },
    { header: "Member Name", kind: "text" },
    { header: "Lead ID", kind: "text" },
    { header: "Lead Name", kind: "text" },
    { header: "Trainer", kind: "text" },
    { header: "Staff", kind: "text" },
    { header: "Starts At", kind: "datetime" },
    { header: "Ends At", kind: "datetime" },
    { header: "Status", kind: "text" },
    { header: "Location", kind: "text" },
    { header: "Notes", kind: "text" },
    { header: "Created At", kind: "datetime" },
    { header: "Updated At", kind: "datetime" },
  ],
  tasks: [
    { header: "Task ID", kind: "text" },
    { header: "Title", kind: "text" },
    { header: "Description", kind: "text" },
    { header: "Due Date", kind: "datetime" },
    { header: "Status", kind: "text" },
    { header: "Assignee", kind: "text" },
    { header: "Created By", kind: "text" },
    { header: "Member ID", kind: "text" },
    { header: "Member Name", kind: "text" },
    { header: "Lead ID", kind: "text" },
    { header: "Lead Name", kind: "text" },
    { header: "Created At", kind: "datetime" },
    { header: "Updated At", kind: "datetime" },
  ],
  qrSessions: [
    { header: "QR Session ID", kind: "text" },
    { header: "Label", kind: "text" },
    { header: "Location", kind: "text" },
    { header: "Expires At", kind: "datetime" },
    { header: "Revoked At", kind: "datetime" },
    { header: "Created By", kind: "text" },
    { header: "Created At", kind: "datetime" },
  ],
  leadActivities: [
    { header: "Activity ID", kind: "text" },
    { header: "Lead ID", kind: "text" },
    { header: "Lead Name", kind: "text" },
    { header: "Type", kind: "text" },
    { header: "Body", kind: "text" },
    { header: "Created By", kind: "text" },
    { header: "Activity Date", kind: "datetime" },
    { header: "Created At", kind: "datetime" },
  ],
  trainers: [
    { header: "Trainer ID", kind: "text" },
    { header: "Name", kind: "text" },
    { header: "Email", kind: "text" },
    { header: "Phone", kind: "text" },
    { header: "Role", kind: "text" },
    { header: "User Status", kind: "text" },
    { header: "Bio", kind: "text" },
    { header: "Specialties", kind: "text" },
    { header: "Active", kind: "text" },
    { header: "Members Assigned", kind: "number" },
    { header: "Created At", kind: "datetime" },
    { header: "Updated At", kind: "datetime" },
  ],
}

/** Column catalog for the derived Member Financial Summary worksheet. */
export const FINANCIAL_SUMMARY_COLUMNS: ExportColumn[] = [
  { header: "Member ID", kind: "text" },
  { header: "Member Name", kind: "text" },
  { header: "Current Membership", kind: "text" },
  { header: "Membership Status", kind: "text" },
  { header: "Start Date", kind: "date" },
  { header: "End Date", kind: "date" },
  { header: "Total Membership Value (INR)", kind: "money" },
  { header: "Total Paid (INR)", kind: "money" },
  { header: "Payment Count", kind: "number" },
  { header: "Latest Payment Amount (INR)", kind: "money" },
  { header: "Latest Payment Date", kind: "date" },
  { header: "Payment Methods Used", kind: "text" },
]

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function fullNameRow(member: { firstName: string; lastName: string }): string {
  return `${member.firstName} ${member.lastName}`.trim()
}

function mapMembersRow(row: ExportRowMap["members"], timeZone: string): ExcelCell[] {
  return [
    empty(row.id),
    empty(row.firstName),
    empty(row.lastName),
    fullNameRow(row),
    empty(row.phone),
    empty(row.email),
    row.gender ?? "",
    dateCellFromKey(dateKeyInZone(row.dateOfBirth, timeZone)),
    empty(row.address),
    empty(row.emergencyContactName),
    empty(row.emergencyContactPhone),
    empty(row.trainer?.user.name),
    empty(row.location?.name),
    row.signupSource ?? "",
    row.status,
    empty(row.notes),
    dateTimeCellInZone(row.deletedAt, timeZone),
    dateTimeCellInZone(row.createdAt, timeZone),
    dateTimeCellInZone(row.updatedAt, timeZone),
  ]
}

function mapMembershipsRow(row: ExportRowMap["memberships"], timeZone: string): ExcelCell[] {
  const startKey = dateKeyInZone(row.startDate, timeZone)
  const endKey = dateKeyInZone(row.endDate, timeZone)
  return [
    empty(row.id),
    empty(row.memberId),
    fullNameRow(row.member),
    empty(row.planId),
    empty(row.plan.name),
    minorToRupees(row.plan.priceMinor),
    dateCellFromKey(startKey),
    dateCellFromKey(endKey),
    startKey && endKey ? daysBetweenKeys(startKey, endKey) : "",
    row.status,
    minorToRupees(row.amountMinor),
    row.renewsAutomatically ? "Yes" : "No",
    empty(row.notes),
    dateTimeCellInZone(row.createdAt, timeZone),
    dateTimeCellInZone(row.updatedAt, timeZone),
  ]
}

function mapPlansRow(row: ExportRowMap["plans"], timeZone: string): ExcelCell[] {
  return [
    empty(row.id),
    empty(row.name),
    row.billingInterval,
    minorToRupees(row.priceMinor),
    row.currency,
    row.durationDays,
    empty(row.description),
    row.active ? "Yes" : "No",
    dateTimeCellInZone(row.createdAt, timeZone),
    dateTimeCellInZone(row.updatedAt, timeZone),
  ]
}

function mapPaymentsRow(row: ExportRowMap["payments"], timeZone: string): ExcelCell[] {
  return [
    empty(row.id),
    empty(row.memberId),
    fullNameRow(row.member),
    dateTimeCellInZone(row.paymentDate, timeZone),
    minorToRupees(row.amountMinor),
    row.currency,
    row.method,
    row.status,
    empty(row.membershipId),
    empty(row.membership?.plan.name),
    empty(row.membership?.plan.id),
    dateCellFromKey(row.membership ? dateKeyInZone(row.membership.startDate, timeZone) : ""),
    dateCellFromKey(row.membership ? dateKeyInZone(row.membership.endDate, timeZone) : ""),
    empty(row.reference),
    empty(row.notes),
    empty(row.recordedBy.name),
    dateTimeCellInZone(row.createdAt, timeZone),
    dateTimeCellInZone(row.updatedAt, timeZone),
  ]
}

function mapAttendanceRow(row: ExportRowMap["attendance"], timeZone: string): ExcelCell[] {
  return [
    empty(row.id),
    empty(row.memberId),
    fullNameRow(row.member),
    dateCellFromKey(row.dayKey),
    dateTimeCellInZone(row.checkedInAt, timeZone),
    empty(row.location?.name),
    row.source,
    empty(row.qrSession?.label),
    empty(row.qrSession?.id),
  ]
}

function mapLeadsRow(row: ExportRowMap["leads"], timeZone: string): ExcelCell[] {
  return [
    empty(row.id),
    empty(row.name),
    empty(row.phone),
    empty(row.email),
    row.source,
    empty(row.sourceDetail),
    row.stage,
    empty(row.interestedPlan?.name),
    empty(row.ownerUser?.name),
    dateTimeCellInZone(row.followUpDate, timeZone),
    dateTimeCellInZone(row.convertedAt, timeZone),
    empty(row.convertedMemberId),
    row.convertedMember ? fullNameRow(row.convertedMember) : "",
    empty(row.location?.name),
    empty(row.notes),
    dateTimeCellInZone(row.deletedAt, timeZone),
    dateTimeCellInZone(row.createdAt, timeZone),
    dateTimeCellInZone(row.updatedAt, timeZone),
  ]
}

function mapAppointmentsRow(row: ExportRowMap["appointments"], timeZone: string): ExcelCell[] {
  return [
    empty(row.id),
    empty(row.member?.id),
    row.member ? fullNameRow(row.member) : "",
    empty(row.lead?.id),
    empty(row.lead?.name),
    empty(row.trainer?.user.name),
    empty(row.staff?.name),
    dateTimeCellInZone(row.startsAt, timeZone),
    dateTimeCellInZone(row.endsAt, timeZone),
    row.status,
    empty(row.location?.name),
    empty(row.notes),
    dateTimeCellInZone(row.createdAt, timeZone),
    dateTimeCellInZone(row.updatedAt, timeZone),
  ]
}

function mapTasksRow(row: ExportRowMap["tasks"], timeZone: string): ExcelCell[] {
  return [
    empty(row.id),
    empty(row.title),
    empty(row.description),
    dateTimeCellInZone(row.dueDate, timeZone),
    row.status,
    empty(row.assignee?.name),
    empty(row.createdBy?.name),
    empty(row.member?.id),
    row.member ? fullNameRow(row.member) : "",
    empty(row.lead?.id),
    empty(row.lead?.name),
    dateTimeCellInZone(row.createdAt, timeZone),
    dateTimeCellInZone(row.updatedAt, timeZone),
  ]
}

function mapQrSessionsRow(row: ExportRowMap["qrSessions"], timeZone: string): ExcelCell[] {
  return [
    empty(row.id),
    empty(row.label),
    empty(row.location.name),
    dateTimeCellInZone(row.expiresAt, timeZone),
    dateTimeCellInZone(row.revokedAt, timeZone),
    empty(row.createdBy.name),
    dateTimeCellInZone(row.createdAt, timeZone),
  ]
}

function mapLeadActivitiesRow(row: ExportRowMap["leadActivities"], timeZone: string): ExcelCell[] {
  return [
    empty(row.id),
    empty(row.lead.id),
    empty(row.lead.name),
    row.type,
    empty(row.body),
    empty(row.createdBy?.name),
    dateTimeCellInZone(row.activityDate, timeZone),
    dateTimeCellInZone(row.createdAt, timeZone),
  ]
}

function mapTrainersRow(row: ExportRowMap["trainers"], timeZone: string): ExcelCell[] {
  return [
    empty(row.id),
    empty(row.user.name),
    empty(row.user.email),
    empty(row.user.phone),
    row.user.role,
    row.user.status,
    empty(row.bio),
    row.specialties != null ? JSON.stringify(row.specialties) : "",
    row.active ? "Yes" : "No",
    row._count.members,
    dateTimeCellInZone(row.createdAt, timeZone),
    dateTimeCellInZone(row.updatedAt, timeZone),
  ]
}

/**
 * Map a fetched row to its Excel cells, aligned with EXPORT_COLUMNS[key].
 */
export function mapExportRow(
  key: DataCategoryKey,
  row: AnyExportRow,
  timeZone: string
): ExcelCell[] {
  switch (key) {
    case "members":
      return mapMembersRow(row as ExportRowMap["members"], timeZone)
    case "memberships":
      return mapMembershipsRow(row as ExportRowMap["memberships"], timeZone)
    case "plans":
      return mapPlansRow(row as ExportRowMap["plans"], timeZone)
    case "payments":
      return mapPaymentsRow(row as ExportRowMap["payments"], timeZone)
    case "attendance":
      return mapAttendanceRow(row as ExportRowMap["attendance"], timeZone)
    case "leads":
      return mapLeadsRow(row as ExportRowMap["leads"], timeZone)
    case "appointments":
      return mapAppointmentsRow(row as ExportRowMap["appointments"], timeZone)
    case "tasks":
      return mapTasksRow(row as ExportRowMap["tasks"], timeZone)
    case "qrSessions":
      return mapQrSessionsRow(row as ExportRowMap["qrSessions"], timeZone)
    case "leadActivities":
      return mapLeadActivitiesRow(row as ExportRowMap["leadActivities"], timeZone)
    case "trainers":
      return mapTrainersRow(row as ExportRowMap["trainers"], timeZone)
  }
}

/** Map a derived member financial row to cells aligned with FINANCIAL_SUMMARY_COLUMNS. */
export function mapFinancialSummaryRow(row: MemberFinancialSummaryRow): ExcelCell[] {
  return [
    empty(row.memberId),
    empty(row.memberName),
    empty(row.currentPlan),
    row.currentStatus,
    dateCellFromKey(row.currentStartKey),
    dateCellFromKey(row.currentEndKey),
    minorToRupees(row.totalMembershipValueMinor),
    minorToRupees(row.totalPaidMinor),
    row.paymentCount,
    row.latestPaymentMinor != null ? minorToRupees(row.latestPaymentMinor) : "",
    dateCellFromKey(row.latestPaymentKey),
    row.methods.join(", "),
  ]
}

// ---------------------------------------------------------------------------
// Summary sheet rows
// ---------------------------------------------------------------------------

export type SummaryCounts = {
  members: { active: number; inactive: number; archived: number }
  memberships: { active: number; expired: number; cancelled: number; paused: number }
  payments: { recorded: number; voided: number; refunded: number }
  /** Sum of amountMinor across RECORDED payments only (the revenue rule). */
  collectedMinor: number
  plans: number
  attendance: number
  leads: number
  convertedLeads: number
  appointments: number
  tasks: number
  qrSessions: number
  leadActivities: number
  trainers: number
}

export type SummaryRow = {
  metric: string
  value: string | number
  /** True when `value` is rupees and should render as money. */
  money?: boolean
}

export type SummaryInput = {
  gymName: string
  timeZone: string
  generatedAt: Date
  rangeLabel: string
  counts: SummaryCounts
  /** Categories the summary should report. Omit to report every module. */
  selectedCategories?: readonly DataCategoryKey[]
  /** False → omit the Export Information header rows (used for "Business Overview"). */
  includeHeader?: boolean
}

/** Build the key/value rows rendered on the Summary worksheet. */
export function buildSummaryRows(input: SummaryInput): SummaryRow[] {
  const c = input.counts
  const isSelected = (key: DataCategoryKey) =>
    !input.selectedCategories || input.selectedCategories.includes(key)
  const memberTotal = c.members.active + c.members.inactive + c.members.archived
  const membershipTotal =
    c.memberships.active + c.memberships.expired + c.memberships.cancelled + c.memberships.paused
  const paymentTotal = c.payments.recorded + c.payments.voided + c.payments.refunded

  const rows: SummaryRow[] = []

  if (input.includeHeader !== false) {
    rows.push(
      { metric: "Gym", value: input.gymName },
      { metric: "Export generated at", value: datetimeInZone(input.generatedAt, input.timeZone) },
      { metric: "Date range", value: input.rangeLabel },
      { metric: "Timezone", value: input.timeZone },
      { metric: "", value: "" }
    )
  }

  if (isSelected("members")) {
    rows.push(
      { metric: "Members", value: memberTotal },
      { metric: "  Active members", value: c.members.active },
      { metric: "  Inactive members", value: c.members.inactive },
      { metric: "  Archived members", value: c.members.archived }
    )
  }

  if (isSelected("memberships")) {
    rows.push(
      { metric: "Memberships", value: membershipTotal },
      { metric: "  Active", value: c.memberships.active },
      { metric: "  Expired", value: c.memberships.expired },
      { metric: "  Cancelled", value: c.memberships.cancelled },
      { metric: "  Paused", value: c.memberships.paused }
    )
  }

  if (isSelected("payments")) {
    rows.push(
      { metric: "Payment transactions", value: paymentTotal },
      { metric: "  Recorded", value: c.payments.recorded },
      { metric: "  Voided", value: c.payments.voided },
      { metric: "  Refunded", value: c.payments.refunded },
      { metric: "Amount collected (INR)", value: minorToRupees(c.collectedMinor), money: true },
      {
        metric: "Note",
        value:
          "Amount collected = RECORDED payments only (VOIDED/REFUNDED excluded). Membership prices are not revenue.",
      }
    )
  }

  if (isSelected("plans")) rows.push({ metric: "Membership plans", value: c.plans })
  if (isSelected("attendance")) rows.push({ metric: "Attendance check-ins", value: c.attendance })
  if (isSelected("leads")) {
    rows.push(
      { metric: "Leads", value: c.leads },
      { metric: "  Converted leads", value: c.convertedLeads }
    )
  }
  if (isSelected("appointments")) rows.push({ metric: "Appointments", value: c.appointments })
  if (isSelected("tasks")) rows.push({ metric: "Tasks", value: c.tasks })
  if (isSelected("qrSessions")) rows.push({ metric: "QR sessions", value: c.qrSessions })
  if (isSelected("leadActivities")) rows.push({ metric: "Lead activities", value: c.leadActivities })
  if (isSelected("trainers")) rows.push({ metric: "Trainers", value: c.trainers })

  return rows
}

// ---------------------------------------------------------------------------
// Clickable module index (Summary section 2)
// ---------------------------------------------------------------------------

/** One row of the Summary's clickable module index. */
export type ModuleIndexItem = {
  /** Worksheet title the row links to (Excel-safe). */
  sheetName: string
  /** Display label (e.g. "Members"). */
  label: string
  /** Total data rows written to that sheet (reconciled with the sheet itself). */
  count: number
  description: string
}

export const MODULE_DESCRIPTIONS: Record<DataCategoryKey, string> = {
  members: "Member profiles, contact details, trainer assignment and status.",
  memberships: "Full membership history — every renewal/plan period, price and status.",
  plans: "Membership plan catalogue with billing interval and price.",
  payments: "Every payment transaction with method, status and associated plan.",
  attendance: "All check-ins for the selected range with source and QR session.",
  leads: "Lead pipeline with source, stage, owner and conversion details.",
  appointments: "Scheduled appointments for members and leads.",
  tasks: "Follow-up and CRM tasks with assignment and status.",
  qrSessions: "QR check-in session windows and their status.",
  leadActivities: "Timeline of every lead interaction by staff.",
  trainers: "Trainer staff profiles (safe fields only — no credentials).",
}

export const MEMBER_FINANCIAL_DESCRIPTION =
  "One row per financially-active member: membership value, paid total, payment count and methods."

/**
 * Build the module index shown on the Summary worksheet from the sheets that
 * were actually written. Counts come from the real sheet rows, so the index
 * always reconciles with the detail sheets.
 */
export function buildModuleIndexRows(
  keys: DataCategoryKey[],
  counts: Array<number>
): ModuleIndexItem[] {
  return keys.map((key, index) => ({
    sheetName: CATEGORY_META[key].label.slice(0, 31),
    label: CATEGORY_META[key].label,
    count: counts[index],
    description: MODULE_DESCRIPTIONS[key],
  }))
}

// ---------------------------------------------------------------------------
// Workbook filename
// ---------------------------------------------------------------------------

/** "GymCRM-Export-{gym-name}-{YYYY-MM-DD}.xlsx" with a sanitized gym name. */
export function exportWorkbookFilename(
  gymName: string | null | undefined,
  timeZone: string,
  now: Date = new Date()
): string {
  const day = dayKeyInTimeZone(now, timeZone)
  return `GymCRM-Export-${sanitizeFileNamePart(gymName)}-${day}.xlsx`
}