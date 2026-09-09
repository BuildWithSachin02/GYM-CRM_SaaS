import "server-only"

import { createHash, randomBytes } from "node:crypto"

/**
 * Stateless signed session cookies (HMAC-SHA256).
 * The token payload is the user id + expiry; the signature is computed with
 * AUTH_SECRET. It works in both Node.js and Edge (middleware) runtimes via
 * WebCrypto. Full authorization is always re-checked in the server layer
 * against the database for every request/action.
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

export async function createSessionToken(userId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const payload = base64urlEncode(bytesOf(JSON.stringify({ userId, exp })))
  const key = await importKey("sign")
  const sig = await crypto.subtle.sign(ALG, key, decodeOf(payload))
  return `${payload}.${base64urlEncode(sig)}`
}

export async function verifySessionToken(
  token: string | undefined
): Promise<string | null> {
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

    const { userId, exp } = JSON.parse(
      new TextDecoder().decode(decodeOf(payload))
    ) as {
      userId: string
      exp: number
    }
    if (!userId || typeof exp !== "number" || exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    return userId
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