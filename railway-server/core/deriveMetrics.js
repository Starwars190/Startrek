/**
 * deriveMetrics.js
 *
 * Pure port of calculateRatios() from server.js.
 * Input/output shape is IDENTICAL — any code that calls calculateRatios can
 * call deriveRatios with the same arguments and get the same result.
 *
 * Intentionally kept as a faithful 1-to-1 translation so that the pipeline
 * diff test can verify bit-exact parity before server.js is touched.
 */

import { toNum, div, pct, growthPct } from './normalize.js'
import { getField, getRetainedEarnings, getTotalLiabilities } from './extractFinancials.js'

/**
 * @param {Object} data  Full analysis object (as returned by /analyze)
 * @returns {Object}     { [year]: { [ratioName]: number|null } }
 */
export function deriveRatios(data) {
  const years  = data.financial_years || []
  const is_    = data.income_statement || {}
  const bs_    = data.balance_sheet    || {}
  const cf_    = data.cash_flow        || {}
  const result = {}

  for (const yr of years) {
    const g = (sec, k) => getField(sec, k, yr)

    const rev    = g(is_, 'revenue')
    const gp     = g(is_, 'gross_profit')
    const ebitda = g(is_, 'ebitda')
    const ebit   = g(is_, 'ebit')
    const ni     = g(is_, 'net_income')
    const ie     = g(is_, 'interest_expense')
    const cogs   = g(is_, 'cost_of_goods_sold')

    const ta   = g(bs_, 'total_assets')
    const ca   = g(bs_, 'total_current_assets')
    const cl   = g(bs_, 'total_current_liabilities')
    const inv  = g(bs_, 'inventory')
    const ar   = g(bs_, 'accounts_receivable')
    const ap   = g(bs_, 'accounts_payable')
    const cash = g(bs_, 'cash_equivalents')
    const eq   = g(bs_, 'total_equity')
    const ltd  = g(bs_, 'long_term_debt')
    const std  = g(bs_, 'short_term_debt')
    const fa   = g(bs_, 'fixed_assets_net')

    const cfo   = g(cf_, 'cfo')
    const capex = g(cf_, 'capex')
    const fcf   = g(cf_, 'free_cash_flow')

    const debt    = ltd != null && std != null ? ltd + std : (ltd ?? std)
    const netDebt = debt != null && cash != null ? debt - cash : null

    const r = {}

    // ── Profitability ─────────────────────────────────────────────────────────
    r['Gross Margin %']                  = pct(gp, rev)
    r['EBITDA Margin %']                 = pct(ebitda, rev)
    r['EBIT Margin %']                   = pct(ebit, rev)
    r['Net Profit Margin %']             = pct(ni, rev)
    r['Return on Assets %']              = pct(ni, ta)
    r['Return on Equity %']              = (eq != null && eq <= 0) ? 'n.m.' : pct(ni, eq)
    r['Return on Capital Employed %']    = (ebit != null && ta != null && cl != null) ? pct(ebit, ta - cl) : null
    r['Asset Turnover']                  = div(rev, ta)

    // ── Liquidity ─────────────────────────────────────────────────────────────
    r['Current Ratio']                   = div(ca, cl)
    r['Quick Ratio']                     = (ca != null && inv != null) ? div(ca - inv, cl) : div(ca, cl)
    r['Cash Ratio']                      = div(cash, cl)
    r['Operating CF Ratio']              = div(cfo, cl)

    // ── Leverage ──────────────────────────────────────────────────────────────
    r['Debt to Equity']                  = (eq != null && eq <= 0) ? 'n.m.' : div(debt, eq)
    r['Total Debt to Assets %']          = pct(debt, ta)
    r['Equity Ratio %']                  = pct(eq, ta)
    r['Debt to EBITDA']                  = div(debt, ebitda)
    r['Net Debt to EBITDA']              = div(netDebt, ebitda)
    r['Interest Cover (EBIT)']           = div(ebit, ie)
    r['Interest Cover (EBITDA)']         = div(ebitda, ie)

    // ── Efficiency ────────────────────────────────────────────────────────────
    r['Inventory Days']       = (inv != null && cogs != null) ? Math.round(div(inv, cogs) * 365 * 10) / 10 : null
    r['Receivables Days (DSO)'] = (ar  != null && rev  != null) ? Math.round(div(ar, rev)  * 365 * 10) / 10 : null
    r['Payables Days (DPO)']  = (ap  != null && cogs != null) ? Math.round(div(ap, cogs) * 365 * 10) / 10 : null
    r['Fixed Asset Turnover'] = div(rev, fa)

    // ── Cash flow ─────────────────────────────────────────────────────────────
    r['FCF Margin %']         = pct(fcf, rev)
    r['Capex to Revenue %']   = pct(capex, rev)
    r['CFO to Net Income']    = div(cfo, ni)

    // ── Altman Z-Score (private-company Z' model) ─────────────────────────────
    const re  = getRetainedEarnings(bs_, yr, eq)
    const tl_ = getTotalLiabilities(bs_, yr, cl, ta, eq)
    const wc  = (ca != null && cl != null) ? ca - cl : null

    if (wc != null && re != null && ebit != null && eq != null &&
        tl_ != null && rev != null && ta != null && ta > 0 && tl_ > 0) {
      const A = wc   / ta
      const B = re   / ta
      const C = ebit / ta
      const D = eq   / tl_
      const E = rev  / ta
      const z = Math.round(((0.717 * A) + (0.847 * B) + (3.107 * C) + (0.420 * D) + (0.998 * E)) * 100) / 100
      r['Altman Z-Score'] = z
      r['Altman Zone']    = z >= 2.0 ? 'Safe Zone' : z >= 1.23 ? 'Grey Zone' : 'Distress Zone'
      r['Credit Rating']  = z >= 5.0 ? 'AAA' : z >= 4.0 ? 'AA' : z >= 3.0 ? 'A' : z >= 2.9 ? 'BBB' : z >= 2.0 ? 'BB' : z >= 1.23 ? 'B' : 'D'
    } else {
      r['Altman Z-Score'] = null
      r['Altman Zone']    = null
      r['Credit Rating']  = null
    }

    // ── YoY growth ────────────────────────────────────────────────────────────
    // Sort ascending so FY2024 is always "before" FY2025, regardless of input order
    const sortedYears = [...years].sort()
    const prevYr = sortedYears[sortedYears.indexOf(yr) - 1]
    if (prevYr) {
      const gp2 = (sec, k) => getField(sec, k, prevYr)
      r['Revenue Growth %']    = growthPct(rev,    gp2(is_, 'revenue'))
      r['Net Income Growth %'] = growthPct(ni,     gp2(is_, 'net_income'))
      r['EBITDA Growth %']     = growthPct(ebitda, gp2(is_, 'ebitda'))
    }

    result[yr] = r
  }

  return result
}
