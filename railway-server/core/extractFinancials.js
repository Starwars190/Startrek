/**
 * extractFinancials.js
 *
 * Typed accessors for the analysis JSON object.
 * All functions return JS numbers (or null) — never raw strings.
 */

import { toNum } from './normalize.js'
import { RETAINED_EARNINGS_ALIASES } from './extractionSchema.js'

/**
 * Get a single field value from a section object for a given year.
 *
 * @param {Object} section  e.g. analysis.income_statement
 * @param {string} key      e.g. 'revenue'
 * @param {string} year     e.g. 'FY2025'
 * @returns {number|null}
 */
export function getField(section, key, year) {
  return toNum(section?.[key]?.[year])
}

/**
 * Try a list of field-name aliases in order; return the first non-null hit.
 *
 * @param {Object}   section
 * @param {string[]} aliases  candidate key names, checked left-to-right
 * @param {string}   year
 * @returns {number|null}
 */
export function resolveAliases(section, aliases, year) {
  for (const alias of aliases) {
    const v = toNum(section?.[alias]?.[year])
    if (v != null) return v
  }
  return null
}

/**
 * Resolve retained earnings for the Altman Z-Score, mirroring server.js:
 *   retained_earnings → reserves_surplus → reserves_and_surplus →
 *   reserves_and_surplus_balance → total_equity (fallback)
 *
 * @param {Object} bs   analysis.balance_sheet
 * @param {string} year
 * @param {number|null} equityFallback  pre-computed total_equity for this year
 */
export function getRetainedEarnings(bs, year, equityFallback = null) {
  const v = resolveAliases(bs, RETAINED_EARNINGS_ALIASES, year)
  return v ?? equityFallback
}

/**
 * Resolve total liabilities for the Altman Z-Score, mirroring server.js:
 *   total_liabilities → total_liabilities_net →
 *   (non_current_liabilities + current_liabilities) →
 *   current_liabilities alone →
 *   (total_assets - total_equity)
 *
 * @param {Object}      bs
 * @param {string}      year
 * @param {number|null} cl    pre-computed total_current_liabilities
 * @param {number|null} ta    pre-computed total_assets
 * @param {number|null} eq    pre-computed total_equity
 */
export function getTotalLiabilities(bs, year, cl = null, ta = null, eq = null) {
  const tl = toNum(bs?.total_liabilities?.[year]) ?? toNum(bs?.total_liabilities_net?.[year])
  if (tl != null) return tl

  const ncl = toNum(bs?.non_current_liabilities?.[year])
  const cl2 = toNum(bs?.current_liabilities?.[year])
  if (ncl != null && cl2 != null) return ncl + cl2

  if (cl != null) return cl

  if (ta != null && eq != null) return ta - eq

  return null
}
