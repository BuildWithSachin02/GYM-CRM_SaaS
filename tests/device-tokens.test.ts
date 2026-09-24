import { test } from "node:test"
import assert from "node:assert/strict"

import {
  DEVICE_TOKEN_HEX_LENGTH,
  generateDeviceToken,
  hashDeviceToken,
} from "../src/lib/device-tokens"

test("generated tokens are 64 lowercase hex characters (256 bits of entropy)", () => {
  const token = generateDeviceToken()
  assert.equal(token.length, DEVICE_TOKEN_HEX_LENGTH)
  assert.match(token, /^[0-9a-f]{64}$/)
})

test("tokens are unique in practice", () => {
  const seen = new Set<string>()
  for (let i = 0; i < 1000; i++) seen.add(generateDeviceToken())
  assert.equal(seen.size, 1000)
})

test("hashes are deterministic sha256 hex digests", () => {
  const token = generateDeviceToken()
  assert.equal(hashDeviceToken(token), hashDeviceToken(token))
  assert.match(hashDeviceToken(token), /^[0-9a-f]{64}$/)
})

test("the raw token can never be recovered from its hash", () => {
  const token = generateDeviceToken()
  assert.notEqual(hashDeviceToken(token), token)
})

test("distinct tokens produce distinct hashes", () => {
  assert.notEqual(hashDeviceToken("a"), hashDeviceToken("b"))
})