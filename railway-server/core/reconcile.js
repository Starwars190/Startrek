/**
 * reconcile.js
 *
 * Adapter between normalize() output and the analysis object expected by
 * validateFinancials / deriveMetrics.  Reserved for future derived-field
 * filling (e.g. gross_profit = revenue − cogs when null).
 *
 * @param {{ lineItems: Object, meta: Object, flags: string[] }} normalized
 * @returns {Object}  The analysis object (lineItems), ready for check() / deriveRatios()
 */
export function reconcile({ lineItems }) {
  return lineItems
}
