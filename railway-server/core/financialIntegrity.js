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

/**
 * Accounting identity gate — soft checks per year.
 * Returns validation_flags array (non-fatal; callers include in 200 response).
 *
 * Tolerance per check: max(1 lakh, 0.5% of the expected value).
 *
 * @param {Object} analysis  Full analysis object
 * @returns {{ check: string, fy: string, expected: number, got: number }[]}
 */
export function identityGate(analysis) {
  const is_   = analysis.income_statement || {}
  const bs_   = analysis.balance_sheet    || {}
  const cf_   = analysis.cash_flow        || {}
  const years = analysis.financial_years  || []
  const flags = []

  const g = (sec, k, yr) => {
    const v = sec?.[k]?.[yr]
    if (v == null) return null
    const n = parseFloat(String(v).replace(/,/g, ''))
    return isNaN(n) ? null : n
  }

  const tol = (expected) => Math.max(1, Math.abs(expected) * 0.005)

  const check = (name, fy, expected, got) => {
    if (expected == null || got == null) return
    if (Math.abs(got - expected) > tol(expected)) {
      flags.push({
        check: name,
        fy,
        expected: Math.round(expected * 100) / 100,
        got:      Math.round(got      * 100) / 100,
      })
    }
  }

  for (const yr of years) {
    const ta  = g(bs_, 'total_assets',             yr)
    const tl  = g(bs_, 'total_liabilities',        yr)
    const te  = g(bs_, 'total_equity',             yr)
    const ni  = g(is_, 'net_income',               yr)
    const pbt = g(is_, 'pbt',                      yr)
    const tax = g(is_, 'tax',                      yr)
    const ebit   = g(is_, 'ebit',                  yr)
    const ie     = g(is_, 'interest_expense',      yr)
    const ebitda = g(is_, 'ebitda',                yr)
    const depn   = g(is_, 'depreciation_amortization', yr)
    const gp     = g(is_, 'gross_profit',          yr)
    const rev    = g(is_, 'revenue',               yr)
    const cogs   = g(is_, 'cost_of_goods_sold',    yr)
    const cfo    = g(cf_, 'cfo',  yr)
    const cfi    = g(cf_, 'cfi',  yr)
    const cff    = g(cf_, 'cff',  yr)

    // 1. total_assets == total_liabilities + total_equity
    if (ta != null && tl != null && te != null) {
      check('total_assets == total_liabilities + total_equity', yr, tl + te, ta)
    }

    // 2. PAT == PBT - tax
    if (ni != null && pbt != null && tax != null) {
      check('PAT == PBT - tax', yr, pbt - tax, ni)
    }

    // 3. EBIT == PBT + finance_costs
    if (ebit != null && pbt != null && ie != null) {
      check('EBIT == PBT + finance_costs', yr, pbt + ie, ebit)
    }

    // 4. EBITDA == EBIT + depreciation + amortisation
    if (ebitda != null && ebit != null && depn != null) {
      check('EBITDA == EBIT + depreciation + amortisation', yr, ebit + depn, ebitda)
    }

    // 5. gross_profit == revenue - cogs
    if (gp != null && rev != null && cogs != null) {
      check('gross_profit == revenue - cogs', yr, rev - cogs, gp)
    }

    // 6. revenue == product_revenue + service_revenue (only if both components present)
    const prodRev = g(is_, 'product_revenue', yr)
    const svcRev  = g(is_, 'service_revenue', yr)
    if (rev != null && prodRev != null && svcRev != null) {
      check('revenue == product_revenue + service_revenue', yr, prodRev + svcRev, rev)
    }

    // 7. opening_cash + cfo + cfi + cff == closing_cash (only if all fields present)
    const openCash  = g(bs_, 'opening_cash_equivalents', yr)
    const closeCash = g(bs_, 'closing_cash_equivalents', yr)
    if (openCash != null && cfo != null && cfi != null && cff != null && closeCash != null) {
      check('opening_cash + cfo + cfi + cff == closing_cash', yr, openCash + cfo + cfi + cff, closeCash)
    }
  }

  return flags
}
