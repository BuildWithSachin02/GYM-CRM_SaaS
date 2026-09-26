/**
 * Branch Code domain rules (PURE — no DB access, unit-testable).
 *
 * A Branch Code is the org-scoped, human-facing identifier shown to staff and
 * used for search/display ("John: which branch code?"). It deliberately shares
 * the Member Code philosophy:
 *   - format: "BR-" + zero-padded integer, minimum 4 digits (BR-0001 …
 *     BR-9999, BR-10000, …). There is NO cap at 9999.
 *   - uniqueness: per organization. Two branches in the same org never share
 *     a code; different orgs may reuse codes.
 *   - generation: deterministic, server-side only. The next code is the lowest
 *     positive integer not already in use within the org. The DB unique
 *     constraint (`@@unique([organizationId, branchCode])`) is the source of
 *     truth; callers retry on a P2002 race.
 *   - permanence: once assigned, a code is never reused or recycled, even
 *     after a branch is deactivated.
 *
 * The canonical identity remains the UUID `branch.id`. A Branch Code is
 * display/organizational only — it is never a foreign key, never trusted as
 * client input, and never used for authorization.
 */

export const BRANCH_CODE_PREFIX = "BR"

/**
 * Is this a Prisma P2002 unique violation on `branchCode`? This module is PURE
 * (no Prisma import), so the error is inspected structurally: a known
 * request-error with `code === "P2002"` whose meta.target mentions the
 * branchCode column.
 */
export function isBranchCodeCollision(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const e = error as { code?: unknown; meta?: { target?: unknown } }
  return (
    e.code === "P2002" &&
    Array.isArray(e.meta?.target) &&
    (e.meta.target as unknown[]).some(
      (t) => typeof t === "string" && t.includes("branchCode")
    )
  )
}

/** 4-digit minimum padding, no upper bound (BR-10000 …). */
const BRANCH_CODE_MIN_DIGITS = 4

const BRANCH_CODE_RE = /^BR-0*([1-9]\d*)$/i

/** `1 → "BR-0001"`, `10000 → "BR-10000"`. Throws on n < 1. */
export function toBranchCode(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid branch code sequence: ${n}`)
  }
  return `${BRANCH_CODE_PREFIX}-${String(n).padStart(BRANCH_CODE_MIN_DIGITS, "0")}`
}

/** Parse a code back to its integer. `null` for anything malformed. */
export function parseBranchCode(code: string | null | undefined): number | null {
  if (!code) return null
  const match = BRANCH_CODE_RE.exec(code.trim())
  if (!match) return null
  const n = Number.parseInt(match[1], 10)
  return Number.isSafeInteger(n) && n >= 1 ? n : null
}

/** `true` when the string is a well-formed branch code ("BR-0042"). */
export function isValidBranchCode(code: string | null | undefined): boolean {
  return parseBranchCode(code) !== null
}

/**
 * Deterministic "next free code": the lowest positive integer not already
 * present in `existing`. Purely functional — the caller provides the full set
 * of codes currently in scope (org) and retries on a P2002 race.
 */
export function nextBranchCode(existingCodes: Iterable<string>): string {
  const used = new Set<number>()
  for (const code of existingCodes) {
    const n = parseBranchCode(code)
    if (n !== null) used.add(n)
  }
  let n = 1
  while (used.has(n)) n += 1
  return toBranchCode(n)
}

/**
 * Shared branch selection/combobox label: `"King's Gym — Main / BR-0001"`.
 * Used everywhere a branch option is rendered so every picker shows the same
 * unambiguous identity.
 */
export function branchSelectionLabel(branch: {
  name: string
  branchCode?: string | null
}): string {
  return branch.branchCode ? `${branch.name} / ${branch.branchCode}` : branch.name
}