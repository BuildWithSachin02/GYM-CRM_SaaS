/** Canonical money-to-rupees constant lives with the format helpers. */
export { MINOR_PER_RUPEE } from "./format"
import { minorToRupees, formatRupees } from "./format"

/**
 * Deterministic chart axes derived from the ACTUAL data being plotted.
 *
 * No hardcoded 0..100000/0..500k scales anywhere. The domain is computed from
 * the dataset maximum with ~10% headroom, then rounded up to a "nice" step so
 * tick labels are readable (₹500, ₹5K, ₹25K, ₹1L, ₹10L, ₹1Cr...).
 * All values passed here are in the plot unit (RUPEES for money charts,
 * unitless integers for count charts).
 */

type AxisSteps = number[]

const MONEY_STEPS: AxisSteps = [1, 2, 2.5, 5, 10]
const INT_STEPS: AxisSteps = [1, 2, 5, 10]

export type AxisSpec = {
  ticks: number[]
  domainMax: number
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * Degenerate input (zero / no data / empty) still yields a valid deterministic
 * axis so charts render instead of producing an empty or NaN scale.
 */
export function emptyAxis(integer: boolean): AxisSpec {
  if (integer) return { ticks: [0, 1], domainMax: 1 }
  return { ticks: [0, 1], domainMax: 1 }
}

export function niceAxis(
  maxValue: number,
  tickCount = 4,
  integer = false
): AxisSpec {
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    return emptyAxis(integer)
  }

  const raw = maxValue * 1.1
  const idealStep = raw / Math.max(1, tickCount)
  const exp = Math.floor(Math.log10(idealStep))
  const base = 10 ** exp
  const ratio = idealStep / base
  const steps = integer ? INT_STEPS : MONEY_STEPS
  let step = steps[steps.length - 1]
  for (const s of steps) {
    if (s >= ratio - 1e-9) {
      step = s
      break
    }
  }
  const stepValue = step * base
  const top = Math.max(stepValue, Math.ceil(raw / stepValue - 1e-9) * stepValue)

  const ticks: number[] = []
  for (let t = 0; t <= top + 1e-9; t += stepValue) {
    ticks.push(round6(t))
  }
  return { ticks, domainMax: top }
}

/**
 * Indian compact currency for axis tick labels.
 * ₹0 · ₹500 · ₹5K · ₹25K · ₹1L · ₹10L · ₹1Cr
 */
export function compactMoney(rupees: number): string {
  if (rupees === 0) return "₹0"
  const sign = rupees < 0 ? "-" : ""
  const abs = Math.abs(rupees)
  const strip = (v: number) => {
    const s = v.toFixed(1)
    return s.endsWith(".0") ? s.slice(0, -2) : s
  }
  if (abs >= 1e7) return `${sign}₹${strip(rupees / 1e7)}Cr`
  if (abs >= 1e5) return `${sign}₹${strip(rupees / 1e5)}L`
  if (abs >= 1e3) return `${sign}₹${strip(rupees / 1e3)}K`
  return `${sign}₹${Math.round(rupees)}`
}

/** Exact currency value (tooltips only — never rounded/compacted). */
export function exactMoney(rupees: number): string {
  return formatRupees(rupees)
}

/**
 * Deterministic MONEY chart axis derived from a paise maximum.
 *
 * The paise amount is converted to rupees once (the chart boundary) before the
 * scale is built, so the axis domain and ticks are always rupee-scale — a raw
 * paise value can never leak into the plot as if it were rupees.
 */
export function moneyAxisFromMinor(maxMinor: number, tickCount = 4): AxisSpec {
  return niceAxis(minorToRupees(maxMinor), tickCount, false)
}

/** Tick label for a given axis unit (money rupees vs integer counts). */
export function formatTick(value: number, money: boolean): string {
  if (money) return compactMoney(value)
  if (Number.isInteger(value)) return String(value)
  return String(Math.round(value * 10) / 10)
}