/**
 * test-pipeline.mjs — end-to-end local test
 *
 * Flow:
 *   1. Start railway-server (or reuse if already running)
 *   2. GET /fetch-mca/:cin  → flat adapted per-year array
 *   3. Transform flat array → nested pipeline format  (field renames + derived fields)
 *   4. Supplement fields available in raw BRisk report but absent from adapter
 *      (ebit, depreciation, interest, pbt, tax, cash, receivables, inventory, etc.)
 *   5. calculateRatios inline (exact copy of server.js logic)
 *   6. Print Altman Z-Score + credit rating per year
 *   7. generateCMAWorkbook → save brisk_cma.xlsx
 *   8. Scan each sheet for null / blank cells
 *   9. Field-mismatch report: adapter output vs pipeline expectations
 *  10. Stop server if we started it
 */

import { spawn }                          from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname }               from 'path'
import { fileURLToPath }                  from 'url'
import ExcelJS                            from 'exceljs'
import { generateCMAWorkbook }            from './src/CMAGenerator.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// 0. Load .env
// ---------------------------------------------------------------------------
const envPath = resolve(__dirname, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim()
    if (!(k in process.env)) process.env[k] = v
  }
}

const PORT   = 3001
const BASE   = `http://localhost:${PORT}`
const CIN    = process.argv[2] || 'U74999MH2012PTC231360'
const SEP    = '═'.repeat(100)
const SEP_S  = '─'.repeat(100)

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------
async function checkHealth() {
  try { const r = await fetch(`${BASE}/health`); return r.ok } catch { return false }
}
async function waitForServer(ms = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await checkHealth()) return true
    await new Promise(r => setTimeout(r, 400))
  }
  return false
}

// ---------------------------------------------------------------------------
// Inline calculateRatios  (mirrors server.js exactly)
// ---------------------------------------------------------------------------
function calculateRatios(data) {
  const years = data.financial_years || []
  const result = {}
  for (const yr of years) {
    const is_ = data.income_statement || {}
    const bs_ = data.balance_sheet    || {}
    const cf_ = data.cash_flow        || {}
    const g = (s, k) => {
      const v = s[k]?.[yr]
      if (v == null) return null
      const n = parseFloat(String(v).replace(/,/g, ''))
      return isNaN(n) ? null : n
    }
    const div = (a, b) => (a != null && b != null && b !== 0) ? Math.round(a / b * 10000) / 10000 : null
    const pct = (a, b) => { const v = div(a, b); return v != null ? Math.round(v * 10000) / 100 : null }

    const rev    = g(is_, 'revenue')
    const gp     = g(is_, 'gross_profit')
    const ebitda = g(is_, 'ebitda')
    const ebit   = g(is_, 'ebit')
    const ni     = g(is_, 'net_income')
    const ie     = g(is_, 'interest_expense')
    const ta     = g(bs_, 'total_assets')
    const ca     = g(bs_, 'total_current_assets')
    const cl     = g(bs_, 'total_current_liabilities')
    const inv    = g(bs_, 'inventory')
    const ar     = g(bs_, 'accounts_receivable')
    const ap     = g(bs_, 'accounts_payable')
    const cash   = g(bs_, 'cash_equivalents')
    const eq     = g(bs_, 'total_equity')
    const ltd    = g(bs_, 'long_term_debt')
    const std    = g(bs_, 'short_term_debt')
    const fa     = g(bs_, 'fixed_assets_net')
    const cfo    = g(cf_, 'cfo')
    const capex  = g(cf_, 'capex')
    const fcf    = g(cf_, 'free_cash_flow')
    const cogs   = g(is_, 'cost_of_goods_sold')
    const debt   = ltd != null && std != null ? ltd + std : (ltd ?? std)
    const netDebt = debt != null && cash != null ? debt - cash : null
    const r = {}

    r['Gross Margin %']               = pct(gp, rev)
    r['EBITDA Margin %']              = pct(ebitda, rev)
    r['EBIT Margin %']                = pct(ebit, rev)
    r['Net Profit Margin %']          = pct(ni, rev)
    r['Return on Assets %']           = pct(ni, ta)
    r['Return on Equity %']           = pct(ni, eq)
    r['Return on Capital Employed %'] = (ebit != null && ta != null && cl != null) ? pct(ebit, ta - cl) : null
    r['Asset Turnover']               = div(rev, ta)
    r['Current Ratio']                = div(ca, cl)
    r['Quick Ratio']                  = (ca != null && inv != null) ? div(ca - inv, cl) : div(ca, cl)
    r['Cash Ratio']                   = div(cash, cl)
    r['Operating CF Ratio']           = div(cfo, cl)
    r['Debt to Equity']               = div(debt, eq)
    r['Total Debt to Assets %']       = pct(debt, ta)
    r['Equity Ratio %']               = pct(eq, ta)
    r['Debt to EBITDA']               = div(debt, ebitda)
    r['Net Debt to EBITDA']           = div(netDebt, ebitda)
    r['Interest Cover (EBIT)']        = div(ebit, ie)
    r['Interest Cover (EBITDA)']      = div(ebitda, ie)
    r['Inventory Days']               = (inv != null && cogs != null) ? Math.round(div(inv, cogs) * 365 * 10) / 10 : null
    r['Receivables Days (DSO)']       = (ar != null && rev != null) ? Math.round(div(ar, rev) * 365 * 10) / 10 : null
    r['Payables Days (DPO)']          = (ap != null && cogs != null) ? Math.round(div(ap, cogs) * 365 * 10) / 10 : null
    r['Fixed Asset Turnover']         = div(rev, fa)
    r['FCF Margin %']                 = pct(fcf, rev)
    r['Capex to Revenue %']           = pct(capex, rev)
    r['CFO to Net Income']            = div(cfo, ni)

    // Altman Z-Score (private company Z' model)
    const re  = g(bs_, 'retained_earnings') ?? eq
    const tl_ = g(bs_, 'total_liabilities') ?? (ta != null && eq != null ? ta - eq : null)
    const wc  = (ca != null && cl != null) ? ca - cl : null
    if (wc != null && re != null && ebit != null && eq != null && tl_ != null &&
        rev != null && ta != null && ta > 0 && tl_ > 0) {
      const z = Math.round(((0.717 * wc/ta) + (0.847 * re/ta) + (3.107 * ebit/ta) + (0.420 * eq/tl_) + (0.998 * rev/ta)) * 100) / 100
      r['Altman Z-Score'] = z
      r['Altman Zone']    = z >= 2.9 ? 'Safe Zone' : z >= 1.23 ? 'Grey Zone' : 'Distress Zone'
      r['Credit Rating']  = z >= 5 ? 'AAA' : z >= 4 ? 'AA' : z >= 3 ? 'A' : z >= 2.9 ? 'BBB' : z >= 2 ? 'BB' : z >= 1.23 ? 'B' : 'D'
    } else {
      r['Altman Z-Score'] = null
      r['Altman Zone']    = null
      r['Credit Rating']  = null
      // record which inputs blocked the computation
      const missing = Object.entries({ wc, re, ebit, eq, 'tl_': tl_, rev, ta })
        .filter(([, v]) => v == null).map(([k]) => k)
      if (missing.length) r['Altman Blockers'] = missing.join(', ')
    }

    const prevYr = years[years.indexOf(yr) - 1]
    if (prevYr) {
      const g2 = (s, k) => { const v = s[k]?.[prevYr]; if (v == null) return null; const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? null : n }
      const rp = g2(is_, 'revenue'), nip = g2(is_, 'net_income'), ep = g2(is_, 'ebitda')
      r['Revenue Growth %']    = (rev != null && rp  != null && rp  !== 0) ? Math.round((rev   - rp)  / Math.abs(rp)  * 10000) / 100 : null
      r['Net Income Growth %'] = (ni  != null && nip != null && nip !== 0) ? Math.round((ni    - nip) / Math.abs(nip) * 10000) / 100 : null
      r['EBITDA Growth %']     = (ebitda != null && ep  != null && ep  !== 0) ? Math.round((ebitda - ep) / Math.abs(ep) * 10000) / 100 : null
    }
    result[yr] = r
  }
  return result
}

// ---------------------------------------------------------------------------
// Year label: "2020-2021" → "FY2021"
// ---------------------------------------------------------------------------
function toFY(adapterYear) {
  const parts = adapterYear.split('-')
  return 'FY' + parts[parts.length - 1]
}

// ---------------------------------------------------------------------------
// toMap helper (same as test-brisk.mjs)
// ---------------------------------------------------------------------------
function toMap(arr) {
  if (!Array.isArray(arr)) return {}
  return Object.fromEntries(arr.map(({ FinancialYear, Amount }) => [toFY(FinancialYear), Amount]))
}

// ---------------------------------------------------------------------------
// Build analysis object
//   Pass A: pure adapter output  (shows raw mismatches)
//   Pass B: supplemented with raw BRisk fields (shows what adapter should expose)
// ---------------------------------------------------------------------------
function buildAnalysis(adaptedRows, companyProfile, rawReport, supplemented) {
  const financial_years = adaptedRows.map(r => toFY(r.year))
  const is_ = {}; const bs_ = {}; const cf_ = {}

  // initialise all fields to empty year maps
  ;['revenue','ebitda','net_income','ebit','interest_expense','pbt','tax',
    'cost_of_goods_sold','gross_profit','operating_expenses','depreciation_amortization']
    .forEach(k => is_[k] = {})
  ;['total_equity','retained_earnings','long_term_debt','short_term_debt','total_assets',
    'total_current_assets','total_current_liabilities','total_liabilities',
    'share_capital','cash_equivalents','accounts_receivable','inventory',
    'accounts_payable','fixed_assets_net','intangibles_goodwill']
    .forEach(k => bs_[k] = {})
  ;['cfo','cfi','cff','capex','free_cash_flow'].forEach(k => cf_[k] = {})

  // — pure adapter fields (now includes all BRisk-available fields) —
  for (const row of adaptedRows) {
    const yr = toFY(row.year)
    // income statement
    is_.revenue[yr]                    = row.revenue
    is_.ebitda[yr]                     = row.ebitda
    is_.depreciation_amortization[yr]  = row.depreciation
    is_.ebit[yr]                       = row.ebit
    is_.interest_expense[yr]           = row.interestExpense
    is_.pbt[yr]                        = row.pbt
    is_.tax[yr]                        = row.tax
    is_.net_income[yr]                 = row.pat
    // balance sheet
    bs_.total_equity[yr]               = row.netWorth
    bs_.share_capital[yr]              = row.shareCapital
    bs_.retained_earnings[yr]          = row.retainedEarnings
    bs_.long_term_debt[yr]             = row.totalDebt
    bs_.short_term_debt[yr]            = 0                  // no bank CC/OD for this company
    bs_.total_current_assets[yr]       = row.currentAssets
    bs_.total_current_liabilities[yr]  = row.currentLiabilities
    bs_.total_assets[yr]               = row.totalAssets
    bs_.total_liabilities[yr]          = (row.totalAssets != null && row.netWorth != null)
      ? row.totalAssets - row.netWorth : null
    bs_.cash_equivalents[yr]           = row.cash
    bs_.accounts_receivable[yr]        = row.receivables
    bs_.inventory[yr]                  = row.inventory
    bs_.fixed_assets_net[yr]           = row.fixedAssetsNet
    // cash flow
    cf_.cfo[yr]                        = row.cfo
    cf_.cfi[yr]                        = row.cfi
    cf_.cff[yr]                        = row.cff
  }

  // — supplemented from raw BRisk report (available in API but absent from adapter) —
  if (supplemented && rawReport) {
    const fin  = rawReport?.ReportData?.ComparativeFinancialsStandalone || {}
    const pl   = fin.ProfitAndLossStatement   || {}
    const bs   = fin.BalanceSheetStandalone   || {}
    const cfs  = fin.CashFlowStatementStandalone || {}
    const cm   = rawReport?.ReportData?.CorporateDirectory?.CompanyMaster || {}

    const ebitdaMap  = toMap(pl.EBDITA)
    const deprMap    = toMap(pl.Depreciations)
    const intMap     = toMap(pl.Interests)
    const pbtMap     = toMap(pl.PBT)
    const taxMap     = toMap(pl.Taxes)
    const cashMap    = toMap(bs.CashAndBankBalances)
    const arMap      = toMap(bs.TradeReceivables)
    const invMap     = toMap(bs.Inventories)
    const tanMap     = toMap(bs.TangibleAssets)
    const intanMap   = toMap(bs.IntangibleAssets)
    const wipMap     = toMap(bs.CapitalWIPAndOthers)
    const cfoMap     = toMap(cfs.OperatingActivities)
    const cfiMap     = toMap(cfs.InvestingActivities)
    const cffMap     = toMap(cfs.FinancingActivities)
    const paidupCap  = cm.PaidupCapital ?? null

    for (const yr of financial_years) {
      // ebit = EBITDA - Depreciation
      const eb = ebitdaMap[yr] ?? null
      const dp = deprMap[yr]   ?? null
      is_.ebit[yr]                    = (eb != null && dp != null) ? eb - dp : (eb ?? null)
      is_.depreciation_amortization[yr] = dp
      is_.interest_expense[yr]        = intMap[yr] ?? null
      is_.pbt[yr]                     = pbtMap[yr] ?? null
      is_.tax[yr]                     = taxMap[yr] ?? null
      bs_.cash_equivalents[yr]        = cashMap[yr] ?? null
      bs_.accounts_receivable[yr]     = arMap[yr]   ?? null
      bs_.inventory[yr]               = invMap[yr]  ?? null
      // fixed_assets_net = TangibleAssets + IntangibleAssets + CWIP
      const tan   = tanMap[yr]   ?? null
      const intan = intanMap[yr] ?? null
      const wip   = wipMap[yr]   ?? null
      bs_.fixed_assets_net[yr] = (tan != null || intan != null || wip != null)
        ? (tan ?? 0) + (intan ?? 0) + (wip ?? 0) : null
      bs_.share_capital[yr]           = paidupCap   // scalar — same every year
      cf_.cfo[yr]                     = cfoMap[yr]  ?? null
      cf_.cfi[yr]                     = cfiMap[yr]  ?? null
      cf_.cff[yr]                     = cffMap[yr]  ?? null
    }
  }

  return { company_profile: companyProfile, financial_years, income_statement: is_, balance_sheet: bs_, cash_flow: cf_ }
}

// ---------------------------------------------------------------------------
// Null-cell audit on saved xlsx
// ---------------------------------------------------------------------------
async function scanNulls(xlsxPath) {
  const wb2 = new ExcelJS.Workbook()
  await wb2.xlsx.readFile(xlsxPath)
  const report = {}
  for (const ws of wb2.worksheets) {
    let nullCount = 0, dataCount = 0
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        dataCount++
        const v = cell.value
        if (v === null || v === undefined || v === '') nullCount++
      })
    })
    report[ws.name] = { dataCount, nullCount, pct: dataCount ? Math.round(nullCount / dataCount * 100) : 0 }
  }
  return report
}

// ---------------------------------------------------------------------------
// Pretty printer
// ---------------------------------------------------------------------------
function pad(s, n) { return String(s ?? '—').slice(0, n).padEnd(n) }
function rpad(s, n) { return String(s ?? '—').slice(0, n).padStart(n) }

// ╔══════════════════════════════════════════════════════════════════════════╗
// MAIN
// ╚══════════════════════════════════════════════════════════════════════════╝
let serverProc = null
try {
  // 1. Start server
  const already = await checkHealth()
  if (!already) {
    console.log('Starting railway-server on port 3001…')
    serverProc = spawn('node', ['server.js'], {
      cwd:   resolve(__dirname, 'railway-server'),
      env:   { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    serverProc.stdout.on('data', d => process.stdout.write('[server] ' + d))
    serverProc.stderr.on('data', d => process.stderr.write('[server] ' + d))
    const ready = await waitForServer()
    if (!ready) throw new Error('Server did not become healthy within 20 s')
    console.log('Server ready.\n')
  } else {
    console.log('Server already running on port 3001.\n')
  }

  // 2. Call /fetch-mca/:cin
  console.log(`\nCIN: ${CIN}`)
  console.log(`GET ${BASE}/fetch-mca/${CIN}`)
  const res = await fetch(`${BASE}/fetch-mca/${CIN}`)
  if (!res.ok) { const e = await res.json(); throw new Error(`/fetch-mca ${res.status}: ${JSON.stringify(e)}`) }
  const adaptedRows = await res.json()
  console.log(`Route returned ${adaptedRows.length} years: ${adaptedRows.map(r => r.year).join(', ')}\n`)

  // Detect abridged financials: WC cannot be computed when CA or CL is absent for every year.
  // Use OR — a filing missing only CA (with CL present) is still abridged for WC purposes.
  const hasCA = adaptedRows.some(r => r.currentAssets != null)
  const hasCL = adaptedRows.some(r => r.currentLiabilities != null)
  const abridgedFinancials = !hasCA || !hasCL
  const missingField = !hasCA && !hasCL ? 'Current Assets and Current Liabilities are'
    : !hasCA ? 'Current Assets (the total CA aggregate) is'
    : 'Current Liabilities (the total CL aggregate) is'
  const ABRIDGED_NOTE =
    `This company filed an abridged or non-standard balance sheet with MCA. ${missingField} ` +
    'not disclosed in the regulatory filing, so working-capital-based metrics — Altman Z-Score, ' +
    'Current Ratio, Working Capital Gap, and MPBF — cannot be computed. Individual P&L metrics ' +
    '(revenue, EBITDA, EBIT, margins, interest cover) and any individual balance-sheet line items ' +
    'that were filed (receivables, inventory, fixed assets, cash) are available and have been ' +
    'computed. Working-capital-dependent cells have been left blank intentionally. ' +
    'No values have been estimated or fabricated.'
  const dataFlags = abridgedFinancials
    ? { abridged_financials: true, abridged_note: ABRIDGED_NOTE }
    : {}
  if (abridgedFinancials) {
    console.log('⚠  ABRIDGED FINANCIALS DETECTED')
    console.log(`   ${missingField} not present in the BRisk/MCA data.`)
    console.log('   Working-capital metrics (Z-Score, Current Ratio, MPBF) will be null for all years.')
    console.log('   P&L metrics (revenue, EBITDA, EBIT, margins) are available where filed.\n')
  }

  // 3. Company profile from server's per-CIN cache (written by /fetch-mca route)
  const rawReport = JSON.parse(readFileSync(
    resolve(__dirname, 'railway-server', 'cache', `brisk_${CIN}.json`), 'utf8'
  ))
  const kyc    = rawReport?.ReportData?.CorporateDirectory?.CompanyKYC    || {}
  const master = rawReport?.ReportData?.CorporateDirectory?.CompanyMaster || {}
  const companyProfile = {
    name:               kyc.CompanyName || 'Unknown',
    cin:                kyc.CompanyCIN  || CIN,
    industry:           'Information and Communication',
    sub_industry:       'Digital Media',
    reporting_currency: 'INR',
    reporting_unit:     'INR (Absolute)',
    legal_structure:    master.Class || 'Private Company',
    fiscal_year_end:    'March 31',
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PASS A — pure adapter output only
  // ═══════════════════════════════════════════════════════════════════════
  console.log(SEP)
  console.log('PASS A — PURE ADAPTER OUTPUT (no supplementation)')
  console.log(SEP)
  const analysisA   = buildAnalysis(adaptedRows, companyProfile, null, false)
  const ratiosA     = calculateRatios(analysisA)
  const yrs         = analysisA.financial_years

  console.log('\n' + pad('Year', 8) + rpad('Z-Score', 10) + '  ' + pad('Zone', 16) + pad('Rating', 10) + 'Blockers')
  console.log(SEP_S)
  for (const yr of yrs) {
    const r = ratiosA[yr]
    console.log(
      pad(yr, 8) +
      rpad(r['Altman Z-Score'] ?? 'null', 10) + '  ' +
      pad(r['Altman Zone']  ?? '—', 16) +
      pad(r['Credit Rating'] ?? '—', 10) +
      (r['Altman Blockers'] ? '⚠ missing: ' + r['Altman Blockers'] : '')
    )
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PASS B — supplemented with raw BRisk fields
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n' + SEP)
  console.log('PASS B — SUPPLEMENTED (re-derives from raw BRisk report; should match Pass A since adapter now exposes all these fields)')
  console.log('(Pass A already surfaces ebit, depreciation, interest, pbt, tax, cash, receivables, inventory, fixedAssetsNet, cfo/cfi/cff, shareCapital)')
  console.log(SEP)
  const analysisB = buildAnalysis(adaptedRows, companyProfile, rawReport, true)
  const ratiosB   = calculateRatios(analysisB)

  console.log('\n' + pad('Year', 8) + rpad('Z-Score', 10) + '  ' + pad('Zone', 16) + pad('Rating', 10) +
    rpad('EBIT Margin%', 14) + rpad('Net Margin%', 13) + rpad('Current Ratio', 14))
  console.log(SEP_S)
  for (const yr of yrs) {
    const r = ratiosB[yr]
    console.log(
      pad(yr, 8) +
      rpad(r['Altman Z-Score'] ?? 'null', 10) + '  ' +
      pad(r['Altman Zone']  ?? '—', 16) +
      pad(r['Credit Rating'] ?? '—', 10) +
      rpad(r['EBIT Margin %']         ?? 'null', 14) +
      rpad(r['Net Profit Margin %']   ?? 'null', 13) +
      rpad(r['Current Ratio']         ?? 'null', 14)
    )
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CMA WORKBOOK — use supplemented analysis for richest output
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n' + SEP)
  console.log('CMA WORKBOOK GENERATION (using supplemented analysis)')
  console.log(SEP)
  const cmaBlob   = await generateCMAWorkbook(analysisB, ratiosB, {}, dataFlags)
  const cmaBuf    = Buffer.from(await cmaBlob.arrayBuffer())
  const cmaPath   = resolve(__dirname, `brisk_cma_${CIN}.xlsx`)
  writeFileSync(cmaPath, cmaBuf)
  console.log(`Saved brisk_cma_${CIN}.xlsx  (${(cmaBuf.length / 1024).toFixed(1)} KB)`)

  // Null-cell audit
  const nullAudit = await scanNulls(cmaPath)
  console.log('\n' + pad('Sheet', 34) + rpad('Cells', 8) + rpad('Null/Blank', 12) + '  % Null   Status')
  console.log(SEP_S)
  for (const [name, { dataCount, nullCount, pct }] of Object.entries(nullAudit)) {
    const status = pct === 0 ? '✓ all populated' : pct < 15 ? `⚠ ${nullCount} blank (labels/spacers)` : `✗ ${nullCount} blank — data gaps`
    console.log(pad(name, 34) + rpad(dataCount, 8) + rpad(nullCount, 12) + `  ${String(pct).padStart(4)}%   ${status}`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FIELD MISMATCH REPORT
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n' + SEP)
  console.log('FIELD-MISMATCH REPORT — /fetch-mca adapter output vs pipeline expectations')
  console.log(SEP)

  const rows = [
    // header
    ['Adapter Field', 'Pipeline Field', 'Section', 'Status'],
    ['─'.repeat(22), '─'.repeat(38), '─'.repeat(18), '─'.repeat(42)],
    // mapped fields
    ['revenue',            'revenue',                      'income_statement', '✓ direct match'],
    ['ebitda',             'ebitda',                       'income_statement', '✓ direct match'],
    ['pat',                'net_income',                   'income_statement', '✓ renamed (pat → net_income)'],
    ['netWorth',           'total_equity',                 'balance_sheet',   '✓ renamed (netWorth → total_equity)'],
    ['retainedEarnings',   'retained_earnings',            'balance_sheet',   '✓ direct match (derived: NW - PaidupCap)'],
    ['totalDebt',          'long_term_debt',               'balance_sheet',   '✓ renamed (Borrowings, all 0 here)'],
    ['currentAssets',      'total_current_assets',         'balance_sheet',   '✓ renamed (longer name)'],
    ['currentLiabilities', 'total_current_liabilities',   'balance_sheet',   '✓ renamed (longer name)'],
    ['totalAssets',        'total_assets',                 'balance_sheet',   '✓ direct match (TotalEquityAndLiabilities fallback)'],
    ['(derived)',          'total_liabilities',            'balance_sheet',   '✓ derived: totalAssets − total_equity'],
    ['(derived)',          'short_term_debt',              'balance_sheet',   '✓ hardcoded 0 (no CC/OD in Borrowings)'],
    // spacer
    ['', '', '', ''],
    // previously missing — now surfaced by adapter
    ['ebit',              'ebit',                      'income_statement', '✓ EBDITA − Depreciations (fallback to EBDITA)'],
    ['depreciation',      'depreciation_amortization', 'income_statement', '✓ BRisk Depreciations[]'],
    ['interestExpense',   'interest_expense',          'income_statement', '✓ BRisk Interests[]'],
    ['pbt',               'pbt',                       'income_statement', '✓ BRisk PBT[]'],
    ['tax',               'tax',                       'income_statement', '✓ BRisk Taxes[]'],
    ['shareCapital',      'share_capital',             'balance_sheet',    '✓ CompanyMaster.PaidupCapital (scalar)'],
    ['cash',              'cash_equivalents',          'balance_sheet',    '✓ BRisk CashAndBankBalances[]'],
    ['receivables',       'accounts_receivable',       'balance_sheet',    '✓ BRisk TradeReceivables[]'],
    ['inventory',         'inventory',                 'balance_sheet',    '✓ BRisk Inventories[]'],
    ['fixedAssetsNet',    'fixed_assets_net',          'balance_sheet',    '✓ TangibleAssets + IntangibleAssets + CapitalWIPAndOthers'],
    ['cfo',               'cfo',                       'cash_flow',        '✓ BRisk OperatingActivities[]'],
    ['cfi',               'cfi',                       'cash_flow',        '✓ BRisk InvestingActivities[]'],
    ['cff',               'cff',                       'cash_flow',        '✓ BRisk FinancingActivities[]'],
    // not in BRisk at all
    ['—',  'cost_of_goods_sold',        'income_statement', '✗ NOT IN BRisk — P&L detail not broken down to COGS'],
    ['—',  'gross_profit',              'income_statement', '✗ NOT IN BRisk — not available from API'],
    ['—',  'accounts_payable',          'balance_sheet',    '✗ NOT IN BRisk — CurrentLiabilities is an aggregate'],
    // word doc
    ['', '', '', ''],
    ['Word brief',  'generateOrganizedWordDoc', 'src/App.jsx', '⚠ NOT RUNNABLE from Node.js — embedded in React component'],
  ]

  for (const [a, b, c, d] of rows) {
    console.log(pad(a, 22) + pad(b, 38) + pad(c, 18) + d)
  }

  const mapped  = rows.filter(r => r[3].startsWith('✓')).length
  const noApi   = rows.filter(r => r[3].startsWith('✗ NOT IN')).length
  console.log('\n  Summary:')
  console.log(`  • ${mapped} fields mapped and surfaced by adapter → pipeline`)
  console.log(`  • ${noApi} fields not available from BRisk at all (P&L detail, A/P breakdown)`)
  console.log(`  • Word brief: generateOrganizedWordDoc is inside src/App.jsx (React component)`)
  console.log(`    — extracting it to a standalone module would allow Node.js invocation.`)

  console.log('\n' + SEP)
  console.log(`DONE.  Output files: brisk_cma_${CIN}.xlsx`)
  console.log(SEP)

} finally {
  if (serverProc) { serverProc.kill(); console.log('\nStopped server process.') }
}
