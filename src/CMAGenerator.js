import ExcelJS from 'exceljs'

// Phase 1 CMA Data Generator — historical from analysis JSON + growth-%-based projections
export async function generateCMAWorkbook(analysis, ratiosByYear, cmaInputs = {}) {
  const co = analysis.company_profile || {}
  const years = analysis.financial_years || []
  const is_ = analysis.income_statement || {}
  const bs_ = analysis.balance_sheet || {}
  const companyName = co.name || 'Private Company'

  // numeric getter for a key+year
  const g = (sec, k, yr) => {
    const v = sec?.[k]?.[yr]
    if (v == null) return null
    const n = parseFloat(String(v).replace(/,/g, ''))
    return isNaN(n) ? null : n
  }

  // historical revenue CAGR for default projection growth
  const lastYr = years[years.length - 1]
  const firstYr = years[0]
  const revLast = g(is_, 'revenue', lastYr)
  const revFirst = g(is_, 'revenue', firstYr)
  let defaultGrowth = 0.10
  if (revLast != null && revFirst != null && revFirst > 0 && years.length > 1) {
    defaultGrowth = Math.pow(revLast / revFirst, 1 / (years.length - 1)) - 1
  }
  const growthPct = cmaInputs.growthPct != null ? cmaInputs.growthPct / 100 : defaultGrowth
  const marginPct = cmaInputs.marginPct != null ? cmaInputs.marginPct / 100 : 0.25

  // Per-line-item projection (generic):
  //  - growing item        -> compound at growthPct
  //  - declining item but revenue growing -> grow at revenue rate (margins hold, stays internally consistent)
  //  - declining item and revenue flat/declining -> hold flat (conservative)
  //  - negative base (losses) -> hold flat (don't project compounding losses)
  const revenueGrowing = growthPct > 0
  const projectValue = (sec, key, step) => {
    const base = (() => { const v = sec?.[key]?.[lastYr]; if (v == null) return null; const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? null : n })()
    if (base == null) return null
    const prev = (() => { const v = sec?.[key]?.[firstYr]; if (v == null) return null; const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? null : n })()
    if (base < 0) return base // never compound a loss; hold flat
    const declining = (prev != null && base < prev)
    let rate
    if (!declining) rate = growthPct
    else rate = revenueGrowing ? growthPct : 0
    return Math.round(base * Math.pow(1 + rate, step) * 10) / 10
  }

  // projected year labels
  const lastNum = parseInt(String(lastYr).replace(/\D/g, '')) || 0
  const projYr1 = lastNum ? 'FY' + (lastNum + 1) + 'P' : 'Proj Yr1'
  const projYr2 = lastNum ? 'FY' + (lastNum + 2) + 'P' : 'Proj Yr2'
  const allYears = [...years, projYr1, projYr2]

  const wb = new ExcelJS.Workbook()
  wb.creator = 'FinSight AI'

  const navyFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A1628' } }
  const orangeFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6600' } }
  const paleFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF0F7' } }
  const lgFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FA' } }
  const projFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF7EE' } }
  const yellowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CC' } }
  const greenTextFont = { name: 'Arial', size: 10, color: { argb: 'FF1A6B3C' } }
  const redTextFont = { name: 'Arial', size: 10, color: { argb: 'FF8B1A1A' } }
  const hFont = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  const bFont = { name: 'Arial', size: 10 }
  const bbFont = { name: 'Arial', size: 10, bold: true }
  const thin = { style: 'thin', color: { argb: 'FFD1D5DB' } }
  const border4 = { top: thin, left: thin, bottom: thin, right: thin }

  function applyCell(ws, r, c, value, font, fill, align, numFmt) {
    const cell = ws.getCell(r, c)
    cell.value = value
    if (font) cell.font = font
    if (fill) cell.fill = fill
    if (align) cell.alignment = align
    if (numFmt) cell.numFmt = numFmt
    cell.border = border4
  }

  // ---------- COVER SHEET ----------
  const cov = wb.addWorksheet('Cover')
  cov.showGridLines = false
  cov.getColumn(1).width = 32
  cov.getColumn(2).width = 44
  applyCell(cov, 1, 1, 'CMA DATA — CREDIT MONITORING ARRANGEMENT', hFont, navyFill, { vertical: 'middle' })
  cov.mergeCells(1, 1, 1, 2)
  cov.getRow(1).height = 26
  const covRows = [
    ['Company Name', companyName],
    ['CIN', co.cin || co.registration_number || '—'],
    ['Industry', co.industry || '—'],
    ['Reporting Currency', co.reporting_currency || 'INR'],
    ['Financial Years Covered', years.join(', ')],
    ['Bank Name', cmaInputs.bankName || '[To be filled by CA]'],
    ['Proposed Credit Limit', cmaInputs.proposedCC != null ? cmaInputs.proposedCC : '[To be filled by CA]'],
    ['Existing Credit Limit', cmaInputs.existingCC != null ? cmaInputs.existingCC : '[To be filled by CA]'],
    ['Purpose of Facility', cmaInputs.purpose || '[To be filled by CA]'],
    ['Date of Preparation', new Date().toLocaleDateString('en-IN')],
  ]
  covRows.forEach(([label, value], idx) => {
    const rn = idx + 3
    const isPlaceholder = typeof value === 'string' && value.startsWith('[')
    cov.getRow(rn).height = 20
    applyCell(cov, rn, 1, label, bbFont, paleFill, { vertical: 'middle' })
    applyCell(cov, rn, 2, value, isPlaceholder ? { name: 'Arial', size: 10, italic: true, color: { argb: 'FF999999' } } : bFont, isPlaceholder ? yellowFill : null, { vertical: 'middle' })
  })
  const disc = covRows.length + 4
  applyCell(cov, disc, 1, 'Generated by FinSight AI. Historical figures sourced from audited financial statements. Projections are growth-based assumptions and must be reviewed by the preparing Chartered Accountant before submission. This document does not constitute a credit recommendation.', { name: 'Arial', size: 8, italic: true, color: { argb: 'FF6B7280' } }, null, { wrapText: true, vertical: 'top' })
  cov.mergeCells(disc, 1, disc, 2)
  cov.getRow(disc).height = 50

  // ---------- FORM 2: OPERATING STATEMENT ----------
  const f2 = wb.addWorksheet('Form 2 - Operating Stmt')
  f2.showGridLines = false
  f2.getColumn(1).width = 38
  allYears.forEach((_, i) => { f2.getColumn(i + 2).width = 15 })
  applyCell(f2, 1, 1, 'FORM 2 — OPERATING STATEMENT', hFont, navyFill, { vertical: 'middle' })
  allYears.forEach((yr, i) => applyCell(f2, 1, i + 2, yr, hFont, i < years.length ? navyFill : orangeFill, { horizontal: 'center', vertical: 'middle' }))
  f2.getRow(1).height = 22

  const f2rows = [
    ['Net Sales / Revenue from Operations', 'revenue', false],
    ['Cost of Goods Sold', 'cost_of_goods_sold', false],
    ['Gross Profit', 'gross_profit', true],
    ['Operating Expenses', 'operating_expenses', false],
    ['EBITDA', 'ebitda', true],
    ['Depreciation & Amortisation', 'depreciation_amortization', false],
    ['EBIT', 'ebit', true],
    ['Interest / Finance Costs', 'interest_expense', false],
    ['Profit Before Tax (PBT)', 'pbt', true],
    ['Tax', 'tax', false],
    ['Profit After Tax (PAT)', 'net_income', true],
  ]

  f2rows.forEach(([label, key, isTotal], idx) => {
    const rn = idx + 2
    const baseFill = isTotal ? paleFill : (idx % 2 === 0 ? lgFill : null)
    f2.getRow(rn).height = 17
    applyCell(f2, rn, 1, label, isTotal ? bbFont : bFont, baseFill, { vertical: 'middle' })
    // historical
    years.forEach((yr, yi) => {
      const num = g(is_, key, yr)
      applyCell(f2, rn, yi + 2, num, isTotal ? bbFont : bFont, baseFill, { horizontal: 'center' }, '#,##0.0')
    })
    ;[1, 2].forEach((step) => {
      const col = years.length + step + 1
      const proj = projectValue(is_, key, step)
      applyCell(f2, rn, col, proj, isTotal ? bbFont : bFont, projFill, { horizontal: 'center' }, '#,##0.0')
    })
  })
  const f2note = f2rows.length + 3
  applyCell(f2, f2note, 1, `Projections (green) based on ${Math.round(growthPct * 1000) / 10}% growth assumption. Historical (navy headers) from audited financials.`, { name: 'Arial', size: 8, italic: true, color: { argb: 'FF6B7280' } }, null, { vertical: 'middle' })

  // ---------- FORM 3: COMPARATIVE BALANCE SHEET ----------
  const f3 = wb.addWorksheet('Form 3 - Balance Sheet')
  f3.showGridLines = false
  f3.getColumn(1).width = 38
  allYears.forEach((_, i) => { f3.getColumn(i + 2).width = 15 })
  applyCell(f3, 1, 1, 'FORM 3 — COMPARATIVE BALANCE SHEET', hFont, navyFill, { vertical: 'middle' })
  allYears.forEach((yr, i) => applyCell(f3, 1, i + 2, yr, hFont, i < years.length ? navyFill : orangeFill, { horizontal: 'center', vertical: 'middle' }))
  f3.getRow(1).height = 22

  const f3rows = [
    ['Share Capital', 'share_capital', false],
    ['Reserves & Surplus / Retained Earnings', 'retained_earnings', false],
    ['Total Net Worth (TNW)', 'total_equity', true],
    ['Long-Term Debt', 'long_term_debt', false],
    ['Total Liabilities', 'total_liabilities', true],
    ['Short-Term Debt (Bank CC/OD)', 'short_term_debt', false],
    ['Trade Payables', 'accounts_payable', false],
    ['Total Current Liabilities (CL)', 'total_current_liabilities', true],
    ['Net Fixed Assets', 'fixed_assets_net', false],
    ['Inventory', 'inventory', false],
    ['Trade Receivables (Debtors)', 'accounts_receivable', false],
    ['Cash & Bank Balances', 'cash_equivalents', false],
    ['Total Current Assets (CA)', 'total_current_assets', true],
    ['Total Assets', 'total_assets', true],
  ]

  f3rows.forEach(([label, key, isTotal], idx) => {
    const rn = idx + 2
    const baseFill = isTotal ? paleFill : (idx % 2 === 0 ? lgFill : null)
    f3.getRow(rn).height = 17
    applyCell(f3, rn, 1, label, isTotal ? bbFont : bFont, baseFill, { vertical: 'middle' })
    years.forEach((yr, yi) => {
      const num = g(bs_, key, yr)
      applyCell(f3, rn, yi + 2, num, isTotal ? bbFont : bFont, baseFill, { horizontal: 'center' }, '#,##0.0')
    })
    ;[1, 2].forEach((step) => {
      const col = years.length + step + 1
      const proj = projectValue(bs_, key, step)
      applyCell(f3, rn, col, proj, isTotal ? bbFont : bFont, projFill, { horizontal: 'center' }, '#,##0.0')
    })
  })
  const f3note = f3rows.length + 3
  applyCell(f3, f3note, 1, 'Projected balance sheet items grown at the same assumption rate. CA should adjust for planned capex / debt changes.', { name: 'Arial', size: 8, italic: true, color: { argb: 'FF6B7280' } }, null, { vertical: 'middle' })

  // ---------- FORMS 4 & 5: WORKING CAPITAL + MPBF ----------
  const f4 = wb.addWorksheet('Form 4-5 - WC & MPBF')
  f4.showGridLines = false
  f4.getColumn(1).width = 42
  years.forEach((_, i) => { f4.getColumn(i + 2).width = 16 })
  applyCell(f4, 1, 1, 'FORM 4 — WORKING CAPITAL ASSESSMENT', hFont, navyFill, { vertical: 'middle' })
  years.forEach((yr, i) => applyCell(f4, 1, i + 2, yr, hFont, navyFill, { horizontal: 'center', vertical: 'middle' }))
  f4.getRow(1).height = 22

  const wcRow = (rn, label, fn, isTotal) => {
    const fill = isTotal ? paleFill : (rn % 2 === 0 ? lgFill : null)
    f4.getRow(rn).height = 17
    applyCell(f4, rn, 1, label, isTotal ? bbFont : bFont, fill, { vertical: 'middle' })
    years.forEach((yr, yi) => {
      const v = fn(yr)
      applyCell(f4, rn, yi + 2, v != null ? Math.round(v * 10) / 10 : null, isTotal ? bbFont : bFont, fill, { horizontal: 'center' }, '#,##0.0')
    })
  }
  const ca = (yr) => g(bs_, 'total_current_assets', yr)
  const clTotal = (yr) => g(bs_, 'total_current_liabilities', yr)
  const stDebt = (yr) => g(bs_, 'short_term_debt', yr) || 0
  const clNonBank = (yr) => { const c = clTotal(yr); return c != null ? c - stDebt(yr) : null }
  const wcGap = (yr) => { const a = ca(yr), b = clNonBank(yr); return (a != null && b != null) ? a - b : null }
  const margin = (yr) => { const gap = wcGap(yr); return gap != null ? gap * marginPct : null }
  const bankFin = (yr) => { const gap = wcGap(yr), m = margin(yr); return (gap != null && m != null) ? gap - m : null }

  wcRow(2, 'Total Current Assets (CA)', ca, true)
  wcRow(3, 'Less: Current Liabilities (Non-Bank)', clNonBank, false)
  wcRow(4, 'Working Capital Gap (CA - CL non-bank)', wcGap, true)
  wcRow(5, `Less: Margin @ ${Math.round(marginPct * 100)}% (borrower contribution)`, margin, false)
  wcRow(6, 'Bank Finance Required (Net WC)', bankFin, true)

  // Form 5 MPBF
  const m5start = 8
  applyCell(f4, m5start, 1, 'FORM 5 — MPBF (TANDON METHOD II)', hFont, navyFill, { vertical: 'middle' })
  years.forEach((yr, i) => applyCell(f4, m5start, i + 2, yr, hFont, navyFill, { horizontal: 'center', vertical: 'middle' }))
  f4.getRow(m5start).height = 22

  const mpbfRow = (rn, label, fn, isTotal) => {
    const fill = isTotal ? paleFill : (rn % 2 === 0 ? lgFill : null)
    f4.getRow(rn).height = 17
    applyCell(f4, rn, 1, label, isTotal ? bbFont : bFont, fill, { vertical: 'middle' })
    years.forEach((yr, yi) => {
      const v = fn(yr)
      applyCell(f4, rn, yi + 2, v != null ? Math.round(v * 10) / 10 : null, isTotal ? bbFont : bFont, fill, { horizontal: 'center' }, '#,##0.0')
    })
  }
  const method1 = (yr) => { const gap = wcGap(yr); return gap != null ? 0.75 * gap : null }
  const method2 = (yr) => { const a = ca(yr), b = clNonBank(yr); return (a != null && b != null) ? (0.75 * a) - b : null }
  const mpbf = (yr) => { const m1 = method1(yr), m2 = method2(yr); if (m1 == null || m2 == null) return null; return Math.min(m1, m2) }
  const existingCC = (yr) => { return (yr === lastYr && cmaInputs.existingCC != null) ? cmaInputs.existingCC : stDebt(yr) }
  const surplus = (yr) => { const mp = mpbf(yr), e = existingCC(yr); return (mp != null && e != null) ? mp - e : null }

  mpbfRow(m5start + 1, 'Method I: 75% of (CA - CL)', method1, false)
  mpbfRow(m5start + 2, 'Method II: 75% of CA, less CL', method2, false)
  mpbfRow(m5start + 3, 'MPBF (lower of Method I & II)', mpbf, true)
  mpbfRow(m5start + 4, 'Less: Existing Bank Finance (CC/OD)', existingCC, false)
  mpbfRow(m5start + 5, 'Surplus / (Shortfall) — Recommended Limit', surplus, true)

  // Generic applicability guard: detect companies with no working capital cycle
  const wcGapLast = wcGap(lastYr)
  const anyStDebt = years.some(yr => { const v = stDebt(yr); return v != null && v > 0 })
  const mpbfNotApplicable = (wcGapLast == null || wcGapLast <= 0) && !anyStDebt
  if (mpbfNotApplicable) {
    const naRow = m5start + 7
    applyCell(f4, naRow, 1, 'MPBF / Working Capital Finance — NOT APPLICABLE', bbFont, yellowFill, { vertical: 'middle' })
    years.forEach((_, i) => applyCell(f4, naRow, i + 2, 'N/A', { name: 'Arial', size: 10, italic: true, color: { argb: 'FF999999' } }, yellowFill, { horizontal: 'center' }))
    applyCell(f4, naRow + 1, 1, 'This entity shows no working capital funding gap (current liabilities cover current assets) and no short-term bank borrowing. A working capital limit is not applicable. The historical figures above are shown for reference only.', { name: 'Arial', size: 8, italic: true, color: { argb: 'FF6B7280' } }, null, { wrapText: true, vertical: 'top' })
    f4.mergeCells(naRow + 1, 1, naRow + 1, years.length + 1)
    f4.getRow(naRow + 1).height = 40
  } else {
    applyCell(f4, m5start + 7, 1, 'Tandon Method II is the RBI-recommended approach. CA contributes 25% of working capital gap as margin. Existing CC defaults to short-term debt unless entered.', { name: 'Arial', size: 8, italic: true, color: { argb: 'FF6B7280' } }, null, { vertical: 'middle' })
  }

  // ---------- FORM 6: FUND FLOW STATEMENT ----------
  const f6 = wb.addWorksheet('Form 6 - Fund Flow')
  f6.showGridLines = false
  f6.getColumn(1).width = 40
  f6.getColumn(2).width = 16
  f6.getColumn(3).width = 40
  f6.getColumn(4).width = 16
  applyCell(f6, 1, 1, `FORM 6 — FUND FLOW STATEMENT (${firstYr} to ${lastYr})`, hFont, navyFill, { vertical: 'middle' })
  f6.mergeCells(1, 1, 1, 4)
  f6.getRow(1).height = 22
  applyCell(f6, 2, 1, 'SOURCES OF FUNDS', bbFont, orangeFill, { horizontal: 'center' })
  applyCell(f6, 2, 2, 'Amount', bbFont, orangeFill, { horizontal: 'center' })
  applyCell(f6, 2, 3, 'USES OF FUNDS', bbFont, orangeFill, { horizontal: 'center' })
  applyCell(f6, 2, 4, 'Amount', bbFont, orangeFill, { horizontal: 'center' })

  const delta = (sec, k) => { const a = g(sec, k, firstYr), b = g(sec, k, lastYr); return (a != null && b != null) ? b - a : null }
  const pat = g(is_, 'net_income', lastYr)
  const dep = g(is_, 'depreciation_amortization', lastYr)
  const dLTD = delta(bs_, 'long_term_debt')
  const dEquity = delta(bs_, 'share_capital')
  const dFixed = delta(bs_, 'fixed_assets_net')
  const dCA = delta(bs_, 'total_current_assets')
  const dCL = delta(bs_, 'total_current_liabilities')

  const sources = []
  const uses = []
  if (pat != null) sources.push(['Profit After Tax (PAT)', pat])
  if (dep != null) sources.push(['Add: Depreciation', dep])
  if (dLTD != null && dLTD > 0) sources.push(['Increase in Long-Term Debt', dLTD])
  else if (dLTD != null && dLTD < 0) uses.push(['Repayment of Long-Term Debt', -dLTD])
  if (dEquity != null && dEquity > 0) sources.push(['Fresh Equity Capital', dEquity])
  if (dCL != null && dCL > 0) sources.push(['Increase in Current Liabilities', dCL])
  else if (dCL != null && dCL < 0) uses.push(['Decrease in Current Liabilities', -dCL])
  if (dFixed != null && dFixed > 0) uses.push(['Capital Expenditure (Fixed Assets)', dFixed])
  else if (dFixed != null && dFixed < 0) sources.push(['Sale of Fixed Assets', -dFixed])
  if (dCA != null && dCA > 0) uses.push(['Increase in Current Assets', dCA])
  else if (dCA != null && dCA < 0) sources.push(['Decrease in Current Assets', -dCA])

  const maxLen = Math.max(sources.length, uses.length)
  let srcTotal = 0, useTotal = 0
  for (let i = 0; i < maxLen; i++) {
    const rn = i + 3
    const fill = i % 2 === 0 ? lgFill : null
    f6.getRow(rn).height = 17
    if (sources[i]) { applyCell(f6, rn, 1, sources[i][0], bFont, fill, { vertical: 'middle' }); applyCell(f6, rn, 2, Math.round(sources[i][1] * 10) / 10, bFont, fill, { horizontal: 'center' }, '#,##0.0'); srcTotal += sources[i][1] }
    else { applyCell(f6, rn, 1, '', bFont, fill); applyCell(f6, rn, 2, null, bFont, fill) }
    if (uses[i]) { applyCell(f6, rn, 3, uses[i][0], bFont, fill, { vertical: 'middle' }); applyCell(f6, rn, 4, Math.round(uses[i][1] * 10) / 10, bFont, fill, { horizontal: 'center' }, '#,##0.0'); useTotal += uses[i][1] }
    else { applyCell(f6, rn, 3, '', bFont, fill); applyCell(f6, rn, 4, null, bFont, fill) }
  }
  const totRn = maxLen + 3
  applyCell(f6, totRn, 1, 'Total Sources', bbFont, paleFill, { vertical: 'middle' })
  applyCell(f6, totRn, 2, Math.round(srcTotal * 10) / 10, bbFont, paleFill, { horizontal: 'center' }, '#,##0.0')
  applyCell(f6, totRn, 3, 'Total Uses', bbFont, paleFill, { vertical: 'middle' })
  applyCell(f6, totRn, 4, Math.round(useTotal * 10) / 10, bbFont, paleFill, { horizontal: 'center' }, '#,##0.0')

  // ---------- FORM 7: FINANCIAL RATIOS WITH BENCHMARKS ----------
  const f7 = wb.addWorksheet('Form 7 - Ratios')
  f7.showGridLines = false
  f7.getColumn(1).width = 34
  years.forEach((_, i) => { f7.getColumn(i + 2).width = 13 })
  f7.getColumn(years.length + 2).width = 18
  applyCell(f7, 1, 1, 'FORM 7 — FINANCIAL RATIOS', hFont, navyFill, { vertical: 'middle' })
  years.forEach((yr, i) => applyCell(f7, 1, i + 2, yr, hFont, navyFill, { horizontal: 'center', vertical: 'middle' }))
  applyCell(f7, 1, years.length + 2, 'Banker Benchmark', hFont, orangeFill, { horizontal: 'center', vertical: 'middle' })
  f7.getRow(1).height = 22

  const ratioList = [
    ['Current Ratio', 'Current Ratio', 1.33, 'min'],
    ['Debt-Equity Ratio', 'Debt to Equity', 2.0, 'max'],
    ['Interest Cover (EBIT)', 'Interest Cover (EBIT)', 2.0, 'min'],
    ['Net Profit Margin %', 'Net Profit Margin %', 5.0, 'min'],
    ['EBITDA Margin %', 'EBITDA Margin %', 10.0, 'min'],
    ['Return on Equity %', 'Return on Equity %', 15.0, 'min'],
    ['Receivables Days (DSO)', 'Receivables Days (DSO)', 60, 'max'],
    ['Inventory Days', 'Inventory Days', 60, 'max'],
    ['Revenue Growth %', 'Revenue Growth %', 10.0, 'min'],
    ['Altman Z-Score', 'Altman Z-Score', 2.9, 'min'],
  ]
  const benchLabel = { min: (v) => `≥ ${v}`, max: (v) => `≤ ${v}` }

  ratioList.forEach(([label, key, bench, dir], idx) => {
    const rn = idx + 2
    const fill = idx % 2 === 0 ? lgFill : null
    f7.getRow(rn).height = 17
    applyCell(f7, rn, 1, label, bFont, fill, { vertical: 'middle' })
    years.forEach((yr, yi) => {
      const val = ratiosByYear?.[yr]?.[key]
      let cellFont = bFont
      let display = val != null ? val : null
      if (val != null) {
        const pass = dir === 'min' ? val >= bench : val <= bench
        cellFont = pass ? greenTextFont : redTextFont
      }
      // Altman: very high scores are valid but cap the display with context to avoid looking like a glitch
      if (key === 'Altman Z-Score' && val != null && val > 8) {
        const cell = f7.getCell(rn, yi + 2)
        cell.value = '8.0+ (very strong)'
        cell.font = greenTextFont
        cell.fill = fill
        cell.alignment = { horizontal: 'center' }
        cell.border = border4
        return
      }
      applyCell(f7, rn, yi + 2, display, cellFont, fill, { horizontal: 'center' }, '#,##0.00')
    })
    applyCell(f7, rn, years.length + 2, benchLabel[dir](bench), { name: 'Arial', size: 9, italic: true, color: { argb: 'FF6B7280' } }, fill, { horizontal: 'center' })
  })
  applyCell(f7, ratioList.length + 3, 1, 'Green = meets banker benchmark; Red = below benchmark. Benchmarks are indicative; individual banks may vary.', { name: 'Arial', size: 8, italic: true, color: { argb: 'FF6B7280' } }, null, { vertical: 'middle' })

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
