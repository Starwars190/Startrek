/**
 * cfm.js  —  Cash-Flow & Working-Capital Management
 *
 * Implements the Tandon Committee MPBF (Maximum Permissible Bank Finance)
 * calculation and related working-capital metrics used in Indian credit analysis.
 *
 * All functions are pure and unit-testable.
 */

import { toNum, div, round2 } from './normalize.js'

/**
 * Working capital = Current Assets − Current Liabilities.
 * Returns null if either input is null.
 */
export function computeWorkingCapital(ca, cl) {
  if (ca == null || cl == null) return null
  return round2(ca - cl)
}

/**
 * Tandon Committee Method I (simplified):
 *   MPBF = 0.75 × (CA − Core Current Assets)
 *
 * Where Core Current Assets (CCA) is approximated as Trade Payables (AP),
 * i.e. the portion of current assets self-financed by suppliers.
 * If AP is not supplied, CCA defaults to zero (conservative).
 *
 * Returns null when CA is unavailable.
 *
 * @param {number|null} ca   Total current assets
 * @param {number|null} ap   Trade payables / accounts payable (optional)
 * @returns {number|null}
 */
export function computeMPBF(ca, ap = null) {
  if (ca == null) return null
  const cca = ap != null ? Math.max(0, ap) : 0
  return round2(0.75 * (ca - cca))
}

/**
 * Net Working Capital (Equity − Long-term Debt approach):
 *   NWC = Total Equity + Long-term Debt − Fixed Assets
 *
 * Indicates the long-term capital available to fund current operations.
 * Returns null when any input is null.
 */
export function computeNWC(equity, ltd, fixedAssets) {
  if (equity == null || ltd == null || fixedAssets == null) return null
  return round2(equity + ltd - fixedAssets)
}

/**
 * Cash Conversion Cycle (days):
 *   CCC = DSO + DIO − DPO
 *
 * All inputs in days (use the output of receivables/inventory/payables
 * days from deriveMetrics).  Returns null when any component is null.
 */
export function computeCCC(dso, dio, dpo) {
  if (dso == null || dio == null || dpo == null) return null
  return round2(dso + dio - dpo)
}

/**
 * Working-capital summary for a single year.
 * Convenience wrapper that calls the individual helpers.
 *
 * @param {{ ca, cl, ap, equity, ltd, fixedAssets, dso, dio, dpo }} fields
 * @returns {{ workingCapital, mpbf, nwc, ccc }}
 */
export function summariseCFM({ ca, cl, ap, equity, ltd, fixedAssets, dso, dio, dpo } = {}) {
  return {
    workingCapital: computeWorkingCapital(ca, cl),
    mpbf:          computeMPBF(ca, ap),
    nwc:           computeNWC(equity, ltd, fixedAssets),
    ccc:           computeCCC(dso, dio, dpo),
  }
}
