/**
 * Payment business rules.
 *
 * Product rule: from the owner payment workflow a payment must always have a
 * clear, verifiable business reason. For the current Gym CRM that reason is the
 * membership it settles — a member-linked payment with no membership is
 * ambiguous ("which plan was this for?") and is therefore rejected.
 *
 * These helpers are pure (no Prisma, no `server-only`) so the exact rule that is
 * enforced in the server action can also be unit tested directly.
 */

/** The subset of a Membership needed to validate a payment link. */
export type MembershipLinkRecord = {
  id: string
  memberId: string
  organizationId: string
  status: string
}

export type PaymentLinkInput = {
  memberId: string
  membershipId?: string | null
}

export type PaymentLinkResult =
  | { ok: true; membershipId: string }
  | { ok: false; error: string }

/**
 * Validate that a payment is linked to a membership that actually belongs to
 * the selected member in the caller's organization. Standalone member-only
 * payments (membershipId null) are rejected.
 *
 * `membership` must be the record looked up server-side (never trusted from the
 * client). Pass `null` when no membership exists for the supplied id.
 */
export function checkMembershipPaymentLink(
  input: PaymentLinkInput,
  membership: MembershipLinkRecord | null | undefined,
  organizationId: string
): PaymentLinkResult {
  const membershipId = input.membershipId?.trim()
  if (!membershipId) {
    return {
      ok: false,
      error:
        "Select the membership this payment is for. Standalone payments are not supported.",
    }
  }

  if (!membership) {
    return {
      ok: false,
      error: "The selected membership was not found for your gym.",
    }
  }

  if (membership.organizationId !== organizationId) {
    return {
      ok: false,
      error: "The selected membership does not belong to your gym.",
    }
  }

  if (membership.memberId !== input.memberId) {
    return {
      ok: false,
      error: "The selected membership does not belong to this member.",
    }
  }

  if (membership.status === "CANCELLED") {
    return {
      ok: false,
      error: "This membership is cancelled and cannot receive new payments.",
    }
  }

  return { ok: true, membershipId }
}
