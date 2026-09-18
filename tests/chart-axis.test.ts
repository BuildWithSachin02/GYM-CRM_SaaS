import { test } from "node:test"
import assert from "node:assert/strict"

import {
  compactMoney,
  emptyAxis,
  exactMoney,
  formatTick,
  niceAxis,
} from "../src/lib/chart-axis"

// ---------------------------------------------------------------------------
// niceAxis — deterministic scales derived from the ACTUAL dataset max
// ---------------------------------------------------------------------------

test("axis for max ₹500 (tiny revenue) stays small with readable ticks", () => {
  const axis = niceAxis(500, 4, false)
  assert.deepEqual(axis.ticks, [0, 200, 400, 600])
  assert.equal(axis.domainMax, 600)
})

test("axis for max ₹5,000", () => {
  const axis = niceAxis(5000, 4, false)
  assert.deepEqual(axis.ticks, [0, 2000, 4000, 6000])
  assert.equal(axis.domainMax, 6000)
})

test("axis for max ₹25,000", () => {
  const axis = niceAxis(25000, 4, false)
  assert.deepEqual(axis.ticks, [0, 10000, 20000, 30000])
  assert.equal(axis.domainMax, 30000)
})

test("axis for max ₹1,00,000", () => {
  const axis = niceAxis(100000, 4, false)
  assert.deepEqual(axis.ticks, [0, 50000, 100000, 150000])
  assert.equal(axis.domainMax, 150000)
})

test("axis for max ₹10,00,000 (large legitimate revenue)", () => {
  const axis = niceAxis(1000000, 4, false)
  assert.deepEqual(axis.ticks, [0, 500000, 1000000, 1500000])
  assert.equal(axis.domainMax, 1500000)
})

test("axis for the exact 18-Sep scenario max ₹15,018 stays readable", () => {
  const axis = niceAxis(15018, 4, false)
  assert.deepEqual(axis.ticks, [0, 5000, 10000, 15000, 20000])
  assert.equal(axis.domainMax, 20000)
})

test("axis handles one large legitimate value without clipping it", () => {
  const axis = niceAxis(15000000, 4, false) // ₹1.5Cr single point
  assert.equal(axis.domainMax, 20000000)
  assert.ok(axis.domainMax > 15000000)
  assert.ok(axis.ticks.every((t) => t >= 0))
})

test("all-zero data yields a degenerate but valid axis (no NaN/Infinity)", () => {
  const axis = niceAxis(0, 4, false)
  assert.deepEqual(axis, emptyAxis(false))
  assert.equal(axis.domainMax, 1)
  const axisInt = niceAxis(0, 4, true)
  assert.equal(axisInt.domainMax, 1)
})

test("integer count axis (attendance) uses integer ticks", () => {
  const axis = niceAxis(11, 4, true)
  assert.deepEqual(axis.ticks, [0, 5, 10, 15])
  assert.equal(axis.domainMax, 15)
  assert.ok(axis.ticks.every((t) => Number.isInteger(t)))
})

test("niceAxis is deterministic — identical input yields identical output", () => {
  const a = niceAxis(22514, 4, false)
  const b = niceAxis(22514, 4, false)
  assert.deepEqual(a, b)
})

test("domain always ≥ all data points (headroom, never hiding data)", () => {
  for (const max of [0, 1, 99, 500, 3499, 22514, 34310, 1501800]) {
    const axis = niceAxis(max, 4, false)
    assert.ok(axis.domainMax >= max, `domain ${axis.domainMax} < max ${max}`)
    assert.ok(!Number.isNaN(axis.domainMax))
  }
})

// ---------------------------------------------------------------------------
// compactMoney — Indian compact formatting for axis tick labels
// ---------------------------------------------------------------------------

test("compactMoney uses Indian magnitude units", () => {
  assert.equal(compactMoney(0), "₹0")
  assert.equal(compactMoney(500), "₹500")
  assert.equal(compactMoney(5000), "₹5K")
  assert.equal(compactMoney(25000), "₹25K")
  assert.equal(compactMoney(100000), "₹1L")
  assert.equal(compactMoney(150000), "₹1.5L")
  assert.equal(compactMoney(10000000), "₹1Cr")
  assert.equal(compactMoney(1501800), "₹15L")
  assert.equal(compactMoney(15000000), "₹1.5Cr")
})

test("formatTick dispatches money vs integer count labels", () => {
  assert.equal(formatTick(20000, true), "₹20K")
  assert.equal(formatTick(1500000, true), "₹15L")
  assert.equal(formatTick(0, true), "₹0")
  assert.equal(formatTick(15, false), "15")
  assert.equal(formatTick(300, false), "300")
})

test("exactMoney never compacts — tooltip precision", () => {
  assert.equal(exactMoney(15018), "₹15,018")
  assert.equal(exactMoney(34310), "₹34,310")
  assert.equal(exactMoney(15018.5), "₹15,018.5")
})