/**
 * Member Code domain rules (PURE — no DB access, unit-testable).
 *
 * Also hosts the shared member selection/combobox label helpers used across
 * membership, payment, attendance and CRM pickers so every member option
 * renders the SAME unambiguous identity: "First Last / MEM-0042" with a
 * masked-phone sublabel when the owning page already fetches the phone.
 *
 * A Member Code is the org-scoped, human-facing identifier shown to staff:
 *   - format: "MEM-" + zero-padded integer, minimum 4 digits (MEM-0001 …
 *     MEM-9999, MEM-10000, …). There is NO cap at 9999.
 *   - uniqueness: per organization (future Branch-proof): two members in the
 *     same org never share a code; different orgs may reuse codes.
 *   - generation: deterministic, server-side only. The next code is the lowest
 *     positive integer not already in use (no randomness, no timestamps, no
 *     client counters, never derived from a name or UUID). The DB unique
 *     constraint is the source of truth; callers retry on a P2002 collision.
 *   - permanence: once assigned a code is never reused or recycled, even after
 *     a member is archived.
 *
 * The canonical identity remains the UUID `member.id`. A Member Code is
 * display/organizational only — it is never a foreign key, never trusted as
 * client input, and never used for authorization.
 */

import { maskPhone } from "@/lib/qr-attendance"

export type MemberOptionInfo = {
  firstName: string
  lastName: string
  memberCode?: string | null
  phone?: string | null
}

/** "First Last / MEM-0042" (code appended only when the member has one). */
export function memberSelectionLabel(member: MemberOptionInfo): string {
  const name = `${member.firstName} ${member.lastName}`.trim()
  return member.memberCode ? `${name} / ${member.memberCode}` : name
}

/** Masked phone sublabel for combobox options (never the raw number). */
export function memberSelectionSublabel(
  member: MemberOptionInfo
): string | undefined {
  const masked = maskPhone(member.phone)
  return masked || undefined
}

export const MEMBER_CODE_PREFIX = "MEM"

/**
 * Is this a Prisma P2002 unique violation on `memberCode`? Puppets no Prisma
 * dependency here (this module is PURE), so the error is inspected structurally:
 * a known request-error with `code === "P2002"` whose meta.target mentions the
 * memberCode column.
 */
export function isMemberCodeCollision(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const e = error as { code?: unknown; meta?: { target?: unknown } }
  // Prisma reports P2002 targets either as field names (["organizationId",
  // "memberCode"]) or as the constraint name (["Member_organizationId_memberCode_key"]).
  // Both mention the column name, so a substring match covers each shape.
  return (
    e.code === "P2002" &&
    Array.isArray(e.meta?.target) &&
    (e.meta.target as unknown[]).some(
      (t) => typeof t === "string" && t.includes("memberCode")
    )
  )
}

/** 4-digit minimum padding, no upper bound (MEM-10000 …). */
const MEMBER_CODE_MIN_DIGITS = 4

const MEMBER_CODE_RE = /^MEM-0*([1-9]\d*)$/i

/** `1 → "MEM-0001"`, `10000 → "MEM-10000"`. Throws on n < 1. */
export function toMemberCode(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid member code sequence: ${n}`)
  }
  return `${MEMBER_CODE_PREFIX}-${String(n).padStart(MEMBER_CODE_MIN_DIGITS, "0")}`
}

/** Parse a code back to its integer. `null` for anything malformed. */
export function parseMemberCode(code: string | null | undefined): number | null {
  if (!code) return null
  const match = MEMBER_CODE_RE.exec(code.trim())
  if (!match) return null
  const n = Number.parseInt(match[1], 10)
  return Number.isSafeInteger(n) && n >= 1 ? n : null
}

/** `true` when the string is a well-formed member code ("MEM-0042"). */
export function isValidMemberCode(code: string | null | undefined): boolean {
  return parseMemberCode(code) !== null
}

/**
 * Deterministic "next free code": the lowest positive integer not already
 * present in `existing`. Purely functional — the caller provides the full set
 * of codes currently in scope (org) and retries on a P2002 race.
 */
export function nextMemberCode(existingCodes: Iterable<string>): string {
  const used = new Set<number>()
  for (const code of existingCodes) {
    const n = parseMemberCode(code)
    if (n !== null) used.add(n)
  }
  let n = 1
  while (used.has(n)) n += 1
  return toMemberCode(n)
}

/**
 * Normalized identity keys used ONLY for duplicate detection. They never
 * replace the stored display values.
 */

/** Collapse whitespace + lowercase, e.g. "Rahul   Patel" → "rahul patel". */
export function normalizeMemberName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ")
}

/** Digits only (phone formatting never affects duplicate matching). */
export function normalizePhoneKey(phone: string): string {
  return phone.replace(/\D+/g, "")
}

/** A real member the duplicate check runs against (display fields only). */
export type DuplicateCandidate = {
  id: string
  firstName: string
  lastName: string
  phone: string
  memberCode: string | null
}

export type DuplicateWarning = {
  memberId: string
  memberCode: string | null
  /** Display name of the existing member. */
  name: string
  strength: "weak" | "strong"
}

/**
 * Classify existing members against a new/edited member's identity.
 *
 *   - STRONG ("Possible duplicate member"): same normalized name AND same
 *     phone. Informational only — never blocks the action.
 *   - WEAK: same normalized name with a different phone (family members may
 *     share a name; different names sharing a phone is explicitly ALLOWED).
 *
 * A candidate that qualifies as STRONG is reported only once (as STRONG).
 */
export function classifyDuplicates(
  input: { firstName: string; lastName: string; phone: string },
  candidates: DuplicateCandidate[]
): DuplicateWarning[] {
  const nameKey = normalizeMemberName(`${input.firstName} ${input.lastName}`)
  const phoneKey = normalizePhoneKey(input.phone)

  const warnings: DuplicateWarning[] = []
  for (const c of candidates) {
    const candidateNameKey = normalizeMemberName(`${c.firstName} ${c.lastName}`)
    if (candidateNameKey !== nameKey) continue
    const candidatePhoneKey = normalizePhoneKey(c.phone)
    const strength: DuplicateWarning["strength"] =
      phoneKey !== "" && candidatePhoneKey !== "" && candidatePhoneKey === phoneKey
        ? "strong"
        : "weak"
    warnings.push({
      memberId: c.id,
      memberCode: c.memberCode,
      name: `${c.firstName} ${c.lastName}`.trim(),
      strength,
    })
  }
  return warnings
}