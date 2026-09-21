import type { Prisma } from "@prisma/client"

import { addDaysToKey, utcInstantForKey } from "@/lib/memberships"

/**
 * Data catalog for the gym/branch business-data export + reset features.
 *
 * This module is PURE (no DB access) so it can be unit-tested exactly like the
 * rest of the domain layer. It is the single source of truth for:
 *   - which business categories exist (members, memberships, plans, payments,
 *     attendance, leads, appointments, tasks, QR sessions, lead activities),
 *   - the DB field each category is filtered by for a date range,
 *   - the dependency graph used to delete records in referential-safe order,
 *   - the reset confirmation phrase.
 *
 * Everything in here is tenant-agnostic: the caller MUST pass the
 * organizationId resolved from the authenticated session. No client-supplied
 * id ever enters these functions except the validated category keys and the
 * date range.
 */

export type DataCategoryKey =
  | "members"
  | "memberships"
  | "plans"
  | "payments"
  | "attendance"
  | "leads"
  | "appointments"
  | "tasks"
  | "qrSessions"
  | "leadActivities"
  | "trainers"

export type DataModelName =
  | "member"
  | "membership"
  | "membershipPlan"
  | "payment"
  | "checkIn"
  | "lead"
  | "appointment"
  | "task"
  | "qrSession"
  | "leadActivity"
  | "trainer"

export type DateKind = "instant" | "dayKey"

export type DataCategoryMeta = {
  key: DataCategoryKey
  /** Plural display label used in the UI and Excel sheet titles. */
  label: string
  /** Singular display label (used in confirmation copy). */
  singularLabel: string
  /** Prisma model delegate name. */
  modelName: DataModelName
  /** DB field used for date range filtering. */
  dateField: string
  /** Human-readable date field label. */
  dateFieldLabel: string
  dateKind: DateKind
  /** Can this category be independently selected for a reset? */
  resetSelectable: boolean
}

export const CATEGORY_META: Record<DataCategoryKey, DataCategoryMeta> = {
  members: {
    key: "members",
    label: "Members",
    singularLabel: "Member",
    modelName: "member",
    dateField: "createdAt",
    dateFieldLabel: "Created On",
    dateKind: "instant",
    resetSelectable: true,
  },
  memberships: {
    key: "memberships",
    label: "Memberships",
    singularLabel: "Membership",
    modelName: "membership",
    // Business date for a membership: the start of the purchased period.
    dateField: "startDate",
    dateFieldLabel: "Start Date",
    dateKind: "instant",
    resetSelectable: true,
  },
  plans: {
    key: "plans",
    label: "Plans",
    singularLabel: "Plan",
    modelName: "membershipPlan",
    dateField: "createdAt",
    dateFieldLabel: "Created On",
    dateKind: "instant",
    resetSelectable: true,
  },
  payments: {
    key: "payments",
    label: "Payments",
    singularLabel: "Payment",
    modelName: "payment",
    dateField: "paymentDate",
    dateFieldLabel: "Payment Date",
    dateKind: "instant",
    resetSelectable: true,
  },
  attendance: {
    key: "attendance",
    label: "Attendance",
    singularLabel: "Attendance record",
    modelName: "checkIn",
    // Check-ins are keyed by the org-timezone calendar day (YYYY-MM-DD).
    dateField: "dayKey",
    dateFieldLabel: "Check-in Date",
    dateKind: "dayKey",
    resetSelectable: true,
  },
  leads: {
    key: "leads",
    label: "Leads",
    singularLabel: "Lead",
    modelName: "lead",
    dateField: "createdAt",
    dateFieldLabel: "Created On",
    dateKind: "instant",
    resetSelectable: true,
  },
  appointments: {
    key: "appointments",
    label: "Appointments",
    singularLabel: "Appointment",
    modelName: "appointment",
    dateField: "startsAt",
    dateFieldLabel: "Starts At",
    dateKind: "instant",
    resetSelectable: true,
  },
  tasks: {
    key: "tasks",
    label: "Tasks",
    singularLabel: "Task",
    modelName: "task",
    dateField: "createdAt",
    dateFieldLabel: "Created On",
    dateKind: "instant",
    resetSelectable: true,
  },
  qrSessions: {
    key: "qrSessions",
    label: "QR Sessions",
    singularLabel: "QR Session",
    modelName: "qrSession",
    dateField: "createdAt",
    dateFieldLabel: "Created On",
    dateKind: "instant",
    resetSelectable: true,
  },
  leadActivities: {
    key: "leadActivities",
    label: "Lead Activities",
    singularLabel: "Lead activity",
    modelName: "leadActivity",
    dateField: "activityDate",
    dateFieldLabel: "Activity Date",
    dateKind: "instant",
    resetSelectable: false,
  },
  trainers: {
    key: "trainers",
    label: "Trainers",
    singularLabel: "Trainer",
    modelName: "trainer",
    dateField: "createdAt",
    dateFieldLabel: "Created On",
    dateKind: "instant",
    // Trainers are staff accounts — resetting them would delete users, so this
    // category participates in export but NOT in the destructive reset flow.
    resetSelectable: false,
  },
}

/** Order the raw category checklists/render (UIs that show tick boxes). */
export const DATA_CATEGORY_ORDER = [
  "members",
  "memberships",
  "plans",
  "payments",
  "attendance",
  "leads",
  "appointments",
  "tasks",
  "qrSessions",
  "leadActivities",
  "trainers",
] as const satisfies readonly DataCategoryKey[]

/**
 * Canonical worksheet order in the exported workbook (professional CRM
 * narrative: profiles → plan coverage → money → activity → CRM workflow).
 *
 * `Summary` is always the first worksheet and `Member Financial Summary` is
 * placed directly after the Payments sheet — neither is a selectable category,
 * so they are positioned structurally by the export service.
 */
export const EXPORT_SHEET_ORDER = [
  "members",
  "memberships",
  "payments",
  "plans",
  "attendance",
  "qrSessions",
  "leads",
  "leadActivities",
  "trainers",
  "appointments",
  "tasks",
] as const satisfies readonly DataCategoryKey[]

/**
 * Categories whose presence in an export triggers the derived
 * "Member Financial Summary" worksheet.
 */
export const FINANCIAL_CATEGORIES = [
  "members",
  "memberships",
  "payments",
] as const satisfies readonly DataCategoryKey[]

/**
 * The workbook is a full-org snapshot for the selected range. A line like
 * "All Time" or "2026-09-01 — 2026-09-30" labels whether every stored record
 * was exported or only the range was honoured.
 */
export function isFullExportRange(range: DataDateRange | null | undefined): boolean {
  return isDataDateRangeAll(range)
}

/** Categories that can be independently selected in the reset flow. */
export const RESET_SELECTABLE_CATEGORIES = [
  "members",
  "memberships",
  "plans",
  "payments",
  "attendance",
  "leads",
  "appointments",
  "tasks",
  "qrSessions",
] as const satisfies readonly DataCategoryKey[]

// ---------------------------------------------------------------------------
// Date range
// ---------------------------------------------------------------------------

export type DataDateRange =
  | { mode: "all" }
  | { mode: "custom"; fromKey: string; toKey: string }

export function isDataDateRangeAll(range: DataDateRange | null | undefined): boolean {
  return !range || range.mode === "all"
}

/**
 * Render "All Time" or "18 Sep 2026 — 25 Sep 2026" for confirmation copy.
 * Custom ranges are shown as org day keys.
 */
export function dataRangeLabel(range: DataDateRange | null | undefined): string {
  if (isDataDateRangeAll(range)) return "All Time"
  const { fromKey, toKey } = range as { fromKey: string; toKey: string }
  if (fromKey === toKey) return fromKey
  return `${fromKey} — ${toKey}`
}

// ---------------------------------------------------------------------------
// Category date filters
// ---------------------------------------------------------------------------

export type DataModelWhere = {
  member: Prisma.MemberWhereInput
  membership: Prisma.MembershipWhereInput
  membershipPlan: Prisma.MembershipPlanWhereInput
  payment: Prisma.PaymentWhereInput
  checkIn: Prisma.CheckInWhereInput
  lead: Prisma.LeadWhereInput
  appointment: Prisma.AppointmentWhereInput
  task: Prisma.TaskWhereInput
  qrSession: Prisma.QRSessionWhereInput
  leadActivity: Prisma.LeadActivityWhereInput
  trainer: Prisma.TrainerWhereInput
}

export type CategoryWhere<K extends DataCategoryKey> =
  DataModelWhere[DataCategoryModel[K]]

type DataCategoryModel = {
  members: "member"
  memberships: "membership"
  plans: "membershipPlan"
  payments: "payment"
  attendance: "checkIn"
  leads: "lead"
  appointments: "appointment"
  tasks: "task"
  qrSessions: "qrSession"
  leadActivities: "leadActivity"
  trainers: "trainer"
}

/**
 * The org-scoped filter for one category against the given date range.
 *
 * `organizationId` MUST come from the authenticated session — it is never
 * derived from the client. "instant" fields use org-timezone local midnights
 * (same convention as reports/memberships); "dayKey" fields use the stored
 * org-local YYYY-MM-DD string range (inclusive on both ends).
 */
export function categoryFilter<K extends DataCategoryKey>(
  key: K,
  organizationId: string,
  range: DataDateRange,
  timeZone: string
): CategoryWhere<K> {
  const meta = CATEGORY_META[key]
  const base = { organizationId } as CategoryWhere<K>

  if (isDataDateRangeAll(range)) return base

  const { fromKey, toKey } = range as { fromKey: string; toKey: string }
  if (meta.dateKind === "dayKey") {
    return {
      ...base,
      [meta.dateField]: { gte: fromKey, lte: toKey },
    } as CategoryWhere<K>
  }

  const gte = utcInstantForKey(fromKey, timeZone)
  const lt = utcInstantForKey(addDaysToKey(toKey, 1), timeZone)
  return {
    ...base,
    [meta.dateField]: { gte, lt },
  } as CategoryWhere<K>
}

// ---------------------------------------------------------------------------
// Reset dependency graph
//
// The graph below is derived from prisma/schema.prisma: RESTRICT relations
// must be removed before their parent, and SET NULL relations on records we
// are deliberately wiping are listed too so no orphaned rows survive.
//   - Member is RESTRICT-referenced by Membership/Payment/CheckIn and
//     SET NULL-referenced by Appointment/Task/Lead.convertedMember.
//   - MembershipPlan is RESTRICT-referenced by Membership.
//   - Lead is referenced (CASCADE) by LeadActivity.
//   - QRSession is RESTRICT-referenced by CheckIn.
// ---------------------------------------------------------------------------

/** For each parent, the child categories that must be removed with it. */
export const RESET_DEPENDENCIES: Partial<
  Record<DataCategoryKey, DataCategoryKey[]>
> = {
  members: [
    "memberships",
    "payments",
    "attendance",
    "appointments",
    "tasks",
    "leads",
  ],
  plans: ["memberships"],
  leads: ["leadActivities"],
  qrSessions: ["attendance"],
}

/** The child-side relation field used to scope a dependent deletion. */
export const RESET_CHILD_RELATION: Partial<
  Record<DataCategoryKey, Partial<Record<DataCategoryKey, string>>>
> = {
  members: {
    memberships: "member",
    payments: "member",
    attendance: "member",
    appointments: "member",
    tasks: "member",
    leads: "convertedMember",
  },
  plans: { memberships: "plan" },
  leads: { leadActivities: "lead" },
  qrSessions: { attendance: "qrSession" },
}

/**
 * Deletion order (leaf-first). Every RESTRICT foreign key is satisfied:
 *   leadActivities (1) before leads (7)
 *   attendance (2) before qrSessions (8) and members (9)
 *   payments (3) before members (9)
 *   memberships (4) before members (9) and plans (10)
 *   appointments/tasks/leads (5/6/7) before members (9)
 */
export const RESET_ORDER: DataCategoryKey[] = [
  "leadActivities",
  "attendance",
  "payments",
  "memberships",
  "appointments",
  "tasks",
  "leads",
  "qrSessions",
  "members",
  "plans",
]

export type ResetOperation = {
  category: DataCategoryKey
  label: string
  modelName: DataModelName
  /** "selected" = directly chosen by the user; "dependent" = required by a selected parent. */
  role: "selected" | "dependent"
  /** Parent categories that force this operation (empty for top-level selections). */
  dependencyOf: DataCategoryKey[]
  where: DataModelWhere[DataModelName]
}

/**
 * Build the full dependency-aware reset plan for the selected categories.
 *
 * The plan is ordered with RESET_ORDER and every `where` is scoped to the
 * session organization. Dependent categories are scoped through their parent
 * (e.g. memberships whose member was "created in the range"), so a date-range
 * reset never touches rows belonging to records outside the range. When a
 * category is both selected and a dependency, its `where` is the OR union of
 * both so nothing is double counted.
 */
export function buildResetPlan(
  selected: readonly DataCategoryKey[],
  organizationId: string,
  range: DataDateRange,
  timeZone: string
): ResetOperation[] {
  const selectedSet = new Set(selected)

  const topWhere = new Map<DataCategoryKey, DataModelWhere[DataModelName]>()
  for (const key of selectedSet) {
    topWhere.set(key, categoryFilter(key, organizationId, range, timeZone))
  }

  const ops = new Map<DataCategoryKey, ResetOperation>()
  for (const opKey of RESET_ORDER) {
    const segments: DataModelWhere[DataModelName][] = []
    const dependencyOf: DataCategoryKey[] = []

    if (selectedSet.has(opKey)) {
      segments.push(topWhere.get(opKey)!)
    }

    for (const parent of RESET_ORDER) {
      if (!selectedSet.has(parent)) continue
      const relation = RESET_CHILD_RELATION[parent]?.[opKey]
      if (!relation) continue
      dependencyOf.push(parent)
      const parentWhere = topWhere.get(parent)!
      segments.push({
        organizationId,
        [relation]: {
          organizationId,
          ...Object.fromEntries(
            Object.entries(parentWhere).filter(([field]) => field !== "organizationId")
          ),
        },
      } as DataModelWhere[DataModelName])
    }

    if (segments.length === 0) continue

    ops.set(opKey, {
      category: opKey,
      label: CATEGORY_META[opKey].label,
      modelName: CATEGORY_META[opKey].modelName,
      role: selectedSet.has(opKey) ? "selected" : "dependent",
      dependencyOf,
      where:
        segments.length === 1
          ? segments[0]
          : ({ OR: segments } as DataModelWhere[DataModelName]),
    })
  }

  return Array.from(ops.values())
}

// ---------------------------------------------------------------------------
// Confirmation phrase + filename safety
// ---------------------------------------------------------------------------

/** Exact phrase the owner must type to confirm a reset. */
export const RESET_CONFIRM_PHRASE = "DELETE MY GYM DATA"

/**
 * The typed phrase must match AFTER trimming. Comparison is case-insensitive
 * only by product choice; whitespace inside the phrase is significant.
 */
export function matchesResetPhrase(
  input: string | null | undefined | ""
): boolean {
  return (input ?? "").trim().toUpperCase() === RESET_CONFIRM_PHRASE
}

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g

/** Sanitize a gym/branch name so it can never break a filesystem filename. */
export function sanitizeFileNamePart(name: string | null | undefined): string {
  const cleaned = (name ?? "Gym")
    .normalize("NFKC")
    .replace(INVALID_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
  const safe = cleaned || "Gym"
  return safe.length > 60 ? safe.slice(0, 60).trim() : safe
}