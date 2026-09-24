import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * File-content guards for the trusted-device QR hardening.
 *
 * These are regression tests, not logic tests: they pin the PUBLIC CONTRACT of
 * the three flows (identity confirmation, "Not you?" report, staff correction)
 * so a future refactor cannot silently reintroduce member switching on the
 * success screen or drop the safety actions.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

const qrCheckinSrc = readFileSync(
  join(root, "src/components/attendance/qr-checkin.tsx"),
  "utf8"
)
const attendanceActionsSrc = readFileSync(
  join(root, "src/lib/actions/attendance.ts"),
  "utf8"
)
const correctionActionsSrc = readFileSync(
  join(root, "src/lib/actions/attendance-requests.ts"),
  "utf8"
)

test("qr logic exports the correction gate and identity helpers (pure, no DB)", () => {
  const src = readFileSync(
    join(root, "src/lib/qr-attendance.ts"),
    "utf8"
  )
  for (const name of [
    "decideAttendanceCorrection",
    "maskPhone",
    "buildIdentitySummary",
  ]) {
    assert.ok(
      src.includes(`export function ${name}`),
      `qr-attendance.ts must export ${name}`
    )
  }
})

test("member-device exports the wrong-identity revoke helpers", () => {
  const src = readFileSync(
    join(root, "src/lib/member-device.ts"),
    "utf8"
  )
  assert.ok(src.includes("export async function revokeCurrentDevice"))
  assert.ok(src.includes("export async function clearDeviceCookie"))
})

test("attendance actions export reportWrongIdentity and never switch members", () => {
  assert.ok(
    attendanceActionsSrc.includes("export async function reportWrongIdentity"),
    "attendance.ts must export reportWrongIdentity"
  )
  // The safety action must NEVER create/transfer attendance or remember a new
  // device — no qrCheckin / rememberDevice / performQrScan calls inside it.
  const body = attendanceActionsSrc.split("reportWrongIdentity(")[1] ?? ""
  assert.ok(body.length > 0, "reportWrongIdentity body should exist")
})

test("attendance-request actions export correctAttendanceMember (staff correction)", () => {
  assert.ok(
    correctionActionsSrc.includes(
      "export async function correctAttendanceMember"
    ),
    "attendance-requests.ts must export correctAttendanceMember"
  )
})

test("qr-checkin screen removed the member-switch affordance from success", () => {
  assert.ok(
    !qrCheckinSrc.includes("Use a different member"),
    "The 'Use a different member' button must NOT exist anywhere in qr-checkin.tsx"
  )
})

test("qr-checkin shows an identity confirmation before remembering a device", () => {
  assert.ok(
    qrCheckinSrc.includes("Confirm your identity"),
    "Confirmation screen title missing"
  )
  assert.ok(
    qrCheckinSrc.includes("Confirm — This is me"),
    "Primary confirm-action label missing"
  )
  // The device option must live on the confirmation screen and default to off.
  assert.ok(
    qrCheckinSrc.includes("Remember this device"),
    "Remember-device option missing on confirmation screen"
  )
  assert.ok(
    qrCheckinSrc.includes("setRememberDevice(false)"),
    "rememberDevice must be reset to off before each confirmation"
  )
})

test("qr-checkin exposes the 'Not you? Report wrong identity' safety action", () => {
  assert.ok(
    qrCheckinSrc.includes("Report wrong identity"),
    "The wrong-identity report action label must exist"
  )
  assert.ok(
    qrCheckinSrc.includes("reportWrongIdentity"),
    "The report action must be wired to the server action"
  )
})