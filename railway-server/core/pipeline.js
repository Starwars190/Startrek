/**
 * pipeline.js
 *
 * Orchestrates the full post-extraction pipeline:
 *   extract → integrity-check → derive metrics → return
 *
 * The `run` function is a drop-in replacement for the inline logic in
 * server.js — same input shape, same output shape.
 */

import { deriveRatios }  from './deriveMetrics.js'
import { check, identityGate } from './financialIntegrity.js'
import { summariseCFM }  from './cfm.js'
import { getField }      from './extractFinancials.js'

/**
 * Run the full pipeline on a parsed analysis object.
 *
 * @param {Object} analysis  As returned by the /analyze endpoint
 * @returns {{
 *   ratiosByYear: Object,   // same shape as calculateRatios() in server.js
 *   warnings:    string[],  // integrity warnings (non-fatal)
 *   cfmByYear:   Object,    // working-capital / MPBF per year
 * }}
 */
export function run(analysis) {
  if (!analysis || typeof analysis !== 'object') {
    throw new TypeError('pipeline.run: analysis must be a non-null object')
  }

  const warnings        = check(analysis)
  const validationFlags = identityGate(analysis)
  const ratiosByYear    = deriveRatios(analysis)
  const cfmByYear       = _deriveCFM(analysis, ratiosByYear)

  return { ratiosByYear, warnings, validationFlags, cfmByYear }
}

// ── internal ─────────────────────────────────────────────────────────────────

function _deriveCFM(analysis, ratiosByYear) {
  const years  = analysis.financial_years || []
  const is_    = analysis.income_statement || {}
  const bs_    = analysis.balance_sheet    || {}

  const result = {}
  for (const yr of years) {
    const g = (sec, k) => getField(sec, k, yr)
    const ca         = g(bs_, 'total_current_assets')
    const cl         = g(bs_, 'total_current_liabilities')
    const ap         = g(bs_, 'accounts_payable')
    const ar         = g(bs_, 'accounts_receivable')
    const inv        = g(bs_, 'inventory')
    const equity     = g(bs_, 'total_equity')
    const ltd        = g(bs_, 'long_term_debt')
    const fixedAssets = g(bs_, 'fixed_assets_net')
    const rev        = g(is_, 'revenue')
    const cogs       = g(is_, 'cost_of_goods_sold')

    // Days from ratiosByYear (already computed)
    const ratios = ratiosByYear?.[yr] || {}  // forward reference safe: ratiosByYear built above
    const dso = ratios['Receivables Days (DSO)'] ?? null
    const dio = ratios['Inventory Days']          ?? null
    const dpo = ratios['Payables Days (DPO)']     ?? null

    result[yr] = summariseCFM({ ca, cl, ap, equity, ltd, fixedAssets, dso, dio, dpo })
  }
  return result
}
