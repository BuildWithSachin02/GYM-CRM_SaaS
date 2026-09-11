/**
 * A user-facing business rule violation. Thrown inside a Prisma transaction
 * or action to roll the transaction back and return a friendly error to the
 * form instead of a 500. Kept in a plain module (not a "use server" file) so
 * it can be imported anywhere.
 */
export class BusinessRuleError extends Error {}