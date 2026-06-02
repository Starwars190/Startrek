import https from 'https'

export const BRISK_BASE = 'https://api.instafinancials.com/InstaReports/v1/BRiskFinancials'

// Native fetch rejects a body on GET (Node 18+ strict), so we use the lower-level
// https module for InstaFinancials DownloadReport which requires GET + JSON body.
export function httpsGetJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const bodyStr = JSON.stringify(body)
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
      },
      (r) => {
        let raw = ''
        r.on('data', (c) => { raw += c })
        r.on('end', () => {
          resolve({
            ok:     r.statusCode >= 200 && r.statusCode < 300,
            status: r.statusCode,
            json:   () => JSON.parse(raw),
            text:   () => raw,
          })
        })
      }
    )
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

function toMap(arr) {
  if (!Array.isArray(arr)) return {}
  return Object.fromEntries(arr.map(({ FinancialYear, Amount }) => [FinancialYear, Amount]))
}

export function adaptBRiskReport(reportData) {
  const fin = reportData?.ReportData?.ComparativeFinancialsStandalone
  if (!fin) throw new Error('ComparativeFinancialsStandalone not found in report')

  const pl  = fin.ProfitAndLossStatement      ?? {}
  const bs  = fin.BalanceSheetStandalone      ?? {}
  const cfs = fin.CashFlowStatementStandalone ?? {}
  const paidupCapital =
    reportData?.ReportData?.CorporateDirectory?.CompanyMaster?.PaidupCapital ?? null

  const revenue       = toMap(pl.TotalRevenues)
  const ebitdaMap     = toMap(pl.EBDITA)
  const deprMap       = toMap(pl.Depreciations)
  const pat           = toMap(pl.PAT)
  const interestMap   = toMap(pl.Interests)
  const pbtMap        = toMap(pl.PBT)
  const taxMap        = toMap(pl.Taxes)

  const netWorthMap   = toMap(bs.NetWorth)
  const totalDebtMap  = toMap(bs.Borrowings)
  const currentAssets = toMap(bs.CurrentAssets)
  const currentLiab   = toMap(bs.CurrentLiabilities)
  const cashMap       = toMap(bs.CashAndBankBalances)
  const receivables   = toMap(bs.TradeReceivables)
  const inventories   = toMap(bs.Inventories)
  const tangible      = toMap(bs.TangibleAssets)
  const intangible    = toMap(bs.IntangibleAssets)
  const cwip          = toMap(bs.CapitalWIPAndOthers)
  const totalAssetsMap = Array.isArray(bs.TotalAssets)
    ? toMap(bs.TotalAssets)
    : toMap(bs.TotalEquityAndLiabilities)
  const workingCapMap = Array.isArray(bs.WorkingCapitals) ? toMap(bs.WorkingCapitals) : null

  const cfoMap = toMap(cfs.OperatingActivities)
  const cfiMap = toMap(cfs.InvestingActivities)
  const cffMap = toMap(cfs.FinancingActivities)

  const allYears = [...new Set([
    ...Object.keys(revenue),       ...Object.keys(ebitdaMap),  ...Object.keys(pat),
    ...Object.keys(netWorthMap),   ...Object.keys(totalDebtMap),
    ...Object.keys(currentAssets), ...Object.keys(currentLiab),
    ...Object.keys(totalAssetsMap),
    ...Object.keys(cashMap),       ...Object.keys(receivables), ...Object.keys(cfoMap),
  ])].sort()

  return allYears.map((year) => {
    const nw  = netWorthMap[year]    ?? null
    const ca  = currentAssets[year]  ?? null
    const cl  = currentLiab[year]    ?? null
    const ta  = totalAssetsMap[year] ?? null
    const wc  = workingCapMap !== null
      ? (workingCapMap[year] ?? null)
      : (ca !== null && cl !== null ? ca - cl : null)
    const re  = nw !== null && paidupCapital !== null ? nw - paidupCapital : null
    const insufficient = ta === null || nw === null
    const reExtreme = re !== null && ta !== null && ta !== 0 && Math.abs(re) > ta

    const eb   = ebitdaMap[year] ?? null
    const dp   = deprMap[year]   ?? null
    const ebit = eb !== null ? (dp !== null ? eb - dp : eb) : null

    const tan  = tangible[year]   ?? null
    const itan = intangible[year] ?? null
    const wip  = cwip[year]       ?? null
    const fixedAssetsNet = (tan !== null || itan !== null || wip !== null)
      ? (tan ?? 0) + (itan ?? 0) + (wip ?? 0) : null

    return {
      year,
      revenue:            revenue[year]        ?? null,
      ebitda:             eb,
      depreciation:       dp,
      ebit,
      interestExpense:    interestMap[year]    ?? null,
      pbt:                pbtMap[year]         ?? null,
      tax:                taxMap[year]         ?? null,
      pat:                pat[year]            ?? null,
      netWorth:           nw,
      shareCapital:       paidupCapital,
      retainedEarnings:   re,
      totalDebt:          totalDebtMap[year]   ?? null,
      currentAssets:      ca,
      currentLiabilities: cl,
      workingCapital:     wc,
      cash:               cashMap[year]        ?? null,
      receivables:        receivables[year]    ?? null,
      inventory:          inventories[year]    ?? null,
      fixedAssetsNet,
      totalAssets:        ta,
      cfo:                cfoMap[year]         ?? null,
      cfi:                cfiMap[year]         ?? null,
      cff:                cffMap[year]         ?? null,
      ...(insufficient ? { flag: 'insufficient' } : {}),
      ...(reExtreme    ? { retainedEarningsFlag: 'extreme — abs value exceeds total assets, verify against source filing' } : {}),
    }
  })
}
