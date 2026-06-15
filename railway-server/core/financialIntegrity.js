/**
 * financialIntegrity.js
 *
 * Validation layer — mirrors validateAnalysis() from server.js and adds a few
 * extra sanity checks.  Returns a warnings array (empty = clean).
 * Does NOT throw; callers decide whether warnings are fatal.
 */

import { toNum } from './normalize.js'
import {
  BALANCE_SHEET_GAP_THRESHOLD,
  NET_INCOME_TO_REVENUE_MAX,
} from './extractionSchema.js'

/**
 * @param {Object} analysis  Full analysis object (as returned by /analyze)
 * @returns {string[]}       Human-readable warning strings
 */
export function check(analysis) {
  const is_     = analysis.income_statement || {}
  const bs_     = analysis.balance_sheet    || {}
  const years   = analysis.financial_years  || []
  const warnings = []

  const g = (sec, k, yr) => {
    const v = sec?.[k]?.[yr]
    if (v == null) return null
    const n = parseFloat(String(v).replace(/,/g, ''))
    return isNaN(n) ? null : n
  }

  for (const yr of years) {
    const rev = g(is_, 'revenue',        yr)
    const ni  = g(is_, 'net_income',     yr)
    const ta  = g(bs_, 'total_assets',   yr)
    const te  = g(bs_, 'total_equity',   yr)
    const tl  = g(bs_, 'total_liabilities', yr)

    // Revenue must not be negative
    if (rev != null && rev < 0) {
      warnings.push(`${yr}: Revenue negative (${rev}) — likely extraction error`)
    }

    // Net income sanity: must not exceed 2× revenue in absolute terms
    if (rev != null && rev > 0 && ni != null && Math.abs(ni) > Math.abs(rev) * NET_INCOME_TO_REVENUE_MAX) {
      warnings.push(`${yr}: Net income (${ni}) exceeds ${NET_INCOME_TO_REVENUE_MAX}× revenue (${rev}) — likely extraction error`)
    }

    // Balance sheet: Assets ≈ Liabilities + Equity
    if (ta != null && ta > 0 && te != null && tl != null) {
      const diff = Math.abs(ta - (te + tl))
      if (diff / ta > BALANCE_SHEET_GAP_THRESHOLD) {
        warnings.push(`${yr}: Balance sheet gap ${diff.toFixed(0)} lakhs (${(diff / ta * 100).toFixed(1)}% of assets)`)
      }
    }

    // Total assets must be positive if reported
    if (ta != null && ta <= 0) {
      warnings.push(`${yr}: Total assets non-positive (${ta}) — likely extraction error`)
    }

    // EBITDA should be ≥ EBIT if both present (depreciation cannot be negative)
    const ebitda = g(is_, 'ebitda', yr)
    const ebit   = g(is_, 'ebit',   yr)
    if (ebitda != null && ebit != null && ebit > ebitda) {
      warnings.push(`${yr}: EBIT (${ebit}) > EBITDA (${ebitda}) — depreciation would be negative`)
    }
  }

  return warnings
}
