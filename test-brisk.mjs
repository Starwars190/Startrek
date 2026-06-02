import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Load .env without dotenv
// ---------------------------------------------------------------------------
const envPath = resolve(import.meta.dirname, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

const API_KEY = process.env.INSTAFINANCIALS_API_KEY;
if (!API_KEY) throw new Error('INSTAFINANCIALS_API_KEY not set');

const CIN = 'U74999MH2012PTC231360';
const BASE = 'https://api.instafinancials.com/InstaReports/v1/BRiskFinancials';
const REPORT_PATH = resolve(import.meta.dirname, 'brisk_report.json');
const ADAPTED_PATH = resolve(import.meta.dirname, 'brisk_adapted.json');
const HEADERS = {
  'user-key': API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

// ---------------------------------------------------------------------------
// Step 1 – Place order (skipped if brisk_report.json already exists)
// ---------------------------------------------------------------------------
let reportData;

if (existsSync(REPORT_PATH)) {
  console.log('brisk_report.json already exists — reusing cached report (no new order placed).');
  reportData = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
} else {
  console.log('Placing BRisk order…');
  const orderRes = await fetch(`${BASE}/CompanyCIN/${CIN}/OrderReport`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(['FIN']),
  });
  if (!orderRes.ok) {
    const text = await orderRes.text();
    throw new Error(`Order failed ${orderRes.status}: ${text}`);
  }
  const orderJson = await orderRes.json();
  const orderId = orderJson?.OrderID ?? orderJson?.Data?.OrderID ?? orderJson?.orderId;
  if (!orderId) throw new Error(`No OrderID in response: ${JSON.stringify(orderJson)}`);
  console.log(`Order placed. OrderID: ${orderId}`);

  console.log('Downloading report…');
  const dlRes = await fetch(`${BASE}/OrderID/${orderId}/DownloadReport`, {
    method: 'GET',
    headers: HEADERS,
    body: JSON.stringify(['FIN']),
  });
  if (!dlRes.ok) {
    const text = await dlRes.text();
    throw new Error(`Download failed ${dlRes.status}: ${text}`);
  }
  reportData = await dlRes.json();
  writeFileSync(REPORT_PATH, JSON.stringify(reportData, null, 2));
  console.log('Saved brisk_report.json');
}

// ---------------------------------------------------------------------------
// Step 2 – Adapter
// ---------------------------------------------------------------------------
const fin = reportData?.ReportData?.ComparativeFinancialsStandalone;
if (!fin) throw new Error('ComparativeFinancialsStandalone not found in report');

const pl  = fin.ProfitAndLossStatement      ?? {};
const bs  = fin.BalanceSheetStandalone      ?? {};
const cfs = fin.CashFlowStatementStandalone ?? {};
const paidupCapital =
  reportData?.ReportData?.CorporateDirectory?.CompanyMaster?.PaidupCapital ?? null;

// Convert [{FinancialYear, Amount}] arrays to a year→value map
function toMap(arr) {
  if (!Array.isArray(arr)) return {};
  return Object.fromEntries(arr.map(({ FinancialYear, Amount }) => [FinancialYear, Amount]));
}

// P&L maps
const revenue       = toMap(pl.TotalRevenues);
const ebitdaMap     = toMap(pl.EBDITA);
const deprMap       = toMap(pl.Depreciations);
const pat           = toMap(pl.PAT);
const interestMap   = toMap(pl.Interests);
const pbtMap        = toMap(pl.PBT);
const taxMap        = toMap(pl.Taxes);
// Balance sheet maps
const netWorthMap   = toMap(bs.NetWorth);
const totalDebt     = toMap(bs.Borrowings);
const currentAssets = toMap(bs.CurrentAssets);
const currentLiab   = toMap(bs.CurrentLiabilities);
const cashMap       = toMap(bs.CashAndBankBalances);
const receivables   = toMap(bs.TradeReceivables);
const inventories   = toMap(bs.Inventories);
const tangible      = toMap(bs.TangibleAssets);
const intangible    = toMap(bs.IntangibleAssets);
const cwip          = toMap(bs.CapitalWIPAndOthers);
// Fallback: TotalAssets → TotalEquityAndLiabilities
const totalAssetsMap = Array.isArray(bs.TotalAssets)
  ? toMap(bs.TotalAssets)
  : toMap(bs.TotalEquityAndLiabilities);
// Fallback: WorkingCapitals → CurrentAssets − CurrentLiabilities
const workingCapMap = Array.isArray(bs.WorkingCapitals) ? toMap(bs.WorkingCapitals) : null;
// Cash-flow maps
const cfoMap = toMap(cfs.OperatingActivities);
const cfiMap = toMap(cfs.InvestingActivities);
const cffMap = toMap(cfs.FinancingActivities);

// All years appearing in any series
const allYears = [
  ...new Set([
    ...Object.keys(revenue),       ...Object.keys(ebitdaMap),  ...Object.keys(pat),
    ...Object.keys(netWorthMap),   ...Object.keys(totalDebt),
    ...Object.keys(currentAssets), ...Object.keys(currentLiab),
    ...Object.keys(totalAssetsMap),
    ...Object.keys(cashMap),       ...Object.keys(receivables), ...Object.keys(cfoMap),
  ]),
].sort();

const adapted = allYears.map((year) => {
  const nw  = netWorthMap[year]    ?? null;
  const ca  = currentAssets[year]  ?? null;
  const cl  = currentLiab[year]    ?? null;
  const ta  = totalAssetsMap[year] ?? null;
  const wc  = workingCapMap !== null ? (workingCapMap[year] ?? null) : (ca != null && cl != null ? ca - cl : null);
  const re  = nw != null && paidupCapital != null ? nw - paidupCapital : null;
  const insufficient = ta == null || nw == null;
  const reExtreme = re !== null && ta !== null && ta !== 0 && Math.abs(re) > ta;

  // ebit: EBITDA − Depreciation; fall back to EBITDA when depreciation absent
  const eb   = ebitdaMap[year] ?? null;
  const dp   = deprMap[year]   ?? null;
  const ebit = eb !== null ? (dp !== null ? eb - dp : eb) : null;

  // fixedAssetsNet: sum components, treating absent ones as 0 when ≥1 is present
  const tan  = tangible[year]   ?? null;
  const itan = intangible[year] ?? null;
  const wip  = cwip[year]       ?? null;
  const fixedAssetsNet = (tan !== null || itan !== null || wip !== null)
    ? (tan ?? 0) + (itan ?? 0) + (wip ?? 0) : null;

  return {
    year,
    revenue:            revenue[year]       ?? null,
    ebitda:             eb,
    depreciation:       dp,
    ebit,
    interestExpense:    interestMap[year]   ?? null,
    pbt:                pbtMap[year]        ?? null,
    tax:                taxMap[year]        ?? null,
    pat:                pat[year]           ?? null,
    netWorth:           nw,
    shareCapital:       paidupCapital,
    retainedEarnings:   re,
    totalDebt:          totalDebt[year]     ?? null,
    currentAssets:      ca,
    currentLiabilities: cl,
    workingCapital:     wc,
    cash:               cashMap[year]       ?? null,
    receivables:        receivables[year]   ?? null,
    inventory:          inventories[year]   ?? null,
    fixedAssetsNet,
    totalAssets:        ta,
    cfo:                cfoMap[year]        ?? null,
    cfi:                cfiMap[year]        ?? null,
    cff:                cffMap[year]        ?? null,
    ...(insufficient ? { flag: 'insufficient' } : {}),
    ...(reExtreme ? { retainedEarningsFlag: 'extreme — abs value exceeds total assets, verify against source filing' } : {}),
  };
});

writeFileSync(ADAPTED_PATH, JSON.stringify(adapted, null, 2));
console.log('Saved brisk_adapted.json\n');

// ---------------------------------------------------------------------------
// Step 3 – Print table
// ---------------------------------------------------------------------------
const COL_W = 16;
const NUM_W = 14;
const fmt = (v) => v == null ? 'null'.padStart(NUM_W) : v.toLocaleString('en-IN').padStart(NUM_W);
const hdr = (s) => s.padEnd(COL_W);

// Table 1 — core P&L + BS (original fields)
const COLS1 = ['year','revenue','ebitda','depreciation','ebit','pat','netWorth',
               'retainedEarnings','totalDebt','currentAssets','currentLiabilities',
               'workingCapital','totalAssets'];

const div1 = '-'.repeat(COL_W + COLS1.slice(1).length * (NUM_W + 1) + 6);
console.log('--- Table 1: Core P&L & Balance Sheet ---');
console.log(div1);
console.log(hdr('Year') + '  ' + COLS1.slice(1).map(c => c.padStart(NUM_W)).join(' '));
console.log(div1);
for (const row of adapted) {
  const flags = [
    row.flag ? '⚠ insufficient' : '',
    row.retainedEarningsFlag ? '⚠ RE:' + row.retainedEarningsFlag : '',
  ].filter(Boolean).join('  ');
  console.log(
    hdr(row.year) + '  ' +
    COLS1.slice(1).map(c => fmt(row[c])).join(' ') +
    (flags ? '  ' + flags : '')
  );
}
console.log(div1);

// Table 2 — supplementary fields
const COLS2 = ['year','interestExpense','pbt','tax','shareCapital','cash',
               'receivables','inventory','fixedAssetsNet','cfo','cfi','cff'];

const div2 = '-'.repeat(COL_W + COLS2.slice(1).length * (NUM_W + 1) + 6);
console.log('\n--- Table 2: Supplementary Fields ---');
console.log(div2);
console.log(hdr('Year') + '  ' + COLS2.slice(1).map(c => c.padStart(NUM_W)).join(' '));
console.log(div2);
for (const row of adapted) {
  console.log(hdr(row.year) + '  ' + COLS2.slice(1).map(c => fmt(row[c])).join(' '));
}
console.log(div2);

console.log(`\n(All amounts in INR. PaidupCapital used for retainedEarnings: ${paidupCapital?.toLocaleString('en-IN') ?? 'N/A'})`);
console.log(`TotalAssets source: ${Array.isArray(bs.TotalAssets) ? 'TotalAssets' : 'TotalEquityAndLiabilities (fallback)'}`);
console.log(`WorkingCapital source: ${bs.WorkingCapitals != null ? 'WorkingCapitals' : 'CurrentAssets − CurrentLiabilities (fallback)'}`);
console.log(`ebit source: EBDITA − Depreciations (falls back to EBDITA when Depreciations absent)`);
