import { createHash, randomBytes } from "node:crypto"

/**
 * Trusted-device token primitives (pure module).
 *
 * A remembered device is identified by an opaque, cryptographically random
 * token that only ever exists in two places:
 *   - the browser's secure HttpOnly cookie (raw value), and
 *   - the database as its SHA-256 hex digest.
 * The server never stores or logs the raw token, and the cookie never contains
 * the memberId or organizationId. The token is an IDENTIFICATION convenience,
 * never authorization: every scan still runs the full server-side validation.
 */

export const DEVICE_TOKEN_BYTES = 32
export const DEVICE_TOKEN_HEX_LENGTH = DEVICE_TOKEN_BYTES * 2

/** A fresh opaque device token (64 lowercase hex chars). */
export function generateDeviceToken(): string {
  return randomBytes(DEVICE_TOKEN_BYTES).toString("hex")
}

/** SHA-256 hex digest of a device token — the ONLY thing stored server-side. */
export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}