async function processPrivateCompanyDoc(file, options, onProgress, onDebug) {
  try {
    onProgress('reading')
    onDebug('FILE RECEIVED: ' + file.name)

    const arrayBuffer = await file.arrayBuffer()
    let fullText = ''

    try {
      const pdfjsLib = await import('pdfjs-dist')
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      onDebug('PDF: ' + pdf.numPages + ' pages')
      for (let i = 1; i <= pdf.numPages; i++) {
        try {
          const page = await pdf.getPage(i)
          const content = await page.getTextContent()
          fullText += content.items.map(item => item.str).join(' ') + '\n'
        } catch(e) {}
      }
    } catch(e) {
      onDebug('PDF read error: ' + e.message)
    }

    onDebug('TEXT: ' + fullText.length + ' chars')

    if (fullText.length < 500) {
      throw new Error('This PDF appears to be image-based. Please download the XBRL version from mca.gov.in and upload that instead.')
    }

    onProgress('extracting')
    onDebug('CALLING CLAUDE API...')

    const apiResponse = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: 'You are a chartered accountant with 20 years experience reading Indian company annual reports. Extract financial data with perfect accuracy. Return only valid JSON with no text before or after.',
        messages: [{
          role: 'user',
          content: `Extract all financial data from this Indian company annual report text. Return ONLY this JSON structure with no other text:

{
  "company_name": "string",
  "cin": "string or null",
  "financial_year": "string",
  "currency": "INR",
  "unit": "Lakhs or Crores",
  "sector": "string or null",
  "auditor": "string or null",
  "directors": [{"name": "string", "designation": "string"}],
  "profit_loss": {
    "revenue_from_operations": {"current": number, "prior": number},
    "other_income": {"current": number, "prior": number},
    "total_income": {"current": number, "prior": number},
    "cogs": {"current": number, "prior": number},
    "gross_profit": {"current": number, "prior": number},
    "changes_in_inventories": {"current": number, "prior": number},
    "employee_costs": {"current": number, "prior": number},
    "interest_expense": {"current": number, "prior": number},
    "depreciation": {"current": number, "prior": number},
    "other_expenses": {"current": number, "prior": number},
    "total_expenses": {"current": number, "prior": number},
    "ebitda": {"current": number, "prior": number},
    "operating_profit": {"current": number, "prior": number},
    "pbt": {"current": number, "prior": number},
    "tax": {"current": number, "prior": number},
    "net_income": {"current": number, "prior": number},
    "eps_basic": {"current": number, "prior": number},
    "eps_diluted": {"current": number, "prior": number}
  },
  "balance_sheet": {
    "share_capital": {"current": number, "prior": number},
    "reserves_and_surplus": {"current": number, "prior": number},
    "total_equity": {"current": number, "prior": number},
    "long_term_debt": {"current": number, "prior": number},
    "non_current_liabilities": {"current": number, "prior": number},
    "short_term_debt": {"current": number, "prior": number},
    "trade_payables": {"current": number, "prior": number},
    "current_liabilities": {"current": number, "prior": number},
    "total_liabilities": {"current": number, "prior": number},
    "fixed_assets": {"current": number, "prior": number},
    "non_current_assets": {"current": number, "prior": number},
    "inventory": {"current": number, "prior": number},
    "receivables": {"current": number, "prior": number},
    "cash": {"current": number, "prior": number},
    "current_assets": {"current": number, "prior": number},
    "total_assets": {"current": number, "prior": number}
  },
  "cash_flow": {
    "cfo": {"current": number, "prior": number},
    "investing": {"current": number, "prior": number},
    "financing": {"current": number, "prior": number},
    "net_change_in_cash": {"current": number, "prior": number},
    "closing_cash": {"current": number, "prior": number}
  }
}

RULES - never break these:
1. revenue_from_operations is the top line. It may be labeled: Revenue from Operations, Total Revenue from Operations, Net Revenue, Turnover, Net Sales, Revenue from Contracts with Customers, Total revenue from operations other than finance company. Extract whichever you find.
2. current year is always the MORE RECENT date. For example if document shows 01/04/2024 to 31/03/2025 and 01/04/2023 to 31/03/2024, the first period is current year FY2025.
3. Strip all commas from numbers. 73,698.16 becomes 73698.16
4. Brackets mean negative. (1,680.94) becomes -1680.94
5. Return null for any field not found. Never guess.
6. Page numbers like 1, 2, 3 at page edges are NOT financial figures.
7. Note reference numbers like 3, 4, 5 in narrow columns are NOT financial figures.

DOCUMENT TEXT:
${fullText}`
        }]
      })
    })

    const apiData = await apiResponse.json()
    if (!apiData?.content?.[0]?.text) throw new Error('Claude API returned no content')

    const rawText = apiData.content[0].text
    const start = rawText.indexOf('{')
    const end = rawText.lastIndexOf('}')
    if (start === -1 || end === -1) throw new Error('No JSON found in Claude response')

    const claudeResult = JSON.parse(rawText.substring(start, end + 1))
    onDebug('CLAUDE RESULT: company=' + claudeResult.company_name + ' revenue=' + claudeResult.profit_loss?.revenue_from_operations?.current)

    const pl = claudeResult.profit_loss || {}
    const bs = claudeResult.balance_sheet || {}
    const cf = claudeResult.cash_flow || {}

    const aggregated = {
      revenue: pl.revenue_from_operations?.current ?? pl.total_income?.current ?? null,
      otherIncome: pl.other_income?.current ?? null,
      totalIncome: pl.total_income?.current ?? null,
      grossProfit: pl.gross_profit?.current ?? null,
      ebitda: pl.ebitda?.current ?? null,
      operatingProfit: pl.operating_profit?.current ?? null,
      pbt: pl.pbt?.current ?? null,
      tax: pl.tax?.current ?? null,
      netIncome: pl.net_income?.current ?? null,
      interestExpense: pl.interest_expense?.current ?? null,
      depreciation: pl.depreciation?.current ?? null,
      cogs: pl.cogs?.current ?? null,
      employeeCosts: pl.employee_costs?.current ?? null,
      otherExpenses: pl.other_expenses?.current ?? null,
      totalExpenses: pl.total_expenses?.current ?? null,
      eps: pl.eps_basic?.current ?? null,
      totalAssets: bs.total_assets?.current ?? null,
      currentAssets: bs.current_assets?.current ?? null,
      nonCurrentAssets: bs.non_current_assets?.current ?? null,
      cash: bs.cash?.current ?? null,
      inventory: bs.inventory?.current ?? null,
      receivables: bs.receivables?.current ?? null,
      fixedAssets: bs.fixed_assets?.current ?? null,
      totalLiabilities: bs.total_liabilities?.current ?? null,
      currentLiabilities: bs.current_liabilities?.current ?? null,
      nonCurrentLiabilities: bs.non_current_liabilities?.current ?? null,
      totalEquity: bs.total_equity?.current ?? null,
      longTermDebt: bs.long_term_debt?.current ?? null,
      shortTermDebt: bs.short_term_debt?.current ?? null,
      tradePayables: bs.trade_payables?.current ?? null,
      shareCapital: bs.share_capital?.current ?? null,
      reserves: bs.reserves_and_surplus?.current ?? null,
      operatingCashFlow: cf.cfo?.current ?? null,
      investingCashFlow: cf.investing?.current ?? null,
      financingCashFlow: cf.financing?.current ?? null,
    }

    const aggregatedPrior = {
      revenue: pl.revenue_from_operations?.prior ?? pl.total_income?.prior ?? null,
      otherIncome: pl.other_income?.prior ?? null,
      totalIncome: pl.total_income?.prior ?? null,
      grossProfit: pl.gross_profit?.prior ?? null,
      ebitda: pl.ebitda?.prior ?? null,
      operatingProfit: pl.operating_profit?.prior ?? null,
      pbt: pl.pbt?.prior ?? null,
      tax: pl.tax?.prior ?? null,
      netIncome: pl.net_income?.prior ?? null,
      interestExpense: pl.interest_expense?.prior ?? null,
      depreciation: pl.depreciation?.prior ?? null,
      cogs: pl.cogs?.prior ?? null,
      employeeCosts: pl.employee_costs?.prior ?? null,
      otherExpenses: pl.other_expenses?.prior ?? null,
      totalExpenses: pl.total_expenses?.prior ?? null,
      eps: pl.eps_basic?.prior ?? null,
      totalAssets: bs.total_assets?.prior ?? null,
      currentAssets: bs.current_assets?.prior ?? null,
      nonCurrentAssets: bs.non_current_assets?.prior ?? null,
      cash: bs.cash?.prior ?? null,
      inventory: bs.inventory?.prior ?? null,
      receivables: bs.receivables?.prior ?? null,
      fixedAssets: bs.fixed_assets?.prior ?? null,
      totalLiabilities: bs.total_liabilities?.prior ?? null,
      currentLiabilities: bs.current_liabilities?.prior ?? null,
      nonCurrentLiabilities: bs.non_current_liabilities?.prior ?? null,
      totalEquity: bs.total_equity?.prior ?? null,
      longTermDebt: bs.long_term_debt?.prior ?? null,
      shortTermDebt: bs.short_term_debt?.prior ?? null,
      tradePayables: bs.trade_payables?.prior ?? null,
      shareCapital: bs.share_capital?.prior ?? null,
      reserves: bs.reserves_and_surplus?.prior ?? null,
      operatingCashFlow: cf.cfo?.prior ?? null,
      investingCashFlow: cf.investing?.prior ?? null,
      financingCashFlow: cf.financing?.prior ?? null,
    }

    const companyInfo = {
      name: claudeResult.company_name || file.name,
      cin: claudeResult.cin || null,
      sector: claudeResult.sector || null,
      auditor: claudeResult.auditor || null,
      directors: claudeResult.directors || [],
      financialYear: claudeResult.financial_year || 'FY2025',
      currency: claudeResult.currency || 'INR',
      unit: claudeResult.unit || 'Lakhs',
      reportingType: claudeResult.standalone_or_consolidated || 'Standalone'
    }

    onProgress('generating')

    const validCount = Object.values(aggregated).filter(v => v !== null).length
    onDebug('VALID FIELDS: ' + validCount)

    if (validCount < 5) {
      throw new Error('Insufficient data extracted. Please upload the XBRL version from mca.gov.in')
    }

    const swot = await generateSWOTAndInterpretation(companyInfo, aggregated, null, null, aggregatedPrior)

    const excelResult = await generateFinancialExcel(companyInfo, aggregated, aggregatedPrior, null, swot, {}, {})
    const wordResult = await generateOrganizedWordDoc([], companyInfo, null, swot, [], file.name, { aggregated, aggregatedPrior })

    onProgress('complete')

    return {
      excelBlob: excelResult?.excelBlob || excelResult,
      excelFileName: 'FinSight_' + (companyInfo.name || 'Report').replace(/[^a-zA-Z0-9]/g, '_') + '_Financials.xlsx',
      wordBlob: wordResult?.blob || wordResult,
      wordFileName: 'FinSight_' + (companyInfo.name || 'Report').replace(/[^a-zA-Z0-9]/g, '_') + '_Report.docx',
      companyInfo,
      aggregated,
      aggregatedPrior,
      swot,
      sectionCount: wordResult?.sectionCount || 0,
      sheetCount: excelResult?.sheetCount || 0,
    }

  } catch(err) {
    onDebug('ERROR: ' + err.message)
    throw err
  }
}
