import { test } from "node:test"
import assert from "node:assert/strict"

import {
  MINOR_PER_RUPEE,
  formatMoney,
  formatRupees,
  minorToRupees,
} from "../src/lib/format"
import {
  compactMoney,
  exactMoney,
  formatTick,
  moneyAxisFromMinor,
} from "../src/lib/chart-axis"

// ---------------------------------------------------------------------------
// The single money presentation rule:
//   storage = integer paise → minorToRupees() converts once at the display/chart
//   boundary → formatRupees()/formatMoney() render. A raw paise value must NEVER
//   be displayed as if it were rupees, and charts must not plot paise against a
//   rupee axis.
// ---------------------------------------------------------------------------

test("TEST 1: 1,501,800 paise renders as ₹15,018 (single conversion rule)", () => {
  assert.equal(minorToRupees(1501800), 15018)
  assert.equal(formatRupees(15018), "₹15,018")
  assert.equal(formatMoney(1501800), "₹15,018")
  assert.equal(exactMoney(15018), "₹15,018")
})

test("TEST 2: 3,431,000 paise renders as ₹34,310", () => {
  assert.equal(formatMoney(3431000), "₹34,310")
  assert.equal(formatRupees(34310), "₹34,310")
  assert.equal(exactMoney(34310), "₹34,310")
})

test("TEST 3: 50,000 paise renders as ₹500 (not ₹50,000)", () => {
  assert.equal(formatMoney(50000), "₹500")
  assert.equal(formatRupees(500), "₹500")
})

test("TEST 4: 500,000 paise renders as ₹5,000 (not ₹5,00,000)", () => {
  assert.equal(formatMoney(500000), "₹5,000")
  assert.equal(formatRupees(5000), "₹5,000")
})

test("TEST 5: 10,000,000 paise renders as ₹1,00,000 (Indian grouping)", () => {
  assert.equal(formatMoney(10000000), "₹1,00,000")
  assert.equal(formatRupees(100000), "₹1,00,000")
})

test("TEST 6: 150,000,000 paise renders as ₹15,00,000 (Indian grouping)", () => {
  assert.equal(formatMoney(150000000), "₹15,00,000")
  assert.equal(formatRupees(1500000), "₹15,00,000")
})

test("TEST 7: the chart money axis derives from RUPEES, never raw paise", () => {
  // The old bug plotted 1,501,800 paise against a rupee axis. The axis built
  // from a paise max must be the SAME as the axis for the rupee value, so the
  // paise number can never leak in as if it were rupees.
  const fromMinor = moneyAxisFromMinor(1501800)
  const fromRupees = moneyAxisFromMinor(minorToRupees(1501800) * MINOR_PER_RUPEE)
  assert.deepEqual(fromMinor.ticks, fromRupees.ticks)
  assert.equal(fromMinor.domainMax, fromRupees.domainMax)
  // A ~₹15k day can never produce a 1M+ scale (the recognizable bug signature).
  const paiseAsRupeesScale = 1501800 // what the axis WOULD be if paise leaked in
  assert.ok(fromMinor.domainMax < paiseAsRupeesScale)
})

test("TEST 8: ₹15,018 max (18-Sep demo, Ananya + himanshu + Nikita) → ₹0/₹5K/₹10K/₹15K/₹20K axis", () => {
  const axis = moneyAxisFromMinor(1501800)
  assert.deepEqual(axis.ticks, [0, 5000, 10000, 15000, 20000])
  assert.equal(axis.domainMax, 20000)
  assert.equal(axis.ticks.map((t) => formatTick(t, true)).join(","), "₹0,₹5K,₹10K,₹15K,₹20K")
  assert.ok(axis.domainMax >= 15018, "axis must never clip the max")
})

test("TEST 9: ₹34,310 max (30-day revenue) → sensible dynamic ₹0..₹40K axis", () => {
  const axis = moneyAxisFromMinor(3431000)
  assert.deepEqual(axis.ticks, [0, 10000, 20000, 30000, 40000])
  assert.equal(axis.domainMax, 40000)
  assert.ok(axis.domainMax >= 34310)
  assert.ok(axis.ticks.length <= 6, "readable axis, no runaway tick count")
})

test("TEST 10: all-zero data still yields a degenerate-but-valid axis (no NaN/Infinity)", () => {
  const axis = moneyAxisFromMinor(0)
  assert.deepEqual(axis, { ticks: [0, 1], domainMax: 1 })
  assert.ok(Number.isFinite(axis.domainMax))
  assert.ok(axis.ticks.every((t) => Number.isFinite(t)))
})

test("TEST 11: one large legitimate value (₹1,500,000) is readable and never clipped", () => {
  const axis = moneyAxisFromMinor(150000000)
  assert.equal(axis.domainMax, 2000000)
  assert.deepEqual(axis.ticks, [0, 500000, 1000000, 1500000, 2000000])
  assert.ok(axis.domainMax >= 1500000)
  // Compact labels stay readable at this magnitude.
  assert.equal(compactMoney(500000), "₹5L")
  assert.equal(compactMoney(1000000), "₹10L")
  assert.equal(compactMoney(2000000), "₹20L")
})

test("TEST 12: sparse revenue (few non-zero days) keeps a readable scale", () => {
  // Mirror the revenue-trend chart contract: max over all days, then the axis.
  const values = [1501800, 0, 0, 0, 0, 0, 0, 0, 0]
  const maxMinor = values.reduce((acc, v) => Math.max(acc, v), 0)
  const axis = moneyAxisFromMinor(maxMinor)
  assert.deepEqual(axis.ticks, [0, 5000, 10000, 15000, 20000])
  assert.equal(axis.domainMax, 20000)
  assert.ok(axis.ticks.length >= 3)
})