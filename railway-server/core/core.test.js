/**
 * core.test.js  —  20 unit tests for railway-server/core/
 *
 * Run with:  node railway-server/core/core.test.js
 *
 * Uses only Node.js built-ins (assert, process) — no test framework required.
 */

import assert from 'assert/strict'
import { toNum, div, pct, round2, growthPct }       from './normalize.js'
import { getField, resolveAliases,
         getRetainedEarnings, getTotalLiabilities }  from './extractFinancials.js'
import { deriveRatios }                              from './deriveMetrics.js'
import { check }                                     from './financialIntegrity.js'
import { computeWorkingCapital, computeMPBF,
         computeNWC, computeCCC }                    from './cfm.js'
import { run }                                       from './pipeline.js'

// ── helpers ───────────────────────────────────────────────────────────────────
let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓  ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗  ${name}`)
    console.error(`     ${err.message}`)
    failed++
  }
}

// ── normalize.js (6 tests) ────────────────────────────────────────────────────
console.log('\nnormalize.js')

test('toNum parses comma-formatted number string', () => {
  assert.strictEqual(toNum('1,234.56'), 1234.56)
})

test('toNum returns null for null input', () => {
  assert.strictEqual(toNum(null), null)
})

test('toNum returns null for non-numeric string', () => {
  assert.strictEqual(toNum('N/A'), null)
})

test('div divides and rounds to 4 decimal places', () => {
  assert.strictEqual(div(1, 3), 0.3333)
})

test('div returns null when divisor is zero', () => {
  assert.strictEqual(div(10, 0), null)
})

test('pct computes percentage correctly', () => {
  assert.strictEqual(pct(25, 100), 25)
  assert.strictEqual(pct(1, 4), 25)
})

// ── extractFinancials.js (3 tests) ───────────────────────────────────────────
console.log('\nextractFinancials.js')

test('getField retrieves a value from section/year', () => {
  const section = { revenue: { FY2025: '73,698' } }
  assert.strictEqual(getField(section, 'revenue', 'FY2025'), 73698)
})

test('getField returns null for a missing year', () => {
  const section = { revenue: { FY2025: 1000 } }
  assert.strictEqual(getField(section, 'revenue', 'FY2023'), null)
})

test('resolveAliases returns the first alias that has a value', () => {
  const section = {
    reserves_and_surplus: { FY2025: 500 },
    retained_earnings:    { FY2025: null },
  }
  const aliases = ['retained_earnings', 'reserves_surplus', 'reserves_and_surplus']
  assert.strictEqual(resolveAliases(section, aliases, 'FY2025'), 500)
})

// ── deriveMetrics.js (6 tests) ────────────────────────────────────────────────
console.log('\nderiveMetrics.js')

const minAnalysis = {
  financial_years: ['FY2025', 'FY2024'],
  income_statement: {
    revenue:             { FY2025: 10000, FY2024: 8000 },
    gross_profit:        { FY2025: 4000,  FY2024: 3000 },
    ebitda:              { FY2025: 2000,  FY2024: 1600 },
    ebit:                { FY2025: 1600,  FY2024: 1200 },
    interest_expense:    { FY2025: 400,   FY2024: 400  },
    net_income:          { FY2025: 900,   FY2024: 700  },
    cost_of_goods_sold:  { FY2025: 6000,  FY2024: 5000 },
    depreciation_amortization: { FY2025: 400, FY2024: 400 },
    pbt: { FY2025: 1200, FY2024: 800 },
    tax: { FY2025: 300,  FY2024: 100 },
    operating_expenses: { FY2025: 2000, FY2024: 1400 },
  },
  balance_sheet: {
    total_current_assets:      { FY2025: 5000, FY2024: 4000 },
    total_current_liabilities: { FY2025: 2000, FY2024: 1800 },
    inventory:                 { FY2025: 1000, FY2024: 900  },
    accounts_receivable:       { FY2025: 1500, FY2024: 1200 },
    accounts_payable:          { FY2025: 800,  FY2024: 700  },
    cash_equivalents:          { FY2025: 500,  FY2024: 400  },
    total_assets:              { FY2025: 12000, FY2024: 10000 },
    total_equity:              { FY2025: 6000,  FY2024: 5000  },
    total_liabilities:         { FY2025: 6000,  FY2024: 5000  },
    long_term_debt:            { FY2025: 3000,  FY2024: 2500  },
    short_term_debt:           { FY2025: 1000,  FY2024: 800   },
    fixed_assets_net:          { FY2025: 5000,  FY2024: 4500  },
    retained_earnings:         { FY2025: 4000,  FY2024: 3200  },
    share_capital:             { FY2025: 2000,  FY2024: 1800  },
  },
  cash_flow: {
    cfo:            { FY2025: 1200, FY2024: 1000 },
    cfi:            { FY2025: -800, FY2024: -600 },
    cff:            { FY2025: -200, FY2024: -100 },
    capex:          { FY2025: 700,  FY2024: 500  },
    free_cash_flow: { FY2025: 500,  FY2024: 500  },
  },
}

test('Current Ratio = CA / CL', () => {
  const ratios = deriveRatios(minAnalysis)
  // 5000 / 2000 = 2.5
  assert.strictEqual(ratios['FY2025']['Current Ratio'], 2.5)
})

test('EBITDA Margin % = EBITDA / Revenue × 100', () => {
  const ratios = deriveRatios(minAnalysis)
  // 2000 / 10000 × 100 = 20
  assert.strictEqual(ratios['FY2025']['EBITDA Margin %'], 20)
})

test('Altman Z-Score falls in Safe Zone for healthy company', () => {
  const ratios = deriveRatios(minAnalysis)
  const z = ratios['FY2025']['Altman Z-Score']
  assert.ok(z != null, 'Altman Z-Score should be computable')
  assert.strictEqual(ratios['FY2025']['Altman Zone'], 'Safe Zone')
})

test('Altman Z-Score is null when current assets are missing', () => {
  const noCA = JSON.parse(JSON.stringify(minAnalysis))
  delete noCA.balance_sheet.total_current_assets
  delete noCA.balance_sheet.total_current_liabilities
  const ratios = deriveRatios(noCA)
  assert.strictEqual(ratios['FY2025']['Altman Z-Score'], null)
})

test('Revenue Growth % computed correctly for second year', () => {
  const ratios = deriveRatios(minAnalysis)
  // (10000 - 8000) / 8000 * 100 = 25
  assert.strictEqual(ratios['FY2025']['Revenue Growth %'], 25)
})

test('Debt = LTD + STD when both present', () => {
  const ratios = deriveRatios(minAnalysis)
  // debt = 3000 + 1000 = 4000; eq = 6000; D/E = 4000/6000
  assert.strictEqual(ratios['FY2025']['Debt to Equity'], div(4000, 6000))
})

// ── financialIntegrity.js (3 tests) ──────────────────────────────────────────
console.log('\nfinancialIntegrity.js')

test('warns when revenue is negative', () => {
  const a = JSON.parse(JSON.stringify(minAnalysis))
  a.income_statement.revenue['FY2025'] = -100
  const w = check(a)
  assert.ok(w.some(s => s.includes('Revenue negative')), `Expected revenue warning, got: ${w}`)
})

test('warns when balance sheet gap exceeds 15 %', () => {
  const a = JSON.parse(JSON.stringify(minAnalysis))
  // Assets 12000, equity 6000, liabilities deliberately wrong → gap = 4000 (33%)
  a.balance_sheet.total_liabilities['FY2025'] = 2000
  const w = check(a)
  assert.ok(w.some(s => s.includes('Balance sheet gap')), `Expected balance sheet warning, got: ${w}`)
})

test('returns no warnings for a clean balanced analysis', () => {
  const w = check(minAnalysis)
  // minAnalysis is balanced: assets 12000 = equity 6000 + liabilities 6000
  assert.strictEqual(w.length, 0, `Expected 0 warnings, got: ${JSON.stringify(w)}`)
})

// ── cfm.js (2 tests) ─────────────────────────────────────────────────────────
console.log('\ncfm.js')

test('computeMPBF = 0.75 × (CA − AP)', () => {
  // CA=5000, AP=800 → 0.75 * 4200 = 3150
  assert.strictEqual(computeMPBF(5000, 800), 3150)
})

test('computeMPBF returns null when CA is null', () => {
  assert.strictEqual(computeMPBF(null, 800), null)
})

// ── pipeline.js (end-to-end) (2 tests) ───────────────────────────────────────
console.log('\npipeline.js')

test('run() returns ratiosByYear with entries for each year', () => {
  const { ratiosByYear } = run(minAnalysis)
  assert.ok(typeof ratiosByYear === 'object')
  assert.ok('FY2025' in ratiosByYear)
  assert.ok('FY2024' in ratiosByYear)
})

test('run() returns warnings array (empty for clean data)', () => {
  const { warnings } = run(minAnalysis)
  assert.ok(Array.isArray(warnings))
  assert.strictEqual(warnings.length, 0)
})

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`)
console.log(`  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`)
console.log()
if (failed > 0) process.exit(1)
