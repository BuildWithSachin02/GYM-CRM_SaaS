import { test } from "node:test"
import assert from "node:assert/strict"

import { formatMoney, dayKeyOf, pluralize, fullName, initials } from "../src/lib/format"

test("formatMoney formats minor units as INR", () => {
  assert.equal(formatMoney(500000), "₹5,000")
  assert.equal(formatMoney(100), "₹1")
})

test("dayKeyOf returns YYYY-MM-DD", () => {
  assert.equal(dayKeyOf(new Date("2026-09-09T12:00:00Z")), "2026-09-09")
})

test("pluralize handles singular and plural", () => {
  assert.equal(pluralize(1, "appointment"), "appointment")
  assert.equal(pluralize(2, "appointment"), "appointments")
})

test("fullName joins first and last", () => {
  assert.equal(fullName("Rahul", "Sharma"), "Rahul Sharma")
})

test("initials takes first letters of first two words", () => {
  assert.equal(initials("Rahul Sharma"), "RS")
})
