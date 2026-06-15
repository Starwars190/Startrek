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

/**
 * Normalise an extraction's raw payload to a canonical unit (INR Lakhs).
 *
 * Detects the reporting unit from company_profile.reporting_unit, scales
 * every numeric figure in income_statement / balance_sheet / cash_flow if
 * the source is in Crores (×100), and returns a stable meta object so
 * callers never need to re-derive the unit.
 *
 * @param {{ lineItems: Object }} raw  As returned by extractFinancials ({ status:'ok' }).raw
 * @returns {{ lineItems: Object, meta: { reportingUnit: string }, flags: string[] }}
 */
export function normalize(raw) {
  // Deep-clone — never mutate the caller's extraction object
  const lineItems = JSON.parse(JSON.stringify(raw.lineItems))
  const co = lineItems.company_profile || {}
  const ruRaw = String(co.reporting_unit || '').toLowerCase().trim()

  const flags = []
  let scale = 1

  if (/crore/.test(ruRaw)) {
    scale = 100
    co.reporting_unit = 'INR Lakhs'
    flags.push(`Reporting unit was Crores — all figures multiplied ×100 to convert to Lakhs`)
  } else if (/hundred/.test(ruRaw)) {
    flags.push(`Reporting unit '${co.reporting_unit}' (Hundreds) — no automatic conversion applied; manual review recommended`)
  } else {
    if (ruRaw && !/lakh/.test(ruRaw)) {
      flags.push(`Reporting unit '${co.reporting_unit}' unrecognized — assuming INR Lakhs`)
    }
    co.reporting_unit = 'INR Lakhs'
  }

  if (scale !== 1) {
    for (const section of ['income_statement', 'balance_sheet', 'cash_flow']) {
      const sec = lineItems[section]
      if (!sec || typeof sec !== 'object') continue
      for (const byYear of Object.values(sec)) {
        if (!byYear || typeof byYear !== 'object') continue
        for (const yr of Object.keys(byYear)) {
          const v = byYear[yr]
          if (v == null) continue
          const n = parseFloat(String(v).replace(/,/g, ''))
          if (!isNaN(n)) byYear[yr] = Math.round(n * scale * 100) / 100
        }
      }
    }
  }

  lineItems.company_profile = co
  return {
    lineItems,
    meta: { reportingUnit: co.reporting_unit || 'INR Lakhs' },
    flags,
  }
}
