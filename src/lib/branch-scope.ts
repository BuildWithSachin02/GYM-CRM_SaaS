/**
 * Branch filter semantics (PURE — no DB access, unit-testable).
 *
 * Branch scoping is applied to every data read in the app via a BranchFilter
 * derived ONCE per request from the signed user session + the validated branch
 * cookie. This module is the single definition of what each filter means, so
 * members, memberships, payments, attendance, leads, appointments, tasks,
 * counts, reports and exports can never disagree about visibility.
 *
 * Filter kinds:
 *   all    — OWNER / org-wide read. No branch clause. Callers see every branch
 *            plus organization-wide records.
 *   single — a RESTRICTED user viewing one explicit branch. Sees that branch's
 *            records PLUS organization-wide records (branchId = null), which
 *            represent non-site-bound operations (website leads, org tasks,
 *            phone appointments, a member with no home branch yet).
 *   multi  — a RESTRICTED user with several accessible branches (the default
 *            branch view). Same org-wide inclusion as single, because the
 *            org-wide records are never branch-specific.
 *   none   — a RESTRICTED user with zero assigned branches. FAIL-CLOSED: they
 *            see nothing at all, including org-wide records. Callers are
 *            expected to hard-stop (ForbiddenError) BEFORE running a query,
 *            but the where-builder still returns a never-matching clause as a
 *            defensive backstop.
 *   exact  — ONE branch's OWN records, with NO organization-wide arm. This is
 *            the per-branch ATTRIBUTION filter used by the Branches module
 *            (a branch card / branch overview must report what happened AT
 *            that branch and nothing else). It is the deliberate difference
 *            from `single`: a card showing "organization-wide members" or
 *            "org-wide revenue" would be a data-mixing bug, so the
 *            organization-wide arm is omitted here by design.
 *
 * SECURITY CONTRACT: a branch filter is NEVER a tenant boundary by itself.
 * Every query MUST also carry `organizationId: session.organizationId`. The
 * branch filter only narrows within that org.
 *
 * NULLABILITY CONTRACT (the rule that keeps Prisma queries valid): whether a
 * filter may carry the organization-wide `branchId: null` arm is a property of
 * the MODEL, not of the filter kind. Most branch columns are NOT NULL
 * (Membership, Payment, CheckIn, QRSession, AttendanceRequest, UserBranch), and
 * Prisma does not accept `null` for a required FK, so those models MUST be
 * filtered with `branchFilterWhereRequired()`, which never emits the null arm.
 * Only genuinely nullable columns (Lead, Appointment, Task, Member.homeBranchId)
 * may use `branchFilterWhere()`.
 */

export type BranchFilter =
  | { kind: "all" }
  | { kind: "single"; branchId: string }
  | { kind: "multi"; branchIds: string[] }
  | { kind: "none" }
  | { kind: "exact"; branchId: string }

/** The concrete branch ids a filter constrains to ([] for all / none). */
export function filterBranchIds(filter: BranchFilter): string[] {
  switch (filter.kind) {
    case "single":
    case "exact":
      return [filter.branchId]
    case "multi":
      return filter.branchIds
    default:
      return []
  }
}

/**
 * The filter that attributes data to exactly ONE branch (no organization-wide
 * arm). Callers MUST pass branch ids they have already proven the viewer may
 * access — this builder never authorizes anything, it only narrows a query
 * that is already org-scoped.
 */
export function exactBranchFilter(branchId: string): BranchFilter {
  // A blank id would compile into `{ branchId: "" }`, which Prisma treats as a
  // real (never-matching) value — a silent empty result instead of a bug. Fail
  // loudly at the call site instead.
  if (!branchId) throw new Error("exactBranchFilter requires a non-empty branch id")
  return { kind: "exact", branchId }
}

export function isBranchFilterAll(filter: BranchFilter): boolean {
  return filter.kind === "all"
}

export function isBranchFilterNone(filter: BranchFilter): boolean {
  return filter.kind === "none"
}

/**
 * Does the filter expose organization-wide (branchId = null) records?
 * single/multi/exact-1-branch-of-the-viewer: yes for the viewer scopes. all:
 * non-applicable (returns true so `isRecordVisible` stays total). none: NO —
 * fail-closed. `exact`: NO — it attributes to a single branch only.
 */
export function includesOrgWideRecords(filter: BranchFilter): boolean {
  return filter.kind !== "none" && filter.kind !== "exact"
}

/**
 * In-memory visibility check for a single record whose branch is known.
 * `recordBranchId` null means an organization-wide record; `undefined` is
 * treated as "not proven to be org-wide" and never shown (fail-closed — Prisma
 * always returns `null` for an absent optional FK, so this is defensive only).
 */
export function isRecordVisible(
  filter: BranchFilter,
  recordBranchId: string | null | undefined
): boolean {
  switch (filter.kind) {
    case "all":
      return true
    case "none":
      return false
    case "exact":
      return recordBranchId === filter.branchId
    case "single":
      return recordBranchId === filter.branchId || recordBranchId === null
    case "multi": {
      // An empty multi is fail-closed (matches the where-builder): nothing is
      // visible, not even org-wide records.
      if (filter.branchIds.length === 0) return false
      if (recordBranchId === null) return true
      return recordBranchId !== undefined && filter.branchIds.includes(recordBranchId)
    }
  }
}

export type BranchWhereFragment = {
  OR?: Array<Record<string, unknown>>
  [field: string]: unknown
}

/**
 * The nullability of a model's branch foreign key. This is the single most
 * important fact about a branch filter, and it is decided by the SCHEMA, not by
 * the viewer:
 *
 *   "nullable" - the column may be NULL, and NULL means "organization-wide /
 *     not tied to a location" (a website lead, an org task, a phone booking, a
 *     member with no home branch yet): Lead.branchId, Appointment.branchId,
 *     Task.branchId, Member.homeBranchId.
 *
 *   "required" - the column is NOT NULL, so every row already belongs to a real
 *     branch: Membership.branchId, Payment.branchId, CheckIn.branchId,
 *     QRSession.branchId, AttendanceRequest.branchId, UserBranch.branchId.
 *
 * For a "required" model the `branchId: null` arm is not merely redundant, it
 * is INVALID. Prisma types a required FK in its generated `...WhereInput` as
 * `StringFilter | string`, so `{ branchId: null }` is not a member of that
 * input and Prisma rejects the ENTIRE query at runtime with
 * `PrismaClientValidationError: Argument 'branchId' is missing.`
 */
export type BranchFieldNullability = "nullable" | "required"

/**
 * The ONE implementation of the fragment shape. `nullability` decides whether the
 * organization-wide arm is legal for the model being filtered, so both public
 * builders below share this code path and cannot drift apart.
 *
 *   all    -> {}                                    (no clause)
 *   none   -> { OR: [{ field: { in: [] } }] }       (never matches, fail-closed)
 *   single -> { OR: [{ field }, { field: null }] }  (nullable models only)
 *   multi  -> { OR: [{ field: { in } }, <org-wide>] } (nullable models only)
 *   exact  -> { field }                              (one branch, never org-wide)
 *
 * `none` and `exact` are identical for both nullability classes: neither can
 * express a null, so neither needs to.
 */
function buildBranchWhere(
  filter: BranchFilter,
  field: string,
  nullability: BranchFieldNullability
): BranchWhereFragment {
  // The organization-wide arm is the ONLY difference between the two classes.
  const withOrgWide = (value: Record<string, unknown>): BranchWhereFragment =>
    nullability === "required" ? { OR: [value] } : { OR: [value, { [field]: null }] }

  switch (filter.kind) {
    case "all":
      return {}
    case "none":
      return { OR: [{ [field]: { in: [] } }] }
    case "exact":
      return { [field]: filter.branchId }
    case "single":
      return withOrgWide({ [field]: filter.branchId })
    case "multi": {
      const ids = filter.branchIds
      // An empty set is fail-closed and NEVER means "all branches".
      if (ids.length === 0) return { OR: [{ [field]: { in: [] } }] }
      return withOrgWide({ [field]: { in: ids } })
    }
  }
}

/**
 * Build the Prisma-style AND fragment to append to a query's `where`, for a
 * model whose branch foreign key is NULLABLE.
 *
 *   all    -> {}                                    (no clause)
 *   none   -> { OR: [{ branchId: { in: [] } }] }    (never matches, fail-closed)
 *   single -> { OR: [{ branchId }, { branchId: null }] }
 *   multi  -> { OR: [{ branchId: { in } }, { branchId: null }] }
 *   exact  -> { branchId }                          (one branch, no org-wide arm)
 *
 * The org-wide arm (`branchId: null`) is intentionally inside the OR so a
 * RESTRICTED user keeps seeing organization-wide records; remove it here and
 * every nullable-branch module changes behaviour together.
 *
 * USE ONLY WHERE THE MODEL'S BRANCH FK IS NULLABLE (Lead, Appointment, Task,
 * Member.homeBranchId). For a NOT NULL branch FK use
 * `branchFilterWhereRequired()` instead: emitting `{ branchId: null }` for those
 * models makes Prisma reject the whole query.
 */
export function branchFilterWhere(
  filter: BranchFilter,
  field: string = "branchId"
): BranchWhereFragment {
  return buildBranchWhere(filter, field, "nullable")
}

/**
 * Build the Prisma-style AND fragment for a model whose branch foreign key is
 * REQUIRED, i.e. every row already belongs to a branch (Membership, Payment,
 * CheckIn, QRSession, AttendanceRequest, UserBranch).
 *
 * Identical to `branchFilterWhere()` EXCEPT that the organization-wide
 * (`field: null`) arm is never emitted, because no such row can exist and
 * Prisma does not accept `null` for a required FK. A restricted viewer's scope
 * therefore reduces to exactly their assigned branches, which is precisely the
 * set of rows that can exist -- nothing is hidden by dropping the null arm.
 *
 * `all` still yields no clause (an owner reads the whole organization) and
 * `none` / an empty `multi` still fail closed to a never-matching clause.
 */
export function branchFilterWhereRequired(
  filter: BranchFilter,
  field: string = "branchId"
): BranchWhereFragment {
  return buildBranchWhere(filter, field, "required")
}

/**
 * JSON-serializable form for server-action round-trips / tests. Used by the
 * branch context resolution when a filter has to survive across a boundary
 * that Prisma types cannot cross.
 */
export function serializeBranchFilter(filter: BranchFilter): BranchFilter {
  return filter
}
