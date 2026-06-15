/**
 * extractionSchema.js
 *
 * Canonical field lists and section names for the FinSight analysis JSON
 * produced by the /analyze endpoint.  All other core modules reference these
 * constants so that renaming a field is a one-line change here.
 */

export const SECTIONS = Object.freeze({
  INCOME:   'income_statement',
  BALANCE:  'balance_sheet',
  CASHFLOW: 'cash_flow',
  PROFILE:  'company_profile',
})

export const INCOME_FIELDS = Object.freeze([
  'revenue',
  'cost_of_goods_sold',
  'gross_profit',
  'operating_expenses',
  'ebitda',
  'depreciation_amortization',
  'ebit',
  'interest_expense',
  'pbt',
  'tax',
  'net_income',
])

export const BALANCE_FIELDS = Object.freeze([
  'cash_equivalents',
  'accounts_receivable',
  'inventory',
  'total_current_assets',
  'fixed_assets_net',
  'intangibles_goodwill',
  'total_assets',
  'accounts_payable',
  'short_term_debt',
  'total_current_liabilities',
  'long_term_debt',
  'total_liabilities',
  'share_capital',
  'retained_earnings',
  'total_equity',
])

export const CASHFLOW_FIELDS = Object.freeze([
  'cfo',
  'cfi',
  'cff',
  'capex',
  'free_cash_flow',
])

// Field-alias chains for multi-name lookups (first hit wins).
export const RETAINED_EARNINGS_ALIASES = Object.freeze([
  'retained_earnings',
  'reserves_surplus',
  'reserves_and_surplus',
  'reserves_and_surplus_balance',
  // final fallback: total_equity — handled by caller, not listed here
])

export const TOTAL_LIABILITIES_ALIASES = Object.freeze([
  'total_liabilities',
  'total_liabilities_net',
  // computed variants handled by caller
])

// Integrity thresholds
export const BALANCE_SHEET_GAP_THRESHOLD = 0.15  // 15 %
export const NET_INCOME_TO_REVENUE_MAX    = 2.00  // net income must not exceed 2× revenue
