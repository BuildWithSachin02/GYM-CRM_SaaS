import "server-only"

import { createHash, randomBytes } from "node:crypto"

/**
 * Stateless signed session cookies (HMAC-SHA256).
 * The token payload is the user id + session version + expiry; the signature
 * is computed with AUTH_SECRET. It works in both Node.js and Edge (middleware)
 * runtimes via WebCrypto. Full authorization is always re-checked in the
 * server layer against the database for every request/action.
 *
 * The signed-in session version (`v`) mirrors User.sessionVersion. Bumping that
 * column (deactivation, password change/reset, role change, permission edit)
 * makes an already-issued cookie stale: the next request is treated as
 * unauthenticated, actively revoking old sessions without a session table.
 */

export const SESSION_COOKIE = "gym_session"
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days
const ALG = { name: "HMAC", hash: "SHA-256" }

function getSecret(): ArrayBuffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error("AUTH_SECRET is not set")
  }
  return new TextEncoder().encode(secret).buffer as ArrayBuffer
}

function bytesOf(input: string): ArrayBuffer {
  return new TextEncoder().encode(input).buffer as ArrayBuffer
}

/** Returns an exact-size, freshly allocated ArrayBuffer (Node pooled buffers excluded). */
function decodeOf(input: string): ArrayBuffer {
  return Uint8Array.from(Buffer.from(input, "base64url")).buffer as ArrayBuffer
}

async function importKey(usage: "sign" | "verify") {
  return crypto.subtle.importKey("raw", getSecret(), ALG, false, [usage])
}

function base64urlEncode(data: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(data)).toString("base64url")
}

export async function createSessionToken(
  userId: string,
  sessionVersion = 0
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const payload = base64urlEncode(
    bytesOf(JSON.stringify({ userId, exp, v: sessionVersion }))
  )
  const key = await importKey("sign")
  const sig = await crypto.subtle.sign(ALG, key, decodeOf(payload))
  return `${payload}.${base64urlEncode(sig)}`
}

export type SessionTokenPayload = {
  userId: string
  exp: number
  v: number
}

export async function verifySessionToken(
  token: string | undefined
): Promise<SessionTokenPayload | null> {
  if (!token) return null
  const [payload, signature] = token.split(".")
  if (!payload || !signature) return null

  try {
    const key = await importKey("verify")
    const ok = await crypto.subtle.verify(
      ALG,
      key,
      decodeOf(signature),
      decodeOf(payload)
    )
    if (!ok) return null

    const decoded = JSON.parse(
      new TextDecoder().decode(decodeOf(payload))
    ) as {
      userId: string
      exp: number
      v?: number
    }
    if (
      !decoded.userId ||
      typeof decoded.exp !== "number" ||
      decoded.exp < Math.floor(Date.now() / 1000)
    ) {
      return null
    }
    return { userId: decoded.userId, exp: decoded.exp, v: decoded.v ?? 0 }
  } catch {
    return null
  }
}

/** Random opaque token that we will only ever store as a hash. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("hex")
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}