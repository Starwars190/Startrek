/**
 * normalize.js
 *
 * Pure numeric helpers shared by every core module.
 * No side-effects, no imports.
 */

/**
 * Parse a raw field value (string, number, or null) into a JS number.
 * Returns null for null / undefined / NaN / non-numeric strings.
 */
export function toNum(v) {
  if (v == null) return null
  const n = parseFloat(String(v).replace(/,/g, ''))
  return isNaN(n) ? null : n
}

/**
 * Safe division rounded to 4 decimal places.
 * Returns null when either operand is null or divisor is zero.
 */
export function div(a, b) {
  if (a == null || b == null || b === 0) return null
  return Math.round(a / b * 10000) / 10000
}

/**
 * Safe percentage (a/b × 100) rounded to 2 decimal places.
 */
export function pct(a, b) {
  const v = div(a, b)
  return v != null ? Math.round(v * 10000) / 100 : null
}

/**
 * Round a number to 2 decimal places; null-safe.
 */
export function round2(v) {
  return v != null ? Math.round(v * 100) / 100 : null
}

/**
 * YoY growth percentage, matching server.js precision.
 * Returns null when either value is null or the prior value is zero.
 */
export function growthPct(current, prior) {
  if (current == null || prior == null || prior === 0) return null
  return Math.round((current - prior) / Math.abs(prior) * 10000) / 100
}
